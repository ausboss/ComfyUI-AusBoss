// The face of Mask by Touch: the picture, what is picked on it, and the
// pointer that picks. js/mask_by_touch/index.js mounts one per node and
// hands it what a run sent back; the math is js/shared/touch_math.mjs.
//
// The picture and what SAM 3 found reach the face as the node's own result
// (a "note"), so the face has to run the node: a click on a thing or a
// stroke queues this node alone. Three things keep that from feeling slow.
// A note can carry the pieces of the picture (ask "scope"), and a piece the
// pointer lights up is picked without a run, because the face already holds
// its outline. Every picked area the face has shown is kept for a while, so
// Undo is instant. And the edge settings are worked out here on a small copy
// of the picture, so Grow and Soften answer while they are dragged.

import { api } from "/scripts/api.js";
import {
  brushAdjusts,
  brushCore,
  brushFlips,
  brushKey,
  brushProfile,
  brushReach,
  brushWords,
  clampSoft,
  moveAdjust,
  startAdjust,
  steppedBrushSize,
  steppedSoft,
  toolKey,
} from "./brush.mjs";
import { BRAND, chainCallback, keepDomWidgetWidthAuto, notifyAusbossChange, showToast } from "./index.mjs";
import { linkById, placeholderText, sourceFileWidget, upstreamNode, viewQueryForFile } from "./input_preview.mjs";
import { WIDGET_FRAME, fillNodeHeight } from "./panel_layout.mjs";
import { makeScrubInput } from "./scrub_input.mjs";
import { makeSlideSwitch } from "./slide_switch.mjs";
import {
  BACKDROP,
  BRUSH_RADIUS,
  LIT,
  LIT_AWAY,
  LIT_STRENGTH,
  OWN_LOADERS,
  SURE,
  TINT,
  areaKey,
  brushStroke,
  candidatesAt,
  chipGroups,
  chipLabel,
  cleanWord,
  composeEdge,
  decodeTouches,
  dropIdleAways,
  encodeTouches,
  extendStroke,
  fineChoice,
  fineMade,
  fineMask,
  goesBehind,
  growMask,
  hardMask,
  joinMasks,
  loaderSignature,
  maskOn,
  maskShare,
  nameShown,
  nextGroup,
  numberChip,
  packPlanes,
  paintCover,
  paintStroke,
  paintTint,
  pieceAt,
  pieceMask,
  pieceOverlaps,
  pieceRanks,
  pieceWholes,
  pieceSizes,
  piecesInside,
  prefixStamps,
  previewPixels,
  readoutText,
  sameTouches,
  sharedPixels,
  shrinkMask,
  stampOf,
  strokePieces,
  thinStroke,
  touchFits,
} from "./touch_math.mjs";

const CSS_ID = "ausboss-touch-css";
export const WIDGET_NAME = "ausboss_touch_stage";
export const NOTE_KEY = "ausboss_mask_by_touch";
const TOOLS_HEIGHT = 24;
const BAR_HEIGHT = 20;
const STAGE_MIN = 150;
// Wide enough for the bar under the picture: the arrows, a pick's name, Subject and Background.
export const PANEL_MIN_WIDTH = 400;
// What the panel's element needs at its smallest: tools, stage and bar, two
// gaps and the padding under them.
const CHIPS_HEIGHT = 22;
// The chips wrap onto this many rows; more are scrolled to.
const CHIP_ROWS = 3;
// A node this wide has room for the names in front of the brush's two
// numbers. A narrower one shows the numbers alone.
const LABELS_FROM = 440;
// The width a new node opens with: the names fit.
export const OPENING_WIDTH = 460;
const PANEL_NEEDS = TOOLS_HEIGHT + STAGE_MIN + BAR_HEIGHT + CHIPS_HEIGHT + 12 + 6;
// Saved with the workflow: the brush size once it was set by hand, the snap
// switch, and how the picked area is shown.
const BRUSH_PROPERTY = "ausboss_touch_brush";
const SOFT_PROPERTY = "ausboss_touch_soft";
// The tool: Pick takes whole things, Paint and Erase are the brush.
// SNAP_PROPERTY is how the pack kept "Pick or Draw" before there were three;
// it is still written, so an older version of the pack opens the workflow
// with the right one.
const TOOL_PROPERTY = "ausboss_touch_tool";
const TOOLS = ["pick", "paint", "erase"];
const SNAP_PROPERTY = "ausboss_touch_snap";
const VIEW_PROPERTY = "ausboss_touch_view";
// The loader's file the picks were made on, so a reopened workflow can tell
// "the same picture, not confirmed yet" from "another picture".
const FILE_PROPERTY = "ausboss_touch_file";
// What the picture shows: your picks tinted on the whole picture ("tint"),
// or the result with everything else hidden, as the cut-out or as the mask.
const VIEWS = ["tint", "cut", "mask"];
const EYE_TITLES = {
  tint: "Show the result: only what you picked, the rest hidden. Shift-click for the black and white mask.",
  cut: "Showing the result, cut out. Click to go back to your picks on the whole picture. Shift-click for the black and white mask.",
  mask: "Showing the result as the black and white mask. Click to go back to your picks on the whole picture. Shift-click for the cut-out.",
};
// The eye beside Undo and Clear, drawn here: an almond and its pupil.
const EYE_ICON = '<svg width="16" height="16" viewBox="-8 -8 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M-6.6 0Q0 -6 6.6 0Q0 6 -6.6 0Z"/><circle r="2" fill="currentColor" stroke="none"/></svg>';
// The brush size, across the picture, in picture pixels.
const BRUSH_SIZE = [4, 1000];
// A brush mark counts as touching an area within this many pixels of the
// small copy.
const TOUCH_REACH = 2;
// The areas of picked things a picture keeps, as the node sent them.
const AREAS_KEPT = 96;
// Pictures the faces of a page have shown, newest last. A picture keeps its
// pieces and the picked areas it has shown, so a tab switch, an undo or a
// second node on the same picture costs nothing.
const PICTURES_KEPT = 3;
const STATES_KEPT = 14;
const pictures = new Map();
// A face asks for a run again on its own at most this often in a row.
const RETRIES = 2;
// The long side of the small copy the masks are worked on, when the face
// has to choose it itself (the server chooses for its own pictures).
const PREVIEW_SIDE = 1024;

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  // The picture and its layers sit out of flow in the stage, so they can
  // never set the panel's height: Nodes 2.0 sizes a node by its content.
  // That leaves the stage with no height of its own, so inside a Nodes 2.0
  // node ([data-node-id]) it carries its floor itself.
  style.textContent = `
.ausboss-touch{box-sizing:border-box;display:flex;flex-direction:column;gap:4px;width:100%;height:100%;padding:0 6px 6px;pointer-events:none;overflow:hidden;color:#c8dddd;font:11px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
.ausboss-touch-tools,.ausboss-touch-bar{box-sizing:border-box;flex:none;display:flex;align-items:center;gap:4px;padding:0 1px;}
.ausboss-touch-tools{height:${TOOLS_HEIGHT}px;}
.ausboss-touch-bar{height:${BAR_HEIGHT}px;gap:6px;overflow:visible;}
.ausboss-touch-bar.choosing .ausboss-touch-readout{flex:1 1 auto;text-align:center;}
.ausboss-touch-bar.choosing .ausboss-touch-gap{display:none;}
.ausboss-touch-chips{box-sizing:border-box;flex:none;display:flex;flex-wrap:wrap;align-items:center;align-content:flex-start;gap:4px 5px;min-height:${CHIPS_HEIGHT}px;max-height:${CHIP_ROWS * 24 - 2}px;padding:1px;overflow-x:hidden;overflow-y:auto;scrollbar-width:thin;pointer-events:auto;}
.ausboss-touch-chiplist{display:contents;}
.ausboss-touch:not(.live) .ausboss-touch-chips,.ausboss-touch.locked .ausboss-touch-chips{visibility:hidden;}
.ausboss-touch-chip{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;gap:3px;max-width:100%;height:20px;padding:0 3px 0 9px;border:1px solid rgba(0,180,170,.5);border-radius:10px;background:rgba(0,180,170,.14);color:${BRAND};font:600 10px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;cursor:pointer;}
.ausboss-touch-chip:hover{background:rgba(0,180,170,.26);}
.ausboss-touch-chip.open,.ausboss-touch-chip.open:hover{border-color:#dffcf9;background:${BRAND};color:#04201f;}
.ausboss-touch-chip.fresh{border-style:dashed;}
.ausboss-touch-chip.away{border-color:rgba(255,150,120,.6);background:rgba(255,150,120,.1);color:#ffb49c;}
.ausboss-touch-chip.away:hover{background:rgba(255,150,120,.2);}
.ausboss-touch-chip.away.open,.ausboss-touch-chip.away.open:hover{border-color:#ffe3d9;background:rgba(255,150,120,.3);color:#ffe3d9;}
.ausboss-touch-chip>span{overflow:hidden;text-overflow:ellipsis;}
.ausboss-touch-new{box-sizing:border-box;flex:none;height:20px;padding:0 8px;border:1px dashed rgba(0,180,170,.5);border-radius:10px;background:transparent;color:#78908e;font:600 10px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;cursor:pointer;}
.ausboss-touch-new:hover{border-color:${BRAND};color:#dffcf9;}
.ausboss-touch-new:disabled{opacity:.4;cursor:default;}
.ausboss-touch-chip>button{box-sizing:border-box;height:16px;min-width:16px;padding:0 4px;border:none;border-radius:8px;background:transparent;color:inherit;font:700 9.5px/16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;opacity:.7;}
.ausboss-touch-chip>button:hover{opacity:1;background:rgba(255,255,255,.14);}
.ausboss-touch-chip>button.more{padding:0 6px;background:rgba(0,0,0,.35);opacity:.95;}
.ausboss-touch-chip.open>button.more{background:rgba(0,0,0,.2);}
.ausboss-touch-name{box-sizing:border-box;flex:none;width:104px;height:20px;padding:0 9px;border:1px dashed rgba(0,180,170,.5);border-radius:10px;background:transparent;color:#dffcf9;font:600 10px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;outline:none;}
.ausboss-touch-name::placeholder{color:#78908e;font-weight:500;}
.ausboss-touch-name:focus{border-style:solid;border-color:${BRAND};background:rgba(0,0,0,.4);}
.ausboss-touch-gap{flex:1 1 auto;min-width:0;}
.ausboss-touch-stage{position:relative;flex:1 1 auto;min-height:0;width:100%;overflow:hidden;border:1px solid rgba(0,180,170,.27);border-radius:6px;background:rgba(0,0,0,.28);}
[data-node-id] .ausboss-touch-stage{box-sizing:border-box;min-height:${STAGE_MIN}px;}
.ausboss-touch-frame{position:absolute;display:none;overflow:hidden;border-radius:3px;pointer-events:auto;touch-action:none;cursor:crosshair;}
.ausboss-touch.live .ausboss-touch-frame{display:block;}
.ausboss-touch-frame>img,.ausboss-touch-frame>canvas,.ausboss-touch-frame>svg{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;user-select:none;-webkit-user-drag:none;}
.ausboss-touch-frame>canvas{image-rendering:auto;}
.ausboss-touch.view-mask .ausboss-touch-lit{mix-blend-mode:normal;}
.ausboss-touch.locked .ausboss-touch-frame{pointer-events:none;opacity:.55;}
.ausboss-touch-wake{position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:10px;text-align:center;pointer-events:none;}
.ausboss-touch:not(.live) .ausboss-touch-wake,.ausboss-touch.locked .ausboss-touch-wake{display:flex;}
.ausboss-touch-hint{max-width:86%;color:#78908e;}
.ausboss-touch-start{box-sizing:border-box;height:28px;padding:0 14px;border:1px solid ${BRAND};border-radius:14px;background:rgba(0,79,75,.86);color:#eafffd;font:600 11.5px/26px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;pointer-events:auto;white-space:nowrap;}
.ausboss-touch-start:hover{background:rgba(0,110,104,.95);}
.ausboss-touch.busy .ausboss-touch-start{opacity:.55;cursor:progress;}
.ausboss-touch-busy{position:absolute;left:0;right:0;top:0;height:2px;overflow:hidden;display:none;pointer-events:none;}
.ausboss-touch.busy .ausboss-touch-busy{display:block;}
.ausboss-touch-busy::after{content:"";position:absolute;top:0;bottom:0;left:-40%;width:40%;background:linear-gradient(90deg,transparent,${BRAND},transparent);animation:ausboss-touch-run 1.1s linear infinite;}
@keyframes ausboss-touch-run{to{left:100%;}}
.ausboss-touch-note{position:absolute;left:6px;right:6px;bottom:6px;display:none;padding:4px 7px;border-radius:4px;background:rgba(0,0,0,.78);color:#e7c98c;font-size:10.5px;pointer-events:none;}
.ausboss-touch-note.on{display:block;}
.ausboss-touch-tag{position:absolute;display:none;box-sizing:border-box;max-width:70%;padding:1px 7px;border:1px solid rgba(0,180,170,.6);border-radius:9px;background:rgba(4,14,15,.84);color:#dffcf9;font:600 10px/15px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;transform:translate(12px,14px);}
.ausboss-touch-tag.on{display:block;}
.ausboss-touch-tag.left{transform:translate(calc(-100% - 12px),14px);}
.ausboss-touch-tag.up{transform:translate(12px,calc(-100% - 12px));}
.ausboss-touch-tag.left.up{transform:translate(calc(-100% - 12px),calc(-100% - 12px));}
.ausboss-touch-tag.away{border-color:rgba(255,150,120,.7);color:#ffd9cc;}
.ausboss-touch-fining{position:absolute;top:6px;left:6px;display:none;align-items:center;gap:6px;box-sizing:border-box;height:22px;max-width:calc(100% - 12px);padding:0 10px 0 8px;border:1px solid rgba(0,180,170,.6);border-radius:11px;background:rgba(4,14,15,.84);color:#dffcf9;font:600 10.5px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;}
.ausboss-touch.fining .ausboss-touch-fining{display:flex;}
.ausboss-touch-fining::before{content:"";flex:none;width:7px;height:7px;border-radius:50%;background:${BRAND};animation:ausboss-touch-pulse 1s ease-in-out infinite;}
@keyframes ausboss-touch-pulse{0%,100%{opacity:.25;}50%{opacity:1;}}
.ausboss-touch-btn.lookpill{display:inline-flex;align-items:center;gap:5px;height:${BAR_HEIGHT}px;padding:0 9px 0 8px;border:1px solid rgba(0,180,170,.6);border-radius:10px;letter-spacing:0;text-transform:none;font:600 10px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#dffcf9;background:linear-gradient(90deg,rgba(0,180,170,.38) var(--done,0%),rgba(0,180,170,.08) var(--done,0%));}
.ausboss-touch-btn.lookpill:hover{border-color:${BRAND};color:#fff;background:linear-gradient(90deg,rgba(0,180,170,.5) var(--done,0%),rgba(0,180,170,.16) var(--done,0%));}
.ausboss-touch-btn.lookpill .icon{flex:none;font-size:8px;letter-spacing:-1px;opacity:.9;}
.ausboss-touch-btn.lookpill.paused{border-color:rgba(120,144,142,.6);color:#c8dddd;background:linear-gradient(90deg,rgba(120,144,142,.3) var(--done,0%),rgba(120,144,142,.06) var(--done,0%));}
.ausboss-touch-btn.lookpill.paused .icon{letter-spacing:0;}
.ausboss-touch-btn.lookpill .count{opacity:.8;}
.ausboss-touch.narrow .ausboss-touch-btn.lookpill .word{display:none;}
.ausboss-touch-btn.lookpill.nudge{animation:ausboss-touch-nudge .45s ease-out;}
@keyframes ausboss-touch-nudge{0%{border-color:#fff;background:rgba(0,79,75,.96);transform:scale(1.06);}100%{transform:scale(1);}}
.ausboss-touch-btn{box-sizing:border-box;flex:none;height:20px;min-width:22px;padding:0 6px;border:1px solid rgba(0,180,170,.52);border-radius:4px;background:rgba(0,0,0,.7);color:#c8dddd;font:700 9px/18px "Segoe UI",sans-serif;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;pointer-events:auto;white-space:nowrap;}
.ausboss-touch-btn:hover{border-color:${BRAND};color:#fff;background:rgba(0,79,75,.78);}
.ausboss-touch-btn:disabled{opacity:.38;cursor:default;border-color:rgba(0,180,170,.3);color:#8fa3a2;background:rgba(0,0,0,.5);}
.ausboss-touch .ausboss-slide{pointer-events:auto;}
.ausboss-touch .ausboss-slide.away .ausboss-slide-mark{background:#ff9678;box-shadow:0 0 7px rgba(255,150,120,.3);}
.ausboss-touch-field{flex:none;display:flex;align-items:center;gap:4px;pointer-events:auto;}
.ausboss-touch-field.idle{opacity:.45;}
.ausboss-touch-label{flex:none;color:#9fb6b4;font-size:10px;line-height:22px;white-space:nowrap;user-select:none;}
.ausboss-touch.narrow .ausboss-touch-label{display:none;}
.ausboss-touch.narrow .ausboss-touch-tools{gap:3px;}
.ausboss-touch.narrow .ausboss-touch-field.size .ausboss-scrub{width:56px !important;}
.ausboss-touch.narrow .ausboss-touch-field.soft .ausboss-scrub{width:48px !important;}
.ausboss-touch-btn.eye{display:inline-flex;align-items:center;justify-content:center;width:26px;min-width:26px;padding:0;}
.ausboss-touch-btn.eye.on{border-color:${BRAND};background:${BRAND};color:#04201f;}
.ausboss-touch-btn.arrow{min-width:20px;width:20px;padding:0;font-size:14px;line-height:16px;}
.ausboss-touch-swatch{box-sizing:border-box;flex:none;width:${BAR_HEIGHT}px;height:${BAR_HEIGHT}px;border-radius:4px;background:#0b1113;border:1px solid rgba(0,180,170,.3);pointer-events:auto;}
.ausboss-touch-readout.warn{border-color:rgba(231,185,140,.6);background:rgba(231,185,140,.12);color:#e7c98c;}
.ausboss-touch-readout{box-sizing:border-box;flex:0 1 auto;min-width:0;height:${BAR_HEIGHT}px;padding:0 8px;border:1px solid rgba(0,180,170,.5);border-radius:10px;background:rgba(0,180,170,.14);color:${BRAND};font:600 10px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ausboss-touch-readout:empty{display:none;}
.ausboss-touch-readout.quiet{border-color:rgba(120,144,142,.4);background:transparent;color:#78908e;}
.ausboss-touch-ink path{fill:none;stroke-linecap:round;stroke-linejoin:round;stroke:rgba(0,214,203,.42);}
.ausboss-touch-ink path.away{stroke:rgba(255,150,120,.42);}
.ausboss-touch-ink circle{fill:none;vector-effect:non-scaling-stroke;}
.ausboss-touch-ink .ring-back{stroke:rgba(0,0,0,.55);stroke-width:3px;}
.ausboss-touch-ink .ring{stroke:#fff;stroke-width:1.2px;}
.ausboss-touch-ink .ring.away{stroke:#ffb49c;}
.ausboss-touch-ink .core{stroke:rgba(255,255,255,.8);stroke-width:1.1px;stroke-dasharray:4 4;}
.ausboss-touch-brush{position:absolute;display:none;gap:10px;box-sizing:border-box;height:18px;padding:0 7px;border-radius:4px;background:rgba(0,0,0,.74);color:#7f9896;font:600 11px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;pointer-events:none;transform:translate(-50%,8px);}
.ausboss-touch-brush.on{display:flex;}
.ausboss-touch-brush.up{transform:translate(-50%,calc(-100% - 8px));}
.ausboss-touch-brush>span.lit{color:#eafffd;}
.ausboss-touch-ink .dot{fill:#fff;stroke:rgba(0,0,0,.6);stroke-width:1px;animation:ausboss-touch-dot .7s ease-in-out infinite alternate;}
@keyframes ausboss-touch-dot{from{opacity:.35;}to{opacity:1;}}
`;
  document.head.append(style);
}

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svg(tag, className) {
  const element = document.createElementNS(SVG_NS, tag);
  if (className) element.setAttribute("class", className);
  return element;
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const widgetByName = (node, name) => node.widgets?.find((widget) => widget?.name === name) ?? null;

// ---- the pictures a page has shown ---------------------------------------

function pictureFor(note) {
  const width = Math.round(Number(note.width));
  const height = Math.round(Number(note.height));
  const scale = Number(note.scale) > 0 ? Number(note.scale) : 1;
  let entry = pictures.get(note.key);
  if (entry && (entry.width !== width || entry.height !== height)) entry = null;
  pictures.delete(note.key);
  entry ??= {
    key: note.key,
    width,
    height,
    scale,
    pw: Math.max(1, Math.round(width * scale)),
    ph: Math.max(1, Math.round(height * scale)),
    image: null,
    file: "",
    pieces: null,
    scoped: false,
    scopeAsks: 0,
    piecesTag: "",
    seeds: new Map(),
    nameSeeds: new Map(),
    states: new Map(),
  };
  pictures.set(note.key, entry);
  while (pictures.size > PICTURES_KEPT) pictures.delete(pictures.keys().next().value);
  return entry;
}

// Keep a picked area this picture has shown, under the stamp of the touches
// that give it. The oldest go first.
function remember(entry, stamp, mask) {
  if (!stamp || !mask) return;
  entry.states.delete(stamp);
  entry.states.set(stamp, mask);
  while (entry.states.size > STATES_KEPT) entry.states.delete(entry.states.keys().next().value);
}

function viewUrl(file, tag = "") {
  const query = new URLSearchParams({
    filename: String(file.filename),
    subfolder: String(file.subfolder ?? ""),
    type: String(file.type ?? "temp"),
  });
  if (tag) query.set("v", tag);
  return api.apiURL(`/view?${query}`);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("the picture did not load")), { once: true });
    image.src = url;
  });
}

// The exact pixels of a picture the server sent at the preview's size.
let reader = null;
function readPixels(image, width, height) {
  reader ??= document.createElement("canvas");
  reader.width = width;
  reader.height = height;
  const context = reader.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

function onOff(rgba) {
  const mask = new Uint8Array(rgba.length / 4);
  for (let index = 0, at = 0; index < mask.length; index += 1, at += 4) mask[index] = rgba[at] >= 128 ? 1 : 0;
  return mask;
}

// What the node says is picked, as the face keeps it: on/off, or how strong
// each pixel is where a brush with a soft edge painted (the node sends greys
// only then).
function readSelection(rgba) {
  let soft = false;
  for (let at = 0; at < rgba.length; at += 4) {
    if (rgba[at] > 3 && rgba[at] < 252) { soft = true; break; }
  }
  if (!soft) return onOff(rgba);
  const mask = new Float32Array(rgba.length / 4);
  for (let index = 0, at = 0; index < mask.length; index += 1, at += 4) mask[index] = rgba[at] / 255;
  return mask;
}

const isFile = (file) => file && typeof file === "object" && typeof file.filename === "string" && file.filename !== "";

function validNote(note) {
  return Boolean(note) && typeof note === "object" && typeof note.key === "string" && note.key !== ""
    && Number(note.width) > 0 && Number(note.height) > 0 && isFile(note.picture);
}

// The pieces come in rounds: each look adds what it found, and `more` says
// whether the picture has points left to ask about.
const piecesTag = (pieces) => `${pieces?.list?.length ?? 0}:${(Array.isArray(pieces?.planes) ? pieces.planes : []).map((file) => file?.filename).join(",")}`;

async function loadPieces(entry, pieces) {
  const tag = piecesTag(pieces);
  const list = (Array.isArray(pieces.list) ? pieces.list : [])
    .filter((piece) => piece && Number.isFinite(Number(piece.x)) && Number.isFinite(Number(piece.y)))
    .map((piece) => {
      // A piece is a match of a word ("name", with the word and how sure
      // SAM 3 was) or what SAM 3 found at a point.
      const name = piece.kind === "name" ? cleanWord(piece.name) : "";
      const sure = name ? Number(piece.sure) || 0 : 0;
      const share = Number(piece.share) || 0;
      return {
        x: Math.round(Number(piece.x)),
        y: Math.round(Number(piece.y)),
        share,
        kind: name ? "name" : "point",
        name,
        sure,
        // What is shown of the word: nothing when SAM 3 was not sure of it.
        // The thing lights up and is picked all the same.
        label: name && nameShown(sure, share) ? name : "",
      };
    });
  const files = (Array.isArray(pieces.planes) ? pieces.planes : []).filter(isFile);
  const images = await Promise.all(files.map((file) => loadImage(viewUrl(file, entry.key))));
  const planes = packPlanes(images.map((image) => readPixels(image, entry.pw, entry.ph)), entry.pw, entry.ph);
  const sizes = pieceSizes(planes, list.length);
  const overlaps = pieceOverlaps(planes, list.length);
  entry.pieces = {
    planes,
    list,
    sizes,
    ranks: pieceRanks(list, sizes, entry.pw * entry.ph, overlaps),
    wholes: pieceWholes(list, sizes, entry.pw * entry.ph, overlaps),
  };
  entry.seeds = new Map();
  entry.nameSeeds = new Map();
  list.forEach((piece, index) => {
    if (piece.kind === "name") entry.nameSeeds.set(`${piece.name}|${piece.x},${piece.y}`, index);
    else entry.seeds.set(`${piece.x},${piece.y}`, index);
  });
  entry.piecesTag = tag;
  entry.scoped = pieces.more !== true;
}

// ---- what is picked --------------------------------------------------------

// The area one touch stands for, when the face can know it without a run:
// a tap or a name at a piece it holds, or paint. A stroke that finds a
// thing, and a tap elsewhere, are SAM 3's to answer.
function localMask(pic, item) {
  if (item.t === "tap") {
    const piece = pic.seeds.get(`${item.x},${item.y}`);
    return piece === undefined ? null : pieceMask(pic.pieces.planes, piece);
  }
  if (item.t === "name") {
    const piece = pic.nameSeeds.get(`${item.w}|${item.x},${item.y}`);
    return piece === undefined ? null : pieceMask(pic.pieces.planes, piece);
  }
  if (item.t !== "paint") return null;
  // A brush mark, with the edge the brush had: on/off for a hard brush.
  const points = item.pts.map((pair) => [pair[0] * pic.scale, pair[1] * pic.scale]);
  return brushStroke(pic.pw, pic.ph, points, item.r * pic.scale, item.s ?? 0);
}

// The area one touch stands for by itself, as far as the face knows it:
// worked out here, or as the node sent it with an answer.
function itemArea(pic, item) {
  return localMask(pic, item) ?? pic.areas?.get(areaKey(item)) ?? null;
}

// Keep what the node said one picked thing covers. The oldest go first.
function keepArea(pic, key, mask) {
  pic.areas ??= new Map();
  pic.areas.delete(key);
  pic.areas.set(key, mask);
  while (pic.areas.size > AREAS_KEPT) pic.areas.delete(pic.areas.keys().next().value);
}

// A chip is known by the number its touches carry. One whose touches were
// saved before chips had numbers is known by where it starts instead.
const chipId = (chip) => chip.g || -(chip.first + 1);

// What a chip covers, on/off: everything its touches add, where that is
// still picked. Half strength or more counts, which is where the picture
// draws an area's outline. Null while none of it is known.
function chipArea(face, chip) {
  const pic = face.pic;
  if (!pic || !face.raw) return null;
  face.chipAreas ??= new Map();
  if (face.chipAreas.has(chip.first)) return face.chipAreas.get(chip.first);
  let all = null;
  for (const index of chip.at) {
    const own = itemArea(pic, face.items[index]);
    if (own) all = all ? joinMasks(all, own, 1) : own;
  }
  let area = null;
  if (all) {
    area = new Uint8Array(all.length);
    for (let index = 0; index < area.length; index += 1) area[index] = all[index] >= 0.5 && face.raw[index] >= 0.5 ? 1 : 0;
  }
  face.chipAreas.set(chip.first, area);
  return area;
}

// Whether two areas share any pixel at all, however faint.
function meets(one, other) {
  if (!one || !other) return false;
  for (let index = 0; index < one.length; index += 1) if (one[index] > 0 && other[index] > 0) return true;
  return false;
}

// Work out the picked area from the touches: start from the longest run of
// them whose area this picture has already shown, and add the rest where the
// face knows them. `exact` is false while a touch still waits for SAM 3.
function resolve(face) {
  const pic = face.pic;
  if (!pic) return;
  const items = face.items;
  const blank = () => new Uint8Array(pic.pw * pic.ph);
  let from = items.length;
  let base = from ? pic.states.get(face.stamp) ?? pic.states.get(face.stamps[from - 1]) ?? null : blank();
  while (!base && from > 0) {
    from -= 1;
    base = from ? pic.states.get(face.stamps[from - 1]) ?? null : blank();
  }
  let raw = base;
  let exact = true;
  for (let index = from; index < items.length; index += 1) {
    const own = localMask(pic, items[index]);
    if (!own) { exact = false; continue; }
    raw = joinMasks(raw, own, items[index].op);
    if (exact) remember(pic, face.stamps[index], raw);
  }
  face.raw = raw;
  face.exact = exact;
  face.chipAreas = null;
  face.inside = pic.pieces ? piecesInside(pic.pieces.planes, pic.pieces.list.length, raw) : null;
  face.hoverMask = null;
}

// Read the touches from the node's widget. Touches made on another picture
// stay in the widget until this one is touched, but show as none. A picture
// the face only knows from its loader has no key yet, so touches that carry
// one wait for the node's own word (face.held).
function readItems(face) {
  const text = String(face.touches?.value ?? "");
  const { key, items } = decodeTouches(text);
  const pic = face.pic;
  const mine = Boolean(pic) && (key === "" || key === pic.key);
  face.items = mine ? items : [];
  face.keyless = mine && key === "" && items.length > 0;
  face.held = 0;
  face.other = Boolean(pic) && !mine && items.length > 0;
  if (face.other && pic.provisional) {
    // A key starts with the picture's size. The same size, from the same
    // file of the loader: most likely the picture the picks were made on.
    const size = /^(\d+)x(\d+)-/.exec(key);
    const sameSize = !size || (Number(size[1]) === pic.width && Number(size[2]) === pic.height);
    const file = face.node.properties?.[FILE_PROPERTY];
    if (sameSize && (!file || !face.sourceName || file === face.sourceName)) {
      face.held = items.length;
      // Said as the chips will show them: an area is one pick.
      face.heldPicks = chipGroups(items).filter((chip) => !chip.away).length || 1;
      face.other = false;
    }
  }
  face.stamp = stampOf(text);
  face.stamps = pic ? prefixStamps(pic.key, face.items) : [];
  face.text = text;
}

function writeTouches(face, text) {
  if (!face.touches || face.touches.value === text) return;
  face.touches.value = text;
  face.touches.callback?.(text);
  notifyAusbossChange();
}

// Write the touches back and show what they give.
function commit(face) {
  const pic = face.pic;
  if (!pic || !face.touches) return;
  writeTouches(face, encodeTouches(pic.key, face.items));
  if (face.items.length && face.sourceName) {
    face.node.properties ??= {};
    face.node.properties[FILE_PROPERTY] = face.sourceName;
  }
  readItems(face);
  face.itemNotes = null;
  face.retries = 0;
  resolve(face);
  syncState(face);
  draw(face);
  if (!face.exact) requestRun(face, "look");
  else wantFine(face);
}

// ---- runs -----------------------------------------------------------------

// A picture is looked at in rounds, each about a second of SAM 3, until the
// server says it has no points left. Short rounds, because a click made
// while one runs waits for it. This many at most, so a server that never
// says it is done is not asked for ever.
const SCOPE_ROUNDS = 16;

// Whether to ask for (more of) the pieces of the picture next.
function wantsScope(face) {
  const pic = face.pic;
  return face.snap && Boolean(pic) && !pic.provisional && !pic.scoped && !pic.paused && pic.scopeAsks < SCOPE_ROUNDS;
}

// The pieces are looked for behind the scenes once the pointer rests on the
// picture, so they light up before the first click. Only when a plain
// loader feeds the node: its picture costs nothing to fetch again. After
// anything else (a sampler, say) a run nobody asked for could redo that
// work, so there the pieces come with the first touch.
const DWELL_MS = 350;
// Once the whole picture has been looked at, a spot where the pointer rests
// and nothing lights up is asked about by itself. A little slower to start,
// and each picture is asked about this many spots at most.
const REST_MS = 500;
const RESTS_KEPT = 60;
// Spots count as the same within this many pixels of the small copy.
const REST_CELL = 12;

// Whether any piece at all covers the pointer's place, picked or not.
function anyPieceUnder(face) {
  const pic = face.pic;
  const point = face.pointer;
  if (!pic?.pieces || !point) return false;
  const x = clamp(Math.floor(point[0] * pic.scale), 0, pic.pw - 1);
  const y = clamp(Math.floor(point[1] * pic.scale), 0, pic.ph - 1);
  return pic.pieces.planes.some((bits) => bits[y * pic.pw + x] !== 0);
}

function restCell(face) {
  const pic = face.pic;
  const point = face.pointer;
  return `${Math.floor((point[0] * pic.scale) / REST_CELL)},${Math.floor((point[1] * pic.scale) / REST_CELL)}`;
}

function armDwell(face) {
  clearTimeout(face.dwell);
  const pic = face.pic;
  if (!pic || !face.snap || face.inFlight || face.held || !face.pointer || pic.paused) return;
  // Only where running what comes before costs nothing: a Load Image, or
  // one of the pack's own loaders.
  if (!(loaderSource(face.node) || ownLoader(face.node)) || face.host.lookOnButton?.()) return;
  if (!pic.scoped && pic.scopeAsks < SCOPE_ROUNDS) {
    face.dwell = setTimeout(() => {
      if (!face.alive || !face.pointer || face.stroke || face.inFlight || face.pic !== pic || pic.scoped) return;
      requestRun(face, "scope");
    }, DWELL_MS);
    return;
  }
  pic.rests ??= new Set();
  if (pic.rests.size >= RESTS_KEPT || anyPieceUnder(face) || pic.rests.has(restCell(face))) return;
  face.dwell = setTimeout(() => {
    if (!face.alive || !face.pointer || face.stroke || face.inFlight || face.pic !== pic) return;
    if (anyPieceUnder(face) || pic.rests.has(restCell(face))) return;
    pic.rests.add(restCell(face));
    requestRun(face, "scope");
  }, REST_MS);
}

// What a scope run is asked: with the pointer's place when it is on the
// picture, so the thing under it is looked at first.
function scopeAsk(face) {
  const pic = face.pic;
  const waiting = face.pending[0];
  const point = waiting ? [waiting.x, waiting.y] : face.pointer;
  if (!pic || !point) return "scope";
  return `scope:${Math.round(point[0])},${Math.round(point[1])}`;
}

// Run this node alone. `ask` is "look" (the picture and what is picked) or
// "scope" (the pieces of the picture as well). Says whether a run was sent.
function requestRun(face, ask) {
  // The workflow is being sent right now and will answer for these touches.
  if (face.holdRuns) return false;
  // Switched off (bypassed or muted, by hand or by a switch): ComfyUI leaves
  // this node out of a run, so a run of it alone has nothing to do and comes
  // back as "Prompt has no outputs". Nothing is sent; the look is made up
  // when the node is on again and the pointer comes to it.
  if (face.host.switchedOff?.()) {
    face.lookMissed = true;
    dropPending(face);
    setNote(face, "This node is switched off. Switch it on to pick.", { life: 5000 });
    return false;
  }
  if (face.flying.length) {
    // A look at the picture gives way to the next job in the queue. So a
    // run that is not a look is sent at once, behind the look, and the look
    // ends early for it. So is a look at another picture: the one on its
    // way is at a picture this node no longer has. Anything else waits for
    // what is on its way.
    if (!goesBehind(face.flying, ask, face.sourceEpoch)) {
      face.wanted = face.wanted === "scope" || ask === "scope" ? "scope" : ask;
      return false;
    }
  }
  if (!upstreamNode(face.node, "model") || !upstreamNode(face.node, "clip")) {
    setNote(face, "Connect SAM 3 first: MODEL and CLIP from its Load Checkpoint.", { life: 6000 });
    return false;
  }
  const run = { ask, stamp: face.stamp, epoch: face.sourceEpoch, queued: false };
  face.flying.push(run);
  face.inFlight = true;
  face.askedAt = performance.now();
  if (ask === "scope" && face.pic) face.pic.scopeAsks += 1;
  setNote(face, "");
  syncState(face);
  const failed = () => {
    face.flying = face.flying.filter((other) => other !== run);
    if (!face.flying.length) settle(face);
  };
  Promise.resolve(face.host.run(ask === "scope" ? scopeAsk(face) : ask)).then((queued) => {
    if (queued === false) {
      failed();
      return;
    }
    run.queued = true;
    // A touch that came while this look was still being sent goes now.
    if (face.alive && face.wanted && face.wanted !== "scope") {
      const wanted = face.wanted;
      face.wanted = null;
      requestRun(face, wanted);
    }
  }, failed);
  return true;
}

// The run this face asked for is over without a result of its own (it could
// not be queued, it was stopped, or something before this node failed).
function settle(face) {
  if (!face.alive) return;
  face.flying = [];
  face.inFlight = false;
  face.wanted = null;
  if (face.pending.length) {
    dropPending(face);
    setNote(face, "The picture could not be looked at. Click again.", { life: 5000 });
  }
  syncState(face);
  draw(face);
}

// ---- drawing ---------------------------------------------------------------

function settings(face) {
  const number = (name) => Number(widgetByName(face.node, name)?.value) || 0;
  return {
    grow: Math.round(number("grow")),
    soften: Math.max(0, number("soften")),
    smooth: Math.max(0, Math.round(number("smooth"))),
    fill: widgetByName(face.node, "fill_holes")?.value !== false,
    invert: widgetByName(face.node, "invert")?.value === true,
    fine: fineChoice(widgetByName(face.node, "fine_edges")?.value),
  };
}

// ---- the fine edge ----------------------------------------------------------
// With Fine edges on, the node works out a soft edge (hair, fur) that the
// face cannot draw by itself. The node sends it with every answer, at the
// small copy's size; the face shows it while its picks and settings are
// still the ones it was made with, and asks for a new one when they are not.

// The fine edge that fits what the face shows right now, or null.
function fineOf(face) {
  const fine = face.pic?.fine;
  if (!fine || !face.exact || !face.items.length) return null;
  const now = settings(face);
  return now.fine && fine.stamp === face.stamp && fine.made === fineMade(now) ? fine : null;
}

// Whether the node is working out the fine edge for what is shown right now:
// then the edge on the picture is still the plain one, and the picture says
// so in its corner, so nobody wonders what it is waiting for.
function fineWaiting(face) {
  const pic = face.pic;
  if (!pic || pic.provisional || face.held || !face.exact || !face.items.length) return false;
  const now = settings(face);
  if (!now.fine || fineOf(face) || !face.raw?.some((value) => value)) return false;
  const state = `${face.stamp}|${fineMade(now)}`;
  if (pic.fineTrouble === state) return false;
  return !(pic.fineAsked === state && pic.fineAsks >= 2 && !face.inFlight);
}

// A little after the last change, so a drag of Grow asks once, at its end.
const FINE_WAIT_MS = 320;

// Ask the node for the fine edge when the one at hand does not fit.
function wantFine(face) {
  clearTimeout(face.fineTimer);
  const pic = face.pic;
  if (!face.alive || !pic || pic.provisional || !face.items.length || !settings(face).fine) return;
  face.fineTimer = setTimeout(() => {
    if (!face.alive || face.pic !== pic || !face.exact || !face.items.length || face.stroke || fineOf(face)) return;
    const now = settings(face);
    // The node said why it cannot (the model file is missing, say): it is
    // not asked again for the same picks and settings.
    const state = `${face.stamp}|${fineMade(now)}`;
    if (!now.fine || pic.fineTrouble === state) return;
    if (face.inFlight) { wantFine(face); return; }
    // Asked twice for the same picks and settings and nothing came: the
    // node has no fine edge for them (nothing is picked in the end).
    if (pic.fineAsked !== state) { pic.fineAsked = state; pic.fineAsks = 0; }
    if (pic.fineAsks >= 2) { draw(face); return; }
    pic.fineAsks += 1;
    requestRun(face, "look");
  }, FINE_WAIT_MS);
}

function draw(face) {
  if (face.frameRequest || !face.alive) return;
  face.frameRequest = requestAnimationFrame(() => {
    face.frameRequest = 0;
    if (face.alive) paint(face);
  });
}

function layerContext(canvas, width, height) {
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return canvas.getContext("2d");
}

const lineOf = (pic) => Math.max(1, Math.round(Math.min(pic.pw, pic.ph) / 340));

// An on/off area after the node's edge settings, on the small copy: the
// mask as the node will return it (`soft`), and the same shape before it is
// softened (`hard`), which is what the tint and its outline are drawn from.
// A small pick under a wide Soften has no pixel left over half, and drawn
// from the soft mask alone it showed as nothing at all.
function edged(face, raw) {
  const pic = face.pic;
  const now = settings(face);
  const steps = {
    raw,
    width: pic.pw,
    height: pic.ph,
    grow: previewPixels(now.grow, pic.scale),
    smooth: previewPixels(now.smooth, pic.scale),
    fill: now.fill,
  };
  const hard = composeEdge(steps);
  const sigma = now.soften * pic.scale;
  const soft = sigma > 0 ? composeEdge({ ...steps, soften: sigma }) : hard;
  // Invert turns the finished mask round: everything but what was picked.
  // Nothing picked stays nothing.
  if (!now.invert || !raw.some((value) => value)) return { hard, soft };
  const turned = (mask) => { const out = new Float32Array(mask.length); for (let index = 0; index < out.length; index += 1) out[index] = 1 - mask[index]; return out; };
  const hardTurned = turned(hard);
  return { hard: hardTurned, soft: soft === hard ? hardTurned : turned(soft) };
}

// What the tint view shows: the shape itself, full, with the soft edge
// fading out around it.
function tintOf({ hard, soft }) {
  if (soft === hard) return hard;
  const shown = new Float32Array(hard.length);
  for (let index = 0; index < shown.length; index += 1) shown[index] = hard[index] > soft[index] ? hard[index] : soft[index];
  return shown;
}

// The strongest value of a mask: under about half, the mask is faint.
function peakOf(mask) {
  let peak = 0;
  for (let index = 0; index < mask.length; index += 1) if (mask[index] > peak) peak = mask[index];
  return peak;
}

function paint(face) {
  const pic = face.pic;
  syncReadout(face);
  if (!pic || !face.raw) return;
  // The node's fine edge when it fits; else the edge as the face works it out.
  const fine = fineOf(face);
  const edge = fine ? { hard: fine.mask, soft: fine.mask } : edged(face, face.raw);
  face.share = maskShare(edge.soft);
  // Something is picked, and Soften has spread it so thin that no part of
  // the mask is over half: it will hardly change anything downstream.
  face.faint = face.items.length > 0 && maskShare(edge.hard) > 0 && peakOf(edge.soft) < 0.5;
  const context = layerContext(face.tint, pic.pw, pic.ph);
  if (!face.tintPixels || face.tintPixels.width !== pic.pw || face.tintPixels.height !== pic.ph) {
    face.tintPixels = context.createImageData(pic.pw, pic.ph);
  }
  // The tint is for picking: it keeps the shape and its outline whatever
  // Soften is. Cut and Mask show the mask exactly as it will be returned.
  if (face.view === "tint") paintTint(face.tintPixels.data, tintOf(edge), pic.pw, pic.ph, { line: lineOf(pic) });
  else paintCover(face.tintPixels.data, edge.soft, pic.pw, pic.ph, face.view, fine?.colours ?? null);
  context.putImageData(face.tintPixels, 0, 0);
  face.root.classList.toggle("fining", fineWaiting(face));
  paintLit(face);
  paintSwatch(face);
  syncReadout(face);
  syncTools(face);
}

// The little dot beside the readout: how the edge comes out with Grow and
// Soften, on one dab of the brush. It is drawn at the dab's own scale, so a
// Soften that is wide for the brush looks as washed out as it will be.
function paintSwatch(face) {
  const canvas = face.swatch;
  const size = canvas.width;
  const context = canvas.getContext("2d");
  const now = settings(face);
  const brush = brushSize(face);
  // The dab fills a little under half the swatch, so growth and a soft
  // edge have room to show.
  const scale = (size * 0.42) / brush;
  // With the brush's own edge, where the brush is what paints.
  const mask = brushStroke(size, size, [[size / 2, size / 2]], (brush / 2) * scale, face.tool === "pick" ? 0 : brushSoft(face));
  const grow = Math.round(now.grow * scale);
  const shape = composeEdge({ raw: mask, width: size, height: size, grow, soften: now.soften * scale });
  const pixels = context.createImageData(size, size);
  for (let index = 0; index < shape.length; index += 1) {
    const at = index * 4;
    pixels.data[at] = TINT[0]; pixels.data[at + 1] = TINT[1]; pixels.data[at + 2] = TINT[2];
    pixels.data[at + 3] = Math.round(Math.min(1, shape[index]) * 255);
  }
  context.putImageData(pixels, 0, 0);
}

// The layer over the picked area: the piece under the pointer, and the rim
// of the last stroke while SAM 3 turns it into a thing.
function paintLit(face) {
  const pic = face.pic;
  if (!pic) return;
  const context = layerContext(face.lit, pic.pw, pic.ph);
  if (!face.litPixels || face.litPixels.width !== pic.pw || face.litPixels.height !== pic.ph) {
    face.litPixels = context.createImageData(pic.pw, pic.ph);
  }
  const pixels = face.litPixels.data;
  if (face.hover >= 0 && pic.pieces) {
    // Through the same edge steps as the mask: what lights up is what a
    // click gives.
    face.hoverMask ??= tintOf(edged(face, pieceMask(pic.pieces.planes, face.hover)));
    paintTint(pixels, face.hoverMask, pic.pw, pic.ph, {
      tint: face.hoverAway ? LIT_AWAY : LIT,
      outline: face.hoverAway ? LIT_AWAY : [255, 255, 255],
      strength: LIT_STRENGTH,
      line: lineOf(pic),
    });
  } else {
    // A chip that is pointed at lights its area; the selected one keeps a
    // white line round it, so it is plain where paint will join.
    const id = face.hoverChip || (face.active !== face.fresh ? face.active : 0);
    const chip = id ? chipGroups(face.items).find((other) => chipId(other) === id) : null;
    const area = chip ? chipArea(face, chip) : null;
    if (area) {
      paintTint(pixels, area, pic.pw, pic.ph, {
        tint: LIT,
        outline: [255, 255, 255],
        strength: face.hoverChip ? LIT_STRENGTH : 0,
        line: lineOf(pic),
      });
    } else {
      pixels.fill(0);
    }
  }
  if (face.rim) {
    for (const index of face.rim) {
      const at = index * 4;
      pixels[at] = 255; pixels[at + 1] = 255; pixels[at + 2] = 255; pixels[at + 3] = 235;
    }
  }
  context.putImageData(face.litPixels, 0, 0);
}

// The outline of a stroke as a dashed line of pixels, so what was painted
// can be told from what it was turned into.
function rimOf(pic, item) {
  const points = item.pts.map((pair) => [pair[0] * pic.scale, pair[1] * pic.scale]);
  const mask = paintStroke(new Uint8Array(pic.pw * pic.ph), pic.pw, pic.ph, points, item.r * pic.scale, 1);
  const inner = shrinkMask(mask, pic.pw, pic.ph, lineOf(pic));
  const dash = Math.max(3, lineOf(pic) * 4);
  const rim = [];
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index] || inner[index]) continue;
    const x = index % pic.pw;
    const y = (index - x) / pic.pw;
    if (Math.floor((x + y) / dash) % 2 === 0) rim.push(index);
  }
  return Uint32Array.from(rim);
}

function brushSize(face) {
  const saved = Number(face.node.properties?.[BRUSH_PROPERTY]);
  if (Number.isFinite(saved) && saved > 0) return clamp(Math.round(saved), BRUSH_SIZE[0], BRUSH_SIZE[1]);
  // Until it is set by hand the brush follows the picture: about a
  // sixteenth of its short side, an even number.
  const short = face.pic ? Math.min(face.pic.width, face.pic.height) : 960;
  return clamp(Math.round(short / 32) * 2, BRUSH_SIZE[0], BRUSH_SIZE[1]);
}

const brushRadius = (face) => clamp(Math.round(brushSize(face) / 2), BRUSH_RADIUS[0], BRUSH_RADIUS[1]);

// How soft the brush's edge is, 0 (hard) to 100. Hard until it is set.
const brushSoft = (face) => clampSoft(face.node.properties?.[SOFT_PROPERTY], 0);

// One gradient per face, so two nodes on a page never share one.
let dabCount = 0;
// How strongly the brush's shape tints the picture under the pointer: light
// while aiming, stronger while the brush itself is being set (as on Image
// Compare A/B).
const DAB_AIMING = 0.4;
const DAB_SETTING = 0.62;
const DAB_STOPS = 14;

// Draw the brush's shape: solid in the middle, fading where its edge is
// soft, in teal where it paints and coral where it erases.
function drawDab(face, at, radius, soft, setting, away) {
  const dab = face.dab;
  const brushing = face.tool !== "pick";
  if (!at || face.stroke || (!setting && !brushing)) {
    dab.style.display = "none";
    return;
  }
  const size = radius * 2;
  const reach = brushReach(size, soft / 100);
  const colour = away ? LIT_AWAY : TINT;
  const strength = setting ? DAB_SETTING : DAB_AIMING;
  const key = `${size}|${soft}|${away ? 1 : 0}|${setting ? 1 : 0}`;
  if (face.dabKey !== key) {
    face.dabKey = key;
    const fade = dab.parentNode.querySelector("radialGradient");
    fade.replaceChildren(...Array.from({ length: DAB_STOPS + 1 }, (_, index) => {
      const offset = index / DAB_STOPS;
      const stop = svg("stop");
      stop.setAttribute("offset", offset.toFixed(4));
      stop.setAttribute("stop-color", `rgb(${colour.join(",")})`);
      stop.setAttribute("stop-opacity", (strength * brushProfile(offset * reach, size, soft / 100)).toFixed(3));
      return stop;
    }));
  }
  dab.setAttribute("cx", at[0].toFixed(1));
  dab.setAttribute("cy", at[1].toFixed(1));
  dab.setAttribute("r", reach.toFixed(1));
  dab.style.display = "";
}

// The name of the thing under the pointer, beside the pointer: what a click
// there would take. A thing SAM 3 has no word for lights up without one.
function syncTag(face) {
  const tag = face.tag;
  const pic = face.pic;
  const at = face.pointer;
  const piece = pic?.pieces && at && !face.stroke && face.hover >= 0 ? pic.pieces.list[face.hover] : null;
  const name = piece?.label || "";
  tag.classList.toggle("on", Boolean(name));
  if (!name) return;
  tag.textContent = face.hoverAway ? `take away: ${name}` : name;
  tag.classList.toggle("away", Boolean(face.hoverAway));
  // Kept inside the picture: it swaps sides near the right and bottom edges.
  tag.classList.toggle("left", at[0] > pic.width * 0.6);
  tag.classList.toggle("up", at[1] > pic.height * 0.86);
  tag.style.left = `${(at[0] / pic.width) * 100}%`;
  tag.style.top = `${(at[1] / pic.height) * 100}%`;
}

function drawInk(face) {
  syncTag(face);
  const pic = face.pic;
  if (!pic) return;
  const radius = brushRadius(face);
  const stroke = face.stroke;
  // While the brush is being set it stays where the drag began.
  const setting = face.adjust;
  const away = setting ? false : stroke ? stroke.away : face.away;
  const at = setting ? setting.anchor : face.pointer;
  for (const ring of [face.ringBack, face.ring]) {
    ring.style.display = at ? "" : "none";
    if (!at) continue;
    ring.setAttribute("cx", at[0].toFixed(1));
    ring.setAttribute("cy", at[1].toFixed(1));
    ring.setAttribute("r", String(radius));
  }
  face.ring.classList.toggle("away", Boolean(away));
  const soft = brushSoft(face);
  drawDab(face, at, radius, soft, Boolean(setting), Boolean(away));
  // Where the brush's solid middle ends, as a dashed ring: while the brush
  // is being set, and in Paint and Erase while its edge is soft.
  const brushing = stroke ? stroke.brush : face.tool !== "pick";
  const core = at && (setting || (brushing && soft > 0)) ? brushCore(radius * 2, soft / 100) : 0;
  face.coreRing.style.display = core >= 1 && core < radius ? "" : "none";
  if (core >= 1 && at) {
    face.coreRing.setAttribute("cx", at[0].toFixed(1));
    face.coreRing.setAttribute("cy", at[1].toFixed(1));
    face.coreRing.setAttribute("r", core.toFixed(1));
  }
  // Both values in words under the brush, the one being set in white.
  const label = face.brushLabel;
  label.classList.toggle("on", Boolean(setting));
  if (setting) {
    const words = brushWords(brushSize(face), soft);
    const axis = setting.drag.axis;
    label.children[0].textContent = words[0];
    label.children[0].classList.toggle("lit", axis !== "soft");
    label.children[1].textContent = words[1];
    label.children[1].classList.toggle("lit", axis !== "size");
    const below = at[1] + radius < pic.height * 0.86;
    label.classList.toggle("up", !below);
    label.style.left = `${clamp((at[0] / pic.width) * 100, 18, 82)}%`;
    label.style.top = `${((at[1] + (below ? radius : -radius)) / pic.height) * 100}%`;
  }
  if (stroke?.moved) {
    const path = stroke.points.map((pair) => `${pair[0].toFixed(1)} ${pair[1].toFixed(1)}`).join("L");
    face.path.setAttribute("d", `M${path}${stroke.points.length === 1 ? `L${path}` : ""}`);
    // A soft brush shows its solid middle while it is dragged.
    const width = stroke.brush && stroke.soft > 0 ? Math.max(1, brushCore(radius * 2, stroke.soft / 100)) * 2 : radius * 2;
    face.path.setAttribute("stroke-width", String(width));
    face.path.classList.toggle("away", stroke.away);
    face.path.style.display = "";
  } else {
    face.path.style.display = "none";
  }
  // A tap that is still with SAM 3 shows as a dot where it landed.
  const waiting = face.exact ? [] : face.items.filter((item) => item.t === "tap" && !pic.seeds.has(`${item.x},${item.y}`)).slice(-4);
  for (const click of face.pending) waiting.push({ x: Math.round(click.x), y: Math.round(click.y) });
  if (!waiting.length && !face.dots.childElementCount) return;
  face.dots.replaceChildren(...waiting.map((item) => {
    const dot = svg("circle", "dot");
    dot.setAttribute("cx", String(item.x));
    dot.setAttribute("cy", String(item.y));
    dot.setAttribute("r", String(Math.max(2, 4 / (face.zoom || 1))));
    return dot;
  }));
}

function syncLine(face) {
  const readout = face.readout;
  // A pick can be swapped for as long as it is the last thing that happened,
  // or after its chip was opened; the arrows show only then.
  const live = choiceLive(face);
  if (!live) face.choice = null;
  face.before.style.display = live ? "" : "none";
  face.after.style.display = live ? "" : "none";
  // With the arrows on, the name takes the room between them: the arrows
  // stay where they are whatever the name's length, so one can be pressed
  // again and again.
  face.before.parentElement?.classList.toggle("choosing", Boolean(live));
  if (!face.pic) {
    readout.textContent = "";
    return;
  }
  if (face.held) {
    readout.textContent = face.heldPicks === 1 ? "1 pick saved" : `${face.heldPicks} picks saved`;
    readout.classList.add("quiet");
    readout.classList.remove("warn");
    return;
  }
  if (face.pending.length) {
    readout.textContent = "your click is in";
    readout.classList.add("quiet");
    readout.classList.remove("warn");
    readout.title = "Your click is taken as soon as the picture has been looked at.";
    return;
  }
  // Counted as the chips show them: an area is one pick however many brush
  // marks it took, and what was taken away is none.
  const groups = chipGroups(face.items).filter((chip) => !chip.away);
  const count = groups.length;
  const choice = face.choice;
  if (!count && face.inFlight) {
    // The button before it says so.
    readout.textContent = notReady(face) ? "" : "looking at the picture";
    readout.classList.add("quiet");
    readout.classList.remove("warn");
    return;
  }
  if (choice && face.exact && !face.faint) {
    // A pick that takes away says so, with the sign of its button.
    readout.textContent = `${choice.op ? "" : "\u2212 "}${choice.candidates[choice.current].label} · ${choice.current + 1} of ${choice.candidates.length}`;
    readout.classList.remove("quiet", "warn");
    readout.title = "The arrows swap this pick for the next thing it could mean.";
    return;
  }
  let only = null;
  let name = "";
  if (count === 1) {
    const first = groups[0].first;
    const item = face.items[first];
    name = item.t === "name" && !item.q ? item.w : item.t === "subject" || item.t === "background" ? `the ${item.t}` : "";
    only = item.t === "tap" || item.t === "name" ? "thing" : groups[0].paint || face.itemNotes?.[first]?.as === "paint" ? "paint" : "under";
  }
  // A pick that Soften has thinned out says so, where the eye already is.
  if (face.faint && face.exact) {
    readout.textContent = `faint mask: Soften ${settings(face).soften} is wider than the pick`;
    readout.classList.remove("quiet");
    readout.classList.add("warn");
    readout.title = "No part of the mask is over half strength, so it will change little. Lower Soften, or pick something bigger.";
    return;
  }
  readout.classList.remove("warn");
  readout.title = "";
  readout.textContent = readoutText({ count, share: face.share ?? 0, only, name, waiting: !face.exact });
  readout.classList.toggle("quiet", !count || !(face.share > 0));
}

// The line under the picture, and the chips under it.
function syncReadout(face) {
  syncLine(face);
  if (face.chipList) syncChips(face);
  syncLooking(face);
}

// ---- the chips ---------------------------------------------------------------
//
// Under the picture every area has a chip: a thing that was picked, by its
// name, or an area that was painted. The cross takes that area away;
// "all n" on a named pick takes every thing of that name instead of the
// one. A click selects a chip: what is painted then joins it, and the
// arrows above swap it. The field at the end takes a name typed by hand.
//
// A thing that was taken away again has a chip too, in a warm colour: its
// cross brings the thing back, a click opens its arrows. The brush has
// none: Erase rubs out whatever is there. And a touch that would take
// nothing away is not kept at all.

const NOTHING_THERE = "Nothing is picked there to take away.";

// Give touches that add their chip: each a chip of its own, except that the
// first ones take the place of the picks they replace (`inPlaceOf`), so
// brush marks painted onto a pick stay with it when it is swapped.
function placed(face, templates, inPlaceOf = []) {
  const spare = inPlaceOf.map((item) => item?.g).filter(Boolean);
  let taken = face.fresh || 0;
  return templates.map((item) => {
    if (item.op !== 1) return item;
    const g = spare.shift() ?? nextGroup(face.items, taken);
    taken = Math.max(taken, g);
    return { ...item, g };
  });
}

// Take a chip away: the pick, and what was painted onto it.
function removeChip(face, chip) {
  if (!face.pic || face.held) return;
  flushPending(face);
  const own = new Set(chip.at);
  // The older chips' places move, so a chip known by its place lets go.
  if (face.active === chipId(chip) || face.active < 0) face.active = 0;
  face.hoverChip = 0;
  change(face, dropIdleAways(face.items.filter((_, at) => !own.has(at))));
  refreshHover(face);
}

// The chip of a thing that was picked as it is (or, with `away`, taken away
// as it is), if there is one.
function chipOfThing(face, item, away = false) {
  const key = areaKey(item);
  return chipGroups(face.items).find((chip) => !chip.paint && chip.away === away && areaKey(face.items[chip.first]) === key) ?? null;
}

function takeAll(face, index) {
  const item = face.items[index];
  if (!face.pic || face.held || item?.t !== "name") return;
  flushPending(face);
  const all = { t: "all", op: item.op, w: item.w };
  if (item.g) all.g = item.g;
  change(face, face.items.map((other, at) => (at === index ? all : other)));
  refreshHover(face);
}

function addName(face, text) {
  const word = cleanWord(text);
  if (!word || !face.pic || face.held) return false;
  flushPending(face);
  addItem(face, { t: "all", op: face.away ? 0 : 1, w: word });
  return true;
}

// The picture's main subject, or everything but it, as a pick: ComfyUI's
// background-removal model says what the subject is.
function addWhole(face, kind) {
  if (!face.pic || face.held) return;
  flushPending(face);
  addItem(face, { t: kind, op: face.away ? 0 : 1 });
}

// Select a chip, or let go of it. What is painted joins the selected chip
// wherever it lands, and the arrows above swap it when it has other
// meanings.
function selectChip(face, chip) {
  if (!face.pic || face.held) return;
  flushPending(face);
  if (chip.away) {
    // Nothing is painted onto a thing that was taken away: a click opens
    // its arrows, and a second one closes them.
    const open = choiceLive(face) && face.choice.start === chip.first;
    if (open) face.choice = null;
    else openChoice(face, chip.first);
    if (!open && !face.choice) setNote(face, "There is nothing else at this spot to swap it for.", { life: 2600 });
    face.chipsShown = null;
    syncReadout(face);
    return;
  }
  const id = chipId(chip);
  face.fresh = 0;
  if (face.active === id) {
    face.active = 0;
    face.choice = null;
  } else {
    face.active = id;
    openChoice(face, chip.first);
  }
  face.chipsShown = null;
  syncReadout(face);
  paintLit(face);
}

// Start an area of its own: what is painted next gets a new chip, also
// where it touches another one.
function startFresh(face) {
  if (!face.pic || face.held) return;
  flushPending(face);
  face.fresh = nextGroup(face.items);
  face.active = face.fresh;
  face.choice = null;
  face.chipsShown = null;
  // A new area is painted.
  if (face.tool === "pick") setTool(face, "paint");
  syncReadout(face);
  paintLit(face);
}

function letGo(face) {
  face.active = 0;
  face.fresh = 0;
  face.choice = null;
  face.chipsShown = null;
  syncReadout(face);
  paintLit(face);
}

function syncChips(face) {
  const pic = face.pic;
  const list = pic?.pieces?.list ?? [];
  const counts = (face.itemNotes ?? []).map((note) => note?.count ?? 0).join(",");
  const groups = chipGroups(face.items);
  // A chip that is gone (an Undo, a Clear) is no longer selected.
  if (face.active && face.active !== face.fresh && !groups.some((chip) => chipId(chip) === face.active)) face.active = 0;
  const swapping = choiceLive(face) ? face.choice.start : -1;
  const signature = `${face.text}|${face.held}|${face.exact}|${counts}|${pic?.piecesTag ?? ""}|${face.active}|${face.fresh}|${swapping}`;
  if (signature === face.chipsShown) return;
  face.chipsShown = signature;
  let painted = 0;
  const chips = groups.map((group) => {
    const index = group.first;
    const item = face.items[index];
    const id = chipId(group);
    const open = group.away ? swapping === index : face.active === id;
    // A pick of one thing can be swapped for the other things at its spot.
    const swaps = !group.paint && (item.t === "name" || item.t === "tap" || item.t === "find") && Boolean(pic?.pieces);
    const chip = el("span", `ausboss-touch-chip${group.away ? " away" : ""}${open ? " open" : ""}`);
    chip.addEventListener("click", () => selectChip(face, group));
    const count = face.itemNotes?.[index]?.count ?? 0;
    if (group.paint) painted += 1;
    const name = group.paint ? (painted > 1 ? `paint ${painted}` : "paint") : chipLabel(item, count);
    chip.append(el("span", "", name));
    const onIt = !group.paint && group.marks ? `, with ${group.marks === 1 ? "1 brush mark" : `${group.marks} brush marks`} on it` : "";
    chip.title = group.away
      ? (open ? "The arrows above swap what is taken away. Click again to close." : `Taken away from what is picked. The cross brings it back${swaps ? "; click to swap it for something else at the same spot" : ""}.`)
      : open
      ? `Selected: what you paint now joins this area${swaps ? ", and the arrows above swap it for something else at the same spot" : ""}. Click again to let go.`
      : group.paint
        ? `Your own paint${group.marks > 1 ? `: ${group.marks} marks` : ""}. Click to select it: what you paint then joins it.`
        : `${item.t === "all" ? `Every "${item.w}" in the picture` : "A thing you picked"}${onIt}. Click to select it: what you paint then joins it.`;
    if (item.t === "name") {
      const same = item.q ? 0 : list.filter((piece) => piece.kind === "name" && piece.name === item.w).length;
      if (same > 1) {
        const more = el("button", "more", `all ${same}`);
        more.type = "button";
        more.title = `Take every "${item.w}" in the picture, not only this one.`;
        more.addEventListener("click", (event) => { event.stopPropagation(); takeAll(face, index); });
        chip.append(more);
      }
    }
    // Pointing at a chip lights its area on the picture.
    chip.addEventListener("pointerenter", () => { face.hoverChip = id; paintLit(face); });
    chip.addEventListener("pointerleave", () => { face.hoverChip = 0; paintLit(face); });
    const cross = el("button", "", "\u2715");
    cross.type = "button";
    cross.title = group.away ? "Bring this back." : group.paint ? "Take this paint away." : group.marks ? "Take this pick away, with what you painted onto it." : "Take this pick away.";
    cross.addEventListener("click", (event) => { event.stopPropagation(); removeChip(face, group); });
    chip.append(cross);
    return chip;
  });
  // An area that was started and not painted yet.
  if (face.fresh) {
    const chip = el("span", "ausboss-touch-chip open fresh");
    chip.append(el("span", "", "new area"));
    chip.title = "A new area: what you paint next is kept apart from the others. Click to let go.";
    chip.addEventListener("click", () => letGo(face));
    const cross = el("button", "", "\u2715");
    cross.type = "button";
    cross.title = "Do not start a new area.";
    cross.addEventListener("click", (event) => { event.stopPropagation(); letGo(face); });
    chip.append(cross);
    chips.push(chip);
  }
  face.chipList.replaceChildren(...chips);
  // The newest chip is in view.
  face.chips.scrollTop = face.chips.scrollHeight;
}

function syncTools(face) {
  const live = Boolean(face.pic);
  const some = live && face.items.length > 0;
  // A click that waits for the look can be taken back like a pick.
  const waiting = live && face.pending.length > 0;
  face.undo.disabled = !live || (!some && !face.past.length && !waiting);
  face.clear.disabled = !some && !waiting;
  if (face.lookButton) {
    const offer = live && face.snap && !face.held && !face.inFlight && !face.pic.scoped && Boolean(face.host.lookOnButton?.());
    face.lookButton.style.display = offer ? "" : "none";
  }
  if (face.nameField) {
    face.nameField.disabled = !live || face.held > 0;
    // A typed name is added, or taken away while the tool takes away.
    face.nameField.placeholder = face.away ? "\u2212 type a name" : "+ type a name";
  }
  if (face.newButton) face.newButton.disabled = !live || face.held > 0 || Boolean(face.fresh);
  // The switch shows what a press does right now: with Ctrl held, Paint
  // and Erase swap. Pick stays Pick, and its marker turns warm while a
  // click takes away.
  face.toolSwitch.set(face.tool === "pick" ? "pick" : face.away ? "erase" : "paint");
  face.toolSwitch.root.classList.toggle("away", face.tool === "pick" && face.away);
  // The brush's edge is for Paint and Erase: Pick takes whole things.
  face.softField.classList.toggle("idle", face.tool === "pick");
  face.softBox.set(brushSoft(face));
  for (const [whole, word] of [[face.subjectButton, "subject"], [face.backgroundButton, "background"]]) {
    whole.disabled = !live || face.held > 0;
    whole.title = face.away
      ? `Take the picture's ${word === "subject" ? "main subject" : "background (everything but the main subject)"} away from what is picked.`
      : `Pick the picture's ${word === "subject" ? "main subject" : "background: everything but the main subject"}.`;
  }
  face.eye.classList.toggle("on", face.view !== "tint");
  face.eye.title = EYE_TITLES[face.view];
  face.size.set(brushSize(face));
}

// The node that makes the picture: what is wired into image, through any
// Reroute nodes on the way, which hand the picture on as it is.
function imageSource(node) {
  let upstream = upstreamNode(node, "image");
  for (let hops = 0; upstream && (upstream.comfyClass ?? upstream.type) === "Reroute" && hops < 32; hops += 1) {
    const link = linkById(upstream.graph, upstream.inputs?.[0]?.link);
    upstream = link ? upstream.graph.getNodeById?.(link.origin_id) ?? null : null;
  }
  return upstream;
}

// The picture can be known before the node has run when a plain Load Image
// feeds it directly: that node hands its file on as it is. Anything else
// between the file and this node may change the picture, and a wrong picture
// is worse than none, so then the face waits for a run.
function loaderSource(node) {
  const widget = loaderWidget(node);
  const value = widget?.value;
  if (typeof value !== "string" || !value) return null;
  return { widget, name: value, url: api.apiURL(`/view?${viewQueryForFile(value)}`) };
}

// The file box of a plain Load Image wired straight in, with or without a
// file in it: a workflow is shared with none, and the first one chosen has
// to show as well.
function loaderWidget(node) {
  const upstream = imageSource(node);
  if (!upstream || (upstream.comfyClass ?? upstream.type) !== "LoadImage") return null;
  return sourceFileWidget(upstream);
}

// One of the pack's own loaders wired straight in. It may crop, turn or pad
// its file, so its picture is only known from a run.
function ownLoaderNode(node) {
  const upstream = imageSource(node);
  return upstream && OWN_LOADERS.has(upstream.comfyClass ?? upstream.type) ? upstream : null;
}

// The same, once a file is chosen on it.
function ownLoader(node) {
  const upstream = ownLoaderNode(node);
  const file = sourceFileWidget(upstream)?.value;
  return typeof file === "string" && file ? upstream : null;
}

// How long the loader's settings have to rest before its picture is asked
// for: a crop that is being dragged changes them many times a second.
const OWN_SETTLE_MS = 700;

// Show the loader's picture without a press on Show picture: the same run
// that button asks for. Only ever in answer to something the person did (a
// file chosen, a setting changed, a wire made), never while a workflow is
// being opened, so opening one queues nothing. Picks saved with a workflow
// still wait for their own press.
function showOwnPicture(face) {
  if (!face.alive || face.holdRuns || face.host.lookOnButton?.()) return;
  const upstream = ownLoader(face.node);
  if (!upstream) return;
  if (!upstreamNode(face.node, "model") || !upstreamNode(face.node, "clip")) return;
  if (face.pic && face.held > 0) return;
  const seen = `${upstream.id}|${loaderSignature(upstream.widgets)}`;
  if (seen === face.ownSeen) {
    // Asked for already: it is on show, or on its way.
    if (face.pic || face.inFlight) return;
  } else {
    // Another picture: a look that is on its way is at the old one, and so
    // is a click that waits. The new look goes behind it, which ends it.
    face.sourceEpoch += 1;
    dropPending(face);
  }
  face.retries = 0;
  if (requestRun(face, "scope")) face.ownSeen = seen;
  // A run of this node that is no look is in the way (or one that is still
  // being sent): once more when it is over.
  else if (face.inFlight) followOwnLoader(face, true);
}

// Watch the loader's settings, and ask for its picture once they rest.
// `now` is for something the person just did (a wire made, a look that was
// in the way): the picture is asked for after the same rest.
function followOwnLoader(face, now = false) {
  const upstream = ownLoaderNode(face.node);
  if (!upstream) return;
  const later = () => {
    clearTimeout(face.ownTimer);
    face.ownTimer = setTimeout(() => showOwnPicture(face), OWN_SETTLE_MS);
  };
  for (const widget of upstream.widgets ?? []) {
    if (!widget || face.watchedSources.has(widget)) continue;
    face.watchedSources.add(widget);
    // A workflow being opened sets its values too: that is not the person.
    chainCallback(widget, "callback", () => { if (face.alive && !face.host.loading?.()) later(); });
  }
  if (now) later();
}

const OTHER_PICTURE = "This is another picture. The picks made on the last one are not used.";

function dropPicture(face) {
  dropPending(face);
  face.pic = null;
  face.raw = null;
  face.items = [];
  face.held = 0;
  face.other = false;
  face.share = 0;
  face.stroke = null;
  face.adjust = null;
  face.pointer = null;
  face.active = 0;
  face.fresh = 0;
  face.hoverChip = 0;
}

// Follow the loader: show its file as soon as one is chosen, and again when
// another is.
function syncSource(face) {
  const source = loaderSource(face.node);
  const url = source?.url ?? "";
  const watched = loaderWidget(face.node);
  if (watched && !face.watchedSources.has(watched)) {
    face.watchedSources.add(watched);
    chainCallback(watched, "callback", () => queueMicrotask(() => { if (face.alive) syncState(face); }));
  }
  if (url === face.sourceUrl) return;
  face.sourceUrl = url;
  face.sourceName = source?.name ?? "";
  face.sourceEpoch += 1;
  dropPending(face);
  if (!url) {
    if (face.pic?.provisional) dropPicture(face);
    return;
  }
  // A look at the last file is still on its way: this file's goes behind
  // it, which ends that one. It would be asked for anyway once that look
  // was over; this only stops the wait for a picture nobody looks at now.
  if (face.flying.length) requestRun(face, "look");
  const turn = ++face.turn;
  loadImage(url).then((image) => {
    if (!face.alive || turn !== face.turn || url !== face.sourceUrl) return;
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!(width > 0 && height > 0)) return;
    const scale = Math.min(1, PREVIEW_SIDE / Math.max(width, height));
    adopt(face, {
      key: "",
      provisional: true,
      width,
      height,
      scale,
      pw: Math.max(1, Math.round(width * scale)),
      ph: Math.max(1, Math.round(height * scale)),
      image,
      file: "",
      pieces: null,
      scoped: false,
      scopeAsks: 0,
      piecesTag: "",
      seeds: new Map(),
      nameSeeds: new Map(),
      states: new Map(),
    });
    readItems(face);
    face.itemNotes = null;
    if (face.other) setNote(face, OTHER_PICTURE, { life: 6000 });
    resolve(face);
    syncState(face);
    draw(face);
    drawInk(face);
  }, () => {});
}

// Which output feeds the picture in: "<node id>:<output slot>", or "".
function imageOrigin(node) {
  const input = node.inputs?.find((candidate) => candidate?.name === "image");
  const link = linkById(node.graph, input?.link);
  return link ? `${link.origin_id}:${link.origin_slot}` : "";
}

function syncState(face) {
  const linked = Boolean(upstreamNode(face.node, "image"));
  const model = Boolean(upstreamNode(face.node, "model")) && Boolean(upstreamNode(face.node, "clip"));
  // Wired to something else, the picture on show is no longer the node's.
  const origin = imageOrigin(face.node);
  if (face.pic && origin !== face.origin) {
    dropPicture(face);
    face.sourceUrl = "";
  }
  face.origin = origin;
  syncSource(face);
  followOwnLoader(face);
  const pic = face.pic;
  // Picks saved with the workflow, on a picture the node has not confirmed
  // yet: one press shows them, and until then the picture takes no touches.
  const locked = Boolean(pic) && face.held > 0;
  face.root.classList.toggle("live", Boolean(pic));
  face.root.classList.toggle("locked", locked);
  face.root.classList.toggle("busy", face.inFlight);
  for (const view of VIEWS) face.root.classList.toggle(`view-${view}`, face.view === view);
  const ready = linked && model;
  face.start.style.display = (!pic || locked) && ready ? "" : "none";
  face.start.textContent = !locked ? "Show picture" : face.heldPicks === 1 ? "Show the pick" : `Show the ${face.heldPicks} picks`;
  face.hint.style.display = !pic && !ready ? "" : "none";
  face.hint.textContent = !linked ? placeholderText(false, "an image") : "Connect SAM 3 to pick from the picture: MODEL and CLIP from its Load Checkpoint";
  syncTools(face);
  syncLooking(face);
}

function setNote(face, text, { life = 0 } = {}) {
  clearTimeout(face.noteTimer);
  face.noteEl.textContent = text;
  face.noteEl.classList.toggle("on", Boolean(text));
  if (text && life) face.noteTimer = setTimeout(() => setNote(face, ""), life);
}

// Fit the picture in the stage. The frame is the picture's own rectangle,
// so everything on it shares one set of coordinates.
function layout(face) {
  const pic = face.pic;
  if (!pic) return;
  const width = face.stage.clientWidth;
  const height = face.stage.clientHeight;
  if (!(width > 0 && height > 0)) return;
  const fit = Math.min(width / pic.width, height / pic.height);
  const frameWidth = Math.max(1, Math.round(pic.width * fit));
  const frameHeight = Math.max(1, Math.round(pic.height * fit));
  Object.assign(face.frame.style, {
    left: `${Math.round((width - frameWidth) / 2)}px`,
    top: `${Math.round((height - frameHeight) / 2)}px`,
    width: `${frameWidth}px`,
    height: `${frameHeight}px`,
  });
  // How many screen pixels one picture pixel is drawn at, for marks that
  // should stay the same size on screen.
  face.zoom = fit;
}

// ---- taking what a run sent ------------------------------------------------

// Put a picture on the stage. Returns whether it is a new one.
function adopt(face, entry) {
  if (face.pic === entry) return false;
  const before = face.pic;
  face.pic = entry;
  face.img.src = entry.image.src;
  face.ink.setAttribute("viewBox", `0 0 ${entry.width} ${entry.height}`);
  face.hover = -1;
  face.hoverMask = null;
  face.rim = null;
  face.stroke = null;
  face.share = 0;
  // A picture the node only confirms (same size, picks kept) keeps its
  // history; any other picture starts a new one.
  if (!(before?.provisional && before.width === entry.width && before.height === entry.height)) {
    face.past = [];
    face.active = 0;
    face.fresh = 0;
  }
  face.hoverChip = 0;
  face.chipAreas = null;
  face.adjust = null;
  face.choice = null;
  layout(face);
  return true;
}

function show(face, entry, note, answered, { restored = false, own = false, interim = false, areas = null } = {}) {
  const before = face.pic;
  adopt(face, entry);
  readItems(face);
  let items = face.items;
  let mine = Boolean(answered) && note.stamp === face.stamp;
  // The areas are numbered by the touches the note answers: these ones.
  if (mine && areas) {
    areas.items.forEach((at, number) => {
      const mask = items[at] ? pieceMask(areas.planes, number) : null;
      if (mask) keepArea(entry, areaKey(items[at]), mask);
    });
  }
  face.itemNotes = mine && Array.isArray(note.items) && note.items.length === items.length ? note.items : null;
  let rewrite = false;
  // Touches made before the node had said which picture it has (on a
  // loader's picture, or typed by hand) carry no key. They belong to this
  // picture if it is the size they were made on, and get its key now.
  if (face.keyless) {
    rewrite = true;
    if (before?.provisional && (before.width !== entry.width || before.height !== entry.height)) {
      items = [];
      mine = false;
      face.itemNotes = null;
      setNote(face, "The picture changed size on its way here. Pick again.", { life: 6000 });
    }
  }
  // A tap that found nothing did nothing. Take it out again, so Undo never
  // steps over something that cannot be seen.
  if (face.itemNotes) {
    const notes = face.itemNotes;
    const empty = (item, index) => ["tap", "all", "subject", "background"].includes(item.t) && notes[index]?.as === "none";
    // A pick swapped for "this spot" where SAM 3 then finds nothing must not
    // vanish: it goes back to what it was, and that spot is no choice any more.
    const choice = face.choice;
    const swappedAway = choice && choice.pic === entry && choice.last !== undefined && choice.last !== choice.current
      && choice.count === 1 && choice.start < items.length && empty(items[choice.start], choice.start)
      && sameTouches([items[choice.start]], choice.candidates[choice.current].items);
    if (swappedAway) {
      const before = choice.candidates[choice.last];
      const candidates = choice.candidates.filter((_, index) => index !== choice.current);
      items = [...items.slice(0, choice.start), ...placed(face, before.items, [items[choice.start]]), ...items.slice(choice.start + 1)];
      // The answer was for the touches with the empty spot in them.
      face.itemNotes = null;
      mine = false;
      rewrite = true;
      // The swap was no step if it changed nothing in the end.
      const last = face.past[face.past.length - 1];
      const undone = Boolean(choice.reopened && last && sameTouches(last, items));
      if (undone) face.past.pop();
      face.choice = candidates.length > 1
        ? { ...choice, candidates, current: candidates.indexOf(before), count: before.items.length, last: undefined, stepped: undone ? false : choice.stepped }
        : null;
      setNote(face, "Nothing found at that spot. The pick is as it was.", { life: 2800 });
    }
    // A touch that takes away and took nothing (nothing of it was picked)
    // goes the same way: the node says so for the ones the face cannot see.
    const idle = (item, index) => item.op === 0 && notes[index]?.did === false;
    const lost = face.itemNotes ? items.find((item, index) => empty(item, index) || idle(item, index)) : undefined;
    const kept = face.itemNotes ? items.filter((item, index) => !empty(item, index) && !idle(item, index)) : items;
    if (kept.length !== items.length) {
      // Whether the node found the thing at all: then it only took nothing.
      const found = notes[items.indexOf(lost)]?.as !== "none";
      face.itemNotes = notes.filter((_, index) => kept.includes(items[index]));
      items = kept;
      rewrite = true;
      // The step that added it is no step any more.
      const last = face.past[face.past.length - 1];
      if (last && JSON.stringify(last) === JSON.stringify(kept)) face.past.pop();
      const whole = lost.t === "subject" || lost.t === "background";
      // Without its model the subject cannot be asked for: the node says what is missing.
      const why = found ? NOTHING_THERE : whole ? (typeof note.fine?.trouble === "string" && note.fine.trouble) || `No ${lost.t} found in this picture.` : "";
      setNote(face, why || (lost.t === "all" ? `Nothing called "${lost.w}" found in this picture.` : "Nothing found there."), { life: found ? 2600 : whole ? 12000 : lost.t === "all" ? 4000 : 2200 });
    }
  }
  if (rewrite) {
    const text = encodeTouches(entry.key, items);
    if (mine) remember(entry, stampOf(text), answered);
    const notes = face.itemNotes;
    writeTouches(face, text);
    readItems(face);
    face.itemNotes = notes;
  }
  if (face.other) setNote(face, OTHER_PICTURE, { life: 6000 });
  if (face.shownPieces !== entry.piecesTag) {
    face.shownPieces = entry.piecesTag;
    face.hover = -1;
    face.hoverMask = null;
  }
  resolve(face);
  syncState(face);
  refreshHover(face);
  draw(face);
  drawInk(face);
  wantFine(face);
  if (restored) return;
  const waited = settlePending(face);
  // More is on its way (the look goes on, or a run sent behind it): what to
  // ask next is decided when the last of it is in.
  if (interim || face.inFlight) return;
  if (waited) {
    face.wanted = null;
    return;
  }
  // What to ask next, if anything: a touch still waits for SAM 3, or the
  // picture has pieces left to find. A run that was wanted while this one
  // was on its way is only needed if one of the two is still true.
  const wanted = face.wanted;
  face.wanted = null;
  if (!face.exact) {
    if (face.retries < RETRIES) {
      face.retries += 1;
      requestRun(face, "look");
    }
  } else if ((own || wanted === "scope") && wantsScope(face)) {
    requestRun(face, "scope");
  }
}

// `restored` is a note the page kept from an earlier run (a tab switch, an
// undo): it is shown, but it never starts a run of its own.
async function takeNote(face, note, { restored = false, interim = false } = {}) {
  // A result of this node is here: the run it asked for (or another run of
  // the workflow) is over. `interim` is what a look has found so far, sent
  // while it is still running: nothing is over yet.
  const sent = !restored && !interim ? face.flying.shift() ?? null : null;
  const own = Boolean(sent);
  if (!restored && !interim) face.inFlight = face.flying.length > 0;
  if (interim && !face.flying.length) return;
  if (!validNote(note)) {
    if (!restored && !interim) dropPending(face);
    syncState(face);
    return;
  }
  // The loader was given another file after this run was asked for: the
  // picture in the note is the old one.
  if ((own && sent.epoch !== face.sourceEpoch) || (interim && face.flying[0].epoch !== face.sourceEpoch)) {
    if (interim) return;
    face.wanted = null;
    syncState(face);
    if (!face.exact && !face.inFlight) requestRun(face, "look");
    return;
  }
  const turn = ++face.turn;
  const sentStamp = sent?.stamp ?? "";
  const entry = pictureFor(note);
  // How many looks at this picture have come back, and how far through its
  // list of words the node is: an early click waits for the words.
  if (own && sent.ask === "scope") entry.looks = (entry.looks ?? 0) + 1;
  const words = note.pieces?.words;
  if (Array.isArray(words) && words.length === 2) {
    entry.words = [Number(words[0]) || 0, Number(words[1]) || 0];
    entry.wordsDone = entry.words[1] > 0 && entry.words[0] >= entry.words[1];
  }
  const jobs = [];
  if (!entry.image || entry.file !== note.picture.filename) {
    jobs.push(loadImage(viewUrl(note.picture, note.key)).then((image) => {
      entry.image = image;
      entry.file = note.picture.filename;
    }));
  }
  if (note.pieces && typeof note.pieces === "object" && piecesTag(note.pieces) !== entry.piecesTag) {
    jobs.push(loadPieces(entry, note.pieces));
  } else if (note.pieces && typeof note.pieces === "object") {
    entry.scoped = note.pieces.more !== true;
  }
  // Which touches the picked area in this note answers: the server stamps
  // them; an older server did not, so then it is what this face last sent.
  const stamp = typeof note.stamp === "string" && note.stamp ? note.stamp : own ? sentStamp : "";
  let answered = null;
  if (stamp) {
    if (isFile(note.selection)) {
      jobs.push(loadImage(viewUrl(note.selection, `${note.key}-${stamp}`)).then((image) => {
        answered = readSelection(readPixels(image, entry.pw, entry.ph));
      }));
    } else {
      answered = new Uint8Array(entry.pw * entry.ph);
    }
  }
  // Each picked thing's own area, when the node sent them: what tells the
  // face which chip a brush mark touches. Lost files only cost that.
  let areas = null;
  if (stamp && Array.isArray(note.areas?.items) && Array.isArray(note.areas?.planes)) {
    const files = note.areas.planes.filter(isFile);
    jobs.push(Promise.all(files.map((file) => loadImage(viewUrl(file, `${note.key}-${stamp}-areas`)))).then((images) => {
      areas = { planes: packPlanes(images.map((image) => readPixels(image, entry.pw, entry.ph)), entry.pw, entry.ph), items: note.areas.items };
    }, () => {}));
  }
  // The fine edge, when the node made one: the cut-out's colours with the
  // mask as their see-through channel. A lost file only costs the fine look.
  let fine = null;
  if (stamp && isFile(note.fine?.file) && typeof note.fine.made === "string") {
    jobs.push(loadImage(viewUrl(note.fine.file, `${note.key}-${stamp}-fine`)).then((image) => {
      const colours = readPixels(image, entry.pw, entry.ph).slice();
      fine = { stamp, made: note.fine.made, colours, mask: fineMask(colours) };
    }, () => {}));
  }
  try {
    await Promise.all(jobs);
  } catch {
    if (!face.alive || turn !== face.turn) return;
    if (restored) {
      // A kept note whose files are gone (ComfyUI was restarted) is no
      // loss: fall back to what the loader shows.
      face.sourceUrl = "";
      syncState(face);
    } else {
      setNote(face, "The picture did not load. Run the node again.");
      if (!interim) settle(face);
    }
    return;
  }
  if (answered) remember(entry, stamp, answered);
  if (fine) entry.fine = fine;
  if (typeof note.fine?.trouble === "string" && note.fine.trouble) {
    // The node could not make it, and says why. The plain edge is shown.
    const now = settings(face);
    entry.fineTrouble = `${stamp}|${fineMade(now)}`;
    if (!restored) setNote(face, note.fine.trouble, { life: 12000 });
  }
  if (!face.alive || turn !== face.turn || !entry.image) return;
  show(face, entry, { ...note, stamp }, answered, { restored, own, interim, areas });
}

// ---- the pointer -----------------------------------------------------------

function pointOf(face, event) {
  const rect = face.frame.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return null;
  const x = ((event.clientX - rect.left) / rect.width) * face.pic.width;
  const y = ((event.clientY - rect.top) / rect.height) * face.pic.height;
  return [clamp(x, 0, face.pic.width - 1), clamp(y, 0, face.pic.height - 1)];
}

function pieceUnder(face, point, adding) {
  const pic = face.pic;
  if (!pic?.pieces || !point) return -1;
  const x = clamp(Math.floor(point[0] * pic.scale), 0, pic.pw - 1);
  const y = clamp(Math.floor(point[1] * pic.scale), 0, pic.ph - 1);
  return pieceAt(pic.pieces.planes, y * pic.pw + x, { sizes: pic.pieces.sizes, inside: face.inside, adding, ranks: pic.pieces.ranks });
}

// The pixel of the small copy under a point of the picture.
function pixelOf(pic, point) {
  const x = clamp(Math.floor(point[0] * pic.scale), 0, pic.pw - 1);
  const y = clamp(Math.floor(point[1] * pic.scale), 0, pic.ph - 1);
  return y * pic.pw + x;
}

// ---- one pick, several things it could mean -------------------------------
//
// A click or a stroke can mean more than one thing: the jacket or the person
// wearing it, the thing under a stroke or the paint itself. The face takes
// the likeliest and keeps the others as a "choice": the arrows beside the
// readout swap the pick for the next one at the same spot.

// A candidate as it is kept: what it is called beside the arrows, and the
// touch (or touches, for a pair) it stands for. Worked out when the pick is
// made, so the pieces may change afterwards (the picture is still being
// looked at) without the choice going stale.
function settled(pic, candidate, op) {
  const one = (piece) => {
    const entry = pic.pieces.list[piece];
    if (entry.kind !== "name") return { t: "tap", op, x: entry.x, y: entry.y };
    // A word that was not shown stays unsaid: the pick carries it, marked quiet.
    return entry.label ? { t: "name", op, w: entry.name, x: entry.x, y: entry.y } : { t: "name", op, w: entry.name, x: entry.x, y: entry.y, q: 1 };
  };
  const called = (piece) => pic.pieces.list[piece]?.label || "thing";
  if (candidate.kind === "piece") return { label: called(candidate.piece), items: [one(candidate.piece)] };
  if (candidate.kind === "pair") return { label: candidate.pieces.map(called).join(" + "), items: candidate.pieces.map(one) };
  if (candidate.kind === "spot") return { label: "this spot", items: [{ t: "tap", op, x: candidate.x, y: candidate.y }] };
  return { label: candidate.item.t === "find" ? "what the stroke finds" : "your paint", items: [{ ...candidate.item, op }] };
}

// Make a pick from a list of candidates, taking number `current`.
function pick(face, list, current, op) {
  const pic = face.pic;
  const candidates = list.map((candidate) => settled(pic, candidate, op));
  const items = placed(face, candidates[current].items);
  if (!items.every((item, index) => touchFits([...face.items, ...items.slice(0, index)], item))) {
    showToast({ detail: "This node holds no more touches. Press Clear, or Undo a few.", severity: "warn", summary: "Mask by Touch" });
    return false;
  }
  const start = face.items.length;
  const rim = face.rim;
  change(face, [...face.items, ...items]);
  face.rim = rim;
  face.choice = candidates.length > 1 ? { candidates, current, start, count: items.length, op, pic } : null;
  syncReadout(face);
  return true;
}

// Whether the choice still stands for touches that are there: the picture is
// the same, nothing waits, and the touches at its place are the ones it last
// wrote. Anything else that changed the touches has made it stale.
function choiceLive(face) {
  const choice = face.choice;
  if (!choice || !face.pic || choice.pic !== face.pic || face.held || face.pending.length) return false;
  const here = face.items.slice(choice.start, choice.start + choice.count);
  return here.length === choice.count && sameTouches(here, choice.candidates[choice.current].items);
}

// Swap a pick for the next (or the one before) of its candidates: the newest
// pick, or the one whose chip was opened. The touches after it stay.
function swap(face, step) {
  const choice = face.choice;
  if (!choiceLive(face)) return;
  const next = (choice.current + step + choice.candidates.length) % choice.candidates.length;
  // The pick keeps its chip, so what was painted onto it stays with it.
  const items = placed(face, choice.candidates[next].items, face.items.slice(choice.start, choice.start + choice.count));
  const kept = face.items.slice(0, choice.start);
  const rest = face.items.slice(choice.start + choice.count);
  if (!items.every((item, index) => touchFits([...kept, ...rest, ...items.slice(0, index)], item))) return;
  face.rim = null;
  // A new pick and its swaps are one step for Undo, which takes the pick
  // away whatever it ended up as. Swapping an older pick from its chip is a
  // step of its own, once for as long as the chip stays open.
  if (choice.reopened && !choice.stepped) {
    face.past.push(face.items);
    if (face.past.length > PAST_KEPT) face.past.shift();
  }
  face.items = [...kept, ...items, ...rest];
  commit(face);
  face.choice = { ...choice, current: next, count: items.length, stepped: true, last: choice.current };
  syncReadout(face);
  syncTools(face);
}

// Everything a stroke in Pick could mean: the named thing it lies in, a pair
// it crosses, what SAM 3 finds along it; the paint itself is always last.
function strokeCandidates(pic, op, radius, pts) {
  const find = { t: "find", op, r: radius, pts };
  const paint = { t: "paint", op, r: radius, pts };
  const candidates = [];
  if (pic.pieces) {
    const area = paintStroke(new Uint8Array(pic.pw * pic.ph), pic.pw, pic.ph, pts.map((pair) => [pair[0] * pic.scale, pair[1] * pic.scale]), radius * pic.scale, 1);
    const found = strokePieces(pic.pieces.planes, pic.pieces.list, pic.pieces.sizes, pic.pw * pic.ph, area, pic.pieces.ranks, pic.pieces.wholes);
    for (const piece of found.candidates) candidates.push({ kind: "piece", piece });
    if (found.pair) candidates.splice(found.pairAt, 0, { kind: "pair", pieces: found.pair });
  }
  candidates.push({ kind: "item", item: find }, { kind: "item", item: paint });
  return candidates;
}

// What the pick at `index` could have meant, worked out again from where it
// was made: every piece at its spot for a click, the stroke's own list for a
// stroke. Null for a touch that has no other meaning (paint, a typed name).
function candidatesOf(face, index) {
  const pic = face.pic;
  const item = face.items[index];
  if (!pic?.pieces || !item) return null;
  if (item.t === "name" || item.t === "tap") {
    const pieces = candidatesAt(pic.pieces.planes, pixelOf(pic, [item.x, item.y]), pic.pieces.ranks);
    const list = pieces.map((piece) => ({ kind: "piece", piece }));
    if (!pieces.some((piece) => pic.pieces.list[piece].kind === "point")) list.push({ kind: "spot", x: item.x, y: item.y });
    return list;
  }
  if (item.t === "find") return strokeCandidates(pic, item.op, item.r, item.pts);
  return null;
}

// The arrows for the pick at `index`: the other things at its spot, as for
// a pick that was just made. No arrows when it has no other meaning.
function openChoice(face, index) {
  const item = face.items[index];
  const candidates = item && face.pic ? (candidatesOf(face, index) ?? []).map((candidate) => settled(face.pic, candidate, item.op)) : [];
  const current = candidates.findIndex((candidate) => sameTouches(candidate.items, [item]));
  face.choice = candidates.length < 2 || current < 0
    ? null
    : { candidates, current, start: index, count: 1, op: item.op, pic: face.pic, reopened: true, stepped: false };
}

function setHover(face, piece, away = false) {
  if (face.hover === piece && face.hoverAway === away) return;
  face.hover = piece;
  face.hoverAway = away;
  face.hoverMask = null;
  if (face.pic) {
    paintLit(face);
    syncReadout(face);
  }
  syncTag(face);
}

function refreshHover(face) {
  if (!face.pic || !face.snap || face.stroke || face.adjust || !face.pointer || face.quietAt) {
    setHover(face, -1);
    return;
  }
  const adding = !face.away;
  setHover(face, pieceUnder(face, face.pointer, adding), !adding);
}

// Every change to the touches goes through here, so each one can be taken
// back: a click, a stroke, and Clear too.
const PAST_KEPT = 200;

function change(face, items) {
  face.past.push(face.items);
  if (face.past.length > PAST_KEPT) face.past.shift();
  face.rim = null;
  face.choice = null;
  face.items = items;
  commit(face);
}

const FULL = "This node holds no more touches. Press Clear, or Undo a few.";

function addItem(face, item) {
  // A touch that adds gets a chip of its own, unless it came with one.
  const own = item.op === 1 && !item.g ? placed(face, [item])[0] : item;
  if (!touchFits(face.items, own)) {
    showToast({ detail: FULL, severity: "warn", summary: "Mask by Touch" });
    return;
  }
  const rim = face.rim;
  change(face, [...face.items, own]);
  face.rim = rim;
  face.choice = null;
}

// ---- the brush: Paint and Erase ---------------------------------------------
//
// A brush mark is used exactly as it is drawn. One that erases rubs out
// whatever is picked under it, and is not kept when nothing is. One that
// paints joins a chip: the selected one; else the area it touches; else the
// newest area that was painted, so loose paint shares one chip.

function chipFor(face, area) {
  const pic = face.pic;
  const chips = chipGroups(face.items).filter((chip) => !chip.away);
  if (face.active) {
    if (face.active === face.fresh) return { g: face.fresh };
    const chosen = chips.find((chip) => chipId(chip) === face.active);
    if (chosen) return { chip: chosen };
  }
  if (chips.length && face.raw) {
    // "Touches" is a pixel or two of room: paint right beside an area joins it.
    const near = growMask(hardMask(area), pic.pw, pic.ph, TOUCH_REACH);
    if (sharedPixels(near, face.raw) > 0) {
      // The chip it shares the most with, the newest on a tie.
      let best = null;
      let most = 0;
      for (const chip of chips) {
        const shared = sharedPixels(near, chipArea(face, chip));
        if (shared > 0 && shared >= most) { best = chip; most = shared; }
      }
      if (best) return { chip: best };
    }
  }
  const loose = chips.filter((chip) => chip.paint).pop();
  return loose ? { chip: loose } : { g: nextGroup(face.items) };
}

function addMark(face, mark) {
  const pic = face.pic;
  const area = localMask(pic, mark);
  if (mark.op === 0) {
    if (face.exact && !meets(area, face.raw)) {
      setNote(face, "Nothing is picked there to erase.", { life: 1800 });
      return;
    }
    addItem(face, mark);
    return;
  }
  const target = chipFor(face, area);
  // A chip whose touches were saved without a number gets one now.
  const numbered = target.chip ? numberChip(face.items, target.chip, face.fresh) : { items: face.items, g: target.g };
  const own = { ...mark, g: numbered.g };
  if (!touchFits(numbered.items, own)) {
    showToast({ detail: FULL, severity: "warn", summary: "Mask by Touch" });
    return;
  }
  const selected = Boolean(face.active) && (face.active === face.fresh || (target.chip && face.active === chipId(target.chip)));
  change(face, [...numbered.items, own]);
  if (face.fresh === numbered.g) face.fresh = 0;
  if (selected) {
    // Still selected, under the number it has now, with its arrows.
    face.active = numbered.g;
    const chip = chipGroups(face.items).find((other) => other.g === numbered.g);
    if (chip) openChoice(face, chip.first);
    face.chipsShown = null;
    syncReadout(face);
  }
}

function undo(face) {
  if (!face.pic || face.held) return;
  // A click that still waits for the look is the last thing that happened.
  if (face.pending.length) {
    face.pending = face.pending.slice(0, -1);
    drawInk(face);
    syncReadout(face);
    syncTools(face);
    return;
  }
  // Touches that came with the workflow have no history: take the last off.
  const before = face.past.length ? face.past.pop() : face.items.length ? face.items.slice(0, -1) : null;
  if (!before) return;
  face.rim = null;
  face.choice = null;
  face.items = before;
  commit(face);
  refreshHover(face);
}

// A click in Pick: every piece at the spot, in the order they are offered;
// the pick is the first that still changes something. The spot itself (what
// SAM 3 finds right there) is offered last when no piece came from a point.
function pickAt(face, x, y, op) {
  const pic = face.pic;
  const spot = { kind: "spot", x: Math.round(x), y: Math.round(y) };
  const pieces = pic.pieces ? candidatesAt(pic.pieces.planes, pixelOf(pic, [x, y]), pic.pieces.ranks) : [];
  const candidates = pieces.map((piece) => ({ kind: "piece", piece }));
  if (!pieces.some((piece) => pic.pieces.list[piece].kind === "point")) candidates.push(spot);
  // Nothing at the spot would change anything (all of it is picked already,
  // or there is nothing picked to take away): the spot itself is asked,
  // when it is on offer.
  const lit = pieceUnder(face, [x, y], op === 1);
  if (op === 0) {
    if (lit >= 0) {
      // The thing is a pick of its own: it is un-picked, chip and all.
      const chip = chipOfThing(face, settled(pic, { kind: "piece", piece: lit }, 1).items[0]);
      if (chip) {
        removeChip(face, chip);
        return;
      }
    } else if (face.exact && !(face.raw?.[pixelOf(pic, [x, y])] > 0)) {
      // Nothing is picked there: nothing to take away, and nothing is kept.
      setNote(face, NOTHING_THERE, { life: 1800 });
      return;
    }
  }
  if (op === 1 && lit >= 0) {
    // The thing was taken away as it is: it is put back, and no chip is left.
    const taken = chipOfThing(face, settled(pic, { kind: "piece", piece: lit }, 0).items[0], true);
    if (taken) {
      removeChip(face, taken);
      return;
    }
  }
  const current = lit >= 0 ? pieces.indexOf(lit) : candidates.indexOf(spot);
  if (current >= 0) pick(face, candidates, current, op);
  else if (op === 0) setNote(face, "No whole thing to take away here. Erase rubs it out with the brush.", { life: 2800 });
}

// ---- a click that waits for the first look --------------------------------
//
// A click on a picture that has not been looked at yet would only get what
// SAM 3 finds at that one point: the whole person for a click on a jacket.
// So a click on a spot where NOTHING is lit yet waits. The picture is looked
// at, starting at the click, and the pick is made from what the looks find:
// as soon as a thing with a name lies under the click, and after
// PENDING_LOOKS looks at the latest (three looks ask every word of the list
// on most pictures).
// A click on a thing that IS lit never waits: what lights up is what a click
// takes (pickAt takes the lit piece), also while the looking goes on.
// One click waits at a time; the picture says that it does (syncLooking).
const PENDING_LOOKS = 3;
// A click is never kept waiting longer than this: a first look that also
// loads SAM 3 takes about 25 seconds.
const PENDING_MS = 45000;
// A click taken this close to one that waits (on the screen copy) answers it.
const PENDING_SAME = 24;

// Whether the thing a click at this spot would take is one SAM 3 is sure of
// by name. The person as a whole and a backdrop do not count: they lie under
// nearly every click, and the jacket or the headphones may still be on the
// way.
function namedAt(pic, x, y) {
  if (!pic?.pieces) return false;
  const { planes, list, sizes, ranks } = pic.pieces;
  const first = candidatesAt(planes, pixelOf(pic, [x, y]), ranks)[0];
  if (first === undefined) return false;
  const piece = list[first];
  const backdrop = (sizes[first] ?? 0) / (pic.pw * pic.ph) > BACKDROP;
  return piece.kind === "name" && piece.sure >= SURE && !backdrop && piece.name !== "person";
}

// Whether the looks so far are all a click on this picture gets.
function lookedEnough(pic) {
  if (pic.scoped || pic.wordsDone || pic.scopeAsks >= SCOPE_ROUNDS) return true;
  return !pic.words && (pic.looks ?? 0) >= PENDING_LOOKS;
}

// Whether a click on the picture would have to wait: the node has not
// looked at it enough to say what is where.
function notReady(face) {
  const pic = face.pic;
  if (!pic || face.held || lookedEnough(pic)) return false;
  return Boolean(upstreamNode(face.node, "model")) && Boolean(upstreamNode(face.node, "clip"));
}

// The picture says that it is still being looked at, and how far along that
// is, so nobody wonders why nothing lights up or where a click went.
function syncLooking(face) {
  const waits = face.pending.length > 0;
  const paused = Boolean(face.pic?.paused) && !face.inFlight;
  const on = notReady(face) && (face.inFlight || waits || paused);
  const pill = face.lookPill;
  pill.style.display = on ? "" : "none";
  if (!on) return;
  // How far along the look is, as the button's fill and as numbers.
  const words = face.pic.words;
  const total = words?.[1] > 0 ? words[1] : 0;
  const done = total ? Math.min(words[0], total) : 0;
  pill.classList.toggle("paused", paused);
  pill.style.setProperty("--done", `${total ? Math.round((done / total) * 100) : 0}%`);
  face.lookIcon.textContent = paused ? "\u25b6" : "\u275a\u275a";
  face.lookWord.textContent = paused ? "Paused" : "Looking";
  face.lookCount.textContent = total ? `${done}/${total}` : "\u2026";
  const far = total ? ` ${done} of ${total}` : "";
  pill.title = paused
    ? `Paused at${far || " the start"}. What is lit can still be picked. Click to look on.`
    : waits
      ? `Looking at the picture${far ? `:${far}` : ""}. Your click is taken as soon as the node has found the thing there. Click to pause.`
      : `Looking at the picture${far ? `:${far}` : ""}. What is lit can be picked already, and more lights up as it goes. Click to pause: what is lit stays.`;
}

// Stop looking at this picture for now, or look on. A pause holds until
// Resume, a click where nothing is lit yet, or Show picture.
function pauseLook(face) {
  const pic = face.pic;
  if (!pic) return;
  pic.paused = true;
  clearTimeout(face.dwell);
  dropPending(face);
  face.wanted = null;
  syncLooking(face);
  Promise.resolve(face.host.stopLook?.()).finally(() => {
    if (!face.alive) return;
    // A look taken out of the queue never answers: stop waiting for it.
    if (face.flying.every((run) => run.ask === "scope")) settle(face);
    syncLooking(face);
  });
}

function resumeLook(face) {
  const pic = face.pic;
  if (!pic) return;
  pic.paused = false;
  face.retries = 0;
  if (wantsScope(face)) requestRun(face, "scope");
  syncLooking(face);
}

// A click that was not taken: the message on the picture answers it.
function nudge(face) {
  const chip = face.lookPill;
  chip.classList.remove("nudge");
  void chip.offsetWidth;
  chip.classList.add("nudge");
}

function waitForLook(face, x, y) {
  const pic = face.pic;
  if (!pic || lookedEnough(pic)) return false;
  // A click where nothing is lit yet means: look on.
  if (pic.paused && pieceUnder(face, [x, y], true) < 0) pic.paused = false;
  if (!upstreamNode(face.node, "model") || !upstreamNode(face.node, "clip")) return false;
  // A thing is lit under the pointer: it is taken now, whatever else is
  // still on its way. A click that waited at this spot is answered by it.
  if (pieceUnder(face, [x, y], true) >= 0) {
    const far = (click) => Math.hypot(click.x - x, click.y - y) * pic.scale >= PENDING_SAME;
    if (!face.pending.every(far)) {
      face.pending = face.pending.filter(far);
      if (!face.pending.length) clearTimeout(face.pendingTimer);
    }
    return false;
  }
  // Nothing is known at this spot yet. One click waits at a time. More of
  // them would be taken one after the other when the look is done, as picks
  // nobody saw being made: three clicks on a shirt came out as the shirt,
  // the person and a third thing.
  if (face.pending.length) {
    nudge(face);
    return true;
  }
  face.pending.push({ x, y, epoch: face.sourceEpoch, width: pic.width, height: pic.height });
  clearTimeout(face.pendingTimer);
  face.pendingTimer = setTimeout(() => { if (face.alive) flushPending(face); }, PENDING_MS);
  face.choice = null;
  syncReadout(face);
  syncTools(face);
  requestRun(face, "scope");
  return true;
}

function dropPending(face) {
  if (!face.pending?.length) return;
  clearTimeout(face.pendingTimer);
  face.pending = [];
  if (face.pic) {
    drawInk(face);
    syncReadout(face);
    syncTools(face);
  }
}

// Take every click that waits, now, with what is known of the picture.
function flushPending(face) {
  const pic = face.pic;
  const clicks = face.pending;
  if (!clicks.length) return;
  clearTimeout(face.pendingTimer);
  face.pending = [];
  for (const click of clicks) {
    if (pic && click.epoch === face.sourceEpoch && click.width === pic.width && click.height === pic.height) pickAt(face, click.x, click.y, 1);
  }
  drawInk(face);
  syncReadout(face);
  syncTools(face);
}

// A look came back. True when the clicks that waited were dealt with here:
// taken, or another look asked for.
function settlePending(face) {
  const pic = face.pic;
  if (!face.pending.length) return false;
  if (!pic || face.pending.some((click) => click.epoch !== face.sourceEpoch || click.width !== pic.width || click.height !== pic.height)) {
    dropPending(face);
    return false;
  }
  if (!lookedEnough(pic) && !face.pending.every((click) => namedAt(pic, click.x, click.y))) {
    requestRun(face, "scope");
    return true;
  }
  flushPending(face);
  // The looking goes on behind the pick, so the next thing lights up at once.
  if (!face.inFlight && face.exact && wantsScope(face)) requestRun(face, "scope");
  return true;
}

function finishStroke(face, event, cancelled) {
  const stroke = face.stroke;
  if (!stroke || (event && event.pointerId !== stroke.id)) return;
  face.stroke = null;
  try { face.frame.releasePointerCapture?.(stroke.id); } catch { /* already released */ }
  if (cancelled || !face.pic) {
    drawInk(face);
    return;
  }
  const op = stroke.away ? 0 : 1;
  const radius = brushRadius(face);
  const [x, y] = stroke.points[0];
  face.rim = null;
  // Nothing lights up under the pointer until it has moved on: a piece
  // lighting at once where the click or the stroke ended would look like
  // part of the pick.
  if (event) face.quietAt = [event.clientX, event.clientY];
  const pic = face.pic;
  const thinned = () => thinStroke(stroke.points, Math.max(1, radius / 6)).map((pair) => [Math.round(pair[0]), Math.round(pair[1])]);
  if (stroke.brush) {
    // Paint or Erase: the mark itself, with the edge the brush has.
    flushPending(face);
    const mark = { t: "paint", op, r: radius, pts: stroke.moved ? thinned() : [[Math.round(x), Math.round(y)]] };
    if (stroke.soft > 0) mark.s = stroke.soft;
    addMark(face, mark);
  } else if (!stroke.moved) {
    if (op === 1 && waitForLook(face, x, y)) {
      refreshHover(face);
      drawInk(face);
      return;
    }
    // What waited before this click comes first, so the touches keep the
    // order they were made in. A click that still waits for the look is
    // left waiting: it is taken when the look has found its thing.
    if (!notReady(face)) flushPending(face);
    pickAt(face, x, y, op);
  } else {
    flushPending(face);
    const pts = thinned();
    const area = () => paintStroke(new Uint8Array(pic.pw * pic.ph), pic.pw, pic.ph, pts.map((pair) => [pair[0] * pic.scale, pair[1] * pic.scale]), radius * pic.scale, 1);
    if (op === 0 && face.exact && !meets(area(), face.raw)) {
      // A stroke that takes away where nothing is picked takes nothing.
      setNote(face, NOTHING_THERE, { life: 1800 });
    } else {
      face.rim = rimOf(pic, { t: "find", op, r: radius, pts });
      pick(face, strokeCandidates(pic, op, radius, pts), 0, op);
    }
  }
  refreshHover(face);
  drawInk(face);
}

// The brush drag is over: keep what it set, or put the brush back.
function finishAdjust(face, event, cancelled) {
  const adjust = face.adjust;
  if (!adjust || (event && event.pointerId !== adjust.id)) return;
  face.adjust = null;
  try { face.frame.releasePointerCapture?.(adjust.id); } catch { /* already released */ }
  if (cancelled) {
    setBrush(face, adjust.size);
    setSoft(face, adjust.soft);
  } else if (brushSize(face) !== adjust.size || brushSoft(face) !== adjust.soft) {
    notifyAusbossChange();
  }
  if (event) face.quietAt = [event.clientX, event.clientY];
  refreshHover(face);
  drawInk(face);
}

function installPointer(face, signal) {
  const frame = face.frame;
  frame.addEventListener("pointerdown", (event) => {
    // The middle button pans the graph, as everywhere else.
    if (!face.pic || (event.button !== 0 && event.button !== 2) || face.stroke || face.adjust) return;
    const point = pointOf(face, event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    try { frame.setPointerCapture?.(event.pointerId); } catch { /* a pointer that is already gone */ }
    clearTimeout(face.dwell);
    face.pointer = point;
    // The rim of the stroke before this one has done its job.
    if (face.rim) {
      face.rim = null;
      paintLit(face);
    }
    // Alt and the right button together set the brush (on a Mac: Control
    // and Option with a click), as on Image Compare A/B.
    if (brushAdjusts(event)) {
      const rect = frame.getBoundingClientRect();
      const brush = { size: brushSize(face), soft: brushSoft(face) };
      face.adjust = {
        id: event.pointerId,
        // The brush as it was, for Escape, and the drag as it goes.
        ...brush,
        drag: startAdjust(event.clientX, event.clientY, brush, BRUSH_SIZE),
        anchor: point,
        // Pixels of the picture under one pixel of the screen.
        perPixel: face.pic.width / Math.max(1, rect.width),
      };
      setHover(face, -1);
      drawInk(face);
      return;
    }
    // Ctrl, or the right button, does the opposite of the chosen tool.
    face.stroke = {
      id: event.pointerId,
      away: (face.tool === "erase") !== brushFlips(event),
      brush: face.tool !== "pick",
      soft: brushSoft(face),
      start: [event.clientX, event.clientY],
      points: [point],
      moved: false,
    };
    drawInk(face);
  }, { signal });
  frame.addEventListener("pointermove", (event) => {
    if (!face.pic) return;
    const point = pointOf(face, event);
    if (!point) return;
    face.pointer = point;
    const adjust = face.adjust;
    if (adjust && event.pointerId === adjust.id) {
      adjust.drag = moveAdjust(adjust.drag, event.clientX, event.clientY, adjust.perPixel);
      setBrush(face, adjust.drag.brush.size);
      setSoft(face, adjust.drag.brush.soft);
      drawInk(face);
      return;
    }
    face.flipKey = event.ctrlKey;
    syncAway(face);
    if (face.quietAt && Math.hypot(event.clientX - face.quietAt[0], event.clientY - face.quietAt[1]) > 6) face.quietAt = null;
    const stroke = face.stroke;
    if (stroke && event.pointerId === stroke.id) {
      if (!stroke.moved && Math.hypot(event.clientX - stroke.start[0], event.clientY - stroke.start[1]) > 4) {
        stroke.moved = true;
        setHover(face, -1);
      }
      if (stroke.moved) extendStroke(stroke.points, point[0], point[1], Math.max(1, brushRadius(face) / 5));
    } else {
      refreshHover(face);
      armDwell(face);
    }
    drawInk(face);
  }, { signal });
  frame.addEventListener("pointerup", (event) => { finishStroke(face, event, false); finishAdjust(face, event, false); }, { signal });
  frame.addEventListener("pointercancel", (event) => { finishStroke(face, event, true); finishAdjust(face, event, true); }, { signal });
  // The keys work while the pointer is anywhere on the node's panel: they
  // are listened to from when it comes onto the panel until it is off it.
  face.root.addEventListener("pointerenter", () => {
    // A look that was skipped while the node was switched off.
    if (face.lookMissed && !face.host.switchedOff?.()) {
      face.lookMissed = false;
      showOwnPicture(face);
    }
    if (face.keys) return;
    face.keys = new AbortController();
    const options = { signal: face.keys.signal, capture: true };
    window.addEventListener("keydown", (event) => onKey(face, event, true), options);
    window.addEventListener("keyup", (event) => onKey(face, event, false), options);
    window.addEventListener("pointermove", (event) => {
      if (face.stroke || face.adjust) return;
      const box = face.root.getBoundingClientRect();
      if (event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom) return;
      face.keys?.abort();
      face.keys = null;
    }, { signal: face.keys.signal, passive: true });
  }, { signal });
  frame.addEventListener("pointerleave", () => {
    clearTimeout(face.dwell);
    if (face.stroke || face.adjust) return;
    face.pointer = null;
    face.flipKey = false;
    syncAway(face);
    setHover(face, -1);
    drawInk(face);
  }, { signal });
  frame.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
  }, { signal });
  signal.addEventListener("abort", () => face.keys?.abort());
}

// Whether a press takes away right now: Erase is chosen, or Ctrl is held and
// does the opposite of the chosen tool for as long as it is down.
function syncAway(face) {
  const away = (face.tool === "erase") !== Boolean(face.flipKey);
  if (away === face.away) return;
  face.away = away;
  syncTools(face);
  refreshHover(face);
}

function onKey(face, event, down) {
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
  // Alt is the brush drag's key. Kept from the browser, which would open
  // its menu on it.
  if (event.key === "Alt") {
    event.preventDefault();
    return;
  }
  if (event.key === "Control") {
    face.flipKey = down;
    syncAway(face);
    drawInk(face);
    return;
  }
  // Ctrl+Z and Ctrl+Y stay ComfyUI's own: every pick is a change to the
  // graph, so its undo takes picks back too.
  if (!down || event.ctrlKey || event.metaKey) return;
  if (event.key === "Escape" && (face.stroke || face.adjust)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    finishStroke(face, null, true);
    finishAdjust(face, null, true);
    return;
  }
  // Esc lets go of a selected chip.
  if (event.key === "Escape" && face.active) {
    event.preventDefault();
    event.stopImmediatePropagation();
    letGo(face);
    return;
  }
  // [ and ] for the size, with Shift for the edge, as in Photoshop.
  const key = brushKey(event);
  if (key) {
    event.preventDefault();
    event.stopPropagation();
    if (key.what === "soft") setSoft(face, steppedSoft(brushSoft(face), key.up));
    else setBrush(face, steppedBrushSize(brushSize(face), key.up, BRUSH_SIZE));
    notifyAusbossChange();
    return;
  }
  // W, B and E pick the tool, as in Photoshop. Not in the middle of a stroke.
  const tool = toolKey(event);
  if (tool && !face.stroke && !face.adjust && face.pic) {
    event.preventDefault();
    event.stopPropagation();
    setTool(face, tool);
  }
}

function setBrush(face, size) {
  const next = clamp(Math.round(size / 2) * 2, BRUSH_SIZE[0], BRUSH_SIZE[1]);
  face.node.properties ??= {};
  if (face.node.properties[BRUSH_PROPERTY] === next) return;
  face.node.properties[BRUSH_PROPERTY] = next;
  face.size.set(next);
  paintSwatch(face);
  drawInk(face);
}

function setSoft(face, soft) {
  const next = clampSoft(soft, 0);
  face.node.properties ??= {};
  if (face.node.properties[SOFT_PROPERTY] === next) return;
  // A hard brush is what a node has until it is told otherwise.
  if (next === 0 && face.node.properties[SOFT_PROPERTY] === undefined) return;
  face.node.properties[SOFT_PROPERTY] = next;
  face.softBox.set(next);
  paintSwatch(face);
  drawInk(face);
}

// Pick takes whole things; Paint and Erase are the brush.
function setTool(face, tool) {
  if (!TOOLS.includes(tool)) return;
  face.tool = tool;
  face.snap = tool === "pick";
  setProperty(face, TOOL_PROPERTY, tool);
  setProperty(face, SNAP_PROPERTY, face.snap);
  face.away = (tool === "erase") !== Boolean(face.flipKey);
  syncTools(face);
  paintSwatch(face);
  refreshHover(face);
  drawInk(face);
}

// ---- building it ------------------------------------------------------------

function button(className, text, title, onClick, signal) {
  const element = el("button", className, text);
  element.type = "button";
  element.title = title;
  element.addEventListener("pointerdown", (event) => event.stopPropagation(), { signal });
  element.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  }, { signal });
  return element;
}

function setProperty(face, name, value) {
  face.node.properties ??= {};
  if (face.node.properties[name] === value) return;
  face.node.properties[name] = value;
  notifyAusbossChange();
}

function readProperties(face) {
  const properties = face.node.properties ?? {};
  // A workflow saved before there were three tools kept Pick or Draw.
  const tool = properties[TOOL_PROPERTY];
  face.tool = TOOLS.includes(tool) ? tool : properties[SNAP_PROPERTY] === false ? "paint" : "pick";
  face.snap = face.tool === "pick";
  face.away = (face.tool === "erase") !== Boolean(face.flipKey);
  face.view = VIEWS.includes(properties[VIEW_PROPERTY]) ? properties[VIEW_PROPERTY] : "tint";
}

export function mountTouchStage(node, host) {
  if (node.__ausbossTouch) return node.__ausbossTouch;
  ensureCss();
  const abort = new AbortController();
  const { signal } = abort;

  const root = el("div", "ausboss-touch");
  const tools = el("div", "ausboss-touch-tools");
  const stage = el("div", "ausboss-touch-stage");
  const bar = el("div", "ausboss-touch-bar");
  const chips = el("div", "ausboss-touch-chips");
  const chipList = el("span", "ausboss-touch-chiplist");
  const nameField = el("input", "ausboss-touch-name");
  nameField.type = "text";
  nameField.placeholder = "+ type a name";
  nameField.maxLength = 60;
  nameField.spellcheck = false;
  nameField.title = "Type what to pick, like \"screen\" or \"earring\", and press Enter. Every thing of that name is taken.";
  const newButton = el("button", "ausboss-touch-new", "+ new");
  newButton.type = "button";
  newButton.title = "Start a new area: what you paint next gets a chip of its own, also where it touches another area.";
  chips.append(chipList, newButton, nameField);
  root.append(tools, stage, bar, chips);

  const frame = el("div", "ausboss-touch-frame");
  const img = el("img");
  img.alt = "";
  img.draggable = false;
  const tint = el("canvas", "ausboss-touch-tint");
  const lit = el("canvas", "ausboss-touch-lit");
  const ink = svg("svg", "ausboss-touch-ink");
  ink.setAttribute("preserveAspectRatio", "none");
  const path = svg("path");
  const dots = svg("g");
  const ringBack = svg("circle", "ring-back");
  const ring = svg("circle", "ring");
  path.style.display = "none";
  ringBack.style.display = "none";
  ring.style.display = "none";
  const coreRing = svg("circle", "core");
  coreRing.style.display = "none";
  // The brush's shape under the pointer: a circle filled with a gradient
  // that fades as the brush's edge does.
  const fade = svg("radialGradient");
  fade.id = `ausboss-touch-dab-${++dabCount}`;
  const defs = svg("defs");
  defs.append(fade);
  const dab = svg("circle", "dab");
  // Inline, so the rule that leaves the rings unfilled does not reach it.
  dab.style.fill = `url(#${fade.id})`;
  dab.style.stroke = "none";
  dab.style.display = "none";
  ink.append(defs, dab, path, dots, ringBack, ring, coreRing);
  const brushLabel = el("div", "ausboss-touch-brush");
  brushLabel.append(el("span"), el("span"));
  const tag = el("div", "ausboss-touch-tag");
  const fining = el("div", "ausboss-touch-fining", "Working on the fine details…");
  frame.append(img, tint, lit, ink, tag, brushLabel, fining);

  const wake = el("div", "ausboss-touch-wake");
  const hint = el("div", "ausboss-touch-hint");
  const noteEl = el("div", "ausboss-touch-note");
  stage.append(frame, wake, el("div", "ausboss-touch-busy"), noteEl);

  const face = node.__ausbossTouch = {
    node, host, root, stage, frame, img, tint, lit, ink, path, dots, ringBack, ring, coreRing, dab, brushLabel, tag, hint, noteEl, abort,
    chips, chipList, newButton, nameField, chipsShown: null,
    flying: [],
    pendingTimer: 0,
    alive: true,
    touches: widgetByName(node, "touches"),
    pic: null,
    items: [],
    stamps: [],
    stamp: stampOf(""),
    text: "",
    itemNotes: null,
    raw: null,
    exact: true,
    inside: null,
    share: 0,
    hover: -1,
    hoverAway: false,
    hoverMask: null,
    rim: null,
    stroke: null,
    pointer: null,
    // The tool, and whether a press takes away right now (Erase, or Ctrl).
    tool: "pick",
    away: false,
    flipKey: false,
    snap: true,
    // The brush drag that sets the brush, while it goes.
    adjust: null,
    // The selected chip (its number; under zero for one known by its
    // place), a new area that is started and not painted yet, and the chip
    // the pointer is on.
    active: 0,
    fresh: 0,
    hoverChip: 0,
    chipAreas: null,
    view: "tint",
    zoom: 1,
    turn: 0,
    retries: 0,
    inFlight: false,
    wanted: null,
    sentStamp: "",
    askedAt: 0,
    frameRequest: 0,
    noteTimer: 0,
    dwell: 0,
    keys: null,
    past: [],
    pending: [],
    choice: null,
    keyless: false,
    held: 0,
    other: false,
    quietAt: null,
    shownPieces: "",
    origin: "",
    sourceName: "",
    sourceUrl: "",
    sourceEpoch: 0,
    sentEpoch: 0,
    watchedSources: new WeakSet(),
    // One of the pack's loaders wired straight in: what it was last asked for.
    ownSeen: "",
    ownTimer: 0,
  };
  readProperties(face);

  face.start = button("ausboss-touch-start", "Show picture",
    "Runs only this node, so the picture shows here and its pieces light up under the pointer.",
    () => { if (!face.inFlight) { face.retries = 0; if (face.pic) face.pic.paused = false; requestRun(face, "scope"); } }, signal);
  wake.append(face.start, hint);

  // Tools: what a press does, the brush, undo and clear; on the right, how
  // the picked area is shown.
  face.toolSwitch = makeSlideSwitch({
    label: "What a click or a stroke does",
    fit: true,
    options: [
      { value: "pick", label: "Pick", title: "Pick: a click takes the thing under it, a stroke takes the thing you stroke over. Hold Ctrl, or use the right mouse button, to take a thing away again." },
      { value: "paint", label: "Paint", title: "Paint: the brush adds to the mask, exactly as you draw it. Paint that touches an area joins it. Hold Ctrl, or use the right mouse button, to erase instead." },
      { value: "erase", label: "Erase", title: "Erase: the brush rubs the mask out, exactly as you draw it. Hold Ctrl, or use the right mouse button, to paint instead." },
    ],
    value: face.tool,
    signal,
    onChange: (value) => setTool(face, value),
  });
  const SIZE_HELP = "How wide the brush is, in pixels of the picture. Drag here or on the number to change it. Also: the [ and ] keys, or hold Alt and the right mouse button on the picture and drag left or right.";
  const SOFT_HELP = "How soft the brush's edge is, for Paint and Erase: 0 is a hard edge, 100 fades all the way from the middle. Drag here or on the number to change it. Also: Shift with [ and ], or hold Alt and the right mouse button on the picture and drag up (softer) or down (harder).";
  face.size = makeScrubInput({
    value: brushSize(face),
    min: BRUSH_SIZE[0],
    max: BRUSH_SIZE[1],
    step: 2,
    fineStep: 2,
    decimals: 0,
    width: 62,
    unit: "px",
    title: SIZE_HELP,
    onChange: (value) => setBrush(face, value),
    onSettle: () => notifyAusbossChange(),
  });
  face.softBox = makeScrubInput({
    value: brushSoft(face),
    min: 0,
    max: 100,
    step: 5,
    fineStep: 1,
    decimals: 0,
    width: 54,
    unit: "%",
    title: SOFT_HELP,
    onChange: (value) => setSoft(face, value),
    onSettle: () => notifyAusbossChange(),
  });
  // Each number with its name in front of it. The name scrubs the number
  // too, and so does the unit inside the box: the whole field is one handle.
  const field = (name, box, help) => {
    const wrap = el("div", `ausboss-touch-field ${name.toLowerCase()}`);
    const label = el("span", "ausboss-touch-label", name);
    label.title = help;
    box.input.setAttribute("aria-label", name);
    box.handle(label);
    box.handle(box.root);
    wrap.append(label, box.root);
    wrap.addEventListener("pointerdown", (event) => event.stopPropagation(), { signal });
    return wrap;
  };
  face.sizeField = field("Size", face.size, SIZE_HELP);
  face.softField = field("Soft", face.softBox, SOFT_HELP);
  face.undo = button("ausboss-touch-btn", "Undo", "Take back the last pick, or a Clear.", () => undo(face), signal);
  face.clear = button("ausboss-touch-btn", "Clear", "Pick nothing. Undo brings it back.", () => {
    dropPending(face);
    face.active = 0;
    face.fresh = 0;
    if (!face.items.length) {
      face.chipsShown = null;
      syncReadout(face);
      return;
    }
    change(face, []);
    refreshHover(face);
  }, signal);
  // The eye, beside Undo and Clear and off the picture, so nothing is in
  // the way of a pick or a stroke: your picks on the whole picture, or the
  // result with the rest hidden. The result shows cut out, or as the black
  // and white mask: Shift-click swaps the two, and so does the node's menu.
  face.result = face.view === "tint" ? "cut" : face.view;
  face.setView = (view) => {
    face.view = view;
    if (view !== "tint") face.result = view;
    setProperty(face, VIEW_PROPERTY, face.view);
    syncState(face);
    syncTools(face);
    draw(face);
  };
  face.eye = el("button", "ausboss-touch-btn eye");
  face.eye.type = "button";
  face.eye.innerHTML = EYE_ICON;
  face.eye.addEventListener("pointerdown", (event) => event.stopPropagation(), { signal });
  face.eye.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) face.setView(face.view === "cut" ? "mask" : face.view === "mask" ? "cut" : face.result === "cut" ? "mask" : "cut");
    else face.setView(face.view === "tint" ? face.result : "tint");
  }, { signal });
  tools.append(face.toolSwitch.root, face.sizeField, face.softField, el("div", "ausboss-touch-gap"), face.undo, face.clear, face.eye);
  newButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    startFresh(face);
  }, { signal });

  // Under the picture: what is picked, in words; a dot that shows the edge
  // the settings give; and how the picked area is shown.
  face.readout = el("span", "ausboss-touch-readout quiet");
  face.before = button("ausboss-touch-btn arrow", "\u2039", "The thing before this one that the pick could mean.", () => swap(face, -1), signal);
  face.after = button("ausboss-touch-btn arrow", "\u203a", "The next thing this pick could mean.", () => swap(face, 1), signal);
  face.before.style.display = "none";
  face.after.style.display = "none";
  face.swatch = el("canvas", "ausboss-touch-swatch");
  face.swatch.width = 40;
  face.swatch.height = 40;
  face.swatch.title = "The edge Grow and Soften give, shown on one dab of the brush.";
  // In "look when I press" mode: the button that looks at the picture.
  face.lookButton = button("ausboss-touch-btn", "Look", "Look at the picture, so things light up and say their name.",
    () => { if (!face.inFlight && face.pic) { face.retries = 0; face.pic.paused = false; requestRun(face, "scope"); } }, signal);
  face.lookButton.style.display = "none";
  // The whole subject, or everything but it, in one click: ComfyUI's
  // background-removal model says what the subject is.
  face.subjectButton = button("ausboss-touch-btn whole", "Subject", "", () => addWhole(face, "subject"), signal);
  face.backgroundButton = button("ausboss-touch-btn whole", "Background", "", () => addWhole(face, "background"), signal);
  // While the node looks at the picture: how far along it is, and a press
  // that pauses it (what is lit stays and can be picked) or looks on.
  face.lookPill = button("ausboss-touch-btn lookpill", "", "", () => {
    if (face.pic?.paused && !face.inFlight) resumeLook(face);
    else pauseLook(face);
  }, signal);
  face.lookIcon = el("span", "icon");
  face.lookWord = el("span", "word");
  face.lookCount = el("span", "count");
  face.lookPill.append(face.lookIcon, face.lookWord, face.lookCount);
  face.lookPill.style.display = "none";
  // First in the line under the picture: what the node is doing with the
  // picture, then what is picked; the buttons that pick come after.
  bar.append(face.lookPill, face.before, face.readout, face.after, el("div", "ausboss-touch-gap"), face.lookButton, face.subjectButton, face.backgroundButton, face.swatch);
  // The name field keeps its keys and clicks to itself: the graph has
  // shortcuts on most letters.
  for (const type of ["keydown", "keyup", "keypress", "pointerdown", "mousedown", "dblclick"]) {
    chips.addEventListener(type, (event) => event.stopPropagation(), { signal });
  }
  nameField.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (addName(face, nameField.value)) nameField.value = "";
    } else if (event.key === "Escape") {
      nameField.value = "";
      nameField.blur();
    }
  }, { signal });

  const widget = node.addDOMWidget(WIDGET_NAME, "ausboss_touch_stage", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => PANEL_NEEDS + WIDGET_FRAME,
  });
  keepDomWidgetWidthAuto(widget);
  // Not saved with the workflow either: options.serialize only keeps it out
  // of the prompt, and saved values come back by position.
  widget.serialize = false;
  fillNodeHeight(widget, {
    minWidth: PANEL_MIN_WIDTH,
    minHeight: PANEL_NEEDS + WIDGET_FRAME,
    minNodeSize: [PANEL_MIN_WIDTH, 90],
    exactMinWidth: true,
  });
  face.widget = widget;

  installPointer(face, signal);
  const resize = new ResizeObserver(() => {
    // A narrow node keeps the brush's numbers and drops their names.
    root.classList.toggle("narrow", root.clientWidth > 0 && root.clientWidth < LABELS_FROM - 12);
    layout(face);
    drawInk(face);
  });
  resize.observe(stage);
  signal.addEventListener("abort", () => resize.disconnect());

  // What the face can be told from outside.
  face.takeNote = (note, options) => takeNote(face, note, options);
  face.settle = () => settle(face);
  face.resyncTools = () => syncTools(face);
  // The workflow is about to run: a click that still waits for the look is
  // taken now, as it is, so the run has it. No run of this node's own is
  // asked for here: the workflow's run answers.
  face.takeWaiting = () => {
    if (!face.pending.length) return;
    face.holdRuns = true;
    try { flushPending(face); } finally { face.holdRuns = false; }
  };
  // The run stopped at this node with a message for the person.
  face.stopped = (message) => {
    settle(face);
    setNote(face, String(message ?? ""));
  };
  // A setting on the node changed: the edge follows it.
  face.settingsChanged = () => {
    face.hoverMask = null;
    paintSwatch(face);
    draw(face);
    wantFine(face);
  };
  // The widget's text was changed from outside (a loaded workflow, an undo).
  face.resync = () => {
    face.touches = widgetByName(node, "touches");
    readProperties(face);
    face.past = [];
    face.choice = null;
    face.active = 0;
    face.fresh = 0;
    if (face.pic) {
      readItems(face);
      face.itemNotes = null;
      face.rim = null;
      resolve(face);
    }
    syncState(face);
    draw(face);
    drawInk(face);
  };
  face.linksChanged = () => {
    syncState(face);
    // A wire the person just made (not one a workflow came with): one of
    // the pack's loaders shows its picture.
    if (!face.host.loading?.()) followOwnLoader(face, true);
  };
  face.destroy = () => {
    face.alive = false;
    clearTimeout(face.noteTimer);
    clearTimeout(face.ownTimer);
    clearTimeout(face.dwell);
    clearTimeout(face.fineTimer);
    if (face.frameRequest) cancelAnimationFrame(face.frameRequest);
    abort.abort();
  };

  syncState(face);
  paintSwatch(face);
  return face;
}

// For tests and the harness: the pictures this page holds.
export function touchPictures() {
  return pictures;
}
