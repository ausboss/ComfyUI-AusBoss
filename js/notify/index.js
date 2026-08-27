// Completion sound 🆎 — a soft two-note chime when the queue finishes.
//
// Off by default (a sound nobody asked for is a surprise); one boolean
// setting turns it on. The chime is synthesized with WebAudio, so the pack
// ships no audio asset and nothing loads until the first chime plays.
import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { queueRemaining, shouldChime } from "../shared/notify.mjs";

const SETTING_ID = "AusBoss.Notifications.CompletionSound";

let enabled = false;
// Start at 0 so a page opened onto an idle queue never chimes; the first
// queued prompt raises it and the run's final 0 triggers the chime.
let lastRemaining = 0;
let audioContext = null;

function playChime() {
  try {
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioContext;
    // Browsers suspend fresh contexts until a user gesture; queuing a prompt
    // was one, so resume is allowed by the time a run can finish.
    if (ctx.state === "suspended") ctx.resume?.();
    const now = ctx.currentTime;
    for (const [offset, frequency] of [[0, 660], [0.16, 880]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.08, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.55);
    }
  } catch (_error) {
    // No audio device or a blocked context: the chime is advice, not a
    // feature — never let it break the status stream.
  }
}

app.registerExtension({
  name: "AusBoss.Notify",
  settings: [
    {
      id: SETTING_ID,
      name: "Completion sound",
      type: "boolean",
      defaultValue: false,
      tooltip:
        "Plays a soft two-note chime when the prompt queue empties, so a "
        + "long video render can run in another window without being "
        + "watched. Off keeps ComfyUI silent.",
      category: ["🆎 AusBoss", "Notifications", "Completion sound"],
      onChange(value) {
        enabled = !!value;
      },
    },
  ],
  setup() {
    // onChange only fires on later edits, so seed from the stored value here.
    enabled = !!app.ui?.settings?.getSettingValue?.(SETTING_ID);
    api.addEventListener("status", (event) => {
      const next = queueRemaining(event?.detail);
      if (next === null) return; // disconnects and unknown shapes stay silent
      if (shouldChime(enabled, lastRemaining, next)) playChime();
      lastRemaining = next;
    });
  },
});
