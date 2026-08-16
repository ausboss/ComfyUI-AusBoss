import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { chainCallback, keepDomWidgetWidthAuto, notifyAusbossChange } from "../shared/index.mjs";
import {
  findVideoMetadata,
  mediaInfo,
  mediaViewQuery,
  responsivePreviewHeight,
} from "../shared/video_preview.mjs";
import {
  VIDEO_MIN_WIDTH,
  applyVideoNodeColors,
  applyVideoNodeTitleColor,
  ensureVideoCss,
  makeToolButton,
  suppressCoreVideoPreview,
} from "../shared/video_ui.mjs";

const NODE_NAME = "AUSBOSS_NODES_SaveVideo";
const PREVIEW_WIDGET = "ausboss_save_video_viewer";
const PREVIEW_CHROME = 12;

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

function loadMetadata(state, meta) {
  if (!meta?.filename) {
    setEmpty(state, "No saved video was returned");
    return;
  }
  state.meta = { ...meta };
  setEmpty(state, `Loading ${meta.filename}…`);
  state.video.pause();
  state.video.src = api.apiURL(`/view?${mediaViewQuery(meta, "output")}`);
  state.video.load();
}

function buildPreview(node) {
  if (node.__ausbossSaveVideo) return node.__ausbossSaveVideo;
  ensureVideoCss();
  applyVideoNodeColors(node);
  suppressCoreVideoPreview(node);

  const root = document.createElement("div");
  root.className = "ausboss-video-root";
  const stage = document.createElement("div");
  stage.className = "ausboss-video-stage is-empty";
  const video = document.createElement("video");
  video.controls = true;
  video.preload = "metadata";
  video.playsInline = true;
  const status = document.createElement("div");
  status.className = "ausboss-video-status";
  status.textContent = "Run to preview the saved video";
  const tools = document.createElement("div");
  tools.className = "ausboss-video-tools";
  const loopButton = makeToolButton("LOOP", "Toggle looping for this saved preview");
  const reloadButton = makeToolButton("↻", "Reload the last saved preview");
  tools.append(loopButton, reloadButton);
  stage.append(video, status, tools);
  root.append(stage);

  const widget = node.addDOMWidget(PREVIEW_WIDGET, "ausboss_video", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => 132,
  });
  keepDomWidgetWidthAuto(widget);
  widget.computeSize = (width) => {
    const resolvedWidth = Math.max(VIDEO_MIN_WIDTH, Number(width || node.size?.[0] || 360));
    return [resolvedWidth, responsivePreviewHeight(resolvedWidth, 132, 520) + PREVIEW_CHROME];
  };
  widget.computeLayoutSize = () => ({ minWidth: VIDEO_MIN_WIDTH, minHeight: 144 });
  widget.options ??= {};
  widget.options.minNodeSize = [VIDEO_MIN_WIDTH, 270];

  const abort = new AbortController();
  const state = node.__ausbossSaveVideo = {
    node, root, stage, video, status, tools, loopButton, reloadButton,
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
  reloadButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (state.meta) loadMetadata(state, state.meta);
    else setEmpty(state, "Run once before reloading a preview");
  });
  video.addEventListener("loadedmetadata", () => {
    setReady(state, mediaInfo(state.meta, video) || state.meta?.filename || "Preview ready");
    node.setDirtyCanvas?.(true, true);
  }, { signal: abort.signal });
  video.addEventListener("error", () => setEmpty(state, "Saved video preview could not load"), {
    signal: abort.signal,
  });

  return state;
}

app.registerExtension({
  name: "ausboss.save_video.polished",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_NAME) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      buildPreview(this);
      installFilenameTokens(this);
    });
    chainCallback(nodeType.prototype, "onConfigure", function () {
      queueMicrotask(() => {
        buildPreview(this);
        applyVideoNodeTitleColor(this);
        suppressCoreVideoPreview(this);
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
