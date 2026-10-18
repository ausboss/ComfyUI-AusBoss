// Which picture of a run to show, and the "2 / 5" that says so. DOM-free
// so node:test covers it; the arrows themselves are picture_stepper.mjs.

// Which picture to show when a run brings `count` of them: the one shown
// before if there still is one, else the last one there is.
export function keepIndex(index, count) {
  if (!(count > 0)) return 0;
  const whole = Number.isFinite(index) ? Math.trunc(index) : 0;
  return Math.min(Math.max(whole, 0), count - 1);
}

// One step back (-1) or on (+1), round from the last picture to the first.
export function stepIndex(index, count, step) {
  if (!(count > 0)) return 0;
  const next = keepIndex(index, count) + Math.sign(Number(step) || 0);
  return ((next % count) + count) % count;
}

export function stepperLabel(index, count) {
  return count > 1 ? `${keepIndex(index, count) + 1} / ${count}` : "";
}
