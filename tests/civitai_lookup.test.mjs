import test from "node:test";
import assert from "node:assert/strict";

import {
  CIVITAI_BY_HASH_URL,
  MAX_CIVITAI_BYTES,
  civitaiButtonLabel,
  civitaiByHashUrl,
  civitaiFailureText,
  civitaiQueueLabel,
  civitaiQueueSummary,
  isCivitaiAddress,
  isMildPicture,
  parseCivitaiBody,
  pickCivitaiPicture,
  runCivitaiQueue,
  smallPictureUrl,
} from "../js/shared/civitai_lookup.mjs";

const SHA = "a".repeat(64);

test("the lookup address is the fixed Civitai host plus a plain SHA256", () => {
  assert.equal(civitaiByHashUrl(SHA), `${CIVITAI_BY_HASH_URL}${SHA}`);
  assert.equal(civitaiByHashUrl(` ${SHA.toUpperCase()} `), `${CIVITAI_BY_HASH_URL}${SHA}`);
  assert.ok(CIVITAI_BY_HASH_URL.startsWith("https://civitai.com/"));
});

test("anything that is not a SHA256 never becomes part of an address", () => {
  for (const bad of ["", null, undefined, "abc", `${SHA}/../x`, `${SHA}?a=1`, "g".repeat(64), `${SHA}0`]) {
    assert.throws(() => civitaiByHashUrl(bad), /Could not hash/);
  }
});

test("parseCivitaiBody keeps objects and rejects everything else", () => {
  assert.deepEqual(parseCivitaiBody('{"id": 1}'), { id: 1 });
  assert.throws(() => parseCivitaiBody("[1]"));
  assert.throws(() => parseCivitaiBody("null"));
  assert.throws(() => parseCivitaiBody("not json"));
  assert.throws(() => parseCivitaiBody("x".repeat(MAX_CIVITAI_BYTES + 1)), /too large/);
});

test("the button says refresh once Civitai info exists", () => {
  assert.equal(civitaiButtonLabel(false), "Fetch Civitai info");
  assert.equal(civitaiButtonLabel(true), "Refresh Civitai info");
});

const picture = (name) => `https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/0b1c2d3e/width=1024/${name}.jpeg`;

test("only PG and PG-13 pictures are picked unless any rating is allowed", () => {
  const info = { images: [
    { url: picture("video"), type: "video", nsfwLevel: 1 },
    { url: picture("r"), type: "image", nsfwLevel: 4 },
    { url: picture("pg13"), type: "image", nsfwLevel: 2 },
  ] };
  assert.equal(pickCivitaiPicture(info).url, picture("pg13"));
  assert.equal(pickCivitaiPicture(info, true).url, picture("r"));
  assert.equal(pickCivitaiPicture({ images: [{ url: picture("x"), nsfwLevel: 8 }] }), null);
  assert.equal(pickCivitaiPicture({}), null);
  assert.equal(pickCivitaiPicture(null), null);
});

test("older answers rate pictures with a word, and an unrated picture is not mild", () => {
  assert.equal(isMildPicture({ nsfw: "None" }), true);
  assert.equal(isMildPicture({ nsfw: "Soft" }), true);
  assert.equal(isMildPicture({ nsfw: "Mature" }), false);
  assert.equal(isMildPicture({}), false);
});

test("the small copy comes only from Civitai's picture server over https", () => {
  assert.equal(smallPictureUrl(picture("a")), "https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/0b1c2d3e/width=450/a.jpeg");
  assert.equal(smallPictureUrl("https://image.civitai.com/key/uuid/original=true/a.png"),
    "https://image.civitai.com/key/uuid/width=450/a.png");
  assert.equal(smallPictureUrl("https://image.civitai.com/key/uuid/a.png"), "https://image.civitai.com/key/uuid/width=450/a.png");
  assert.equal(smallPictureUrl("http://image.civitai.com/key/uuid/width=1024/a.png"), null);
  assert.equal(smallPictureUrl("https://image.civitai.com.example.org/key/uuid/a.png"), null);
  assert.equal(smallPictureUrl("https://example.org/a.png"), null);
  assert.equal(smallPictureUrl("not a url"), null);
  assert.equal(pickCivitaiPicture({ images: [{ url: "https://example.org/a.png", nsfwLevel: 1 }] }), null);
});

test("after the redirect the picture must still be on a Civitai server", () => {
  assert.equal(isCivitaiAddress("https://blobs-b2.civitai.com/file.jpeg"), true);
  assert.equal(isCivitaiAddress("https://civitai.com/file.jpeg"), true);
  assert.equal(isCivitaiAddress("http://blobs-b2.civitai.com/file.jpeg"), false);
  assert.equal(isCivitaiAddress("https://evilcivitai.com/file.jpeg"), false);
  assert.equal(isCivitaiAddress(""), false);
});

test("a failed lookup says why in plain words", () => {
  assert.match(civitaiFailureText(new TypeError("Failed to fetch")), /Could not reach civitai\.com/);
  assert.match(civitaiFailureText(new TypeError("Failed to fetch")), /--disable-api-nodes/);
  assert.equal(civitaiFailureText(new Error("Civitai answered 500.")), "Civitai answered 500.");
  assert.equal(civitaiFailureText(null), "The Civitai lookup failed.");
});

// ---------- fetch all ----------

// A fake Civitai: `answers` maps a name to what lookUp returns or throws.
function fakeQueue({ have = [], missing = [], answers = {}, stopAfter = Infinity } = {}) {
  const asked = [];
  const pauses = [];
  const progress = [];
  let stop = false;
  const options = {
    needsLookup: async (name) => {
      if (missing.includes(name)) throw new Error("No such LoRA.");
      return !have.includes(name);
    },
    lookUp: async (name) => {
      asked.push(name);
      if (asked.length >= stopAfter) stop = true;
      const answer = typeof answers[name] === "function" ? answers[name](asked) : answers[name];
      if (answer instanceof Error) throw answer;
      return answer ?? { picture: "saved" };
    },
    wait: async (ms) => { pauses.push(ms); },
    shouldStop: () => stop,
    onProgress: (step) => progress.push({ ...step }),
  };
  return { asked, pauses, progress, options, stopNow: () => { stop = true; } };
}

const statusError = (status) => Object.assign(new Error(`Civitai answered ${status}.`), { status });

test("fetch all asks only about LoRAs with no info, once each, with a pause between", async () => {
  const fake = fakeQueue({ have: ["b"], missing: ["gone"], answers: { c: false, d: { picture: "none" } } });
  const result = await runCivitaiQueue(["a", "b", "", "a", "gone", "c", "d", null], fake.options);
  assert.deepEqual(fake.asked, ["a", "c", "d"]);
  assert.deepEqual(fake.pauses, [1500, 1500]);
  assert.equal(result.total, 3);
  assert.equal(result.done, 3);
  assert.equal(result.found, 2);
  assert.equal(result.pictures, 1);
  assert.equal(result.notFound, 1);
  assert.equal(result.alreadyHad, 1);
  assert.equal(result.missing, 1);
  assert.equal(result.stopped, null);
  assert.deepEqual(fake.progress.map(({ done, total }) => [done, total]), [[0, null], [0, 3], [1, 3], [2, 3], [3, 3]]);
  assert.equal(civitaiQueueSummary(result),
    "Civitai: found 2 LoRAs (1 new picture), 1 not on Civitai, 1 already had info, 1 file not found on disk.");
});

test("stop ends the run after the file being fetched", async () => {
  const fake = fakeQueue({ stopAfter: 2 });
  const result = await runCivitaiQueue(["a", "b", "c", "d"], fake.options);
  assert.deepEqual(fake.asked, ["a", "b"]);
  assert.equal(result.stopped, "you");
  assert.equal(result.done, 2);
  assert.match(civitaiQueueSummary(result), /Stopped with 2 left\.$/);
});

test("stop while the files are checked asks Civitai nothing", async () => {
  const fake = fakeQueue();
  fake.stopNow();
  const result = await runCivitaiQueue(["a", "b"], fake.options);
  assert.deepEqual(fake.asked, []);
  assert.equal(result.stopped, "you");
});

test("one failure is counted and the run goes on", async () => {
  const fake = fakeQueue({ answers: { b: new Error("Could not save the Civitai info.") } });
  const result = await runCivitaiQueue(["a", "b", "c"], fake.options);
  assert.deepEqual(fake.asked, ["a", "b", "c"]);
  assert.equal(result.failed, 1);
  assert.equal(result.found, 2);
  assert.equal(result.stopped, null);
  assert.match(civitaiQueueSummary(result), /1 failed\. Last failure: Could not save the Civitai info\.$/);
});

test("three failures in a row end the run", async () => {
  const broken = new Error("Civitai answered 500.");
  const fake = fakeQueue({ answers: { a: broken, b: broken, c: broken } });
  const result = await runCivitaiQueue(["a", "b", "c", "d", "e"], fake.options);
  assert.deepEqual(fake.asked, ["a", "b", "c"]);
  assert.equal(result.stopped, "failures");
  assert.match(civitaiQueueSummary(result), /Stopped after 3 failures in a row: Civitai answered 500\./);
});

test("a site that cannot be reached ends the run at once", async () => {
  const fake = fakeQueue({ answers: { a: new TypeError("Failed to fetch") } });
  const result = await runCivitaiQueue(["a", "b"], fake.options);
  assert.deepEqual(fake.asked, ["a"]);
  assert.equal(result.stopped, "unreachable");
  assert.match(civitaiQueueSummary(result), /Could not reach civitai\.com/);
});

test("Civitai's slow down waits longer and tries the file again once", async () => {
  const fake = fakeQueue({ answers: { b: (asked) => (asked.length === 2 ? statusError(429) : { picture: "saved" }) } });
  const result = await runCivitaiQueue(["a", "b", "c"], fake.options);
  assert.deepEqual(fake.asked, ["a", "b", "b", "c"]);
  assert.deepEqual(fake.pauses, [1500, 20000, 1500]);
  assert.equal(result.found, 3);
  assert.equal(result.stopped, null);
});

test("a second slow down in a row ends the run", async () => {
  const fake = fakeQueue({ answers: { b: statusError(429) } });
  const result = await runCivitaiQueue(["a", "b", "c"], fake.options);
  assert.deepEqual(fake.asked, ["a", "b", "b"]);
  assert.equal(result.stopped, "slow down");
  assert.match(civitaiQueueSummary(result), /asked us to slow down, so it stopped with 2 left/);
});

test("nothing to do says so plainly", async () => {
  const all = await runCivitaiQueue(["a"], fakeQueue({ have: ["a"] }).options);
  assert.equal(civitaiQueueSummary(all), "Every LoRA in this stack already has its Civitai info.");
  const none = await runCivitaiQueue([], fakeQueue().options);
  assert.equal(civitaiQueueSummary(none), "This stack has no LoRAs to look up.");
});

test("the run's button shows where it is and that a click stops it", () => {
  assert.equal(civitaiQueueLabel(0, null), "Civitai: checking · Stop");
  assert.equal(civitaiQueueLabel(12, 44), "Civitai 12 / 44 · Stop");
});
