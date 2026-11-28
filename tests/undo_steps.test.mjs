// A value written from a click or a drag on a node face is one undo step.
// ComfyUI records a step when the canvas sees the mouse go up, but a face
// that keeps its own pointer events never lets the canvas see it. A file that
// writes widgets through commitWidgetValue therefore also records the step
// itself, with notifyAusbossChange once the gesture is over. Without it, the
// next Ctrl+Z jumps back past the change and it is gone for good.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const JS = fileURLToPath(new URL("../js/", import.meta.url));

function sources(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return entry.name === "docs" ? [] : sources(path);
    return /\.m?js$/.test(entry.name) ? [path] : [];
  });
}

test("every face that commits a widget value also records the undo step", () => {
  const missing = sources(JS)
    .filter((path) => !path.endsWith("widget_card_math.mjs"))
    .filter((path) => {
      const source = readFileSync(path, "utf8");
      return /\bcommitWidgetValue\(/.test(source) && !/\bnotifyAusbossChange\(|changeTracker\?\.checkState\?\.\(/.test(source);
    })
    .map((path) => relative(JS, path));
  assert.deepEqual(missing, []);
});

test("the moment strip records a step for each drag or click it writes", () => {
  const source = readFileSync(join(JS, "shared/moment_strip.mjs"), "utf8");
  const commit = source.slice(source.indexOf("const commitScript"), source.indexOf("const addHandle"));
  assert.match(commit, /commitWidgetValue\([^)]*\);\s*notifyAusbossChange\(\);/);
});

test("a job picked from a picture chip is its own step", () => {
  const source = readFileSync(join(JS, "shared/h3_cast_chips.mjs"), "utf8");
  const choose = source.slice(source.indexOf("const choose ="), source.indexOf("button.addEventListener"));
  assert.match(choose, /notifyAusbossChange\(\)/);
});
