// Pure decision logic for the pack-wide browser-chrome features (favicon
// and tab-title queue status).
//
// No DOM or LiteGraph access here — js/chrome/index.js owns the wiring.
// Everything exported is unit-tested in tests/chrome.test.mjs.

// Matches exactly the queue prefix composeTitle() writes: "(N) " with a
// single space. Anything else (mid-title parens, "(3)NoSpace") is treated
// as part of the page's real title and left alone.
const QUEUE_PREFIX = /^\(\d+\) /;

// Remove our own "(N) " queue prefix from a tab title, if present.
export function stripQueuePrefix(title) {
  if (typeof title !== "string") return "";
  return title.replace(QUEUE_PREFIX, "");
}

// Compose the tab title for a queue depth. Always strips any existing
// queue prefix first so repeated calls never stack "(2) (3) ..." — the
// input may be a title we already rewrote. N <= 0 (or junk) restores the
// bare title exactly.
export function composeTitle(title, queueRemaining) {
  const base = stripQueuePrefix(title);
  const n = Number(queueRemaining);
  if (!Number.isFinite(n) || n <= 0) return base;
  return `(${Math.floor(n)}) ${base}`;
}
