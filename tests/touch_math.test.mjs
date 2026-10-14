// The math behind Mask by Touch's face (js/shared/touch_math.mjs): the
// touches as text, the pieces a pointer lights up, and the edge steps the
// face works out itself so the picture answers without a run.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BRUSH_RADIUS,
  OUTLINE,
  OWN_LOADERS,
  PIECES_PER_PLANE,
  STROKE_MAX_POINTS,
  TINT,
  TOUCH_MAX_ITEMS,
  TOUCH_MAX_POINTS,
  candidatesAt,
  chipGroups,
  chipLabel,
  cleanWord,
  composeEdge,
  decodeTouches,
  encodeTouches,
  extendStroke,
  fillHoles,
  fineChoice,
  fineEdgeLabel,
  fineMade,
  fineMask,
  goesBehind,
  growMask,
  loaderSignature,
  maskShare,
  nameShown,
  packPlanes,
  paintCover,
  paintStroke,
  paintTint,
  pieceAt,
  pieceMask,
  pieceOverlaps,
  pieceRanks,
  pieceWholes,
  pieceSizes,
  piecesInside,
  pointCount,
  prefixStamps,
  previewPixels,
  readoutText,
  sameTouches,
  shrinkMask,
  smoothMask,
  softenMask,
  stampOf,
  strokePieces,
  thinStroke,
  touchFits,
} from "../js/shared/touch_math.mjs";
import {
  GROUP_MAX,
  areaKey,
  brushStroke,
  cleanItem,
  dropIdleAways,
  hardMask,
  joinMasks,
  maskOn,
  nextGroup,
  numberChip,
  sharedPixels,
} from "../js/shared/touch_math.mjs";

const total = (mask) => mask.reduce((sum, value) => sum + value, 0);

function blank(width, height) {
  return new Uint8Array(width * height);
}

function box(width, height, x0, y0, x1, y1) {
  const mask = blank(width, height);
  for (let y = y0; y < y1; y += 1) mask.fill(1, y * width + x0, y * width + x1);
  return mask;
}

const TAP = { t: "tap", op: 1, x: 160, y: 1450 };
const FIND = { t: "find", op: 1, r: 30, pts: [[150, 1240], [230, 1010], [330, 1150]] };
const PAINT = { t: "paint", op: 0, r: 45, pts: [[640, 120], [760, 170]] };

test("touches survive the trip to text and back", () => {
  const text = encodeTouches("abc", [TAP, FIND, PAINT]);
  assert.equal(text, JSON.stringify({ v: 1, key: "abc", items: [TAP, FIND, PAINT] }));
  assert.deepEqual(decodeTouches(text), { key: "abc", items: [TAP, FIND, PAINT] });
});

test("no touches is the empty text, and the empty text is no touches", () => {
  assert.equal(encodeTouches("abc", []), "");
  assert.deepEqual(decodeTouches(""), { key: "", items: [] });
  assert.deepEqual(decodeTouches("   "), { key: "", items: [] });
});

test("text that is not touches gives none, and never throws", () => {
  for (const text of ["{", "[]", "null", "42", '{"items": 3}', '{"v":1,"items":[{"t":"lasso"}]}', undefined, null, 7]) {
    assert.deepEqual(decodeTouches(text).items, []);
  }
});

test("a touch that is not whole is left out, the rest stay", () => {
  const text = JSON.stringify({ v: 1, key: "k", items: [
    TAP,
    { t: "tap", op: 1, x: "12", y: 3 },
    { t: "find", op: 1, r: 30, pts: [] },
    { t: "paint", op: 1, pts: [[1, 2]] },
    { t: "paint", op: 1, r: 9, pts: [[1, 2], ["a", 2]] },
  ] });
  assert.deepEqual(decodeTouches(text).items, [TAP, { t: "paint", op: 1, r: 9, pts: [[1, 2]] }]);
});

test("touches are written as whole pixels and the brush is kept in range", () => {
  const text = encodeTouches("k", [
    { t: "tap", op: 0, x: 10.6, y: 3.2 },
    { t: "paint", op: 1, r: 0.2, pts: [[1.4, 2.6]] },
    { t: "paint", op: 1, r: 99999, pts: [[1, 2]] },
  ]);
  assert.deepEqual(decodeTouches(text).items, [
    { t: "tap", op: 0, x: 11, y: 3 },
    { t: "paint", op: 1, r: BRUSH_RADIUS[0], pts: [[1, 3]] },
    { t: "paint", op: 1, r: BRUSH_RADIUS[1], pts: [[1, 2]] },
  ]);
});

test("reading stops at the server's caps", () => {
  const many = Array.from({ length: TOUCH_MAX_ITEMS + 30 }, (_, index) => ({ t: "tap", op: 1, x: index, y: 1 }));
  assert.equal(decodeTouches(JSON.stringify({ v: 1, key: "k", items: many })).items.length, TOUCH_MAX_ITEMS);
  const long = { t: "paint", op: 1, r: 5, pts: Array.from({ length: TOUCH_MAX_POINTS }, (_, index) => [index, 1]) };
  const two = decodeTouches(JSON.stringify({ v: 1, key: "k", items: [long, TAP] })).items;
  assert.equal(two.length, 1, "the tap after 20,000 points no longer fits");
  assert.equal(pointCount(two), TOUCH_MAX_POINTS);
});

test("touchFits says whether one more touch stays under the caps", () => {
  const full = Array.from({ length: TOUCH_MAX_ITEMS }, () => TAP);
  assert.equal(touchFits(full.slice(1), TAP), true);
  assert.equal(touchFits(full, TAP), false);
  const long = { t: "paint", op: 1, r: 5, pts: Array.from({ length: TOUCH_MAX_POINTS }, () => [1, 1]) };
  assert.equal(touchFits([long], TAP), false);
});

test("the stamp is 32-bit FNV-1a, the same the server writes", () => {
  assert.equal(stampOf(""), "811c9dc5");
  assert.equal(stampOf("a"), "e40c292c");
  assert.equal(stampOf("foobar"), "bf9cf968");
  assert.equal(stampOf(undefined), "811c9dc5");
});

test("prefixStamps gives the stamp of every shorter list of touches", () => {
  const items = [TAP, FIND, PAINT];
  const stamps = prefixStamps("abc", items);
  assert.equal(stamps.length, 3);
  for (let count = 1; count <= items.length; count += 1) {
    assert.equal(stamps[count - 1], stampOf(encodeTouches("abc", items.slice(0, count))));
  }
  assert.notEqual(prefixStamps("abd", items)[2], stamps[2], "another picture, another stamp");
});

test("a stroke takes a point only once the pointer has moved on", () => {
  const points = [];
  assert.equal(extendStroke(points, 0, 0, 5), true);
  assert.equal(extendStroke(points, 3, 0, 5), false);
  assert.equal(extendStroke(points, 5, 0, 5), true);
  assert.deepEqual(points, [[0, 0], [5, 0]]);
});

test("thinning a stroke keeps its ends and its corners", () => {
  const straight = Array.from({ length: 50 }, (_, index) => [index * 4, 10]);
  assert.deepEqual(thinStroke(straight, 1), [[0, 10], [196, 10]]);
  const corner = [[0, 0], [10, 0], [20, 0], [20, 10], [20, 20]];
  assert.deepEqual(thinStroke(corner, 1), [[0, 0], [20, 0], [20, 20]]);
  assert.deepEqual(thinStroke([[4, 4]], 1), [[4, 4]]);
});

test("a very long stroke is thinned to the most one stroke may hold", () => {
  const wiggle = Array.from({ length: 4000 }, (_, index) => [index, index % 2 ? 40 : 0]);
  const thin = thinStroke(wiggle, 1);
  assert.equal(thin.length, STROKE_MAX_POINTS);
  assert.deepEqual(thin[0], [0, 0]);
  assert.deepEqual(thin[thin.length - 1], [3999, 40]);
});

test("grow is a square brush, and shrink takes it back", () => {
  const dot = box(21, 21, 10, 10, 11, 11);
  const grown = growMask(dot, 21, 21, 3);
  assert.equal(total(grown), 49);
  assert.equal(grown[7 * 21 + 7], 1);
  assert.equal(grown[6 * 21 + 7], 0);
  assert.deepEqual(shrinkMask(grown, 21, 21, 3), dot);
  assert.equal(growMask(dot, 21, 21, 0), dot, "no growth hands the mask back as it is");
});

test("the picture's own edge does not eat into a shrunk mask", () => {
  const left = box(10, 10, 0, 0, 5, 10);
  const shrunk = shrinkMask(left, 10, 10, 2);
  assert.equal(shrunk[0], 1, "the corner on the picture's edge stays");
  assert.equal(shrunk[4], 0, "the side facing the rest of the picture moves in");
  assert.equal(total(shrunk), 30);
});

test("fill holes closes a pinhole and leaves a real opening", () => {
  const solid = box(40, 40, 5, 5, 35, 35);
  solid[20 * 40 + 20] = 0;
  assert.equal(total(fillHoles(solid, 40, 40)), 900);

  const ring = blank(40, 40);
  for (let y = 0; y < 40; y += 1) {
    for (let x = 0; x < 40; x += 1) {
      const distance = Math.hypot(x - 20, y - 20);
      if (distance < 15 && distance > 8) ring[y * 40 + x] = 1;
    }
  }
  const before = total(ring);
  assert.equal(total(fillHoles(ring, 40, 40)), before, "the ring's middle is far over 1% of the ring");
  assert.ok(total(fillHoles(ring, 40, 40, Infinity)) > before, "with no cap the middle is filled");
});

test("fill holes never fills what is open to the picture's edge, and copies", () => {
  const cup = blank(20, 20);
  for (let y = 5; y < 15; y += 1) { cup[y * 20 + 5] = 1; cup[y * 20 + 14] = 1; }
  for (let x = 5; x < 15; x += 1) cup[14 * 20 + x] = 1;
  const filled = fillHoles(cup, 20, 20, Infinity);
  assert.deepEqual(filled, cup);
  assert.notEqual(filled, cup, "a new array, so the picked area itself is never changed");
  assert.equal(total(fillHoles(blank(8, 8), 8, 8)), 0);
});

test("soften keeps the mask between 0 and 1 and spreads its edge", () => {
  const half = box(40, 40, 0, 0, 20, 40);
  const soft = softenMask(half, 40, 40, 3);
  assert.ok(soft instanceof Float32Array);
  assert.ok(soft.every((value) => value >= 0 && value <= 1.000001));
  assert.ok(soft[20 * 40 + 2] > 0.99, "far inside stays full");
  assert.ok(soft[20 * 40 + 37] < 0.01, "far outside stays empty");
  const edge = soft[20 * 40 + 20];
  assert.ok(edge > 0.2 && edge < 0.5, `just outside the edge is partly on (${edge})`);
  assert.deepEqual([...softenMask(half, 40, 40, 0)], [...half]);
});

test("smooth drops a speck and keeps the edge hard", () => {
  const mask = box(60, 60, 10, 10, 50, 50);
  mask[2 * 60 + 2] = 1;
  const smooth = smoothMask(mask, 60, 60, 2);
  assert.ok(smooth instanceof Uint8Array);
  assert.equal(smooth[2 * 60 + 2], 0, "the lone pixel is gone");
  assert.equal(smooth[30 * 60 + 30], 1);
  assert.ok(smooth.every((value) => value === 0 || value === 1));
  assert.equal(smoothMask(mask, 60, 60, 0), mask);
});

test("the edge steps run in the server's order: fill, smooth, grow, soften", () => {
  const raw = box(60, 60, 20, 20, 40, 40);
  raw[30 * 60 + 30] = 0;
  const plain = composeEdge({ raw, width: 60, height: 60 });
  assert.equal(total(plain), 399);
  const filled = composeEdge({ raw, width: 60, height: 60, fill: true });
  assert.equal(total(filled), 400);
  // Grown first, the pinhole would be closed by the growth and never count
  // as a hole; filled first, growing adds exactly the border.
  const grown = composeEdge({ raw, width: 60, height: 60, fill: true, grow: 2 });
  assert.equal(total(grown), 24 * 24);
  const shrunk = composeEdge({ raw, width: 60, height: 60, fill: true, grow: -2 });
  assert.equal(total(shrunk), 16 * 16);
  const soft = composeEdge({ raw, width: 60, height: 60, fill: true, soften: 2 });
  assert.ok(soft[20 * 60 + 18] > 0 && soft[20 * 60 + 18] < 1);
});

test("a setting that is on never rounds away on the small copy", () => {
  assert.equal(previewPixels(0, 0.5), 0);
  assert.equal(previewPixels(1, 0.2), 1);
  assert.equal(previewPixels(-1, 0.2), -1);
  assert.equal(previewPixels(24, 0.627), 15);
  assert.equal(previewPixels(-24, 0.627), -15);
  assert.equal(previewPixels(8, 1), 8);
});

test("maskShare is the part of the picture a mask covers", () => {
  assert.equal(maskShare(box(10, 10, 0, 0, 5, 10)), 0.5);
  assert.equal(maskShare(new Float32Array([0.5, 0.5, 0, 1])), 0.5);
  assert.equal(maskShare(new Uint8Array(0)), 0);
});

test("a dab of paint is a disc, a stroke is the brush dragged along", () => {
  const dab = paintStroke(blank(41, 41), 41, 41, [[20, 20]], 10, 1);
  const area = total(dab);
  assert.ok(Math.abs(area - Math.PI * 100) < 20, `a disc of radius 10 (${area})`);
  const line = paintStroke(blank(100, 41), 100, 41, [[20, 20], [80, 20]], 10, 1);
  assert.ok(Math.abs(total(line) - (Math.PI * 100 + 60 * 20)) < 60, `a capsule (${total(line)})`);
  assert.equal(line[20 * 100 + 50], 1);
  assert.equal(line[5 * 100 + 50], 0);
});

test("paint that runs off the picture is cut at its edge, and 0 takes away", () => {
  const corner = paintStroke(blank(20, 20), 20, 20, [[-5, -5], [40, 40]], 3, 1);
  assert.equal(corner[0], 1);
  assert.equal(corner[19 * 20 + 19], 1);
  const cleared = paintStroke(box(20, 20, 0, 0, 20, 20), 20, 20, [[10, 10]], 4, 0);
  assert.equal(cleared[10 * 20 + 10], 0);
  assert.equal(cleared[0], 1);
  assert.deepEqual(paintStroke(blank(4, 4), 4, 4, [], 3, 1), blank(4, 4));
});

// Three pieces, one inside the other, and a fourth on the second plane.
function nested() {
  const width = 30;
  const height = 30;
  const small = box(width, height, 12, 12, 16, 16);
  const middle = box(width, height, 8, 8, 20, 20);
  const large = box(width, height, 2, 2, 28, 28);
  const far = box(width, height, 24, 0, 30, 2);
  const planes = [new Uint8ClampedArray(width * height * 4), new Uint8ClampedArray(width * height * 4)];
  const put = (mask, piece) => {
    const rgba = planes[Math.floor(piece / PIECES_PER_PLANE)];
    const bit = piece % PIECES_PER_PLANE;
    for (let index = 0; index < mask.length; index += 1) {
      if (mask[index]) rgba[index * 4 + Math.floor(bit / 8)] |= 1 << (bit % 8);
    }
  };
  put(small, 0);
  put(middle, 9);
  put(large, 17);
  put(far, 25);
  for (const rgba of planes) for (let at = 3; at < rgba.length; at += 4) rgba[at] = 255;
  return { width, height, small, middle, large, far, packed: packPlanes(planes, width, height) };
}

test("pieces come back out of the planes bit for bit", () => {
  const { width, height, small, middle, large, far, packed } = nested();
  assert.deepEqual(pieceMask(packed, 0), small);
  assert.deepEqual(pieceMask(packed, 9), middle);
  assert.deepEqual(pieceMask(packed, 17), large);
  assert.deepEqual(pieceMask(packed, 25), far);
  assert.equal(pieceMask(packed, 60), null);
  const sizes = pieceSizes(packed, 26);
  assert.equal(sizes[0], 16);
  assert.equal(sizes[9], 144);
  assert.equal(sizes[17], 26 * 26);
  assert.equal(sizes[25], 12);
  assert.equal(total(sizes), 16 + 144 + 676 + 12);
  assert.equal(width * height, small.length);
});

test("the pointer lights the smallest piece that would still add something", () => {
  const { width, small, middle, packed } = nested();
  const sizes = pieceSizes(packed, 26);
  const centre = 14 * width + 14;
  const nothing = piecesInside(packed, 26, null);
  assert.equal(pieceAt(packed, centre, { sizes, inside: nothing }), 0);
  // The small one is picked: the same spot now lights the one around it.
  assert.equal(pieceAt(packed, centre, { sizes, inside: piecesInside(packed, 26, small) }), 9);
  assert.equal(pieceAt(packed, centre, { sizes, inside: piecesInside(packed, 26, middle) }), 17);
  assert.equal(pieceAt(packed, 0, { sizes, inside: nothing }), -1, "nothing there");
  assert.equal(pieceAt(packed, 1 * width + 25, { sizes, inside: nothing }), 25, "a piece on the second plane");
});

test("taking away, the pointer lights the smallest piece with picked area in it", () => {
  const { width, small, large, packed } = nested();
  const sizes = pieceSizes(packed, 26);
  const centre = 14 * width + 14;
  assert.equal(pieceAt(packed, centre, { sizes, inside: piecesInside(packed, 26, null), adding: false }), -1);
  assert.equal(pieceAt(packed, centre, { sizes, inside: piecesInside(packed, 26, small), adding: false }), 0);
  // Only the outer band is picked: the two inside it have nothing to give up.
  const band = Uint8Array.from(large, (value, index) => (value && !pieceMask(packed, 9)[index] ? 1 : 0));
  assert.equal(pieceAt(packed, centre, { sizes, inside: piecesInside(packed, 26, band), adding: false }), 17);
});

test("the tint has a line on the mask's edge and a dark hairline outside it", () => {
  const width = 20;
  const height = 20;
  const mask = Float32Array.from(box(width, height, 5, 5, 15, 15));
  const pixels = new Uint8ClampedArray(width * height * 4).fill(9);
  paintTint(pixels, mask, width, height);
  const at = (x, y) => [...pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
  assert.deepEqual(at(5, 5), [...OUTLINE, 255], "the mask's own edge is the line");
  assert.deepEqual(at(10, 10).slice(0, 3), TINT, "inside is the tint");
  assert.ok(at(10, 10)[3] > 100 && at(10, 10)[3] < 160);
  assert.deepEqual(at(4, 10).slice(0, 3), [0, 0, 0], "one pixel out is the hairline");
  assert.ok(at(4, 10)[3] > 0);
  assert.deepEqual(at(1, 1), [0, 0, 0, 0], "the rest is clear");
});

test("nothing picked paints nothing", () => {
  const pixels = new Uint8ClampedArray(16 * 4).fill(200);
  paintTint(pixels, new Float32Array(16), 4, 4);
  assert.ok(pixels.every((value) => value === 0));
});

test("the mask view is black and white, the cut-out covers what is not picked", () => {
  const mask = new Float32Array([1, 0.5, 0, 0]);
  const pixels = new Uint8ClampedArray(16);
  paintCover(pixels, mask, 2, 2, "mask");
  assert.deepEqual([...pixels.slice(0, 8)], [255, 255, 255, 255, 128, 128, 128, 255]);
  assert.deepEqual([...pixels.slice(8, 12)], [0, 0, 0, 255]);
  paintCover(pixels, mask, 2, 2, "cut");
  assert.equal(pixels[3], 0, "the picked pixel shows the picture");
  assert.equal(pixels[11], 255, "an unpicked pixel is covered");
  assert.ok(pixels[7] > 100 && pixels[7] < 150, "a half-picked pixel is half covered");
});

test("the readout says what is picked in plain words", () => {
  assert.equal(readoutText({}), "nothing picked");
  assert.equal(readoutText({ count: 2, share: 0 }), "nothing picked");
  assert.equal(readoutText({ count: 1, share: 0.043, only: "thing" }), "1 thing · 4% of the picture");
  assert.equal(readoutText({ count: 1, share: 0.24, only: "under" }), "the thing under your paint · 24%");
  assert.equal(readoutText({ count: 1, share: 0.03, only: "paint" }), "your paint, as it is · 3%");
  assert.equal(readoutText({ count: 3, share: 0.27 }), "3 picks · 27% of the picture");
  assert.equal(readoutText({ count: 1, share: 0.001, only: "thing" }), "1 thing · under 1% of the picture");
  assert.equal(readoutText({ count: 4, share: 0.2, waiting: true }), "finding it");
});

// ---- named things ----------------------------------------------------------

const NAMED = { t: "name", op: 1, w: "jacket", x: 412, y: 900 };

test("a named touch survives the trip, and its word is cleaned", () => {
  const text = encodeTouches("k", [NAMED, TAP]);
  assert.deepEqual(decodeTouches(text).items, [NAMED, TAP]);
  assert.equal(cleanWord("  fur   collar "), "fur collar");
  assert.equal(cleanWord("pants:16, (shoes)"), "pants 16 shoes", "the text reader's own signs are taken out");
  assert.equal(cleanWord("x".repeat(200)).length, 60);
  assert.deepEqual(decodeTouches(JSON.stringify({ v: 1, key: "k", items: [
    { t: "name", op: 0, w: " teddy  bear ", x: 3.6, y: 9 },
    { t: "name", op: 1, w: ",:", x: 1, y: 1 },
    { t: "name", op: 1, w: "hat" },
  ] })).items, [{ t: "name", op: 0, w: "teddy bear", x: 4, y: 9 }]);
  assert.equal(pointCount([NAMED, TAP, FIND]), 5, "a named touch is one point");
});

// A person (large), the jacket they wear (inside it), a button on the jacket
// found at a point, a wall behind everything, and a "dress" SAM 3 is not
// sure of that covers the jacket too.
function scene() {
  const width = 40;
  const height = 40;
  const masks = {
    button: box(width, height, 18, 18, 20, 20),
    jacket: box(width, height, 12, 12, 26, 28),
    dress: box(width, height, 12, 12, 26, 30),
    person: box(width, height, 10, 4, 28, 36),
    wall: box(width, height, 0, 0, 40, 34),
  };
  // In the order a server sends them: smallest first.
  const order = ["button", "jacket", "dress", "person", "wall"];
  const list = [
    { kind: "point", name: "", sure: 0 },
    { kind: "name", name: "jacket", sure: 0.96 },
    { kind: "name", name: "dress", sure: 0.7 },
    { kind: "name", name: "person", sure: 0.98 },
    { kind: "name", name: "wall", sure: 0.9 },
  ];
  const rgba = new Uint8ClampedArray(width * height * 4);
  order.forEach((name, piece) => {
    masks[name].forEach((value, index) => { if (value) rgba[index * 4 + Math.floor(piece / 8)] |= 1 << (piece % 8); });
  });
  for (let at = 3; at < rgba.length; at += 4) rgba[at] = 255;
  const planes = packPlanes([rgba], width, height);
  const sizes = pieceSizes(planes, list.length);
  return { width, height, masks, list, planes, sizes, ranks: pieceRanks(list, sizes, width * height) };
}

test("pieces are offered sure names first, then points, then unsure names, backdrops last", () => {
  const { width, planes, ranks } = scene();
  // On the button: all five cover it.
  assert.deepEqual(candidatesAt(planes, 19 * width + 19, ranks), [1, 3, 0, 2, 4], "jacket, person, the point piece, dress, wall");
  // On the jacket beside the button.
  assert.deepEqual(candidatesAt(planes, 14 * width + 14, ranks), [1, 3, 2, 4]);
  // On the person's legs: no jacket there.
  assert.deepEqual(candidatesAt(planes, 32 * width + 14, ranks), [3, 4]);
  assert.deepEqual(candidatesAt(planes, 39 * width + 39, ranks), []);
  assert.deepEqual(candidatesAt(planes, 19 * width + 19, null), [0, 1, 2, 3, 4], "without an order: smallest first");
});

test("the pointer lights the jacket, not the person, and goes on when it is picked", () => {
  const { width, masks, planes, sizes, ranks } = scene();
  const spot = 14 * width + 14;
  const none = piecesInside(planes, 5, null);
  assert.equal(pieceAt(planes, spot, { sizes, inside: none, ranks }), 1, "the jacket");
  assert.equal(pieceAt(planes, spot, { sizes, inside: piecesInside(planes, 5, masks.jacket), ranks }), 3, "then the person");
  assert.equal(pieceAt(planes, spot, { sizes, inside: piecesInside(planes, 5, masks.person), ranks }), 4, "then the wall");
  assert.equal(pieceAt(planes, spot, { sizes, inside: piecesInside(planes, 5, masks.person), ranks, adding: false }), 1, "taking away starts with the jacket again");
});

test("a stroke means the piece most of it lies in", () => {
  const { width, height, list, planes, sizes, ranks } = scene();
  const pixels = width * height;
  // Across the jacket, inside the person.
  const across = paintStroke(blank(width, height), width, height, [[14, 20], [24, 20]], 1.5, 1);
  assert.deepEqual(strokePieces(planes, list, sizes, pixels, across, ranks), { candidates: [1, 3, 2, 4], pair: null, pairAt: 0 });
  // Down the legs: the person, then the wall.
  const legs = paintStroke(blank(width, height), width, height, [[19, 30], [19, 33]], 1.5, 1);
  assert.deepEqual(strokePieces(planes, list, sizes, pixels, legs, ranks).candidates, [3, 4]);
  // In the empty corner: nothing.
  const corner = paintStroke(blank(width, height), width, height, [[37, 37], [39, 39]], 1, 1);
  assert.deepEqual(strokePieces(planes, list, sizes, pixels, corner, ranks), { candidates: [], pair: null, pairAt: 0 });
  assert.deepEqual(strokePieces(planes, list, sizes, pixels, blank(width, height), ranks), { candidates: [], pair: null, pairAt: 0 });
});

test("a stroke across a pair takes both", () => {
  // Two shoes side by side with a gap, each a sure name; a stroke crosses
  // both and lies mostly in neither.
  const width = 60;
  const height = 20;
  const left = box(width, height, 5, 5, 25, 15);
  const right = box(width, height, 35, 5, 55, 15);
  const list = [{ kind: "name", name: "shoe", sure: 0.92 }, { kind: "name", name: "shoe", sure: 0.9 }];
  const rgba = new Uint8ClampedArray(width * height * 4);
  left.forEach((value, index) => { if (value) rgba[index * 4] |= 1; });
  right.forEach((value, index) => { if (value) rgba[index * 4] |= 2; });
  for (let at = 3; at < rgba.length; at += 4) rgba[at] = 255;
  const planes = packPlanes([rgba], width, height);
  const sizes = pieceSizes(planes, 2);
  const ranks = pieceRanks(list, sizes, width * height);
  const stroke = paintStroke(blank(width, height), width, height, [[8, 10], [52, 10]], 1.5, 1);
  assert.deepEqual(strokePieces(planes, list, sizes, width * height, stroke, ranks), { candidates: [], pair: [0, 1], pairAt: 0 });
  // Not a pair when SAM 3 is unsure of one of them.
  const unsure = [{ kind: "name", name: "shoe", sure: 0.92 }, { kind: "name", name: "shoe", sure: 0.6 }];
  assert.equal(strokePieces(planes, unsure, sizes, width * height, stroke, pieceRanks(unsure, sizes, width * height)).pair, null);
  // A stroke on one shoe is that shoe alone.
  const one = paintStroke(blank(width, height), width, height, [[8, 10], [22, 10]], 1.5, 1);
  assert.deepEqual(strokePieces(planes, list, sizes, width * height, one, ranks), { candidates: [0], pair: null, pairAt: 0 });
});

test("both shoes come before the person standing in them", () => {
  // A person with two shoes at the bottom; the stroke crosses both shoes
  // and lies wholly in the person.
  const width = 60;
  const height = 60;
  const masks = [
    box(width, height, 10, 44, 26, 54),   // left shoe
    box(width, height, 34, 44, 50, 54),   // right shoe
    box(width, height, 8, 4, 52, 56),     // person
    box(width, height, 0, 40, 60, 60),    // floor: under the shoes and between them
  ];
  const list = [
    { kind: "name", name: "shoe", sure: 0.95 },
    { kind: "name", name: "shoe", sure: 0.92 },
    { kind: "name", name: "person", sure: 0.98 },
    { kind: "name", name: "floor", sure: 0.9 },
  ];
  const rgba = new Uint8ClampedArray(width * height * 4);
  masks.forEach((mask, piece) => mask.forEach((value, index) => { if (value) rgba[index * 4] |= 1 << piece; }));
  for (let at = 3; at < rgba.length; at += 4) rgba[at] = 255;
  const planes = packPlanes([rgba], width, height);
  const sizes = pieceSizes(planes, 4);
  const overlaps = pieceOverlaps(planes, 4);
  const ranks = pieceRanks(list, sizes, width * height, overlaps);
  const wholes = pieceWholes(list, sizes, width * height, overlaps);
  const stroke = paintStroke(blank(width, height), width, height, [[13, 49], [47, 49]], 1.5, 1);
  const found = strokePieces(planes, list, sizes, width * height, stroke, ranks, wholes);
  // The person and the floor each hold the whole stroke; the two shoes
  // together hold most of it and are smaller than either.
  assert.deepEqual(found.candidates, [3, 2], "the floor is smaller than the person here");
  assert.deepEqual(found.pair, [1, 0].sort((a, b) => ranks[a] - ranks[b]));
  assert.equal(found.pairAt, 0, "the pair comes first");
});

test("a stroke over a jacket that crosses its sleeve means the jacket", () => {
  const width = 50;
  const height = 50;
  const masks = [
    box(width, height, 10, 14, 18, 34),   // sleeve
    box(width, height, 20, 20, 30, 30),   // a pocket SAM 3 calls a bag
    box(width, height, 10, 14, 30, 34),   // jacket
  ];
  const list = [
    { kind: "name", name: "sleeve", sure: 0.93 },
    { kind: "name", name: "bag", sure: 0.9 },
    { kind: "name", name: "jacket", sure: 0.96 },
  ];
  const rgba = new Uint8ClampedArray(width * height * 4);
  masks.forEach((mask, piece) => mask.forEach((value, index) => { if (value) rgba[index * 4] |= 1 << piece; }));
  for (let at = 3; at < rgba.length; at += 4) rgba[at] = 255;
  const planes = packPlanes([rgba], width, height);
  const sizes = pieceSizes(planes, 3);
  const overlaps = pieceOverlaps(planes, 3);
  const ranks = pieceRanks(list, sizes, width * height, overlaps);
  const wholes = pieceWholes(list, sizes, width * height, overlaps);
  assert.deepEqual(Array.from(wholes), [2, -1, -1], "the sleeve is part of the jacket; a bag is no part word");
  // Half on the sleeve, half on the pocket: without the part rule the two
  // would be a pair that comes before the jacket.
  const stroke = paintStroke(blank(width, height), width, height, [[11, 24], [28, 24]], 1.5, 1);
  assert.deepEqual(strokePieces(planes, list, sizes, width * height, stroke, ranks, wholes), { candidates: [2], pair: null, pairAt: 0 });
  assert.notEqual(strokePieces(planes, list, sizes, width * height, stroke, ranks).pair, null, "without the table of wholes they pair up");
});

test("a skirt comes before the outfit SAM 3 also calls a dress", () => {
  const width = 40;
  const height = 60;
  const masks = [
    box(width, height, 10, 30, 30, 50),   // skirt: 400 of the dress's 700
    box(width, height, 10, 15, 30, 50),   // "dress": the top and the skirt
    box(width, height, 8, 2, 32, 58),     // person
  ];
  const list = [
    { kind: "name", name: "skirt", sure: 0.98 },
    { kind: "name", name: "dress", sure: 0.89 },
    { kind: "name", name: "person", sure: 0.98 },
  ];
  const rgba = new Uint8ClampedArray(width * height * 4);
  masks.forEach((mask, piece) => mask.forEach((value, index) => { if (value) rgba[index * 4] |= 1 << piece; }));
  for (let at = 3; at < rgba.length; at += 4) rgba[at] = 255;
  const planes = packPlanes([rgba], width, height);
  const sizes = pieceSizes(planes, 3);
  const ranks = pieceRanks(list, sizes, width * height, pieceOverlaps(planes, 3));
  assert.deepEqual(candidatesAt(planes, 40 * width + 20, ranks), [0, 1, 2], "skirt, dress, person");
});

test("one named pick says its name on the node's edge", () => {
  assert.equal(readoutText({ count: 1, share: 0.18, only: "thing", name: "jacket" }), "jacket \u00b7 18% of the picture");
  assert.equal(readoutText({ count: 2, share: 0.3, name: "jacket" }), "2 picks \u00b7 30% of the picture");
});

test("a big part goes behind the thing it is part of, but never behind the person", () => {
  // A person, the jacket on them, a sleeve that is a good third of the
  // jacket, and a small badge on the jacket. All sure.
  const width = 50;
  const height = 50;
  const masks = [
    box(width, height, 22, 22, 24, 24),   // badge: tiny
    box(width, height, 10, 14, 18, 34),   // sleeve: 160 of the jacket's 400
    box(width, height, 10, 14, 30, 34),   // jacket
    box(width, height, 8, 4, 32, 46),     // person
  ];
  const list = [
    { kind: "name", name: "badge", sure: 0.9 },
    { kind: "name", name: "sleeve", sure: 0.93 },
    { kind: "name", name: "jacket", sure: 0.96 },
    { kind: "name", name: "person", sure: 0.98 },
  ];
  const rgba = new Uint8ClampedArray(width * height * 4);
  masks.forEach((mask, piece) => mask.forEach((value, index) => { if (value) rgba[index * 4] |= 1 << piece; }));
  for (let at = 3; at < rgba.length; at += 4) rgba[at] = 255;
  const planes = packPlanes([rgba], width, height);
  const sizes = pieceSizes(planes, 4);
  const overlaps = pieceOverlaps(planes, 4);
  assert.equal(overlaps[1 * 4 + 2], 160, "the sleeve lies in the jacket");
  assert.equal(overlaps[2 * 4 + 1], 160);
  assert.equal(overlaps[0 * 4 + 1], 0, "the badge is not on the sleeve");
  const ranks = pieceRanks(list, sizes, width * height, overlaps);
  // On the sleeve: the jacket first, then the sleeve, then the person.
  assert.deepEqual(candidatesAt(planes, 20 * width + 12, ranks), [2, 1, 3]);
  // On the badge: a small part is meant as itself.
  assert.deepEqual(candidatesAt(planes, 23 * width + 23, ranks), [0, 2, 3]);
  // The jacket is nearly half the person and still comes before it.
  assert.deepEqual(candidatesAt(planes, 30 * width + 26, ranks), [2, 3]);
  // Without the table of overlaps nothing is moved: smallest first.
  assert.deepEqual(candidatesAt(planes, 20 * width + 12, pieceRanks(list, sizes, width * height)), [1, 2, 3]);
});

test("a pick of every thing of a name survives the trip", () => {
  const text = encodeTouches("k", [{ t: "all", op: 1, w: " neon,  sign " }, { t: "all", op: 0, w: "bird" }, { t: "all", op: 1, w: " ,: " }]);
  assert.deepEqual(decodeTouches(text).items, [{ t: "all", op: 1, w: "neon sign" }, { t: "all", op: 0, w: "bird" }]);
  assert.equal(touchFits([], { t: "all", op: 1, w: "bird" }), true);
});

test("each pick has a short name for its chip", () => {
  assert.equal(chipLabel({ t: "name", op: 1, w: "jacket", x: 1, y: 2 }), "jacket");
  assert.equal(chipLabel({ t: "name", op: 0, w: "cup", x: 1, y: 2 }), "\u2212 cup");
  assert.equal(chipLabel({ t: "all", op: 1, w: "bird" }), "every bird");
  assert.equal(chipLabel({ t: "all", op: 1, w: "bird" }, 5), "5 \u00d7 bird");
  assert.equal(chipLabel({ t: "tap", op: 1, x: 1, y: 2 }), "thing");
  assert.equal(chipLabel({ t: "find", op: 1, r: 4, pts: [[1, 2]] }), "stroke");
  assert.equal(chipLabel({ t: "paint", op: 0, r: 4, pts: [[1, 2]] }), "\u2212 paint");
});

test("two touches are the same when they are written the same", () => {
  const cup = { t: "name", op: 1, w: "cup", x: 10, y: 20 };
  // A touch fresh from a click and the same one read back from the widget: the key order differs.
  assert.equal(sameTouches([cup], decodeTouches(encodeTouches("k", [{ y: 20, x: 10, w: "cup", op: 1, t: "name" }])).items), true);
  assert.equal(sameTouches([cup], [{ ...cup, op: 0 }]), false);
  assert.equal(sameTouches([cup], [{ ...cup, w: "mug" }]), false);
  assert.equal(sameTouches([cup], [cup, cup]), false);
  assert.equal(sameTouches([], []), true);
  const stroke = { t: "find", op: 1, r: 12, pts: [[1, 2], [3, 4]] };
  assert.equal(sameTouches([stroke], [{ ...stroke, pts: [[1, 2], [3, 4]] }]), true);
  assert.equal(sameTouches([stroke], [{ ...stroke, t: "paint" }]), false);
});

test("a chip is an area: a pick, or paint, with the brush marks that joined it", () => {
  const paint = (op, g) => ({ t: "paint", op, r: 4, pts: [[1, 2]], ...(g ? { g } : {}) });
  const cup = (g) => ({ t: "name", op: 1, w: "cup", x: 1, y: 2, ...(g ? { g } : {}) });
  assert.deepEqual(chipGroups([]), []);
  // Marks painted onto a pick carry its number and share its chip, wherever they are in the list.
  assert.deepEqual(chipGroups([cup(1), paint(1, 2), paint(1, 1), paint(1, 2)]), [
    { g: 1, first: 0, at: [0, 2], paint: false, marks: 1, away: false },
    { g: 2, first: 1, at: [1, 3], paint: true, marks: 2, away: false },
  ]);
  // Two picks of the same name are two chips.
  assert.equal(chipGroups([cup(1), cup(2)]).length, 2);
});

test("a thing taken away has a chip of its own, a brush mark that erases has none", () => {
  const erase = { t: "paint", op: 0, r: 4, pts: [[1, 2]] };
  const cup = { t: "name", op: 1, w: "cup", x: 1, y: 2, g: 1 };
  const things = [{ t: "tap", op: 0, x: 1, y: 2 }, { t: "name", op: 0, w: "face", x: 1, y: 2 }, { t: "all", op: 0, w: "hair" }, { t: "subject", op: 0 }, { t: "find", op: 0, r: 4, pts: [[1, 2]] }];
  assert.deepEqual(chipGroups([erase, erase]), []);
  assert.deepEqual(chipGroups([cup, erase, things[1], erase]), [
    { g: 1, first: 0, at: [0], paint: false, marks: 0, away: false },
    { g: 0, first: 2, at: [2], paint: false, marks: 0, away: true },
  ]);
  assert.deepEqual(chipGroups(things).map((chip) => [chip.first, chip.away]), things.map((_, index) => [index, true]));
});

test("touches saved before chips had numbers are told apart as they were", () => {
  const paint = (op) => ({ t: "paint", op, r: 4, pts: [[1, 2]] });
  const cup = { t: "name", op: 1, w: "cup", x: 1, y: 2 };
  // Marks that follow each other share a chip, rubbing out or not.
  assert.deepEqual(chipGroups([paint(1), paint(1), paint(0), paint(1)]), [{ g: 0, first: 0, at: [0, 1, 3], paint: true, marks: 3, away: false }]);
  // A pick between two runs of paint keeps them apart.
  assert.deepEqual(chipGroups([paint(1), paint(1), cup, paint(0), paint(1)]).map((chip) => [chip.first, chip.at.length, chip.paint]), [
    [0, 2, true], [2, 1, false], [4, 1, true],
  ]);
  assert.equal(chipGroups([cup, cup, { t: "find", op: 1, r: 4, pts: [[1, 2]] }]).length, 3);
});

test("a chip gets a number the moment something joins it", () => {
  const items = [{ t: "name", op: 1, w: "cup", x: 1, y: 2 }, { t: "paint", op: 1, r: 4, pts: [[1, 2]], g: 7 }];
  assert.equal(nextGroup(items), 8);
  assert.equal(nextGroup(items, 12), 13, "a number that is spoken for is passed over");
  assert.equal(nextGroup([]), 1);
  const [cup, marks] = chipGroups(items);
  const numbered = numberChip(items, cup);
  assert.equal(numbered.g, 8);
  assert.deepEqual(numbered.items.map((item) => item.g), [8, 7]);
  assert.equal(items[0].g, undefined, "the list it was given is left alone");
  const same = numberChip(items, marks);
  assert.equal(same.g, 7);
  assert.equal(same.items, items, "a chip with a number keeps it");
});

test("the chip a touch is in is kept, and only for a touch that adds", () => {
  assert.deepEqual(cleanItem({ t: "tap", op: 1, x: 1, y: 2, g: 3 }), { t: "tap", op: 1, x: 1, y: 2, g: 3 });
  assert.deepEqual(cleanItem({ t: "name", op: 1, w: "cup", x: 1, y: 2, q: 1, g: 3 }), { t: "name", op: 1, w: "cup", x: 1, y: 2, q: 1, g: 3 });
  assert.deepEqual(cleanItem({ t: "all", op: 1, w: "cup", g: 3 }), { t: "all", op: 1, w: "cup", g: 3 });
  assert.deepEqual(cleanItem({ t: "subject", op: 1, g: 3 }), { t: "subject", op: 1, g: 3 });
  assert.deepEqual(cleanItem({ t: "paint", op: 1, r: 4, pts: [[1, 2]], g: 3 }), { t: "paint", op: 1, r: 4, pts: [[1, 2]], g: 3 });
  // Taking away belongs to no chip.
  assert.deepEqual(cleanItem({ t: "paint", op: 0, r: 4, pts: [[1, 2]], g: 3 }), { t: "paint", op: 0, r: 4, pts: [[1, 2]] });
  for (const g of [0, -1, 1.5, "2", null, GROUP_MAX + 1]) {
    assert.equal(cleanItem({ t: "tap", op: 1, x: 1, y: 2, g }).g, undefined, `${g} is no chip`);
  }
  // A touch written by an older version reads back exactly as it was.
  const old = { t: "paint", op: 1, r: 4, pts: [[1, 2]] };
  assert.deepEqual(cleanItem(old), old);
  assert.equal(encodeTouches("k", [old]), '{"v":1,"key":"k","items":[{"t":"paint","op":1,"r":4,"pts":[[1,2]]}]}');
});

test("a brush mark keeps how soft its brush was", () => {
  assert.equal(cleanItem({ t: "paint", op: 1, r: 4, pts: [[1, 2]], s: 40 }).s, 40);
  assert.equal(cleanItem({ t: "paint", op: 0, r: 4, pts: [[1, 2]], s: 250 }).s, 100);
  assert.equal(cleanItem({ t: "paint", op: 1, r: 4, pts: [[1, 2]], s: 0 }).s, undefined, "a hard brush has none");
  assert.equal(cleanItem({ t: "paint", op: 1, r: 4, pts: [[1, 2]], s: "soft" }).s, undefined);
  assert.equal(cleanItem({ t: "find", op: 1, r: 4, pts: [[1, 2]], s: 40 }).s, undefined, "a stroke that finds a thing has no edge of its own");
});

test("the same picks are the same touches, whichever chip they are in", () => {
  const cup = { t: "name", op: 1, w: "cup", x: 1, y: 2 };
  assert.equal(sameTouches([{ ...cup, g: 4 }], [cup]), true);
  assert.equal(sameTouches([{ ...cup, g: 4 }], [{ ...cup, g: 9 }]), true);
  assert.equal(sameTouches([{ ...cup, g: 4 }], [{ ...cup, op: 0 }]), false);
});

test("a touch that takes away with nothing before it is dropped", () => {
  const add = { t: "tap", op: 1, x: 1, y: 2, g: 1 };
  const away = { t: "paint", op: 0, r: 4, pts: [[1, 2]] };
  assert.deepEqual(dropIdleAways([away, away, add, away]), [add, away]);
  assert.deepEqual(dropIdleAways([away]), []);
  assert.deepEqual(dropIdleAways([add]), [add]);
});

test("the area of a touch is known by what it picks, not by what it is used for", () => {
  const cup = { t: "name", op: 1, w: "cup", x: 1, y: 2, g: 4 };
  assert.equal(areaKey(cup), areaKey({ ...cup, op: 0, g: undefined, q: 1 }));
  assert.notEqual(areaKey(cup), areaKey({ ...cup, x: 2 }));
  assert.notEqual(areaKey({ t: "paint", op: 1, r: 4, pts: [[1, 2]] }), areaKey({ t: "paint", op: 1, r: 4, pts: [[1, 2]], s: 50 }));
  assert.notEqual(areaKey({ t: "paint", op: 1, r: 4, pts: [[1, 2]] }), areaKey({ t: "find", op: 1, r: 4, pts: [[1, 2]] }));
});

// ---- a soft brush -------------------------------------------------------------

test("a hard brush mark is on or off, a soft one fades", () => {
  const [width, height] = [120, 80];
  const points = [[30, 40], [90, 40]];
  const hard = brushStroke(width, height, points, 10, 0);
  assert.ok(hard instanceof Uint8Array);
  assert.deepEqual(hard, paintStroke(new Uint8Array(width * height), width, height, points, 10, 1));
  const soft = brushStroke(width, height, points, 10, 100);
  assert.ok(soft instanceof Float32Array);
  const at = (x, y) => soft[y * width + x];
  assert.ok(at(60, 40) > 0.9, "solid along the middle");
  assert.ok(at(60, 34) > 0.25 && at(60, 34) < 0.85, "half way out it is partly there");
  assert.ok(at(60, 28) < 0.1, "little is left at the ring");
  assert.equal(at(60, 10), 0, "and nothing far off");
  // Softer is wider at the faint end and thinner at the strong end.
  const softer = brushStroke(width, height, points, 10, 50);
  assert.ok(softer[36 * width + 60] > at(60, 36));
});

test("a soft mark that runs off the picture keeps its fade at the edge", () => {
  const soft = brushStroke(60, 60, [[-30, 30], [30, 30]], 12, 100);
  // The stroke goes on past the left edge, so the edge pixel is as strong as the middle of the line.
  assert.ok(Math.abs(soft[30 * 60] - soft[30 * 60 + 15]) < 0.02);
  assert.ok(soft[30 * 60] > 0.9);
});

test("joining areas: on/off stays on/off, anything soft makes it soft", () => {
  const one = Uint8Array.from([1, 1, 0, 0]);
  const other = Uint8Array.from([1, 0, 1, 0]);
  assert.deepEqual(joinMasks(one, other, 1), Uint8Array.from([1, 1, 1, 0]));
  assert.deepEqual(joinMasks(one, other, 0), Uint8Array.from([0, 1, 0, 0]));
  const soft = Float32Array.from([0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual([...joinMasks(one, soft, 1)], [1, 1, 0.5, 0.5]);
  assert.deepEqual([...joinMasks(one, soft, 0)], [0.5, 0.5, 0, 0]);
  assert.deepEqual([...joinMasks(soft, other, 0)], [0, 0.5, 0, 0.5]);
  assert.equal(maskOn(joinMasks(one, one, 0)), false);
  assert.equal(maskOn(soft), true);
  assert.deepEqual(hardMask(Float32Array.from([0.49, 0.5, 1, 0])), Uint8Array.from([0, 1, 1, 0]));
  assert.equal(sharedPixels(Uint8Array.from([1, 1, 0]), Float32Array.from([0.6, 0.4, 1])), 1);
});

test("the edge settings give the same mask whether the pick is kept on/off or as numbers", () => {
  const [width, height] = [90, 70];
  const raw = paintStroke(new Uint8Array(width * height), width, height, [[20, 20], [70, 50], [30, 55]], 9, 1);
  // A hole and a ragged bit, so Fill and Smooth have work.
  for (const index of [35 * width + 45, 35 * width + 46, 36 * width + 45]) raw[index] = 0;
  raw[8 * width + 20] = 1;
  const numbers = Float32Array.from(raw);
  for (const settings of [{}, { grow: 5 }, { grow: -3 }, { smooth: 4 }, { fill: true }, { soften: 2.5 }, { fill: true, smooth: 3, grow: 4, soften: 3 }]) {
    const hard = composeEdge({ raw, width, height, ...settings });
    const soft = composeEdge({ raw: numbers, width, height, ...settings });
    for (let index = 0; index < hard.length; index += 1) {
      assert.ok(Math.abs(hard[index] - soft[index]) < 1e-6, `${JSON.stringify(settings)} differs at ${index}`);
    }
  }
});

test("Grow and Shrink move a soft edge and keep it soft", () => {
  const [width, height] = [160, 120];
  const soft = brushStroke(width, height, [[80, 60]], 40, 100);
  const grown = composeEdge({ raw: soft, width, height, grow: 6 });
  const shrunk = composeEdge({ raw: soft, width, height, grow: -6 });
  const row = (mask) => Array.from({ length: width }, (_, x) => mask[60 * width + x]);
  const half = (mask) => row(mask).filter((value) => value >= 0.5).length;
  // Six pixels on each side, give or take the pixel the half line falls in.
  assert.ok(Math.abs(half(grown) - half(soft) - 12) <= 2, `grew by ${half(grown) - half(soft)}`);
  assert.ok(Math.abs(half(soft) - half(shrunk) - 12) <= 2, `shrank by ${half(soft) - half(shrunk)}`);
  assert.ok(row(grown).some((value) => value > 0.05 && value < 0.95), "the fade is still there");
});

// ---- fine edges ---------------------------------------------------------------

test("Fine edges is on only while the input holds a model file", () => {
  for (const value of [undefined, null, "", " ", "off", " off "]) assert.equal(fineChoice(value), "", JSON.stringify(value));
  assert.equal(fineChoice("model.safetensors"), "model.safetensors");
  assert.equal(fineChoice(" sub/model.safetensors "), "sub/model.safetensors");
});

test("the Fine edges choices read off and on, and by name only when there are several files", () => {
  assert.equal(fineEdgeLabel("off", ["off", "model.safetensors"]), "off");
  assert.equal(fineEdgeLabel("model.safetensors", ["off", "model.safetensors"]), "on");
  // A workflow that names a file this machine does not have: still "on", so it reads as what was chosen.
  assert.equal(fineEdgeLabel("model.safetensors", ["off"]), "on");
  const several = ["off", "small/model.safetensors", "vitmatte_base.safetensors"];
  assert.equal(fineEdgeLabel("small/model.safetensors", several), "model");
  assert.equal(fineEdgeLabel("vitmatte_base.safetensors", several), "vitmatte_base");
  assert.equal(fineEdgeLabel("off", several), "off");
});

test("the line of settings a fine edge was made with is the one the node writes", () => {
  // The same strings as fine_made in nodes/node_mask_by_touch.py (tests/test_mask_by_touch.py holds that side).
  assert.equal(fineMade({ grow: 0, soften: 0, smooth: 0, fill: true, invert: false, fine: "model.safetensors" }), "0|0.000|0|1|0|model.safetensors");
  assert.equal(fineMade({ grow: 12, soften: 0.5, smooth: 3, fill: false, invert: true, fine: "a/b.safetensors" }), "12|0.500|3|0|1|a/b.safetensors");
  assert.notEqual(fineMade({ grow: 1, fine: "m" }), fineMade({ grow: 2, fine: "m" }), "any setting that changes the mask changes the line");
  assert.notEqual(fineMade({ soften: 1, fine: "m" }), fineMade({ soften: 1.5, fine: "m" }));
  assert.notEqual(fineMade({ invert: true, fine: "m" }), fineMade({ invert: false, fine: "m" }));
});

test("a fine edge's mask is its picture's see-through channel", () => {
  const rgba = new Uint8ClampedArray([10, 20, 30, 0, 40, 50, 60, 128, 70, 80, 90, 255]);
  assert.deepEqual([...fineMask(rgba)].map((value) => Math.round(value * 1000) / 1000), [0, 0.502, 1]);
});

test("with clean colours the cut-out is drawn whole, and nothing of the picture shows through", () => {
  const mask = new Float32Array([1, 0.5, 0, 1]);
  const colours = new Uint8ClampedArray([200, 0, 0, 255, 200, 0, 0, 128, 0, 0, 0, 0, 0, 100, 0, 255]);
  const pixels = paintCover(new Uint8ClampedArray(16), mask, 2, 2, "cut", colours);
  assert.deepEqual([...pixels.slice(0, 4)], [200, 0, 0, 255], "all the thing: its clean colour, solid");
  assert.equal(pixels[7], 255, "half see-through: still solid, the chequer mixed in under it");
  assert.ok(pixels[4] > 100 && pixels[4] < 200 && pixels[5] > 0, "half the clean colour, half the chequer");
  assert.equal(pixels[11], 255, "not the thing: the chequer, solid");
  assert.ok(pixels[8] < 60 && pixels[9] < 60 && pixels[10] < 60);
  // Without clean colours it is a cover with a hole, as before: the picture shows through where the mask is.
  const plain = paintCover(new Uint8ClampedArray(16), mask, 2, 2, "cut");
  assert.deepEqual([plain[3], plain[7], plain[11]], [0, 128, 255]);
  // The mask view does not care about colours.
  assert.deepEqual([...paintCover(new Uint8ClampedArray(16), mask, 2, 2, "mask", colours).slice(4, 8)], [128, 128, 128, 255]);
});

// ---- the subject, the background, and names SAM 3 is not sure of ---------------

test("the subject and the background are picks without a point or a word", () => {
  const text = encodeTouches("k", [{ t: "subject", op: 1, x: 5, w: "junk" }, { t: "background", op: 0 }]);
  assert.deepEqual(decodeTouches(text).items, [{ t: "subject", op: 1 }, { t: "background", op: 0 }]);
  assert.equal(chipLabel({ t: "subject", op: 1 }), "subject");
  assert.equal(chipLabel({ t: "background", op: 0 }), "\u2212 background");
  assert.equal(touchFits([], { t: "subject", op: 1 }), true);
});

test("a word that was not shown is kept quiet: picked, saved, and called a thing", () => {
  const quiet = { t: "name", op: 1, w: "foot", x: 10, y: 20, q: 1 };
  const loud = { t: "name", op: 1, w: "hair", x: 10, y: 20 };
  const round = decodeTouches(encodeTouches("k", [quiet, loud])).items;
  assert.deepEqual(round, [quiet, loud], "the mark is saved, and only where it is set");
  assert.equal(chipLabel(quiet), "thing");
  assert.equal(chipLabel({ ...quiet, op: 0 }), "\u2212 thing");
  assert.equal(chipLabel(loud), "hair");
  assert.deepEqual(decodeTouches(encodeTouches("k", [{ ...loud, q: 0 }, { ...loud, q: "yes" }])).items, [loud, loud], "anything but 1 is not the mark");
  assert.equal(sameTouches([quiet], [loud]), false);
});

test("a name is shown only when SAM 3 is sure of it, and surer still for a big thing", () => {
  // The numbers come from 1137 names on 22 pictures: under 0.8 one name in three was wrong.
  assert.equal(nameShown(0.79, 0.05), false);
  assert.equal(nameShown(0.8, 0.05), true);
  assert.equal(nameShown(0.99, 0.05), true);
  // A big thing: "mirror" at 0.81 and "poster" at 0.898 were both wrong, the right big ones all 0.958 or more.
  assert.equal(nameShown(0.898, 0.95), false);
  assert.equal(nameShown(0.89, 0.3), false);
  assert.equal(nameShown(0.9, 0.3), true);
  assert.equal(nameShown(0.85, 0.29), true);
  assert.equal(nameShown(undefined, undefined), false);
});

test("the pack's own picture loaders are the ones the node runs by itself", () => {
  assert.deepEqual([...OWN_LOADERS].sort(), ["AUSBOSS_NODES_ImageCropRotatePad", "AUSBOSS_NODES_LoadImagePad"]);
  // A core Load Image is not in the list: its file is the picture, and the node shows it without a run.
  assert.equal(OWN_LOADERS.has("LoadImage"), false);
});

test("a loader's file and settings make one text, and another text means another picture", () => {
  const widgets = (over = {}) => [
    { name: "image", value: "photo.png" },
    { name: "rotation_degrees", value: 0 },
    { name: "crop_width", value: 0 },
    { name: "resize_to_megapixels", value: false },
    // What is only drawn carries no setting: a panel, a card, a button.
    { name: "ausboss_panel", value: "", serialize: false },
    { name: "upload", value: {} },
    { value: 3 },
    null,
  ].map((widget) => (widget && over[widget.name] !== undefined ? { ...widget, value: over[widget.name] } : widget));
  const base = loaderSignature(widgets());
  assert.equal(base, '[["image","photo.png"],["rotation_degrees",0],["crop_width",0],["resize_to_megapixels",false]]');
  assert.equal(loaderSignature(widgets()), base);
  assert.notEqual(loaderSignature(widgets({ image: "other.png" })), base);
  assert.notEqual(loaderSignature(widgets({ crop_width: 512 })), base);
  assert.notEqual(loaderSignature(widgets({ rotation_degrees: 90 })), base);
  assert.equal(loaderSignature(undefined), "[]");
});

test("the node asks for its own loader's picture only in answer to the person, never while a workflow opens", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const stage = readFileSync(join(root, "js", "shared", "touch_stage.mjs"), "utf-8");
  const show = stage.slice(stage.indexOf("function showOwnPicture"), stage.indexOf("function followOwnLoader"));
  // the same run the Show picture button asks for
  assert.match(show, /requestRun\(face, "scope"\)/);
  // never with the look-on-button setting, never over picks that wait for their own press
  assert.match(show, /face\.host\.lookOnButton\?\.\(\)/);
  assert.match(show, /face\.pic && face\.held > 0/);
  const follow = stage.slice(stage.indexOf("function followOwnLoader"), stage.indexOf("const OTHER_PICTURE"));
  assert.match(follow, /!face\.host\.loading\?\.\(\)/);
  assert.match(stage, /if \(!face\.host\.loading\?\.\(\)\) followOwnLoader\(face, true\)/);
  const host = readFileSync(join(root, "js", "mask_by_touch", "index.js"), "utf-8");
  assert.match(host, /loading: \(\) => Boolean\(app\.configuringGraph\)/);
});

test("a look at another picture goes behind the look at the old one, which ends it", () => {
  const look = (epoch, queued = true) => ({ ask: "scope", epoch, queued });
  // nothing on its way: anything is sent
  assert.equal(goesBehind([], "scope", 1), true);
  assert.equal(goesBehind(undefined, "look", 1), true);
  // a click never waits for a look
  assert.equal(goesBehind([look(1)], "look", 1), true);
  // a second look at the same picture waits for the first
  assert.equal(goesBehind([look(1)], "scope", 1), false);
  // another picture was chosen while the first was looked at: its look is sent at once
  assert.equal(goesBehind([look(1)], "scope", 2), true);
  // and again for a third picture, behind the two that are now old
  assert.equal(goesBehind([look(1), look(2)], "scope", 3), true);
  // but not behind a look at the picture that is on the node now
  assert.equal(goesBehind([look(1), look(2)], "scope", 2), false);
  // a look ComfyUI does not have yet cannot be ended by a job behind it
  assert.equal(goesBehind([look(1, false)], "scope", 2), false);
  assert.equal(goesBehind([look(1, false)], "look", 1), false);
  // a run that is no look does not give way
  assert.equal(goesBehind([{ ask: "look", epoch: 1, queued: true }], "scope", 2), false);
  assert.equal(goesBehind([{ ask: "look", epoch: 1, queued: true }], "look", 2), false);
});

test("both kinds of loader send the new picture's look without waiting for the old one", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const stage = readFileSync(join(root, "js", "shared", "touch_stage.mjs"), "utf-8");
  const run = stage.slice(stage.indexOf("function requestRun"), stage.indexOf("function settle"));
  assert.match(run, /goesBehind\(face\.flying, ask, face\.sourceEpoch\)/);
  // the pack's own loaders: the picture counts as asked for only once its run was really sent
  const show = stage.slice(stage.indexOf("function showOwnPicture"), stage.indexOf("function followOwnLoader"));
  assert.match(show, /if \(requestRun\(face, "scope"\)\) face\.ownSeen = seen/);
  assert.doesNotMatch(show, /if \(face\.inFlight\) \{\s*followOwnLoader/);
  // a plain Load Image: another file while a look is on its way sends this file's look behind it
  const source = stage.slice(stage.indexOf("function syncSource"), stage.indexOf("function imageOrigin"));
  assert.match(source, /if \(face\.flying\.length\) requestRun\(face, "look"\)/);
});

test("while the node still looks at a picture it says so, a lit thing is taken at once, and one click can wait", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const stage = readFileSync(join(root, "js", "shared", "touch_stage.mjs"), "utf-8");
  const wait = stage.slice(stage.indexOf("function waitForLook"), stage.indexOf("function dropPending"));
  // what lights up is what a click takes: a click on a lit thing never waits, whatever its name is worth
  assert.match(wait, /if \(pieceUnder\(face, \[x, y\], true\) >= 0\) \{[\s\S]*?return false;\s*\}/);
  assert.ok(wait.indexOf("pieceUnder(face, [x, y], true)") < wait.indexOf("face.pending.push("));
  // where nothing is lit, one click waits at a time: a second one is answered by the message, never added
  assert.match(wait, /if \(face\.pending\.length\) \{\s*nudge\(face\);\s*return true;\s*\}/);
  assert.equal((wait.match(/face\.pending\.push\(/g) ?? []).length, 1);
  // hovering is not held back while it looks
  const hover = stage.slice(stage.indexOf("function refreshHover"), stage.indexOf("const PAST_KEPT"));
  assert.doesNotMatch(hover, /notReady/);
  // a click on a lit thing does not rush the click that still waits
  assert.match(stage, /if \(!notReady\(face\)\) flushPending\(face\);\s*pickAt\(face, x, y, op\);/);
  // the message follows every change of state and of the line under the picture
  const looking = stage.slice(stage.indexOf("function syncLooking"), stage.indexOf("function nudge"));
  assert.match(looking, /notReady\(face\) && \(face\.inFlight \|\| waits( \|\| paused)?\)/);
  // Said on the button under the picture, never on the picture itself.
  assert.match(looking, /Looking at the picture/);
  assert.match(looking, /Click to pause/);
  assert.match(looking, /Paused at/);
  assert.match(stage, /your click is in/);
  assert.doesNotMatch(stage, /frame\.append\([^)]*look/);
  assert.match(stage.slice(stage.indexOf("function syncReadout"), stage.indexOf("function removeChip")), /syncLooking\(face\)/);
  assert.match(stage.slice(stage.indexOf("function syncState"), stage.indexOf("function setNote")), /syncLooking\(face\)/);
});
