import test from "node:test";
import assert from "node:assert/strict";

import {
  CIVITAI_BY_HASH_URL,
  MAX_CIVITAI_BYTES,
  civitaiButtonLabel,
  civitaiByHashUrl,
  civitaiFailureText,
  isCivitaiAddress,
  isMildPicture,
  parseCivitaiBody,
  pickCivitaiPicture,
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
