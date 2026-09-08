// The Resolution node's pure geometry: snapping, ratio math, drag model,
// and megapixel retargeting.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DIM_MAX,
  DIM_MIN,
  MP_LADDER,
  applyRatioAtBudget,
  chipMatch,
  clampDim,
  dragResize,
  fitRectInBox,
  megapixels,
  offGrid,
  orientRatio,
  outwardDelta,
  parsePins,
  parseRail,
  defaultSizeForRatio,
  pinLabel,
  quickSizes,
  ratioLabel,
  ratioSizeForAxis,
  ratioSizeNear,
  ratioStride,
  readout,
  reduceRatio,
  scrubDim,
  serializePins,
  sizeForMegapixels,
  snapDim,
  stageScale,
  stepMegapixels,
  strideWarning,
  togglePin,
} from "../js/shared/resolution_math.mjs";

// ---------- snapping ----------

test("snapDim rounds to the step and never collapses below one step", () => {
  assert.equal(snapDim(1000, 32), 992);
  assert.equal(snapDim(1016, 32), 1024);
  assert.equal(snapDim(5, 64), 64);
});

test("clampDim holds the 64..8192 range", () => {
  assert.equal(clampDim(10), DIM_MIN);
  assert.equal(clampDim(999999), DIM_MAX);
  assert.equal(clampDim("1024"), 1024);
});

// ---------- ratio math ----------

test("reduceRatio finds the exact reduced ratio", () => {
  assert.deepEqual(reduceRatio(1344, 768), { x: 7, y: 4 });
  assert.deepEqual(reduceRatio(1024, 1024), { x: 1, y: 1 });
  assert.deepEqual(reduceRatio(2048, 1024), { x: 2, y: 1 });
});

test("ratioLabel is exact for small terms, approximate for monsters", () => {
  assert.equal(ratioLabel(1920, 1080), "16:9");
  assert.equal(ratioLabel(1344, 768), "7:4");
  assert.equal(ratioLabel(1000, 707), "~1.41:1");
  assert.equal(ratioLabel(707, 1000), "~1:1.41");
});

test("readout combines size, MP, and ratio", () => {
  assert.equal(readout(1024, 1024), "1024 × 1024  ·  1.05 MP  ·  1:1");
  assert.equal(megapixels(1344, 768), 1.03);
});

test("fitRectInBox letterboxes by the tighter side", () => {
  assert.deepEqual(fitRectInBox(16, 9, 32, 32), { w: 32, h: 18 });
  assert.deepEqual(fitRectInBox(9, 16, 32, 32), { w: 18, h: 32 });
});

// ---------- exact-ratio sizing ----------

test("ratioSizeForAxis keeps the ratio mathematically exact", () => {
  const size = ratioSizeForAxis({ x: 7, y: 4 }, "width", 1400, 32);
  assert.equal(size.width % 7, 0);
  assert.equal(size.height % 4, 0);
  assert.equal(size.width * 4, size.height * 7);
});

test("ratioSizeNear lands on the closest on-ratio size", () => {
  const size = ratioSizeNear({ x: 1, y: 1 }, 1030, 1010, 32);
  assert.deepEqual(size, { width: 1024, height: 1024 });
});

// ---------- drag model ----------

test("outward deltas grow whichever edge is grabbed", () => {
  assert.deepEqual(outwardDelta("e", 10, 0), { ox: 10, oy: 0 });
  assert.deepEqual(outwardDelta("w", -10, 0), { ox: 10, oy: 0 });
  assert.deepEqual(outwardDelta("n", 0, -10), { ox: 0, oy: 10 });
  assert.deepEqual(outwardDelta("se", 10, 10), { ox: 10, oy: 10 });
});

test("an east drag grows width only, snapped", () => {
  const size = dragResize({
    handle: "e", startWidth: 1024, startHeight: 1024,
    dx: 50, dy: 0, scale: 0.25, snap: 32,
  });
  // 50 CSS px outward at 0.25 px/px = 400 image px of growth -> 1424 -> snap 1440
  assert.deepEqual(size, { width: 1440, height: 1024 });
});

test("snap off gives pixel freedom", () => {
  const size = dragResize({
    handle: "e", startWidth: 1024, startHeight: 1024,
    dx: 5, dy: 0, scale: 1, snapOn: false,
  });
  assert.deepEqual(size, { width: 1034, height: 1024 });
});

test("a ratio-locked corner drag cannot drift the ratio", () => {
  const size = dragResize({
    handle: "se", startWidth: 1344, startHeight: 768,
    dx: 100, dy: 3, scale: 0.5, snap: 32, lockRatio: true,
  });
  assert.equal(size.width * 4, size.height * 7);
  assert.ok(size.width > 1344, "grew outward");
});

test("stageScale leaves label and handle headroom", () => {
  assert.ok(stageScale(1024, 1024, 200, 200) < 200 / 1024);
  assert.equal(stageScale(1024, 1024, 400, 400), (400 - 90) / 1024);
  assert.ok(stageScale(1024, 1024, 50, 50) > 0, "tiny stages stay positive");
});

// ---------- megapixel retarget ----------

test("sizeForMegapixels hits near the target on the exact ratio", () => {
  const size = sizeForMegapixels(1344, 768, 2.0, 32);
  assert.equal(size.width * 4, size.height * 7);
  const mp = (size.width * size.height) / 1e6;
  assert.ok(Math.abs(mp - 2.0) < 0.25, `got ${mp} MP`);
});

test("retargeting a square to 1MP lands on 992 or 1024", () => {
  const size = sizeForMegapixels(2048, 2048, 1.0, 32);
  assert.equal(size.width, size.height);
  assert.ok([992, 1024].includes(size.width), `got ${size.width}`);
});

// ---------- the judge's fixture table: chip clicks hit real sizes ----------

test("from the 1024x1024 default, 7:4 at /32 yields exactly 1344x768", () => {
  assert.deepEqual(applyRatioAtBudget(1024, 1024, { x: 7, y: 4 }, 32),
    { width: 1344, height: 768 });
});

test("from the 1024x1024 default, 16:9 at /16 yields exactly 1280x720", () => {
  assert.deepEqual(applyRatioAtBudget(1024, 1024, { x: 16, y: 9 }, 16),
    { width: 1280, height: 720 });
});

test("chips preserve the current orientation", () => {
  // Portrait canvas + landscape 3:2 chip -> a 2:3 portrait result.
  const size = applyRatioAtBudget(768, 1120, { x: 3, y: 2 }, 32);
  assert.ok(size.height > size.width, `stayed portrait, got ${size.width}x${size.height}`);
  assert.equal(size.width * 3, size.height * 2);
});

test("stride math: one snap system for locked ratios", () => {
  assert.equal(ratioStride({ x: 7, y: 4 }, 32), 32);   // k=192 -> 1344x768
  assert.equal(ratioStride({ x: 16, y: 9 }, 16), 16);  // k=80  -> 1280x720
  assert.equal(ratioStride({ x: 1, y: 1 }, 32), 32);
  const size = ratioSizeForAxis({ x: 7, y: 4 }, "width", 1344, 32);
  assert.equal(size.width % 32, 0);
  assert.equal(size.height % 32, 0);
});

test("coarse strides warn so the drag never feels stuck silently", () => {
  assert.equal(strideWarning({ x: 16, y: 9 }, 32), true);  // width jumps 512
  assert.equal(strideWarning({ x: 7, y: 4 }, 32), false);
  assert.equal(strideWarning({ x: 1, y: 1 }, 64), false);
});

// ---------- chip matching ----------

test("chipMatch is exact, near, or nothing - orientation-blind", () => {
  assert.deepEqual(chipMatch(1344, 768, { x: 7, y: 4 }), { state: "exact", flipped: false });
  assert.deepEqual(chipMatch(768, 1344, { x: 7, y: 4 }), { state: "exact", flipped: true });
  assert.equal(chipMatch(1704, 960, { x: 16, y: 9 }).state, "near"); // ~1.775 vs 1.778
  assert.equal(chipMatch(1024, 1024, { x: 16, y: 9 }), null);
});

test("the rail renders in the canvas orientation", () => {
  assert.deepEqual(orientRatio({ x: 3, y: 2 }, true), { x: 2, y: 3, label: "2:3" });
  assert.deepEqual(orientRatio({ x: 3, y: 2 }, false), { x: 3, y: 2, label: "3:2" });
  assert.deepEqual(orientRatio({ x: 1, y: 1 }, true), { x: 1, y: 1, label: "1:1" });
});

test("parseRail survives junk and never empties", () => {
  const rail = parseRail("1:1, junk, 21x9, 4:3, 4:3");
  assert.deepEqual(rail.map((r) => r.label), ["1:1", "21:9", "4:3"]);
  assert.equal(parseRail("").length, 6); // shipped defaults
});

// ---------- quick sizes ----------

test("the 1:1 ladder IS the canonical square list", () => {
  const list = quickSizes(1024, 1024, 64);
  assert.deepEqual(list.map((s) => s.width),
    [512, 768, 1024, 1280, 1536, 1792, 2048]);
  for (const size of list) assert.equal(size.width, size.height);
});

test("every rung is on-ratio, on-grid, and sorted", () => {
  const list = quickSizes(1344, 768, 32);
  for (const size of list) {
    assert.equal(size.width * 4, size.height * 7);
    assert.equal(size.width % 32, 0);
    assert.equal(size.height % 32, 0);
  }
  assert.ok(list.every((s, i) => i === 0 || s.width > list[i - 1].width));
});

test("chip clicks land on the ratio's ~1MP default", () => {
  assert.deepEqual(defaultSizeForRatio({ x: 1, y: 1 }, 64),
    { width: 1024, height: 1024 });
  assert.deepEqual(defaultSizeForRatio({ x: 16, y: 9 }, 16),
    { width: 1280, height: 720 });
  assert.deepEqual(defaultSizeForRatio({ x: 7, y: 4 }, 32),
    { width: 1344, height: 768 });
});

test("custom-ratio corner drags are fluid, not stride jumps", () => {
  // 1408x1840 reduces to 88:115 - exact lock would jump by 1840px steps.
  const small = dragResize({
    handle: "se", startWidth: 1408, startHeight: 1840,
    dx: 8, dy: 8, scale: 0.2, snap: 16, lockRatio: true,
  });
  assert.ok(Math.abs(small.width - 1408) <= 96, `moved ${small.width - 1408}`);
  assert.ok(Math.abs(small.height - 1840) <= 96);
  assert.equal(small.width % 16, 0);
  assert.equal(small.height % 16, 0);
  const bigger = dragResize({
    handle: "se", startWidth: 1408, startHeight: 1840,
    dx: 40, dy: 40, scale: 0.2, snap: 16, lockRatio: true,
  });
  assert.ok(bigger.width > small.width, "keeps growing smoothly");
  // ratio approximately kept (within a snap step of proportional)
  assert.ok(Math.abs(bigger.width / bigger.height - 1408 / 1840) < 0.05);
});

test("16:9 at /16 offers 1280x720", () => {
  const list = quickSizes(1280, 720, 16);
  assert.ok(list.some((s) => s.width === 1280 && s.height === 720),
    JSON.stringify(list));
  for (const size of list) assert.equal(size.width * 9, size.height * 16);
});

test("7:4 at /32 offers the 1344x768 video canvas", () => {
  const list = quickSizes(1344, 768, 32);
  assert.ok(list.some((s) => s.width === 1344 && s.height === 768),
    JSON.stringify(list));
});

test("awkward ratios yield short lists rather than junk", () => {
  const list = quickSizes(768, 1120, 64); // 24:35 at /64: huge stride
  assert.ok(list.length >= 1);
  for (const size of list) assert.equal(size.width * 35, size.height * 24);
});

// ---------- ladder, pins, misc ----------

test("MP stepping walks the rung ladder from the nearest rung", () => {
  assert.equal(stepMegapixels(1.03, +1), 1.5);
  assert.equal(stepMegapixels(1.03, -1), 0.5);
  assert.equal(stepMegapixels(MP_LADDER[0], -1), MP_LADDER[0]);
});

test("pins round-trip, toggle, and cap", () => {
  let pins = parsePins(serializePins([{ w: 1344, h: 768 }]));
  assert.deepEqual(pins, [{ w: 1344, h: 768 }]);
  pins = togglePin(pins, 1024, 1024);
  assert.equal(pins.length, 2);
  pins = togglePin(pins, 1344, 768); // unpin
  assert.deepEqual(pins, [{ w: 1024, h: 1024 }]);
  assert.equal(pinLabel(pins[0]), "1024×1024");
  assert.deepEqual(parsePins("not json"), []);
});

test("offGrid and scrubDim behave", () => {
  assert.equal(offGrid(1920, 1080, 32), true);
  assert.equal(offGrid(1920, 1088, 32), false);
  assert.equal(scrubDim(1024, 2, 32), 1024);   // dead zone: click stays a click
  assert.equal(scrubDim(1024, 43, 32), 1344);  // 40px travel = 10 steps of 32
});

test("applyRatioAtBudget takes an explicit orientation for a square canvas", () => {
  const landscape = applyRatioAtBudget(1024, 1024, { x: 16, y: 9 }, 32, false);
  const portrait = applyRatioAtBudget(1024, 1024, { x: 16, y: 9 }, 32, true);
  assert.ok(landscape.width > landscape.height);
  assert.ok(portrait.height > portrait.width);
  assert.equal(portrait.width, landscape.height);
  assert.equal(portrait.height, landscape.width);
});


test("default ratio sizes preserve both orientations for every shape chip", () => {
  for (const [x, y] of [[1, 1], [4, 3], [3, 2], [16, 9], [7, 4], [2, 1]]) {
    for (const step of [8, 16, 32, 64]) {
      const landscape = defaultSizeForRatio({ x, y }, step);
      const portrait = defaultSizeForRatio({ x: y, y: x }, step);
      assert.equal(landscape.width * y, landscape.height * x);
      assert.deepEqual(portrait, { width: landscape.height, height: landscape.width });
    }
  }
});


test("budgets below one megapixel remain usable", () => {
  const size = sizeForMegapixels(1024, 1024, 0.25, 16);
  assert.deepEqual(size, { width: 496, height: 496 });
});

test("extreme ratio and snap combinations always return bounded dimensions", () => {
  for (const ratio of [{x:999,y:1},{x:1,y:999},{x:997,y:991}]) {
    const size = defaultSizeForRatio(ratio, 1024);
    assert.ok(size.width >= 64 && size.width <= 8192);
    assert.ok(size.height >= 64 && size.height <= 8192);
  }
  assert.deepEqual(orientRatio({x:3,y:4}, true), {x:3,y:4,label:"3:4"});
  assert.deepEqual(orientRatio({x:3,y:4}, false), {x:4,y:3,label:"4:3"});
});
