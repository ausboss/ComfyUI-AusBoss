// The video timeline the transform nodes share, on the node face and in the
// editor: one rail with a playhead, and on the clip node the IN/OUT handles
// around it. Frame arithmetic lives in timeline_math.mjs (tested); this
// file is the DOM.
//
// Interaction, in the words of a video editor: press or drag anywhere on
// the rail to scrub the playhead - the stage shows that frame. Drag an IN
// or OUT handle to trim; the playhead rides along on the handle, so the
// frame on the stage is the first (IN) or last (OUT) frame the run keeps,
// and stays there on release. IN, OUT and the playhead are frames, snapped
// to the source's own frame grid; the seconds the widgets store are derived
// from them and round-trip exactly.
import { makeScrubInput } from "./scrub_input.mjs";
import { formatTimecode } from "./timecode.mjs";
import {
  boundaryAtFraction,
  clampFrame,
  clipInfo,
  dragTrimBoundary,
  formatFps,
  fractionOfFrame,
  frameAtFraction,
  frameTime,
  frameWindow,
  keptEndFraction,
  keptFrames,
  keyboardStep,
  setTrimFrame,
  windowSeconds,
} from "./timeline_math.mjs";

const CSS_ID = "ausboss-transform-trim-css-v2";
const HANDLE_HIT_PX = 9;

function installCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
    .ausboss-transform-trim{flex:none;display:flex;flex-direction:column;gap:8px;min-width:0;padding:9px 10px 8px;border:1px solid #164b49;border-radius:8px;background:#0e1718;color:#cadddb;font:11px system-ui;box-sizing:border-box;overflow:hidden}
    .ausboss-transform-trim-rail{position:relative;height:28px;margin:0 6px;touch-action:none;cursor:pointer;user-select:none}
    .ausboss-transform-trim-rail.is-disabled{opacity:.45;cursor:default}
    .ausboss-transform-trim-rail:before{content:"";position:absolute;left:0;right:0;top:11px;height:6px;border-radius:4px;background:#293637}
    .ausboss-transform-trim-span{position:absolute;top:11px;height:6px;border-radius:4px;background:rgba(0,180,170,.3);pointer-events:none}
    .ausboss-transform-trim-kept{position:absolute;top:11px;height:6px;border-radius:4px;background:#00b4aa;pointer-events:none}
    .ausboss-transform-trim-handle{position:absolute!important;top:2px;width:12px!important;height:24px;min-width:0;padding:0!important;margin:0!important;transform:translateX(-50%);border:2px solid #00b4aa!important;border-radius:4px!important;background:#e5fffc!important;cursor:ew-resize;touch-action:none;z-index:2}
    .ausboss-transform-trim-handle:focus-visible{outline:2px solid white;outline-offset:2px}
    .ausboss-transform-trim-playhead{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:#f4fffd;box-shadow:0 0 0 1px rgba(0,0,0,.55);pointer-events:none;z-index:3}
    .ausboss-transform-trim-playhead:before{content:"";position:absolute;top:-1px;left:50%;transform:translateX(-50%);border:5px solid transparent;border-top:6px solid #f4fffd;filter:drop-shadow(0 0 1px rgba(0,0,0,.7))}
    .ausboss-transform-trim-line{display:flex;align-items:center;gap:7px;min-width:0}
    .ausboss-transform-trim-line.wrap{flex-wrap:wrap;row-gap:6px}
    .ausboss-transform-trim-line label{display:flex;align-items:center;gap:5px;white-space:nowrap}
    .ausboss-transform-trim-line .spacer{flex:1 1 0;min-width:0}
    .ausboss-transform-trim-line .ausboss-scrub{width:64px}
    .ausboss-transform-trim-line select{background:#1b2627;color:#e5fffc;border:1px solid #2c4d4b;border-radius:5px;padding:3px 4px;font:11px system-ui;cursor:pointer;flex:none}
    .ausboss-transform-trim-line select:focus-visible{outline:2px solid #00b4aa;outline-offset:1px}
    .ausboss-transform-trim-line .ausboss-scrub-step button{font-size:8px}
    .ausboss-transform-trim-caption{color:#00b4aa;font-weight:650;font-size:10px;letter-spacing:.06em}
    .ausboss-transform-trim-readout{flex:1 1 0;min-width:0;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#8ca8a5;font-variant-numeric:tabular-nums}
    .ausboss-transform-trim-readout b{color:#e5fffc;font-weight:600}
    .ausboss-transform-trim-summary{flex:1 1 0;min-width:0;color:#8ca8a5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
    .ausboss-transform-trim-reset{flex:none;border:0;background:transparent;color:#8ca8a5;font:11px system-ui;cursor:pointer;padding:0}
    .ausboss-transform-trim-reset:hover{color:#e5fffc}
  `;
  document.head.append(style);
}

function el(tag, className = "", text = "") {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text) item.textContent = text;
  return item;
}

const pct = (fraction) => `${(fraction * 100).toFixed(3)}%`;

// options:
//   get(name, fallback) / set(name, value)  widget access
//   has(name)                                whether a widget exists
//   metadata()                               the source's {fps, frame_count, duration}
//   trim                                     IN/OUT handles and the sampling rows
//                                            (the clip node) or playhead only
//   onSeek(frame, settled)                   the playhead moved; settled on release
//   onCommit()                               a stored value settled (undo point)
export function mountTransformTrim({ get, set, has = () => true, metadata, trim = true, onSeek, onCommit }) {
  installCss();
  const root = el("div", "ausboss-transform-trim");
  const rail = el("div", "ausboss-transform-trim-rail");
  const span = el("div", "ausboss-transform-trim-span");
  const kept = el("div", "ausboss-transform-trim-kept");
  const playhead = el("div", "ausboss-transform-trim-playhead");
  const handles = {};
  if (trim) rail.append(span, kept);
  rail.append(playhead);

  const info = () => clipInfo(metadata());
  const currentWindow = () => {
    const clip = info();
    return trim ? frameWindow(clip, get("start_seconds", 0), get("end_seconds", 0)) : { first: 0, last: Math.max(0, clip.count - 1) };
  };
  const playheadFrame = () => clampFrame(get("frame_index", 0), info());
  const controls = {};

  const seek = (frame, settled) => {
    onSeek?.(clampFrame(frame, info()), settled);
    sync();
  };
  const writeWindow = (next) => {
    const seconds = windowSeconds(info(), next.first, next.last);
    set("start_seconds", seconds.start_seconds);
    set("end_seconds", seconds.end_seconds);
    return next;
  };
  // A trim edge moved: store it and park the playhead on that edge's
  // frame, so the stage shows the first or last frame the run keeps.
  const moveEdge = (edge, next, settled) => {
    writeWindow(next);
    seek(edge === "start" ? next.first : next.last, settled);
    if (settled) onCommit?.();
  };

  const readout = el("span", "ausboss-transform-trim-readout");
  const summary = el("div", "ausboss-transform-trim-summary");

  const sync = () => {
    const clip = info();
    const window = currentWindow();
    const head = playheadFrame();
    rail.classList.toggle("is-disabled", !clip.count);
    playhead.style.left = pct(fractionOfFrame(head, clip, "center"));
    playhead.style.visibility = clip.count ? "" : "hidden";
    readout.replaceChildren();
    if (clip.count) {
      readout.append(el("b", "", `fr ${head}`), document.createTextNode(` · ${formatTimecode(frameTime(head, clip))}`));
      readout.title = `Playhead: frame ${head} of ${clip.count} at ${frameTime(head, clip).toFixed(3)} s. Press or drag the rail to scrub; ${trim ? "the trim handles carry it with them." : "this is the frame the node outputs."}`;
    }
    controls.frame?.set(head);
    if (!trim) return;
    const keep = keptFrames(window, get("every_nth", 1), get("max_frames", 0), get("frame_snap", "free"));
    const startFraction = fractionOfFrame(window.first, clip, "start");
    const endFraction = fractionOfFrame(window.last, clip, "end");
    span.style.left = pct(startFraction);
    span.style.width = pct(Math.max(0, endFraction - startFraction));
    kept.style.left = pct(startFraction);
    kept.style.width = pct(Math.max(0, keptEndFraction(window, keep, clip) - startFraction));
    for (const edge of ["start", "end"]) {
      const handle = handles[edge];
      const frame = edge === "start" ? window.first : window.last;
      handle.style.left = pct(edge === "start" ? startFraction : endFraction);
      handle.disabled = !clip.count;
      handle.setAttribute("aria-valuemin", "0");
      handle.setAttribute("aria-valuemax", String(Math.max(0, clip.count - 1)));
      handle.setAttribute("aria-valuenow", String(frame));
      handle.setAttribute("aria-valuetext", `frame ${frame}, ${formatTimecode(frameTime(frame, clip))}`);
    }
    controls.start_seconds?.set(window.first);
    controls.end_seconds?.set(window.last);
    controls.every_nth?.set(get("every_nth", 1));
    controls.max_frames?.set(get("max_frames", 0));
    if (controls.frame_snap) controls.frame_snap.value = String(get("frame_snap", "free"));
    if (!clip.count) {
      summary.textContent = "Choose a source to set the clip window";
      summary.title = "";
      return;
    }
    const count = keep.cut ? `${keep.frames} of ${keep.total} frames` : `${keep.frames} frames`;
    const from = formatTimecode(frameTime(window.first, clip));
    const to = formatTimecode((keep.lastKept + 1) / clip.fps);
    summary.textContent = `${count} @ ${formatFps(clip.fps / keep.nth)} fps · ${from} → ${to}`;
    summary.title = keep.cut
      ? `The window holds ${keep.total} frames; every nth, the frame limit or the snap rule keep ${keep.frames} of them, ending at frame ${keep.lastKept}. The bright part of the bar is what the run outputs.`
      : "Frames the run outputs, at the fps the node reports. Counts are estimated from the source's frame rate.";
  };

  // --- rail gestures --------------------------------------------------------
  const hit = (event) => {
    const box = rail.getBoundingClientRect();
    const width = Math.max(1, box.width);
    const x = Math.max(0, Math.min(width, event.clientX - box.left));
    const fraction = x / width;
    if (!trim) return { fraction, zone: "playhead" };
    if (event.target === handles.start) return { fraction, zone: "start" };
    if (event.target === handles.end) return { fraction, zone: "end" };
    const clip = info();
    const window = currentWindow();
    const inX = fractionOfFrame(window.first, clip, "start") * width;
    const outX = fractionOfFrame(window.last, clip, "end") * width;
    const toIn = Math.abs(x - inX);
    const toOut = Math.abs(x - outX);
    // Screen pixels, so the zone keeps its size whatever the graph zoom.
    // Handles stacked on one spot split by side: left of them is IN.
    let zone = "playhead";
    if (Math.min(toIn, toOut) <= HANDLE_HIT_PX) zone = toIn < toOut || (toIn === toOut && x <= inX) ? "start" : "end";
    return { fraction, zone };
  };
  const applyPointer = (zone, fraction, settled) => {
    const clip = info();
    if (zone === "playhead") { seek(frameAtFraction(fraction, clip), settled); return; }
    moveEdge(zone, dragTrimBoundary(currentWindow(), zone, boundaryAtFraction(fraction, clip), clip), settled);
  };
  let drag = null;
  rail.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !info().count) return;
    event.preventDefault(); event.stopPropagation();
    const { fraction, zone } = hit(event);
    drag = { zone, fraction, pointerId: event.pointerId };
    try { rail.setPointerCapture(event.pointerId); } catch { /* mouse fallback */ }
    applyPointer(zone, fraction, false);
  });
  rail.addEventListener("pointermove", (event) => {
    if (!drag) {
      const { zone } = info().count ? hit(event) : { zone: "playhead" };
      rail.style.cursor = zone === "playhead" ? "pointer" : "ew-resize";
      return;
    }
    event.preventDefault(); event.stopPropagation();
    drag.fraction = hit(event).fraction;
    applyPointer(drag.zone, drag.fraction, false);
  });
  const finish = (event) => {
    if (!drag) return;
    const { zone, fraction, pointerId } = drag;
    drag = null;
    try { if (rail.hasPointerCapture(pointerId)) rail.releasePointerCapture(pointerId); } catch { /* released already */ }
    if (event?.type === "pointerup") event.stopPropagation();
    applyPointer(zone, fraction, true);
  };
  rail.addEventListener("pointerup", finish);
  rail.addEventListener("pointercancel", finish);
  rail.addEventListener("lostpointercapture", () => finish(null));

  // --- trim handles ---------------------------------------------------------
  if (trim) {
    for (const edge of ["start", "end"]) {
      const handle = el("button", "ausboss-transform-trim-handle");
      handle.type = "button";
      handle.setAttribute("role", "slider");
      handle.setAttribute("aria-label", edge === "start" ? "Clip IN" : "Clip OUT");
      handle.title = `Drag ${edge === "start" ? "IN" : "OUT"} to trim; the stage shows that frame. Arrow keys move one second, Shift one frame.`;
      handle.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const clip = info();
        if (!clip.count) return;
        const window = currentWindow();
        const current = edge === "start" ? window.first : window.last;
        const step = keyboardStep(clip, event.shiftKey) * (event.key === "ArrowLeft" ? -1 : 1);
        const target = event.key === "Home" ? 0 : event.key === "End" ? clip.count - 1 : current + step;
        moveEdge(edge, setTrimFrame(window, edge, target, clip), true);
      });
      handles[edge] = handle;
      rail.append(handle);
    }
  }

  // --- rows -----------------------------------------------------------------
  const timeRow = el("div", "ausboss-transform-trim-line");
  if (trim) {
    for (const [name, caption, edge] of [["start_seconds", "IN", "start"], ["end_seconds", "OUT", "end"]]) {
      const label = el("label");
      label.append(el("span", "ausboss-transform-trim-caption", caption));
      controls[name] = makeScrubInput({
        value: 0, min: 0, max: 10000000, step: 1, decimals: 0,
        title: `${caption} frame: the ${edge === "start" ? "first" : "last"} frame the run keeps (stored as ${name}).`,
        onChange: (frame) => moveEdge(edge, setTrimFrame(currentWindow(), edge, frame, info()), false),
        onSettle: () => { const window = currentWindow(); seek(edge === "start" ? window.first : window.last, true); onCommit?.(); },
      });
      label.append(controls[name].root);
      timeRow.append(label);
      if (edge === "start") timeRow.append(readout);
    }
  } else {
    const label = el("label");
    label.append(el("span", "ausboss-transform-trim-caption", "FRAME"));
    controls.frame = makeScrubInput({
      value: 0, min: 0, max: 10000000, step: 1, decimals: 0,
      title: "The frame this node outputs (frame_index).",
      onChange: (frame) => seek(frame, false),
      onSettle: () => seek(playheadFrame(), true),
    });
    label.append(controls.frame.root);
    timeRow.append(label, readout);
  }
  root.append(rail, timeRow);

  if (trim) {
    const sampling = el("div", "ausboss-transform-trim-line wrap");
    for (const [name, caption, min, max, tip] of [
      ["every_nth", "Every nth", 1, 512, "Keep one frame in this many. Output fps is adjusted to keep real-time playback."],
      ["max_frames", "Limit", 0, 100000, "Maximum returned frames. 0 keeps the whole selection."],
    ]) {
      const label = el("label", "", caption);
      controls[name] = makeScrubInput({ value: get(name, min), min, max, step: 1, decimals: 0, title: tip,
        onChange: (next) => { set(name, next); sync(); }, onSettle: onCommit,
      });
      label.append(controls[name].root);
      sampling.append(label);
      if (name === "every_nth") sampling.append(el("span", "spacer"));
    }
    if (has("frame_snap")) {
      // Video models keep 8n+1 (LTX) or 4n+1 (Wan) frames and drop the
      // rest; snapping here keeps the clip, its audio, and its stitcher the
      // same length as what comes back from the sampler.
      const label = el("label", "", "Snap");
      label.style.marginLeft = "auto";
      const select = el("select");
      select.title = "Drop trailing frames to a count video models keep: 8n+1 for LTX, 4n+1 for Wan. Free keeps every frame.";
      for (const rule of ["free", "8n+1", "4n+1"]) {
        const option = el("option", "", rule); option.value = rule; select.append(option);
      }
      select.addEventListener("change", () => { set("frame_snap", select.value); sync(); onCommit?.(); });
      controls.frame_snap = select;
      label.append(select);
      sampling.append(label);
    }
    const footer = el("div", "ausboss-transform-trim-line");
    const reset = el("button", "ausboss-transform-trim-reset", "Full clip");
    reset.type = "button";
    reset.title = "Reset IN/OUT to the full source. Keeps frame skipping and the frame limit.";
    reset.addEventListener("click", () => { set("start_seconds", 0); set("end_seconds", 0); sync(); onCommit?.(); });
    footer.append(summary, reset);
    root.append(sampling, footer);
  }
  root.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button,input,select")) event.stopPropagation();
  });
  sync();
  return { root, sync, info, window: currentWindow };
}
