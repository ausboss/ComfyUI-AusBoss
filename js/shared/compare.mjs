// Pure decision logic for the A/B Compare panel. No DOM in here — the
// wiring lives in js/compare/index.js so this module stays testable
// under node:test.

export const COMPARE_MODES = ["slide", "hold"];

export function normalizeCompareMode(value) {
  return COMPARE_MODES.includes(value) ? value : COMPARE_MODES[0];
}

export function nextCompareMode(value) {
  const index = COMPARE_MODES.indexOf(normalizeCompareMode(value));
  return COMPARE_MODES[(index + 1) % COMPARE_MODES.length];
}

// Fraction of the panel width covered by the pointer, clamped to 0..1.
// Degenerate rectangles and non-finite input resolve to 0 (all-A).
export function clipFraction(pointerX, rectLeft, rectWidth) {
  const width = Number(rectWidth);
  if (!Number.isFinite(width) || width <= 0) return 0;
  const fraction = (Number(pointerX) - Number(rectLeft)) / width;
  if (!Number.isFinite(fraction)) return 0;
  return Math.max(0, Math.min(1, fraction));
}

// CSS for a given reveal fraction: image B keeps its left portion up to the
// seam, the rest is clipped away. The seam only shows while both images are
// partially visible.
export function compareClip(fraction) {
  const value = Number(fraction);
  const clamped = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return {
    clipPath: `inset(0 ${((1 - clamped) * 100).toFixed(2)}% 0 0)`,
    seamLeft: `${(clamped * 100).toFixed(2)}%`,
    seamVisible: clamped > 0 && clamped < 1,
  };
}

// Pull the two preview references out of an onExecuted payload. Both must
// be present for the panel to have anything meaningful to show.
export function findCompareImages(message) {
  const a = message?.a_images?.[0] ?? null;
  const b = message?.b_images?.[0] ?? null;
  return a?.filename && b?.filename ? { a, b } : null;
}
