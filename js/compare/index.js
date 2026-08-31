import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { BRAND, chainCallback, keepDomWidgetWidthAuto } from "../shared/index.mjs";
import { WIDGET_FRAME, fillNodeHeight } from "../shared/panel_layout.mjs";
import { mediaViewQuery, responsivePreviewHeight } from "../shared/video_preview.mjs";
import { VIDEO_MIN_WIDTH, ensureVideoCss, makeToolButton } from "../shared/video_ui.mjs";
import {
  clipFraction,
  compareClip,
  compareSizeLabel,
  findCompareImages,
  normalizeCompareMode,
} from "../shared/compare.mjs";

const NODE_NAME = "AUSBOSS_NODES_Compare";
const PANEL_WIDGET = "ausboss_compare_panel";
const PANEL_CHROME = 12;
// The stage floor plus the caption row that now sits under it.
const CAPTION_HEIGHT = 15;
const PANEL_MIN_HEIGHT = 144 + CAPTION_HEIGHT;
// Height the node opens at. It used to fall out of computeSize; with the panel
// now free to grow, the default has to be stated somewhere, and a 16:9-ish
// stage is the shape most A/B pairs want.
const DEFAULT_NODE_SIZE = [
  420,
  responsivePreviewHeight(420, 132, 520) + PANEL_CHROME + CAPTION_HEIGHT + 60,
];
const CSS_ID = "ausboss-compare-ui-v2";

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
/* Once the previews are up the status has nothing to say, and an empty chip
   over the corner of the picture is just something in the way. */
.ausboss-compare-status:empty{display:none;}
.ausboss-compare-stage.is-empty .ausboss-compare-status{left:50%;top:50%;max-width:82%;transform:translate(-50%,-50%);color:#78908e;text-align:center;white-space:normal;}
.ausboss-compare-tools{position:absolute;right:6px;top:6px;z-index:4;display:flex;gap:4px;opacity:.9;}
.ausboss-compare-tools:hover{opacity:1;}
.ausboss-compare-caption{flex:none;height:${CAPTION_HEIGHT}px;overflow:hidden;color:#8ba3a1;font-size:10px;line-height:${CAPTION_HEIGHT}px;text-align:center;white-space:nowrap;text-overflow:ellipsis;}
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
  state.caption.textContent = "";
}

function setReady(state) {
  state.stage.classList.remove("is-empty");
  // Nothing overlays the picture once it is up: the status chip goes away
  // (it collapses when empty) and the resolution moves to the caption below.
  state.status.textContent = "";
  state.caption.textContent = compareSizeLabel(state.refs);
}

function updateModeButtons(state) {
  const mode = getMode(state.node);
  state.slideButton.classList.toggle("active", mode === "slide");
  state.abButton.classList.toggle("active", mode === "toggle");
  // The label names what is on screen right now, not what the next click
  // will do, so the button reads as a status as much as a control.
  state.abButton.textContent = mode === "toggle" && state.showingB ? "B" : "A";
  state.abButton.title = mode === "toggle"
    ? `Showing ${state.showingB ? "B" : "A"} - click to switch to ${state.showingB ? "A" : "B"}`
    : "Switch between A and B with a click";
}

// In toggle mode the reveal is all or nothing; slide keeps whatever fraction
// the pointer last set.
function applyToggle(state) {
  state.fraction = state.showingB ? 1 : 0;
  applyClip(state);
  updateModeButtons(state);
  state.node.setDirtyCanvas?.(true, true);
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
  const abButton = makeToolButton("A", "Switch between A and B with a click");
  tools.append(slideButton, abButton);
  stage.append(imageA, imageB, seam, status, tools);
  const caption = document.createElement("div");
  caption.className = "ausboss-compare-caption";
  root.append(stage, caption);

  const widget = node.addDOMWidget(PANEL_WIDGET, "ausboss_compare", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => PANEL_MIN_HEIGHT + WIDGET_FRAME,
  });
  keepDomWidgetWidthAuto(widget);
  // + WIDGET_FRAME: the frontend insets the element, so a bare floor hands
  // the panel fewer CSS pixels than the stage + caption minimums and shaves
  // the caption's glyphs at the node's minimum height.
  fillNodeHeight(widget, {
    minWidth: VIDEO_MIN_WIDTH,
    minHeight: PANEL_MIN_HEIGHT + WIDGET_FRAME,
    minNodeSize: [VIDEO_MIN_WIDTH, 220],
  });

  const abort = new AbortController();
  const state = node.__ausbossCompare = {
    node, root, stage, imageA, imageB, seam, status, caption,
    slideButton, abButton,
    widget, abort, refs: null, fraction: 0, loaded: 0, showingB: false,
  };
  applyClip(state);
  updateModeButtons(state);

  const signal = abort.signal;
  slideButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    node.properties.ausboss_compare_mode = normalizeCompareMode("slide");
    state.showingB = false;
    state.fraction = 0;
    applyClip(state);
    updateModeButtons(state);
    node.setDirtyCanvas?.(true, true);
  }, { signal });

  abButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    // Arriving from slide mode, the first click is what selects this mode, and
    // it lands on B - the point of reaching for it is to see the other one.
    // After that each click just flips.
    const wasToggle = getMode(node) === "toggle";
    node.properties.ausboss_compare_mode = normalizeCompareMode("toggle");
    state.showingB = wasToggle ? !state.showingB : true;
    applyToggle(state);
  }, { signal });

  // The panel owns pointer movement only inside itself; pointerdown is never
  // prevented, so dragging the node from its title keeps working. Events born
  // in the tools bar never reach the stage, or a click on a button would also
  // read as a slide. Toggle mode needs no pointer handling at all - the
  // button is the whole interaction, which is why it replaced press-and-hold.
  stage.addEventListener("pointermove", (event) => {
    if (tools.contains(event.target)) return;
    if (!state.refs || getMode(node) !== "slide") return;
    const rect = stage.getBoundingClientRect();
    state.fraction = clipFraction(event.clientX, rect.left, rect.width);
    applyClip(state);
  }, { signal });

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
      // Only for a genuinely new node: onConfigure restores a saved size after
      // this runs, so a workflow's own dimensions still win.
      this.setSize?.([
        Math.max(DEFAULT_NODE_SIZE[0], this.size?.[0] ?? 0),
        Math.max(DEFAULT_NODE_SIZE[1], this.size?.[1] ?? 0),
      ]);
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
