// The live preview's maths (Film Grain, Keep Detail, Cut Out in the browser)
// against what the Python nodes return, on the small picture in
// tests/fixtures/live_parity.json (made by tests/test_live_parity.py).
//
// Tolerance: the pictures and masks are 0-1 values and both sides work in
// 32-bit floats, so the same maths lands within a few millionths (the
// fixture is rounded to five digits). Every value must agree within 5e-5
// for grain, Keep Detail and Cut Out alike. The grain's random cells are the
// one thing not shared: the browser draws its own (see live_grain.mjs), so
// they are tested for the node's strength and grain size instead.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { makeImage } from "../js/shared/live_image.mjs";
import { autoGrain, autoValues, cellNormal, filmGrain, grainFrame, hashedCells, layGrain, matchValues, measureNoise } from "../js/shared/live_grain.mjs";
import { copiesGrain, grainFromLinked, keepMatch, keptMatch, matchFromRun, refreshAuto } from "../js/shared/grain_auto.mjs";
import { keepDetail } from "../js/shared/live_detail.mjs";
import { cutOut } from "../js/shared/live_cutout.mjs";
import { areaResize } from "../js/shared/live_image.mjs";
import { cropGeometry, fitGeometry, insideOf, paddedWindow, runIsCurrent, valuesSignature } from "../js/shared/live_view_math.mjs";
import { connectionKey, keptQuery, pixelsLookBlocked, planInput, scaledImage, windowImage } from "../js/shared/live_sources.mjs";
import { KINDS, drawKind, reachOf } from "../js/shared/live_kinds.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(readFileSync(join(HERE, "fixtures", "live_parity.json"), "utf-8"));
const { height, width } = FIX;
const pic = (flat, c = 3, h = height, w = width) => makeImage(w, h, c, Float32Array.from(flat));
const maxDiff = (a, b) => {
  assert.equal(a.length, b.length);
  let worst = 0;
  for (let i = 0; i < a.length; i += 1) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
};

// The node's recorded random grids, handed out in the order the node drew them.
const recorded = (cells) => (index) => {
  const [channels, rows, cols] = [...cells[index].shape];
  return (ch, i, j) => {
    assert.ok(ch < channels && i < rows && j < cols, "cell outside the recorded grid");
    return cells[index].data[(ch * rows + i) * cols + j];
  };
};

test("grain: the node's own random cells give the node's grain and result", () => {
  for (const item of FIX.cases.grain) {
    const cellsAt = recorded(item.cells);
    const grain = grainFrame(cellsAt, height, width, item.size, item.roughness, item.color);
    assert.equal(grain.c, item.grain_channels, item.name);
    const grainDiff = maxDiff(grain.data, item.grain);
    assert.ok(grainDiff < 5e-5, `${item.name}: grain differs by ${grainDiff}`);
    const out = layGrain(pic(FIX.image), grain, item.amount);
    const diff = maxDiff(out.data, item.result);
    assert.ok(diff < 5e-5, `${item.name}: result differs by ${diff}`);
  }
});

test("grain: a window of the picture has the same grain as the whole", () => {
  const whole = grainFrame(hashedCells(5), 64, 80, 1.5, 0.5, 0.4);
  const win = { x0: 20, y0: 12, w: 30, h: 22 };
  const part = grainFrame(hashedCells(5), 64, 80, 1.5, 0.5, 0.4, win);
  // The grid and its random cells are the whole picture's; only the
  // normalising spread is read from the window, so the two agree closely.
  let worst = 0;
  for (let k = 0; k < whole.c; k += 1) {
    for (let y = 0; y < win.h; y += 1) {
      for (let x = 0; x < win.w; x += 1) {
        worst = Math.max(worst, Math.abs(whole.data[(k * 64 + win.y0 + y) * 80 + win.x0 + x] - part.data[(k * win.h + y) * win.w + x]));
      }
    }
  }
  assert.ok(worst < 0.25, `window grain strays ${worst} from the whole's`);
});

test("grain: the browser's random cells have the node's strength and grain size", () => {
  const flat = makeImage(96, 96, 3, new Float32Array(96 * 96 * 3).fill(0.5));
  for (const size of [1, 2.5]) {
    const out = filmGrain(flat, { amount: 0.25, size, roughness: 0, color: 0, cellsAt: hashedCells(3) });
    let sum = 0;
    for (const v of out.data) sum += (v - 0.5) ** 2;
    const spread = Math.sqrt(sum / out.data.length);
    // Amount 0.25 at mid grey is a spread of 0.25 * 0.15 = 0.0375.
    assert.ok(Math.abs(spread - 0.0375) < 0.004, `size ${size}: spread ${spread}`);
  }
  // Bigger grain is smoother: neighbouring pixels agree more.
  const lag = (size) => {
    const out = filmGrain(flat, { amount: 0.25, size, roughness: 0, color: 0, cellsAt: hashedCells(4) });
    let same = 0; let all = 0;
    for (let y = 0; y < 96; y += 1) for (let x = 1; x < 96; x += 1) { same += (out.data[(y * 96 + x) * 3] - 0.5) * (out.data[(y * 96 + x - 1) * 3] - 0.5); all += (out.data[(y * 96 + x) * 3] - 0.5) ** 2; }
    return same / all;
  };
  assert.ok(lag(3) > lag(1) + 0.3, "larger size should give smoother, more correlated grain");
  const normals = Array.from({ length: 4000 }, (_, i) => cellNormal(9, 0, i, 7));
  const mean = normals.reduce((a, b) => a + b, 0) / normals.length;
  const sd = Math.sqrt(normals.reduce((a, b) => a + (b - mean) ** 2, 0) / normals.length);
  assert.ok(Math.abs(mean) < 0.06 && Math.abs(sd - 1) < 0.06, `cell normals: mean ${mean}, sd ${sd}`);
});

test("auto: the noise reading and Auto's picks match the node", () => {
  for (const item of FIX.cases.noise) {
    const got = measureNoise(pic(item.image, 3, item.height, item.width));
    assert.ok(Math.abs(got - item.measured) < 2e-5, `${item.name}: ${got} vs ${item.measured}`);
  }
  for (const item of FIX.cases.auto) {
    const got = autoGrain(item.height, item.width, item.noise);
    assert.ok(Math.abs(got.amount - item.amount) < 1e-6 && Math.abs(got.size - item.size) < 1e-6, JSON.stringify(item));
  }
});

test("auto: 4 MP gets twice the grain size of 1 MP, and a clean picture starts at 0.25", () => {
  const small = autoValues(1000, 1000, 0, 1, 1);
  const big = autoValues(2000, 2000, 0, 1, 1);
  assert.equal(small.size, 1);
  assert.equal(big.size, 2);
  assert.equal(small.amount, 0.25);
  const times = autoValues(2000, 2000, 0, 1.5, 2);
  assert.equal(times.amount, 0.375);
  assert.equal(times.size, 4);
  assert.ok(autoValues(1000, 1000, 0.03, 1, 1).amount > 0.4, "a grainy picture gets more");
});

test("grain match: the multipliers count from the run's match, inside the node's limits", () => {
  const match = { amount: 0.4, size: 2, color: 0.3 };
  assert.deepEqual(matchValues(match, 1, 1, 1), match);
  const times = matchValues(match, 3, 10, 4);
  assert.equal(times.amount, 1);
  assert.equal(times.size, 16);
  assert.equal(times.color, 1);
  assert.equal(matchValues(match, 1, 0.1, 0).size, 0.5);
  assert.equal(matchValues(match, 1, 1, 0).color, 0);
});

test("grain match: read from the run, used only while Auto is on and a picture is wired", () => {
  const record = { ausboss_grain_match: [{ amount: 0.5, size: 3, color: 0.3, base_amount: 0.25, base_size: 1.5, base_color: 0.3, found: 1 }] };
  assert.deepEqual(matchFromRun(record), { amount: 0.25, size: 1.5, color: 0.3 });
  assert.equal(matchFromRun({ ausboss_grain_auto: [{ base_amount: 0.25, base_size: 1 }] }), null);
  assert.equal(matchFromRun(null), null);
  const node = (auto, link) => ({ widgets: [{ name: "auto", value: auto }], inputs: [{ name: "image", link: 1 }, { name: "grain_from", link }] });
  assert.equal(grainFromLinked(node(false, 4)), true);
  assert.equal(copiesGrain(node(true, 4)), true);
  assert.equal(copiesGrain(node(false, 4)), false);
  assert.equal(copiesGrain(node(true, null)), false);
  assert.equal(copiesGrain({ widgets: [{ name: "auto", value: true }] }), false);
});

test("grain match: kept per pair of pictures, so a run ComfyUI answers from its cache still shows it", async () => {
  // Two decoded pictures (known after a run) wired into Film Grain.
  const links = { 1: { id: 1, origin_id: 10, origin_slot: 0 }, 2: { id: 2, origin_id: 11, origin_slot: 0 }, 3: { id: 3, origin_id: 12, origin_slot: 0 } };
  const graph = { links, getNodeById: (id) => ({ id, type: "VAEDecode", widgets: [] }) };
  const node = { graph, properties: {}, widgets: [{ name: "auto", value: true }], inputs: [{ name: "image", link: 1 }, { name: "grain_from", link: 2 }], setDirtyCanvas() {} };
  const first = { amount: 0.3, size: 2, color: 0.2 };
  keepMatch(node, first);
  node.inputs[1].link = 3;
  assert.equal(keptMatch(node), null);
  keepMatch(node, { amount: 0.1, size: 4, color: 0 });
  // Back to the first picture: ComfyUI's cache answers, no match is sent.
  node.inputs[1].link = 2;
  await refreshAuto(node, { viewUrl: (q) => q, record: null });
  assert.deepEqual(node.__ausbossMatch, first);
  // The kept matches ride in the saved workflow.
  assert.equal(Object.keys(JSON.parse(JSON.stringify(node.properties)).ausboss_grain_matches).length, 2);
  // A picture never matched waits for a run; unwiring forgets the match.
  links[4] = { id: 4, origin_id: 13, origin_slot: 0 };
  node.inputs[1].link = 4;
  await refreshAuto(node, { viewUrl: (q) => q, record: null });
  assert.equal(node.__ausbossMatch, null);
  node.inputs[1].link = null;
  await refreshAuto(node, { viewUrl: (q) => q, record: null });
  assert.equal(node.__ausbossMatch, null);
  // Only the last few pairs are kept.
  for (let i = 0; i < 12; i += 1) { links[20 + i] = { id: 20 + i, origin_id: 30 + i, origin_slot: 0 }; node.inputs[1].link = 20 + i; keepMatch(node, first); }
  assert.equal(Object.keys(node.properties.ausboss_grain_matches).length, 8);
});

test("grain match: the live drawing uses the match's colour and strength", () => {
  const w = 64, h = 48;
  const image = makeImage(w, h, 3, new Float32Array(w * h * 3).fill(0.5));
  const base = { amount: 0.25, size: 1, roughness: 0.5, color: 0, moving: false, seed: 3, auto: true, auto_amount: 1, auto_size: 1, auto_color: 1 };
  const view = { scale: 1, fullW: w, fullH: h, win: null };
  const matched = drawKind("grain", { ...base, match: { amount: 0.4, size: 1, color: 1 } }, { image }, view, 0);
  const direct = drawKind("grain", { ...base, auto: false, amount: 0.4, size: 1, color: 1 }, { image }, view, 0);
  assert.deepEqual(Array.from(matched.data), Array.from(direct.data));
  assert.ok(KINDS.grain.values.includes("auto_color"));
});

test("keep detail: the same result as the node", () => {
  for (const item of FIX.cases.detail) {
    const out = keepDetail(pic(FIX.smooth), pic(FIX.original), {
      detailSize: item.detail_size, strength: item.strength, colorDetail: item.color_detail, edgeSafe: item.edge_safe,
    });
    const diff = maxDiff(out.data, item.result);
    assert.ok(diff < 5e-5, `${item.name}: differs by ${diff}`);
  }
});

test("cut out: the same alpha and cut-out as the node", () => {
  for (const item of FIX.cases.cutout) {
    const out = cutOut(pic(FIX.image), Float32Array.from(FIX.mask), {
      keep: item.keep, grow: item.grow, feather: item.feather, cleanEdges: item.clean_edges, clearHaze: item.clear_haze, solidAbove: item.solid_above,
    });
    const alpha = Float32Array.from({ length: height * width }, (_, i) => out.data[i * 4 + 3]);
    const alphaDiff = maxDiff(alpha, item.alpha);
    assert.ok(alphaDiff < 5e-5, `${item.name}: alpha differs by ${alphaDiff}`);
    const diff = maxDiff(out.data, item.result);
    assert.ok(diff < 5e-5, `${item.name}: cut-out differs by ${diff}`);
  }
});

test("grain: far-below-a-pixel grain (a big picture shrunk to fit) keeps the node's strength", () => {
  // 2000 px shrunk to 100 is a scale of 0.05: 1 px grain averages 400 cells
  // per pixel, so the picture's grain falls to 1/20 of its spread.
  const flat = makeImage(100, 100, 3, new Float32Array(100 * 100 * 3).fill(0.5));
  const out = filmGrain(flat, { amount: 0.5, size: 1 * 0.05, roughness: 0, color: 0, cellsAt: hashedCells(8), height: 100, width: 100 });
  let sum = 0;
  for (const v of out.data) sum += (v - 0.5) ** 2;
  const spread = Math.sqrt(sum / out.data.length);
  assert.ok(Math.abs(spread - 0.5 * 0.15 * 0.05) < 0.0008, `spread ${spread}`);
});

test("area shrinking from 8-bit pixels is the same as shrinking floats", () => {
  const w = 17; const h = 11;
  const rgba = new Uint8ClampedArray(w * h * 4).map((_, i) => (i * 37) % 256);
  const px = { w, h, data: rgba };
  const floats = makeImage(w, h, 3, Float32Array.from({ length: w * h * 3 }, (_, at) => rgba[Math.floor(at / 3) * 4 + (at % 3)] / 255));
  const a = scaledImage(px, 6, 5, 3);
  const b = areaResize(floats, 5, 6);
  assert.ok(maxDiff(a.data, b.data) < 1e-6);
  const win = windowImage(px, { x: -2, y: 3, w: 5, h: 4 }, 3);
  assert.ok(Math.abs(win.data[0] - rgba[(3 * w) * 4] / 255) < 1e-6, "the first pixel is the picture's own");
  assert.ok(Math.abs(win.data[0] - win.data[3]) < 1e-9 && Math.abs(win.data[3] - win.data[6]) < 1e-9, "the edge is repeated past the picture's side");
});

test("views: Fit shrinks to what is shown, 100% is a window of real pixels", () => {
  const fit = fitGeometry(300, 200, 4000, 3000, 2);
  assert.equal(fit.displayW, 267);
  assert.equal(fit.displayH, 200);
  assert.equal(fit.workW, 534, "the copy is as sharp as it is shown (device pixels)");
  assert.equal(fitGeometry(300, 200, 100, 80, 1).scale, 1, "a small picture is never enlarged");
  assert.equal(fitGeometry(0, 200, 100, 80), null, "no stage yet");
  assert.deepEqual(cropGeometry(300, 200, 4000, 3000), { w: 300, h: 200, x: 1850, y: 1400 });
  assert.deepEqual(cropGeometry(300, 200, 4000, 3000, { x: -50, y: 9999 }), { w: 300, h: 200, x: 0, y: 2800 });
  assert.deepEqual(cropGeometry(300, 200, 120, 80), { w: 120, h: 80, x: 0, y: 0 });
  const padded = paddedWindow({ x: 10, y: 10, w: 100, h: 50 }, 30, 120, 90);
  assert.deepEqual(padded, { x: 0, y: 0, w: 120, h: 90 });
  assert.deepEqual(insideOf({ x: 10, y: 10, w: 100, h: 50 }, padded), { x: 10, y: 10, w: 100, h: 50 });
});

test("a window of Keep Detail and Cut Out at 100% matches the whole picture's pixels", () => {
  // The filters read past the window by `reach`; padded by that, the window's
  // own pixels are the whole picture's.
  const w = 96; const h = 80;
  const image = makeImage(w, h, 3, Float32Array.from({ length: w * h * 3 }, (_, i) => 0.5 + 0.3 * Math.sin(i * 0.37) * Math.cos(i * 0.011)));
  const original = makeImage(w, h, 3, Float32Array.from({ length: w * h * 3 }, (_, i) => 0.5 + 0.3 * Math.sin(i * 0.41) * Math.cos(i * 0.017)));
  const mask = Float32Array.from({ length: w * h }, (_, i) => ((i % w) > 20 && (i % w) < 70 && Math.floor(i / w) > 15 && Math.floor(i / w) < 60 ? 1 : 0));
  const win = { x: 30, y: 25, w: 30, h: 24 };
  const params = { detail_size: 3, strength: 1, color_detail: false, edge_safe: true };
  const whole = drawKind("detail", params, { image, detail_from: original }, { scale: 1, fullW: w, fullH: h, win: null }, null);
  const padded = paddedWindow(win, reachOf("detail", params, 96), w, h);
  const crop = (pic) => {
    const out = makeImage(padded.w, padded.h, pic.c);
    for (let y = 0; y < padded.h; y += 1) for (let x = 0; x < padded.w; x += 1) for (let k = 0; k < pic.c; k += 1) out.data[(y * padded.w + x) * pic.c + k] = pic.data[((padded.y + y) * w + padded.x + x) * pic.c + k];
    return out;
  };
  const part = drawKind("detail", params, { image: crop(image), detail_from: crop(original) }, { scale: 1, fullW: w, fullH: h, win: padded }, null);
  const at = insideOf(win, padded);
  let worst = 0;
  for (let y = 0; y < win.h; y += 1) for (let x = 0; x < win.w; x += 1) for (let k = 0; k < 3; k += 1) {
    worst = Math.max(worst, Math.abs(part.data[((at.y + y) * part.w + at.x + x) * 3 + k] - whole.data[((win.y + y) * w + win.x + x) * 3 + k]));
  }
  assert.ok(worst < 1e-4, `Keep Detail window strays ${worst}`);
  const cparams = { keep: "white", grow: 2, feather: 2, clean_edges: true, clear_haze: 0, solid_above: 1 };
  const wholeCut = drawKind("cutout", cparams, { image, mask: makeImage(w, h, 1, mask) }, { scale: 1, fullW: w, fullH: h, win: null }, null);
  const paddedCut = paddedWindow(win, reachOf("cutout", cparams, 96), w, h);
  const cropMask = Float32Array.from({ length: paddedCut.w * paddedCut.h }, (_, i) => mask[(paddedCut.y + Math.floor(i / paddedCut.w)) * w + paddedCut.x + (i % paddedCut.w)]);
  const cutImage = (() => { const out = makeImage(paddedCut.w, paddedCut.h, 3); for (let y = 0; y < paddedCut.h; y += 1) for (let x = 0; x < paddedCut.w; x += 1) for (let k = 0; k < 3; k += 1) out.data[(y * paddedCut.w + x) * 3 + k] = image.data[((paddedCut.y + y) * w + paddedCut.x + x) * 3 + k]; return out; })();
  const partCut = drawKind("cutout", cparams, { image: cutImage, mask: makeImage(paddedCut.w, paddedCut.h, 1, cropMask) }, { scale: 1, fullW: w, fullH: h, win: paddedCut }, null);
  const atCut = insideOf(win, paddedCut);
  let worstAlpha = 0;
  for (let y = 0; y < win.h; y += 1) for (let x = 0; x < win.w; x += 1) {
    worstAlpha = Math.max(worstAlpha, Math.abs(partCut.data[((atCut.y + y) * partCut.w + atCut.x + x) * 4 + 3] - wholeCut.data[((win.y + y) * w + win.x + x) * 4 + 3]));
  }
  assert.ok(worstAlpha < 1e-4, `Cut Out alpha window strays ${worstAlpha}`);
});

test("sources: a Load Image is known at once, anything else after a run", () => {
  const links = new Map([[1, { id: 1, origin_id: 10, origin_slot: 0 }], [2, { id: 2, origin_id: 11, origin_slot: 0 }], [3, { id: 3, origin_id: 10, origin_slot: 1 }]]);
  const nodes = {
    10: { type: "LoadImage", widgets: [{ name: "image", value: "pier.png" }] },
    11: { type: "VAEDecode", widgets: [] },
  };
  const graph = { links, getNodeById: (id) => nodes[id] };
  const node = { graph, inputs: [{ name: "image", link: 1 }, { name: "detail_from", link: 2 }, { name: "mask", link: 3 }, { name: "free", link: null }] };
  assert.deepEqual(planInput(node, "image"), { state: "direct", query: "filename=pier.png&subfolder=&type=input", key: "view:filename=pier.png&subfolder=&type=input" });
  assert.equal(planInput(node, "detail_from").state, "run");
  assert.equal(planInput(node, "mask").state, "run", "a Load Image's mask output is not its picture");
  assert.equal(planInput(node, "free").state, "none");
  assert.equal(planInput(node, "nothing").state, "none");
  assert.notEqual(connectionKey(node, ["image", "detail_from"]), connectionKey({ ...node, inputs: [{ name: "image", link: 2 }, { name: "detail_from", link: 2 }] }, ["image", "detail_from"]));
  assert.equal(keptQuery({ ausboss_live: [{ image: { filename: "a.png", subfolder: "", type: "temp" } }] }, "image"), "filename=a.png&subfolder=&type=temp");
  assert.equal(keptQuery({ images: [] }, "image"), null);
  assert.equal(keptQuery({ ausboss_live: [{}] }, "mask"), null);
});

test("sources: a read that returns only zeros is a blocked read", () => {
  assert.equal(pixelsLookBlocked(new Uint8ClampedArray(4000)), true);
  const some = new Uint8ClampedArray(4000);
  some[40] = 9;
  assert.equal(pixelsLookBlocked(some), false);
  assert.equal(pixelsLookBlocked(Uint8ClampedArray.from({ length: 4000 }, (_, i) => (i % 4 === 3 ? 255 : 0))), false, "black but opaque is a picture");
});

test("the values a result depends on are what the run's picture is matched against", () => {
  const node = { widgets: [{ name: "amount", value: 0.25 }, { name: "size", value: 1 }] };
  const before = valuesSignature(node, KINDS.grain.values);
  node.widgets[0].value = 0.3;
  assert.notEqual(valuesSignature(node, KINDS.grain.values), before);
  assert.equal(valuesSignature(node, ["amount"]), JSON.stringify([0.3]));
});

test("a run's result counts only for its values and its pictures", () => {
  const run = { sig: "[0.3]", sources: "image=view:filename=a.png|mask=-" };
  assert.equal(runIsCurrent(run, "[0.3]", "image=view:filename=a.png|mask=-"), true);
  assert.equal(runIsCurrent(run, "[0.4]", "image=view:filename=a.png|mask=-"), false);
  // Another file in the same Load Image: the old result is not this picture's.
  assert.equal(runIsCurrent(run, "[0.3]", "image=view:filename=b.png|mask=-"), false);
  assert.equal(runIsCurrent(null, "[0.3]", run.sources), false);
});

test("cut out: a see-through picture stays see-through in the live preview", () => {
  assert.equal(KINDS.cutout.inputs.find((input) => input.name === "image").channels, 4);
  const w = 8, h = 4;
  const data = new Float32Array(w * h * 4).fill(1);
  for (let i = 0; i < w * h; i += 1) data[i * 4 + 3] = i % w < 4 ? 0 : 0.5;
  const image = makeImage(w, h, 4, data);
  const mask = makeImage(w, h, 1, new Float32Array(w * h).fill(1));
  const out = drawKind("cutout", { keep: "white", grow: 0, feather: 0, clean_edges: false, clear_haze: 0, solid_above: 1 }, { image, mask }, { scale: 1, fullW: w, fullH: h, win: null }, 0);
  assert.equal(out.c, 4);
  assert.equal(out.data[3], 0);
  assert.ok(Math.abs(out.data[(w - 1) * 4 + 3] - 0.5) < 1e-6);
});
