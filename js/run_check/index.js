// Stop a run that has no picture yet, and show a failed check once.
//
// Many shared workflows save Load Image and the other loaders blank, so the
// person who opens one loads their own picture. Pressing Run first used to
// start the run and fail inside it ("[Errno 21] Is a directory" from core
// Load Image). Now the run stops before it is sent: one toast names the
// loader, and the loader gets ComfyUI's red error outline.
//
// The frontend has no extension hook that runs before a queue and can stop
// it (a widget's beforeQueued callback can only throw, which surfaces as an
// error dialog), so app.queuePrompt is wrapped. The wrapper only reads: the
// cheap widget scan finds a candidate, and only then is the prompt built
// once more to see what the run would really execute, as the server would.
// Bypassed and muted loaders, loaders fed by a link, loaders no output
// needs, and API prompts sent straight to the server are never stopped.
// Anything unexpected in here lets the run through unchanged.
//
// api.queuePrompt is wrapped too, for the answer: ComfyUI repeats a failed
// check once per input the check reads, and collapseRepeatedErrors keeps
// one per message on AusBoss nodes before the frontend shows them.

import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { showToast } from "../shared/index.mjs";
import { nodeByExecutionId } from "../shared/graph_ids.mjs";
import {
  collapseRepeatedErrors,
  emptySourceMessage,
  findEmptySources,
  nodeLacksSource,
} from "../shared/run_check.mjs";

const rootGraph = () => app.rootGraph ?? app.graph ?? null;
const definitionOf = (classType) => globalThis.LiteGraph?.registered_node_types?.[classType]?.nodeData ?? null;

function* everyNode(root) {
  yield* root?.nodes ?? root?._nodes ?? [];
  for (const subgraph of root?.subgraphs?.values?.() ?? []) yield* subgraph.nodes ?? [];
}

// ------------------------------------------------------------ the red outline

let marked = [];
let outlined = [];

function setMark(node, on) {
  if (!node || Boolean(node.has_errors) === on) return;
  const oldValue = node.has_errors;
  node.has_errors = on;
  node.graph?.trigger?.("node:property:changed", {
    type: "node:property:changed", nodeId: node.id, property: "has_errors", oldValue, newValue: on,
  });
}

// Nodes 2.0 draws its error ring from ComfyUI's own error list, which an
// extension cannot add to, so the node's element gets the same colour as an
// outline. Only nodes of the graph on screen: ids repeat inside subgraphs.
function outlineOnScreen(node) {
  if (!node || node.graph !== app.canvas?.graph) return;
  const element = document.querySelector(`[data-node-id="${CSS.escape(String(node.id))}"]`);
  if (!element) return;
  outlined.push({ element, outline: element.style.outline, offset: element.style.outlineOffset });
  element.style.outline = "3px solid var(--node-stroke-error, #e5484d)";
  element.style.outlineOffset = "3px";
}

function clearMarks() {
  for (const node of marked) setMark(node, false);
  for (const { element, outline, offset } of outlined) {
    element.style.outline = outline;
    element.style.outlineOffset = offset;
  }
  marked = [];
  outlined = [];
}

// The loader, and each subgraph node it sits in, so it can be found from
// the top of the workflow.
function markLoaders(found) {
  const root = rootGraph();
  for (const { id } of found) {
    const parts = String(id).split(":");
    for (let depth = parts.length; depth > 0; depth -= 1) {
      const node = nodeByExecutionId(root, parts.slice(0, depth).join(":"));
      if (!node || marked.includes(node)) continue;
      setMark(node, true);
      outlineOnScreen(node);
      marked.push(node);
    }
  }
  app.canvas?.setDirty?.(true, true);
}

// A run blocked again and again ("Run (On Change)" while editing) shows the
// toast once, not once per keystroke.
let lastToast = { text: "", at: 0 };
const TOAST_LIFE = 7000;

function announce(found) {
  const text = emptySourceMessage(found);
  const now = Date.now();
  if (text === lastToast.text && now - lastToast.at < TOAST_LIFE) return;
  lastToast = { text, at: now };
  showToast({ detail: text, severity: "warn", life: TOAST_LIFE });
}

// ------------------------------------------------------------- before a run

const targetsOf = (options) => (Array.isArray(options) ? options : options?.queueNodeIds) ?? null;
// LiteGraph node modes: 2 is muted ("never"), 4 is bypassed.
const SKIPPED_MODES = new Set([2, 4]);

async function emptySources(options) {
  const root = rootGraph();
  let candidate = false;
  for (const node of everyNode(root)) {
    if (!SKIPPED_MODES.has(node?.mode) && nodeLacksSource(node)) {
      candidate = true;
      break;
    }
  }
  if (!candidate) return [];
  const prompt = await app.graphToPrompt(root);
  return findEmptySources(prompt?.output, definitionOf, targetsOf(options));
}

function guardRuns() {
  const queue = app.queuePrompt;
  if (typeof queue !== "function" || queue.__ausbossRunCheck) return;
  const guarded = async function (number, batchCount, options, ...rest) {
    clearMarks();
    let found = [];
    try {
      found = await emptySources(options);
    } catch (error) {
      console.warn("[AusBoss] Run check skipped:", error);
      found = [];
    }
    if (found.length) {
      markLoaders(found);
      announce(found);
      return false;
    }
    return queue.call(this, number, batchCount, options, ...rest);
  };
  guarded.__ausbossRunCheck = true;
  app.queuePrompt = guarded;
}

// ---------------------------------------------------------- after the answer

function tidy(nodeErrors) {
  try {
    if (nodeErrors && typeof nodeErrors === "object") collapseRepeatedErrors(nodeErrors);
  } catch {
    // The errors stay exactly as ComfyUI sent them.
  }
}

function collapseAnswers() {
  const send = api.queuePrompt;
  if (typeof send !== "function" || send.__ausbossRunCheck) return;
  const collapsing = async function (...args) {
    try {
      const answer = await send.apply(this, args);
      tidy(answer?.node_errors);
      return answer;
    } catch (error) {
      tidy(error?.response?.node_errors);
      throw error;
    }
  };
  collapsing.__ausbossRunCheck = true;
  api.queuePrompt = collapsing;
}

app.registerExtension({
  name: "ausboss.run_check",
  setup() {
    guardRuns();
    collapseAnswers();
  },
});
