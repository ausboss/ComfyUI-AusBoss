// The stitch mask math, mirrored from the backend so the editor's Show
// blend overlay is the paste mask the stitcher will actually use - not a
// sketch of it. Pure Float32Array functions on a row-major mask (1 =
// generated), testable under node:test against a fixture the Python
// helpers produced (tests/fixtures/stitch_blend_parity.json).
//
// Mirrors nodes/_mask_helpers.py grow_shrink_mask (square max filter,
// separable, -inf padding) and blur_mask (gaussian, radius ceil(3 sigma),
// replicate padding), and nodes/_inpaint_crop_helpers.py
// stitch_blend_from_mask (signed grow, then grow by blend and blur by
// blend / 3).

// Sliding window max/min over one line, window 2r+1, missing samples ignored
// (that is the -inf padding of a max pool). Monotonic deque: O(n) per line.
function slidingExtreme(line, out, r, useMax) {
  const n = line.length;
  const deque = new Int32Array(n);
  let head = 0, tail = 0;
  const better = useMax ? (a, b) => a >= b : (a, b) => a <= b;
  for (let i = 0; i < n + r; i++) {
    if (i < n) {
      while (tail > head && better(line[i], line[deque[tail - 1]])) tail--;
      deque[tail++] = i;
    }
    const center = i - r;
    if (center >= 0) {
      while (deque[head] < center - r) head++;
      out[center] = line[deque[head]];
    }
  }
}

export function growShrinkMask(values, width, height, pixels) {
  const steps = Math.abs(Math.round(pixels));
  if (!steps) return Float32Array.from(values);
  const useMax = pixels > 0;
  const pass = new Float32Array(values.length);
  const row = new Float32Array(width), rowOut = new Float32Array(width);
  for (let y = 0; y < height; y++) {
    row.set(values.subarray(y * width, (y + 1) * width));
    slidingExtreme(row, rowOut, steps, useMax);
    pass.set(rowOut, y * width);
  }
  const out = new Float32Array(values.length);
  const col = new Float32Array(height), colOut = new Float32Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) col[y] = pass[y * width + x];
    slidingExtreme(col, colOut, steps, useMax);
    for (let y = 0; y < height; y++) out[y * width + x] = colOut[y];
  }
  return out;
}

export function gaussianKernel(sigma) {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); kernel[i + radius] = v; sum += v; }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  return { kernel, radius };
}

export function blurMask(values, width, height, sigma) {
  if (!(sigma > 0)) return Float32Array.from(values);
  const { kernel, radius } = gaussianKernel(sigma);
  const pass = new Float32Array(values.length);
  for (let y = 0; y < height; y++) {
    const base = y * width;
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = Math.min(width - 1, Math.max(0, x + k)); // replicate padding
        acc += values[base + sx] * kernel[k + radius];
      }
      pass[base + x] = acc;
    }
  }
  const out = new Float32Array(values.length);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = Math.min(height - 1, Math.max(0, y + k));
        acc += pass[sy * width + x] * kernel[k + radius];
      }
      out[y * width + x] = acc;
    }
  }
  return out;
}

function clamp01(values) {
  for (let i = 0; i < values.length; i++) values[i] = values[i] < 0 ? 0 : values[i] > 1 ? 1 : values[i];
  return values;
}

// stitch_blend_from_mask: signed grow first, then the blend ramp - grown
// by `blend` and blurred with sigma blend / 3 - clamped to 0..1.
export function stitchBlendFromMask(values, width, height, blendPixels, growPixels = 0) {
  const grow = Math.round(growPixels) || 0;
  const ramp = Math.max(0, Math.round(blendPixels) || 0);
  let out = values;
  if (grow) out = growShrinkMask(out, width, height, grow);
  if (ramp > 0) { out = growShrinkMask(out, width, height, ramp); out = blurMask(out, width, height, ramp / 3); }
  return (grow || ramp) ? clamp01(out) : Float32Array.from(values);
}

// The transform's own mask feather (transform_pil): the generated-area
// mask blurred, doubled and clipped, then max'd with the original - the
// ramp starts at full strength on the edge and runs into the kept pixels.
export function featherGeneratedMask(values, width, height, featherPixels) {
  if (!(featherPixels > 0)) return Float32Array.from(values);
  const blurred = blurMask(values, width, height, featherPixels);
  const out = new Float32Array(values.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(values[i], Math.min(1, blurred[i] * 2));
  return out;
}

// Work-resolution planning for the overlay. Blend and grow are output
// pixels AFTER any resize; the stage draws the pre-resize canvas. One
// output pixel is `unit` work pixels (the two axes can differ by a step
// rounding; the mean keeps the ramp within a percent of either).
export function overlayPlan(outputWidth, outputHeight, target, maxSide = 384) {
  const k = Math.min(1, maxSide / Math.max(1, outputWidth, outputHeight));
  const width = Math.max(1, Math.round(outputWidth * k));
  const height = Math.max(1, Math.round(outputHeight * k));
  const targetWidth = target?.width || outputWidth;
  const targetHeight = target?.height || outputHeight;
  const unit = k * ((outputWidth / targetWidth) + (outputHeight / targetHeight)) / 2;
  return { k, width, height, unit };
}
