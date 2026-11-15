import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { copyPicture, transformPicture } from "../js/shared/transform_picture.mjs";

function render(values = {}, resize = null) {
  const calls = [];
  const context = new Proxy({}, { get: (target, name) => name in target ? target[name] : (...args) => calls.push([name, ...args]) });
  const canvas = { getContext: () => context };
  const result = transformPicture({
    sourceWidth: 100, sourceHeight: 60,
    values: { canvas_multiple: 1, ...values }, resize, fill: "#123456",
    drawSource: (ctx) => ctx.drawImage("source", -50, -30, 100, 60),
    createCanvas: () => canvas,
  });
  return { result, calls, context };
}

test("copy uses source pixels at full size, with no stage margin or controls", () => {
  const { result, calls, context } = render();
  assert.deepEqual([result.width, result.height], [100, 60]);
  assert.equal(context.fillStyle, "#123456");
  assert.deepEqual(calls, [
    ["fillRect", 0, 0, 100, 60], ["save"], ["scale", 1, 1], ["beginPath"],
    ["rect", 0, 0, 100, 60], ["clip"], ["translate", 50, 30], ["rotate", 0],
    ["drawImage", "source", -50, -30, 100, 60], ["restore"],
  ]);
});

test("crop, padding and alignment set the copied bounds and source offset", () => {
  const { result, calls } = render({ crop_x: 10, crop_y: 5, crop_width: 40, crop_height: 30, pad_left: 8, pad_top: 4, pad_right: 8, pad_bottom: 6, canvas_multiple: 8 });
  assert.deepEqual([result.width, result.height], [56, 40]);
  assert.ok(calls.some((c) => JSON.stringify(c) === JSON.stringify(["rect", 8, 4, 40, 30])));
  assert.ok(calls.some((c) => JSON.stringify(c) === JSON.stringify(["translate", 48, 29])));
});

test("rotation and resize are applied without copying a screen-sized preview", () => {
  const { result, calls } = render({ rotation_degrees: 90 }, { megapixels: 0.25, steps: 8 });
  assert.deepEqual([result.width, result.height], [400, 664]);
  assert.ok(calls.some((c) => c[0] === "rotate" && c[1] === Math.PI / 2));
  assert.ok(calls.some((c) => c[0] === "scale" && c[1] === 400 / 60 && c[2] === 664 / 100));
});

test("clipboard write starts before PNG encoding finishes and contains only the clean PNG", async () => {
  let finish, item, written = false;
  const canvas = { toBlob: (callback, type) => { assert.equal(type, "image/png"); finish = callback; } };
  class ClipboardItem { constructor(data) { this.data = data; } }
  const clipboard = { write: async (items) => { written = true; [item] = items; await item.data["image/png"]; } };
  const pending = copyPicture(canvas, { clipboard, ClipboardItem });
  assert.equal(written, true);
  assert.deepEqual(Object.keys(item.data), ["image/png"]);
  await Promise.resolve(); await Promise.resolve();
  const png = new Blob(["picture"], { type: "image/png" });
  finish(png);
  await pending;
  assert.equal(await item.data["image/png"], png);
});

test("clipboard and encoding failures are reported instead of false success", async () => {
  assert.throws(() => copyPicture({}, { clipboard: null, ClipboardItem: null }), /Open image/);
  class ClipboardItem { constructor(data) { this.data = data; } }
  const canvas = { toBlob: (callback) => callback(null) };
  const clipboard = { write: async ([item]) => await item.data["image/png"] };
  await assert.rejects(copyPicture(canvas, { clipboard, ClipboardItem }), /could not make/);
  await assert.rejects(copyPicture({ toBlob: () => {} }, { clipboard: { write: async () => { throw new Error("Denied"); } }, ClipboardItem }), /Denied/);
});

test("both image editing surfaces replace native canvas copying, video is unchanged", () => {
  const source = readFileSync(new URL("../js/shared/transform_editor.mjs", import.meta.url), "utf8");
  assert.match(source, /attachStageHandlers\(state, preview, state.panelAbort.signal\)/);
  assert.match(source, /attachStageHandlers\(state, canvas, abort.signal\)/);
  assert.match(source, /if \(state.kind === "image"\) \{\s*canvas.addEventListener\("contextmenu"/);
  assert.match(source, /copyPicture\(picture\)/);
});
