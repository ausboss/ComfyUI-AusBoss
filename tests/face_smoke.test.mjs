import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("face smoke gives each probe a fresh node id after clearing the graph", () => {
  const source = readFileSync(new URL("../scripts/dev/face_smoke.mjs", import.meta.url), "utf8");
  // Run the browser setup used by every probe. ComfyUI clears the node-id
  // counter with the graph, but output/preview caches can retain those ids.
  const setup = source.match(/const seen = await evalJs\(`\(async \(\) => \{([\s\S]*?)\n    let node;/)?.[1];
  assert.ok(setup, "the browser probe setup must be exercised");
  const previews = new Map();
  const graph = { last_node_id: 0, clear() { this.last_node_id = 0; } };
  let resets = 0;
  const context = vm.createContext({ window: { app: {
    graph, canvas: { linkConnector: { reset() { resets++; } } },
  } } });
  const ids = [];
  for (let probe = 0; probe < 48; probe++) {
    vm.runInContext(`(() => { ${setup} })()`, context);
    const id = ++graph.last_node_id;
    assert.equal(previews.has(id), false, "a later node must not inherit an earlier node's preview");
    previews.set(id, `preview-${probe}`);
    ids.push(id);
  }
  assert.equal(new Set(ids).size, 48);
  assert.equal(resets, 48);
});
