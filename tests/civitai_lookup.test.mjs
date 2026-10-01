import test from "node:test";
import assert from "node:assert/strict";

import {
  CIVITAI_BY_HASH_URL,
  MAX_CIVITAI_BYTES,
  civitaiButtonLabel,
  civitaiByHashUrl,
  parseCivitaiBody,
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
