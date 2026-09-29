// Keep a run's results on the workflow tab that queued it.
//
// Every workflow tab in a page shares one server connection, and ComfyUI
// files a node's results by node id. A run from one tab that finishes while
// another tab is open lands on the open tab's node with the same id: a
// Save Video's clip turns up under a Video Crop + Rotate + Pad node, and
// Show Text takes the other workflow's prompt and would save it there.
//
// This file notes which graph queued each run (shared/prompt_scope.mjs).
// When a result from another tab lands on an AusBoss node here, it puts
// this tab's own result for that node back; the nodes' onExecuted handlers
// ask isForeignRun() first, so none of them takes it either. The result is
// kept, and handed to the AusBoss nodes of the tab that queued it when that
// tab is open again (ComfyUI already restores that tab's pictures itself).
// Core and third-party nodes are left as ComfyUI has them.

import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { isAusbossNode } from "../shared/index.mjs";
import { nodeByExecutionId } from "../shared/graph_ids.mjs";
import { outputKey, runScope } from "../shared/prompt_scope.mjs";

const rootGraph = () => app.rootGraph ?? app.graph ?? null;
const graphOwner = (graph) => graph?.rootGraph?.id ?? graph?.id ?? null;

runScope.setActiveOwner(() => graphOwner(rootGraph()));

// The prompt id only comes back from the queue call, so the call is wrapped
// rather than chained: the wrapper has to see the resolved value. It never
// changes what the call sends or returns, and a failure to record is silent.
function recordQueuedRuns() {
  const queue = api.queuePrompt;
  if (typeof queue !== "function" || queue.__ausbossRunScope) return;
  const scoped = async function (number, data, ...rest) {
    let owner = null;
    try {
      owner = data?.workflow?.id ?? graphOwner(rootGraph());
    } catch {
      owner = null;
    }
    const result = await queue.call(this, number, data, ...rest);
    try {
      runScope.queued(result?.prompt_id, owner);
    } catch {
      // Unrecorded runs behave as they always have.
    }
    return result;
  };
  scoped.__ausbossRunScope = true;
  api.queuePrompt = scoped;
}

function keepOwnResult(detail) {
  try {
    const executionId = String(detail.display_node ?? detail.node ?? "");
    const node = nodeByExecutionId(rootGraph(), executionId);
    if (!node || !isAusbossNode(node)) return;
    const own = app.extensionManager?.workflow?.activeWorkflow?.changeTracker?.nodeOutputs?.[String(detail.node ?? executionId)];
    const key = outputKey(node, rootGraph());
    if (own) app.nodeOutputs[key] = own;
    else if (app.nodeOutputs && key in app.nodeOutputs) delete app.nodeOutputs[key];
  } catch {
    // The stray result stays, exactly as core would leave it.
  }
}

// Results held back from the tab that was open, by the graph that queued
// them, oldest first. A handful per tab is plenty: a panel only shows the
// newest, and Seed's history keeps a short list anyway.
const withheld = new Map();
const WITHHELD_PER_TAB = 32;
const WITHHELD_TABS = 16;

function withhold(detail) {
  const owner = runScope.ownerOf(detail.prompt_id);
  if (!owner) return;
  const list = withheld.get(owner) ?? [];
  list.push({ prompt: detail.prompt_id, node: String(detail.display_node ?? detail.node ?? ""), output: detail.output });
  while (list.length > WITHHELD_PER_TAB) list.shift();
  withheld.delete(owner);
  withheld.set(owner, list);
  while (withheld.size > WITHHELD_TABS) withheld.delete(withheld.keys().next().value);
}

// A newer result of this tab's own supersedes one held back for the node.
function forgetWithheld(detail) {
  const list = withheld.get(graphOwner(rootGraph()));
  if (!list?.length) return;
  const node = String(detail.display_node ?? detail.node ?? "");
  const kept = list.filter((item) => item.node !== node);
  if (kept.length !== list.length) withheld.set(graphOwner(rootGraph()), kept);
}

function deliverWithheld() {
  const owner = graphOwner(rootGraph());
  const list = owner ? withheld.get(owner) : null;
  if (!list?.length) return;
  withheld.delete(owner);
  for (const item of list) {
    try {
      const node = nodeByExecutionId(rootGraph(), item.node);
      if (!node || !isAusbossNode(node) || typeof node.onExecuted !== "function") continue;
      runScope.during(item.prompt, () => node.onExecuted(item.output));
    } catch {
      // One node that cannot take its result never blocks the others.
    }
  }
}

recordQueuedRuns();

// Extensions load before the app adds its own api handlers, so this runs
// ahead of core's "executed" handler: the scope knows the run before any
// node's onExecuted is called, and the clean-up waits for core's write.
api.addEventListener("execution_start", ({ detail }) => runScope.started(detail?.prompt_id));
api.addEventListener("executed", ({ detail }) => {
  if (!detail) return;
  runScope.started(detail.prompt_id);
  if (!runScope.isForeign(detail.prompt_id)) {
    forgetWithheld(detail);
    return;
  }
  withhold(detail);
  queueMicrotask(() => keepOwnResult(detail));
});

app.registerExtension({
  name: "ausboss.prompt_scope",
  // Opening a tab restores its stored results in one go; once its nodes
  // have set themselves up, hand them anything held back while it was shut.
  onNodeOutputsUpdated() {
    setTimeout(deliverWithheld, 0);
  },
});
