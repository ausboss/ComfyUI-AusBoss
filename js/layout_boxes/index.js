// Layout Boxes 🆎: the canvas on the node.
//
// Drag on the canvas to draw a box, drag a box to move it, drag its handles
// to size it. Under the canvas the chosen box's type, words and colors. The
// canvas size is the card above it (js/widget_cards), or a picture on
// `background`, or what width and height are wired to.
//
// The panel drives the hidden `layout` widget, so saving, loading, undo and
// the API format all go the usual way, in the classic look and in Nodes 2.0
// alike. The geometry and the saved form are js/shared/layout_boxes.mjs; the
// outputs are worked out by nodes/_layout_boxes_helpers.py.
//
// Keys while the canvas has the focus: Delete removes the chosen box, the
// arrows move it one pixel (Shift: ten), Ctrl + D copies it, Esc lets go of
// it. Ctrl (or Alt) while dragging leaves the grid off. The grid starts off
// over a picture on `background`; a click on Grid is saved with the node.

import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { BRAND, chainCallback, keepDomWidgetWidthAuto, notifyAusbossChange, showToast } from "../shared/index.mjs";
import { keepKeyInField } from "../shared/canvas_passthrough.mjs";
import { describeSourcePreview, outputLocatorId } from "../shared/input_preview.mjs";
import { WIDGET_FRAME, fillNodeHeight } from "../shared/panel_layout.mjs";
import { isForeignRun } from "../shared/prompt_scope.mjs";
import { gearIconSvg, openSettingsMenu } from "../shared/settings_menu.mjs";
import { commitWidgetValue } from "../shared/widget_card_math.mjs";
import { hideInputsInDef, hideWidget } from "../shared/widget_visibility.mjs";
import {
  CHIPS_MAX,
  GRID_SIZES,
  HANDLES,
  HANDLE_PX,
  LAYOUTS,
  MAX_BOXES,
  MAX_COLORS,
  TAG_HEIGHT_PX,
  applyLayout,
  boxColor,
  boxKind,
  boxMarks,
  boxSizePx,
  boxTag,
  boxWords,
  canvasSide,
  chipWindow,
  copiedRect,
  drawnRect,
  faceCanvas,
  fromPixels,
  gridCellOf,
  gridIsOn,
  inputLink,
  keptWordsNote,
  movedRect,
  newBox,
  normalizeHex,
  nudgeStep,
  nudgedRect,
  parseLayout,
  resizedRect,
  serializeLayout,
  sideForPicture,
  snapping,
  tagWidthPx,
  textOn,
  wholePixels,
  wiredNumber,
  wiredSource,
} from "../shared/layout_boxes.mjs";

const NODE_CLASS = "AUSBOSS_NODES_LayoutBoxes";
const WIDGET_NAME = "ausboss_layout_boxes";
const UI_KEY = "ausboss_layout_boxes";
const GRID_PROPERTY = "ausboss_layout_grid";
const GRID_SIZE_PROPERTY = "ausboss_layout_grid_size";
// The gear's settings belong to the node they were set on.
const SETTINGS_SCOPE = "layout_boxes";
const SETTINGS_SCHEMA = [
  {
    key: "grid_size", label: "Grid size", type: "choice", options: GRID_SIZES, default: "Auto", persist: false,
    hint: "Pixels between grid lines. Auto is 32, more on a very big canvas. Kept on this node.",
  },
];
const INPUT_SIDE = 1; // LiteGraph.INPUT

const MIN_WIDTH = 360;
const OPENING_WIDTH = 420;
// Room for the canvas on a node that is new, over its smallest height.
const OPENING_ROOM = 220;
const BAR_HEIGHT = 26;
// The box chips and the chosen box's own row, then its words and colors.
const CHIPS_HEIGHT = 22;
const EDITOR_HEIGHT = 184;
const STAGE_MIN = 140;
const GAP = 6;
const PANEL_MIN = BAR_HEIGHT + GAP + STAGE_MIN + GAP + EDITOR_HEIGHT;
// The canvas keeps this much space around it inside the stage.
const STAGE_MARGIN = 8;
// Screen pixels a pointer moves before a press becomes a drag.
const MOVE_START = 3;
const DRAW_START = 6;
// How long the box's place stays in view after an arrow key moved it.
const READOUT_MS = 1500;
// A zoom is measured again this long after the graph stops zooming.
const ZOOM_SETTLE_MS = 160;
const FONT = `-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`;
const MONO = `ui-monospace,"Cascadia Mono",Consolas,monospace`;

const live = new Set();
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

function el(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, title, onClick) {
  const node = el("button", className, text);
  node.type = "button";
  if (title) node.title = title;
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick(event);
  });
  return node;
}

const findWidget = (node, name) => node?.widgets?.find((widget) => widget?.name === name) ?? null;

function ensureCss() {
  if (document.getElementById("ausboss-lb-css")) return;
  const style = document.createElement("style");
  style.id = "ausboss-lb-css";
  style.textContent = `
.ausboss-lb{--lb-u:1;box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;gap:${GAP}px;overflow:hidden;font:12px/1.3 ${FONT};color:#c8dddd}
.ausboss-lb *{box-sizing:border-box}
.ausboss-lb [hidden]{display:none!important}
.ausboss-lb-bar{flex:none;height:${BAR_HEIGHT}px;display:flex;align-items:center;gap:6px;min-width:0}
.ausboss-lb-btn{flex:none;height:24px;display:inline-flex;align-items:center;gap:5px;padding:0 9px;border:1px solid #2a3437;border-radius:6px;background:#0f1516;color:#8ba3a1;font:600 10.5px/1 ${FONT};cursor:pointer;white-space:nowrap}
.ausboss-lb-btn:hover{border-color:${BRAND};color:#fff}
.ausboss-lb-btn.on{border-color:rgba(0,180,170,.55);background:rgba(0,180,170,.14);color:#7fe9e2}
.ausboss-lb-btn svg{width:12px;height:12px;flex:none}
.ausboss-lb-btn.icon{width:26px;padding:0;justify-content:center}
.ausboss-lb-size{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;text-align:right;white-space:nowrap;color:#5f7674;font:600 10.5px ${MONO}}
.ausboss-lb-stage{flex:1 1 auto;min-height:0;position:relative;overflow:hidden;border:1px solid rgba(0,180,170,.22);border-radius:8px;background:#0b0f10;outline:none;touch-action:none}
.ausboss-lb-stage:focus-visible{border-color:${BRAND}}
.ausboss-lb-frame{position:absolute;left:0;top:0;overflow:hidden;background:#161c1d;box-shadow:0 0 0 1px #2e3a3c;cursor:crosshair}
.ausboss-lb-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;opacity:.55;pointer-events:none;user-select:none;-webkit-user-drag:none}
.ausboss-lb-grid{position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(circle at 0 0,rgba(205,225,225,.32) 1px,transparent 1.6px)}
.ausboss-lb-box{position:absolute;box-shadow:inset 0 0 0 calc(1.5px*var(--lb-u)) var(--c);background:color-mix(in srgb,var(--c) 13%,transparent);cursor:move}
.ausboss-lb-box.sel{z-index:5;background:color-mix(in srgb,var(--c) 22%,transparent);box-shadow:inset 0 0 0 calc(2px*var(--lb-u)) var(--c),0 0 0 calc(1px*var(--lb-u)) rgba(0,0,0,.55)}
.ausboss-lb-frame.pic .ausboss-lb-box{background:color-mix(in srgb,var(--c) 5%,transparent)}
.ausboss-lb-frame.pic .ausboss-lb-box.sel{background:color-mix(in srgb,var(--c) 9%,transparent)}
.ausboss-lb-strip{position:absolute;left:0;right:0;top:0;height:calc(4px*var(--lb-u));display:flex;pointer-events:none}
.ausboss-lb-strip i{flex:1 1 0}
.ausboss-lb-tag{position:absolute;left:0;bottom:100%;z-index:4;height:calc(${TAG_HEIGHT_PX}px*var(--lb-u));padding:0 calc(5px*var(--lb-u));border-radius:calc(3px*var(--lb-u)) calc(3px*var(--lb-u)) 0 0;background:var(--c);color:var(--t);font:500 calc(10px*var(--lb-u))/calc(${TAG_HEIGHT_PX}px*var(--lb-u)) ${MONO};white-space:nowrap;pointer-events:none}
.ausboss-lb-tag b{font-weight:800}
.ausboss-lb-box.tag-in>.ausboss-lb-tag{bottom:auto;top:0;left:0;border-radius:0 0 calc(3px*var(--lb-u)) 0}
.ausboss-lb-box.tag-r>.ausboss-lb-tag{left:auto;right:0}
.ausboss-lb-box.tag-in.tag-r>.ausboss-lb-tag{right:0;border-radius:0 0 0 calc(3px*var(--lb-u))}
.ausboss-lb-words{position:absolute;left:0;right:0;top:calc(4px*var(--lb-u));bottom:0;padding:min(2px,calc(2px*var(--lb-u))) min(5px,calc(5px*var(--lb-u)));overflow:hidden;color:#f4f8f8;font:min(11px,calc(13px*var(--lb-u)))/1.3 ${FONT};text-shadow:0 1px 2px #000,0 0 2px #000;white-space:pre-line;word-break:break-word;pointer-events:none}
.ausboss-lb-frame.pic .ausboss-lb-words{display:none}
.ausboss-lb-box.tag-in>.ausboss-lb-words{top:calc(${TAG_HEIGHT_PX}px*var(--lb-u))}
.ausboss-lb-handle{position:absolute;width:calc(${HANDLE_PX}px*var(--lb-u));height:calc(${HANDLE_PX}px*var(--lb-u));margin:calc(${-HANDLE_PX / 2}px*var(--lb-u)) 0 0 calc(${-HANDLE_PX / 2}px*var(--lb-u));display:none;z-index:6;touch-action:none}
.ausboss-lb-handle::after{content:"";position:absolute;inset:calc(3px*var(--lb-u));border-radius:calc(1px*var(--lb-u));background:#f4f8f8;box-shadow:0 0 0 calc(1px*var(--lb-u)) #061010}
.ausboss-lb-box.sel .ausboss-lb-handle{display:block}
.ausboss-lb-box.sel.no-tb .ausboss-lb-handle:is([data-h="n"],[data-h="s"]),.ausboss-lb-box.sel.no-lr .ausboss-lb-handle:is([data-h="e"],[data-h="w"]){display:none}
.ausboss-lb-handle[data-h="nw"]{left:0;top:0;cursor:nwse-resize}
.ausboss-lb-handle[data-h="n"]{left:50%;top:0;cursor:ns-resize}
.ausboss-lb-handle[data-h="ne"]{left:100%;top:0;cursor:nesw-resize}
.ausboss-lb-handle[data-h="e"]{left:100%;top:50%;cursor:ew-resize}
.ausboss-lb-handle[data-h="se"]{left:100%;top:100%;cursor:nwse-resize}
.ausboss-lb-handle[data-h="s"]{left:50%;top:100%;cursor:ns-resize}
.ausboss-lb-handle[data-h="sw"]{left:0;top:100%;cursor:nesw-resize}
.ausboss-lb-handle[data-h="w"]{left:0;top:50%;cursor:ew-resize}
.ausboss-lb-ghost{position:absolute;z-index:7;border:calc(1.5px*var(--lb-u)) dashed ${BRAND};background:rgba(0,180,170,.12);pointer-events:none}
.ausboss-lb-empty{position:absolute;inset:0;display:grid;place-items:center;padding:14px;text-align:center;color:#6f8886;font:12px/1.4 ${FONT};pointer-events:none}
.ausboss-lb-readout{position:absolute;left:6px;bottom:5px;z-index:8;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,.66);color:#d8ecea;font:600 10.5px ${MONO};pointer-events:none;white-space:nowrap}
.ausboss-lb-readout[hidden]{display:none}
.ausboss-lb-editor{flex:none;height:${EDITOR_HEIGHT}px;display:flex;flex-direction:column;gap:5px;padding:6px 8px;overflow:hidden;border:1px solid rgba(0,180,170,.22);border-radius:8px;background:rgba(0,0,0,.28)}
.ausboss-lb-chips{flex:none;height:${CHIPS_HEIGHT}px;display:flex;align-items:center;gap:4px;min-width:0}
.ausboss-lb-chips>span{flex:1 1 auto;min-width:0;display:flex;gap:4px;overflow:hidden}
.ausboss-lb-chips .ausboss-lb-tool{width:22px;height:22px}
.ausboss-lb-chip{flex:none;max-width:100%;height:${CHIPS_HEIGHT}px;padding:0 7px 0 6px;border:1px solid #2a3437;border-left:3px solid var(--c);border-radius:5px;background:#0f1516;color:#8ba3a1;font:500 10.5px/1 ${MONO};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.ausboss-lb-chip b{font-weight:800}
.ausboss-lb-chip:hover{border-color:#5f7674;border-left-color:var(--c);color:#fff}
.ausboss-lb-chip.on{border-color:var(--c);background:color-mix(in srgb,var(--c) 26%,#0f1516);color:#fff}
.ausboss-lb-head{flex:none;height:24px;display:flex;align-items:center;gap:6px;min-width:0}
.ausboss-lb-head>b{flex:none;color:#d8ecea;font:600 11px ${FONT};white-space:nowrap}
.ausboss-lb-kept{flex:none;padding:3px 8px;border:1px dashed #3a4749;border-radius:6px;color:#8ba3a1;font:11px/1.35 ${FONT}}
.ausboss-lb-tool{flex:none;width:24px;height:24px;display:grid;place-items:center;padding:0;border:1px solid #2a3437;border-radius:6px;background:#0f1516;color:#8ba3a1;font:600 12px/1 ${FONT};cursor:pointer}
.ausboss-lb-tool:hover{border-color:${BRAND};color:#fff}
.ausboss-lb-tool.danger:hover{border-color:#e07a6a;color:#e07a6a}
.ausboss-lb-tool:disabled{opacity:.35;pointer-events:none}
.ausboss-lb-tool svg{width:13px;height:13px}
.ausboss-lb-seg{flex:1 1 auto;min-width:96px;max-width:170px;height:24px;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;padding:2px;border:1px solid #2a3437;border-radius:6px;background:#0f1516}
.ausboss-lb-seg button{min-width:0;padding:0 2px;border:none;border-radius:4px;background:transparent;color:#8ba3a1;font:600 10.5px/1 ${FONT};cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ausboss-lb-seg button:hover{color:#fff}
.ausboss-lb-seg button.on{background:${BRAND};color:#04201d}
.ausboss-lb-spacer{flex:1 1 auto;min-width:0}
.ausboss-lb-field{position:relative;flex:1 1 0;min-height:0;display:flex}
.ausboss-lb-field.text{flex:none;height:36px}
.ausboss-lb-field[hidden]{display:none}
.ausboss-lb-field>span{position:absolute;top:3px;left:8px;color:#5f7674;font:600 9px/1 ${FONT};letter-spacing:.08em;text-transform:uppercase;pointer-events:none}
.ausboss-lb-field textarea{width:100%;height:100%;min-height:0;margin:0;padding:14px 8px 3px;resize:none;border:1px solid #2a3437;border-radius:6px;background:#0b0f10;color:#d8ecea;font:12px/1.35 ${FONT};overflow:auto;scrollbar-width:thin;scrollbar-color:#2f3d3c transparent}
.ausboss-lb-field textarea:focus{outline:none;border-color:${BRAND}}
.ausboss-lb-field textarea::placeholder{color:#4f6462}
.ausboss-lb-colors{flex:none;height:22px;display:flex;align-items:center;gap:5px;min-width:0}
.ausboss-lb-colors>b{flex:none;width:52px;color:#8ba3a1;font:500 11px ${FONT}}
.ausboss-lb-swatch{position:relative;flex:none;width:20px;height:20px;border:1px solid #2a3437;border-radius:4px;cursor:pointer}
.ausboss-lb-swatch input{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:none;opacity:0;cursor:pointer}
.ausboss-lb-swatch i{position:absolute;top:-6px;right:-6px;width:13px;height:13px;display:none;place-items:center;border-radius:50%;background:#1d2627;color:#e7f2f1;font:700 9px/1 ${FONT};font-style:normal;cursor:pointer;box-shadow:0 0 0 1px #3a4749}
.ausboss-lb-swatch:hover i{display:grid}
.ausboss-lb-swatch i:hover{background:#e07a6a;color:#fff}
.ausboss-lb-add{position:relative;flex:none;height:20px;padding:0 7px;display:grid;place-items:center;border:1px dashed #3a4749;border-radius:4px;color:#8ba3a1;font:600 11px/1 ${FONT};cursor:pointer}
.ausboss-lb-add:hover{border-color:${BRAND};color:#fff}
.ausboss-lb-add input{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:none;opacity:0;cursor:pointer}
.ausboss-lb-add[hidden]{display:none}
.ausboss-lb-hint{flex:1 1 auto;display:grid;place-items:center;padding:4px 10px;text-align:center;color:#6f8886;font:12px/1.45 ${FONT}}
.ausboss-lb-hint[hidden]{display:none}
.ausboss-lb-pop{position:fixed;z-index:100000;width:230px;display:flex;flex-direction:column;gap:2px;padding:6px;border:1px solid #2f3b3d;border-radius:8px;background:#141a1b;box-shadow:0 10px 28px rgba(0,0,0,.55);color:#c8dddd;font:12px ${FONT}}
.ausboss-lb-pop .head{padding:2px 6px 5px;color:#6f8886;font:600 9.5px ${FONT};letter-spacing:.12em;text-transform:uppercase}
.ausboss-lb-pop .item{display:flex;align-items:center;gap:9px;padding:5px 6px;border-radius:5px;cursor:pointer}
.ausboss-lb-pop .item:hover{background:#21292a;color:#7fe9e2}
.ausboss-lb-pop .mini{position:relative;flex:none;width:34px;height:22px;border:1px solid #3a4749;border-radius:2px;background:#0b0f10}
.ausboss-lb-pop .mini i{position:absolute;border:1px solid ${BRAND};background:rgba(0,180,170,.25)}
.ausboss-lb-pop .mini i.text{border-color:#e0a030;background:rgba(224,160,48,.25)}
`;
  document.head.append(style);
}

const ICONS = {
  grid: '<svg viewBox="0 0 12 12" fill="currentColor"><circle cx="2" cy="2" r="1"/><circle cx="6" cy="2" r="1"/><circle cx="10" cy="2" r="1"/><circle cx="2" cy="6" r="1"/><circle cx="6" cy="6" r="1"/><circle cx="10" cy="6" r="1"/><circle cx="2" cy="10" r="1"/><circle cx="6" cy="10" r="1"/><circle cx="10" cy="10" r="1"/></svg>',
  back: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5.5" y="5.5" width="7" height="7" rx="1" fill="currentColor" fill-opacity=".35"/><rect x="1.5" y="1.5" width="7" height="7" rx="1"/></svg>',
  front: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5.5" y="5.5" width="7" height="7" rx="1"/><rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="currentColor" fill-opacity=".35"/></svg>',
  copy: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="4.5" y="4.5" width="8" height="8" rx="1.2"/><path d="M2.5 9.5v-7h7"/></svg>',
};

// ---------- sizes ----------

// The size the canvas has: what width and height are wired to when the page
// can know it, else the node's own values.
// A side wired to a node whose value is only known once the workflow runs
// (Image Size of a picture) shows the size the last run used.
// With a picture shown, the canvas is the picture, at its own size and shape:
// wired numbers would stretch it, and the mask is made on the picture.
function canvasSize(state) {
  const read = (name, at) => wiredNumber(state.node, name)
    ?? (sizeWired(state, name) ? state.lastRun?.size?.[at] : null)
    ?? findWidget(state.node, name)?.value;
  return faceCanvas(state.pictureSize, read("width", 0), read("height", 1));
}

const ownSize = (state) => ({
  width: canvasSide(findWidget(state.node, "width")?.value),
  height: canvasSide(findWidget(state.node, "height")?.value),
});

const sizeWired = (state, name) => Boolean(inputLink(state.node, name));

// The grid steers the mouse only. It starts off over a picture on
// `background`; a click on Grid is saved with the node and wins from then on.
const gridOn = (state) => gridIsOn(state.node.properties?.[GRID_PROPERTY], Boolean(wiredSource(state.node, "background")));

// The grid's size from the gear, kept on the node: Auto until someone picks one.
const gridSize = (state) => {
  const size = String(state.node.properties?.[GRID_SIZE_PROPERTY] ?? "Auto");
  return GRID_SIZES.includes(size) ? size : "Auto";
};

// ---------- writing ----------

function commit(state, { settle = true } = {}) {
  const text = serializeLayout(state.boxes, state.fromInput);
  state.layoutValue = text;
  const widget = findWidget(state.node, "layout");
  if (widget && widget.value !== text) commitWidgetValue(state.node, widget, text, app.canvas);
  state.node.graph?.setDirtyCanvas?.(true, true);
  if (settle) notifyAusbossChange();
}

// What the widget holds now, read again when it is not what this panel last
// wrote: a workflow opened, an undo, a paste, a value set from elsewhere.
function syncFromWidget(state, force = false) {
  if (state.disposed) return;
  const value = findWidget(state.node, "layout")?.value;
  const key = typeof value === "string" ? value : JSON.stringify(value ?? null);
  if (!force && key === state.layoutValue) return;
  state.layoutValue = key;
  const { width, height } = ownSize(state);
  const parsed = parseLayout(value, width, height);
  state.boxes = parsed.boxes;
  state.fromInput = parsed.fromInput;
  state.selected = clamp(state.selected, -1, state.boxes.length - 1);
  renderBoxes(state);
}

// ---------- geometry on screen ----------

function fitFrame(state) {
  const { width, height } = state.size;
  const roomW = Math.max(20, state.stage.clientWidth - STAGE_MARGIN * 2);
  const roomH = Math.max(20, state.stage.clientHeight - STAGE_MARGIN * 2);
  const scale = Math.min(roomW / width, roomH / height);
  const w = Math.max(10, Math.floor(width * scale));
  const h = Math.max(10, Math.floor(height * scale));
  state.frameW = w;
  state.frameH = h;
  Object.assign(state.frame.style, {
    width: `${w}px`,
    height: `${h}px`,
    left: `${Math.round((state.stage.clientWidth - w) / 2)}px`,
    top: `${Math.round((state.stage.clientHeight - h) / 2)}px`,
  });
  paintGrid(state, w, h);
}

function paintGrid(state, frameW, frameH) {
  const { width, height } = state.size;
  const cellW = (gridCellOf(width, gridSize(state)) / width) * frameW;
  const cellH = (gridCellOf(height, gridSize(state)) / height) * frameH;
  // Dots closer than this on the screen read as a grey wash, not a grid.
  const zoom = state.zoom || 1;
  state.grid.hidden = !gridOn(state) || cellW * zoom < 5 || cellH * zoom < 5;
  state.grid.style.backgroundSize = `${cellW}px ${cellH}px`;
}

// The Grid button and the dots again, when the grid may have changed without
// a click: a picture wired in or taken away, a workflow opened.
function syncGrid(state) {
  const on = gridOn(state);
  if (on === state.gridShown) return;
  state.gridShown = on;
  state.gridBtn.classList.toggle("on", on);
  fitFrame(state);
}

// ---------- the graph's zoom ----------

// Both looks draw the face at the graph's zoom through a CSS transform:
// classic scales each DOM widget, Nodes 2.0 the layer the nodes sit in. The
// marks on the boxes are sized in --lb-u, one screen pixel in the face's own
// pixels, so they keep one size on the screen at any zoom. True when the
// zoom changed.
function syncZoom(state) {
  if (state.disposed) return false;
  const width = state.root.offsetWidth;
  const zoom = width ? state.root.getBoundingClientRect().width / width : NaN;
  if (!Number.isFinite(zoom) || zoom <= 0 || Math.abs(zoom - state.zoom) < 0.001) return false;
  state.zoom = zoom;
  state.root.style.setProperty("--lb-u", String(1 / zoom));
  if (state.frameW) paintGrid(state, state.frameW, state.frameH);
  return true;
}

function syncZoomAll() {
  for (const state of live) if (syncZoom(state)) paintBoxes(state);
}

// The canvas draws itself in both looks, and always when the zoom changes
// (Nodes 2.0 draws no node on it, so a node's own draw hook would miss it).
// A new zoom reaches the faces' styles in the same frame: measure in the
// next one, and once more when the zooming stops.
let zoomCanvas = null;
let zoomSeen = NaN;
let zoomFrame = 0;
let zoomTimer = null;
function watchZoom() {
  const canvas = app.canvas;
  if (!canvas || canvas === zoomCanvas) return;
  zoomCanvas = canvas;
  chainCallback(canvas, "onDrawForeground", () => {
    const scale = zoomCanvas?.ds?.scale;
    if (scale === zoomSeen) return;
    zoomSeen = scale;
    cancelAnimationFrame(zoomFrame);
    zoomFrame = requestAnimationFrame(syncZoomAll);
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(syncZoomAll, ZOOM_SETTLE_MS);
  });
}

// Read the size again; refit and redraw when it changed.
function refreshSize(state) {
  if (state.disposed) return;
  const size = canvasSize(state);
  const wired = sizeWired(state, "width") || sizeWired(state, "height");
  const key = `${size.width}x${size.height}|${wired}|${size.picture}`;
  if (key === state.sizeKey) return;
  state.sizeKey = key;
  state.size = size;
  // The label says where the size comes from.
  const from = size.picture ? "picture" : wired ? "wired" : "";
  state.sizeEl.textContent = `${size.width} × ${size.height}${from ? ` · ${from}` : ""}`;
  state.sizeEl.title = size.picture
    ? "The canvas is the picture on background, at its own size: the boxes are drawn on it."
    : wired
      ? "The canvas size, from what width and height are wired to."
      : "The canvas size. Change it in the card above, or wire width and height in.";
  fitFrame(state);
  paintBoxes(state);
  watchUpstream(state);
}

// Canvas pixels under the pointer, from the canvas's place on the screen
// (right at any zoom, in either look).
function pointerPixels(state, event) {
  const rect = state.frame.getBoundingClientRect();
  const { width, height } = state.size;
  return {
    x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * width,
    y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * height,
    inside: event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom,
    screen: rect.width / Math.max(1, width),
  };
}

// ---------- drawing the boxes ----------

function placeBox(element, box) {
  element.style.left = `${box.x * 100}%`;
  element.style.top = `${box.y * 100}%`;
  element.style.width = `${box.w * 100}%`;
  element.style.height = `${box.h * 100}%`;
}

function makeBoxEl(state, index) {
  const box = state.boxes[index];
  const element = el("div", "ausboss-lb-box");
  element.dataset.i = String(index);
  const color = boxColor(box);
  element.style.setProperty("--c", color);
  element.style.setProperty("--t", textOn(color));
  if (box.palette.length) {
    const strip = el("div", "ausboss-lb-strip");
    for (const swatch of box.palette) {
      const part = el("i");
      part.style.background = swatch;
      strip.append(part);
    }
    element.append(strip);
  }
  const tag = el("div", "ausboss-lb-tag");
  tag.append(el("b", "", String(index + 1)), ` ${boxKind(box)}`);
  element.append(tag, el("div", "ausboss-lb-words", boxWords(box)));
  for (const handle of HANDLES) {
    const grip = el("div", "ausboss-lb-handle");
    grip.dataset.h = handle;
    element.append(grip);
  }
  placeBox(element, box);
  dressBox(state, element, box, index);
  return element;
}

// The marks that follow the box's size on the screen: a handle in the middle
// of a side only where it fits, and the tag inside the box, or running
// leftward, where the canvas has no room for it.
function dressBox(state, element, box, index) {
  const zoom = state.zoom || 1;
  const across = (state.frameW || 0) * zoom;
  const down = (state.frameH || 0) * zoom;
  const rect = { x: box.x * across, y: box.y * down, w: box.w * across, h: box.h * down };
  const marks = boxMarks(rect, across, tagWidthPx(boxTag(box, index)));
  element.classList.toggle("no-tb", !marks.middleTopBottom);
  element.classList.toggle("no-lr", !marks.middleLeftRight);
  element.classList.toggle("tag-in", marks.tagInside);
  element.classList.toggle("tag-r", marks.tagFromRight);
}

function renderBoxes(state) {
  for (const element of state.boxEls) element.remove();
  state.boxEls = state.boxes.map((_, index) => makeBoxEl(state, index));
  state.frame.append(...state.boxEls);
  state.empty.hidden = state.boxes.length > 0;
  setSelected(state, clamp(state.selected, -1, state.boxes.length - 1));
}

function paintBoxes(state) {
  state.boxes.forEach((box, index) => {
    const element = state.boxEls[index];
    if (!element) return;
    placeBox(element, box);
    dressBox(state, element, box, index);
  });
}

// One box's look again after its words, type or colors changed.
function repaintBox(state, index) {
  const old = state.boxEls[index];
  if (!old) return;
  const next = makeBoxEl(state, index);
  next.classList.toggle("sel", index === state.selected);
  old.replaceWith(next);
  state.boxEls[index] = next;
  renderChips(state);
}

function showReadout(state, text = "") {
  clearTimeout(state.readoutTimer);
  state.readout.hidden = !text;
  state.readout.textContent = text;
}

// The place for a moment, after a key press: one pixel is too small to see.
function flashReadout(state, text) {
  showReadout(state, text);
  state.readoutTimer = setTimeout(() => showReadout(state), READOUT_MS);
}

function readoutFor(state, index) {
  const box = state.boxes[index];
  if (!box) return "";
  const { width, height } = state.size;
  const rect = wholePixels(box, width, height);
  const [w, h] = boxSizePx(box, width, height);
  return `box ${index + 1}: ${w} × ${h} at ${rect.x0}, ${rect.y0}`;
}

// ---------- choosing a box ----------

function setSelected(state, index) {
  state.selected = index;
  state.boxEls.forEach((element, i) => element.classList.toggle("sel", i === index));
  syncEditor(state);
}

// A box chosen in the editor, as a click on it would: the arrow keys and
// Delete then work on that box.
function chooseBox(state, index) {
  setSelected(state, index);
  state.stage.focus({ preventScroll: true });
}

// The chips under the canvas: one per box with its number and type, the
// chosen one lit. As many as fit with their whole words, up to CHIPS_MAX,
// the chosen box's among them, and ‹ › when some boxes have none.
function renderChips(state) {
  if (!state.chipList) return;
  const count = state.boxes.length;
  state.chipsRow.hidden = !count;
  const key = [state.chipsRow.clientWidth, state.selected, ...state.boxes.map((box) => boxKind(box) + boxColor(box))].join("|");
  if (key === state.chipsKey) return;
  state.chipsKey = key;
  for (let fit = Math.min(count, CHIPS_MAX); fit >= 0; fit -= 1) {
    state.prevBtn.hidden = fit >= count;
    state.nextBtn.hidden = fit >= count;
    const [first, end] = chipWindow(count, state.selected, Math.max(1, fit));
    const chips = [];
    for (let index = first; index < end; index += 1) {
      const box = state.boxes[index];
      const chip = button(`ausboss-lb-chip${index === state.selected ? " on" : ""}`, "", `Choose box ${index + 1}`, () => chooseBox(state, index));
      chip.style.setProperty("--c", boxColor(box));
      chip.append(el("b", "", String(index + 1)), ` ${boxKind(box)}`);
      chips.push(chip);
    }
    state.chipList.replaceChildren(...chips);
    if (fit <= 1 || state.chipList.scrollWidth <= state.chipList.clientWidth + 1) break;
  }
}

function focusWords(state) {
  const box = state.boxes[state.selected];
  if (!box) return;
  const target = box.type === "text" && !box.text ? state.textArea : state.descArea;
  requestAnimationFrame(() => {
    if (state.disposed) return;
    target.focus({ preventScroll: true });
    const end = target.value.length;
    target.setSelectionRange?.(end, end);
  });
}

// ---------- changing the list ----------

function addBox(state, box) {
  if (state.boxes.length >= MAX_BOXES) {
    showToast({ summary: "Layout Boxes", detail: `A canvas holds up to ${MAX_BOXES} boxes.`, severity: "warn" });
    return -1;
  }
  state.boxes.push(box);
  renderBoxes(state);
  setSelected(state, state.boxes.length - 1);
  commit(state);
  return state.boxes.length - 1;
}

function removeBox(state, index) {
  if (index < 0 || index >= state.boxes.length) return;
  state.boxes.splice(index, 1);
  renderBoxes(state);
  setSelected(state, Math.min(index, state.boxes.length - 1));
  commit(state);
}

function copyBox(state, index) {
  const box = state.boxes[index];
  if (!box) return;
  const { width, height } = state.size;
  const size = gridSize(state);
  const rect = copiedRect(wholePixels(box, width, height), width, height, gridCellOf(width, size), gridCellOf(height, size));
  addBox(state, fromPixels(rect, width, height, { type: box.type, text: box.text, desc: box.desc, palette: [...box.palette] }));
}

// Earlier in the list is further back; the last box is in front.
function reorderBox(state, index, step) {
  const to = index + step;
  if (index < 0 || to < 0 || to >= state.boxes.length) return;
  const [box] = state.boxes.splice(index, 1);
  state.boxes.splice(to, 0, box);
  state.selected = to;
  renderBoxes(state);
  commit(state);
}

function clearAll(state) {
  if (!state.boxes.length && !state.fromInput) return;
  state.boxes = [];
  // The boxes on the wire, if any, fill the canvas again on the next run.
  state.fromInput = "";
  renderBoxes(state);
  commit(state);
}

// ---------- gestures ----------

function watchDrag(state, { onMove, onEnd, onCancel }) {
  state.dragAbort?.abort();
  const abort = new AbortController();
  state.dragAbort = abort;
  const { signal } = abort;
  window.addEventListener("pointermove", (event) => onMove(event), { capture: true, signal });
  window.addEventListener("pointerup", (event) => { abort.abort(); onEnd(event); }, { capture: true, signal });
  window.addEventListener("pointercancel", () => { abort.abort(); onCancel(); }, { capture: true, signal });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    abort.abort();
    onCancel();
  }, { capture: true, signal });
}

function beginBoxDrag(state, index, handle, event) {
  const { width, height } = state.size;
  const startBox = { ...state.boxes[index] };
  const start = wholePixels(startBox, width, height);
  const origin = pointerPixels(state, event);
  let moved = false;
  const box = state.boxes[index];
  const apply = (moveEvent) => {
    // The list changed under the drag (an undo, a run): let go.
    if (state.boxes[index] !== box || !state.boxEls[index]) return;
    const point = pointerPixels(state, moveEvent);
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    if (!moved && Math.hypot(dx, dy) * origin.screen < MOVE_START) return;
    moved = true;
    const grid = snapping(width, height, gridOn(state) && !moveEvent.altKey && !moveEvent.ctrlKey && !moveEvent.metaKey, gridSize(state));
    const rect = handle
      ? resizedRect(start, handle, dx, dy, width, height, grid)
      : movedRect(start, dx, dy, width, height, grid);
    Object.assign(state.boxes[index], fromPixels(rect, width, height));
    placeBox(state.boxEls[index], state.boxes[index]);
    dressBox(state, state.boxEls[index], state.boxes[index], index);
    showReadout(state, readoutFor(state, index));
  };
  watchDrag(state, {
    onMove: apply,
    onEnd: () => {
      showReadout(state);
      if (moved && state.boxes[index] === box) commit(state);
    },
    onCancel: () => {
      if (state.boxes[index] === box) Object.assign(box, startBox);
      paintBoxes(state);
      showReadout(state);
    },
  });
}

function beginDraw(state, event) {
  const { width, height } = state.size;
  const origin = pointerPixels(state, event);
  const ghost = el("div", "ausboss-lb-ghost");
  let rect = null;
  const apply = (moveEvent) => {
    const point = pointerPixels(state, moveEvent);
    if (!rect && Math.hypot(point.x - origin.x, point.y - origin.y) * origin.screen < DRAW_START) return;
    if (!ghost.isConnected) state.frame.append(ghost);
    rect = drawnRect(origin.x, origin.y, point.x, point.y, width, height, snapping(width, height, gridOn(state) && !moveEvent.altKey && !moveEvent.ctrlKey && !moveEvent.metaKey, gridSize(state)));
    placeBox(ghost, fromPixels(rect, width, height));
    showReadout(state, `new box: ${rect.x1 - rect.x0} × ${rect.y1 - rect.y0} at ${rect.x0}, ${rect.y0}`);
  };
  const finish = (keep) => {
    ghost.remove();
    showReadout(state);
    if (!rect) {
      setSelected(state, -1);
      return;
    }
    if (keep && addBox(state, newBox(rect, width, height)) >= 0) focusWords(state);
  };
  watchDrag(state, { onMove: apply, onEnd: () => finish(true), onCancel: () => finish(false) });
}

function onStagePointerDown(state, event) {
  if (event.button !== 0 || state.disposed) return;
  closePop();
  // The canvas takes this press: no node drag, no graph pan.
  event.preventDefault();
  event.stopPropagation();
  state.stage.focus({ preventScroll: true });
  refreshSize(state);
  const target = event.target;
  const boxEl = target.closest?.(".ausboss-lb-box");
  const index = boxEl ? Number(boxEl.dataset.i) : -1;
  const handle = target.closest?.(".ausboss-lb-handle");
  if (handle && index >= 0) {
    setSelected(state, index);
    beginBoxDrag(state, index, handle.dataset.h, event);
  } else if (index >= 0 && !event.shiftKey) {
    setSelected(state, index);
    beginBoxDrag(state, index, null, event);
  } else if (pointerPixels(state, event).inside) {
    beginDraw(state, event);
  } else {
    setSelected(state, -1);
  }
}

function onStageKey(state, event) {
  if (event.target !== state.stage) return;
  const index = state.selected;
  const handled = () => {
    event.preventDefault();
    event.stopPropagation();
  };
  const key = event.key;
  // Delete and Backspace stay on the canvas while it has the focus, so the
  // node itself is never deleted by a key meant for a box.
  if (key === "Delete" || key === "Backspace") {
    handled();
    if (index >= 0) removeBox(state, index);
  } else if (key === "Escape") {
    if (index < 0) return;
    handled();
    setSelected(state, -1);
  } else if (key.startsWith("Arrow") && !event.ctrlKey && !event.metaKey) {
    handled();
    const step = nudgeStep(key, event);
    if (index < 0 || !step) return;
    const { width, height } = state.size;
    const rect = nudgedRect(wholePixels(state.boxes[index], width, height), step[0], step[1], width, height);
    Object.assign(state.boxes[index], fromPixels(rect, width, height));
    paintBoxes(state);
    flashReadout(state, readoutFor(state, index));
    commit(state);
  } else if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "d") {
    handled();
    if (index >= 0) copyBox(state, index);
  }
}

// ---------- the chosen box's editor ----------

function setBoxField(state, field, value, { settle = true } = {}) {
  const box = state.boxes[state.selected];
  if (!box || box[field] === value) return;
  box[field] = value;
  repaintBox(state, state.selected);
  commit(state, { settle });
}

function swatch(state, color, index) {
  const holder = el("label", "ausboss-lb-swatch");
  holder.style.background = color;
  holder.title = "Click to change this color. Right-click, or the cross, removes it.";
  const input = el("input");
  input.type = "color";
  input.value = color.slice(0, 7);
  input.addEventListener("input", () => {
    const box = state.boxes[state.selected];
    if (!box) return;
    box.palette[index] = normalizeHex(input.value) ?? box.palette[index];
    holder.style.background = box.palette[index];
    repaintBox(state, state.selected);
    commit(state, { settle: false });
  });
  input.addEventListener("change", () => notifyAusbossChange());
  const cross = el("i", "", "×");
  const remove = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const box = state.boxes[state.selected];
    if (!box) return;
    box.palette.splice(index, 1);
    repaintBox(state, state.selected);
    syncEditor(state);
    commit(state);
  };
  cross.addEventListener("click", remove);
  holder.addEventListener("contextmenu", remove);
  holder.append(input, cross);
  return holder;
}

function syncEditor(state) {
  if (!state.editor) return;
  const box = state.boxes[state.selected];
  const count = state.boxes.length;
  renderChips(state);
  // The chosen box's own row: its type and its tools.
  state.head.hidden = !box;
  if (box) {
    state.kindLabel.textContent = `Box ${state.selected + 1} is`;
    state.backBtn.disabled = state.selected === 0;
    state.frontBtn.disabled = state.selected === count - 1;
  }
  for (const [value, element] of state.typeButtons) element.classList.toggle("on", box?.type === value);
  state.hint.hidden = Boolean(box);
  state.hint.textContent = count
    ? "Click a box, or its chip above, to give it words. Drag on an empty spot to draw another."
    : "Each box you draw gets its words here: a thing to show, or text to write in the picture.";
  state.textField.hidden = !box || box.type !== "text";
  // Words typed while it was a text box stay with an object box, unsent.
  const kept = keptWordsNote(box);
  state.keptNote.hidden = !kept;
  state.keptNote.textContent = kept;
  state.descField.hidden = !box;
  state.colorsRow.style.display = box ? "flex" : "none";
  if (!box) return;
  if (document.activeElement !== state.textArea) state.textArea.value = box.text;
  if (document.activeElement !== state.descArea) state.descArea.value = box.desc;
  state.descArea.placeholder = box.type === "text"
    ? "How the words look, e.g. pink neon letters"
    : "What is in the box, e.g. a red bicycle";
  // Swatches are rebuilt unless a color is being picked right now.
  if (!state.colorsRow.contains(document.activeElement)) {
    state.swatches.textContent = "";
    box.palette.forEach((color, index) => state.swatches.append(swatch(state, color, index)));
    state.addColor.hidden = box.palette.length >= MAX_COLORS;
  }
}

function buildEditor(state) {
  const editor = el("div", "ausboss-lb-editor");
  const chipsRow = el("div", "ausboss-lb-chips");
  const step = (by) => {
    const count = state.boxes.length;
    if (!count) return;
    const from = state.selected < 0 ? (by > 0 ? -1 : 0) : state.selected;
    chooseBox(state, (from + by + count) % count);
  };
  state.prevBtn = button("ausboss-lb-tool", "‹", "The box before (further back)", () => step(-1));
  state.nextBtn = button("ausboss-lb-tool", "›", "The box after (further forward)", () => step(1));
  state.chipList = el("span");
  state.chipList.title = "Choose a box. Box 1 is the furthest back, the last one is in front.";
  chipsRow.append(state.prevBtn, state.chipList, state.nextBtn);
  state.chipsRow = chipsRow;

  const head = el("div", "ausboss-lb-head");
  state.kindLabel = el("b", "", "Box 1 is");
  state.head = head;

  const seg = el("div", "ausboss-lb-seg");
  state.typeButtons = new Map();
  for (const [value, label, title] of [
    ["obj", "object", "The box holds a thing: a person, an animal, an object, a place."],
    ["text", "text", "The box holds words written in the picture: a sign, a title, a label."],
  ]) {
    const option = button("", label, title, () => {
      setBoxField(state, "type", value);
      syncEditor(state);
    });
    seg.append(option);
    state.typeButtons.set(value, option);
  }

  const tool = (icon, title, onClick, extra = "") => {
    const node = button(`ausboss-lb-tool${extra}`, "", title, onClick);
    node.innerHTML = icon;
    return node;
  };
  state.backBtn = tool(ICONS.back, "Send back: earlier in the list", () => reorderBox(state, state.selected, -1));
  state.frontBtn = tool(ICONS.front, "Bring forward: later in the list", () => reorderBox(state, state.selected, 1));
  state.copyBtn = tool(ICONS.copy, "Copy this box (Ctrl + D)", () => copyBox(state, state.selected));
  state.deleteBtn = button("ausboss-lb-tool danger", "×", "Remove this box (Delete)", () => removeBox(state, state.selected));
  head.append(state.kindLabel, seg, el("span", "ausboss-lb-spacer"), state.backBtn, state.frontBtn, state.copyBtn, state.deleteBtn);

  const area = (label, className, field, placeholder) => {
    const holder = el("label", `ausboss-lb-field ${className}`);
    const text = el("textarea");
    text.placeholder = placeholder;
    text.spellcheck = false;
    text.addEventListener("input", () => setBoxField(state, field, text.value, { settle: false }));
    text.addEventListener("change", () => notifyAusbossChange());
    text.addEventListener("keydown", (event) => {
      keepKeyInField(event);
      if (event.key === "Escape") text.blur();
    });
    holder.append(el("span", "", label), text);
    return { holder, text };
  };
  const textField = area("Text", "text", "text", "Words to write, e.g. OPEN 24 HOURS");
  const descField = area("Description", "desc", "desc", "");
  state.textField = textField.holder;
  state.textArea = textField.text;
  state.descField = descField.holder;
  state.descArea = descField.text;

  const colors = el("div", "ausboss-lb-colors");
  const caption = el("b", "", "Colors");
  caption.title = "Up to five colors the model should use for this box. The first one also colors the box here.";
  state.swatches = el("span");
  state.swatches.style.cssText = "display:flex;align-items:center;gap:6px";
  const add = el("label", "ausboss-lb-add", "+");
  add.title = "Add a color";
  const picker = el("input");
  picker.type = "color";
  picker.value = "#ffffff";
  let adding = -1;
  picker.addEventListener("input", () => {
    const box = state.boxes[state.selected];
    if (!box) return;
    const color = normalizeHex(picker.value);
    if (!color) return;
    if (adding < 0 || adding >= box.palette.length) {
      if (box.palette.length >= MAX_COLORS) return;
      box.palette.push(color);
      adding = box.palette.length - 1;
    } else {
      box.palette[adding] = color;
    }
    repaintBox(state, state.selected);
    commit(state, { settle: false });
  });
  picker.addEventListener("change", () => {
    adding = -1;
    picker.value = "#ffffff";
    picker.blur();
    syncEditor(state);
    notifyAusbossChange();
  });
  add.append(picker);
  state.addColor = add;
  colors.append(caption, state.swatches, add);
  state.colorsRow = colors;

  state.keptNote = el("div", "ausboss-lb-kept");
  state.keptNote.hidden = true;
  state.hint = el("div", "ausboss-lb-hint");
  editor.append(chipsRow, head, state.textField, state.keptNote, state.descField, state.hint, colors);
  // Clicks on the editor's controls stay out of the node drag.
  editor.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button,textarea,input,label")) event.stopPropagation();
  });
  state.editor = editor;
  return editor;
}

// ---------- ready-made layouts ----------

let popEl = null;
let popAbort = null;

function closePop() {
  popAbort?.abort();
  popEl?.remove();
  popEl = null;
  popAbort = null;
}

function openLayouts(state, anchor) {
  closePop();
  const pop = el("div", "ausboss-lb-pop");
  pop.append(el("div", "head", "Start from a layout"));
  for (const layout of LAYOUTS) {
    const item = el("div", "item");
    const mini = el("span", "mini");
    for (const slot of layout.boxes) {
      const block = el("i", slot.type === "text" ? "text" : "");
      const [x, y, w, h] = slot.at;
      Object.assign(block.style, { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` });
      mini.append(block);
    }
    item.append(mini, el("span", "", layout.label));
    item.title = "Places the boxes; boxes you have keep their words, in order.";
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      closePop();
      const { width, height } = state.size;
      state.boxes = applyLayout(layout, state.boxes, width, height, snapping(width, height, gridOn(state), gridSize(state)));
      renderBoxes(state);
      setSelected(state, state.boxes.length ? 0 : -1);
      commit(state);
    });
    pop.append(item);
  }
  document.body.append(pop);
  const rect = anchor.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom;
  pop.style.left = `${clamp(rect.left, 6, Math.max(6, window.innerWidth - 236))}px`;
  if (below < 240 && rect.top > below) pop.style.bottom = `${window.innerHeight - rect.top + 4}px`;
  else pop.style.top = `${rect.bottom + 4}px`;
  popAbort = new AbortController();
  const { signal } = popAbort;
  document.addEventListener("pointerdown", (event) => {
    if (!pop.contains(event.target) && !anchor.contains(event.target)) closePop();
  }, { capture: true, signal });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closePop();
    }
  }, { capture: true, signal });
  pop.addEventListener("pointerdown", (event) => event.stopPropagation());
  popEl = pop;
}

// ---------- the picture under the boxes ----------

// The node feeding `background`, through Reroutes.
const backgroundSource = (node) => wiredSource(node, "background")?.node ?? null;

const viewUrl = (file) => api.apiURL(`/view?${new URLSearchParams({
  filename: file.filename, subfolder: file.subfolder ?? "", type: file.type ?? "temp",
})}`);

// Best first: the picture the feeding node shows (a Load Image), then the
// one this node's last run saved, when the same node still feeds it.
function backgroundWanted(state) {
  const source = backgroundSource(state.node);
  if (!source) return null;
  const shown = describeSourcePreview(source);
  if (shown?.kind === "url") return { url: shown.url, size: null };
  if (shown?.kind === "view" && !shown.isVideo) return { url: api.apiURL(`/view?${shown.query}`), size: null };
  const run = state.lastRun;
  if (run?.background && run.sourceId === source.id) return { url: viewUrl(run.background), size: run.picture ?? null };
  return null;
}

function refreshBackground(state) {
  if (state.disposed) return;
  syncGrid(state);
  const wanted = backgroundWanted(state);
  const url = wanted?.url ?? "";
  if (url === state.backgroundUrl) return;
  state.backgroundUrl = url;
  if (!url) {
    showPicture(state, false);
    state.bg.removeAttribute("src");
    return;
  }
  const picture = new Image();
  picture.onload = () => {
    if (state.disposed || state.backgroundUrl !== url) return;
    state.bg.src = url;
    const size = wanted.size ?? [picture.naturalWidth, picture.naturalHeight];
    showPicture(state, true, size);
    pictureSetsSize(state, size);
  };
  picture.onerror = () => {
    if (state.backgroundUrl === url) showPicture(state, false);
  };
  picture.src = url;
}

// Over a picture the boxes are lighter and show no words, so what is under
// them stays readable; the chosen box's words are in the editor.
function showPicture(state, on, size = null) {
  state.bg.hidden = !on;
  state.frame.classList.toggle("pic", on);
  state.pictureSize = on ? size : null;
  refreshSize(state);
}

// A picture on `background` makes the canvas its size, as on Create Bounding
// Boxes, unless width and height are wired to something else.
function pictureSetsSize(state, [width, height]) {
  if (sizeWired(state, "width") || sizeWired(state, "height")) return;
  const w = sideForPicture(width);
  const h = sideForPicture(height);
  if (!w || !h) return;
  let changed = false;
  for (const [name, value] of [["width", w], ["height", h]]) {
    const widget = findWidget(state.node, name);
    if (widget && widget.value !== value) {
      commitWidgetValue(state.node, widget, value, app.canvas);
      changed = true;
    }
  }
  if (changed) {
    state.node.__ausbossCard?.refresh?.();
    refreshSize(state);
  }
}

// ---------- what a run sent back ----------

function takeNote(state, note, { restored = false } = {}) {
  if (!note || state.disposed) return;
  const source = backgroundSource(state.node);
  state.lastRun = {
    background: note.background ?? null,
    picture: Array.isArray(note.picture) ? note.picture : null,
    size: Array.isArray(note.size) ? note.size : null,
    sourceId: source?.id ?? null,
  };
  refreshSize(state);
  refreshBackground(state);
  // New boxes on the wire fill the canvas, once; the run already used them.
  const incoming = note.incoming;
  if (!restored && incoming?.fingerprint && incoming.fingerprint !== state.fromInput) {
    const { width, height } = ownSize(state);
    state.boxes = parseLayout({ v: 1, boxes: incoming.boxes ?? [] }, width, height).boxes;
    state.fromInput = incoming.fingerprint;
    renderBoxes(state);
    setSelected(state, state.boxes.length ? 0 : -1);
    commit(state);
  }
}

function restoreNote(state) {
  const note = app.nodeOutputs?.[outputLocatorId(state.node)]?.[UI_KEY]?.[0];
  if (note) takeNote(state, note, { restored: true });
}

// ---------- watching what feeds the node ----------

// A change on the node a size or a picture comes from (Latent Size's width,
// the file picked in a Load Image) reaches this canvas through that widget's
// own callback.
function watchUpstream(state) {
  const hook = (source, names) => {
    for (const widget of source?.widgets ?? []) {
      if (!names(widget) || state.watched.has(widget)) continue;
      state.watched.add(widget);
      chainCallback(widget, "callback", () => {
        if (state.disposed) return;
        queueMicrotask(() => {
          refreshSize(state);
          refreshBackground(state);
        });
      });
    }
  };
  for (const name of ["width", "height"]) hook(wiredSource(state.node, name)?.node, (widget) => typeof widget.value === "number");
  hook(backgroundSource(state.node), (widget) => widget.name === "image");
}

// ---------- building the panel ----------

function buildPanel(state) {
  const root = state.root;
  const bar = el("div", "ausboss-lb-bar");
  const gridBtn = button("ausboss-lb-btn", "", "Boxes snap to the grid while you drag them; it starts off over a picture. Hold Ctrl (or Alt) while dragging to place a box freely.", () => {
    state.node.properties ??= {};
    state.node.properties[GRID_PROPERTY] = !gridOn(state);
    syncGrid(state);
    notifyAusbossChange();
  });
  gridBtn.innerHTML = `${ICONS.grid}<span>Grid</span>`;
  state.gridBtn = gridBtn;
  const layoutsBtn = button("ausboss-lb-btn", "Layouts ▾", "Start from a ready-made arrangement of boxes", () => {
    if (popEl) closePop();
    else openLayouts(state, layoutsBtn);
  });
  state.sizeEl = el("span", "ausboss-lb-size", "");
  const clear = button("ausboss-lb-btn", "Clear", "Remove every box. Boxes on the bboxes wire fill the canvas again on the next run.", () => clearAll(state));
  const gear = button("ausboss-lb-btn icon", "", "Layout Boxes settings: the grid size", () => openGear(state, gear));
  gear.innerHTML = gearIconSvg(12);
  bar.append(gridBtn, layoutsBtn, state.sizeEl, clear, gear);

  const stage = el("div", "ausboss-lb-stage");
  stage.tabIndex = 0;
  const frame = el("div", "ausboss-lb-frame");
  const bg = el("img", "ausboss-lb-bg");
  bg.alt = "";
  bg.hidden = true;
  bg.draggable = false;
  const grid = el("div", "ausboss-lb-grid");
  frame.append(bg, grid);
  const empty = el("div", "ausboss-lb-empty", "Drag on the canvas to draw a box");
  const readout = el("div", "ausboss-lb-readout");
  readout.hidden = true;
  stage.append(frame, empty, readout);
  stage.addEventListener("pointerdown", (event) => onStagePointerDown(state, event));
  stage.addEventListener("dblclick", (event) => {
    if (!event.target.closest?.(".ausboss-lb-box")) return;
    event.preventDefault();
    event.stopPropagation();
    focusWords(state);
  });
  stage.addEventListener("keydown", (event) => onStageKey(state, event));
  Object.assign(state, { stage, frame, bg, grid, empty, readout });
  syncGrid(state);

  root.append(bar, stage, buildEditor(state));

  // While the canvas has the focus its keys are its own; a press anywhere
  // else takes the focus away, so Delete goes back to the graph.
  stage.addEventListener("focus", () => {
    state.focusAbort?.abort();
    const abort = new AbortController();
    state.focusAbort = abort;
    window.addEventListener("pointerdown", (event) => {
      if (!root.contains(event.target)) stage.blur();
    }, { capture: true, signal: abort.signal });
  });
  stage.addEventListener("blur", () => state.focusAbort?.abort());

  state.resizeObserver = new ResizeObserver(() => {
    fitFrame(state);
    syncZoom(state);
    paintBoxes(state);
    renderChips(state);
  });
  state.resizeObserver.observe(stage);
  root.addEventListener("pointerenter", () => {
    refreshSize(state);
    refreshBackground(state);
    if (syncZoom(state)) paintBoxes(state);
  });
}

function openGear(state, anchor) {
  closePop();
  openSettingsMenu({
    scope: SETTINGS_SCOPE,
    schema: SETTINGS_SCHEMA,
    anchor: anchor.getBoundingClientRect(),
    title: "Layout Boxes settings",
    initial: { grid_size: gridSize(state) },
    onChange: (values) => {
      if (state.disposed || values.grid_size === gridSize(state)) return;
      state.node.properties ??= {};
      state.node.properties[GRID_SIZE_PROPERTY] = values.grid_size;
      fitFrame(state);
      notifyAusbossChange();
    },
  });
}

function install(node) {
  if (node.__ausbossLayoutBoxes) return node.__ausbossLayoutBoxes;
  ensureCss();
  const layout = findWidget(node, "layout");
  if (layout) hideWidget(layout);
  const root = el("div", "ausboss-lb");
  const state = {
    node, root,
    boxes: [], selected: -1, fromInput: "", boxEls: [],
    layoutValue: null, size: { width: 1024, height: 1024 }, sizeKey: "", zoom: 1,
    watched: new WeakSet(), backgroundUrl: "", lastRun: null, disposed: false,
  };
  node.__ausbossLayoutBoxes = state;
  live.add(state);

  const widget = node.addDOMWidget(WIDGET_NAME, WIDGET_NAME, root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => PANEL_MIN + WIDGET_FRAME,
  });
  widget.serialize = false;
  keepDomWidgetWidthAuto(widget);
  fillNodeHeight(widget, {
    minWidth: MIN_WIDTH,
    minHeight: PANEL_MIN + WIDGET_FRAME,
    minNodeSize: [MIN_WIDTH, PANEL_MIN + WIDGET_FRAME],
    exactMinWidth: true,
  });
  state.widget = widget;

  buildPanel(state);
  syncFromWidget(state, true);
  refreshSize(state);
  watchZoom();

  for (const name of ["width", "height"]) {
    const target = findWidget(node, name);
    if (target) chainCallback(target, "callback", () => queueMicrotask(() => refreshSize(state)));
  }
  if (layout) chainCallback(layout, "callback", () => syncFromWidget(state));

  // A new node opens with room for the canvas. It takes that size as it
  // joins the graph, when the card above is in place too; a size put on the
  // node afterwards (a workflow, an undo) wins, and a copy arrives with its
  // size already (onConfigure below).
  chainCallback(node, "onAdded", () => {
    if (state.sized) return;
    state.sized = true;
    const floor = Number(node.computeSize?.()?.[1]);
    if (Number.isFinite(floor) && node.size?.[1] <= floor + 1) {
      node.setSize?.([Math.max(node.size[0], OPENING_WIDTH), floor + OPENING_ROOM]);
    }
  });
  return state;
}

// The hidden `layout` widget is the canvas's own: a wire into it would hide
// the boxes from the canvas, and boxes come in on `bboxes`. So it is the
// stock text widget made socketless, with no input slot in either look.
const STATE_WIDGET = "AUSBOSS_LAYOUT_BOXES_STATE";

app.registerExtension({
  name: "ausboss.layout_boxes",
  getCustomWidgets() {
    return {
      [STATE_WIDGET](node, inputName, inputData) {
        const spec = inputData?.[1] ?? {};
        const widget = node.addWidget("text", inputName, spec.default ?? "", () => {}, {});
        widget.options.socketless = true;
        return { widget };
      },
    };
  },
  // Reopening a workflow tab hands every node its stored output at once.
  onNodeOutputsUpdated() {
    for (const state of live) if (!state.disposed) restoreNote(state);
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    hideInputsInDef(nodeData, ["layout"]);
    for (const spec of [nodeData?.input?.optional?.layout?.[1], nodeData?.inputs?.layout]) {
      if (spec && typeof spec === "object") Object.assign(spec, { widgetType: STATE_WIDGET, socketless: true });
    }
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      install(this);
    });
    chainCallback(nodeType.prototype, "onConfigure", function (info) {
      const state = install(this);
      if (info?.size) state.sized = true;
      // The saved values and links are on the node once configure is done.
      queueMicrotask(() => {
        if (state.disposed) return;
        hideWidget(findWidget(this, "layout"));
        syncGrid(state);
        syncFromWidget(state, true);
        state.sizeKey = "";
        refreshSize(state);
        restoreNote(state);
        refreshBackground(state);
      });
    });
    chainCallback(nodeType.prototype, "onConnectionsChange", function (side) {
      if (side !== undefined && side !== INPUT_SIDE) return;
      const state = this.__ausbossLayoutBoxes;
      if (!state) return;
      queueMicrotask(() => {
        refreshSize(state);
        refreshBackground(state);
      });
    });
    chainCallback(nodeType.prototype, "onExecuted", function (output) {
      if (isForeignRun()) return;
      const state = install(this);
      takeNote(state, output?.[UI_KEY]?.[0]);
    });
    // The classic look draws the node every frame it changes: a cheap look
    // at the size catches a change made upstream by any means.
    chainCallback(nodeType.prototype, "onDrawForeground", function () {
      const state = this.__ausbossLayoutBoxes;
      if (!state) return;
      refreshSize(state);
      syncFromWidget(state);
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      const state = this.__ausbossLayoutBoxes;
      if (!state) return;
      state.disposed = true;
      clearTimeout(state.readoutTimer);
      state.dragAbort?.abort();
      state.focusAbort?.abort();
      state.resizeObserver?.disconnect();
      closePop();
      live.delete(state);
    });
  },
});
