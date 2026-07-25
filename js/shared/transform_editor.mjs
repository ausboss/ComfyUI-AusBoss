import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { BRAND, chainCallback } from "./index.mjs";
import {
  canvasLocalPoint,
  clamp,
  cropHandleCenters,
  nearestHandle,
  paddingHandleCenters,
  parseAspectRatio,
  resetTransformValues,
  resizeCrop,
  resolveCrop,
  resolvePadding,
  rotatedSize,
  sourceChanged,
  zoomAround,
} from "./transform_geometry.mjs";

const HIDDEN_WIDGETS = [
  "rotation_degrees", "crop_aspect_ratio", "crop_x", "crop_y", "crop_width", "crop_height",
  "pad_left", "pad_top", "pad_right", "pad_bottom", "feather", "canvas_multiple", "fill_color",
  "seek_mode", "frame_index", "frame_time",
];
const TRANSFORM_DEFAULTS = resetTransformValues(false);
const CORE_IMAGE_PREVIEW_WIDGET = "$$canvas-image-preview";

function installStyles() {
  if (document.getElementById("ausboss-transform-styles")) return;
  const style = document.createElement("style");
  style.id = "ausboss-transform-styles";
  style.textContent = `
    .ausboss-transform-panel{display:flex;flex-direction:column;gap:8px;padding:8px;color:#ddd;font:12px system-ui;box-sizing:border-box}
    .ausboss-transform-preview{width:100%;height:180px;border:1px solid #50555b;border-radius:8px;background:#111;display:block}
    .lg-node:has(.ausboss-transform-panel) .image-preview{display:none!important}
    .ausboss-transform-row{display:flex;gap:7px;align-items:center}.ausboss-transform-row>*{min-width:0;flex:1}
    .ausboss-transform-button,.ausboss-transform-modal button{background:#30343a;color:#eee;border:1px solid #555b63;border-radius:5px;padding:7px 10px;cursor:pointer}
    .ausboss-transform-button:hover,.ausboss-transform-modal button:hover{border-color:${BRAND};background:#383e44}
    .ausboss-transform-file{position:relative;text-align:center;overflow:hidden}.ausboss-transform-file input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}
    .ausboss-transform-modal{position:fixed;inset:0;z-index:100000;background:#101214;color:#e6e8ea;font:13px system-ui;display:grid;grid-template-rows:42px minmax(0,1fr) auto}
    .ausboss-transform-header{display:flex;align-items:center;gap:12px;padding:0 12px;border-bottom:1px solid #30343a;background:#17191c}
    .ausboss-transform-header strong{color:#fff}.ausboss-transform-header .spacer{flex:1}.ausboss-transform-close{border-color:${BRAND}!important}
    .ausboss-transform-body{display:grid;grid-template-columns:270px minmax(320px,1fr) 250px;min-height:0}
    .ausboss-transform-sidebar{padding:12px;border-right:1px solid #30343a;overflow:auto;background:#181b1e}
    .ausboss-transform-sidebar.right{border-right:0;border-left:1px solid #30343a}
    .ausboss-transform-section{border-bottom:1px solid #34383d;padding:0 0 13px;margin:0 0 13px}.ausboss-transform-section h3{font-size:11px;color:${BRAND};text-transform:uppercase;margin:0 0 8px}
    .ausboss-transform-section label{display:grid;grid-template-columns:88px 1fr 58px;gap:7px;align-items:center;margin:7px 0}
    .ausboss-transform-section input,.ausboss-transform-section select{box-sizing:border-box;width:100%;background:#0e1012;color:#eee;border:1px solid #454b52;border-radius:4px;padding:5px}
    .ausboss-transform-stage{position:relative;min-width:0;min-height:0;background-color:#0c0e10;background-image:radial-gradient(#292d31 1px,transparent 1px);background-size:18px 18px;overflow:hidden}
    .ausboss-transform-canvas{width:100%;height:100%;display:block;touch-action:none}
    .ausboss-transform-status{line-height:1.55;color:#b8bec5;white-space:pre-wrap}.ausboss-transform-help{line-height:1.55;color:#aeb4ba}
    .ausboss-transform-timeline{display:flex;align-items:center;gap:6px;padding:8px 12px;border-top:1px solid #30343a;background:#17191c}
    .ausboss-transform-timeline input[type=range]{flex:1}.ausboss-transform-steps{display:flex;gap:4px;flex-wrap:wrap}.ausboss-transform-steps button{padding:5px 7px}
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
function hideWidget(target) {
  if (!target || target.__ausbossHidden) return;
  target.__ausbossHidden = true;
  target.__ausbossComputeSize = target.computeSize;
  target.computeSize = () => [0, -4];
  target.options ??= {};
  target.options.hidden = true;
  target.hidden = true;
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
  const mode = value(node, "source_mode", "input folder");
  const selection = String(mode === "local path" ? value(node, "local_path", "") : value(node, "video", ""));
  // Empty selection is "no source yet": switching modes before picking a
  // file must not count as a source change (which would reset transforms).
  return selection ? `${mode === "local path" ? "local" : "input"}:${selection}` : "";
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

async function uploadVideo(node, file) {
  const body = new FormData();
  body.append("image", file, file.name);
  body.append("type", "input");
  const response = await api.fetchApi("/upload/image", { method: "POST", body });
  if (!response.ok) throw new Error((await response.text()) || "Video upload failed.");
  const result = await response.json();
  const selection = result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
  const target = widget(node, "video");
  if (target?.options?.values && !target.options.values.includes(selection)) target.options.values.push(selection);
  setValue(node, "source_mode", "input folder");
  setValue(node, "video", selection);
  return selection;
}

function resetTransform(node, includeTimeline = false) {
  for (const [name, next] of Object.entries(resetTransformValues(includeTimeline))) setValue(node, name, next);
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

export function installTransformNode(node, kind) {
  installStyles();
  const state = {
    node, kind, image: null, sourceWidth: 0, sourceHeight: 0, metadata: null,
    modal: null, canvas: null, previewCanvas: null, render: null, drag: null,
    view: { zoom: 1, panX: 0, panY: 0 }, grid: false, ready: false,
    source: sourceKey(node, kind), frameController: null, frameObjectUrl: null,
    playbackTimer: null, disposed: false, loadSerial: 0,
  };
  node.__ausbossTransformState = state;
  if (kind === "image") suppressCoreImagePreview(node);
  for (const name of HIDDEN_WIDGETS) hideWidget(widget(node, name));

  const panel = createElement("div", "ausboss-transform-panel");
  const preview = createElement("canvas", "ausboss-transform-preview");
  const row = createElement("div", "ausboss-transform-row");
  const open = createElement("button", "ausboss-transform-button", "Open editor");
  row.append(open);
  if (kind === "video") {
    const choose = createElement("label", "ausboss-transform-button ausboss-transform-file");
    choose.append(createElement("span", "", "Upload video"));
    const fileInput = createElement("input");
    fileInput.type = "file"; fileInput.accept = "video/*"; fileInput.setAttribute("aria-label", "Upload video");
    fileInput.addEventListener("change", async () => {
      if (!fileInput.files?.[0]) return;
      try { await uploadVideo(node, fileInput.files[0]); await onSourceChanged(state, true); }
      catch (error) { alert(`Video Crop + Rotate + Pad: ${error.message}`); }
      finally { fileInput.value = ""; }
    });
    choose.append(fileInput); row.prepend(choose);
  }
  panel.append(preview, row);
  state.previewCanvas = preview;
  open.addEventListener("click", () => openEditor(state));

  if (typeof node.addDOMWidget === "function") {
    const domWidget = node.addDOMWidget("ausboss_transform_preview", "ausboss_transform_preview", panel, { serialize: false });
    domWidget.computeSize = (width) => [Math.max(300, width), 230];
  } else {
    node.addWidget?.("button", "Open editor", null, () => openEditor(state), { serialize: false });
  }
  node.setSize?.([Math.max(330, Math.min(520, node.size?.[0] || 330)), kind === "video" ? 455 : 390]);

  const watched = kind === "image" ? ["image"] : ["video", "source_mode", "local_path"];
  for (const name of watched) {
    const target = widget(node, name);
    if (!target) continue;
    const prior = target.callback;
    target.callback = function (...args) {
      const result = prior?.apply(this, args);
      if (state.ready) onSourceChanged(state, true);
      return result;
    };
  }
  queueMicrotask(async () => {
    state.ready = true;
    await onSourceChanged(state, false);
  });
  return state;
}

async function onSourceChanged(state, reset) {
  const key = sourceKey(state.node, state.kind);
  if (reset && sourceChanged(state.source, key, state.ready)) {
    resetTransform(state.node, state.kind === "video");
    resetView(state);
  }
  state.source = key;
  await loadSource(state);
}

async function loadSource(state) {
  const serial = ++state.loadSerial;
  try {
    if (state.kind === "image") {
      const selection = value(state.node, "image", "");
      if (!selection) return;
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve; image.onerror = () => reject(new Error("Could not load image preview."));
        image.src = imageSourceUrl(selection);
      });
      if (serial !== state.loadSerial) return;
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
        state.storyboard = null; state.scrubPreviewTile = null;
        syncTimelineRange(state);
        requestStoryboard(state, key);
      }
      await loadVideoFrame(state, serial);
    }
    draw(state); updateModalInfo(state);
  } catch (error) {
    if (error?.name === "AbortError") return;
    state.image = null;
    drawEmpty(state, error.message);
  }
}

function syncTimelineRange(state) {
  if (!state.timelineSlider) return;
  state.timelineSlider.max = String(Math.max(0, (state.metadata?.frame_count || 1) - 1));
  if (state.timelineLabel) state.timelineLabel.textContent = `${state.timelineSlider.value} / ${state.timelineSlider.max}`;
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
  const moment = frameIndex / Math.max(1, state.metadata?.fps || 30);
  let tile = 0;
  for (let index = 0; index < storyboard.times.length; index += 1) {
    if (storyboard.times[index] <= moment) tile = index; else break;
  }
  state.scrubPreviewTile = tile;
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
    // Writing the decoded position back is only safe when the user is not
    // mid-scrub: a stale response overwriting frame_index would rubber-band
    // the slider to an older frame.
    if (syncWidgets) {
      const actualIndex = Number(response.headers.get("X-AusBoss-Frame-Index"));
      const actualTime = Number(response.headers.get("X-AusBoss-Frame-Time"));
      if (Number.isFinite(actualIndex)) setValue(state.node, "frame_index", actualIndex);
      if (Number.isFinite(actualTime)) setValue(state.node, "frame_time", actualTime);
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
  if (state.kind === "video") modal.append(buildTimeline(state));
  document.body.append(modal);

  const abort = new AbortController(); state.modalAbort = abort;
  close.addEventListener("click", () => closeEditor(state), { signal: abort.signal });
  canvas.addEventListener("pointerdown", (event) => pointerDown(state, event), { signal: abort.signal });
  canvas.addEventListener("pointermove", (event) => pointerMove(state, event), { signal: abort.signal });
  canvas.addEventListener("pointerup", (event) => pointerUp(state, event), { signal: abort.signal });
  canvas.addEventListener("pointercancel", (event) => pointerUp(state, event), { signal: abort.signal });
  canvas.addEventListener("wheel", (event) => wheelZoom(state, event), { signal: abort.signal, passive: false });
  window.addEventListener("keydown", (event) => keyDown(state, event), { signal: abort.signal });
  window.addEventListener("keyup", (event) => keyUp(state, event), { signal: abort.signal });
  state.resizeObserver = new ResizeObserver(() => draw(state)); state.resizeObserver.observe(stage);
  requestAnimationFrame(() => { resetView(state); draw(state); updateModalInfo(state); });
}

function closeEditor(state) {
  stopPlayback(state);
  state.scrubPending = false;
  state.modalAbort?.abort(); state.resizeObserver?.disconnect(); state.modal?.remove();
  state.modal = null; state.canvas = null; state.drag = null; state.grid = false;
  draw(state); state.node.setDirtyCanvas?.(true, true);
}

function buildControls(state, sidebar) {
  const node = state.node;
  const cropSection = createElement("section", "ausboss-transform-section"); cropSection.append(createElement("h3", "", "Crop"));
  const ratio = createElement("select");
  for (const optionValue of ["free", "source", "1:1", "9:16", "16:9", "2:3", "3:2", "3:4", "4:3", "9:21", "21:9"]) {
    const option = createElement("option", "", optionValue); option.value = optionValue; ratio.append(option);
  }
  ratio.value = value(node, "crop_aspect_ratio", "free"); ratio.addEventListener("change", () => { setValue(node, "crop_aspect_ratio", ratio.value); fitCrop(state); });
  addLabeledControl(cropSection, "Aspect", ratio);
  const fit = createElement("button", "", "Fit crop to source"); fit.addEventListener("click", () => fitCrop(state)); cropSection.append(fit);

  const rotateSection = createElement("section", "ausboss-transform-section"); rotateSection.append(createElement("h3", "", "Rotate"));
  const rotation = createElement("input"); rotation.type = "range"; rotation.min = "-180"; rotation.max = "180"; rotation.step = "0.1"; rotation.value = value(node, "rotation_degrees", 0);
  const rotationNumber = createElement("input"); rotationNumber.type = "number"; rotationNumber.min = "-180"; rotationNumber.max = "180"; rotationNumber.step = "0.1"; rotationNumber.value = rotation.value;
  rotation.addEventListener("input", () => { rotationNumber.value = rotation.value; setRotation(state, Number(rotation.value)); });
  rotationNumber.addEventListener("change", () => { rotation.value = rotationNumber.value; setRotation(state, Number(rotationNumber.value)); });
  addLabeledControl(rotateSection, "Degrees", rotation, ""); rotateSection.append(rotationNumber);
  const zeroRotation = createElement("button", "", "Reset rotation"); zeroRotation.addEventListener("click", () => { rotation.value = "0"; rotationNumber.value = "0"; setRotation(state, 0); }); rotateSection.append(zeroRotation);

  const padSection = createElement("section", "ausboss-transform-section"); padSection.append(createElement("h3", "", "Padding & mask"));
  const color = createElement("input"); color.type = "color"; color.value = normalizeColor(value(node, "fill_color", "#808080")); color.addEventListener("input", () => { setValue(node, "fill_color", color.value); draw(state); });
  addLabeledControl(padSection, "Fill", color);
  const feather = createElement("input"); feather.type = "range"; feather.min = "0"; feather.max = "512"; feather.step = "1"; feather.value = value(node, "feather", 0);
  const featherText = createElement("span", "", `${feather.value}px`); feather.addEventListener("input", () => { featherText.textContent = `${feather.value}px`; setValue(node, "feather", Number(feather.value)); });
  const featherLabel = addLabeledControl(padSection, "Feather", feather); featherLabel.lastElementChild.replaceWith(featherText);
  const multiple = createElement("input"); multiple.type = "number"; multiple.min = "1"; multiple.max = "4096"; multiple.step = "1"; multiple.value = value(node, "canvas_multiple", 1);
  multiple.addEventListener("change", () => { setValue(node, "canvas_multiple", Math.max(1, Number(multiple.value) || 1)); draw(state); });
  addLabeledControl(padSection, "Multiple", multiple, "px");
  const resetPad = createElement("button", "", "Reset padding"); resetPad.addEventListener("click", () => { for (const name of ["pad_left", "pad_top", "pad_right", "pad_bottom"]) setValue(node, name, 0); draw(state); }); padSection.append(resetPad);

  const actions = createElement("section", "ausboss-transform-section"); actions.append(createElement("h3", "", "View & reset"));
  const resetViewButton = createElement("button", "", "Reset view"); resetViewButton.addEventListener("click", () => { resetView(state); draw(state); });
  const resetAll = createElement("button", "", "Reset all"); resetAll.addEventListener("click", () => { resetTransform(node, state.kind === "video"); resetView(state); draw(state); updateModalInfo(state); });
  actions.append(resetViewButton, resetAll);
  sidebar.append(cropSection, rotateSection, padSection, actions);
}

function buildTimeline(state) {
  const node = state.node; const timeline = createElement("div", "ausboss-transform-timeline");
  const slider = createElement("input"); slider.type = "range"; slider.min = "0"; slider.max = String(Math.max(0, (state.metadata?.frame_count || 1) - 1)); slider.step = "1"; slider.value = value(node, "frame_index", 0);
  const label = createElement("span", "", "0 / 0");
  const steps = createElement("div", "ausboss-transform-steps");
  const commands = [["|<", "first"], ["-100", -100], ["-50", -50], ["-25", -25], ["-1", -1], ["Play", "play"], ["+1", 1], ["+25", 25], ["+50", 50], ["+100", 100], [">|", "last"]];
  for (const [text, command] of commands) {
    const button = createElement("button", "", text); if (command === "play") state.playButton = button;
    button.addEventListener("click", () => timelineCommand(state, command, slider, label)); steps.append(button);
  }
  const seek = () => {
    setValue(node, "seek_mode", "frame index"); setValue(node, "frame_index", Number(slider.value));
    setValue(node, "frame_time", Number(slider.value) / Math.max(1, state.metadata?.fps || 30));
    label.textContent = `${slider.value} / ${slider.max}`;
    showScrubGhost(state, Number(slider.value)); // instant, zero network
    requestScrubFrame(state);
  };
  slider.addEventListener("input", seek);
  // Drag release: one full-resolution fetch that snaps widgets to the frame
  // that was actually decoded.
  slider.addEventListener("change", () => seekFrame(state));
  state.timelineSlider = slider; state.timelineLabel = label;
  label.textContent = `${slider.value} / ${slider.max}`; timeline.append(slider, label, steps); return timeline;
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

async function timelineCommand(state, command, slider = state.timelineSlider, label = state.timelineLabel, light = false) {
  if (command === "play") { state.playbackTimer ? stopPlayback(state) : startPlayback(state); return; }
  const maximum = Math.max(0, Number(slider?.max) || (state.metadata?.frame_count || 1) - 1);
  let next = Number(value(state.node, "frame_index", 0));
  if (command === "first") next = 0; else if (command === "last") next = maximum; else next += Number(command);
  next = Math.round(clamp(next, 0, maximum));
  if (slider) slider.value = String(next); if (label) label.textContent = `${next} / ${maximum}`;
  setValue(state.node, "seek_mode", "frame index"); setValue(state.node, "frame_index", next);
  setValue(state.node, "frame_time", next / Math.max(1, state.metadata?.fps || 30));
  await (light ? seekFrameLight(state) : seekFrame(state));
}

function startPlayback(state) {
  state.playButton.textContent = "Pause";
  const delay = Math.max(20, Math.round(1000 / Math.max(1, state.metadata?.fps || 30)));
  const tick = async () => {
    if (!state.playbackTimer) return;
    const before = Number(value(state.node, "frame_index", 0)); await timelineCommand(state, 1, state.timelineSlider, state.timelineLabel, true);
    if (Number(value(state.node, "frame_index", 0)) === before) { stopPlayback(state); return; }
    state.playbackTimer = window.setTimeout(tick, delay);
  };
  state.playbackTimer = window.setTimeout(tick, delay);
}
function stopPlayback(state) {
  const wasPlaying = Boolean(state.playbackTimer);
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
    event.preventDefault(); timelineCommand(state, (event.shiftKey ? 10 : 1) * (event.key === "ArrowLeft" ? -1 : 1), state.timelineSlider, state.timelineLabel, true);
  }
}

function keyUp(state, event) {
  if (!state.modal || state.kind !== "video") return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") void seekFrame(state);
}

function fitCrop(state) {
  setValue(state.node, "crop_x", 0); setValue(state.node, "crop_y", 0); setValue(state.node, "crop_width", 0); setValue(state.node, "crop_height", 0); draw(state);
}
function setRotation(state, degrees) {
  setValue(state.node, "rotation_degrees", Math.round(clamp(degrees, -180, 180) * 10) / 10);
  fitCrop(state); draw(state); updateModalInfo(state);
}
function resetView(state) { state.view = { zoom: 1, panX: 0, panY: 0 }; }
function normalizeColor(value) { const text = String(value || "#808080"); return /^#[0-9a-f]{6}$/i.test(text) ? text : "#808080"; }

function renderGeometry(state, width, height) {
  const source = rotatedSize(state.sourceWidth, state.sourceHeight, value(state.node, "rotation_degrees", 0));
  const crop = resolveCrop(values(state.node), source); const padding = resolvePadding(values(state.node), crop);
  const margin = Math.max(12, Math.min(90, width * 0.1, height * 0.1)); const union = { x: Math.min(0, crop.x - padding.left), y: Math.min(0, crop.y - padding.top) };
  union.width = Math.max(source.width, crop.x - padding.left + padding.outputWidth) - union.x;
  union.height = Math.max(source.height, crop.y - padding.top + padding.outputHeight) - union.y;
  const fit = Math.max(0.01, Math.min((width - margin * 2) / union.width, (height - margin * 2) / union.height));
  const scale = fit * state.view.zoom;
  const originX = (width - union.width * fit) / 2 - union.x * fit + state.view.panX;
  const originY = (height - union.height * fit) / 2 - union.y * fit + state.view.panY;
  const rect = (x, y, w, h) => ({ x: originX + x * scale, y: originY + y * scale, width: w * scale, height: h * scale });
  const sourceRect = rect(0, 0, source.width, source.height);
  const cropRect = rect(crop.x, crop.y, crop.width, crop.height);
  const outputRect = rect(crop.x - padding.left, crop.y - padding.top, padding.outputWidth, padding.outputHeight);
  return { source, crop, padding, scale, originX, originY, sourceRect, cropRect, outputRect };
}

function prepareCanvas(canvas) {
  const width = Math.max(1, canvas.clientWidth || 1); const height = Math.max(1, canvas.clientHeight || 1); const dpr = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * dpr); const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
  const context = canvas.getContext("2d"); context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, width, height); return { context, width, height };
}

function draw(state) {
  for (const canvas of [state.canvas, state.previewCanvas]) {
    if (!canvas) continue;
    const { context, width, height } = prepareCanvas(canvas);
    if (!state.image || !state.sourceWidth || !state.sourceHeight) { drawEmptyCanvas(context, width, height, "Choose a source to begin"); continue; }
    const preview = canvas === state.previewCanvas; const render = renderGeometry(state, width, height); if (!preview) state.render = render;
    drawScene(context, state, render, preview);
  }
}

function drawScene(context, state, render, preview) {
  const { sourceRect, cropRect, outputRect, padding } = render; context.save();
  context.fillStyle = normalizeColor(value(state.node, "fill_color", "#808080")); context.fillRect(outputRect.x, outputRect.y, outputRect.width, outputRect.height);
  context.save(); context.translate(sourceRect.x + sourceRect.width / 2, sourceRect.y + sourceRect.height / 2); context.rotate((Number(value(state.node, "rotation_degrees", 0)) || 0) * Math.PI / 180);
  drawSourceImage(context, state, render.scale); context.restore();
  context.save(); context.globalCompositeOperation = "source-over"; context.fillStyle = "rgba(8,10,12,.62)";
  const full = { x: 0, y: 0, width: context.canvas.width, height: context.canvas.height }; context.beginPath(); context.rect(full.x, full.y, full.width, full.height); context.rect(cropRect.x, cropRect.y, cropRect.width, cropRect.height); context.fill("evenodd"); context.restore();
  context.strokeStyle = "#4bd8ef"; context.lineWidth = preview ? 1 : 2; context.setLineDash([7, 5]); context.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
  context.strokeStyle = "#ff9d42"; context.setLineDash([5, 5]); context.strokeRect(outputRect.x, outputRect.y, outputRect.width, outputRect.height); context.setLineDash([]);
  if (!preview) {
    if (state.grid) drawGrid(context, cropRect);
    drawCropHandles(context, cropRect, state.drag?.kind === "crop" ? state.drag.name : null);
    drawPaddingHandles(context, outputRect, state.drag?.kind === "padding" ? state.drag.name : null);
    drawRotationHandle(context, render, state.drag?.kind === "rotation");
    context.fillStyle = "#e9edf0"; context.font = "12px system-ui"; context.fillText(`${padding.outputWidth} x ${padding.outputHeight}`, outputRect.x + 8, outputRect.y + 18);
  }
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
function drawPaddingHandles(context, rect, active) {
  for (const handle of paddingHandleCenters(rect)) { context.save(); context.translate(handle.x, handle.y); context.rotate(Math.PI / 4); context.fillStyle = handle.name === active ? "#fff" : "#ff9d42"; context.fillRect(-8, -8, 16, 16); context.strokeStyle = "#3b2108"; context.strokeRect(-8, -8, 16, 16); context.restore(); }
}
// Top-right corner keeps the rotation control clear of the pad_top diamond
// that used to sit directly beneath it.
function rotationHandle(render) {
  return { x: render.sourceRect.x + render.sourceRect.width + 28, y: render.sourceRect.y - 28 };
}
function drawRotationHandle(context, render, active) {
  const handle = rotationHandle(render);
  const corner = { x: render.sourceRect.x + render.sourceRect.width, y: render.sourceRect.y };
  context.strokeStyle = "#73e36a";
  context.beginPath(); context.moveTo(corner.x, corner.y); context.lineTo(handle.x, handle.y); context.stroke();
  context.fillStyle = active ? "#fff" : "#73e36a";
  context.beginPath(); context.arc(handle.x, handle.y, 13, 0, Math.PI * 2); context.fill();
  context.strokeStyle = "#173516"; context.stroke();
  drawRotateGlyph(context, handle.x, handle.y, 6, "#0c2210");
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

function pointerDown(state, event) {
  if (event.button === 1 || event.altKey) { state.drag = { kind: "pan", start: canvasLocalPoint(state.canvas, event), view: { ...state.view } }; }
  else if (event.button === 0 && state.render) {
    const point = canvasLocalPoint(state.canvas, event); const rotate = rotationHandle(state.render);
    const selected = nearestHandle(point, [
      { kind: "rotation", priority: 0, radius: 24, handles: [{ name: "rotation", ...rotate }] },
      { kind: "padding", priority: 1, radius: 24, handles: paddingHandleCenters(state.render.outputRect) },
      { kind: "crop", priority: 2, radius: 22, handles: cropHandleCenters(state.render.cropRect) },
    ]);
    if (selected) state.drag = { ...selected, start: point, crop: { ...state.render.crop }, padding: { ...state.render.padding }, rotation: Number(value(state.node, "rotation_degrees", 0)) };
    else if (inside(point, state.render.cropRect)) state.drag = { kind: "move", start: point, crop: { ...state.render.crop } };
  }
  if (state.drag) { event.preventDefault(); event.stopPropagation(); state.canvas.setPointerCapture(event.pointerId); state.grid = state.drag.kind === "rotation"; draw(state); }
}

function pointerMove(state, event) {
  const point = canvasLocalPoint(state.canvas, event); if (!state.drag) { updateCursor(state, point); return; }
  event.preventDefault(); const dxScreen = point.x - state.drag.start.x; const dyScreen = point.y - state.drag.start.y;
  if (state.drag.kind === "pan") { state.view.panX = state.drag.view.panX + dxScreen; state.view.panY = state.drag.view.panY + dyScreen; }
  else if (state.drag.kind === "rotation") {
    const center = { x: state.render.sourceRect.x + state.render.sourceRect.width / 2, y: state.render.sourceRect.y + state.render.sourceRect.height / 2 };
    const startAngle = Math.atan2(state.drag.start.y - center.y, state.drag.start.x - center.x); const nextAngle = Math.atan2(point.y - center.y, point.x - center.x);
    let degrees = state.drag.rotation + (nextAngle - startAngle) * 180 / Math.PI; if (event.shiftKey) degrees = Math.round(degrees / 15) * 15; setValue(state.node, "rotation_degrees", Math.round(clamp(degrees, -180, 180) * 10) / 10);
  } else if (state.drag.kind === "crop") {
    const source = state.render.source; const ratio = parseAspectRatio(value(state.node, "crop_aspect_ratio", "free"), source);
    const crop = resizeCrop(state.drag.crop, state.drag.name, dxScreen / state.render.scale, dyScreen / state.render.scale, source, ratio); setCrop(state.node, crop);
  } else if (state.drag.kind === "move") {
    const crop = state.drag.crop; setCrop(state.node, { ...crop, x: Math.round(clamp(crop.x + dxScreen / state.render.scale, 0, state.render.source.width - crop.width)), y: Math.round(clamp(crop.y + dyScreen / state.render.scale, 0, state.render.source.height - crop.height)) });
  } else if (state.drag.kind === "padding") {
    const delta = (state.drag.name === "pad_left" || state.drag.name === "pad_right" ? dxScreen : dyScreen) / state.render.scale;
    const sign = state.drag.name === "pad_left" || state.drag.name === "pad_top" ? -1 : 1; setValue(state.node, state.drag.name, Math.max(0, Math.round(state.drag.padding[state.drag.name.replace("pad_", "")] + delta * sign)));
  }
  draw(state); updateModalInfo(state);
}

function pointerUp(state, event) { if (!state.drag) return; state.drag = null; state.grid = false; try { state.canvas.releasePointerCapture(event.pointerId); } catch {} draw(state); state.node.setDirtyCanvas?.(true, true); }
function inside(point, rect) { return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height; }
function setCrop(node, crop) { setValue(node, "crop_x", crop.x); setValue(node, "crop_y", crop.y); setValue(node, "crop_width", crop.width); setValue(node, "crop_height", crop.height); }
function updateCursor(state, point) {
  if (!state.render) return; const rotate = rotationHandle(state.render); const selected = nearestHandle(point, [
    { kind: "rotation", priority: 0, radius: 24, handles: [{ name: "rotation", ...rotate }] },
    { kind: "padding", priority: 1, radius: 24, handles: paddingHandleCenters(state.render.outputRect) },
    { kind: "crop", priority: 2, radius: 22, handles: cropHandleCenters(state.render.cropRect) },
  ]); state.canvas.style.cursor = selected?.kind === "rotation" ? "crosshair" : selected ? "grab" : inside(point, state.render.cropRect) ? "move" : "default";
}
function wheelZoom(state, event) { event.preventDefault(); const point = canvasLocalPoint(state.canvas, event); state.view = zoomAround(state.view, state.view.zoom * Math.exp(-event.deltaY * 0.0015), point); draw(state); }

function updateModalInfo(state) {
  if (!state.modal || !state.sourceWidth) return; const status = state.modal.querySelector("[data-ausboss-status]"); if (!status) return;
  const source = rotatedSize(state.sourceWidth, state.sourceHeight, value(state.node, "rotation_degrees", 0)); const crop = resolveCrop(values(state.node), source); const pad = resolvePadding(values(state.node), crop);
  const frame = state.kind === "video" ? `\nFrame ${value(state.node, "frame_index", 0)} at ${Number(value(state.node, "frame_time", 0)).toFixed(3)}s` : "";
  status.textContent = `Source ${state.sourceWidth} x ${state.sourceHeight}\nRotated ${source.width} x ${source.height}\nCrop ${crop.x}, ${crop.y}, ${crop.width} x ${crop.height}\nOutput ${pad.outputWidth} x ${pad.outputHeight}${frame}`;
}
function drawEmpty(state, text) { for (const canvas of [state.canvas, state.previewCanvas]) { if (!canvas) continue; const prepared = prepareCanvas(canvas); drawEmptyCanvas(prepared.context, prepared.width, prepared.height, text); } }
function drawEmptyCanvas(context, width, height, text) { context.fillStyle = "#111"; context.fillRect(0, 0, width, height); context.fillStyle = "#9ba2aa"; context.font = "13px system-ui"; context.textAlign = "center"; context.fillText(text, width / 2, height / 2); context.textAlign = "left"; }

export function disposeTransformNode(node) {
  const state = node.__ausbossTransformState; if (!state) return; state.disposed = true; closeEditor(state); state.frameController?.abort(); if (state.frameObjectUrl) URL.revokeObjectURL(state.frameObjectUrl);
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

export function registerTransformExtension(nodeClass, kind) {
  app.registerExtension({
    name: `ausboss.transform.${kind}`,
    beforeRegisterNodeDef(nodeType, nodeData) {
      if (nodeData.name !== nodeClass) return;
      chainCallback(nodeType.prototype, "onNodeCreated", function () { installTransformNode(this, kind); });
      chainCallback(nodeType.prototype, "onRemoved", function () { disposeTransformNode(this); });
    },
  });
}
