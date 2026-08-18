// Starting expand/blur for a mask, picked from the picture's size.
//
// A feather is a fraction of the subject, not a fixed number of pixels: the
// 8 px grow that covers a watermark's antialiased rim on a 576-tall clip is
// a smear on a 128 px thumbnail and does nothing at all on a 4K plate. The
// ladder below is anchored on the value that was tuned by hand for the video
// watermark workflow — 8 px of expand, 4 of blur, on a 576x1024 clip — and
// scales it by the SHORT edge, which is what "how big is this picture"
// actually means for a mask.
//
// These are a starting point to nudge, never a correct answer: how far a
// mask has to grow depends on how tight the segmentation was, and nothing
// here can see that.
//
// No DOM and no ComfyUI imports, so node:test covers it directly.

const REFERENCE_SHORT_EDGE = 576;
const REFERENCE_EXPAND = 8;
const MIN_EXPAND = 1;
const MAX_EXPAND = 64;

export function autoMaskValues(width, height) {
  const shortEdge = Math.min(Number(width) || 0, Number(height) || 0);
  if (!(shortEdge > 0)) return null;
  const scaled = Math.round((shortEdge * REFERENCE_EXPAND) / REFERENCE_SHORT_EDGE);
  const expand = Math.max(MIN_EXPAND, Math.min(MAX_EXPAND, scaled));
  // Half the grow: enough to soften the edge the grow just created without
  // washing away the coverage it added.
  return { expand, blur: Math.round(expand * 5) / 10 };
}
