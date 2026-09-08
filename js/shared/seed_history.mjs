// Seed node logic: the "last used" memory. No DOM, no ComfyUI imports.

export const SEED_HISTORY_LIMIT = 8;

function isSeed(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// The backend reports the seed a run actually used via its ui payload.
export function seedFromExecuted(message) {
  const value = message?.seed;
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first === "string" && /^\d+$/.test(first)) return Number(first);
  return isSeed(first) ? first : null;
}

// Most recent first, no duplicates (a re-run moves its seed to the front).
export function pushSeed(history, seed, limit = SEED_HISTORY_LIMIT) {
  const kept = Array.isArray(history) ? history.filter((item) => isSeed(item) && item !== seed) : [];
  if (!isSeed(seed)) return kept.slice(0, limit);
  return [seed, ...kept].slice(0, limit);
}

export function formatSeed(seed) {
  return isSeed(seed) ? String(seed) : "—";
}
