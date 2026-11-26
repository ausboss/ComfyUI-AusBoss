// Check layout 🆎 (canvas right-click menu and command palette): lists what
// makes a workflow hard to read and moves nothing. Overlapping nodes and
// groups, wires that run backwards or hide behind a node, a node close under
// one that grows when it runs, nodes outside every group, a saved zoom too
// small to read and a missing Workflow Note, on the top level and inside
// every subgraph. Click an entry to jump to it. The decisions live in
// js/shared/layout_check_math.mjs under node:test.

import { app } from "../../../scripts/app.js";
import { t } from "../shared/i18n.mjs";
import { THEME as T, FONT_UI } from "../shared/theme.mjs";
import { compactAction } from "../shared/panel_controls.mjs";
import { CALLOUT_TYPES, NOTE_TYPES } from "../shared/note_identity.mjs";
import { normalizeNote } from "../shared/workflow_note.mjs";
import { frameBounds } from "../shared/workflow_switches.mjs";
import { KINDS, MIN_ZOOM, checkLayout, countByKind } from "../shared/layout_check_math.mjs";

const CSS_ID = "ausboss-layout-check-css";
const LABEL = "Check layout";
const FRAME_FILL = 0.8;
// Core nodes that get taller once a run shows its picture or text in them.
// The pack's own preview nodes keep their size (js/input_preview/).
const GROWS = new Set(["PreviewImage", "SaveImage", "SaveAnimatedWEBP", "SaveAnimatedPNG", "SaveWEBM", "SaveVideo", "PreviewAny"]);
const KIND_LABEL = {
  "overlap": "Overlapping",
  "group-overlap": "Groups overlapping",
  "under-grower": "Under a node that grows",
  "hidden-wire": "Wire behind a node",
  "backward-wire": "Wire runs backwards",
  "outside-group": "Outside every group",
  "no-groups": "No groups",
  "zoom": "Zoomed out too far",
  "no-note": "No Workflow Note",
};

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-layout-check{position:fixed;z-index:1000;display:flex;flex-direction:column;box-sizing:border-box;width:360px;max-height:70vh;overflow:hidden;border:1px solid ${T.rule};border-radius:10px;background:${T.card};box-shadow:0 12px 40px #0009;color:${T.inkSoft};font:12px/1.4 ${FONT_UI}}
.ausboss-layout-check header{display:flex;align-items:center;gap:6px;padding:10px 10px 8px 14px;border-bottom:1px solid ${T.rule}}
.ausboss-layout-check header b{color:${T.ink};font-size:13px;font-weight:650}
.ausboss-layout-check header span{margin-right:auto;color:${T.faint}}
.ausboss-layout-check-list{overflow:auto;padding:4px 0 6px}
.ausboss-layout-check h4{display:flex;align-items:center;gap:6px;margin:10px 14px 4px;color:${T.label};font:600 11px/1.25 ${FONT_UI}}
.ausboss-layout-check h4 i{color:${T.faint};font-style:normal}
.ausboss-layout-check-row{display:block;box-sizing:border-box;width:100%;padding:5px 12px 5px 11px;border:0;border-left:3px solid transparent;background:transparent;color:${T.inkSoft};font:12px/1.35 ${FONT_UI};text-align:left;cursor:pointer}
.ausboss-layout-check-row:hover{background:${T.fill}}
.ausboss-layout-check-row.is-picked{border-left-color:${T.brand};background:${T.brandSoft}}
.ausboss-layout-check-row:focus-visible{outline:2px solid ${T.brand};outline-offset:-2px}
.ausboss-layout-check-row small{display:block;color:${T.faint};font-size:11px}
.ausboss-layout-check-row.is-info{cursor:default}
.ausboss-layout-check-row.is-info:hover{background:transparent}
.ausboss-layout-check-clean{padding:12px 14px;color:${T.inkSoft}}
.ausboss-layout-check-clean small{display:block;margin-top:2px;color:${T.faint};font-size:11px}
.ausboss-layout-check footer{padding:7px 14px 9px;border-top:1px solid ${T.rule};color:${T.faint};font-size:11px}
`;
  document.head.append(style);
}

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
};

// A name from the graph: never translated, whatever it says.
const nameSpan = (text) => {
  const span = el("span", "", text);
  span.dataset.noI18n = "";
  return span;
};

const LINK_MODES = { 0: "straight", 1: "linear", 2: "spline" };

function titleHeight(node) {
  const LG = globalThis.LiteGraph;
  const none = LG?.NO_TITLE;
  if (none !== undefined && (node.title_mode === none || node.constructor?.title_mode === none)) return 0;
  return LG?.NODE_TITLE_HEIGHT ?? 30;
}

// A graph as plain numbers for checkLayout.
function readGraph(graph, top) {
  const LG = globalThis.LiteGraph;
  const nodes = (graph._nodes ?? graph.nodes ?? []).map((node) => {
    const collapsed = Boolean(node.flags?.collapsed);
    const kind = NOTE_TYPES.has(node.type) ? "note" : CALLOUT_TYPES.has(node.type) ? "callout" : null;
    return {
      id: node.id,
      x: node.pos[0],
      y: node.pos[1],
      w: collapsed ? (node._collapsed_width ?? LG?.NODE_COLLAPSED_WIDTH ?? 80) : node.size[0],
      h: collapsed ? 0 : node.size[1],
      titleHeight: titleHeight(node),
      grows: GROWS.has(node.type),
      kind,
    };
  });
  const mode = app.canvas?.links_render_mode;
  const links = [];
  if (mode !== LG?.HIDDEN_LINK) {
    const all = graph.links instanceof Map ? [...graph.links.values()] : Object.values(graph.links ?? {});
    for (const link of all) {
      const from = link && graph.getNodeById?.(link.origin_id);
      const to = link && graph.getNodeById?.(link.target_id);
      if (!from || !to) continue;
      const start = from.getConnectionPos?.(false, link.origin_slot);
      const end = to.getConnectionPos?.(true, link.target_slot);
      if (!start || !end) continue;
      const via = [];
      for (let id = link.parentId, guard = 0; id !== undefined && id !== null && guard < 64; guard++) {
        const reroute = graph.reroutes?.get?.(id);
        if (!reroute) break;
        via.unshift([reroute.pos[0], reroute.pos[1]]);
        id = reroute.parentId;
      }
      links.push({ id: link.id, from: from.id, to: to.id, points: [[start[0], start[1]], ...via, [end[0], end[1]]] });
    }
  }
  const groups = (graph.groups ?? graph._groups ?? []).map((group) => {
    const [x, y, w, h] = group._bounding ?? [group.pos[0], group.pos[1], group.size[0], group.size[1]];
    return { id: group.id, x, y, w, h };
  });
  const shape = { nodes, links, groups, linkMode: LINK_MODES[mode] ?? "spline", topLevel: top };
  if (top) {
    const notes = (graph._nodes ?? []).filter((node) => NOTE_TYPES.has(node.type));
    shape.noteFilled = notes.some((node) => {
      const note = normalizeNote(node.widgets?.find((widget) => widget.name === "note")?.value);
      return Boolean(note.title && note.body.trim());
    });
    if (app.canvas?.graph === graph) shape.scale = app.canvas.ds?.scale;
  }
  return shape;
}

// Every issue of the workflow, each with the graph it is in and the names of
// the boxes that lead there.
function findIssues() {
  const root = app.rootGraph ?? app.graph;
  if (!root) return [];
  const graphs = [{ graph: root, path: [] }];
  for (const sub of root.subgraphs?.values?.() ?? []) graphs.push({ graph: sub, path: [sub.name || "Subgraph"] });
  const out = [];
  for (const { graph, path } of graphs) {
    for (const issue of checkLayout(readGraph(graph, path.length === 0))) out.push({ ...issue, graph, path });
  }
  return out.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
}

const nodeName = (graph, id) => {
  const node = graph.getNodeById?.(id);
  return node?.getTitle?.() ?? node?.title ?? String(id);
};
const groupName = (graph, id) => (graph.groups ?? []).find((group) => group.id === id)?.title || "Group";

// The two lines of an entry: what, and why or where.
function describe(issue) {
  const { graph } = issue;
  const names = (ids) => ids.map((id) => nodeName(graph, id));
  const main = [];
  const small = [];
  const wires = issue.wires > 1 ? [" · ", el("span", "", `${issue.wires} wires`)] : [];
  switch (issue.kind) {
    case "overlap":
      main.push(nameSpan(names(issue.nodes).join("  ×  ")));
      small.push("Title bars count too");
      break;
    case "group-overlap":
      main.push(nameSpan(issue.groups.map((id) => groupName(graph, id)).join("  ×  ")));
      small.push("One group crosses the other");
      break;
    case "under-grower":
      main.push(nameSpan(nodeName(graph, issue.nodes[0])));
      small.push(el("span", "", "Under:"), " ", nameSpan(nodeName(graph, issue.nodes[1])));
      break;
    case "hidden-wire":
      main.push(nameSpan(names(issue.nodes.slice(0, 2)).join("  →  ")));
      small.push(el("span", "", "Behind:"), " ", nameSpan(names(issue.behind).join(", ")), ...wires);
      break;
    case "backward-wire":
      main.push(nameSpan(names(issue.nodes).join("  →  ")));
      small.push(el("span", "", "Ends left of where it starts"), ...wires);
      break;
    case "outside-group":
      main.push(nameSpan(nodeName(graph, issue.nodes[0])));
      small.push("Move it into a group");
      break;
    case "no-groups":
      main.push("Nothing here is in a group");
      small.push("Put each step in a numbered group");
      break;
    case "zoom":
      main.push(el("span", "", "Saved zoom:"), " ", nameSpan(issue.scale.toFixed(2)));
      small.push(el("span", "", `Below ${MIN_ZOOM.toFixed(2)} the text on nodes stops drawing`));
      break;
    case "no-note":
      main.push(issue.empty ? "The Workflow Note has no title or steps" : "Add a Workflow Note");
      small.push("It tells people what the workflow does and how to run it");
      break;
    default:
      main.push(issue.kind);
  }
  if (issue.path.length) small.push(small.length ? " · " : "", el("span", "", "Inside:"), " ", nameSpan(issue.path.join(" › ")));
  return { main, small };
}

// Open the graph the issue is in, select what it names and bring it into view.
function jump(issue) {
  const canvas = app.canvas;
  if (!canvas) return;
  const { graph } = issue;
  if (canvas.graph !== graph) {
    const root = app.rootGraph ?? app.graph;
    if (graph !== root && typeof canvas.openSubgraph === "function") canvas.openSubgraph(graph);
    else canvas.setGraph?.(graph);
  }
  canvas.deselectAll?.();
  for (const id of issue.nodes ?? []) {
    const node = graph.getNodeById?.(id);
    if (node) canvas.select?.(node);
  }
  for (const id of issue.groups ?? []) {
    const group = (graph.groups ?? []).find((item) => item.id === id);
    if (group) canvas.select?.(group);
  }
  const focus = issue.focus;
  if (focus) {
    const view = canvas.canvas?.getBoundingClientRect?.();
    // Leave room for the panel on the right, so what it names is not under it.
    const width = (focus[2] - focus[0]) * (view?.width && panel ? view.width / Math.max(200, view.width - 380) : 1);
    const rect = frameBounds([focus[0], focus[1], width, focus[3] - focus[1]], [view?.width, view?.height], FRAME_FILL);
    if (typeof canvas.animateToBounds === "function") canvas.animateToBounds(rect, { zoom: FRAME_FILL });
    else canvas.ds?.fitToBounds?.(rect, { zoom: FRAME_FILL });
  }
  canvas.setDirty?.(true, true);
}

let panel = null;

function onKey(event) {
  if (event.key !== "Escape" || !panel || event.target?.closest?.("input,textarea,select,[contenteditable]")) return;
  closePanel();
}

function closePanel() {
  if (!panel) return;
  panel.remove();
  panel = null;
  window.removeEventListener("keydown", onKey, true);
}

function fill(list, count) {
  const issues = findIssues();
  list.replaceChildren();
  count.textContent = issues.length === 0 ? "Nothing to fix" : issues.length === 1 ? "1 thing to look at" : `${issues.length} things to look at`;
  if (!issues.length) {
    const clean = el("div", "ausboss-layout-check-clean", "Nothing to fix.");
    clean.append(el("small", "", "No overlaps, no hidden or backwards wires, and every node sits in a group."));
    list.append(clean);
    return;
  }
  for (const [kind, total] of countByKind(issues)) {
    const heading = el("h4", "", KIND_LABEL[kind] ?? kind);
    heading.append(el("i", "", String(total)));
    list.append(heading);
    for (const issue of issues.filter((item) => item.kind === kind)) {
      const { main, small } = describe(issue);
      const canJump = Boolean(issue.focus || issue.nodes?.length || issue.groups?.length);
      const row = el(canJump ? "button" : "div", `ausboss-layout-check-row${canJump ? "" : " is-info"}`);
      if (canJump) row.type = "button";
      row.append(...main);
      if (small.length) {
        const line = el("small");
        line.append(...small);
        row.append(line);
      }
      if (canJump) {
        row.addEventListener("click", () => {
          list.querySelector(".is-picked")?.classList.remove("is-picked");
          row.classList.add("is-picked");
          jump(issue);
        });
      }
      list.append(row);
    }
  }
}

function openPanel() {
  closePanel();
  ensureCss();
  panel = el("div", "ausboss-layout-check");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", LABEL);
  const head = el("header");
  const count = el("span");
  const again = compactAction("Check again", "Look at the workflow again after a change");
  const close = compactAction("✕", "Close");
  head.append(el("b", "", LABEL), count, again, close);
  const list = el("div", "ausboss-layout-check-list");
  panel.append(head, list, el("footer", "", "Click an entry to jump to it. Nothing is moved."));
  again.addEventListener("click", () => fill(list, count));
  close.addEventListener("click", closePanel);
  // The panel is not part of the canvas: a press here must not start a drag.
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  const rect = app.canvas?.canvas?.getBoundingClientRect?.();
  panel.style.left = `${(rect?.right ?? window.innerWidth) - 376}px`;
  panel.style.top = `${(rect?.top ?? 0) + 100}px`;
  document.body.append(panel);
  window.addEventListener("keydown", onKey, true);
  fill(list, count);
}

app.registerExtension({
  name: "AusBoss.LayoutCheck",
  commands: [{ id: "AusBoss.CheckLayout", label: `AusBoss: ${LABEL}`, function: openPanel }],
  getCanvasMenuItems() {
    return [{ content: `${t(LABEL)} 🆎`, callback: openPanel }];
  },
  afterConfigureGraph() {
    closePanel();
  },
});
