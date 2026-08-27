// Pure decision logic for the queue-completion chime. No DOM and no ComfyUI
// imports, so it stays testable under node:test; the audio and event wiring
// live in js/notify/index.js.

// ComfyUI's "status" event has carried the queue count in two shapes across
// frontend versions: detail.exec_info.queue_remaining and
// detail.status.exec_info.queue_remaining. Anything else (including the null
// detail sent on disconnect) resolves to null, which callers must ignore
// rather than treat as "queue empty".
export function queueRemaining(detail) {
  const info = detail?.exec_info ?? detail?.status?.exec_info;
  const remaining = Number(info?.queue_remaining);
  return Number.isFinite(remaining) ? remaining : null;
}

// The chime marks the moment work finishes: a transition from a busy queue
// to an empty one, and only while the setting is on. Loading the page with
// an idle queue (0 → 0) and every in-between tick (3 → 2) stay silent.
export function shouldChime(enabled, previousRemaining, nextRemaining) {
  return !!enabled && Number(previousRemaining) > 0 && nextRemaining === 0;
}
