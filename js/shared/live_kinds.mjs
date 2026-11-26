// What each live-preview kind reads and how it draws: the pure half of
// js/shared/live_stage.mjs, with no DOM, so node:test runs it.
import { pyRound } from "./live_image.mjs";
import { autoValues, filmGrain, hashedCells, matchValues } from "./live_grain.mjs";
import { detailReach, keepDetail } from "./live_detail.mjs";
import { cutOut, cutOutReach } from "./live_cutout.mjs";

export const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

// What each node's drawing reads: its inputs, in the order they are told
// about, and the widgets its result depends on.
export const KINDS = {
  grain: {
    inputs: [{ name: "image", channels: 3, noun: "an image" }, { name: "mask", channels: 1, noun: "a mask", optional: true }],
    values: ["amount", "size", "roughness", "color", "moving", "seed", "auto", "auto_amount", "auto_size", "auto_color"],
    outChannels: 3,
  },
  detail: {
    inputs: [
      { name: "image", channels: 3, noun: "an image" },
      { name: "detail_from", channels: 3, noun: "an image" },
      { name: "mask", channels: 1, noun: "a mask", optional: true },
    ],
    values: ["detail_size", "strength", "color_detail", "edge_safe"],
    outChannels: 3,
  },
  cutout: {
    inputs: [{ name: "image", channels: 3, noun: "an image" }, { name: "mask", channels: 1, noun: "a mask" }],
    values: ["keep", "grow", "feather", "clean_edges", "clear_haze", "solid_above"],
    outChannels: 4,
  },
};

// ---------- the nodes' drawing on the pictures at hand ----------

// `parts` are pictures of the same size ({ image, detail_from?, mask? } as
// floats; mask a one-channel picture). `view` says how they sit in the whole
// picture: { scale, fullW, fullH, win } (win: where a window of real pixels
// starts in the whole picture, null for a whole shrunk copy).
export function drawKind(kind, vals, parts, view, noise) {
  const { image } = parts;
  const mask = parts.mask?.data ?? null;
  if (kind === "grain") {
    // vals.match: the last run's match of grain_from's grain, while Auto
    // copies it (js/shared/grain_auto.mjs).
    const picks = !vals.auto ? null
      : vals.match ? matchValues(vals.match, vals.auto_amount, vals.auto_size, vals.auto_color)
        : autoValues(view.fullH, view.fullW, noise ?? 0, vals.auto_amount, vals.auto_size);
    return filmGrain(image, {
      amount: picks ? picks.amount : vals.amount,
      size: (picks ? picks.size : vals.size) * (view.win ? 1 : view.scale),
      roughness: vals.roughness,
      color: picks?.color ?? vals.color,
      cellsAt: hashedCells(Math.max(0, Math.floor(num(vals.seed, 0)))),
      height: view.win ? view.fullH : image.h,
      width: view.win ? view.fullW : image.w,
      win: view.win ? { x0: view.win.x, y0: view.win.y, w: image.w, h: image.h } : null,
      mask,
    });
  }
  if (kind === "detail") {
    return keepDetail(image, parts.detail_from, {
      detailSize: vals.detail_size * (view.win ? 1 : view.scale),
      strength: vals.strength,
      colorDetail: vals.color_detail,
      edgeSafe: vals.edge_safe,
      mask,
    });
  }
  return cutOut(image, mask ?? new Float32Array(image.w * image.h), {
    keep: vals.keep,
    grow: view.win ? Math.trunc(vals.grow) : pyRound(vals.grow * view.scale),
    feather: vals.feather * (view.win ? 1 : view.scale),
    cleanEdges: vals.clean_edges,
    clearHaze: vals.clear_haze,
    solidAbove: vals.solid_above,
    longSide: Math.max(view.fullW, view.fullH),
  });
}

// How far past a window a kind reads, so its window comes out as the whole
// picture's would.
export function reachOf(kind, vals, longSide) {
  if (kind === "detail") return detailReach(vals.detail_size, vals.edge_safe);
  if (kind === "cutout") return cutOutReach({ grow: vals.grow, feather: vals.feather, cleanEdges: vals.clean_edges }, longSide);
  return 0;
}

