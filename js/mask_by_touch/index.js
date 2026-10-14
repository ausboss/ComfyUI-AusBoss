// Mask by Touch: the picture on the node is where the mask is made.
//
// The face itself is js/shared/touch_stage.mjs. This file mounts it on the
// node, runs the node alone when the face asks for the picture or for what
// SAM 3 finds at a click, and hands it what a run sent back.

import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { chainCallback } from "../shared/index.mjs";
import { executionIdOf, isSwitchedOff, nodeByExecutionId } from "../shared/graph_ids.mjs";
import { outputLocatorId } from "../shared/input_preview.mjs";
import { isForeignRun } from "../shared/prompt_scope.mjs";
import { NOTE_KEY, OPENING_WIDTH, WIDGET_NAME, mountTouchStage } from "../shared/touch_stage.mjs";

const NODE_CLASS = "AUSBOSS_NODES_MaskByTouch";
// The edge settings the face follows while they are changed.
const SETTINGS = ["grow", "soften", "smooth", "fill_holes", "invert", "fine_edges"];
const INPUT_SIDE = 1; // LiteGraph.INPUT
// Room for the picture on a node that is new.
const OPENING_ROOM = 280;
const faces = new Set();
// When the node looks at a new picture: by itself once the pointer rests on
// it, or only on a click or the Look button.
const LOOK_SETTING = "AusBoss.MaskByTouch.Look";
let lookOnButton = false;
// What a look has found so far, sent by the node while the look still runs.
const LOOK_EVENT = "ausboss.mask_by_touch.look";

const widgetByName = (node, name) => node.widgets?.find((widget) => widget?.name === name) ?? null;

// Stop this node's look at its picture: take it out of the queue while it
// waits, interrupt it while it runs. Only a look of this node is touched,
// never a run of the workflow or another node's.
async function stopLook(node) {
  const id = executionIdOf(app.rootGraph ?? app.graph, node);
  if (!id) return false;
  const queue = await (await api.fetchApi("/queue")).json();
  const ours = (entry) => {
    const step = entry?.[2]?.[id];
    return step?.class_type === NODE_CLASS && String(step.inputs?.ask ?? "").startsWith("scope");
  };
  const post = (path, body) => api.fetchApi(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const waiting = (queue?.queue_pending ?? []).filter(ours).map((entry) => entry[1]);
  if (waiting.length) await post("/queue", { delete: waiting });
  const running = (queue?.queue_running ?? []).find(ours);
  if (running) await post("/interrupt", { prompt_id: running[1] });
  return Boolean(running || waiting.length);
}

// The picture goes above the settings: the stage widget sits ahead of the
// node's card, whichever of the two was built first.
function stageFirst(node) {
  const widgets = node.widgets;
  if (!Array.isArray(widgets)) return;
  const stage = widgets.findIndex((widget) => widget?.name === WIDGET_NAME);
  const card = widgets.indexOf(node.__ausbossCard?.widget);
  if (stage < 0 || card < 0 || stage < card) return;
  widgets.splice(card, 0, widgets.splice(stage, 1)[0]);
}

function watchSettings(node, face) {
  face.watched ??= new WeakSet();
  for (const name of SETTINGS) {
    const widget = widgetByName(node, name);
    if (!widget || face.watched.has(widget)) continue;
    face.watched.add(widget);
    chainCallback(widget, "callback", () => { if (face.alive) face.settingsChanged(); });
  }
}

// What the page kept from this node's last run, if anything.
function restore(face) {
  if (face.pic && !face.pic.provisional) return;
  const note = app.nodeOutputs?.[outputLocatorId(face.node)]?.[NOTE_KEY]?.[0];
  if (note) face.takeNote(note, { restored: true });
}

function build(node) {
  if (node.__ausbossTouch) return node.__ausbossTouch;
  // What the face asks of the next run of this node. The widget itself
  // always holds nothing, so a saved workflow and an ordinary run carry no
  // request; the request rides along only while the face's own run is being
  // sent. It stays up until that run is on its way, not just for one read:
  // the pack's check for a blank loader builds the prompt once more first.
  let asking = "";
  let askTimer = 0;
  const ask = widgetByName(node, "ask");
  if (ask) {
    ask.value = "";
    ask.serializeValue = () => asking;
  }
  const face = mountTouchStage(node, {
    lookOnButton: () => lookOnButton,
    stopLook: () => stopLook(node).catch(() => false),
    // A workflow is being opened: nothing is run on the person's behalf.
    loading: () => Boolean(app.configuringGraph),
    // Bypassed or muted, or inside a box that is: nothing is run for it.
    switchedOff: () => isSwitchedOff(app.rootGraph ?? app.graph, node),
    run(what) {
      const id = executionIdOf(app.rootGraph ?? app.graph, node);
      if (!id || typeof app.queuePrompt !== "function") return false;
      clearTimeout(askTimer);
      asking = String(what ?? "");
      // At the front of the queue: a touch waits for the job that is
      // running, never for every job behind it.
      return Promise.resolve(app.queuePrompt(-1, 1, [id])).then((queued) => {
        if (queued !== false) {
          asking = "";
          return true;
        }
        // Refused (ComfyUI shows why), or another queue call was already
        // sending and takes this run along in a moment.
        askTimer = setTimeout(() => { asking = ""; }, 3000);
        const errors = app.lastNodeErrors;
        return !(errors && Object.keys(errors).length);
      }, () => {
        asking = "";
        return false;
      });
    },
  });
  // A run of the workflow that is sent while a click still waits for the
  // look takes that click along: the touches are read for the prompt here,
  // and a click that is not among them yet would not be run.
  const touches = widgetByName(node, "touches");
  if (touches) {
    touches.serializeValue = () => {
      if (!asking) face.takeWaiting();
      return touches.value;
    };
  }
  faces.add(face);
  watchSettings(node, face);
  stageFirst(node);
  // A new node opens with room for the picture. It takes that size as it
  // joins the graph: the card is in place by then, and a size put on the
  // node afterwards wins (a loaded workflow, an undo). A copy gets its size
  // before it joins, which onConfigure notes below.
  chainCallback(node, "onAdded", () => {
    stageFirst(node);
    if (face.sized) return;
    face.sized = true;
    const floor = Number(node.computeSize?.()?.[1]);
    if (Number.isFinite(floor) && node.size?.[1] <= floor + 1) {
      node.setSize?.([Math.max(node.size[0], OPENING_WIDTH), floor + OPENING_ROOM]);
    }
  });
  return face;
}

const settleAll = () => {
  for (const face of faces) if (face.inFlight) face.settle();
};

// The run stopped. At this node: its message goes on its face, where the
// person is looking. Anywhere else: the faces stop waiting.
api.addEventListener("execution_error", ({ detail }) => {
  try {
    if (!faces.size || isForeignRun(detail?.prompt_id)) return;
    const node = nodeByExecutionId(app.rootGraph ?? app.graph, String(detail?.node_id ?? ""));
    const face = node?.__ausbossTouch;
    if (face?.alive && detail?.node_type === NODE_CLASS) face.stopped(detail?.exception_message);
    settleAll();
  } catch {
    // Never in the way of ComfyUI's own error handling.
  }
});
api.addEventListener("execution_interrupted", () => settleAll());
// A look is one long, quiet run. The node sends what it has found every
// second or two, so things light up while it is still looking.
api.addEventListener(LOOK_EVENT, ({ detail }) => {
  try {
    if (!faces.size || !detail?.note) return;
    const id = String(detail.node ?? "");
    const root = app.rootGraph ?? app.graph;
    for (const face of faces) {
      if (face.alive && face.inFlight && executionIdOf(root, face.node) === id) face.takeNote(detail.note, { interim: true });
    }
  } catch {
    // Never in the way of a run.
  }
});
// A run that left the queue without ever reaching the node (it was deleted
// there) would leave a face waiting for good. Once the queue is empty and a
// face has waited a while, it stops waiting; the next touch asks again.
api.addEventListener("status", ({ detail }) => {
  try {
    if (!faces.size || detail?.exec_info?.queue_remaining !== 0) return;
    const now = performance.now();
    for (const face of faces) if (face.inFlight && now - face.askedAt > 1500) face.settle();
  } catch {
    // Never in the way of a run.
  }
});

app.registerExtension({
  name: "ausboss.mask_by_touch",
  settings: [
    {
      id: LOOK_SETTING,
      name: "Mask by Touch: look at a new picture",
      type: "combo",
      options: [
        { text: "when the pointer rests on it", value: "auto" },
        { text: "only on a click or the Look button", value: "button" },
      ],
      defaultValue: "auto",
      tooltip:
        "Mask by Touch looks at a picture once, so things light up and say "
        + "their name. By default it starts when the pointer rests on the "
        + "picture. Choose the other way and nothing runs until you click a "
        + "thing or press Look on the node.",
      category: ["🆎 AusBoss", "Mask by Touch", "Look"],
      onChange(value) {
        lookOnButton = value === "button";
        for (const face of faces) if (face.alive) face.resyncTools?.();
      },
    },
  ],
  // Reopening a workflow tab restores every node's stored output at once,
  // with no per-node event; each face re-reads its own.
  onNodeOutputsUpdated() {
    for (const face of faces) if (face.alive) restore(face);
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      build(this);
    });
    chainCallback(nodeType.prototype, "onConfigure", function (info) {
      const face = build(this);
      // A node that comes with a size keeps it, the smallest one too.
      if (info?.size) face.sized = true;
      // The saved touches and switches are on the node once it is configured.
      queueMicrotask(() => {
        if (!face.alive) return;
        watchSettings(this, face);
        face.resync();
        restore(face);
      });
    });
    chainCallback(nodeType.prototype, "onConnectionsChange", function (side) {
      if (side !== undefined && side !== INPUT_SIDE) return;
      this.__ausbossTouch?.linksChanged();
    });
    chainCallback(nodeType.prototype, "onExecuted", function (output) {
      if (isForeignRun()) return;
      const face = build(this);
      face.takeNote(output?.[NOTE_KEY]?.[0]);
    });
    // What the eye shows is chosen here too: the cut-out, or the black and white mask.
    chainCallback(nodeType.prototype, "getExtraMenuOptions", function (_canvas, options) {
      const face = this.__ausbossTouch;
      if (!face?.alive || !Array.isArray(options)) return;
      const other = face.result === "mask" ? "cut" : "mask";
      options.unshift(
        {
          content: other === "mask" ? "Eye shows: the black and white mask" : "Eye shows: the cut-out",
          callback: () => face.setView(other),
        },
        null,
      );
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      const face = this.__ausbossTouch;
      if (!face) return;
      faces.delete(face);
      face.destroy();
      this.__ausbossTouch = null;
    });
  },
});
