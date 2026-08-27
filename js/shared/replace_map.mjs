// Replace Missing Nodes — the map and its decision logic.
//
// Kept free of /scripts/app.js imports so node:test can cover it
// (tests/replace_map.test.mjs); js/replace_missing/index.js does the DOM
// and graph wiring. Declarations imitate ComfyUI's official Node
// Replacement API (io.NodeReplace): old_node_id / new_node_id,
// old_widget_ids to bind positional widgets_values to names, input_mapping
// as {new_id, old_id} pairs, output_mapping as {new_idx, old_idx} pairs.
// On top of that shape each entry carries a tier:
//
//   "swap"   — 1:1 replacement; translate() maps old widget values onto the
//              AusBoss node and returns human-readable flags for anything
//              that could not carry over losslessly.
//   "pair"   — needs an atomic multi-node rewrite; declared now, applied in
//              phase 2. Shown in the preview with a polite refusal.
//   "refuse" — no AusBoss equivalent exists; reason is shown to the user.
//
// Mapping semantics: an entry with NO input_mapping carries links by same
// input name; with a mapping, unmapped old inputs are dropped. Same for
// output_mapping by slot index. Dropping is deliberate — a link wired to
// the wrong socket is worse than a link the preview says was dropped.

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------- translators

function translateVhsLoadVideo(widgets, context = {}) {
  const out = {};
  const flags = [];
  if (typeof widgets.video === "string" && widgets.video) out.video = widgets.video;

  const width = toNumber(widgets.custom_width);
  const height = toNumber(widgets.custom_height);
  if (width !== null) out.custom_width = clamp(Math.round(width), 0, 16384);
  if (height !== null) out.custom_height = clamp(Math.round(height), 0, 16384);

  const nth = toNumber(widgets.select_every_nth);
  if (nth !== null && nth >= 1) out.every_nth = Math.round(nth);

  // Both sides count kept frames, so the cap crosses without needing fps.
  const cap = toNumber(widgets.frame_load_cap);
  if (cap !== null && cap > 0) out.max_frames = Math.round(cap);

  // The trim start is the one frame-index value that needs seconds. Without
  // the source fps there is no honest conversion, so the trim stays at the
  // default and the preview says to check it — a silently wrong trim would
  // look like data loss.
  const skip = toNumber(widgets.skip_first_frames);
  if (skip !== null && skip > 0) {
    const fps = toNumber(context.fps);
    if (fps !== null && fps > 0) {
      out.start_seconds = Math.round((skip / fps) * 100) / 100;
    } else {
      flags.push(
        `check trim: skip_first_frames=${Math.round(skip)} needs the source fps ` +
          "to become seconds — trim left at 0, set start on the preview timeline"
      );
    }
  }

  const forceRate = toNumber(widgets.force_rate);
  if (forceRate !== null && forceRate > 0) {
    flags.push(
      `force_rate=${forceRate} dropped — Load Video 🆎 keeps the source rate ` +
        "(every_nth thins frames instead)"
    );
  }
  if (typeof widgets.force_size === "string" && widgets.force_size !== "Disabled") {
    flags.push(`force_size="${widgets.force_size}" dropped — use custom_width/custom_height`);
  }
  return { widgets: out, flags };
}

// VHS format ids → Save Video 🆎 format names (keys of VIDEO_FORMATS in
// nodes/_video_save_helpers.py). Anything unlisted falls back to mp4 h264
// with a flag rather than guessing a codec.
const VHS_FORMAT_MAP = {
  "video/h264-mp4": "mp4 h264",
  "video/h265-mp4": "mp4 h265",
  "video/nvenc_h264-mp4": "mp4 h264 nvenc",
  "video/nvenc_hevc-mp4": "mp4 h265 nvenc",
  "video/webm": "webm vp9",
  "video/av1-webm": "webm av1",
  "video/ProRes": "mov prores",
  "image/gif": "gif",
  "image/webp": "webp",
};

function translateVhsVideoCombine(widgets) {
  const out = {};
  const flags = [];

  const fps = toNumber(widgets.frame_rate);
  if (fps !== null && fps > 0) out.fps = clamp(fps, 0.01, 240);

  if (typeof widgets.filename_prefix === "string" && widgets.filename_prefix) {
    out.filename_prefix = widgets.filename_prefix;
  }

  if (typeof widgets.format === "string" && widgets.format) {
    const mapped = VHS_FORMAT_MAP[widgets.format];
    if (mapped) {
      out.format = mapped;
    } else {
      out.format = "mp4 h264";
      flags.push(`format "${widgets.format}" has no direct match — set to mp4 h264`);
    }
  }

  const crf = toNumber(widgets.crf);
  if (crf !== null) out.crf = clamp(Math.round(crf), 0, 51);

  if (typeof widgets.pingpong === "boolean") out.pingpong = widgets.pingpong;
  if (typeof widgets.save_metadata === "boolean") out.save_metadata = widgets.save_metadata;

  const loops = toNumber(widgets.loop_count);
  if (loops !== null && loops > 0) {
    flags.push(`loop_count=${Math.round(loops)} dropped — gif/webp loop forever, video players decide for themselves`);
  }
  if (widgets.save_output === false) {
    flags.push("save_output was off (temp save) — Save Video 🆎 always saves to the output folder");
  }
  return { widgets: out, flags };
}

// KJNodes method ids → Color Match 🆎 methods. reinhard is a per-channel
// mean/std transfer, which lab approximates in a perceptual space; the
// combined hm-* pipelines have no single-method equivalent, so lab is the
// safe default — flagged either way.
const COLOR_METHOD_MAP = { mkl: "mkl", hm: "histogram" };

function translateColorMatch(widgets) {
  const out = {};
  const flags = [];
  const method = typeof widgets.method === "string" ? widgets.method : "";
  if (COLOR_METHOD_MAP[method]) {
    out.method = COLOR_METHOD_MAP[method];
  } else {
    out.method = "lab";
    if (method && method !== "lab") {
      flags.push(`method "${method}" approximated with lab (perceptual mean/std transfer)`);
    }
  }
  const strength = toNumber(widgets.strength);
  if (strength !== null) {
    out.strength = clamp(strength, 0, 1);
    if (strength > 1) flags.push(`strength ${strength} clamped to 1.0 — Color Match 🆎 blends, it does not overdrive`);
  }
  return { widgets: out, flags };
}

function translateGrowMaskWithBlur(widgets) {
  const out = {};
  const flags = [];
  const expand = toNumber(widgets.expand);
  if (expand !== null) out.expand = clamp(Math.round(expand), -1024, 1024);
  const blur = toNumber(widgets.blur_radius);
  if (blur !== null) out.blur = clamp(blur, 0, 100);
  if (typeof widgets.fill_holes === "boolean") out.fill_holes = widgets.fill_holes;

  if (widgets.flip_input === true) {
    flags.push("flip_input not carried — invert upstream, or wire the mask_inverted output");
  }
  const increment = toNumber(widgets.incremental_expandrate);
  if (increment !== null && increment !== 0) {
    flags.push(`incremental_expandrate=${increment} dropped — per-frame expand animation is not supported`);
  }
  const lerp = toNumber(widgets.lerp_alpha);
  if (lerp !== null && lerp < 1) {
    flags.push(`lerp_alpha=${lerp} dropped — frame-to-frame mask blending is not supported`);
  }
  const decay = toNumber(widgets.decay_factor);
  if (decay !== null && decay < 1) {
    flags.push(`decay_factor=${decay} dropped — frame-to-frame mask decay is not supported`);
  }
  return { widgets: out, flags };
}

function translateLayerStyleLama(widgets) {
  // The model lists differ and LayerStyle's grow/blur edge treatment is a
  // pre-process this node does not do, so nothing carries; the flag tells
  // the user what to rebuild instead of pretending the swap was lossless.
  const flags = [
    "check mask: LayerStyle's grow/blur edge treatment is not carried — " +
      "reproduce it with Mask Refine 🆎 upstream if the result shows seams",
  ];
  if (widgets.invert_mask === true) {
    flags.push("invert_mask was on — invert the mask upstream (e.g. Mask Refine 🆎 mask_inverted)");
  }
  return { widgets: {}, flags };
}

// ---------------------------------------------------------------- the map

export const REPLACEMENTS = [
  {
    tier: "swap",
    old_node_id: "VHS_LoadVideo",
    new_node_id: "AUSBOSS_NODES_LoadVideo",
    // Recent VHS serializes widgets_values as a name-keyed object; this
    // binding only decodes the older positional arrays.
    old_widget_ids: [
      "video",
      "force_rate",
      "custom_width",
      "custom_height",
      "frame_load_cap",
      "skip_first_frames",
      "select_every_nth",
    ],
    // VHS: 0 IMAGE, 1 frame_count, 2 audio, 3 video_info.
    // AusBoss: 0 frames, 1 audio, 2 frame_count, 3 fps, 4 width, 5 height,
    // 6 duration, 7 video. video_info has no equivalent and is dropped.
    output_mapping: [
      { new_idx: 0, old_idx: 0 },
      { new_idx: 2, old_idx: 1 },
      { new_idx: 1, old_idx: 2 },
    ],
    translate: translateVhsLoadVideo,
  },
  {
    tier: "swap",
    old_node_id: "VHS_VideoCombine",
    new_node_id: "AUSBOSS_NODES_SaveVideo",
    old_widget_ids: [
      "frame_rate",
      "loop_count",
      "filename_prefix",
      "format",
      "pingpong",
      "save_output",
    ],
    input_mapping: [
      { new_id: "frames", old_id: "images" },
      { new_id: "audio", old_id: "audio" },
    ],
    // The VHS_FILENAMES output has no equivalent; Save Video 🆎 is a sink.
    output_mapping: [],
    translate: translateVhsVideoCombine,
  },
  {
    tier: "swap",
    old_node_id: "ColorMatch",
    new_node_id: "AUSBOSS_NODES_ColorMatch",
    old_widget_ids: ["method", "strength"],
    input_mapping: [
      { new_id: "reference", old_id: "image_ref" },
      { new_id: "image", old_id: "image_target" },
    ],
    translate: translateColorMatch,
  },
  {
    tier: "swap",
    old_node_id: "ColorMatchV2",
    new_node_id: "AUSBOSS_NODES_ColorMatch",
    old_widget_ids: ["method", "strength"],
    input_mapping: [
      { new_id: "reference", old_id: "image_ref" },
      { new_id: "image", old_id: "image_target" },
    ],
    translate: translateColorMatch,
  },
  {
    tier: "swap",
    old_node_id: "GrowMaskWithBlur",
    new_node_id: "AUSBOSS_NODES_RefineMask",
    old_widget_ids: [
      "expand",
      "incremental_expandrate",
      "tapered_corners",
      "flip_input",
      "blur_radius",
      "lerp_alpha",
      "decay_factor",
      "fill_holes",
    ],
    // mask → mask, mask_inverted → mask_inverted line up by name and index.
    translate: translateGrowMaskWithBlur,
  },
  {
    tier: "swap",
    old_node_id: "LayerUtility: LaMa",
    new_node_id: "AUSBOSS_NODES_LaMaInpaint",
    // No old_widget_ids on purpose: the positional layout is not stable
    // across LayerStyle versions, and a mislabeled decode would carry a
    // wrong value silently. Undecoded widgets just mean defaults + flags.
    translate: translateLayerStyleLama,
  },
  {
    tier: "swap",
    old_node_id: "easy imageSize",
    new_node_id: "AUSBOSS_NODES_ImageSize",
    output_mapping: [
      { new_idx: 0, old_idx: 0 },
      { new_idx: 1, old_idx: 1 },
    ],
  },
  {
    tier: "swap",
    old_node_id: "DF_Get_image_size",
    new_node_id: "AUSBOSS_NODES_ImageSize",
    output_mapping: [
      { new_idx: 0, old_idx: 0 },
      { new_idx: 1, old_idx: 1 },
    ],
  },
  {
    tier: "pair",
    old_node_id: "GetImageSizeAndCount",
    new_node_id: "AUSBOSS_NODES_ImageSize",
    reason:
      "needs Image Size 🆎 plus rewiring its image passthrough to the upstream " +
      "source — atomic multi-node swaps land in phase 2",
  },
  {
    tier: "refuse",
    old_node_id: "UnetLoaderGGUF",
    reason: "model loader — no AusBoss equivalent",
  },
  {
    tier: "refuse",
    old_node_prefix: "WanVideo",
    reason: "WanVideoWrapper pipeline node — no AusBoss equivalent",
  },
  {
    tier: "refuse",
    old_node_suffix: "Preprocessor",
    reason: "controlnet preprocessor — no AusBoss equivalent",
  },
];

// ---------------------------------------------------------------- decisions

// Exact ids win over prefix/suffix rules, so a specific swap can always be
// declared for a node a broad refuse rule would otherwise catch.
export function findReplacement(classType) {
  const type = String(classType ?? "");
  if (!type || type.startsWith("AUSBOSS_NODES_")) return null;
  let byPattern = null;
  for (const entry of REPLACEMENTS) {
    if (entry.old_node_id === type) return entry;
    if (!byPattern && entry.old_node_prefix && type.startsWith(entry.old_node_prefix)) {
      byPattern = entry;
    }
    if (!byPattern && entry.old_node_suffix && type.endsWith(entry.old_node_suffix)) {
      byPattern = entry;
    }
  }
  return byPattern;
}

// widgets_values arrives as a name-keyed object (VHS and other packs with
// custom serialization), a positional array (LiteGraph's default — decoded
// through old_widget_ids), or nothing at all. Always returns an object;
// undecodable input returns {} so translators fall back to defaults.
export function decodeWidgetValues(entry, serialized) {
  if (serialized && typeof serialized === "object" && !Array.isArray(serialized)) {
    return { ...serialized };
  }
  if (Array.isArray(serialized) && Array.isArray(entry?.old_widget_ids)) {
    const widgets = {};
    entry.old_widget_ids.forEach((name, index) => {
      if (index < serialized.length) widgets[name] = serialized[index];
    });
    return widgets;
  }
  return {};
}

export function translateWidgets(entry, widgets, context = {}) {
  if (typeof entry?.translate !== "function") return { widgets: {}, flags: [] };
  const result = entry.translate(widgets ?? {}, context) ?? {};
  return { widgets: result.widgets ?? {}, flags: result.flags ?? [] };
}

// Old input name → new input name. No mapping declared means same-name
// carry; a declared mapping drops anything it does not list (null).
export function mapInputName(entry, oldName) {
  if (!Array.isArray(entry?.input_mapping)) return oldName;
  const hit = entry.input_mapping.find((pair) => pair.old_id === oldName);
  return hit ? hit.new_id : null;
}

// Old output slot → new output slot, same convention by index.
export function mapOutputSlot(entry, oldSlot) {
  if (!Array.isArray(entry?.output_mapping)) return oldSlot;
  const hit = entry.output_mapping.find((pair) => pair.old_idx === oldSlot);
  return hit ? hit.new_idx : null;
}

// Build the preview rows for a set of candidate nodes. Each input row is
// {id, type, title, registered, widgetValues}; healthy nodes the map does
// not know are skipped, unregistered ones it does not know become tier
// "none" so the user sees why nothing is offered for them.
export function planReplacements(nodes, context = {}) {
  const rows = [];
  for (const node of nodes ?? []) {
    const type = String(node?.type ?? "");
    if (!type) continue;
    const entry = findReplacement(type);
    if (!entry && node?.registered !== false) continue;
    const base = {
      id: node.id,
      type,
      title: node.title && node.title !== type ? String(node.title) : null,
      entry: entry ?? null,
      target: entry?.new_node_id ?? null,
      widgets: {},
      flags: [],
      reason: null,
    };
    if (!entry) {
      rows.push({ ...base, tier: "none", reason: "no AusBoss replacement declared for this type" });
    } else if (entry.tier === "refuse") {
      rows.push({ ...base, tier: "refuse", target: null, reason: entry.reason });
    } else if (entry.tier === "pair") {
      rows.push({ ...base, tier: "pair", reason: entry.reason });
    } else {
      const decoded = decodeWidgetValues(entry, node.widgetValues);
      const { widgets, flags } = translateWidgets(entry, decoded, context);
      rows.push({ ...base, tier: "swap", widgets, flags });
    }
  }
  return rows;
}
