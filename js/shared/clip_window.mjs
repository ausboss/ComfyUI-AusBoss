// The clip window: the part of the video a run uses, as one box on a strip
// of pictures from the video. Drag the box to pick where the clip starts;
// drag an edge to make it shorter or longer, never past min_seconds /
// max_seconds. Made for an App-mode form, where it is the only control a
// person sees for the clip node: the node keeps it hidden on the graph and
// js/app_mode/ lends it to the form when the form lists it.
//
// It reads and writes the node's own values (start_seconds, max_frames,
// end_seconds), the way the node's timeline does, so both always agree. The
// arithmetic lives in timeline_math.mjs (clipWindowOf, dragClipWindow).
import { THEME, FONT_UI, RADIUS_CONTROL } from "./theme.mjs";
import { formatTimecode } from "./timecode.mjs";
import {
  clipInfo,
  clipWindowOf,
  clipWindowValues,
  dragClipWindow,
  lengthLimits,
  limitFrameRange,
} from "./timeline_math.mjs";

const CSS_ID = "ausboss-clip-window-css-v1";
const EDGE_HIT_PX = 14;
const STRIP_HEIGHT = 58;
// Inputs that, when connected, set the clip on the graph instead.
const GRAPH_SET = ["start_seconds", "start_frame", "end_frame", "end_seconds", "fixed_frames", "frame_load_cap", "max_frames", "every_nth"];

function installCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
    .ausboss-clip-window{display:flex;flex-direction:column;gap:6px;box-sizing:border-box;width:100%;min-width:0;overflow:hidden;padding:2px 0 4px;color:${THEME.inkSoft};font:13px ${FONT_UI}}
    .ausboss-clip-window-head{display:flex;align-items:baseline;gap:6px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${THEME.label}}
    .ausboss-clip-window-head b{color:${THEME.ink};font-weight:600}
    .ausboss-clip-window-strip{position:relative;height:${STRIP_HEIGHT}px;margin:0 9px;border-radius:${RADIUS_CONTROL}px;background:${THEME.well};touch-action:none;user-select:none;cursor:pointer}
    .ausboss-clip-window-strip.is-off{cursor:default}
    .ausboss-clip-window-thumbs{position:absolute;inset:0;width:100%;height:100%;border-radius:${RADIUS_CONTROL}px;pointer-events:none}
    .ausboss-clip-window-shade{position:absolute;top:0;bottom:0;background:rgba(8,9,10,.68);pointer-events:none}
    .ausboss-clip-window-box{position:absolute;top:-3px;bottom:-3px;box-sizing:border-box;border:3px solid ${THEME.brand};border-radius:${RADIUS_CONTROL}px;cursor:grab;outline:none}
    .ausboss-clip-window-box:focus-visible{box-shadow:0 0 0 2px ${THEME.ink}}
    .ausboss-clip-window-strip.is-moving .ausboss-clip-window-box{cursor:grabbing}
    .ausboss-clip-window-box[hidden]{display:none}
    .ausboss-clip-window-edge{position:absolute;top:50%;width:9px;height:26px;margin-top:-13px;border-radius:3px;background:${THEME.brand};cursor:ew-resize}
    .ausboss-clip-window-edge.start{left:-6px}
    .ausboss-clip-window-edge.end{right:-6px}
    .ausboss-clip-window-box.is-whole{cursor:default}
    .ausboss-clip-window-box.is-whole .ausboss-clip-window-edge{display:none}
    .ausboss-clip-window-empty{position:absolute;inset:0;display:grid;place-items:center;color:${THEME.faint};pointer-events:none}
    .ausboss-clip-window-empty[hidden],.ausboss-clip-window-shade[hidden]{display:none}
    .ausboss-clip-window-readout{color:${THEME.brandInk};font-weight:600;font-size:14px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ausboss-clip-window-hint{color:${THEME.faint};font-size:12px;line-height:1.4}
    .ausboss-clip-window-hint.is-stop{color:${THEME.warnInk}}
  `;
  document.head.append(style);
}

function el(tag, className = "", text = "") {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text) item.textContent = text;
  return item;
}

const secondsText = (value) => String(Number((Number(value) || 0).toFixed(1)));
// A length in the readout keeps its tenth: "8.0 s used".
const lengthText = (value) => (Number(value) || 0).toFixed(1);

// options:
//   get(name, fallback) / set(name, value)   widget access
//   driven(name)                              whether an input is linked
//   number(name, fallback)                    a linked literal's value, null when only the run knows it
//   outputRate()                              output fps, null when unknown
//   metadata()                                the source's {fps, frame_count, duration}
//   storyboard()                              {image, times, tileWidth, tileHeight} or null
//   onCommit()                                a drag settled (undo point)
export function mountClipWindow({ get, set, driven = () => false, number = (name, fallback) => get(name, fallback), outputRate = () => null, metadata, storyboard = () => null, onCommit }) {
  installCss();
  const root = el("div", "ausboss-clip-window");
  const head = el("div", "ausboss-clip-window-head");
  const strip = el("div", "ausboss-clip-window-strip");
  const thumbs = el("canvas", "ausboss-clip-window-thumbs");
  const shadeLeft = el("div", "ausboss-clip-window-shade");
  const shadeRight = el("div", "ausboss-clip-window-shade");
  const box = el("div", "ausboss-clip-window-box");
  box.tabIndex = 0;
  box.setAttribute("role", "slider");
  box.setAttribute("aria-label", "Part of the video to use");
  const edgeStart = el("span", "ausboss-clip-window-edge start");
  const edgeEnd = el("span", "ausboss-clip-window-edge end");
  box.append(edgeStart, edgeEnd);
  const empty = el("div", "ausboss-clip-window-empty", "Choose a video first");
  strip.append(thumbs, shadeLeft, shadeRight, box, empty);
  const readout = el("div", "ausboss-clip-window-readout");
  const hint = el("div", "ausboss-clip-window-hint");
  root.append(head, strip, readout, hint);

  const info = () => clipInfo(metadata());
  const limits = () => lengthLimits(number("min_seconds", get("min_seconds", 0)) ?? 0, number("max_seconds", get("max_seconds", 0)) ?? 0);
  const nth = () => Math.max(1, Math.trunc(Number(get("every_nth", 1)) || 1));
  const rate = () => {
    const known = outputRate?.();
    if (known > 0) return known;
    const clip = info();
    return clip.fps > 0 ? clip.fps / nth() : 0;
  };
  // The clip is set on the graph (a connected input, or an exact Fixed
  // frames count): the window shows nothing it cannot honour.
  const setOnGraph = () => GRAPH_SET.some((name) => driven(name)) || Number(get("fixed_frames", 0)) > 0;
  const current = () => clipWindowOf(info(), {
    start: get("start_seconds", 0),
    end: get("end_seconds", 0),
    cap: get("max_frames", 0),
    rate: rate(),
  }, limits());

  const rangeWords = () => {
    const { min, max } = limits();
    if (min > 0 && max > 0) return min === max ? `${secondsText(min)} s` : `${secondsText(min)} to ${secondsText(max)} s`;
    if (max > 0) return `up to ${secondsText(max)} s`;
    if (min > 0) return `at least ${secondsText(min)} s`;
    return "";
  };

  let stopText = "";
  let thumbsKey = "";
  const drawThumbs = () => {
    const clip = info();
    const board = storyboard?.();
    const width = Math.round(strip.clientWidth);
    const height = Math.round(strip.clientHeight);
    const key = `${width}x${height}:${board?.image?.src?.length ?? 0}:${board?.times?.length ?? 0}:${clip.duration}`;
    if (key === thumbsKey) return;
    thumbsKey = key;
    const scale = Math.min(2, window.devicePixelRatio || 1);
    thumbs.width = Math.max(1, Math.round(width * scale));
    thumbs.height = Math.max(1, Math.round(height * scale));
    const context = thumbs.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, thumbs.width, thumbs.height);
    if (!board?.image || !board.times?.length || !(clip.duration > 0) || !width) return;
    // Cells as wide as a tile drawn at the strip's height, each showing the
    // tile nearest its middle.
    const cellWidth = Math.max(24, (board.tileWidth / board.tileHeight) * height);
    const cells = Math.max(1, Math.ceil(width / cellWidth));
    const cell = thumbs.width / cells;
    for (let index = 0; index < cells; index++) {
      const moment = ((index + 0.5) / cells) * clip.duration;
      let tile = 0;
      for (let other = 1; other < board.times.length; other++) {
        if (Math.abs(board.times[other] - moment) < Math.abs(board.times[tile] - moment)) tile = other;
      }
      // Cover the cell: crop the tile's sides to the cell's shape.
      const sourceWidth = Math.min(board.tileWidth, (cell / thumbs.height) * board.tileHeight);
      const sourceX = tile * board.tileWidth + (board.tileWidth - sourceWidth) / 2;
      context.drawImage(board.image, sourceX, 0, sourceWidth, board.tileHeight, Math.floor(index * cell), 0, Math.ceil(cell), thumbs.height);
    }
  };

  const sync = () => {
    const clip = info();
    const window = clip.count ? current() : null;
    const off = !window || setOnGraph();
    strip.classList.toggle("is-off", off);
    empty.hidden = Boolean(window);
    box.hidden = !window;
    shadeLeft.hidden = shadeRight.hidden = !window;
    const range = rangeWords();
    if (!clip.count) {
      head.textContent = "";
      readout.textContent = "";
      hint.textContent = range ? `The clip will be ${range} long.` : "";
      hint.classList.remove("is-stop");
      thumbsKey = "";
      drawThumbs();
      return;
    }
    head.replaceChildren(el("b", "", `Your video: ${secondsText(clip.duration)} s long`));
    if (range) head.append(document.createTextNode(`· the clip is ${range} long`));
    if (!window) {
      readout.textContent = "";
      hint.textContent = "The clip length is known once the graph runs.";
      return;
    }
    const duration = clip.duration || clip.count / clip.fps;
    const left = Math.max(0, Math.min(1, window.start / duration));
    const right = Math.max(left, Math.min(1, (window.start + window.seconds) / duration));
    box.style.left = `${(left * 100).toFixed(3)}%`;
    box.style.width = `${((right - left) * 100).toFixed(3)}%`;
    shadeLeft.style.left = "0";
    shadeLeft.style.width = `${(left * 100).toFixed(3)}%`;
    shadeRight.style.left = `${(right * 100).toFixed(3)}%`;
    shadeRight.style.right = "0";
    box.classList.toggle("is-whole", window.whole || off);
    box.setAttribute("aria-valuemin", "0");
    box.setAttribute("aria-valuemax", String(Number(duration.toFixed(2))));
    box.setAttribute("aria-valuenow", String(Number(window.start.toFixed(2))));
    box.setAttribute("aria-valuetext", `${secondsText(window.seconds)} seconds from ${formatTimecode(window.start)}`);
    readout.textContent = window.whole
      ? `The whole video is used: ${lengthText(window.seconds)} s`
      : `${lengthText(window.seconds)} s used, starting at ${formatTimecode(Math.round(window.start * 10) / 10)}`;
    hint.classList.toggle("is-stop", Boolean(stopText));
    if (off) hint.textContent = "This clip is set on the graph, so it cannot be moved here.";
    else if (window.whole) hint.textContent = `The video is shorter than ${secondsText(limits().min)} s, so all of it is used.`;
    else if (stopText) hint.textContent = stopText;
    else hint.textContent = range
      ? `Drag the box to pick where it starts. Drag an edge to shorten it, never under ${secondsText(limits().min || 0)} s or over ${secondsText(limits().max || duration)} s.`
      : "Drag the box to pick where it starts. Drag an edge to change its length.";
    drawThumbs();
  };

  const store = (window) => {
    const values = clipWindowValues(window, info());
    if (!driven("fixed_frames") && Number(get("fixed_frames", 0)) !== 0) set("fixed_frames", 0);
    set("start_seconds", values.start_seconds);
    set("end_seconds", values.end_seconds);
    set("max_frames", values.max_frames);
  };

  // Why a drag stopped short of the pointer, in words.
  const stopWords = (zone, wanted, got) => {
    if (zone === "move" || Math.abs(wanted - got) < 0.5 / Math.max(1, rate())) return "";
    const range = limitFrameRange(limits(), rate());
    const frames = Math.round(got * rate());
    if (frames >= range.max) return `${secondsText(got)} s is the longest it can be.`;
    if (frames <= range.min) return `${secondsText(got)} s is the shortest it can be.`;
    return "The video ends there.";
  };

  // --- gestures ---------------------------------------------------------------
  let drag = null;
  const secondsAt = (event) => {
    const rect = strip.getBoundingClientRect();
    const clip = info();
    const duration = clip.duration || (clip.fps ? clip.count / clip.fps : 0);
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    return { seconds: rect.width > 0 ? (x / rect.width) * duration : 0, x, width: rect.width, duration };
  };
  const apply = (event, settled) => {
    if (!drag) return;
    const { seconds } = secondsAt(event);
    const target = drag.zone === "move" ? seconds - drag.grab : seconds;
    const next = dragClipWindow(drag.base, drag.zone, target, info(), limits());
    if (!next) return;
    const wantedLength = drag.zone === "end" ? seconds - drag.base.start
      : drag.zone === "start" ? drag.base.start + drag.base.seconds - seconds : next.seconds;
    stopText = stopWords(drag.zone, wantedLength, next.seconds);
    store(next);
    sync();
    if (settled) {
      onCommit?.();
      stopText = "";
      setTimeout(sync, 1600);
    }
  };
  strip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const window = info().count && !setOnGraph() ? current() : null;
    if (!window || window.whole) return;
    event.preventDefault();
    event.stopPropagation();
    const { seconds, width, duration } = secondsAt(event);
    const pxPerSecond = duration > 0 ? width / duration : 0;
    const startX = window.start * pxPerSecond;
    const endX = (window.start + window.seconds) * pxPerSecond;
    const x = seconds * pxPerSecond;
    const nearStart = Math.abs(x - startX) <= EDGE_HIT_PX;
    const nearEnd = Math.abs(x - endX) <= EDGE_HIT_PX;
    let zone;
    if (nearStart || nearEnd) zone = nearStart && nearEnd ? (x < (startX + endX) / 2 ? "start" : "end") : nearStart ? "start" : "end";
    else zone = "move";
    // A press outside the box brings the box there, centred on the press.
    const inside = x > startX && x < endX;
    const grab = zone !== "move" ? 0 : inside ? seconds - window.start : window.seconds / 2;
    drag = { zone, grab, base: window, pointerId: event.pointerId };
    strip.classList.toggle("is-moving", zone === "move");
    box.focus({ preventScroll: true });
    try { strip.setPointerCapture(event.pointerId); } catch { /* mouse fallback */ }
    apply(event, false);
  });
  strip.addEventListener("pointermove", (event) => {
    if (!drag) {
      const window = info().count && !setOnGraph() ? current() : null;
      if (!window || window.whole) { strip.style.cursor = ""; return; }
      const { seconds, width, duration } = secondsAt(event);
      const px = duration > 0 ? width / duration : 0;
      const near = Math.min(Math.abs(seconds - window.start), Math.abs(seconds - window.start - window.seconds)) * px <= EDGE_HIT_PX;
      strip.style.cursor = near ? "ew-resize" : "grab";
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    apply(event, false);
  });
  const finish = (event) => {
    if (!drag) return;
    if (event) apply(event, true);
    else onCommit?.();
    try { if (strip.hasPointerCapture(drag.pointerId)) strip.releasePointerCapture(drag.pointerId); } catch { /* released already */ }
    drag = null;
    strip.classList.remove("is-moving");
  };
  strip.addEventListener("pointerup", (event) => { event.stopPropagation(); finish(event); });
  strip.addEventListener("pointercancel", () => finish(null));
  strip.addEventListener("lostpointercapture", () => finish(null));

  // Arrow keys slide the box a second at a time; Shift moves one frame.
  box.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const window = info().count && !setOnGraph() ? current() : null;
    if (!window || window.whole) return;
    event.preventDefault();
    event.stopPropagation();
    const clip = info();
    const step = event.shiftKey && clip.fps > 0 ? 1 / clip.fps : 1;
    const target = event.key === "Home" ? 0 : event.key === "End" ? Infinity
      : window.start + (event.key === "ArrowLeft" ? -step : step);
    store(dragClipWindow(window, "move", Number.isFinite(target) ? target : clip.duration, clip, limits()));
    sync();
    onCommit?.();
  });

  new ResizeObserver(() => drawThumbs()).observe(strip);
  sync();
  return { root, sync };
}
