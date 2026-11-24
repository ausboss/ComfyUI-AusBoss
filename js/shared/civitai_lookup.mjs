// Pure helpers for the LoRA Loader's one-click Civitai lookup. The browser
// asks Civitai about one file by its SHA256; the server never contacts anyone.

export const CIVITAI_BY_HASH_URL = "https://civitai.com/api/v1/model-versions/by-hash/";

// A real answer is about 150 KB of JSON; this only stops absurd bodies.
export const MAX_CIVITAI_BYTES = 1024 * 1024;

// The hash is the only part of the address that varies, so it is checked to
// be a plain SHA256 before it goes anywhere near the URL.
export function civitaiByHashUrl(sha256) {
  const hash = String(sha256 ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("Could not hash this LoRA file.");
  return CIVITAI_BY_HASH_URL + hash;
}

// Civitai's answer as an object, or an error. The server checks it again.
export function parseCivitaiBody(text) {
  if (typeof text !== "string" || text.length > MAX_CIVITAI_BYTES) {
    throw new Error("Civitai's answer is too large.");
  }
  const payload = JSON.parse(text);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Civitai's answer was not what we expected.");
  }
  return payload;
}

// What to tell the person when a Civitai call fails. A browser that cannot
// reach the site at all only says "Failed to fetch", which explains nothing.
export function civitaiFailureText(error) {
  if (error instanceof TypeError) {
    return "Could not reach civitai.com. A firewall, a VPN or starting ComfyUI "
      + "with --disable-api-nodes can block it.";
  }
  return String(error?.message || error || "The Civitai lookup failed.");
}

export function civitaiButtonLabel(hasCivitai) {
  return hasCivitai ? "Refresh Civitai info" : "Fetch Civitai info";
}

// ---------- the LoRA's preview picture ----------
// After the lookup, the browser also downloads the LoRA's first picture from
// Civitai's picture server, and the pack's server saves it beside the LoRA.

export const PICTURE_HOST = "image.civitai.com";
export const PICTURE_WIDTH = 450;
export const MAX_PICTURE_BYTES = 8 * 1024 * 1024;

// Civitai rates each picture. The number is a set of flags: 1 = PG,
// 2 = PG-13, 4 = R, 8 = X, 16 = XXX. Older answers give a word instead.
const MILD_LEVEL = 2;
const MILD_WORDS = new Set(["none", "soft"]);

export function isMildPicture(image) {
  const level = Number(image?.nsfwLevel);
  if (Number.isFinite(level) && level > 0) return level <= MILD_LEVEL;
  if (typeof image?.nsfw === "string") return MILD_WORDS.has(image.nsfw.toLowerCase());
  if (image?.nsfw === false) return true;
  return false;
}

// The first still picture in Civitai's answer that may be saved: PG and
// PG-13 only, unless any rating is allowed.
export function pickCivitaiPicture(info, anyRating = false) {
  const images = Array.isArray(info?.images) ? info.images : [];
  return images.find((image) =>
    image && typeof image.url === "string"
    && (image.type ?? "image") === "image"
    && (anyRating || isMildPicture(image))
    && smallPictureUrl(image.url) !== null) ?? null;
}

// The address of a 450-pixel copy of the picture, or null for any address
// that is not Civitai's picture server over https.
export function smallPictureUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== PICTURE_HOST) return null;
  const parts = parsed.pathname.split("/");
  const sizing = parts.findIndex((part, index) => index > 1 && index < parts.length - 1 && part.includes("="));
  if (sizing >= 0) parts[sizing] = `width=${PICTURE_WIDTH}`;
  else if (parts.length >= 3) parts.splice(parts.length - 1, 0, `width=${PICTURE_WIDTH}`);
  else return null;
  parsed.pathname = parts.join("/");
  parsed.search = "";
  parsed.hash = "";
  return parsed.href;
}

// Where the picture really came from, after Civitai's redirect to its file
// store: Civitai's own servers, over https.
export function isCivitaiAddress(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:"
      && (parsed.hostname === "civitai.com" || parsed.hostname.endsWith(".civitai.com"));
  } catch {
    return false;
  }
}

// ---------- fetch all ----------
// One button runs the same one-file lookup for every LoRA in a stack that has
// no Civitai info yet: one file at a time, with a pause between files so
// Civitai is not asked too fast. Nothing here talks to the network itself;
// the caller hands in the lookup.

// The pause between two lookups, and the longer one after Civitai answers
// 429 ("too many requests"). A second 429 ends the run.
export const QUEUE_PAUSE_MS = 1500;
export const SLOW_DOWN_PAUSE_MS = 20000;
// This many failures in a row ends the run: something is wrong for all files.
export const MAX_FAILURES_IN_A_ROW = 3;

// `names`: the stack's LoRA names (repeats and blanks are dropped).
// `needsLookup(name)`: true when the file has no Civitai info yet; an error
//   means the file is missing, and it is left out.
// `lookUp(name)`: false when Civitai does not know the file, else
//   `{ picture }` ("saved" when a picture was saved). An error with
//   `status: 429` means slow down; a TypeError means Civitai cannot be reached.
// `wait(ms)`: a pause; it may end early once `shouldStop()` is true.
// `onProgress({ done, total, name })`: total is null while files are checked.
export async function runCivitaiQueue(names, {
  needsLookup, lookUp, wait, shouldStop = () => false, onProgress = () => {},
  pauseMs = QUEUE_PAUSE_MS, slowDownMs = SLOW_DOWN_PAUSE_MS,
}) {
  const result = {
    total: 0, done: 0, found: 0, pictures: 0, notFound: 0, failed: 0,
    alreadyHad: 0, missing: 0, stopped: null, error: null,
  };
  const unique = [...new Set((names ?? []).filter((name) => typeof name === "string" && name))];
  const todo = [];
  onProgress({ done: 0, total: null, name: null });
  for (const name of unique) {
    if (shouldStop()) { result.stopped = "you"; return result; }
    try {
      if (await needsLookup(name)) todo.push(name);
      else result.alreadyHad += 1;
    } catch {
      result.missing += 1;
    }
  }
  result.total = todo.length;
  onProgress({ done: 0, total: result.total, name: null });
  let failuresInRow = 0;
  for (const name of todo) {
    if (result.done > 0) await wait(pauseMs);
    if (shouldStop()) { result.stopped = "you"; return result; }
    let slowedDown = false;
    for (;;) {
      try {
        const answer = await lookUp(name);
        if (answer) {
          result.found += 1;
          if (answer.picture === "saved") result.pictures += 1;
        } else {
          result.notFound += 1;
        }
        failuresInRow = 0;
        break;
      } catch (error) {
        if (error?.status === 429 && !slowedDown) {
          slowedDown = true;
          await wait(slowDownMs);
          if (shouldStop()) { result.stopped = "you"; return result; }
          continue;
        }
        result.error = error;
        if (error?.status === 429) { result.stopped = "slow down"; return result; }
        if (error instanceof TypeError) { result.stopped = "unreachable"; return result; }
        result.failed += 1;
        failuresInRow += 1;
        break;
      }
    }
    result.done += 1;
    onProgress({ done: result.done, total: result.total, name });
    if (failuresInRow >= MAX_FAILURES_IN_A_ROW) { result.stopped = "failures"; return result; }
  }
  return result;
}

// The run's button while it works: where it is, and that a click stops it.
export function civitaiQueueLabel(done, total) {
  return total == null ? "Civitai: checking · Stop" : `Civitai ${done} / ${total} · Stop`;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// What the run did, in one or two plain sentences for the closing message.
export function civitaiQueueSummary(result) {
  if (!result.total && !result.stopped) {
    if (result.alreadyHad && !result.missing) return "Every LoRA in this stack already has its Civitai info.";
    if (!result.alreadyHad && !result.missing) return "This stack has no LoRAs to look up.";
  }
  const parts = [];
  if (result.found) {
    parts.push(`found ${plural(result.found, "LoRA")}`
      + (result.pictures ? ` (${plural(result.pictures, "new picture")})` : ""));
  }
  if (result.notFound) parts.push(`${result.notFound} not on Civitai`);
  if (result.failed) parts.push(`${result.failed} failed`);
  if (result.alreadyHad) parts.push(`${result.alreadyHad} already had info`);
  if (result.missing) parts.push(`${plural(result.missing, "file")} not found on disk`);
  let text = parts.length ? `Civitai: ${parts.join(", ")}.` : "Civitai: nothing fetched.";
  const left = result.total - result.done;
  if (result.stopped === "you") text += ` Stopped with ${left} left.`;
  else if (result.stopped === "slow down") {
    text += ` Civitai asked us to slow down, so it stopped with ${left} left. Try again in a few minutes.`;
  } else if (result.stopped === "unreachable") text += ` ${civitaiFailureText(result.error)}`;
  else if (result.failed && !result.stopped) text += ` Last failure: ${civitaiFailureText(result.error)}`;
  else if (result.stopped === "failures") {
    text += ` Stopped after ${MAX_FAILURES_IN_A_ROW} failures in a row: ${civitaiFailureText(result.error)}`;
  }
  return text;
}
