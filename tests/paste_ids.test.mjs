import assert from "node:assert/strict";
import test from "node:test";

import { onPaste, pastedIds } from "../js/shared/paste_ids.mjs";

class Group {
  constructor(id) {
    this.id = id;
  }
}

test("a paste's old ids map to the copies' ids; groups by the order they were made", () => {
  const isGroup = (item) => item instanceof Group;
  const result = {
    nodes: new Map([[41, { id: 151 }], ["105", { id: "152" }]]),
    created: [new Group(7), new Group(8), { id: 151 }, { id: "152" }],
  };
  const ids = pastedIds(result, [3, 4], isGroup);
  assert.deepEqual([...ids.nodes], [["41", 151], ["105", "152"]]);
  assert.deepEqual([...ids.groups], [["3", 7], ["4", 8]]);
  assert.equal(ids.created.length, 4);
  // A group the frontend did not make: none is matched rather than a wrong one.
  assert.deepEqual([...pastedIds(result, [3], isGroup).groups], []);
  assert.deepEqual(pastedIds(undefined), { nodes: new Map(), groups: new Map(), created: [] });
});

test("every paste reaches the handlers, and the frontend gets its own result back", () => {
  const calls = [];
  class Canvas {
    _deserializeItems(items) {
      for (const group of items.groups) group.id = -1; // the frontend renumbers what it is handed
      return { nodes: new Map([[5, { id: 20 }]]), created: [new Group(30), { id: 20 }] };
    }
  }
  globalThis.LiteGraph = { LGraphCanvas: Canvas, LGraphGroup: Group };
  const warn = console.warn;
  const warned = [];
  console.warn = (...args) => warned.push(args);
  try {
    onPaste((ids) => calls.push(ids));
    onPaste(() => {
      throw new Error("one handler failing never breaks the paste");
    });
    const result = new Canvas()._deserializeItems({ nodes: [{ id: 5 }], groups: [{ id: 2 }] });
    assert.deepEqual([...result.nodes.keys()], [5]);
    assert.equal(calls.length, 1);
    assert.deepEqual([...calls[0].nodes], [["5", 20]]);
    assert.deepEqual([...calls[0].groups], [["2", 30]]);
    // Wrapped once, however many handlers.
    onPaste(() => {});
    new Canvas()._deserializeItems({ nodes: [], groups: [] });
    assert.equal(calls.length, 2);
    assert.equal(warned.length, 2);
  } finally {
    console.warn = warn;
    delete globalThis.LiteGraph;
  }
});
