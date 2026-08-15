// Resolving ComfyUI execution ids to graph nodes.
//
// Kept free of /scripts/app.js imports so node:test can cover it
// (tests/graph_ids.test.mjs); callers pass the root graph in.

// ComfyUI identifies a node inside a subgraph by its execution id: the chain
// of subgraph node ids that reaches it, colon-joined ("12:3" is node 3 inside
// the subgraph node 12 holds). Only the last segment is a real graph node id,
// and ids are numbered independently inside each subgraph, so looking the
// bare tail up on the root graph does not merely miss - it can return a
// completely unrelated top-level node that happens to share the number.
// Walking the chain is the only way to answer correctly; an id that does not
// resolve returns null, because acting on the wrong node is worse than doing
// nothing at all.
export function nodeByExecutionId(rootGraph, executionId) {
  const parts = String(executionId ?? "")
    .split(":")
    .filter((part) => part !== "");
  if (!parts.length) return null;
  let graph = rootGraph ?? null;
  for (const part of parts.slice(0, -1)) {
    const holder = graph?.getNodeById?.(Number(part)) ?? graph?.getNodeById?.(part);
    graph = holder?.subgraph ?? null;
    if (!graph) return null;
  }
  const tail = parts[parts.length - 1];
  return graph?.getNodeById?.(Number(tail)) ?? graph?.getNodeById?.(tail) ?? null;
}
