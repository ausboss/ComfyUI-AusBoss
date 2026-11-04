// Load Audio's window rules for the face, mirroring audio_window in
// nodes/_audio_trim_helpers.py so the wave shows exactly what one Run hands
// on. Pure: tests/load_audio_window.test.mjs runs it without a browser.
import { inputNumber } from "../shared/clip_rate.mjs";
import { dragTrimHandle } from "../load_video/trim_preview.mjs";

// Calculated outputs stay unknown until execution, even if the source has numbers.
export function wiredMax(node) {
  const input = node.inputs?.find((slot) => slot.name === "max_seconds" || slot.widget?.name === "max_seconds");
  if (input?.link == null) return { wired: false, value: null };
  return { wired: true, value: inputNumber(node, "max_seconds", null) };
}

export function typedTrimBounds(duration, bounds, edge, seconds) {
  // OUT 0 is the saved widget's "to the end", before handle clamping.
  if (edge === "end" && seconds === 0) return { start: bounds.start, end: duration };
  return dragTrimHandle(duration, bounds, edge, seconds / duration);
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// The pick, and what comes out of it. `end` 0 means "to the end of the
// file". A max above 0 keeps the start and cuts off anything past
// start + max. All times in seconds; duration is the file's length.
export function outputWindow(durationValue, startValue, endValue, maxValue = 0) {
  const duration = Math.max(0, finite(durationValue));
  const start = Math.min(Math.max(0, finite(startValue)), duration);
  const pickedEnd = finite(endValue) > 0 ? Math.min(finite(endValue), duration) : duration;
  const end = Math.max(start, pickedEnd);
  const max = Math.max(0, finite(maxValue));
  const keepEnd = max > 0 && end - start > max ? Math.min(duration, start + max) : end;
  return { start, end, keepEnd, length: keepEnd - start, cut: Math.max(0, end - keepEnd) };
}

// "0:12.0" style, the way the IN and OUT fields write a time.
export function secondsLabel(value) {
  const seconds = Math.max(0, finite(value));
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(1).padStart(4, "0")}`;
}

// The line between IN and OUT: what comes out, and what the max cuts off.
export function outputSummary(window, { maxFromLink = false } = {}) {
  if (!window || window.length <= 0) return "";
  const parts = [secondsLabel(window.length)];
  if (window.cut > 0.005) parts.push(`cut ${secondsLabel(window.cut)}`);
  if (maxFromLink) parts.push("max wired");
  return parts.join(" · ");
}

// Loud and quiet across the file: for each of `buckets` slices, the lowest
// and highest sample of the channels mixed down. Channel data is a list of
// Float32Arrays (AudioBuffer.getChannelData). Returns a Float32Array of
// [min0, max0, min1, max1, ...].
export function wavePeaks(channels, bucketsValue = 1200) {
  const list = Array.isArray(channels) ? channels.filter(Boolean) : [];
  const buckets = Math.max(1, Math.floor(finite(bucketsValue, 1200)));
  const peaks = new Float32Array(buckets * 2);
  const length = list.length ? list[0].length : 0;
  if (!length) return peaks;
  const count = list.length;
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const from = Math.floor((bucket * length) / buckets);
    const to = Math.max(from + 1, Math.floor(((bucket + 1) * length) / buckets));
    let low = 0;
    let high = 0;
    for (let index = from; index < to && index < length; index += 1) {
      let sample = 0;
      for (let channel = 0; channel < count; channel += 1) sample += list[channel][index] || 0;
      sample /= count;
      if (sample < low) low = sample;
      if (sample > high) high = sample;
    }
    peaks[bucket * 2] = low;
    peaks[bucket * 2 + 1] = high;
  }
  return peaks;
}

// Which part of the wave a press at `fraction` (0..1 across it) grabs: a
// handle within `hitPixels` of it, the inside of the pick to slide it, or
// "jump" to move the pick there.
export function grabZone(window, durationValue, fraction, widthValue, hitPixels = 10) {
  const duration = Math.max(0, finite(durationValue));
  const width = Math.max(0, finite(widthValue));
  if (duration <= 0 || width <= 0) return "none";
  const x = Math.min(1, Math.max(0, finite(fraction))) * width;
  const startX = (window.start / duration) * width;
  const endX = (window.end / duration) * width;
  const toStart = Math.abs(x - startX);
  const toEnd = Math.abs(x - endX);
  if (Math.min(toStart, toEnd) <= hitPixels) return toStart <= toEnd ? "start" : "end";
  if (x > startX && x < endX) return "move";
  return "jump";
}
