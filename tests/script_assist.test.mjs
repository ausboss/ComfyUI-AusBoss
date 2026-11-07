import test from "node:test";
import assert from "node:assert/strict";
import { CHEAT_SHEET, suggestAt } from "../js/shared/script_assist_math.mjs";

const pictures = [
  { number: 1, job: "person", plugged: true },
  { number: 2, job: "place", plugged: true },
  { number: 3, job: "outfit", plugged: false },
  { number: 4, job: "thing", plugged: false },
];
const ctx = { pictures, cameras: ["handheld", "push in", "pull back"], looks: ["anime", "watercolour"], seconds: 8 };
const at = (text, extra = {}) => suggestAt(text, text.length, { ...ctx, ...extra });

test("@ lists only the pictures plugged in, with their job", () => {
  const offer = at("She walks into @");
  assert.equal(offer.strong, true);
  assert.deepEqual(offer.items.map((item) => [item.label, item.hint]), [["@1", "person"], ["@2", "place"]]);
  assert.equal(offer.from, "She walks into ".length);
  assert.deepEqual(at("@2").items.map((item) => item.label), ["@2"]);
});

test("@ with nothing plugged in still offers all four, marked", () => {
  const offer = at("@", { pictures: pictures.map((picture) => ({ ...picture, plugged: false })) });
  assert.equal(offer.items.length, 4);
  assert.equal(offer.items[0].hint, "not plugged in");
});

test("an email address or a second @ is not a picture", () => {
  assert.equal(at("mail me at a@"), null);
  assert.equal(at("@@"), null);
});

test("camera: and look: list the node's own choices", () => {
  assert.deepEqual(at("camera: p").items.map((item) => item.insert), ["push in", "pull back"]);
  assert.deepEqual(at("look:").items.map((item) => item.insert), ["anime", "watercolour"]);
  assert.equal(at("camera: push in"), null);
});

test("the first letters of a line offer a label, but only Tab takes it", () => {
  const offer = at("@1 runs.\nmu");
  assert.equal(offer.strong, false);
  assert.deepEqual(offer.items.map((item) => item.insert), ["music: "]);
  assert.equal(at("@1 runs.\ns"), null, "one letter is too little to guess from");
  assert.equal(at("look"), null, "a whole word is left alone");
  assert.equal(at("she walks"), null);
});

test("a number at the start of a line offers a time inside the clip", () => {
  assert.deepEqual(at("@1 sits.\n3").items.map((item) => item.insert), ["3s: "]);
  assert.equal(at("@1 sits.\n9"), null, "past the end of an 8 s clip");
  assert.equal(at("@1 sits.\n0"), null);
});

test("the help card names every kind of colored word", () => {
  const codes = CHEAT_SHEET.map((entry) => entry.code).join(" ");
  for (const word of ["@1", "3s:", "blank line", "quotes", "sound:", "music:", "camera:", "look:", "no cuts"]) assert.ok(codes.includes(word), word);
});
