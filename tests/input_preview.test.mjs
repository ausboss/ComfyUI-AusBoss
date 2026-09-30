import assert from "node:assert/strict";
import test from "node:test";

import {
  describeNodePreview,
  describeOwnResult,
  describeSourcePreview,
  linkById,
  outputLocatorId,
  outputRecordQuery,
  placeholderText,
  sourceFileWidget,
  upstreamNode,
  viewQueryForFile,
} from "../js/shared/input_preview.mjs";

test("links resolve through Map and legacy object stores", () => {
  const link = { origin_id: 7 };
  assert.equal(linkById({ links: new Map([[3, link]]) }, 3), link);
  assert.equal(linkById({ links: { 3: link } }, 3), link);
  assert.equal(linkById({ links: new Map() }, 3), null);
  assert.equal(linkById({}, 3), null);
  assert.equal(linkById({ links: new Map([[3, link]]) }, null), null);
});

test("the upstream node is found by input name", () => {
  const source = { id: 7 };
  const graph = {
    links: new Map([[3, { origin_id: 7 }]]),
    getNodeById: (id) => (id === 7 ? source : null),
  };
  const node = {
    graph,
    inputs: [{ name: "mask", link: null }, { name: "image", link: 3 }],
  };
  assert.equal(upstreamNode(node, "image"), source);
  assert.equal(upstreamNode(node, "mask"), null);
  assert.equal(upstreamNode(node, "model"), null);
  assert.equal(upstreamNode({ inputs: [] }, "image"), null);
});

test("cached execution previews win over the file widget", () => {
  const source = {
    imgs: [{ src: "blob:thumbnail" }],
    widgets: [{ name: "image", value: "photo.png" }],
  };
  assert.deepEqual(describeSourcePreview(source), {
    kind: "url",
    url: "blob:thumbnail",
  });
});

test("file widgets resolve to a deterministic input /view query", () => {
  assert.equal(
    viewQueryForFile("clips\\photo.png [input]"),
    new URLSearchParams({
      filename: "photo.png",
      subfolder: "clips",
      type: "input",
    }).toString(),
  );
  const imageSource = { widgets: [{ name: "image", value: "photo.png" }] };
  assert.deepEqual(describeSourcePreview(imageSource), {
    kind: "view",
    isVideo: false,
    query: viewQueryForFile("photo.png"),
  });
  const videoSource = { widgets: [{ name: "video", value: "loop.mp4" }] };
  assert.equal(describeSourcePreview(videoSource).isVideo, true);
});

test("the watchable file widget is found regardless of its value", () => {
  const widget = { name: "video" };
  assert.equal(sourceFileWidget({ widgets: [{ name: "seed" }, widget] }), widget);
  assert.equal(sourceFileWidget({ widgets: [{ name: "seed" }] }), null);
  assert.equal(sourceFileWidget(null), null);
});

test("unpreviewable sources fall back to the quiet placeholder", () => {
  assert.equal(describeSourcePreview(null), null);
  assert.equal(describeSourcePreview({ widgets: [{ name: "seed", value: 3 }] }), null);
  assert.equal(describeSourcePreview({ widgets: [{ name: "image", value: "" }] }), null);
  assert.equal(placeholderText(false, "an image"), "connect an image to preview");
  assert.equal(placeholderText(false, "a mask"), "connect a mask to preview");
  // Connected but nothing to show yet: the node has to run to make a picture,
  // which is the whole instruction the panel can usefully give.
  assert.equal(placeholderText(true, "a mask"), "run to preview");
});

test("the node's own result is the newest image it has", () => {
  // Progress frames append during a run, so the last entry is the current one.
  assert.deepEqual(
    describeOwnResult({ imgs: [{ src: "frame1" }, { src: "frame9" }] }),
    { kind: "url", url: "frame9" },
  );
  assert.equal(describeOwnResult({ imgs: [] }), null);
  assert.equal(describeOwnResult({ imgs: [{ src: "" }] }), null);
  assert.equal(describeOwnResult({}), null);
  assert.equal(describeOwnResult(null), null);
});

test("a node's own result outranks the input feeding it", () => {
  const source = { imgs: [{ src: "upstream" }] };
  const graph = {
    links: new Map([[1, { origin_id: 5 }]]),
    getNodeById: () => source,
  };
  const node = { graph, inputs: [{ name: "image", link: 1 }] };

  // Before the run there is only the input to look at...
  assert.deepEqual(describeNodePreview(node, "image"), { kind: "url", url: "upstream" });
  // ...and once this node has produced something, that is what matters.
  node.imgs = [{ src: "own-result" }];
  assert.deepEqual(describeNodePreview(node, "image"), { kind: "url", url: "own-result" });
  // Nothing anywhere stays null so the caller shows its placeholder.
  assert.equal(describeNodePreview({ inputs: [] }, "image"), null);
});

test("a node's stored outputs are found under the frontend's key for it", () => {
  const root = { id: "root-graph" };
  root.rootGraph = root;
  const subgraph = { id: "0f3c9a52-sub", rootGraph: root };
  assert.equal(outputLocatorId({ id: 16, graph: root }), "16");
  assert.equal(outputLocatorId({ id: 5, graph: subgraph }), "0f3c9a52-sub:5");
  // A graph without a rootGraph link is its own root.
  assert.equal(outputLocatorId({ id: 7, graph: {} }), "7");
  assert.equal(outputLocatorId({ id: 7 }), null);
  assert.equal(outputLocatorId(null), null);
});

test("the stored output resolves to the newest image the node wrote", () => {
  const record = {
    images: [
      { filename: "shot_00001.png", subfolder: "", type: "output" },
      { filename: "shot_00002.png", subfolder: "sets", type: "output" },
    ],
  };
  assert.equal(
    outputRecordQuery(record),
    new URLSearchParams({ filename: "shot_00002.png", subfolder: "sets", type: "output" }).toString(),
  );
  // A preview node's temp file keeps its own folder type.
  const temp = { images: [{ filename: "ausboss_select_frame_ab_00001_.png", subfolder: "", type: "temp" }] };
  assert.match(outputRecordQuery(temp), /type=temp/);
  assert.equal(outputRecordQuery({ images: [] }), null);
  assert.equal(outputRecordQuery({ images: [{ subfolder: "" }] }), null);
  assert.equal(outputRecordQuery({ text: ["not an image"] }), null);
  assert.equal(outputRecordQuery(undefined), null);
});

test("without node.imgs the stored output is the result, ahead of the input", () => {
  // Nodes 2.0 never fills node.imgs once its own copy of the preview is
  // stood down, so the stored output has to stand in for it.
  const source = { imgs: [{ src: "upstream" }] };
  const graph = {
    links: new Map([[1, { origin_id: 5 }]]),
    getNodeById: () => source,
  };
  const node = { graph, inputs: [{ name: "images", link: 1 }] };
  assert.deepEqual(describeNodePreview(node, "images", "/view?stored"), { kind: "url", url: "/view?stored" });
  // No stored output yet: the input is still what the panel shows.
  assert.deepEqual(describeNodePreview(node, "images", null), { kind: "url", url: "upstream" });
  // Classic fills node.imgs (streamed progress frames too); that still wins.
  node.imgs = [{ src: "own-result" }];
  assert.deepEqual(describeNodePreview(node, "images", "/view?stored"), { kind: "url", url: "own-result" });
});
