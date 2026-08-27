import assert from "node:assert/strict";
import test from "node:test";

import {
  REPLACEMENTS,
  decodeWidgetValues,
  findReplacement,
  mapInputName,
  mapOutputSlot,
  planReplacements,
  translateWidgets,
} from "../js/shared/replace_map.mjs";

function entryFor(oldId) {
  const entry = REPLACEMENTS.find((candidate) => candidate.old_node_id === oldId);
  assert.ok(entry, `map declares ${oldId}`);
  return entry;
}

// ------------------------------------------------------------ findReplacement

test("exact ids resolve to their entry", () => {
  assert.equal(findReplacement("VHS_LoadVideo").new_node_id, "AUSBOSS_NODES_LoadVideo");
  assert.equal(findReplacement("LayerUtility: LaMa").new_node_id, "AUSBOSS_NODES_LaMaInpaint");
  assert.equal(findReplacement("UnetLoaderGGUF").tier, "refuse");
});

test("prefix and suffix rules catch families, exact ids win over them", () => {
  assert.equal(findReplacement("WanVideoSampler").tier, "refuse");
  assert.equal(findReplacement("WanVideoModelLoader").tier, "refuse");
  assert.equal(findReplacement("CannyEdgePreprocessor").tier, "refuse");
  assert.equal(findReplacement("DWPreprocessor").tier, "refuse");
  // An exact swap declaration must never be shadowed by a broad pattern.
  assert.equal(findReplacement("VHS_VideoCombine").tier, "swap");
});

test("unknown and AusBoss-own types return null", () => {
  assert.equal(findReplacement("KSampler"), null);
  assert.equal(findReplacement("AUSBOSS_NODES_LoadVideo"), null);
  assert.equal(findReplacement(""), null);
  assert.equal(findReplacement(null), null);
});

// -------------------------------------------------------- decodeWidgetValues

test("object widgets_values pass through by name", () => {
  const entry = entryFor("VHS_LoadVideo");
  const decoded = decodeWidgetValues(entry, { video: "clip.mp4", force_rate: 0 });
  assert.deepEqual(decoded, { video: "clip.mp4", force_rate: 0 });
});

test("positional widgets_values decode through old_widget_ids", () => {
  const entry = entryFor("VHS_LoadVideo");
  const decoded = decodeWidgetValues(entry, ["clip.mp4", 0, 512, 0, 24, 12, 2]);
  assert.equal(decoded.video, "clip.mp4");
  assert.equal(decoded.custom_width, 512);
  assert.equal(decoded.frame_load_cap, 24);
  assert.equal(decoded.skip_first_frames, 12);
  assert.equal(decoded.select_every_nth, 2);
});

test("positions past the binding are ignored, short arrays stop early", () => {
  const entry = entryFor("ColorMatch");
  assert.deepEqual(decodeWidgetValues(entry, ["mkl", 0.5, "extra", 9]), {
    method: "mkl",
    strength: 0.5,
  });
  assert.deepEqual(decodeWidgetValues(entry, ["hm"]), { method: "hm" });
});

test("an array without old_widget_ids is undecodable, not misread", () => {
  const entry = entryFor("LayerUtility: LaMa");
  assert.deepEqual(decodeWidgetValues(entry, ["lama", "cuda", true, 25, 8]), {});
  assert.deepEqual(decodeWidgetValues(entry, null), {});
  assert.deepEqual(decodeWidgetValues(entry, undefined), {});
});

// ---------------------------------------------------- VHS_LoadVideo translate

test("Load Video: frame trim becomes seconds when fps is known", () => {
  const entry = entryFor("VHS_LoadVideo");
  const { widgets, flags } = translateWidgets(
    entry,
    { video: "clip.mp4", skip_first_frames: 30, frame_load_cap: 48, select_every_nth: 2 },
    { fps: 24 }
  );
  assert.equal(widgets.start_seconds, 1.25);
  assert.equal(widgets.max_frames, 48);
  assert.equal(widgets.every_nth, 2);
  assert.equal(widgets.video, "clip.mp4");
  assert.deepEqual(flags, []);
});

test("Load Video: without fps the trim stays default and is flagged", () => {
  const entry = entryFor("VHS_LoadVideo");
  const { widgets, flags } = translateWidgets(entry, {
    video: "clip.mp4",
    skip_first_frames: 30,
  });
  assert.equal(widgets.start_seconds, undefined);
  assert.equal(widgets.video, "clip.mp4"); // the filename still carries
  assert.equal(flags.length, 1);
  assert.match(flags[0], /check trim/);
  assert.match(flags[0], /skip_first_frames=30/);
});

test("Load Video: force_rate and force_size are dropped loudly, sizes carry", () => {
  const entry = entryFor("VHS_LoadVideo");
  const { widgets, flags } = translateWidgets(entry, {
    force_rate: 8,
    force_size: "512x?",
    custom_width: 640,
    custom_height: 360,
  });
  assert.equal(widgets.custom_width, 640);
  assert.equal(widgets.custom_height, 360);
  assert.equal(flags.length, 2);
  assert.match(flags[0], /force_rate/);
  assert.match(flags[1], /force_size/);
});

test("Load Video: zero/default trim values produce no widgets and no flags", () => {
  const entry = entryFor("VHS_LoadVideo");
  const { widgets, flags } = translateWidgets(entry, {
    skip_first_frames: 0,
    frame_load_cap: 0,
    force_rate: 0,
    force_size: "Disabled",
  });
  assert.deepEqual(widgets, {});
  assert.deepEqual(flags, []);
});

// -------------------------------------------------- VHS_VideoCombine translate

test("Video Combine: the format table maps every declared VHS id", () => {
  const entry = entryFor("VHS_VideoCombine");
  const expectations = {
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
  for (const [vhs, ausboss] of Object.entries(expectations)) {
    const { widgets, flags } = translateWidgets(entry, { format: vhs });
    assert.equal(widgets.format, ausboss, vhs);
    assert.deepEqual(flags, [], vhs);
  }
});

test("Video Combine: an unknown format falls back to mp4 h264 with a flag", () => {
  const entry = entryFor("VHS_VideoCombine");
  const { widgets, flags } = translateWidgets(entry, { format: "video/16bit-png" });
  assert.equal(widgets.format, "mp4 h264");
  assert.equal(flags.length, 1);
  assert.match(flags[0], /video\/16bit-png/);
});

test("Video Combine: rate, prefix, crf, pingpong and metadata carry", () => {
  const entry = entryFor("VHS_VideoCombine");
  const { widgets, flags } = translateWidgets(entry, {
    frame_rate: 23.976,
    filename_prefix: "renders/final",
    crf: 17,
    pingpong: true,
    save_metadata: false,
  });
  assert.equal(widgets.fps, 23.976);
  assert.equal(widgets.filename_prefix, "renders/final");
  assert.equal(widgets.crf, 17);
  assert.equal(widgets.pingpong, true);
  assert.equal(widgets.save_metadata, false);
  assert.deepEqual(flags, []);
});

test("Video Combine: crf clamps to the AusBoss 0..51 range", () => {
  const entry = entryFor("VHS_VideoCombine");
  assert.equal(translateWidgets(entry, { crf: 63 }).widgets.crf, 51);
  assert.equal(translateWidgets(entry, { crf: -4 }).widgets.crf, 0);
});

test("Video Combine: loop_count and temp save are flagged", () => {
  const entry = entryFor("VHS_VideoCombine");
  const { flags } = translateWidgets(entry, { loop_count: 3, save_output: false });
  assert.equal(flags.length, 2);
  assert.match(flags[0], /loop_count=3/);
  assert.match(flags[1], /output folder/);
});

// ------------------------------------------------------- ColorMatch translate

test("Color Match: the method table maps mkl, hm and falls back to lab", () => {
  const entry = entryFor("ColorMatch");
  assert.equal(translateWidgets(entry, { method: "mkl" }).widgets.method, "mkl");
  assert.equal(translateWidgets(entry, { method: "hm" }).widgets.method, "histogram");
  assert.deepEqual(translateWidgets(entry, { method: "mkl" }).flags, []);

  const reinhard = translateWidgets(entry, { method: "reinhard" });
  assert.equal(reinhard.widgets.method, "lab");
  assert.match(reinhard.flags[0], /reinhard/);

  const combined = translateWidgets(entry, { method: "hm-mkl-hm" });
  assert.equal(combined.widgets.method, "lab");
  assert.equal(combined.flags.length, 1);

  // No stored method (or lab itself) is the quiet default.
  assert.equal(translateWidgets(entry, {}).widgets.method, "lab");
  assert.deepEqual(translateWidgets(entry, {}).flags, []);
});

test("Color Match: strength carries and clamps to the 0..1 blend", () => {
  const entry = entryFor("ColorMatch");
  assert.equal(translateWidgets(entry, { strength: 0.6 }).widgets.strength, 0.6);
  const over = translateWidgets(entry, { strength: 3 });
  assert.equal(over.widgets.strength, 1);
  assert.match(over.flags[0], /clamped/);
});

test("Color Match: V2 shares the translation and the input mapping", () => {
  const v2 = entryFor("ColorMatchV2");
  assert.equal(v2.new_node_id, "AUSBOSS_NODES_ColorMatch");
  assert.equal(translateWidgets(v2, { method: "hm" }).widgets.method, "histogram");
  assert.equal(mapInputName(v2, "image_ref"), "reference");
});

// ------------------------------------------------ GrowMaskWithBlur translate

test("Mask Refine: expand, blur and fill_holes carry, ranges clamp", () => {
  const entry = entryFor("GrowMaskWithBlur");
  const { widgets, flags } = translateWidgets(entry, {
    expand: -12,
    blur_radius: 6.5,
    fill_holes: true,
    tapered_corners: true,
    lerp_alpha: 1,
    decay_factor: 1,
    incremental_expandrate: 0,
  });
  assert.deepEqual(widgets, { expand: -12, blur: 6.5, fill_holes: true });
  assert.deepEqual(flags, []); // neutral animation defaults stay silent
  assert.equal(translateWidgets(entry, { expand: 5000 }).widgets.expand, 1024);
  assert.equal(translateWidgets(entry, { blur_radius: 400 }).widgets.blur, 100);
});

test("Mask Refine: flip_input and animation settings are flagged", () => {
  const entry = entryFor("GrowMaskWithBlur");
  const { flags } = translateWidgets(entry, {
    flip_input: true,
    incremental_expandrate: 1.5,
    lerp_alpha: 0.5,
    decay_factor: 0.9,
  });
  assert.equal(flags.length, 4);
  assert.match(flags[0], /flip_input/);
  assert.match(flags[1], /incremental_expandrate/);
  assert.match(flags[2], /lerp_alpha/);
  assert.match(flags[3], /decay_factor/);
});

// ------------------------------------------------------------ LaMa translate

test("LaMa: nothing carries and the mask treatment is always flagged", () => {
  const entry = entryFor("LayerUtility: LaMa");
  const plain = translateWidgets(entry, {});
  assert.deepEqual(plain.widgets, {});
  assert.equal(plain.flags.length, 1);
  assert.match(plain.flags[0], /check mask/);

  const inverted = translateWidgets(entry, { invert_mask: true });
  assert.equal(inverted.flags.length, 2);
  assert.match(inverted.flags[1], /invert_mask/);
});

// ------------------------------------------------------------- slot mapping

test("input mapping renames, drops the unlisted, defaults to same-name", () => {
  const combine = entryFor("VHS_VideoCombine");
  assert.equal(mapInputName(combine, "images"), "frames");
  assert.equal(mapInputName(combine, "audio"), "audio");
  assert.equal(mapInputName(combine, "meta_batch"), null); // dropped, not guessed
  assert.equal(mapInputName(combine, "vae"), null);

  const colorMatch = entryFor("ColorMatch");
  assert.equal(mapInputName(colorMatch, "image_target"), "image");
  assert.equal(mapInputName(colorMatch, "image_ref"), "reference");

  const grow = entryFor("GrowMaskWithBlur"); // no mapping declared
  assert.equal(mapInputName(grow, "mask"), "mask");
});

test("output mapping remaps by index and drops the unlisted", () => {
  const load = entryFor("VHS_LoadVideo");
  assert.equal(mapOutputSlot(load, 0), 0); // IMAGE → frames
  assert.equal(mapOutputSlot(load, 1), 2); // frame_count → frame_count
  assert.equal(mapOutputSlot(load, 2), 1); // audio → audio
  assert.equal(mapOutputSlot(load, 3), null); // video_info has no home

  const combine = entryFor("VHS_VideoCombine");
  assert.equal(mapOutputSlot(combine, 0), null); // VHS_FILENAMES dropped

  const size = entryFor("easy imageSize");
  assert.equal(mapOutputSlot(size, 0), 0);
  assert.equal(mapOutputSlot(size, 1), 1);
  assert.equal(mapOutputSlot(size, 2), null);

  const grow = entryFor("GrowMaskWithBlur"); // no mapping → identity
  assert.equal(mapOutputSlot(grow, 1), 1);
});

test("both image-size sources swap to Image Size 🆎 with no widgets", () => {
  for (const oldId of ["easy imageSize", "DF_Get_image_size"]) {
    const entry = entryFor(oldId);
    assert.equal(entry.new_node_id, "AUSBOSS_NODES_ImageSize");
    assert.deepEqual(translateWidgets(entry, {}), { widgets: {}, flags: [] });
  }
});

// --------------------------------------------------------- planReplacements

test("a mixed graph plans tiers per node and skips healthy strangers", () => {
  const rows = planReplacements(
    [
      { id: 1, type: "KSampler", registered: true },
      {
        id: 2,
        type: "VHS_LoadVideo",
        title: "intro clip",
        registered: false,
        widgetValues: { video: "intro.mp4", skip_first_frames: 24 },
      },
      { id: 3, type: "GetImageSizeAndCount", registered: true },
      { id: 4, type: "WanVideoSampler", registered: false },
      { id: 5, type: "SomePackNode", registered: false },
    ],
    {}
  );
  assert.deepEqual(
    rows.map((row) => [row.id, row.tier]),
    [
      [2, "swap"],
      [3, "pair"],
      [4, "refuse"],
      [5, "none"],
    ]
  );

  const swap = rows[0];
  assert.equal(swap.target, "AUSBOSS_NODES_LoadVideo");
  assert.equal(swap.title, "intro clip");
  assert.equal(swap.widgets.video, "intro.mp4");
  assert.match(swap.flags[0], /check trim/);

  const pair = rows[1];
  assert.equal(pair.target, "AUSBOSS_NODES_ImageSize");
  assert.match(pair.reason, /phase 2/);

  const refuse = rows[2];
  assert.equal(refuse.target, null);
  assert.match(refuse.reason, /no AusBoss equivalent/);

  const unknown = rows[3];
  assert.equal(unknown.target, null);
  assert.match(unknown.reason, /no AusBoss replacement declared/);
});

test("plan context threads fps through to the trim conversion", () => {
  const rows = planReplacements(
    [
      {
        id: 7,
        type: "VHS_LoadVideo",
        registered: false,
        widgetValues: { video: "clip.mp4", skip_first_frames: 24 },
      },
    ],
    { fps: 12 }
  );
  assert.equal(rows[0].widgets.start_seconds, 2);
  assert.deepEqual(rows[0].flags, []);
});

test("a default title is not carried into the plan row", () => {
  const rows = planReplacements(
    [{ id: 9, type: "ColorMatch", title: "ColorMatch", registered: true, widgetValues: ["mkl", 1] }],
    {}
  );
  assert.equal(rows[0].title, null);
  assert.equal(rows[0].widgets.method, "mkl");
});

test("every declared entry names a tier the pipeline understands", () => {
  for (const entry of REPLACEMENTS) {
    assert.ok(["swap", "pair", "refuse"].includes(entry.tier), entry.old_node_id ?? entry.old_node_prefix);
    if (entry.tier === "refuse") assert.ok(entry.reason);
    else assert.match(entry.new_node_id, /^AUSBOSS_NODES_/);
  }
});
