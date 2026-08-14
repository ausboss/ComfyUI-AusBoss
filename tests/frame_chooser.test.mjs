import assert from "node:assert/strict";
import test from "node:test";

import {
  CLICK_COOLDOWN_MS,
  allFrames,
  cancelPayload,
  chooserKeyAction,
  clickLocked,
  continuePayload,
  countdownText,
  isTypingTarget,
  noFrames,
  pauseNoticeText,
  rectOnScreen,
  selectionSummary,
  shouldNotifyPause,
  sortedFrames,
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
