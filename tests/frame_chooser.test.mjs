import assert from "node:assert/strict";
import test from "node:test";

import {
  CLICK_COOLDOWN_MS,
  allFrames,
  answerIsStale,
  beginSubmission,
  cancelPayload,
  chooserKeyAction,
  clearSubmission,
  clickLocked,
  continuePayload,
  countdownText,
  endSubmission,
  isStaleAnswerStatus,
  isTypingTarget,
  noFrames,
  pauseNoticeText,
  rectOnScreen,
  selectionSummary,
  shouldNotifyPause,
  sortedFrames,
  submissionAllowed,
  toggleFrame,
  validFrames,
} from "../js/shared/frame_chooser.mjs";

test("toggling flips membership without mutating the input set", () => {
  const original = new Set([2, 5]);
  const added = toggleFrame(original, 3);
  const removed = toggleFrame(added, 5);
  assert.deepEqual(sortedFrames(added), [2, 3, 5]);
  assert.deepEqual(sortedFrames(removed), [2, 3]);
  assert.deepEqual(sortedFrames(original), [2, 5]);
});

test("select all and none produce the full and empty sets", () => {
  assert.deepEqual(sortedFrames(allFrames(4)), [1, 2, 3, 4]);
  assert.equal(allFrames(0).size, 0);
  assert.equal(noFrames().size, 0);
});

test("remembered selections are filtered to the current batch", () => {
  assert.deepEqual(sortedFrames(validFrames([2, 5, 40, 0, 1.5, "3"], 10)), [2, 5]);
  assert.equal(validFrames(undefined, 10).size, 0);
  assert.equal(validFrames("2,5", 10).size, 0);
});

test("continue payloads are one-based, sorted, and keep-all posts an empty list", () => {
  assert.deepEqual(continuePayload("7", new Set([9, 1, 4]), "pause-token"), {
    node_id: "7",
    token: "pause-token",
    action: "continue",
    selected: [1, 4, 9],
  });
  assert.deepEqual(continuePayload("7", noFrames(), "pause-token").selected, []);
  assert.deepEqual(cancelPayload("7", "pause-token"), {
    node_id: "7",
    token: "pause-token",
    action: "cancel",
  });
});

test("the header summary counts the selection against the batch", () => {
  assert.equal(selectionSummary(new Set([1, 2, 3]), 24), "3 of 24 selected");
  assert.equal(selectionSummary(noFrames(), 24), "0 of 24 selected");
});

test("the countdown names the seconds left and the timeout policy", () => {
  assert.equal(countdownText(42, "keep all"), "42s to keep all");
  assert.equal(countdownText(4.2, "cancel"), "5s to cancel");
  assert.equal(countdownText(3, ""), "3s to keep all");
});

test("no countdown renders while the timer is off or expired", () => {
  assert.equal(countdownText(0, "keep all"), "");
  assert.equal(countdownText(-2, "cancel"), "");
  assert.equal(countdownText(undefined, "keep all"), "");
  assert.equal(countdownText("soon", "keep all"), "");
});

test("digits toggle their frame and letters flip the whole filmstrip", () => {
  assert.deepEqual(chooserKeyAction({ key: "1" }), { action: "toggle", frame: 1 });
  assert.deepEqual(chooserKeyAction({ key: "9" }), { action: "toggle", frame: 9 });
  assert.equal(chooserKeyAction({ key: "0" }), null);
  assert.deepEqual(chooserKeyAction({ key: "a" }), { action: "all" });
  assert.deepEqual(chooserKeyAction({ key: "A" }), { action: "all" });
  assert.deepEqual(chooserKeyAction({ key: "n" }), { action: "none" });
  assert.deepEqual(chooserKeyAction({ key: "N" }), { action: "none" });
  assert.deepEqual(chooserKeyAction({ key: "Enter" }), { action: "keep" });
  assert.deepEqual(chooserKeyAction({ key: "Escape" }), { action: "cancel" });
});

test("unmapped keys, modifier combos, and typed keys stay with the app", () => {
  assert.equal(chooserKeyAction({ key: "z" }), null);
  assert.equal(chooserKeyAction({ key: " " }), null);
  assert.equal(chooserKeyAction({ key: "ArrowLeft" }), null);
  assert.equal(chooserKeyAction({}), null);
  assert.equal(chooserKeyAction(), null);
  // Ctrl+A must stay the app's select-all, Cmd+Enter the queue shortcut.
  assert.equal(chooserKeyAction({ key: "a", ctrl: true }), null);
  assert.equal(chooserKeyAction({ key: "Enter", meta: true }), null);
  assert.equal(chooserKeyAction({ key: "n", alt: true }), null);
  // Typing in a field wins over every mapped key, Escape included.
  assert.equal(chooserKeyAction({ key: "3", typing: true }), null);
  assert.equal(chooserKeyAction({ key: "A", typing: true }), null);
  assert.equal(chooserKeyAction({ key: "Escape", typing: true }), null);
});

test("text fields and editable regions count as typing targets", () => {
  assert.equal(isTypingTarget("INPUT"), true);
  assert.equal(isTypingTarget("textarea"), true);
  assert.equal(isTypingTarget("SELECT"), true);
  assert.equal(isTypingTarget("DIV", true), true);
  assert.equal(isTypingTarget("DIV"), false);
  assert.equal(isTypingTarget("BUTTON", false), false);
  assert.equal(isTypingTarget(undefined), false);
});

test("a freshly shown panel ignores clicks until the cooldown lapses", () => {
  assert.equal(clickLocked(0), true);
  assert.equal(clickLocked(CLICK_COOLDOWN_MS - 1), true);
  assert.equal(clickLocked(CLICK_COOLDOWN_MS), false);
  assert.equal(clickLocked(5000), false);
  assert.equal(clickLocked(120, 100), false);
  // An unknown age fails open rather than leaving a panel that eats clicks.
  assert.equal(clickLocked(undefined), false);
  assert.equal(clickLocked(NaN), false);
  assert.equal(clickLocked(-50), false);
});

test("an unseen pause is notified once, a visible one never", () => {
  assert.equal(shouldNotifyPause({ documentHidden: true }), true);
  assert.equal(shouldNotifyPause({ onScreen: false }), true);
  assert.equal(shouldNotifyPause({ workflowFronted: false }), true);
  assert.equal(shouldNotifyPause({}), false);
  assert.equal(shouldNotifyPause(), false);
  assert.equal(
    shouldNotifyPause({ documentHidden: true, onScreen: false, alreadyNotified: true }),
    false,
  );
});

test("panel rects decide visibility, and unreadable ones assume visible", () => {
  const viewport = { width: 1280, height: 800 };
  assert.equal(rectOnScreen({ left: 40, top: 60, width: 320, height: 300 }, viewport), true);
  // Hidden DOM widgets collapse to a zero rect.
  assert.equal(rectOnScreen({ left: 0, top: 0, width: 0, height: 0 }, viewport), false);
  // Scrolled past every edge of the canvas.
  assert.equal(rectOnScreen({ left: -400, top: 10, width: 320, height: 300 }, viewport), false);
  assert.equal(rectOnScreen({ left: 1400, top: 10, width: 320, height: 300 }, viewport), false);
  assert.equal(rectOnScreen({ left: 10, top: -400, width: 320, height: 300 }, viewport), false);
  assert.equal(rectOnScreen({ left: 10, top: 900, width: 320, height: 300 }, viewport), false);
  // Partly on screen still counts as seen.
  assert.equal(rectOnScreen({ left: -100, top: 700, width: 320, height: 300 }, viewport), true);
  assert.equal(rectOnScreen(null, viewport), true);
  assert.equal(rectOnScreen({ left: 0, top: 0, width: 10, height: 10 }, null), true);
  assert.equal(rectOnScreen({ left: 0, top: 0, width: 10, height: 10 }, { width: NaN }), true);
});

// The answer path from js/frame_chooser/index.js, minus the DOM and the fetch:
// take the latch, post, release, then drop a reply the panel has moved past.
// `submit` hands back a `settle` so a test can land replies late or out of
// order, which is exactly how the double-submit race used to bite.
function pausedPanel({ token = "pause-a", id = "7" } = {}) {
  return {
    active: true,
    activeId: id,
    activeToken: token,
    submitting: false,
    submitSeq: 0,
    summary: "Paused - 0 of 8 selected",
  };
}

function submit(panel) {
  const ticket = beginSubmission(panel);
  if (!ticket) return { accepted: false, settle: null };
  const settle = (reply) => {
    endSubmission(panel, ticket);
    // 409/410 mean the server already resolved this pause: no failure to show.
    if (isStaleAnswerStatus(reply.status) || answerIsStale(ticket, panel)) return "ignored";
    if (reply.ok) {
      panel.active = false; // resolvePanel
      panel.summary = reply.message;
      return "applied";
    }
    panel.summary = `Answer failed: ${reply.error}`;
    return "failed";
  };
  return { accepted: true, settle };
}

test("a burst of answers puts exactly one submission on the wire", () => {
  const panel = pausedPanel();
  const attempts = [submit(panel), submit(panel), submit(panel), submit(panel)];
  assert.equal(attempts.filter((attempt) => attempt.accepted).length, 1);
  assert.equal(attempts[0].accepted, true);
});

test("the latch holds every path until the answer in flight settles", () => {
  const panel = pausedPanel();
  assert.equal(submissionAllowed(panel), true);
  const first = submit(panel);
  assert.equal(first.accepted, true);
  // Keep all, Cancel, Enter, Escape - whichever asks next, the answer is out.
  assert.equal(submissionAllowed(panel), false);
  assert.equal(submit(panel).accepted, false);
  assert.equal(first.settle({ ok: true, message: "Continuing with 3 of 8 frames." }), "applied");
  // The latch is free again, but the pause it answered is over.
  assert.equal(panel.submitting, false);
  assert.equal(submissionAllowed(panel), false);
  assert.equal(submit(panel).accepted, false);
});

test("a failed answer clears the latch so the retry can go out", () => {
  const panel = pausedPanel();
  const first = submit(panel);
  assert.equal(first.settle({ ok: false, error: "NetworkError" }), "failed");
  assert.equal(panel.summary, "Answer failed: NetworkError");
  assert.equal(panel.submitting, false);
  assert.equal(panel.active, true);
  const retry = submit(panel);
  assert.equal(retry.accepted, true);
  assert.equal(retry.settle({ ok: true, message: "Continuing with 8 of 8 frames." }), "applied");
  assert.equal(panel.summary, "Continuing with 8 of 8 frames.");
});

test("a rejection that lands late never paints over the answer that worked", () => {
  const panel = pausedPanel();
  const first = submit(panel);
  // The done event (another tab, or a countdown that expired) resolves the
  // pause while this request is still out; its 409 must not be believed.
  panel.active = false;
  panel.summary = "Continuing with 3 of 8 frames.";
  assert.equal(first.settle({ ok: false, error: "HTTP 409" }), "ignored");
  assert.equal(panel.summary, "Continuing with 3 of 8 frames.");
});

test("a stale success cannot re-resolve a pause that already finished", () => {
  const panel = pausedPanel();
  const first = submit(panel);
  panel.active = false;
  panel.summary = "Timed out - continuing with 8 of 8 frames.";
  assert.equal(first.settle({ ok: true, message: "Continuing with 3 of 8 frames." }), "ignored");
  assert.equal(panel.summary, "Timed out - continuing with 8 of 8 frames.");
});

test("a reply for the previous pause cannot answer or unlatch the new one", () => {
  const panel = pausedPanel({ token: "pause-a" });
  const first = submit(panel);
  // A second pause lands on this node while the first answer is in flight.
  panel.activeToken = "pause-b";
  panel.summary = "Paused - 0 of 5 selected";
  clearSubmission(panel);
  const second = submit(panel);
  assert.equal(second.accepted, true);
  assert.equal(first.settle({ ok: true, message: "Continuing with 3 of 8 frames." }), "ignored");
  assert.equal(panel.active, true);
  assert.equal(panel.summary, "Paused - 0 of 5 selected");
  assert.equal(panel.submitting, true); // the older reply left this latch alone
  assert.equal(second.settle({ ok: true, message: "Continuing with 2 of 5 frames." }), "applied");
  assert.equal(panel.summary, "Continuing with 2 of 5 frames.");
});

test("staleness weighs the pause a reply was posted for against the live panel", () => {
  const ticket = { seq: 1, id: "7", token: "pause-a" };
  const live = { active: true, activeId: "7", activeToken: "pause-a" };
  assert.equal(answerIsStale(ticket, live), false);
  assert.equal(answerIsStale(ticket, { ...live, active: false }), true);
  assert.equal(answerIsStale(ticket, { ...live, activeToken: "pause-b" }), true);
  // A duplicate or subgraph re-key moves the panel to another node id.
  assert.equal(answerIsStale(ticket, { ...live, activeId: "9" }), true);
  assert.equal(answerIsStale(null, live), true);
  assert.equal(answerIsStale(ticket, null), true);
});

test("an idle panel has nothing to answer", () => {
  assert.equal(submissionAllowed({ active: false, submitting: false }), false);
  assert.equal(submissionAllowed(null), false);
  assert.equal(beginSubmission({ active: false }), null);
  // A reply can only release the submission still holding the latch.
  const panel = pausedPanel();
  const ticket = beginSubmission(panel);
  assert.equal(endSubmission(panel, { ...ticket, seq: ticket.seq + 1 }), false);
  assert.equal(panel.submitting, true);
  assert.equal(endSubmission(panel, ticket), true);
  assert.equal(panel.submitting, false);
});

test("only the two already-resolved statuses are treated as spent", () => {
  assert.equal(isStaleAnswerStatus(409), true);
  assert.equal(isStaleAnswerStatus(410), true);
  // Everything the user can actually act on stays a visible failure.
  for (const status of [200, 400, 404, 500, 0, undefined, null, "410"]) {
    assert.equal(isStaleAnswerStatus(status), false);
  }
});

test("losing the race to resolve a pause is not an answer failure", () => {
  // The backend hands the loser a 410, and it can beat the done event that
  // carries the outcome that won. Painting "Answer failed" over a run that is
  // continuing perfectly well is the bug this guards.
  const panel = pausedPanel();
  const attempt = submit(panel);
  assert.equal(
    attempt.settle({ ok: false, status: 410, error: "already resolved" }),
    "ignored",
  );
  assert.equal(panel.summary, "Paused - 0 of 8 selected");
  // A 409 for an answer aimed at an older pause is just as quiet.
  const stale = submit(panel);
  assert.equal(stale.settle({ ok: false, status: 409, error: "older pause" }), "ignored");
  assert.equal(panel.summary, "Paused - 0 of 8 selected");
  // The latch is free either way, so the panel is still answerable.
  assert.equal(submissionAllowed(panel), true);
  const retry = submit(panel);
  assert.equal(retry.accepted, true);
  assert.equal(retry.settle({ ok: true, message: "Continuing with 8 of 8 frames." }), "applied");
});

test("a real failure is still shown while a stale one is not", () => {
  const panel = pausedPanel();
  assert.equal(
    submit(panel).settle({ ok: false, status: 500, error: "Internal Server Error" }),
    "failed",
  );
  assert.equal(panel.summary, "Answer failed: Internal Server Error");
});

test("the pause notice names the node and the batch", () => {
  assert.equal(
    pauseNoticeText("Pick keyframes", 24),
    "Pick keyframes paused the run - pick from 24 frames to continue.",
  );
  assert.equal(
    pauseNoticeText("  ", 0),
    "Frame Chooser paused the run - pick from the incoming frames to continue.",
  );
  assert.equal(
    pauseNoticeText(undefined, 3),
    "Frame Chooser paused the run - pick from 3 frames to continue.",
  );
});

// The two guards that decide whether a pause is answered or written back.
// Both live in js/frame_chooser/index.js, which imports /scripts/app.js and
// so cannot be loaded here; these mirror the exact conditions it applies.
const ALWAYS_PAUSE = "always pause";
const KEEP_LAST = "keep last selection";

function writeback(node, indices, behaviorValue) {
  const widgets = node.widgets || [];
  const behavior = widgets.find((entry) => entry.name === "behavior");
  if (typeof indices !== "string") return false;
  if (String(behavior?.value ?? ALWAYS_PAUSE) === ALWAYS_PAUSE) return false;
  const widget = widgets.find((entry) => entry.name === "pick_list");
  if (!widget || widget.value === indices) return false;
  widget.value = indices;
  return true;
}

function chooserNode(behaviorValue) {
  return {
    widgets: [
      { name: "behavior", value: behaviorValue },
      { name: "pick_list", value: "" },
    ],
  };
}

test("always pause never gets a pick_list written under it", () => {
  // The trap: the writeback pre-answers the node, so a node left at its
  // default paused exactly once and then ran headlessly forever after.
  const node = chooserNode(ALWAYS_PAUSE);
  assert.equal(writeback(node, "2,3"), false);
  assert.equal(node.widgets[1].value, "");
  // Still true for keep-all, which arrives as the empty answer.
  assert.equal(writeback(node, ""), false);
  assert.equal(node.widgets[1].value, "");
});

test("keep last selection records the answer for a headless rerun", () => {
  const node = chooserNode(KEEP_LAST);
  assert.equal(writeback(node, "2,3"), true);
  assert.equal(node.widgets[1].value, "2,3");
  // Idempotent: the same answer twice is not a second graph mutation.
  assert.equal(writeback(node, "2,3"), false);
});

test("a missing or unreadable behavior widget defaults to not writing back", () => {
  const bare = { widgets: [{ name: "pick_list", value: "" }] };
  assert.equal(writeback(bare, "2,3"), false);
  assert.equal(writeback({ widgets: [] }, "2,3"), false);
  assert.equal(writeback(chooserNode(KEEP_LAST), 7), false);
});

// onRemoved fires for every node when LiteGraph clears the graph - undo, a
// workflow tab switch, Clear Workflow, opening another file - so the cancel
// it posts must be gated on a real deletion.
function teardownCancels(state, tearingDown) {
  return Boolean(state?.active) && !tearingDown;
}

test("only a real deletion cancels a paused run", () => {
  const paused = { active: true };
  assert.equal(teardownCancels(paused, false), true);
  // Same node, same pause, but the graph is being replaced under it.
  assert.equal(teardownCancels(paused, true), false);
  assert.equal(teardownCancels({ active: false }, false), false);
  assert.equal(teardownCancels(null, false), false);
});
