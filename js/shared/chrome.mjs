// Pure decision logic for the pack-wide browser-chrome features: the
// favicon/tab-title queue status and the per-node runtime badges.
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

// Format a node runtime in seconds for a badge: "49ms", "1.50s", "1m35s".
// ASCII only. Junk and negatives format to "" so callers can skip drawing.
export function formatDuration(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return "";
  const ms = Math.round(s * 1000);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) {
    const fixed = (ms / 1000).toFixed(2);
    // 59.999s rounds up to "60.00" — carry it into the minutes form.
    if (fixed !== "60.00") return `${fixed}s`;
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}m${totalSeconds - minutes * 60}s`;
}

// Fresh per-run accumulator. `totals` maps node id (string) -> seconds.
export function createRunState() {
  return { runningId: null, startedAt: 0, totals: new Map() };
}

// State transition for one "executing" event. Closes out the elapsed time
// of the previously-running node (accumulating, so a node revisited by a
// batched loop sums across visits) and stamps the new node's start time.
// `nodeId` is the newly-executing node id, or null when the run finished.
// Returns the closed-out totals as [{ id, seconds }] so the caller can
// stamp them onto graph nodes; calling again with null while idle is a
// no-op. A clock that goes backwards contributes zero, never negative.
export function advanceExecution(state, nodeId, now) {
  const timestamp = Number(now) || 0;
  const updates = [];
  if (state.runningId !== null) {
    const elapsed = Math.max(0, (timestamp - state.startedAt) / 1000);
    const seconds = (state.totals.get(state.runningId) ?? 0) + elapsed;
    state.totals.set(state.runningId, seconds);
    updates.push({ id: state.runningId, seconds });
  }
  state.runningId = nodeId == null ? null : String(nodeId);
  state.startedAt = timestamp;
  return updates;
}
