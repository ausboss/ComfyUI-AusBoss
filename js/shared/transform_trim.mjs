import { makeScrubInput } from "./scrub_input.mjs";
import { dragTrimHandle, loadSummary, trimBounds, trimFractions } from "../load_video/trim_preview.mjs";

export function mountTransformTrim({ get, set, has = () => true, metadata, onSeek, onCommit }) {
  if (!document.getElementById("ausboss-transform-trim-css")) {
    const style = document.createElement("style");
    style.id = "ausboss-transform-trim-css";
    style.textContent = `
      .ausboss-transform-trim{flex:none;display:flex;flex-direction:column;gap:9px;min-width:0;padding:10px;border:1px solid #164b49;border-radius:8px;background:#0e1718;color:#cadddb;font:11px system-ui;box-sizing:border-box;overflow:hidden}
      .ausboss-transform-trim-rail{position:relative;height:24px;margin:0 6px;touch-action:none;cursor:ew-resize}
      .ausboss-transform-trim-rail:before{content:"";position:absolute;left:0;right:0;top:9px;height:6px;border-radius:4px;background:#293637}
      .ausboss-transform-trim-span{position:absolute;top:9px;height:6px;background:#00b4aa;border-radius:4px;pointer-events:none}
      .ausboss-transform-trim-handle{position:absolute!important;top:0;width:12px!important;height:24px;min-width:0;padding:0!important;margin:0!important;transform:translateX(-50%);border:2px solid #00b4aa!important;border-radius:4px!important;background:#e5fffc!important;cursor:ew-resize;touch-action:none}
      .ausboss-transform-trim-handle:focus-visible{outline:2px solid white;outline-offset:2px}
      .ausboss-transform-trim-line{display:flex;align-items:center;gap:7px;min-width:0}
      .ausboss-transform-trim-line label{display:flex;align-items:center;gap:5px;white-space:nowrap}
      .ausboss-transform-trim-line .spacer{flex:1;min-width:0}
      .ausboss-transform-trim-line .ausboss-scrub{width:68px}
      .ausboss-transform-trim-line select{background:#1b2627;color:#e5fffc;border:1px solid #2c4d4b;border-radius:5px;padding:3px 4px;font:11px system-ui;cursor:pointer}
      .ausboss-transform-trim-line select:focus-visible{outline:2px solid #00b4aa;outline-offset:1px}
      .ausboss-transform-trim-line .ausboss-scrub-step button{font-size:8px}
      .ausboss-transform-trim-caption{color:#00b4aa;font-weight:650;font-size:10px;letter-spacing:.06em}
      .ausboss-transform-trim-summary{color:#8ca8a5;white-space:normal;font-variant-numeric:tabular-nums}
      .ausboss-transform-trim-reset{border:0;background:transparent;color:#8ca8a5;font:11px system-ui;cursor:pointer;padding:0}
    `;
    document.head.append(style);
  }
  const el = (tag, className = "", text = "") => {
    const item = document.createElement(tag); item.className = className; item.textContent = text; return item;
  };
  const root = el("div", "ausboss-transform-trim");
  const rail = el("div", "ausboss-transform-trim-rail");
  const span = el("div", "ausboss-transform-trim-span");
  const handles = {};
  rail.append(span);
  const duration = () => Number(metadata()?.duration) || 0;
  const bounds = () => trimBounds(duration(), get("start_seconds", 0), get("end_seconds", 0));
  const frameStep = () => 1 / Math.max(1, metadata()?.fps || 30);
  const controls = {};
  const summary = el("div", "ausboss-transform-trim-summary");
  const sync = () => {
    const window = bounds(); const fractions = trimFractions(duration(), window);
    span.style.left = `${fractions.start * 100}%`;
    span.style.width = `${(fractions.end - fractions.start) * 100}%`;
    for (const edge of ["start", "end"]) {
      const handle = handles[edge];
      handle.style.left = `${fractions[edge] * 100}%`;
      handle.disabled = duration() <= 0;
      handle.setAttribute("aria-valuemin", "0");
      handle.setAttribute("aria-valuemax", String(duration()));
      handle.setAttribute("aria-valuenow", String(Number.isFinite(window[edge]) ? window[edge] : 0));
      handle.setAttribute("aria-valuetext", `${Number.isFinite(window[edge]) ? window[edge].toFixed(3) : "end"} seconds`);
    }
    controls.start_seconds?.set(get("start_seconds", 0));
    controls.end_seconds?.set(get("end_seconds", 0) || duration());
    controls.every_nth?.set(get("every_nth", 1));
    controls.max_frames?.set(get("max_frames", 0));
    if (controls.frame_snap) controls.frame_snap.value = String(get("frame_snap", "free"));
    const estimate = loadSummary(duration(), window, metadata()?.fps, get("every_nth", 1), get("max_frames", 0), false, get("frame_snap", "free"));
    summary.textContent = estimate ? `Est. ${estimate} · ${(window.end - window.start).toFixed(2)}s selected` : "Choose a source to set the clip window";
    summary.title = "Estimated from source fps; decoded frame count may differ for variable-rate videos. A frame limit can shorten the selected window. Preview position does not change the output.";
  };
  const apply = (edge, seconds, settled = false) => {
    const total = duration();
    if (!Number.isFinite(seconds)) seconds = get(`${edge}_seconds`, 0);
    if (total <= 0) {
      set(`${edge}_seconds`, Math.max(0, seconds));
    } else {
      const next = dragTrimHandle(total, bounds(), edge, seconds / total, frameStep());
      set("start_seconds", Number(next.start.toFixed(6)));
      set("end_seconds", next.end >= total - 0.000001 ? 0 : Number(next.end.toFixed(6)));
      const preview = edge === "start" ? next.start : Math.max(next.start, next.end - frameStep());
      onSeek?.(preview, settled);
    }
    sync();
    if (settled) onCommit?.();
  };
  for (const edge of ["start", "end"]) {
    const handle = el("button", "ausboss-transform-trim-handle");
    handle.type = "button"; handle.setAttribute("role", "slider");
    handle.setAttribute("aria-label", edge === "start" ? "Clip IN" : "Clip OUT");
    handle.title = `Drag ${edge === "start" ? "IN" : "OUT"} to trim. Arrow keys move one second; Shift moves one frame.`;
    handle.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const delta = (event.shiftKey ? frameStep() : 1) * (event.key === "ArrowLeft" ? -1 : 1);
      apply(edge, event.key === "Home" ? 0 : event.key === "End" ? duration() : bounds()[edge] + delta, true);
    });
    handles[edge] = handle; rail.append(handle);
  }
  let drag = null;
  const pointerTime = (event) => {
    const box = rail.getBoundingClientRect();
    return Math.max(0, Math.min(1, (event.clientX - box.left) / Math.max(1, box.width))) * duration();
  };
  rail.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || duration() <= 0) return;
    event.preventDefault(); event.stopPropagation();
    const seconds = pointerTime(event); const window = bounds();
    drag = event.target === handles.start ? "start" : event.target === handles.end ? "end"
      : Math.abs(seconds - window.start) <= Math.abs(seconds - window.end) ? "start" : "end";
    rail.setPointerCapture(event.pointerId); apply(drag, seconds);
  });
  rail.addEventListener("pointermove", (event) => {
    if (!drag) return; event.preventDefault(); event.stopPropagation(); apply(drag, pointerTime(event));
  });
  const finish = (event) => {
    if (!drag) return;
    const edge = drag; drag = null;
    if (rail.hasPointerCapture(event.pointerId)) rail.releasePointerCapture(event.pointerId);
    apply(edge, bounds()[edge], true);
  };
  rail.addEventListener("pointerup", finish);
  rail.addEventListener("pointercancel", finish);
  const timeRow = el("div", "ausboss-transform-trim-line");
  for (const [name, caption, edge] of [["start_seconds", "IN", "start"], ["end_seconds", "OUT", "end"]]) {
    const label = el("label"); label.append(el("span", "ausboss-transform-trim-caption", caption));
    controls[name] = makeScrubInput({ value: get(name, 0), min: 0, max: 86400, step: 0.1, fineStep: 0.01, decimals: 3,
      title: `${caption} in seconds. OUT = 0 means the end of the source.`,
      onChange: (seconds) => apply(edge, seconds === 0 && edge === "end" ? duration() : seconds),
      onSettle: () => apply(edge, bounds()[edge], true),
    });
    label.append(controls[name].root); timeRow.append(label);
    if (edge === "start") timeRow.append(el("span", "spacer"));
  }
  const sampling = el("div", "ausboss-transform-trim-line");
  for (const [name, caption, min, max, tip] of [
    ["every_nth", "Every nth", 1, 512, "Keep one frame in this many. Output fps is adjusted to keep real-time playback."],
    ["max_frames", "Limit", 0, 100000, "Maximum returned frames. 0 keeps the whole selection."],
  ]) {
    const label = el("label", "", caption);
    controls[name] = makeScrubInput({ value: get(name, min), min, max, step: 1, decimals: 0, title: tip,
      onChange: (next) => { set(name, next); sync(); }, onSettle: onCommit,
    });
    label.append(controls[name].root); sampling.append(label);
    if (name === "every_nth") sampling.append(el("span", "spacer"));
  }
  if (has("frame_snap")) {
    // Video models keep 8n+1 (LTX) or 4n+1 (Wan) frames and drop the rest;
    // snapping here keeps the clip, its audio, and its stitcher the same
    // length as what comes back from the sampler.
    const label = el("label", "", "Snap");
    const select = el("select");
    select.title = "Drop trailing frames to a count video models keep: 8n+1 for LTX, 4n+1 for Wan. Free keeps every frame.";
    for (const rule of ["free", "8n+1", "4n+1"]) {
      const option = el("option", "", rule); option.value = rule; select.append(option);
    }
    select.addEventListener("change", () => { set("frame_snap", select.value); sync(); onCommit?.(); });
    controls.frame_snap = select;
    label.append(select); sampling.append(el("span", "spacer"), label);
  }
  const footer = el("div", "ausboss-transform-trim-line");
  const reset = el("button", "ausboss-transform-trim-reset", "Full clip"); reset.type = "button";
  reset.title = "Reset IN/OUT to the full source. Keeps frame skipping and the frame limit.";
  reset.addEventListener("click", () => { set("start_seconds", 0); set("end_seconds", 0); sync(); onCommit?.(); });
  footer.append(summary, el("span", "spacer"), reset);
  root.append(rail, timeRow, sampling, footer);
  root.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button,input")) event.stopPropagation();
  });
  sync();
  return { root, sync };
}
