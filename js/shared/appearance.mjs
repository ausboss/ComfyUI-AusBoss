// Node color schemes for the AusBoss appearance setting. Pure data and
// decision logic only — the DOM/graph wiring lives in js/appearance/index.js
// so this module stays testable under node:test.

// Each scheme pairs a title-bar color with a slightly lighter body color,
// tuned against ComfyUI's dark canvas. `colors: null` means "leave the
// theme's default colors alone".
export const NODE_COLOR_SCHEMES = [
  { name: "Theme default", colors: null },
  { name: "Graphite", colors: { title: "#242424", body: "#2f2f2f" } },
  { name: "Slate", colors: { title: "#1f2c38", body: "#2a3b4a" } },
  { name: "Teal", colors: { title: "#14332f", body: "#1c453f" } },
  { name: "Moss", colors: { title: "#23331c", body: "#2f4426" } },
  { name: "Plum", colors: { title: "#2e1f38", body: "#3d2a4a" } },
  { name: "Rust", colors: { title: "#3a2317", body: "#4c2f20" } },
  { name: "Navy", colors: { title: "#1b2338", body: "#242f4b" } },
];

export const DEFAULT_SCHEME = NODE_COLOR_SCHEMES[0].name;

export function schemeColors(name) {
  return NODE_COLOR_SCHEMES.find((scheme) => scheme.name === name)?.colors ?? null;
}

const normalize = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");

// Perceived luminance (Rec. 601 weights) of the title color picks the ink
// that keeps the title readable. Malformed input gets the light ink — every
// shipped scheme is dark, so light is the safe fallback.
export function titleInk(hex) {
  const match = /^#([0-9a-f]{6})$/.exec(normalize(hex));
  if (!match) return "#ffffff";
  const rgb = parseInt(match[1], 16);
  const luminance =
    (0.299 * ((rgb >> 16) & 0xff) + 0.587 * ((rgb >> 8) & 0xff) + 0.114 * (rgb & 0xff)) / 255;
  return luminance > 0.6 ? "#1a1a1a" : "#ffffff";
}

// A node is repainted only while it is still "following the setting": either
// it carries no colors while the previous scheme was the theme default, or it
// still wears exactly the previous scheme's pair. Anything else — a color the
// user picked by hand, colors restored from a saved workflow, or a manual
// "no color" reset while a scheme was active — is the user's choice and wins.
export function shouldRecolor(current, previousColors) {
  const color = normalize(current?.color);
  const bgcolor = normalize(current?.bgcolor);
  if (!previousColors) return !color && !bgcolor;
  return color === normalize(previousColors.title) && bgcolor === normalize(previousColors.body);
}
