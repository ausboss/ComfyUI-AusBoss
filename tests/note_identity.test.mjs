import test from "node:test";
import assert from "node:assert/strict";
import { CALLOUT_TYPES, NOTE_TYPES, serializeNoteIdentity } from "../js/shared/note_identity.mjs";

for (const family of [CALLOUT_TYPES, NOTE_TYPES]) {
  const [plain, tile] = [...family];
  for (const source of family) {
    for (const enabled of [false, true]) {
      test(`${source}: ${enabled ? "tile" : "plain"} serialization declares its renderer`, () => {
        const properties = { "Node name for S&R": source, cnr_id: "ausboss-nodes", ausbossCalloutTile: "youtube" };
        const saved = { id: 7, type: source, properties, mode: 0, size: [270, 96], widgets_values: ['unchanged\ntext'], inputs: [], outputs: [] };
        const before = structuredClone(saved);
        serializeNoteIdentity(saved, enabled);
        assert.equal(saved.type, enabled ? tile : plain);
        assert.equal(saved.properties["Node name for S&R"], saved.type);
        assert.equal(saved.properties.cnr_id, "ausboss-nodes");
        assert.deepEqual(properties, before.properties, "serialization cannot mutate live properties");
        assert.deepEqual({ ...saved, type: source, properties: before.properties }, before);
        assert.equal(new Set([plain]).has(saved.type), !enabled, "old pack must not pretend to support a tile");
        assert.equal(new Set().has(saved.type), false);
        assert.equal(family.has(saved.type), true);
      });
    }
  }
}

test("unrelated nodes are not rewritten", () => {
  const saved = { type: "OtherNote", properties: { layout: "tile" } };
  const before = structuredClone(saved);
  serializeNoteIdentity(saved, true);
  assert.deepEqual(saved, before);
});
