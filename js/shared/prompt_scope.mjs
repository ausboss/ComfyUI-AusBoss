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
