// The row of chips on H3 Prompt Writer: each picture plugged in, with its @
// name, a small copy of it and its job, then the video and its job. A slot
// with nothing plugged in has no chip (js/shared/h3_sockets.mjs holds the
// rule). A picture whose loader is turned off keeps a faint dashed chip that
// says so. The widgets underneath stay the source of truth: a chip only
// changes their value.
import { app } from "../../../scripts/app.js";
import { BRAND, chainCallback } from "./index.mjs";
import { THEME as T, FONT_UI } from "./theme.mjs";
import { SHOW_ALL, chipsToShow } from "./h3_sockets.mjs";
import { liftSocket } from "./widget_card.mjs";
import { commitWidgetValue, comboValues } from "./widget_card_math.mjs";

const CSS_ID = "ausboss-cast-chips-css";
const WATCH = 1000; // Workflow Switches can turn a loader off without touching this node.

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-chips{display:flex;flex-wrap:wrap;align-content:flex-start;gap:5px;height:100%;min-width:0;font:600 10.5px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.ausboss-chip{position:relative;display:flex;align-items:center;gap:4px;height:24px;max-width:100%;padding:0 8px;box-sizing:border-box;border:1px solid #2a3437;border-radius:12px;background:#0b0f10;color:#d8ecea;white-space:nowrap}
.ausboss-chip:hover{border-color:${BRAND}}
.ausboss-chip img{flex:none;width:18px;height:18px;margin-left:-5px;border-radius:9px;object-fit:cover}
.ausboss-chip b{flex:none;color:${BRAND};font:700 10px ui-monospace,SFMono-Regular,Menlo,monospace}
.ausboss-chip em{flex:none;color:#6f8886;font-style:normal;font-weight:500}
.ausboss-chip-pick{min-width:0;max-width:120px;height:22px;padding:0 12px 0 0;border:none;background:transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M1 1l3 3 3-3' fill='none' stroke='%236f8886' stroke-width='1.4'/%3E%3C/svg%3E") no-repeat right 1px center;color:#d8ecea;font:inherit;cursor:pointer;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;text-align:left}
.ausboss-chip-pick:focus-visible{outline:2px solid ${BRAND};outline-offset:2px;border-radius:3px}
.ausboss-chip.open{border-color:${BRAND}}
.ausboss-chip-menu{position:fixed;z-index:10000;box-sizing:border-box;padding:.33em;border:1px solid ${T.rule};border-radius:.66em;background:${T.card};box-shadow:0 10px 32px rgba(0,0,0,.55);font:500 12px/1.25 ${FONT_UI};color:${T.inkSoft}}
.ausboss-chip-item{display:flex;align-items:center;gap:.5em;padding:.45em .75em .45em .5em;border-radius:.4em;white-space:nowrap;cursor:pointer;user-select:none}
.ausboss-chip-item::before{content:"";flex:none;width:.9em;text-align:center;color:${T.brand}}
.ausboss-chip-item.current::before{content:"\\2713"}
.ausboss-chip-item.current{color:${T.brandInk}}
.ausboss-chip-item.hot{background:${T.fill};color:${T.ink}}
.ausboss-chip.off{border-style:dashed;background:transparent;color:#56706d}
.ausboss-chip.off:hover{border-color:#2a3437}
.ausboss-chip.wired{color:#8ba3a1}
`;
  document.head.append(style);
}

function linkSource(node, name) {
  const slot = node.inputs?.find((input) => input?.widget?.name === name || input?.name === name);
  if (slot?.link === null || slot?.link === undefined) return null;
  const graph = node.graph;
  const link = graph?.links?.[slot.link] ?? graph?._links?.get?.(slot.link);
  const source = graph?.getNodeById?.(link?.origin_id);
  return (source?.mode ?? 0) === 0 ? source ?? {} : null;
}

const hasWire = (node, name) => {
  const slot = node.inputs?.find((input) => !input?.widget && input?.name === name);
  return slot?.link !== null && slot?.link !== undefined;
};

// The names of the chips this node draws now: picture_1 to picture_4, video.
export function castChipNames(node) {
  return chipsToShow({
    wiredInputs: ["picture_1", "picture_2", "picture_3", "picture_4", "video"].filter((name) => hasWire(node, name)),
    showAll: Boolean(app.extensionManager?.setting?.get?.(SHOW_ALL)),
  });
}

const widgetOf = (node, name) => node.widgets?.find((widget) => widget.name === name) ?? null;

function chip(className = "") {
  const element = document.createElement("label");
  element.className = `ausboss-chip ${className}`.trim();
  return element;
}

function add(parent, tag, text, className) {
  const child = document.createElement(tag);
  if (className) child.className = className;
  if (text !== undefined) child.textContent = text;
  parent.append(child);
  return child;
}

// The open job list, one at a time across every chip on the page.
let openMenu = null;

// The job list a chip opens. A native <select> lets the browser draw its own
// list (small system font, light highlight, pinned to the select's left
// edge); this one wears the node's colours, sits under the whole chip and
// grows with the canvas zoom like the chip does.
function openJobMenu(chipElement, button, values, current, choose) {
  openMenu?.close();
  const menu = add(document.body, "div", undefined, "ausboss-chip-menu");
  menu.setAttribute("role", "listbox");
  const items = values.map((value) => {
    const item = add(menu, "div", value, "ausboss-chip-item");
    item.setAttribute("role", "option");
    if (value === current) { item.classList.add("current"); item.setAttribute("aria-selected", "true"); }
    return item;
  });
  let hot = -1;
  const setHot = (index) => {
    items[hot]?.classList.remove("hot");
    hot = (index + items.length) % items.length;
    items[hot]?.classList.add("hot");
    items[hot]?.scrollIntoView({ block: "nearest" });
  };
  setHot(Math.max(0, values.indexOf(current)));

  // The chip is drawn scaled with the canvas: the list matches that size,
  // starts at the chip's left edge and is at least as wide as the chip.
  function place() {
    const box = chipElement.getBoundingClientRect();
    const zoom = Math.min(2.5, Math.max(0.85, box.height / (chipElement.offsetHeight || 24)));
    menu.style.fontSize = `${12 * zoom}px`;
    menu.style.minWidth = `${box.width}px`;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    let top = box.bottom + 4;
    if (top + height > window.innerHeight - 8 && box.top - height - 4 >= 8) top = box.top - height - 4;
    menu.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  }

  const abort = new AbortController();
  const close = () => {
    abort.abort();
    menu.remove();
    chipElement.classList.remove("open");
    if (openMenu?.menu === menu) openMenu = null;
  };
  const pick = (index) => { close(); button.focus(); choose(values[index]); };
  items.forEach((item, index) => {
    item.addEventListener("pointermove", () => { if (hot !== index) setHot(index); });
    item.addEventListener("click", () => pick(index));
  });
  menu.addEventListener("pointerdown", (event) => event.stopPropagation());
  const outside = (event) => !menu.contains(event.target) && !button.contains(event.target);
  const on = { capture: true, signal: abort.signal };
  window.addEventListener("pointerdown", (event) => { if (outside(event)) close(); }, on);
  window.addEventListener("wheel", (event) => { if (outside(event)) close(); }, { ...on, passive: true });
  // The page fires resize on its own now and then: the list follows the chip
  // instead of vanishing, and goes only when the chip itself is gone.
  window.addEventListener("resize", () => (chipElement.isConnected ? place() : close()), on);
  // Only the window itself losing focus (another app, another tab). Pressing an item takes
  // focus off the chip's button, and a capturing blur listener would hear that and close
  // the list before the click lands. The press keeps focus on the button instead.
  window.addEventListener("blur", (event) => { if (event.target === window) close(); }, { signal: abort.signal });
  menu.addEventListener("mousedown", (event) => event.preventDefault());
  window.addEventListener("keydown", (event) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step) setHot(hot + step);
    else if (event.key === "Home") setHot(0);
    else if (event.key === "End") setHot(items.length - 1);
    else if (event.key === "Enter" || event.key === " ") pick(hot);
    else if (event.key === "Escape" || event.key === "Tab") { close(); if (event.key === "Escape") button.focus(); }
    else return;
    if (event.key !== "Tab") { event.preventDefault(); event.stopPropagation(); }
  }, on);

  place();
  chipElement.classList.add("open");
  openMenu = { owner: button, menu, close };
}

function choice(node, name, into) {
  const widget = widgetOf(node, name);
  const button = add(into, "button", undefined, "ausboss-chip-pick");
  button.type = "button";
  button.setAttribute("aria-haspopup", "listbox");
  button.title = widget?.options?.tooltip ?? "";
  const show = (value) => { button.textContent = String(value ?? ""); };
  show(widget?.value);
  const choose = (value) => {
    show(value);
    if (widget && value !== widget.value) commitWidgetValue(node, widget, value, app.canvas);
    node.setDirtyCanvas?.(true, true);
  };
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    if (openMenu?.owner === button) { openMenu.close(); return; }
    const values = comboValues(widget).map(String);
    openJobMenu(into, button, values, String(widget?.value ?? ""), choose);
  });
  return (values) => { if (openMenu?.owner !== button) show(values[name]); };
}

// The jobs have no socket of their own, but a page saved by an earlier
// release may have one wired: that link stays, in the slot column.
const JOBS = ["job_1", "job_2", "job_3", "job_4", "video_job"];
const keepOldJobLinks = (node) => {
  for (const name of JOBS) {
    const slot = node.inputs?.find((input) => input?.widget?.name === name);
    if (slot && slot.link !== null && slot.link !== undefined) liftSocket(node, name);
  }
};

// A card row: { panel: castChips, height }.
export function castChips(node) {
  ensureCss();
  const element = document.createElement("div");
  element.className = "ausboss-chips";
  queueMicrotask(() => keepOldJobLinks(node));

  let shape = "";
  let syncs = [];
  let latest = {};
  const build = (values) => {
    if (openMenu && element.contains(openMenu.owner)) openMenu.close();
    element.textContent = "";
    syncs = [];
    const names = castChipNames(node);
    // A faint chip: a socket with nothing in it (only with every socket
    // shown), or a picture whose loader is turned off.
    const faint = (name, label, plugIn) => {
      const empty = chip("off");
      const off = hasWire(node, name);
      empty.textContent = off ? `${label} off` : `+ ${label}`;
      empty.title = off ? `The loader on ${name} is turned off, so it is not used.` : plugIn;
      element.append(empty);
    };
    for (const number of [1, 2, 3, 4]) {
      if (!names.includes(`picture_${number}`)) continue;
      const source = linkSource(node, `picture_${number}`);
      if (!source) {
        faint(`picture_${number}`, `@${number}`, `Plug a picture into picture_${number} to name it @${number} in your lines.`);
        continue;
      }
      const item = chip();
      const url = source.imgs?.[0]?.src;
      if (url) add(item, "img").src = url;
      add(item, "b", `@${number}`);
      if (linkSource(node, `job_${number}`)) add(item, "span", "job from its wire");
      else syncs.push(choice(node, `job_${number}`, item));
      element.append(item);
    }
    if (linkSource(node, "video")) {
      const item = chip();
      add(item, "b", "video");
      if (linkSource(node, "video_job")) add(item, "span", "job from its wire");
      else syncs.push(choice(node, "video_job", item));
      element.append(item);
    } else if (names.includes("video")) {
      faint("video", "video", "Plug a video into video to copy its moves, swap the person, keep it going or give it a new voice.");
    }

    for (const run of syncs) run(values);
  };

  const shapeOf = () => JSON.stringify([castChipNames(node), ...["picture_1", "picture_2", "picture_3", "picture_4", "video", ...JOBS].map((name) => {
    const source = linkSource(node, name);
    return source ? [source.id ?? 1, source.imgs?.[0]?.src ?? ""] : 0;
  })]);
  const sync = (values) => {
    latest = values;
    const now = shapeOf();
    if (now !== shape) { shape = now; build(values); return; }
    for (const run of syncs) run(values);
  };
  const watch = setInterval(() => sync(latest), WATCH);
  chainCallback(node, "onRemoved", () => {
    clearInterval(watch);
    if (openMenu && element.contains(openMenu.owner)) openMenu.close();
  });
  chainCallback(node, "onConfigure", () => queueMicrotask(() => keepOldJobLinks(node)));
  return { element, sync };
}
