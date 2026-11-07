// The same live-input rule used by the writer timeline: muted/bypassed
// sources do not reach this node. This inspects the wire, never media bytes.
export function linkSource(node, name) {
  const slot = node.inputs?.find((input) => input?.widget?.name === name || input?.name === name);
  if (slot?.link === null || slot?.link === undefined) return null;
  const graph = node.graph;
  const link = graph?.links?.[slot.link] ?? graph?._links?.get?.(slot.link);
  const source = graph?.getNodeById?.(link?.origin_id);
  return (source?.mode ?? 0) === 0 ? source ?? null : null;
}

// Keep in step with Python KEEPS_ITS_LENGTH. Other jobs use seconds normally.
export function clipSetsDuration(node, values) {
  return ["swap the person", "new voice", "change something"].includes(values.video_job)
    && linkSource(node, "video") !== null;
}
