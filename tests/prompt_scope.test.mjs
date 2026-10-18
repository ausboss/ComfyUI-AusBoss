import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createOwnRuns, createRunScope, isNodeOwnRun, outputKey } from "../js/shared/prompt_scope.mjs";

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
      assert.match(source, /import \{[^}]*\bisForeignRun\b[^}]*\} from "\.\.\/shared\/prompt_scope\.mjs";/, `${name}: import isForeignRun`);
    }
  }
  assert.ok(seen >= 7, `expected the pack's onExecuted handlers, found ${seen}`);
});

test("results are filed by root id, or subgraph id and id inside a subgraph", () => {
  const root = { id: "root-graph" };
  assert.equal(outputKey({ id: 8, graph: root }, root), "8");
  assert.equal(outputKey({ id: 25, graph: { id: "sub-1" } }, root), "sub-1:25");
  assert.equal(outputKey({ id: 3 }, root), "3");
  assert.equal(outputKey(null, root), null);
});

const touchPrompt = (ask) => ({
  2: { class_type: "AUSBOSS_NODES_ImageCropRotatePad", inputs: { image: "pier.png" } },
  3: { class_type: "AUSBOSS_NODES_MaskByTouch", inputs: { ask, touches: "" } },
  15: { class_type: "AUSBOSS_NODES_SaveImage", inputs: {} },
});

test("Mask by Touch looking at its picture is the node's own run", () => {
  assert.equal(isNodeOwnRun(touchPrompt("look"), { partialExecutionTargets: ["3"] }), true);
  assert.equal(isNodeOwnRun(touchPrompt("scope:416,730"), { partialExecutionTargets: ["3"] }), true);
});

test("a run of the workflow is never a node's own run", () => {
  // Run pressed: no targets, and the node sends an empty ask.
  assert.equal(isNodeOwnRun(touchPrompt(""), undefined), false);
  assert.equal(isNodeOwnRun(touchPrompt(""), {}), false);
  // A request still riding along on a whole run does not make it one.
  assert.equal(isNodeOwnRun(touchPrompt("look"), { partialExecutionTargets: [] }), false);
  // Somebody runs the node alone by hand: it carries no request.
  assert.equal(isNodeOwnRun(touchPrompt(""), { partialExecutionTargets: ["3"] }), false);
  // A run of chosen nodes in a workflow without Mask by Touch.
  assert.equal(isNodeOwnRun({ 9: { class_type: "KSampler", inputs: { ask: "x" } } }, { partialExecutionTargets: ["9"] }), false);
  assert.equal(isNodeOwnRun(null, { partialExecutionTargets: ["3"] }), false);
});

test("an own run is told once to whoever listens, and remembered", () => {
  const runs = createOwnRuns({ limit: 2 });
  const heard = [];
  const stop = runs.subscribe((id) => heard.push(id));
  runs.mark("look-1");
  runs.mark("look-1");
  runs.mark("");
  runs.mark(null);
  assert.deepEqual(heard, ["look-1"]);
  assert.equal(runs.has("look-1"), true);
  assert.equal(runs.has("run-1"), false);
  assert.equal(runs.has(undefined), false);
  runs.mark("look-2");
  runs.mark("look-3");
  assert.equal(runs.has("look-1"), false, "the oldest is let go past the limit");
  stop();
  runs.mark("look-4");
  assert.deepEqual(heard, ["look-1", "look-2", "look-3"]);
});

test("a listener that throws does not keep the news from the others", () => {
  const runs = createOwnRuns();
  const heard = [];
  runs.subscribe(() => { throw new Error("broken listener"); });
  runs.subscribe((id) => heard.push(id));
  runs.mark("look-1");
  assert.deepEqual(heard, ["look-1"]);
});

test("the Run Timer and the runtime badges leave a node's own runs out", () => {
  const read = (path) => readFileSync(join(JS_ROOT, path), "utf-8");
  const queue = read("prompt_scope/index.js");
  assert.match(queue, /if \(isNodeOwnRun\(data\?\.output, rest\[0\]\)\) ownRuns\.mark\(result\?\.prompt_id\);/, "the queue wrapper marks own runs");
  for (const path of ["run_timer/index.js", "chrome/index.js"]) {
    const source = read(path);
    assert.match(source, /isOwnRun\(/, `${path}: checks each run`);
    assert.match(source, /ownRuns\.subscribe\(/, `${path}: takes back a run found to be a node's own after it started`);
  }
});
