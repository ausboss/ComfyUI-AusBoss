// The row of chips on H3 Prompt Writer: each picture plugged in, with its @
// name, a small copy of it and its job, then the video and its job. A slot with nothing plugged in is a faint
// dashed chip, so it reads as optional. The widgets underneath stay the
// source of truth: a chip only changes their value.
import { app } from "/scripts/app.js";
import { BRAND, chainCallback } from "./index.mjs";
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
.ausboss-chip select{field-sizing:content;min-width:0;max-width:120px;height:22px;padding:0 11px 0 0;border:none;background:transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M1 1l3 3 3-3' fill='none' stroke='%236f8886' stroke-width='1.4'/%3E%3C/svg%3E") no-repeat right 1px center;color:#d8ecea;font:inherit;appearance:none;-webkit-appearance:none;cursor:pointer;text-overflow:ellipsis}
.ausboss-chip select:focus-visible{outline:2px solid ${BRAND};outline-offset:2px}
.ausboss-chip select option{background:#0f1516;color:#d8ecea}
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

function choice(node, name, into) {
  const widget = widgetOf(node, name);
  const select = add(into, "select");
  for (const value of comboValues(widget)) add(select, "option", value).value = value;
  select.value = widget?.value ?? "";
  select.title = widget?.options?.tooltip ?? "";
  select.addEventListener("change", () => {
    if (widget) commitWidgetValue(node, widget, select.value, app.canvas);
    node.setDirtyCanvas?.(true, true);
  });
  return (values) => { if (document.activeElement !== select) select.value = values[name] ?? ""; };
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
    element.textContent = "";
    syncs = [];
    for (const number of [1, 2, 3, 4]) {
      const source = linkSource(node, `picture_${number}`);
      if (!source) {
        const empty = chip("off");
        empty.textContent = `+ @${number}`;
        empty.title = `Plug a picture into picture_${number} to name it @${number} in your lines.`;
        element.append(empty);
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
    } else {
      const empty = chip("off");
      empty.textContent = "+ video";
      empty.title = "Plug a video into video to copy its moves, swap the person, keep it going or give it a new voice.";
      element.append(empty);
    }

    for (const run of syncs) run(values);
  };

  const shapeOf = () => JSON.stringify(["picture_1", "picture_2", "picture_3", "picture_4", "video", ...JOBS].map((name) => {
    const source = linkSource(node, name);
    return source ? [source.id ?? 1, source.imgs?.[0]?.src ?? ""] : 0;
  }));
  const sync = (values) => {
    latest = values;
    const now = shapeOf();
    if (now !== shape) { shape = now; build(values); return; }
    for (const run of syncs) run(values);
  };
  const watch = setInterval(() => sync(latest), WATCH);
  chainCallback(node, "onRemoved", () => clearInterval(watch));
  chainCallback(node, "onConfigure", () => queueMicrotask(() => keepOldJobLinks(node)));
  return { element, sync };
}
