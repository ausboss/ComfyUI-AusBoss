// Small pieces every timing card shares (the clip node, Load Video, Load
// Audio): the seconds | frames choice and the "linked" button that goes to
// the node feeding a value.
import { app } from "../../../scripts/app.js";

// Seconds or frames on a timing card: a per-browser choice, like a view
// setting. It never changes a stored value.
const UNITS_KEY = "AusBoss.ClipTiming.Units";
let unitsCache = null;
export function timingUnits(next) {
  if (next === "s" || next === "f") {
    unitsCache = next;
    try { localStorage.setItem(UNITS_KEY, next); } catch { /* private window */ }
    return next;
  }
  if (unitsCache) return unitsCache;
  try { unitsCache = localStorage.getItem(UNITS_KEY) === "f" ? "f" : "s"; } catch { unitsCache = "s"; }
  return unitsCache;
}

// The node feeding a linked input, by its title, with a way to go to it.
export function linkedNodeInfo(node, name) {
  const slot = node.inputs?.find((input) => input?.name === name || input?.widget?.name === name);
  if (slot?.link == null) return null;
  const graph = node.graph;
  const link = graph?.links?.get?.(slot.link) ?? graph?.links?.[slot.link] ?? graph?._links?.get?.(slot.link);
  const source = graph?.getNodeById?.(link?.origin_id);
  if (!source) return { title: "the subgraph's input", go: null };
  const title = source.title || source.type || "another node";
  return {
    title,
    go: () => {
      try {
        app.canvas?.selectNode?.(source);
        app.canvas?.centerOnNode?.(source);
        app.canvas?.setDirty?.(true, true);
      } catch { /* an older canvas */ }
    },
  };
}
