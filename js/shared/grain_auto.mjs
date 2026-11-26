// Film Grain's Auto, on the node's face: what Auto picks for the picture on
// hand, shown beside the Amount and Size boxes ("= 0.27", "= 1.0 px").
//
// The picture is read from its Load Image through ComfyUI's /view route and
// its fine noise measured here, with the same measure the node uses
// (js/shared/live_grain.mjs). A picture that only exists after a run (a VAE
// Decode) is known from the node's last run, which sends Auto's picks with
// its result. Until either, the card shows a plain dash.
import { autoGrain, measureNoise } from "./live_grain.mjs";
import { loadPixels, pixelsToImage, planInput } from "./live_sources.mjs";

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
