import assert from "node:assert/strict";
import test from "node:test";

import {
  describeSourcePreview,
  linkById,
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
  assert.equal(placeholderText(true, "a mask"), "source has no preview yet");
});
