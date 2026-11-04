import assert from "node:assert/strict";
import test from "node:test";

import { grabZone, outputSummary, outputWindow, typedTrimBounds, wavePeaks, wiredMax } from "../js/load_audio/audio_window.mjs";

function maxLink(source, originSlot = 0, linkStore = "object") {
  const link = { origin_id: 1, origin_slot: originSlot };
  const graph = { getNodeById: () => source };
  if (linkStore === "map") graph.links = new Map([[2, link]]);
  else if (linkStore === "getter") graph.getLink = () => link;
  else graph.links = { 2: link };
  return { inputs: [{ name: "max_seconds", widget: { name: "max_seconds" }, link: 2 }], graph };
}

test("wired Max length only reads the connected output of an unlinked literal", () => {
  assert.deepEqual(wiredMax({}), { wired: false, value: null });
  const video = { type: "AUSBOSS_NODES_LoadVideo", widgets: [{ name: "start_seconds", value: 4 }, { name: "end_seconds", value: 14 }] };
  assert.deepEqual(wiredMax(maxLink(video, 7)), { wired: true, value: null });
  for (const type of ["AUSBOSS_NODES_Float", "AUSBOSS_NODES_Integer", "PrimitiveFloat", "PrimitiveInt"]) {
    const source = { type, widgets: [{ name: "unrelated", value: 4 }, { name: "value", value: 10 }] };
    for (const store of ["object", "map", "getter"]) {
      assert.deepEqual(wiredMax(maxLink(source, 0, store)), { wired: true, value: 10 });
    }
    assert.equal(wiredMax(maxLink(source, 1)).value, null);
    source.inputs = [{ name: "value", widget: { name: "value" }, link: 9 }];
    assert.equal(wiredMax(maxLink(source)).value, null);
    source.inputs = [];
    source.mode = 4;
    assert.equal(wiredMax(maxLink(source)).value, null);
    source.mode = 0;
    source.widgets[1].value = NaN;
    assert.equal(wiredMax(maxLink(source)).value, null);
  }
});

test("typing OUT zero restores the file end while other typed times keep handle limits", () => {
  assert.deepEqual(typedTrimBounds(10, { start: 2, end: 5 }, "end", 0), { start: 2, end: 10 });
  assert.deepEqual(typedTrimBounds(10, { start: 2, end: 5 }, "end", 1), { start: 2, end: 2.1 });
  assert.deepEqual(typedTrimBounds(10, { start: 2, end: 5 }, "end", 7), { start: 2, end: 7 });
  assert.deepEqual(typedTrimBounds(10, { start: 2, end: 5 }, "start", 0), { start: 0, end: 5 });
});

test("the face shows what the node hands on", () => {
  // Mirrors audio_window in nodes/_audio_trim_helpers.py.
  assert.deepEqual(outputWindow(40, 8, 30, 15), { start: 8, end: 30, keepEnd: 23, length: 15, cut: 7 });
  assert.deepEqual(outputWindow(40, 8, 12, 15), { start: 8, end: 12, keepEnd: 12, length: 4, cut: 0 });
  assert.equal(outputWindow(40, 5, 0, 0).end, 40, "OUT 0 means the end of the file");
  assert.equal(outputWindow(40, 30, 0, 20).keepEnd, 40, "a max past the end stops at the end");
  assert.equal(outputWindow(10, 50, 0).start, 10, "a start past the end is held at the end");
  assert.equal(outputWindow(10, "x", null, NaN).length, 10);
});

test("the line between IN and OUT says how long and what is cut", () => {
  assert.equal(outputSummary(outputWindow(40, 8, 30, 15)), "15.0 s · cut 7.0 s");
  assert.equal(outputSummary(outputWindow(200, 0, 0, 0)), "3:20.0");
  assert.equal(outputSummary(outputWindow(40, 8, 30, 0), { maxFromLink: true }), "22.0 s · max wired");
  assert.equal(outputSummary(outputWindow(0, 0, 0)), "");
});

test("a press grabs the nearest handle, the middle, or jumps", () => {
  const win = outputWindow(40, 10, 30);
  assert.equal(grabZone(win, 40, 0.25, 400), "start");
  assert.equal(grabZone(win, 40, 0.75, 400), "end");
  assert.equal(grabZone(win, 40, 0.5, 400), "move");
  assert.equal(grabZone(win, 40, 0.05, 400), "jump");
  assert.equal(grabZone(win, 0, 0.5, 400), "none");
});

test("peaks keep the loudest sample of each slice, channels mixed", () => {
  const left = Float32Array.from([0, 0.5, -0.5, 0, 1, -1]);
  const right = Float32Array.from([0, 0.5, -0.5, 0, 1, -1]);
  const peaks = wavePeaks([left, right], 2);
  assert.deepEqual(Array.from(peaks), [-0.5, 0.5, -1, 1]);
  assert.equal(wavePeaks([], 3).length, 6);
});
