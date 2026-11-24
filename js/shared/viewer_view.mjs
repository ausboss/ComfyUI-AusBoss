// The viewer's 360 settings and Cut (its "AusBoss View" property,
// js/viewer_pano) as one string, for Pause for Shot's hidden `view` input.
// ComfyUI runs a node again only when one of its inputs changes, and a
// node's properties in the saved workflow are not inputs: read from there, a
// changed Turn handed back the old backdrop. So the page writes them into
// the input as the prompt is built (js/pause_shot). The keys are sorted, so
// the same settings always give the same string and a run with nothing
// changed still comes from the cache.

const KEYS = ["sky", "cut"];

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sorted(value[key]);
  return out;
}

export function viewValue(view) {
  if (!view || typeof view !== "object") return "";
  const out = {};
  for (const key of KEYS) {
    const part = view[key];
    if (part && typeof part === "object" && !Array.isArray(part)) out[key] = sorted(part);
  }
  return Object.keys(out).length ? JSON.stringify(out) : "";
}
