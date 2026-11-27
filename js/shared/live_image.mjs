// Small picture maths for the live preview on Film Grain, Keep Detail and
// Cut Out (js/shared/live_stage.mjs). No DOM, no imports, so node:test runs
// it. These are the pieces the Python nodes get from torch: box and Gaussian
// blurs with repeated edges, area, bilinear and bicubic resizes, a sliding
// maximum. Each follows torch's own definition (edges repeated, the
// align_corners=False pixel centres, adaptive pooling for "area") so the
// browser's drawing of a node's result agrees with the node's.
//
// A picture is { w, h, c, data }: data is a Float32Array of c values per
// pixel, row by row, in 0-1 picture values.

export function makeImage(w, h, c, data = new Float32Array(w * h * c)) {
  return { w, h, c, data };
}

// Python's round(): halves go to the even number, so a grid of
// round(height / size) rows is the same in both languages.
export function pyRound(value) {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

const clampIndex = (index, length) => (index < 0 ? 0 : index >= length ? length - 1 : index);

// The mean over a (2r+1)-square window, edges repeated: torch's
// avg_pool2d of a replicate-padded picture.
export function boxBlur(image, radius) {
  const r = Math.max(0, Math.floor(radius));
  if (r === 0) return image;
  const { w, h, c } = image;
  const win = 2 * r + 1;
  const across = new Float32Array(image.data.length);
  for (let y = 0; y < h; y += 1) {
    for (let ch = 0; ch < c; ch += 1) {
      const base = y * w * c + ch;
      let sum = 0;
      for (let k = -r; k <= r; k += 1) sum += image.data[base + clampIndex(k, w) * c];
      for (let x = 0; x < w; x += 1) {
        across[base + x * c] = sum / win;
        sum += image.data[base + clampIndex(x + r + 1, w) * c] - image.data[base + clampIndex(x - r, w) * c];
      }
    }
  }
  const out = new Float32Array(image.data.length);
  const row = w * c;
  for (let x = 0; x < w; x += 1) {
    for (let ch = 0; ch < c; ch += 1) {
      const base = x * c + ch;
      let sum = 0;
      for (let k = -r; k <= r; k += 1) sum += across[base + clampIndex(k, h) * row];
      for (let y = 0; y < h; y += 1) {
        out[base + y * row] = sum / win;
        sum += across[base + clampIndex(y + r + 1, h) * row] - across[base + clampIndex(y - r, h) * row];
      }
    }
  }
  return makeImage(w, h, c, out);
}

// A Gaussian of the given taps, edges repeated.
function convolve(image, kernel, radius) {
  const { w, h, c } = image;
  const across = new Float32Array(image.data.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let ch = 0; ch < c; ch += 1) {
        let sum = 0;
        for (let k = -radius; k <= radius; k += 1) sum += kernel[k + radius] * image.data[(y * w + clampIndex(x + k, w)) * c + ch];
        across[(y * w + x) * c + ch] = sum;
      }
    }
  }
  const out = new Float32Array(image.data.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let ch = 0; ch < c; ch += 1) {
        let sum = 0;
        for (let k = -radius; k <= radius; k += 1) sum += kernel[k + radius] * across[(clampIndex(y + k, h) * w + x) * c + ch];
        out[(y * w + x) * c + ch] = sum;
      }
    }
  }
  return makeImage(w, h, c, out);
}

export function gaussianKernel(sigma, radius) {
  const kernel = new Float64Array(2 * radius + 1);
  let total = 0;
  for (let k = -radius; k <= radius; k += 1) {
    kernel[k + radius] = Math.exp(-(k * k) / (2 * sigma * sigma));
    total += kernel[k + radius];
  }
  for (let k = 0; k < kernel.length; k += 1) kernel[k] /= total;
  return kernel;
}

// Gaussian blur. A wide one (sigma over WIDE_SIGMA) is worked out on a
// smaller copy, which is smooth anyway, the same shortcut the nodes take for
// their wide blurs; a narrow one is exact. `radius` defaults to torch's
// choice in Keep Detail (3 sigma, at most the picture's short side less one).
const WIDE_SIGMA = 12;
export function gaussianBlur(image, sigma, radius = null) {
  if (!(sigma > 0)) return image;
  if (sigma > WIDE_SIGMA) {
    const shrink = Math.floor(sigma / 6);
    const small = areaResize(image, Math.max(1, Math.floor(image.h / shrink)), Math.max(1, Math.floor(image.w / shrink)));
    return bilinearResize(gaussianBlur(small, sigma / shrink, radius === null ? null : Math.ceil(radius / shrink)), image.h, image.w);
  }
  const taps = radius ?? Math.max(1, Math.min(Math.ceil(3 * sigma), Math.max(1, Math.min(image.w, image.h) - 1)));
  return convolve(image, gaussianKernel(sigma, taps), taps);
}

// torch's adaptive average pooling (F.interpolate mode="area"): each output
// cell averages the input cells from floor(i * in / out) up to
// ceil((i + 1) * in / out).
export function areaTaps(inLength, outLength) {
  const taps = [];
  for (let i = 0; i < outLength; i += 1) {
    const start = Math.floor((i * inLength) / outLength);
    const end = Math.ceil(((i + 1) * inLength) / outLength);
    taps.push([start, Math.max(end, start + 1)]);
  }
  return taps;
}

export function areaResize(image, outH, outW) {
  if (outH === image.h && outW === image.w) return image;
  const { w, h, c } = image;
  const xs = areaTaps(w, outW);
  const ys = areaTaps(h, outH);
  const across = new Float32Array(h * outW * c);
  for (let y = 0; y < h; y += 1) {
    for (let ox = 0; ox < outW; ox += 1) {
      const [a, b] = xs[ox];
      for (let ch = 0; ch < c; ch += 1) {
        let sum = 0;
        for (let x = a; x < b; x += 1) sum += image.data[(y * w + x) * c + ch];
        across[(y * outW + ox) * c + ch] = sum / (b - a);
      }
    }
  }
  const out = new Float32Array(outH * outW * c);
  for (let oy = 0; oy < outH; oy += 1) {
    const [a, b] = ys[oy];
    for (let x = 0; x < outW; x += 1) {
      for (let ch = 0; ch < c; ch += 1) {
        let sum = 0;
        for (let y = a; y < b; y += 1) sum += across[(y * outW + x) * c + ch];
        out[(oy * outW + x) * c + ch] = sum / (b - a);
      }
    }
  }
  return makeImage(outW, outH, c, out);
}

// Bilinear with torch's align_corners=False pixel centres.
export function bilinearResize(image, outH, outW) {
  if (outH === image.h && outW === image.w) return image;
  const { w, h, c } = image;
  const axis = (inLength, outLength) => {
    const scale = inLength / outLength;
    return Array.from({ length: outLength }, (_, o) => {
      const src = Math.max(0, (o + 0.5) * scale - 0.5);
      const i0 = Math.min(Math.floor(src), inLength - 1);
      return [i0, Math.min(i0 + 1, inLength - 1), src - i0];
    });
  };
  const xs = axis(w, outW);
  const ys = axis(h, outH);
  const out = new Float32Array(outH * outW * c);
  for (let oy = 0; oy < outH; oy += 1) {
    const [y0, y1, fy] = ys[oy];
    for (let ox = 0; ox < outW; ox += 1) {
      const [x0, x1, fx] = xs[ox];
      for (let ch = 0; ch < c; ch += 1) {
        const top = image.data[(y0 * w + x0) * c + ch] * (1 - fx) + image.data[(y0 * w + x1) * c + ch] * fx;
        const bottom = image.data[(y1 * w + x0) * c + ch] * (1 - fx) + image.data[(y1 * w + x1) * c + ch] * fx;
        out[(oy * outW + ox) * c + ch] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return makeImage(outW, outH, c, out);
}

// Cubic convolution weights for torch's bicubic (A = -0.75) at offsets
// -1, 0, 1, 2 around a source position with fraction t.
const CUBIC_A = -0.75;
export function cubicWeights(t) {
  const near = (x) => ((CUBIC_A + 2) * x - (CUBIC_A + 3)) * x * x + 1;
  const far = (x) => ((CUBIC_A * x - 5 * CUBIC_A) * x + 8 * CUBIC_A) * x - 4 * CUBIC_A;
  return [far(t + 1), near(t), near(1 - t), far(2 - t)];
}

// A grid of values (rows x cols) sampled for the pixels of a window, for
// pictures that are `outH` x `outW`: the window starts at (x0, y0) and is
// cw x ch big. Returns the taps each window column and row reads.
export function bicubicTaps(inLength, outLength, start, count) {
  const scale = inLength / outLength;
  const taps = [];
  for (let o = start; o < start + count; o += 1) {
    const src = (o + 0.5) * scale - 0.5;
    const i0 = Math.floor(src);
    const weights = cubicWeights(src - i0);
    taps.push({ at: [-1, 0, 1, 2].map((k) => clampIndex(i0 + k, inLength)), weights });
  }
  return taps;
}

export function crop(image, x0, y0, cw, ch) {
  const out = new Float32Array(cw * ch * image.c);
  for (let y = 0; y < ch; y += 1) {
    const sy = clampIndex(y0 + y, image.h);
    for (let x = 0; x < cw; x += 1) {
      const sx = clampIndex(x0 + x, image.w);
      for (let k = 0; k < image.c; k += 1) out[(y * cw + x) * image.c + k] = image.data[(sy * image.w + sx) * image.c + k];
    }
  }
  return makeImage(cw, ch, image.c, out);
}

// Max over the 2 * steps + 1 pixels centred on each pixel along one axis
// (pixels off the picture count as nothing), with a monotonic queue: the
// work is the same however far it reaches.
export function slidingMax(plane, w, h, steps, alongX) {
  const length = alongX ? w : h;
  const lines = alongX ? h : w;
  const out = new Float32Array(plane.length);
  const queue = new Int32Array(length);
  for (let line = 0; line < lines; line += 1) {
    const at = (i) => (alongX ? line * w + i : i * w + line);
    let head = 0;
    let tail = 0;
    let next = 0;
    for (let i = 0; i < length; i += 1) {
      const reach = Math.min(length - 1, i + steps);
      while (next <= reach) {
        const value = plane[at(next)];
        while (tail > head && plane[at(queue[tail - 1])] <= value) tail -= 1;
        queue[tail] = next;
        tail += 1;
        next += 1;
      }
      while (queue[head] < i - steps) head += 1;
      out[at(i)] = plane[at(queue[head])];
    }
  }
  return out;
}

export function planeStd(values) {
  const n = values.length;
  if (n < 2) return 0;
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += values[i];
  mean /= n;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += (values[i] - mean) ** 2;
  return Math.sqrt(sum / (n - 1));
}
