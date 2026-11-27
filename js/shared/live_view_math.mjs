// The geometry of the live preview's two views (js/shared/live_stage.mjs):
// Fit draws the whole picture on a downscaled copy, 100% draws a window of
// real pixels you can pan. No DOM, so node:test covers it.

// Longest side of the copy Fit works on, however big the stage is.
export const FIT_LONG_MAX = 1200;
export const FIT_LONG_MIN = 32;

// Fit: the picture as large as the stage allows, never bigger than its own
// size, and the size of the copy the node's maths runs on (the displayed
// size in device pixels, so what is drawn is as sharp as it is shown).
// Returns null while the stage has no size yet.
export function fitGeometry(stageW, stageH, imageW, imageH, ratio = 1) {
  if (!(stageW > 0 && stageH > 0 && imageW > 0 && imageH > 0)) return null;
  const k = Math.min(1, stageW / imageW, stageH / imageH);
  const displayW = Math.max(1, Math.round(imageW * k));
  const displayH = Math.max(1, Math.round(imageH * k));
  const wanted = Math.min(FIT_LONG_MAX, Math.max(FIT_LONG_MIN, Math.round(Math.max(displayW, displayH) * Math.max(1, ratio))));
  const scale = Math.min(1, wanted / Math.max(imageW, imageH));
  return {
    displayW, displayH, scale,
    workW: Math.max(1, Math.round(imageW * scale)),
    workH: Math.max(1, Math.round(imageH * scale)),
  };
}

// 100%: the window of real pixels the stage shows, and where it starts. One
// picture pixel is one pixel of the stage. `pan` is the window's top-left
// corner in picture pixels (null: centred).
export function cropGeometry(stageW, stageH, imageW, imageH, pan = null) {
  if (!(stageW > 0 && stageH > 0 && imageW > 0 && imageH > 0)) return null;
  const w = Math.min(imageW, Math.floor(stageW));
  const h = Math.min(imageH, Math.floor(stageH));
  const clamp = (value, room) => Math.min(Math.max(Math.round(value), 0), room);
  return {
    w, h,
    x: clamp(pan ? pan.x : (imageW - w) / 2, imageW - w),
    y: clamp(pan ? pan.y : (imageH - h) / 2, imageH - h),
  };
}

// The window grown by `reach` pixels each way, kept on the picture: what a
// filter must read for the window's own pixels to come out as the whole
// picture's would.
export function paddedWindow(win, reach, imageW, imageH) {
  const x0 = Math.max(0, win.x - reach);
  const y0 = Math.max(0, win.y - reach);
  const x1 = Math.min(imageW, win.x + win.w + reach);
  const y1 = Math.min(imageH, win.y + win.h + reach);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// A window's pixels inside a padded window's, for cutting the padding off.
export function insideOf(win, padded) {
  return { x: win.x - padded.x, y: win.y - padded.y, w: win.w, h: win.h };
}

// One string for the values a result depends on, to tell whether the picture
// on the node is the one the last run made.
// Is the last run's result what the node would give now: the same values
// and the same pictures (each Load Image's file, or the link a run reads)?
export const runIsCurrent = (run, sig, sources) => Boolean(run) && run.sig === sig && run.sources === sources;

export function valuesSignature(node, names) {
  return JSON.stringify(names.map((name) => node?.widgets?.find((widget) => widget?.name === name)?.value ?? null));
}
