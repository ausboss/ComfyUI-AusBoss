// Callout 🆎: a note whose text grows to fill it. An arrow typed into the text
// (an arrow emoji such as ⬆️, a plain arrow, a pointing hand, or -> and <-)
// shows as a teal arrow sitting in the line.
//
// The text lives in the node's one STRING widget (hidden, so save/load, undo
// and copy ride the default path); the panel only shows it. Decisions live in
// js/shared/callout.mjs under node:test.

import { app } from "/scripts/app.js";
import { BRAND, chainCallback, keepDomWidgetWidthAuto } from "../shared/index.mjs";
import {
  ARROW_ANGLE,
  ARROW_CHOICES,
  DOUBLE_ARROWS,
  arrowText,
  fitFontSize,
  parseBlocks,
} from "../shared/callout.mjs";
import { keepKeyInField } from "../shared/canvas_passthrough.mjs";
import { WIDGET_FRAME, fillNodeHeight } from "../shared/panel_layout.mjs";
import { hideInputsInDef, hideWidget } from "../shared/widget_visibility.mjs";
import { commitWidgetValue } from "../shared/widget_card_math.mjs";
import { frameBounds } from "../shared/workflow_switches.mjs";

const NODE_CLASS = "AUSBOSS_NODES_Callout";
const CSS_ID = "ausboss-callout-css";
const WIDGET_NAME = "ausboss_callout_panel";
const DEFAULT_SIZE = [380, 160];
const PANEL_MIN_WIDTH = 200;
const PANEL_MIN_HEIGHT = 64;
const SVG_NS = "http://www.w3.org/2000/svg";
const ARROW_COLOR = "#1fd3c6";
const FRAME_FILL = 0.8; // the share of the view a node brought into view takes, as in Workflow Switches
const FONT = '"IBM Plex Sans", "Inter", "Segoe UI", system-ui, -apple-system, sans-serif';

// The text sits out of flow, centred in the card by its auto margins. Nodes
// 2.0 sizes a node by its content, so text in normal flow set the note's
// height: a note could not be made shorter than its own text, and the text
// was then fitted to a card it had sized itself. Out of flow, the card takes
// its size from the node alone, in both renderers.
function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-callout{box-sizing:border-box;width:100%;height:100%;padding:2px 4px 6px;overflow:hidden;pointer-events:none;}
.ausboss-callout-card{position:relative;box-sizing:border-box;width:100%;height:100%;overflow:hidden;border-radius:8px;background:linear-gradient(135deg,rgba(0,180,170,.07),rgba(0,0,0,.2));}
.ausboss-callout-inner{position:absolute;top:0;bottom:0;left:0;box-sizing:border-box;width:100%;height:fit-content;margin:auto 0;padding:.6em 1em .6em .85em;color:#d6e6e4;font-family:${FONT};font-weight:500;line-height:1.4;letter-spacing:.003em;overflow-wrap:anywhere;}
.ausboss-callout-point{margin:0 0 .6em;padding-left:.7em;border-left:2px solid rgba(0,180,170,.7);}
.ausboss-callout-point:last-child{margin-bottom:0;}
.ausboss-callout-point b{color:#6fe0d6;font-weight:650;}
.ausboss-callout-empty{color:#6f8987;font-size:14px;font-weight:400;}
.ausboss-callout-arrow{display:inline-block;width:1.2em;height:1.2em;margin:0 .1em;vertical-align:-.26em;filter:drop-shadow(0 0 .3em rgba(0,180,170,.55));}
.ausboss-callout-arrow svg{display:block;width:100%;height:100%;overflow:visible;}
.ausboss-callout-arrow.is-link{pointer-events:auto;cursor:pointer;border-radius:6px;filter:drop-shadow(0 0 .4em rgba(0,180,170,.8));}
.ausboss-callout-arrow.is-link:hover{background:rgba(0,180,170,.2);}
.ausboss-callout-arrow.is-gone{opacity:.4;}
.ausboss-callout-tools{position:absolute;top:5px;right:5px;display:flex;gap:4px;opacity:0;transition:opacity .15s;pointer-events:auto;}
.ausboss-callout-card:hover .ausboss-callout-tools,.ausboss-callout.is-selected .ausboss-callout-tools{opacity:.95;}
.ausboss-callout-tool{height:22px;padding:0 8px;border:1px solid rgba(0,180,170,.45);border-radius:5px;background:rgba(8,14,16,.86);color:#9fd8d3;font:600 11px ${FONT};letter-spacing:.02em;cursor:pointer;}
.ausboss-callout-tool:hover{color:#fff;border-color:${BRAND};}
.ausboss-callout-editor{position:absolute;inset:0;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;padding:6px;border:1px solid ${BRAND};border-radius:8px;background:rgba(5,10,11,.95);pointer-events:auto;}
.ausboss-callout-edit{flex:1;min-height:0;box-sizing:border-box;width:100%;padding:6px 8px;resize:none;border:none;background:transparent;color:#e6f4f3;font:15px/1.45 ${FONT};outline:none;}
.ausboss-callout-arrowbar{flex:none;display:flex;align-items:center;gap:4px;}
.ausboss-callout-arrowbar span{margin-right:4px;color:#6f8987;font:11px ${FONT};}
.ausboss-callout-link{margin-left:auto;display:flex;align-items:center;gap:6px;max-width:55%;color:#6f8987;font:11px ${FONT};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ausboss-callout-link.has-node{color:#9fe8e1;}
.ausboss-callout-link button{height:20px;padding:0 6px;border:1px solid rgba(0,180,170,.35);border-radius:5px;background:rgba(8,14,16,.9);color:#9fd8d3;font:600 11px ${FONT};cursor:pointer;}
.ausboss-callout-pick{width:26px;height:24px;padding:3px;border:1px solid rgba(0,180,170,.35);border-radius:5px;background:rgba(8,14,16,.9);cursor:pointer;}
.ausboss-callout-pick:hover{border-color:${BRAND};background:rgba(0,180,170,.14);}
.ausboss-callout-pick svg{display:block;width:100%;height:100%;}
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

// The node a link names, looked up in the graph the note sits in.
function linkedNode(state, id) {
  const graph = state.node.graph ?? app.graph;
  return graph?.getNodeById?.(id) ?? graph?.getNodeById?.(Number(id)) ?? null;
}

function nodeName(node) {
  return node?.getTitle?.() ?? node?.title ?? node?.type ?? "node";
}

function arrowSpan(state, kind, link) {
  const span = el("span", "ausboss-callout-arrow");
  span.append(arrowIcon(kind));
  if (link === undefined) return span;
  const target = linkedNode(state, link);
  span.classList.add("is-link", target ? "is-live" : "is-gone");
  span.title = target ? `Bring "${nodeName(target)}" into view` : "The node this arrow points at is not in the workflow";
  span.addEventListener("click", (event) => {
    event.stopPropagation();
    bringIntoView(state, link);
  });
  return span;
}

// Bring a node into view the way Workflow Switches does: a small node is
// shown at natural size, a big one fitted to most of the view.
function bringIntoView(state, id) {
  const target = linkedNode(state, id);
  const canvas = app.canvas;
  if (!target || !canvas) return;
  const title = globalThis.LiteGraph?.NODE_TITLE_HEIGHT ?? 30;
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

function renderText(state) {
  const blocks = parseBlocks(state.valueWidget.value);
  state.inner.replaceChildren();
  state.empty = blocks.length === 0;
  if (state.empty) {
    state.inner.append(el("div", "ausboss-callout-empty", "Double-click to write a note"));
  }
  for (const lines of blocks) {
    const point = el("div", "ausboss-callout-point");
    lines.forEach((line, index) => {
      if (index) point.append(document.createElement("br"));
      for (const piece of line) {
        if (piece.arrow) point.append(arrowSpan(state, piece.arrow, piece.link));
        else point.append(piece.bold ? el("b", "", piece.text) : document.createTextNode(piece.text));
      }
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
  inner.style.fontSize = `${fitFontSize(fits)}px`;
}

function markChanged() {
  app.graph?.setDirtyCanvas?.(true, true);
  try {
    app.extensionManager?.workflow?.activeWorkflow?.changeTracker?.checkState?.();
  } catch {
    // The change tracker is optional; the canvas still saves what it holds.
  }
}

function startEdit(state) {
  if (state.editor) return;
  const wrap = el("div", "ausboss-callout-editor");
  const area = el("textarea", "ausboss-callout-edit");
  area.value = state.valueWidget.value ?? "";
  area.placeholder = "One idea per paragraph. **Bold** a word to stress it. Add an arrow with the buttons below.";
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
      linkBox.append(el("span", "", "Click a node to link the arrow"));
      return;
    }
    const clear = el("button", "", "\u00D7");
    clear.type = "button";
    clear.title = "Do not link the next arrow";
    clear.addEventListener("mousedown", (event) => event.preventDefault());
    clear.addEventListener("click", () => {
      linkTarget = null;
      showLink();
      area.focus();
    });
    linkBox.append(el("span", "", `Links to ${nodeName(linkTarget)}`), clear);
  };
  for (const [kind, emoji] of ARROW_CHOICES) {
    const pick = el("button", "ausboss-callout-pick");
    pick.type = "button";
    pick.title = `Add an arrow pointing ${kind}. Click a node first to link it.`;
    pick.append(arrowIcon(kind));
    // The text box keeps focus, so clicking an arrow does not end the edit.
    pick.addEventListener("mousedown", (event) => event.preventDefault());
    pick.addEventListener("click", () => {
      area.setRangeText(arrowText(emoji, linkTarget?.id), area.selectionStart, area.selectionEnd, "end");
      linkTarget = null;
      showLink();
      area.focus();
    });
    bar.append(pick);
  }
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

  const domWidget = node.addDOMWidget(WIDGET_NAME, "ausboss_callout", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => PANEL_MIN_HEIGHT + WIDGET_FRAME,
  });
  keepDomWidgetWidthAuto(domWidget);
  domWidget.serialize = false;
  fillNodeHeight(domWidget, {
    minWidth: PANEL_MIN_WIDTH,
    minHeight: () => PANEL_MIN_HEIGHT + WIDGET_FRAME,
    minNodeSize: [PANEL_MIN_WIDTH, PANEL_MIN_HEIGHT + 40],
    exactMinWidth: true,
  });

  const state = { node, valueWidget, domWidget, root, card, inner, empty: true, editor: null, frame: 0 };
  node.__ausbossCallout = state;
  edit.addEventListener("click", () => startEdit(state));
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
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    hideInputsInDef(nodeData, ["text"]);
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      buildPanel(this);
    });
    chainCallback(nodeType.prototype, "onConfigure", function () {
      // Saved values land after onNodeCreated; show them.
      queueMicrotask(() => {
        const state = buildPanel(this);
        if (state) renderText(state);
      });
    });
    chainCallback(nodeType.prototype, "onDblClick", function () {
      const state = this.__ausbossCallout;
      if (state) startEdit(state);
    });
    chainCallback(nodeType.prototype, "getExtraMenuOptions", function (_canvas, options) {
      const state = this.__ausbossCallout;
      if (!state || !Array.isArray(options)) return;
      options.unshift({ content: "Edit callout text", callback: () => startEdit(state) }, null);
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      const state = this.__ausbossCallout;
      if (!state) return;
      state.observer?.disconnect();
      cancelAnimationFrame(state.frame);
      this.__ausbossCallout = null;
    });
  },
});
