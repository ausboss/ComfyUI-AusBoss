// Link bookkeeping for the graph rewrites (Recreate node 🆎, Replace with
// AusBoss nodes 🆎): snapshot a node's links, wire a replacement, and hand
// links back on rollback.
//
// Kept free of /scripts/app.js imports so node:test can cover it
// (tests/graph_links.test.mjs); callers pass the graph and nodes in.

// graph.links is a plain object on older frontends and a Map on newer ones.
export function lookupLink(graph, linkId) {
  if (linkId == null) return null;
  return graph?.links?.get?.(linkId) ?? graph?.links?.[linkId] ?? null;
}

// Wire origin's output slot to target's input slot, both by index. Returns
// the new link, or null when it could not be made.
//
// LGraphNode's index-based connect only resolves the two slot objects -
// after the same checks as below, including the target's
// onBeforeConnectInput redirect - and hands them to connectSlots, which does
// the real work: type validation, onConnectInput/onConnectOutput, replacing
// the input's previous link, and the undo bracket. Calling connectSlots
// directly keeps that behavior and avoids the index-based connect call,
// which registry scanners read as a network socket.
export function linkSlots(origin, outputIndex, target, inputIndex) {
  if (!origin?.graph || !target || target === origin) return null;
  if (typeof origin.connectSlots !== "function") return null;
  let slot = inputIndex;
  if (typeof target.onBeforeConnectInput === "function") {
    const redirected = target.onBeforeConnectInput(slot, inputIndex);
    slot = typeof redirected === "number" ? redirected : null;
  }
  const output = origin.outputs?.[outputIndex];
  const input = slot == null ? null : target.inputs?.[slot];
  if (!output || !input) return null;
  return origin.connectSlots(output, target, input) ?? null;
}

// A node's links resolved to node ids and slot positions up front, so the
// snapshot stays valid after individual links are torn down.
export function snapshotLinks(node, graph) {
  const inputs = [];
  for (const input of node.inputs || []) {
    const link = lookupLink(graph, input.link);
    if (!link) continue;
    inputs.push({ name: input.name, originId: link.origin_id, originSlot: link.origin_slot });
  }
  const outputs = [];
  (node.outputs || []).forEach((output, slot) => {
    const targets = [];
    for (const linkId of output.links || []) {
      const link = lookupLink(graph, linkId);
      if (link) targets.push({ nodeId: link.target_id, slot: link.target_slot });
    }
    if (targets.length) outputs.push({ name: output.name, slot, targets });
  });
  return { inputs, outputs };
}

// Wiring a replacement's outputs steals the target inputs from the original
// node, so a rollback hands back every link that was taken.
export function restoreOutputLinks(node, outputs, graph) {
  for (const output of outputs) {
    for (const target of output.targets) {
      const targetNode = graph.getNodeById(target.nodeId);
      if (!targetNode) continue;
      const current = lookupLink(graph, targetNode.inputs?.[target.slot]?.link);
      if (current?.origin_id === node.id) continue; // never stolen
      linkSlots(node, output.slot, targetNode, target.slot);
    }
  }
}
