// Schema-driven per-node settings: pure validation and merge logic for the
// gear menus (settings_menu.mjs does the DOM and storage). A schema is an
// array of entries; entries with a `key` describe one setting, entries with
// only `section` render as headers and hold no value.
//
//   { section: "Civitai" }
//   { key, label, type: "toggle", default: false, hint }
//   { key, label, type: "number", default: 1, min, max, step, hint }
//   { key, label, type: "text",   default: ",", hint, placeholder }
//   { key, label, type: "choice", default: "standard", options: [...], hint }

export function schemaDefaults(schema) {
  const values = {};
  for (const entry of schema) {
    if (entry.key !== undefined) values[entry.key] = entry.default;
  }
  return values;
}

// Coerce one stored value against its schema entry; the entry's default wins
// whenever the stored value is missing or the wrong shape.
export function coerceSetting(entry, value) {
  switch (entry.type) {
    case "toggle":
      return typeof value === "boolean" ? value : entry.default;
    case "number": {
      const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      if (typeof number !== "number" || !Number.isFinite(number)) return entry.default;
      let clamped = number;
      if (typeof entry.min === "number") clamped = Math.max(entry.min, clamped);
      if (typeof entry.max === "number") clamped = Math.min(entry.max, clamped);
      return clamped;
    }
    case "text":
      return typeof value === "string" ? value : entry.default;
    case "choice":
      return entry.options?.includes(value) ? value : entry.default;
    default:
      return entry.default;
  }
}

// Merge stored values over the schema defaults. Unknown stored keys are
// dropped; every schema key comes back with a valid value.
export function mergeSettings(schema, stored) {
  const values = {};
  const source = stored && typeof stored === "object" ? stored : {};
  for (const entry of schema) {
    if (entry.key === undefined) continue;
    values[entry.key] = coerceSetting(entry, source[entry.key]);
  }
  return values;
}
