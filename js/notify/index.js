// Completion sound 🆎 — a soft two-note chime when the queue finishes.
//
// Off by default (a sound nobody asked for is a surprise); one boolean
// setting turns it on. The chime is built once as a small WAV in memory
// and played through an ordinary audio element, so the pack ships no sound
// file and nothing is built until the first chime plays.
import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { queueRemaining, shouldChime } from "../shared/notify.mjs";
import { chimeSamples, wavBytes } from "./chime.mjs";

const SETTING_ID = "AusBoss.Notifications.CompletionSound";

let enabled = false;
// Start at 0 so a page opened onto an idle queue never chimes; the first
// queued prompt raises it and the run's final 0 triggers the chime.
let lastRemaining = 0;
let chimeUrl = null;

function playChime() {
  try {
    chimeUrl ??= URL.createObjectURL(new Blob([wavBytes(chimeSamples())], { type: "audio/wav" }));
    // Queuing a prompt was a click, so the page may play sound by the time
    // a run finishes; a refusal is swallowed like any other failure.
    new Audio(chimeUrl).play()?.catch?.(() => {});
  } catch (_error) {
    // No audio device or playback blocked: the chime is advice, not a
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
