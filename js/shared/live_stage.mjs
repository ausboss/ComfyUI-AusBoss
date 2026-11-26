// The live preview on Film Grain, Keep Detail and Cut Out: the picture on the
// node redraws while a value is dragged, before any run.
//
// It lives inside the node's preview panel (js/input_preview/index.js) and
// takes the stage over while it can draw. Two views, chosen with the Fit |
// 100% switch on the panel's bar:
//
//   Fit    the whole picture, worked out on a copy shrunk to the size it is
//          shown at (js/shared/live_view_math.mjs fitGeometry)
//   100%   a window of real pixels; dragging on the picture pans it
//
// The maths is the nodes' own, in the browser (live_grain.mjs,
// live_detail.mjs, live_cutout.mjs; tests/live_preview.test.mjs holds it to
// the Python's numbers). The pictures come from a Load Image through
// ComfyUI's /view route, or, for any other source, from the copy the node
// wrote with its last run (live_sources.mjs). A "not run yet" tag shows
// whenever what is drawn is not what the last run made; once the values match
// a run, that run's own picture is shown instead.
//
// Where the browser will not hand the page a picture's pixels (a privacy
// setting), the stage stays as it was and shows the run's result.
import { FONT_UI, RADIUS_XS, THEME as T } from "./theme.mjs";
import { CHECKER } from "./compare_erase.mjs";
import { panelSwitch } from "./panel_controls.mjs";
import { chainCallback } from "./index.mjs";
import { makeImage } from "./live_image.mjs";
import { autoGrain, measureNoise } from "./live_grain.mjs";
import { KINDS, drawKind, num, reachOf } from "./live_kinds.mjs";
import { cropGeometry, fitGeometry, insideOf, paddedWindow, runIsCurrent, valuesSignature } from "./live_view_math.mjs";
import { connectionKey, keptQuery, loadPixels, lumaImage, planInput, scaledImage, windowImage } from "./live_sources.mjs";
import { copiesGrain, setAuto } from "./grain_auto.mjs";

const CSS_ID = "ausboss-live-stage-css";
const VIEW_PROPERTY = "ausboss_live_view";
const RUN_ONCE = "Run once to get the picture. Then it changes as you drag.";
const RUN_ONCE_MASK = "Run once to get the mask. Then it changes as you drag.";
const RUN_ONCE_MATCH = "Run once to match the grain. Then it changes as you drag.";

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-input-preview-stage canvas.ausboss-live-canvas{display:none;position:absolute;inset:0;margin:auto;max-width:none;max-height:none;pointer-events:none;image-rendering:auto}
.ausboss-input-preview-stage.live-on canvas.ausboss-live-canvas{display:block}
.ausboss-input-preview-stage.live-on img,.ausboss-input-preview-stage.live-on video,.ausboss-input-preview-stage.live-on .ausboss-input-preview-hint{display:none!important}
.ausboss-input-preview-stage.checker canvas.ausboss-live-canvas{background-image:repeating-conic-gradient(${CHECKER.light} 0 25%,${CHECKER.dark} 0 50%);background-size:${CHECKER.side * 2}px ${CHECKER.side * 2}px}
.ausboss-input-preview-stage.live-pan canvas.ausboss-live-canvas{pointer-events:auto;cursor:grab;touch-action:none}
.ausboss-input-preview-stage.live-pan.panning canvas.ausboss-live-canvas{cursor:grabbing}
.ausboss-live-tag,.ausboss-live-look{display:none;position:absolute;z-index:3;padding:2px 7px;border-radius:999px;background:${T.card};color:${T.inkSoft};font:600 10px/1.3 ${FONT_UI};pointer-events:none;white-space:nowrap}
.ausboss-live-tag{left:6px;top:6px}
.ausboss-live-look{left:50%;bottom:6px;transform:translateX(-50%);color:${T.label}}
.ausboss-input-preview-stage.live-on .ausboss-live-tag.show,.ausboss-input-preview-stage.live-on.live-pan .ausboss-live-look.show{display:block}
.ausboss-panel-switch.ausboss-live-view{gap:0;margin-left:auto;padding:2px;min-height:20px;border-radius:${RADIUS_XS}px;background:${T.fill};color:${T.label}}
.ausboss-live-view + .ausboss-panel-switch{margin-left:6px}
.ausboss-live-view span{padding:2px 7px;border-radius:${RADIUS_XS - 1}px;font:600 10.5px/1.2 ${FONT_UI}}
.ausboss-live-view[aria-checked=false] .fit,.ausboss-live-view[aria-checked=true] .full{background:${T.brand};color:${T.onBrand}}
.ausboss-live-view.faded{opacity:.4;pointer-events:none}
`;
  document.head.append(style);
}

const widgetValue = (node, name) => node.widgets?.find((widget) => widget?.name === name)?.value;
const imageData = (image) => {
  const out = new Uint8ClampedArray(image.w * image.h * 4);
  for (let i = 0; i < image.w * image.h; i += 1) {
    for (let k = 0; k < 3; k += 1) out[i * 4 + k] = Math.round(image.data[i * image.c + (image.c === 1 ? 0 : k)] * 255);
    out[i * 4 + 3] = image.c === 4 ? Math.round(image.data[i * 4 + 3] * 255) : 255;
  }
  return new ImageData(out, image.w, image.h);
};

// ---------- the stage ----------

export function mountLive(state, kind, hooks) {
  ensureCss();
  const spec = KINDS[kind];
  const node = state.node;
  const names = spec.inputs.map((input) => input.name);
  const live = {
    kind, spec, node, state, alive: true, hooks,
    pan: null,           // 100%: the window's top-left in picture pixels
    pix: {},             // name -> { key, pixels }
    noise: new Map(),    // pixel key -> measured noise
    loadedKey: "",
    loadingKey: "",
    broken: "",          // a key that could not be read: the stage stays as it was
    drawnKey: "",
    drawn: false,
    run: null,           // { record, key, sig }: the last run, as first seen here
    raf: 0,
    timer: 0,
    cooldown: 0,
  };
  node.__ausbossLive = live;
  node.properties ??= {};

  const canvas = document.createElement("canvas");
  canvas.className = "ausboss-live-canvas";
  const tag = Object.assign(document.createElement("div"), { className: "ausboss-live-tag", textContent: "not run yet" });
  const look = Object.assign(document.createElement("div"), { className: "ausboss-live-look", textContent: "drag to look around" });
  state.stage.append(canvas, tag, look);
  live.canvas = canvas;

  // Fit | 100%, left of Preview. A switch (role=switch) that reads Fit when
  // off and 100% when on, drawn as two segments.
  const view = panelSwitch("", "Fit shows the whole picture. 100% shows real pixels; drag the picture to look around.");
  view.classList.add("ausboss-live-view", "faded");
  const fit = Object.assign(document.createElement("span"), { className: "fit", textContent: "Fit" });
  const full = Object.assign(document.createElement("span"), { className: "full", textContent: "100%" });
  view.replaceChildren(fit, full);
  view.setAttribute("aria-label", "Picture view: Fit or 100%");
  view.addEventListener("pointerdown", (event) => event.stopPropagation(), { signal: state.abort.signal });
  view.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    node.properties[VIEW_PROPERTY] = mode(live) === "100" ? "fit" : "100";
    live.pan = null;
    syncView(live);
    schedule(live);
  }, { signal: state.abort.signal });
  state.bar.insertBefore(view, state.switchButton ?? null);
  live.viewSwitch = view;
  live.tag = tag;
  live.look = look;
  syncView(live);

  // Dragging on the picture pans it (100% only). The node itself still moves
  // by its title: nothing here listens to the wheel, so it keeps zooming the graph.
  let drag = null;
  canvas.addEventListener("pointerdown", (event) => {
    if (mode(live) !== "100" || event.button !== 0 || !live.geo) return;
    event.preventDefault();
    event.stopPropagation();
    canvas.setPointerCapture?.(event.pointerId);
    drag = { x: event.clientX, y: event.clientY, from: { x: live.geo.x, y: live.geo.y } };
    state.stage.classList.add("panning");
    live.looked = true;
    look.classList.remove("show");
  }, { signal: state.abort.signal });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag || !live.geo) return;
    // The graph can be zoomed: a screen pixel is not a stage pixel.
    const box = canvas.getBoundingClientRect();
    const ratio = canvas.offsetWidth > 0 && box.width > 0 ? box.width / canvas.offsetWidth : 1;
    live.pan = { x: drag.from.x - (event.clientX - drag.x) / ratio, y: drag.from.y - (event.clientY - drag.y) / ratio };
    schedule(live);
  }, { signal: state.abort.signal });
  const endDrag = (event) => {
    if (!drag) return;
    drag = null;
    state.stage.classList.remove("panning");
    canvas.releasePointerCapture?.(event.pointerId);
  };
  canvas.addEventListener("pointerup", endDrag, { signal: state.abort.signal });
  canvas.addEventListener("pointercancel", endDrag, { signal: state.abort.signal });

  // Every value the picture depends on redraws it as it changes.
  const watch = () => {
    for (const name of spec.values) {
      const widget = node.widgets?.find((item) => item?.name === name);
      if (!widget || widget.__ausbossLiveWatch) continue;
      widget.__ausbossLiveWatch = true;
      chainCallback(widget, "callback", () => { if (live.alive) schedule(live); });
    }
  };
  live.watch = watch;
  watch();
  chainCallback(node, "onConfigure", () => queueMicrotask(() => { if (live.alive) { watch(); schedule(live); } }));
  if (typeof ResizeObserver === "function") {
    const watcher = new ResizeObserver(() => { if (live.alive) schedule(live); });
    watcher.observe(state.stage);
    state.abort.signal.addEventListener("abort", () => watcher.disconnect(), { once: true });
  }
  live.dispose = () => {
    live.alive = false;
    cancelAnimationFrame(live.raf);
    clearTimeout(live.timer);
    node.__ausbossLive = null;
  };
  return live;
}

function mode(live) {
  return live.node.properties?.[VIEW_PROPERTY] === "100" ? "100" : "fit";
}

function syncView(live) {
  const full = mode(live) === "100";
  live.viewSwitch.setAttribute("aria-checked", String(full));
  live.viewSwitch.classList.toggle("faded", !live.drawn);
  live.viewSwitch.toggleAttribute("aria-disabled", !live.drawn);
  live.state.stage.classList.toggle("live-pan", full && live.drawn);
  live.look.classList.toggle("show", full && live.drawn && !live.looked);
}

// A redraw at most once a frame, and after a slow one, not before the page
// has had as long again to answer the pointer: a drag stays smooth.
function schedule(live) {
  if (!live.alive || live.raf || live.timer) return;
  const wait = live.cooldown - performance.now();
  if (wait > 4) {
    live.timer = setTimeout(() => { live.timer = 0; schedule(live); }, wait);
    return;
  }
  live.raf = requestAnimationFrame(() => {
    live.raf = 0;
    if (live.alive) live.hooks.refresh();
  });
}

// What each input of the node is, now: the plan for each, and what to say
// when one cannot be drawn from yet.
function describe(live) {
  const { node, spec, hooks } = live;
  const record = hooks.record();
  const here = connectionKey(node, spec.inputs.map((input) => input.name));
  // Which pictures feed the node: a Load Image's file, or a link.
  const sources = spec.inputs.map((input) => `${input.name}=${planInput(node, input.name).key ?? "-"}`).join("|");
  // The pictures a run kept belong to the wiring it had, and its result to
  // the files it read too. A record seen for the first time here belongs to
  // the wiring, files and values as they are now (a new run, or a workflow
  // just opened).
  if (record && live.run?.record !== record) live.run = { record, key: here, sources, sig: valuesSignature(node, spec.values) };
  if (!record) live.run = null;
  const kept = live.run && live.run.key === here;
  const plans = [];
  for (const input of spec.inputs) {
    const plan = planInput(node, input.name);
    if (plan.state === "none") {
      if (input.optional) continue;
      return { status: "none", input };
    }
    if (input.channels === 1 && plan.state === "direct") plan.state = "run"; // a mask is never a Load Image's file
    if (plan.state === "direct") {
      plans.push({ input, key: plan.key, url: hooks.viewUrl(plan.query) });
      continue;
    }
    const query = kept ? keptQuery(record, input.name) : null;
    if (!query) return { status: "run", input };
    plans.push({ input, key: `kept:${query}`, url: hooks.viewUrl(query) });
  }
  return { status: "ready", plans, sources, key: plans.map((plan) => `${plan.input.name}=${plan.key}`).join("|") };
}

function hintFor(input) {
  return input.channels === 1 ? RUN_ONCE_MASK : RUN_ONCE;
}

function showHint(live, text) {
  const { stage, hint } = live.state;
  stage.classList.remove("live-on", "show-image", "show-video", "show-grid");
  hint.textContent = text;
  live.drawn = false;
  live.drawnKey = "";
  syncView(live);
}

async function loadAll(live, found) {
  const key = found.key;
  live.loadingKey = key;
  try {
    const pix = {};
    for (const plan of found.plans) pix[plan.input.name] = { key: plan.key, pixels: await loadPixels(plan.url) };
    if (!live.alive || live.loadingKey !== key) return;
    live.pix = pix;
    live.loadedKey = key;
    live.broken = "";
    const image = pix.image?.pixels;
    if (live.kind === "grain" && image) {
      let noise = live.noise.get(pix.image.key);
      if (noise === undefined) {
        noise = measureNoise(lumaImage(image));
        live.noise.set(pix.image.key, noise);
      }
      setAuto(live.node, autoGrain(image.h, image.w, noise));
    }
  } catch {
    if (live.alive && live.loadingKey === key) live.broken = key;
  } finally {
    if (live.loadingKey === key) live.loadingKey = "";
  }
  if (live.alive) live.hooks.refresh();
}

function currentValues(live) {
  const vals = {};
  for (const name of live.spec.values) vals[name] = widgetValue(live.node, name);
  for (const name of ["amount", "size", "roughness", "color", "auto_amount", "auto_size", "auto_color", "detail_size", "strength", "grow", "feather", "clear_haze", "solid_above"]) {
    if (name in vals) vals[name] = num(vals[name], 0);
  }
  for (const name of ["auto", "moving", "color_detail", "edge_safe", "clean_edges"]) if (name in vals) vals[name] = Boolean(vals[name]);
  if (live.kind === "grain" && copiesGrain(live.node)) vals.match = live.node.__ausbossMatch ?? null;
  return vals;
}

// A picture of the size the work is done at, from the source's pixels (a
// window, or the whole shrunk). Another size than the picture's own is
// stretched to it.
function sourcePart(live, input, pixels, geo, whole) {
  const channels = input.channels;
  const same = pixels.w === whole.w && pixels.h === whole.h;
  if (geo.win) {
    if (same) return windowImage(pixels, geo.win, channels);
    const stretched = scaledImage(pixels, whole.w, whole.h, channels);
    const out = makeImage(geo.win.w, geo.win.h, channels);
    for (let y = 0; y < geo.win.h; y += 1) {
      for (let x = 0; x < geo.win.w; x += 1) {
        const at = (Math.min(Math.max(geo.win.y + y, 0), whole.h - 1) * whole.w + Math.min(Math.max(geo.win.x + x, 0), whole.w - 1)) * channels;
        for (let k = 0; k < channels; k += 1) out.data[(y * geo.win.w + x) * channels + k] = stretched.data[at + k];
      }
    }
    return out;
  }
  // The shrunk copy does not depend on any value: kept for the next drag step.
  const key = `${live.pix[input.name]?.key}|${geo.workW}x${geo.workH}|${channels}`;
  live.shrunk ??= new Map();
  let copy = live.shrunk.get(key);
  if (!copy) {
    copy = scaledImage(pixels, geo.workW, geo.workH, channels);
    if (live.shrunk.size > 6) live.shrunk.delete(live.shrunk.keys().next().value);
    live.shrunk.set(key, copy);
  }
  return copy;
}

// Draw now. Returns true when the stage shows a picture.
function paint(live, found) {
  const { node, hooks, canvas } = live;
  const { stage } = live.state;
  const first = live.pix.image?.pixels;
  if (!first) return false;
  const whole = { w: first.w, h: first.h };
  const viewMode = mode(live);
  const bounds = stage.getBoundingClientRect();
  const stageW = stage.clientWidth || bounds.width;
  const stageH = stage.clientHeight || bounds.height;
  const vals = currentValues(live);
  const sig = valuesSignature(node, live.spec.values);
  const matches = runIsCurrent(live.run, sig, found.sources) && hooks.hasResult();
  const resultUrl = matches ? hooks.resultUrl() : null;
  const stamp = `${found.key}|${sig}|${JSON.stringify(vals.match ?? null)}|${viewMode}|${stageW}x${stageH}|${live.pan?.x}|${live.pan?.y}|${resultUrl}|${Boolean(resultUrl && live.resultPixels?.url === resultUrl)}`;
  if (stamp === live.drawnKey && live.drawn) return true;

  let geo;
  let shown;
  if (viewMode === "fit") {
    const fitted = fitGeometry(stageW, stageH, whole.w, whole.h, window.devicePixelRatio || 1);
    if (!fitted) return live.drawn;
    geo = { ...fitted, win: null };
    canvas.width = geo.workW;
    canvas.height = geo.workH;
    canvas.style.width = `${geo.displayW}px`;
    canvas.style.height = `${geo.displayH}px`;
    shown = { w: geo.workW, h: geo.workH };
  } else {
    const window100 = cropGeometry(stageW, stageH, whole.w, whole.h, live.pan);
    if (!window100) return live.drawn;
    live.pan = { x: window100.x, y: window100.y };
    geo = { win: { x: window100.x, y: window100.y, w: window100.w, h: window100.h }, x: window100.x, y: window100.y, scale: 1 };
    canvas.width = window100.w;
    canvas.height = window100.h;
    canvas.style.width = `${window100.w}px`;
    canvas.style.height = `${window100.h}px`;
    shown = { w: window100.w, h: window100.h };
  }
  live.geo = geo;

  const draw = (image) => canvas.getContext("2d").putImageData(imageData(image), 0, 0);
  const started = performance.now();
  const finish = (real) => {
    live.drawn = true;
    live.drawnKey = stamp;
    live.lastMs = performance.now() - started;
    live.cooldown = performance.now() + Math.min(250, live.lastMs * 0.6);
    live.tag.classList.toggle("show", !real);
    stage.classList.add("live-on");
    stage.classList.remove("show-image", "show-video", "show-grid");
    syncView(live);
    return true;
  };

  if (resultUrl && live.resultPixels?.url === resultUrl) {
    const result = live.resultPixels.pixels;
    const channels = live.spec.outChannels;
    draw(geo.win ? windowImage(result, geo.win, channels) : scaledImage(result, geo.workW, geo.workH, channels));
    return finish(true);
  }
  if (resultUrl && live.resultPixels?.url !== resultUrl && live.resultPixels?.loading !== resultUrl) {
    // Read the run's own picture; until it is here, draw the live one.
    live.resultPixels = { url: null, loading: resultUrl };
    loadPixels(resultUrl).then((pixels) => {
      if (!live.alive) return;
      live.resultPixels = { url: resultUrl, pixels };
      hooks.refresh();
    }, () => { live.resultPixels = { url: null, loading: null, failed: resultUrl }; });
  }

  // The pictures the work is done on: a window grown by what the filters
  // read at 100%, or the whole picture shrunk.
  const reach = geo.win ? reachOf(live.kind, vals, Math.max(whole.w, whole.h)) : 0;
  const padded = geo.win ? paddedWindow(geo.win, reach, whole.w, whole.h) : null;
  const region = geo.win ? { ...geo, win: padded } : geo;
  const parts = {};
  for (const input of live.spec.inputs) {
    const source = live.pix[input.name];
    if (source) parts[input.name === "mask" ? "mask" : input.name] = sourcePart(live, input, source.pixels, region, whole);
  }
  let noise = null;
  if (live.kind === "grain") noise = live.noise.get(live.pix.image.key) ?? 0;
  const view = { scale: geo.scale ?? 1, fullW: whole.w, fullH: whole.h, win: geo.win ? padded : null };
  let out = drawKind(live.kind, vals, parts, view, noise);
  if (geo.win && (padded.w !== geo.win.w || padded.h !== geo.win.h)) {
    const at = insideOf(geo.win, padded);
    const cut = makeImage(shown.w, shown.h, out.c);
    for (let y = 0; y < shown.h; y += 1) {
      cut.data.set(out.data.subarray(((at.y + y) * out.w + at.x) * out.c, ((at.y + y) * out.w + at.x + shown.w) * out.c), y * shown.w * out.c);
    }
    out = cut;
  }
  draw(out);
  return finish(false);
}

// The panel's refresh calls this. True: the live stage has the stage, so the
// panel leaves it alone. False: the panel shows what it always showed.
export function takeStage(state) {
  const live = state.live;
  if (!live?.alive) return false;
  live.watch();
  const found = describe(live);
  if (found.status === "none") {
    live.state.stage.classList.remove("live-on");
    live.drawn = false;
    syncView(live);
    return false;
  }
  if (found.status === "run") {
    showHint(live, hintFor(found.input));
    return true;
  }
  // Copying grain from a picture: the match comes from a run.
  if (live.kind === "grain" && copiesGrain(live.node) && !live.node.__ausbossMatch) {
    showHint(live, RUN_ONCE_MATCH);
    return true;
  }
  if (live.broken === found.key) {
    live.state.stage.classList.remove("live-on");
    live.drawn = false;
    syncView(live);
    return false;
  }
  if (live.loadedKey !== found.key) {
    if (live.loadingKey !== found.key) loadAll(live, found);
    // Until the pictures are read, what is on the stage stays.
    return live.drawn;
  }
  try {
    return paint(live, found);
  } catch (error) {
    live.broken = found.key;
    console.warn("[AusBoss] live preview off:", error?.message ?? error);
    live.state.stage.classList.remove("live-on");
    live.drawn = false;
    syncView(live);
    return false;
  }
}
