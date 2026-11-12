// Load Image: the size a picture comes out at, worked out in the browser so
// the node can show it before a run. This repeats plan_load_size in
// nodes/_load_image_helpers.py; tests/fixtures/load_size_cases.json holds
// both to the same answers. No DOM in here.

export const SIZE_MODES = Object.freeze(["off", "megapixels", "longest side", "scale", "fit inside", "crop to fill", "crop", "crop to ratio"]);
// Which part of the picture a crop keeps, as a 3 x 3 grid read row by row.
export const CROP_GRID = Object.freeze(["top left", "top", "top right", "left", "center", "right", "bottom left", "bottom", "bottom right"]);
// The choices that cut something off, so the kept part matters.
export const CROP_MODES = Object.freeze(["crop to fill", "crop", "crop to ratio"]);

const roundHalfUp = (value) => Math.floor(value + 0.5);
const whole = (value, fallback) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback);
// Nearest multiple, never below one step.
const nearest = (value, step) => Math.max(step, roundHalfUp(value / step) * step);
// The largest multiple that is not above the value, never below one step.
const below = (value, step) => Math.max(step, Math.floor(value / step) * step);
// Rounded down to a multiple, or left alone when smaller than one step.
const inside = (value, step) => (value >= step ? Math.floor(value / step) * step : value);
// Where a cut starts along one edge with `spare` pixels to lose.
const cropStart = (spare, side, low, high) => (side.includes(low) ? 0 : side.includes(high) ? spare : Math.floor(spare / 2));

function ratioTerms(ratio, width, height) {
  if (ratio === "width : height") return [Math.max(1, width), Math.max(1, height)];
  const [across, down] = String(ratio ?? "1:1").split(":").map((term) => Math.trunc(Number(term)));
  return [Math.max(1, across || 1), Math.max(1, down || 1)];
}

function target(sourceW, sourceH, size, { megapixels, longest_side: longestSide, scale, width, height }) {
  const scaled = (factor) => [Math.max(1, roundHalfUp(sourceW * factor)), Math.max(1, roundHalfUp(sourceH * factor))];
  if (size === "megapixels") {
    const amount = Number(megapixels);
    return amount > 0 ? scaled(Math.sqrt((amount * 1e6) / (sourceW * sourceH))) : [sourceW, sourceH];
  }
  if (size === "longest side") {
    const edge = whole(longestSide, 0);
    if (edge <= 0) return [sourceW, sourceH];
    const [w, h] = scaled(edge / Math.max(sourceW, sourceH));
    return sourceW >= sourceH ? [edge, h] : [w, edge];
  }
  if (size === "scale") {
    const factor = Number(scale);
    return factor > 0 ? scaled(factor) : [sourceW, sourceH];
  }
  const fit = Math.min(Math.max(1, whole(width, 1)) / sourceW, Math.max(1, whole(height, 1)) / sourceH);
  return scaled(fit);
}

// { resizeWidth, resizeHeight, cropX, cropY, width, height } for a picture of
// sourceWidth x sourceHeight and the node's values, or null when the picture
// has no size yet or the choice is not one the node knows.
export function planLoadSize(sourceWidth, sourceHeight, values = {}) {
  const sourceW = whole(sourceWidth, 0);
  const sourceH = whole(sourceHeight, 0);
  const size = values.size ?? "off";
  if (sourceW <= 0 || sourceH <= 0 || !SIZE_MODES.includes(size)) return null;
  const same = { resizeWidth: sourceW, resizeHeight: sourceH, cropX: 0, cropY: 0, width: sourceW, height: sourceH };
  if (size === "off") return same;
  const step = Math.max(1, whole(values.multiple, 1));
  const enlarge = values.enlarge !== false;
  const boxW = Math.max(1, whole(values.width, 1024));
  const boxH = Math.max(1, whole(values.height, 1024));
  const side = CROP_GRID.includes(values.crop_from) ? values.crop_from : "center";
  const cut = (resizeWidth, resizeHeight, width, height) => ({
    resizeWidth, resizeHeight,
    cropX: cropStart(resizeWidth - width, side, "left", "right"),
    cropY: cropStart(resizeHeight - height, side, "top", "bottom"),
    width, height,
  });

  if (size === "crop") {
    return cut(sourceW, sourceH, inside(Math.min(boxW, sourceW), step), inside(Math.min(boxH, sourceH), step));
  }

  if (size === "crop to ratio") {
    const [across, down] = ratioTerms(values.ratio, boxW, boxH);
    let width = sourceW;
    let height = sourceH;
    if (sourceW * down >= sourceH * across) width = Math.min(sourceW, Math.max(1, roundHalfUp((sourceH * across) / down)));
    else height = Math.min(sourceH, Math.max(1, roundHalfUp((sourceW * down) / across)));
    return cut(sourceW, sourceH, inside(width, step), inside(height, step));
  }

  if (size === "crop to fill") {
    let width = boxW;
    let height = boxH;
    if (enlarge) {
      width = nearest(width, step);
      height = nearest(height, step);
    } else {
      const grow = Math.max(width / sourceW, height / sourceH);
      if (grow > 1) {
        width = Math.max(1, Math.floor(width / grow + 1e-6));
        height = Math.max(1, Math.floor(height / grow + 1e-6));
      }
      width = Math.min(below(width, step), Math.max(step, sourceW));
      height = Math.min(below(height, step), Math.max(step, sourceH));
    }
    const cover = Math.max(width / sourceW, height / sourceH);
    const resizeWidth = Math.max(width, Math.ceil(sourceW * cover - 1e-6));
    const resizeHeight = Math.max(height, Math.ceil(sourceH * cover - 1e-6));
    return cut(resizeWidth, resizeHeight, width, height);
  }

  let [targetW, targetH] = target(sourceW, sourceH, size, { ...values, width: boxW, height: boxH });
  if (!enlarge && (targetW > sourceW || targetH > sourceH)) [targetW, targetH] = [sourceW, sourceH];
  const rounded = (wanted, source, box) => {
    let value = nearest(wanted, step);
    if (size === "fit inside" && value > box) value = below(box, step);
    if (!enlarge && value > source) value = below(source, step);
    return value;
  };
  const width = rounded(targetW, sourceW, boxW);
  const height = rounded(targetH, sourceH, boxH);
  return { resizeWidth: width, resizeHeight: height, cropX: 0, cropY: 0, width, height };
}

// "912 × 1632" for a picture that comes out as it went in, "912 × 1632 →
// 1144 × 2048" when its size changes, "" while the picture's size is unknown.
export function sizeText(sourceWidth, sourceHeight, plan) {
  if (!(sourceWidth > 0 && sourceHeight > 0)) return "";
  const from = `${sourceWidth} × ${sourceHeight}`;
  if (!plan || (plan.width === sourceWidth && plan.height === sourceHeight)) return from;
  return `${from} → ${plan.width} × ${plan.height}`;
}

// What a plan does to the picture, in a few words for the node: how much it
// is resized and how much is cut off, in the file's own pixels. "" when the
// picture comes out as it went in.
export function changeText(sourceWidth, sourceHeight, plan) {
  if (!plan || !(sourceWidth > 0 && sourceHeight > 0)) return "";
  const parts = [];
  const percent = Math.round((plan.resizeWidth / sourceWidth) * 100);
  if (plan.resizeWidth !== sourceWidth || plan.resizeHeight !== sourceHeight) parts.push(`${percent}% size`);
  const cutWide = Math.round(((plan.resizeWidth - plan.width) * sourceWidth) / plan.resizeWidth);
  const cutHigh = Math.round(((plan.resizeHeight - plan.height) * sourceHeight) / plan.resizeHeight);
  if (cutWide > 0 && cutHigh > 0) parts.push(`cuts ${cutWide} × ${cutHigh} px`);
  else if (cutWide > 0) parts.push(`cuts ${cutWide} px of width`);
  else if (cutHigh > 0) parts.push(`cuts ${cutHigh} px of height`);
  return parts.join(" · ");
}

const SHAPES = [[1, 1], [5, 4], [4, 3], [3, 2], [16, 10], [16, 9], [2, 1], [21, 9]];

// A picture's shape in words people use: "3:4", "16:9". A size within one
// percent of a common shape gets that name (rounding to a multiple moves a
// 16:9 picture a few pixels off it); any other gets "~1.34:1" or "~1:1.34".
export function shapeText(width, height) {
  if (!(width > 0 && height > 0)) return "";
  const wide = width >= height;
  const value = wide ? width / height : height / width;
  const near = SHAPES.find(([across, down]) => Math.abs(value - across / down) <= (across / down) * 0.01);
  if (near) return wide ? `${near[0]}:${near[1]}` : `${near[1]}:${near[0]}`;
  const rounded = Math.round(value * 100) / 100;
  return wide ? `~${rounded}:1` : `~1:${rounded}`;
}

// The part of the file a plan keeps, as fractions of the file's width and
// height: { x, y, width, height }, all 0 to 1.
export function keptPart(plan) {
  if (!plan) return { x: 0, y: 0, width: 1, height: 1 };
  return {
    x: plan.cropX / plan.resizeWidth,
    y: plan.cropY / plan.resizeHeight,
    width: Math.min(1, plan.width / plan.resizeWidth),
    height: Math.min(1, plan.height / plan.resizeHeight),
  };
}

// The sizes two small pictures are drawn at so their difference shows: both
// on one scale, the larger filling a box of maxWidth x maxHeight, and neither
// edge under `least` pixels.
export function thumbSizes(sourceWidth, sourceHeight, plan, maxWidth, maxHeight, least = 10) {
  const outW = plan?.width ?? sourceWidth;
  const outH = plan?.height ?? sourceHeight;
  const scale = Math.min(maxWidth / Math.max(sourceWidth, outW), maxHeight / Math.max(sourceHeight, outH));
  const at = (value) => Math.max(least, Math.round(value * scale));
  return { input: [at(sourceWidth), at(sourceHeight)], output: [at(outW), at(outH)] };
}

// The crop side under a click at (x, y), each 0 to 1 across the picture.
export function cropSideAt(x, y) {
  const third = (value) => (value < 1 / 3 ? 0 : value < 2 / 3 ? 1 : 2);
  return CROP_GRID[third(y) * 3 + third(x)];
}

// The file one step before or after the current one in the list, going
// round at the ends. A file that is not in the list steps to the first or
// the last. null when the list has nothing to step to.
export function stepFile(files, current, delta) {
  const list = (Array.isArray(files) ? files : []).filter((name) => name !== "" && name != null);
  if (!list.length) return null;
  const at = list.indexOf(current);
  if (at < 0) return delta < 0 ? list[list.length - 1] : list[0];
  if (list.length === 1) return null;
  return list[(at + (delta < 0 ? -1 : 1) + list.length) % list.length];
}

// "14 / 212": where the current file is in the list. "" for an empty list,
// "– / 212" for a file that is not in it.
export function placeText(files, current) {
  const list = (Array.isArray(files) ? files : []).filter((name) => name !== "" && name != null);
  if (!list.length) return "";
  const at = list.indexOf(current);
  return `${at < 0 ? "–" : at + 1} / ${list.length}`;
}
