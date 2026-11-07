// Latent Size 🆎 — SHAPE × BUDGET picker, styled to the designer's pass.
//
// The ratio grid picks the shape, the stage shows the actual rectangle
// (stretchable by its edges and corner), and the per-ratio quick list
// offers generated on-grid sizes across the useful megapixel range.
// Width/height are always the derived, visible result, living in two
// ordinary hidden INT widgets (widgets are the single source of truth —
// no state blob, no queue-time injection).
//
// Layout: SHAPE (a flip container beside a 3-column ratio-chip container),
// the stage, SIZE & BUDGET (grip-scrub W/H fields, swap, typeable snap
// with ladder arrows, gear), and SIZES — quick picks for the CURRENT
// ratio, regenerated whenever the ratio or snap changes. A new node opens
// at the designed footprint and can be resized from its corner: wider, the
// chips, fields and size picks stretch with it; taller, the stage takes
// the extra height; narrower, down to MIN_WIDTH, the size row tightens.
//
// Interaction grammar: EDGES change shape (one axis, snapped), the CORNER
// changes size at the exact locked ratio (Shift frees it), Alt drops the
// snap to 1px, Escape mid-drag restores the grab-time size. Chips reshape
// at the selected pixel budget and follow the explicit orientation toggle. Snap governs gestures only — typed
// values are never re-snapped.

import { CAPTION_TYPE, HINT_TYPE, compactAction } from "../shared/panel_controls.mjs";
import { app } from "../../../scripts/app.js";
import {
  chainCallback,
  keepDomWidgetWidthAuto,
  notifyAusbossChange,
} from "../shared/index.mjs";
import { WIDGET_FRAME, fillNodeHeight, holdVueNodeMinWidth } from "../shared/panel_layout.mjs";
import { hideInputsInDef, hideWidget } from "../shared/widget_visibility.mjs";
import { markSocketless } from "../shared/widget_card_math.mjs";
import { makeScrubInput } from "../shared/scrub_input.mjs";
import {
  closeSettingsMenu,
  gearIconSvg,
  loadSettings,
  openSettingsMenu,
} from "../shared/settings_menu.mjs";
import {
  DEFAULT_RAIL,
  DEFAULT_SNAP,
  DIM_MAX,
  DIM_MIN,
  SNAP_STEPS,
  applyRatioAtBudget,
  chipMatch,
  defaultSizeForRatio,
  clampDim,
  dragResize,
  fitRectInBox,
  megapixels,
  offGrid,
  orientRatio,
  parseRail,
  parseWorkflowSizes,
  readWorkflowPolicy,
  savedWorkflowPolicy,
  workflowRatios,
  quickSizes,
  ratioLabel,
  reduceRatio,
  scrubDim,
  sizeForMegapixels,
  fitStage,
} from "../shared/resolution_math.mjs";

const NODE_CLASS = "AUSBOSS_NODES_Resolution";
// The node was called "Resolution Master" until that name, which belongs to
// another node pack, was retired. Workflows only store a title that differs
// from the default, so most pick up the new name by themselves. A saved
// title that still starts with the old default - on its own, or with a note
// after it ("Resolution Master 🆎 · 1 MP portrait") - gets the new name in
// its place on load. Any other title somebody typed stays as it is.
const RETIRED_TITLE = "Resolution Master 🆎";
const DEFAULT_WIDTH = 340; // a new node's width: W, H, and MP share the size row comfortably
const MIN_WIDTH = 320; // narrowest width where the size row's numbers still fit whole
const SECTION_HEAD = 19; // header line + its 6px bottom margin
const SECTION_PAD_Y = 14; // 6 top + 8 bottom
const CHIP_H = 24;
const QUICK_H = 22;
const CONTROL_H = 28;
const STAGE_MIN = 140;
const PANEL_PADDING = 6;
const SECTION_GAP = 6;
const REFIT_MS = 160;

const MONO = "ui-monospace, 'Cascadia Mono', Consolas, monospace";

const SETTINGS_SCOPE = "resolution";
const SETTINGS_SCHEMA = [
  {
    key: "default_snap", label: "Snap step", type: "choice",
    options: ["8", "16", "32", "64"], default: "32",
    hint: "Grid for stage gestures and the size ladder. Typed values are never snapped.",
  },
  {
    key: "chips_keep_budget", label: "Chips keep current budget", type: "toggle",
    default: false,
    hint: "Ratio chips reshape at your current megapixels instead of jumping "
      + "to that ratio's ~1MP default size.",
  },
  {
    key: "rail", label: "Ratio rail", type: "text",
    default: DEFAULT_RAIL, placeholder: DEFAULT_RAIL,
    hint: "Comma-separated ratios shown as chips, e.g. \"1:1, 21:9\".",
  },
  { section: "Latent output" },
  {
    key: "latent", label: "Latent family", type: "choice",
    options: ["16ch", "4ch", "128ch"], default: "16ch", persist: false,
    hint: "16ch: SD3, Flux 1, Krea 2, Qwen, Z-Image. 4ch: SD 1.5, SDXL. "
      + "128ch: Flux 2 Klein. Stored on this node.",
  },
  {
    key: "batch", label: "Batch size", type: "number", scrub: true, default: 1, min: 1, max: 64,
    persist: false, hint: "Latents in the batch. Stored on this node.",
  },
  { section: "Panel" },
  {
    key: "show_mp_rings", label: "MP cost curves", type: "toggle",
    default: true,
    hint: "Equal-cost curves on the stage at 0.5 / 1 / 2 MP.",
  },
  {
    key: "show_grid", label: "Dot grid", type: "toggle",
    default: true,
    hint: "The stage's dotted texture.",
  },
];

function installStyles() {
  if (document.getElementById("ausboss-res-styles")) return;
  const style = document.createElement("style");
  style.id = "ausboss-res-styles";
  style.textContent = `
  .ausboss-res-panel, .ausboss-res-panel * { box-sizing: border-box; }
  .ausboss-res-panel { display: flex; flex-direction: column; gap: ${SECTION_GAP}px;
    width: 100%; height: 100%; padding: ${PANEL_PADDING}px; overflow: hidden;
    font: 400 11px ${MONO}; color: #d7dde2; }
  .ausboss-size-dialog{color-scheme:dark;width:min(365px,88vw);border:1px solid #345554;border-radius:10px;background:#162022;color:#d7e4e3;padding:18px;font:13px system-ui}
  .ausboss-size-dialog::backdrop{background:#0008}
  .ausboss-size-dialog textarea{display:block;box-sizing:border-box;width:100%;margin:8px 0;padding:8px;font:13px monospace}
  .ausboss-size-dialog input{accent-color:#00b4aa}
  .ausboss-size-dialog [role=alert]{color:#ffd49e}
  .ausboss-size-dialog p{color:#adc1be;font:12px/1.45 system-ui;margin:7px 0 12px}
  .ausboss-size-dialog footer{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
  .ausboss-res-sec { flex: none; background: #141515; border: 1px solid #252727;
    border-radius: 8px; padding: 6px 8px 8px; }
  .ausboss-res-sechead { display: flex; align-items: baseline;
    justify-content: space-between; margin-bottom: 6px; gap: 8px; }
  .ausboss-res-sechead .label { ${CAPTION_TYPE} white-space: nowrap; }
  .ausboss-res-sechead .hint { ${HINT_TYPE}
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ausboss-res-shaperow { display: flex; gap: 6px; align-items: stretch; }
  .ausboss-res-subbox { background: #101111; border: 1px solid #252727;
    border-radius: 6px; padding: 4px; }
  .ausboss-res-flipbox { flex: none; display: grid; place-items: center; }
  .ausboss-res-chipbox { flex: 1 1 auto; min-width: 0; display: grid;
    align-content: start; max-height: 65px; overflow-y: auto; }
  .ausboss-res-chipgrid { display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; }
  .ausboss-res-chip { display: flex; align-items: center; justify-content: center;
    gap: 5px; height: ${CHIP_H}px; padding: 0 3px; border-radius: 5px; cursor: pointer;
    font: 500 10.5px ${MONO}; background: #1e2020; border: 1px solid #313434;
    color: #9aa0a0; transition: border-color .12s, color .12s; white-space: nowrap;
    overflow: hidden; }
  .ausboss-res-panel button:disabled { opacity: .4; cursor: default; }
  .ausboss-res-chip:hover { border-color: #00b4aa; color: #00b4aa; }
  .ausboss-res-chip.near { border: 1px dashed #3c6663; color: #9fc4c1; }
  .ausboss-res-chip.exact { background: rgba(0,180,170,.16); border: 1px solid #00b4aa;
    color: #7fe9e2; }
  .ausboss-res-chip .glyph { display: inline-block; border: 1.4px solid currentColor;
    border-radius: 1.5px; opacity: .75; flex: none; }
  .ausboss-res-flip { width: 32px; height: 100%; min-height: ${CHIP_H * 2 + 5}px;
    display: grid; place-items: center; background: #1e2020; border: 1px solid #313434;
    border-radius: 5px; cursor: pointer; color: #c8cccc; padding: 0; }
  .ausboss-res-flip:hover { border-color: #00b4aa; color: #00b4aa; }
  .ausboss-res-flip .glyph { display: block; border: 1.5px solid currentColor;
    border-radius: 2px; }
  .ausboss-res-stage { flex: 1 1 auto; min-height: 0; position: relative;
    overflow: hidden; background: #0e0f0f; border: 1px solid #252727; border-radius: 8px;
    outline: none; }
  .ausboss-res-stage:focus-visible { border-color: #00b4aa; }
  .ausboss-res-dots { position: absolute; inset: 0; pointer-events: none;
    background-image: radial-gradient(#242727 1px, transparent 1px);
    background-size: 22px 22px; background-position: center; opacity: .55; }
  .ausboss-res-rings { position: absolute; inset: 0; pointer-events: none; }
  .ausboss-res-rect { position: absolute; inset: var(--ausboss-res-inset,0) 0 0; margin: auto;
    border: 1.5px solid #00b4aa; background: rgba(0,180,170,.10);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 2px; }
  .ausboss-res-rect.easing { transition: width ${REFIT_MS}ms ease, height ${REFIT_MS}ms ease; }
  .ausboss-res-ghost { position: absolute; inset: var(--ausboss-res-inset,0) 0 0; margin: auto;
    border: 1px dashed #4d5555; pointer-events: none; display: none; }
  .ausboss-res-readout { position: absolute; top: 6px; left: 9px; right: 9px; z-index: 2;
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    pointer-events: none; white-space: nowrap; text-shadow: 0 1px 2px rgba(0,0,0,.7); }
  .ausboss-res-readout .dims { font: 600 13px ${MONO}; color: #f0f3f3; letter-spacing: -.01em; }
  .ausboss-res-readout .meta { display: flex; align-items: center; gap: 5px;
    font: 400 10.5px ${MONO}; color: #8d9494; }
  .ausboss-res-readout .mp { font-weight: 600; color: #e5eeee; }
  .ausboss-res-ringlabel { font: 400 8.5px ${MONO}; fill: #4f5656; }
  .ausboss-res-offgrid { width: 6px; height: 6px; border-radius: 50%;
    background: #f0a11e; }
  .ausboss-res-handle { position: absolute; width: 18px; height: 18px;
    display: grid; place-items: center; border: none; background: transparent; padding: 0; }
  .ausboss-res-handle::after { content: ""; width: 9px; height: 9px;
    background: #2ee0e8; }
  .ausboss-res-handle.e { right: -9px; top: 50%; margin-top: -9px; cursor: ew-resize; }
  .ausboss-res-handle.s { bottom: -9px; left: 50%; margin-left: -9px; cursor: ns-resize; }
  .ausboss-res-handle.se { right: -9px; bottom: -9px; cursor: nwse-resize; }
  .ausboss-res-handle.linked { opacity: .3; pointer-events: none; }
  .ausboss-res-controls { display: flex; align-items: center; gap: 6px;
    flex-wrap: nowrap; }
  .ausboss-res-field { display: flex; align-items: center; gap: 4px; flex: 1 1 80px;
    min-width: 0; }
  .ausboss-res-field .ausboss-scrub { width: auto; flex: 1 1 auto; min-width: 0;
    height: ${CONTROL_H}px; background: #1c1e1e; border-color: #313434; font: 500 13px ${MONO}; }
  .ausboss-res-field .ausboss-scrub > .ausboss-scrub-input { text-align: left;
    padding-left: 8px; color: #eef1f1; }
  .ausboss-res-field[inert] .ausboss-scrub,.ausboss-res-field .ausboss-scrub[inert]{border-color:transparent;background:transparent}
  .ausboss-res-field[inert] .ausboss-scrub-step,.ausboss-res-field .ausboss-scrub[inert] .ausboss-scrub-step{display:none}
  .ausboss-res-field.linked { opacity: .5; pointer-events: none; }
  .ausboss-res-axis { flex: none; font: 400 9px ${MONO}; color: #565c5c; }
  .ausboss-res-btn { width: ${CONTROL_H}px; height: ${CONTROL_H}px; flex: none;
    display: grid; place-items: center; background: #1c1e1e; border: 1px solid #313434;
    border-radius: 5px; color: #9aa0a0; cursor: pointer; font-size: 12px; padding: 0; }
  .ausboss-res-btn:hover { border-color: #00b4aa; color: #00b4aa; }
  .ausboss-res-quick { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px;
    height: ${QUICK_H * 2 + 5}px; overflow-y: auto; align-content: start; }
  .ausboss-res-chip.customchip { opacity: .45; cursor: default;
    pointer-events: none; border-style: dashed; grid-column: span 2; }
  .ausboss-res-quick .ausboss-res-chip { height: ${QUICK_H}px; font-size: 9.5px;
    padding: 0 1px; }
  .ausboss-res-noquick { font: 400 10px ${MONO}; color: #4a5050; padding: 4px 0;
    grid-column: 1 / -1; }
  /* Below the default width the size row tightens, so W, H and MP stay
     whole down to MIN_WIDTH. 289px is this section's content width at
     DEFAULT_WIDTH (node - 20 frame - 12 panel padding - 18 section). */
  .ausboss-res-sizesec { container-type: inline-size; }
  @container (max-width: 289px) {
    .ausboss-res-controls { gap: 4px; }
    .ausboss-res-field { gap: 2px; }
    .ausboss-res-field .ausboss-scrub > .ausboss-scrub-input { padding-left: 4px; }
    .ausboss-res-btn { width: 26px; }
  }
  `;
  document.head.append(style);
}

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function svgEl(tag) {
  return document.createElementNS("http://www.w3.org/2000/svg", tag);
}

// ---------- state plumbing ----------

function getSize(state) {
  return {
    width: clampDim(state.widthWidget.value),
    height: clampDim(state.heightWidget.value),
  };
}

function commitSize(state, width, height, { gesture = false } = {}) {
  if (state.strict && (!isListed(state, width, height) || axisLinked(state, "width") || axisLinked(state, "height"))) return;
  if (!axisLinked(state, "width")) state.widthWidget.value = clampDim(width);
  if (!axisLinked(state, "height")) state.heightWidget.value = clampDim(height);
  repaint(state);
  state.node.graph?.setDirtyCanvas(true, true);
  if (!gesture) notifyAusbossChange();
}

// Orientation is a saved two-mode choice, independent of canvas resizing.
// Older workflows infer their initial mode from dimensions once.
function orientation(state) {
  const properties = state.node.properties ??= {};
  if (typeof properties.ausbossResolutionPortrait !== "boolean") {
    const { width, height } = getSize(state);
    properties.ausbossResolutionPortrait = height > width;
  }
  return properties.ausbossResolutionPortrait;
}

function flipOrientation(state) {
  if (axisLinked(state, "width") || axisLinked(state, "height")) return;
  const portrait = !orientation(state);
  state.node.properties.ausbossResolutionPortrait = portrait;
  const { width, height } = getSize(state);
  commitSize(state, portrait ? Math.min(width, height) : Math.max(width, height),
    portrait ? Math.max(width, height) : Math.min(width, height));
  easeRefit(state);
}

// Core Primitive nodes propagate through widget-row metadata. Our compact
// size bar lifts sockets into the input column, so mirror a connected
// Primitive's edits into the ordinary backing widgets at edit time.
// No prompt-export hook or custom serialization is involved.
function syncPrimitiveLinks(state) {
  const target = state.node;
  state.primitiveSources ??= new WeakSet();
  for (const input of target.inputs ?? []) {
    const link = target.graph?.links?.[input.link];
    const source = link && target.graph.getNodeById(link.origin_id);
    if (source?.type !== "PrimitiveNode" || !source.widgets?.[0]) continue;
    const reference = new WeakRef(target);
    const mirror = () => {
      const node = reference.deref();
      if (!node?.graph) return;
      for (const slot of node.inputs ?? []) {
        const edge = node.graph.links?.[slot.link];
        if (!edge || String(edge.origin_id) !== String(source.id)) continue;
        const widget = node.widgets?.find((item) => item.name === slot.name);
        if (widget && widget.value !== source.widgets[0].value) {
          widget.value = source.widgets[0].value;
          widget.callback?.(widget.value);
        }
      }
    };
    if (!state.primitiveSources.has(source)) {
      state.primitiveSources.add(source);
      chainCallback(source.widgets[0], "callback", mirror);
    }
    mirror();
  }
}

function axisLinked(state, name) {
  return !!state.node.inputs?.some(
    (input) => input?.name === name && input.link !== null && input.link !== undefined,
  );
}

// Any positive step is legal (the snap box is typeable); the ladder
// 8/16/32/64 rides the arrows.
function currentSnap(state) {
  const stored = Number(state.node.properties?.ausbossResolutionSnap);
  if (Number.isInteger(stored) && stored >= 1 && stored <= 1024) return stored;
  const preferred = Number(state.settings?.default_snap);
  return SNAP_STEPS.includes(preferred) ? preferred : DEFAULT_SNAP;
}

function setSnap(state, step) {
  const value = Math.round(Number(step));
  if (!Number.isFinite(value) || value < 1 || value > 1024) return;
  state.node.properties.ausbossResolutionSnap = value;
  repaint(state);
}

// ---------- painting ----------

function stageBox(state) {
  return {
    w: Math.max(40, state.stage.clientWidth),
    h: Math.max(40, state.stage.clientHeight),
  };
}

// Equal-cost curves, log-sampled across the plausible width range so they
// sweep the whole quadrant (the design's rendering).
function paintRings(state, scale, shift) {
  const svg = state.rings;
  svg.replaceChildren();
  const show = state.settings?.show_mp_rings !== false;
  if (!show) return;
  const box = stageBox(state);
  svg.setAttribute("viewBox", `0 0 ${box.w} ${box.h}`);
  const cx = box.w / 2;
  const cy = box.h / 2 + shift;
  for (const mp of [0.5, 1, 2]) {
    const points = [];
    for (let i = 0; i <= 60; i += 1) {
      const w = 128 * Math.pow(20000 / 128, i / 60);
      const x = (w * scale) / 2;
      const y = ((mp * 1_000_000) / w) * (scale / 2);
      if (x < cx * 1.4 && y < cy * 1.6) points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    if (points.length < 2) continue;
    // Name the curve where it leaves the stage on the right, so the
    // legend lives on the line itself instead of in a footer.
    const labelX = box.w - 8;
    const labelW = ((labelX - cx) * 2) / scale;
    const labelY = cy - ((mp * 1_000_000) / labelW) * (scale / 2);
    if (labelW > 0 && labelY > 26 && labelY < box.h - 6) {
      const text = svgEl("text");
      text.setAttribute("x", String(labelX));
      text.setAttribute("y", String(labelY - 3));
      text.setAttribute("text-anchor", "end");
      text.setAttribute("class", "ausboss-res-ringlabel");
      text.textContent = `${mp} MP`;
      svg.append(text);
    }
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const path = svgEl("polyline");
      path.setAttribute("points", points.join(" "));
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "#3a4040");
      path.setAttribute("stroke-width", "1");
      path.setAttribute("transform", `translate(${cx} ${cy}) scale(${sx} ${sy})`);
      svg.append(path);
    }
  }
}

// The quick list regenerates when the ratio or snap changes; repaint only
// re-highlights it otherwise.
function rebuildQuick(state, width, height, snap, custom, picks) {
  const wrap = state.quickWrap;
  wrap.replaceChildren();
  state.quickButtons = [];
  if (custom) {
    // A shape off the rail has no ladder; one quiet chip says so instead
    // of a list that churns with every drag step.
    const chip = el("button", "ausboss-res-chip customchip", "custom");
    chip.type = "button";
    chip.disabled = true;
    wrap.append(chip);
    return;
  }
  const list = picks ?? quickSizes(width, height, snap);
  if (state.strict && !list.length) return;
  if (!list.length) {
    wrap.append(el("span", "ausboss-res-noquick",
      "No on-grid sizes for this ratio at this snap — try a finer snap."));
    return;
  }
  for (const size of list) {
    const chip = el("button", "ausboss-res-chip", `${size.width}×${size.height}`);
    chip.type = "button";
    chip.title = `Apply ${size.width}×${size.height} exactly.`;
    chip.addEventListener("click", () => {
      if (picks && size.width !== size.height) state.node.properties.ausbossResolutionPortrait = size.height > size.width;
      commitSize(state, size.width, size.height);
      easeRefit(state);
    });
    chip.addEventListener("pointerenter", () => showGhost(state, size.width, size.height));
    chip.addEventListener("pointerleave", () => hideGhost(state));
    wrap.append(chip);
    state.quickButtons.push({ button: chip, size });
  }
}

function isListed(state, width, height) {
  return state.sizes.some(([w, h]) => w === width && h === height);
}

function restorePolicy(state) {
  const widget = state.policyWidget;
  if (!widget) return;
  const legacy = state.node.properties?.ausbossWorkflowSizes;
  widget.value = savedWorkflowPolicy(widget.value, legacy);
  if (state.node.properties) delete state.node.properties.ausbossWorkflowSizes;
  try {
    Object.assign(state, readWorkflowPolicy(widget.value), { policyError: false });
  } catch {
    Object.assign(state, { sizes: [], strict: true, policyError: true });
  }
  const { width, height } = getSize(state);
  if (state.strict && state.sizes.length && !isListed(state, width, height)
      && !axisLinked(state, "width") && !axisLinked(state, "height")) {
    [state.widthWidget.value, state.heightWidget.value] = state.sizes[0];
  }
}

function editWorkflowSizes(state) {
  closeSettingsMenu();
  const dialog = el("dialog", "ausboss-size-dialog");
  dialog.setAttribute("aria-label", "Workflow resolutions");
  const label = el("label", "", "Workflow resolutions");
  const area = el("textarea");
  area.rows = 6;
  area.placeholder = "576 × 1024";
  area.value = state.sizes.map(pair => pair.join(" × ")).join("\n");
  label.append(area);
  const hint = el("p", "", "One width × height per line. These quick picks are saved with this node.");
  const lock = el("label");
  const checkbox = el("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.strict;
  lock.append(checkbox, " Limit choices to this list");
  const description = el("p", "", "Only listed sizes and their exact aspect ratios can be selected. Linked dimensions are checked when the workflow runs.");
  const error = el("div");
  error.setAttribute("role", "alert");
  const footer = el("footer");
  const cancel = compactAction("Cancel");
  const save = compactAction("Save sizes");
  cancel.onclick = () => dialog.close();
  save.onclick = () => {
    let sizes;
    try {
      sizes = parseWorkflowSizes(area.value);
      if (checkbox.checked && !sizes.length) throw new Error("Add a resolution, or turn off the limit to allow any size.");
    } catch (e) {
      error.textContent = e.message;
      area.focus();
      return;
    }
    state.policyWidget.value = sizes.length ? JSON.stringify({ strict: checkbox.checked, sizes }) : "";
    restorePolicy(state);
    buildPanel(state);
    fitNode(state);
    notifyAusbossChange();
    dialog.close();
  };
  footer.append(cancel, save);
  dialog.append(label, hint, lock, description, error, footer);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once:true });
  dialog.showModal();
}

function repaint(state) {
  const { width, height } = getSize(state);
  const snap = currentSnap(state);
  const portrait = orientation(state);
  const ratio = reduceRatio(width, height);

  state.dimLabel.textContent = `${width} × ${height}`;
  state.subMp.textContent = `${megapixels(width, height).toFixed(2)} MP`;
  state.subRatio.textContent = state.strict ? `${ratio.x}:${ratio.y}` : ratioLabel(width, height);
  state.offGridDot.style.display = !state.strict && offGrid(width, height, snap) ? "" : "none";
  state.dots.style.display = state.settings?.show_grid === false ? "none" : "";

  const box = stageBox(state);
  const sideRoom = 14 + Math.max(state.dimLabel.offsetWidth, state.subMp.parentElement.offsetWidth);
  const frame = state.frame = state.frozenFrame ?? fitStage(width, height, box.w, box.h, sideRoom);
  const { scale, shift } = frame;
  state.stage.style.setProperty("--ausboss-res-inset", `${2 * shift}px`);
  state.rect.style.width = `${Math.max(8, width * scale)}px`;
  state.rect.style.height = `${Math.max(8, height * scale)}px`;
  paintRings(state, scale, shift);

  // Section labels.
  state.orientLabel.textContent = state.strict ? "Workflow ratios" : width === height
    ? `square · chips ${portrait ? "portrait" : "landscape"}`
    : portrait ? "portrait" : "landscape";
  const flipFit = portrait ? { w: 11, h: 15 } : { w: 15, h: 11 };
  state.flipGlyph.style.width = `${flipFit.w}px`;
  state.flipGlyph.style.height = `${flipFit.h}px`;
  state.flipButton.title = width === height
    ? `Square canvas: the ratio chips land ${portrait ? "portrait" : "landscape"}. Click to switch.`
    : `Flip to ${portrait ? "landscape" : "portrait"}`;

  state.flipButton.setAttribute("aria-pressed", String(portrait));

  // Ratio chips render in the selected orientation; filled = exact, dashed = near.
  state.chipButtons.forEach(({ button, ratio: chipRatio, glyph, label }) => {
    const oriented = state.strict ? chipRatio : orientRatio(chipRatio, portrait);
    const fitted = fitRectInBox(oriented.x, oriented.y, 14, 14);
    glyph.style.width = `${fitted.w.toFixed(1)}px`;
    glyph.style.height = `${fitted.h.toFixed(1)}px`;
    label.textContent = oriented.label;
    button.title = state.strict ? `Show approved ${oriented.label} sizes` : `${oriented.label}: reshape to this ratio. The flip button on the left sets the orientation.`;
    const candidate = chipMatch(width, height, oriented);
    const match = state.strict
      ? (ratio.x === chipRatio.x && ratio.y === chipRatio.y ? { state: "exact" } : null)
      : candidate?.flipped ? null : candidate;
    button.setAttribute("aria-pressed", String(match?.state === "exact"));
    button.classList.toggle("exact", match?.state === "exact");
    button.classList.toggle("near", match?.state === "near");
  });

  // Fields and handles honor converted-to-input axes.
  const widthLinked = axisLinked(state, "width");
  const heightLinked = axisLinked(state, "height");
  const linked = widthLinked || heightLinked;
  state.flipButton.disabled = linked || state.strict;
  state.swapButton.disabled = linked || (state.strict && (width === height || !isListed(state, height, width)));
  state.budgetControl.root.inert = linked || state.strict;
  state.budgetControl.root.style.opacity = linked || state.strict ? ".65" : "";
  for (const { button } of state.chipButtons) button.disabled = linked;
  state.widthControl.set(width);
  state.heightControl.set(height);
  state.budgetControl.set(megapixels(width, height));
  for (const [field, wired] of [[state.widthField, widthLinked], [state.heightField, heightLinked]]) {
    field.inert = wired || state.strict;
    field.classList.toggle("linked", wired);
  }
  state.handles.e.classList.toggle("linked", widthLinked);
  state.handles.s.classList.toggle("linked", heightLinked);
  state.handles.se.classList.toggle("linked", linked);

  // Quick sizes follow the current ratio and snap grid. Frozen
  // while a gesture is live (a drag sweeps ratios; regenerating per move
  // read as glitching), and a shape off the rail shows one "custom" chip.
  if (!state.dragging) {
    const onRail = state.railRatios?.some(
      (railRatio) => chipMatch(width, height, railRatio)?.state === "exact",
    );
    const group = state.strict && state.railRatios.find(r => r.x === ratio.x && r.y === ratio.y);
    const picks = state.strict ? (group?.sizes ?? []) : state.sizes.length
      ? state.sizes.map(([w, h]) => ({ width: w, height: h })) : null;
    const quickKey = picks ? JSON.stringify(picks) : onRail ? `${ratio.x}:${ratio.y}/${snap}` : `custom/${snap}`;
    if (state.quickKey !== quickKey) {
      state.quickKey = quickKey;
      rebuildQuick(state, width, height, snap, !picks && !onRail, picks);
    }
    state.quickHint.textContent = state.policyError ? "Invalid list · edit in settings"
      : linked && state.strict ? "Linked size checked at run"
      : state.strict ? `Allowed · ${ratio.x}:${ratio.y}` : picks ? "Workflow recommendations"
      : onRail ? `for ${ratioLabel(width, height)} · /${snap}` : `custom · /${snap}`;
  }
  state.quickButtons.forEach(({ button, size }) => {
    button.disabled = linked;
    const selected = size.width === width && size.height === height;
    button.classList.toggle("exact", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function showGhost(state, width, height) {
  const { scale } = state.frame;
  state.ghost.style.width = `${width * scale}px`;
  state.ghost.style.height = `${height * scale}px`;
  state.ghost.style.display = "";
}

function hideGhost(state) {
  state.ghost.style.display = "none";
}

function easeRefit(state) {
  state.frozenFrame = null;
  state.rect.classList.add("easing");
  repaint(state);
  clearTimeout(state.easeTimer);
  state.easeTimer = setTimeout(() => state.rect.classList.remove("easing"), REFIT_MS + 30);
}

// ---------- gestures ----------

function beginHandleDrag(state, handle, event) {
  if (state.strict || event.button !== 0 || state.disposed) return;
  if ((handle !== "s" && axisLinked(state, "width")) || (handle !== "e" && axisLinked(state, "height"))) return;
  event.preventDefault();
  event.stopPropagation();
  const start = getSize(state);
  // Frozen at pointerdown: the rect may overflow the stage mid-gesture and
  // re-fits with a short ease on release - auto-fit never squirms mid-drag.
  state.frozenFrame = state.frame;
  state.dragging = true;
  const origin = { x: event.clientX, y: event.clientY };
  state.dragAbort?.abort();
  const abort = state.dragAbort = new AbortController();
  const zoom = state.stage.getBoundingClientRect().width / state.stage.offsetWidth || 1;
  const move = (moveEvent) => {
    const next = dragResize({
      handle,
      startWidth: start.width,
      startHeight: start.height,
      dx: (moveEvent.clientX - origin.x) / zoom,
      dy: (moveEvent.clientY - origin.y) / zoom,
      scale: state.frozenFrame.scale,
      snap: currentSnap(state),
      snapOn: !moveEvent.altKey,
      // The corner scales at the exact locked ratio; Shift frees both axes.
      lockRatio: handle === "se" ? !moveEvent.shiftKey : false,
    });
    commitSize(state, next.width, next.height, { gesture: true });
  };
  const finish = (commit) => {
    abort.abort();
    state.dragging = false;
    if (!commit) commitSize(state, start.width, start.height, { gesture: true });
    easeRefit(state);
    if (commit) notifyAusbossChange();
  };
  // Window + capture phase, never element capture: the proven house drag
  // pattern (see the LoRA loader's grip).
  window.addEventListener("pointermove", move, { capture: true, signal: abort.signal });
  window.addEventListener("pointerup", () => finish(true), { capture: true, signal: abort.signal });
  window.addEventListener("pointercancel", () => finish(false), { capture: true, signal: abort.signal });
  window.addEventListener(
    "keydown",
    (keyEvent) => {
      if (keyEvent.key === "Escape") {
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        finish(false); // restore the pointer-down snapshot
      }
    },
    { capture: true, signal: abort.signal },
  );
}

// Adobe-style, the house norm: the value itself is the control - drag it to
// scrub by the snap step (Shift = 8px), click it to type, arrows to step.
// The cursor says which, so no instructions ride the header. Typed values
// are sacred: committed exactly, never re-snapped.
function sizeField(state, key) {
  const field = el("div", "ausboss-res-field");
  const control = makeScrubInput({
    value: getSize(state)[key],
    min: DIM_MIN,
    max: DIM_MAX,
    step: currentSnap(state),
    fineStep: 8,
    decimals: 0,
    title: `${key === "width" ? "Width" : "Height"} in pixels.`,
    onChange: (value) => {
      const size = getSize(state);
      state.dragging = true; // freezes the size ladder until the gesture settles
      commitSize(
        state,
        key === "width" ? value : size.width,
        key === "height" ? value : size.height,
        { gesture: true },
      );
    },
    onSettle: () => {
      state.dragging = false;
      easeRefit(state);
      notifyAusbossChange();
    },
  });
  const axis = el("span", "ausboss-res-axis", key === "width" ? "W" : "H");
  field.append(control.root, axis);
  return { field, control };
}

function sectionHead(label, hint) {
  const head = el("div", "ausboss-res-sechead");
  head.append(el("span", "label", label));
  const hintEl = el("span", "hint", hint ?? "");
  head.append(hintEl);
  return { head, hintEl };
}

// ---------- build ----------

function buildPanel(state) {
  state.dragAbort?.abort();
  state.dragging = false;
  state.frozenFrame = null;
  const panel = state.panel;
  panel.textContent = "";
  state.quickKey = null; // force the quick list to regenerate

  // (1) SHAPE - two distinct containers: orientation | ratio grid.
  const shapeSec = el("div", "ausboss-res-sec");
  const shapeHead = sectionHead("Shape", "");
  shapeSec.append(shapeHead.head);
  state.orientLabel = shapeHead.hintEl;
  const shapeRow = el("div", "ausboss-res-shaperow");
  const flipBox = el("div", "ausboss-res-subbox ausboss-res-flipbox");
  const flip = el("button", "ausboss-res-flip");
  flip.type = "button";
  flip.setAttribute("aria-label", "Toggle landscape or portrait");
  const flipGlyph = el("span", "glyph");
  flip.append(flipGlyph);
  flip.addEventListener("click", () => flipOrientation(state));
  flipBox.append(flip);
  const chipBox = el("div", "ausboss-res-subbox ausboss-res-chipbox");
  const chipGrid = el("div", "ausboss-res-chipgrid");
  state.flipButton = flip;
  state.flipGlyph = flipGlyph;
  state.chipButtons = [];
  state.railRatios = state.strict ? workflowRatios(state.sizes) : parseRail(state.settings?.rail);
  for (const ratio of state.railRatios) {
    const chip = el("button", "ausboss-res-chip");
    chip.type = "button";
    const glyph = el("span", "glyph");
    const label = el("span");
    chip.append(glyph, label);
    const chipTarget = () => {
      const size = getSize(state);
      if (state.strict) return ratio.sizes.find(s => s.width === size.width && s.height === size.height) ?? ratio.sizes[0];
      const portrait = orientation(state);
      if (state.settings?.chips_keep_budget) {
        return applyRatioAtBudget(size.width, size.height, ratio, currentSnap(state), portrait);
      }
      return defaultSizeForRatio(orientRatio(ratio, portrait), currentSnap(state));
    };
    chip.addEventListener("click", () => {
      const next = chipTarget();
      commitSize(state, next.width, next.height);
      easeRefit(state);
    });
    chip.addEventListener("pointerenter", () => {
      const next = chipTarget();
      showGhost(state, next.width, next.height);
    });
    chip.addEventListener("pointerleave", () => hideGhost(state));
    chipGrid.append(chip);
    state.chipButtons.push({ button: chip, ratio, glyph, label });
  }
  chipBox.append(chipGrid);
  if (!state.strict) shapeRow.append(flipBox);
  shapeRow.append(chipBox);
  shapeSec.append(shapeRow);
  panel.append(shapeSec);

  // (2) STAGE
  const stage = el("div", "ausboss-res-stage");
  stage.tabIndex = state.strict ? -1 : 0;
  if (state.strict) stage.title = "Choose from the workflow’s ratio and size buttons.";
  const dots = el("div", "ausboss-res-dots");
  const rings = svgEl("svg");
  rings.classList.add("ausboss-res-rings");
  const rect = el("div", "ausboss-res-rect");
  const ghost = el("div", "ausboss-res-ghost");
  // The readout rides the stage's top edge, never the rectangle: a tall
  // narrow canvas has no room inside it for its own numbers.
  const readout = el("div", "ausboss-res-readout");
  const dimLabel = el("span", "dims");
  const meta = el("span", "meta");
  const subMp = el("span", "mp");
  const subRatio = el("span");
  const offGridDot = el("span", "ausboss-res-offgrid");
  offGridDot.title = "Off the snap grid - gestures snap, typed values stay exact.";
  meta.append(subMp, el("span", "", "·"), subRatio, offGridDot);
  readout.append(dimLabel, meta);
  state.handles = {};
  for (const handle of ["e", "s", "se"]) {
    const grip = el("button", `ausboss-res-handle ${handle}`);
    grip.type = "button";
    grip.title = handle === "se"
      ? "Drag both (ratio locked) - Shift frees, Alt unsnaps, Esc cancels"
      : handle === "e"
        ? "Drag width - Alt unsnaps, Esc cancels"
        : "Drag height - Alt unsnaps, Esc cancels";
    grip.addEventListener("pointerdown", (event) => beginHandleDrag(state, handle, event));
    if (!state.strict) rect.append(grip);
    state.handles[handle] = grip;
  }
  stage.append(dots, rings, ghost, rect, readout);
  stage.addEventListener("keydown", (event) => {
    const keys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const move = keys[event.key];
    if (!move || state.strict) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 8 : currentSnap(state);
    const size = getSize(state);
    commitSize(
      state,
      clampDim(size.width + move[0] * step),
      clampDim(size.height + move[1] * step), // up = taller
    );
    easeRefit(state);
  });
  panel.append(stage);

  // (3) SIZE & BUDGET
  const sizeSec = el("div", "ausboss-res-sec ausboss-res-sizesec");
  sizeSec.append(sectionHead("Size & budget", "").head);
  const controls = el("div", "ausboss-res-controls");
  const widthField = sizeField(state, "width");
  const heightField = sizeField(state, "height");
  const swap = el("button", "ausboss-res-btn", "⇄");
  swap.type = "button";
  state.swapButton = swap;
  swap.title = "Swap width and height";
  swap.addEventListener("click", () => {
    const size = getSize(state);
    state.node.properties.ausbossResolutionPortrait = size.width > size.height;
    commitSize(state, size.height, size.width);
    easeRefit(state);
  });
  // The budget is typeable: scrub or type megapixels and the canvas keeps
  // its ratio, landing on the grid nearest that cost.
  const budgetField = el("div", "ausboss-res-field ausboss-res-budget");
  const budget = makeScrubInput({
    value: megapixels(getSize(state).width, getSize(state).height),
    min: 0.05,
    max: 16,
    step: 0.1,
    fineStep: 0.01,
    decimals: 2,
    title: "Megapixels. Scrub or type a budget; the canvas keeps its ratio.",
    onChange: (mp) => {
      const size = getSize(state);
      state.dragging = true;
      const next = sizeForMegapixels(size.width, size.height, mp, currentSnap(state));
      commitSize(state, next.width, next.height, { gesture: true });
    },
    onSettle: () => {
      state.dragging = false;
      easeRefit(state);
      notifyAusbossChange();
    },
  });
  budgetField.append(budget.root, el("span", "ausboss-res-axis", "MP"));
  state.budgetControl = budget;
  const gear = el("button", "ausboss-res-btn");
  gear.type = "button";
  gear.title = "Latent Size settings";
  gear.innerHTML = gearIconSvg();
  gear.addEventListener("click", () => {
    openSettingsMenu({
      scope: SETTINGS_SCOPE,
      schema: [{ section: "This workflow" }, {
        key: "workflow_sizes", type: "action", label: "Workflow resolutions", button: "Edit list",
        onAction: () => editWorkflowSizes(state),
      }, ...SETTINGS_SCHEMA.filter(e => !state.strict || !["default_snap", "chips_keep_budget", "rail"].includes(e.key)).map((entry) => {
        const input = entry.key === "latent" ? "latent" : entry.key === "batch" ? "batch_size" : null;
        return input && axisLinked(state, input) ? { section: `${entry.label} is linked` } : entry;
      })],
      anchor: gear.getBoundingClientRect(),
      title: "Latent Size settings",
      initial: {
        ...state.settings,
        latent: state.latentWidget?.value ?? "16ch",
        batch: Number(state.batchWidget?.value ?? 1),
      },
      onChange: (values, key) => {
        state.settings = values;
        if (key === "latent" && state.latentWidget) {
          state.latentWidget.value = values.latent;
          state.latentWidget.callback?.(values.latent);
          notifyAusbossChange();
          return;
        }
        if (key === "batch" && state.batchWidget) {
          state.batchWidget.value = Math.round(values.batch);
          state.batchWidget.callback?.(state.batchWidget.value);
          notifyAusbossChange();
          return;
        }
        if (key === "default_snap" || key === null) {
          // The gear owns the snap now; changes apply to this node too.
          setSnap(state, values.default_snap);
        }
        buildPanel(state);
        fitNode(state);
      },
    });
  });
  controls.append(widthField.field, swap, heightField.field, budgetField, gear);
  sizeSec.append(controls);
  panel.append(sizeSec);

  // (4) SIZES - quick picks for the CURRENT ratio, regenerated on change.
  const quickSec = el("div", "ausboss-res-sec");
  const quickHead = sectionHead("Sizes", "");
  quickSec.append(quickHead.head);
  const quickWrap = el("div", "ausboss-res-quick");
  quickSec.append(quickWrap);
  panel.append(quickSec);
  state.quickHint = quickHead.hintEl;
  state.quickWrap = quickWrap;
  state.quickButtons = [];

  state.stage = stage;
  state.dots = dots;
  state.rings = rings;
  state.rect = rect;
  state.ghost = ghost;
  state.dimLabel = dimLabel;
  state.subMp = subMp;
  state.subRatio = subRatio;
  state.offGridDot = offGridDot;
  state.widthField = widthField.field;
  state.widthControl = widthField.control;
  state.heightField = heightField.field;
  state.heightControl = heightField.control;

  state.resizeObserver?.disconnect();
  state.resizeObserver = new ResizeObserver(() => {
    holdVueNodeMinWidth(state.panel, MIN_WIDTH);
    if (!state.frozenFrame) repaint(state);
  });
  state.resizeObserver.observe(stage);

  repaint(state);
}

function panelHeight(state) {
  const section = (content) => SECTION_PAD_Y + SECTION_HEAD + content + 2;
  const shape = section(CHIP_H * 2 + 5 + 8); // 2 chip rows + gap inside the subbox
  const size = section(CONTROL_H);            // one line: W, swap, H, gear
  const quick = section(QUICK_H * 2 + 5);     // 4x2 quick grid
  return PANEL_PADDING * 2 + shape + SECTION_GAP + STAGE_MIN + SECTION_GAP
    + size + SECTION_GAP + quick;
}

function fitNode(state) {
  const height = state.node.computeSize
    ? state.node.computeSize()[1]
    : panelHeight(state) + WIDGET_FRAME + 60;
  const width = Math.max(MIN_WIDTH, state.node.size?.[0] || DEFAULT_WIDTH);
  state.node.setSize?.([width, Math.max(height, state.node.size?.[1] || 0)]);
  state.node.graph?.setDirtyCanvas(true, true);
}

// ---------- install ----------

function installResolutionNode(node) {
  installStyles();
  const widthWidget = node.widgets?.find((widget) => widget.name === "width");
  const heightWidget = node.widgets?.find((widget) => widget.name === "height");
  if (!widthWidget || !heightWidget) return;
  hideWidget(widthWidget);
  hideWidget(heightWidget);
  // The latent family and batch size ride hidden widgets the gear sets, so
  // the API format carries them like any other value.
  const latentWidget = node.widgets?.find((widget) => widget.name === "latent");
  const batchWidget = node.widgets?.find((widget) => widget.name === "batch_size");
  const policyWidget = node.widgets?.find(widget => widget.name === "workflow_sizes");
  hideWidget(policyWidget);
  if (latentWidget) hideWidget(latentWidget);
  if (batchWidget) hideWidget(batchWidget);

  // W/H share the compact size bar: their sockets belong in the slot
  // column, never stacked on that bar. The gear widgets live there too.
  const liftSockets = () => {
    for (const input of node.inputs ?? []) {
      if (["width", "height", "latent", "batch_size"].includes(input.widget?.name)) {
        delete input.widget;
        input._widget = undefined;
      }
    }
  };
  liftSockets();
  const panel = el("div", "ausboss-res-panel");
  const state = {
    node,
    widthWidget,
    heightWidget,
    latentWidget,
    batchWidget,
    policyWidget,
    sizes: [],
    strict: false,
    panel,
    settings: loadSettings(SETTINGS_SCOPE, SETTINGS_SCHEMA),
    frozenFrame: null,
    quickKey: null,
  };
  node.__ausbossResolution = state;

  const domWidget = node.addDOMWidget("ausboss_resolution_panel", "ausboss_resolution", panel, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => panelHeight(state) + WIDGET_FRAME,
  });
  keepDomWidgetWidthAuto(domWidget);
  // Not saved with the workflow either: options.serialize only keeps it out
  // of the prompt, and saved values come back by position.
  domWidget.serialize = false;
  // exactMinWidth: MIN_WIDTH is the node's real floor, without the
  // frontend's padding on top (panel_layout.mjs).
  fillNodeHeight(domWidget, {
    minWidth: MIN_WIDTH,
    minHeight: () => panelHeight(state) + WIDGET_FRAME,
    minNodeSize: [MIN_WIDTH, 400],
    exactMinWidth: true,
  });

  restorePolicy(state);
  buildPanel(state);
  for (const widget of [widthWidget, heightWidget, latentWidget, batchWidget]) {
    if (widget) chainCallback(widget, "callback", () => {
      requestAnimationFrame(() => { if (!state.disposed) { syncPrimitiveLinks(state); repaint(state); } });
    });
  }
  // A new node opens at the designed footprint: every section is spaced
  // for it, and the SIZES grid reserves its two rows so content never
  // changes the height. From there the size is the user's to pick, so the
  // node can line up with its neighbours; the layout minimums above stop a
  // corner drag at MIN_WIDTH and the panel's height. A saved node keeps
  // its saved size.
  node.setSize?.([
    DEFAULT_WIDTH,
    Math.max(panelHeight(state) + WIDGET_FRAME + 86, node.computeSize?.()[1] || 0),
  ]);

  chainCallback(node, "onConfigure", function () {
    if (this.title?.startsWith(RETIRED_TITLE) && this.constructor?.title) {
      this.title = this.constructor.title + this.title.slice(RETIRED_TITLE.length);
    }
    liftSockets();
    // Restore lands widget values after creation: re-read and repaint. A
    // workflow saved before the latent widgets existed lands its panel's
    // empty placeholder in their slots; put the defaults back.
    if (latentWidget && !["16ch", "4ch", "128ch"].includes(latentWidget.value)) latentWidget.value = "16ch";
    if (batchWidget && !(Number.isInteger(batchWidget.value) && batchWidget.value >= 1)) batchWidget.value = 1;
    restorePolicy(state);
    buildPanel(state);
    requestAnimationFrame(() => { if (!state.disposed) { syncPrimitiveLinks(state); repaint(state); } });
  });
  chainCallback(node, "onConnectionsChange", function () {
    requestAnimationFrame(() => {
      if (state.disposed) return;
      syncPrimitiveLinks(state);
      // A removed Primitive can leave its last value in the backing widget.
      if (state.strict) restorePolicy(state);
      repaint(state);
    });
  });
  chainCallback(node, "onRemoved", () => {
    state.disposed = true;
    state.dragAbort?.abort();
    state.resizeObserver?.disconnect();
    clearTimeout(state.easeTimer);
  });
}

app.registerExtension({
  name: "AusBoss.Resolution",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    markSocketless(nodeData, ["workflow_sizes"]);
    hideInputsInDef(nodeData, ["width", "height", "latent", "batch_size", "workflow_sizes"]);
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      installResolutionNode(this);
    });
  },
});
