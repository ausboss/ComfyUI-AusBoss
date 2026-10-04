import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { isForeignRun, outputKey } from "../shared/prompt_scope.mjs";
import { BRAND, chainCallback, keepDomWidgetWidthAuto, notifyAusbossChange } from "../shared/index.mjs";
import { WIDGET_FRAME, fillNodeHeight } from "../shared/panel_layout.mjs";
import { mediaViewQuery, responsivePreviewHeight } from "../shared/video_preview.mjs";
import { VIDEO_MIN_WIDTH, ensureVideoCss, makeToolButton } from "../shared/video_ui.mjs";
import {
  slideFraction,
  compareBadges,
  compareClip,
  compareSizeLabel,
  findCompareImages,
  normalizeCompareMode,
} from "../shared/compare.mjs";

const NODE_NAME = "AUSBOSS_NODES_Compare";
const PANEL_WIDGET = "ausboss_compare_panel";
const PANEL_CHROME = 12;
// The stage floor plus the caption row that now sits under it.
const CAPTION_HEIGHT = 24;
const PANEL_MIN_HEIGHT = 144 + CAPTION_HEIGHT;
// Height the node opens at. It used to fall out of computeSize; with the panel
// now free to grow, the default has to be stated somewhere, and a 16:9-ish
// stage is the shape most A/B pairs want.
const DEFAULT_NODE_SIZE = [
  420,
  responsivePreviewHeight(420, 132, 520) + PANEL_CHROME + CAPTION_HEIGHT + 60,
];
const CSS_ID = "ausboss-compare-ui-v3";
const BADGE_WIDTH = 22;

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
.ausboss-compare-footer{display:flex;align-items:center;gap:8px;flex:none;height:24px;}
.ausboss-compare-tools{display:flex;gap:4px;flex:none;opacity:.9;}
.ausboss-compare-identity{position:absolute;left:0;right:0;top:7px;height:22px;z-index:3;pointer-events:none;}
.ausboss-compare-identity span{position:absolute;top:0;width:${BADGE_WIDTH}px;height:22px;border-radius:4px;background:rgba(0,0,0,.7);color:#d8eeee;font-weight:600;text-align:center;line-height:22px;}
.ausboss-compare-identity span[hidden]{display:none;}
.ausboss-compare-stage.is-empty .ausboss-compare-identity{display:none;}
.ausboss-compare-tools:hover{opacity:1;}
.ausboss-compare-caption{flex:1;min-width:0;height:${CAPTION_HEIGHT}px;overflow:hidden;color:#8ba3a1;font-size:10px;line-height:${CAPTION_HEIGHT}px;text-align:center;white-space:nowrap;text-overflow:ellipsis;}
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

// A and B ride on either side of the split line (compareBadges), so each
// label sits on the picture it names wherever the line is.
function applyClip(state) {
  const { clipPath, seamLeft, seamVisible } = compareClip(state.fraction);
  state.imageA.style.clipPath = clipPath;
  state.seam.style.left = seamLeft;
  state.seam.style.opacity = seamVisible ? "1" : "0";
  const places = compareBadges(state.fraction, state.stage.clientWidth || 0, BADGE_WIDTH);
  for (const [badge, left] of [[state.identityLeft, places.a], [state.identityRight, places.b]]) {
    badge.hidden = left == null;
    if (left != null) badge.style.left = `${left}px`;
  }
  state.identity.title = seamVisible ? "A on the left of the line · B on the right" : `Showing ${state.fraction === 0 ? "B" : "A"}`;
  state.identity.setAttribute("aria-label", state.identity.title);
}

function setEmpty(state, text) {
  state.stage.classList.add("is-empty");
  state.status.textContent = text;
  state.caption.textContent = "";
}

function setReady(state) {
  state.stage.classList.remove("is-empty");
  // Keep loading/error status separate from the image identity label.
  state.status.textContent = "";
  state.caption.textContent = compareSizeLabel(state.refs);
}

function updateModeButtons(state) {
  const mode = getMode(state.node);
  state.slideButton.classList.toggle("active", mode === "slide");
  state.aButton.classList.toggle("active", mode === "toggle" && !state.showingB);
  state.bButton.classList.toggle("active", mode === "toggle" && state.showingB);
  state.slideButton.setAttribute("aria-pressed", String(mode === "slide"));
  state.aButton.setAttribute("aria-pressed", String(mode === "toggle" && !state.showingB));
  state.bButton.setAttribute("aria-pressed", String(mode === "toggle" && state.showingB));
}

// In toggle mode the reveal is all or nothing.
function applyToggle(state) {
  state.fraction = state.showingB ? 0 : 1;
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
  const identity = document.createElement("div");
  identity.className = "ausboss-compare-identity";
  const identityLeft = document.createElement("span");
  const identityRight = document.createElement("span");
  identityLeft.textContent = "A";
  identityRight.textContent = "B";
  identity.append(identityLeft, identityRight);
  const tools = document.createElement("div");
  tools.className = "ausboss-compare-tools";
  const slideButton = makeToolButton("SLIDE", "Slide: the seam follows the pointer across the image");
  const aButton = makeToolButton("A", "Lock preview A (turn sliding off)");
  const bButton = makeToolButton("B", "Lock preview B (turn sliding off)");
  tools.setAttribute("role", "group");
  tools.setAttribute("aria-label", "Compare preview mode");
  tools.append(slideButton, aButton, bButton);
  stage.append(imageB, imageA, seam, status, identity);
  const caption = document.createElement("div");
  caption.className = "ausboss-compare-caption";
  const footer = document.createElement("div");
  footer.className = "ausboss-compare-footer";
  footer.append(caption, tools);
  root.append(stage, footer);

  const widget = node.addDOMWidget(PANEL_WIDGET, "ausboss_compare", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => PANEL_MIN_HEIGHT + WIDGET_FRAME,
  });
  keepDomWidgetWidthAuto(widget);
  // Not saved with the workflow either: options.serialize only keeps it out
  // of the prompt, and saved values come back by position.
  widget.serialize = false;
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
    node, root, stage, imageA, imageB, seam, status, caption, identity, identityLeft, identityRight,
    slideButton, aButton, bButton,
    widget, abort, refs: null, fraction: 1, loaded: 0, showingB: false,
  };
  applyClip(state);
  updateModeButtons(state);

  const signal = abort.signal;
  // The labels are placed in pixels, so they follow the stage's width.
  const resized = new ResizeObserver(() => applyClip(state));
  resized.observe(stage);
  signal.addEventListener("abort", () => resized.disconnect());
  slideButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const changed = getMode(node) !== "slide";
    node.properties.ausboss_compare_mode = normalizeCompareMode("slide");
    state.showingB = false;
    state.fraction = 1;
    applyClip(state);
    updateModeButtons(state);
    node.setDirtyCanvas?.(true, true);
    // The mode saves with the workflow; flipping A/B within it does not.
    if (changed) notifyAusbossChange();
  }, { signal });

  for (const [button, showingB] of [[aButton, false], [bButton, true]]) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const changed = getMode(node) !== "toggle" || state.showingB !== showingB;
      // Keep the legacy mode key; the optional side property restores new locks.
      node.properties.ausboss_compare_mode = "toggle";
      node.properties.ausboss_compare_side = showingB ? "B" : "A";
      state.showingB = showingB;
      applyToggle(state);
      if (changed) notifyAusbossChange();
    }, { signal });
  }

  // Movement belongs to the preview only; graph dragging and panning remain
  // untouched. A/B locks ignore pointer movement and exits.
  stage.addEventListener("pointermove", (event) => {
    if (tools.contains(event.target)) return;
    if (!state.refs || getMode(node) !== "slide") return;
    const rect = stage.getBoundingClientRect();
    state.fraction = slideFraction(event.clientX, rect.left, rect.width);
    applyClip(state);
  }, { signal });

  // Settle to the nearest full image on every exit, including top/bottom.
  stage.addEventListener("pointerleave", (event) => {
    if (!state.refs || getMode(node) !== "slide") return;
    const rect = stage.getBoundingClientRect();
    state.fraction = slideFraction(event.clientX, rect.left, rect.width, true);
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

// Going back to a workflow tab puts its results back in ComfyUI's store,
// but the panel only ever filled from onExecuted. Show the stored pair.
function showStoredResult(node) {
  const state = node.__ausbossCompare;
  if (!state || state.refs) return;
  const refs = findCompareImages(app.nodeOutputs?.[outputKey(node, app.rootGraph ?? app.graph)]);
  if (refs) loadPreviews(state, refs);
}

app.registerExtension({
  name: "ausboss.compare.panel",
  onNodeOutputsUpdated() {
    setTimeout(() => {
      for (const node of app.graph?._nodes ?? []) if (node?.comfyClass === NODE_NAME) showStoredResult(node);
    }, 0);
  },
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
        state.showingB = this.properties?.ausboss_compare_side === "B";
        if (getMode(this) === "toggle") applyToggle(state);
        else updateModeButtons(state);
      });
    });
    chainCallback(nodeType.prototype, "onExecuted", function (message) {
      if (isForeignRun()) return;
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
