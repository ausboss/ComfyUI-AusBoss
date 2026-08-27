// What a video dropped ONTO a Load Video 🆎 node restores. An AusBoss-saved
// file carries the workflow that made it; if that workflow holds a Load
// Video node, its trim and sampling values repopulate the target node so the
// clip reloads the way it was loaded before. Pure parsing and sanitizing
// only - the drop wiring lives in js/video_workflow_drop/index.js and
// node:test drives this module directly.

export const LOAD_VIDEO_CLASS = "AUSBOSS_NODES_LoadVideo";

// The node's serialized widget order, i.e. its INPUT_TYPES order. The DOM
// preview widget never serializes (serialize: false), so widgets_values is
// exactly this list - and the node only ever appends widgets, for the same
// positional-compatibility reason this list is append-only.
export const LOAD_VIDEO_WIDGET_ORDER = [
  "video",
  "start_seconds",
  "end_seconds",
  "custom_width",
  "custom_height",
  "every_nth",
  "max_frames",
  "single_frame",
];

// Widget ranges straight from INPUT_TYPES. The values come out of a file
// anyone could have written, so each is clamped before it may touch a node.
const NUMERIC_RANGES = {
  start_seconds: { min: 0, max: 86400, integer: false },
  end_seconds: { min: 0, max: 86400, integer: false },
  custom_width: { min: 0, max: 16384, integer: true },
  custom_height: { min: 0, max: 16384, integer: true },
  every_nth: { min: 1, max: 512, integer: true },
  max_frames: { min: 0, max: 100000, integer: true },
};

// Mirrors VIDEO_EXTENSIONS in nodes/_media_helpers.py - the set the node's
// own file list accepts, so a drop takes exactly what the picker offers.
const VIDEO_FILE_PATTERN = /\.(avi|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|mts|webm)$/i;

export function isVideoFileName(name) {
  return VIDEO_FILE_PATTERN.test(String(name || ""));
}

function sanitizedNumber(name, value) {
  const range = NUMERIC_RANGES[name];
  const number = Number(value);
  if (!range || !Number.isFinite(number)) return undefined;
  const bounded = Math.min(range.max, Math.max(range.min, number));
  return range.integer ? Math.round(bounded) : bounded;
}

function namedValues(raw) {
  const byName = {};
  if (Array.isArray(raw)) {
    raw.forEach((value, index) => {
      const name = LOAD_VIDEO_WIDGET_ORDER[index];
      if (name) byName[name] = value;
    });
  } else if (raw && typeof raw === "object") {
    for (const name of LOAD_VIDEO_WIDGET_ORDER) {
      if (name in raw) byName[name] = raw[name];
    }
  }
  return byName;
}

// name -> sanitized value for the first Load Video node in the workflow, or
// null when there is none (or nothing usable on it). "video" is never
// restored: the dropped file itself is the source now. A save from before
// the single_frame widget existed was a trim, so the toggle restores off
// rather than staying whatever the target node happened to have.
export function loadVideoRestoreValues(workflow) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  for (const node of nodes) {
    if (node?.type !== LOAD_VIDEO_CLASS) continue;
    const named = namedValues(node.widgets_values);
    const restored = {};
    for (const [name, value] of Object.entries(named)) {
      if (name === "video") continue;
      if (name === "single_frame") {
        restored[name] = value === true || value === 1 || value === "true";
        continue;
      }
      const number = sanitizedNumber(name, value);
      if (number !== undefined) restored[name] = number;
    }
    // A restore needs at least the IN point to mean anything.
    if (!("start_seconds" in restored)) continue;
    if (!("single_frame" in restored)) restored.single_frame = false;
    return restored;
  }
  return null;
}
