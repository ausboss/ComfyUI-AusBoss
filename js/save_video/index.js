import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { chainCallback, keepDomWidgetWidthAuto, notifyAusbossChange } from "../shared/index.mjs";
import { fillNodeHeight } from "../shared/panel_layout.mjs";
import { formatWidgetVisibility } from "../shared/save_video_formats.mjs";
import { setWidgetVisible } from "../shared/widget_visibility.mjs";
import {
  findVideoMetadata,
  mediaInfo,
  mediaViewQuery,
  responsivePreviewHeight,
} from "../shared/video_preview.mjs";
import {
  VIDEO_MIN_WIDTH,
  ensureVideoCss,
  makeToolButton,
  suppressCoreVideoPreview,
} from "../shared/video_ui.mjs";

const NODE_NAME = "AUSBOSS_NODES_SaveVideo";
const PREVIEW_WIDGET = "ausboss_save_video_viewer";
const PREVIEW_CHROME = 12;
// Height the node opens at. It used to fall out of the panel's computeSize;
// with the panel free to follow the node, the default has to be stated. Same
// 16:9-ish stage the width-derived formula produced, plus the widget rows.
const DEFAULT_NODE_SIZE = [
  380,
  responsivePreviewHeight(380, 132, 520) + PREVIEW_CHROME + 150,
];

// ComfyUI resolves %date:yyyy-MM-dd%-style tokens in filename_prefix only for
// its own save nodes. Serializing the widget through the core replacement
// utility opts this node in: tokens resolve at queue time while the stored
// workflow keeps the raw template. Without the utility the value passes
// through untouched.
function installFilenameTokens(node) {
  const prefix = node.widgets?.find((item) => item.name === "filename_prefix");
  if (!prefix || prefix.__ausbossTokenSerialize) return;
  prefix.__ausbossTokenSerialize = true;
  prefix.serializeValue = () => {
    const raw = String(prefix.value ?? "");
    const replace = window.comfyAPI?.utils?.applyTextReplacements;
    if (typeof replace !== "function") return raw;
    try {
      return replace(app, raw);
    } catch {
      return raw;
    }
  };
}

// Only the widgets the chosen format actually reads stay on the face: crf
// disappears for the formats with no quality number, save_metadata for the
// Pillow formats that cannot carry it. Hidden widgets keep their place and
// their serialized value (widget_visibility collapses rendering only), so
// widgets_values order never changes and switching back restores the number
// the user had. The preview stage fills the node's height, so freed rows go
// to it and no resize is needed.
function syncFormatWidgets(node) {
  const format = node.widgets?.find((item) => item.name === "format");
  if (!format) return;
  const wants = formatWidgetVisibility(String(format.value));
  let changed = false;
  for (const [name, visible] of Object.entries(wants)) {
    const target = node.widgets?.find((item) => item.name === name);
    if (target && setWidgetVisible(target, visible)) changed = true;
  }
  if (changed) node.setDirtyCanvas?.(true, true);
}

function watchFormatWidget(node) {
  const format = node.widgets?.find((item) => item.name === "format");
  if (!format || format.__ausbossFormatWatch) return;
  format.__ausbossFormatWatch = true;
  const prior = format.callback;
  format.callback = function (...args) {
    const result = prior?.apply(this, args);
    syncFormatWidgets(node);
    return result;
  };
}

function getLoopEnabled(node) {
  node.properties ??= {};
  if (node.properties.ausboss_save_video_loop === undefined) {
    node.properties.ausboss_save_video_loop = true;
  }
  return !!node.properties.ausboss_save_video_loop;
}

function setEmpty(state, text) {
  state.stage.classList.add("is-empty");
  state.status.textContent = text;
}

function setReady(state, text) {
  state.stage.classList.remove("is-empty");
  state.status.textContent = text;
}

// gif and webp are animated images, not video: a <video> element cannot play
// either, so the same saved file needs a different tag to preview at all.
const STILL_IMAGE_EXTENSIONS = new Set(["gif", "webp"]);

function isStillImage(filename) {
  return STILL_IMAGE_EXTENSIONS.has(String(filename).split(".").pop().toLowerCase());
}

function loadMetadata(state, meta) {
  if (!meta?.filename) {
    setEmpty(state, "No saved video was returned");
    return;
  }
  state.meta = { ...meta };
  setEmpty(state, `Loading ${meta.filename}…`);
  const url = api.apiURL(`/view?${mediaViewQuery(meta, "output")}`);
  const still = isStillImage(meta.filename);
  state.stage.classList.toggle("is-still", still);
  state.video.pause();
  if (still) {
    state.video.removeAttribute("src");
    state.image.src = url;
    return;
  }
  state.image.removeAttribute("src");
  state.video.src = url;
  state.video.load();
}

function buildPreview(node) {
  if (node.__ausbossSaveVideo) return node.__ausbossSaveVideo;
  ensureVideoCss();
  suppressCoreVideoPreview(node);

  const root = document.createElement("div");
  root.className = "ausboss-video-root";
  const stage = document.createElement("div");
  stage.className = "ausboss-video-stage is-empty";
  const video = document.createElement("video");
  video.controls = true;
  video.preload = "metadata";
  video.playsInline = true;
  const image = document.createElement("img");
  image.className = "ausboss-video-still";
  const status = document.createElement("div");
  status.className = "ausboss-video-status";
  status.textContent = "Run to preview the saved video";
  const tools = document.createElement("div");
  tools.className = "ausboss-video-tools";
  // No reload button: the preview is already the last saved file, so the
  // button only ever re-fetched what was on screen, and after a page reload
  // there is no saved file in memory for it to fetch at all.
  const loopButton = makeToolButton("LOOP", "Toggle looping for this saved preview");
  tools.append(loopButton);
  stage.append(video, image, status, tools);
  root.append(stage);

  const widget = node.addDOMWidget(PREVIEW_WIDGET, "ausboss_video", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => 132,
  });
  keepDomWidgetWidthAuto(widget);
  fillNodeHeight(widget, {
    minWidth: VIDEO_MIN_WIDTH,
    minHeight: 144,
    minNodeSize: [VIDEO_MIN_WIDTH, 270],
  });

  const abort = new AbortController();
  const state = node.__ausbossSaveVideo = {
    node, root, stage, video, image, status, tools, loopButton,
    widget, abort, meta: null,
  };
  const updateLoopButton = () => {
    const enabled = getLoopEnabled(node);
    video.loop = enabled;
    loopButton.classList.toggle("active", enabled);
  };
  updateLoopButton();

  loopButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    node.properties.ausboss_save_video_loop = !getLoopEnabled(node);
    updateLoopButton();
    node.setDirtyCanvas?.(true, true);
    notifyAusbossChange();
  });
  video.addEventListener("loadedmetadata", () => {
    setReady(state, mediaInfo(state.meta, video) || state.meta?.filename || "Preview ready");
    node.setDirtyCanvas?.(true, true);
  }, { signal: abort.signal });
  video.addEventListener("error", () => {
    // Only a genuine video failure: clearing src for a gif fires error too.
    if (video.getAttribute("src")) setEmpty(state, "Saved video preview could not load");
  }, { signal: abort.signal });
  image.addEventListener("load", () => {
    setReady(state, state.meta?.filename || "Preview ready");
    node.setDirtyCanvas?.(true, true);
  }, { signal: abort.signal });
  image.addEventListener("error", () => {
    if (image.getAttribute("src")) setEmpty(state, "Saved animation preview could not load");
  }, { signal: abort.signal });

  return state;
}

app.registerExtension({
  name: "ausboss.save_video.polished",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_NAME) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      buildPreview(this);
      installFilenameTokens(this);
      watchFormatWidget(this);
      syncFormatWidgets(this);
      // Only for a genuinely new node: onConfigure restores a saved size after
      // this runs, so a workflow's own dimensions still win.
      this.setSize?.([
        Math.max(DEFAULT_NODE_SIZE[0], this.size?.[0] ?? 0),
        Math.max(DEFAULT_NODE_SIZE[1], this.size?.[1] ?? 0),
      ]);
    });
    chainCallback(nodeType.prototype, "onConfigure", function () {
      queueMicrotask(() => {
        buildPreview(this);
        suppressCoreVideoPreview(this);
        // Restored widget values land after creation; re-sync visibility to
        // the loaded format without touching the values themselves.
        syncFormatWidgets(this);
      });
    });
    chainCallback(nodeType.prototype, "onExecuted", function (message) {
      const state = buildPreview(this);
      const meta = findVideoMetadata(message);
      if (state && meta) loadMetadata(state, meta);
      else if (state) setEmpty(state, "Execution finished without video metadata");
      app.canvas?.setDirty?.(true, true);
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      const state = this.__ausbossSaveVideo;
      state?.video?.pause();
      state?.abort?.abort();
      this.__ausbossSaveVideo = null;
    });
  },
});
