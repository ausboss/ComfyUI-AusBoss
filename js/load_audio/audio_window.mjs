// Load Audio's window rules for the face, mirroring audio_window in
// nodes/_audio_trim_helpers.py so the wave shows exactly what one Run hands
// on. Pure: tests/load_audio_window.test.mjs runs it without a browser.

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

const hundredth = (value) => Math.round(value * 100) / 100;

// What the face stores for a pick from `start` to `end`: a Start and a
// Duration (max_seconds, with end_seconds at 0, "to the end"). A pick that
// reaches the end of the file needs no Duration. When another node sets the
// Duration or the end, the pick is stored as a start and an end instead.
// A key left out is not written.
export function pickWrites(durationValue, startValue, endValue, { maxLinked = false, endLinked = false } = {}) {
  const duration = Math.max(0, finite(durationValue));
  const start = hundredth(Math.min(Math.max(0, finite(startValue)), duration));
  const end = hundredth(Math.max(start, Math.min(finite(endValue), duration)));
  const toEnd = end >= duration - 0.005;
  if (endLinked) return { start };
  if (maxLinked) return { start, end: toEnd ? 0 : end };
  return { start, end: 0, max: toEnd ? 0 : Math.max(0.01, hundredth(end - start)) };
}

// A value typed into Start, Duration or Ends at, as the pick it makes.
// Start keeps the Duration; Duration and Ends at keep the start. An empty
// or 0 Duration, and an empty Ends at, run to the end of the file.
export function typedPick(key, value, window, durationValue, minimum = 0.1) {
  const duration = Math.max(0, finite(durationValue));
  const clampTime = (time) => Math.min(duration, Math.max(0, finite(time)));
  if (key === "start") {
    const start = clampTime(value);
    return { start, end: Math.min(duration, start + window.length) };
  }
  if (value == null || (key === "duration" && !(finite(value) > 0))) return { start: window.start, end: duration };
  const end = key === "duration" ? window.start + Math.max(minimum, finite(value)) : Math.max(window.start + minimum, finite(value));
  return { start: window.start, end: clampTime(end) };
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
