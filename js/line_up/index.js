import { app } from "../../../scripts/app.js";
import { BRAND, notifyAusbossChange, showToast } from "../shared/index.mjs";
import { enoughFor, lineUp, matchWidth, sameSize, sharedSides, spreadEvenly } from "../shared/line_up.mjs";
import { outlineOf } from "../shared/outline.mjs";

// Line up: with two or more nodes or groups selected, ComfyUI's selection
// toolbar gets one button that pops out a small panel. The panel lines the
// selection up, gives it one width or height, or spaces it evenly. Every tool
// is also a command, so it can be found in the command palette and given a key.
//
// Resize together: with two or more nodes selected, pulling the edge or corner
// of one resizes them all, in both looks. A column shares the width, a row
// shares the height, and a grid shares both.
//
// A node inside a selected group moves with its group, the way a drag moves
// it. Pinned items count when the selection is measured but never move.

const PANEL = "AusBoss.LineUp.Panel";
const SETTING = "AusBoss.Canvas.LineUpButton";
const TOGETHER_SETTING = "AusBoss.Canvas.ResizeTogether";
const ICON_CLASS = "ausboss-line-up-icon";

const TOOLS = [
  { kind: "lineUp", how: "left", id: "AusBoss.LineUp.Left", label: "Line up left edges" },
  { kind: "lineUp", how: "middleX", id: "AusBoss.LineUp.MiddleX", label: "Line up middles in a column" },
  { kind: "lineUp", how: "right", id: "AusBoss.LineUp.Right", label: "Line up right edges" },
  { kind: "lineUp", how: "top", id: "AusBoss.LineUp.Top", label: "Line up top edges" },
  { kind: "lineUp", how: "middleY", id: "AusBoss.LineUp.MiddleY", label: "Line up middles in a row" },
  { kind: "lineUp", how: "bottom", id: "AusBoss.LineUp.Bottom", label: "Line up bottom edges" },
  { kind: "size", how: "widest", id: "AusBoss.LineUp.Widest", label: "Same width as the widest" },
  { kind: "size", how: "narrowest", id: "AusBoss.LineUp.Narrowest", label: "Same width as the narrowest" },
  { kind: "size", how: "tallest", id: "AusBoss.LineUp.Tallest", label: "Same height as the tallest" },
  { kind: "size", how: "shortest", id: "AusBoss.LineUp.Shortest", label: "Same height as the shortest" },
  { kind: "spacing", how: "across", id: "AusBoss.LineUp.SpaceAcross", label: "Even spacing across" },
  { kind: "spacing", how: "down", id: "AusBoss.LineUp.SpaceDown", label: "Even spacing down" },
];

const SECTIONS = [
  { title: "Line up", kind: "lineUp" },
  { title: "Same size", kind: "size" },
  { title: "Even spacing", kind: "spacing" },
];

// ---------------------------------------------------------------------------
// Icons: grey boxes in the text color, and the line or arrows they line up on
// in the pack's teal, the color of the snap lines.
// ---------------------------------------------------------------------------

const box = (x, y, w, h) => ({ x, y, w, h });
const turn = (parts) => ({
  boxes: parts.boxes.map(({ x, y, w, h }) => box(y, x, h, w)),
  lines: parts.lines.map(([x1, y1, x2, y2]) => [y1, x1, y2, x2]),
  heads: parts.heads.map(([x, y, dir]) => [y, x, { l: "u", r: "d", u: "l", d: "r" }[dir]]),
});

const WIDEST = {
  boxes: [box(3, 4, 18, 5), box(8, 15, 8, 5)],
  lines: [[7, 12, 3.5, 12], [17, 12, 20.5, 12]],
  heads: [[3.5, 12, "l"], [20.5, 12, "r"]],
};
const NARROWEST = {
  boxes: [box(8, 4, 8, 5), box(3, 15, 18, 5)],
  lines: [[3, 12, 7, 12], [21, 12, 17, 12]],
  heads: [[7, 12, "r"], [17, 12, "l"]],
};
const ACROSS = {
  boxes: [box(2, 7, 4.5, 10), box(9.75, 7, 4.5, 10), box(17.5, 7, 4.5, 10)],
  lines: [[7.5, 12, 8.75, 12], [15.25, 12, 16.5, 12], [7.5, 9.5, 7.5, 14.5], [8.75, 9.5, 8.75, 14.5], [15.25, 9.5, 15.25, 14.5], [16.5, 9.5, 16.5, 14.5]],
  heads: [],
};

const ICONS = {
  left: { boxes: [box(7, 5, 13, 5), box(7, 14, 8, 5)], lines: [[4, 3, 4, 21]], heads: [] },
  middleX: { boxes: [box(5, 5, 14, 5), box(8, 14, 8, 5)], lines: [[12, 3, 12, 21]], heads: [] },
  right: { boxes: [box(4, 5, 13, 5), box(9, 14, 8, 5)], lines: [[20, 3, 20, 21]], heads: [] },
  top: { boxes: [box(5, 7, 5, 13), box(14, 7, 5, 8)], lines: [[3, 4, 21, 4]], heads: [] },
  middleY: { boxes: [box(5, 5, 5, 14), box(14, 8, 5, 8)], lines: [[3, 12, 21, 12]], heads: [] },
  bottom: { boxes: [box(5, 4, 5, 13), box(14, 9, 5, 8)], lines: [[3, 20, 21, 20]], heads: [] },
  widest: WIDEST,
  narrowest: NARROWEST,
  tallest: turn(WIDEST),
  shortest: turn(NARROWEST),
  across: ACROSS,
  down: turn(ACROSS),
};

function headPath([x, y, dir]) {
  const s = 2.6;
  const points = {
    l: [[x + s, y - s], [x, y], [x + s, y + s]],
    r: [[x - s, y - s], [x, y], [x - s, y + s]],
    u: [[x - s, y + s], [x, y], [x + s, y + s]],
    d: [[x - s, y - s], [x, y], [x + s, y - s]],
  }[dir];
  return `M${points.map((p) => p.join(" ")).join(" L")}`;
}

function boxesSvg(parts, color, fillOpacity) {
  return parts.boxes
    .map(({ x, y, w, h }) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.4" fill="${color}" fill-opacity="${fillOpacity}" stroke="${color}" stroke-width="1.5"/>`)
    .join("");
}

function marksSvg(parts, color) {
  const lines = parts.lines.map(([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`).join("");
  const heads = parts.heads.map((head) => `<path d="${headPath(head)}" fill="none"/>`).join("");
  return `<g stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${lines}${heads}</g>`;
}

function iconSvg(how) {
  const parts = ICONS[how];
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${boxesSvg(parts, "currentColor", 0.2)}${marksSvg(parts, BRAND)}</svg>`;
}

// The toolbar button is an <i> with a class, so its icon is drawn in CSS:
// the boxes take the button's text color, the line stays teal.
function maskUrl(body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function styleSheet() {
  const parts = ICONS.left;
  const boxes = maskUrl(boxesSvg(parts, "black", 0.25));
  const marks = maskUrl(marksSvg(parts, "black"));
  return `
.${ICON_CLASS} { position: relative; display: inline-block; width: 1rem; height: 1rem; }
.${ICON_CLASS}::before, .${ICON_CLASS}::after {
  content: ""; position: absolute; inset: 0;
  -webkit-mask: var(--ausboss-mask) center / contain no-repeat; mask: var(--ausboss-mask) center / contain no-repeat;
}
.${ICON_CLASS}::before { --ausboss-mask: ${boxes}; background: currentColor; }
.${ICON_CLASS}::after { --ausboss-mask: ${marks}; background: ${BRAND}; }
.ausboss-line-up {
  position: fixed; z-index: 1000; padding: 6px 6px 4px; border-radius: 10px;
  background: var(--interface-panel-surface, #1f2225); color: var(--base-foreground, #e6edf3);
  border: 1px solid var(--interface-stroke, #3a3f44); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  font-size: 11px; line-height: 1.2; user-select: none;
}
.ausboss-line-up-title { margin: 2px 6px 3px; color: var(--muted-foreground, #8b949e); }
.ausboss-line-up-row { display: flex; gap: 2px; }
.ausboss-line-up-rule { height: 1px; margin: 5px 2px; background: var(--interface-stroke, #30363d); }
.ausboss-line-up button {
  display: grid; place-items: center; width: 30px; height: 30px; padding: 0;
  border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer;
}
.ausboss-line-up button:hover:not(:disabled) { background: color-mix(in srgb, ${BRAND} 18%, transparent); }
.ausboss-line-up button:focus-visible { outline: 1px solid ${BRAND}; }
.ausboss-line-up button:disabled { opacity: 0.35; cursor: default; }
`;
}

// ---------------------------------------------------------------------------
// The selection
// ---------------------------------------------------------------------------

function graphSets(graph) {
  return {
    nodes: new Set(graph?._nodes ?? graph?.nodes ?? []),
    groups: new Set(graph?._groups ?? graph?.groups ?? []),
  };
}

function pickedCount(canvas) {
  const { nodes, groups } = graphSets(canvas?.graph);
  let count = 0;
  for (const item of canvas?.selectedItems ?? []) if (nodes.has(item) || groups.has(item)) count++;
  return count;
}

// The selected nodes and groups that move on their own, each with the
// outline people see. A node or group inside a selected group is left out:
// it rides along with that group.
function selectionUnits(canvas) {
  const { nodes, groups } = graphSets(canvas?.graph);
  const picked = [...(canvas?.selectedItems ?? [])].filter((item) => nodes.has(item) || groups.has(item));
  const carried = new Set();
  for (const item of picked) {
    if (!groups.has(item)) continue;
    item.recomputeInsideNodes?.();
    for (const child of item.children ?? item._children ?? []) carried.add(child);
  }
  const units = [];
  for (const item of picked) {
    if (carried.has(item)) continue;
    const group = groups.has(item);
    if (!group) item.updateArea?.(canvas.ctx); // fresh after a size change this frame
    const rect = outlineOf(item, canvas, { node: !group });
    if (rect) units.push({ item, group, rect });
  }
  return units;
}

function isPinned(item) {
  return item.pinned === true || item.flags?.pinned === true;
}

function moveUnit({ item, group, rect }, { x, y }) {
  const dx = x - rect.x;
  const dy = y - rect.y;
  if ((!dx && !dy) || isPinned(item)) return;
  if (group) item.move(dx, dy);
  else item.pos = [item.pos[0] + dx, item.pos[1] + dy];
}

function resizeUnit({ item, group, rect }, { w, h }) {
  if (isPinned(item) || item.flags?.collapsed) return;
  if (w === rect.w && h === rect.h) return;
  if (group) {
    item.resize(w, h);
    return;
  }
  // A node's outline includes its title bar and any frame drawn around it;
  // its size does not, so set the size that gives the outline asked for.
  const extraW = rect.w - item.size[0];
  const extraH = rect.h - item.size[1];
  const least = item.computeSize?.() ?? [0, 0];
  item.setSize([Math.max(w - extraW, least[0]), Math.max(h - extraH, least[1])]);
}

function run(tool) {
  const canvas = app.canvas;
  if (!canvas?.graph) return;
  const units = selectionUnits(canvas);
  if (!enoughFor(tool.kind, units.length)) {
    showToast({ detail: `Select ${tool.kind === "spacing" ? "three" : "two"} or more nodes or groups first.`, life: 3000 });
    return;
  }
  const rects = units.map((unit) => unit.rect);
  if (tool.kind === "size") {
    const sizes = sameSize(rects, tool.how);
    units.forEach((unit, index) => resizeUnit(unit, sizes[index]));
  } else {
    const places = tool.kind === "lineUp" ? lineUp(rects, tool.how) : spreadEvenly(rects, tool.how);
    units.forEach((unit, index) => moveUnit(unit, places[index]));
  }
  canvas.setDirty?.(true, true);
  notifyAusbossChange();
  refreshPanel(true);
}

// ---------------------------------------------------------------------------
// Resize together
// ---------------------------------------------------------------------------
//
// The frontend resizes only the node under the pointer: the canvas's own
// pointermove in the classic look, a pointermove on the window in Nodes 2.0.
// This listens on the window and catches up a frame later, so it always reads
// the size the frontend (and Snap into line) settled on. Which sizes are
// shared comes from how the selection was laid out when the button went down
// (sharedSides in js/shared/line_up.mjs). The grabbed node is
// the canvas's resizing node, or in Nodes 2.0 the node whose corner handle
// took the press. Every other selected node takes its size from where it
// stood when the button went down, so nothing builds up across steps.

const together = { enabled: true, before: null, grabbed: null, handleOf: null, sides: null, frame: 0 };

function resizableSelection(canvas) {
  const { nodes } = graphSets(canvas?.graph);
  return [...(canvas?.selectedItems ?? [])].filter(
    (item) => nodes.has(item) && item.size && item.pos && !isPinned(item) && !item.flags?.collapsed,
  );
}

function onTogetherDown(event) {
  endTogether();
  if (event.button !== 0 || !together.enabled) return;
  const picked = resizableSelection(app.canvas);
  if (picked.length < 2) return;
  together.before = new Map(picked.map((node) => [node, { pos: [node.pos[0], node.pos[1]], size: [node.size[0], node.size[1]] }]));
  // Nodes 2.0 draws a corner handle on each node (a div with data-corner).
  const handle = event.target?.closest?.("[data-corner]");
  together.handleOf = handle?.closest?.("[data-node-id]")?.dataset?.nodeId ?? null;
}

function grabbedNode(canvas) {
  const classic = canvas?.resizing_node;
  if (classic) return together.before.has(classic) ? classic : null;
  if (together.handleOf == null) return null;
  for (const node of together.before.keys()) if (String(node.id) === together.handleOf) return node;
  return null;
}

function syncSizes() {
  const canvas = app.canvas;
  if (!together.before || !canvas?.graph) return;
  together.grabbed ??= grabbedNode(canvas);
  const grabbed = together.grabbed;
  if (!grabbed) return;
  const was = together.before.get(grabbed);
  together.sides ??= sharedSides(
    [...together.before.values()].map(({ pos, size }) => ({ x: pos[0], y: pos[1], w: size[0], h: size[1] })),
  );
  const others = [...together.before].filter(([node]) => node !== grabbed);
  const least = others.map(([node]) => node.computeSize?.() ?? [0, 0]);
  // Heights go through the same rule as widths, with y for x.
  const widths = together.sides.width
    ? matchWidth(
        grabbed.size[0],
        others.map(([, start], i) => ({ x: start.pos[0], w: start.size[0], least: least[i][0] })),
        { fromLeft: grabbed.pos[0] !== was.pos[0] },
      )
    : null;
  const heights = together.sides.height
    ? matchWidth(
        grabbed.size[1],
        others.map(([, start], i) => ({ x: start.pos[1], w: start.size[1], least: least[i][1] })),
        { fromLeft: grabbed.pos[1] !== was.pos[1] },
      )
    : null;
  let moved = false;
  others.forEach(([node], index) => {
    const x = widths ? widths[index].x : node.pos[0];
    const y = heights ? heights[index].x : node.pos[1];
    const w = widths ? widths[index].w : node.size[0];
    const h = heights ? heights[index].w : node.size[1];
    if (node.pos[0] !== x || node.pos[1] !== y) {
      node.pos = [x, y];
      moved = true;
    }
    if (node.size[0] !== w || node.size[1] !== h) {
      node.setSize([w, h]);
      moved = true;
    }
  });
  if (moved) canvas.setDirty?.(true, true);
}

function onTogetherMove(event) {
  if (!together.before) return;
  if (!(event.buttons & 1)) return endTogether();
  if (together.frame) return;
  together.frame = requestAnimationFrame(() => {
    together.frame = 0;
    syncSizes();
  });
}

function onTogetherUp() {
  if (together.before) syncSizes(); // the last step, before the frontend records the change
  endTogether();
}

function endTogether() {
  if (together.frame) cancelAnimationFrame(together.frame);
  together.frame = 0;
  together.before = null;
  together.grabbed = null;
  together.handleOf = null;
  together.sides = null;
}

function installTogether() {
  window.addEventListener("pointerdown", onTogetherDown, true);
  window.addEventListener("pointermove", onTogetherMove);
  // Capture phase: the classic canvas stops its pointerup from bubbling.
  window.addEventListener("pointerup", onTogetherUp, true);
  window.addEventListener("pointercancel", endTogether, true);
  window.addEventListener("blur", endTogether);
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

const panel = { el: null, frame: 0, buttons: [], count: -1 };

function anchorButton() {
  return document.querySelector(`.selection-toolbox .${ICON_CLASS}`)?.closest("button") ?? null;
}

function labelAnchor() {
  const button = anchorButton();
  if (!button || button.title) return;
  button.title = "Line up, same size, even spacing";
  button.setAttribute("aria-label", button.title);
}

function buildPanel() {
  const el = document.createElement("div");
  el.className = "ausboss-line-up";
  el.setAttribute("role", "toolbar");
  el.setAttribute("aria-label", "Line up the selection");
  panel.buttons = [];
  SECTIONS.forEach((section, index) => {
    if (index) el.append(Object.assign(document.createElement("div"), { className: "ausboss-line-up-rule" }));
    el.append(Object.assign(document.createElement("div"), { className: "ausboss-line-up-title", textContent: section.title }));
    const row = Object.assign(document.createElement("div"), { className: "ausboss-line-up-row" });
    for (const tool of TOOLS.filter((t) => t.kind === section.kind)) {
      const button = document.createElement("button");
      button.type = "button";
      button.title = tool.label;
      button.setAttribute("aria-label", tool.label);
      button.innerHTML = iconSvg(tool.how);
      button.addEventListener("click", () => run(tool));
      panel.buttons.push({ button, tool });
      row.append(button);
    }
    el.append(row);
  });
  return el;
}

function refreshPanel(force = false) {
  if (!panel.el) return;
  const count = pickedCount(app.canvas);
  if (!force && count === panel.count) return;
  panel.count = count;
  const units = selectionUnits(app.canvas).length;
  for (const { button, tool } of panel.buttons) button.disabled = !enoughFor(tool.kind, units);
}

// Above the selection toolbar, or below it when there is no room above. The
// toolbar follows the selection, so the panel follows the toolbar.
function placePanel() {
  const anchor = anchorButton();
  if (!panel.el || !anchor) return closePanel();
  const bar = (anchor.closest(".selection-toolbox") ?? anchor).getBoundingClientRect();
  const at = anchor.getBoundingClientRect();
  const size = panel.el.getBoundingClientRect();
  const left = Math.min(Math.max(8, at.left + at.width / 2 - size.width / 2), window.innerWidth - size.width - 8);
  let top = bar.top - size.height - 6;
  if (top < 8) top = bar.bottom + 6;
  panel.el.style.left = `${Math.round(left)}px`;
  panel.el.style.top = `${Math.round(top)}px`;
  refreshPanel();
}

function follow() {
  panel.frame = 0;
  if (!panel.el) return;
  placePanel();
  if (panel.el) panel.frame = requestAnimationFrame(follow);
}

function openPanel() {
  if (panel.el || !anchorButton()) return;
  panel.el = buildPanel();
  panel.count = -1;
  document.body.append(panel.el);
  window.addEventListener("pointerdown", onOutside, true);
  window.addEventListener("keydown", onKey, true);
  follow();
}

function closePanel() {
  if (!panel.el) return;
  panel.el.remove();
  panel.el = null;
  panel.buttons = [];
  if (panel.frame) cancelAnimationFrame(panel.frame);
  panel.frame = 0;
  window.removeEventListener("pointerdown", onOutside, true);
  window.removeEventListener("keydown", onKey, true);
}

function onOutside(event) {
  if (!panel.el || panel.el.contains(event.target)) return;
  if (anchorButton()?.contains(event.target)) return; // its own click closes the panel
  closePanel();
}

function onKey(event) {
  if (event.key === "Escape") closePanel();
}

function togglePanel() {
  if (panel.el) closePanel();
  else openPanel();
}

function buttonOn() {
  return app.ui?.settings?.getSettingValue?.(SETTING) !== false;
}

app.registerExtension({
  name: "AusBoss.LineUp",
  commands: [
    { id: PANEL, label: "AusBoss: Line up, same size, even spacing", icon: ICON_CLASS, function: togglePanel },
    ...TOOLS.map((tool) => ({ id: tool.id, label: `AusBoss: ${tool.label}`, function: () => run(tool) })),
  ],
  getSelectionToolboxCommands() {
    if (!buttonOn() || pickedCount(app.canvas) < 2) return [];
    // The toolbar names extension buttons from its own translations, which
    // have no entry for this one; name it once it is on the page.
    requestAnimationFrame(labelAnchor);
    return [PANEL];
  },
  settings: [
    {
      id: SETTING,
      name: "Line-up button on the selection toolbar",
      type: "boolean",
      defaultValue: true,
      category: ["🆎 AusBoss", "Canvas", "Line-up button"],
      tooltip:
        "With two or more nodes or groups selected, the toolbar over them gets a button " +
        "that lines them up, gives them one size or spaces them evenly.",
      onChange(value) {
        if (value === false) closePanel();
      },
    },
    {
      id: TOGETHER_SETTING,
      name: "Resize selected nodes together",
      type: "boolean",
      defaultValue: true,
      category: ["🆎 AusBoss", "Canvas", "Resize together"],
      tooltip:
        "With two or more nodes selected, pulling the edge or corner of one resizes them all: " +
        "a column gets one width, a row one height, a grid both.",
      onChange(value) {
        together.enabled = value !== false;
        if (!together.enabled) endTogether();
      },
    },
  ],
  setup() {
    const style = document.createElement("style");
    style.id = "ausboss-line-up-style";
    style.textContent = styleSheet();
    document.head.append(style);
    // onChange only fires on later edits on some frontends, so read the
    // stored value here.
    together.enabled = app.ui?.settings?.getSettingValue?.(TOGETHER_SETTING) !== false;
    installTogether();
  },
});
