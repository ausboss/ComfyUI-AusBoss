import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { chainCallback, notifyAusbossChange } from "../shared/index.mjs";
import { formatTimecode, parseTimecode } from "../shared/timecode.mjs";
import {
  mediaInfo,
  mediaViewQuery,
  responsivePreviewHeight,
  splitMediaName,
} from "../shared/video_preview.mjs";
import {
  VIDEO_MIN_WIDTH,
  applyVideoNodeColors,
  applyVideoNodeTitleColor,
  ensureVideoCss,
  hideCanvasWidget,
  makeToolButton,
  suppressCoreVideoPreview,
} from "../shared/video_ui.mjs";
import {
  MIN_TRIM_SECONDS,
  clampTrimSeek,
  closestTrimHandle,
  dragTrimHandle,
  playbackBoundaryAction,
  slideTrimWindow,
  trimBounds,
  trimFractions,
} from "./trim_preview.mjs";

const NODE_NAME = "AUSBOSS_NODES_LoadVideo";
const PREVIEW_WIDGET = "ausboss_load_video_viewer";
const PREVIEW_CHROME = 88;
const TRIM_EPSILON = 0.04;

function findWidget(node, name) {
  return node.widgets?.find((widget) => widget.name === name);
}

function roundHundredth(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getLoopEnabled(node) {
  node.properties ??= {};
  if (node.properties.ausboss_load_video_loop === undefined) {
    node.properties.ausboss_load_video_loop = true;
  }
  return !!node.properties.ausboss_load_video_loop;
}

function setEmpty(state, text) {
  state.stage.classList.add("is-empty");
  state.status.textContent = text;
}

function setReady(state, text) {
  state.stage.classList.remove("is-empty");
  state.status.textContent = text;
}

function currentBounds(state) {
  return trimBounds(state.video.duration, state.startWidget.value, state.endWidget.value);
}

function writeWidget(widget, value) {
  const next = roundHundredth(value);
  if (Math.abs(Number(widget.value || 0) - next) < 0.0001) return;
  widget.value = next;
  widget.callback?.(next);
}

function writeTrim(state, bounds, seekEdge = null) {
  state.writing = true;
  try {
    writeWidget(state.startWidget, bounds.start);
    writeWidget(state.endWidget, bounds.end);
  } finally {
    state.writing = false;
  }
  updateTrimFace(state);
  if (state.video.readyState >= 1 && seekEdge) {
    state.video.currentTime = seekEdge === "start"
      ? bounds.start
      : Math.max(bounds.start, bounds.end - TRIM_EPSILON);
  }
  state.node.setDirtyCanvas?.(true, true);
  state.node.graph?.setDirtyCanvas?.(true, true);
}

function updateTrimFace(state) {
  const duration = Number.isFinite(state.video.duration) ? state.video.duration : 0;
  const bounds = trimBounds(duration, state.startWidget.value, state.endWidget.value);
  const fractions = trimFractions(duration, bounds);
  const startPercent = fractions.start * 100;
  const endPercent = fractions.end * 100;
  state.selection.style.left = `${startPercent}%`;
  state.selection.style.width = `${Math.max(0, endPercent - startPercent)}%`;
  state.startHandle.style.left = `${startPercent}%`;
  state.endHandle.style.left = `${endPercent}%`;
  if (document.activeElement !== state.startInput) state.startInput.value = formatTimecode(bounds.start);
  if (document.activeElement !== state.endInput) state.endInput.value = formatTimecode(bounds.end);
  const selected = Math.max(0, bounds.end - bounds.start);
  state.durationLabel.textContent = duration > 0
    ? `${formatTimecode(selected)} of ${formatTimecode(duration)}`
    : "load a video to trim";
  state.status.textContent = duration > 0
    ? `${formatTimecode(bounds.start)} → ${formatTimecode(bounds.end)}`
    : state.status.textContent;
}

function installTrimDrag(state) {
  const { range } = state;
  const infoAt = (clientX) => {
    const rect = range.getBoundingClientRect();
    const duration = Number.isFinite(state.video.duration) ? state.video.duration : 0;
    const bounds = currentBounds(state);
    const fractions = trimFractions(duration, bounds);
    const x = clientX - rect.left;
    const hit = 10;
    let zone = "jump";
    const closest = closestTrimHandle(
      fractions.start,
      fractions.end,
      rect.width ? x / rect.width : 0,
      rect.width,
      hit,
    );
    if (closest) zone = closest;
    else if (x > fractions.start * rect.width && x < fractions.end * rect.width) zone = "move";
    return { rect, duration, bounds, fraction: rect.width ? x / rect.width : 0, zone };
  };

  range.addEventListener("pointermove", (event) => {
    if (state.dragging) return;
    const { zone } = infoAt(event.clientX);
    range.style.cursor = zone === "start" || zone === "end"
      ? "ew-resize"
      : zone === "move" ? "grab" : "pointer";
  });

  range.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || state.dragging) return;
    const initial = infoAt(event.clientX);
    if (initial.duration <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    state.dragging = true;
    try { range.setPointerCapture(event.pointerId); } catch (_error) { /* mouse fallback */ }
    const downX = event.clientX;
    const anchorTime = initial.fraction * initial.duration;
    let moved = false;

    const apply = (clientX) => {
      const next = infoAt(clientX);
      if (initial.zone === "start" || initial.zone === "end") {
        writeTrim(
          state,
          dragTrimHandle(next.duration, currentBounds(state), initial.zone, next.fraction),
          initial.zone,
        );
      } else if (initial.zone === "move") {
        const pointerTime = next.fraction * next.duration;
        writeTrim(
          state,
          slideTrimWindow(next.duration, initial.bounds, pointerTime - anchorTime),
          "start",
        );
      } else {
        const span = initial.bounds.end - initial.bounds.start;
        const centeredStart = next.fraction * next.duration - span / 2;
        writeTrim(
          state,
          slideTrimWindow(next.duration, initial.bounds, centeredStart - initial.bounds.start),
          "start",
        );
      }
    };

    const move = (moveEvent) => {
      if (!(moveEvent.buttons & 1)) { finish(moveEvent); return; }
      if (!moved && Math.abs(moveEvent.clientX - downX) < 3) return;
      moved = true;
      apply(moveEvent.clientX);
    };
    const finish = (finishEvent) => {
      if (!state.dragging) return;
      state.dragging = false;
      range.removeEventListener("pointermove", move);
      try { range.releasePointerCapture(event.pointerId); } catch (_error) { /* already released */ }
      if (!moved && initial.zone === "jump") {
        const next = infoAt(finishEvent?.clientX ?? downX);
        const span = initial.bounds.end - initial.bounds.start;
        const centeredStart = next.fraction * next.duration - span / 2;
        writeTrim(
          state,
          slideTrimWindow(next.duration, initial.bounds, centeredStart - initial.bounds.start),
          "start",
        );
      }
      // One notification per gesture, on release — never per pointermove.
      if (moved || initial.zone === "jump") notifyAusbossChange();
    };
    range.addEventListener("pointermove", move);
    range.addEventListener("pointerup", finish, { once: true });
    range.addEventListener("pointercancel", finish, { once: true });
    range.addEventListener("lostpointercapture", finish, { once: true });
  });
}

function installPlayback(state) {
  const { video } = state;
  const stopTick = () => {
    if (state.playRaf) cancelAnimationFrame(state.playRaf);
    state.playRaf = 0;
  };
  const tick = () => {
    if (video.paused || video.ended) { stopTick(); return; }
    const bounds = currentBounds(state);
    const action = playbackBoundaryAction(video.currentTime, bounds, getLoopEnabled(state.node), TRIM_EPSILON);
    if (action === "loop") {
      video.currentTime = bounds.start;
    } else if (action === "stop") {
      video.pause();
      video.currentTime = Math.max(bounds.start, bounds.end - TRIM_EPSILON);
      return;
    }
    state.playRaf = requestAnimationFrame(tick);
  };
  video.addEventListener("play", () => {
    const bounds = currentBounds(state);
    if (video.currentTime < bounds.start || video.currentTime >= bounds.end - TRIM_EPSILON) {
      video.currentTime = bounds.start;
    }
    stopTick();
    state.playRaf = requestAnimationFrame(tick);
  }, { signal: state.abort.signal });
  video.addEventListener("pause", stopTick, { signal: state.abort.signal });
  video.addEventListener("seeking", () => {
    if (state.correctingSeek) return;
    const target = clampTrimSeek(video.currentTime, currentBounds(state), TRIM_EPSILON);
    if (Math.abs(target - video.currentTime) < 0.001) return;
    state.correctingSeek = true;
    video.currentTime = target;
  }, { signal: state.abort.signal });
  video.addEventListener("seeked", () => { state.correctingSeek = false; }, { signal: state.abort.signal });
  state.stopTick = stopTick;
}

function watchTrimWidget(state, widget) {
  if (!widget || widget.__ausbossTrimWatch) return;
  widget.__ausbossTrimWatch = true;
  const prior = widget.callback;
  widget.callback = function (...args) {
    const result = prior?.apply(this, args);
    if (!state.writing) {
      updateTrimFace(state);
      const bounds = currentBounds(state);
      if (state.video.readyState >= 1) state.video.currentTime = bounds.start;
    }
    return result;
  };
}

function commitTimeInput(state, edge, input) {
  const duration = Number.isFinite(state.video.duration) ? state.video.duration : 0;
  if (duration <= 0) return;
  const seconds = parseTimecode(input.value);
  if (seconds === null) {
    // Malformed entry: restore the previous value and keep focus for a retry.
    const bounds = currentBounds(state);
    input.value = formatTimecode(edge === "start" ? bounds.start : bounds.end);
    return;
  }
  const fraction = seconds / duration;
  writeTrim(state, dragTrimHandle(duration, currentBounds(state), edge, fraction), edge);
  notifyAusbossChange();
  input.blur();
}

function buildPreview(node) {
  if (node.__ausbossLoadVideo) return node.__ausbossLoadVideo;
  const videoWidget = findWidget(node, "video");
  const startWidget = findWidget(node, "start_seconds");
  const endWidget = findWidget(node, "end_seconds");
  if (!videoWidget || !startWidget || !endWidget) return null;

  ensureVideoCss();
  applyVideoNodeColors(node);
  suppressCoreVideoPreview(node);
  hideCanvasWidget(startWidget);
  hideCanvasWidget(endWidget);

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
  status.textContent = "Choose or upload a video";
  const tools = document.createElement("div");
  tools.className = "ausboss-video-tools";
  const loopButton = makeToolButton("LOOP", "Loop playback inside the selected trim");
  const reloadButton = makeToolButton("↻", "Reload the selected source video");
  tools.append(loopButton, reloadButton);
  stage.append(video, status, tools);

  const trim = document.createElement("div");
  trim.className = "ausboss-video-trim";
  const range = document.createElement("div");
  range.className = "ausboss-video-range";
  range.title = "Drag either handle to set the trim; drag the selected range to move it";
  const selection = document.createElement("div");
  selection.className = "ausboss-video-selection";
  const startHandle = document.createElement("div");
  startHandle.className = "ausboss-video-handle";
  const endHandle = document.createElement("div");
  endHandle.className = "ausboss-video-handle";
  range.append(selection, startHandle, endHandle);
  const values = document.createElement("div");
  values.className = "ausboss-video-values";
  const makeValue = (labelText) => {
    const wrap = document.createElement("div");
    wrap.className = "ausboss-video-value";
    const label = document.createElement("label");
    label.textContent = labelText;
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.placeholder = "m:ss.s";
    input.title = `${labelText} point - type seconds (95.5) or a timecode (1:35.5, 1:02:03.5)`;
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") input.dispatchEvent(new Event("change"));
    });
    wrap.append(label, input);
    return { wrap, input };
  };
  const startValue = makeValue("IN");
  const endValue = makeValue("OUT");
  const durationLabel = document.createElement("div");
  durationLabel.className = "ausboss-video-duration";
  values.append(startValue.wrap, durationLabel, endValue.wrap);
  trim.append(range, values);
  root.append(stage, trim);

  const widget = node.addDOMWidget(PREVIEW_WIDGET, "ausboss_video", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => 200,
  });
  widget.computeSize = (width) => {
    const resolvedWidth = Math.max(VIDEO_MIN_WIDTH, Number(width || node.size?.[0] || 320));
    return [resolvedWidth, responsivePreviewHeight(resolvedWidth) + PREVIEW_CHROME];
  };
  widget.computeLayoutSize = () => ({ minWidth: VIDEO_MIN_WIDTH, minHeight: 200 });
  widget.options ??= {};
  widget.options.minNodeSize = [VIDEO_MIN_WIDTH, 310];

  const abort = new AbortController();
  const state = node.__ausbossLoadVideo = {
    node, root, stage, video, status, loopButton, reloadButton, trim, range,
    selection, startHandle, endHandle, startInput: startValue.input,
    endInput: endValue.input, durationLabel, videoWidget, startWidget, endWidget,
    widget, abort, writing: false, dragging: false, correctingSeek: false, playRaf: 0,
  };

  const updateLoopButton = () => loopButton.classList.toggle("active", getLoopEnabled(node));
  updateLoopButton();
  loopButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    node.properties.ausboss_load_video_loop = !getLoopEnabled(node);
    updateLoopButton();
    node.setDirtyCanvas?.(true, true);
    notifyAusbossChange();
  });

  const refresh = () => {
    const name = videoWidget.value;
    if (!name || typeof name !== "string") {
      video.pause();
      video.removeAttribute("src");
      setEmpty(state, "Choose or upload a video");
      updateTrimFace(state);
      return;
    }
    const parts = splitMediaName(name);
    setEmpty(state, `Loading ${parts.filename}…`);
    video.pause();
    video.src = api.apiURL(`/view?${mediaViewQuery({ ...parts, type: "input" }, "input")}`);
    video.load();
  };
  state.refresh = refresh;
  reloadButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    refresh();
  });

  video.addEventListener("loadedmetadata", () => {
    const bounds = currentBounds(state);
    if (bounds.end - bounds.start < MIN_TRIM_SECONDS && video.duration >= MIN_TRIM_SECONDS) {
      writeTrim(state, { start: Math.max(0, bounds.end - MIN_TRIM_SECONDS), end: bounds.end });
    }
    video.currentTime = currentBounds(state).start;
    setReady(state, `${formatTimecode(currentBounds(state).start)} → ${formatTimecode(currentBounds(state).end)}`);
    // Quiet source hint: resolution and duration from the loaded metadata.
    const sourceInfo = mediaInfo(null, video);
    durationLabel.title = sourceInfo ? `Source: ${sourceInfo}` : "";
    updateTrimFace(state);
    node.setDirtyCanvas?.(true, true);
  }, { signal: abort.signal });
  video.addEventListener("error", () => setEmpty(state, "Preview could not load this video"), { signal: abort.signal });

  installTrimDrag(state);
  installPlayback(state);
  watchTrimWidget(state, startWidget);
  watchTrimWidget(state, endWidget);
  startValue.input.addEventListener("change", () => commitTimeInput(state, "start", startValue.input));
  endValue.input.addEventListener("change", () => commitTimeInput(state, "end", endValue.input));

  const priorVideoCallback = videoWidget.callback;
  videoWidget.callback = function (...args) {
    const result = priorVideoCallback?.apply(this, args);
    refresh();
    return result;
  };

  setTimeout(refresh, 0);
  return state;
}

app.registerExtension({
  name: "ausboss.load_video.polished",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_NAME) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      buildPreview(this);
    });
    chainCallback(nodeType.prototype, "onConfigure", function () {
      queueMicrotask(() => {
        const state = buildPreview(this);
        if (state) {
          applyVideoNodeTitleColor(this);
          suppressCoreVideoPreview(this);
          state.refresh?.();
        }
      });
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      const state = this.__ausbossLoadVideo;
      state?.stopTick?.();
      state?.abort?.abort();
      this.__ausbossLoadVideo = null;
    });
  },
});
