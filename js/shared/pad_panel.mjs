// The on-node padding stage: dotted backdrop, source bitmap (or wireframe),
// the FINAL canvas rect with whole-edge drag handles, per-side "+N px"
// labels, and the output-size badge. Shared by js/load_image_pad/index.js
// (file-fed source) and js/pad_image/index.js (execution-fed source).
//
// Pure math lives in pad_canvas.mjs; this module owns canvas drawing and
// pointer wiring only, with everything node-specific injected:
//   getSource() -> { bitmap, width, height, known, emptyText }
//   getValues() -> { pad_left/top/right/bottom, canvas_multiple, target_megapixels }
//   writePad(side, value)   write one raw pad widget (with callbacks)
//   onGestureEnd()          called once per completed drag

import { canvasLocalPoint } from "./transform_geometry.mjs";
import {
  edgeCursor,
  finalOutputSize,
  fitRect,
  hitPadEdge,
  labelMode,
  padDragValue,
  padGeometry,
} from "./pad_canvas.mjs";

const MARGIN = 26;
const FONT = "11px system-ui, sans-serif";
const PAD_TINT = "rgba(255,157,66,0.16)"; // orange = padding, per the pack grammar
const PAD_LINE = "#ff9d42";
const IMAGE_LINE = "rgba(216,238,238,0.55)";

function cssSize(canvas) {
  const bounds = canvas.getBoundingClientRect();
  return {
    w: Math.max(1, canvas.clientWidth || bounds.width || 1),
    h: Math.max(1, canvas.clientHeight || bounds.height || 1),
  };
}

function resizeForDpr(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const size = cssSize(canvas);
  const pixelW = Math.max(1, Math.round(size.w * dpr));
  const pixelH = Math.max(1, Math.round(size.h * dpr));
  if (canvas.width !== pixelW || canvas.height !== pixelH) {
    canvas.width = pixelW;
    canvas.height = pixelH;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, ...size };
}

function drawBackdrop(ctx, w, h) {
  ctx.fillStyle = "#0c0e10";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  for (let y = 9; y < h; y += 14) {
    for (let x = 9; x < w; x += 14) ctx.fillRect(x, y, 1, 1);
  }
}

function dashedRect(ctx, rect, color, dash) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash(dash);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

function drawPill(ctx, text, cx, cy, accent = false) {
  ctx.save();
  ctx.font = FONT;
  const padX = 7;
  const height = 18;
  const width = ctx.measureText(text).width + padX * 2;
  const x = cx - width / 2;
  const y = cy - height / 2;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 9);
  ctx.fillStyle = "rgba(6,10,11,0.85)";
  ctx.fill();
  ctx.strokeStyle = accent ? "rgba(0,180,170,0.55)" : "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = accent ? "#8de0da" : "#e7f4f2";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy + 0.5);
  ctx.restore();
  return width;
}

function drawBandText(ctx, text, cx, cy) {
  ctx.save();
  ctx.font = FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 3;
  ctx.fillStyle = "#ffe2c2";
  ctx.fillText(text, cx, cy);
  ctx.restore();
}

function pillWidth(ctx, text) {
  ctx.font = FONT;
  return ctx.measureText(text).width + 14;
}

// One side's label: on the band when it is thick enough, otherwise hopped
// just inside the image on a contrast pill. Skipped entirely for untouched
// sides unless that side is mid-drag (live feedback beats quiet).
function drawSideLabel(ctx, side, amount, band, imageRect, dragging) {
  if (amount <= 0 && !dragging) return;
  const text = `+${amount} px`;
  const midX = imageRect.x + imageRect.width / 2;
  const midY = imageRect.y + imageRect.height / 2;
  const onBand = labelMode(band) === "band";
  if (side === "left") {
    if (onBand) drawBandText(ctx, text, imageRect.x - band / 2, midY);
    else drawPill(ctx, text, imageRect.x + 8 + pillWidth(ctx, text) / 2, midY);
  } else if (side === "right") {
    const edge = imageRect.x + imageRect.width;
    if (onBand) drawBandText(ctx, text, edge + band / 2, midY);
    else drawPill(ctx, text, edge - 8 - pillWidth(ctx, text) / 2, midY);
  } else if (side === "top") {
    if (onBand) drawBandText(ctx, text, midX, imageRect.y - band / 2);
    else drawPill(ctx, text, midX, imageRect.y + 14);
  } else if (side === "bottom") {
    const edge = imageRect.y + imageRect.height;
    if (onBand) drawBandText(ctx, text, midX, edge + band / 2);
    else drawPill(ctx, text, midX, edge - 14);
  }
}

export function createPadStage(canvas, options) {
  const state = {
    drag: null,
    finalRect: null,
    raf: 0,
    disposed: false,
  };
  const abort = new AbortController();
  const signal = abort.signal;

  function draw() {
    if (state.disposed) return;
    const { ctx, w, h } = resizeForDpr(canvas);
    drawBackdrop(ctx, w, h);
    const source = options.getSource();
    const values = options.getValues();
    const geom = padGeometry(source.width, source.height, values);
    // The render scale/anchor freezes at pointerdown for the whole gesture:
    // a live refit makes the edge slip out from under the pointer as the
    // composition shrinks to fit the growing canvas.
    let render = state.drag?.render;
    if (!render) {
      const fit = fitRect(geom.outputWidth, geom.outputHeight, w, h, MARGIN);
      render = {
        scale: fit.scale,
        imageX: fit.x + geom.left * fit.scale,
        imageY: fit.y + geom.top * fit.scale,
      };
    }
    const scale = render.scale;
    const imageRect = {
      x: render.imageX,
      y: render.imageY,
      width: source.width * scale,
      height: source.height * scale,
    };
    const finalRect = {
      x: render.imageX - geom.left * scale,
      y: render.imageY - geom.top * scale,
      width: geom.outputWidth * scale,
      height: geom.outputHeight * scale,
    };
    state.finalRect = finalRect;

    // Padding tint between the final canvas and the image (evenodd ring).
    ctx.save();
    ctx.beginPath();
    ctx.rect(finalRect.x, finalRect.y, finalRect.width, finalRect.height);
    ctx.rect(imageRect.x, imageRect.y, imageRect.width, imageRect.height);
    ctx.fillStyle = PAD_TINT;
    ctx.fill("evenodd");
    ctx.restore();

    if (source.bitmap) {
      ctx.drawImage(source.bitmap, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
    } else {
      // Wireframe placeholder: the geometry is real, the pixels are not yet.
      ctx.save();
      ctx.fillStyle = "#15181b";
      ctx.fillRect(imageRect.x, imageRect.y, imageRect.width, imageRect.height);
      ctx.strokeStyle = "rgba(216,238,238,0.16)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(imageRect.x, imageRect.y);
      ctx.lineTo(imageRect.x + imageRect.width, imageRect.y + imageRect.height);
      ctx.moveTo(imageRect.x + imageRect.width, imageRect.y);
      ctx.lineTo(imageRect.x, imageRect.y + imageRect.height);
      ctx.stroke();
      ctx.restore();
    }

    dashedRect(ctx, imageRect, IMAGE_LINE, [4, 4]);
    dashedRect(ctx, finalRect, PAD_LINE, [7, 5]);

    const bands = { left: geom.left, top: geom.top, right: geom.right, bottom: geom.bottom };
    for (const side of ["left", "top", "right", "bottom"]) {
      drawSideLabel(
        ctx, side, bands[side], bands[side] * scale, imageRect, state.drag?.side === side,
      );
    }

    if (source.emptyText) {
      ctx.save();
      ctx.font = "12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,0.85)";
      ctx.shadowBlur = 4;
      ctx.fillStyle = "#78908e";
      ctx.fillText(source.emptyText, w / 2, h / 2);
      ctx.restore();
    }

    // The preview is the composition; this badge is the truth — the final
    // output size after the multiple and megapixel math.
    if (source.known) {
      const final = finalOutputSize(source.width, source.height, values);
      const text = `${final.width} × ${final.height}`;
      drawPill(ctx, text, w - 10 - pillWidth(ctx, text) / 2, h - 16, true);
    }
  }

  function scheduleDraw() {
    if (state.raf || state.disposed) return;
    state.raf = requestAnimationFrame(() => {
      state.raf = 0;
      draw();
    });
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || state.drag) return;
    if (!state.finalRect) draw();
    const point = canvasLocalPoint(canvas, event);
    const side = hitPadEdge(point, state.finalRect);
    // No hit: no preventDefault, so the empty stage still drags the node.
    if (!side) return;
    event.preventDefault();
    event.stopPropagation();
    try { canvas.setPointerCapture(event.pointerId); } catch { /* mouse fallback */ }
    const source = options.getSource();
    const values = options.getValues();
    const geom = padGeometry(source.width, source.height, values);
    const { w, h } = cssSize(canvas);
    const fit = fitRect(geom.outputWidth, geom.outputHeight, w, h, MARGIN);
    state.drag = {
      side,
      pointerId: event.pointerId,
      start: point,
      startPads: {
        left: Math.max(0, Number(values.pad_left) || 0),
        top: Math.max(0, Number(values.pad_top) || 0),
        right: Math.max(0, Number(values.pad_right) || 0),
        bottom: Math.max(0, Number(values.pad_bottom) || 0),
      },
      moved: false,
      render: {
        scale: fit.scale,
        imageX: fit.x + geom.left * fit.scale,
        imageY: fit.y + geom.top * fit.scale,
      },
    };
    scheduleDraw();
  }, { signal });

  canvas.addEventListener("pointermove", (event) => {
    const point = canvasLocalPoint(canvas, event);
    if (!state.drag) {
      canvas.style.cursor = edgeCursor(hitPadEdge(point, state.finalRect)) || "default";
      return;
    }
    const drag = state.drag;
    const dx = (point.x - drag.start.x) / drag.render.scale;
    const dy = (point.y - drag.start.y) / drag.render.scale;
    const next = padDragValue(drag.side, drag.startPads, dx, dy);
    const current = Math.max(0, Number(options.getValues()[`pad_${drag.side}`]) || 0);
    if (next !== current) {
      drag.moved = true;
      options.writePad(drag.side, next);
    }
    scheduleDraw();
  }, { signal });

  function endDrag() {
    const drag = state.drag;
    if (!drag) return;
    state.drag = null;
    try { canvas.releasePointerCapture(drag.pointerId); } catch { /* already released */ }
    if (drag.moved) options.onGestureEnd?.();
    scheduleDraw();
  }
  canvas.addEventListener("pointerup", endDrag, { signal });
  canvas.addEventListener("pointercancel", endDrag, { signal });
  canvas.addEventListener("mouseleave", () => {
    if (state.drag) endDrag();
    else canvas.style.cursor = "default";
  }, { signal });

  // node.onResize is unreliable across frontends; the observer catches every
  // wrapper size change (node resize, zoom relayout) in one place.
  const observer = new ResizeObserver(() => scheduleDraw());
  observer.observe(canvas);

  return {
    draw: scheduleDraw,
    dispose() {
      state.disposed = true;
      if (state.raf) cancelAnimationFrame(state.raf);
      observer.disconnect();
      abort.abort();
    },
  };
}
