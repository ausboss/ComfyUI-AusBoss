import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createRunScope } from "../js/shared/prompt_scope.mjs";

const JS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "js");

function scopeOn(graphId) {
  const scope = createRunScope();
  let active = graphId;
  scope.setActiveOwner(() => active);
  return { scope, show: (id) => { active = id; } };
}

test("a run queued from the graph on screen is its own", () => {
  const { scope } = scopeOn("ltx");
  scope.queued("p1", "ltx");
  scope.started("p1");
  assert.equal(scope.isForeign(), false);
  assert.equal(scope.isForeign("p1"), false);
});

test("a run from another tab is foreign while this tab is open, and own again back there", () => {
  const { scope, show } = scopeOn("watermark");
  scope.queued("p2", "ltx");
  scope.started("p2");
  assert.equal(scope.isForeign(), true);
  show("ltx");
  assert.equal(scope.isForeign(), false);
});

test("a run nobody recorded is never foreign", () => {
  const { scope } = scopeOn("ltx");
  scope.started("queued-before-this-page-loaded");
  assert.equal(scope.isForeign(), false);
  assert.equal(scope.isForeign(undefined), false);
  assert.equal(scope.isForeign(null), false);
});

test("without a graph on screen nothing is foreign", () => {
  const scope = createRunScope();
  scope.queued("p3", "ltx");
  scope.started("p3");
  assert.equal(scope.isForeign(), false);
  scope.setActiveOwner(() => { throw new Error("no graph yet"); });
  assert.equal(scope.isForeign(), false);
});

test("the record keeps the newest runs only", () => {
  const scope = createRunScope({ limit: 3 });
  scope.setActiveOwner(() => "b");
  for (const id of ["1", "2", "3", "4"]) scope.queued(id, "a");
  assert.equal(scope.ownerOf("1"), null);
  assert.equal(scope.ownerOf("4"), "a");
  assert.equal(scope.isForeign("1"), false);
  assert.equal(scope.isForeign("4"), true);
});

test("a held-back result is handed over as its own run", () => {
  const { scope, show } = scopeOn("watermark");
  scope.queued("p4", "ltx");
  scope.queued("p5", "watermark");
  scope.started("p5");
  show("ltx");
  // back on the tab that queued p4, while p5 (the other tab's) is running
  assert.equal(scope.isForeign(), true);
  assert.equal(scope.during("p4", () => scope.isForeign()), false);
  assert.equal(scope.current, "p5");
});

test("a queue call without a prompt id or owner records nothing", () => {
  const scope = createRunScope();
  scope.queued(undefined, "a");
  scope.queued("p", null);
  scope.queued("p", "");
  assert.equal(scope.ownerOf("p"), null);
});

// Policy: every node that takes a run's result on its face asks first
// whether the run is this tab's. A handler that forgets would show, or save,
// another workflow's result on the node that happens to share its id.
function entries() {
  const found = [];
  for (const name of readdirSync(JS_ROOT)) {
    const path = join(JS_ROOT, name, "index.js");
    try {
      statSync(path);
    } catch {
      continue;
    }
    found.push({ name, source: readFileSync(path, "utf-8") });
  }
  return found;
}

test("every onExecuted handler skips runs from another workflow tab", () => {
  const handler = /chainCallback\([^,]+,\s*"onExecuted",\s*(?:function\s*\([^)]*\)|\([^)]*\)\s*=>)\s*\{\s*([^\n]*)/g;
  let seen = 0;
  for (const { name, source } of entries()) {
    for (const match of source.matchAll(handler)) {
      seen += 1;
      assert.match(match[1], /^if \(isForeignRun\(\)\) return;/, `${name}: onExecuted must start with "if (isForeignRun()) return;"`);
      assert.match(source, /import \{ isForeignRun \} from "\.\.\/shared\/prompt_scope\.mjs";/, `${name}: import isForeignRun`);
    }
  }
  assert.ok(seen >= 7, `expected the pack's onExecuted handlers, found ${seen}`);
});
