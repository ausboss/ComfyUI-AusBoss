// Pure selection-set logic for the Frame Chooser filmstrip.
//
// Kept DOM-free so node:test covers it (tests/frame_chooser.test.mjs); the
// entry point in js/frame_chooser/index.js only wires these to the panel.
// Frame indices are one-based everywhere, matching the backend contract.

export function toggleFrame(selected, index) {
  const next = new Set(selected);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}

export function allFrames(count) {
  const next = new Set();
  for (let index = 1; index <= count; index += 1) next.add(index);
  return next;
}

export function noFrames() {
  return new Set();
}

// Remembered selections arrive from the server and may predate the current
// batch; keep only indices this filmstrip actually shows.
export function validFrames(values, count) {
  const next = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    if (Number.isInteger(value) && value >= 1 && value <= count) next.add(value);
  }
  return next;
}

export function sortedFrames(selected) {
  return [...selected].sort((a, b) => a - b);
}

export function selectionSummary(selected, count) {
  return `${selected.size} of ${count} selected`;
}

// An empty selected list tells the server to keep every frame, so "Keep all"
// posts [] instead of enumerating the batch.
export function continuePayload(nodeId, selected) {
  return { node_id: nodeId, action: "continue", selected: sortedFrames(selected) };
}

export function cancelPayload(nodeId) {
  return { node_id: nodeId, action: "cancel" };
}
