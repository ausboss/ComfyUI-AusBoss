import test from "node:test";
import assert from "node:assert/strict";

import {
  ERASE_MAX_POINTS,
  ERASE_MAX_STROKES,
  ERASE_MAX_STROKE_POINTS,
  ERASE_OUTSIDE,
  ERASE_SIZE,
  adjustAxis,
  adjustedBrush,
  brushCore,
  brushSigma,
  clampSize,
  clampSoft,
  cleanStroke,
  defaultBrushSize,
  fitRect,
  makeStroke,
  moveAdjust,
  normalizeTop,
  pointCount,
  previewScale,
  readPaint,
  saveRequest,
  savedLinks,
  savedMessage,
  startAdjust,
  steppedSize,
  steppedSoft,
  strokeFits,
  toPicture,
} from "../js/shared/compare_erase.mjs";
import { normalizeCompareMode } from "../js/shared/compare.mjs";

test("erase is a mode the panel keeps", () => {
  assert.equal(normalizeCompareMode("erase"), "erase");
});

test("the brush is a solid middle with a soft edge", () => {
  assert.equal(brushCore(100, 0), 50);
  assert.equal(brushCore(100, 1), 25);
  assert.equal(brushSigma(100, 0), 0);
  assert.equal(brushSigma(100, 1), 12.5);
  // The fade ends near the ring the pointer shows: middle plus two blurs.
  assert.equal(brushCore(80, 1) + 2 * brushSigma(80, 1), 40);
});

test("sizes and softness stay in range", () => {
  assert.equal(clampSize(0), ERASE_SIZE[0]);
  assert.equal(clampSize(99999), ERASE_SIZE[1]);
  assert.equal(clampSize("x"), ERASE_SIZE[0]);
  assert.equal(clampSize(40.4), 40);
  assert.equal(clampSoft(-5), 0);
  assert.equal(clampSoft(250), 100);
  assert.equal(clampSoft("x"), 50);
  assert.equal(defaultBrushSize(1024, 1536), 128);
  assert.equal(defaultBrushSize(0, 0), 64);
  assert.equal(steppedSize(100, true), 120);
  assert.equal(steppedSize(100, false), 84);
  assert.equal(steppedSize(4, false), 2);
  assert.equal(steppedSize(2, false), 2);
  assert.equal(normalizeTop("B"), "B");
  assert.equal(normalizeTop("x"), "A");
});

test("a stored stroke is checked before it is used", () => {
  assert.deepEqual(cleanStroke({ o: 0, d: 30, s: 20, p: [1.4, 2.6, 7, 8] }, 100, 100), { o: 0, d: 30, s: 20, p: [1, 3, 7, 8] });
  assert.deepEqual(cleanStroke({ d: 99999, p: [-99999, 5] }, 100, 100), { o: 1, d: ERASE_SIZE[1], s: 50, p: [-ERASE_OUTSIDE, 5] });
  assert.equal(cleanStroke(null, 10, 10), null);
  assert.equal(cleanStroke({ d: 4, p: [1] }, 10, 10), null);
  assert.equal(cleanStroke({ d: 4, p: [1, 2, 3] }, 10, 10), null);
  assert.equal(cleanStroke({ d: 4, p: [1, "x"] }, 10, 10), null);
  assert.equal(cleanStroke({ d: 4, p: new Array((ERASE_MAX_STROKE_POINTS + 1) * 2).fill(0) }, 10, 10), null);
});

test("the paint a node keeps is dropped when the picture changes size", () => {
  const strokes = [{ o: 1, d: 20, s: 50, p: [5, 5] }, { junk: true }, { o: 0, d: 10, s: 0, p: [1, 1, 9, 9] }];
  const kept = readPaint({ w: 64, h: 48, strokes }, 64, 48);
  assert.deepEqual(kept, { w: 64, h: 48, strokes: [strokes[0], strokes[2]] });
  assert.deepEqual(readPaint({ w: 64, h: 48, strokes }, 64, 50).strokes, []);
  assert.deepEqual(readPaint(undefined, 64, 48).strokes, []);
  assert.deepEqual(readPaint({ w: 64, h: 48, strokes: "x" }, 64, 48).strokes, []);
});

test("a mix holds a fixed amount of paint", () => {
  const dab = { o: 1, d: 10, s: 0, p: [1, 1] };
  assert.equal(strokeFits([], dab), true);
  assert.equal(strokeFits(new Array(ERASE_MAX_STROKES).fill(dab), dab), false);
  const long = { o: 1, d: 10, s: 0, p: new Array(ERASE_MAX_STROKE_POINTS * 2).fill(0) };
  const many = new Array(Math.floor(ERASE_MAX_POINTS / ERASE_MAX_STROKE_POINTS)).fill(long);
  assert.equal(pointCount(many), ERASE_MAX_POINTS - (ERASE_MAX_POINTS % ERASE_MAX_STROKE_POINTS));
  assert.equal(strokeFits(many, long), false);
  // Paint over the limit in a workflow is cut off, not drawn.
  assert.equal(readPaint({ w: 9, h: 9, strokes: new Array(ERASE_MAX_STROKES + 50).fill(dab) }, 9, 9).strokes.length, ERASE_MAX_STROKES);
});

test("a finished stroke keeps its shape with far fewer points", () => {
  const points = [];
  for (let x = 0; x <= 400; x += 1) points.push([x, 100 + (x > 200 ? x - 200 : 0)]);
  const stroke = makeStroke(points, { erase: false, size: 40, soft: 30 }, 512, 512);
  assert.equal(stroke.o, 0);
  assert.equal(stroke.d, 40);
  assert.equal(stroke.s, 30);
  assert.deepEqual(stroke.p, [0, 100, 200, 100, 400, 300]);
  // A click that never moved is one dab.
  assert.deepEqual(makeStroke([[10.2, 20.7]], { size: 8, soft: 0 }, 64, 64), { o: 1, d: 8, s: 0, p: [10, 21] });
  // However long the scribble, a stroke stays under the limit.
  const scribble = Array.from({ length: 5000 }, (_, index) => [index % 300, (index * 7) % 300]);
  assert.ok(makeStroke(scribble, { size: 4, soft: 0 }, 300, 300).p.length / 2 <= ERASE_MAX_STROKE_POINTS);
});

test("the picture is shown whole and centred, and a click maps back to it", () => {
  const fit = fitRect(400, 300, 1000, 500);
  assert.deepEqual(fit, { left: 0, top: 50, width: 400, height: 200, scale: 0.4 });
  assert.deepEqual(toPicture(fit, 200, 150), [500, 250]);
  assert.deepEqual(toPicture(fit, 0, 50), [0, 0]);
  assert.deepEqual(fitRect(300, 400, 500, 1000), { left: 50, top: 0, width: 200, height: 400, scale: 0.4 });
  assert.equal(fitRect(0, 300, 10, 10).scale, 0);
  assert.equal(toPicture(fitRect(0, 0, 10, 10), 5, 5), null);
  assert.equal(previewScale(1024, 512), 1);
  assert.equal(previewScale(4096, 2048), 0.5);
});

test("save sends the run's key, the strokes and the choices, and no file name", () => {
  const strokes = [{ o: 1, d: 10, s: 0, p: [1, 1] }];
  assert.deepEqual(saveRequest({ pair: "k3y", top: "B", strokes, layers: true }), { pair: "k3y", top: "B", strokes, layers: true });
  assert.deepEqual(saveRequest({}), { pair: "", top: "A", strokes: [], layers: false });
  assert.equal(saveRequest({ pair: { filename: "a.png" } }).pair, "");
  assert.equal(saveRequest({ pair: "k", layers: "yes" }).layers, false);
  assert.deepEqual(Object.keys(saveRequest({ pair: "k", name: "x/y", refs: {} })), ["pair", "top", "strokes", "layers"]);
});

test("the saved line names the file", () => {
  assert.equal(savedMessage([{ filename: "compare_00001.png", subfolder: "" }]), "Saved compare_00001.png in the output folder.");
  assert.equal(
    savedMessage([{ filename: "p_00002.png", subfolder: "mixes" }, { filename: "p_00002.psd" }, { filename: "p_00002_mask.png" }]),
    "Saved mixes/p_00002.png, with its PSD and mask, in the output folder.",
  );
  assert.equal(savedMessage(undefined), "Saved.");
});

test("each saved file gets a short link", () => {
  const files = [
    { filename: "p_00002.png", subfolder: "mixes", type: "output" },
    { filename: "p_00002.psd", subfolder: "mixes", type: "output" },
    { filename: "p_00002_mask.png", subfolder: "mixes", type: "output" },
  ];
  assert.deepEqual(savedLinks(files).map((link) => link.label), ["PNG", "PSD", "MASK"]);
  assert.equal(savedLinks(files)[1].file, files[1]);
  assert.deepEqual(savedLinks([{ filename: "compare_00001.png" }, {}, null]).map((link) => link.label), ["PNG"]);
  assert.deepEqual(savedLinks(undefined), []);
});

test("a brush drag sets the size across and the edge up and down", () => {
  // The first few pixels pick what the drag changes, and it stays that.
  assert.equal(adjustAxis(2, 3), null);
  assert.equal(adjustAxis(9, 3), "size");
  assert.equal(adjustAxis(-3, -9), "soft");
  assert.equal(adjustAxis(7, 7), "size");
  const brush = { size: 100, soft: 50 };
  // Across: the rim follows the pointer, so the width grows by twice the drag.
  assert.deepEqual(adjustedBrush(brush, "size", 30, 80), { size: 160, soft: 50 });
  assert.deepEqual(adjustedBrush(brush, "size", -30, 0), { size: 40, soft: 50 });
  // A picture shown at half size: one screen pixel is two of the picture's.
  assert.deepEqual(adjustedBrush(brush, "size", 30, 0, 2), { size: 220, soft: 50 });
  // Up is softer, down is harder.
  assert.deepEqual(adjustedBrush(brush, "soft", 80, -40), { size: 100, soft: 70 });
  assert.deepEqual(adjustedBrush(brush, "soft", 0, 60), { size: 100, soft: 20 });
  assert.deepEqual(adjustedBrush(brush, "soft", 0, 9999), { size: 100, soft: 0 });
  assert.deepEqual(adjustedBrush(brush, "size", -9999, 0), { size: ERASE_SIZE[0], soft: 50 });
  assert.deepEqual(adjustedBrush(brush, null, 50, 50), brush);
});

test("shift with the bracket keys moves the edge a quarter", () => {
  assert.equal(steppedSoft(50, true), 75);
  assert.equal(steppedSoft(50, false), 25);
  assert.equal(steppedSoft(90, true), 100);
  assert.equal(steppedSoft(10, false), 0);
});

// A drag through these places, one small step at a time, as a hand makes it.
function drag(points, brush = { size: 100, soft: 50 }, perPixel = 1) {
  let state = startAdjust(points[0][0], points[0][1], brush);
  for (let leg = 1; leg < points.length; leg += 1) {
    const [x0, y0] = points[leg - 1];
    const [x1, y1] = points[leg];
    const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 3));
    for (let step = 1; step <= steps; step += 1) {
      state = moveAdjust(state, x0 + ((x1 - x0) * step) / steps, y0 + ((y1 - y0) * step) / steps, perPixel);
    }
  }
  return state;
}

test("one drag sets the size, and a turn in it sets the edge", () => {
  // Across only: the size, and the edge stays.
  assert.deepEqual(drag([[0, 0], [60, 0]]).brush, { size: 220, soft: 50 });
  // Up only: the edge, and the size stays.
  assert.deepEqual(drag([[0, 0], [0, -60]]).brush, { size: 100, soft: 80 });
  // Across, then up without letting go: the size it reached stays, and the
  // edge starts to move once the turn is clear.
  const turned = drag([[0, 0], [60, 0], [60, -80]]);
  assert.equal(turned.axis, "soft");
  assert.equal(turned.brush.size, 220);
  assert.ok(turned.brush.soft >= 80 && turned.brush.soft < 90, `soft ${turned.brush.soft}`);
  // And back across again: now the edge stays and the size moves on.
  const back = drag([[0, 0], [60, 0], [60, -80], [0, -80]]);
  assert.equal(back.axis, "size");
  assert.equal(back.brush.soft, turned.brush.soft);
  assert.ok(back.brush.size < 140, `size ${back.brush.size}`);
});

test("a shaky hand setting the size does not move the edge", () => {
  // A long drag across that wanders up and down by a few pixels.
  const points = [[0, 0]];
  for (let x = 10; x <= 200; x += 10) points.push([x, (x / 10) % 2 ? 5 : -4]);
  const state = drag(points);
  assert.equal(state.axis, "size");
  assert.equal(state.brush.soft, 50);
  assert.equal(state.brush.size, 500);
  // A slow slant is still one drag: it does not count as a turn.
  const slant = drag([[0, 0], [200, -60]]);
  assert.equal(slant.axis, "size");
  assert.equal(slant.brush.soft, 50);
  // The same for the edge: straight down with a wobble leaves the size.
  const down = drag([[0, 0], [4, 30], [-3, 60], [5, 90]]);
  assert.equal(down.axis, "soft");
  assert.deepEqual(down.brush, { size: 100, soft: 5 });
});
