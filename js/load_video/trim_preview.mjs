const DEFAULT_PREVIEW_WIDTH = 256;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

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

export function clampTrimSeek(timeValue, bounds, epsilon = 0.04) {
  const time = finiteNumber(timeValue, bounds.start);
  if (time < bounds.start) return bounds.start;
  if (Number.isFinite(bounds.end) && time >= bounds.end) {
    return Math.max(bounds.start, bounds.end - epsilon);
  }
  return time;
}

export function shouldLoopTrim(timeValue, bounds, epsilon = 0.04) {
  if (!Number.isFinite(bounds.end) || bounds.end <= bounds.start) return false;
  return finiteNumber(timeValue, bounds.start) >= bounds.end - epsilon;
}

export function responsivePreviewHeight(widthValue, minimum = 96, maximum = 220) {
  const width = Math.max(0, finiteNumber(widthValue, DEFAULT_PREVIEW_WIDTH));
  const scaled = Math.round(Math.max(0, width - 12) * 9 / 16);
  return Math.max(minimum, Math.min(maximum, scaled));
}
