// Decision logic for the Show Text panel. No DOM and no ComfyUI imports in
// here, so it stays testable under node:test.

// The executed message's `text` entry arrives however the run shaped it: our
// backend sends ["one string"], list-producing graphs deliver nested arrays,
// and a replayed history can hand the same payload back again. Flatten it to
// one displayable string. null means "nothing arrived", so the caller keeps
// its placeholder — distinct from "", which is a real (empty) result.
export function textFromExecuted(message) {
  const value = message?.text;
  if (value === undefined || value === null) return null;
  const parts = [];
  const walk = (entry) => {
    if (entry === undefined || entry === null) return;
    if (Array.isArray(entry)) {
      for (const item of entry) walk(item);
      return;
    }
    parts.push(typeof entry === "string" ? entry : String(entry));
  };
  walk(value);
  if (!parts.length) return null;
  return parts.join("\n");
}

// The panel is a viewport, not a document: a runaway string (a JSON dump, a
// caption model gone feral) must not build a multi-megabyte DOM node. The
// full string still flows through the node's STRING output untouched.
export const DISPLAY_LIMIT = 10000;

export function displayText(text, limit = DISPLAY_LIMIT) {
  if (typeof text !== "string") return { text: "", truncated: false };
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}
