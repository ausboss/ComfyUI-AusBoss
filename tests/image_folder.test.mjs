import assert from "node:assert/strict";
import test from "node:test";

import {
  childOf,
  countLine,
  foldersAddress,
  isPicked,
  listAddress,
  nameAt,
  nextPosition,
  parentOf,
  parsePicked,
  pickRange,
  pickedNames,
  placeOf,
  serializePicked,
  summary,
  thumbAddress,
  togglePick,
} from "../js/shared/image_folder.mjs";

const NAMES = ["a.png", "b.png", "c.png", "d.png"];

test("an empty widget means every picture, and a list is read as names", () => {
  assert.equal(parsePicked(""), null);
  assert.equal(parsePicked("   "), null);
  assert.deepEqual(parsePicked('["b.png","a.png","b.png"]'), ["b.png", "a.png"]);
  assert.deepEqual(parsePicked("[]"), []);
  // Unreadable text counts as every picture here; the node refuses it when it runs.
  for (const bad of ["{", '"a.png"', "[1]", '{"a":1}']) assert.equal(parsePicked(bad), null);
  assert.deepEqual(parsePicked('["sub\\\\x.png"]'), ["sub/x.png"]);
});

test("picked names come back in the folder's order, without the ones that are gone", () => {
  assert.deepEqual(pickedNames(null, NAMES), NAMES);
  assert.deepEqual(pickedNames(["d.png", "gone.png", "a.png"], NAMES), ["a.png", "d.png"]);
  assert.equal(isPicked(null, "c.png"), true);
  assert.equal(isPicked(["a.png"], "c.png"), false);
});

test("a click takes one picture out of all, and a full pick is all again", () => {
  let picked = togglePick(null, NAMES, "b.png");
  assert.deepEqual(picked, ["a.png", "c.png", "d.png"]);
  picked = togglePick(picked, NAMES, "b.png");
  assert.equal(picked, null, "every picture ticked is the same as All");
  assert.deepEqual(togglePick([], NAMES, "c.png"), ["c.png"]);
  assert.deepEqual(togglePick(["c.png"], NAMES, "c.png"), []);
  assert.deepEqual(togglePick(["c.png"], NAMES, "not-there.png"), ["c.png"]);
});

test("a Shift click ticks or clears a run of pictures", () => {
  assert.deepEqual(pickRange([], NAMES, "b.png", "d.png", true), ["b.png", "c.png", "d.png"]);
  assert.deepEqual(pickRange([], NAMES, "d.png", "b.png", true), ["b.png", "c.png", "d.png"], "either direction");
  assert.deepEqual(pickRange(null, NAMES, "a.png", "b.png", false), ["c.png", "d.png"]);
  assert.equal(pickRange(["a.png"], NAMES, "b.png", "d.png", true), null);
  assert.deepEqual(pickRange(["a.png"], NAMES, "b.png", "zzz.png", true), ["a.png"]);
});

test("the widget holds nothing for all, else the names in folder order", () => {
  assert.equal(serializePicked(null, NAMES), "");
  assert.equal(serializePicked(["d.png", "a.png"], NAMES), '["a.png","d.png"]');
  assert.equal(serializePicked([], NAMES), "[]");
  assert.deepEqual(parsePicked(serializePicked(["c.png"], NAMES)), ["c.png"]);
});

test("the count line", () => {
  assert.equal(summary(null, NAMES).text, "all 4 picked");
  assert.equal(summary(["a.png", "c.png"], NAMES).text, "2 of 4 picked");
  assert.equal(summary([], NAMES).text, "none of 4 picked");
  assert.equal(summary(null, []).text, "no pictures");
  assert.deepEqual(summary(["a.png", "gone.png"], NAMES), { count: 1, total: 4, text: "1 of 4 picked" });
});

test("a picture's number among the picked ones", () => {
  assert.equal(placeOf(null, NAMES, "c.png"), 3);
  assert.equal(placeOf(["d.png", "b.png"], NAMES, "d.png"), 2);
  assert.equal(placeOf(["b.png"], NAMES, "a.png"), 0);
});

test("the picture the next one-per-run run loads", () => {
  assert.equal(nameAt(null, NAMES, 2, "stop the run"), "b.png");
  assert.equal(nameAt(["d.png", "b.png"], NAMES, 2, "stop the run"), "d.png");
  assert.equal(nameAt(null, NAMES, 5, "stop the run"), null, "past the last one it stops");
  assert.equal(nameAt(null, NAMES, 5, "start over"), "a.png");
  assert.equal(nameAt(null, NAMES, 0, "stop the run"), "a.png");
  assert.equal(nameAt([], NAMES, 1, "stop the run"), null);
});

test("Picture moves on by one after a run, and stops one past the last", () => {
  assert.equal(nextPosition(1, 4, "next"), 2);
  assert.equal(nextPosition(4, 4, "next"), 5, "one past the last: the node stops the run there");
  assert.equal(nextPosition(5, 4, "next"), 5, "and it goes no further");
  assert.equal(nextPosition(2, 4, "stay"), 2);
  assert.equal(nextPosition(2, 0, "next"), 2);
  assert.equal(nextPosition("x", 4, "next"), 2);
  // random lands on any picked picture, never past the last
  assert.equal(nextPosition(2, 4, "random", 0), 1);
  assert.equal(nextPosition(2, 4, "random", 0.5), 3);
  assert.equal(nextPosition(2, 4, "random", 0.9999), 4);
});

test("the count line says which picture is next, in a form that fits", () => {
  const DOT = "\u00b7";
  assert.deepEqual(countLine(null, NAMES, { run: "all in one run" }), { text: "all 4 picked", warn: false });
  assert.deepEqual(countLine([], NAMES, { run: "all in one run" }), { text: "none of 4 picked", warn: true });
  assert.equal(countLine(null, NAMES, { run: "one per run", position: 3 }).text, `all 4 ${DOT} next 3`);
  assert.equal(countLine(["a.png", "c.png"], NAMES, { run: "one per run", position: 1 }).text, `2 of 4 ${DOT} next 1`);
  assert.deepEqual(countLine(null, NAMES, { run: "one per run", position: 5, atTheEnd: "stop the run" }), { text: `all 4 ${DOT} all done`, warn: true });
  assert.equal(countLine(null, NAMES, { run: "one per run", position: 6, atTheEnd: "start over" }).text, `all 4 ${DOT} next 2`);
  assert.deepEqual(countLine([], NAMES, { run: "one per run", position: 1 }), { text: "none of 4 picked", warn: true });
});

test("folders: up and into", () => {
  assert.equal(parentOf("people/trips"), "people");
  assert.equal(parentOf("people"), "");
  assert.equal(parentOf(""), "");
  assert.equal(childOf("", "people"), "people");
  assert.equal(childOf("people/", "trips"), "people/trips");
});

test("addresses carry every value encoded", () => {
  assert.equal(listAddress({ source: "input", folder: "my set/a&b", subfolders: true, sort: "newest first" }),
    "/ausboss/image_folder/list?source=input&folder=my%20set%2Fa%26b&subfolders=1&sort=newest%20first");
  assert.equal(listAddress({ source: "output", folder: "", subfolders: false, sort: "name" }),
    "/ausboss/image_folder/list?source=output&subfolders=0&sort=name");
  assert.equal(foldersAddress({ source: "input", folder: "" }), "/ausboss/image_folder/folders?source=input");
  assert.equal(thumbAddress({ source: "input", folder: "p", name: "a b#1.png", v: 12 }),
    "/ausboss/image_folder/thumb?source=input&folder=p&name=a%20b%231.png&size=160&v=12");
});
