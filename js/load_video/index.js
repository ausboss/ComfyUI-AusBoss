import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { BRAND, chainCallback } from "../shared/index.mjs";
import {
  clampTrimSeek,
  responsivePreviewHeight,
  shouldLoopTrim,
  trimBounds,
} from "./trim_preview.mjs";

// Compact preview player for Load Video (AusBoss) with two playhead-capture
// buttons that fill start_seconds / end_seconds — the node's whole point.

const NODE_NAME = "AUSBOSS_NODES_LoadVideo";
const CORE_VIDEO_PREVIEW_WIDGET = "video-preview";
const PREVIEW_MIN_WIDTH = 180;
const TRIM_EPSILON = 0.04;

function findWidget(node, name) {
  return node.widgets?.find((widget) => widget.name === name);
}

function trimLabel(bounds) {
  const end = Number.isFinite(bounds.end) ? `${bounds.end.toFixed(2)}s` : "source end";
  return `Trim preview  ${bounds.start.toFixed(2)}s → ${end}`;
}

function installTrimPlayback(node, video, container, startWidget, endWidget) {
  let label = container.querySelector(".ausboss-trim-preview-label");
  if (!label) {
    label = document.createElement("div");
    label.className = "ausboss-trim-preview-label";
    label.style.cssText =
      "position:absolute;left:6px;top:6px;z-index:2;padding:2px 5px;" +
      "border-radius:3px;background:#111c;color:#ddd;font-size:10px;pointer-events:none;";
    container.appendChild(label);
  }
  if (video.__ausbossTrimOwner === node) {
    video.__ausbossUpdateTrimPreview?.(false);
    return;
  }

  video.__ausbossTrimAbort?.abort();
  const abort = new AbortController();
  video.__ausbossTrimAbort = abort;
  video.__ausbossTrimOwner = node;
  video.loop = false;
  video.playsInline = true;
  video.style.cssText +=
    "width:100%;height:100%;min-height:0;max-height:none;object-fit:contain;";

  let correctingSeek = false;
  const bounds = () => trimBounds(video.duration, startWidget.value, endWidget.value);
  const update = (reset = false) => {
    const window = bounds();
    label.textContent = trimLabel(window);
    if (video.readyState < 1 || !Number.isFinite(video.duration)) return window;
    const outside =
      video.currentTime < window.start - TRIM_EPSILON ||
      (Number.isFinite(window.end) && video.currentTime >= window.end - TRIM_EPSILON);
    if (reset || outside) video.currentTime = window.start;
    return window;
  };
  video.__ausbossUpdateTrimPreview = update;
  node.__ausbossTrimPreviewVideo = video;

  video.addEventListener("loadedmetadata", () => update(true), { signal: abort.signal });
  video.addEventListener("durationchange", () => update(false), { signal: abort.signal });
  video.addEventListener("play", () => {
    const window = update(false);
    if (window.end <= window.start) video.pause();
  }, { signal: abort.signal });
  video.addEventListener("seeking", () => {
    if (correctingSeek) return;
    const target = clampTrimSeek(video.currentTime, bounds(), TRIM_EPSILON);
    if (Math.abs(target - video.currentTime) < 0.001) return;
    correctingSeek = true;
    video.currentTime = target;
  }, { signal: abort.signal });
  video.addEventListener("seeked", () => {
    correctingSeek = false;
  }, { signal: abort.signal });
  const loop = () => {
    const window = bounds();
    if (!shouldLoopTrim(video.currentTime, window, TRIM_EPSILON)) return;
    const wasPlaying = !video.paused;
    video.currentTime = window.start;
    if (wasPlaying) video.play().catch(() => {});
  };
  video.addEventListener("timeupdate", loop, { signal: abort.signal });
  video.addEventListener("ended", () => {
    const window = bounds();
    video.currentTime = window.start;
  }, { signal: abort.signal });
  update(true);
}

function prepareNativeTrimPreview(node, widget, container, startWidget, endWidget) {
  if (!widget || !container) return;
  const computeHeight = (width) => responsivePreviewHeight(width || node.size?.[0]);
  widget.computeSize = (width) => [Math.max(PREVIEW_MIN_WIDTH, width || 0), computeHeight(width)];
  widget.computeLayoutSize = () => ({ minHeight: 96, minWidth: PREVIEW_MIN_WIDTH });
  widget.options ??= {};
  widget.options.minNodeSize = [PREVIEW_MIN_WIDTH, 96];
  container.style.cssText +=
    "position:relative;width:100%;height:100%;min-height:96px;overflow:hidden;";

  const adapt = () => {
    const video = container.querySelector("video");
    if (video) installTrimPlayback(node, video, container, startWidget, endWidget);
  };
  if (!container.__ausbossTrimObserver) {
    container.__ausbossTrimObserver = new MutationObserver(() => queueMicrotask(adapt));
    container.__ausbossTrimObserver.observe(container, { childList: true });
  }
  adapt();
  node.__ausbossNativeTrimContainer = container;
}

function installNativeTrimPreviewHook(node, startWidget, endWidget) {
  if (node.__ausbossNativeTrimHook) return;
  node.__ausbossNativeTrimHook = true;
  const priorAddDOMWidget = node.addDOMWidget;
  if (typeof priorAddDOMWidget === "function") {
    node.addDOMWidget = function (name, type, element, options) {
      const widget = priorAddDOMWidget.call(this, name, type, element, options);
      if (name === CORE_VIDEO_PREVIEW_WIDGET) {
        queueMicrotask(() => prepareNativeTrimPreview(
          this, widget, element, startWidget, endWidget
        ));
      }
      return widget;
    };
  }

  const existing = findWidget(node, CORE_VIDEO_PREVIEW_WIDGET);
  if (existing) {
    queueMicrotask(() => prepareNativeTrimPreview(
      node, existing, existing.element || node.videoContainer, startWidget, endWidget
    ));
  }
  chainCallback(node, "onRemoved", function () {
    this.__ausbossNativeTrimContainer?.__ausbossTrimObserver?.disconnect();
    this.__ausbossTrimPreviewVideo?.__ausbossTrimAbort?.abort();
  });
}

function watchTrimWidget(node, widget) {
  if (!widget || widget.__ausbossTrimWatched) return;
  widget.__ausbossTrimWatched = true;
  const priorCallback = widget.callback;
  widget.callback = function (...args) {
    const result = priorCallback?.apply(this, args);
    node.__ausbossTrimPreviewVideo?.__ausbossUpdateTrimPreview?.(true);
    node.setDirtyCanvas?.(true, true);
    return result;
  };
}

function buildPreview(node) {
  const videoWidget = findWidget(node, "video");
  const startWidget = findWidget(node, "start_seconds");
  const endWidget = findWidget(node, "end_seconds");
  if (!videoWidget || !startWidget || !endWidget) return;
  installNativeTrimPreviewHook(node, startWidget, endWidget);
  watchTrimWidget(node, startWidget);
  watchTrimWidget(node, endWidget);

  const container = document.createElement("div");
  container.style.cssText =
    "display:flex;flex-direction:column;gap:4px;padding:2px 0;width:100%;";

  const sourceLabel = document.createElement("div");
  sourceLabel.textContent = "Source preview — scrub to choose trim points";
  sourceLabel.style.cssText = "color:#aaa;font-size:10px;text-align:center;line-height:12px;";
  container.appendChild(sourceLabel);

  const videoElement = document.createElement("video");
  videoElement.controls = true;
  videoElement.muted = true;
  videoElement.preload = "metadata";
  videoElement.style.cssText =
    "width:100%;height:140px;min-height:0;max-height:220px;object-fit:contain;" +
    "background:#111;border-radius:4px;";
  container.appendChild(videoElement);

  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:4px;";
  const makeButton = (label, onClick) => {
    const button = document.createElement("button");
    button.textContent = label;
    button.style.cssText =
      `flex:1;padding:3px 0;border:1px solid ${BRAND};border-radius:4px;` +
      `background:transparent;color:${BRAND};cursor:pointer;font-size:11px;`;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    row.appendChild(button);
    return button;
  };
  const capture = (widget) => {
    if (!videoElement.duration) return;
    widget.value = Math.round(videoElement.currentTime * 100) / 100;
    widget.callback?.(widget.value);
    node.setDirtyCanvas(true, true);
  };
  makeButton("⏱ set start", () => capture(startWidget));
  makeButton("⏱ set end", () => capture(endWidget));
  container.appendChild(row);

  const previewWidget = node.addDOMWidget("ausboss_video_preview", "preview", container, {
    serialize: false,
    hideOnZoom: false,
  });
  const resizeSourcePreview = (width) => {
    const height = responsivePreviewHeight(width || node.size?.[0]);
    videoElement.style.height = `${height}px`;
    return height;
  };
  previewWidget.computeSize = (width) => [
    Math.max(PREVIEW_MIN_WIDTH, width || 0),
    resizeSourcePreview(width) + 42,
  ];
  previewWidget.computeLayoutSize = () => ({
    minHeight: resizeSourcePreview(node.size?.[0]) + 42,
    minWidth: PREVIEW_MIN_WIDTH,
  });
  chainCallback(node, "onResize", function (size) {
    resizeSourcePreview(size?.[0]);
  });

  const refresh = () => {
    const name = videoWidget.value;
    if (!name || typeof name !== "string") return;
    const [subfolder, file] = name.includes("/")
      ? [name.slice(0, name.lastIndexOf("/")), name.slice(name.lastIndexOf("/") + 1)]
      : ["", name];
    videoElement.src = api.apiURL(
      `/view?filename=${encodeURIComponent(file)}&type=input&subfolder=${encodeURIComponent(subfolder)}&t=${Date.now()}`
    );
  };
  const priorCallback = videoWidget.callback;
  videoWidget.callback = function (...args) {
    const result = priorCallback?.apply(this, args);
    refresh();
    return result;
  };
  // setTimeout, not requestAnimationFrame: rAF never fires in background
  // tabs, which would leave workflows loaded there with a blank preview.
  setTimeout(refresh, 0);
}

app.registerExtension({
  name: "ausboss.load_video",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_NAME) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      buildPreview(this);
    });
  },
});
