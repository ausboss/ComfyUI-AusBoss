import { keptCrop, resolveCrop, resolvePadding, rotatedSize, scaleToMegapixels } from "./transform_geometry.mjs";

export const COPY_EDITS_SETTING = Object.freeze({
  key: "copy_edits", label: "Copy with crop, rotation and padding", type: "toggle", default: false,
  hint: "Off: copy the original picture. On: include crop, rotation, padding and resize. Handles and guides are never copied.",
});

// Render picture pixels into a separate canvas. The editor's canvas contains
// handles, hatching and stage margins and must never be a clipboard source.
export function transformPicture({ sourceWidth, sourceHeight, values, resize, fill, drawSource, includeEdits = false, createCanvas = () => document.createElement("canvas") }) {
  const canvas = createCanvas();
  if (!includeEdits) {
    canvas.width = sourceWidth; canvas.height = sourceHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The browser could not make the picture.");
    context.translate(sourceWidth / 2, sourceHeight / 2);
    drawSource(context);
    return canvas;
  }
  const source = rotatedSize(sourceWidth, sourceHeight, values.rotation_degrees);
  const whole = resolveCrop(values, source);
  const padding = resolvePadding(values, whole);
  const crop = keptCrop(whole, padding);
  const size = resize
    ? scaleToMegapixels(padding.outputWidth, padding.outputHeight, resize.megapixels, resize.steps)
    : { width: padding.outputWidth, height: padding.outputHeight };
  canvas.width = size.width; canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The browser could not make the picture.");
  context.fillStyle = fill;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.scale(size.width / padding.outputWidth, size.height / padding.outputHeight);
  context.beginPath();
  context.rect(padding.left, padding.top, crop.width, crop.height);
  context.clip();
  context.translate(padding.left - crop.x + source.width / 2, padding.top - crop.y + source.height / 2);
  context.rotate((Number(values.rotation_degrees) || 0) * Math.PI / 180);
  drawSource(context);
  context.restore();
  return canvas;
}

// Start the clipboard write in the click's activation, including in browsers
// that require a promised PNG rather than a write after toBlob has finished.
export function copyPicture(picture, { clipboard = globalThis.navigator?.clipboard, ClipboardItem = globalThis.ClipboardItem } = {}) {
  if (!clipboard?.write || !ClipboardItem) throw new Error("Open ComfyUI on localhost or HTTPS to copy directly. Choose Open image, then right-click the picture to copy it instead.");
  const png = Promise.resolve().then(() => typeof picture === "function" ? picture() : picture).then((canvas) => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The browser could not make the picture.")), "image/png");
  }));
  // Also observe encoding failure when write() is refused before it reads png.
  png.catch(() => {});
  return clipboard.write([new ClipboardItem({ "image/png": png })]);
}
