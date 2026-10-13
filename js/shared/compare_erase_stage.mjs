// Image Compare A/B: the Erase mode's canvas, brush and tools.
//
// One picture lies on top of the other and the brush rubs the top one away.
// The node keeps the strokes (compare_erase.mjs), and this file draws them:
// a mask canvas holds what has been rubbed away, and the view shows the
// picture underneath with the top picture, less that mask, over it. Save
// sends the strokes to the server, which builds the mix at full size.
import { api } from "/scripts/api.js";
import { BRAND, notifyAusbossChange, showToast } from "./index.mjs";
import { keepKeyInField } from "./canvas_passthrough.mjs";
import { makeScrubInput } from "./scrub_input.mjs";
import { makeSlideSwitch } from "./slide_switch.mjs";
import { extendStroke } from "./touch_math.mjs";
import { makeToolButton } from "./video_ui.mjs";
import {
  ERASE_OUTSIDE,
  ERASE_SIZE,
  ERASE_SOFT_DEFAULT,
  brushCore,
  brushSigma,
  clampSize,
  clampSoft,
  defaultBrushSize,
  fitRect,
  makeStroke,
  moveAdjust,
  nameHint,
  normalizeTop,
  previewScale,
  readPaint,
  saveRequest,
  savedMessage,
  startAdjust,
  steppedSize,
  steppedSoft,
  strokeFits,
  typedName,
} from "./compare_erase.mjs";

// The heights of the tool row above the picture and the save row under it,
// and the width the tools need side by side.
export const ERASE_BAR_HEIGHT = 24;
export const SAVE_ROW_HEIGHT = 28;
export const ERASE_MIN_WIDTH = 540;

// Saved with the workflow: the paint, the brush once it was set by hand,
// which picture is on top, and whether Save writes the layers too.
const PAINT_PROPERTY = "ausboss_compare_paint";
const SIZE_PROPERTY = "ausboss_compare_brush";
const SOFT_PROPERTY = "ausboss_compare_soft";
const TOP_PROPERTY = "ausboss_compare_top";
const LAYERS_PROPERTY = "ausboss_compare_layers";
const NAME_PROPERTY = "ausboss_compare_name";
// A floppy disk, drawn here: the corner cut off, the label, the shutter.
const SAVE_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">'
  + '<path d="M2.5 2.5h8.4l2.6 2.6v8.4h-11z"/><path d="M5.2 2.7v3.3h4.6V2.7"/><path d="M4.9 13.3V9.6h6.2v3.7"/></svg>';
const SAVE_ROUTE = "/ausboss/compare/save";
const UNDO_KEPT = 60;
// The view is drawn at the size it has on screen, up to this many pixels.
const VIEW_SIDE = 2600;
// The brush shown around the pointer: the pack's teal where it rubs away,
// coral where it paints back, as on Mask by Touch.
const RUB_TINT = BRAND;
const RUB_RING = "#78fff0";
const BACK_TINT = "#ff9678";
const BACK_RING = "#ffb49c";
// How strongly the brush's shape tints the picture under the pointer: light
// while aiming, stronger while the brush itself is being set.
const TINT_AIMING = 0.4;
const TINT_SETTING = 0.62;

// A blurred stroke in one call where the browser can filter a canvas; a
// shadow whose own shape is drawn off the canvas where it cannot (Safari).
const CAN_FILTER = typeof CanvasRenderingContext2D !== "undefined" && "filter" in CanvasRenderingContext2D.prototype;

export const ERASE_CSS = `
.ausboss-compare-erasebar{display:none;box-sizing:border-box;align-items:center;gap:6px;flex:none;height:${ERASE_BAR_HEIGHT}px;}
.ausboss-compare-root.is-erasing .ausboss-compare-erasebar{display:flex;}
.ausboss-compare-erasebar .ausboss-scrub{flex:none;}
.ausboss-compare-field{display:flex;align-items:center;gap:4px;flex:none;}
.ausboss-compare-label{flex:none;color:#9fb6b4;font-size:10px;line-height:22px;white-space:nowrap;user-select:none;}
.ausboss-compare-gap{flex:1 1 auto;min-width:0;}
.ausboss-compare-saverow{display:none;box-sizing:border-box;align-items:center;gap:8px;flex:none;height:${SAVE_ROW_HEIGHT}px;}
.ausboss-compare-root.is-erasing .ausboss-compare-saverow{display:flex;}
.ausboss-compare-name{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:4px;}
.ausboss-compare-name input{box-sizing:border-box;flex:1 1 auto;min-width:40px;width:40px;height:24px;padding:0 7px;border:1px solid #3a4047;border-radius:5px;background:#0f1516;color:#d8eeee;font:11px/22px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;outline:none;}
.ausboss-compare-name input:focus{border-color:${BRAND};}
.ausboss-compare-name input:disabled{color:#7f9896;border-style:dashed;}
.ausboss-compare-name input::placeholder{color:#5f7674;}
.ausboss-compare-savebtn{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;gap:6px;height:${SAVE_ROW_HEIGHT}px;padding:0 14px 0 11px;border:1px solid ${BRAND};border-radius:6px;background:${BRAND};color:#04201d;font:700 11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.04em;cursor:pointer;box-shadow:0 0 9px rgba(0,180,170,.32);}
.ausboss-compare-savebtn:hover{background:#19cdc2;border-color:#19cdc2;}
.ausboss-compare-savebtn:disabled{background:#16302e;border-color:#23504c;color:#5f8a86;box-shadow:none;cursor:default;}
.ausboss-compare-root .ausboss-video-tool:disabled{opacity:.42;cursor:default;pointer-events:none;}
.ausboss-compare-erase{position:absolute;inset:0;width:100%;height:100%;display:none;cursor:crosshair;touch-action:none;}
.ausboss-compare-stage.is-erasing:not(.is-empty) .ausboss-compare-erase{display:block;}
.ausboss-compare-stage.is-erasing img,.ausboss-compare-stage.is-erasing .ausboss-compare-seam,.ausboss-compare-stage.is-erasing .ausboss-compare-identity{display:none;}
`;

function sized(canvas, width, height) {
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return canvas.getContext("2d");
}

// One stroke onto a mask, `scale` mask pixels to a pixel of the picture.
// What the mask holds is how much of the top picture is gone: a stroke that
// rubs away adds to it, one that brings back takes from it, each by the
// brush's solid middle blurred into its soft edge.
function drawStroke(ctx, stroke, scale) {
  const soft = stroke.s / 100;
  const core = Math.max(0.01, brushCore(stroke.d, soft) * scale);
  const sigma = brushSigma(stroke.d, soft) * scale;
  const path = stroke.p;
  let shift = 0;
  ctx.save();
  ctx.globalCompositeOperation = stroke.o ? "source-over" : "destination-out";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = core * 2;
  ctx.strokeStyle = "#000";
  ctx.fillStyle = "#000";
  if (sigma >= 0.25) {
    if (CAN_FILTER) {
      ctx.filter = `blur(${sigma.toFixed(3)}px)`;
    } else {
      // Far enough that the stroke itself never lands on the canvas.
      shift = Math.ceil(ctx.canvas.width + 2 * (ERASE_OUTSIDE * scale + core + 3 * sigma) + 16);
      ctx.shadowColor = "#000";
      ctx.shadowBlur = sigma * 2;
      ctx.shadowOffsetX = shift;
    }
  }
  ctx.beginPath();
  if (path.length === 2) {
    ctx.arc(path[0] * scale - shift, path[1] * scale, core, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(path[0] * scale - shift, path[1] * scale);
    for (let index = 2; index < path.length; index += 2) ctx.lineTo(path[index] * scale - shift, path[index + 1] * scale);
    ctx.stroke();
  }
  ctx.restore();
}

// The brush as one dab in a colour: its solid middle and its soft edge, at
// the size it has in the view. Kept until the brush or the view changes.
function dabOf(er, size, soft, scale, colour) {
  const key = `${size}|${soft}|${scale.toFixed(5)}|${colour}`;
  const reach = Math.ceil((brushCore(size, soft / 100) + 3 * brushSigma(size, soft / 100)) * scale) + 2;
  if (reach * 2 > 4096) return null;
  if (er.dabKey !== key) {
    const ctx = sized(er.dab, reach * 2, reach * 2);
    ctx.clearRect(0, 0, reach * 2, reach * 2);
    drawStroke(ctx, { o: 1, d: size, s: soft, p: [reach / scale, reach / scale] }, scale);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, reach * 2, reach * 2);
    ctx.globalCompositeOperation = "source-over";
    er.dabKey = key;
  }
  return { canvas: er.dab, reach };
}

function topOf(er) {
  return normalizeTop(er.node.properties?.[TOP_PROPERTY]);
}

function brushSize(er) {
  const stored = Number(er.node.properties?.[SIZE_PROPERTY]);
  // Until it is set by hand the brush follows the picture.
  return Number.isFinite(stored) && stored > 0 ? clampSize(stored) : defaultBrushSize(er.width, er.height);
}

function brushSoft(er) {
  const stored = er.node.properties?.[SOFT_PROPERTY];
  return stored == null ? ERASE_SOFT_DEFAULT : clampSoft(stored);
}

function setProperty(er, name, value) {
  er.node.properties ??= {};
  er.node.properties[name] = value;
}

// The mask from every kept stroke, drawn afresh.
function rebuildMask(er) {
  const scale = er.maskScale = previewScale(er.width, er.height);
  const ctx = sized(er.mask, Math.max(1, Math.round(er.width * scale)), Math.max(1, Math.round(er.height * scale)));
  ctx.clearRect(0, 0, er.mask.width, er.mask.height);
  for (const stroke of er.strokes) drawStroke(ctx, stroke, scale);
}

function schedule(er) {
  if (er.frame || !er.active) return;
  er.frame = requestAnimationFrame(() => draw(er));
}

// The view's own pixels follow its size on screen, so the picture stays
// sharp when the graph is zoomed in, and never fall under its layout size.
function sizeView(er) {
  const rect = er.canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  let width = Math.max(rect.width, er.canvas.clientWidth) * ratio;
  let height = Math.max(rect.height, er.canvas.clientHeight) * ratio;
  const over = Math.max(width, height) / VIEW_SIDE;
  if (over > 1) {
    width /= over;
    height /= over;
  }
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  // A few pixels either way are not worth a new canvas.
  if (Math.abs(er.canvas.width - width) > 2 || Math.abs(er.canvas.height - height) > 2) {
    er.canvas.width = width;
    er.canvas.height = height;
  }
}

function draw(er) {
  er.frame = 0;
  if (!er.active || !er.refs) return;
  sizeView(er);
  const { canvas } = er;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const box = fitRect(canvas.width, canvas.height, er.width, er.height);
  const width = Math.max(1, Math.round(box.width));
  const height = Math.max(1, Math.round(box.height));
  const fit = er.fit = { left: Math.round(box.left), top: Math.round(box.top), width, height, scale: width / er.width };
  const [top, under] = topOf(er) === "B" ? [er.imageB, er.imageA] : [er.imageA, er.imageB];

  // The mask as it stands: the kept strokes, and the one being drawn.
  let mask = er.mask;
  if (er.stroke) {
    const live = sized(er.live, width, height);
    live.globalCompositeOperation = "copy";
    live.drawImage(er.mask, 0, 0, width, height);
    drawStroke(live, { o: er.stroke.back ? 0 : 1, d: er.stroke.size, s: er.stroke.soft, p: er.stroke.points.flat() }, fit.scale);
    mask = er.live;
  }
  // The top picture with the mask cut out of it, over the other picture.
  // A picture of another size is fitted to A's, as the saved mix does.
  const cut = sized(er.cut, width, height);
  cut.globalCompositeOperation = "copy";
  cut.drawImage(top, 0, 0, width, height);
  cut.globalCompositeOperation = "destination-out";
  cut.drawImage(mask, 0, 0, width, height);
  ctx.drawImage(under, fit.left, fit.top, width, height);
  ctx.drawImage(er.cut, fit.left, fit.top);

  // The brush around the pointer: its shape as a tint (the solid middle and
  // the soft edge), and a ring at its full size. While a stroke is drawn
  // only the ring stays, so the paint is not hidden.
  const setting = er.adjust;
  const at = setting ? setting.anchor : er.pointer;
  if (at) {
    const size = er.stroke?.size ?? brushSize(er);
    const soft = er.stroke?.soft ?? brushSoft(er);
    const back = !setting && (er.stroke ? er.stroke.back : er.back !== Boolean(er.altKey));
    const x = fit.left + at[0] * fit.scale;
    const y = fit.top + at[1] * fit.scale;
    const line = Math.max(1, canvas.width / Math.max(1, canvas.getBoundingClientRect().width));
    const dab = er.stroke ? null : dabOf(er, size, soft, fit.scale, back ? BACK_TINT : RUB_TINT);
    if (dab) {
      ctx.globalAlpha = setting ? TINT_SETTING : TINT_AIMING;
      ctx.drawImage(dab.canvas, Math.round(x - dab.reach), Math.round(y - dab.reach));
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1.5, (size / 2) * fit.scale), 0, Math.PI * 2);
    ctx.lineWidth = 3 * line;
    ctx.strokeStyle = "rgba(0,0,0,.55)";
    ctx.stroke();
    ctx.lineWidth = 1.3 * line;
    ctx.strokeStyle = back ? BACK_RING : RUB_RING;
    ctx.stroke();
    if (setting) {
      // Where the solid middle ends: the ring that moves when the edge is
      // made softer or harder.
      const core = brushCore(size, soft / 100) * fit.scale;
      if (core >= 2) {
        ctx.beginPath();
        ctx.arc(x, y, core, 0, Math.PI * 2);
        ctx.setLineDash([4 * line, 4 * line]);
        ctx.lineWidth = 1.2 * line;
        ctx.strokeStyle = "rgba(255,255,255,.85)";
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Both values in words under the brush, the one being set in white.
      const axis = setting.drag.axis;
      const parts = [[`Size ${size} px`, axis !== "soft"], [`Soft ${soft}%`, axis !== "size"]];
      ctx.font = `600 ${Math.round(11 * line)}px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const gap = 10 * line;
      const widths = parts.map(([text]) => ctx.measureText(text).width);
      const width = widths[0] + widths[1] + gap + 14 * line;
      const height = 18 * line;
      const rim = Math.max(1.5, (size / 2) * fit.scale);
      const below = y + rim + 8 * line + height <= canvas.height;
      const top = Math.max(2 * line, below ? y + rim + 8 * line : y - height / 2);
      const left = Math.min(canvas.width - width - 2 * line, Math.max(2 * line, x - width / 2));
      ctx.fillStyle = "rgba(0,0,0,.74)";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(left, top, width, height, 4 * line);
      else ctx.rect(left, top, width, height);
      ctx.fill();
      let textLeft = left + 7 * line;
      parts.forEach(([text, lit], index) => {
        ctx.fillStyle = lit ? "#eafffd" : "#7f9896";
        ctx.fillText(text, textLeft, top + height / 2 + line * 0.5);
        textLeft += widths[index] + gap;
      });
    }
  }
}

// Where the pointer is on the picture, in picture pixels.
function pointOf(er, event) {
  const rect = er.canvas.getBoundingClientRect();
  const fit = er.fit;
  if (!(rect.width > 0) || !(rect.height > 0) || !(fit?.scale > 0)) return null;
  const x = ((event.clientX - rect.left) / rect.width) * er.canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * er.canvas.height;
  return [(x - fit.left) / fit.scale, (y - fit.top) / fit.scale];
}

// Is a name wired into the node's filename input? Then the run names the
// files, and the field on the node only shows that name.
function nameIsWired(er) {
  return er.node.inputs?.some((input) => input?.name === "filename" && input.link != null) ?? false;
}

function syncTools(er) {
  const ready = Boolean(er.refs);
  const top = topOf(er);
  const other = top === "A" ? "B" : "A";
  er.kindSwitch.set(er.back !== Boolean(er.altKey) ? "restore" : "erase");
  er.kindSwitch.describe("erase", { title: `The brush rubs ${top} away, so ${other} shows through.` });
  er.kindSwitch.describe("restore", { title: `The brush paints ${top} back. Holding Alt, or the right mouse button, does the same.` });
  er.topSwitch.set(top);
  const layers = er.node.properties?.[LAYERS_PROPERTY] === true;
  er.layersSwitch.set(layers ? "on" : "off");
  er.undoButton.disabled = !er.history.length && !er.strokes.length;
  er.clearButton.disabled = !er.strokes.length;
  er.saveButton.disabled = !ready || er.saving;
  er.saveLabel.textContent = er.saving ? "Saving" : "Save";
  // The name: typed here, or shown as the run got it from the input.
  const wired = nameIsWired(er);
  const typed = String(er.node.properties?.[NAME_PROPERTY] ?? "");
  er.nameInput.disabled = wired;
  if (wired) er.nameInput.value = er.refs?.name || "";
  else if (document.activeElement !== er.nameInput) er.nameInput.value = typed;
  er.nameInput.placeholder = wired ? "from the filename input" : "compare";
  const hint = nameHint(wired ? er.refs?.name : typed, layers);
  er.nameInput.title = wired
    ? `The filename input names the files: ${hint}. They go to ComfyUI's output folder.`
    : `What the saved files are called. Save writes ${hint} to ComfyUI's output folder, and the number counts up. Letters, digits, spaces, dots, dashes and underscores.`;
  er.saveButton.title = ready
    ? `Save this mix to ComfyUI's output folder as ${hint}. Nothing is run again.`
    : "Run the workflow first: Save needs the two pictures.";
}

// Keep the strokes with the node, so a tab switch or ComfyUI's own undo
// finds them again.
function keep(er) {
  setProperty(er, PAINT_PROPERTY, { w: er.width, h: er.height, strokes: er.strokes });
  notifyAusbossChange();
}

function change(er, strokes) {
  er.history.push(er.strokes);
  if (er.history.length > UNDO_KEPT) er.history.shift();
  er.strokes = strokes;
  keep(er);
  syncTools(er);
}

function finishStroke(er, event, cancelled) {
  const stroke = er.stroke;
  if (!stroke || (event && event.pointerId !== stroke.id)) return;
  er.stroke = null;
  try { er.canvas.releasePointerCapture?.(stroke.id); } catch { /* already released */ }
  if (!cancelled) {
    const made = makeStroke(stroke.points, { erase: !stroke.back, size: stroke.size, soft: stroke.soft }, er.width, er.height);
    if (made && strokeFits(er.strokes, made)) {
      change(er, [...er.strokes, made]);
      drawStroke(er.mask.getContext("2d"), made, er.maskScale);
    } else if (made) {
      showToast({ severity: "warn", detail: "This mix holds as much paint as it can. Save it, or press Clear to start again." });
    }
  }
  schedule(er);
}

function setSize(er, size) {
  const next = clampSize(size);
  if (er.node.properties?.[SIZE_PROPERTY] === next) return;
  setProperty(er, SIZE_PROPERTY, next);
  er.sizeBox.set(next);
  schedule(er);
}

function setSoft(er, soft) {
  const next = clampSoft(soft);
  if (er.node.properties?.[SOFT_PROPERTY] === next) return;
  setProperty(er, SOFT_PROPERTY, next);
  er.softBox.set(next);
  schedule(er);
}

// The brush drag is over: keep what it set, or put the brush back.
function finishAdjust(er, event, cancelled) {
  const adjust = er.adjust;
  if (!adjust || (event && event.pointerId !== adjust.id)) return;
  er.adjust = null;
  try { er.canvas.releasePointerCapture?.(adjust.id); } catch { /* already released */ }
  if (cancelled) {
    setSize(er, adjust.size);
    setSoft(er, adjust.soft);
  } else if (brushSize(er) !== adjust.size || brushSoft(er) !== adjust.soft) {
    notifyAusbossChange();
  }
  schedule(er);
}

function onKey(er, event, down) {
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
  if (event.key === "Alt") {
    event.preventDefault();
    er.altKey = down;
    syncTools(er);
    schedule(er);
    return;
  }
  // Ctrl+Z and Ctrl+Y stay ComfyUI's own: a stroke is a change to the graph,
  // so its undo takes strokes back too.
  if (!down || event.ctrlKey || event.metaKey) return;
  if (event.key === "Escape" && (er.stroke || er.adjust)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    finishStroke(er, null, true);
    finishAdjust(er, null, true);
    return;
  }
  // [ and ] for the size, with Shift for the edge, as in Photoshop. The key
  // is read by its place on the keyboard too: with Shift it types { and }.
  const smaller = event.code === "BracketLeft" || event.key === "[" || event.key === "{";
  const larger = event.code === "BracketRight" || event.key === "]" || event.key === "}";
  if (smaller || larger) {
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) setSoft(er, steppedSoft(brushSoft(er), smaller));
    else setSize(er, steppedSize(brushSize(er), larger));
    notifyAusbossChange();
  }
}

function installPointer(er, signal) {
  const { canvas } = er;
  canvas.addEventListener("pointerdown", (event) => {
    // The middle button pans the graph, as everywhere else.
    if (!er.refs || (event.button !== 0 && event.button !== 2) || er.stroke || er.adjust) return;
    const point = pointOf(er, event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    try { canvas.setPointerCapture?.(event.pointerId); } catch { /* a pointer that is already gone */ }
    er.pointer = point;
    // Alt and the right button together set the brush (on a Mac: Control
    // and Option with a click). Either one alone paints back.
    if (event.altKey && (event.button === 2 || event.ctrlKey)) {
      const rect = canvas.getBoundingClientRect();
      er.adjust = {
        id: event.pointerId,
        // The brush as it was, for Escape, and the drag as it goes.
        size: brushSize(er),
        soft: brushSoft(er),
        drag: startAdjust(event.clientX, event.clientY, { size: brushSize(er), soft: brushSoft(er) }),
        anchor: point,
        // Pixels of the picture under one pixel of the screen.
        perPixel: canvas.width / Math.max(1, rect.width) / er.fit.scale,
      };
      schedule(er);
      return;
    }
    er.stroke = {
      id: event.pointerId,
      back: event.button === 2 || er.back !== event.altKey,
      size: brushSize(er),
      soft: brushSoft(er),
      points: [point],
    };
    schedule(er);
  }, { signal });
  canvas.addEventListener("pointermove", (event) => {
    const point = pointOf(er, event);
    if (!point) return;
    er.pointer = point;
    const adjust = er.adjust;
    if (adjust && event.pointerId === adjust.id) {
      adjust.drag = moveAdjust(adjust.drag, event.clientX, event.clientY, adjust.perPixel);
      setSize(er, adjust.drag.brush.size);
      setSoft(er, adjust.drag.brush.soft);
      schedule(er);
      return;
    }
    if (er.altKey !== event.altKey) {
      er.altKey = event.altKey;
      syncTools(er);
    }
    const stroke = er.stroke;
    if (stroke && event.pointerId === stroke.id) extendStroke(stroke.points, point[0], point[1], Math.max(1, stroke.size / 12));
    schedule(er);
  }, { signal });
  canvas.addEventListener("pointerup", (event) => { finishStroke(er, event, false); finishAdjust(er, event, false); }, { signal });
  canvas.addEventListener("pointercancel", (event) => { finishStroke(er, event, true); finishAdjust(er, event, true); }, { signal });
  canvas.addEventListener("pointerenter", () => {
    if (er.keys) return;
    er.keys = new AbortController();
    const options = { signal: er.keys.signal, capture: true };
    window.addEventListener("keydown", (event) => onKey(er, event, true), options);
    window.addEventListener("keyup", (event) => onKey(er, event, false), options);
  }, { signal });
  canvas.addEventListener("pointerleave", () => {
    if (er.stroke || er.adjust) return;
    er.keys?.abort();
    er.keys = null;
    er.pointer = null;
    er.altKey = false;
    syncTools(er);
    schedule(er);
  }, { signal });
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
  }, { signal });
  signal.addEventListener("abort", () => er.keys?.abort());
}

async function save(er) {
  if (er.saving || !er.refs) return;
  er.saving = true;
  syncTools(er);
  try {
    const response = await api.fetchApi(SAVE_ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(saveRequest({
        pair: er.refs.pair,
        top: topOf(er),
        strokes: er.strokes,
        layers: er.node.properties?.[LAYERS_PROPERTY] === true,
        name: er.node.properties?.[NAME_PROPERTY],
      })),
    });
    const answer = await response.json().catch(() => null);
    if (!response.ok) {
      // No words from the route: this ComfyUI started before the update.
      const missing = (response.status === 404 || response.status === 405) && !answer?.error;
      throw new Error(missing ? "Restart ComfyUI once, then save: the AusBoss update is only half loaded." : (answer?.error || `The server answered ${response.status}.`));
    }
    showToast({ severity: "success", summary: "Image Compare", detail: savedMessage(answer?.files) });
    er.onSaved?.(answer?.files ?? []);
  } catch (error) {
    showToast({ severity: "error", summary: "Image Compare", detail: String(error?.message ?? error), life: 8000 });
  } finally {
    er.saving = false;
    syncTools(er);
  }
}

// Build the Erase tools for one Compare panel. `onSaved` is told which
// files a save wrote. The caller places `bar` above the stage and
// `saveRow` under its footer, and tells the eraser when the mode or the
// pictures change.
export function makeEraser({ node, root, stage, imageA, imageB, signal, onSaved }) {
  const er = {
    node, root, stage, imageA, imageB, onSaved,
    canvas: document.createElement("canvas"),
    mask: document.createElement("canvas"),
    live: document.createElement("canvas"),
    cut: document.createElement("canvas"),
    dab: document.createElement("canvas"),
    dabKey: "",
    maskScale: 1,
    refs: null, width: 0, height: 0, fit: null,
    strokes: [], history: [],
    active: false, stroke: null, adjust: null, pointer: null, back: false, altKey: false,
    saving: false, frame: 0, keys: null,
  };
  er.canvas.className = "ausboss-compare-erase";
  stage.append(er.canvas);

  const click = (button, action) => {
    button.addEventListener("pointerdown", (event) => event.stopPropagation(), { signal });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      action(event);
    }, { signal });
    return button;
  };

  const labelled = (name, help, ...controls) => {
    const wrap = document.createElement("div");
    wrap.className = "ausboss-compare-field";
    const label = document.createElement("span");
    label.className = "ausboss-compare-label";
    label.textContent = name;
    label.title = help;
    wrap.append(label, ...controls);
    return { wrap, label };
  };

  // The tool row above the picture: what the brush does, its size and
  // edge, which picture is on top, and taking strokes back.
  er.bar = document.createElement("div");
  er.bar.className = "ausboss-compare-erasebar";
  er.kindSwitch = makeSlideSwitch({
    label: "What the brush does",
    options: [{ value: "erase", label: "Erase" }, { value: "restore", label: "Restore" }],
    value: "erase",
    signal,
    onChange: (value) => { er.back = value === "restore"; syncTools(er); schedule(er); },
  });
  const SIZE_HELP = "How wide the brush is, in pixels of the picture. Drag here or on the number to change it. Also: the [ and ] keys, or hold Alt and the right mouse button on the picture and drag left or right.";
  const SOFT_HELP = "How soft the brush's edge is: 0 is a hard edge, 100 fades all the way from the middle. Drag here or on the number to change it. Also: Shift with [ and ], or hold Alt and the right mouse button on the picture and drag up (softer) or down (harder).";
  er.sizeBox = makeScrubInput({
    value: brushSize(er),
    min: ERASE_SIZE[0],
    max: ERASE_SIZE[1],
    step: 2,
    fineStep: 1,
    decimals: 0,
    width: 66,
    unit: "px",
    title: SIZE_HELP,
    onChange: (value) => setSize(er, value),
    onSettle: () => notifyAusbossChange(),
  });
  er.softBox = makeScrubInput({
    value: brushSoft(er),
    min: 0,
    max: 100,
    step: 5,
    fineStep: 1,
    decimals: 0,
    width: 58,
    unit: "%",
    title: SOFT_HELP,
    onChange: (value) => { setProperty(er, SOFT_PROPERTY, clampSoft(value)); schedule(er); },
    onSettle: () => notifyAusbossChange(),
  });
  // Each number with its name in front of it. The name scrubs the number
  // too, and so does the unit inside the box: the whole field is one handle.
  const scrubField = (name, box, help) => {
    const { wrap, label } = labelled(name, help, box.root);
    box.input.setAttribute("aria-label", name);
    box.handle(label);
    box.handle(box.root);
    wrap.addEventListener("pointerdown", (event) => event.stopPropagation(), { signal });
    return wrap;
  };
  const sizeField = scrubField("Size", er.sizeBox, SIZE_HELP);
  const softField = scrubField("Soft", er.softBox, SOFT_HELP);
  const TOP_HELP = "Which picture you start from. The brush shows the other one through it. Swapping keeps your paint.";
  er.topSwitch = makeSlideSwitch({
    label: "The picture on top",
    options: [{ value: "A", label: "A", title: "A is on top; the brush shows B." }, { value: "B", label: "B", title: "B is on top; the brush shows A." }],
    value: topOf(er),
    signal,
    onChange: (value) => {
      if (value === topOf(er)) return;
      setProperty(er, TOP_PROPERTY, value);
      notifyAusbossChange();
      syncTools(er);
      schedule(er);
    },
  });
  const topField = labelled("On top", TOP_HELP, er.topSwitch.root).wrap;
  const gap = document.createElement("div");
  gap.className = "ausboss-compare-gap";
  er.undoButton = click(makeToolButton("UNDO", "Take back the last stroke, or a Clear."), () => {
    if (!er.history.length && !er.strokes.length) return;
    // Paint that came with the workflow has no steps of its own to go back
    // through: its last stroke is taken off.
    er.strokes = er.history.length ? er.history.pop() : er.strokes.slice(0, -1);
    keep(er);
    rebuildMask(er);
    syncTools(er);
    schedule(er);
  });
  er.clearButton = click(makeToolButton("CLEAR", "Take all the paint off. Undo brings it back."), () => {
    if (!er.strokes.length) return;
    change(er, []);
    rebuildMask(er);
    schedule(er);
  });
  er.bar.append(er.kindSwitch.root, sizeField, softField, topField, gap, er.undoButton, er.clearButton);

  // The save row under the picture: the name, the layers choice, and Save
  // at the right end, where the eye ends up.
  er.saveRow = document.createElement("div");
  er.saveRow.className = "ausboss-compare-saverow";
  const nameField = labelled("Name", "What the saved files are called.");
  nameField.wrap.classList.add("ausboss-compare-name");
  er.nameInput = document.createElement("input");
  er.nameInput.type = "text";
  er.nameInput.spellcheck = false;
  er.nameInput.maxLength = 80;
  er.nameInput.setAttribute("aria-label", "File name");
  er.nameInput.addEventListener("pointerdown", (event) => event.stopPropagation(), { signal });
  er.nameInput.addEventListener("keydown", (event) => {
    keepKeyInField(event);
    if (event.key === "Enter" || event.key === "Escape") er.nameInput.blur();
  }, { signal });
  er.nameInput.addEventListener("input", () => {
    // Only what a file name can hold stays in the field, as it is typed.
    const clean = typedName(er.nameInput.value);
    if (clean !== er.nameInput.value) er.nameInput.value = clean;
    setProperty(er, NAME_PROPERTY, clean);
  }, { signal });
  er.nameInput.addEventListener("change", () => { notifyAusbossChange(); syncTools(er); }, { signal });
  nameField.wrap.append(er.nameInput);
  const LAYERS_HELP = "On: Save also writes one PSD with both pictures as layers and your paint as a layer mask on the top one, for Photoshop or GIMP, and the mask as its own PNG. Off: the PNG only.";
  er.layersSwitch = makeSlideSwitch({
    label: "Save a PSD with the layers too",
    offLeft: true,
    options: [{ value: "off", label: "off", title: LAYERS_HELP }, { value: "on", label: "on", title: LAYERS_HELP }],
    value: "off",
    signal,
    onChange: (value) => {
      setProperty(er, LAYERS_PROPERTY, value === "on");
      notifyAusbossChange();
      syncTools(er);
    },
  });
  const layersField = labelled("PSD", LAYERS_HELP, er.layersSwitch.root).wrap;
  er.saveButton = document.createElement("button");
  er.saveButton.type = "button";
  er.saveButton.className = "ausboss-compare-savebtn";
  er.saveButton.innerHTML = SAVE_ICON;
  er.saveLabel = document.createElement("span");
  er.saveLabel.textContent = "Save";
  er.saveButton.append(er.saveLabel);
  click(er.saveButton, () => save(er));
  er.saveRow.append(nameField.wrap, layersField, er.saveButton);

  installPointer(er, signal);
  const resized = new ResizeObserver(() => schedule(er));
  resized.observe(stage);
  signal.addEventListener("abort", () => {
    resized.disconnect();
    if (er.frame) cancelAnimationFrame(er.frame);
    er.frame = 0;
    er.active = false;
  });
  syncTools(er);

  return {
    bar: er.bar,
    saveRow: er.saveRow,
    get active() { return er.active; },
    // Erase mode on or off.
    setActive(on) {
      er.active = Boolean(on);
      root.classList.toggle("is-erasing", er.active);
      stage.classList.toggle("is-erasing", er.active);
      if (!er.active) {
        finishStroke(er, null, true);
        finishAdjust(er, null, true);
      }
      syncTools(er);
      schedule(er);
    },
    // Both pictures are loaded (or, with null, on their way). The paint is
    // read from the node, and kept only while the picture keeps its size.
    setPictures(refs) {
      const ready = Boolean(refs && imageA.naturalWidth > 0 && imageB.naturalWidth > 0);
      er.refs = ready ? refs : null;
      finishStroke(er, null, true);
      finishAdjust(er, null, true);
      if (ready) {
        const width = imageA.naturalWidth;
        const height = imageA.naturalHeight;
        const stored = er.node.properties?.[PAINT_PROPERTY];
        // The same picture size and the paint this panel put there itself:
        // nothing to read again, and Undo keeps its steps.
        const same = width === er.width && height === er.height && stored?.strokes === er.strokes;
        er.width = width;
        er.height = height;
        er.fit = null;
        if (!same) {
          er.strokes = readPaint(stored, width, height).strokes;
          er.history = [];
          rebuildMask(er);
        }
      }
      er.sizeBox.set(brushSize(er));
      er.softBox.set(brushSoft(er));
      syncTools(er);
      schedule(er);
    },
    redraw: () => schedule(er),
    // Something outside changed what the tools show (a link on the
    // filename input).
    refresh: () => syncTools(er),
  };
}
