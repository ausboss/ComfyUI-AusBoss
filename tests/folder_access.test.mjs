import assert from "node:assert/strict";
import test from "node:test";

import { CHOOSE_ROUTE, chooseOnServer, choiceOutcome } from "../js/shared/folder_access.mjs";

test("a chosen path is stored and nothing is said", () => {
  assert.deepEqual(choiceOutcome({ ok: true, path: "/data/sets" }), { path: "/data/sets", message: null });
});

test("a cancelled dialog is silent; busy, refusals and failures are explained", () => {
  assert.deepEqual(choiceOutcome({ ok: false, cancelled: true }), { path: null, message: null });
  assert.match(choiceOutcome({ ok: false, busy: true }).message, /already open/);
  assert.equal(
    choiceOutcome({ ok: false, unavailable: true, message: "approve it by hand" }).message,
    "approve it by hand",
  );
  assert.equal(choiceOutcome({ ok: false, refused: true, message: "holds ComfyUI" }).message, "holds ComfyUI");
  assert.match(choiceOutcome(null).message, /did not answer/);
  assert.match(choiceOutcome({ ok: true, path: "" }).message, /did not answer/);
});

test("the request names only the kind of dialog", async () => {
  const calls = [];
  const api = {
    fetchApi: async (url, options) => {
      calls.push({ url, options });
      return { json: async () => ({ ok: true, path: "/x" }) };
    },
  };
  assert.deepEqual(await chooseOnServer(api, "video"), { ok: true, path: "/x" });
  assert.equal(calls[0].url, CHOOSE_ROUTE);
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { kind: "video" });
  await chooseOnServer(api, "../../etc/passwd");
  assert.deepEqual(JSON.parse(calls[1].options.body), { kind: "folder" });
});

test("a network failure becomes a message, never a throw", async () => {
  const api = { fetchApi: async () => { throw new Error("offline"); } };
  assert.match(choiceOutcome(await chooseOnServer(api, "folder")).message, /offline/);
  const broken = { fetchApi: async () => ({ json: async () => { throw new Error("not json"); } }) };
  assert.match(choiceOutcome(await chooseOnServer(broken, "folder")).message, /did not answer/);
});
