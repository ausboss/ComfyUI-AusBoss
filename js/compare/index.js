import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { BRAND, chainCallback, keepDomWidgetWidthAuto } from "../shared/index.mjs";
import { mediaViewQuery, responsivePreviewHeight } from "../shared/video_preview.mjs";
import { VIDEO_MIN_WIDTH, ensureVideoCss, makeToolButton } from "../shared/video_ui.mjs";
import {
  clipFraction,
  compareClip,
  findCompareImages,
  normalizeCompareMode,
} from "../shared/compare.mjs";

const NODE_NAME = "AUSBOSS_NODES_Compare";
const PANEL_WIDGET = "ausboss_compare_panel";
const PANEL_CHROME = 12;
const CSS_ID = "ausboss-compare-ui-v1";

const MODE_HINTS = {
  slide: "Move across the panel to reveal B",
  hold: "Press and hold to see B",
};

function ensureCompareCss() {
  ensureVideoCss(); // tool button styles are shared with the video panels
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-compare-root{box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;gap:6px;padding:2px 6px 6px;color:#d8eeee;font:11px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden;}
.ausboss-compare-stage{position:relative;flex:1 1 auto;min-height:112px;overflow:hidden;border:1px solid rgba(0,180,170,.34);border-radius:6px;background:#000;box-shadow:inset 0 0 0 1px rgba(255,255,255,.025);touch-action:none;}
.ausboss-compare-stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;user-select:none;-webkit-user-drag:none;}
.ausboss-compare-stage.is-empty img{visibility:hidden;}
.ausboss-compare-seam{position:absolute;top:0;bottom:0;z-index:2;width:1px;margin-left:-0.5px;background:${BRAND};box-shadow:0 0 4px rgba(0,180,170,.55);opacity:0;pointer-events:none;}
.ausboss-compare-status{position:absolute;left:7px;top:7px;z-index:3;max-width:calc(100% - 112px);padding:3px 6px;border-radius:4px;background:rgba(0,0,0,.7);color:#b8d3d1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;backdrop-filter:blur(4px);}
.ausboss-compare-stage.is-empty .ausboss-compare-status{left:50%;top:50%;max-width:82%;transform:translate(-50%,-50%);color:#78908e;text-align:center;white-space:normal;}
.ausboss-compare-tools{position:absolute;right:6px;top:6px;z-index:4;display:flex;gap:4px;opacity:.9;}
.ausboss-compare-tools:hover{opacity:1;}
`;
  document.head.appendChild(style);
}

function getMode(node) {
  node.properties ??= {};
  node.properties.ausboss_compare_mode = normalizeCompareMode(
    node.properties.ausboss_compare_mode,
  );
  return node.properties.ausboss_compare_mode;
}

function applyClip(state) {
  const { clipPath, seamLeft, seamVisible } = compareClip(state.fraction);
  state.imageB.style.clipPath = clipPath;
  state.seam.style.left = seamLeft;
  state.seam.style.opacity = seamVisible ? "1" : "0";
}

function setEmpty(state, text) {
  state.stage.classList.add("is-empty");
  state.status.textContent = text;
}

function setReady(state) {
  state.stage.classList.remove("is-empty");
  const mode = getMode(state.node);
  const size = state.refs?.a?.width
    ? `${state.refs.a.width}×${state.refs.a.height} · `
    : "";
  state.status.textContent = `${size}${MODE_HINTS[mode]}`;
}

function updateModeButtons(state) {
  const mode = getMode(state.node);
  state.slideButton.classList.toggle("active", mode === "slide");
  state.holdButton.classList.toggle("active", mode === "hold");
  if (!state.stage.classList.contains("is-empty")) setReady(state);
}

function loadPreviews(state, refs) {
  state.refs = refs;
  state.loaded = 0;
  setEmpty(state, "Loading previews…");
  state.imageA.src = api.apiURL(`/view?${mediaViewQuery(refs.a, "temp")}`);
  state.imageB.src = api.apiURL(`/view?${mediaViewQuery(refs.b, "temp")}`);
}

function buildPanel(node) {
  if (node.__ausbossCompare) return node.__ausbossCompare;
  ensureCompareCss();

  const root = document.createElement("div");
  root.className = "ausboss-compare-root";
  const stage = document.createElement("div");
  stage.className = "ausboss-compare-stage is-empty";
  const imageA = document.createElement("img");
  const imageB = document.createElement("img");
  const seam = document.createElement("div");
  seam.className = "ausboss-compare-seam";
  const status = document.createElement("div");
  status.className = "ausboss-compare-status";
  status.textContent = "Run to load the A/B previews";
  const tools = document.createElement("div");
  tools.className = "ausboss-compare-tools";
  const slideButton = makeToolButton("SLIDE", "Slide: the seam follows the pointer across the image");
  const holdButton = makeToolButton("HOLD", "Hold: press and hold anywhere to see B, release for A");
  tools.append(slideButton, holdButton);
  stage.append(imageA, imageB, seam, status, tools);
  root.append(stage);

  const widget = node.addDOMWidget(PANEL_WIDGET, "ausboss_compare", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => 132,
  });
  keepDomWidgetWidthAuto(widget);
  widget.computeSize = (width) => {
    const resolvedWidth = Math.max(VIDEO_MIN_WIDTH, Number(width || node.size?.[0] || 360));
    return [resolvedWidth, responsivePreviewHeight(resolvedWidth, 132, 520) + PANEL_CHROME];
  };
  widget.computeLayoutSize = () => ({ minWidth: VIDEO_MIN_WIDTH, minHeight: 144 });
  widget.options ??= {};
  widget.options.minNodeSize = [VIDEO_MIN_WIDTH, 220];

  const abort = new AbortController();
  const state = node.__ausbossCompare = {
    node, root, stage, imageA, imageB, seam, status, slideButton, holdButton,
    widget, abort, refs: null, fraction: 0, loaded: 0, holding: false,
  };
  applyClip(state);
  updateModeButtons(state);

  const signal = abort.signal;
  const setMode = (mode) => (event) => {
    event.preventDefault();
    event.stopPropagation();
    node.properties.ausboss_compare_mode = normalizeCompareMode(mode);
    if (mode !== "hold") state.holding = false;
    state.fraction = 0;
    applyClip(state);
    updateModeButtons(state);
    node.setDirtyCanvas?.(true, true);
  };
  slideButton.addEventListener("click", setMode("slide"), { signal });
  holdButton.addEventListener("click", setMode("hold"), { signal });

  // The panel owns pointer movement only inside itself; pointerdown is never
  // prevented, so dragging the node from its title keeps working. Events
  // born in the tools bar never reach the stage behaviors — in hold mode a
  // stage pointerdown captures the pointer, which would retarget the
  // release and eat the button's click (the "stuck on HOLD" bug).
  stage.addEventListener("pointermove", (event) => {
    if (tools.contains(event.target)) return;
    if (!state.refs || getMode(node) !== "slide" || state.holding) return;
    const rect = stage.getBoundingClientRect();
    state.fraction = clipFraction(event.clientX, rect.left, rect.width);
    applyClip(state);
  }, { signal });

  stage.addEventListener("pointerdown", (event) => {
    if (tools.contains(event.target)) return;
    if (!state.refs || getMode(node) !== "hold") return;
    state.holding = true;
    state.fraction = 1;
    applyClip(state);
    try {
      stage.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; release still arrives via the
      // window when the browser refuses it.
    }
  }, { signal });

  const endHold = () => {
    if (!state.holding) return;
    state.holding = false;
    state.fraction = 0;
    applyClip(state);
  };
  stage.addEventListener("pointerup", endHold, { signal });
  stage.addEventListener("pointercancel", endHold, { signal });

  const onImageLoad = () => {
    state.loaded += 1;
    if (state.loaded >= 2) {
      setReady(state);
      node.setDirtyCanvas?.(true, true);
    }
  };
  imageA.addEventListener("load", onImageLoad, { signal });
  imageB.addEventListener("load", onImageLoad, { signal });
  const onImageError = () => setEmpty(state, "A compare preview could not load");
  imageA.addEventListener("error", onImageError, { signal });
  imageB.addEventListener("error", onImageError, { signal });

  return state;
}

app.registerExtension({
  name: "ausboss.compare.panel",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_NAME) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      buildPanel(this);
    });
    chainCallback(nodeType.prototype, "onConfigure", function () {
      queueMicrotask(() => {
        const state = buildPanel(this);
        updateModeButtons(state);
      });
    });
    chainCallback(nodeType.prototype, "onExecuted", function (message) {
      const state = buildPanel(this);
      const refs = findCompareImages(message);
      if (refs) loadPreviews(state, refs);
      else setEmpty(state, "Execution finished without compare previews");
      app.canvas?.setDirty?.(true, true);
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      this.__ausbossCompare?.abort?.abort();
      this.__ausbossCompare = null;
    });
  },
});
