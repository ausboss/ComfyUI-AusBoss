// Language for the pack's own node faces. ComfyUI translates node names and
// socket names from locales/<language>/nodeDefs.json; the controls the pack
// draws itself (widget cards, panels, bars, menus) are translated here.
//
//   t("Preview")            the Chinese text on a Chinese ComfyUI, else the same text
//   translateText(text)     the lookup alone, no locale check
//
// The Chinese table is js/shared/i18n_zh.mjs, keyed by the English text, so a
// string with no entry stays English. Only what is displayed changes; widget
// names, widget values and saved workflows never go through this.

import { PATTERNS, SCRUB_HINT_EN, SCRUB_HINT_ZH, ZH } from "./i18n_zh.mjs";

// "zh", "zh-CN", "zh-TW" ... all take the Chinese table.
export function isChineseLocale(code) {
  return typeof code === "string" && /^zh(?:[-_]|$)/i.test(code.trim());
}

// ComfyUI's language setting, read each time so a changed setting is seen on
// the next call.
let localeSource = null;
// js/i18n/index.js hands over ComfyUI's own `app`, which is there before
// `window.app` is.
export function useLocaleSource(read) { localeSource = typeof read === "function" ? read : null; }

export function currentLocale() {
  try {
    const value = localeSource ? localeSource() : globalThis.app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export const chineseActive = () => isChineseLocale(currentLocale());

// Look `text` up in the Chinese table, keeping any spaces around it. Returns
// the text itself when there is no entry.
export function translateText(text, table = ZH, patterns = PATTERNS) {
  if (typeof text !== "string" || text === "") return text;
  const trimmed = text.trim();
  if (trimmed === "") return text;
  // A number box's tooltip is "<its own tooltip> <the scrub hint>".
  if (table === ZH && trimmed.endsWith(` ${SCRUB_HINT_EN}`)) {
    const own = trimmed.slice(0, -SCRUB_HINT_EN.length - 1);
    return text.replace(trimmed, () => `${translateText(own, table, patterns)} ${SCRUB_HINT_ZH}`);
  }
  const hit = Object.hasOwn(table, trimmed) ? table[trimmed] : undefined;
  let result = typeof hit === "string" && hit !== "" ? hit : null;
  if (result === null) {
    for (const [pattern, build] of patterns) {
      const match = pattern.exec(trimmed);
      if (match) { result = build(...match); break; }
    }
  }
  if (result === null) return text;
  return text.replace(trimmed, () => result);
}

export function t(text) {
  return chineseActive() ? translateText(text) : text;
}

// ---------- translating a face that is already built ----------

const ATTRIBUTES = ["title", "placeholder", "aria-label"];
// Text that belongs to the user or the graph, or that code reads back.
const SKIP = "[data-no-i18n],[class*='ausboss-callout'],[class*='ausboss-note'],.ausboss-show-text-body,.ausboss-lora-label";
// Text inside these is a value (what is typed, or the page's own scripts), not a label.
const VALUE_HOLDERS = "textarea,input,script,style,[contenteditable]";
const SCOPE = "[class*='ausboss']";

function inScope(element, text = false) {
  if (!element?.closest?.(SCOPE) || element.closest(SKIP)) return false;
  return !(text && element.closest(VALUE_HOLDERS));
}

function translateNode(node) {
  if (node.nodeType === 3) {
    const parent = node.parentElement;
    // An <option>'s text is what the list shows; its value is its own attribute.
    if (!parent || !inScope(parent, true)) return;
    const next = translateText(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
    return;
  }
  if (node.nodeType !== 1 || !(node.matches?.(SCOPE) || node.querySelector?.(SCOPE) || node.closest?.(SCOPE))) return;
  const walker = node.ownerDocument.createTreeWalker(node, 1 | 4);
  const visit = (current) => {
    if (current.nodeType === 3) translateNode(current);
    else if (current.nodeType === 1 && inScope(current)) {
      for (const name of ATTRIBUTES) {
        const value = current.getAttribute(name);
        if (!value) continue;
        const next = translateText(value);
        if (next !== value) current.setAttribute(name, next);
      }
    }
  };
  visit(node);
  for (let current = walker.nextNode(); current; current = walker.nextNode()) visit(current);
}

// Keep every pack face in `root` translated, including text a face writes
// later. Returns a function that stops it.
export function followFaces(root = document.body) {
  translateNode(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") translateNode(record.target);
      else if (record.type === "attributes") translateNode(record.target);
      else for (const added of record.addedNodes) translateNode(added);
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
  return () => observer.disconnect();
}
