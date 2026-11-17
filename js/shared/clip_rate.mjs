// Read only literal numeric sources. Calculated inputs must remain unknown
// until execution; never evaluate an arbitrary upstream graph for a label.
// A subgraph's output that comes straight from a literal inside it (Person
// Swap's "Pick the model files" hands out its video fps that way) counts as
// that literal: it is still a typed number, not a calculation.
function tableLink(graph, id) {
  if (id == null || !graph) return null;
  return graph.getLink?.(id) ?? graph.links?.get?.(id) ?? graph.links?.[id] ?? graph._links?.get?.(id) ?? null;
}

// The link into one of a node's inputs: the frontend's own accessor first
// (newer frontends warn on reading input.link), the link table after it.
// undefined when nothing is connected.
function linkInto(node, index, graph) {
  if (typeof node?.getInputLink === "function" && node.graph) {
    try {
      return node.getInputLink(index) ?? undefined;
    } catch {
      return undefined;
    }
  }
  const id = node?.inputs?.[index]?.link;
  return id == null ? undefined : tableLink(node.graph ?? graph, id);
}

// Where a linked input really comes from: the node and output slot at the
// far end, through Reroutes and into a subgraph whose output is wired
// straight to a node inside it. null for a muted or bypassed source, a loop,
// or a subgraph output with nothing behind it. undefined when the input is
// not linked at all.
export function linkOrigin(node, name) {
  const index = node?.inputs?.findIndex((slot) => slot?.name === name || slot?.widget?.name === name) ?? -1;
  if (index < 0) return undefined;
  let graph = node.graph;
  let link = linkInto(node, index, graph);
  if (link === undefined) return undefined;
  const seen = new Set();
  for (let depth = 0; depth < 16; depth++) {
    if (!link || seen.has(link)) return null;
    seen.add(link);
    const source = graph?.getNodeById?.(link.origin_id);
    if (!source || (source.mode ?? 0) !== 0) return null;
    if ((source.comfyClass ?? source.type) === "Reroute") {
      link = linkInto(source, 0, graph) ?? null;
      continue;
    }
    const inner = source.subgraph;
    if (inner && typeof source.isSubgraphNode === "function" && source.isSubgraphNode()) {
      link = tableLink(inner, inner.outputs?.[link.origin_slot]?.linkIds?.[0]);
      graph = inner;
      continue;
    }
    return { node: source, slot: link.origin_slot };
  }
  return null;
}

const LITERALS = ["PrimitiveFloat", "PrimitiveInt", "AUSBOSS_NODES_Integer", "AUSBOSS_NODES_Float"];

export function inputNumber(node, name, fallback) {
  const origin = linkOrigin(node, name);
  if (origin === undefined) return fallback;
  if (!origin) return null;
  const { node: source, slot } = origin;
  // ComfyUI's older Primitive node holds the value of the widget it feeds.
  if ((source.comfyClass ?? source.type) === "PrimitiveNode") {
    const value = source.widgets?.[0]?.value;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  if (!LITERALS.includes(source.type) || slot !== 0) return null;
  if (source.inputs?.some((input) => input.name === "value" && input.link != null)) return null;
  const value = source.widgets?.find((widget) => widget.name === "value")?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function clipOutputRate(node, sourceFps, everyNth = 1) {
  const forced = inputNumber(node, "force_rate", 0);
  const nth = inputNumber(node, "every_nth", everyNth);
  if (forced === null || nth === null || forced < 0 || forced > 1000 || nth < 1) return null;
  const rate = forced || Number(sourceFps);
  return Number.isFinite(rate) && rate > 0 ? rate / Math.max(1, Math.trunc(nth)) : null;
}
