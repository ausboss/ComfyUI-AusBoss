// Pure decisions behind js/shared/script_colours.mjs: which parts of a script
// get which colour. No DOM, so tests run it under node:test.

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const span = (kind, text) => `<span class="${kind}">${escape(text)}</span>`;
const TOKENS = /(@\d)|("[^"\n]*"?)/g;
const LABEL = /^\s*(sound|music|camera|look):/i;

function lineMarkup(line, wired) {
  let head = "";
  let rest = line;
  const time = rest.match(/^(\s*)(\d+(?:\.\d+)?s:)/);
  const key = rest.match(/^(\s*)(sound|music|camera|look):/i);
  if (time) { head = escape(time[1]) + span("time", time[2]); rest = rest.slice(time[0].length); }
  else if (key) { head = escape(key[1]) + span("key", `${key[2]}:`); rest = rest.slice(key[0].length); }
  let out = head;
  let at = 0;
  for (const match of rest.matchAll(TOKENS)) {
    out += escape(rest.slice(at, match.index));
    if (match[1]) {
      const number = Number(match[1].slice(1));
      out += span(number >= 1 && number <= 4 && wired(number) ? "at" : "at unknown", match[1]);
    } else {
      out += span("say", match[2]);
    }
    at = match.index + match[0].length;
  }
  return out + escape(rest.slice(at));
}

// The coloured copy of a script, as HTML. wired(number) says whether a
// picture is plugged in under that @ number; one that isn't shows amber.
// A blank line between two lines is a cut, unless the script says no cuts or
// what follows is a label line.
export function scriptMarkup(text, wired = () => true) {
  const lines = String(text ?? "").split("\n");
  const cuts = !/\bno cuts\b/i.test(String(text ?? ""));
  const filled = lines.map((line) => line.trim() !== "");
  // A sound:, music:, camera: or look: line on its own is for the whole clip, not a new shot.
  const label = lines.map((line) => LABEL.test(line));
  const html = lines.map((line, index) => {
    if (filled[index]) return lineMarkup(line, wired);
    const before = filled.slice(0, index).some(Boolean);
    const next = filled.indexOf(true, index + 1);
    const after = next >= 0 && !label[next];
    const firstBlank = index > 0 && filled[index - 1];
    return cuts && before && after && firstBlank ? '<span class="cut">​</span>' : escape(line);
  });
  // A box that ends on a new line shows one more empty line.
  return html.join("\n") + (String(text ?? "").endsWith("\n") ? " " : "");
}
