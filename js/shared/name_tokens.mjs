// Name tokens in a save node's file name, as ComfyUI's own save nodes take them.
//
//   %date:yyyy-MM-dd%   the date, in the given form
//   %KSampler.seed%     a setting of another node, by the node's title or type
//   %width% %height%    the picture's size
//   %year% %month% %day% %hour% %minute% %second%
//
// ComfyUI fills the first two in the browser, and only for its own save
// nodes. Serializing a name widget through the same core utility opts a node
// of the pack in: the tokens are filled when a run is sent, and the saved
// workflow keeps the text as typed. The rest are filled by the server, which
// knows the picture's size and the time of the save, so they are left alone
// here (the core utility would only warn about them).

const SERVER_TOKENS = new Set(["width", "height", "year", "month", "day", "hour", "minute", "second"]);
const TOKEN = /%([^%]+)%/g;

const coreReplace = () => globalThis.comfyAPI?.utils?.applyTextReplacements;

// The text with the browser's tokens filled. `replace` is ComfyUI's own
// utility; without it, or when it fails, the text goes through untouched.
export function filledName(value, app, replace = coreReplace()) {
  const raw = String(value ?? "");
  if (typeof replace !== "function" || !raw.includes("%")) return raw;
  return raw.replace(TOKEN, (match, name) => {
    if (SERVER_TOKENS.has(name)) return match;
    try {
      return String(replace(app, match));
    } catch {
      return match;
    }
  });
}

const two = (number) => String(number).padStart(2, "0");

// What a name will look like before a run, for a preview on the node: the
// browser's tokens, and the time tokens as of `now`. The picture's size is
// not known until the run, so %width% and %height% stay as typed.
export function previewName(value, app, { now = new Date(), replace = coreReplace() } = {}) {
  const parts = {
    year: String(now.getFullYear()), month: two(now.getMonth() + 1), day: two(now.getDate()),
    hour: two(now.getHours()), minute: two(now.getMinutes()), second: two(now.getSeconds()),
  };
  const timed = String(value ?? "").replace(TOKEN, (match, name) => parts[name] ?? match);
  return filledName(timed, app, replace);
}

// Fill the tokens of these name widgets whenever a run is sent.
export function installNameTokens(node, names, app) {
  for (const name of names) {
    const widget = node.widgets?.find((item) => item.name === name);
    if (!widget || widget.__ausbossTokenSerialize) continue;
    widget.__ausbossTokenSerialize = true;
    widget.serializeValue = () => filledName(widget.value, app);
  }
}
