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

export function reorderRows(rows, from, to) {
  if (from === to) return rows;
  if (from < 0 || from >= rows.length || to < 0 || to >= rows.length) return rows;
  const next = rows.slice();
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
}

export function moveRow(rows, index, delta) {
  return reorderRows(rows, index, index + delta);
}

// Drag-to-reorder model: which visual slot the pointer is over, given the
// vertical centers of the rows in their current on-screen order. Past the
// last center means the last slot; an empty stack has no slot.
export function hoverRowIndex(centers, y) {
  for (let i = 0; i < centers.length; i += 1) {
    if (y < centers[i]) return i;
  }
  return centers.length - 1;
}

// Hover-thumbnail placement: below-right of the cursor, flipped left when the
// viewport edge is near, never off-screen. `edge` is the thumb's largest side
// plus its margin.
export function thumbPosition(x, y, viewportWidth, viewportHeight, edge = 188, offset = 14) {
  let left = x + offset;
  if (left + edge > viewportWidth) left = Math.max(4, x - edge - offset);
  let top = y + offset;
  if (top + edge > viewportHeight) top = Math.max(4, viewportHeight - edge);
  return { left, top };
}

export function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return "";
  let value = size;
  let unit = "B";
  for (const next of ["KB", "MB", "GB", "TB"]) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  const text =
    unit === "B" ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
  return `${text} ${unit}`;
}

export function setStrength(rows, index, value, linked) {
  const next = rows.slice();
  const row = { ...next[index], strength: roundStrength(value) };
  if (linked) row.strength_clip = row.strength;
  next[index] = row;
  return next;
}

// Scrub model: value follows horizontal pointer distance from the grab point.
// Inside the dead zone nothing changes, so a plain click stays a click. The
// coarse step is configurable (the gear menu's "Strength step"); Shift always
// scrubs by the fine step.
export function scrubValue(startValue, deltaX, fine = false, coarseStep = DEFAULT_STEP) {
  if (Math.abs(deltaX) <= SCRUB_DEAD_ZONE) return roundStrength(startValue);
  const coarse = Number.isFinite(coarseStep) && coarseStep > 0 ? coarseStep : DEFAULT_STEP;
  const step = fine ? FINE_STEP : coarse;
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
// ---------- templates ----------
// A template is a named snapshot of the row stack: { name, rows } with rows
// stored id-less (ids are per-node identity, not part of the recipe).

export function templateFromRows(name, rows) {
  const label = String(name ?? "").trim();
  if (!label) return null;
  return {
    name: label,
    rows: normalizeRows(rows).map(({ id, ...rest }) => rest),
  };
}

export function applyTemplate(template) {
  return normalizeRows(template?.rows);
}

// Replace a same-named template (case-insensitive) or append; kept sorted so
// the menu order is stable however the list was built.
export function upsertTemplate(list, template) {
  if (!template) return Array.isArray(list) ? list : [];
  const base = Array.isArray(list) ? list : [];
  const key = template.name.toLowerCase();
  const next = base.filter((entry) => entry?.name?.toLowerCase() !== key);
  next.push(template);
  next.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return next;
}

export function removeTemplate(list, name) {
  const key = String(name ?? "").toLowerCase();
  return (Array.isArray(list) ? list : []).filter(
    (entry) => entry?.name?.toLowerCase() !== key
  );
}

export function parseTemplates(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => templateFromRows(entry?.name, entry?.rows))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function strengthOutOfRange(value, range) {
  if (!range) return false;
  const low = Number.isFinite(range.min) ? range.min : null;
  const high = Number.isFinite(range.max) ? range.max : null;
  if (low !== null && value < low) return true;
  if (high !== null && value > high) return true;
  return false;
}
