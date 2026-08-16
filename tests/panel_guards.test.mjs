// Every DOM-widget panel must keep its contents inside the node.
//
// Three guards make that true, and the LoRA loader shipped without all
// three - its strength box and info button hung past the node's right edge:
//   1. box-sizing: border-box on the panel, so padding cannot render
//      outside the width the frontend allocates (content-box padding adds
//      to it);
//   2. an overflow clip on the panel, so anything that still ends up wider
//      paints inside the node instead of escaping it;
//   3. a minimum width wired through computeLayoutSize, so the node cannot
//      be resized below the narrowest width the panel's fixed-size controls
//      need (the legacy computeSize clamp holds the PANEL wide, but without
//      the layout minimum the NODE could shrink out from under it).
//
// This test is policy: every js/<name>/index.js that calls addDOMWidget
// either imports the shared video root (which carries the guards) or
// carries them itself. A new panel that forgets shows up here, not in a
// screenshot.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const JS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "js");

function domWidgetEntries() {
  const entries = [];
  for (const name of readdirSync(JS_ROOT)) {
    const path = join(JS_ROOT, name, "index.js");
    try {
      statSync(path);
    } catch {
      continue;
    }
    const source = readFileSync(path, "utf-8");
    if (source.includes("addDOMWidget")) entries.push({ name, source });
  }
  return entries;
}

// The shared video root (js/shared/video_ui.mjs) carries border-box and
// overflow:hidden for everyone who mounts it.
const SHARED_ROOT_IMPORT = "ensureVideoCss";

test("the audit sees the panels it exists to guard", () => {
  const names = domWidgetEntries().map((entry) => entry.name);
  for (const expected of ["lora_loader", "frame_chooser", "load_video", "save_video"]) {
    assert.ok(names.includes(expected), `${expected} not found by the audit`);
  }
});

test("every DOM panel keeps padding inside its box and clips overflow", () => {
  for (const { name, source } of domWidgetEntries()) {
    if (source.includes(SHARED_ROOT_IMPORT)) continue;
    assert.match(
      source,
      /box-sizing:\s*border-box/,
      `${name}: panel CSS has no box-sizing: border-box - its padding widens it past the node`,
    );
    assert.match(
      source,
      /overflow(-x)?:\s*(hidden|clip)/,
      `${name}: panel CSS never clips overflow - oversized content escapes the node`,
    );
  }
});

test("every resizable DOM panel declares its minimum width to the layout", () => {
  // input_preview is a pointer-transparent thumbnail with no fixed-width
  // controls; there is nothing that could hang out of it.
  const exempt = new Set(["input_preview"]);
  for (const { name, source } of domWidgetEntries()) {
    if (exempt.has(name)) continue;
    assert.match(
      source,
      /computeLayoutSize\s*=\s*\(\)\s*=>\s*\(\{\s*\n?\s*minWidth/,
      `${name}: DOM widget has no computeLayoutSize minWidth - the node can shrink out from under the panel`,
    );
  }
});

test("the shared video root really carries the guards it is trusted for", () => {
  const shared = readFileSync(join(JS_ROOT, "shared", "video_ui.mjs"), "utf-8");
  assert.match(shared, /ausboss-video-root\{[^}]*box-sizing:border-box/);
  assert.match(shared, /ausboss-video-root\{[^}]*overflow:hidden/);
});

test("the lora panel carries all three guards by name", () => {
  const source = readFileSync(join(JS_ROOT, "lora_loader", "index.js"), "utf-8");
  // Regexes cannot use [^}] here: the CSS lives in a template literal whose
  // ${...} interpolations close braces mid-rule. Slice the panel rule out
  // by its neighbors instead.
  assert.match(
    source,
    /\.ausboss-lora-panel,\s*\.ausboss-lora-panel \*[\s\S]{0,120}box-sizing:\s*border-box/,
    "the border-box blanket over the panel and its children is gone",
  );
  const start = source.indexOf(".ausboss-lora-panel {");
  const end = source.indexOf(".ausboss-lora-row", start);
  assert.ok(start > 0 && end > start, "the panel rule is missing");
  const rule = source.slice(start, end);
  assert.ok(rule.includes("overflow: hidden"), "the panel no longer clips overflow");
  assert.ok(rule.includes("width: 100%"), "the panel no longer pins to the widget width");
  assert.match(source, /minWidth:\s*PANEL_MIN_WIDTH/);
  assert.match(source, /minNodeSize\s*=\s*\[PANEL_MIN_WIDTH/);
});
