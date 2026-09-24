// Workflow Note 🆎 — the card that makes a shared workflow self-explanatory.
//
// One hidden STRING widget holds the card as JSON (title, subtitle, author,
// Markdown body, model rows, node-pack rows, links). This file renders it
// on the node face, checks every model file and node pack against this
// install, and opens the editor dialog. All parsing and the model match
// live in js/shared/workflow_note.mjs under node:test.
//
// Safety: a downloaded workflow is someone else's text. Nothing here goes
// through innerHTML - every string becomes a text node - and only http(s)
// URLs become buttons or links (the parser already filtered them).

import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { BRAND, chainCallback, keepDomWidgetWidthAuto, notifyAusbossChange } from "../shared/index.mjs";
import { copyToClipboard } from "../shared/clipboard.mjs";
import { WIDGET_FRAME, fillNodeHeight } from "../shared/panel_layout.mjs";
import { hideInputsInDef, hideWidget } from "../shared/widget_visibility.mjs";
import {
  COMMON_FOLDERS,
  INPUT_FOLDER,
  LAYOUTS,
  groupModels,
  hostLabel,
  matchInstalled,
  noteIsEmpty,
  normalizeNote,
  packsFromGraph,
  parseMarkdown,
  serializeNote,
} from "../shared/workflow_note.mjs";

const NODE_CLASS = "AUSBOSS_NODES_WorkflowNote";
const CSS_ID = "ausboss-workflow-note-css";
const WIDGET_NAME = "ausboss_workflow_note_panel";
const PANEL_MIN_WIDTH = 300;
const CARD_MIN_HEIGHT = 160;
const BANNER_MIN_HEIGHT = 64;
const DEFAULT_SIZE = [520, 620];
const FOLDER_CACHE_MS = 30000;

// ---------------------------------------------------------------------------
// Server lookups, cached across every note on the canvas
// ---------------------------------------------------------------------------

const folderLists = new Map(); // dir -> { at, promise }
let modelFolders = null; // Promise<string[]> from GET /models

function listFolder(dir, fresh = false) {
  const cached = folderLists.get(dir);
  if (!fresh && cached && performance.now() - cached.at < FOLDER_CACHE_MS) return cached.promise;
  const promise = api
    .fetchApi(`/models/${encodeURIComponent(dir)}`)
    .then((response) => (response.ok ? response.json() : null))
    .then((files) => (Array.isArray(files) ? files : null))
    .catch(() => null);
  folderLists.set(dir, { at: performance.now(), promise });
  return promise;
}

function inputExists(name) {
  const query = new URLSearchParams({ filename: name, type: "input" });
  return api
    .fetchApi(`/view?${query}`, { method: "HEAD" })
    .then((response) => response.ok)
    .catch(() => false);
}

function knownFolders() {
  modelFolders ??= api
    .fetchApi("/models")
    .then((response) => (response.ok ? response.json() : []))
    .then((list) => (Array.isArray(list) ? list.filter((item) => typeof item === "string") : []))
    .catch(() => []);
  return modelFolders;
}

function nodeTypeRegistered(type) {
  return Boolean(type && globalThis.LiteGraph?.registered_node_types?.[type]);
}

function moduleOfType(type) {
  return globalThis.LiteGraph?.registered_node_types?.[type]?.nodeData?.python_module;
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-note{box-sizing:border-box;width:100%;height:100%;padding:2px 6px 6px;pointer-events:none;overflow:hidden;--accent:${BRAND};}
.ausboss-note *{box-sizing:border-box;}
.ausboss-note-card{position:relative;display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden;border:1px solid rgba(0,180,170,.27);border-radius:6px;background:rgba(0,0,0,.28);color:#c8dddd;font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
.ausboss-note-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;pointer-events:auto;padding:0 0 8px;}
.ausboss-note-head{position:relative;padding:12px 40px 10px 16px;border-left:4px solid var(--accent);}
.ausboss-note-title{margin:0;color:#f2f8f8;font-size:22px;font-weight:700;line-height:1.15;letter-spacing:-.01em;overflow-wrap:anywhere;}
.ausboss-note-subtitle{margin:5px 0 0;color:#a9c4c2;font-size:12.5px;line-height:1.35;overflow-wrap:anywhere;}
.ausboss-note-author{margin:6px 0 0;color:#78908e;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;}
.ausboss-note.is-banner .ausboss-note-head{padding:14px 40px 14px 18px;}
.ausboss-note.is-banner .ausboss-note-title{font-size:28px;}
.ausboss-note-edit{position:absolute;top:8px;right:8px;width:24px;height:24px;border:1px solid transparent;border-radius:5px;background:transparent;color:#78908e;font-size:13px;line-height:1;cursor:pointer;pointer-events:auto;}
.ausboss-note-edit:hover{border-color:#3a4047;background:#23272c;color:#fff;}
.ausboss-note-empty{padding:14px 16px 4px;color:#78908e;font-size:11.5px;line-height:1.4;}
.ausboss-note-section{padding:8px 16px 0;}
.ausboss-note-section + .ausboss-note-section{margin-top:6px;border-top:1px solid rgba(255,255,255,.06);padding-top:10px;}
.ausboss-note-h{display:flex;align-items:center;gap:8px;margin:0 0 6px;color:#78908e;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;}
.ausboss-note-h .spacer{flex:1 1 auto;}
.ausboss-note-mini{height:18px;padding:0 7px;border:1px solid #3a4047;border-radius:4px;background:#23272c;color:#9ba2aa;font:10px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.04em;text-transform:none;cursor:pointer;pointer-events:auto;}
.ausboss-note-mini:hover{border-color:var(--accent);color:#fff;}
.ausboss-note-body{user-select:text;-webkit-user-select:text;cursor:text;}
.ausboss-note-body p{margin:0 0 7px;overflow-wrap:anywhere;}
.ausboss-note-body h1,.ausboss-note-body h2,.ausboss-note-body h3{margin:8px 0 5px;color:#eaf4f3;font-weight:700;line-height:1.25;}
.ausboss-note-body h1{font-size:16px;}
.ausboss-note-body h2{font-size:14px;}
.ausboss-note-body h3{font-size:12.5px;text-transform:uppercase;letter-spacing:.06em;color:#a9c4c2;}
.ausboss-note-body ul,.ausboss-note-body ol{margin:0 0 7px;padding-left:20px;}
.ausboss-note-body li{margin:2px 0;overflow-wrap:anywhere;}
.ausboss-note-body hr{margin:8px 0;border:0;border-top:1px solid rgba(255,255,255,.08);}
.ausboss-note-body code{padding:1px 4px;border-radius:3px;background:rgba(255,255,255,.08);font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e6f4f3;}
.ausboss-note-body pre{margin:0 0 7px;padding:7px 9px;overflow-x:auto;border-radius:5px;background:rgba(0,0,0,.35);font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e6f4f3;white-space:pre;}
.ausboss-note-body a,.ausboss-note-link{color:var(--accent);text-decoration:none;pointer-events:auto;}
.ausboss-note-body a:hover,.ausboss-note-link:hover{text-decoration:underline;}
.ausboss-note-folder{margin:8px 0 4px;color:#a9c4c2;font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}
.ausboss-note-folder:first-child{margin-top:0;}
.ausboss-note-row{display:flex;align-items:center;gap:8px;min-height:30px;padding:3px 0;}
.ausboss-note-dot{flex:none;width:8px;height:8px;border-radius:50%;background:#4b5a5a;}
.ausboss-note-dot.checking{background:#4b5a5a;animation:ausboss-note-pulse 1s ease-in-out infinite;}
.ausboss-note-dot.ok{background:var(--accent);box-shadow:0 0 5px rgba(0,180,170,.55);}
.ausboss-note-dot.missing{background:#e0564b;box-shadow:0 0 5px rgba(224,86,75,.5);}
.ausboss-note-dot.unknown{background:#4b5a5a;}
@keyframes ausboss-note-pulse{0%,100%{opacity:.35;}50%{opacity:1;}}
.ausboss-note-file{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px;}
.ausboss-note-name{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#e6f4f3;font:11.5px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;pointer-events:auto;cursor:copy;}
.ausboss-note-meta{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#78908e;font-size:10.5px;}
.ausboss-note-dl{flex:none;display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border:1px solid var(--accent);border-radius:5px;background:rgba(0,180,170,.14);color:#e6f4f3;font-size:11px;font-weight:600;text-decoration:none;white-space:nowrap;pointer-events:auto;cursor:pointer;}
.ausboss-note-dl:hover{background:var(--accent);color:#08211f;}
.ausboss-note-dl .size{font-weight:400;opacity:.8;}
.ausboss-note-pill{flex:none;display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:11px;background:rgba(0,180,170,.16);color:#9fe3dc;font-size:10.5px;white-space:nowrap;}
.ausboss-note-pill.missing{background:rgba(224,86,75,.16);color:#f0a59e;}
.ausboss-note-pill a{color:inherit;text-decoration:none;pointer-events:auto;}
.ausboss-note-pill a:hover{text-decoration:underline;}
.ausboss-note-chips{display:flex;flex-wrap:wrap;gap:6px;}
.ausboss-note-chip{display:inline-flex;align-items:center;height:24px;padding:0 10px;border:1px solid #3a4047;border-radius:12px;background:#23272c;color:#d7dde2;font-size:11px;text-decoration:none;white-space:nowrap;pointer-events:auto;}
.ausboss-note-chip:hover{border-color:var(--accent);color:#fff;}
/* editor dialog */
.ausboss-note-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);}
.ausboss-note-dialog{display:flex;flex-direction:column;width:min(860px,94vw);max-height:92vh;border:1px solid #3a4047;border-radius:9px;background:#1c1f23;box-shadow:0 12px 40px rgba(0,0,0,.6);color:#d7dde2;font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
.ausboss-note-dialog *{box-sizing:border-box;}
.ausboss-note-dhead{display:flex;align-items:center;gap:8px;padding:11px 14px;border-bottom:1px solid #2c3238;color:${BRAND};font-weight:600;}
.ausboss-note-dhead .spacer{flex:1 1 auto;}
.ausboss-note-dbody{flex:1 1 auto;min-height:0;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:12px;}
.ausboss-note-dfoot{display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid #2c3238;}
.ausboss-note-dfoot .spacer{flex:1 1 auto;}
.ausboss-note-field{display:flex;flex-direction:column;gap:4px;}
.ausboss-note-field > label{color:#9ba2aa;font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;}
.ausboss-note-field .hint{color:#78908e;font-size:10.5px;}
.ausboss-note-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.ausboss-note-dialog input,.ausboss-note-dialog textarea,.ausboss-note-dialog select{width:100%;padding:5px 8px;border:1px solid #3a4047;border-radius:5px;background:#23272c;color:#e6f4f3;font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;outline:none;}
.ausboss-note-dialog textarea{min-height:120px;resize:vertical;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}
.ausboss-note-dialog textarea.json{min-height:320px;}
.ausboss-note-dialog input:focus,.ausboss-note-dialog textarea:focus,.ausboss-note-dialog select:focus{border-color:${BRAND};}
.ausboss-note-table{display:flex;flex-direction:column;gap:4px;}
.ausboss-note-trow{display:grid;gap:6px;align-items:center;}
.ausboss-note-trow.models{grid-template-columns:minmax(120px,1.4fr) 130px 70px minmax(120px,1.6fr) 24px;}
.ausboss-note-trow.packs{grid-template-columns:minmax(120px,1fr) minmax(120px,1.4fr) minmax(120px,1fr) 24px;}
.ausboss-note-trow.links{grid-template-columns:minmax(120px,1fr) minmax(120px,2fr) 24px;}
.ausboss-note-trow.head{color:#78908e;font-size:10px;letter-spacing:.06em;text-transform:uppercase;}
.ausboss-note-x{width:24px;height:24px;padding:0;border:1px solid transparent;border-radius:5px;background:transparent;color:#9ba2aa;cursor:pointer;}
.ausboss-note-x:hover{border-color:#3a4047;color:#fff;}
.ausboss-note-btn{height:26px;padding:0 10px;border:1px solid #3a4047;border-radius:5px;background:#23272c;color:#d7dde2;font:12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;}
.ausboss-note-btn:hover{border-color:${BRAND};color:#fff;}
.ausboss-note-btn.primary{border-color:${BRAND};background:${BRAND};color:#08211f;font-weight:600;}
.ausboss-note-btn.primary:hover{background:#19c9be;}
.ausboss-note-seg{display:inline-flex;border:1px solid #3a4047;border-radius:5px;overflow:hidden;}
.ausboss-note-seg button{height:26px;padding:0 10px;border:none;background:#23272c;color:#9ba2aa;font:12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;}
.ausboss-note-seg button + button{border-left:1px solid #3a4047;}
.ausboss-note-seg button.on{background:${BRAND};color:#08211f;font-weight:600;}
.ausboss-note-error{color:#f0a59e;font-size:11px;}
`;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function externalLink(url, className, text) {
  const link = el("a", className, text);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  // A click on a link must not become a node drag.
  link.addEventListener("pointerdown", (event) => event.stopPropagation());
  return link;
}

function spansInto(parent, spans) {
  for (const span of spans) {
    if (span.type === "br") parent.append(document.createElement("br"));
    else if (span.type === "strong") parent.append(el("strong", "", span.text));
    else if (span.type === "em") parent.append(el("em", "", span.text));
    else if (span.type === "code") parent.append(el("code", "", span.text));
    else if (span.type === "link") parent.append(externalLink(span.url, "", span.text));
    else parent.append(document.createTextNode(span.text));
  }
}

function markdownInto(parent, text) {
  for (const block of parseMarkdown(text)) {
    if (block.type === "heading") {
      const heading = el(`h${block.level}`);
      spansInto(heading, block.spans);
      parent.append(heading);
    } else if (block.type === "list") {
      const list = el(block.ordered ? "ol" : "ul");
      for (const item of block.items) {
        const li = el("li");
        spansInto(li, item);
        list.append(li);
      }
      parent.append(list);
    } else if (block.type === "hr") parent.append(el("hr"));
    else if (block.type === "code") parent.append(el("pre", "", block.text));
    else {
      const paragraph = el("p");
      spansInto(paragraph, block.spans);
      parent.append(paragraph);
    }
  }
}

async function copyText(text, element) {
  const copied = await copyToClipboard(text);
  // A blocked clipboard says so; the name is still on screen to copy by hand.
  const note = copied ? "copied" : "copy blocked";
  const before = element.textContent;
  element.textContent = note;
  setTimeout(() => { if (element.textContent === note) element.textContent = before; }, copied ? 700 : 1400);
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

function setDot(dot, status, title) {
  dot.className = `ausboss-note-dot ${status}`;
  dot.title = title ?? "";
}

function modelRow(state, row) {
  const line = el("div", "ausboss-note-row");
  const dot = el("span", "ausboss-note-dot checking");
  const file = el("div", "ausboss-note-file");
  const name = el("div", "ausboss-note-name", row.name);
  name.title = `${row.name} - click to copy the file name`;
  name.addEventListener("pointerdown", (event) => event.stopPropagation());
  name.addEventListener("click", () => copyText(row.name, name));
  file.append(name);
  const metaBits = [];
  if (row.note) metaBits.push(row.note);
  const meta = el("div", "ausboss-note-meta", metaBits.join(" · "));
  if (metaBits.length) file.append(meta);
  const action = el("span");
  line.append(dot, file, action);

  const showDownload = () => {
    action.textContent = "";
    if (row.url) {
      const button = externalLink(row.url, "ausboss-note-dl", "");
      button.append(document.createTextNode("Download"));
      if (row.size) button.append(el("span", "size", row.size));
      button.title = `Opens ${hostLabel(row.url) || row.url} in a new tab`;
      action.append(button);
    } else if (row.size) {
      action.append(el("span", "ausboss-note-meta", row.size));
    }
  };
  const showInstalled = (path) => {
    action.textContent = "";
    const pill = el("span", "ausboss-note-pill");
    pill.append(document.createTextNode("✓ installed"));
    if (row.url) {
      const link = externalLink(row.url, "", "↗");
      link.title = `Source: ${hostLabel(row.url) || row.url}`;
      pill.append(link);
    }
    pill.title = path ? `Found: ${path}` : "Found";
    action.append(pill);
  };
  showDownload();
  state.rows.push({ row, dot, showDownload, showInstalled });
  return line;
}

function packRow(state, row) {
  const line = el("div", "ausboss-note-row");
  const dot = el("span", "ausboss-note-dot unknown");
  const file = el("div", "ausboss-note-file");
  const name = el("div", "ausboss-note-name", row.name);
  name.style.cursor = "default";
  file.append(name);
  const action = el("span");
  line.append(dot, file, action);
  const installed = row.node ? nodeTypeRegistered(row.node) : null;
  if (installed === true) {
    setDot(dot, "ok", `${row.node} is registered on this install`);
    const pill = el("span", "ausboss-note-pill", "✓ installed");
    if (row.url) {
      const link = externalLink(row.url, "", "↗");
      link.title = row.url;
      pill.append(link);
    }
    action.append(pill);
  } else {
    setDot(dot, installed === false ? "missing" : "unknown",
      installed === false ? `${row.node} is not registered here - install the pack` : "No probe node set, so this row is not checked");
    if (row.url) {
      const button = externalLink(row.url, "ausboss-note-dl", installed === false ? "Get it" : "Open");
      button.title = row.url;
      action.append(button);
    } else if (installed === false) {
      action.append(el("span", "ausboss-note-pill missing", "missing"));
    }
  }
  return line;
}

function sectionHeading(text) {
  const heading = el("div", "ausboss-note-h");
  heading.append(el("span", "", text), el("span", "spacer"));
  return heading;
}

// The frontend hangs a "which pack" badge above every custom node. On a
// banner - a title label for a column or stage - it floats in space, so
// the banner layout hides it and the card layout puts it back.
function setBadgesHidden(node, hidden) {
  if (hidden === Boolean(node.__ausbossBadgesHidden)) return;
  try {
    if (hidden) {
      node.__ausbossBadgeStash = node.badges;
      Object.defineProperty(node, "badges", { configurable: true, get: () => [], set: () => {} });
    } else {
      delete node.badges;
      node.badges = node.__ausbossBadgeStash ?? [];
    }
    node.__ausbossBadgesHidden = hidden;
  } catch {
    // A frozen node keeps its badge; nothing else depends on this.
  }
}

function render(state) {
  const { note } = state;
  const root = state.root;
  root.classList.toggle("is-banner", note.layout === "banner");
  setBadgesHidden(state.node, note.layout === "banner" && !noteIsEmpty(note));
  root.style.setProperty("--accent", note.accent || BRAND);
  const scroll = state.scroll;
  scroll.textContent = "";
  state.rows = [];

  const head = el("div", "ausboss-note-head");
  head.append(el("h1", "ausboss-note-title", note.title || "Untitled workflow"));
  if (note.subtitle) head.append(el("p", "ausboss-note-subtitle", note.subtitle));
  if (note.author) head.append(el("p", "ausboss-note-author", `by ${note.author}`));
  const edit = el("button", "ausboss-note-edit", "✎");
  edit.type = "button";
  edit.title = "Edit this note";
  edit.addEventListener("pointerdown", (event) => event.stopPropagation());
  edit.addEventListener("click", () => openEditor(state));
  head.append(edit);
  scroll.append(head);

  if (noteIsEmpty(note)) {
    scroll.append(el("div", "ausboss-note-empty",
      "Click ✎ to give this workflow a title, a how-to, the models it needs with download links, and your own links."));
    state.domWidget.options.getMinHeight = () => CARD_MIN_HEIGHT + WIDGET_FRAME;
    return;
  }
  if (note.layout === "banner") {
    state.domWidget.options.getMinHeight = () => BANNER_MIN_HEIGHT + WIDGET_FRAME;
    return;
  }
  state.domWidget.options.getMinHeight = () => CARD_MIN_HEIGHT + WIDGET_FRAME;

  if (note.body.trim()) {
    const section = el("div", "ausboss-note-section");
    const body = el("div", "ausboss-note-body");
    body.addEventListener("pointerdown", (event) => event.stopPropagation());
    markdownInto(body, note.body);
    section.append(body);
    scroll.append(section);
  }

  if (note.models.length) {
    const section = el("div", "ausboss-note-section");
    const heading = sectionHeading("Models");
    const recheck = el("button", "ausboss-note-mini", "↻ check files");
    recheck.type = "button";
    recheck.title = "Look for each file again (after moving files in, or pressing R)";
    recheck.addEventListener("pointerdown", (event) => event.stopPropagation());
    recheck.addEventListener("click", () => checkModels(state, true));
    heading.append(recheck);
    section.append(heading);
    for (const group of groupModels(note.models)) {
      section.append(el("div", "ausboss-note-folder", `📂 ${group.path}`));
      for (const row of group.rows) section.append(modelRow(state, row));
    }
    scroll.append(section);
  }

  if (note.packs.length) {
    const section = el("div", "ausboss-note-section");
    section.append(sectionHeading("Node packs"));
    for (const row of note.packs) section.append(packRow(state, row));
    scroll.append(section);
  }

  if (note.links.length) {
    const section = el("div", "ausboss-note-section");
    section.append(sectionHeading("Links"));
    const chips = el("div", "ausboss-note-chips");
    for (const row of note.links) {
      if (row.url) chips.append(externalLink(row.url, "ausboss-note-chip", row.label));
      else chips.append(el("span", "ausboss-note-chip", row.label));
    }
    section.append(chips);
    scroll.append(section);
  }

  checkModels(state, false);
}

async function checkModels(state, fresh) {
  const generation = (state.checkGeneration = (state.checkGeneration || 0) + 1);
  const rows = state.rows;
  for (const entry of rows) setDot(entry.dot, "checking", "checking…");
  const byDir = new Map();
  for (const entry of rows) {
    const dir = entry.row.dir;
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(entry);
  }
  await Promise.all([...byDir.entries()].map(async ([dir, entries]) => {
    if (!dir) {
      for (const entry of entries) setDot(entry.dot, "unknown", "No folder set, so this file is not checked");
      return;
    }
    if (dir === INPUT_FOLDER) {
      await Promise.all(entries.map(async (entry) => {
        const found = await inputExists(entry.row.name);
        if (generation !== state.checkGeneration) return;
        if (found) {
          setDot(entry.dot, "ok", "Found in ComfyUI/input");
          entry.showInstalled(`input/${entry.row.name}`);
        } else {
          setDot(entry.dot, "missing", "Not in ComfyUI/input yet");
          entry.showDownload();
        }
      }));
      return;
    }
    const files = await listFolder(dir, fresh);
    if (generation !== state.checkGeneration) return;
    for (const entry of entries) {
      if (files === null) {
        setDot(entry.dot, "unknown", `This install has no "${dir}" model folder, so the file is not checked`);
        entry.showDownload();
        continue;
      }
      const match = matchInstalled(entry.row.name, files);
      if (match.found) {
        setDot(entry.dot, "ok", `Found: ${match.path}`);
        entry.showInstalled(match.path);
      } else {
        setDot(entry.dot, "missing", `Not found in ComfyUI/models/${dir}`);
        entry.showDownload();
      }
    }
  }));
}

// ---------------------------------------------------------------------------
// The editor dialog
// ---------------------------------------------------------------------------

let openDialog = null;

function closeEditor() {
  if (!openDialog) return;
  openDialog.abort.abort();
  openDialog.element.remove();
  openDialog = null;
}

function field(labelText, control, hint) {
  const wrap = el("div", "ausboss-note-field");
  wrap.append(el("label", "", labelText), control);
  if (hint) wrap.append(el("span", "hint", hint));
  return wrap;
}

function input(value, placeholder) {
  const box = el("input");
  box.type = "text";
  box.value = value ?? "";
  if (placeholder) box.placeholder = placeholder;
  return box;
}

function folderSelect(value, folders) {
  const select = el("select");
  const options = [...folders];
  if (value && !options.includes(value)) options.push(value);
  if (!options.includes("")) options.unshift("");
  for (const folder of options) {
    const option = el("option", "", folder || "(folder)");
    option.value = folder;
    select.append(option);
  }
  select.value = value ?? "";
  return select;
}

// A small editable table. `columns` describes each cell; rows are plain
// objects and `read()` returns them back as edited.
function table(kind, columns, rows, makeRow) {
  const box = el("div", "ausboss-note-table");
  const head = el("div", `ausboss-note-trow ${kind} head`);
  for (const column of columns) head.append(el("span", "", column));
  head.append(el("span"));
  box.append(head);
  const body = el("div", "ausboss-note-table");
  box.append(body);
  const entries = [];
  const add = (row) => {
    const line = el("div", `ausboss-note-trow ${kind}`);
    const controls = makeRow(row ?? {});
    for (const control of controls) line.append(control);
    const remove = el("button", "ausboss-note-x", "✕");
    remove.type = "button";
    remove.title = "Remove this row";
    const entry = { line, controls };
    remove.addEventListener("click", () => {
      line.remove();
      entries.splice(entries.indexOf(entry), 1);
    });
    line.append(remove);
    body.append(line);
    entries.push(entry);
    return entry;
  };
  for (const row of rows) add(row);
  return { box, add, entries };
}

async function openEditor(state) {
  closeEditor();
  ensureCss();
  const folders = await knownFolders();
  const folderOptions = [...new Set([...COMMON_FOLDERS, ...folders])];
  const draft = normalizeNote(state.note);

  const overlay = el("div", "ausboss-note-overlay");
  const dialog = el("div", "ausboss-note-dialog");
  const head = el("div", "ausboss-note-dhead");
  head.append(el("span", "", "Workflow Note"), el("span", "spacer"));
  const jsonToggle = el("button", "ausboss-note-btn", "JSON");
  jsonToggle.type = "button";
  jsonToggle.title = "Edit the raw card JSON instead of the form";
  head.append(jsonToggle);
  const body = el("div", "ausboss-note-dbody");
  const foot = el("div", "ausboss-note-dfoot");
  const error = el("span", "ausboss-note-error");
  const cancel = el("button", "ausboss-note-btn", "Cancel");
  cancel.type = "button";
  const save = el("button", "ausboss-note-btn primary", "Save");
  save.type = "button";
  foot.append(error, el("span", "spacer"), cancel, save);
  dialog.append(head, body, foot);
  overlay.append(dialog);

  // --- form ---------------------------------------------------------------
  const form = el("div", "ausboss-note-dbody");
  form.style.padding = "0";
  form.style.overflow = "visible";
  const title = input(draft.title, "Krea 2 Outpaint");
  const subtitle = input(draft.subtitle, "One line on what this workflow does");
  const author = input(draft.author, "your name");
  const accent = input(draft.accent, "#00b4aa");
  let layout = draft.layout;
  const seg = el("div", "ausboss-note-seg");
  const segButtons = LAYOUTS.map((option) => {
    const button = el("button", option === layout ? "on" : "", option === "card" ? "Card" : "Banner (title only)");
    button.type = "button";
    button.addEventListener("click", () => {
      layout = option;
      segButtons.forEach((other, index) => other.classList.toggle("on", LAYOUTS[index] === option));
    });
    seg.append(button);
    return button;
  });
  const grid = el("div", "ausboss-note-grid");
  grid.append(
    field("Title", title),
    field("Author", author),
    field("Subtitle", subtitle),
    field("Layout", seg, "Banner shows just the title - a label for a column or stage."),
    field("Accent color", accent, "Hex like #00b4aa; empty keeps the pack teal."),
  );
  form.append(grid);

  const bodyBox = el("textarea");
  bodyBox.value = draft.body;
  bodyBox.placeholder = "## How it works\n\n1. Load your image\n2. Drag the padding edges\n3. Queue\n\nMarkdown: # headings, **bold**, `code`, [links](https://...), - lists";
  form.append(field("How-to (Markdown)", bodyBox));

  const models = table("models", ["File", "Folder", "Size", "Download URL"], draft.models, (row) => [
    input(row.name, "krea2_turbo_fp8_scaled.safetensors"),
    folderSelect(row.dir, folderOptions),
    input(row.size, "13.1 GB"),
    input(row.url, "https://huggingface.co/.../resolve/main/file.safetensors"),
  ]);
  const modelTools = el("div");
  const addModel = el("button", "ausboss-note-btn", "+ model");
  addModel.type = "button";
  addModel.addEventListener("click", () => models.add({ dir: "diffusion_models" }));
  modelTools.append(addModel);
  form.append(field("Models", models.box, "Each row shows a Download button until the file is found in its folder (subfolders count)."), modelTools);

  const packs = table("packs", ["Pack", "URL", "Probe node class"], draft.packs, (row) => [
    input(row.name, "ComfyUI-AusBoss"),
    input(row.url, "https://github.com/ausboss/ComfyUI-AusBoss"),
    input(row.node, "AUSBOSS_NODES_LoraLoader"),
  ]);
  const packTools = el("div");
  packTools.style.display = "flex";
  packTools.style.gap = "6px";
  const addPack = el("button", "ausboss-note-btn", "+ pack");
  addPack.type = "button";
  addPack.addEventListener("click", () => packs.add({}));
  const detect = el("button", "ausboss-note-btn", "Detect from this workflow");
  detect.type = "button";
  detect.title = "List every custom node pack the open graph uses";
  detect.addEventListener("click", () => {
    const types = (app.graph?._nodes ?? app.graph?.nodes ?? []).map((node) => node.type);
    const have = new Set(packs.entries.map((entry) => entry.controls[0].value.trim()));
    for (const pack of packsFromGraph(types, moduleOfType)) {
      if (have.has(pack.name)) continue;
      packs.add(pack.name === "ComfyUI-AusBoss"
        ? { ...pack, url: "https://github.com/ausboss/ComfyUI-AusBoss" }
        : pack);
    }
  });
  packTools.append(addPack, detect);
  form.append(field("Node packs", packs.box, "The probe node class is checked against this install; a missing one marks the pack missing."), packTools);

  const links = table("links", ["Label", "URL"], draft.links, (row) => [
    input(row.label, "GitHub"),
    input(row.url, "https://github.com/ausboss"),
  ]);
  const linkTools = el("div");
  const addLink = el("button", "ausboss-note-btn", "+ link");
  addLink.type = "button";
  addLink.addEventListener("click", () => links.add({}));
  linkTools.append(addLink);
  form.append(field("Links", links.box, "Your pages: GitHub, Civitai, YouTube, Discord…"), linkTools);

  // --- raw JSON -------------------------------------------------------------
  const jsonBox = el("textarea", "json");
  let showingJson = false;

  const readForm = () => normalizeNote({
    title: title.value,
    subtitle: subtitle.value,
    author: author.value,
    body: bodyBox.value,
    layout,
    accent: accent.value,
    models: models.entries.map(({ controls }) => ({
      name: controls[0].value, dir: controls[1].value, size: controls[2].value, url: controls[3].value,
    })),
    packs: packs.entries.map(({ controls }) => ({
      name: controls[0].value, url: controls[1].value, node: controls[2].value,
    })),
    links: links.entries.map(({ controls }) => ({ label: controls[0].value, url: controls[1].value })),
  });

  body.append(form);
  jsonToggle.addEventListener("click", () => {
    if (!showingJson) {
      jsonBox.value = JSON.stringify(readForm(), null, 2);
      body.textContent = "";
      body.append(field("Card JSON", jsonBox, "The exact text stored in the workflow. Save applies it."));
      jsonToggle.textContent = "Form";
    } else {
      // Going back to the form discards JSON edits that did not parse.
      try {
        const parsed = normalizeNote(JSON.parse(jsonBox.value));
        Object.assign(draft, parsed);
        closeEditor();
        state.note = parsed;
        openEditor(state);
        return;
      } catch {
        error.textContent = "That JSON does not parse - fix it or Cancel.";
        return;
      }
    }
    showingJson = !showingJson;
  });

  const commit = () => {
    let next;
    if (showingJson) {
      try {
        next = normalizeNote(JSON.parse(jsonBox.value));
      } catch {
        error.textContent = "That JSON does not parse - fix it or Cancel.";
        return;
      }
    } else next = readForm();
    state.note = next;
    state.valueWidget.value = serializeNote(next);
    closeEditor();
    render(state);
    state.node.setDirtyCanvas?.(true, true);
    notifyAusbossChange();
  };
  save.addEventListener("click", commit);
  cancel.addEventListener("click", closeEditor);

  const abort = new AbortController();
  // Keys typed into the dialog are the dialog's, not the canvas's shortcuts.
  overlay.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") closeEditor();
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) commit();
  }, { signal: abort.signal });
  overlay.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    if (event.target === overlay) closeEditor();
  }, { signal: abort.signal });
  overlay.addEventListener("wheel", (event) => event.stopPropagation(), { signal: abort.signal });
  document.body.append(overlay);
  openDialog = { element: overlay, abort };
  title.focus();
}

// ---------------------------------------------------------------------------
// Node wiring
// ---------------------------------------------------------------------------

function buildPanel(node) {
  if (node.__ausbossNote) return node.__ausbossNote;
  ensureCss();
  const widget = node.widgets?.find((item) => item.name === "note");
  if (!widget) return null;
  hideWidget(widget);

  const root = el("div", "ausboss-note");
  const card = el("div", "ausboss-note-card");
  const scroll = el("div", "ausboss-note-scroll");
  card.append(scroll);
  root.append(card);
  // Selecting text or scrolling the card must not read as a node drag; a
  // press on empty card space still falls through to the canvas.
  scroll.addEventListener("pointerdown", (event) => {
    if (event.target !== scroll) event.stopPropagation();
  });

  const domWidget = node.addDOMWidget(WIDGET_NAME, "ausboss_workflow_note", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => CARD_MIN_HEIGHT + WIDGET_FRAME,
  });
  keepDomWidgetWidthAuto(domWidget);
  fillNodeHeight(domWidget, {
    minWidth: PANEL_MIN_WIDTH,
    minHeight: () => (domWidget.options.getMinHeight?.() ?? CARD_MIN_HEIGHT + WIDGET_FRAME),
    minNodeSize: [PANEL_MIN_WIDTH, 120],
  });

  // valueWidget is the hidden STRING (the storage the editor writes
  // through); domWidget is the panel the layout sizes.
  const state = (node.__ausbossNote = {
    node, domWidget, valueWidget: widget, root, card, scroll, rows: [],
    note: normalizeNote(widget.value),
  });
  render(state);
  node.setSize?.([
    Math.max(node.size?.[0] ?? 0, DEFAULT_SIZE[0]),
    Math.max(node.size?.[1] ?? 0, DEFAULT_SIZE[1]),
  ]);
  return state;
}

app.registerExtension({
  name: "AusBoss.WorkflowNote",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    hideInputsInDef(nodeData, ["note"]);
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      buildPanel(this);
    });
    chainCallback(nodeType.prototype, "onConfigure", function () {
      // Saved widget values land after onNodeCreated: re-read them, and
      // keep the saved size rather than the default the panel asked for.
      queueMicrotask(() => {
        const state = buildPanel(this);
        if (!state) return;
        state.note = normalizeNote(state.valueWidget.value);
        render(state);
      });
    });
    chainCallback(nodeType.prototype, "getExtraMenuOptions", function (_canvas, options) {
      const state = this.__ausbossNote;
      if (!state || !Array.isArray(options)) return;
      options.unshift({ content: "✎ Edit Workflow Note", callback: () => openEditor(state) }, null);
    });
    chainCallback(nodeType.prototype, "refreshComboInNode", function () {
      const state = this.__ausbossNote;
      if (state) checkModels(state, true);
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      closeEditor();
      this.__ausbossNote = null;
    });
  },
});
