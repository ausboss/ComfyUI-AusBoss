import assert from "node:assert/strict";
import test from "node:test";

import { ensureNodeMinHeight, fillNodeHeight } from "../js/shared/panel_layout.mjs";

test("fillNodeHeight drops computeSize and declares a floor with no ceiling", () => {
  const widget = { computeSize: () => [0, 200], options: {} };
  fillNodeHeight(widget, { minWidth: 200, minHeight: () => 140, minNodeSize: [200, 90] });
  assert.equal(widget.computeSize, undefined);
  assert.deepEqual(widget.computeLayoutSize(), { minWidth: 200, minHeight: 140 });
  assert.deepEqual(widget.options.minNodeSize, [200, 90]);
});

test("ensureNodeMinHeight grows a node that loaded shorter than its widgets need", () => {
  const node = { size: [300, 100], computeSize: () => [300, 180], setSize(size) { this.size = size; } };
  assert.equal(ensureNodeMinHeight(node), true);
  assert.deepEqual(node.size, [300, 180]);
  assert.equal(ensureNodeMinHeight(node), false, "already tall enough: untouched");
  node.size = [300, 400];
  assert.equal(ensureNodeMinHeight(node), false, "taller than the floor: never shrunk");
  assert.deepEqual(node.size, [300, 400]);
  assert.equal(ensureNodeMinHeight(null), false);
});
