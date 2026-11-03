// Load Audio 🆎 - the wave, the trim and the player.
//
// The card above (js/widget_cards) holds Source and Max length. This panel
// draws the whole file as a wave: the part that comes out is bright, the
// part a Max length cuts off is red, and the rest is dim. Drag a handle to
// move IN or OUT, drag the middle to slide the pick, or click elsewhere to
// move it there. Play plays only what comes out. The widgets underneath
// (start_seconds, end_seconds, max_seconds) stay the source of truth.
import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { BRAND, chainCallback, keepDomWidgetWidthAuto, notifyAusbossChange } from "../shared/index.mjs";
import { keepKeyInField } from "../shared/canvas_passthrough.mjs";
import { WIDGET_FRAME, fillNodeHeight } from "../shared/panel_layout.mjs";
import { formatTimecode, parseTimecode } from "../shared/timecode.mjs";
import { parseImageReference } from "../shared/pad_canvas.mjs";
import { mediaViewQuery, splitMediaName } from "../shared/video_preview.mjs";
import { ensureVideoCss, hideCanvasWidget, makeToolButton } from "../shared/video_ui.mjs";
import { MIN_TRIM_SECONDS, dragTrimHandle, slideTrimWindow } from "../load_video/trim_preview.mjs";
import { grabZone, outputSummary, outputWindow, wavePeaks } from "./audio_window.mjs";

const NODE_NAME = "AUSBOSS_NODES_LoadAudio";
const PANEL_WIDGET = "ausboss_load_audio_wave";
// The frontend's own player for an audio_upload input. The wave replaces it.
const CORE_AUDIO_WIDGET = "audioUI";
const MIN_WIDTH = 280;
// 8px root padding + the wave's 52px floor + 6px gap + the 22px play, IN/OUT and loop row.
const PANEL_MIN_HEIGHT = 88;
// Opens small and neat: 300 px wide, as short as it can be plus a little,
// so the wave is about 64 px tall. Drag the corner for a bigger wave.
const DEFAULT_WIDTH = 300;
const DEFAULT_WAVE_EXTRA = 12;
const CUT_RED = "#e0525a";
const PEAK_BUCKETS = 1600;
const END_EPSILON = 0.03;

// Decoded once per file and kept small: only the peaks and the length.
const peakCache = new Map();

function findWidget(node, name) {
  return node.widgets?.find((widget) => widget.name === name);
}

function roundHundredth(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function hideCoreAudio(node) {
  for (const widget of node.widgets ?? []) {
    if (widget?.name === CORE_AUDIO_WIDGET) hideCanvasWidget(widget, widget.element);
  }
}

// A wired Max length: the number the wire carries, when the far end is a
// node that shows it (Float, Integer, a Primitive). null when it can't be known.
function wiredMax(node) {
  const input = node.inputs?.find((slot) => slot?.widget?.name === "max_seconds");
  if (!input || input.link == null) return { wired: false, value: null };
  const graph = node.graph;
  const link = graph?.getLink?.(input.link) ?? graph?.links?.get?.(input.link) ?? graph?.links?.[input.link];
  const origin = link ? graph?.getNodeById?.(link.origin_id) : null;
  const shown = origin?.widgets?.find((widget) => typeof widget?.value === "number");
  return { wired: true, value: shown ? Number(shown.value) : null };
}

function maxSeconds(state) {
  const wired = wiredMax(state.node);
  if (wired.wired) return { value: wired.value ?? 0, fromLink: true, known: wired.value != null };
  return { value: Number(state.maxWidget?.value) || 0, fromLink: false, known: true };
}

function currentWindow(state) {
  return outputWindow(state.duration, state.startWidget.value, state.endWidget.value, maxSeconds(state).value);
}

async function loadPeaks(name, route) {
  const key = name;
  if (peakCache.has(key)) return peakCache.get(key);
  const job = (async () => {
    const response = await api.fetchApi(route, { cache: "no-store" });
    if (!response.ok) throw new Error(`the file could not be read (${response.status})`);
    const bytes = await response.arrayBuffer();
    const Context = window.AudioContext || window.webkitAudioContext;
    const context = new Context();
    try {
      const buffer = await context.decodeAudioData(bytes);
      const channels = [];
      for (let index = 0; index < buffer.numberOfChannels; index += 1) channels.push(buffer.getChannelData(index));
      return { duration: buffer.duration, peaks: wavePeaks(channels, PEAK_BUCKETS) };
    } finally {
      context.close?.();
    }
  })();
  peakCache.set(key, job);
  job.catch(() => peakCache.delete(key));
  return job;
}

function ensureAudioCss() {
  ensureVideoCss();
  if (document.getElementById("ausboss-load-audio-css")) return;
  const style = document.createElement("style");
  style.id = "ausboss-load-audio-css";
  style.textContent = `
.ausboss-audio-root .ausboss-video-stage{min-height:52px;background:#050b0b;cursor:pointer;touch-action:none;}
.ausboss-audio-root canvas.ausboss-audio-wave{position:absolute;inset:0;width:100%;height:100%;display:block;}
.ausboss-audio-root .ausboss-video-stage:not(.is-empty) .ausboss-video-status{display:none;}
.ausboss-audio-root .ausboss-audio-row{display:flex;align-items:center;gap:6px;flex:none;padding:0 2px;}
.ausboss-audio-root .ausboss-audio-row .ausboss-video-values{flex:1 1 auto;min-width:0;}
.ausboss-audio-root .ausboss-audio-play{min-width:30px;font-size:10px;}
.ausboss-audio-root .ausboss-audio-summary{position:absolute;left:6px;top:6px;z-index:3;max-width:calc(100% - 12px);padding:2px 6px;border-radius:4px;background:rgba(0,0,0,.72);color:#b8d3d1;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;}
.ausboss-audio-root .ausboss-audio-summary:empty{display:none;}
.ausboss-audio-root .ausboss-audio-summary.has-cut{color:#ff9aa0;border:1px solid rgba(224,82,90,.6);cursor:pointer;pointer-events:auto;}
.ausboss-audio-root .ausboss-video-values{grid-template-columns:minmax(max-content,1fr) minmax(max-content,1fr);}
`;
  document.head.appendChild(style);
}

function draw(state) {
  const { canvas } = state;
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * scale));
  const height = Math.max(1, Math.round(rect.height * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  if (!state.peaks || state.duration <= 0) return;
  const win = currentWindow(state);
  const xOf = (seconds) => (seconds / state.duration) * width;
  const startX = xOf(win.start);
  const keepX = xOf(win.keepEnd);
  const endX = xOf(win.end);
  // Backdrops: the part that comes out, then the part cut off.
  ctx.fillStyle = "rgba(0,180,170,0.13)";
  ctx.fillRect(startX, 0, keepX - startX, height);
  if (endX > keepX) {
    ctx.fillStyle = "rgba(224,82,90,0.16)";
    ctx.fillRect(keepX, 0, endX - keepX, height);
  }
  // The wave, one bar per pixel column.
  const mid = height / 2;
  const reach = mid * 0.92;
  const buckets = state.peaks.length / 2;
  for (let x = 0; x < width; x += 1) {
    const from = Math.floor((x / width) * buckets);
    const to = Math.max(from + 1, Math.floor(((x + 1) / width) * buckets));
    let low = 0;
    let high = 0;
    for (let bucket = from; bucket < to && bucket < buckets; bucket += 1) {
      low = Math.min(low, state.peaks[bucket * 2]);
      high = Math.max(high, state.peaks[bucket * 2 + 1]);
    }
    if (x >= startX && x < keepX) ctx.fillStyle = BRAND;
    else if (x >= keepX && x < endX) ctx.fillStyle = CUT_RED;
    else ctx.fillStyle = "#3a4948";
    const top = mid - high * reach;
    ctx.fillRect(x, top, 1, Math.max(1, (high - low) * reach));
  }
  // The handles: IN and OUT, and a dashed line where the max cuts off.
  const handle = (x, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x) - scale, 0, 2 * scale, height);
    ctx.fillRect(Math.round(x) - 5 * scale, 0, 10 * scale, 7 * scale);
    ctx.fillRect(Math.round(x) - 5 * scale, height - 7 * scale, 10 * scale, 7 * scale);
  };
  handle(startX, "#f4ffff");
  handle(endX, "#f4ffff");
  if (endX > keepX + 1) {
    ctx.strokeStyle = CUT_RED;
    ctx.lineWidth = 2 * scale;
    ctx.setLineDash([4 * scale, 3 * scale]);
    ctx.beginPath();
    ctx.moveTo(keepX, 0);
    ctx.lineTo(keepX, height);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // The playhead while it plays, or where it paused inside the pick.
  if (state.audio && !state.audio.paused) {
    const x = xOf(state.audio.currentTime);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x - scale / 2, 0, scale, height);
  }
}

function updateFace(state) {
  const win = currentWindow(state);
  const max = maxSeconds(state);
  if (document.activeElement !== state.startInput) state.startInput.value = formatTimecode(win.start);
  if (document.activeElement !== state.endInput) state.endInput.value = formatTimecode(win.end);
  if (state.duration > 0) {
    const summary = outputSummary(win, { maxFromLink: max.fromLink && !max.known });
    state.summary.textContent = summary;
    state.summary.classList.toggle("has-cut", win.cut > 0.005);
    state.summary.title = win.cut > 0.005
      ? `Max length is ${max.value} s, so ${formatTimecode(win.keepEnd)} to ${formatTimecode(win.end)} is cut off. Click to move OUT to ${formatTimecode(win.keepEnd)}.`
      : `${formatTimecode(win.start)} to ${formatTimecode(win.keepEnd)} comes out.`;
  } else {
    state.summary.textContent = "";
  }
  draw(state);
}

function writeWidget(widget, value) {
  const next = roundHundredth(value);
  if (Math.abs(Number(widget.value || 0) - next) < 0.0001) return;
  widget.value = next;
  widget.callback?.(next);
}

function writeTrim(state, bounds) {
  state.writing = true;
  try {
    writeWidget(state.startWidget, bounds.start);
    // OUT at the very end stays 0, the widget's own "to the end".
    writeWidget(state.endWidget, bounds.end >= state.duration - 0.005 ? 0 : bounds.end);
  } finally {
    state.writing = false;
  }
  updateFace(state);
  state.node.setDirtyCanvas?.(true, true);
}

function installDrag(state) {
  const surface = state.stage;
  const infoAt = (clientX) => {
    const rect = state.canvas.getBoundingClientRect();
    const fraction = rect.width ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
    const win = currentWindow(state);
    return { fraction, win, zone: grabZone(win, state.duration, fraction, rect.width) };
  };
  surface.addEventListener("pointermove", (event) => {
    if (state.dragging || state.duration <= 0 || event.target === state.summary) return;
    const { zone } = infoAt(event.clientX);
    surface.style.cursor = zone === "start" || zone === "end" ? "ew-resize" : zone === "move" ? "grab" : "pointer";
  });
  surface.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || state.dragging || state.duration <= 0) return;
    if (event.target === state.summary && state.summary.classList.contains("has-cut")) return;
    event.preventDefault();
    event.stopPropagation();
    const initial = infoAt(event.clientX);
    const bounds = { start: initial.win.start, end: initial.win.end };
    const anchor = initial.fraction * state.duration;
    const downX = event.clientX;
    let moved = false;
    state.dragging = true;
    try { surface.setPointerCapture(event.pointerId); } catch (_error) { /* mouse fallback */ }
    const centred = (fraction) => {
      const span = bounds.end - bounds.start;
      return slideTrimWindow(state.duration, bounds, fraction * state.duration - span / 2 - bounds.start);
    };
    const apply = (clientX) => {
      const next = infoAt(clientX);
      if (initial.zone === "start" || initial.zone === "end") {
        const now = currentWindow(state);
        writeTrim(state, dragTrimHandle(state.duration, { start: now.start, end: now.end }, initial.zone, next.fraction, MIN_TRIM_SECONDS));
      } else if (initial.zone === "move") {
        writeTrim(state, slideTrimWindow(state.duration, bounds, next.fraction * state.duration - anchor));
      } else {
        writeTrim(state, centred(next.fraction));
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
      surface.removeEventListener("pointermove", move);
      try { surface.releasePointerCapture(event.pointerId); } catch (_error) { /* already released */ }
      if (!moved && initial.zone === "jump") writeTrim(state, centred(infoAt(finishEvent?.clientX ?? downX).fraction));
      if (moved || initial.zone === "jump") {
        if (state.audio && !state.audio.paused) state.audio.currentTime = currentWindow(state).start;
        notifyAusbossChange();
      }
    };
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerup", finish, { once: true });
    surface.addEventListener("pointercancel", finish, { once: true });
    surface.addEventListener("lostpointercapture", finish, { once: true });
  });
}

function loopEnabled(node) {
  node.properties ??= {};
  return !!node.properties.ausboss_load_audio_loop;
}

function installPlayer(state) {
  const audio = state.audio;
  const stop = () => {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    state.playButton.textContent = "▶";
    state.playButton.classList.remove("active");
    draw(state);
  };
  const tick = () => {
    if (audio.paused) { stop(); return; }
    const win = currentWindow(state);
    if (audio.currentTime >= win.keepEnd - END_EPSILON || audio.currentTime < win.start - 0.25) {
      if (loopEnabled(state.node)) audio.currentTime = win.start;
      else { audio.pause(); audio.currentTime = win.start; stop(); return; }
    }
    draw(state);
    state.raf = requestAnimationFrame(tick);
  };
  audio.addEventListener("play", () => {
    state.playButton.textContent = "❚❚";
    state.playButton.classList.add("active");
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(tick);
  }, { signal: state.abort.signal });
  audio.addEventListener("pause", stop, { signal: state.abort.signal });
  state.playButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (state.duration <= 0) return;
    if (!audio.paused) { audio.pause(); return; }
    const win = currentWindow(state);
    if (audio.currentTime < win.start || audio.currentTime >= win.keepEnd - END_EPSILON) audio.currentTime = win.start;
    audio.play().catch(() => stop());
  });
  state.stopPlayer = () => { audio.pause(); stop(); };
}

function commitTimeInput(state, edge, input) {
  if (state.duration <= 0) return;
  const seconds = parseTimecode(input.value);
  const win = currentWindow(state);
  if (seconds === null) {
    input.value = formatTimecode(edge === "start" ? win.start : win.end);
    return;
  }
  writeTrim(state, dragTrimHandle(state.duration, { start: win.start, end: win.end }, edge, seconds / state.duration, MIN_TRIM_SECONDS));
  notifyAusbossChange();
  input.blur();
}

function watchWidget(state, widget) {
  if (!widget || widget.__ausbossAudioWatch) return;
  widget.__ausbossAudioWatch = true;
  const prior = widget.callback;
  widget.callback = function (...args) {
    const result = prior?.apply(this, args);
    if (!state.writing) updateFace(state);
    return result;
  };
}

function buildPanel(node) {
  if (node.__ausbossLoadAudio) return node.__ausbossLoadAudio;
  const audioWidget = findWidget(node, "audio");
  const startWidget = findWidget(node, "start_seconds");
  const endWidget = findWidget(node, "end_seconds");
  if (!audioWidget || !startWidget || !endWidget) return null;
  ensureAudioCss();
  hideCoreAudio(node);
  hideCanvasWidget(startWidget);
  hideCanvasWidget(endWidget);

  const root = document.createElement("div");
  root.className = "ausboss-video-root ausboss-audio-root";
  const stage = document.createElement("div");
  stage.className = "ausboss-video-stage is-empty";
  stage.title = "Drag a handle to set where the sound starts or stops. Drag the middle to slide it.";
  const canvas = document.createElement("canvas");
  canvas.className = "ausboss-audio-wave";
  const status = document.createElement("div");
  status.className = "ausboss-video-status";
  status.textContent = "Choose or upload a sound file";
  const playButton = makeToolButton("▶", "Play the part that comes out");
  playButton.classList.add("ausboss-audio-play");
  const loopButton = makeToolButton("LOOP", "Play it again and again");
  stage.append(canvas, status);

  const values = document.createElement("div");
  values.className = "ausboss-video-values";
  const makeValue = (labelText, title) => {
    const wrap = document.createElement("div");
    wrap.className = "ausboss-video-value";
    const label = document.createElement("label");
    label.textContent = labelText;
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.placeholder = "m:ss.s";
    input.title = title;
    input.addEventListener("keydown", (event) => {
      keepKeyInField(event);
      if (event.key === "Enter") input.dispatchEvent(new Event("change"));
    });
    wrap.append(label, input);
    return { wrap, input };
  };
  const startValue = makeValue("IN", "Where the sound starts. Type seconds (12.5) or a time (0:12.5).");
  const endValue = makeValue("OUT", "Where the sound stops. Type seconds (24) or a time (0:24.0).");
  // What comes out, over the wave's corner: "15.0 s · cut 7.0 s".
  const summary = document.createElement("div");
  summary.className = "ausboss-audio-summary";
  stage.append(summary);
  values.append(startValue.wrap, endValue.wrap);
  const row = document.createElement("div");
  row.className = "ausboss-audio-row";
  row.append(playButton, values, loopButton);
  root.append(stage, row);

  const widget = node.addDOMWidget(PANEL_WIDGET, "ausboss_audio", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => PANEL_MIN_HEIGHT + WIDGET_FRAME,
  });
  keepDomWidgetWidthAuto(widget);
  widget.serialize = false;
  fillNodeHeight(widget, {
    minWidth: MIN_WIDTH,
    minHeight: PANEL_MIN_HEIGHT + WIDGET_FRAME,
    minNodeSize: [MIN_WIDTH, 200],
    exactMinWidth: true,
  });

  const audio = new Audio();
  audio.preload = "auto";
  const abort = new AbortController();
  const state = node.__ausbossLoadAudio = {
    node, root, stage, canvas, status, playButton, loopButton, summary, audio,
    startInput: startValue.input, endInput: endValue.input,
    audioWidget, startWidget, endWidget, maxWidget: findWidget(node, "max_seconds"),
    duration: 0, peaks: null, abort, writing: false, dragging: false, raf: 0, loading: 0,
  };

  // Clicking the red "cut off" line moves OUT to where the sound really ends.
  summary.addEventListener("click", (event) => {
    const win = currentWindow(state);
    if (win.cut <= 0.005) return;
    event.preventDefault();
    event.stopPropagation();
    writeTrim(state, { start: win.start, end: win.keepEnd });
    notifyAusbossChange();
  });

  const updateLoop = () => loopButton.classList.toggle("active", loopEnabled(node));
  updateLoop();
  loopButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    node.properties.ausboss_load_audio_loop = !loopEnabled(node);
    updateLoop();
    notifyAusbossChange();
  });

  const refresh = async () => {
    state.stopPlayer?.();
    const name = audioWidget.value;
    const ticket = ++state.loading;
    state.duration = 0;
    state.peaks = null;
    if (!name || typeof name !== "string") {
      audio.removeAttribute("src");
      stage.classList.add("is-empty");
      status.textContent = "Choose or upload a sound file";
      updateFace(state);
      return;
    }
    const parts = splitMediaName(name);
    stage.classList.add("is-empty");
    status.textContent = `Loading ${parts.filename}…`;
    const type = parseImageReference(name)?.type ?? "input";
    const route = `/view?${mediaViewQuery({ ...parts, type }, "input")}`;
    audio.src = api.apiURL(route);
    try {
      const result = await loadPeaks(name, route);
      if (ticket !== state.loading) return;
      state.duration = result.duration;
      state.peaks = result.peaks;
      stage.classList.remove("is-empty");
      updateFace(state);
    } catch (error) {
      if (ticket !== state.loading) return;
      status.textContent = `This sound could not be shown: ${error?.message || error}`;
    }
  };
  state.refresh = refresh;

  installDrag(state);
  installPlayer(state);
  watchWidget(state, startWidget);
  watchWidget(state, endWidget);
  watchWidget(state, state.maxWidget);
  startValue.input.addEventListener("change", () => commitTimeInput(state, "start", startValue.input));
  endValue.input.addEventListener("change", () => commitTimeInput(state, "end", endValue.input));
  const observer = new ResizeObserver(() => draw(state));
  observer.observe(stage);
  state.observer = observer;

  const priorAudioCallback = audioWidget.callback;
  audioWidget.callback = function (...args) {
    const result = priorAudioCallback?.apply(this, args);
    peakCache.delete(audioWidget.value);
    refresh();
    return result;
  };
  setTimeout(refresh, 0);
  return state;
}

app.registerExtension({
  name: "ausboss.load_audio",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_NAME) return;
    // The frontend's Upload button for an audio_upload input looks for its
    // player widget and fails without one, and it adds that player only to
    // its own audio nodes. Ask for it here, ahead of the button; the panel
    // hides it, since the wave plays the sound instead.
    const required = nodeData.input?.required;
    if (required && !required.audioUI) {
      const entries = Object.entries(required);
      const at = entries.findIndex(([name]) => name === "audio") + 1;
      entries.splice(at, 0, ["audioUI", ["AUDIO_UI", {}]]);
      nodeData.input.required = Object.fromEntries(entries);
    }
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      buildPanel(this);
      // Only for a genuinely new node: onConfigure restores a saved size
      // after this runs, so a workflow's own size still wins.
      const floor = Number(this.computeSize?.()?.[1]) || 0;
      if (floor > 0) this.setSize?.([DEFAULT_WIDTH, floor + DEFAULT_WAVE_EXTRA]);
    });
    chainCallback(nodeType.prototype, "onConfigure", function () {
      queueMicrotask(() => {
        const state = buildPanel(this);
        if (state) {
          hideCoreAudio(this);
          state.refresh?.();
        }
      });
    });
    // A wire into Max length changes what comes out; redraw when one comes or goes.
    chainCallback(nodeType.prototype, "onConnectionsChange", function () {
      const state = this.__ausbossLoadAudio;
      if (state) queueMicrotask(() => updateFace(state));
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      const state = this.__ausbossLoadAudio;
      state?.stopPlayer?.();
      state?.abort?.abort();
      state?.observer?.disconnect();
      if (state) state.audio.removeAttribute("src");
      this.__ausbossLoadAudio = null;
    });
  },
});
