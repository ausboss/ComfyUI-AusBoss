// Pause for Shot 🆎: while a run waits on the node, a Continue bar shows on
// the node and over the 3D viewer it is wired to. Continue reads the viewer's
// camera, model turn and size as they are now and sends them to
// POST /ausboss/pause_shot/answer (nodes/node_pause_shot.py), which only
// accepts them while that node is waiting. The switch above the bar is the
// node's `pause` setting (js/widget_cards). When a 360 is wired into the
// node, the run hands it over as a temp picture and it goes behind the model
// as the viewer's panorama; Continue also sends the 360 strip's settings
// (js/viewer_pano), so the run's backdrop matches the viewer.

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { chainCallback, keepDomWidgetWidthAuto, showToast } from "../shared/index.mjs";
import { nodeByExecutionId } from "../shared/graph_ids.mjs";
import { compactAction, HINT_TYPE } from "../shared/panel_controls.mjs";
import { holdNodeMinWidth, pinVuePanelHeight } from "../shared/panel_layout.mjs";
import { FONT_UI, RADIUS_CONTROL, THEME as T } from "../shared/theme.mjs";
import { bottomButtons } from "../shared/viewer3d_layout.mjs";

const NODE_CLASS = "AUSBOSS_NODES_PauseShot";
const PANEL = "ausboss_pause_shot_panel";
const MIN_WIDTH = 260;
const PANEL_HEIGHT = 62;

function ensureCss() {
  if (document.getElementById("ausboss-pause-shot-css")) return;
  const style = document.createElement("style");
  style.id = "ausboss-pause-shot-css";
  style.textContent = `
.ausboss-pshot{box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column;gap:6px;width:100%;height:100%;padding:6px 8px 8px;background:${T.card};border-radius:${RADIUS_CONTROL}px;font:400 12px/1.3 ${FONT_UI};color:${T.inkSoft}}
.ausboss-pshot-hint{${HINT_TYPE}}
.ausboss-pshot.waiting .ausboss-pshot-hint{color:${T.brandInk}}
.ausboss-pshot-row{display:flex;gap:6px;justify-content:flex-end}
.ausboss-pshot-row .ausboss-compact-action{height:26px;padding:0 12px}
.ausboss-pshot .go,.ausboss-pshot-over .go{background:${T.brand};color:${T.onBrand}}
.ausboss-pshot .go:hover:enabled,.ausboss-pshot-over .go:hover:enabled{background:${T.brand};color:${T.onBrand};filter:brightness(1.1)}
.ausboss-pshot:not(.waiting) .ausboss-pshot-row{visibility:hidden}
.ausboss-pshot-over{position:absolute;left:8px;bottom:8px;z-index:6;box-sizing:border-box;display:flex;align-items:center;gap:6px;height:32px;padding:0 4px 0 10px;border-radius:${RADIUS_CONTROL}px;background:${T.card};box-shadow:0 1px 6px rgba(0,0,0,.4);font:600 11px/1 ${FONT_UI};color:${T.brandInk};white-space:nowrap}
.ausboss-pshot-over .ausboss-compact-action{height:24px;padding:0 10px}
`;
  document.head.append(style);
}

// The viewer wired to the pause: where its camera comes from.
function viewerOf(node) {
  const slot = node.inputs?.findIndex((input) => input.name === "camera_info") ?? -1;
  return slot >= 0 ? node.getInputNode?.(slot) ?? null : null;
}

// The viewer's shot as it is on screen right now.
async function readShot(viewer) {
  const shot = {};
  const state = viewer?.widgets?.find((widget) => widget.name === "viewport_state");
  if (state?.serializeValue) {
    const value = await state.serializeValue(viewer, viewer.widgets.indexOf(state));
    if (value?.camera_info) shot.camera_info = value.camera_info;
    if (Array.isArray(value?.model_3d_info)) shot.model_3d_info = value.model_3d_info;
  }
  const sky = viewer?.properties?.["AusBoss View"]?.sky;
  if (sky && typeof sky === "object") shot.sky = sky;
  // The 360 taken out of the viewer (its background image removed) leaves
  // the backdrop grey, as with no 360 wired in.
  const scene = viewerGizmo(viewer)?.__ausbossScene;
  if (scene && !(scene.currentBackgroundType === "image" && scene.backgroundRenderMode === "panorama")) shot.panorama = false;
  try {
    const ground = viewerGizmo(viewer)?.__ausbossScene?.__ausbossGround?.();
    if (ground) shot.ground = ground;
  } catch {
    // No shadow then.
  }
  for (const key of ["width", "height"]) {
    const linked = viewer?.inputs?.find((input) => input.name === key)?.link != null;
    const widget = viewer?.widgets?.find((w) => w.name === key);
    if (!linked && Number.isFinite(Number(widget?.value))) shot[key] = Number(widget.value);
  }
  return shot;
}

// The viewer's gizmo box, found through the 360 strip (js/viewer_pano).
function viewerGizmo(viewer) {
  if (!viewer) return null;
  for (const box of document.querySelectorAll("div[data-ausboss-gizmo]")) {
    if (box.__ausbossNode === viewer && box.parentElement) return box;
  }
  return null;
}
const viewerBox = (viewer) => viewerGizmo(viewer)?.parentElement ?? null;

// ComfyUI sends the viewer's model only to the page that pressed Run. The
// pause brings it along, so a page that did not start the run (another tab,
// a phone, a reload) shows the model too.
function modelName(output) {
  const first = output?.result?.[0];
  return typeof first === "string" ? first.replace(/\s*\[[^\]]*\]$/, "").replaceAll("\\", "/") : "";
}

function showModel(viewer, shown) {
  const name = modelName(shown?.output);
  if (!viewer || !name || typeof viewer.onExecuted !== "function") return;
  const last = String(viewer.properties?.["Last Time Model File"] ?? "").replaceAll("\\", "/");
  if (last === name || last.endsWith(`/${name}`)) return;
  viewer.onExecuted(shown.output);
}

// Put the run's 360 behind the model, as the viewer's panorama.
async function showPanorama(viewer, picture) {
  const scene = viewerGizmo(viewer)?.__ausbossScene;
  if (!scene?.setBackgroundImage || !picture?.filename) return false;
  await scene.setBackgroundImage(`temp/${picture.filename}`);
  scene.setBackgroundRenderMode?.("panorama");
  scene.__ausbossViewport?.forceRender?.();
  return true;
}

function buildPanel(node) {
  ensureCss();
  const root = document.createElement("div");
  root.className = "ausboss-pshot";
  const hint = document.createElement("div");
  hint.className = "ausboss-pshot-hint";
  const row = document.createElement("div");
  row.className = "ausboss-pshot-row";
  const stop = compactAction("Stop", "End the run here.");
  const go = compactAction("Continue", "Go on with the shot as the viewer shows it now.");
  go.classList.add("go");
  row.append(stop, go);
  root.append(hint, row);

  const state = { waitingFor: null, over: null };
  const idle = "A run waits here while you frame the shot.";
  hint.textContent = idle;

  const removeOver = () => { state.over?.remove(); state.over = null; };
  const clear = () => {
    state.waitingFor = null;
    root.classList.remove("waiting");
    hint.textContent = idle;
    removeOver();
  };

  const answer = async (action) => {
    const id = state.waitingFor;
    if (!id) return;
    const buttons = [go, stop, ...(state.over ? state.over.querySelectorAll("button") : [])];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      const body = { node: id, action };
      if (action === "continue") body.shot = await readShot(viewerOf(node));
      const response = await api.fetchApi("/ausboss/pause_shot/answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        showToast({ detail: data.error || "The pause could not be answered.", severity: "warn" });
        if (response.status === 409) clear();
      }
    } catch {
      showToast({ detail: "The pause could not be answered. Is ComfyUI still running?", severity: "warn" });
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  };
  go.addEventListener("click", () => answer("continue"));
  stop.addEventListener("click", () => answer("stop"));

  // The same Continue on the viewer, at its bottom-left corner on the line
  // of the viewer's own bottom buttons, clear of the shot.
  const placeOver = (host, over) => {
    const line = bottomButtons(host);
    if (!line) return;
    over.style.bottom = `${line.bottom}px`;
    over.style.height = `${line.height}px`;
  };
  const showOver = () => {
    removeOver();
    const host = viewerBox(viewerOf(node));
    if (!host) return;
    const over = document.createElement("div");
    over.className = "ausboss-pshot-over";
    const label = document.createElement("span");
    label.textContent = "Frame your shot";
    const overStop = compactAction("Stop", "End the run here.");
    const overGo = compactAction("Continue", "Go on with the shot as the viewer shows it now.");
    overGo.classList.add("go");
    overStop.addEventListener("click", () => answer("stop"));
    overGo.addEventListener("click", () => answer("continue"));
    for (const type of ["pointerdown", "mousedown", "dblclick", "contextmenu"]) over.addEventListener(type, (event) => event.stopPropagation());
    over.append(label, overStop, overGo);
    host.append(over);
    placeOver(host, over);
    state.over = over;
  };

  const show = (detail) => {
    state.waitingFor = String(detail.node);
    root.classList.add("waiting");
    hint.textContent = "Frame the shot in the viewer, then Continue.";
    showOver();
    const viewer = viewerOf(node);
    try {
      showModel(viewer, detail.viewer);
    } catch {
      // The viewer keeps what it has.
    }
    const panorama = detail.panorama;
    const showIt = () => showPanorama(viewer, panorama).catch(() => false);
    // After a reload, or before the viewer has drawn once, its panel is not
    // there yet: keep looking for it while the pause waits.
    if (!state.over || !viewerGizmo(viewer)) {
      const id = state.waitingFor;
      let tries = 0;
      const retry = () => {
        if (state.waitingFor !== id) return;
        if (!state.over) showOver();
        if (state.over && viewerGizmo(viewer)) { showIt(); return; }
        // Quick at first, then slower for as long as the pause waits.
        setTimeout(retry, (tries += 1) < 40 ? 750 : 2000);
      };
      setTimeout(retry, 750);
    } else showIt();
    node.setDirtyCanvas?.(true, true);
  };

  root.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) event.stopPropagation();
  });
  return { root, show, clear, isWaitingFor: (id) => state.waitingFor === String(id) };
}

function panelOf(detail) {
  const node = nodeByExecutionId(app.rootGraph ?? app.graph, detail?.node);
  return node?.__ausbossPauseShot ?? null;
}

// A page opened or reloaded while a run waits missed the event: ask.
async function showWaiting() {
  try {
    const response = await api.fetchApi("/ausboss/pause_shot/waiting");
    if (!response.ok) return;
    const { waiting } = await response.json();
    for (const detail of Array.isArray(waiting) ? waiting : []) {
      const panel = panelOf(detail);
      if (panel && !panel.isWaitingFor(detail.node)) panel.show(detail);
    }
  } catch {
    // Nothing to bring back.
  }
}

app.registerExtension({
  name: "ausboss.pause_shot",
  afterConfigureGraph() { showWaiting(); },
  setup() {
    api.addEventListener("reconnected", () => showWaiting());
    api.addEventListener("ausboss-pause-shot", (event) => panelOf(event.detail)?.show(event.detail));
    api.addEventListener("ausboss-pause-shot-done", (event) => {
      const panel = panelOf(event.detail);
      if (panel?.isWaitingFor(event.detail?.node)) panel.clear();
    });
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      const panel = buildPanel(this);
      const widget = this.addDOMWidget(PANEL, PANEL, panel.root, { serialize: false, hideOnZoom: false });
      keepDomWidgetWidthAuto(widget);
      // Not saved with the workflow: saved values come back by position.
      widget.serialize = false;
      // A hint and two buttons: a constant height (tests/panel_guards.test.mjs,
      // fixedByDesign).
      widget.computeSize = (width) => [Math.max(MIN_WIDTH, Number(width || this.size?.[0] || MIN_WIDTH)), PANEL_HEIGHT];
      pinVuePanelHeight(widget);
      holdNodeMinWidth(widget, MIN_WIDTH);
      widget.options.minNodeSize = [MIN_WIDTH, 60];
      this.__ausbossPauseShot = panel;
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      this.__ausbossPauseShot?.clear();
    });
  },
});
