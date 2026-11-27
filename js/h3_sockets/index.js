// H3 Prompt Writer 🆎 draws only the sockets in use.
//
// The node keeps every socket in its lists: a wire is saved by its socket's
// number, so taking one out would send the wrong output. A socket that is
// not in use is only left out of the drawing. The rule is in
// js/shared/h3_sockets.mjs.
//
//   classic    a hidden socket gets a position of its own, which takes it
//              out of the stacked rows, and draws nothing.
//   Nodes 2.0  one style rule hides the socket's row by its data-slot-key.
//
// If either lever is missing in the running frontend, every socket shows,
// as it always did.
import { app } from "../../../scripts/app.js";
import { chainCallback } from "../shared/index.mjs";
import { setSocketHidden, socketsToShow } from "../shared/h3_sockets.mjs";

const NODE_CLASS = "AUSBOSS_NODES_H3PromptWriter";
const STYLE_ID = "ausboss-h3-sockets";

let warned = false;
// Nothing here may stop a node from loading: on a throw the sockets show.
function safely(run) {
  return function (...args) {
    try { return run.apply(this, args); } catch (error) {
      if (!warned) console.warn("[AusBoss] H3 Prompt Writer shows every socket:", error);
      warned = true;
    }
  };
}

const plainInputs = (node) => (node.inputs ?? []).filter((slot) => !slot.widget);
const outputWired = (slot) => (slot.links?.length ?? 0) > 0;
const shownRows = (node) => Math.max(
  plainInputs(node).filter((slot) => !slot._ausbossHidden).length,
  (node.outputs ?? []).filter((slot) => !slot._ausbossHidden).length,
  1,
);
const hiddenRows = (node) => Math.max(plainInputs(node).length, (node.outputs ?? []).length, 1) - shownRows(node);
const rowHeight = () => globalThis.LiteGraph?.NODE_SLOT_HEIGHT ?? 20;

function writerNodes(graph = app.graph, found = []) {
  for (const node of graph?._nodes ?? []) {
    if (node.type === NODE_CLASS) found.push(node);
    if (node.subgraph) writerNodes(node.subgraph, found);
  }
  return found;
}

// Nodes 2.0 draws a row for every socket of the list. One style sheet for
// the page holds each node's hidden rows.
function writeStyleRules() {
  const rules = writerNodes().map((node) => node._ausbossSocketRule ?? "").filter(Boolean).join("\n");
  let sheet = document.getElementById(STYLE_ID);
  if (!sheet && !rules) return;
  sheet ??= document.head.appendChild(Object.assign(document.createElement("style"), { id: STYLE_ID }));
  if (sheet.textContent !== rules) sheet.textContent = rules;
}

export function applySockets(node) {
  if (!node?.inputs || !node?.outputs) return;
  const rowsBefore = shownRows(node);
  const show = socketsToShow({
    wiredInputs: plainInputs(node).filter((slot) => slot.link != null).map((slot) => slot.name),
    wiredOutputs: node.outputs.filter(outputWired).map((slot) => slot.name),
  });
  const hiddenKeys = [];
  node.inputs.forEach((slot, index) => {
    if (slot.widget) return;
    const hide = !show.inputs.has(slot.name);
    if (setSocketHidden(slot, hide) && hide) hiddenKeys.push(`${node.id}-in-${index}`);
  });
  node.outputs.forEach((slot, index) => {
    const hide = !show.outputs.has(slot.name);
    if (setSocketHidden(slot, hide) && hide) hiddenKeys.push(`${node.id}-out-${index}`);
  });
  node._ausbossSocketRule = hiddenKeys.length
    ? `${hiddenKeys.map((key) => `.lg-slot:has([data-slot-key="${key}"])`).join(",")}{display:none}`
    : "";
  writeStyleRules();

  // The node gets a row taller or shorter with its sockets, so the panel
  // keeps its size. A workflow that is loading keeps the size it was saved at.
  const rows = shownRows(node);
  if (node._ausbossSocketRows != null && rows !== rowsBefore && !app.configuringGraph && node.size) {
    node.setSize([node.size[0], node.size[1] + (rows - rowsBefore) * rowHeight()]);
  }
  node._ausbossSocketRows = rows;
  node.setDirtyCanvas?.(true, true);
}

app.registerExtension({
  name: "AusBoss.H3Sockets",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_CLASS) return;
    const proto = nodeType.prototype;

    // The least height counts only the rows that are drawn.
    const computeSize = proto.computeSize;
    proto.computeSize = function (...args) {
      const size = computeSize.apply(this, args);
      try { size[1] -= hiddenRows(this) * rowHeight(); } catch { /* the full height is a safe answer */ }
      return size;
    };

    const apply = safely(function () { applySockets(this); });
    chainCallback(proto, "onNodeCreated", apply);
    chainCallback(proto, "onAdded", apply);
    chainCallback(proto, "onConfigure", apply);
    chainCallback(proto, "onConnectionsChange", apply);
    chainCallback(proto, "onRemoved", safely(function () {
      this._ausbossSocketRule = "";
      // The node is still in the graph's list while it is being removed.
      queueMicrotask(safely(writeStyleRules));
    }));
    // The saved node is what it always was: no parked position in it.
    chainCallback(proto, "onSerialize", safely(function (saved) {
      (saved.inputs ?? []).forEach((slot, index) => { if (this.inputs?.[index]?._ausbossHidden) delete slot.pos; });
      (saved.outputs ?? []).forEach((slot, index) => { if (this.outputs?.[index]?._ausbossHidden) delete slot.pos; });
    }));
  },
});
