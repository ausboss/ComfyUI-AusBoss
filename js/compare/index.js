import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { isForeignRun, outputKey } from "../shared/prompt_scope.mjs";
import { BRAND, chainCallback, keepDomWidgetWidthAuto, notifyAusbossChange } from "../shared/index.mjs";
import { lookupLink } from "../shared/graph_links.mjs";
import { WIDGET_FRAME, fillNodeHeight, growToNodeFloor } from "../shared/panel_layout.mjs";
import { mediaViewQuery, responsivePreviewHeight } from "../shared/video_preview.mjs";
import { makeSlideSwitch } from "../shared/slide_switch.mjs";
import { makePictureStepper } from "../shared/picture_stepper.mjs";
import { keepIndex, stepIndex } from "../shared/picture_steps.mjs";
import { VIDEO_MIN_WIDTH, ensureVideoCss } from "../shared/video_ui.mjs";
import {
  slideFraction,
  compareBadges,
  compareClip,
  compareResultSide,
  compareSizeLabel,
  compareSwitchValue,
  findComparePairs,
  normalizeCompareMode,
  sizeAfterErase,
} from "../shared/compare.mjs";
import { savedLinks } from "../shared/compare_erase.mjs";
import { ERASE_CSS, makeEraser } from "../shared/compare_erase_stage.mjs";

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
const CSS_ID = "ausboss-compare-ui-v6";
const ROOT_GAP = 6;
const FOOTER_GAP = 8;
const BADGE_WIDTH = 22;
const REST_SETTING = "AusBoss.Compare.RestOnResult";
const SIZE_BEFORE_ERASE = "ausboss_compare_size_before_erase";
let restOnResult = true;

function ensureCompareCss() {
  ensureVideoCss(); // tool button styles are shared with the video panels
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-compare-root{box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;gap:${ROOT_GAP}px;padding:2px 6px 6px;color:#d8eeee;font:11px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden;}
.ausboss-compare-stage{position:relative;flex:1 1 auto;min-height:112px;overflow:hidden;border:1px solid rgba(0,180,170,.34);border-radius:6px;background:#000;box-shadow:inset 0 0 0 1px rgba(255,255,255,.025);touch-action:none;}
.ausboss-compare-stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;user-select:none;-webkit-user-drag:none;}
.ausboss-compare-stage.is-empty img{visibility:hidden;}
.ausboss-compare-seam{position:absolute;top:0;bottom:0;z-index:2;width:1px;margin-left:-0.5px;background:${BRAND};box-shadow:0 0 4px rgba(0,180,170,.55);opacity:0;pointer-events:none;}
.ausboss-compare-status{position:absolute;left:7px;top:7px;z-index:3;max-width:calc(100% - 112px);padding:3px 6px;border-radius:4px;background:rgba(0,0,0,.7);color:#b8d3d1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;backdrop-filter:blur(4px);}
/* Once the previews are up the status has nothing to say, and an empty chip
   over the corner of the picture is just something in the way. */
.ausboss-compare-status:empty{display:none;}
.ausboss-compare-stage.is-empty .ausboss-compare-status{left:50%;top:50%;max-width:82%;transform:translate(-50%,-50%);color:#78908e;text-align:center;white-space:normal;}
.ausboss-compare-footer{display:flex;align-items:center;gap:${FOOTER_GAP}px;flex:none;height:24px;}
.ausboss-compare-identity{position:absolute;left:0;right:0;top:7px;height:22px;z-index:3;pointer-events:none;}
.ausboss-compare-identity span{position:absolute;top:0;width:${BADGE_WIDTH}px;height:22px;border-radius:4px;background:rgba(0,0,0,.7);color:#d8eeee;font-weight:600;text-align:center;line-height:22px;}
.ausboss-compare-identity span[hidden]{display:none;}
.ausboss-compare-stage.is-empty .ausboss-compare-identity{display:none;}
.ausboss-compare-caption{flex:1;min-width:0;height:${CAPTION_HEIGHT}px;overflow:hidden;color:#8ba3a1;font-size:10px;line-height:${CAPTION_HEIGHT}px;text-align:center;white-space:nowrap;text-overflow:ellipsis;}
.ausboss-compare-caption a{color:${BRAND};font-weight:700;text-decoration:none;cursor:pointer;}
.ausboss-compare-caption a:hover{text-decoration:underline;}
${ERASE_CSS}`;
  document.head.appendChild(style);
}

function getMode(node) {
  node.properties ??= {};
  node.properties.ausboss_compare_mode = normalizeCompareMode(
    node.properties.ausboss_compare_mode,
  );
  return node.properties.ausboss_compare_mode;
}

// One floor for every mode: Erase fits its rows into the node as it is, so
// picking it never moves the node's edge over its neighbours.
const PANEL_FLOOR = PANEL_MIN_HEIGHT + WIDGET_FRAME;

// A and B ride on either side of the split line (compareBadges), so each
// label sits on the picture it names wherever the line is.
function applyClip(state) {
  const { clipPath, seamLeft, seamVisible, showA, showB } = compareClip(state.fraction);
  state.imageA.style.clipPath = clipPath;
  // "" hands a picture back to the stylesheet, which hides both while the
  // stage is empty.
  state.imageA.style.visibility = showA ? "" : "hidden";
  state.imageB.style.visibility = showB ? "" : "hidden";
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

// After a save the caption names the files as links: ComfyUI often runs on
// another computer, and this is how the mix gets from there to an editor.
// The next pair of pictures puts the size back.
function showSaved(state, files) {
  const links = savedLinks(files);
  if (!links.length) return;
  state.caption.textContent = "Saved ";
  links.forEach(({ label, file }, index) => {
    const link = document.createElement("a");
    link.textContent = label;
    link.href = api.apiURL(`/view?${mediaViewQuery(file, "output")}`);
    link.download = file.filename;
    link.title = `Download ${file.filename}`;
    link.addEventListener("pointerdown", (event) => event.stopPropagation());
    state.caption.append(index ? " · " : "", link);
  });
}

function updateModeButtons(state) {
  state.modeSwitch.set(compareSwitchValue(getMode(state.node), state.showingB));
}

// Hand the stage to the brush, or take it back, when the mode says so. The
// node keeps its size: Erase's rows wrap and take their room from the
// picture. Pack 2.12.1 grew a small node for Erase and kept the size from
// before with the workflow; a node saved like that still gets it back.
function syncErase(state) {
  const node = state.node;
  const on = getMode(node) === "erase";
  if (state.eraser.active === on) return;
  state.eraser.setActive(on);
  if (on || !node.size) return;
  const back = sizeAfterErase([...node.size], node.properties[SIZE_BEFORE_ERASE]);
  delete node.properties[SIZE_BEFORE_ERASE];
  if (back) node.setSize?.(back);
}

// In toggle mode the reveal is all or nothing.
function applyToggle(state) {
  state.fraction = state.showingB ? 0 : 1;
  applyClip(state);
  updateModeButtons(state);
  state.node.setDirtyCanvas?.(true, true);
}

// One graph's links, in the shape compareResultSide reads them.
function linkView(graph) {
  const origin = (linkId) => {
    const link = lookupLink(graph, linkId);
    return link ? { id: String(link.origin_id), slot: link.origin_slot } : null;
  };
  return {
    origin,
    feeds: (id) => (graph?.getNodeById?.(id)?.inputs ?? []).map((input) => origin(input?.link)?.id),
    inside(id) {
      const subgraph = graph?.getNodeById?.(id)?.subgraph;
      if (!subgraph) return null;
      const view = linkView(subgraph);
      return { ...view, output: (slot) => view.origin(subgraph.outputs?.[slot]?.linkIds?.[0]) };
    },
  };
}

// Which input holds the result, read from the graph the panel sits in.
function resultSide(node) {
  const view = linkView(node.graph);
  const source = (name) => view.origin(node.inputs?.find((input) => input?.name === name)?.link);
  return compareResultSide(source("image_a"), source("image_b"), view);
}

// Slide mode rests on the result while the pointer is away.
function showResult(state) {
  state.fraction = resultSide(state.node) === "B" ? 0 : 1;
  applyClip(state);
}

// A click on the mode switch. The mode saves with the workflow; a flip
// between A and B within the lock does too, through the side it stores.
function pickMode(state, value) {
  const node = state.node;
  const before = compareSwitchValue(getMode(node), state.showingB);
  if (value === "slide") {
    node.properties.ausboss_compare_mode = normalizeCompareMode("slide");
    state.showingB = false;
    state.fraction = 1;
    syncErase(state);
    if (restOnResult) showResult(state);
    else applyClip(state);
  } else if (value === "erase") {
    node.properties.ausboss_compare_mode = "erase";
    syncErase(state);
  } else {
    // Keep the legacy mode key; the optional side property restores new locks.
    node.properties.ausboss_compare_mode = "toggle";
    node.properties.ausboss_compare_side = value === "b" ? "B" : "A";
    state.showingB = value === "b";
    syncErase(state);
    applyToggle(state);
  }
  updateModeButtons(state);
  node.setDirtyCanvas?.(true, true);
  if (value !== before) notifyAusbossChange();
}

function loadPreviews(state, refs) {
  state.refs = refs;
  state.loaded = 0;
  state.eraser.setPictures(null);
  setEmpty(state, "Loading previews…");
  // A new pair opens on the result, unless a lock or the pointer holds the view.
  if (restOnResult && getMode(state.node) === "slide" && !state.stage.matches(":hover")) showResult(state);
  state.imageA.src = api.apiURL(`/view?${mediaViewQuery(refs.a, "temp")}`);
  state.imageB.src = api.apiURL(`/view?${mediaViewQuery(refs.b, "temp")}`);
}

// The arrows need room beside the mode switch. While they show, the node's
// floor is what the footer's fixed parts take, measured; the caption gives
// way first.
function compareMinWidth(state) {
  if (!state || state.stepper.root.hidden) return VIDEO_MIN_WIDTH;
  const parts = state.stepper.root.offsetWidth + state.modeSwitch.root.offsetWidth;
  if (!parts || !state.footer.clientWidth) return VIDEO_MIN_WIDTH;
  const inset = state.node.size[0] - state.footer.clientWidth;
  return Math.max(VIDEO_MIN_WIDTH, Math.ceil(inset + parts + 2 * FOOTER_GAP));
}

// A run's pairs. The panel shows one, and the arrows step through the rest:
// a list of pictures runs the node once per picture.
function showPairs(state, pairs) {
  const hidden = state.stepper.root.hidden;
  state.pairs = pairs;
  state.index = keepIndex(state.index, pairs.length);
  state.stepper.set(state.index, pairs.length);
  if (state.stepper.root.hidden !== hidden) growToNodeFloor(state.widget);
  if (pairs.length) loadPreviews(state, pairs[state.index]);
}

// Align swaps B for B lined up with A, or back: the pair on screen changes,
// and so does the one the arrows come back to.
function showAligned(state, refs) {
  if (!refs) return;
  if (state.pairs[state.index]) state.pairs[state.index] = refs;
  loadPreviews(state, refs);
}

function stepPair(state, step) {
  if (state.pairs.length < 2) return;
  state.index = stepIndex(state.index, state.pairs.length, step);
  state.stepper.set(state.index, state.pairs.length);
  loadPreviews(state, state.pairs[state.index]);
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
  const abort = new AbortController();
  const signal = abort.signal;
  // One switch for what the panel does: slide across the pair, hold one of
  // the two, or mix them with the brush. Its marker slides to the choice.
  const modeSwitch = makeSlideSwitch({
    label: "What the panel does",
    // Each choice as wide as its name, so the row still fits a narrow node.
    fit: true,
    options: [
      { value: "slide", label: "Slide", title: "Slide: the line follows the pointer across the picture, A on its left and B on its right" },
      { value: "a", label: "A", title: "Show picture A and hold it" },
      { value: "b", label: "B", title: "Show picture B and hold it" },
      { value: "erase", label: "Erase", title: "Erase: rub one picture away with a brush so the other shows through, then save the mix" },
    ],
    value: "slide",
    signal,
    onChange: (value) => node.__ausbossCompare && pickMode(node.__ausbossCompare, value),
  });
  stage.append(imageB, imageA, seam, status, identity);
  const caption = document.createElement("div");
  caption.className = "ausboss-compare-caption";
  const eraser = makeEraser({
    node, root, stage, imageA, imageB, signal,
    onSaved: (files) => showSaved(node.__ausbossCompare, files),
    onAligned: (refs) => node.__ausbossCompare && showAligned(node.__ausbossCompare, refs),
  });
  const stepper = makePictureStepper({
    noun: "pair",
    signal,
    onStep: (step) => node.__ausbossCompare && stepPair(node.__ausbossCompare, step),
  });
  const footer = document.createElement("div");
  footer.className = "ausboss-compare-footer";
  footer.append(stepper.root, caption, modeSwitch.root);
  root.append(eraser.bar, stage, footer, eraser.saveRow);

  const widget = node.addDOMWidget(PANEL_WIDGET, "ausboss_compare", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => PANEL_FLOOR,
  });
  keepDomWidgetWidthAuto(widget);
  // Not saved with the workflow either: options.serialize only keeps it out
  // of the prompt, and saved values come back by position.
  widget.serialize = false;
  // + WIDGET_FRAME: the frontend insets the element, so a bare floor hands
  // the panel fewer CSS pixels than the stage + caption minimums and shaves
  // the caption's glyphs at the node's minimum height.
  fillNodeHeight(widget, {
    minWidth: () => compareMinWidth(node.__ausbossCompare),
    minHeight: PANEL_FLOOR,
    minNodeSize: [VIDEO_MIN_WIDTH, 220],
    exactMinWidth: true,
  });

  const state = node.__ausbossCompare = {
    node, root, stage, imageA, imageB, seam, status, caption, identity, identityLeft, identityRight,
    footer, modeSwitch, eraser, stepper,
    widget, abort, refs: null, pairs: [], index: 0, fraction: 1, loaded: 0, showingB: false,
  };
  applyClip(state);
  updateModeButtons(state);

  // The labels are placed in pixels, so they follow the stage's width.
  const resized = new ResizeObserver(() => applyClip(state));
  resized.observe(stage);
  signal.addEventListener("abort", () => resized.disconnect());
  // Movement belongs to the preview only; graph dragging and panning remain
  // untouched. A/B locks ignore pointer movement and exits.
  stage.addEventListener("pointermove", (event) => {
    if (!state.refs || getMode(node) !== "slide") return;
    const rect = stage.getBoundingClientRect();
    state.fraction = slideFraction(event.clientX, rect.left, rect.width);
    applyClip(state);
  }, { signal });

  // Back to the result on every exit, including top/bottom. With the
  // setting off, settle to the nearest full image instead.
  stage.addEventListener("pointerleave", (event) => {
    if (!state.refs || getMode(node) !== "slide") return;
    if (restOnResult) return showResult(state);
    const rect = stage.getBoundingClientRect();
    state.fraction = slideFraction(event.clientX, rect.left, rect.width, true);
    applyClip(state);
  }, { signal });

  const onImageLoad = () => {
    state.loaded += 1;
    if (state.loaded >= 2) {
      setReady(state);
      eraser.setPictures(state.refs);
      node.setDirtyCanvas?.(true, true);
    }
  };
  imageA.addEventListener("load", onImageLoad, { signal });
  imageB.addEventListener("load", onImageLoad, { signal });
  const onImageError = () => {
    eraser.setPictures(null);
    setEmpty(state, "A compare preview could not load");
  };
  imageA.addEventListener("error", onImageError, { signal });
  imageB.addEventListener("error", onImageError, { signal });

  return state;
}

// Going back to a workflow tab puts its results back in ComfyUI's store,
// but the panel only ever filled from onExecuted. Show the stored pair.
function showStoredResult(node) {
  const state = node.__ausbossCompare;
  if (!state || state.refs) return;
  showPairs(state, findComparePairs(app.nodeOutputs?.[outputKey(node, app.rootGraph ?? app.graph)]));
}

app.registerExtension({
  name: "ausboss.compare.panel",
  settings: [
    {
      id: REST_SETTING,
      name: "Rest on the result",
      type: "boolean",
      defaultValue: true,
      category: ["🆎 AusBoss", "Image Compare", "Rest on the result"],
      tooltip:
        "While the pointer is away, Image Compare A/B shows the result: "
        + "after every run, and again each time the pointer leaves the "
        + "picture. Off: it stays on the picture nearest to where the "
        + "pointer left, and a new run does not change it.",
      onChange(value) {
        restOnResult = value !== false;
      },
    },
  ],
  setup() {
    // onChange only fires on later edits, so seed from the stored value here.
    restOnResult = app.ui?.settings?.getSettingValue?.(REST_SETTING) !== false;
  },
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
        syncErase(state);
        // The saved paint, if the pictures are already up.
        if (state.refs && state.loaded >= 2) state.eraser.setPictures(state.refs);
        if (getMode(this) === "toggle") applyToggle(state);
        else updateModeButtons(state);
      });
    });
    chainCallback(nodeType.prototype, "onExecuted", function (message) {
      if (isForeignRun()) return;
      const state = buildPanel(this);
      const pairs = findComparePairs(message);
      showPairs(state, pairs);
      if (!pairs.length) setEmpty(state, "Execution finished without compare previews");
      app.canvas?.setDirty?.(true, true);
    });
    // A link on the filename input decides whether the name is typed here.
    chainCallback(nodeType.prototype, "onConnectionsChange", function () {
      this.__ausbossCompare?.eraser?.refresh();
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      this.__ausbossCompare?.abort?.abort();
      this.__ausbossCompare = null;
    });
  },
});
