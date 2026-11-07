// The pack's node-face palette, in one place. Cards, number boxes and
// switches read their colours, font and sizes from here instead of
// carrying their own literals.
//
// The look: solid gray controls with no outlines on a near-black card,
// neutral grays, and one teal accent for whatever is on or picked.
//
// No imports on purpose: scrub_input.mjs and the node:test suites load
// this file without the ComfyUI app.

export const THEME = Object.freeze({
  brand: "#00b4aa",          // the one accent: picked segment, switch on, focus ring
  onBrand: "#04201d",        // text on a brand fill
  brandSoft: "rgba(0,180,170,.16)", // chip fill
  brandSoftHover: "rgba(0,180,170,.26)",
  brandInk: "#45d6cb",       // chip text on brandSoft
  brandGlow: "#6fe0d6",      // the big text look

  card: "#101214",           // widget card ground
  fill: "#2d3134",           // every control: solid, no border
  fillHover: "#383c40",      // control hover, the chevron column
  well: "#0f1112",           // picture stage ground
  rule: "#2b2f32",           // hairline after a section label
  switchOff: "#62676d",      // the mark of a switch sitting on off

  ink: "#f6f7f8",            // values: numbers, picked options, typed text
  inkSoft: "#e0e3e5",        // default card text
  inkHover: "#ffffff",
  label: "#b4b9bd",          // row labels, unselected segments, chevrons
  faint: "#979da2",          // units, section labels, placeholders, muted rows

  danger: "#e0605a",         // stop: the dot on the Stop button
  dangerInk: "#ffd9d6",
  dangerSoft: "#3a1c1b",

  warn: "#e0a040",
  warnInk: "#ffdca8",
  warnSoft: "#3a2a10",
});

export const FONT_UI = `system-ui,-apple-system,"Segoe UI",Roboto,sans-serif`;

// Every control in a card row is as tall as the row.
export const CONTROL_HEIGHT = 26;
export const RADIUS_XS = 4;
export const RADIUS_CONTROL = 6;
export const RADIUS_CARD = 10;

// The select's chevron, drawn in `label`.
export const SELECT_CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23b4b9bd' stroke-width='1.5'/%3E%3C/svg%3E")`;
