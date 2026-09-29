// Widget cards for the nodes whose face was still a stack of classic canvas
// widgets. Each entry names the rows the card shows in place of those
// widgets; the card (js/shared/widget_card.mjs) hides the originals and
// mirrors them, so the backend, saved workflows and widget-to-input links
// are untouched. Rows with `when` appear only while they mean something,
// and a `group` row folds the rarely-touched settings behind one click.
import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { chainCallback } from "../shared/index.mjs";
import { formatWidgetVisibility } from "../shared/save_video_formats.mjs";
import { hideInputsInDef } from "../shared/widget_visibility.mjs";
import { mountWidgetCard } from "../shared/widget_card.mjs";
import { resetUnknownValues } from "../shared/widget_card_math.mjs";
import { mediaViewQuery } from "../shared/media_list.mjs";
import { gearIconSvg, openSettingsMenu } from "../shared/settings_menu.mjs";
import { SEAM_MENU, SEAM_MUTE_TITLES, isBlendIn, seamCornerReserve } from "../shared/stitch_seam.mjs";

// The Source lists preview the hovered file straight from ComfyUI's /view.
const viewUrl = (value) => api.apiURL(`/view?${mediaViewQuery(value)}`);

const isMode = (name, ...modes) => (values) => modes.includes(values[name]);
// Stitch Inpaint: Seam lives in the card's gear menu (shared/stitch_seam.mjs
// holds the menu and the rules). The gear in the card's corner opens the
// menu; a "blend in" chip beside it shows the mode at a glance and opens the
// same menu.
function seamCorner(node, card) {
  const tools = document.createElement("div");
  tools.style.cssText = "position:relative;display:flex;align-items:center;gap:5px";
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "ausboss-card-chip";
  chip.textContent = "blend in";
  chip.title = "Seam is blend in, so Tone match and Fix edge halo are not used. Change it in the gear menu.";
  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "ausboss-card-gear";
  gear.title = "Stitch Inpaint settings";
  gear.innerHTML = gearIconSvg();
  const open = () => openSettingsMenu({
    scope: "stitch_inpaint",
    schema: SEAM_MENU,
    anchor: gear.getBoundingClientRect(),
    title: "Stitch Inpaint settings",
    initial: { seam: card.values().seam },
    onChange: (values, key) => {
      if (key === "seam") card.setWidget("seam", values.seam);
    },
  });
  gear.addEventListener("click", open);
  chip.addEventListener("click", open);
  // Under the chip, beside the muted rows: why they are dim.
  const note = document.createElement("div");
  note.append("not used", document.createElement("br"), "by blend in");
  note.style.cssText = "position:absolute;top:33px;right:2px;text-align:right;white-space:nowrap;"
    + "color:#6f8886;font:9px/11px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"
    + "pointer-events:none";
  tools.append(chip, gear, note);
  return {
    element: tools,
    sync: (values) => {
      chip.hidden = !isBlendIn(values);
      note.hidden = chip.hidden;
      return seamCornerReserve(values);
    },
  };
}
// Save Video rows that only some formats read (crf, save_metadata).
const formatReads = (name) => (values) => formatWidgetVisibility(String(values.format))[name];

const CARDS = {
  AUSBOSS_NODES_ImageResize: {
    minWidth: 300,
    rows: [
      { widget: "target_mode", label: "Target", kind: "select",
        labels: { "width+height": "Width × height", longest_edge: "Longest edge", shortest_edge: "Shortest edge", megapixels: "Megapixels", scale_factor: "Scale factor" } },
      // Sockets for the pair sit among the node's inputs (one socket per
      // row is the rule, and a size is what people wire).
      { pair: ["width", "height"], label: "Size", prefixes: ["W", "H"], sep: "×", top: true, when: isMode("target_mode", "width+height") },
      { widget: "edge_length", label: "Edge", suffix: "px", when: isMode("target_mode", "longest_edge", "shortest_edge") },
      { widget: "megapixels", label: "Budget", suffix: "MP", when: isMode("target_mode", "megapixels") },
      { widget: "scale_factor", label: "Scale", suffix: "×", when: isMode("target_mode", "scale_factor") },
      { widget: "keep_proportion", label: "Fit", kind: "segment", labels: { cover_crop: "cover" } },
      { widget: "fill_color", label: "Fill", kind: "color", when: isMode("keep_proportion", "pad") },
      { widget: "divisible_by", label: "Multiple" },
      { widget: "interpolation", label: "Filter", kind: "select" },
    ],
  },
  AUSBOSS_NODES_ColorMatch: {
    minWidth: 300,
    rows: [
      { widget: "strength", label: "Strength" },
      { widget: "method", label: "Method", kind: "segment", labels: { histogram: "hist" }, titles: { histogram: "histogram" } },
      { widget: "reference_mode", label: "Reference", kind: "segment", labels: { reference: "reference", first_frame: "first frame" } },
      { widget: "invert_mask", label: "Invert mask" },
    ],
  },
  AUSBOSS_NODES_StitchInpaint: {
    minWidth: 300,
    // A workflow saved before Seam existed holds the card's own empty value
    // in the slot Seam now takes; it loads as classic.
    resetUnknown: { seam: "classic" },
    // Seam has no row and no socket: the gear menu sets it.
    hide: ["seam"],
    socketless: ["seam"],
    corner: seamCorner,
    rows: [
      { widget: "color_match", label: "Tone match", mute: isBlendIn, muteTitle: SEAM_MUTE_TITLES.color_match },
      { widget: "fix_edge_halo", label: "Fix edge halo", mute: isBlendIn, muteTitle: SEAM_MUTE_TITLES.fix_edge_halo },
    ],
  },
  AUSBOSS_NODES_CropForInpaint: {
    minWidth: 320,
    // A workflow saved before Stay in picture existed holds the card's own
    // empty value in the slot keep_inside now takes; it loads on, the node's
    // default and what an API prompt without keep_inside runs with.
    resetUnknown: { keep_inside: true },
    rows: [
      { widget: "context_factor", label: "Context", suffix: "×" },
      { widget: "keep_inside", label: "Stay in picture" },
      { widget: "blend_pixels", label: "Blend", suffix: "px" },
      { widget: "output_multiple", label: "Multiple" },
      { widget: "mask_grow", label: "Grow", suffix: "px" },
      { widget: "mask_blur", label: "Blur" },
      { widget: "invert_mask", label: "Invert mask" },
      { group: "advanced", label: "Target size, extend" },
      { widget: "context_pixels", label: "Extra context", suffix: "px", group: "advanced" },
      { widget: "target_width", label: "Target width", suffix: "px", group: "advanced" },
      { widget: "target_height", label: "Target height", suffix: "px", group: "advanced" },
      { widget: "target_megapixels", label: "Target", suffix: "MP", group: "advanced" },
      { widget: "rescale_algorithm", label: "Rescale", kind: "segment", group: "advanced" },
      { widget: "extend_left", label: "Extend left", suffix: "px", group: "advanced" },
      { widget: "extend_right", label: "Extend right", suffix: "px", group: "advanced" },
      { widget: "extend_up", label: "Extend up", suffix: "px", group: "advanced" },
      { widget: "extend_down", label: "Extend down", suffix: "px", group: "advanced" },
    ],
  },
  AUSBOSS_NODES_RefineMask: {
    minWidth: 300, first: true,
    // A workflow saved by a 1.x release holds the preview panel's own empty
    // value where preview now sits; it loads on, the node's default.
    resetUnknown: { preview: true },
    rows: [
      { widget: "expand", label: "Expand", suffix: "px" },
      { widget: "blur", label: "Blur" },
      { group: "advanced", label: "More" },
      { widget: "fill_holes", label: "Fill holes", group: "advanced" },
      { widget: "smooth", label: "Smooth", suffix: "px", group: "advanced" },
      { widget: "black_point", label: "Black point", group: "advanced" },
      { widget: "white_point", label: "White point", group: "advanced" },
      { widget: "edge_refine", label: "Edge", kind: "segment", labels: { "guided filter": "guided" }, group: "advanced" },
    ],
  },
  AUSBOSS_NODES_FrameInterpolate: {
    minWidth: 300,
    rows: [
      { pair: ["source_fps", "target_fps"], label: "FPS", sep: "→", top: true },
      { widget: "method", label: "Method", kind: "select", labels: { "optical flow (requires cached RAFT weights)": "optical flow (RAFT)" } },
      { widget: "scene_cut_threshold", label: "Scene cut" },
      { widget: "batch_size", label: "Batch" },
    ],
  },
  AUSBOSS_NODES_AlignImage: {
    minWidth: 300,
    rows: [
      { widget: "mode", label: "Mode", kind: "segment" },
      { widget: "multiple", label: "Multiple" },
      { widget: "crop_position", label: "Anchor", kind: "select", when: isMode("mode", "crop") },
      { widget: "pad_position", label: "Anchor", kind: "select", when: isMode("mode", "pad") },
      { widget: "pad_fill", label: "Pad fill", kind: "segment", when: isMode("mode", "pad") },
      { widget: "pad_color", label: "Pad color", kind: "color", when: (values) => values.mode === "pad" && values.pad_fill === "color" },
    ],
  },
  AUSBOSS_NODES_RealignToSource: {
    minWidth: 300,
    rows: [
      { widget: "fit", label: "Fit", kind: "segment",
        titles: { "zoom + shift": "A separate horizontal and vertical zoom plus a shift: how Qwen edits drift", affine: "Also a slight rotation or shear" } },
      { widget: "empty_fill", label: "Empty fill", kind: "segment",
        titles: { edge: "Stretch the nearest edge pixels", source: "The original's pixels", gray: "Flat #808080, for an inpaint pass" } },
      { widget: "max_zoom", label: "Max zoom", suffix: "%" },
    ],
  },
  // a, b and c are socket-only inputs (forceInput), so the card is the
  // expression alone; the values arrive on the node's left edge.
  AUSBOSS_NODES_MathExpression: {
    minWidth: 300,
    rows: [{ widget: "expression", label: "f(a, b, c)", placeholder: "a + b" }],
  },
  AUSBOSS_NODES_SelectEveryNth: { minWidth: 280, rows: [{ widget: "nth", label: "Every nth" }, { widget: "offset", label: "Offset" }] },
  AUSBOSS_NODES_SplitBatch: { minWidth: 280, rows: [{ widget: "index", label: "Split after" }] },
  AUSBOSS_NODES_MergeBatches: { minWidth: 300, rows: [{ widget: "on_mismatch", label: "Mismatch", kind: "segment", labels: { "resize to a": "match a", "resize to b": "match b" }, titles: { "resize to a": "resize b to a's size", "resize to b": "resize a to b's size", error: "stop the run" } }] },
  AUSBOSS_NODES_Integer: { minWidth: 260, rows: [{ widget: "value", label: "Value" }] },
  AUSBOSS_NODES_Float: { minWidth: 260, rows: [{ widget: "value", label: "Value", decimals: 3 }] },
  AUSBOSS_NODES_Text: { minWidth: 300, rows: [{ widget: "text", kind: "textarea", placeholder: "Prompt, caption, or shared text", height: 100, grow: true }] },
  // Saved by a 1.x release, these two hold that empty value too and open
  // with preview on, like Mask Refine.
  AUSBOSS_NODES_SelectFrame: { minWidth: 280, first: true, resetUnknown: { preview: true }, rows: [{ widget: "frame_number", label: "Frame" }] },
  AUSBOSS_NODES_LaMaInpaint: { minWidth: 280, first: true, resetUnknown: { preview: true }, rows: [{ widget: "model", label: "Model", kind: "select" }] },
  AUSBOSS_NODES_Krea2OutpaintModelPatch: {
    minWidth: 320,
    rows: [
      { widget: "placement", label: "Reference", kind: "segment", labels: { "source rectangle": "source rect", "whole canvas": "whole canvas" } },
      { widget: "kv_cache", label: "KV cache", onText: "once per run", offText: "every step" },
    ],
  },
  AUSBOSS_NODES_Krea2Encode: {
    minWidth: 320,
    rows: [
      { widget: "prompt", kind: "textarea", placeholder: "Prompt - describe the whole finished canvas", height: 96, grow: true },
      { widget: "negative_prompt", kind: "textarea", placeholder: "Negative prompt (ignored at CFG 1)", height: 44 },
      { widget: "vlm_reference", label: "VLM reference", title: "On, the vision tower also sees the reference images. Use on for AnyPaint with a whole-canvas reference; use off for Registered Outpaint with a source-rectangle reference. Match the adapter's conditioning contract." },
    ],
  },
  AUSBOSS_NODES_LoadVideo: {
    minWidth: 320, first: true, hide: ["upload"],
    rows: [
      { widget: "video", label: "Source", kind: "select", preview: { kind: "video", url: viewUrl },
        button: { text: "Upload", title: "Upload a video into ComfyUI's input folder", onClick: (node) => node.widgets?.find((w) => w.name === "upload")?.callback?.() } },
      { widget: "custom_width", label: "Width", suffix: "px", title: "0 keeps the source width; set one side only to keep the aspect." },
      { widget: "custom_height", label: "Height", suffix: "px", title: "0 keeps the source height; set one side only to keep the aspect." },
      { widget: "every_nth", label: "Every nth" },
      { widget: "max_frames", label: "Limit" },
    ],
  },
  AUSBOSS_NODES_LoadImagePad: {
    minWidth: 340, first: true, hide: ["upload"],
    rows: [
      { widget: "image", label: "Source", kind: "select", preview: { kind: "image", url: viewUrl }, linkedBy: ["source_image"],
        button: { text: "Upload", title: "Upload an image into ComfyUI's input folder", onClick: (node) => node.widgets?.find((w) => w.name === "upload")?.callback?.() } },
      { widget: "mode", label: "Fill", kind: "select" },
      { widget: "fill_color", label: "Color", kind: "color", when: isMode("mode", "color") },
      { widget: "backdrop_blur", label: "Backdrop", when: isMode("mode", "pillarbox blur") },
      { widget: "feather", label: "Feather", suffix: "px" },
      { widget: "canvas_multiple", label: "Multiple" },
      { widget: "target_megapixels", label: "Budget", suffix: "MP" },
      { group: "padding", label: "Exact padding" },
      { widget: "pad_left", label: "Left", suffix: "px", group: "padding" },
      { widget: "pad_top", label: "Top", suffix: "px", group: "padding" },
      { widget: "pad_right", label: "Right", suffix: "px", group: "padding" },
      { widget: "pad_bottom", label: "Bottom", suffix: "px", group: "padding" },
    ],
  },
  AUSBOSS_NODES_SaveVideo: {
    minWidth: 320, first: true,
    rows: [
      { widget: "filename_prefix", label: "Prefix", placeholder: "video" },
      { widget: "format", label: "Format", kind: "select" },
      // CRF and Metadata show only for the formats that read them; fps keeps
      // its lifted socket either way.
      { pair: ["fps", "crf"], label: "FPS · CRF", sep: "·", top: true, when: formatReads("crf") },
      { widget: "fps", label: "FPS", top: true, when: (values) => !formatReads("crf")(values) },
      { widget: "pingpong", label: "Ping-pong", onText: "forward, back", offText: "off" },
      { widget: "save_metadata", label: "Metadata", when: formatReads("save_metadata"), title: "On embeds the workflow in the video file, so dropping the file back on the canvas restores the graph that made it." },
    ],
  },
};

function cardWidgetNames(config) {
  return [...config.rows.flatMap((row) => row.pair ?? (row.widget ? [row.widget] : [])), ...(config.hide ?? [])];
}

// A choice a card sets from its own controls (a gear menu), never from a
// link: the stock combo, marked socketless so the frontend gives it no input
// slot - no dot to draw or aim at in either renderer, no row to reserve.
const SOCKETLESS_CHOICE = "AUSBOSS_SOCKETLESS_COMBO";

function markSocketless(nodeData, names) {
  for (const name of names) {
    for (const spec of [nodeData?.input?.optional?.[name]?.[1], nodeData?.input?.required?.[name]?.[1], nodeData?.inputs?.[name]]) {
      if (spec && typeof spec === "object") Object.assign(spec, { widgetType: SOCKETLESS_CHOICE, socketless: true });
    }
  }
}

app.registerExtension({
  name: "ausboss.widget_cards",
  getCustomWidgets() {
    return {
      // inputData is the input's spec: its options hold the choices.
      [SOCKETLESS_CHOICE](node, inputName, inputData) {
        const spec = inputData?.[1] ?? {};
        const values = Array.isArray(spec.options) ? spec.options : Array.isArray(inputData?.[0]) ? inputData[0] : [];
        const widget = node.addWidget("combo", inputName, spec.default ?? values[0], () => {}, { values });
        widget.options.socketless = true;
        return { widget };
      },
    };
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    const config = CARDS[nodeData?.name];
    if (!config) return;
    hideInputsInDef(nodeData, cardWidgetNames(config));
    if (config.socketless?.length) {
      markSocketless(nodeData, config.socketless);
      // A workflow saved while the widget still had a socket brings the
      // empty slot back with it; an unlinked one goes again.
      chainCallback(nodeType.prototype, "onConfigure", function () {
        for (let index = (this.inputs?.length ?? 0) - 1; index >= 0; index -= 1) {
          const input = this.inputs[index];
          const linked = typeof this.isInputConnected === "function" ? this.isInputConnected(index) : input?.link != null;
          if (config.socketless.includes(input?.widget?.name) && !linked) {
            this.removeInput(index);
          }
        }
      });
    }
    if (config.resetUnknown) {
      // Positional widget values from an older save can land a value that is
      // not one of a choice's options, or not on/off for a switch; put the
      // default back before the card draws it, so the graph queues what the
      // user sees.
      chainCallback(nodeType.prototype, "onConfigure", function () {
        resetUnknownValues(this.widgets, config.resetUnknown);
      });
    }
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      if (this.__ausbossCard) return;
      mountWidgetCard(this, config);
      const width = Math.max(this.size?.[0] || 0, config.minWidth ?? 300);
      this.setSize?.([width, this.computeSize?.()[1] || this.size?.[1] || 0]);
    });
  },
});
