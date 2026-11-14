import { api } from "../../../scripts/api.js";
import { app } from "../../../scripts/app.js";
import { chainCallback, keepDomWidgetWidthAuto, notifyAusbossChange } from "../shared/index.mjs";
import { WIDGET_FRAME, fillNodeHeight } from "../shared/panel_layout.mjs";
import { inputNumber } from "../shared/clip_rate.mjs";
import { clipInfo, windowSeconds } from "../shared/timeline_math.mjs";
import { mountTransformTrim } from "../shared/transform_trim.mjs";
import { linkedNodeInfo, timingUnits } from "../shared/timing_links.mjs";
import { parseImageReference } from "../shared/pad_canvas.mjs";
import {
  mediaInfo,
  mediaViewQuery,
  responsivePreviewHeight,
  splitMediaName,
} from "../shared/video_preview.mjs";
import {
  VIDEO_MIN_WIDTH,
  ensureVideoCss,
  hideCanvasWidget,
  makeToolButton,
  suppressCoreVideoPreview,
} from "../shared/video_ui.mjs";
import {
  clampTrimSeek,
  playbackBoundaryAction,
  singleFrameTime,
  trimAfterFramePick,
  trimBounds,
} from "./trim_preview.mjs";

const NODE_NAME = "AUSBOSS_NODES_LoadVideo";
const PREVIEW_WIDGET = "ausboss_load_video_viewer";
const PREVIEW_CHROME = 88;
// 8px root padding + the stage's 112px floor + 6px gap + the 152px timing
// card (js/shared/transform_trim.mjs). The declared floor adds WIDGET_FRAME
// on top, or the element comes up short and clips the card's bottom border
// at the node's minimum height.
const PANEL_MIN_HEIGHT = 278;
// Height the node opens at. It used to fall out of the panel's computeSize;
// with the panel free to follow the node, the default has to be stated. The
// chrome covers the transport row and the trim strip under the player.
const DEFAULT_NODE_SIZE = [380, responsivePreviewHeight(380) + PREVIEW_CHROME + 210];
const TRIM_EPSILON = 0.04;

function findWidget(node, name) {
  return node.widgets?.find((widget) => widget.name === name);
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
  state.status.hidden = false;
}

function setReady(state, text) {
  state.stage.classList.remove("is-empty");
  state.status.textContent = text;
  state.status.hidden = !text;
}

// The run's window in seconds, as the timing card works it out (Start, and
// the Duration or the end), or the plain start/end before the video's frame
// rate is known.
function currentBounds(state) {
  const info = clipInfo(state.metadata);
  const window = state.card?.window?.();
  if (info.fps > 0 && window && Number.isFinite(window.first)) {
    const last = Number.isFinite(window.last) ? window.last : info.count - 1;
    return { start: window.first / info.fps, end: Math.min(info.duration || Infinity, (last + 1) / info.fps) };
  }
  return trimBounds(state.video.duration, state.startWidget.value, state.endWidget.value);
}

function isSingleFrame(state) {
  return !!state.frameWidget?.value;
}

// Where the preview belongs for the current mode: the chosen frame, or the
// clip's start.
function homeTime(state) {
  return isSingleFrame(state)
    ? singleFrameTime(state.video.duration, state.startWidget.value)
    : currentBounds(state).start;
}

function widgetLinkDriven(node, name) {
  return !!node.inputs?.some((input) => input?.widget?.name === name && input.link != null);
}

// Frame rate and the real frame count come from the pack's metadata route:
// the <video> element knows neither, and its length rounds up a frame.
// Fail-soft: without it the card waits for a source.
async function probeMetadata(state, name) {
  state.metadata = null;
  try {
    const query = new URLSearchParams({ source_mode: "input folder", video: name });
    const type = parseImageReference(name)?.type;
    if (type && type !== "input") {
      query.set("source_mode", "local path");
      query.set("local_path", name);
    }
    const response = await api.fetchApi(`/ausboss/transform/video/metadata?${query}`);
    if (!response.ok) return;
    const metadata = await response.json();
    if (state.videoWidget.value !== name) return; // a newer selection won
    state.metadata = metadata;
    state.card?.sync();
  } catch (_error) {
    /* no metadata, no timing card numbers */
  }
}

function setWidget(widget, value) {
  if (!widget) return;
  if (widget.value === value) return;
  widget.value = value;
  widget.callback?.(value);
}

// The timing card: the clip node's own, with Start, Duration and Ends at,
// or, while FRAME is on, its frame picker. The player above it is the
// picture, so the card leaves out its own Play button.
function mountCard(state) {
  const { node } = state;
  const widgetFor = (name) => node.widgets?.find((widget) => widget.name === name);
  const fps = () => clipInfo(state.metadata).fps;
  const single = isSingleFrame(state);
  const card = mountTransformTrim({
    get: (name, fallback) => {
      if (name === "frame_index") return state.head ?? 0;
      const widget = widgetFor(name);
      return widget ? widget.value : fallback;
    },
    set: (name, value) => {
      state.writing = true;
      try { setWidget(widgetFor(name), value); } finally { state.writing = false; }
      if (state.video.readyState >= 1 && !state.video.paused) return;
      node.setDirtyCanvas?.(true, true);
    },
    has: (name) => Boolean(widgetFor(name)),
    driven: (name) => widgetLinkDriven(node, name),
    number: (name, fallback) => inputNumber(node, name, fallback),
    metadata: () => state.metadata,
    trim: !single,
    play: false,
    isPlaying: () => !state.video.paused,
    onTogglePlayback: () => {},
    onSeek: (frame, settled) => {
      state.head = frame;
      const rate = fps();
      if (single && rate > 0) {
        state.writing = true;
        try { setWidget(state.startWidget, windowSeconds(clipInfo(state.metadata), frame, frame).start_seconds); } finally { state.writing = false; }
      }
      if (state.video.readyState >= 1 && rate > 0) state.video.currentTime = Math.min(state.video.duration || Infinity, (frame + 0.5) / rate);
      if (settled) notifyAusbossChange();
    },
    onCommit: notifyAusbossChange,
    linkInfo: (name) => linkedNodeInfo(node, name),
    units: () => timingUnits(),
    setUnits: (next) => timingUnits(next),
  });
  state.card?.root.remove();
  state.card = card;
  state.cardSlot.append(card.root);
  return card;
}

function applyMode(state) {
  const single = isSingleFrame(state);
  state.root.classList.toggle("is-single-frame", single);
  state.frameButton?.classList.toggle("active", single);
  if (state.cardMode !== single) {
    state.cardMode = single;
    mountCard(state);
  }
  state.card?.sync();
}

// The playhead follows the player, so the card's marker and readout move
// with the picture.
function followPlayer(state) {
  const rate = clipInfo(state.metadata).fps;
  if (!(rate > 0)) return;
  const frame = Math.max(0, Math.floor(state.video.currentTime * rate + 1e-6));
  if (frame === state.head) return;
  state.head = frame;
  state.card?.sync();
}

function installPlayback(state) {
  const { video } = state;
  const stopTick = () => {
    if (state.playRaf) cancelAnimationFrame(state.playRaf);
    state.playRaf = 0;
  };
  const tick = () => {
    if (video.paused || video.ended) { stopTick(); followPlayer(state); return; }
    // Frame picking plays the whole source freely - the clip is not in
    // force, so there is no boundary to loop or stop at.
    if (!isSingleFrame(state)) {
      const bounds = currentBounds(state);
      const action = playbackBoundaryAction(video.currentTime, bounds, getLoopEnabled(state.node), TRIM_EPSILON);
      if (action === "loop") {
        video.currentTime = bounds.start;
      } else if (action === "stop") {
        video.pause();
        video.currentTime = Math.max(bounds.start, bounds.end - TRIM_EPSILON);
        followPlayer(state);
        return;
      }
    }
    followPlayer(state);
    state.playRaf = requestAnimationFrame(tick);
  };
  video.addEventListener("play", () => {
    if (!isSingleFrame(state)) {
      const bounds = currentBounds(state);
      if (video.currentTime < bounds.start || video.currentTime >= bounds.end - TRIM_EPSILON) {
        video.currentTime = bounds.start;
      }
    }
    stopTick();
    state.playRaf = requestAnimationFrame(tick);
  }, { signal: state.abort.signal });
  video.addEventListener("pause", stopTick, { signal: state.abort.signal });
  video.addEventListener("seeking", () => {
    if (state.correctingSeek || isSingleFrame(state)) return;
    const target = clampTrimSeek(video.currentTime, currentBounds(state), TRIM_EPSILON);
    if (Math.abs(target - video.currentTime) < 0.001) return;
    state.correctingSeek = true;
    video.currentTime = target;
  }, { signal: state.abort.signal });
  video.addEventListener("seeked", () => { state.correctingSeek = false; followPlayer(state); }, { signal: state.abort.signal });
  state.stopTick = stopTick;
}

function watchTrimWidget(state, widget) {
  if (!widget || widget.__ausbossTrimWatch) return;
  widget.__ausbossTrimWatch = true;
  const prior = widget.callback;
  widget.callback = function (...args) {
    const result = prior?.apply(this, args);
    if (!state.writing) {
      state.card?.sync();
      if (state.video.readyState >= 1 && state.video.paused) state.video.currentTime = homeTime(state);
    }
    return result;
  };
}

function watchFrameWidget(state, widget) {
  if (!widget || widget.__ausbossFrameWatch) return;
  widget.__ausbossFrameWatch = true;
  const prior = widget.callback;
  widget.callback = function (...args) {
    const result = prior?.apply(this, args);
    if (!isSingleFrame(state)) {
      const reopened = trimAfterFramePick(state.startWidget.value, state.endWidget.value);
      if (reopened) {
        state.writing = true;
        try { setWidget(state.endWidget, reopened.end); } finally { state.writing = false; }
      }
    }
    applyMode(state);
    if (state.video.readyState >= 1) state.video.currentTime = homeTime(state);
    return result;
  };
}

function buildPreview(node) {
  if (node.__ausbossLoadVideo) return node.__ausbossLoadVideo;
  const videoWidget = findWidget(node, "video");
  const startWidget = findWidget(node, "start_seconds");
  const endWidget = findWidget(node, "end_seconds");
  if (!videoWidget || !startWidget || !endWidget) return null;
  // Absent on a backend that predates the widget; the toggle simply
  // does not render and the node stays a plain trimmer.
  const frameWidget = findWidget(node, "single_frame");

  ensureVideoCss();
  suppressCoreVideoPreview(node);
  hideCanvasWidget(startWidget);
  hideCanvasWidget(endWidget);
  if (frameWidget) hideCanvasWidget(frameWidget);
  // Every nth and the frame limit (the Duration) live in the timing card.
  for (const name of ["every_nth", "max_frames"]) {
    const extra = findWidget(node, name);
    if (extra) hideCanvasWidget(extra);
  }

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
  const loopButton = makeToolButton("LOOP", "Play the clip again and again");
  loopButton.classList.add("ausboss-video-loop");
  const reloadButton = makeToolButton("↻", "Reload the selected source video");
  const frameButton = frameWidget
    ? makeToolButton("FRAME", "Pick one frame instead of a trim window; only the frame at the marker loads")
    : null;
  if (frameButton) tools.append(frameButton);
  tools.append(loopButton, reloadButton);
  stage.append(video, status, tools);

  // The timing card goes here (mountCard): the clip node's Start,
  // Duration and Ends at, or the frame picker while FRAME is on.
  const cardSlot = document.createElement("div");
  cardSlot.className = "ausboss-video-timing";
  cardSlot.style.flex = "none";
  root.append(stage, cardSlot);

  const widget = node.addDOMWidget(PREVIEW_WIDGET, "ausboss_video", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => PANEL_MIN_HEIGHT + WIDGET_FRAME,
  });
  keepDomWidgetWidthAuto(widget);
  // Not saved with the workflow either: options.serialize only keeps it out
  // of the prompt, and saved values come back by position.
  widget.serialize = false;
  fillNodeHeight(widget, {
    minWidth: VIDEO_MIN_WIDTH,
    minHeight: PANEL_MIN_HEIGHT + WIDGET_FRAME,
    minNodeSize: [VIDEO_MIN_WIDTH, 310],
    exactMinWidth: true,
  });

  const abort = new AbortController();
  const state = node.__ausbossLoadVideo = {
    node, root, stage, video, status, loopButton, reloadButton, frameButton,
    cardSlot, card: null, cardMode: null, metadata: null, head: 0,
    videoWidget, startWidget, endWidget, frameWidget,
    widget, abort, writing: false, correctingSeek: false, playRaf: 0,
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

  frameButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const next = !frameWidget.value;
    frameWidget.value = next;
    // The widget watch applies the mode and repositions the preview.
    frameWidget.callback?.(next);
    node.setDirtyCanvas?.(true, true);
    notifyAusbossChange();
  });

  const refresh = () => {
    applyMode(state);
    const name = videoWidget.value;
    if (!name || typeof name !== "string") {
      video.pause();
      video.removeAttribute("src");
      state.metadata = null;
      setEmpty(state, "Choose or upload a video");
      state.card?.sync();
      return;
    }
    const parts = splitMediaName(name);
    setEmpty(state, `Loading ${parts.filename}…`);
    video.pause();
    // A video ComfyUI made ("clip.mp4 [output]") plays from its own folder.
    const type = parseImageReference(name)?.type ?? "input";
    video.src = api.apiURL(`/view?${mediaViewQuery({ ...parts, type }, "input")}`);
    video.load();
    probeMetadata(state, name);
  };
  state.refresh = refresh;
  reloadButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    refresh();
  });

  video.addEventListener("loadedmetadata", () => {
    video.currentTime = homeTime(state);
    // The card says where the clip is; the stage only names the source on hover.
    setReady(state, "");
    const sourceInfo = mediaInfo(null, video);
    stage.title = sourceInfo ? `Source: ${sourceInfo}` : "";
    state.card?.sync();
    node.setDirtyCanvas?.(true, true);
  }, { signal: abort.signal });
  video.addEventListener("error", () => setEmpty(state, "Preview could not load this video"), { signal: abort.signal });

  installPlayback(state);
  watchTrimWidget(state, startWidget);
  watchTrimWidget(state, endWidget);
  watchFrameWidget(state, frameWidget);
  watchTrimWidget(state, findWidget(node, "every_nth"));
  watchTrimWidget(state, findWidget(node, "max_frames"));
  applyMode(state);

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
      // Only for a genuinely new node: onConfigure restores a saved size after
      // this runs, so a workflow's own dimensions still win.
      this.setSize?.([
        Math.max(DEFAULT_NODE_SIZE[0], this.size?.[0] ?? 0),
        Math.max(DEFAULT_NODE_SIZE[1], this.size?.[1] ?? 0),
      ]);
    });
    chainCallback(nodeType.prototype, "onConfigure", function () {
      queueMicrotask(() => {
        const state = buildPreview(this);
        if (state) {
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
