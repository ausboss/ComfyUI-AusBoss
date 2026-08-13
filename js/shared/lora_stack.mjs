// Pure state logic for the LoRA Loader rows: stack normalization, strength
// scrubbing math, and the picker's filter/keyboard model. DOM wiring lives in
// js/lora_loader/index.js; everything here runs under node:test.

export const STRENGTH_MIN = -10;
export const STRENGTH_MAX = 10;
export const DEFAULT_STEP = 0.05;
export const FINE_STEP = 0.01;
// Horizontal pixels of drag per strength step; small enough to feel light,
// large enough that a shaky click cannot change the value.
export const SCRUB_PIXELS_PER_STEP = 4;
export const SCRUB_DEAD_ZONE = 3;
export const MAX_ROWS = 64;

let rowSerial = 0;

export function clampStrength(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(STRENGTH_MIN, Math.min(STRENGTH_MAX, number));
}

export function roundStrength(value) {
  return Math.round(clampStrength(value) * 100) / 100;
}

export function newRow() {
  rowSerial += 1;
  return {
    id: `r${Date.now().toString(36)}${rowSerial}`,
    name: "",
    strength: 1,
    strength_clip: 1,
    enabled: true,
    triggers: "",
  };
}

export function normalizeRows(parsed) {
  if (!Array.isArray(parsed)) return [];
  return parsed.slice(0, MAX_ROWS).map((entry) => {
    const row = newRow();
    if (entry && typeof entry === "object") {
      row.id = typeof entry.id === "string" && entry.id ? entry.id : row.id;
      row.name = typeof entry.name === "string" ? entry.name : "";
      row.strength = roundStrength(entry.strength ?? 1);
      row.strength_clip = roundStrength(entry.strength_clip ?? row.strength);
      row.enabled = entry.enabled !== false;
      row.triggers = typeof entry.triggers === "string" ? entry.triggers : "";
    }
    return row;
  });
}

export function parseRows(raw) {
  try {
    return normalizeRows(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function serializeRows(rows) {
  return JSON.stringify(rows);
}

export function moveRow(rows, index, delta) {
  const target = index + delta;
  if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) return rows;
  const next = rows.slice();
  const [row] = next.splice(index, 1);
  next.splice(target, 0, row);
  return next;
}

export function setStrength(rows, index, value, linked) {
  const next = rows.slice();
  const row = { ...next[index], strength: roundStrength(value) };
  if (linked) row.strength_clip = row.strength;
  next[index] = row;
  return next;
}

// Scrub model: value follows horizontal pointer distance from the grab point.
// Inside the dead zone nothing changes, so a plain click stays a click.
export function scrubValue(startValue, deltaX, fine = false) {
  if (Math.abs(deltaX) <= SCRUB_DEAD_ZONE) return roundStrength(startValue);
  const step = fine ? FINE_STEP : DEFAULT_STEP;
  const travel = deltaX - Math.sign(deltaX) * SCRUB_DEAD_ZONE;
  const steps = Math.round(travel / SCRUB_PIXELS_PER_STEP);
  return roundStrength(startValue + steps * step);
}

export function isScrubbing(deltaX, deltaY) {
  return Math.abs(deltaX) > SCRUB_DEAD_ZONE && Math.abs(deltaX) >= Math.abs(deltaY);
}

export function filterLoras(names, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return names.slice();
  return names.filter((name) => name.toLowerCase().includes(needle));
}

// Picker keyboard model: a highlight index over the filtered list.
// Arrow keys wrap; Home/End jump; a shrinking filter keeps the highlight
// valid. Enter resolves to the highlighted name (null when the list is empty).
export function moveHighlight(index, delta, length) {
  if (length <= 0) return -1;
  if (index < 0) return delta >= 0 ? 0 : length - 1;
  return (index + delta + length) % length;
}

export function clampHighlight(index, length) {
  if (length <= 0) return -1;
  if (index < 0) return 0;
  return Math.min(index, length - 1);
}

export function highlightedName(names, index) {
  return index >= 0 && index < names.length ? names[index] : null;
}

export function toggleTrigger(triggers, word) {
  const parts = String(triggers || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const key = word.trim().toLowerCase();
  const existing = parts.findIndex((part) => part.toLowerCase() === key);
  if (existing >= 0) parts.splice(existing, 1);
  else if (word.trim()) parts.push(word.trim());
  return parts.join(", ");
}

export function summarizeRows(rows) {
  const on = rows.filter((row) => row.enabled && row.name).length;
  const total = rows.filter((row) => row.name).length;
  return total === 0 ? "no LoRAs" : `${on} / ${total} on`;
}

// Master toggle model: "on" when every named row is enabled, "off" when none
// are, "mixed" otherwise. Blank rows don't vote.
export function toggleAllState(rows) {
  const named = rows.filter((row) => row.name);
  if (!named.length) return "off";
  const on = named.filter((row) => row.enabled).length;
  return on === 0 ? "off" : on === named.length ? "on" : "mixed";
}

// Clicking the master pill: anything not fully-on turns everything on;
// fully-on turns everything off.
export function toggleAllRows(rows) {
  const enabled = toggleAllState(rows) !== "on";
  return rows.map((row) => (row.name ? { ...row, enabled } : row));
}

// Longest common folder prefix (whole segments only) across displayed names,
// so a picker full of "styles/wan22/x.safetensors" reads as just "x".
export function commonFolderPrefix(names) {
  if (names.length < 2) return "";
  const split = names.map((name) => name.split("/"));
  const first = split[0];
  let depth = 0;
  while (
    depth < first.length - 1 &&
    split.every((parts) => parts.length > depth + 1 && parts[depth] === first[depth])
  ) {
    depth += 1;
  }
  return depth ? first.slice(0, depth).join("/") + "/" : "";
}

// Folder grouping for the picker's browse view: names bucketed by their
// top-level folder in first-appearance order; root files group under "".
export function groupByFolder(names) {
  const groups = [];
  const index = new Map();
  for (const name of names) {
    const slash = name.indexOf("/");
    const folder = slash >= 0 ? name.slice(0, slash) : "";
    if (!index.has(folder)) {
      index.set(folder, { folder, names: [] });
      groups.push(index.get(folder));
    }
    index.get(folder).names.push(name);
  }
  return groups;
}

// A suggested range is advisory: null/absent bounds never flag.
export function strengthOutOfRange(value, range) {
  if (!range) return false;
  const low = Number.isFinite(range.min) ? range.min : null;
  const high = Number.isFinite(range.max) ? range.max : null;
  if (low !== null && value < low) return true;
  if (high !== null && value > high) return true;
  return false;
}
