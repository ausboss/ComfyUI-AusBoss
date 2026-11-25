// Image Resize 🆎: which card rows the node reads for the values set. No DOM
// and no ComfyUI imports, so node:test covers it.

// Only a width × height box can disagree with the picture's shape; every other
// target takes its shape from the picture, and the node always fits it
// (nodes/_resize_helpers.py). So Fit is only read in width × height.
export function readsFit(values) {
  return values?.target_mode === "width+height";
}

// The fill colour paints pad's bars, so it is read only where pad is.
export function readsFill(values) {
  return readsFit(values) && values?.keep_proportion === "pad";
}
