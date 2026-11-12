// Callout 🆎: a note whose text grows to fill it. An arrow typed into the text
// (an arrow emoji such as ⬆️, a plain arrow, a pointing hand, or -> and <-)
// shows as a teal arrow sitting in the line.
//
// The text lives in the node's one STRING widget (hidden, so save/load, undo
// and copy ride the default path); the panel only shows it. Decisions live in
// js/shared/callout.mjs under node:test.

import { app } from "../../../scripts/app.js";
import { setTileFace, TILE_FACE_CSS } from "../shared/tile_face.mjs";
import { CALLOUT_TYPES, serializeNoteIdentity } from "../shared/note_identity.mjs";
import { BRAND, chainCallback, keepDomWidgetWidthAuto } from "../shared/index.mjs";
import {
  ARROW_ANGLE,
  ARROW_CHOICES,
  CARD_TEMPLATE,
  DOUBLE_ARROWS,
  arrowText,
  fitFontSize,
  parseBlocks,
  parseCard,
  pastedLink,
  repointLinks,
  targetId,
  toggleSmall,
  tileLinkFields,
  tileLinkText,
  urlLabel,
  wrapLink,
} from "../shared/callout.mjs";
import { onPaste } from "../shared/paste_ids.mjs";
import { keepKeyInField } from "../shared/canvas_passthrough.mjs";
import { WIDGET_FRAME, fillNodeHeight } from "../shared/panel_layout.mjs";
import { hideInputsInDef, hideWidget } from "../shared/widget_visibility.mjs";
import { commitWidgetValue } from "../shared/widget_card_math.mjs";
import { compactAction } from "../shared/panel_controls.mjs";
import { frameBounds } from "../shared/workflow_switches.mjs";

const CSS_ID = "ausboss-callout-css";
const WIDGET_NAME = "ausboss_callout_panel";
const DEFAULT_SIZE = [380, 160];
const PANEL_MIN_WIDTH = 200;
const PANEL_MIN_HEIGHT = 64;
const SVG_NS = "http://www.w3.org/2000/svg";
const ARROW_COLOR = "#1fd3c6";
const LINK_TILES = {
  youtube: { label: "Watch Me on YouTube", url: "https://www.youtube.com/@ausbossdev" },
  discord: { label: "Join for Help or More Workflows", url: "https://discord.gg/RwVxY9Fuaj" },
};
// A new Info card opens at this size, which shows its starter text whole.
const CARD_SIZE = [300, 230];
// The card's text grows with the node like a note's, but a card stays a card.
const CARD_FONT_MAX = 20;
const FRAME_FILL = 0.8; // the share of the view a node brought into view takes, as in Workflow Switches
const FONT = '"IBM Plex Sans", "Inter", "Segoe UI", system-ui, -apple-system, sans-serif';

// The text sits out of flow, centred in the card by its auto margins. Nodes
// 2.0 sizes a node by its content, so text in normal flow set the note's
// height: a note could not be made shorter than its own text, and the text
// was then fitted to a card it had sized itself. Out of flow, the card takes
// its size from the node alone, in both renderers.
//
// The editor's bar is laid out for a note of ordinary width. On a narrow one
// it drops its "Arrow" label and its hint, and when the note is tall enough
// it goes onto two rows, so the buttons keep their size instead of being
// squeezed to slivers (the two @container rules).
function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
${TILE_FACE_CSS}
.ausboss-callout{box-sizing:border-box;width:100%;height:100%;padding:2px 4px 6px;overflow:hidden;pointer-events:none;}
.ausboss-callout-card{position:relative;box-sizing:border-box;width:100%;height:100%;overflow:hidden;border-radius:8px;background:linear-gradient(135deg,rgba(0,180,170,.07),rgba(0,0,0,.2));}
.ausboss-callout-inner{position:absolute;top:0;bottom:0;left:0;box-sizing:border-box;width:100%;height:fit-content;margin:auto 0;padding:.6em 1em .6em .85em;color:#d6e6e4;font-family:${FONT};font-weight:500;line-height:1.4;letter-spacing:.003em;overflow-wrap:anywhere;}
.ausboss-callout-point{margin:0 0 .6em;padding-left:.7em;border-left:2px solid rgba(0,180,170,.7);}
.ausboss-callout-point:last-child{margin-bottom:0;}
.ausboss-callout-point b{color:#6fe0d6;font-weight:650;}
.ausboss-callout-small{margin-top:.3em;color:#9fb5b2;font-size:max(11px,.62em);font-weight:400;line-height:1.4;}
.ausboss-callout-small b{color:#8fd6cf;font-weight:600;}
.ausboss-callout-card[data-tile=youtube]{background:#ae2639}
.ausboss-callout-card[data-tile=discord]{background:#5146aa}
.ausboss-callout-card[data-tile=title]{background:#090909;border-left:4px solid #21c7b9}
.ausboss-callout-card[data-tile] .ausboss-callout-inner{padding-block:.15em;}
.ausboss-callout-card[data-tile] .ausboss-callout-point{border:0;padding:0;margin:0;font-weight:650;color:#fff}
.ausboss-callout-card[data-tile] .ausboss-callout-url{color:white;text-decoration:none;display:flex;align-items:center;gap:12px}
.ausboss-callout-card[data-tile] .ausboss-callout-url svg{width:36px;height:28px;flex:none}
.ausboss-callout-card[data-tile] .ausboss-callout-out{margin-left:auto}
.ausboss-callout-card[data-tile] .ausboss-callout-tools{right:27px;}
.ausboss-callout-card[data-card]{background:#111818;border:1px solid #2e3c3b;}
.ausboss-callout-card[data-card] .ausboss-callout-inner{padding:.8em 1em;color:#d9e4e3;font-weight:400;line-height:1.45;}
.ausboss-callout-card[data-card] b{color:#f2f7f6;font-weight:650;}
.ausboss-card-block{margin:0 0 .85em;}
.ausboss-card-block:last-child{margin-bottom:0;}
.ausboss-card-block>*+*{margin-top:.3em;}
.ausboss-card-title{display:flex;align-items:center;gap:.4em;color:#f2f7f6;font-size:1.08em;font-weight:650;}
.ausboss-card-icon{flex:none;width:1em;height:1em;color:#c9d6d4;}
.ausboss-card-icon svg{display:block;width:100%;height:100%;}
.ausboss-card-row{display:flex;justify-content:space-between;align-items:baseline;gap:1em;}
.ausboss-card-row>span:last-child{flex:none;text-align:right;white-space:nowrap;}
.ausboss-card-row.is-mark,.ausboss-card-row.is-mark b{color:#6fe0d6;font-weight:500;}
.ausboss-card-small,.ausboss-card-small b{color:#93a6a4;}
.ausboss-card-small{font-size:.92em;}
.ausboss-callout-empty{color:#6f8987;font-size:14px;font-weight:400;}
.ausboss-callout-arrow{display:inline-block;width:1.2em;height:1.2em;margin:0 .1em;vertical-align:-.26em;filter:drop-shadow(0 0 .3em rgba(0,180,170,.55));}
.ausboss-callout-arrow svg{display:block;width:100%;height:100%;overflow:visible;}
.ausboss-callout-arrow.is-link{pointer-events:auto;cursor:pointer;border-radius:6px;filter:drop-shadow(0 0 .4em rgba(0,180,170,.8));}
.ausboss-callout-arrow.is-link:hover{background:rgba(0,180,170,.2);}
.ausboss-callout-arrow.is-gone{opacity:.4;}
.ausboss-callout-url,.ausboss-callout-jump{pointer-events:auto;cursor:pointer;border-radius:.2em;color:#6fe0d6;text-decoration:underline;text-decoration-thickness:.06em;text-underline-offset:.17em;}
.ausboss-callout-url:hover,.ausboss-callout-jump:hover{background:rgba(0,180,170,.2);color:#a5f1ea;}
.ausboss-callout-url b,.ausboss-callout-jump b{color:inherit;}
.ausboss-callout-out{display:inline-block;margin-left:.2em;font-size:.7em;font-weight:600;vertical-align:.14em;text-decoration:none;opacity:.85;}
.ausboss-callout-jump.is-gone{opacity:.45;cursor:default;text-decoration-style:dotted;}
.ausboss-callout-tools{position:absolute;top:5px;right:5px;display:flex;gap:4px;opacity:0;transition:opacity .15s;pointer-events:auto;}
.ausboss-callout-card:is(:hover,:focus-within) .ausboss-callout-tools,.ausboss-callout.is-selected .ausboss-callout-tools{opacity:.95;}
.ausboss-callout-tool{height:22px;padding:0 8px;border:1px solid rgba(0,180,170,.45);border-radius:5px;background:rgba(8,14,16,.86);color:#9fd8d3;font:600 11px ${FONT};letter-spacing:.02em;cursor:pointer;}
.ausboss-callout-tool:hover{color:#fff;border-color:${BRAND};}
.ausboss-callout-editor{position:absolute;inset:0;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;padding:6px;border:1px solid ${BRAND};border-radius:8px;background:rgba(5,10,11,.95);pointer-events:auto;container-type:size;}
.ausboss-callout-edit{flex:1;min-height:0;box-sizing:border-box;width:100%;padding:6px 8px;resize:none;border:none;background:transparent;color:#e6f4f3;font:15px/1.45 ${FONT};outline:none;}
.ausboss-callout-arrowbar{flex:none;display:flex;align-items:center;gap:4px;}
.ausboss-callout-arrowbar span{margin-right:4px;color:#6f8987;font:11px ${FONT};}
.ausboss-callout-link{margin-left:auto;display:flex;align-items:center;gap:6px;max-width:55%;color:#6f8987;font:11px ${FONT};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ausboss-callout-link.has-node{color:#9fe8e1;}
.ausboss-callout-link button{height:20px;padding:0 6px;border:1px solid rgba(0,180,170,.35);border-radius:5px;background:rgba(8,14,16,.9);color:#9fd8d3;font:600 11px ${FONT};cursor:pointer;}
.ausboss-callout-pick{width:26px;height:24px;padding:3px;border:1px solid rgba(0,180,170,.35);border-radius:5px;background:rgba(8,14,16,.9);cursor:pointer;}
.ausboss-callout-pick:hover{border-color:${BRAND};background:rgba(0,180,170,.14);}
.ausboss-callout-pick svg{display:block;width:100%;height:100%;}
.ausboss-callout-size{flex:none;height:24px;margin-left:4px;padding:0 7px;border:1px solid rgba(0,180,170,.35);border-radius:5px;background:rgba(8,14,16,.9);color:#9fd8d3;font:600 11px ${FONT};cursor:pointer;}
.ausboss-callout-size:hover{border-color:${BRAND};background:rgba(0,180,170,.14);}
.ausboss-tile-editor{box-sizing:border-box;width:min(520px,94vw);max-height:86vh;overflow:auto;margin:auto;padding:24px;border:1px solid #365957;border-top:3px solid ${BRAND};border-radius:10px;background:#111b1c;color:#e6f4f3;box-shadow:0 18px 64px #0008;font:14px/1.5 ${FONT};}
.ausboss-tile-editor::backdrop{background:#06090ab8;}
.ausboss-tile-editor h2{margin:0 0 18px;font-size:21px;}
.ausboss-tile-editor label{display:flex;flex-direction:column;gap:7px;margin-bottom:16px;font-weight:600;}
.ausboss-tile-editor input,.ausboss-tile-editor textarea{box-sizing:border-box;width:100%;padding:10px 12px;border:1px solid #365957;border-radius:5px;background:#080e10;color:#e6f4f3;font:16px/1.5 ${FONT};user-select:text;}
.ausboss-tile-editor textarea{min-height:120px;resize:vertical;}
.ausboss-tile-editor :is(input,textarea):focus{outline:2px solid ${BRAND};outline-offset:1px;}
.ausboss-tile-editor footer{display:flex;justify-content:flex-end;align-items:center;gap:8px;}
.ausboss-tile-editor footer span{margin-right:auto;color:#99b0ad;font-size:12px;}
.ausboss-tile-editor .ausboss-compact-action{height:32px;padding:0 15px;font-size:13px;}
.ausboss-tile-editor .ausboss-tile-error{color:#ffc36d;margin:0 0 12px;}
@container (max-width:395px){.ausboss-callout-arrowbar>span:first-child,.ausboss-callout-link:not(.has-node){display:none;}}
@container (max-width:395px) and (min-height:112px){.ausboss-callout-arrowbar{flex-wrap:wrap;}.ausboss-callout-pick{flex:none;}}
`;
  document.head.appendChild(style);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function svg(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

// One teal arrow, drawn right-pointing and turned to face `kind`.
function arrowIcon(kind) {
  const root = svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" });
  const group = svg("g", { transform: `rotate(${ARROW_ANGLE[kind] ?? 0} 12 12)`, fill: ARROW_COLOR, stroke: ARROW_COLOR });
  const double = DOUBLE_ARROWS.has(kind);
  group.append(
    svg("path", { d: `M${double ? 5 : 3} 12H${double ? 19 : 15.5}`, fill: "none", "stroke-width": "2.8", "stroke-linecap": "round" }),
    svg("path", { d: "M13.5 5.8L22 12L13.5 18.2Z", "stroke-width": "1.6", "stroke-linejoin": "round" }),
  );
  if (double) {
    group.append(svg("path", { d: "M10.5 5.8L2 12L10.5 18.2Z", "stroke-width": "1.6", "stroke-linejoin": "round" }));
  }
  root.append(group);
  return root;
}

// The small line icons an Info card's title can start with.
const CARD_ICON_PATHS = {
  clock: ["M12 7v5l3.2 2"],
  info: ["M12 11v6", "M12 7.6v.01"],
  warning: ["M12 3.5 2.8 19.5h18.4Z", "M12 10v4", "M12 16.9v.01"],
  tip: ["M9.5 18h5", "M10.5 21h3", "M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3Z"],
  check: ["M8 12.4l2.8 2.8 5.2-5.6"],
};
const CARD_ICON_RING = new Set(["clock", "info", "check"]);

function cardIcon(kind) {
  const span = el("span", "ausboss-card-icon");
  const root = svg("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" });
  if (CARD_ICON_RING.has(kind)) root.append(svg("circle", { cx: 12, cy: 12, r: 9 }));
  for (const d of CARD_ICON_PATHS[kind] ?? []) root.append(svg("path", { d }));
  span.append(root);
  return span;
}

// The node a link names, looked up in the graph the note sits in.
function linkedNode(state, id) {
  const graph = state.node.graph ?? app.graph;
  return graph?.getNodeById?.(id) ?? graph?.getNodeById?.(Number(id)) ?? null;
}

function nodeName(node) {
  return node?.getTitle?.() ?? node?.title ?? node?.type ?? "node";
}

// The group a link names (#g3), looked up in the graph the note sits in.
function linkedGroup(state, id) {
  const graph = state.node.graph ?? app.graph;
  return (graph?.groups ?? graph?._groups ?? []).find((group) => String(group?.id) === String(id)) ?? null;
}

const isGroup = (item) => Boolean(item) && (item instanceof (globalThis.LGraphGroup ?? globalThis.LiteGraph?.LGraphGroup ?? class {}) || (item.constructor?.name === "LGraphGroup"));

// What a piece of the text points at inside the workflow: a node or a group,
// with the words that say so. null for a piece that points at nothing here.
function placeOf(state, piece) {
  if (piece.group !== undefined) {
    const group = linkedGroup(state, piece.group);
    return { item: group, title: group ? `Bring the group "${group.title ?? ""}" into view` : "The group this points at is not in the workflow" };
  }
  if (piece.link !== undefined) {
    const node = linkedNode(state, piece.link);
    return { item: node, title: node ? `Bring "${nodeName(node)}" into view` : "The node this points at is not in the workflow" };
  }
  return null;
}

function arrowSpan(state, kind, piece = {}) {
  const span = el("span", "ausboss-callout-arrow");
  span.append(arrowIcon(kind));
  // Inside linked words (a run) the arrow is part of that link.
  const place = piece.run === undefined ? placeOf(state, piece) : null;
  if (!place) return span;
  span.classList.add("is-link", place.item ? "is-live" : "is-gone");
  span.title = place.title;
  span.addEventListener("click", (event) => {
    event.stopPropagation();
    bringIntoView(place.item);
  });
  return span;
}

// The words of one link, as one element: an address opens in a new tab, a
// node or a group comes into view.
function linkRun(state, first) {
  if (first.url !== undefined) {
    const link = el("a", "ausboss-callout-url");
    const tile = state.card.dataset.tile;
    if (tile === "youtube" || tile === "discord") {
      const icon = svg("svg", { viewBox:"0 0 28 20", "aria-hidden":"true" });
      if (tile === "youtube") {
        icon.append(svg("rect",{x:0,y:1,width:28,height:18,rx:5,fill:"white"}),
          svg("path",{d:"M11 5.5 19 10 11 14.5Z",fill:"#ae2639"}));
      } else {
        icon.append(svg("path",{d:"M4 3 10 1l1 2a15 15 0 0 1 6 0l1-2 6 2c2 4 3 8 3 12l-6 4-2-3a17 17 0 0 1-10 0l-2 3-6-4c0-4 1-8 3-12Z",fill:"white"}));
        for (const cx of [9,19]) icon.append(svg("ellipse",{cx,cy:10,rx:2,ry:2.6,fill:"#5146aa"}));
      }
      link.append(icon);
    }
    link.href = first.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = `Opens ${urlLabel(first.url)} in a new tab`;
    // A press on a link must not become a node drag, and a double-click is one visit.
    link.addEventListener("pointerdown", (event) => event.stopPropagation());
    let last = 0;
    link.addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.timeStamp - last < 600) event.preventDefault();
      last = event.timeStamp;
    });
    return link;
  }
  const place = placeOf(state, first);
  const jump = el("span", "ausboss-callout-jump");
  jump.setAttribute("role", "link");
  jump.title = place.title;
  if (!place.item) jump.classList.add("is-gone");
  jump.addEventListener("pointerdown", (event) => event.stopPropagation());
  jump.addEventListener("click", (event) => {
    event.stopPropagation();
    bringIntoView(place.item);
  });
  return jump;
}

// Bring a node or a group into view the way Workflow Switches does: a small
// one is shown at natural size, a big one fitted to most of the view.
function bringIntoView(target) {
  const canvas = app.canvas;
  if (!target || !canvas) return;
  const title = isGroup(target) ? 0 : (globalThis.LiteGraph?.NODE_TITLE_HEIGHT ?? 30);
  const found = [target.pos[0], target.pos[1] - title, target.size[0], target.size[1] + title];
  const view = canvas.canvas?.getBoundingClientRect?.();
  const rect = frameBounds(found, [view?.width, view?.height], FRAME_FILL);
  if (typeof canvas.animateToBounds === "function") {
    canvas.animateToBounds(rect, { zoom: FRAME_FILL });
  } else if (typeof canvas.ds?.fitToBounds === "function") {
    canvas.ds.fitToBounds(rect, { zoom: FRAME_FILL });
    canvas.setDirty?.(true, true);
  }
}

// One line's pieces into an element. The pieces of one link sit in one
// element; a link that leaves ComfyUI ends with a small ↗.
function appendPieces(state, into, line) {
  let run = null;
  let wrap = null;
  const close = () => {
    if (wrap?.classList.contains("ausboss-callout-url")) wrap.append(el("span", "ausboss-callout-out", "↗"));
  };
  for (const piece of line) {
    if (piece.run !== run) {
      close();
      run = piece.run;
      wrap = run === undefined ? null : linkRun(state, piece);
      if (wrap) into.append(wrap);
    }
    const target = wrap ?? into;
    if (piece.arrow) target.append(arrowSpan(state, piece.arrow, piece));
    else target.append(piece.bold ? el("b", "", piece.text) : document.createTextNode(piece.text));
  }
  close();
}

// An Info card: a title, rows of label and value, and small print.
function renderCard(state, blocks) {
  for (const lines of blocks) {
    const block = el("div", "ausboss-card-block");
    for (const line of lines) {
      let row;
      if (line.kind === "title") {
        row = el("div", "ausboss-card-title");
        if (line.icon) row.append(cardIcon(line.icon));
        const words = el("span");
        appendPieces(state, words, line.pieces);
        row.append(words);
      } else if (line.kind === "row") {
        row = el("div", `ausboss-card-row${line.highlight ? " is-mark" : ""}`);
        for (const cell of line.cells) {
          const side = el("span");
          appendPieces(state, side, cell);
          row.append(side);
        }
      } else {
        row = el("div", "ausboss-card-text");
        appendPieces(state, row, line.pieces);
      }
      if (line.small) row.classList.add("ausboss-card-small");
      block.append(row);
    }
    state.inner.append(block);
  }
}

function renderText(state) {
  const style = state.node.properties?.ausbossCalloutTile;
  if (["youtube","discord","title"].includes(style)) state.card.dataset.tile = style;
  else delete state.card.dataset.tile;
  // An Info card has no title bar, like a tile, but keeps the full editor
  // and saves as a plain Callout: an older pack shows its text as a note.
  if (style === "card") state.card.dataset.card = "";
  else delete state.card.dataset.card;
  const isCard = style === "card";
  setTileFace(state.node, state.root, Boolean(state.card.dataset.tile) || isCard, () => startEdit(state));
  const blocks = isCard ? parseCard(state.valueWidget.value) : parseBlocks(state.valueWidget.value);
  state.inner.replaceChildren();
  state.empty = blocks.length === 0;
  if (state.empty) {
    state.inner.append(el("div", "ausboss-callout-empty", "Double-click to write a note"));
  }
  if (isCard) {
    renderCard(state, blocks);
    fit(state);
    return;
  }
  for (const lines of blocks) {
    const point = el("div", "ausboss-callout-point");
    lines.forEach((line, index) => {
      // Small print is a block of its own under the line above it. Normal
      // lines are told apart by a break, as before; a block needs none.
      const into = line.small ? el("div", "ausboss-callout-small") : point;
      if (index && !line.small && !lines[index - 1].small) point.append(document.createElement("br"));
      appendPieces(state, into, line);
      if (line.small) point.append(into);
    });
    state.inner.append(point);
  }
  fit(state);
}

// The frontend's wrapper around a panel takes every click, so a press on the
// note's body would neither select nor drag it. The wrapper hands those
// presses to the canvas and opens the editor on a double-click; the Edit
// button and the editor take the pointer for themselves.
let forwarded = null;

function letClicksThrough(state) {
  const wrapper = state.root.closest(".dom-widget");
  if (!wrapper || wrapper.__ausbossCallout) return;
  wrapper.__ausbossCallout = true;
  // The presses are forwarded to the canvas, which can swallow the browser's
  // own double-click, so a second press close to the first is read here.
  let lastPress = null;
  wrapper.addEventListener("pointerdown", (event) => {
    const canvas = app.canvas;
    if (event.target !== wrapper || event.button !== 0 || !canvas) return;
    const again = lastPress
      && event.timeStamp - lastPress.time < 500
      && Math.hypot(event.clientX - lastPress.x, event.clientY - lastPress.y) < 8;
    lastPress = { time: event.timeStamp, x: event.clientX, y: event.clientY };
    if (again) {
      lastPress = null;
      event.preventDefault();
      event.stopPropagation();
      startEdit(state);
      return;
    }
    forwarded = event.pointerId;
    event.preventDefault();
    event.stopPropagation();
    canvas.processMouseDown(event);
  }, true);
  wrapper.addEventListener("contextmenu", (event) => {
    if (event.target !== wrapper) return;
    event.preventDefault();
    app.canvas?.processContextMenu?.(state.node, event);
  }, true);
  window.addEventListener("pointermove", (event) => {
    if (forwarded === event.pointerId) app.canvas?.processMouseMove(event);
  }, true);
  window.addEventListener("pointerup", (event) => {
    if (forwarded !== event.pointerId) return;
    forwarded = null;
    app.canvas?.processMouseUp(event);
  }, true);
}

// The text grows to the largest size that still sits inside the node.
function fit(state) {
  const { card, inner } = state;
  letClicksThrough(state);
  if (state.empty) {
    inner.style.fontSize = "";
    return;
  }
  const height = card.clientHeight;
  const width = card.clientWidth;
  if (!height || !width) return;
  const fits = (px) => {
    inner.style.fontSize = `${px}px`;
    return inner.offsetHeight <= height && inner.scrollWidth <= width + 1;
  };
  const size = fitFontSize(fits, undefined, card.dataset.card === undefined ? undefined : CARD_FONT_MAX);
  const social = card.dataset.tile === "youtube" || card.dataset.tile === "discord";
  inner.style.fontSize = `${social ? Math.min(size, 16) : size}px`;
}

function markChanged() {
  app.graph?.setDirtyCanvas?.(true, true);
  try {
    app.extensionManager?.workflow?.activeWorkflow?.changeTracker?.checkState?.();
  } catch {
    // The change tracker is optional; the canvas still saves what it holds.
  }
}

function startTileEdit(state) {
  if (state.editor) return;
  const original = String(state.valueWidget.value ?? "");
  const social = ["youtube", "discord"].includes(state.card.dataset.tile);
  const link = social ? tileLinkFields(original) : null;
  const dialog = el("dialog", "ausboss-tile-editor");
  const heading = social ? "Edit link tile" : "Edit title";
  dialog.setAttribute("aria-label", heading);
  dialog.append(el("h2", "", heading));
  const label = el("label", "", link ? "Button text" : "Text");
  const text = el(link ? "input" : "textarea");
  text.value = link?.label ?? original;
  label.append(text);
  dialog.append(label);
  let address;
  if (link) {
    const field = el("label", "", "Link address");
    address = el("input");
    address.type = "url";
    address.value = link.url;
    field.append(address);
    dialog.append(field);
  }
  const error = el("p", "ausboss-tile-error");
  error.setAttribute("role", "alert");
  const foot = el("footer");
  const cancel = compactAction("Cancel");
  const save = compactAction("Save");
  foot.append(el("span", "", "Ctrl + Enter to save"), cancel, save);
  dialog.append(error, foot);
  const commit = () => {
    let value = text.value;
    try {
      if (address) value = tileLinkText(text.value, address.value);
    } catch (problem) {
      error.textContent = problem.message;
      return;
    }
    if (value !== original) {
      state.node.graph?.beforeChange?.();
      commitWidgetValue(state.node, state.valueWidget, value, app.canvas);
      renderText(state);
      state.node.graph?.afterChange?.();
      markChanged();
    }
    dialog.close();
  };
  save.addEventListener("click", commit);
  cancel.addEventListener("click", () => dialog.close());
  dialog.addEventListener("keydown", event => {
    event.stopPropagation();
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      commit();
    }
  });
  dialog.addEventListener("keyup", event => event.stopPropagation());
  dialog.addEventListener("close", () => {
    state.editor = null;
    dialog.remove();
    state.root.querySelector(".ausboss-callout-tool")?.focus();
  }, { once: true });
  state.editor = dialog;
  document.body.append(dialog);
  dialog.showModal();
  text.focus();
  text.select();
}

function startEdit(state) {
  if (state.editor) return;
  if (state.card.dataset.tile) return startTileEdit(state);
  const wrap = el("div", "ausboss-callout-editor");
  const area = el("textarea", "ausboss-callout-edit");
  area.value = state.valueWidget.value ?? "";
  area.placeholder = state.card.dataset.card === undefined
    ? "One idea per paragraph. **Bold** a word to stress it. The buttons below add an arrow, make a line small or make words a link."
    : "The first line is the title. Write label | value for a row. **Bold** a whole row to make it teal. Small makes a line small print.";
  area.spellcheck = true;
  const bar = el("div", "ausboss-callout-arrowbar");
  bar.append(el("span", "", "Arrow"));
  // The node the next arrow will be linked to: click a node on the canvas
  // while editing, then press an arrow.
  let linkTarget = null;
  const linkBox = el("div", "ausboss-callout-link");
  const showLink = () => {
    linkBox.replaceChildren();
    linkBox.classList.toggle("has-node", Boolean(linkTarget));
    if (!linkTarget) {
      linkBox.append(el("span", "", "Click a node or a group to link to it"));
      return;
    }
    const clear = el("button", "", "\u00D7");
    clear.type = "button";
    clear.title = "Do not link the next arrow or link";
    clear.addEventListener("mousedown", (event) => event.preventDefault());
    clear.addEventListener("click", () => {
      linkTarget = null;
      showLink();
      area.focus();
    });
    linkBox.append(el("span", "", `Links to ${isGroup(linkTarget) ? `the group ${linkTarget.title ?? ""}` : nodeName(linkTarget)}`), clear);
  };
  // What stands after # for the picked node or group: "12", "g3", or nothing.
  const pickedId = () => (linkTarget ? targetId(linkTarget, isGroup(linkTarget)) : undefined);
  for (const [kind, emoji] of ARROW_CHOICES) {
    const pick = el("button", "ausboss-callout-pick");
    pick.type = "button";
    pick.title = `Add an arrow pointing ${kind}. Click a node first to link it.`;
    pick.append(arrowIcon(kind));
    // The text box keeps focus, so clicking an arrow does not end the edit.
    pick.addEventListener("mousedown", (event) => event.preventDefault());
    pick.addEventListener("click", () => {
      area.setRangeText(arrowText(emoji, pickedId()), area.selectionStart, area.selectionEnd, "end");
      linkTarget = null;
      showLink();
      area.focus();
    });
    bar.append(pick);
  }
  // Small print for the line the caret is on, or every line of a selection.
  const small = el("button", "ausboss-callout-size", "Small");
  small.type = "button";
  small.title = "Make this line small print, for the details under the line above. Press again to make it normal.";
  small.addEventListener("mousedown", (event) => event.preventDefault());
  small.addEventListener("click", () => {
    const next = toggleSmall(area.value, area.selectionStart, area.selectionEnd);
    area.setRangeText(next.insert, next.from, next.to, "preserve");
    area.setSelectionRange(next.selectionStart, next.selectionEnd);
    area.focus();
  });
  bar.append(small);
  // The selected words become a link: to the picked node or group, or to an
  // address, which comes back selected so it can be pasted over.
  const link = el("button", "ausboss-callout-size", "Link");
  link.type = "button";
  link.title = "Make the selected words a link. Click a node or a group first to link to it; otherwise paste the address of a page.";
  link.addEventListener("mousedown", (event) => event.preventDefault());
  link.addEventListener("click", () => {
    const id = pickedId();
    const next = wrapLink(area.value, area.selectionStart, area.selectionEnd, id ? `#${id}` : "");
    area.setRangeText(next.insert, next.from, next.to, "preserve");
    area.setSelectionRange(next.selectionStart, next.selectionEnd);
    linkTarget = null;
    showLink();
    area.focus();
  });
  bar.append(link);
  bar.append(linkBox);
  showLink();
  wrap.append(area, bar);

  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    const value = area.value;
    state.editor = null;
    watch.abort();
    wrap.remove();
    if (keep && value !== state.valueWidget.value) {
      commitWidgetValue(state.node, state.valueWidget, value, app.canvas);
    }
    renderText(state);
    markChanged();
  };
  area.addEventListener("keydown", (event) => {
    keepKeyInField(event);
    if (event.key === "Escape") finish(false);
  });
  area.addEventListener("keyup", (event) => event.stopPropagation());
  // An address pasted over selected words makes them a link to it.
  area.addEventListener("paste", (event) => {
    const selected = area.value.slice(area.selectionStart, area.selectionEnd);
    const made = pastedLink(selected, event.clipboardData?.getData("text/plain"));
    if (!made) return;
    event.preventDefault();
    area.setRangeText(made, area.selectionStart, area.selectionEnd, "end");
  });
  // A press on the editor's own bar keeps the keyboard in the text box.
  wrap.addEventListener("mousedown", (event) => {
    if (event.target !== area) event.preventDefault();
  });
  wrap.addEventListener("pointerdown", (event) => event.stopPropagation());
  wrap.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
  // Clicking another node on the canvas takes the keyboard from the text box.
  // That is how the link is picked, so the edit stays open then; a click on
  // empty canvas, or on the note itself, ends it.
  const watch = new AbortController();
  let pointerDown = false;
  window.addEventListener("pointerdown", () => { pointerDown = true; }, { capture: true, signal: watch.signal });
  const settle = () => {
    if (done) return;
    const others = [...(app.canvas?.selectedItems ?? [])].filter((item) => item !== state.node && item?.pos && item?.size);
    const stays = others.length === 1 && !app.canvas.selectedItems.has?.(state.node);
    if (stays) {
      linkTarget = others[0];
      showLink();
      area.focus();
    } else {
      finish(true);
    }
  };
  window.addEventListener("pointerup", () => {
    pointerDown = false;
    if (waiting) {
      waiting = false;
      setTimeout(settle, 40);
    }
  }, { capture: true, signal: watch.signal });
  let waiting = false;
  area.addEventListener("blur", () => {
    if (done) return;
    if (pointerDown) waiting = true;
    else finish(true);
  });
  state.editor = wrap;
  state.card.append(wrap);
  area.focus();
}

function buildPanel(node) {
  if (node.__ausbossCallout) return node.__ausbossCallout;
  const valueWidget = node.widgets?.find((item) => item.name === "text");
  if (!valueWidget) return null;
  ensureCss();
  hideWidget(valueWidget);

  const root = el("div", "ausboss-callout");
  const card = el("div", "ausboss-callout-card");
  const inner = el("div", "ausboss-callout-inner");
  const tools = el("div", "ausboss-callout-tools");
  const edit = el("button", "ausboss-callout-tool", "Edit");
  edit.type = "button";
  edit.title = "Edit the text. Double-clicking the note does the same.";
  tools.append(edit);
  card.append(inner, tools);
  root.append(card);
  tools.addEventListener("pointerdown", (event) => event.stopPropagation());

  const panelHeight = () => (card.dataset.tile ? 36 : PANEL_MIN_HEIGHT) + WIDGET_FRAME;
  const domWidget = node.addDOMWidget(WIDGET_NAME, "ausboss_callout", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: panelHeight,
  });
  keepDomWidgetWidthAuto(domWidget);
  domWidget.serialize = false;
  fillNodeHeight(domWidget, {
    minWidth: PANEL_MIN_WIDTH,
    minHeight: panelHeight,
    minNodeSize: [PANEL_MIN_WIDTH, PANEL_MIN_HEIGHT + 40],
    exactMinWidth: true,
  });

  const state = { node, valueWidget, domWidget, root, card, inner, empty: true, editor: null, frame: 0 };
  node.__ausbossCallout = state;
  edit.addEventListener("click", () => startEdit(state));
  card.addEventListener("dblclick", (event) => {
    if (card.dataset.tile && !event.target.closest("a,button,textarea,.ausboss-callout-editor")) startEdit(state);
  });
  state.observer = new ResizeObserver(() => {
    cancelAnimationFrame(state.frame);
    state.frame = requestAnimationFrame(() => fit(state));
  });
  state.observer.observe(card);
  node.setSize?.([
    Math.max(node.size?.[0] ?? 0, DEFAULT_SIZE[0]),
    Math.max(node.size?.[1] ?? 0, DEFAULT_SIZE[1]),
  ]);
  renderText(state);
  return state;
}

app.registerExtension({
  name: "AusBoss.Callout",
  setup() {
    // A note copied with what its links name follows the copies.
    onPaste(({ nodes, groups, created }) => {
      for (const node of created) {
        if (!CALLOUT_TYPES.has(node?.comfyClass) && !CALLOUT_TYPES.has(node?.type)) continue;
        const state = buildPanel(node);
        if (!state) continue;
        const text = repointLinks(state.valueWidget.value, nodes, groups);
        if (text === null) continue;
        state.valueWidget.value = text;
        renderText(state);
      }
    });
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (!CALLOUT_TYPES.has(nodeData?.name)) return;
    hideInputsInDef(nodeData, ["text"]);
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      if (nodeData.name === "AUSBOSS_NODES_CalloutTile") {
        this.properties ??= {};
        this.properties.ausbossCalloutTile ??= "title";
      }
      buildPanel(this);
      // Keep new tiles compact without changing ordinary or saved callouts.
      if (nodeData.name === "AUSBOSS_NODES_CalloutTile") this.setSize?.([380, 80]);
    });
    chainCallback(nodeType.prototype, "onSerialize", function (saved) {
      serializeNoteIdentity(saved, ["youtube", "discord", "title"].includes(this.properties?.ausbossCalloutTile));
    });
    chainCallback(nodeType.prototype, "onConfigure", function (saved) {
      // Saved values land after onNodeCreated; show them.
      queueMicrotask(() => {
        const state = buildPanel(this);
        if (!state) return;
        renderText(state);
        if ((state.card.dataset.tile || state.card.dataset.card !== undefined) && Number.isFinite(saved?.size?.[1])) {
          this.setSize?.([this.size[0], saved.size[1]]);
        }
      });
    });
    chainCallback(nodeType.prototype, "onDblClick", function () {
      const state = this.__ausbossCallout;
      if (state) startEdit(state);
    });
    chainCallback(nodeType.prototype, "getExtraMenuOptions", function (_canvas, options) {
      const state = this.__ausbossCallout;
      if (!state || !Array.isArray(options)) return;
      for (const [style, label] of [["plain","Plain callout"],["card","Info card"],["title","Title tile"],["youtube","Set YouTube link tile"],["discord","Set Discord link tile"]]) {
        options.unshift({ content: label, callback: () => {
          this.properties ??= {};
          this.properties.ausbossCalloutTile = style;
          const preset = LINK_TILES[style];
          if (preset) commitWidgetValue(this, state.valueWidget, `[${preset.label}](${preset.url})`, app.canvas);
          // An empty card starts with text that shows how one is written.
          const starter = style === "card" && !String(state.valueWidget.value ?? "").trim();
          if (starter) commitWidgetValue(this, state.valueWidget, CARD_TEMPLATE, app.canvas);
          renderText(state);
          if (starter) this.setSize?.([Math.max(this.size[0], CARD_SIZE[0]), CARD_SIZE[1]]);
          else if (style !== "plain" && style !== "card") this.setSize?.([this.size[0], style === "title" ? 86 : 78]);
          markChanged();
        }});
      }
      options.unshift({ content: "Edit callout text", callback: () => startEdit(state) }, null);
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      const state = this.__ausbossCallout;
      if (!state) return;
      state.observer?.disconnect();
      state.editor?.close?.();
      cancelAnimationFrame(state.frame);
      this.__ausbossCallout = null;
    });
  },
});
