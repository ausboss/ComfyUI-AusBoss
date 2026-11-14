// Load Audio 🆎 - the wave, the timing and the player.
//
// The card above (js/widget_cards) holds Source. This panel draws the whole
// file as a wave: the part that comes out is bright and the rest is dim.
// Under it, Start, Duration and Ends at, as on the video nodes. Drag a
// handle on the wave to move the start or the end, drag the middle to slide
// the sound, or click elsewhere to move it there. Play plays only what comes
// out. The widgets underneath stay the source of truth: the Duration is
// max_seconds with end_seconds at 0. A saved end (or a linked Max length)
// still works: the part a Max length cuts off shows red.
import { api } from "../../../scripts/api.js";
import { app } from "../../../scripts/app.js";
import { BRAND, chainCallback, keepDomWidgetWidthAuto, notifyAusbossChange, showToast } from "../shared/index.mjs";
import { WIDGET_FRAME, fillNodeHeight } from "../shared/panel_layout.mjs";
import { formatTimecode } from "../shared/timecode.mjs";
import { inputNumber } from "../shared/clip_rate.mjs";
import { makeScrubInput } from "../shared/scrub_input.mjs";
import { linkedNodeInfo } from "../shared/timing_links.mjs";
import { parseImageReference } from "../shared/pad_canvas.mjs";
import { mediaViewQuery, splitMediaName } from "../shared/video_preview.mjs";
import { ensureVideoCss, hideCanvasWidget, makeToolButton } from "../shared/video_ui.mjs";
import { MIN_TRIM_SECONDS, dragTrimHandle, slideTrimWindow } from "../load_video/trim_preview.mjs";
import { grabZone, outputWindow, wavePeaks } from "./audio_window.mjs";

const NODE_NAME = "AUSBOSS_NODES_LoadAudio";
const PANEL_WIDGET = "ausboss_load_audio_wave";
// The frontend's own player for an audio_upload input. The wave replaces it.
const CORE_AUDIO_WIDGET = "audioUI";
const MIN_WIDTH = 280;
// 8px root padding + the wave's 28px floor + 6px gap + the 38px Start,
// Duration and Ends at row (a label over a box).
const PANEL_MIN_HEIGHT = 80;
// Opens small and neat: 300 px wide, with a wave about as tall as a field
// (32 px). Drag the corner down for a taller wave.
const DEFAULT_WIDTH = 300;
const DEFAULT_WAVE_EXTRA = 4;
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

function linked(node, name) {
  return !!node.inputs?.some((slot) => slot?.widget?.name === name && slot.link != null);
}

// A value as the run will see it: the widget, or the number a linked input
// carries when the far end is a typed number (through Reroutes and
// subgraphs). null when only the run knows it.
function valueOf(state, name, widget) {
  if (!linked(state.node, name)) return Number(widget?.value) || 0;
  return inputNumber(state.node, name, null);
}

function maxSeconds(state) {
  const fromLink = linked(state.node, "max_seconds");
  const value = valueOf(state, "max_seconds", state.maxWidget);
  return { value: value ?? 0, fromLink, known: value != null };
}

function currentWindow(state) {
  const start = valueOf(state, "start_seconds", state.startWidget) ?? 0;
  const max = maxSeconds(state).value;
  let end = valueOf(state, "end_seconds", state.endWidget) ?? 0;
  // No end and a Duration: the Duration is where the sound stops, so
  // nothing past it shows as cut off. Only an end past the Duration does.
  if (!(end > 0) && max > 0 && state.duration > 0) end = Math.min(state.duration, Math.max(0, start) + max);
  return outputWindow(state.duration, start, end, max);
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
.ausboss-audio-root .ausboss-video-stage{min-height:28px;background:#050b0b;cursor:pointer;touch-action:none;}
.ausboss-audio-error{pointer-events:auto;border:0;background:transparent;color:#e6bf87;font:11px system-ui;cursor:pointer;white-space:nowrap}
.ausboss-audio-root canvas.ausboss-audio-wave{position:absolute;inset:0;width:100%;height:100%;display:block;}
.ausboss-audio-root .ausboss-video-stage:not(.is-empty) .ausboss-video-status{display:none;}
.ausboss-audio-root .ausboss-audio-wave-row{display:flex;align-items:stretch;gap:6px;flex:1 1 auto;min-height:28px;}
.ausboss-audio-root .ausboss-audio-wave-row .ausboss-video-stage{flex:1 1 auto;min-width:0;}
.ausboss-audio-root .ausboss-audio-play{flex:none;align-self:center;min-width:30px;font-size:10px;}
.ausboss-audio-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;flex:none;padding:0 2px;color:#ddd;font:11px system-ui;}
.ausboss-audio-field{display:flex;flex-direction:column;gap:2px;min-width:0;}
.ausboss-audio-field .ausboss-scrub{width:100%;box-sizing:border-box;}
.ausboss-audio-field-label{display:flex;align-items:center;gap:6px;min-width:0;color:#cadddb;}
.ausboss-audio-go{border:0;background:transparent;padding:0;color:#45d6cb;font:600 10px system-ui;text-decoration:underline;cursor:pointer;}
.ausboss-audio-go[hidden]{display:none;}
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
  // The grips stay small on a short wave so they don't hide it.
  const grip = Math.round(Math.max(3, Math.min(7, rect.height * 0.12)) * scale);
  const handle = (x, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x) - scale, 0, 2 * scale, height);
    ctx.fillRect(Math.round(x) - 4 * scale, 0, 8 * scale, grip);
    ctx.fillRect(Math.round(x) - 4 * scale, height - grip, 8 * scale, grip);
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

// One box's look: its value, whether it can be typed, and the "linked"
// button when another node sets it.
function showField(state, key, value, lockedBy, tip) {
  const field = state.fields[key];
  field.control.set(value);
  field.control.root.style.opacity = lockedBy ? ".45" : "";
  field.control.root.inert = Boolean(lockedBy);
  field.go.hidden = !lockedBy;
  field.cell.title = lockedBy ? `Set by ${lockedBy.title}. Click "linked" to go to that node.` : tip;
  if (lockedBy) field.go.onclick = () => lockedBy.go?.();
}

function updateFace(state) {
  const win = currentWindow(state);
  const max = maxSeconds(state);
  const link = (name) => (linked(state.node, name) ? linkedNodeInfo(state.node, name) : null);
  const durationLink = link("max_seconds");
  const has = state.duration > 0;
  showField(state, "start", has ? win.start : null, link("start_seconds"), `Where the sound starts in the file, of ${formatTimecode(state.duration)}.`);
  showField(state, "duration", has && (!max.fromLink || max.known) ? win.length : null, durationLink,
    win.cut > 0.005 ? `How long the sound is. Max length cuts ${formatTimecode(win.cut)} off the picked part (red).` : "How long the sound is. 0 or the whole rest of the file means it runs to the end.");
  showField(state, "end", has ? win.keepEnd : null, link("end_seconds"), "Where the sound stops in the file. Typing it changes the Duration.");
  draw(state);
}

function writeWidget(widget, value) {
  const next = roundHundredth(value);
  if (Math.abs(Number(widget.value || 0) - next) < 0.0001) return;
  widget.value = next;
  widget.callback?.(next);
}

// The pick, written the way the face shows it: a Start and a Duration
// (max_seconds, with the end at 0 - "to the end"). Running to the end of the
// file needs no Duration at all. A linked Max length or end keeps the old
// start and end instead.
function writeTrim(state, bounds) {
  state.writing = true;
  try {
    const startLinked = linked(state.node, "start_seconds");
    if (!startLinked) writeWidget(state.startWidget, bounds.start);
    const start = startLinked ? currentWindow(state).start : bounds.start;
    const toEnd = bounds.end >= state.duration - 0.005;
    if (linked(state.node, "max_seconds") || linked(state.node, "end_seconds") || !state.maxWidget) {
      if (!linked(state.node, "end_seconds")) writeWidget(state.endWidget, toEnd ? 0 : bounds.end);
    } else {
      writeWidget(state.endWidget, 0);
      writeWidget(state.maxWidget, toEnd ? 0 : Math.max(0.01, bounds.end - start));
    }
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
    if (state.dragging || state.duration <= 0) return;
    const { zone } = infoAt(event.clientX);
    surface.style.cursor = zone === "start" || zone === "end" ? "ew-resize" : zone === "move" ? "grab" : "pointer";
  });
  surface.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || state.dragging || state.duration <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    const initial = infoAt(event.clientX);
    const bounds = { start: initial.win.start, end: initial.win.keepEnd };
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
        writeTrim(state, dragTrimHandle(state.duration, { start: now.start, end: now.keepEnd }, initial.zone, next.fraction, MIN_TRIM_SECONDS));
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
  // Max length is the Duration box now.
  const maxWidget = findWidget(node, "max_seconds");
  if (maxWidget) hideCanvasWidget(maxWidget);

  const root = document.createElement("div");
  root.className = "ausboss-video-root ausboss-audio-root";
  const stage = document.createElement("div");
  stage.className = "ausboss-video-stage is-empty";
  stage.title = "Drag a handle to set where the sound starts or stops. Drag the middle to slide it.";
  const canvas = document.createElement("canvas");
  canvas.className = "ausboss-audio-wave";
  const status = document.createElement("div");
  status.className = "ausboss-video-status";
  status.textContent = "Choose a sound file";
  const playButton = makeToolButton("▶", "Play the part that comes out");
  playButton.classList.add("ausboss-audio-play");
  const loopButton = makeToolButton("LOOP", "Play it again and again");
  stage.append(canvas, status);
  // Play and Loop sit either side of the wave, so neither covers a handle.
  loopButton.classList.add("ausboss-audio-play");
  const waveRow = document.createElement("div");
  waveRow.className = "ausboss-audio-wave-row";
  waveRow.append(playButton, stage, loopButton);

  // Start, Duration and Ends at, as on the video nodes, in seconds.
  const fieldsRow = document.createElement("div");
  fieldsRow.className = "ausboss-audio-fields";
  const fields = {};
  const commit = (key, value) => {
    const state = node.__ausbossLoadAudio;
    if (!state || state.duration <= 0 || value == null) return;
    const win = currentWindow(state);
    const clampTime = (time) => Math.min(state.duration, Math.max(0, time));
    if (key === "start") {
      // The Duration stays; a start near the end leaves less of it.
      const start = clampTime(value);
      writeTrim(state, { start, end: Math.min(state.duration, start + win.length) });
    } else if (key === "duration") {
      writeTrim(state, { start: win.start, end: clampTime(win.start + Math.max(MIN_TRIM_SECONDS, value)) });
    } else {
      writeTrim(state, { start: win.start, end: clampTime(Math.max(win.start + MIN_TRIM_SECONDS, value)) });
    }
  };
  for (const [key, caption] of [["start", "Start"], ["duration", "Duration"], ["end", "Ends at"]]) {
    const cell = document.createElement("div");
    cell.className = "ausboss-audio-field";
    const label = document.createElement("span");
    label.className = "ausboss-audio-field-label";
    label.textContent = caption;
    const go = document.createElement("button");
    go.type = "button";
    go.className = "ausboss-audio-go";
    go.textContent = "linked";
    go.hidden = true;
    label.append(go);
    const control = makeScrubInput({
      value: 0, min: 0, max: 86400, step: 0.1, fineStep: 0.01, decimals: 2, minDecimals: 0, unit: "s", unitWidth: 14,
      allowEmpty: true,
      onChange: (value) => commit(key, value),
      onSettle: () => notifyAusbossChange(),
    });
    cell.append(label, control.root);
    fieldsRow.append(cell);
    fields[key] = { cell, control, go };
  }
  root.append(waveRow, fieldsRow);

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
    node, root, stage, canvas, status, playButton, loopButton, audio, fields,
    audioWidget, startWidget, endWidget, maxWidget: findWidget(node, "max_seconds"),
    duration: 0, peaks: null, abort, writing: false, dragging: false, raf: 0, loading: 0,
  };

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
      status.textContent = "Choose a sound file";
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
      const info = document.createElement("button");
      info.type = "button";
      info.className = "ausboss-audio-error";
      info.textContent = "Audio preview unavailable ⓘ";
      info.title = String(error?.message || error);
      info.setAttribute("aria-label", "Audio preview unavailable. Show details.");
      info.onclick = event => {
        event.stopPropagation();
        showToast({ summary: "Audio preview unavailable", detail: info.title });
      };
      status.replaceChildren(info);
    }
  };
  state.refresh = refresh;

  installDrag(state);
  installPlayer(state);
  watchWidget(state, startWidget);
  watchWidget(state, endWidget);
  watchWidget(state, state.maxWidget);
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
