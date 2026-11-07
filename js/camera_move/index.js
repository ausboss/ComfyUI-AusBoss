// Camera Move: the shot on the node, and on the box (subgraph node) that holds it.
//
// The face itself is face.mjs. This file mounts it, keeps it pointed at
// wherever the camera keys are kept, runs the node alone when the face asks
// for the clip, and hands it what a run sent back.
//
// Where the keys are kept:
// - on the node, in its own `camera` setting;
// - once `camera` is brought up to a box (a subgraph input linked to it),
//   in the box's own copy of the setting, one copy per box. The face then
//   sits on the box too, and the node inside shows that box's keys.

import { api } from "../../../scripts/api.js";
import { app } from "../../../scripts/app.js";
import { chainCallback, keepDomWidgetWidthAuto, notifyAusbossChange, showToast } from "../shared/index.mjs";
import { executionIdOf, isSwitchedOff } from "../shared/graph_ids.mjs";
import { SUBGRAPH_INPUT_ID, boxesOf, hostBox, workflowNodes } from "../shared/lora_box.mjs";
import { WIDGET_FRAME, ensureNodeMinHeight, fillNodeHeight } from "../shared/panel_layout.mjs";
import { hideWidget } from "../shared/widget_visibility.mjs";
import { CONTROLS_HEIGHT, MIN_STAGE, MIN_WIDTH, mountCameraFace } from "./face.mjs";
import { mountBoxCard } from "./box_card.mjs";
import { CARD_WIDGET } from "../shared/widget_card.mjs";

const NODE_CLASS = "AUSBOSS_NODES_CameraMove";
const CAMERA = "camera";
const UI_KEY = "ausboss_camera_scene";
const FACE_WIDGET = "ausboss_camera_move";
const OPENING_WIDTH = 460;
const OPENING_ROOM = 90; // a new node opens this much taller than its floor, so a wide clip fills the picture
const MIN_HEIGHT = MIN_STAGE + CONTROLS_HEIGHT + WIDGET_FRAME;
const mounts = new Set();

const rootGraph = () => app.rootGraph ?? app.graph;
const isMove = (node) => node?.type === NODE_CLASS || node?.comfyClass === NODE_CLASS;
const same = (a, b) => a != null && b != null && String(a) === String(b);
const linkOf = (graph, id) => (id == null || !graph ? null : graph.getLink?.(id) ?? graph.links?.get?.(id) ?? graph.links?.[id] ?? null);
const nodeOf = (graph, id) => graph?.getNodeById?.(id) ?? (graph?.nodes ?? graph?._nodes ?? []).find((node) => same(node?.id, id)) ?? null;
const ownCamera = (node) => node?.widgets?.find((widget) => widget?.name === CAMERA) ?? null;
const boxCopy = (box, name) => (box?.widgets ?? []).find((widget) => widget?.name === name && typeof widget.value === "string") ?? null;

// The subgraph input that brings a node's camera in from its box, or null.
function cameraInputName(node) {
  const graph = node?.graph;
  const index = (node?.inputs ?? []).findIndex((input) => input?.name === CAMERA);
  if (!graph || index < 0) return null;
  const link = linkOf(graph, node.inputs[index].link);
  if (!link || !same(link.origin_id, SUBGRAPH_INPUT_ID)) return null;
  return graph.inputs?.[link.origin_slot]?.name ?? null;
}

// The first Camera Move inside a box whose camera comes up to the box: { name, inner }.
function boxCamera(box) {
  const subgraph = box?.subgraph;
  for (const input of subgraph?.inputs ?? []) {
    for (const id of input?.linkIds ?? []) {
      const link = linkOf(subgraph, id);
      const inner = link && nodeOf(subgraph, link.target_id);
      if (isMove(inner) && inner.inputs?.[link.target_slot]?.name === CAMERA) return { name: input.name, inner };
    }
  }
  return null;
}

// Where a face reads and writes the keys, and which run of the node it shows.
function sourceOf(mount) {
  const root = rootGraph();
  if (mount.box) {
    const widget = boxCopy(mount.box, mount.inputName);
    if (widget) hideWidget(widget);
    const at = executionIdOf(root, mount.box);
    return { widget, id: at ? `${at}:${mount.inner.id}` : null, holder: mount.box };
  }
  const node = mount.inner;
  const fed = cameraInputName(node);
  if (fed) {
    const box = hostBox(node.graph, boxesOf(node.graph, workflowNodes(root)), null);
    const widget = box && boxCopy(box, fed);
    const at = box && executionIdOf(root, box);
    if (widget) return { widget, id: at ? `${at}:${node.id}` : executionIdOf(root, node), holder: box };
  }
  return { widget: ownCamera(node), id: executionIdOf(root, node), holder: node };
}

const viewRoute = (file) => `/view?${new URLSearchParams({ filename: file.filename, type: file.type || "temp", subfolder: file.subfolder || "" })}`;
const viewUrl = (file) => api.apiURL(viewRoute(file));
// The depth picture's exact bytes, through ComfyUI's own request helper.
const viewBlob = async (file) => {
  const response = await api.fetchApi(viewRoute(file));
  if (!response.ok) throw new Error(`depth ${response.status}`);
  return response.blob();
};

function locatorOf(node) {
  const graph = node?.graph;
  if (!graph || node.id == null) return null;
  const root = graph.rootGraph ?? graph;
  return graph !== root && graph.id ? `${graph.id}:${node.id}` : String(node.id);
}

function restore(mount) {
  if (mount.face.hasScene) return;
  const scene = app.nodeOutputs?.[locatorOf(mount.inner)]?.[UI_KEY]?.[0];
  if (scene) mount.face.takeScene(scene);
}

function mount(host, { box = null, inputName = null, inner = host } = {}) {
  const entry = { host, box, inputName, inner, face: null, widget: null };
  const face = mountCameraFace({
    read: () => String(sourceOf(entry).widget?.value ?? ""),
    write: (text) => {
      const widget = sourceOf(entry).widget;
      if (!widget) return;
      widget.value = text;
      app.canvas?.setDirty?.(true, false);
      notifyAusbossChange();
    },
    view: viewUrl,
    blob: viewBlob,
    run: async () => {
      const { id, holder } = sourceOf(entry);
      if (!id || typeof app.queuePrompt !== "function") return false;
      if (isSwitchedOff(rootGraph(), holder) || isSwitchedOff(rootGraph(), inner)) {
        showToast({ severity: "warn", summary: "Camera Move", detail: "This node is switched off (bypassed or muted), so it cannot run." });
        return false;
      }
      entry.askedAt = performance.now();
      // At the front of the queue: the clip shows up once the job running now is done.
      const queued = await app.queuePrompt(-1, 1, [id]);
      // Refused: an empty loader, a missing link, or a check that stopped it (it says why in a note).
      // Nothing was queued, so the face must not wait for a picture that never comes.
      if (queued === false) return false;
      return true;
    },
  });
  entry.face = face;
  const widget = host.addDOMWidget(box ? `${FACE_WIDGET}:${inputName}` : FACE_WIDGET, FACE_WIDGET, face.root, { serialize: false, hideOnZoom: false });
  keepDomWidgetWidthAuto(widget);
  // Never saved with the workflow: options.serialize only keeps it out of the prompt.
  widget.serialize = false;
  // The floor follows the controls as they measure on this screen (fonts differ between phones).
  fillNodeHeight(widget, { minWidth: MIN_WIDTH, minHeight: () => face.floor() + WIDGET_FRAME, minNodeSize: [MIN_WIDTH, MIN_HEIGHT], exactMinWidth: true });
  entry.widget = widget;
  mounts.add(entry);
  restore(entry);
  holdFloor(host);
  return entry;
}

// A node or box kept shorter than the face needs (a saved size, a font that
// runs taller on this screen) would cut the controls off at its bottom edge.
function holdFloor(host) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (ensureNodeMinHeight(host)) host.setDirtyCanvas?.(true, true);
  }));
}

function unmount(entry) {
  mounts.delete(entry);
  entry.face.destroy();
  try { entry.host.removeWidget?.(entry.widget); } catch { entry.widget?.onRemove?.(); }
}

// A new node or box opens with room for the picture; a saved size wins.
function openRoomy(host) {
  const floor = Number(host.computeSize?.()?.[1]);
  if (!Number.isFinite(floor) || host.size?.[1] > floor + 40) return;
  host.setSize?.([Math.max(host.size?.[0] ?? 0, OPENING_WIDTH), floor + OPENING_ROOM]);
}

function build(node) {
  if (node.__ausbossCameraMove) return node.__ausbossCameraMove;
  hideWidget(ownCamera(node));
  node.__ausbossCameraMove = mount(node);
  return node.__ausbossCameraMove;
}

// The settings card and any LoRA rows sit on top; the shot comes last and
// takes the rest of the box, so its buttons stay on the bottom edge.
function faceLast(box) {
  // A box makes `widgets` afresh on every read (its settings, then the panels
  // added to it), so the panels are put in order in their own list: any other
  // panel (a LoRA Loader's rows), the settings card, then the face. Nodes 2.0
  // lays them out in the order they were made, which is the same.
  const widgets = Array.isArray(box._extraWidgets) ? box._extraWidgets : box.widgets ?? [];
  const order = [widgets.find((w) => w?.name === CARD_WIDGET), box.__ausbossCameraBox?.widget].filter(Boolean);
  const want = [...widgets.filter((w) => !order.includes(w)), ...order];
  if (want.every((w, i) => widgets[i] === w)) return false;
  widgets.splice(0, widgets.length, ...want);
  box.setDirtyCanvas?.(true, true);
  return true;
}

// A box row reads its options from the widget inside. A node with a card
// (Image Resize) hides its own rows by setting options.hidden there, and
// Nodes 2.0 would then hide the box's row too. The box keeps every setting
// brought up to it in view, except the camera text the face stands in for.
const SHOWN = new WeakMap();
function shownOptions(options) {
  if (!options || typeof options !== "object" || !options.hidden) return options;
  let view = SHOWN.get(options);
  if (!view) {
    view = new Proxy(options, { get: (target, key) => (key === "hidden" ? false : Reflect.get(target, key)) });
    SHOWN.set(options, view);
  }
  return view;
}

function showSettings(box, keep) {
  for (const widget of box.widgets ?? []) {
    if (widget === keep || widget.__ausbossCameraShown || !widget.options?.hidden) continue;
    const own = Object.getOwnPropertyDescriptor(widget, "options");
    if (!own?.get || !own.configurable || widget.__ausbossVisibilityStash) continue;
    Object.defineProperty(widget, "options", { ...own, get() { return shownOptions(own.get.call(this)); } });
    widget.__ausbossCameraShown = true;
  }
}

// A box shows the face while the camera of a Camera Move inside comes up to it.
function syncBox(box) {
  if (!box?.isSubgraphNode?.() || !box.graph) return;
  const found = boxCamera(box);
  const have = box.__ausbossCameraBox;
  if (have && (!found || have.inner !== found.inner || have.inputName !== found.name || !boxCopy(box, found.name))) {
    unmount(have);
    box.__ausbossCameraBox = null;
    box.setSize?.([box.size[0], box.computeSize?.()[1] ?? box.size[1]]);
  }
  if (box.__ausbossCameraBox) {
    if (mountBoxCard(box, boxCopy(box, box.__ausbossCameraBox.inputName), faceLast)) holdFloor(box);
    faceLast(box);
    showSettings(box, boxCopy(box, box.__ausbossCameraBox.inputName));
    return;
  }
  if (!found || !boxCopy(box, found.name)) return;
  hideWidget(boxCopy(box, found.name));
  // The card before the face: Nodes 2.0 lays a box's panels out in the order they were made.
  mountBoxCard(box, boxCopy(box, found.name), faceLast);
  box.__ausbossCameraBox = mount(box, { box, inputName: found.name, inner: found.inner });
  faceLast(box);
  showSettings(box, boxCopy(box, found.name));
  if (!box.__ausbossCameraSized) openRoomy(box);
  box.__ausbossCameraSized = true;
  box.setDirtyCanvas?.(true, true);
}

function watchBox(box) {
  if (!box?.isSubgraphNode?.() || box.__ausbossCameraWatch) return;
  const abort = new AbortController();
  box.__ausbossCameraWatch = abort;
  const later = () => requestAnimationFrame(() => syncBox(box));
  for (const type of ["widget-promoted", "widget-demoted", "input-added", "removing-input"]) {
    box.subgraph?.events?.addEventListener?.(type, later, { signal: abort.signal });
  }
  chainCallback(box, "onConfigure", (info) => { if (info?.size) box.__ausbossCameraSized = true; later(); holdFloor(box); });
  chainCallback(box, "onRemoved", () => {
    abort.abort();
    if (box.__ausbossCameraBox) unmount(box.__ausbossCameraBox);
    box.__ausbossCameraBox = null;
  });
  later();
}

// What a run sent back reaches every face that shows that run of the node.
api.addEventListener("executed", ({ detail }) => {
  try {
    const scene = detail?.output?.[UI_KEY]?.[0];
    if (!scene) return;
    const ids = new Set([String(detail.node ?? ""), String(detail.display_node ?? "")]);
    for (const entry of mounts) if (ids.has(String(sourceOf(entry).id))) entry.face.takeScene(scene);
  } catch {
    // Never in the way of a run.
  }
});
const stopped = (note) => { for (const entry of mounts) entry.face.runFailed(note); };
api.addEventListener("execution_error", ({ detail }) => {
  if (/OutOfMemory/i.test(String(detail?.exception_type ?? ""))) {
    stopped("The graphics card is full. Close other jobs using it, then try again.");
    return;
  }
  const why = String(detail?.exception_message ?? "").split("\n")[0].slice(0, 160);
  stopped(why ? `The run stopped: ${why}` : null);
});
api.addEventListener("execution_interrupted", () => stopped("The run was stopped."));
// A run that ended without sending the clip (it never reached the node)
// would leave a face waiting for good. Once the queue is empty, it stops.
api.addEventListener("status", ({ detail }) => {
  if (detail?.exec_info?.queue_remaining !== 0) return;
  const now = performance.now();
  for (const entry of mounts) if (now - (entry.askedAt ?? 0) > 1500) entry.face.runFailed();
});

app.registerExtension({
  name: "ausboss.camera_move",
  onNodeOutputsUpdated() {
    for (const entry of mounts) restore(entry);
  },
  nodeCreated(node) {
    if (node?.isSubgraphNode?.()) watchBox(node);
  },
  loadedGraphNode(node) {
    if (node?.isSubgraphNode?.()) watchBox(node);
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      build(this);
    });
    chainCallback(nodeType.prototype, "onAdded", function () {
      if (this.__ausbossCameraSized) return;
      this.__ausbossCameraSized = true;
      openRoomy(this);
    });
    chainCallback(nodeType.prototype, "onConfigure", function (info) {
      if (info?.size) this.__ausbossCameraSized = true;
      const entry = build(this);
      hideWidget(ownCamera(this));
      queueMicrotask(() => { entry.face.refresh(); restore(entry); });
      holdFloor(this);
    });
    chainCallback(nodeType.prototype, "onConnectionsChange", function () {
      this.__ausbossCameraMove?.face.refresh();
      // The camera may have just come up to a box, or gone back inside.
      for (const box of boxesOf(this.graph, workflowNodes(rootGraph()))) requestAnimationFrame(() => syncBox(box));
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      const entry = this.__ausbossCameraMove;
      if (entry) unmount(entry);
      this.__ausbossCameraMove = null;
    });
  },
});
