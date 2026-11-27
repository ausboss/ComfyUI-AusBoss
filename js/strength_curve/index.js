// Strength Curve 🆎: the curve is drawn on the node. Drag a point, double-
// click to add one, right-click to take one away; the chips start from a
// common shape. The points are kept in the node's hidden "points" widget,
// which is what the workflow saves and what the run reads. Top and Bottom
// (high and low) are on the card under the curve.
//
// The line is the one the node outputs: js/shared/strength_curve_math.mjs
// draws the same curve as nodes/_curve_helpers.py.

import { app } from "../../../scripts/app.js";
import { chainCallback, keepDomWidgetWidthAuto } from "../shared/index.mjs";
import { compactAction, CAPTION_TYPE, HINT_TYPE } from "../shared/panel_controls.mjs";
import { WIDGET_FRAME, fillNodeHeight } from "../shared/panel_layout.mjs";
import { makeScrubInput } from "../shared/scrub_input.mjs";
import {
  MIN_GAP, PRESETS, addPoint, curveValues, movePoint, parsePoints, pointsText, presetOf, removePoint, strengthOf, tagPlace,
} from "../shared/strength_curve_math.mjs";
import { FONT_UI, RADIUS_CONTROL, THEME as T } from "../shared/theme.mjs";
import { commitWidgetValue } from "../shared/widget_card_math.mjs";

const NODE_CLASS = "AUSBOSS_NODES_StrengthCurve";
const CSS_ID = "ausboss-strength-curve-css";
const WIDGET_NAME = "ausboss_strength_curve_panel";
const PANEL_MIN_WIDTH = 320;
const STAGE_MIN_HEIGHT = 130;
const PANEL_MIN_HEIGHT = 22 + 6 + STAGE_MIN_HEIGHT + 6 + 26 + 6 + 14 + 4;
const OPENING_WIDTH = 360;
const OPENING_ROOM = 40;
// Room around the box inside the stage: the strengths on the left, start
// and end underneath.
const EDGE = { left: 34, right: 10, top: 10, bottom: 18 };
const GRAB_RADIUS = 9;
const SAMPLES = 120;
const SVG = "http://www.w3.org/2000/svg";

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-curve{box-sizing:border-box;display:flex;flex-direction:column;gap:6px;width:100%;height:100%;padding:0 2px 4px;overflow:hidden;font:12px/1.3 ${FONT_UI};color:${T.inkSoft};pointer-events:none}
.ausboss-curve-bar{flex:none;display:flex;gap:4px;align-items:center;min-width:0;overflow:hidden}
.ausboss-curve-stage{position:relative;flex:1 1 auto;min-height:${STAGE_MIN_HEIGHT}px;border-radius:${RADIUS_CONTROL}px;background:${T.well};overflow:hidden;cursor:crosshair;touch-action:none;pointer-events:auto}
.ausboss-curve-stage svg{position:absolute;inset:0;width:100%;height:100%;display:block}
.ausboss-curve-stage svg text{font:10px ${FONT_UI};fill:${T.faint}}
.ausboss-curve-stage svg .readout{fill:${T.ink}}
.ausboss-curve-stage.on-point{cursor:grab}
.ausboss-curve-stage.dragging{cursor:grabbing}
.ausboss-curve-point{flex:none;display:flex;gap:6px;align-items:center;height:26px;pointer-events:auto}
.ausboss-curve-point>span{${CAPTION_TYPE}white-space:nowrap}
.ausboss-curve-point>.ausboss-scrub{flex:1 1 0;min-width:0}
.ausboss-curve-point>.held{opacity:.45;pointer-events:none}
.ausboss-curve-hint{flex:none;${HINT_TYPE}white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;
  document.head.append(style);
}

const widgetByName = (node, name) => node.widgets?.find((widget) => widget?.name === name) ?? null;
const numberOf = (node, name, fallback) => {
  const value = Number(widgetByName(node, name)?.value);
  return Number.isFinite(value) ? value : fallback;
};
const svgEl = (name, attrs = {}) => {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
};

// The curve sits above the card, whichever of the two was built first.
function panelFirst(node) {
  const widgets = node.widgets;
  if (!Array.isArray(widgets)) return;
  const panel = widgets.findIndex((widget) => widget?.name === WIDGET_NAME);
  const card = widgets.indexOf(node.__ausbossCard?.widget);
  if (panel < 0 || card < 0 || panel < card) return;
  widgets.splice(card, 0, widgets.splice(panel, 1)[0]);
}

function build(node) {
  if (node.__ausbossCurve) return node.__ausbossCurve;
  ensureCss();
  const abort = new AbortController();
  const { signal } = abort;
  const root = document.createElement("div");
  root.className = "ausboss-curve";

  const bar = document.createElement("div");
  bar.className = "ausboss-curve-bar";
  const chips = PRESETS.map((preset) => {
    const chip = compactAction(preset.name, preset.title);
    chip.dataset.preset = preset.name;
    chip.addEventListener("pointerdown", (event) => event.stopPropagation(), { signal });
    chip.addEventListener("click", (event) => {
      event.stopPropagation();
      face.points = preset.points.map((point) => [...point]);
      face.selected = Math.min(face.selected, face.points.length - 1);
      save();
    }, { signal });
    return chip;
  });
  bar.append(...chips);

  const stage = document.createElement("div");
  stage.className = "ausboss-curve-stage";
  const svg = svgEl("svg");
  stage.append(svg);

  const row = document.createElement("div");
  row.className = "ausboss-curve-point";
  const caption = (text) => {
    const span = document.createElement("span");
    span.textContent = text;
    return span;
  };
  const at = makeScrubInput({
    value: 0, min: 0, max: 100, step: 1, fineStep: 0.1, decimals: 1, minDecimals: 0, unit: "%", unitWidth: 14,
    title: "Where the picked point sits in the run, from the start (0%) to the end (100%).",
    onChange: (value) => {
      face.points = movePoint(face.points, face.selected, value / 100, face.points[face.selected][1]);
      write();
    },
    onSettle: () => save(),
  });
  const value = makeScrubInput({
    value: 1, min: 0, max: 1, step: 0.05, fineStep: 0.01, decimals: 2,
    title: "The strength at the picked point.",
    onChange: (strength) => {
      const low = numberOf(node, "low", 0);
      const high = numberOf(node, "high", 1);
      if (high === low) return;
      const point = face.points[face.selected];
      face.points = movePoint(face.points, face.selected, point[0], (strength - low) / (high - low));
      write();
    },
    onSettle: () => save(),
  });
  for (const scrub of [at, value]) {
    scrub.root.addEventListener("pointerdown", (event) => event.stopPropagation(), { signal });
  }
  row.append(caption("Point at"), at.root, caption("value"), value.root);

  const hint = document.createElement("div");
  hint.className = "ausboss-curve-hint";
  hint.textContent = "Drag a point. Double-click adds one, right-click removes it.";
  root.append(bar, stage, row, hint);

  const face = { node, root, points: parsePoints(widgetByName(node, "points")?.value ?? ""), selected: 0, hover: null, drag: null, alive: true };

  // The box inside the stage, in the stage's own pixels.
  const box = () => {
    const width = stage.clientWidth || 300;
    const height = stage.clientHeight || STAGE_MIN_HEIGHT;
    return {
      width, height,
      x: (place) => EDGE.left + place * (width - EDGE.left - EDGE.right),
      y: (level) => EDGE.top + (1 - level) * (height - EDGE.top - EDGE.bottom),
      place: (px) => (px - EDGE.left) / Math.max(1, width - EDGE.left - EDGE.right),
      level: (py) => 1 - (py - EDGE.top) / Math.max(1, height - EDGE.top - EDGE.bottom),
    };
  };
  // A pointer on the page in the stage's pixels. The classic canvas scales
  // the panel with its zoom, so the screen box and the stage's own size differ.
  const local = (event) => {
    const rect = stage.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * stage.clientWidth,
      y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * stage.clientHeight,
    };
  };
  const pointUnder = (spot) => {
    const geo = box();
    let best = -1;
    let bestDistance = GRAB_RADIUS;
    face.points.forEach(([px, py], index) => {
      const distance = Math.hypot(geo.x(px) - spot.x, geo.y(py) - spot.y);
      if (distance <= bestDistance) { best = index; bestDistance = distance; }
    });
    return best;
  };

  function render() {
    if (!face.alive) return;
    const geo = box();
    const low = numberOf(node, "low", 0);
    const high = numberOf(node, "high", 1);
    svg.setAttribute("viewBox", `0 0 ${geo.width} ${geo.height}`);
    svg.replaceChildren();
    svg.append(svgEl("rect", { x: geo.x(0), y: geo.y(1), width: geo.x(1) - geo.x(0), height: geo.y(0) - geo.y(1), fill: "none", stroke: T.rule }));
    for (const step of [0.25, 0.5, 0.75]) {
      svg.append(svgEl("line", { x1: geo.x(step), y1: geo.y(1), x2: geo.x(step), y2: geo.y(0), stroke: "#23282b" }));
      svg.append(svgEl("line", { x1: geo.x(0), y1: geo.y(step), x2: geo.x(1), y2: geo.y(step), stroke: "#23282b" }));
    }
    const places = Array.from({ length: SAMPLES + 1 }, (_, i) => i / SAMPLES);
    const levels = curveValues(face.points, places);
    const line = places.map((place, i) => `${i ? "L" : "M"}${geo.x(place).toFixed(1)},${geo.y(levels[i]).toFixed(1)}`).join("");
    svg.append(svgEl("path", { d: `${line}L${geo.x(1)},${geo.y(0)}L${geo.x(0)},${geo.y(0)}Z`, fill: T.brandSoft, stroke: "none" }));
    svg.append(svgEl("path", { d: line, fill: "none", stroke: T.brand, "stroke-width": 2 }));
    const text = (content, attrs) => {
      const element = svgEl("text", attrs);
      element.textContent = content;
      svg.append(element);
      return element;
    };
    text(high.toFixed(2), { x: EDGE.left - 5, y: geo.y(1) + 4, "text-anchor": "end" });
    text(low.toFixed(2), { x: EDGE.left - 5, y: geo.y(0) + 3, "text-anchor": "end" });
    text("start", { x: geo.x(0), y: geo.height - 5 });
    text("end", { x: geo.x(1), y: geo.height - 5, "text-anchor": "end" });
    if (face.hover !== null && !face.drag) {
      const place = face.hover;
      const level = curveValues(face.points, [place])[0];
      svg.append(svgEl("line", { x1: geo.x(place), y1: geo.y(1), x2: geo.x(place), y2: geo.y(0), stroke: T.faint, "stroke-dasharray": "3 3" }));
      const label = `${Math.round(place * 100)}% · ${strengthOf(level, low, high).toFixed(2)}`;
      const width = label.length * 6 + 12;
      // Beside the spot, on a side that leaves every point and its value in view.
      const { left, top } = tagPlace({
        x: geo.x(place), y: geo.y(level), width, height: 17,
        box: { left: geo.x(0), top: geo.y(1), right: geo.x(1), bottom: geo.y(0) },
        points: face.points.map(([px, py]) => [geo.x(px), geo.y(py)]),
      });
      svg.append(svgEl("rect", { x: left, y: top, width, height: 17, rx: 4, fill: T.fill }));
      text(label, { x: left + width / 2, y: top + 12, "text-anchor": "middle", class: "readout" });
    }
    face.points.forEach(([place, level], index) => {
      const picked = index === face.selected;
      svg.append(svgEl("circle", {
        cx: geo.x(place), cy: geo.y(level), r: picked ? 6 : 5,
        fill: picked ? T.brand : T.ink, stroke: picked ? T.ink : T.well, "stroke-width": 2,
      }));
    });
    const preset = presetOf(face.points);
    for (const chip of chips) chip.classList.toggle("active", chip.dataset.preset === preset);
    const point = face.points[face.selected] ?? face.points[0];
    const last = face.points.length - 1;
    const end = face.selected <= 0 || face.selected >= last;
    at.root.classList.toggle("held", end);
    at.setRange(end
      ? { min: point[0] * 100, max: point[0] * 100 }
      : { min: (face.points[face.selected - 1][0] + MIN_GAP) * 100, max: (face.points[face.selected + 1][0] - MIN_GAP) * 100 });
    at.set(point[0] * 100);
    value.root.classList.toggle("held", high === low);
    value.setRange({ min: Math.min(low, high), max: Math.max(low, high) });
    value.set(strengthOf(point[1], low, high));
  }

  const pointsWidget = () => widgetByName(node, "points");
  // The points into the hidden widget while a drag is still going: the line
  // follows the pointer, and the change is kept as one step when it ends.
  function write() {
    const widget = pointsWidget();
    if (widget) widget.value = pointsText(face.points);
    render();
  }
  let settledText = null;
  // Kept: through the widget's own callback, so the workflow is marked
  // changed and an undo takes the whole drag back.
  function save() {
    const widget = pointsWidget();
    const text = pointsText(face.points);
    if (widget) {
      widget.value = settledText ?? widget.value;
      if (widget.value !== text) commitWidgetValue(node, widget, text, app.canvas);
    }
    settledText = text;
    node.setDirtyCanvas?.(true, true);
    render();
  }
  // Read the points back from the widget: a loaded workflow, an undo.
  face.resync = () => {
    const raw = pointsWidget()?.value;
    face.points = parsePoints(raw ?? "");
    settledText = typeof raw === "string" ? raw : pointsText(face.points);
    face.selected = Math.max(0, Math.min(face.selected, face.points.length - 1));
    render();
  };
  face.render = render;

  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const index = pointUnder(local(event));
    if (index < 0) return;
    face.selected = index;
    face.drag = { pointerId: event.pointerId, moved: false };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add("dragging");
    render();
  }, { signal });
  stage.addEventListener("pointermove", (event) => {
    const spot = local(event);
    const geo = box();
    if (face.drag) {
      face.drag.moved = true;
      face.points = movePoint(face.points, face.selected, geo.place(spot.x), geo.level(spot.y));
      write();
      return;
    }
    const place = geo.place(spot.x);
    face.hover = place >= 0 && place <= 1 ? place : null;
    stage.classList.toggle("on-point", pointUnder(spot) >= 0);
    render();
  }, { signal });
  const endDrag = (event) => {
    if (!face.drag) return;
    try { stage.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    const moved = face.drag.moved;
    face.drag = null;
    stage.classList.remove("dragging");
    if (moved) save();
    else render();
  };
  stage.addEventListener("pointerup", endDrag, { signal });
  stage.addEventListener("pointercancel", endDrag, { signal });
  stage.addEventListener("pointerleave", () => {
    if (face.drag) return;
    face.hover = null;
    render();
  }, { signal });
  stage.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    event.preventDefault();
    const spot = local(event);
    if (pointUnder(spot) >= 0) return;
    const geo = box();
    const added = addPoint(face.points, geo.place(spot.x), geo.level(spot.y));
    if (!added) return;
    face.points = added.points;
    face.selected = added.index;
    save();
  }, { signal });
  stage.addEventListener("contextmenu", (event) => {
    const index = pointUnder(local(event));
    if (index <= 0 || index >= face.points.length - 1) return;
    event.stopPropagation();
    event.preventDefault();
    face.points = removePoint(face.points, index);
    face.selected = index - 1;
    save();
  }, { signal });
  // LiteGraph opens the node's menu on the pointerdown of a right click;
  // one on a point is the point's own.
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 2) return;
    const index = pointUnder(local(event));
    if (index > 0 && index < face.points.length - 1) event.stopPropagation();
  }, { signal });

  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => render()) : null;
  resize?.observe(stage);

  const widget = node.addDOMWidget(WIDGET_NAME, "ausboss_strength_curve", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => PANEL_MIN_HEIGHT + WIDGET_FRAME,
  });
  keepDomWidgetWidthAuto(widget);
  widget.serialize = false;
  fillNodeHeight(widget, {
    minWidth: PANEL_MIN_WIDTH,
    minHeight: () => PANEL_MIN_HEIGHT + WIDGET_FRAME,
    minNodeSize: [PANEL_MIN_WIDTH, PANEL_MIN_HEIGHT + 40],
    exactMinWidth: true,
  });

  face.watched = new WeakSet();
  face.watch = () => {
    for (const name of ["high", "low"]) {
      const target = widgetByName(node, name);
      if (!target || face.watched.has(target)) continue;
      face.watched.add(target);
      chainCallback(target, "callback", () => render());
    }
  };
  face.destroy = () => {
    face.alive = false;
    resize?.disconnect();
    abort.abort();
  };
  node.__ausbossCurve = face;
  face.watch();
  panelFirst(node);
  face.resync();
  return face;
}

app.registerExtension({
  name: "ausboss.strength_curve",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      const face = build(this);
      // A new node opens with room for the curve; a loaded workflow puts its
      // own size back after this.
      chainCallback(this, "onAdded", () => {
        panelFirst(this);
        if (face.sized) return;
        face.sized = true;
        const floor = Number(this.computeSize?.()?.[1]);
        if (Number.isFinite(floor) && this.size?.[1] <= floor + 1) {
          this.setSize?.([Math.max(this.size[0], OPENING_WIDTH), floor + OPENING_ROOM]);
        }
      });
    });
    chainCallback(nodeType.prototype, "onConfigure", function (info) {
      const face = build(this);
      if (info?.size) face.sized = true;
      queueMicrotask(() => {
        if (!face.alive) return;
        face.watch();
        panelFirst(this);
        face.resync();
      });
    });
    // A wire into high or low, or one taken away.
    chainCallback(nodeType.prototype, "onConnectionsChange", function () {
      this.__ausbossCurve?.render();
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      this.__ausbossCurve?.destroy();
      this.__ausbossCurve = null;
    });
  },
});
