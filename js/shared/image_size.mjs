// Image Size 🆎: what the node shows beside its outputs after a run. No DOM
// and no ComfyUI imports, so node:test covers it.

// The executed message carries [width, height, longest, shortest, count] for
// the batch that was measured. A node that ran once for each item of a list
// reports several batches at once; no one number is true for all of them, so
// that case shows nothing.
export function sizesFromExecuted(message, outputs = 5) {
  const sizes = message?.ausboss_size;
  if (!Array.isArray(sizes) || sizes.length !== outputs) return null;
  return sizes.every((value) => Number.isFinite(value)) ? sizes : null;
}

// "width: 1024": the output's own name, then its number.
export function sizeLabel(name, value) {
  return `${name}: ${value}`;
}

// The label an output is saved with: the one its user gave it, never a
// number from the last run. `shown` is false for an output that never showed
// a size, whose saved label is left as it is.
export function savedLabel({ shown, own }, current) {
  return shown ? own : current;
}
