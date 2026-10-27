import assert from "node:assert/strict";
import test from "node:test";

import {
  IDLE,
  consumersOf,
  drawsTiles,
  feedsInto,
  nextRunState,
  resultRank,
  stepFraction,
  stepText,
  stoppedText,
  upstreamIds,
} from "../js/shared/step_preview_math.mjs";

function play(events, state = IDLE) {
  return events.reduce((run, event) => nextRunState(run, event), state);
}

// A small graph: nodes by id, links as a Map, each node's inputs naming a link.
function makeGraph(nodes, links) {
  const graph = {
    links: new Map(links.map(([id, origin, target]) => [id, { id, origin_id: origin, target_id: target }])),
    getNodeById: (id) => graph.nodes.find((node) => String(node.id) === String(id)) ?? null,
    nodes: [],
  };
  graph.nodes = nodes.map(({ id, title, inputs = [], subgraph = null }) => ({
    id,
    title,
    graph,
    subgraph,
    inputs: inputs.map((link) => ({ link })),
  }));
  return graph;
}

test("a run starts, shows its steps and counts them", () => {
  const run = play([
    { type: "start", promptId: "p1" },
    { type: "picture", promptId: "p1", maker: "7", url: "blob:1" },
    { type: "progress", promptId: "p1", node: "7", value: 1, max: 8 },
    { type: "picture", promptId: "p1", maker: "7", url: "blob:2" },
    { type: "progress", promptId: "p1", node: "7", value: 2, max: 8 },
  ]);
  assert.equal(run.status, "running");
  assert.equal(run.maker, "7");
  assert.equal(run.url, "blob:2");
  assert.equal(stepText(run), "step 2 of 8");
  assert.equal(stepFraction(run), 0.25);
});

test("the count belongs to the node making the picture", () => {
  const run = play([
    { type: "start", promptId: "p1" },
    { type: "progress", promptId: "p1", node: "3", value: 5, max: 20 },
    { type: "picture", promptId: "p1", maker: "7", url: "blob:1" },
    { type: "progress", promptId: "p1", node: "3", value: 6, max: 20 },
  ]);
  assert.equal(run.maker, "7");
  assert.equal(stepText(run), "starting");
});

test("a second sampler in the same run starts its own count", () => {
  const run = play([
    { type: "start", promptId: "p1" },
    { type: "picture", promptId: "p1", maker: "7", url: "blob:1" },
    { type: "progress", promptId: "p1", node: "7", value: 8, max: 8 },
    { type: "picture", promptId: "p1", maker: "12:4", url: "blob:2" },
  ]);
  assert.equal(run.maker, "12:4");
  assert.equal(run.value, 0);
  assert.equal(run.max, 0);
});

test("a stop keeps the last picture and says where it stopped", () => {
  const run = play([
    { type: "start", promptId: "p1" },
    { type: "picture", promptId: "p1", maker: "7", url: "blob:1" },
    { type: "progress", promptId: "p1", node: "7", value: 3, max: 8 },
    { type: "end", promptId: "p1", kind: "interrupted" },
  ]);
  assert.equal(run.status, "stopped");
  assert.equal(run.url, "blob:1");
  assert.equal(stoppedText(run), "stopped at step 3 of 8");
  assert.equal(stoppedText(run, { saves: true }), "stopped at step 3 of 8 · nothing saved");
  assert.equal(stoppedText({ ...run, max: 0 }), "stopped");
});

test("a run ends as done or failed", () => {
  const started = play([
    { type: "start", promptId: "p1" },
    { type: "picture", promptId: "p1", maker: "7", url: "blob:1" },
  ]);
  assert.equal(nextRunState(started, { type: "end", promptId: "p1", kind: "success" }).status, "done");
  assert.equal(nextRunState(started, { type: "end", promptId: "p1", kind: "error" }).status, "failed");
});

test("another run's end leaves this one running", () => {
  const started = play([{ type: "start", promptId: "p1" }]);
  assert.equal(nextRunState(started, { type: "end", promptId: "p2", kind: "success" }), started);
});

test("a late picture after the run ended changes nothing", () => {
  const stopped = play([
    { type: "start", promptId: "p1" },
    { type: "picture", promptId: "p1", maker: "7", url: "blob:1" },
    { type: "end", promptId: "p1", kind: "interrupted" },
  ]);
  assert.equal(nextRunState(stopped, { type: "picture", promptId: "p1", maker: "7", url: "blob:9" }), stopped);
});

test("a picture from a new run starts that run without a start event", () => {
  const done = play([
    { type: "start", promptId: "p1" },
    { type: "picture", promptId: "p1", maker: "7", url: "blob:1" },
    { type: "end", promptId: "p1", kind: "success" },
  ]);
  const next = nextRunState(done, { type: "picture", promptId: "p2", maker: "7", url: "blob:2" });
  assert.equal(next.status, "running");
  assert.equal(next.promptId, "p2");
  assert.equal(next.value, 0);
});

test("events that carry nothing leave the state alone", () => {
  const started = play([{ type: "start", promptId: "p1" }]);
  assert.equal(nextRunState(started, { type: "picture", promptId: "p1", maker: "7" }), started);
  assert.equal(nextRunState(started, { type: "progress", promptId: "p1", node: "7", value: "x", max: 8 }), started);
  assert.equal(nextRunState(started, { type: "unknown" }), started);
  assert.equal(nextRunState(undefined, null), IDLE);
  assert.equal(nextRunState(IDLE, { type: "progress", node: "7", value: 1, max: 2 }), IDLE);
});

test("the step text never runs past the end", () => {
  assert.equal(stepText({ value: 9, max: 8 }), "step 8 of 8");
  assert.equal(stepText({ value: -1, max: 8 }), "step 0 of 8");
  assert.equal(stepFraction({ value: 9, max: 8 }), 1);
  assert.equal(stepFraction(IDLE), 0);
});

test("the finished picture replaces the last step once the run saves it", () => {
  const steps = play([
    { type: "start", promptId: "p1" },
    { type: "picture", promptId: "p1", maker: "7", url: "blob:8" },
    { type: "progress", promptId: "p1", node: "7", value: 8, max: 8 },
  ]);
  const saved = nextRunState(steps, { type: "result", promptId: "p1", url: "/view?saved", rank: 2 });
  assert.equal(saved.result, "/view?saved");
  assert.equal(stepText(saved), "step 8 of 8");
  // It stays when the run ends.
  assert.equal(nextRunState(saved, { type: "end", promptId: "p1", kind: "success" }).result, "/view?saved");
});

test("a picture that stands less for the result never replaces a better one", () => {
  const saved = play([
    { type: "start", promptId: "p1" },
    { type: "picture", promptId: "p1", maker: "7", url: "blob:1" },
    { type: "result", promptId: "p1", url: "/view?save", rank: 2 },
  ]);
  assert.equal(nextRunState(saved, { type: "result", promptId: "p1", url: "/view?compare", rank: 0 }), saved);
  assert.equal(nextRunState(saved, { type: "result", promptId: "p1", url: "/view?again", rank: 2 }).result, "/view?again");
});

test("new steps after a result show the steps again", () => {
  const run = play([
    { type: "start", promptId: "p1" },
    { type: "picture", promptId: "p1", maker: "7", url: "blob:1" },
    { type: "result", promptId: "p1", url: "/view?first", rank: 1 },
    { type: "picture", promptId: "p1", maker: "12:4", url: "blob:2" },
  ]);
  assert.equal(run.result, null);
  assert.equal(run.url, "blob:2");
});

test("a result from another run, or with no picture, is left out", () => {
  const started = play([{ type: "start", promptId: "p1" }]);
  assert.equal(nextRunState(started, { type: "result", promptId: "p2", url: "/view?x", rank: 2 }), started);
  assert.equal(nextRunState(started, { type: "result", promptId: "p1", rank: 2 }), started);
  assert.equal(nextRunState(IDLE, { type: "result", promptId: "p1", url: "/view?x", rank: 2 }), IDLE);
});

test("save and preview nodes fed by the sampler stand best for the result", () => {
  assert.equal(resultRank("AUSBOSS_NODES_SaveImage", true), 2);
  assert.equal(resultRank("SaveImage", false), 1);
  assert.equal(resultRank("PreviewImage", true), 2);
  assert.equal(resultRank("AUSBOSS_NODES_ImageCompare", true), 0);
  assert.equal(resultRank(undefined, true), 0);
});

test("the walk back through the inputs finds every node upstream, loops included", () => {
  // 1 -> 2 -> 3 (save), 2 also reads 3's output back (a loop must not hang)
  const graph = makeGraph(
    [
      { id: 1, title: "loader" },
      { id: 2, title: "sampler", inputs: [10, 30] },
      { id: 3, title: "save", inputs: [20] },
    ],
    [
      [10, 1, 2],
      [20, 2, 3],
      [30, 3, 2],
    ],
  );
  const { ids, outside } = upstreamIds(graph, graph.getNodeById(3));
  assert.deepEqual([...ids].sort(), ["1", "2", "3"]);
  assert.equal(outside, false);
});

test("a save node shows the steps of the sampler that feeds it", () => {
  // Two branches: 1 -> 2 -> 3 (save A) and 4 -> 5 (save B)
  const root = makeGraph(
    [
      { id: 1, title: "sampler A" },
      { id: 2, title: "decode A", inputs: [10] },
      { id: 3, title: "Save A", inputs: [20] },
      { id: 4, title: "sampler B" },
      { id: 5, title: "Save B", inputs: [40] },
    ],
    [
      [10, 1, 2],
      [20, 2, 3],
      [40, 4, 5],
    ],
  );
  const saveA = root.getNodeById(3);
  const saveB = root.getNodeById(5);
  assert.equal(feedsInto(root, saveA, "1"), true);
  assert.equal(feedsInto(root, saveB, "1"), false);
  assert.deepEqual(consumersOf(root, [saveA, saveB], "4"), [saveB]);
  // A maker that feeds neither (a wireless set/get pair) shows on both.
  assert.deepEqual(consumersOf(root, [saveA, saveB], "9"), [saveA, saveB]);
  assert.deepEqual(consumersOf(root, [], "1"), []);
});

test("a sampler inside a box counts as the box", () => {
  const inner = makeGraph([{ id: 4, title: "KSampler" }], []);
  const root = makeGraph(
    [
      { id: 12, title: "Generate", subgraph: inner },
      { id: 13, title: "Upscale", subgraph: makeGraph([], []) },
      { id: 3, title: "Save", inputs: [20] },
    ],
    [[20, 12, 3]],
  );
  const save = root.getNodeById(3);
  assert.equal(feedsInto(root, save, "12:4"), true);
  assert.equal(feedsInto(root, save, "13:4"), false);
});

test("a save node in a box the sampler is outside of shows the steps", () => {
  const inner = makeGraph([{ id: 2, title: "Save" }], []);
  const root = makeGraph(
    [
      { id: 7, title: "KSampler" },
      { id: 12, title: "Finish", subgraph: inner },
    ],
    [],
  );
  const save = inner.getNodeById(2);
  assert.equal(feedsInto(root, save, "7"), true);
  assert.equal(feedsInto(root, null, "7"), false);
  assert.equal(feedsInto(root, save, null), false);
});

test("a tiled upscale's tiles never replace the whole picture", () => {
  const before = play([
    { type: "start", promptId: "p1" },
    { type: "picture", promptId: "p1", maker: "7", url: "blob:whole" },
    { type: "progress", promptId: "p1", node: "7", value: 8, max: 8 },
  ]);
  assert.equal(before.whole, true);
  // The split runs: the whole picture stays, and the chip says what is going on.
  const split = nextRunState(before, { type: "tiles", promptId: "p1", on: true });
  assert.equal(split.url, "blob:whole");
  assert.equal(stepText(split), "upscaling in tiles");
  const tile = play([
    { type: "picture", promptId: "p1", maker: "20:5", url: "blob:tile1" },
    { type: "progress", promptId: "p1", node: "20:5", value: 3, max: 8 },
  ], split);
  assert.equal(tile.url, "blob:whole");
  assert.equal(tile.maker, "20:5");
  assert.equal(stepText(tile), "upscaling in tiles · step 3 of 8");
  // The stitch closes the window; a later sampler's picture shows again.
  const stitched = nextRunState(tile, { type: "tiles", promptId: "p1", on: false });
  assert.equal(stitched.tiling, false);
  const after = nextRunState(stitched, { type: "picture", promptId: "p1", maker: "30", url: "blob:after" });
  assert.equal(after.url, "blob:after");
  assert.equal(after.tilePass, false);
  assert.equal(stepText(after), "starting");
});

test("tiles show when there is no whole picture yet, and say they are tiles", () => {
  const run = play([
    { type: "start", promptId: "p1" },
    { type: "tiles", promptId: "p1", on: true },
    { type: "picture", promptId: "p1", maker: "5", url: "blob:tile1" },
    { type: "picture", promptId: "p1", maker: "5", url: "blob:tile2" },
    { type: "progress", promptId: "p1", node: "5", value: 2, max: 4 },
  ]);
  assert.equal(run.url, "blob:tile2");
  assert.equal(run.whole, false);
  assert.equal(stepText(run), "upscaling in tiles · step 2 of 4");
});

test("a node that samples its own tiles counts as tiles", () => {
  const run = play([
    { type: "start", promptId: "p1" },
    { type: "picture", promptId: "p1", maker: "7", url: "blob:whole" },
    { type: "picture", promptId: "p1", maker: "9", url: "blob:tile", tile: true },
  ]);
  assert.equal(run.url, "blob:whole");
  assert.equal(run.tilePass, true);
  assert.equal(drawsTiles("UltimateSDUpscale"), true);
  assert.equal(drawsTiles("UltimateSDUpscaleNoUpscale"), true);
  assert.equal(drawsTiles("KSampler"), false);
  assert.equal(drawsTiles(undefined), false);
});

test("tile events from another run or after the end change nothing", () => {
  const started = play([{ type: "start", promptId: "p1" }]);
  assert.equal(nextRunState(started, { type: "tiles", promptId: "p2", on: true }), started);
  assert.equal(nextRunState(started, { type: "tiles", promptId: "p1", on: false }), started);
  const done = nextRunState(started, { type: "end", promptId: "p1", kind: "success" });
  assert.equal(nextRunState(done, { type: "tiles", promptId: "p1", on: true }), done);
  // A new run forgets the last one's tiles.
  const tiling = nextRunState(started, { type: "tiles", promptId: "p1", on: true });
  assert.equal(nextRunState(tiling, { type: "start", promptId: "p3" }).tiling, false);
});
