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

// Countdown fragment for the header while a pause has a timeout armed.
// Returns "" when no countdown applies so the caller can join with " - ".
export function countdownText(remaining, policy) {
  const seconds = Number(remaining);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const action = typeof policy === "string" && policy ? policy : "keep all";
  return `${Math.ceil(seconds)}s to ${action}`;
}

// An empty selected list tells the server to keep every frame, so "Keep all"
// posts [] instead of enumerating the batch.
export function continuePayload(nodeId, selected, token) {
  return { node_id: nodeId, token, action: "continue", selected: sortedFrames(selected) };
}

export function cancelPayload(nodeId, token) {
  return { node_id: nodeId, token, action: "cancel" };
}

// One answer at a time. Every path that can post - the buttons, the keyboard,
// the cancel a deleted node sends - asks this first, so two quick Enters (or a
// click chased by an Enter) cannot put the same token on the wire twice and
// collect a rejection for the duplicate.
export function submissionAllowed(state) {
  if (!state || state.active !== true) return false;
  return state.submitting !== true;
}

// Takes the latch and returns the ticket the reply must be matched against:
// which pause was answered, and which submission this was. Returns null when
// the guard refuses, and the caller then simply does not post.
export function beginSubmission(state) {
  if (!submissionAllowed(state)) return null;
  const seq = (Number(state.submitSeq) || 0) + 1;
  state.submitting = true;
  state.submitSeq = seq;
  return {
    seq,
    id: String(state.activeId ?? ""),
    token: String(state.activeToken ?? ""),
  };
}

// Releases the latch for the submission still holding it, whether the request
// succeeded or failed, so a genuine network failure can be retried. A reply
// from a superseded submission leaves the current one latched.
export function endSubmission(state, ticket) {
  if (!state || !ticket) return false;
  if ((Number(state.submitSeq) || 0) !== ticket.seq) return false;
  state.submitting = false;
  return true;
}

// A fresh pause starts unlatched: anything still in flight was aimed at the
// pause that just went away, and its reply is stale by definition.
export function clearSubmission(state) {
  if (!state) return;
  state.submitting = false;
}

// True when a reply must be dropped rather than applied, because the panel has
// moved on since it was posted: the pause was resolved (timeout, another tab,
// the run stopping) or a new pause took the panel over. Dropping is what keeps
// a late rejection from painting "Answer failed" over the result of the
// request that actually worked.
export function answerIsStale(ticket, state) {
  if (!ticket || !state) return true;
  if (state.active !== true) return true;
  if (String(state.activeId ?? "") !== ticket.id) return true;
  return String(state.activeToken ?? "") !== ticket.token;
}

// A pause can appear under a pointer already on its way down, so a freshly
// shown panel ignores clicks for this long: a click aimed at the canvas must
// never answer a filmstrip that just popped up.
export const CLICK_COOLDOWN_MS = 400;

export function clickLocked(elapsed, cooldown = CLICK_COOLDOWN_MS) {
  const since = Number(elapsed);
  // An unknown age fails open - a panel that eats every click is worse than
  // one that answers a stray one.
  if (!Number.isFinite(since)) return false;
  return since >= 0 && since < cooldown;
}

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

// Keys typed into a field belong to the field, never to the filmstrip.
export function isTypingTarget(tagName, isContentEditable) {
  if (isContentEditable === true) return true;
  return TYPING_TAGS.has(String(tagName || "").toUpperCase());
}

// Keyboard map for the focused panel: digits toggle a frame, A/N flip the
// whole filmstrip, Enter keeps the selection, Escape cancels the run. Returns
// null when the key belongs to someone else (a text field, a modifier combo,
// or the app itself) so the caller leaves that event alone.
export function chooserKeyAction({
  key,
  typing = false,
  ctrl = false,
  meta = false,
  alt = false,
} = {}) {
  if (typing || ctrl || meta || alt) return null;
  if (typeof key !== "string" || key.length === 0) return null;
  if (key.length === 1 && key >= "1" && key <= "9") {
    return { action: "toggle", frame: Number(key) };
  }
  switch (key) {
    case "a":
    case "A":
      return { action: "all" };
    case "n":
    case "N":
      return { action: "none" };
    case "Enter":
      return { action: "keep" };
    case "Escape":
      return { action: "cancel" };
    default:
      return null;
  }
}

// True when a pause deserves an out-of-band nudge because the panel is not on
// screen: the browser tab is hidden, the node is scrolled off the canvas, or
// the canvas is drawing another workflow. Unknown signals count as visible -
// a filmstrip the user is looking at must never nag - and the latch keeps it
// to one notification per pause however often the panel re-renders.
export function shouldNotifyPause({
  documentHidden = false,
  onScreen = true,
  workflowFronted = true,
  alreadyNotified = false,
} = {}) {
  if (alreadyNotified) return false;
  return documentHidden === true || onScreen === false || workflowFronted === false;
}

// Panels the canvas has scrolled away report an empty rect (frontends hide
// off-view DOM widgets) or one that misses the viewport entirely. Any overlap
// counts as seen; unreadable numbers assume the user can see the panel.
export function rectOnScreen(rect, viewport) {
  if (!rect || !viewport) return true;
  const width = Number(rect.width);
  const height = Number(rect.height);
  const left = Number(rect.left);
  const top = Number(rect.top);
  const viewWidth = Number(viewport.width);
  const viewHeight = Number(viewport.height);
  if (!Number.isFinite(viewWidth) || !Number.isFinite(viewHeight)) return true;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return true;
  if (!Number.isFinite(left) || !Number.isFinite(top)) return true;
  if (width <= 0 || height <= 0) return false;
  return left + width > 0 && top + height > 0 && left < viewWidth && top < viewHeight;
}

// Notice text for an unattended pause. Names the node so a graph running
// several choosers says which one is waiting.
export function pauseNoticeText(title, count) {
  const name = typeof title === "string" && title.trim() ? title.trim() : "Frame Chooser";
  const frames = Number(count) > 0 ? `${count} frames` : "the incoming frames";
  return `${name} paused the run - pick from ${frames} to continue.`;
}
