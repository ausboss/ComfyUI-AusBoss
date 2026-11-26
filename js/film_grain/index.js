// Film Grain's Auto, on the node's face: keeps what Auto picks for the
// picture on hand up to date for the card's "= 0.27" notes
// (js/shared/grain_auto.mjs).
import { api } from "../../../scripts/api.js";
import { app } from "../../../scripts/app.js";
import { chainCallback } from "../shared/index.mjs";
import { isForeignRun } from "../shared/prompt_scope.mjs";
import { refreshAuto } from "../shared/grain_auto.mjs";
import { outputLocatorId, sourceFileWidget, upstreamNode } from "../shared/input_preview.mjs";

const NODE_CLASS = "AUSBOSS_NODES_FilmGrain";
const viewUrl = (query) => api.apiURL(`/view?${query}`);

// One hook on a Load Image's file box, with every Film Grain it feeds listed
// under it, so a picked file refreshes them all and a removed node leaves.
const watched = new WeakMap();
function watchFile(node) {
  const widget = sourceFileWidget(upstreamNode(node, "image"));
  if (node.__ausbossGrainWatch?.widget === widget) return;
  const old = node.__ausbossGrainWatch;
  if (old) old.nodes.delete(node);
  node.__ausbossGrainWatch = null;
  if (!widget) return;
  let entry = watched.get(widget);
  if (!entry) {
    const nodes = new Set();
    entry = { widget, nodes };
    chainCallback(widget, "callback", () => { for (const item of nodes) update(item); });
    watched.set(widget, entry);
  }
  entry.nodes.add(node);
  node.__ausbossGrainWatch = entry;
}

function update(node) {
  if (!node?.graph) return;
  watchFile(node);
  const record = app.nodeOutputs?.[outputLocatorId(node)] ?? null;
  refreshAuto(node, { viewUrl, record });
}

const later = (node) => queueMicrotask(() => update(node));

app.registerExtension({
  name: "ausboss.film_grain",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () { later(this); });
    chainCallback(nodeType.prototype, "onConfigure", function () { later(this); });
    chainCallback(nodeType.prototype, "onConnectionsChange", function () { later(this); });
    chainCallback(nodeType.prototype, "onExecuted", function () {
      if (isForeignRun()) return;
      later(this);
    });
    chainCallback(nodeType.prototype, "onRemoved", function () { this.__ausbossGrainWatch?.nodes.delete(this); });
  },
  // A reopened workflow restores every node's last output at once.
  onNodeOutputsUpdated() {
    for (const node of app.graph?._nodes ?? []) if (node.type === NODE_CLASS) later(node);
  },
});
