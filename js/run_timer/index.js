// Run Timer 🆎 — a stopwatch for the whole queue, drawn as one black readout.
//
// The node IS the display: no title bar, no slots, no padding. On the
// classic canvas the readout is painted by the node itself (onDrawForeground)
// - no DOM widget, so the pointer lands on the canvas everywhere (drag from
// anywhere, native resize, right-click) and the box is exactly the node.
// The Nodes 2.0 renderer does not run canvas paint, so there the same
// readout mounts as a DOM widget instead.
//
// It listens to the api's execution events; a run starts the clock, ticks
// it, and the total holds when the run ends. Completed totals go into
// node.properties so a saved workflow reopens showing its author's time.
// Decision logic lives in js/shared/run_timer.mjs under node:test.

import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { BRAND, chainCallback, keepDomWidgetWidthAuto } from "../shared/index.mjs";
import {
  createTimer,
  formatElapsed,
  startTimer,
  stopTimer,
  tickTimer,
} from "../shared/run_timer.mjs";

const NODE_CLASS = "AUSBOSS_NODES_RunTimer";
const CSS_ID = "ausboss-run-timer-css";
const WIDGET_NAME = "ausboss_run_timer_panel";
const PROPERTY = "ausboss_run_timer"; // { history: [seconds, newest first] }
const BASE_WIDTH = 176;
const BASE_HEIGHT = 56;
const MIN_WIDTH = 110;
const TICK_MS = 100;
const NO_TITLE = globalThis.LiteGraph?.NO_TITLE ?? 1;
const READOUT_COLOR = "#07090a";
const TEAL = "#2ee8dc";
const AMBER = "#ffd166";
const RED = "#ff5c4d";
const DIM = "#3d5a58";
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// ---------------------------------------------------------------------------
// Shared state and events
// ---------------------------------------------------------------------------

function savedHistory(node) {
  const stored = node.properties?.[PROPERTY];
  return Array.isArray(stored?.history) ? stored.history : [];
}

// "1:05" + ".3", or "12" + ".3" + "s": the whole seconds carry the weight,
// the tenths ride small beside them, hours fold in as h:mm:ss.
function splitDigits(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return { main: "0", tenths: ".0", unit: "s" };
  const whole = Math.floor(seconds);
  const tenths = `.${Math.floor((seconds - whole) * 10)}`;
  if (whole < 60) return { main: String(whole), tenths, unit: "s" };
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  if (hours) return { main: `${hours}:${String(minutes).padStart(2, "0")}:${rest}`, tenths: "", unit: "" };
  return { main: `${minutes}:${rest}`, tenths, unit: "" };
}

// What the readout shows right now: the digits, the LED status and the
// digit color - one place, shared by the canvas paint and the DOM panel.
function readout(state) {
  const { timer } = state;
  const hasRun = timer.running || timer.outcome !== null || timer.history.length > 0;
  const shown = timer.running || timer.outcome ? timer.elapsed : timer.history[0];
  const parts = splitDigits(hasRun ? shown : 0);
  let led = "idle";
  if (timer.running) led = "running";
  else if (timer.outcome) led = timer.outcome;
  else if (hasRun) led = "done";
  const failed = timer.outcome === "error" || timer.outcome === "interrupted";
  return { ...parts, led, color: failed ? "#ff8a7d" : hasRun ? TEAL : DIM, hasRun };
}

function stopTicking(state) {
  if (state.interval) clearInterval(state.interval);
  state.interval = null;
}

function finish(state, outcome) {
  if (!state.timer.running) return;
  stopTicking(state);
  state.timer = stopTimer(state.timer, performance.now(), outcome);
  if (outcome === "done") {
    state.node.properties ??= {};
    state.node.properties[PROPERTY] = { history: state.timer.history };
  }
  state.render();
}

function begin(state) {
  stopTicking(state);
  state.timer = startTimer(state.timer, performance.now());
  state.render();
  state.interval = setInterval(() => {
    state.timer = tickTimer(state.timer, performance.now());
    state.render();
  }, TICK_MS);
}

function listen(state) {
  const { signal } = state.abort;
  api.addEventListener("execution_start", () => begin(state), { signal });
  api.addEventListener("execution_success", () => finish(state, "done"), { signal });
  api.addEventListener("execution_error", () => finish(state, "error"), { signal });
  api.addEventListener("execution_interrupted", () => finish(state, "interrupted"), { signal });
}

// The frontend hangs a "which pack" badge above every custom node; on a
// title-less readout it floats in space. An empty badges list draws none.
function suppressBadges(node) {
  try {
    Object.defineProperty(node, "badges", {
      configurable: true,
      get: () => [],
      set: () => {},
    });
  } catch {
    node.badges = [];
  }
}

function paintBlack(node) {
  node.color = READOUT_COLOR;
  node.bgcolor = READOUT_COLOR;
}

function usesVueNodes() {
  try {
    return app.ui?.settings?.getSettingValue?.("Comfy.VueNodes.Enabled") === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Classic canvas: the node paints its own readout
// ---------------------------------------------------------------------------

function ledColor(status) {
  if (status === "running") return AMBER;
  if (status === "done") return TEAL;
  if (status === "error" || status === "interrupted") return RED;
  return "#2b3336";
}

// Glow as a blurred underlay pass, not a canvas shadow: LiteGraph leaves
// shadow offsets set from painting the node body, and a shadow drawn on
// top of that lands as a displaced copy of every glyph.
function glowText(ctx, text, x, y, color, radius) {
  if (radius <= 0 || !("filter" in ctx)) return;
  ctx.save();
  ctx.filter = `blur(${radius}px)`;
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawReadout(node, ctx, state) {
  const [w, h] = node.size;
  const s = h / BASE_HEIGHT;
  const view = readout(state);
  const big = Math.max(10, Math.round(28 * s));
  const small = Math.max(7, Math.round(15 * s));
  const tiny = Math.max(6, Math.round(10 * s));
  ctx.save();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // LED with its own halo
  const led = ledColor(view.led);
  const pulse = view.led === "running" ? 0.55 + 0.45 * Math.sin(performance.now() / 160) : 1;
  const ledX = 12 * s;
  const ledY = h / 2;
  if (view.led !== "idle") {
    ctx.save();
    ctx.filter = `blur(${4 * s}px)`;
    ctx.globalAlpha = 0.9 * pulse;
    ctx.fillStyle = led;
    ctx.beginPath();
    ctx.arc(ledX, ledY, 4.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = pulse;
  ctx.fillStyle = led;
  ctx.beginPath();
  ctx.arc(ledX, ledY, 3.2 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // digits, measured then centred in the space right of the LED
  const fontBig = `700 ${big}px ${MONO}`;
  const fontSmall = `600 ${small}px ${MONO}`;
  const fontTiny = `500 ${tiny}px ${MONO}`;
  ctx.font = fontBig;
  const mainW = ctx.measureText(view.main).width;
  ctx.font = fontSmall;
  const tenthsW = view.tenths ? ctx.measureText(view.tenths).width : 0;
  ctx.font = fontTiny;
  const unitW = view.unit ? ctx.measureText(view.unit).width + 3 * s : 0;
  const total = mainW + tenthsW + unitW;
  const left = 22 * s;
  const x0 = left + Math.max(0, (w - left - 8 * s - total) / 2);
  const baseline = h / 2 + big * 0.36;
  const glow = view.hasRun ? 5 * s : 0;

  ctx.font = fontBig;
  glowText(ctx, view.main, x0, baseline, view.color, glow);
  ctx.fillStyle = view.color;
  ctx.fillText(view.main, x0, baseline);
  let x = x0 + mainW;
  if (view.tenths) {
    ctx.font = fontSmall;
    glowText(ctx, view.tenths, x, baseline, view.color, glow * 0.8);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = view.color;
    ctx.fillText(view.tenths, x, baseline);
    ctx.globalAlpha = 1;
    x += tenthsW;
  }
  if (view.unit) {
    ctx.font = fontTiny;
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = view.color;
    ctx.fillText(view.unit, x + 3 * s, baseline);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// Width is the handle, height follows. During a corner drag LiteGraph
// writes node.size directly on every move and calls onResize once at
// most, so this runs from the draw path as well: a tall or squat box is
// corrected before the next frame, the way Pixaroma's clock snaps back.
function keepAspect(node) {
  const width = Math.max(MIN_WIDTH, Math.round(node.size?.[0] ?? BASE_WIDTH));
  const height = Math.round((width * BASE_HEIGHT) / BASE_WIDTH);
  if (node.size[0] === width && node.size[1] === height) return false;
  // setSize is the frontend's sanctioned write (it runs onResize); the
  // equality check above is what stops that callback from recursing.
  if (typeof node.setSize === "function") node.setSize([width, height]);
  else node.size = [width, height];
  return true;
}

function installCanvasReadout(node) {
  if (node.__ausbossRunTimer) return node.__ausbossRunTimer;
  node.flags ??= {};
  node.flags.no_title = true;
  suppressBadges(node);
  paintBlack(node);
  const state = (node.__ausbossRunTimer = {
    node, abort: new AbortController(), interval: null, mode: "canvas",
    timer: createTimer(savedHistory(node)),
    render: () => node.setDirtyCanvas?.(true, false),
  });
  // Width is the handle: drag the corner and the readout scales with it.
  // computeSize is the MINIMUM the canvas will let a drag reach - it must
  // never echo the current size, or the node can only ever grow.
  node.resizable = true;
  node.computeSize = () => [MIN_WIDTH, Math.round((MIN_WIDTH * BASE_HEIGHT) / BASE_WIDTH)];
  // A saved workflow overwrites this in onConfigure; a fresh node starts here.
  node.size = [BASE_WIDTH, BASE_HEIGHT];
  chainCallback(node, "onResize", function () { keepAspect(this); });
  chainCallback(node, "onDrawForeground", function (ctx) {
    if (this.flags?.collapsed) return;
    // The body was already painted at whatever size the drag left; fix
    // the size now and ask for one more frame so the box catches up.
    if (keepAspect(this)) this.setDirtyCanvas?.(true, false);
    drawReadout(this, ctx, state);
  });
  listen(state);
  return state;
}

// ---------------------------------------------------------------------------
// Nodes 2.0 fallback: the same readout as a DOM panel
// ---------------------------------------------------------------------------

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-timer{box-sizing:border-box;width:100%;height:100%;pointer-events:none;overflow:hidden;}
.ausboss-timer-box{box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:100%;padding:0 12px;overflow:hidden;border-radius:9px;background:${READOUT_COLOR};}
.ausboss-timer-led{flex:none;width:7px;height:7px;border-radius:50%;background:#2b3336;}
.ausboss-timer-led.running{background:${AMBER};box-shadow:0 0 8px rgba(255,209,102,.9);animation:ausboss-timer-pulse 1s ease-in-out infinite;}
.ausboss-timer-led.done{background:${BRAND};box-shadow:0 0 8px rgba(0,180,170,.8);}
.ausboss-timer-led.error,.ausboss-timer-led.interrupted{background:${RED};box-shadow:0 0 8px rgba(255,92,77,.8);}
@keyframes ausboss-timer-pulse{0%,100%{opacity:1;}50%{opacity:.35;}}
.ausboss-timer-digits{display:flex;align-items:baseline;color:${TEAL};font:700 28px/1 ${MONO};font-variant-numeric:tabular-nums;letter-spacing:.02em;text-shadow:0 0 12px rgba(46,232,220,.35);white-space:nowrap;}
.ausboss-timer-digits.idle{color:${DIM};text-shadow:none;}
.ausboss-timer-digits.error{color:#ff8a7d;text-shadow:0 0 12px rgba(255,92,77,.35);}
.ausboss-timer-digits .tenths{font-size:15px;margin-left:2px;opacity:.78;}
.ausboss-timer-digits .unit{font-size:10px;margin-left:5px;letter-spacing:.12em;opacity:.55;}
/* Nodes 2.0 only: the Vue node wraps this panel in a 225px-minimum body and
   hangs its own pack badge in a footer row; the readout is the whole node. */
.lg-node:has(.ausboss-timer){min-width:0!important;}
.lg-node:has(.ausboss-timer) .bg-component-node-background>div:last-child{display:none;}
`;
  document.head.appendChild(style);
}

function installDomReadout(node) {
  if (node.__ausbossRunTimer) return node.__ausbossRunTimer;
  ensureCss();
  node.flags ??= {};
  node.flags.no_title = true;
  suppressBadges(node);
  paintBlack(node);

  const root = document.createElement("div");
  root.className = "ausboss-timer";
  const box = document.createElement("div");
  box.className = "ausboss-timer-box";
  const led = document.createElement("span");
  led.className = "ausboss-timer-led";
  const digits = document.createElement("span");
  digits.className = "ausboss-timer-digits idle";
  const main = document.createElement("span");
  const tenths = document.createElement("span");
  tenths.className = "tenths";
  const unit = document.createElement("span");
  unit.className = "unit";
  digits.append(main, tenths, unit);
  box.append(led, digits);
  root.append(box);

  const widget = node.addDOMWidget(WIDGET_NAME, "ausboss_run_timer", root, {
    serialize: false,
    hideOnZoom: false,
    margin: 0,
    getMinHeight: () => BASE_HEIGHT,
  });
  keepDomWidgetWidthAuto(widget);
  // A constant-height readout, not a viewport: pinned on purpose (see
  // tests/panel_guards.test.mjs, fixedByDesign).
  widget.computeSize = (width) => [Math.max(MIN_WIDTH, Number(width || node.size?.[0] || BASE_WIDTH)), BASE_HEIGHT];
  widget.computeLayoutSize = () => ({ minWidth: MIN_WIDTH, minHeight: BASE_HEIGHT });
  widget.options.minNodeSize = [MIN_WIDTH, BASE_HEIGHT];

  const state = (node.__ausbossRunTimer = {
    node, abort: new AbortController(), interval: null, mode: "dom",
    timer: createTimer(savedHistory(node)),
    render: () => {
      const view = readout(state);
      main.textContent = view.main;
      tenths.textContent = view.tenths;
      unit.textContent = view.unit;
      led.className = `ausboss-timer-led ${view.led === "idle" ? "" : view.led}`;
      digits.className = "ausboss-timer-digits";
      if (!view.hasRun) digits.classList.add("idle");
      if (view.led === "error" || view.led === "interrupted") digits.classList.add("error");
    },
  });
  state.render();
  listen(state);
  return state;
}

function install(node) {
  return usesVueNodes() ? installDomReadout(node) : installCanvasReadout(node);
}

app.registerExtension({
  name: "AusBoss.RunTimer",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    // Set once on the TYPE at registration: the classic renderer reads it
    // per draw, and the Nodes 2.0 renderer snapshots it when the node is
    // created, so a per-node write would come too late there.
    nodeType.title_mode = NO_TITLE;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      install(this);
    });
    chainCallback(nodeType.prototype, "onConfigure", function () {
      // Saved properties land after onNodeCreated: pick the history up then,
      // and keep the readout black however the save was colored.
      queueMicrotask(() => {
        const state = install(this);
        if (!state) return;
        if (!state.timer.running) state.timer = createTimer(savedHistory(this));
        this.flags.no_title = true;
        paintBlack(this);
        if (state.mode === "canvas") keepAspect(this);
        state.render();
      });
    });
    chainCallback(nodeType.prototype, "getExtraMenuOptions", function (_canvas, options) {
      const state = this.__ausbossRunTimer;
      if (!state || !Array.isArray(options)) return;
      const previous = state.timer.history.slice(0, 5).map(formatElapsed).join(" · ");
      options.unshift(
        { content: previous ? `Runs: ${previous}` : "No completed runs yet", disabled: true },
        {
          content: "Reset Run Timer history",
          callback: () => {
            state.timer = createTimer([]);
            this.properties ??= {};
            this.properties[PROPERTY] = { history: [] };
            state.render();
          },
        },
        null,
      );
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      const state = this.__ausbossRunTimer;
      if (!state) return;
      stopTicking(state);
      state.abort.abort();
      this.__ausbossRunTimer = null;
    });
  },
});
