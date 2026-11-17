import { app } from "../../../scripts/app.js";
import { BRAND, chainCallback } from "../shared/index.mjs";
import {
  SNAP_SCREEN_PX,
  guidesFor,
  insideAny,
  overlaps,
  rectLines,
  snapEdges,
  snapMove,
  unionOf,
} from "../shared/snap_lines.mjs";
import { boundsOf, nodeElements, outlineOf } from "../shared/outline.mjs";
import { TILE_MOVE } from "../shared/tile_face.mjs";

// Snap into line: a node or group being dragged lines up with the nodes and
// groups around it, and a teal line shows what it lines up with. A corner
// being pulled lines up the same way. Shift drags freely, which is what
// ComfyUI's own grid snap uses Shift for.
//
// The frontend's own drag moves the items first: the canvas's pointermove in
// the classic look, a requestAnimationFrame write in Nodes 2.0. This file
// listens on the window behind it. Which items move is read from what moved,
// not from the selection rules, so a group's contents, Ctrl's frame-only drag
// and an Alt-drag copy all come out right. Each step places every moving item
// at its start plus the pointer's travel plus the catch, so a catch never
// builds up across steps.

const SETTING = "AusBoss.Canvas.SnapLines";

// Another pack's snapping moving the same nodes would fight this one, so this
// one steps aside while it is on.
const OTHER_SNAPPERS = ["Pixaroma.Align.Enabled"];

const MARK_PX = 2.5;
const OVERHANG_PX = 6;

const state = {
  enabled: true,
  before: null, // Map item -> { pos, size, rect } taken when the button went down
  corner: null, // the corner a resize pulls, such as "SE"
  resizingNode: null, // the node whose Vue corner handle took the press
  drag: null, // the running move, or { idle: true } for a gesture left alone
  guides: [],
  frame: 0,
  pending: null,
};

function settingOn(id) {
  try {
    return app.ui?.settings?.getSettingValue?.(id) === true;
  } catch {
    return false;
  }
}

function vueNodes() {
  return globalThis.LiteGraph?.vueNodesMode === true;
}

function itemsOf(graph) {
  const nodes = graph?._nodes ?? graph?.nodes ?? [];
  const groups = graph?._groups ?? graph?.groups ?? [];
  const reroutes = graph?.reroutes?.values ? [...graph.reroutes.values()] : [];
  return { nodes, groups, reroutes };
}

function pair(value) {
  return value ? [value[0], value[1]] : null;
}

// Every item's place and outline when the button went down. Items that do
// not move keep these for the whole drag, so they are measured only here.
function takeBefore(canvas) {
  const before = new Map();
  const { nodes, groups, reroutes } = itemsOf(canvas.graph);
  const keep = (item, kind, rect) => {
    if (item?.pos) before.set(item, { kind, pos: pair(item.pos), size: pair(item.size), rect });
  };
  const elements = nodeElements();
  for (const node of nodes) keep(node, "node", outlineOf(node, canvas, { elements }));
  for (const group of groups) keep(group, "group", boundsOf(group));
  for (const reroute of reroutes) keep(reroute, "reroute", null);
  return before;
}

function graphPoint(canvas, event) {
  const box = canvas.canvas.getBoundingClientRect();
  const { scale, offset } = canvas.ds;
  return [(event.clientX - box.left) / scale - offset[0], (event.clientY - box.top) / scale - offset[1]];
}

function reachOf(canvas) {
  return SNAP_SCREEN_PX / (canvas.ds?.scale || 1);
}

function viewOf(canvas, reach) {
  const area = canvas.visible_area;
  if (!area) return null;
  return { x: area[0] - reach, y: area[1] - reach, w: area[2] + 2 * reach, h: area[3] + 2 * reach };
}

// The nodes and groups a moving rect can line up with: the ones on screen
// that are not moving. A moving group skips the nodes inside other groups, so
// it lines up with their frames rather than with what sits inside them.
function targetsFor(canvas, moving, { skipGrouped = false } = {}) {
  const view = viewOf(canvas, reachOf(canvas));
  const seen = (rect) => !view || overlaps(rect, view);
  const groupRects = [];
  const nodeRects = [];
  for (const [item, { kind, rect }] of state.before) {
    if (!rect || moving.has(item)) continue;
    if (kind === "group") groupRects.push(rect);
    else if (kind === "node") nodeRects.push(rect);
  }
  const targets = groupRects.filter(seen);
  for (const rect of nodeRects) {
    if (!seen(rect)) continue;
    if (skipGrouped && insideAny(rect, groupRects)) continue;
    targets.push(rect);
  }
  return targets;
}

function setGuides(guides) {
  if (!guides.length && !state.guides.length) return;
  state.guides = guides;
  app.canvas?.setDirty?.(true, false);
}

function sameSize(a, b) {
  if (!a || !b) return a === b;
  return a[0] === b[0] && a[1] === b[1];
}

// The first step after anything moved: which items move, where each one
// started, and the outline that lines up.
function startMove(canvas, event) {
  const { nodes, groups, reroutes } = itemsOf(canvas.graph);
  const movers = [];
  for (const item of [...nodes, ...groups, ...reroutes]) {
    if (!item?.pos || item.pinned) continue;
    const was = state.before.get(item);
    if (!was) {
      if (item.selected) movers.push(item); // a copy made by Alt-drag
      continue;
    }
    if (item.pos[0] !== was.pos[0] || item.pos[1] !== was.pos[1]) movers.push(item);
  }
  if (!movers.length) return null;
  for (const item of movers) {
    const was = state.before.get(item);
    if (was && !sameSize(pair(item.size), was.size)) return { idle: true }; // a resize
  }
  const outlines = [];
  for (const item of movers) {
    if (!item.size) continue; // reroutes ride along but are too small to line up
    const was = state.before.get(item);
    if (!was) {
      // A new copy has not been drawn yet, so measure it where it is now.
      item.updateArea?.(canvas.ctx);
      const rect = outlineOf(item, canvas);
      if (rect) outlines.push(rect);
      continue;
    }
    const rect = was.rect;
    if (!rect) continue;
    outlines.push({ ...rect, x: rect.x + item.pos[0] - was.pos[0], y: rect.y + item.pos[1] - was.pos[1] });
  }
  const box = unionOf(outlines);
  if (!box) return { idle: true };
  const moving = new Set(movers);
  return {
    anchor: graphPoint(canvas, event),
    box,
    items: movers.map((item) => ({ item, start: pair(item.pos) })),
    moving,
    skipGrouped: movers.some((item) => groups.includes(item)),
  };
}

function place(item, x, y) {
  if (item.pos[0] === x && item.pos[1] === y) return;
  item.pos = [x, y];
}

function stepMove(canvas, drag, event) {
  const point = graphPoint(canvas, event);
  const dx = point[0] - drag.anchor[0];
  const dy = point[1] - drag.anchor[1];
  const raw = { ...drag.box, x: drag.box.x + dx, y: drag.box.y + dy };
  let shift = { dx: 0, dy: 0 };
  let targets = [];
  if (!event.shiftKey) {
    targets = targetsFor(canvas, drag.moving, drag);
    shift = snapMove(raw, targets, reachOf(canvas));
  }
  for (const { item, start } of drag.items) place(item, start[0] + dx + shift.dx, start[1] + dy + shift.dy);
  const placed = { ...raw, x: raw.x + shift.dx, y: raw.y + shift.dy };
  setGuides(targets.length ? guidesFor(placed, targets, rectLines(placed)) : []);
  canvas.setDirty?.(true, true);
}

// The frontend has just sized the node from its corner, so pull the moving
// edges onto any line within reach.
function stepNodeResize(canvas, node, event) {
  // LiteGraph forgets the corner once the pointer leaves the node, so use the
  // one it had when the button went down.
  const corner = state.corner;
  const was = state.before.get(node);
  if (event.shiftKey || typeof corner !== "string" || !was?.rect) return setGuides([]);
  const title = was.pos[1] - was.rect.y;
  const edges = { left: corner.includes("W"), right: corner.includes("E"), top: corner.includes("N"), bottom: corner.includes("S") };
  const rect = { x: node.pos[0], y: node.pos[1] - title, w: node.size[0], h: node.size[1] + title };
  const least = node.computeSize?.() ?? [0, 0];
  const targets = targetsFor(canvas, new Set([node]));
  const placed = snapEdges(rect, edges, targets, reachOf(canvas), { w: least[0], h: least[1] + title });
  if (placed.x !== rect.x || placed.y !== rect.y || placed.w !== rect.w || placed.h !== rect.h) {
    node.pos = [placed.x, placed.y + title];
    node.setSize([placed.w, placed.h - title]);
  }
  setGuides(guidesFor(placed, targets, rectLines(placed, edges)));
}

// A group is pulled by its bottom-right corner in both looks. Its own nodes
// stay targets, so the frame can be fitted to them.
function stepGroupResize(canvas, group, event) {
  if (event.shiftKey) return setGuides([]);
  const rect = { x: group.pos[0], y: group.pos[1], w: group.size[0], h: group.size[1] };
  const edges = { right: true, bottom: true };
  const targets = targetsFor(canvas, new Set([group]));
  const LGraphGroup = globalThis.LiteGraph?.LGraphGroup;
  const least = { w: LGraphGroup?.minWidth ?? 0, h: LGraphGroup?.minHeight ?? 0 };
  const placed = snapEdges(rect, edges, targets, reachOf(canvas), least);
  if (placed.w !== rect.w || placed.h !== rect.h) group.resize(placed.w, placed.h);
  setGuides(guidesFor(placed, targets, rectLines(placed, edges)));
}

function step(event) {
  const canvas = app.canvas;
  if (!state.before || !canvas?.graph || !canvas.canvas || !canvas.ds) return;
  if (canvas.resizing_node) return stepNodeResize(canvas, canvas.resizing_node, event);
  if (state.resizingNode) return stepNodeResize(canvas, state.resizingNode, event);
  if (canvas.resizingGroup) return stepGroupResize(canvas, canvas.resizingGroup, event);
  if (!state.drag) state.drag = startMove(canvas, event);
  if (state.drag && !state.drag.idle) stepMove(canvas, state.drag, event);
}

function onPointerDown(event) {
  end();
  if (event.button !== 0 || !state.enabled) return;
  if (globalThis.LiteGraph?.alwaysSnapToGrid) return; // the grid places every drop
  if (OTHER_SNAPPERS.some(settingOn)) return;
  if (app.canvas?.graph && app.canvas.canvas && app.canvas.ds) state.before = takeBefore(app.canvas);
  state.corner = cornerOf(app.canvas);
  if (vueNodes() && state.before) {
    const handle = event.target?.closest?.("[data-corner]");
    const id = handle?.closest?.("[data-node-id]")?.dataset?.nodeId;
    const corner = handle?.dataset?.corner;
    if (id != null && ["SE", "SW", "NE", "NW"].includes(corner)) {
      for (const [item, was] of state.before) {
        if (was.kind === "node" && String(item.id) === id) {
          state.resizingNode = item;
          state.corner = corner;
          break;
        }
      }
    }
  }
}

function cornerOf(canvas) {
  const corner = canvas?.pointer?.resizeDirection;
  return typeof corner === "string" && corner ? corner : null;
}

// Behind LiteGraph's own pointerdown, which names the corner a resize pulls.
function afterPointerDown() {
  if (state.before && !state.resizingNode) state.corner = cornerOf(app.canvas) ?? state.corner;
}

function onPointerMove(event) {
  if (!state.before) return;
  if (!(event.buttons & 1)) return end();
  if (!vueNodes()) return step(event);
  // Nodes 2.0 writes a dragged node in a frame callback queued by this same
  // event, so queue behind it and keep only the newest event.
  state.pending = event;
  if (state.frame) return;
  state.frame = requestAnimationFrame(() => {
    state.frame = 0;
    const latest = state.pending;
    state.pending = null;
    if (latest && state.before) step(latest);
  });
}

// A frameless tile moves itself and keeps its pointer moves to itself
// (js/shared/tile_face.mjs), then reports each move here once placed.
function onTileMove(event) {
  if (!state.before || !event.detail) return;
  step(event.detail);
}

function end() {
  state.before = null;
  state.corner = null;
  state.resizingNode = null;
  state.drag = null;
  state.pending = null;
  setGuides([]);
}

function drawGuides(canvas, ctx) {
  if (!state.guides.length || !canvas?.ds) return;
  let pen = ctx;
  const overlay = vueNodes() ? canvas.overlayCtx : null;
  if (overlay && canvas.overlayCanvas) {
    // Nodes 2.0 draws nodes above the canvas; its link overlay sits above them.
    pen = overlay;
    pen.save();
    const ratio = canvas.overlayCanvas.width / (canvas.overlayCanvas.clientWidth || 1);
    pen.setTransform(ratio, 0, 0, ratio, 0, 0);
    canvas.ds.toCanvasContext(pen);
  } else {
    pen.save();
  }
  const unit = 1 / (canvas.ds.scale || 1);
  const overhang = OVERHANG_PX * unit;
  pen.strokeStyle = BRAND;
  pen.fillStyle = BRAND;
  pen.lineWidth = unit;
  for (const guide of state.guides) {
    pen.setLineDash(guide.middle ? [4 * unit, 3 * unit] : []);
    pen.beginPath();
    if (guide.axis === "x") {
      pen.moveTo(guide.at, guide.from - overhang);
      pen.lineTo(guide.at, guide.to + overhang);
    } else {
      pen.moveTo(guide.from - overhang, guide.at);
      pen.lineTo(guide.to + overhang, guide.at);
    }
    pen.stroke();
    pen.beginPath();
    for (const mark of guide.marks) {
      const [x, y] = guide.axis === "x" ? [guide.at, mark] : [mark, guide.at];
      pen.moveTo(x + MARK_PX * unit, y);
      pen.arc(x, y, MARK_PX * unit, 0, Math.PI * 2);
    }
    pen.fill();
  }
  pen.restore();
}

function install() {
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointerdown", afterPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener(TILE_MOVE, onTileMove);
  // Capture phase: the classic canvas stops its pointerup from bubbling.
  window.addEventListener("pointerup", end, true);
  window.addEventListener("pointercancel", end, true);
  window.addEventListener("blur", end);
  if (app.canvas) {
    chainCallback(app.canvas, "onDrawForeground", function (ctx) {
      drawGuides(this, ctx);
    });
  }
}

app.registerExtension({
  name: "AusBoss.SnapLines",
  settings: [
    {
      id: SETTING,
      name: "Snap into line while dragging",
      type: "boolean",
      defaultValue: true,
      category: ["🆎 AusBoss", "Canvas", "Snap into line"],
      tooltip:
        "Nodes and groups you drag or resize line up with the ones around them, " +
        "and a teal line shows what they line up with. Hold Shift while dragging to skip it.",
      onChange(value) {
        state.enabled = value !== false;
        if (!state.enabled) end();
      },
    },
  ],
  setup() {
    // onChange only fires on later edits on some frontends, so read the
    // stored value here.
    state.enabled = app.ui?.settings?.getSettingValue?.(SETTING) !== false;
    install();
  },
});
