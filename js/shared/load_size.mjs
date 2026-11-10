// Load Image: the size a picture comes out at, worked out in the browser so
// the node can show it before a run. This repeats plan_load_size in
// nodes/_load_image_helpers.py; tests/fixtures/load_size_cases.json holds
// both to the same answers. No DOM in here.

export const SIZE_MODES = Object.freeze(["off", "megapixels", "longest side", "scale", "fit inside", "crop to fill"]);

const roundHalfUp = (value) => Math.floor(value + 0.5);
const whole = (value, fallback) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback);
// Nearest multiple, never below one step.
const nearest = (value, step) => Math.max(step, roundHalfUp(value / step) * step);
// The largest multiple that is not above the value, never below one step.
const below = (value, step) => Math.max(step, Math.floor(value / step) * step);

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
    return {
      resizeWidth, resizeHeight,
      cropX: Math.floor((resizeWidth - width) / 2), cropY: Math.floor((resizeHeight - height) / 2),
      width, height,
    };
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
