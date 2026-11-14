// Read only literal numeric sources. Calculated inputs must remain unknown
// until execution; never evaluate an arbitrary upstream graph for a label.
// A subgraph's output that comes straight from a literal inside it (Person
// Swap's "Pick the model files" hands out its video fps that way) counts as
// that literal: it is still a typed number, not a calculation.
function getLink(graph, id) {
  return graph?.links?.get?.(id) ?? graph?.links?.[id] ?? graph?._links?.get?.(id);
}

export function inputNumber(node, name, fallback) {
  const input = node.inputs?.find((slot) => slot.name === name || slot.widget?.name === name);
  if (input?.link == null) return fallback;
  let graph = node.graph;
  let linkId = input.link;
  const seen = new Map();
  for (let depth = 0; depth < 16; depth++) {
    if (!seen.has(graph)) seen.set(graph, new Set());
    if (seen.get(graph).has(linkId)) return null;
    seen.get(graph).add(linkId);
    const link = getLink(graph, linkId);
    const source = graph?.getNodeById?.(link?.origin_id);
    if (!source || (source.mode ?? 0) !== 0) return null;
    if (source.type === "Reroute") {
      linkId = source.inputs?.[0]?.link;
      if (linkId == null) return null;
      continue;
    }
    const inner = source.subgraph;
    if (inner && typeof source.isSubgraphNode === "function" && source.isSubgraphNode()) {
      const next = inner.outputs?.[link.origin_slot]?.linkIds?.[0];
      if (next == null) return null;
      graph = inner;
      linkId = next;
      continue;
    }
    if (!["PrimitiveFloat", "PrimitiveInt", "AUSBOSS_NODES_Integer", "AUSBOSS_NODES_Float"].includes(source.type) || link.origin_slot !== 0) return null;
    if (source.inputs?.some((slot) => slot.name === "value" && slot.link != null)) return null;
    const value = source.widgets?.find((widget) => widget.name === "value")?.value;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  return null;
}

export function clipOutputRate(node, sourceFps, everyNth = 1) {
  const forced = inputNumber(node, "force_rate", 0);
  const nth = inputNumber(node, "every_nth", everyNth);
  if (forced === null || nth === null || forced < 0 || forced > 1000 || nth < 1) return null;
  const rate = forced || Number(sourceFps);
  return Number.isFinite(rate) && rate > 0 ? rate / Math.max(1, Math.trunc(nth)) : null;
}
