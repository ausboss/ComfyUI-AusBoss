// Seed 🆎 — one card: the number, the mode, and the memory of what ran.
//
// The seed INT and its control_after_generate combo stay ordinary widgets
// (hidden), so save/load, undo and the API format never change. The card
// on top of them is the whole face: a big editable number, a Random /
// Fixed / Step segment that drives the control, and the buttons a shared
// workflow needs - roll a new fixed seed, put the last run's seed back,
// browse the last few, copy.
//
// The backend echoes the seed each run used through its ui payload; that
// is what "last run" shows, so it stays right even after randomize has
// already moved the box on to the next number.

import { app } from "/scripts/app.js";
import { BRAND, chainCallback, keepDomWidgetWidthAuto, notifyAusbossChange } from "../shared/index.mjs";
import { hideInputsInDef, hideWidget } from "../shared/widget_visibility.mjs";
import { formatSeed, pushSeed, seedFromExecuted } from "../shared/seed_history.mjs";

const NODE_CLASS = "AUSBOSS_NODES_Seed";
const CSS_ID = "ausboss-seed-css";
const WIDGET_NAME = "ausboss_seed_panel";
const PROPERTY = "ausboss_seed_history"; // [seed, newest first]
// The frontend's own randomize rolls below 2^50 so the number stays exact
// in a double; a fresh seed rolled here obeys the same ceiling.
const ROLL_MAX = 0x4000000000000;
const CARD_HEIGHT = 158;
const PANEL_DECLARED_HEIGHT = CARD_HEIGHT + 20; // + the frontend's wrapper insets
const NODE_WIDTH = 300;

let openMenu = null;

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-seed{box-sizing:border-box;width:100%;height:100%;padding:0 6px 6px;pointer-events:none;overflow:hidden;font:12px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#c8dddd;}
.ausboss-seed *{box-sizing:border-box;}
.ausboss-seed-card{display:flex;flex-direction:column;gap:7px;height:100%;padding:8px;overflow:hidden;border:1px solid rgba(0,180,170,.22);border-radius:8px;background:rgba(0,0,0,.28);}
.ausboss-seed-field{display:flex;align-items:center;gap:6px;height:38px;padding:0 6px 0 12px;border:1px solid #2a3437;border-radius:7px;background:#0b0f10;pointer-events:auto;}
.ausboss-seed-field:focus-within{border-color:${BRAND};}
.ausboss-seed-field.linked{opacity:.55;}
.ausboss-seed-field input{flex:1 1 auto;min-width:0;height:100%;border:none;outline:none;background:transparent;color:#eef7f6;font:600 17px/1 ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;letter-spacing:.01em;}
.ausboss-seed-field input:disabled{color:#8ba3a1;}
.ausboss-seed-tag{flex:none;color:#5f7674;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;}
.ausboss-seed-icon{flex:none;width:26px;height:26px;border:1px solid transparent;border-radius:5px;background:transparent;color:#8ba3a1;cursor:pointer;font:13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;pointer-events:auto;}
.ausboss-seed-icon:hover{border-color:#3a4a4d;background:#1a2224;color:#fff;}
.ausboss-seed-seg{display:grid;grid-template-columns:1fr 1fr 1fr;height:30px;padding:3px;border:1px solid #2a3437;border-radius:7px;background:#0f1516;pointer-events:auto;}
.ausboss-seed-seg button{border:none;border-radius:5px;background:transparent;color:#8ba3a1;font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;}
.ausboss-seed-seg button:hover{color:#fff;}
.ausboss-seed-seg button.on{background:${BRAND};color:#04201d;}
.ausboss-seed-row{display:grid;grid-template-columns:1fr 1fr 30px;gap:6px;height:32px;}
.ausboss-seed-btn{height:100%;border:1px solid #2a3437;border-radius:7px;background:#16201f;color:#d8ecea;font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;pointer-events:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ausboss-seed-btn:hover{border-color:${BRAND};color:#fff;}
.ausboss-seed-btn:disabled{opacity:.4;cursor:default;pointer-events:none;}
.ausboss-seed-hint{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#6f8886;font-size:10.5px;text-align:center;}
.ausboss-seed-hint b{color:#9fe3dc;font-weight:600;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;}
.ausboss-seed-menu{position:fixed;z-index:10000;min-width:230px;padding:4px;border:1px solid #3a4047;border-radius:7px;background:#1c1f23;box-shadow:0 8px 28px rgba(0,0,0,.5);font:12px/1.3 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#d7dde2;}
.ausboss-seed-menu-head{padding:5px 8px 6px;border-bottom:1px solid #2c3238;color:#78908e;font:10px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.08em;text-transform:uppercase;}
.ausboss-seed-menu-item{display:block;width:100%;padding:6px 8px;border:none;border-radius:5px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;}
.ausboss-seed-menu-item:hover{background:#2c3238;color:#fff;}
.ausboss-seed-menu-item.current{color:${BRAND};}
`;
  document.head.appendChild(style);
}

function closeMenu() {
  if (!openMenu) return;
  openMenu.abort.abort();
  openMenu.element.remove();
  openMenu = null;
}

function history(node) {
  const stored = node.properties?.[PROPERTY];
  return Array.isArray(stored) ? stored : [];
}

function seedWidget(node) {
  return node.widgets?.find((widget) => widget.name === "seed");
}

function controlWidget(node) {
  const seed = seedWidget(node);
  const linked = seed?.linkedWidgets?.find?.((widget) => Array.isArray(widget.options?.values));
  return linked ?? node.widgets?.find((widget) => widget.name === "control_after_generate");
}

function seedLinked(node) {
  return Boolean(node.inputs?.some((input) => input?.name === "seed" && input.link != null));
}

function setControl(node, value) {
  const control = controlWidget(node);
  if (!control || !Array.isArray(control.options?.values)) return;
  if (!control.options.values.includes(value)) return;
  control.value = value;
  control.callback?.(value);
}

function setSeed(node, seed, { pin = true } = {}) {
  const widget = seedWidget(node);
  if (!widget) return;
  widget.value = seed;
  widget.callback?.(seed);
  if (pin) setControl(node, "fixed");
  node.setDirtyCanvas?.(true, true);
  notifyAusbossChange();
}

function rollSeed() {
  return Math.floor(Math.random() * ROLL_MAX);
}

function render(state) {
  const { node } = state;
  const seeds = history(node);
  const last = seeds[0];
  const control = controlWidget(node)?.value ?? "fixed";
  const linked = seedLinked(node);
  const value = seedWidget(node)?.value;
  if (document.activeElement !== state.input) state.input.value = formatSeed(Number(value));
  state.input.disabled = linked;
  state.field.classList.toggle("linked", linked);
  state.field.title = linked ? "The seed comes from its input link" : "Click to type a seed";
  state.tag.textContent = control === "randomize" ? "next" : control === "fixed" ? "seed" : control;
  state.segRandom.classList.toggle("on", control === "randomize");
  state.segFixed.classList.toggle("on", control === "fixed");
  const stepping = control === "increment" || control === "decrement";
  state.segStep.classList.toggle("on", stepping);
  state.segStep.textContent = control === "decrement" ? "Step −1" : "Step +1";
  state.segStep.title = stepping
    ? "Click again to step the other way"
    : "Increment the seed after each queue (click again for decrement)";
  state.useLast.disabled = !seeds.length;
  state.more.disabled = seeds.length < 2;
  state.hint.textContent = "";
  if (seeds.length) {
    state.hint.append("last run ");
    const b = document.createElement("b");
    b.textContent = formatSeed(last);
    state.hint.append(b);
    if (control === "randomize") state.hint.append(" · rolls a new seed each queue");
  } else {
    state.hint.textContent = control === "randomize"
      ? "rolls a new seed each queue"
      : control === "fixed" ? "same seed every queue" : "steps the seed after each queue";
  }
}

function showMenu(state) {
  closeMenu();
  const seeds = history(state.node);
  if (!seeds.length) return;
  const menu = document.createElement("div");
  menu.className = "ausboss-seed-menu";
  const head = document.createElement("div");
  head.className = "ausboss-seed-menu-head";
  head.textContent = "seeds this node ran with";
  menu.append(head);
  const current = seedWidget(state.node)?.value;
  for (const seed of seeds) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ausboss-seed-menu-item";
    if (seed === current) item.classList.add("current");
    item.textContent = formatSeed(seed);
    item.title = "Put this seed back and pin it";
    item.addEventListener("click", () => {
      setSeed(state.node, seed);
      render(state);
      closeMenu();
    });
    menu.append(item);
  }
  document.body.append(menu);
  const anchor = state.more.getBoundingClientRect();
  const rect = menu.getBoundingClientRect();
  const left = Math.min(anchor.right - rect.width, window.innerWidth - rect.width - 8);
  let top = anchor.bottom + 4;
  if (top + rect.height > window.innerHeight - 8) top = Math.max(8, anchor.top - rect.height - 4);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${top}px`;
  const abort = new AbortController();
  document.addEventListener(
    "pointerdown",
    (event) => { if (!menu.contains(event.target)) closeMenu(); },
    { capture: true, signal: abort.signal },
  );
  window.addEventListener(
    "keydown",
    (event) => { if (event.key === "Escape") { event.stopPropagation(); closeMenu(); } },
    { capture: true, signal: abort.signal },
  );
  openMenu = { element: menu, abort };
}

async function copySeed(state) {
  const value = seedWidget(state.node)?.value;
  try {
    await navigator.clipboard?.writeText(formatSeed(Number(value)));
    state.copy.textContent = "✓";
    setTimeout(() => { state.copy.textContent = "⧉"; }, 700);
  } catch {
    // Clipboard blocked: the number is on screen to read.
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, title) {
  const b = el("button", className, text);
  b.type = "button";
  if (title) b.title = title;
  b.addEventListener("pointerdown", (event) => event.stopPropagation());
  return b;
}

function buildPanel(node) {
  if (node.__ausbossSeed) return node.__ausbossSeed;
  ensureCss();
  const seed = seedWidget(node);
  const control = controlWidget(node);
  if (!seed) return null;
  hideWidget(seed);
  if (control) hideWidget(control);

  const root = el("div", "ausboss-seed");
  const card = el("div", "ausboss-seed-card");

  const field = el("div", "ausboss-seed-field");
  const tag = el("span", "ausboss-seed-tag", "seed");
  const input = el("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.spellcheck = false;
  const copy = button("ausboss-seed-icon", "⧉", "Copy the seed");
  field.append(tag, input, copy);
  field.addEventListener("pointerdown", (event) => event.stopPropagation());

  const seg = el("div", "ausboss-seed-seg");
  const segRandom = button("", "Random", "Roll a new seed after every queue");
  const segFixed = button("", "Fixed", "Keep this seed for every queue");
  const segStep = button("", "Step +1", "Increment the seed after each queue");
  seg.append(segRandom, segFixed, segStep);

  const row = el("div", "ausboss-seed-row");
  const newSeed = button("ausboss-seed-btn", "New seed", "Roll a fresh seed and pin it (Fixed)");
  const useLast = button("ausboss-seed-btn", "Use last run", "Put the last run's seed back and pin it (Fixed)");
  const more = button("ausboss-seed-btn", "▾", "Earlier seeds this node ran with");
  row.append(newSeed, useLast, more);

  const hint = el("div", "ausboss-seed-hint");
  card.append(field, seg, row, hint);
  root.append(card);

  const state = (node.__ausbossSeed = {
    node, root, field, tag, input, copy, segRandom, segFixed, segStep, newSeed, useLast, more, hint,
  });

  const commitTyped = () => {
    const text = input.value.trim().replace(/[\s,_]/g, "");
    if (/^\d+$/.test(text)) {
      const number = Number(text);
      if (Number.isFinite(number) && number >= 0 && number !== seed.value) setSeed(node, number, { pin: false });
    }
    render(state);
  };
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") input.blur();
    if (event.key === "Escape") { input.value = formatSeed(Number(seed.value)); input.blur(); }
  });
  input.addEventListener("focus", () => input.select());
  input.addEventListener("blur", commitTyped);
  copy.addEventListener("click", () => copySeed(state));
  segRandom.addEventListener("click", () => { setControl(node, "randomize"); render(state); notifyAusbossChange(); });
  segFixed.addEventListener("click", () => { setControl(node, "fixed"); render(state); notifyAusbossChange(); });
  segStep.addEventListener("click", () => {
    const current = controlWidget(node)?.value;
    setControl(node, current === "increment" ? "decrement" : "increment");
    render(state);
    notifyAusbossChange();
  });
  newSeed.addEventListener("click", () => { setSeed(node, rollSeed()); render(state); });
  useLast.addEventListener("click", () => {
    const seeds = history(node);
    if (seeds.length) { setSeed(node, seeds[0]); render(state); }
  });
  more.addEventListener("click", () => (openMenu ? closeMenu() : showMenu(state)));

  // The control widget rewrites the seed after each queue; ride its callback
  // so the card shows the new number without waiting for a redraw.
  chainCallback(seed, "callback", () => render(state));
  if (control) chainCallback(control, "callback", () => render(state));

  const widget = node.addDOMWidget(WIDGET_NAME, "ausboss_seed", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => PANEL_DECLARED_HEIGHT,
  });
  keepDomWidgetWidthAuto(widget);
  // A constant-height card: pinned on purpose (see
  // tests/panel_guards.test.mjs, fixedByDesign).
  widget.computeSize = (width) => [
    Math.max(NODE_WIDTH, Number(width || node.size?.[0] || NODE_WIDTH)),
    PANEL_DECLARED_HEIGHT,
  ];
  widget.computeLayoutSize = () => ({ minWidth: NODE_WIDTH, minHeight: PANEL_DECLARED_HEIGHT });
  widget.options.minNodeSize = [NODE_WIDTH, 120];

  render(state);
  node.setSize?.([
    Math.max(node.size?.[0] ?? 0, NODE_WIDTH),
    node.computeSize?.()[1] ?? node.size?.[1],
  ]);
  // The card is a fixed-height row: width may grow, but a corner drag
  // that pulls the node taller only opens dead space under the card, so
  // the height snaps back to the card's own on the next frame (LiteGraph
  // writes size directly during a drag and rarely calls onResize).
  chainCallback(node, "onDrawForeground", function () {
    if (this.flags?.collapsed) return;
    const natural = this.computeSize?.()[1];
    if (natural && this.size[1] !== natural) {
      this.setSize?.([this.size[0], natural]);
      this.setDirtyCanvas?.(true, false);
    }
  });
  return state;
}

app.registerExtension({
  name: "AusBoss.Seed",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    hideInputsInDef(nodeData, ["seed"]);
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      buildPanel(this);
    });
    chainCallback(nodeType.prototype, "onConfigure", function () {
      queueMicrotask(() => {
        const state = buildPanel(this);
        if (state) render(state);
      });
    });
    chainCallback(nodeType.prototype, "onConnectionsChange", function () {
      const state = this.__ausbossSeed;
      if (state) requestAnimationFrame(() => render(state));
    });
    chainCallback(nodeType.prototype, "onExecuted", function (message) {
      const state = buildPanel(this);
      const seed = seedFromExecuted(message);
      if (!state || seed === null) return;
      this.properties ??= {};
      this.properties[PROPERTY] = pushSeed(history(this), seed);
      render(state);
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      closeMenu();
      this.__ausbossSeed = null;
    });
  },
});
