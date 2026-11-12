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

// The preview panel has one more stop, before picture 1: every picture at
// once. ALL stands for it where an index would be.
export const ALL = -1;

// One step back or on through "all, 1, 2 ... count", round at both ends.
export function stepWithAll(index, count, step) {
  if (!(count > 0)) return ALL;
  const stops = count + 1;
  const at = index === ALL ? 0 : keepIndex(index, count) + 1;
  const next = (((at + Math.sign(Number(step) || 0)) % stops) + stops) % stops;
  return next === 0 ? ALL : next - 1;
}

export function allLabel(count) {
  return count > 1 ? `all ${count}` : "";
}

// How to lay `count` pictures out in a box so each one draws as big as it
// can: the columns and rows that leave a picture of this shape (`aspect`,
// width over height) the most room.
export function gridShape(count, width, height, aspect = 1) {
  const total = Math.max(1, Math.trunc(Number(count) || 0));
  const shape = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  if (!(width > 0) || !(height > 0)) {
    const columns = Math.ceil(Math.sqrt(total));
    return { columns, rows: Math.ceil(total / columns) };
  }
  let best = { columns: 1, rows: total, size: 0 };
  for (let columns = 1; columns <= total; columns += 1) {
    const rows = Math.ceil(total / columns);
    const size = Math.min(width / columns, (height / rows) * shape);
    if (size > best.size) best = { columns, rows, size };
  }
  return { columns: best.columns, rows: best.rows };
}

// The held pictures in a Save Image result, in the order they show: each
// one's run token and its place in that run. A list run saves once for each
// item, so one result can hold several tokens. Empty when the result holds
// none, or when a picture in it is not one of the held ones.
export function heldPlaces(record) {
  const tokens = new Set(Array.isArray(record?.ausboss_held) ? record.ausboss_held : []);
  if (!tokens.size) return [];
  const held = (Array.isArray(record.images) ? record.images : []).map((image) => {
    const match = /^([0-9a-f]{16})_(\d{3})\./.exec(String(image?.filename ?? ""));
    return match && tokens.has(match[1]) ? { token: match[1], index: Number(match[2]) } : null;
  });
  return held.length && held.every(Boolean) ? held : [];
}
