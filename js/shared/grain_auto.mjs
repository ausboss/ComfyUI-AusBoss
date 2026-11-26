// Film Grain's Auto, on the node's face: what Auto picks for the picture on
// hand, shown beside the Amount and Size boxes ("= 0.27", "= 1.0 px").
//
// The picture is read from its Load Image through ComfyUI's /view route and
// its fine noise measured here, with the same measure the node uses
// (js/shared/live_grain.mjs). A picture that only exists after a run (a VAE
// Decode) is known from the node's last run, which sends Auto's picks with
// its result. Until either, the card shows a plain dash.
//
// With a picture on grain_from, Auto copies that picture's grain instead.
// The match is worked out by the node when it runs, and sent with its result
// (node.__ausbossMatch = { amount, size, color }); the card's notes and the
// live preview use it from then on. The node keeps its last few matches,
// one per pair of pictures, in its saved properties: ComfyUI does not run a
// node again for pictures it already ran, so a run that comes from its
// cache sends no match, and a reopened workflow would otherwise wait for one.
import { autoGrain, measureNoise } from "./live_grain.mjs";
import { loadPixels, pixelsToImage, planInput } from "./live_sources.mjs";

// Is a picture wired into grain_from?
export const grainFromLinked = (node) => node?.inputs?.some((input) => input?.name === "grain_from" && input.link != null) === true;

// Does Auto copy grain from a picture right now?
export const copiesGrain = (node) => Boolean(node?.widgets?.find((widget) => widget?.name === "auto")?.value) && grainFromLinked(node);

// The match from the node's last run, or null.
export function matchFromRun(record) {
  const sent = record?.ausboss_grain_match?.[0];
  return sent && ["base_amount", "base_size", "base_color"].every((key) => Number.isFinite(sent[key]))
    ? { amount: sent.base_amount, size: sent.base_size, color: sent.base_color }
    : null;
}

// Which pair of pictures a match belongs to: the picture and grain_from's
// source (a Load Image's file, or the link a run reads).
export const matchKey = (node) => ["image", "grain_from"].map((name) => planInput(node, name).key ?? "-").join("|");

const KEPT_MATCHES = 8;
const validMatch = (match) => match && ["amount", "size", "color"].every((key) => Number.isFinite(match[key])) ? match : null;

// Remember a run's match for the pictures wired now.
export function keepMatch(node, match) {
  if (!node || !validMatch(match)) return;
  node.properties ??= {};
  const kept = { ...(node.properties.ausboss_grain_matches ?? {}) };
  const key = matchKey(node);
  delete kept[key];
  kept[key] = { amount: match.amount, size: match.size, color: match.color };
  const keys = Object.keys(kept);
  for (const old of keys.slice(0, Math.max(0, keys.length - KEPT_MATCHES))) delete kept[old];
  node.properties.ausboss_grain_matches = kept;
}

// The kept match for the pictures wired now, or null.
export const keptMatch = (node) => validMatch(node?.properties?.ausboss_grain_matches?.[matchKey(node)]) ?? null;

export function setMatch(node, match) {
  const before = node.__ausbossMatch;
  if (before?.amount === match?.amount && before?.size === match?.size && before?.color === match?.color) return;
  node.__ausbossMatch = match ?? null;
  node.__ausbossCard?.refresh?.();
  node.__ausbossLive?.hooks?.refresh?.();
  node.setDirtyCanvas?.(true, true);
}

// Auto's picks for the node (node.__ausbossAuto = { amount, size }: the
// numbers before the card's multipliers), or null while they are not known.
export function setAuto(node, picks) {
  const before = node.__ausbossAuto;
  const next = picks && Number.isFinite(picks.amount) && Number.isFinite(picks.size) ? { amount: picks.amount, size: picks.size } : null;
  if (before?.amount === next?.amount && before?.size === next?.size) return;
  node.__ausbossAuto = next;
  node.__ausbossCard?.refresh?.();
  node.setDirtyCanvas?.(true, true);
}

// From a picture already read (the live stage has it).
export function autoFromImage(node, image) {
  const noise = measureNoise(image);
  const picks = autoGrain(image.h, image.w, noise);
  setAuto(node, picks);
  return picks;
}

// From what the node's last run sent.
export function autoFromRun(record) {
  const sent = record?.ausboss_grain_auto?.[0];
  return sent && Number.isFinite(sent.base_amount) && Number.isFinite(sent.base_size) ? { amount: sent.base_amount, size: sent.base_size } : null;
}

// Work out Auto's picks for a node now. `viewUrl(query)` turns a /view query
// into a URL; `record` is the node's last output record, if any.
export async function refreshAuto(node, { viewUrl, record = null }) {
  if (!node || typeof viewUrl !== "function") return;
  // The match kept for these two pictures; other pictures wait for a run.
  setMatch(node, grainFromLinked(node) ? keptMatch(node) : null);
  const plan = planInput(node, "image");
  if (plan.state === "direct") {
    try {
      const image = pixelsToImage(await loadPixels(viewUrl(plan.query)), 3);
      // The wiring or the file changed while the picture was being read.
      if (planInput(node, "image").key !== plan.key) return;
      autoFromImage(node, image);
      return;
    } catch {
      // A browser that hides picture pixels: fall back to the last run's numbers.
    }
  }
  setAuto(node, plan.state === "none" ? null : autoFromRun(record));
}
