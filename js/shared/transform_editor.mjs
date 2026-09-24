import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { hideInputsInDef, hideWidget } from "./widget_visibility.mjs";
import { mountTransformTrim } from "./transform_trim.mjs";
import { clipOutputRate, inputNumber } from "./clip_rate.mjs";
import { BRAND, chainCallback, keepDomWidgetWidthAuto, notifyAusbossChange, showToast } from "./index.mjs";
import { fillNodeHeight } from "./panel_layout.mjs";
import { normalizeFillColor } from "./fill_color.mjs";
import { makeScrubInput } from "./scrub_input.mjs";
import { featherGeneratedMask, overlayPlan, stitchBlendFromMask } from "./stitch_preview.mjs";
import {
  INPUT_FOLDER_MODE,
  LOCAL_PATH_MODE,
  normalizeVideoOptions,
  mediaSourceState,
  videoSourceState,
} from "./video_source_card.mjs";
import {
  canvasLocalPoint,
  clamp,
  declaredTransformDefaults,
  fitSourceToAspect,
  cropHandleCenters,
  lockPadding,
  lockedPadMinimum,
  nearestHandle,
  paddingAxis,
  paddingHandleCenters,
  parseAspectRatio,
  resetTransformValues,
  resizeCrop,
  resolveCrop,
  resolvePadding,
  rotatedSize,
  scaleToMegapixels,
  sourceChanged,
  sourceResetValues,
  stageHandleLayout,
  zoomAround,
} from "./transform_geometry.mjs";
import { clampFrame, clipInfo, frameTime, frameWindow, windowSeconds } from "./timeline_math.mjs";
import { liftSocket } from "./widget_card.mjs";

const HIDDEN_WIDGETS = [
  "image", "upload",
  "video", "source_mode", "local_path",
  "rotation_degrees", "crop_aspect_ratio", "crop_x", "crop_y", "crop_width", "crop_height",
  "pad_left", "pad_top", "pad_right", "pad_bottom", "feather", "canvas_multiple", "fill_color",
  "seek_mode", "frame_index", "frame_time",
  "start_seconds", "end_seconds", "every_nth", "max_frames", "frame_snap", "fixed_frames",
  // Clip-node stitch settings, driven by the editor's Inpaint & Stitch section.
  "stitch_blend", "stitch_grow",
  // Image-node resize block; hideWidget on a missing widget is a no-op, so
  // the video node sharing this list is unaffected.
  "resize_to_megapixels", "megapixels", "resize_method", "resolution_steps",
];
const trimInputDriven = (node, name) => node.inputs?.some(
  (input) => (input.name === name || input.widget?.name === name) && input.link != null,
) ?? false;

const RESIZE_METHODS = ["lanczos", "area", "bicubic", "bilinear", "nearest-exact"];
const TRANSFORM_DEFAULTS = resetTransformValues(false);
const CORE_IMAGE_PREVIEW_WIDGET = "$$canvas-image-preview";

function installStyles() {
  if (document.getElementById("ausboss-transform-styles")) return;
  const style = document.createElement("style");
  style.id = "ausboss-transform-styles";
  style.textContent = `
    .ausboss-transform-panel{display:flex;flex-direction:column;gap:8px;padding:8px;color:#ddd;font:12px system-ui;box-sizing:border-box;width:100%;height:100%;overflow:hidden}
    .ausboss-transform-preview{width:100%;flex:1 1 180px;min-height:0;border:1px solid #50555b;border-radius:8px;background:#111;display:block;touch-action:none}
    .ausboss-transform-source{display:flex;flex-direction:column;gap:7px;flex:0 0 auto;padding:8px;border:1px solid rgba(0,184,174,.28);border-radius:8px;background:rgba(0,0,0,.24)}
    .ausboss-transform-source-heading{color:${BRAND};font:600 10px system-ui;letter-spacing:.08em;text-transform:uppercase}
    .ausboss-transform-source-mode{display:grid;grid-template-columns:1fr 1fr;height:30px;padding:3px;border:1px solid #2a3437;border-radius:7px;background:#0f1516}
    .ausboss-transform-source-mode button{border:0;border-radius:5px;background:transparent;color:#8ba3a1;font:600 12px system-ui;cursor:pointer}
    .ausboss-transform-source-mode button:hover{color:#fff}.ausboss-transform-source-mode button.on{background:${BRAND};color:#04201d}
    .ausboss-transform-source-field{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;align-items:center}
    .ausboss-transform-source-field select,.ausboss-transform-source-field input{box-sizing:border-box;width:100%;height:34px;min-width:0;padding:0 10px;border:1px solid #2a3437;border-radius:7px;outline:0;background:#0b0f10;color:#dce9e8;font:12px ui-monospace,"SF Mono",Menlo,Consolas,monospace}
    .ausboss-transform-source-field select:focus,.ausboss-transform-source-field input:focus{border-color:${BRAND}}
    .ausboss-transform-source-action{height:34px;box-sizing:border-box;white-space:nowrap}
    .ausboss-transform-source-field:has(input[type=text]){grid-template-columns:minmax(0,1fr)}
    .ausboss-transform-source-hint{overflow:hidden;color:#6f8886;font-size:10.5px;line-height:1.25;white-space:nowrap;text-overflow:ellipsis}
    .lg-node:has(.ausboss-transform-panel) .image-preview{display:none!important}
    .ausboss-transform-row{display:flex;gap:7px;align-items:center;flex:0 0 auto}.ausboss-transform-row>*{min-width:0;flex:1}
    .ausboss-transform-check{display:flex;align-items:center;justify-content:center;gap:5px;background:#30343a;color:#eee;border:1px solid #555b63;border-radius:5px;padding:6px 8px;cursor:pointer;white-space:nowrap;user-select:none}
    .ausboss-transform-check:hover{border-color:${BRAND};background:#383e44}
    .ausboss-transform-check input{accent-color:${BRAND};margin:0;flex:0 0 auto;cursor:pointer}
    .ausboss-transform-canvas-row{justify-content:space-between}
    .ausboss-transform-canvas-row>label{flex:0 0 auto;display:flex;align-items:center;gap:6px;color:#aeb4ba;font-size:11px;white-space:nowrap;cursor:default;user-select:none}
    .ausboss-transform-canvas-row>label>span{color:#8ca8a5;font-weight:600;font-size:10px;letter-spacing:.06em;text-transform:uppercase}
    .ausboss-transform-swatch{width:30px;height:22px;padding:1px;border:1px solid #555b63;border-radius:5px;background:#23272c;cursor:pointer}
    .ausboss-transform-swatch::-webkit-color-swatch-wrapper{padding:1px}.ausboss-transform-swatch::-webkit-color-swatch{border:0;border-radius:3px}
    .ausboss-transform-canvas-row input[type=checkbox]{accent-color:${BRAND};margin:0;cursor:pointer}
    .ausboss-transform-aspects{display:flex;gap:5px;align-items:center;flex:0 0 auto}
    .ausboss-transform-aspects>span{flex:0 0 auto;color:#8ca8a5;font-size:10px;padding:0 3px;user-select:none}
    .ausboss-transform-aspect{flex:1 1 0;min-width:0;background:#262a30;color:#cfd6dc;border:1px solid #4a5058;border-radius:4px;height:28px;padding:3px 2px;font:600 10px system-ui;font-variant-numeric:tabular-nums;white-space:nowrap;cursor:pointer;text-align:center}
    .ausboss-transform-aspect-flip{flex:0 0 30px;display:flex;align-items:center;justify-content:center;margin-right:3px}
    .ausboss-transform-aspect-glyph{display:block;border:1px solid currentColor;border-radius:1px;box-sizing:border-box}
    .ausboss-transform-aspect:hover{border-color:${BRAND};color:#fff}
    .ausboss-transform-aspect.active{background:rgba(0,184,174,.18);border-color:${BRAND};color:#e5fffc}
    .ausboss-transform-aspect.locked{background:rgba(0,184,174,.34);border-color:#e5fffc;color:#fff}
    .ausboss-transform-aspect-lock{display:inline-block;margin-left:3px;vertical-align:-1px;line-height:0}
    .ausboss-transform-button,.ausboss-transform-modal button{background:#30343a;color:#eee;border:1px solid #555b63;border-radius:5px;padding:7px 10px;cursor:pointer}
    .ausboss-transform-button:hover,.ausboss-transform-modal button:hover{border-color:${BRAND};background:#383e44}
    .ausboss-transform-file{position:relative;text-align:center;overflow:hidden}.ausboss-transform-file input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}
    .ausboss-transform-modal{position:fixed;inset:0;z-index:100000;background:#101214;color:#e6e8ea;font:13px system-ui;display:grid;grid-template-rows:42px minmax(0,1fr) auto}
    .ausboss-transform-header{display:flex;align-items:center;gap:12px;padding:0 12px;border-bottom:1px solid #30343a;background:#17191c}
    .ausboss-transform-header strong{color:#fff}.ausboss-transform-header .spacer{flex:1}
    .ausboss-transform-close{background:${BRAND}!important;border-color:${BRAND}!important;color:#06231f!important;font-weight:600}
    .ausboss-transform-close:hover{filter:brightness(1.15)}
    .ausboss-transform-danger{background:#4a1717!important;border-color:#a13a3a!important;color:#ffd9d9!important}
    .ausboss-transform-danger:hover{background:#6b1f1f!important;border-color:#c74e4e!important}
    .ausboss-transform-body{display:grid;grid-template-columns:270px minmax(320px,1fr) 250px;min-height:0}
    .ausboss-transform-sidebar{padding:12px;border-right:1px solid #30343a;overflow:auto;background:#181b1e}
    .ausboss-transform-sidebar.right{border-right:0;border-left:1px solid #30343a}
    .ausboss-transform-section{border-bottom:1px solid #34383d;padding:0 0 13px;margin:0 0 13px}
    .ausboss-transform-section h3{font-size:11px;color:${BRAND};text-transform:uppercase;margin:0 0 8px;display:flex;align-items:center;gap:7px}
    .ausboss-legend{display:inline-block;flex:0 0 auto;width:10px;height:10px}
    canvas.ausboss-legend{width:16px;height:16px}
    .ausboss-legend-crop{background:#4bd8ef;border:1px solid #08272d}
    .ausboss-legend-pad{background:#ff9d42;border:1px solid #3b2108;width:9px;height:9px;transform:rotate(45deg)}
    .ausboss-final-preview{display:block;max-width:100%;margin:2px auto 0;border:1px solid #34383d;border-radius:6px;background:#0c0e10}
    .ausboss-transform-section label{display:grid;grid-template-columns:88px 1fr 58px;gap:7px;align-items:center;margin:7px 0}
    .ausboss-transform-section label>.ausboss-scrub:last-child{width:58px}
    .ausboss-transform-section label>*{min-width:0}
    .ausboss-transform-section input,.ausboss-transform-section select{box-sizing:border-box;width:100%;background:#0e1012;color:#eee;border:1px solid #454b52;border-radius:4px;padding:5px}
    .ausboss-transform-stage{position:relative;min-width:0;min-height:0;background-color:#0c0e10;background-image:radial-gradient(#292d31 1px,transparent 1px);background-size:18px 18px;overflow:hidden}
    .ausboss-transform-canvas{width:100%;height:100%;display:block;touch-action:none}
    .ausboss-transform-status{line-height:1.55;color:#b8bec5;white-space:pre-wrap}.ausboss-transform-help{line-height:1.55;color:#aeb4ba}
    .ausboss-transform-sidebar.right .ausboss-transform-section{margin-top:13px}
    .ausboss-transform-section details{margin:8px 0 0}.ausboss-transform-section summary{cursor:pointer;color:#8de0da;font-size:11px;text-transform:uppercase;letter-spacing:.06em;list-style:none;user-select:none}
    .ausboss-transform-section summary::before{content:"▸";display:inline-block;width:12px;transition:transform .12s}.ausboss-transform-section details[open] summary::before{transform:rotate(90deg)}
    .ausboss-transform-section input[type=checkbox]{width:auto;justify-self:start;accent-color:${BRAND}}
    .ausboss-transform-timeline{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 12px;border-top:1px solid #30343a;background:#17191c}
    .ausboss-transform-timeline>.ausboss-transform-trim{flex-basis:100%}
    .ausboss-transform-transport{display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex-basis:100%}
    .ausboss-transform-steps{display:flex;gap:4px;flex-wrap:wrap}.ausboss-transform-steps button{padding:5px 7px}
    .ausboss-transform-badge{padding:3px 7px;border-radius:99px;background:#263034;color:#8de0da;font-size:11px}
    @media(max-width:900px){.ausboss-transform-body{grid-template-columns:220px minmax(260px,1fr)}.ausboss-transform-sidebar.right{display:none}}
  `;
  document.head.appendChild(style);
}

function widget(node, name) { return node.widgets?.find((item) => item.name === name); }
function value(node, name, fallback = 0) { return widget(node, name)?.value ?? fallback; }
function setValue(node, name, next) {
  const target = widget(node, name);
  if (!target) return;
  target.value = next;
  target.callback?.(next);
}
function values(node) {
  return Object.fromEntries(Object.keys(TRANSFORM_DEFAULTS).map((name) => [name, value(node, name, TRANSFORM_DEFAULTS[name])]));
}

function suppressCoreImagePreview(node) {
  const previewIndex = node.widgets?.findIndex((item) => item.name === CORE_IMAGE_PREVIEW_WIDGET) ?? -1;
  if (previewIndex >= 0) {
    node.widgets[previewIndex].onRemove?.();
    node.widgets.splice(previewIndex, 1);
  }
  if (node.__ausbossImgsSuppressed) return;
  node.__ausbossImgsSuppressed = true;
  node.__ausbossAddCustomWidget = node.addCustomWidget;
  if (typeof node.addCustomWidget === "function") {
    node.addCustomWidget = function (customWidget) {
      if (customWidget?.name === CORE_IMAGE_PREVIEW_WIDGET) hideWidget(customWidget);
      return node.__ausbossAddCustomWidget.call(this, customWidget);
    };
  }
  node.__ausbossImgsDescriptor = Object.getOwnPropertyDescriptor(node, "imgs");
  Object.defineProperty(node, "imgs", {
    configurable: true,
    enumerable: true,
    get() { return undefined; },
    set() {},
  });
}

function sourceKey(node, kind) {
  if (kind === "image") return String(value(node, "image", ""));
  return videoSourceState(
    value(node, "source_mode", INPUT_FOLDER_MODE),
    value(node, "video", ""),
    value(node, "local_path", ""),
  ).key;
}

function parseInputReference(selection) {
  const normalized = String(selection || "").replaceAll("\\", "/");
  const parts = normalized.split("/");
  const filename = parts.pop() || "";
  return { filename, subfolder: parts.join("/"), type: "input" };
}

function imageSourceUrl(selection) {
  const reference = parseInputReference(selection);
  return api.apiURL(`/view?${new URLSearchParams(reference)}`);
}

function videoParams(node, maxSize = 1600) {
  return new URLSearchParams({
    source_mode: String(value(node, "source_mode", "input folder")),
    video: String(value(node, "video", "")),
    local_path: String(value(node, "local_path", "")),
    seek_mode: String(value(node, "seek_mode", "frame index")),
    frame_index: String(Math.max(0, Math.round(Number(value(node, "frame_index", 0)) || 0))),
    frame_time: String(Math.max(0, Number(value(node, "frame_time", 0)) || 0)),
    max_width: String(maxSize),
    max_height: String(maxSize),
  });
}

async function uploadMedia(node, kind, file) {
  const body = new FormData();
  body.append("image", file, file.name);
  body.append("type", "input");
  const route = kind === "video" ? "/ausboss/transform/video/upload" : "/upload/image";
  const response = await api.fetchApi(route, { method: "POST", body });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try { message = JSON.parse(text).error || text; } catch {}
    throw new Error(message || "Upload failed.");
  }
  const result = await response.json();
  const selection = result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
  const target = widget(node, kind);
  if (Array.isArray(target?.options?.values) && !target.options.values.includes(selection)) target.options.values.push(selection);
  if (kind === "video") setValue(node, "source_mode", "input folder");
  setValue(node, kind, selection);
  return selection;
}

function resetTransform(node, includeTimeline = false) {
  if (node.properties) { delete node.properties.ausboss_fit_aspect; delete node.properties.ausboss_aspect_lock; }
  for (const [name, next] of Object.entries(declaredTransformDefaults(node.constructor?.nodeData, includeTimeline))) setValue(node, name, next);
  node.setDirtyCanvas?.(true, true);
}

// The node face's Reset: only the shape - rotation, crop, padding. Fill,
// feather and Align stay, as they do when the source changes.
function resetGeometry(node) {
  if (node.properties) { delete node.properties.ausboss_fit_aspect; delete node.properties.ausboss_aspect_lock; }
  for (const [name, next] of Object.entries(sourceResetValues(false))) setValue(node, name, next);
  node.setDirtyCanvas?.(true, true);
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function addLabeledControl(section, title, control, suffix = "") {
  const label = createElement("label");
  label.append(createElement("span", "", title), control, createElement("span", "", suffix));
  section.append(label);
  return label;
}

function buildMediaSourceCard(state) {
  const { node, kind } = state;
  const root = createElement("div", "ausboss-transform-source");
  const modes = createElement("div", "ausboss-transform-source-mode");
  const uploadsMode = createElement("button", "", "Uploads");
  const localMode = createElement("button", "", "Local path");
  uploadsMode.type = localMode.type = "button";
  uploadsMode.title = "Choose a video already in ComfyUI's input folder or upload another.";
  localMode.title = "Read a video inside ComfyUI's input, output or temp folder in place, without copying it.";
  modes.append(uploadsMode, localMode);

  const field = createElement("div", "ausboss-transform-source-field");
  const selection = createElement("select");
  selection.setAttribute("aria-label", `Uploaded ${kind}`);
  const localPath = createElement("input");
  localPath.type = "text";
  localPath.spellcheck = false;
  localPath.placeholder = "/absolute/path/to/video.mp4";
  localPath.setAttribute("aria-label", "Local video path");
  const upload = createElement("label", "ausboss-transform-button ausboss-transform-file ausboss-transform-source-action");
  const uploadText = createElement("span", "", "Upload");
  upload.append(uploadText);
  const fileInput = createElement("input");
  fileInput.type = "file";
  fileInput.accept = `${kind}/*`;
  fileInput.setAttribute("aria-label", `Upload ${kind}`);
  upload.append(fileInput);
  const hint = createElement("div", "ausboss-transform-source-hint");
  field.append(selection, upload);
  root.append(kind === "image" ? createElement("div", "ausboss-transform-source-heading", "Image source") : modes, field, hint);

  const currentOptions = () => {
    const target = widget(node, kind);
    let options = target?.options?.values;
    if (typeof options === "function") options = options(target, node);
    return normalizeVideoOptions(options, target?.value);
  };
  const sync = () => {
    const source = mediaSourceState(
      kind,
      value(node, "source_mode", INPUT_FOLDER_MODE),
      value(node, kind, ""),
      value(node, "local_path", ""),
    );
    uploadsMode.classList.toggle("on", source.mode === INPUT_FOLDER_MODE);
    localMode.classList.toggle("on", source.mode === LOCAL_PATH_MODE);
    selection.replaceChildren();
    const empty = createElement("option", "", `Choose an uploaded ${kind}…`);
    empty.value = "";
    selection.append(empty);
    for (const name of currentOptions()) {
      const option = createElement("option", "", name);
      option.value = name;
      selection.append(option);
    }
    selection.value = String(value(node, kind, ""));
    selection.title = selection.value || `Choose an uploaded ${kind}`;
    localPath.value = String(value(node, "local_path", ""));
    field.replaceChildren();
    if (source.mode === LOCAL_PATH_MODE) field.append(localPath);
    else field.append(selection, upload);
    hint.textContent = source.hint;
    hint.title = source.mode === LOCAL_PATH_MODE
      ? `${source.hint} Only videos inside ComfyUI's input, output or temp folder can be read.`
      : source.hint;
  };
  const chooseMode = (mode) => {
    if (value(node, "source_mode", INPUT_FOLDER_MODE) === mode) return;
    setValue(node, "source_mode", mode);
    sync();
    notifyAusbossChange();
  };
  uploadsMode.addEventListener("click", () => chooseMode(INPUT_FOLDER_MODE));
  localMode.addEventListener("click", () => chooseMode(LOCAL_PATH_MODE));
  selection.addEventListener("change", () => {
    setValue(node, kind, selection.value);
    sync();
    notifyAusbossChange();
  });
  const commitLocalPath = () => {
    const next = localPath.value.trim();
    if (next !== String(value(node, "local_path", ""))) {
      setValue(node, "local_path", next);
      notifyAusbossChange();
    }
    sync();
  };
  localPath.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") localPath.blur();
    if (event.key === "Escape") { localPath.value = String(value(node, "local_path", "")); localPath.blur(); }
  });
  localPath.addEventListener("blur", commitLocalPath);
  fileInput.addEventListener("change", async () => {
    if (!fileInput.files?.[0]) return;
    fileInput.disabled = true;
    uploadText.textContent = "Uploading…";
    upload.setAttribute("aria-busy", "true");
    try {
      await uploadMedia(node, kind, fileInput.files[0]);
      sync();
      notifyAusbossChange();
    } catch (error) {
      showToast({ severity: "error", summary: "Crop + Rotate + Pad \u{1F18E}", detail: error.message, life: 8000 });
    } finally {
      fileInput.value = "";
      fileInput.disabled = false;
      uploadText.textContent = "Upload";
      upload.removeAttribute("aria-busy");
    }
  });
  root.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button,select,input,label")) event.stopPropagation();
  });
  state.syncSourceCard = sync;
  sync();
  return root;
}

export function installTransformNode(node, kind, mountPanel = null) {
  installStyles();
  const state = {
    node, kind, image: null, sourceWidth: 0, sourceHeight: 0, metadata: null,
    modal: null, canvas: null, previewCanvas: null, render: null, panelRender: null, drag: null,
    view: { zoom: 1, panX: 0, panY: 0 }, grid: false, ready: false,
    source: sourceKey(node, kind), frameController: null, frameObjectUrl: null,
    playbackTimer: null, playing: false, playbackSession: 0, disposed: false, loadSerial: 0,
    imageIndex: null, imageTime: null,
  };
  node.__ausbossTransformState = state;
  state.isClip = Boolean(widget(node, "start_seconds") && widget(node, "end_seconds"));
  state.trimViews = new Set();
  if (state.isClip) {
    // The executor includes every input in its cache key, even when
    // IS_CHANGED ignores it. Preview position is UI state, not clip input.
    for (const [name, constant] of [["seek_mode", "frame index"], ["frame_index", 0], ["frame_time", 0]]) {
      widget(node, name).serializeValue = () => constant;
    }
  }
  if (kind === "image") suppressCoreImagePreview(node);
  if (kind === "video") installVideoDrop(state);
  for (const name of HIDDEN_WIDGETS) hideWidget(widget(node, name));
  liftSocket(node, "fixed_frames");

  const panel = createElement("div", "ausboss-transform-panel");
  const preview = createElement("canvas", "ausboss-transform-preview");
  const row = createElement("div", "ausboss-transform-row");
  const open = createElement("button", "ausboss-transform-button", "Open editor");
  const resetCrop = createElement("button", "ausboss-transform-button", "Reset crop");
  resetCrop.title = "Restore the full source crop; keep rotation, padding and timeline.";
  resetCrop.addEventListener("click", () => {
    setValue(node, "crop_aspect_ratio", "free");
    if (node.properties) { delete node.properties.ausboss_fit_aspect; node.properties.ausboss_aspect_lock = false; }
    fitCrop(state); updateModalInfo(state); notifyAusbossChange();
  });
  row.append(open, resetCrop);
  panel.append(buildMediaSourceCard(state));
  panel.append(preview);
  panel.append(buildAspectChipRow(state), buildAspectModeRow(state));
  // Both video nodes get the timeline on their face: the clip node trims
  // with it, the frame picker scrubs its output frame with it. Their canvas
  // row shows what a video model keys on - fill, feather, size - so a wrong
  // value is seen on the node, not discovered in the render.
  if (kind === "video") panel.append(buildVideoCanvasRow(state), buildTrim(state));
  panel.append(row);
  if (kind === "image") panel.append(buildImageQuickRow(state));
  state.previewCanvas = preview;
  open.addEventListener("click", () => openEditor(state));

  if (typeof node.addDOMWidget === "function" && mountPanel) {
    mountPanel(node, panel);
  } else if (typeof node.addDOMWidget === "function") {
    const domWidget = node.addDOMWidget("ausboss_transform_preview", "ausboss_transform_preview", panel, {
      serialize: false,
      hideOnZoom: false,
    });
    keepDomWidgetWidthAuto(domWidget);
    fillNodeHeight(domWidget, { minWidth: 330, minHeight: state.isClip ? 602 : kind === "video" ? 510 : 296, minNodeSize: [330, state.isClip ? 802 : kind === "video" ? 570 : 456] });
  } else {
    node.addWidget?.("button", "Open editor", null, () => openEditor(state), { serialize: false });
  }
  const baseHeight = state.isClip ? 842 : kind === "video" ? 635 : 511;
  node.setSize?.([
    Math.max(330, Math.min(520, node.size?.[0] || 330)),
    Math.max(baseHeight, node.computeSize?.()[1] || 0),
  ]);
  if (typeof node.addDOMWidget === "function") {
    // Redraw on wrapper size changes (node resize, zoom relayout);
    // node.onResize is unreliable across frontends.
    //
    // This is not only about hit-testing. prepareCanvas() sizes the backing
    // store from the element at DRAW time, and the canvas is CSS-stretched to
    // its box, so a box that changes shape without a redraw displays the last
    // frame at the wrong aspect. Both kinds need it: the video panel is a
    // passive preview and has no other reason to redraw, which is exactly why
    // it was the one that came out stretched.
    state.panelResizeObserver = new ResizeObserver(() => draw(state));
    state.panelResizeObserver.observe(preview);
    // The graph scales the DOM widget with its zoom, so the backing store
    // sized at one zoom turns to mush at another: redraw when it changes.
    chainCallback(node, "onDrawForeground", function () {
      if (state.isClip && !state.disposed) {
        const rate = clipOutputRate(node, state.metadata?.fps, value(node, "every_nth", 1));
        const signature = JSON.stringify([rate, ...["fixed_frames", "start_frame", "start_seconds"].map(name => inputNumber(node, name, value(node, name, 0)))]);
        if (signature !== state.trimRate) {
          state.trimRate = signature;
          for (const trim of state.trimViews) trim.sync();
        }
      }
      if (state.disposed || state.zoomRedraw || Math.abs(panelOversample() - (state.panelOversample ?? 1)) < 0.01) return;
      state.zoomRedraw = requestAnimationFrame(() => { state.zoomRedraw = null; if (!state.disposed) draw(state); });
    });
  }
  if (typeof node.addDOMWidget === "function") {
    // All transform nodes share inline handles. Wheel/middle-drag still
    // belong to the graph; only direct handle gestures are captured.
    state.panelInteractive = true;
    state.panelAbort = new AbortController();
    attachStageHandlers(state, preview, state.panelAbort.signal);
  }

  const watched = kind === "image" ? ["image"] : ["video", "source_mode", "local_path"];
  for (const name of watched) {
    const target = widget(node, name);
    if (!target) continue;
    chainCallback(target, "callback", function () {
      state.syncSourceCard?.();
      if (state.ready) onSourceChanged(state, true);
    });
  }
  chainCallback(node, "onConnectionsChange", () => queueMicrotask(() => {
    for (const trim of state.trimViews) trim.sync();
  }));
  chainCallback(node, "onConfigure", () => queueMicrotask(() => {
    if (state.disposed) return;
    for (const name of HIDDEN_WIDGETS) hideWidget(widget(node, name));
    liftSocket(node, "fixed_frames");
    state.syncSourceCard?.();
    for (const trim of state.trimViews) trim.sync();
    if (state.ready) onSourceChanged(state, false);
  }));
  queueMicrotask(async () => {
    // Core's upload helper can add its button after our creation hook.
    for (const name of HIDDEN_WIDGETS) hideWidget(widget(node, name));
    liftSocket(node, "fixed_frames");
    state.ready = true;
    await onSourceChanged(state, false);
  });
  return state;
}

// Dropping a video file on the node uploads it and makes it the source,
// as core's upload widgets do for their own nodes. Core's canvas drop
// handler asks the node under the cursor first; a handled drop keeps it
// from spawning a separate Load Video node for the file.
const VIDEO_FILE_PATTERN = /\.(avi|m2ts|m4v|mkv|mov|mp4|mpeg|mpg|mts|webm)$/i;

function installVideoDrop(state) {
  const node = state.node;
  node.onDragOver = (event) => {
    const items = event?.dataTransfer?.items;
    return Boolean(items && Array.from(items).some((item) => item.kind === "file"));
  };
  node.onDragDrop = async (event) => {
    const file = Array.from(event?.dataTransfer?.files ?? []).find(
      (candidate) => String(candidate.type).startsWith("video/") || VIDEO_FILE_PATTERN.test(candidate.name),
    );
    if (!file) return false;
    try {
      await uploadMedia(node, "video", file);
      state.syncSourceCard?.();
      if (state.ready) await onSourceChanged(state, true);
      notifyAusbossChange();
    } catch (error) {
      showToast({ severity: "error", summary: "Crop + Rotate + Pad \u{1F18E}", detail: error.message, life: 8000 });
    }
    return true;
  };
}

// Format chips right under the preview: one tap pads the whole source to
// that aspect with centered fill bands (the editor's Pad to aspect), so an
// outpaint canvas is a single click. Tapping the lit chip clears it again.
const ASPECT_CHIP_ORDER = ["1:1", "4:3", "3:2", "16:9", "21:9"];

function buildAspectChipRow(state) {
  const node = state.node;
  const row = createElement("div", "ausboss-transform-aspects");
  const flip = createElement("button", "ausboss-transform-aspect ausboss-transform-aspect-flip");
  flip.type = "button";
  const glyph = createElement("span", "ausboss-transform-aspect-glyph");
  flip.append(glyph);
  row.append(flip);
  const caption = createElement("span", "", "Ratio");
  caption.title = "Choose the target ratio, then use Crop or Pad below. Crop locks the crop shape without adding padding.";
  row.append(caption);
  const portrait = () => {
    const [w, h] = String(node.properties?.ausboss_fit_aspect ?? "").split(":").map(Number);
    return w && h && w !== h ? h > w : Boolean(node.properties?.ausboss_pad_portrait);
  };
  const oriented = (aspect) => portrait() ? aspect.split(":").reverse().join(":") : aspect;
  flip.addEventListener("click", () => {
    const next = !portrait();
    const current = String(node.properties?.ausboss_fit_aspect ?? "");
    node.properties ??= {};
    node.properties.ausboss_pad_portrait = next;
    if (state.image && /^\d+:\d+$/.test(current) && current !== "1:1") {
      fitAspect(state, current.split(":").reverse().join(":"), aspectMode(state));
    }
    sync();
    notifyAusbossChange();
  });
  // Three taps on one chip: pad to the format, lock it, clear it.
  const chips = [];
  for (const aspect of ASPECT_CHIP_ORDER) {
    const chip = createElement("button", "ausboss-transform-aspect", aspect);
    chip.type = "button";
    chip.addEventListener("click", () => {
      if (!state.image) return;
      node.properties ??= {};
      node.properties.ausboss_pad_portrait = portrait();
      const ratio = oriented(aspect);
      if (String(node.properties.ausboss_fit_aspect ?? "") !== ratio) fitAspect(state, ratio, aspectMode(state));
      else if (!node.properties.ausboss_aspect_lock) setAspectLock(state, true);
      else clearAspect(state);
      sync();
    });
    chips.push({ chip, aspect }); row.append(chip);
  }
  const sync = () => {
    const current = String(node.properties?.ausboss_fit_aspect ?? "");
    const locked = Boolean(node.properties?.ausboss_aspect_lock);
    flip.title = `${portrait() ? "Portrait" : "Landscape"} — click to flip to ${portrait() ? "landscape" : "portrait"}`;
    flip.setAttribute("aria-label", flip.title);
    flip.setAttribute("aria-pressed", String(portrait()));
    glyph.style.width = portrait() ? "10px" : "16px";
    glyph.style.height = portrait() ? "16px" : "10px";
    for (const { chip, aspect } of chips) {
      const ratio = oriented(aspect);
      const active = ratio === current;
      chip.replaceChildren(document.createTextNode(ratio));
      if (active && locked) chip.append(lockGlyph());
      chip.title = !active
        ? aspectMode(state) === "crop" ? `Crop to ${ratio}: lock the crop shape without padding.` : `Pad to ${ratio}: keep every source pixel and add centered fill bands.`
        : locked
          ? `Locked to ${ratio} in ${aspectMode(state)} mode. Tap to clear.`
          : `Padded to ${ratio}. Tap again to lock the format for crop and padding drags.`;
      chip.classList.toggle("active", active);
      chip.classList.toggle("locked", active && locked);
      chip.setAttribute("aria-pressed", String(active));
    }
  };
  sync();
  state.syncAspectChips = sync;
  return row;
}

function aspectMode(state) {
  return state.node.properties?.ausboss_aspect_mode === "crop" ? "crop" : "pad";
}

function buildAspectModeRow(state) {
  const row = createElement("div", "ausboss-transform-row ausboss-transform-aspect-modes");
  const buttons = [];
  for (const mode of ["crop", "pad"]) {
    const button = createElement("button", "ausboss-transform-aspect", mode === "crop" ? "Crop" : "Pad");
    button.type = "button";
    button.title = mode === "crop" ? "Fit and lock the crop to the selected ratio; no padding." : "Keep the whole source and pad to the selected ratio.";
    button.addEventListener("click", () => {
      state.node.properties ??= {};
      state.node.properties.ausboss_aspect_mode = mode;
      const ratio = state.node.properties.ausboss_fit_aspect;
      if (ratio && ratio !== "free") fitAspect(state, ratio, mode);
      draw(state); notifyAusbossChange();
    });
    buttons.push([mode, button]); row.append(button);
  }
  const alignment = createElement("label", "ausboss-transform-alignment");
  alignment.style.cssText = "display:flex;align-items:center;gap:5px;flex:0 0 118px";
  const multiple = makeScrubInput({ value: value(state.node, "canvas_multiple", 1),
    min: 1, max: 4096, step: 8, fineStep: 1, decimals: 0, width: 82, unit: "px",
    title: "Align the output canvas to a pixel multiple (1 disables). Adds pixels on the right/bottom when needed.",
    onChange: (amount) => { setValue(state.node, "canvas_multiple", amount); draw(state); updateModalInfo(state); },
    onSettle: notifyAusbossChange });
  alignment.append(createElement("span", "", "Align"), multiple.root);
  row.append(alignment);
  state.syncAspectMode = () => {
    multiple.set(value(state.node, "canvas_multiple", 1));
    for (const [mode, button] of buttons) {
      button.classList.toggle("active", aspectMode(state) === mode);
      button.setAttribute("aria-pressed", String(aspectMode(state) === mode));
    }
  };
  state.syncAspectMode();
  return row;
}

// A padlock drawn by hand: shackle arc over a filled body.
function lockGlyph() {
  const glyph = createElement("span", "ausboss-transform-aspect-lock");
  glyph.innerHTML = '<svg width="9" height="11" viewBox="0 0 9 11" aria-hidden="true"><path d="M2.2 5V3.4a2.3 2.3 0 0 1 4.6 0V5" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="4.8" width="7" height="5.4" rx="1.2" fill="currentColor"/></svg>';
  return glyph;
}

// --- Aspect lock ----------------------------------------------------------
// The locked format is the chip row's / target select's aspect
// (properties.ausboss_fit_aspect) with properties.ausboss_aspect_lock on.
// Every handle gesture then re-solves the padding so crop plus padding keep
// that ratio (lockPadding, transform_geometry.mjs).
function lockRatio(state) {
  const properties = state.node.properties;
  if (aspectMode(state) === "crop" || !properties?.ausboss_aspect_lock || !state.sourceWidth || !state.sourceHeight) return null;
  const source = rotatedSize(state.sourceWidth, state.sourceHeight, value(state.node, "rotation_degrees", 0));
  return parseAspectRatio(String(properties.ausboss_fit_aspect ?? ""), source);
}

function applyAspectLock(state, driver = "x") {
  const ratio = lockRatio(state);
  if (!ratio) return false;
  const source = rotatedSize(state.sourceWidth, state.sourceHeight, value(state.node, "rotation_degrees", 0));
  const current = values(state.node);
  const pads = lockPadding(current, resolveCrop(current, source), ratio, driver);
  if (!pads) return false;
  for (const [name, next] of Object.entries(pads)) setValue(state.node, name, next);
  return true;
}

function setAspectLock(state, on) {
  state.node.properties ??= {};
  state.node.properties.ausboss_aspect_lock = Boolean(on);
  if (aspectMode(state) === "crop") setValue(state.node, "crop_aspect_ratio", on ? state.node.properties.ausboss_fit_aspect : "free");
  else if (on) applyAspectLock(state, "x");
  draw(state); updateModalInfo(state); notifyAusbossChange();
}

function clearAspect(state) {
  fitAspect(state, "free", aspectMode(state));
  if (state.node.properties) { delete state.node.properties.ausboss_fit_aspect; state.node.properties.ausboss_aspect_lock = false; }
  draw(state); updateModalInfo(state); notifyAusbossChange();
}

// Which axis a crop drag drove, for the lock: the one that changed more,
// the handle's own axis on a tie.
function cropDriver(before, after, handle) {
  const dx = Math.abs(after.width - before.width);
  const dy = Math.abs(after.height - before.height);
  if (dx !== dy) return dx > dy ? "x" : "y";
  return /[ns]/.test(handle) && !/[ew]/.test(handle) ? "y" : "x";
}

// The video nodes' canvas row under the format chips: fill swatch, feather
// amount and the resize budget - the three values a video outpaint model
// keys on (LTX's IC-LoRA wants pure black, a hard edge and 32-px sizes),
// editable on the face and mirrored from the hidden widgets on every draw.
function buildVideoCanvasRow(state) {
  const node = state.node;
  const row = createElement("div", "ausboss-transform-row ausboss-transform-canvas-row");
  const fillLabel = createElement("label");
  const fill = createElement("input"); fill.type = "color"; fill.className = "ausboss-transform-swatch";
  fill.title = "Fill colour of the padding and rotation corners. Video outpaint models key on it: the LTX IC-LoRA paints pure black (#000000) and leaves other colours alone.";
  fill.addEventListener("input", () => { setValue(node, "fill_color", fill.value); draw(state); });
  fill.addEventListener("change", () => notifyAusbossChange());
  fillLabel.append(createElement("span", "", "Fill"), fill);
  const featherLabel = createElement("label");
  const feather = makeScrubInput({ value: value(node, "feather", 0), min: 0, max: 4096, step: 1, decimals: 0, width: 62, unit: "px",
    title: "Feather of the mask and image edge into the fill. 0 keeps the hard edge a black-band outpaint needs; grey bands in a render mean feather was on.",
    onChange: (amount) => { setValue(node, "feather", amount); draw(state); updateModalInfo(state); }, onSettle: notifyAusbossChange });
  featherLabel.append(createElement("span", "", "Feather"), feather.root);
  const resizeLabel = createElement("label");
  const resize = createElement("input"); resize.type = "checkbox";
  resize.title = "Resize the output to a megapixel budget, each side rounded to the resolution step (32 for LTX and Wan).";
  const budget = makeScrubInput({ value: value(node, "megapixels", 1), min: 0.01, max: 16, step: 0.05, fineStep: 0.01, decimals: 2, width: 66, unit: "MP",
    title: "Output budget in megapixels (x 1024x1024).",
    onChange: (amount) => { setValue(node, "megapixels", amount); draw(state); updateModalInfo(state); }, onSettle: notifyAusbossChange });
  resize.addEventListener("change", () => {
    setValue(node, "resize_to_megapixels", resize.checked);
    draw(state); updateModalInfo(state); notifyAusbossChange();
  });
  resizeLabel.append(createElement("span", "", "Resize"), resize, budget.root);
  row.append(fillLabel, featherLabel);
  if (widget(node, "resize_to_megapixels")) row.append(resizeLabel);
  const sync = () => {
    fill.value = normalizeColor(value(node, "fill_color", "#808080"));
    fill.title = `${fill.title.split(" Now ")[0]} Now ${fill.value}.`;
    feather.set(value(node, "feather", 0));
    resize.checked = Boolean(value(node, "resize_to_megapixels", false));
    budget.set(value(node, "megapixels", 1));
    budget.root.style.visibility = resize.checked ? "" : "hidden";
  };
  sync();
  state.syncCanvasRow = sync;
  chainCallback(node, "onConfigure", () => queueMicrotask(sync));
  row.addEventListener("pointerdown", (event) => { if (event.target.closest("input,label")) event.stopPropagation(); });
  return row;
}

// The image node's quick row under the canvas: reset, the feather on/off,
// and the resize-to-megapixels toggle with its budget box. These mirror
// hidden widgets, so the row re-reads them after a workflow restore lands
// (onConfigure) — the panel is built before the saved values arrive.
function buildImageQuickRow(state) {
  const node = state.node;
  const row = createElement("div", "ausboss-transform-row");

  const reset = createElement("button", "ausboss-transform-button", "Reset");
  reset.title = "Reset rotation, crop and padding. Fill, feather and Align stay.";
  reset.addEventListener("click", () => {
    resetGeometry(node);
    draw(state);
    notifyAusbossChange();
  });

  const makeCheck = (text, title) => {
    const label = createElement("label", "ausboss-transform-check");
    const box = createElement("input");
    box.type = "checkbox";
    label.append(box, createElement("span", "", text));
    label.title = title;
    return { label, box };
  };

  // Feather is an amount, so the toggle remembers the amount it turns off:
  // off writes 0, on restores the stashed value (or the 24px default).
  const feather = makeCheck("Feather", "Feather the mask and image edge into the fill color");
  feather.box.addEventListener("change", () => {
    if (feather.box.checked) {
      const stashed = Number(node.properties?.ausbossFeatherMemory) || 24;
      setValue(node, "feather", stashed);
    } else {
      node.properties ??= {};
      node.properties.ausbossFeatherMemory = value(node, "feather", 24) || 24;
      setValue(node, "feather", 0);
    }
    draw(state);
    notifyAusbossChange();
  });

  const resize = makeCheck("Resize", "Resize the output to a megapixel budget (aspect preserved)");
  // The pack's standard scrub control (drag / type / arrows, Shift = fine),
  // same box the LoRA loader strengths use.
  const budget = makeScrubInput({
    value: value(node, "megapixels", 1),
    min: 0.01, max: 16, step: 0.05, fineStep: 0.01, decimals: 2, width: 74,
    title: "Output budget in megapixels (x 1024x1024).",
    onChange: (amount) => {
      setValue(node, "megapixels", amount);
      draw(state);
      updateModalInfo(state);
    },
    onSettle: () => notifyAusbossChange(),
  });
  resize.box.addEventListener("change", () => {
    setValue(node, "resize_to_megapixels", resize.box.checked);
    budget.root.style.display = resize.box.checked ? "" : "none";
    draw(state);
    updateModalInfo(state);
    notifyAusbossChange();
  });

  const sync = () => {
    feather.box.checked = Number(value(node, "feather", 24)) > 0;
    resize.box.checked = Boolean(value(node, "resize_to_megapixels", false));
    budget.set(value(node, "megapixels", 1));
    budget.root.style.display = resize.box.checked ? "" : "none";
  };
  sync();
  state.syncQuickRow = sync;
  chainCallback(node, "onConfigure", () => queueMicrotask(sync));

  row.append(reset, feather.label, resize.label, budget.root);
  return row;
}

async function onSourceChanged(state, reset) {
  const key = sourceKey(state.node, state.kind);
  const changed = reset && sourceChanged(state.source, key, state.ready);
  if (changed) {
    // Geometry measured against the old pixels goes; fill, feather, the
    // resize budget and the lit format chip stay - swapping the clip in an
    // outpaint workflow used to reset the fill to grey and the feather to
    // 24, which is exactly what the model cannot work with.
    for (const [name, next] of Object.entries(sourceResetValues(state.kind === "video"))) setValue(state.node, name, next);
    if (state.isClip) { setValue(state.node, "start_seconds", 0); setValue(state.node, "end_seconds", 0); }
    resetView(state);
  }
  if (key) state.source = key;
  await loadSource(state);
  if (changed && state.image) refitAspect(state);
}

// A lit format chip is a standing request: the new source gets padded to
// it as well, so the canvas keeps its format across clips.
function refitAspect(state) {
  const aspect = String(state.node.properties?.ausboss_fit_aspect ?? "");
  if (!/^\d+:\d+$/.test(aspect)) return;
  fitAspect(state, aspect, aspectMode(state));
}

async function loadSource(state) {
  const serial = ++state.loadSerial;
  try {
    if (state.kind === "image") {
      const selection = value(state.node, "image", "");
      if (!selection) {
        state.image = null; state.sourceWidth = state.sourceHeight = 0;
        drawEmpty(state, "Choose a source to begin"); return;
      }
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve; image.onerror = () => reject(new Error("Could not load image preview."));
        image.src = imageSourceUrl(selection);
      });
      if (serial !== state.loadSerial || state.disposed) return;
      state.image = image; state.sourceWidth = image.naturalWidth; state.sourceHeight = image.naturalHeight;
      // Core's image-upload helper also installs a source preview. This node has
      // its own transformed preview, so keep only the useful one.
      suppressCoreImagePreview(state.node);
      state.node.imageIndex = null;
    } else {
      const key = sourceKey(state.node, "video");
      if (!key) { state.image = null; state.metadata = null; state.metadataKey = null; drawEmpty(state, "Choose a source to begin"); return; }
      if (state.metadataKey !== key) {
        const metaResponse = await api.fetchApi(`/ausboss/transform/video/metadata?${videoParams(state.node)}`);
        const metadata = await metaResponse.json();
        if (!metaResponse.ok) throw new Error(metadata.error || "Could not read video metadata.");
        if (serial !== state.loadSerial) return;
        state.metadata = metadata; state.metadataKey = key;
        state.sourceWidth = metadata.width; state.sourceHeight = metadata.height;
        state.storyboard = null; state.scrubPreviewTile = null; state.imageIndex = null; state.imageTime = null;
        syncTimelineRange(state);
        requestStoryboard(state, key);
      }
      await loadVideoFrame(state, serial);
    }
    draw(state); updateModalInfo(state);
  } catch (error) {
    if (serial !== state.loadSerial || state.disposed) return;
    if (error?.name === "AbortError") return;
    state.image = null;
    drawEmpty(state, error.message);
  }
}

function syncTimelineRange(state) {
  for (const trim of state.trimViews) trim.sync();
  if (!state.timelineLabel) return;
  const info = clipInfo(state.metadata);
  state.timelineLabel.textContent = `${clampFrame(value(state.node, "frame_index", 0), info)} / ${Math.max(0, info.count - 1)}`;
}

// Storyboard: a keyframe thumbnail strip the server builds once per file in
// the background. While it exists, dragging shows the nearest tile with zero
// network latency and the exact decoded frame replaces it a beat later.
// Best-effort — scrubbing works without it, just without the instant ghost.
async function requestStoryboard(state, key, attempt = 0) {
  if (state.disposed || state.kind !== "video") return;
  try {
    const response = await api.fetchApi(`/ausboss/transform/video/storyboard?${videoParams(state.node)}`);
    const payload = await response.json();
    if (!response.ok || state.disposed || sourceKey(state.node, "video") !== key) return;
    if (payload.status === "building") {
      if (attempt < 40) setTimeout(() => requestStoryboard(state, key, attempt + 1), 1200);
      return;
    }
    if (payload.status !== "ready") return;
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = payload.sprite; });
    if (state.disposed || sourceKey(state.node, "video") !== key) return;
    state.storyboard = {
      image, times: payload.times, count: payload.count,
      tileWidth: payload.tile_width, tileHeight: payload.tile_height,
    };
  } catch { /* storyboard is an enhancement, never an error */ }
}

function showScrubGhost(state, frameIndex) {
  const storyboard = state.storyboard;
  if (!storyboard) return;
  const info = clipInfo(state.metadata);
  const moment = frameTime(frameIndex, info);
  let tile = 0;
  for (let index = 0; index < storyboard.times.length; index += 1) {
    if (Math.abs(storyboard.times[index] - moment) < Math.abs(storyboard.times[tile] - moment)) tile = index;
  }
  // The tile stands in only while it is nearer the target than the frame
  // already on the stage. A keyframe seconds away is worse than a slightly
  // stale picture, and swapping between the two on every pointer move was
  // the flicker: with one keyframe per clip the ghost was always frame 0.
  const tileGap = Math.abs(storyboard.times[tile] - moment);
  const imageGap = Number.isFinite(state.imageTime) ? Math.abs(state.imageTime - moment) : Infinity;
  const next = tileGap + 0.5 / Math.max(1, info.fps || 30) < imageGap ? tile : null;
  if (next === state.scrubPreviewTile) return;
  state.scrubPreviewTile = next;
  draw(state);
}

// Frame-only refresh for discrete jumps (step buttons, drag release):
// full-resolution fetch that also snaps the widgets to the decoded frame.
async function seekFrame(state) {
  try {
    await loadVideoFrame(state);
    draw(state); updateModalInfo(state);
  } catch (error) {
    if (error?.name === "AbortError") return;
    drawEmpty(state, error.message);
  }
}

// Live scrubbing pump. Video players feel responsive because they always
// render *something* for the newest position instead of waiting for quiet.
// This keeps exactly one request in flight, fires the first one immediately
// (no debounce delay), and when a response lands it re-reads the widgets so
// the next fetch always targets the latest slider position — intermediate
// positions are skipped, never queued. Scrub frames are fetched at reduced
// size for fast decode+encode; the drag-release handler does one full-size
// fetch at the end.
const SCRUB_PREVIEW_SIZE = 640;

function requestScrubFrame(state) {
  state.scrubPending = true;
  if (state.scrubActive) return;
  state.scrubActive = true;
  (async () => {
    while (state.scrubPending && !state.disposed) {
      state.scrubPending = false;
      try {
        await loadVideoFrame(state, ++state.loadSerial, { maxSize: SCRUB_PREVIEW_SIZE, syncWidgets: false });
        draw(state); updateModalInfo(state);
      } catch (error) {
        if (error?.name !== "AbortError") { drawEmpty(state, error.message); break; }
      }
    }
    state.scrubActive = false;
  })();
}

async function loadVideoFrame(state, serial = ++state.loadSerial, options = {}) {
  const { maxSize = 1600, syncWidgets = true } = options;
  state.frameController?.abort();
  const controller = new AbortController();
  state.frameController = controller;
  const response = await api.fetchApi(`/ausboss/transform/video/frame?${videoParams(state.node, maxSize)}`, { signal: controller.signal });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Could not decode video preview frame.");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve; image.onerror = () => reject(new Error("Could not display video frame.")); image.src = objectUrl;
    });
    if (serial !== state.loadSerial) return;
    if (state.frameObjectUrl) URL.revokeObjectURL(state.frameObjectUrl);
    state.frameObjectUrl = objectUrl; state.image = image;
    state.scrubPreviewTile = null; // real frame arrived; drop the ghost tile
    const actualIndex = Number(response.headers.get("X-AusBoss-Frame-Index"));
    const actualTime = Number(response.headers.get("X-AusBoss-Frame-Time"));
    // Where the picture on the stage comes from: the ghost rule compares
    // storyboard tiles against it.
    state.imageIndex = Number.isFinite(actualIndex) ? actualIndex : null;
    state.imageTime = Number.isFinite(actualTime) ? actualTime : null;
    // Writing the decoded position back is only safe when the user is not
    // mid-scrub: a stale response overwriting frame_index would rubber-band
    // the playhead to an older frame.
    if (syncWidgets) {
      if (Number.isFinite(actualIndex)) setValue(state.node, "frame_index", actualIndex);
      if (Number.isFinite(actualTime)) setValue(state.node, "frame_time", actualTime);
      syncTimelineRange(state);
    }
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function openEditor(state) {
  if (state.modal) return;
  const modal = createElement("div", "ausboss-transform-modal");
  const header = createElement("div", "ausboss-transform-header");
  header.append(createElement("strong", "", `${state.kind === "video" ? "Video" : "Image"} Crop + Rotate + Pad`), createElement("span", "ausboss-transform-badge", "AusBoss"));
  header.append(createElement("span", "spacer"));
  const close = createElement("button", "ausboss-transform-close", "Save & close"); header.append(close);
  const body = createElement("div", "ausboss-transform-body");
  const left = createElement("aside", "ausboss-transform-sidebar");
  const stage = createElement("main", "ausboss-transform-stage");
  const canvas = createElement("canvas", "ausboss-transform-canvas"); stage.append(canvas);
  const right = createElement("aside", "ausboss-transform-sidebar right");
  body.append(left, stage, right); modal.append(header, body);
  state.modal = modal; state.canvas = canvas;
  buildControls(state, left);
  const status = createElement("div", "ausboss-transform-status"); status.dataset.ausbossStatus = ""; right.append(status);
  right.append(createElement("div", "ausboss-transform-help", "Drag cyan squares to crop. Drag inside the crop to move it. Orange diamonds add padding. The rotate knob at the top-right corner rotates; hold Shift to snap to 15 degrees. Wheel zooms. Middle mouse or Alt-drag pans."));
  if (state.isClip && widget(state.node, "stitch_blend")) right.append(buildStitchSection(state));
  if (state.kind === "video") modal.append(buildTimeline(state));
  document.body.append(modal);

  const abort = new AbortController(); state.modalAbort = abort;
  close.addEventListener("click", () => closeEditor(state), { signal: abort.signal });
  attachStageHandlers(state, canvas, abort.signal);
  canvas.addEventListener("wheel", (event) => wheelZoom(state, event), { signal: abort.signal, passive: false });
  window.addEventListener("keydown", (event) => keyDown(state, event), { signal: abort.signal });
  window.addEventListener("keyup", (event) => keyUp(state, event), { signal: abort.signal });
  state.resizeObserver = new ResizeObserver(() => draw(state)); state.resizeObserver.observe(stage);
  requestAnimationFrame(() => { resetView(state); draw(state); updateModalInfo(state); });
}

function closeEditor(state) {
  const hadModal = Boolean(state.modal);
  stopPlayback(state);
  state.scrubPending = false;
  state.modalAbort?.abort(); state.resizeObserver?.disconnect(); state.modal?.remove();
  if (state.modalTrim) state.trimViews.delete(state.modalTrim);
  state.modalTrim = null; state.timelineLabel = null;
  state.modal = null; state.canvas = null; state.finalPreviewCanvas = null; state.drag = null; state.grid = false; state.syncEditorControls = null; state.syncStitchControls = null; state.blendOverlay = null;
  draw(state); state.node.setDirtyCanvas?.(true, true);
  // Sidebar and timeline controls write widgets without a canvas drag, so a
  // closing editor is their commit point. The disposal path (node removed,
  // possibly mid-load teardown) must never trigger a capture.
  if (hadModal && !state.disposed) notifyAusbossChange();
}

// Inpaint & Stitch (clip node): the stitcher this node emits pastes the source
// frames back over the generated clip. Blend is the ramp where generated
// pixels take over; it is deliberately separate from the padding feather,
// which shapes the mask the model sees. Grow moves the paste boundary and
// sits behind a disclosure - most outpaints never touch it.
function buildStitchSection(state) {
  const node = state.node;
  const section = createElement("section", "ausboss-transform-section");
  section.append(sectionHeading("Inpaint & Stitch"));
  section.append(createElement("div", "ausboss-transform-help", "Outside the paste mask the stitcher puts the source frames back bit-for-bit. Inside it - the padded and rotated-in area plus the blend ramp - the generation takes over."));
  const blend = makeScrubInput({ value: value(node, "stitch_blend", 32), min: 0, max: 512, step: 1, decimals: 0,
    title: "Ramp where generated pixels fade over the source, in pixels of the output. Separate from the padding feather.",
    onChange: (amount) => { setValue(node, "stitch_blend", amount); draw(state); updateModalInfo(state); }, onSettle: notifyAusbossChange });
  addLabeledControl(section, "Blend", blend.root, "px");
  const show = createElement("input"); show.type = "checkbox"; show.checked = Boolean(state.showBlend);
  show.title = "Tint the paste mask the stitcher will use - the same mask math as the backend, at preview resolution.";
  show.addEventListener("change", () => { state.showBlend = show.checked; draw(state); });
  addLabeledControl(section, "Show blend", show);
  const advanced = createElement("details"); advanced.append(createElement("summary", "", "Advanced"));
  const grow = makeScrubInput({ value: value(node, "stitch_grow", 0), min: -256, max: 256, step: 1, decimals: 0,
    title: "Moves the paste boundary before the ramp. Positive lets the generation replace a strip of the source next to the seam; negative keeps more source.",
    onChange: (amount) => { setValue(node, "stitch_grow", amount); draw(state); updateModalInfo(state); }, onSettle: notifyAusbossChange });
  addLabeledControl(advanced, "Grow paste", grow.root, "px");
  advanced.append(createElement("div", "ausboss-transform-help", "Use a few pixels of grow when a seam still shows: the generation then repaints the source edge too."));
  section.append(advanced);
  state.syncStitchControls = () => { blend.set(value(node, "stitch_blend", 32)); grow.set(value(node, "stitch_grow", 0)); };
  return section;
}

// Show blend: the stitcher's paste mask, computed the way the backend
// computes it, at preview resolution. The generated-area mask (padding and
// rotation voids, everything the rotated source does not cover inside the
// crop) is rasterised on the pre-resize canvas, feathered like the
// transform, then grown and blurred by the stitch settings converted from
// output pixels through any resize - the same steps as
// stitch_blend_from_mask, mirrored in stitch_preview.mjs and tested against
// the Python helper. Cached on its inputs: a drag that changes geometry
// rebuilds it, a pan or zoom does not.
function blendOverlayCanvas(state, render) {
  const node = state.node;
  const { source, crop, padding } = render;
  const rotation = Number(value(node, "rotation_degrees", 0)) || 0;
  const feather = Math.max(0, Number(value(node, "feather", 0)) || 0);
  const blend = Math.max(0, Number(value(node, "stitch_blend", 32)) || 0);
  const grow = Number(value(node, "stitch_grow", 0)) || 0;
  const resize = value(node, "resize_to_megapixels", false)
    ? scaleToMegapixels(padding.outputWidth, padding.outputHeight, value(node, "megapixels", 1), value(node, "resolution_steps", 1))
    : null;
  const key = JSON.stringify([state.sourceWidth, state.sourceHeight, rotation, crop, padding, feather, blend, grow, resize]);
  if (state.blendOverlay?.key === key) return state.blendOverlay.canvas;
  const plan = overlayPlan(padding.outputWidth, padding.outputHeight, resize);
  const { width, height, k } = plan;
  const raster = document.createElement("canvas"); raster.width = width; raster.height = height;
  const rc = raster.getContext("2d", { willReadFrequently: true });
  rc.fillStyle = "#fff"; rc.fillRect(0, 0, width, height);
  rc.save();
  rc.beginPath(); rc.rect(padding.left * k, padding.top * k, crop.width * k, crop.height * k); rc.clip();
  rc.translate((padding.left - crop.x) * k + source.width * k / 2, (padding.top - crop.y) * k + source.height * k / 2);
  rc.rotate(rotation * Math.PI / 180);
  rc.fillStyle = "#000"; rc.fillRect(-state.sourceWidth * k / 2, -state.sourceHeight * k / 2, state.sourceWidth * k, state.sourceHeight * k);
  rc.restore();
  const pixels = rc.getImageData(0, 0, width, height).data;
  let mask = new Float32Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4] / 255;
  mask = featherGeneratedMask(mask, width, height, feather * k);
  mask = stitchBlendFromMask(mask, width, height, blend * plan.unit, grow * plan.unit);
  const overlay = document.createElement("canvas"); overlay.width = width; overlay.height = height;
  const oc = overlay.getContext("2d"); const image = oc.createImageData(width, height); const data = image.data;
  for (let i = 0; i < mask.length; i++) { data[i * 4] = 0; data[i * 4 + 1] = 184; data[i * 4 + 2] = 174; data[i * 4 + 3] = Math.round(mask[i] * 150); }
  oc.putImageData(image, 0, 0);
  state.blendOverlay = { key, canvas: overlay, mask, width, height };
  return overlay;
}

function drawBlendOverlay(context, state, render) {
  const overlay = blendOverlayCanvas(state, render);
  const { outputRect } = render;
  context.save(); context.imageSmoothingEnabled = true;
  context.drawImage(overlay, outputRect.x, outputRect.y, outputRect.width, outputRect.height);
  context.restore();
}

// Section headers carry a small marker matching the on-canvas handle for
// that group (cyan square = crop, green knob = rotate, orange diamond =
// padding), teaching the editor's color language without a word of text.
function legendMarker(kind) {
  if (kind === "rotate") {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32; // drawn 2x, displayed at 16px for crispness
    canvas.className = "ausboss-legend";
    const context = canvas.getContext("2d");
    context.fillStyle = "#73e36a";
    context.beginPath(); context.arc(16, 16, 15, 0, Math.PI * 2); context.fill();
    drawRotateGlyph(context, 16, 16, 7, "#0c2210");
    return canvas;
  }
  return createElement("span", `ausboss-legend ausboss-legend-${kind}`);
}

function sectionHeading(title, markerKind = null) {
  const heading = createElement("h3");
  if (markerKind) heading.append(legendMarker(markerKind));
  heading.append(createElement("span", "", title));
  return heading;
}

function buildControls(state, sidebar) {
  const node = state.node;
  const cropSection = createElement("section", "ausboss-transform-section"); cropSection.append(sectionHeading("Crop", "crop"));
  const ratio = createElement("select");
  // Options come from the widget the backend registered, so custom presets
  // from ausboss_presets.json appear here automatically.
  const ratioWidget = widget(node, "crop_aspect_ratio");
  let ratioValues = ratioWidget?.options?.values;
  if (typeof ratioValues === "function") ratioValues = ratioValues(ratioWidget, node);
  if (!Array.isArray(ratioValues) || !ratioValues.length) ratioValues = ["free", "source", "1:1", "9:16", "16:9", "2:3", "3:2", "3:4", "4:3", "9:21", "21:9"];
  // The target is a UI preference, separate from the inner crop lock.
  // Pad to aspect deliberately unlocks that inner crop to keep all pixels.
  const currentRatio = String(node.properties?.ausboss_fit_aspect ?? value(node, "crop_aspect_ratio", "free"));
  if (!ratioValues.includes(currentRatio)) ratioValues = [...ratioValues, currentRatio];
  for (const optionValue of ratioValues) {
    const option = createElement("option", "", optionValue); option.value = optionValue; ratio.append(option);
  }
  ratio.value = currentRatio;
  ratio.setAttribute("aria-label", "Target aspect");
  ratio.title = "Choose a target, then Crop or Pad. Changing the target alone does not alter your framing.";
  ratio.addEventListener("change", () => {
    node.properties ??= {}; node.properties.ausboss_fit_aspect = ratio.value;
    if (node.properties.ausboss_aspect_lock) {
      if (aspectMode(state) === "crop") {
        setValue(node, "crop_aspect_ratio", ratio.value);
        if (ratio.value === "free") node.properties.ausboss_aspect_lock = false;
      } else if (ratio.value === "free") node.properties.ausboss_aspect_lock = false;
      else applyAspectLock(state, "x");
    }
    draw(state); updateModalInfo(state);
    notifyAusbossChange();
  });
  addLabeledControl(cropSection, "Target aspect", ratio);
  const lock = createElement("input"); lock.type = "checkbox";
  lock.title = "Crop mode locks the crop rectangle without padding. Pad mode adjusts padding to keep the output ratio.";
  lock.addEventListener("change", () => {
    if (lock.checked && ratio.value === "free") { lock.checked = false; return; }
    node.properties ??= {};
    if (lock.checked) node.properties.ausboss_fit_aspect = ratio.value;
    setAspectLock(state, lock.checked);
  });
  addLabeledControl(cropSection, "Lock aspect", lock);
  const fitRow = createElement("div", "ausboss-transform-row");
  for (const [mode, title, tip] of [
    ["crop", "Crop to aspect", "Center the largest crop inside the rotated source. Removes pixels and resets padding."],
    ["pad", "Pad to aspect", "Keep the full rotated source. Add centered fill-color bands to reach the target aspect; no stretching or cropping."],
  ]) {
    const button = createElement("button", "", title); button.title = tip;
    button.addEventListener("click", () => fitAspect(state, ratio.value, mode)); fitRow.append(button);
  }
  cropSection.append(fitRow, createElement("div", "ausboss-transform-help", "Crop trims. Pad keeps the whole source. Both replace the current crop and padding; rotation stays. Free restores the full source."));

  const rotateSection = createElement("section", "ausboss-transform-section"); rotateSection.append(sectionHeading("Rotate", "rotate"));
  const rotation = createElement("input"); rotation.type = "range"; rotation.min = "-180"; rotation.max = "180"; rotation.step = "0.1"; rotation.value = value(node, "rotation_degrees", 0);
  const rotationNumber = makeScrubInput({ value: Number(rotation.value), min: -180, max: 180, step: 1, fineStep: 0.1, decimals: 1,
    title: "Rotation in degrees. Shift scrubs in tenths.", onChange: (degrees) => setRotation(state, degrees), onSettle: notifyAusbossChange });
  rotation.addEventListener("input", () => setRotation(state, Number(rotation.value)));
  addLabeledControl(rotateSection, "Degrees", rotation, ""); rotateSection.append(rotationNumber.root);
  const zeroRotation = createElement("button", "", "Reset rotation"); zeroRotation.addEventListener("click", () => setRotation(state, 0)); rotateSection.append(zeroRotation);

  const padSection = createElement("section", "ausboss-transform-section"); padSection.append(sectionHeading("Padding & mask", "pad"));
  const color = createElement("input"); color.type = "color"; color.value = normalizeColor(value(node, "fill_color", "#808080")); color.addEventListener("input", () => { setValue(node, "fill_color", color.value); draw(state); });
  addLabeledControl(padSection, "Fill", color);
  // Feather: slider for coarse sweeps plus a number box (with up/down
  // arrows) for granular single-pixel control.
  const feather = createElement("input"); feather.type = "range"; feather.min = "0"; feather.max = "512"; feather.step = "1"; feather.value = value(node, "feather", 24);
  const applyFeather = (raw) => {
    const amount = Math.max(0, Math.min(4096, Math.round(Number(raw) || 0)));
    setValue(node, "feather", amount); draw(state);
  };
  const featherNumber = makeScrubInput({ value: Number(feather.value), min: 0, max: 4096, step: 1, decimals: 0,
    title: "Mask feather in pixels.", onChange: applyFeather, onSettle: notifyAusbossChange });
  feather.addEventListener("input", () => applyFeather(feather.value));
  const featherLabel = addLabeledControl(padSection, "Feather", feather); featherLabel.lastElementChild.replaceWith(featherNumber.root);
  const multiple = makeScrubInput({ value: value(node, "canvas_multiple", 1), min: 1, max: 4096, step: 1, decimals: 0,
    title: "Round the outer canvas up to a pixel multiple. This can slightly change the fitted aspect.",
    onChange: (amount) => { setValue(node, "canvas_multiple", amount); draw(state); }, onSettle: notifyAusbossChange });
  addLabeledControl(padSection, "Multiple", multiple.root, "px");
  const resetPad = createElement("button", "", "Reset padding"); resetPad.title = "Remove all padding; a locked format is released.";
  resetPad.addEventListener("click", () => { for (const name of ["pad_left", "pad_top", "pad_right", "pad_bottom"]) setValue(node, name, 0); if (node.properties) node.properties.ausboss_aspect_lock = false; draw(state); updateModalInfo(state); notifyAusbossChange(); }); padSection.append(resetPad);

  // Resize to a pixel budget (image and clip nodes): mirrors the core Scale
  // Image to Total Pixels trio - megapixels, method, resolution steps -
  // so the output lands render-ready without another node.
  let resizeSection = null;
  if (widget(node, "resize_to_megapixels")) {
    resizeSection = createElement("section", "ausboss-transform-section");
    resizeSection.append(sectionHeading("Resize output"));
    const enable = createElement("input"); enable.type = "checkbox";
    enable.checked = Boolean(value(node, "resize_to_megapixels", false));
    const applyResize = () => {
      setValue(node, "resize_to_megapixels", enable.checked);
      draw(state);
      updateModalInfo(state);
    };
    enable.addEventListener("change", applyResize);
    addLabeledControl(resizeSection, "Resize", enable);
    const budget = makeScrubInput({
      value: value(node, "megapixels", 1),
      min: 0.01, max: 16, step: 0.05, fineStep: 0.01, decimals: 2,
      title: "Output budget in megapixels (x 1024x1024).",
      onChange: (amount) => {
        setValue(node, "megapixels", amount);
        draw(state);
        updateModalInfo(state);
      },
    });
    addLabeledControl(resizeSection, "Megapixels", budget.root, "MP");
    const method = createElement("select");
    for (const name of RESIZE_METHODS) {
      const option = createElement("option", "", name); option.value = name; method.append(option);
    }
    method.value = String(value(node, "resize_method", "lanczos"));
    if (!RESIZE_METHODS.includes(method.value)) method.value = "lanczos";
    method.addEventListener("change", () => { setValue(node, "resize_method", method.value); });
    addLabeledControl(resizeSection, "Method", method);
    const steps = makeScrubInput({
      value: value(node, "resolution_steps", 1),
      min: 1, max: 256, step: 1, decimals: 0,
      title: "Rounds each resized dimension to a multiple of this.",
      onChange: (step) => {
        setValue(node, "resolution_steps", step);
        draw(state);
        updateModalInfo(state);
      },
    });
    addLabeledControl(resizeSection, "Steps", steps.root, "px");
  }

  const actions = createElement("section", "ausboss-transform-section"); actions.append(sectionHeading("View & reset"));
  const resetViewButton = createElement("button", "", "Reset view"); resetViewButton.addEventListener("click", () => { resetView(state); draw(state); });
  const resetAll = createElement("button", "ausboss-transform-danger", "Reset transform");
  resetAll.title = "Reset rotation, crop, padding, fill, feather and Align. Keep the source, current frame, trim window, fixed length, resize and stitch settings.";
  resetAll.addEventListener("click", () => { resetTransform(node); resetView(state); draw(state); updateModalInfo(state); });
  actions.append(resetViewButton, resetAll);

  // Live preview of the actual output composite (no overlays), so the final
  // result is always visible while adjusting handles.
  const previewSection = createElement("section", "ausboss-transform-section");
  previewSection.append(sectionHeading("Preview"));
  const finalPreview = createElement("canvas", "ausboss-final-preview");
  previewSection.append(finalPreview);
  state.finalPreviewCanvas = finalPreview;

  sidebar.append(cropSection, rotateSection, padSection);
  if (resizeSection) sidebar.append(resizeSection);
  sidebar.append(actions, previewSection);
  state.syncEditorControls = () => {
    rotation.value = value(node, "rotation_degrees", 0); rotationNumber.set(Number(rotation.value));
    feather.value = Math.min(512, value(node, "feather", 24)); featherNumber.set(value(node, "feather", 24));
    multiple.set(value(node, "canvas_multiple", 1)); color.value = normalizeColor(value(node, "fill_color", "#808080"));
    ratio.value = node.properties?.ausboss_fit_aspect ?? value(node, "crop_aspect_ratio", "free");
    lock.checked = Boolean(node.properties?.ausboss_aspect_lock);
    lock.disabled = ratio.value === "free";
  };
}

// Renders what the node will actually output: fill background, the rotated
// source clipped to the crop, placed inside the padded canvas. No handles,
// no dashes - the composite itself.
function drawFinalPreview(state) {
  const canvas = state.finalPreviewCanvas;
  if (!canvas || !state.image || !state.sourceWidth || !state.sourceHeight) return;
  const current = values(state.node);
  const source = rotatedSize(state.sourceWidth, state.sourceHeight, current.rotation_degrees);
  const crop = resolveCrop(current, source);
  const padding = resolvePadding(current, crop);
  const scale = Math.min(226 / padding.outputWidth, 260 / padding.outputHeight);
  const width = Math.max(1, Math.round(padding.outputWidth * scale));
  const height = Math.max(1, Math.round(padding.outputHeight * scale));
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  const pixelWidth = Math.round(width * dpr); const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = normalizeColor(current.fill_color);
  context.fillRect(0, 0, width, height);
  context.save();
  context.beginPath();
  context.rect(padding.left * scale, padding.top * scale, crop.width * scale, crop.height * scale);
  context.clip();
  context.translate(
    (padding.left - crop.x) * scale + source.width * scale / 2,
    (padding.top - crop.y) * scale + source.height * scale / 2
  );
  context.rotate((Number(current.rotation_degrees) || 0) * Math.PI / 180);
  drawSourceImage(context, state, scale);
  context.restore();

  // Live feather: a miniature of the backend blend. Build the generated-area
  // mask (everything the image does not cover: padding, rotation corners,
  // source transparency), blur it, draw it twice (alpha ~doubles, matching
  // the engine's ramp that starts at full strength on the edge), tint with
  // the fill color, and overlay.
  const featherPreviewPx = Math.min(60, (Number(current.feather) || 0) * scale);
  if (featherPreviewPx >= 0.3) {
    const maskLayer = document.createElement("canvas");
    maskLayer.width = pixelWidth; maskLayer.height = pixelHeight;
    const maskContext = maskLayer.getContext("2d");
    maskContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    maskContext.fillStyle = "#fff";
    maskContext.fillRect(0, 0, width, height);
    maskContext.save();
    maskContext.beginPath();
    maskContext.rect(padding.left * scale, padding.top * scale, crop.width * scale, crop.height * scale);
    maskContext.clip();
    maskContext.globalCompositeOperation = "destination-out";
    maskContext.translate(
      (padding.left - crop.x) * scale + source.width * scale / 2,
      (padding.top - crop.y) * scale + source.height * scale / 2
    );
    maskContext.rotate((Number(current.rotation_degrees) || 0) * Math.PI / 180);
    drawSourceImage(maskContext, state, scale);
    maskContext.restore();

    const soft = document.createElement("canvas");
    soft.width = pixelWidth; soft.height = pixelHeight;
    const softContext = soft.getContext("2d");
    softContext.filter = `blur(${featherPreviewPx * dpr}px)`;
    softContext.drawImage(maskLayer, 0, 0);
    softContext.drawImage(maskLayer, 0, 0);
    softContext.filter = "none";
    softContext.globalCompositeOperation = "source-in";
    softContext.fillStyle = normalizeColor(current.fill_color);
    softContext.fillRect(0, 0, pixelWidth, pixelHeight);
    context.drawImage(soft, 0, 0, width, height);
  }
}

function buildTimeline(state) {
  const timeline = createElement("div", "ausboss-transform-timeline");
  const transport = createElement("div", "ausboss-transform-transport");
  const label = createElement("span", "ausboss-transform-badge", "0 / 0");
  label.title = "Playhead frame / last frame";
  const steps = createElement("div", "ausboss-transform-steps");
  const commands = [["|<", "first"], ["-100", -100], ["-50", -50], ["-25", -25], ["-1", -1], ["Play", "play"], ["+1", 1], ["+25", 25], ["+50", 50], ["+100", 100], [">|", "last"]];
  for (const [text, command] of commands) {
    const button = createElement("button", "", text); if (command === "play") state.playButton = button;
    button.title = command === "play" ? "Play / pause (Space)" : typeof command === "number" ? `Step ${command > 0 ? "+" : ""}${command} frames (Arrow keys step 1, Shift 10)` : command === "first" ? "First frame (Home)" : "Last frame (End)";
    button.addEventListener("click", () => timelineCommand(state, command)); steps.append(button);
  }
  transport.append(label, steps);
  if (state.isClip) {
    const marks = createElement("div", "ausboss-transform-steps");
    for (const [text, command, tip] of [["Set IN", "setIn", "Put IN at the playhead (I)"], ["Set OUT", "setOut", "Put OUT at the playhead (O)"]]) {
      const button = createElement("button", "", text); button.title = tip;
      button.addEventListener("click", () => timelineCommand(state, command)); marks.append(button);
    }
    transport.append(marks);
  }
  timeline.append(transport, buildTrim(state));
  state.timelineLabel = label;
  state.modalTrim = [...state.trimViews].at(-1);
  syncTimelineRange(state);
  return timeline;
}

// One timeline component on every surface (node face, editor): the clip
// node's with IN/OUT handles, the frame picker's with the playhead alone.
function buildTrim(state) {
  const control = mountTransformTrim({
    get: (name, fallback) => value(state.node, name, fallback),
    set: (name, next) => {
      setValue(state.node, name, next);
      for (const view of state.trimViews) if (view !== control) view.sync();
    },
    has: (name) => Boolean(widget(state.node, name)),
    driven: (name) => trimInputDriven(state.node, name),
    number: (name, fallback) => inputNumber(state.node, name, value(state.node, name, fallback)),
    outputRate: () => clipOutputRate(state.node, state.metadata?.fps, value(state.node, "every_nth", 1)),
    metadata: () => state.metadata,
    trim: state.isClip,
    onSeek: (frame, settled) => scrubTo(state, frame, settled),
    onCommit: notifyAusbossChange,
  });
  state.trimViews.add(control);
  return control.root;
}

function setPlayhead(state, index) {
  const info = clipInfo(state.metadata);
  const frame = clampFrame(index, info);
  setValue(state.node, "seek_mode", "frame index");
  setValue(state.node, "frame_index", frame);
  setValue(state.node, "frame_time", frameTime(frame, info));
  return frame;
}

// The playhead moved. While a gesture is live the pump fetches a reduced
// frame (one request in flight, the latest position wins) and a storyboard
// tile stands in when it is nearer; on release, one full-size fetch that
// also snaps the widgets to the decoded frame.
function scrubTo(state, index, settled) {
  const frame = setPlayhead(state, index);
  syncTimelineRange(state);
  if (settled) { void seekFrame(state); return; }
  showScrubGhost(state, frame);
  requestScrubFrame(state);
}

// Light variant for continuous motion (playback, held arrow keys): reduced
// preview size, widgets still snapped since only the caller writes position.
async function seekFrameLight(state) {
  try {
    await loadVideoFrame(state, ++state.loadSerial, { maxSize: SCRUB_PREVIEW_SIZE });
    draw(state); updateModalInfo(state);
  } catch (error) {
    if (error?.name === "AbortError") return;
    drawEmpty(state, error.message);
  }
}

async function timelineCommand(state, command, light = false) {
  if (command === "play") { state.playing ? stopPlayback(state) : startPlayback(state); return; }
  const info = clipInfo(state.metadata);
  if (!info.count) return;
  const current = clampFrame(value(state.node, "frame_index", 0), info);
  if (command === "setIn" || command === "setOut") {
    if (!state.isClip) return;
    const edge = command === "setIn" ? "start" : "end";
    const trim = [...state.trimViews][0];
    if (trim?.fixed()) { trim.moveEdge(edge, current, true); return; }
    if (trimInputDriven(state.node, `${edge}_frame`) || trimInputDriven(state.node, `${edge}_seconds`)) return;
    const window = frameWindow(info, value(state.node, "start_seconds", 0), value(state.node, "end_seconds", 0));
    const next = command === "setIn"
      ? { first: current, last: Math.max(current, window.last) }
      : { first: Math.min(current, window.first), last: current };
    const seconds = windowSeconds(info, next.first, next.last);
    if (!trimInputDriven(state.node, "start_frame") && !trimInputDriven(state.node, "start_seconds")) setValue(state.node, "start_seconds", seconds.start_seconds);
    if (!trimInputDriven(state.node, "end_frame") && !trimInputDriven(state.node, "end_seconds")) setValue(state.node, "end_seconds", seconds.end_seconds);
    syncTimelineRange(state); notifyAusbossChange();
    return;
  }
  let next = current;
  if (command === "first") next = 0; else if (command === "last") next = info.count - 1; else next += Number(command);
  setPlayhead(state, next);
  syncTimelineRange(state);
  await (light ? seekFrameLight(state) : seekFrame(state));
}

// Playback correctness note: each tick awaits a frame fetch, and a Pause
// press usually lands during that await. The tick must therefore re-check
// after the await — against a session counter, not just a boolean — so a
// paused (or paused-then-restarted) loop's in-flight tick dies instead of
// re-scheduling itself as a zombie that can no longer be stopped.
function startPlayback(state) {
  state.playButton.textContent = "Pause";
  state.playing = true;
  const session = (state.playbackSession = (state.playbackSession || 0) + 1);
  const delay = Math.max(20, Math.round(1000 / Math.max(1, state.metadata?.fps || 30)));
  const tick = async () => {
    if (!state.playing || state.playbackSession !== session) return;
    const before = Number(value(state.node, "frame_index", 0));
    await timelineCommand(state, 1, true);
    if (!state.playing || state.playbackSession !== session) return;
    if (Number(value(state.node, "frame_index", 0)) === before) { stopPlayback(state); return; }
    state.playbackTimer = window.setTimeout(tick, delay);
  };
  state.playbackTimer = window.setTimeout(tick, delay);
}
function stopPlayback(state) {
  const wasPlaying = Boolean(state.playing);
  state.playing = false;
  state.playbackSession = (state.playbackSession || 0) + 1; // orphan in-flight ticks
  if (state.playbackTimer) clearTimeout(state.playbackTimer);
  state.playbackTimer = null;
  if (state.playButton) state.playButton.textContent = "Play";
  // Land on a full-resolution frame after light playback previews.
  if (wasPlaying) void seekFrame(state);
}

function keyDown(state, event) {
  if (!state.modal || ["INPUT", "SELECT", "TEXTAREA"].includes(event.target?.tagName)) return;
  if (event.key === "Escape") { closeEditor(state); return; }
  if (state.kind === "video" && event.code === "Space") { event.preventDefault(); timelineCommand(state, "play"); }
  if (state.kind === "video" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    // Light fetches while the key repeats; keyup lands a full-size frame.
    event.preventDefault(); timelineCommand(state, (event.shiftKey ? 10 : 1) * (event.key === "ArrowLeft" ? -1 : 1), true);
  }
  if (state.kind === "video" && (event.key === "Home" || event.key === "End")) {
    event.preventDefault(); timelineCommand(state, event.key === "Home" ? "first" : "last");
  }
  if (state.isClip && (event.key === "i" || event.key === "I" || event.key === "o" || event.key === "O") && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault(); timelineCommand(state, event.key.toLowerCase() === "i" ? "setIn" : "setOut");
  }
}

function keyUp(state, event) {
  if (!state.modal || state.kind !== "video") return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") void seekFrame(state);
}

function fitCrop(state) {
  setValue(state.node, "crop_x", 0); setValue(state.node, "crop_y", 0); setValue(state.node, "crop_width", 0); setValue(state.node, "crop_height", 0); draw(state);
}
function fitAspect(state, aspect, mode) {
  if (!state.image || !state.sourceWidth || !state.sourceHeight) return;
  const source = rotatedSize(state.sourceWidth, state.sourceHeight, value(state.node, "rotation_degrees", 0));
  for (const [name, next] of Object.entries(fitSourceToAspect(source, aspect, mode))) setValue(state.node, name, next);
  state.node.properties ??= {}; state.node.properties.ausboss_fit_aspect = aspect;
  state.node.properties.ausboss_aspect_mode = mode;
  state.node.properties.ausboss_aspect_lock = mode === "crop" && aspect !== "free";
  if (aspect === "free") state.node.properties.ausboss_aspect_lock = false;
  resetView(state); draw(state); updateModalInfo(state); notifyAusbossChange();
}
function setRotation(state, degrees) {
  setValue(state.node, "rotation_degrees", Math.round(clamp(degrees, -180, 180) * 10) / 10);
  fitCrop(state); applyAspectLock(state, "x"); draw(state); updateModalInfo(state);
}
function resetView(state) { state.view = { zoom: 1, panX: 0, panY: 0 }; }

// Resolve CSS color names with the browser's own parser. An invalid
// assignment leaves fillStyle unchanged, so probing twice from different
// starting values separates "parsed" from "ignored".
let colorProbeContext = null;
function resolveCssColorName(name) {
  try {
    colorProbeContext ??= document.createElement("canvas").getContext("2d");
    const context = colorProbeContext;
    context.fillStyle = "#000000"; context.fillStyle = name;
    const first = String(context.fillStyle);
    context.fillStyle = "#ffffff"; context.fillStyle = name;
    return first === String(context.fillStyle) && /^#[0-9a-f]{6}$/i.test(first) ? first : null;
  } catch { return null; }
}
function normalizeColor(value) { return normalizeFillColor(value, resolveCssColorName); }

// The panel never zooms or pans: fit-only, so it cannot fight graph zoom.
const PANEL_VIEW = Object.freeze({ zoom: 1, panX: 0, panY: 0 });

// Geometry (source, crop, padding) is always read live from the widgets;
// the screen mapping is either fitted fresh or, mid-drag, the frozen map
// captured at pointerdown — a live refit would change the scale under the
// pointer and make the grabbed handle slip.
function renderGeometry(state, width, height, view, map = null) {
  const source = rotatedSize(state.sourceWidth, state.sourceHeight, value(state.node, "rotation_degrees", 0));
  const crop = resolveCrop(values(state.node), source); const padding = resolvePadding(values(state.node), crop);
  const layout = map?.layout ?? stageHandleLayout(width, height);
  let scale, originX, originY;
  if (map) {
    ({ scale, originX, originY } = map);
  } else {
    const margin = layout.margin; const union = { x: Math.min(0, crop.x - padding.left), y: Math.min(0, crop.y - padding.top) };
    union.width = Math.max(source.width, crop.x - padding.left + padding.outputWidth) - union.x;
    union.height = Math.max(source.height, crop.y - padding.top + padding.outputHeight) - union.y;
    const fit = Math.max(0.01, Math.min((width - margin * 2) / union.width, (height - margin * 2) / union.height));
    scale = fit * view.zoom;
    originX = (width - union.width * fit) / 2 - union.x * fit + view.panX;
    originY = (height - union.height * fit) / 2 - union.y * fit + view.panY;
  }
  const rect = (x, y, w, h) => ({ x: originX + x * scale, y: originY + y * scale, width: w * scale, height: h * scale });
  const sourceRect = rect(0, 0, source.width, source.height);
  const cropRect = rect(crop.x, crop.y, crop.width, crop.height);
  const outputRect = rect(crop.x - padding.left, crop.y - padding.top, padding.outputWidth, padding.outputHeight);
  return { source, crop, padding, scale, originX, originY, layout, sourceRect, cropRect, outputRect };
}

// The node preview sits in a DOM widget the graph scales with its zoom, so
// its backing store is sized for the zoom in play (capped) - the same
// sharpness core's canvas-drawn image previews get for free.
const PREVIEW_MAX_OVERSAMPLE = 4;
function panelOversample() {
  const zoom = Number(app.canvas?.ds?.scale) || 1;
  return clamp(zoom, 1, PREVIEW_MAX_OVERSAMPLE);
}

function prepareCanvas(canvas, oversample = 1) {
  const width = Math.max(1, canvas.clientWidth || 1); const height = Math.max(1, canvas.clientHeight || 1); const dpr = (window.devicePixelRatio || 1) * oversample;
  const pixelWidth = Math.round(width * dpr); const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
  const context = canvas.getContext("2d"); context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, width, height); return { context, width, height };
}

function draw(state) {
  state.syncQuickRow?.();
  state.syncCanvasRow?.();
  state.syncAspectChips?.();
  state.syncAspectMode?.();
  state.syncEditorControls?.();
  state.syncStitchControls?.();
  for (const canvas of [state.canvas, state.previewCanvas]) {
    if (!canvas) continue;
    const compact = canvas === state.previewCanvas;
    if (compact) state.panelOversample = panelOversample();
    const { context, width, height } = prepareCanvas(canvas, compact ? state.panelOversample : 1);
    if (!state.image || !state.sourceWidth || !state.sourceHeight) {
      if (compact) state.panelRender = null; else state.render = null;
      drawEmptyCanvas(context, width, height, "Choose a source to begin"); continue;
    }
    const frozen = state.drag?.canvas === canvas ? state.drag.map : null;
    const render = renderGeometry(state, width, height, compact ? PANEL_VIEW : state.view, frozen);
    if (compact) state.panelRender = render; else state.render = render;
    drawScene(context, state, render, compact, !compact || Boolean(state.panelInteractive));
  }
  drawFinalPreview(state);
}

function drawScene(context, state, render, compact, interactive) {
  const { sourceRect, cropRect, outputRect, padding } = render; context.save();
  context.fillStyle = normalizeColor(value(state.node, "fill_color", "#808080")); context.fillRect(outputRect.x, outputRect.y, outputRect.width, outputRect.height);
  context.save(); context.translate(sourceRect.x + sourceRect.width / 2, sourceRect.y + sourceRect.height / 2); context.rotate((Number(value(state.node, "rotation_degrees", 0)) || 0) * Math.PI / 180);
  drawSourceImage(context, state, render.scale); context.restore();
  context.save(); context.globalCompositeOperation = "source-over"; context.fillStyle = "rgba(8,10,12,.62)";
  const full = { x: 0, y: 0, width: context.canvas.width, height: context.canvas.height }; context.beginPath(); context.rect(full.x, full.y, full.width, full.height); context.rect(cropRect.x, cropRect.y, cropRect.width, cropRect.height); context.fill("evenodd"); context.restore();
  if (!compact && state.isClip && state.showBlend) drawBlendOverlay(context, state, render);
  context.strokeStyle = "#4bd8ef"; context.lineWidth = compact ? 1 : 2; context.setLineDash([7, 5]); context.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
  context.strokeStyle = "#ff9d42"; context.setLineDash([5, 5]); context.strokeRect(outputRect.x, outputRect.y, outputRect.width, outputRect.height); context.setLineDash([]);
  if (interactive) {
    if (state.grid) drawGrid(context, cropRect);
    drawCropHandles(context, cropRect, state.drag?.kind === "crop" ? state.drag.name : null);
    drawPaddingHandles(context, outputRect, render.layout.padOffset, state.drag?.kind === "padding" ? state.drag.name : null);
    drawRotationHandle(context, state, render, state.drag?.kind === "rotation");
    drawOutputSize(context, state, outputRect, padding);
  }
  context.restore();
}

// The output pixel size, drawn OUTSIDE the image: centered under the output
// rect's bottom edge, flipping above the top edge when the bottom would run
// off the stage - so it never sits on the pixels being judged. A resize
// budget appends its target so the readout names what the run will emit.
function drawOutputSize(context, state, outputRect, padding) {
  let text = `${padding.outputWidth} x ${padding.outputHeight}`;
  if (value(state.node, "resize_to_megapixels", false)) {
    const target = scaleToMegapixels(
      padding.outputWidth, padding.outputHeight,
      value(state.node, "megapixels", 1), value(state.node, "resolution_steps", 1),
    );
    text += `  →  ${target.width} x ${target.height}`;
  }
  context.save();
  context.font = "12px system-ui";
  const textWidth = context.measureText(text).width;
  const viewWidth = context.canvas.clientWidth || context.canvas.width;
  const viewHeight = context.canvas.clientHeight || context.canvas.height;
  const x = clamp(outputRect.x + outputRect.width / 2 - textWidth / 2, 6, Math.max(6, viewWidth - textWidth - 6));
  let y = outputRect.y + outputRect.height + 17;
  if (y > viewHeight - 6) y = Math.max(15, outputRect.y - 9);
  context.fillStyle = "rgba(8,10,12,0.8)";
  context.beginPath(); context.roundRect(x - 6, y - 12, textWidth + 12, 17, 6); context.fill();
  context.fillStyle = "#e9edf0";
  context.fillText(text, x, y);
  context.restore();
}

// Draws the current source frame centered on the (already translated and
// rotated) origin. During a scrub, the nearest storyboard tile stands in for
// the real frame until its decode lands.
function drawSourceImage(context, state, scale) {
  const width = state.sourceWidth * scale;
  const height = state.sourceHeight * scale;
  const storyboard = state.storyboard;
  if (state.scrubPreviewTile != null && storyboard) {
    context.drawImage(
      storyboard.image,
      state.scrubPreviewTile * storyboard.tileWidth, 0, storyboard.tileWidth, storyboard.tileHeight,
      -width / 2, -height / 2, width, height
    );
    return;
  }
  context.drawImage(state.image, -width / 2, -height / 2, width, height);
}

function drawGrid(context, rect) {
  context.save(); context.strokeStyle = "rgba(255,255,255,.35)"; context.lineWidth = 1;
  for (const fraction of [1 / 3, 1 / 2, 2 / 3]) {
    context.beginPath(); context.moveTo(rect.x + rect.width * fraction, rect.y); context.lineTo(rect.x + rect.width * fraction, rect.y + rect.height); context.stroke();
    context.beginPath(); context.moveTo(rect.x, rect.y + rect.height * fraction); context.lineTo(rect.x + rect.width, rect.y + rect.height * fraction); context.stroke();
  }
  context.restore();
}
function drawCropHandles(context, rect, active) {
  for (const handle of cropHandleCenters(rect)) { context.fillStyle = handle.name === active ? "#fff" : "#4bd8ef"; context.fillRect(handle.x - 6, handle.y - 6, 12, 12); context.strokeStyle = "#08272d"; context.strokeRect(handle.x - 6, handle.y - 6, 12, 12); }
}
function drawPaddingHandles(context, rect, offset, active) {
  for (const handle of paddingHandleCenters(rect, offset)) { context.save(); context.translate(handle.x, handle.y); context.rotate(Math.PI / 4); context.fillStyle = handle.name === active ? "#fff" : "#ff9d42"; context.fillRect(-8, -8, 16, 16); context.strokeStyle = "#3b2108"; context.strokeRect(-8, -8, 16, 16); context.restore(); }
}
// The knob rides the actual top-right corner of the image being rotated
// (the rotated quad's corner, not any bounding box), so it stays physically
// attached and orbits with the image as the angle changes - the same mental
// model as grabbing an object's corner in a design tool.
function rotationAnchor(state, render) {
  const angle = (Number(value(state.node, "rotation_degrees", 0)) || 0) * Math.PI / 180;
  const centerX = render.sourceRect.x + render.sourceRect.width / 2;
  const centerY = render.sourceRect.y + render.sourceRect.height / 2;
  const halfWidth = state.sourceWidth * render.scale / 2;
  const halfHeight = state.sourceHeight * render.scale / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Unrotated top-right corner (+hw, -hh) rotated about the image center.
  const corner = {
    x: centerX + halfWidth * cos + halfHeight * sin,
    y: centerY + halfWidth * sin - halfHeight * cos,
  };
  const length = Math.hypot(corner.x - centerX, corner.y - centerY) || 1;
  const direction = { x: (corner.x - centerX) / length, y: (corner.y - centerY) / length };
  const arm = render.layout?.rotateArm ?? 34;
  return { corner, handle: { x: corner.x + direction.x * arm, y: corner.y + direction.y * arm } };
}
function rotationHandle(state, render) {
  return rotationAnchor(state, render).handle;
}
function drawRotationHandle(context, state, render, active) {
  const { corner, handle } = rotationAnchor(state, render);
  context.strokeStyle = "#73e36a";
  context.beginPath(); context.moveTo(corner.x, corner.y); context.lineTo(handle.x, handle.y); context.stroke();
  context.fillStyle = active ? "#fff" : "#73e36a";
  context.beginPath(); context.arc(handle.x, handle.y, 13, 0, Math.PI * 2); context.fill();
  context.strokeStyle = "#173516"; context.stroke();
  drawRotateGlyph(context, handle.x, handle.y, 6, "#0c2210");
  if (!active) return;
  // Live readout while the knob is held, nudged to stay inside the stage.
  const degrees = Number(value(state.node, "rotation_degrees", 0)) || 0;
  const text = `${degrees.toFixed(1)}°`;
  context.save();
  context.font = "12px system-ui";
  const textWidth = context.measureText(text).width;
  const viewWidth = context.canvas.clientWidth || context.canvas.width;
  const viewHeight = context.canvas.clientHeight || context.canvas.height;
  const x = clamp(handle.x + 20, 8, Math.max(8, viewWidth - textWidth - 10));
  const y = clamp(handle.y - 20, 18, Math.max(18, viewHeight - 8));
  context.fillStyle = "rgba(8,10,12,0.85)";
  context.beginPath(); context.roundRect(x - 5, y - 13, textWidth + 10, 18, 6); context.fill();
  context.fillStyle = "#c9f2c4";
  context.fillText(text, x, y);
  context.restore();
}

// Vector rotate-arrow glyph (circular arc + arrowhead), crisp at any zoom
// and identical on every platform — no emoji font involved.
function drawRotateGlyph(context, x, y, radius, color) {
  const startAngle = -0.4 * Math.PI;
  const endAngle = 1.1 * Math.PI;
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 2;
  context.lineCap = "round";
  context.beginPath();
  context.arc(x, y, radius, startAngle, endAngle);
  context.stroke();
  // Arrowhead at the arc's end, pointing along the direction of travel.
  const tipBase = { x: x + radius * Math.cos(endAngle), y: y + radius * Math.sin(endAngle) };
  const tangent = { x: -Math.sin(endAngle), y: Math.cos(endAngle) };
  const normal = { x: Math.cos(endAngle), y: Math.sin(endAngle) };
  context.beginPath();
  context.moveTo(tipBase.x + tangent.x * 4.6, tipBase.y + tangent.y * 4.6);
  context.lineTo(tipBase.x - tangent.x * 1.2 + normal.x * 3.1, tipBase.y - tangent.y * 1.2 + normal.y * 3.1);
  context.lineTo(tipBase.x - tangent.x * 1.2 - normal.x * 3.1, tipBase.y - tangent.y * 1.2 - normal.y * 3.1);
  context.closePath();
  context.fill();
  context.restore();
}

// One wiring for both stages (editor canvas and compact panel): pointer
// capture starts on handle hits only, empty presses fall through so the
// node itself can still drag, and pointercancel plus mouseleave both end a
// gesture in case the capture was refused.
function attachStageHandlers(state, canvas, signal) {
  canvas.addEventListener("pointerdown", (event) => pointerDown(state, canvas, event), { signal });
  canvas.addEventListener("pointermove", (event) => pointerMove(state, canvas, event), { signal });
  canvas.addEventListener("pointerup", (event) => pointerUp(state, canvas, event), { signal });
  canvas.addEventListener("pointercancel", (event) => pointerUp(state, canvas, event), { signal });
  canvas.addEventListener("mouseleave", (event) => {
    if (state.drag?.canvas === canvas) pointerUp(state, canvas, event);
    else canvas.style.cursor = "default";
  }, { signal });
}

function surfaceRender(state, canvas) {
  return canvas === state.previewCanvas ? state.panelRender : state.render;
}

// The single hit-test order both surfaces share; hit radii are ~2-3x the
// drawn handle so handles stay grabbable on the compact panel.
function handleGroups(state, render) {
  return [
    { kind: "rotation", priority: 0, radius: 24, handles: [{ name: "rotation", ...rotationHandle(state, render) }] },
    { kind: "padding", priority: 1, radius: 24, handles: paddingHandleCenters(render.outputRect, render.layout.padOffset) },
    { kind: "crop", priority: 2, radius: 22, handles: cropHandleCenters(render.cropRect) },
  ];
}

function pointerDown(state, canvas, event) {
  if (state.drag) return;
  const render = surfaceRender(state, canvas);
  if (canvas === state.canvas && (event.button === 1 || event.altKey)) {
    state.drag = { kind: "pan", canvas, start: canvasLocalPoint(canvas, event), view: { ...state.view } };
  } else if (event.button === 0 && render) {
    const point = canvasLocalPoint(canvas, event);
    const selected = nearestHandle(point, handleGroups(state, render));
    const base = {
      canvas, start: point,
      // Everything a drag computes against, frozen at grab time (map plus
      // world snapshots) so a mid-gesture refit cannot move the target.
      map: { scale: render.scale, originX: render.originX, originY: render.originY, layout: render.layout },
      source: { ...render.source },
      center: { x: render.sourceRect.x + render.sourceRect.width / 2, y: render.sourceRect.y + render.sourceRect.height / 2 },
      crop: { ...render.crop },
      padding: { ...render.padding },
      rotation: Number(value(state.node, "rotation_degrees", 0)),
    };
    if (selected) state.drag = { ...selected, ...base };
    else if (inside(point, render.cropRect)) state.drag = { kind: "move", ...base };
  }
  // No hit: no capture and no preventDefault, so an empty press on the
  // panel falls through and the node drags as usual.
  if (!state.drag) return;
  event.preventDefault(); event.stopPropagation();
  try { canvas.setPointerCapture(event.pointerId); } catch { /* mouse fallback */ }
  state.grid = state.drag.kind === "rotation";
  draw(state);
}

function pointerMove(state, canvas, event) {
  const point = canvasLocalPoint(canvas, event);
  const drag = state.drag;
  if (!drag || drag.canvas !== canvas) { updateCursor(state, canvas, point); return; }
  event.preventDefault();
  const dxScreen = point.x - drag.start.x; const dyScreen = point.y - drag.start.y;
  if (drag.kind === "pan") { state.view.panX = drag.view.panX + dxScreen; state.view.panY = drag.view.panY + dyScreen; }
  else if (drag.kind === "rotation") {
    const startAngle = Math.atan2(drag.start.y - drag.center.y, drag.start.x - drag.center.x);
    const nextAngle = Math.atan2(point.y - drag.center.y, point.x - drag.center.x);
    let degrees = drag.rotation + (nextAngle - startAngle) * 180 / Math.PI;
    if (event.shiftKey) degrees = Math.round(degrees / 15) * 15;
    setValue(state.node, "rotation_degrees", Math.round(clamp(degrees, -180, 180) * 10) / 10);
    applyAspectLock(state, "x");
  } else if (drag.kind === "crop") {
    const ratio = parseAspectRatio(value(state.node, "crop_aspect_ratio", "free"), drag.source);
    const next = resizeCrop(drag.crop, drag.name, dxScreen / drag.map.scale, dyScreen / drag.map.scale, drag.source, ratio);
    setCrop(state.node, next);
    applyAspectLock(state, cropDriver(drag.crop, next, drag.name));
  } else if (drag.kind === "move") {
    const crop = drag.crop;
    setCrop(state.node, { ...crop, x: Math.round(clamp(crop.x + dxScreen / drag.map.scale, 0, drag.source.width - crop.width)), y: Math.round(clamp(crop.y + dyScreen / drag.map.scale, 0, drag.source.height - crop.height)) });
  } else if (drag.kind === "padding") {
    const delta = (drag.name === "pad_left" || drag.name === "pad_right" ? dxScreen : dyScreen) / drag.map.scale;
    const sign = drag.name === "pad_left" || drag.name === "pad_top" ? -1 : 1;
    let next = Math.max(0, Math.round(drag.padding[drag.name.replace("pad_", "")] + delta * sign));
    // Under a lock the handle stops where the other axis would need
    // negative padding; the other axis then follows.
    const ratio = lockRatio(state);
    if (ratio) next = Math.max(next, lockedPadMinimum(values(state.node), resolveCrop(values(state.node), drag.source), ratio, drag.name));
    setValue(state.node, drag.name, next);
    if (ratio) applyAspectLock(state, paddingAxis(drag.name));
  }
  draw(state); updateModalInfo(state);
}

function pointerUp(state, canvas, event) {
  const drag = state.drag;
  if (!drag || drag.canvas !== canvas) return;
  const kind = drag.kind;
  state.drag = null; state.grid = false;
  try { canvas.releasePointerCapture(event.pointerId); } catch {}
  draw(state); state.node.setDirtyCanvas?.(true, true);
  // Widgets were written throughout the drag; tell the tracker once, on
  // release. A pan only moves the view and serializes nothing.
  if (kind !== "pan") notifyAusbossChange();
}
function inside(point, rect) { return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height; }
function setCrop(node, crop) { setValue(node, "crop_x", crop.x); setValue(node, "crop_y", crop.y); setValue(node, "crop_width", crop.width); setValue(node, "crop_height", crop.height); }
function updateCursor(state, canvas, point) {
  const render = surfaceRender(state, canvas);
  if (!render) return;
  const selected = nearestHandle(point, handleGroups(state, render));
  canvas.style.cursor = selected?.kind === "rotation" ? "crosshair" : selected ? "grab" : inside(point, render.cropRect) ? "move" : "default";
}
function wheelZoom(state, event) { event.preventDefault(); const point = canvasLocalPoint(state.canvas, event); state.view = zoomAround(state.view, state.view.zoom * Math.exp(-event.deltaY * 0.0015), point); draw(state); }

function updateModalInfo(state) {
  if (!state.modal || !state.sourceWidth) return; const status = state.modal.querySelector("[data-ausboss-status]"); if (!status) return;
  const source = rotatedSize(state.sourceWidth, state.sourceHeight, value(state.node, "rotation_degrees", 0)); const crop = resolveCrop(values(state.node), source); const pad = resolvePadding(values(state.node), crop);
  const frame = state.kind === "video" ? `\nFrame ${value(state.node, "frame_index", 0)} at ${Number(value(state.node, "frame_time", 0)).toFixed(3)}s` : "";
  const stitch = state.isClip && widget(state.node, "stitch_blend") ? `\nStitch blend ${value(state.node, "stitch_blend", 32)} px${Number(value(state.node, "stitch_grow", 0)) ? `, grow ${value(state.node, "stitch_grow", 0)} px` : ""}` : "";
  let resized = "";
  if (value(state.node, "resize_to_megapixels", false)) {
    const target = scaleToMegapixels(
      pad.outputWidth, pad.outputHeight,
      value(state.node, "megapixels", 1), value(state.node, "resolution_steps", 1),
    );
    resized = `\nResized ${target.width} x ${target.height} (${(target.width * target.height / 1048576).toFixed(2)} MP)`;
  }
  status.textContent = `Source ${state.sourceWidth} x ${state.sourceHeight}\nRotated ${source.width} x ${source.height}\nCrop ${crop.x}, ${crop.y}, ${crop.width} x ${crop.height}\nOutput ${pad.outputWidth} x ${pad.outputHeight}${resized}${stitch}${frame}`;
}
function drawEmpty(state, text) { state.render = null; state.panelRender = null; for (const canvas of [state.canvas, state.previewCanvas]) { if (!canvas) continue; const prepared = prepareCanvas(canvas); drawEmptyCanvas(prepared.context, prepared.width, prepared.height, text); } }
function drawEmptyCanvas(context, width, height, text) { context.fillStyle = "#111"; context.fillRect(0, 0, width, height); context.fillStyle = "#9ba2aa"; context.font = "13px system-ui"; context.textAlign = "center"; context.fillText(text, width / 2, height / 2); context.textAlign = "left"; }

// True when the node is an AusBoss transform node whose editor can open
// (installed by installTransformNode). Used by the pack-wide command.
export function openTransformEditorForNode(node) {
  const state = node?.__ausbossTransformState;
  if (!state) return false;
  openEditor(state);
  return true;
}

export function disposeTransformNode(node) {
  const state = node.__ausbossTransformState; if (!state) return; state.disposed = true; closeEditor(state); state.panelAbort?.abort(); state.panelResizeObserver?.disconnect(); state.frameController?.abort(); if (state.frameObjectUrl) URL.revokeObjectURL(state.frameObjectUrl);
  if (node.__ausbossImgsSuppressed) {
    const descriptor = node.__ausbossImgsDescriptor;
    if (descriptor) Object.defineProperty(node, "imgs", descriptor); else delete node.imgs;
    if (node.__ausbossAddCustomWidget) node.addCustomWidget = node.__ausbossAddCustomWidget;
    delete node.__ausbossImgsSuppressed;
    delete node.__ausbossImgsDescriptor;
    delete node.__ausbossAddCustomWidget;
  }
  delete node.__ausbossTransformState;
}

export function registerTransformExtension(nodeClass, kind, mountPanel = null) {
  app.registerExtension({
    name: `ausboss.transform.${nodeClass}`,
    beforeRegisterNodeDef(nodeType, nodeData) {
      if (nodeData.name !== nodeClass) return;
      hideInputsInDef(nodeData, HIDDEN_WIDGETS);
      chainCallback(nodeType.prototype, "onNodeCreated", function () { installTransformNode(this, kind, mountPanel); });
      chainCallback(nodeType.prototype, "onRemoved", function () { disposeTransformNode(this); });
    },
  });
}
