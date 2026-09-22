// Widget cards for the nodes whose face was still a stack of classic canvas
// widgets. Each entry names the rows the card shows in place of those
// widgets; the card (js/shared/widget_card.mjs) hides the originals and
// mirrors them, so the backend, saved workflows and widget-to-input links
// are untouched. Rows with `when` appear only while they mean something,
// and a `group` row folds the rarely-touched settings behind one click.
import { app } from "/scripts/app.js";
import { chainCallback } from "../shared/index.mjs";
import { hideInputsInDef } from "../shared/widget_visibility.mjs";
import { mountWidgetCard } from "../shared/widget_card.mjs";

const isMode = (name, ...modes) => (values) => modes.includes(values[name]);

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
    rows: [
      { widget: "color_match", label: "Tone match" },
      { widget: "fix_edge_halo", label: "Fix edge halo" },
    ],
  },
  AUSBOSS_NODES_CropForInpaint: {
    minWidth: 320,
    rows: [
      { widget: "context_factor", label: "Context", suffix: "×" },
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
  AUSBOSS_NODES_SelectFrame: { minWidth: 280, first: true, rows: [{ widget: "frame_number", label: "Frame" }] },
  AUSBOSS_NODES_LaMaInpaint: { minWidth: 280, first: true, rows: [{ widget: "model", label: "Model", kind: "select" }] },
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
      { widget: "video", label: "Source", kind: "select",
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
      { widget: "image", label: "Source", kind: "select",
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
      { widget: "filename_prefix", label: "Prefix", placeholder: "AusBoss/video" },
      { widget: "format", label: "Format", kind: "select" },
      { pair: ["fps", "crf"], label: "FPS · CRF", sep: "·", top: true },
      { widget: "pingpong", label: "Ping-pong", onText: "forward, back", offText: "off" },
      { widget: "save_metadata", label: "Metadata", title: "On embeds the workflow in the video file, so dropping the file back on the canvas restores the graph that made it." },
    ],
  },
};

function cardWidgetNames(config) {
  return config.rows.flatMap((row) => row.pair ?? (row.widget ? [row.widget] : []));
}

app.registerExtension({
  name: "ausboss.widget_cards",
  beforeRegisterNodeDef(nodeType, nodeData) {
    const config = CARDS[nodeData?.name];
    if (!config) return;
    hideInputsInDef(nodeData, cardWidgetNames(config));
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      if (this.__ausbossCard) return;
      mountWidgetCard(this, config);
      const width = Math.max(this.size?.[0] || 0, config.minWidth ?? 300);
      this.setSize?.([width, this.computeSize?.()[1] || this.size?.[1] || 0]);
    });
  },
});
