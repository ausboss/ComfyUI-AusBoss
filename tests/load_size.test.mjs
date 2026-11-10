import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SIZE_MODES, placeText, planLoadSize, sizeText, stepFile } from "../js/shared/load_size.mjs";

const table = JSON.parse(readFileSync(new URL("./fixtures/load_size_cases.json", import.meta.url), "utf8"));

test("the size the node shows is the size the run gives, case by case", () => {
  assert.ok(table.rows.length > 200);
  const seen = new Set();
  for (const row of table.rows) {
    const [sourceWidth, sourceHeight, size, megapixels, longest_side, scale, width, height, multiple, enlarge, ...wanted] = row;
    seen.add(size);
    const plan = planLoadSize(sourceWidth, sourceHeight, { size, megapixels, longest_side, scale, width, height, multiple, enlarge });
    assert.deepEqual(
      [plan.resizeWidth, plan.resizeHeight, plan.cropX, plan.cropY, plan.width, plan.height],
      wanted,
      JSON.stringify(row.slice(0, 10)),
    );
  }
  assert.deepEqual([...seen].sort(), [...SIZE_MODES].sort(), "every size choice is in the table");
});

test("off gives the picture back whatever the other settings say", () => {
  const plan = planLoadSize(913, 1631, { size: "off", multiple: 64, megapixels: 4, enlarge: false });
  assert.deepEqual([plan.width, plan.height, plan.cropX, plan.cropY], [913, 1631, 0, 0]);
});

test("longest side lands on the number asked for, and round to moves it to a multiple", () => {
  assert.deepEqual(planLoadSize(912, 1632, { size: "longest side", longest_side: 2048, multiple: 1 }).height, 2048);
  const rounded = planLoadSize(912, 1632, { size: "longest side", longest_side: 2000, multiple: 16 });
  assert.equal(rounded.height, 2000);
  assert.equal(rounded.width % 16, 0);
});

test("with enlarge off a small picture keeps its size, and crop to fill only cuts", () => {
  const kept = planLoadSize(640, 480, { size: "megapixels", megapixels: 4, multiple: 1, enlarge: false });
  assert.deepEqual([kept.width, kept.height], [640, 480]);
  const cut = planLoadSize(800, 600, { size: "crop to fill", width: 1024, height: 1024, multiple: 1, enlarge: false });
  assert.deepEqual([cut.width, cut.height, cut.resizeWidth, cut.resizeHeight, cut.cropX, cut.cropY], [600, 600, 800, 600, 100, 0]);
});

test("fit inside never leaves its box, rounding included", () => {
  const plan = planLoadSize(1920, 1080, { size: "fit inside", width: 1000, height: 1000, multiple: 64 });
  assert.ok(plan.width <= 1000 && plan.height <= 1000);
  assert.equal(plan.width % 64, 0);
});

test("a picture with no size yet, or a choice the node does not know, has no plan", () => {
  assert.equal(planLoadSize(0, 0, { size: "scale" }), null);
  assert.equal(planLoadSize(100, 100, { size: "" }), null);
  assert.equal(planLoadSize(100, 100, { size: "stretch" }), null);
});

test("the size line shows one size when nothing changes and both when it does", () => {
  assert.equal(sizeText(912, 1632, planLoadSize(912, 1632, { size: "off" })), "912 × 1632");
  assert.equal(
    sizeText(912, 1632, planLoadSize(912, 1632, { size: "longest side", longest_side: 2048, multiple: 8 })),
    "912 × 1632 → 1144 × 2048",
  );
  assert.equal(sizeText(0, 0, null), "");
  assert.equal(sizeText(912, 1632, null), "912 × 1632");
});

test("the arrows go round the list, and a file that is not listed steps onto it", () => {
  const files = ["a.png", "b.png", "sub/c.png"];
  assert.equal(stepFile(files, "a.png", 1), "b.png");
  assert.equal(stepFile(files, "sub/c.png", 1), "a.png");
  assert.equal(stepFile(files, "a.png", -1), "sub/c.png");
  assert.equal(stepFile(files, "gone.png", 1), "a.png");
  assert.equal(stepFile(files, "gone.png", -1), "sub/c.png");
  assert.equal(stepFile(["only.png"], "only.png", 1), null);
  assert.equal(stepFile([""], "", 1), null, "an empty input folder lists one blank");
  assert.equal(stepFile(undefined, "a.png", 1), null);
});

test("the place in the list counts from one", () => {
  const files = ["a.png", "b.png", "sub/c.png"];
  assert.equal(placeText(files, "b.png"), "2 / 3");
  assert.equal(placeText(files, "gone.png"), "– / 3");
  assert.equal(placeText([""], ""), "");
});

test("Load Image is one of the loaders checked for a picked file before a run", async () => {
  const { SOURCE_LOADERS } = await import("../js/shared/run_check.mjs");
  assert.equal(typeof SOURCE_LOADERS.AUSBOSS_NODES_LoadImage, "function");
  assert.ok(SOURCE_LOADERS.AUSBOSS_NODES_LoadImage({ image: "" }));
  assert.equal(SOURCE_LOADERS.AUSBOSS_NODES_LoadImage({ image: "pic.png" }), null);
});
