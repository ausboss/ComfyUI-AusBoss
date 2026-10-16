// Which workflow tab a run belongs to.
//
// Every workflow tab in one browser page shares one connection to the
// server, and ComfyUI files a node's results by its node id. A run queued in
// one tab that finishes while another tab is open therefore lands on the
// node with the same id in the open tab: its preview, and its onExecuted
// call. Core only shows the stray picture; an AusBoss node that keeps what a
// run sent (Show Text's text, the Seed history) would also save it into the
// wrong workflow.
//
// This module remembers which graph queued each run and says whether the
// run reporting now belongs to the graph on screen. js/prompt_scope wires it
// to the api; the nodes ask isForeignRun() before they take a result. No DOM
// and no ComfyUI imports, so node:test covers it.

const DEFAULT_LIMIT = 256;

export function createRunScope({ limit = DEFAULT_LIMIT } = {}) {
  // prompt id -> id of the graph that queued it, oldest first
  const owners = new Map();
  let current = null;
  let activeOwner = () => null;

  const ownerOf = (promptId = current) => {
    if (promptId === null || promptId === undefined || promptId === "") return null;
    return owners.get(String(promptId)) ?? null;
  };

  return {
    // A run was queued from the graph `owner`.
    queued(promptId, owner) {
      if (!promptId || owner === null || owner === undefined || owner === "") return;
      const key = String(promptId);
      owners.delete(key);
      owners.set(key, String(owner));
      while (owners.size > Math.max(1, limit)) owners.delete(owners.keys().next().value);
    },
    // The server started, or is reporting on, this run.
    started(promptId) {
      if (promptId) current = String(promptId);
    },
    // Run `task` as if `promptId` were reporting: a result held back from
    // another tab is handed over later, when that tab is open again.
    during(promptId, task) {
      const before = current;
      if (promptId) current = String(promptId);
      try {
        return task();
      } finally {
        current = before;
      }
    },
    // Where the graph on screen comes from: a function, read on every ask.
    setActiveOwner(read) {
      activeOwner = typeof read === "function" ? read : () => null;
    },
    ownerOf,
    get current() {
      return current;
    },
    // True only when both sides are known and differ. A run nobody recorded
    // (queued before this page loaded, or by another client) is never
    // foreign: the nodes then behave as they always have.
    isForeign(promptId = current) {
      const owner = ownerOf(promptId);
      if (owner === null) return false;
      let active = null;
      try {
        active = activeOwner();
      } catch {
        return false;
      }
      return active !== null && active !== undefined && active !== "" && owner !== String(active);
    },
  };
}

// Where the frontend files a node's results (app.nodeOutputs): its id on
// the root graph, "<subgraph id>:<id>" inside a subgraph.
export function outputKey(node, root = null) {
  if (!node || node.id === null || node.id === undefined) return null;
  const graph = node.graph;
  return graph && root && graph !== root && graph.id ? `${graph.id}:${node.id}` : String(node.id);
}

// The page-wide scope the nodes share.
export const runScope = createRunScope();

// Does the run reporting now belong to another workflow tab?
export function isForeignRun(promptId) {
  return promptId === undefined ? runScope.isForeign() : runScope.isForeign(promptId);
}

// ---- a node's own runs ------------------------------------------------------
//
// Mask by Touch looks at its picture by running itself alone, as a run of its
// own, whenever the pointer rests on a new picture. Those runs belong to the
// node, not to the workflow: the Run Timer and the runtime badges leave them
// out. Such a run is known by what it sends: it targets nodes only, and the
// node's `ask` carries the request (an ordinary run sends an empty `ask`).

const OWN_RUN_NODES = new Set(["AUSBOSS_NODES_MaskByTouch"]);

// `prompt` is the API prompt being sent, `options` what the frontend passed
// along with it (partialExecutionTargets on a run of chosen nodes).
export function isNodeOwnRun(prompt, options) {
  const targets = options?.partialExecutionTargets;
  if (!Array.isArray(targets) || !targets.length || !prompt || typeof prompt !== "object") return false;
  return Object.values(prompt).some(
    (step) => OWN_RUN_NODES.has(step?.class_type) && String(step?.inputs?.ask ?? "").trim() !== "",
  );
}

export function createOwnRuns({ limit = DEFAULT_LIMIT } = {}) {
  const ids = new Set();
  const listeners = new Set();
  return {
    // The queue answered with this run's id. The server may have started it
    // before the answer came back, so whoever already took it as a run of
    // the workflow hears of it here and takes that back.
    mark(promptId) {
      if (promptId === null || promptId === undefined || promptId === "") return;
      const key = String(promptId);
      if (ids.has(key)) return;
      ids.add(key);
      while (ids.size > Math.max(1, limit)) ids.delete(ids.values().next().value);
      for (const listener of [...listeners]) {
        try {
          listener(key);
        } catch {
          // One listener failing never keeps the news from the others.
        }
      }
    },
    has(promptId) {
      return promptId !== null && promptId !== undefined && promptId !== "" && ids.has(String(promptId));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// The page-wide list the Run Timer and the runtime badges share.
export const ownRuns = createOwnRuns();

export function isOwnRun(promptId) {
  return ownRuns.has(promptId);
}
