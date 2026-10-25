// The pictures ComfyUI sends after each sampling step: what the run is
// doing now, which node made the picture, and which nodes show it.
//
// No DOM and no ComfyUI imports, so node:test covers it
// (tests/step_preview.test.mjs). js/shared/step_preview.mjs wires it to the
// server's events and draws it.

import { executionIdOf, nodeByExecutionId } from "./graph_ids.mjs";
import { linkById } from "./input_preview.mjs";

// Nothing running, nothing to show.
export const IDLE = Object.freeze({
  status: "idle",
  promptId: null,
  maker: null,
  value: 0,
  max: 0,
  url: null,
});

const sameId = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);

// One server event at a time, oldest first; returns the next state and
// never changes the one passed in. Events:
//   { type: "start", promptId }                    a run began
//   { type: "picture", promptId, maker, url }      a step picture arrived
//   { type: "progress", promptId, node, value, max }
//   { type: "end", promptId, kind }                "success" | "interrupted" | "error"
// A step's picture arrives just before its progress report, so a picture
// from a new node starts that node's count at nothing until the report.
export function nextRunState(state, event) {
  const run = state ?? IDLE;
  switch (event?.type) {
    case "start":
      return { ...IDLE, status: "running", promptId: event.promptId ?? null };
    case "picture": {
      if (!event.url) return run;
      // A late picture from a run that already ended changes nothing.
      if (run.status !== "running" && run.status !== "idle" && sameId(event.promptId, run.promptId)) return run;
      const otherRun = run.status !== "running" || (event.promptId && run.promptId && !sameId(event.promptId, run.promptId));
      const base = otherRun ? { ...IDLE, status: "running", promptId: event.promptId ?? null } : run;
      const sameMaker = !otherRun && sameId(base.maker, event.maker);
      return {
        ...base,
        maker: event.maker ?? null,
        url: event.url,
        value: sameMaker ? base.value : 0,
        max: sameMaker ? base.max : 0,
      };
    }
    case "progress": {
      if (run.status !== "running" || !sameId(event.node, run.maker)) return run;
      if (event.promptId && run.promptId && !sameId(event.promptId, run.promptId)) return run;
      const value = Number(event.value);
      const max = Number(event.max);
      if (!Number.isFinite(value) || !Number.isFinite(max)) return run;
      return { ...run, value, max };
    }
    case "end": {
      if (run.status !== "running") return run;
      if (event.promptId && run.promptId && !sameId(event.promptId, run.promptId)) return run;
      const status = event.kind === "interrupted" ? "stopped" : event.kind === "error" ? "failed" : "done";
      return { ...run, status };
    }
    default:
      return run;
  }
}

// "step 3 of 8", or "starting" before the first report.
export function stepText(run) {
  if (!(run?.max > 0)) return "starting";
  return `step ${Math.min(Math.max(0, run.value), run.max)} of ${run.max}`;
}

// What a stopped run leaves on the picture. `saves` adds that the save
// node never got to save it.
export function stoppedText(run, { saves = false } = {}) {
  const where = run?.max > 0 ? `stopped at step ${Math.min(run.value, run.max)} of ${run.max}` : "stopped";
  return saves ? `${where} · nothing saved` : where;
}

// How far along the picture's node is, 0..1.
export function stepFraction(run) {
  if (!(run?.max > 0)) return 0;
  return Math.min(1, Math.max(0, run.value / run.max));
}

// Who is making the picture, in the words on the canvas: the outermost box
// that holds the sampler ("Generate or edit with Qwen"), or the sampler's
// own title when it sits on the top level.
export function makerLabel(rootGraph, executionId) {
  if (executionId === null || executionId === undefined) return "";
  const outer = nodeByExecutionId(rootGraph, String(executionId).split(":")[0]);
  const own = outer ? null : nodeByExecutionId(rootGraph, executionId);
  const node = outer ?? own;
  return String(node?.title || node?.type || "").trim();
}

// The ids of every node a node's inputs reach back to, on its own graph.
// `outside` says the walk met a link from outside that graph (a box's own
// inputs), which it cannot follow.
export function upstreamIds(graph, start) {
  const ids = new Set();
  let outside = false;
  const queue = [start];
  const seen = new Set([start]);
  while (queue.length) {
    const node = queue.pop();
    for (const input of node?.inputs ?? []) {
      const link = linkById(graph, input?.link);
      if (!link) continue;
      const id = String(link.origin_id);
      ids.add(id);
      const origin = graph?.getNodeById?.(link.origin_id) ?? null;
      if (!origin) {
        outside = true;
        continue;
      }
      if (seen.has(origin)) continue;
      seen.add(origin);
      queue.push(origin);
    }
  }
  return { ids, outside };
}

// Whether the node with this execution id feeds `consumer` (a Save Image),
// so the steps it draws belong in the consumer's picture. A maker in a box
// counts as the box. When the answer cannot be read off the graph (the
// consumer sits in a box the maker is outside of) the steps are shown.
export function feedsInto(rootGraph, consumer, executionId) {
  if (!consumer || executionId === null || executionId === undefined) return false;
  const own = executionIdOf(rootGraph, consumer);
  if (!own) return true;
  const prefix = own.split(":").slice(0, -1);
  const maker = String(executionId).split(":");
  for (let index = 0; index < prefix.length; index += 1) {
    if (maker[index] !== prefix[index]) return true;
  }
  const local = maker[prefix.length];
  if (local === undefined) return true;
  return upstreamIds(consumer.graph, consumer).ids.has(local);
}

// Which of the consumers show a maker's steps: the ones it feeds, or every
// one when it feeds none that the graph can tell (a pack's wireless
// set/get nodes break the trail).
export function consumersOf(rootGraph, consumers, executionId) {
  const list = [...(consumers ?? [])];
  const fed = list.filter((consumer) => feedsInto(rootGraph, consumer, executionId));
  return fed.length ? fed : list;
}
