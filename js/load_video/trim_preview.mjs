import { clamp, finiteNumber } from "../shared/video_preview.mjs";

export { responsivePreviewHeight } from "../shared/video_preview.mjs";

export const MIN_TRIM_SECONDS = 0.1;

export function trimBounds(durationValue, startValue, endValue) {
  const rawDuration = finiteNumber(durationValue, 0);
  const duration = rawDuration > 0 ? rawDuration : Number.POSITIVE_INFINITY;
  let start = Math.max(0, finiteNumber(startValue, 0));
  if (Number.isFinite(duration)) start = Math.min(start, duration);

  const requestedEnd = finiteNumber(endValue, 0);
  let end = requestedEnd > 0 ? requestedEnd : duration;
  if (Number.isFinite(duration)) end = Math.min(end, duration);
  end = Math.max(start, end);
  return { start, end };
}

export function trimFractions(durationValue, bounds) {
  const duration = Math.max(0, finiteNumber(durationValue, 0));
  if (duration <= 0) return { start: 0, end: 1 };
  return {
    start: clamp(finiteNumber(bounds?.start, 0) / duration, 0, 1),
    end: clamp(finiteNumber(bounds?.end, duration) / duration, 0, 1),
  };
}

export function closestTrimHandle(
  startFraction,
  endFraction,
  pointerFraction,
  trackWidthValue,
  hitPixels = 10,
) {
  const trackWidth = Math.max(0, finiteNumber(trackWidthValue, 0));
  if (trackWidth <= 0) return null;
  const pointer = clamp(finiteNumber(pointerFraction, 0), 0, 1) * trackWidth;
  const startDistance = Math.abs(pointer - clamp(finiteNumber(startFraction, 0), 0, 1) * trackWidth);
  const endDistance = Math.abs(pointer - clamp(finiteNumber(endFraction, 1), 0, 1) * trackWidth);
  if (Math.min(startDistance, endDistance) > Math.max(0, finiteNumber(hitPixels, 0))) return null;
  return startDistance <= endDistance ? "start" : "end";
}

export function dragTrimHandle(
  durationValue,
  bounds,
  handle,
  fractionValue,
  minimumWindow = MIN_TRIM_SECONDS,
) {
  const duration = Math.max(0, finiteNumber(durationValue, 0));
  if (duration <= 0) return { start: 0, end: 0 };
  const minimum = Math.min(duration, Math.max(0, finiteNumber(minimumWindow, 0)));
  const point = clamp(finiteNumber(fractionValue, 0), 0, 1) * duration;
  let start = clamp(finiteNumber(bounds?.start, 0), 0, duration);
  let end = clamp(finiteNumber(bounds?.end, duration), start, duration);
  if (handle === "start") start = Math.min(point, Math.max(0, end - minimum));
  else if (handle === "end") end = Math.max(point, Math.min(duration, start + minimum));
  return { start, end };
}

export function slideTrimWindow(durationValue, bounds, deltaValue) {
  const duration = Math.max(0, finiteNumber(durationValue, 0));
  const start = clamp(finiteNumber(bounds?.start, 0), 0, duration);
  const end = clamp(finiteNumber(bounds?.end, duration), start, duration);
  const length = end - start;
  const nextStart = clamp(start + finiteNumber(deltaValue, 0), 0, Math.max(0, duration - length));
  return { start: nextStart, end: nextStart + length };
}

export function clampTrimSeek(timeValue, bounds, epsilon = 0.04) {
  const time = finiteNumber(timeValue, bounds.start);
  if (time < bounds.start) return bounds.start;
  if (Number.isFinite(bounds.end) && time >= bounds.end) {
    return Math.max(bounds.start, bounds.end - epsilon);
  }
  return time;
}

export function playbackBoundaryAction(timeValue, bounds, loopEnabled, epsilon = 0.04) {
  if (!Number.isFinite(bounds?.end) || bounds.end <= bounds.start) return "none";
  if (finiteNumber(timeValue, bounds.start) < bounds.end - epsilon) return "none";
  return loopEnabled ? "loop" : "stop";
}

export function shouldLoopTrim(timeValue, bounds, epsilon = 0.04) {
  return playbackBoundaryAction(timeValue, bounds, true, epsilon) === "loop";
}
