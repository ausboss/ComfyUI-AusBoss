// Image Folder 🆎: the gallery under the card.
//
// The card (js/widget_cards) holds the settings. This panel shows the folder's
// pictures as tiles: a click ticks one, Shift + click ticks a run of them, and
// the count line says how many are in. The picked names live in the hidden
// `pictures` widget, so they save, undo and reach an API prompt like any
// other value. With "one per run" the tile the next run loads is ringed, and
// Picture moves on by one each time a run is queued.
//
// The panel only ever asks the pack's own server: the list of pictures, the
// folders for Browse, and small copies of the pictures. Adding pictures goes
// through ComfyUI's own upload into its input folder.

import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { BRAND, chainCallback, chainHandler, keepDomWidgetWidthAuto, notifyAusbossChange, showToast } from "../shared/index.mjs";
import { fillNodeHeight } from "../shared/panel_layout.mjs";
import { isForeignRun } from "../shared/prompt_scope.mjs";
import { commitWidgetValue } from "../shared/widget_card_math.mjs";
import {
  childOf,
  countLine,
  foldersAddress,
  isPicked,
  listAddress,
  nameAt,
  nextPosition,
  parentOf,
  parsePicked,
  pickRange,
  pickedNames,
  placeOf,
  serializePicked,
  thumbAddress,
  togglePick,
} from "../shared/image_folder.mjs";

const NODE_CLASS = "AUSBOSS_NODES_ImageFolder";
const PANEL = "ausboss_image_folder_panel";
const CSS_ID = "ausboss-image-folder-css";
const MIN_WIDTH = 320;
const MIN_HEIGHT = 204;
// Tiles are added this many at a time: a folder of thousands stays light.
const SHOWN_STEP = 300;
const WATCHED = ["source", "folder", "subfolders", "sort", "pictures", "run", "position", "at_the_end"];

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-if{box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column;gap:6px;width:100%;height:100%;padding:2px 6px 6px;color:#cfe3e1;font:11px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
.ausboss-if-bar{flex:none;display:flex;align-items:center;gap:5px;height:20px;}
.ausboss-if-chip{box-sizing:border-box;height:20px;padding:0 8px;border:1px solid rgba(0,180,170,.5);border-radius:10px;background:rgba(0,180,170,.14);color:${BRAND};font:700 9.5px/18px "Segoe UI",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}
.ausboss-if-chip.warn{border-color:#c98a2b;background:rgba(201,138,43,.16);color:#ffd9a0;}
.ausboss-if-gap{flex:1 1 auto;}
.ausboss-if-btn{flex:none;box-sizing:border-box;height:20px;padding:0 8px;border:1px solid #2a3437;border-radius:5px;background:#0e1719;color:#b8d3d1;font:700 9.5px/18px "Segoe UI",sans-serif;letter-spacing:.04em;text-transform:uppercase;cursor:pointer;}
.ausboss-if-btn:hover{color:#fff;border-color:${BRAND};}
.ausboss-if-btn[disabled]{opacity:.38;cursor:default;border-color:#2a3437;color:#b8d3d1;}
.ausboss-if-grid{flex:1 1 auto;min-height:0;box-sizing:border-box;display:grid;grid-template-columns:repeat(auto-fill,minmax(74px,1fr));grid-auto-rows:max-content;align-content:start;gap:5px;padding:5px;overflow-y:auto;border:1px solid rgba(0,180,170,.22);border-radius:6px;background:#0b1214;scrollbar-width:thin;}
.ausboss-if-cell{position:relative;box-sizing:border-box;aspect-ratio:1;padding:0;overflow:hidden;border:1px solid #1f2a2d;border-radius:5px;background:#1b2326;cursor:pointer;}
.ausboss-if-cell img{display:block;width:100%;height:100%;object-fit:cover;opacity:.34;transition:opacity .12s;}
.ausboss-if-cell.picked{border-color:rgba(0,180,170,.8);}
.ausboss-if-cell.picked img{opacity:1;}
.ausboss-if-cell:hover img{opacity:.8;}
.ausboss-if-cell.picked:hover img{opacity:1;}
.ausboss-if-cell.current{outline:2px solid #eafffd;outline-offset:-2px;}
.ausboss-if-tick{position:absolute;top:3px;right:3px;display:none;width:15px;height:15px;border-radius:50%;background:${BRAND};color:#04201e;font:700 10px/15px "Segoe UI",sans-serif;text-align:center;}
.ausboss-if-cell.picked .ausboss-if-tick{display:block;}
.ausboss-if-num{position:absolute;left:3px;bottom:3px;display:none;min-width:8px;padding:0 4px;border-radius:7px;background:rgba(0,0,0,.72);color:#dffaf7;font:700 9px/14px "Segoe UI",sans-serif;text-align:center;}
.ausboss-if-cell.picked .ausboss-if-num{display:block;}
.ausboss-if-cell.done .ausboss-if-num{background:${BRAND};color:#04201e;}
.ausboss-if-note{grid-column:1/-1;align-self:center;padding:22px 12px;color:#8fa7a5;font-size:11.5px;line-height:1.45;text-align:center;}
.ausboss-if-more{grid-column:1/-1;height:24px;border:1px dashed #2a3437;border-radius:5px;background:transparent;color:#8fa7a5;font:600 10.5px/22px "Segoe UI",sans-serif;cursor:pointer;}
.ausboss-if-more:hover{color:#fff;border-color:${BRAND};}
.ausboss-if-browse{position:fixed;z-index:10000;box-sizing:border-box;display:flex;flex-direction:column;width:270px;max-height:330px;border:1px solid rgba(0,180,170,.5);border-radius:8px;background:#0c1416;box-shadow:0 12px 32px rgba(0,0,0,.6);color:#cfe3e1;font:11.5px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
.ausboss-if-browse-path{flex:none;padding:8px 10px 6px;border-bottom:1px solid #1d282b;color:#78908e;font:10.5px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere;}
.ausboss-if-browse-path b{color:#e6f4f3;font-weight:600;}
.ausboss-if-browse-list{flex:1 1 auto;min-height:40px;overflow-y:auto;padding:4px;scrollbar-width:thin;}
.ausboss-if-browse-row{display:block;width:100%;box-sizing:border-box;padding:5px 8px;border:0;border-radius:5px;background:transparent;color:#cfe3e1;font:inherit;text-align:left;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ausboss-if-browse-row:hover{background:rgba(0,180,170,.16);color:#fff;}
.ausboss-if-browse-row.up{color:#8fa7a5;}
.ausboss-if-browse-none{padding:8px;color:#78908e;}
.ausboss-if-browse-foot{flex:none;display:flex;gap:6px;justify-content:flex-end;padding:6px 8px;border-top:1px solid #1d282b;}
.ausboss-if-browse-foot .use{background:${BRAND};border-color:${BRAND};color:#04201e;}
`;
  document.head.appendChild(style);
}

function el(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function widgetOf(node, name) {
  return node.widgets?.find((widget) => widget?.name === name) ?? null;
}

function settings(node) {
  const value = (name, fallback) => widgetOf(node, name)?.value ?? fallback;
  return {
    source: String(value("source", "input")),
    folder: String(value("folder", "") ?? "").trim(),
    subfolders: Boolean(value("subfolders", false)),
    sort: String(value("sort", "name")),
    pictures: String(value("pictures", "") ?? ""),
    run: String(value("run", "all in one run")),
    position: Number(value("position", 1)) || 1,
    afterRun: String(value("after_run", "next")),
    atTheEnd: String(value("at_the_end", "stop the run")),
  };
}

function write(node, name, value) {
  const widget = widgetOf(node, name);
  if (!widget || widget.value === value) return false;
  commitWidgetValue(node, widget, value, app.canvas);
  return true;
}

function isLinked(node, name) {
  return Boolean(node.inputs?.some((input) => (input?.widget?.name ?? input?.name) === name && input.link != null));
}

// --- the tiles -------------------------------------------------------------------
function cellFor(state, picture) {
  const cell = el("button", "ausboss-if-cell");
  cell.type = "button";
  cell.dataset.name = picture.name;
  cell.title = picture.name;
  const img = el("img");
  img.alt = "";
  img.decoding = "async";
  img.draggable = false;
  img.dataset.src = api.apiURL(thumbAddress({ ...state.shown, name: picture.name, v: picture.v }));
  cell.append(img, el("span", "ausboss-if-tick", "✓"), el("span", "ausboss-if-num"));
  state.watcher?.observe(cell);
  return cell;
}

// Rebuild the tiles: the folder, or what it holds, changed.
function rebuild(state) {
  state.watcher?.disconnect();
  state.grid.replaceChildren();
  state.cells = new Map();
  if (state.error) {
    state.grid.append(el("div", "ausboss-if-note", state.error));
  } else if (!state.list.length) {
    state.grid.append(el("div", "ausboss-if-note", state.busy
      ? "Looking in the folder..."
      : "No pictures in this folder. Press Add, drop pictures on the node, or choose another folder."));
  } else {
    for (const picture of state.list.slice(0, state.limit)) {
      const cell = cellFor(state, picture);
      state.cells.set(picture.name, cell);
      state.grid.append(cell);
    }
    const rest = state.list.length - state.limit;
    if (rest > 0) {
      const more = el("button", "ausboss-if-more", `Show ${Math.min(rest, SHOWN_STEP)} more of ${rest}`);
      more.type = "button";
      more.addEventListener("click", () => { state.limit += SHOWN_STEP; rebuild(state); });
      state.grid.append(more);
    }
  }
  paint(state);
}

// Bring ticks, numbers, the ring and the count line up to date.
function paint(state) {
  const now = settings(state.node);
  const picked = parsePicked(now.pictures);
  const names = state.names;
  const next = now.run === "one per run" ? nameAt(picked, names, now.position, now.atTheEnd) : null;
  const order = new Map(pickedNames(picked, names).map((name, index) => [name, index + 1]));
  for (const [name, cell] of state.cells) {
    const place = order.get(name) ?? 0;
    cell.classList.toggle("picked", place > 0);
    cell.classList.toggle("current", name === next);
    cell.classList.toggle("done", state.done.has(name));
    cell.lastChild.textContent = place ? String(place) : "";
  }
  const line = state.error ? { text: "folder not found", warn: true } : countLine(picked, names, now);
  state.chip.textContent = line.text;
  state.chip.classList.toggle("warn", line.warn);
  state.chip.title = [line.text, state.full ? "Only the first 5000 pictures of this folder are listed." : "", state.loadedLine].filter(Boolean).join("\n");
  state.add.disabled = now.source !== "input";
  state.add.title = now.source === "input"
    ? "Add pictures from your computer to this folder. You can also drop them on the node."
    : "Pictures can only be added to the input folder.";
}

// Ask the server what the folder holds.
async function refresh(state) {
  if (!state.alive) return;
  const now = settings(state.node);
  const token = ++state.token;
  state.busy = true;
  const shown = { source: now.source, folder: now.folder, subfolders: now.subfolders, sort: now.sort };
  try {
    const response = await api.fetchApi(listAddress(shown));
    const data = await response.json().catch(() => ({}));
    if (token !== state.token || !state.alive) return;
    if (response.ok) {
      state.list = Array.isArray(data.pictures) ? data.pictures : [];
      state.full = Boolean(data.full);
      state.error = "";
    } else {
      state.list = [];
      state.full = false;
      state.error = String(data?.error ?? "This folder cannot be read.").replace(/^Image Folder:?\s*/, "");
    }
  } catch {
    if (token !== state.token || !state.alive) return;
    state.list = [];
    state.error = "The folder did not load. Press the refresh button to try again.";
  }
  state.busy = false;
  state.shown = shown;
  state.names = state.list.map((picture) => picture.name);
  state.limit = SHOWN_STEP;
  rebuild(state);
}

function scheduleRefresh(state, delay = 160) {
  clearTimeout(state.timer);
  state.timer = setTimeout(() => refresh(state), delay);
}

function setPicked(state, picked) {
  if (write(state.node, "pictures", serializePicked(picked, state.names))) notifyAusbossChange();
  paint(state);
}

// --- adding pictures -------------------------------------------------------------
async function addFiles(state, files) {
  const now = settings(state.node);
  const images = [...(files ?? [])].filter((file) => String(file?.type ?? "").startsWith("image/"));
  if (!images.length) return false;
  if (now.source !== "input") {
    showToast({ severity: "warn", detail: "Pictures can only be added to the input folder. Set From to input first." });
    return true;
  }
  const added = [];
  let failed = 0;
  for (const file of images) {
    const body = new FormData();
    body.append("image", file);
    body.append("type", "input");
    if (now.folder) body.append("subfolder", now.folder);
    try {
      const response = await api.fetchApi("/upload/image", { method: "POST", body });
      if (!response.ok) { failed += 1; continue; }
      const data = await response.json();
      if (data?.name) added.push(String(data.name));
    } catch {
      failed += 1;
    }
  }
  await refresh(state);
  // A hand-made pick takes the new pictures in: they were just put there to be used.
  const picked = parsePicked(settings(state.node).pictures);
  if (picked !== null && added.length) setPicked(state, [...picked, ...added.filter((name) => state.names.includes(name))]);
  const where = now.folder ? `input/${now.folder}` : "the input folder";
  if (added.length) showToast({ detail: `Added ${added.length} picture${added.length === 1 ? "" : "s"} to ${where}.` });
  if (failed) showToast({ severity: "warn", detail: `${failed} file${failed === 1 ? "" : "s"} could not be added.` });
  return true;
}

// --- Browse: the folders inside ComfyUI's input or output folder -----------------
let openBrowse = null;

function closeBrowse() {
  openBrowse?.abort.abort();
  openBrowse?.root.remove();
  openBrowse = null;
}

async function browse(state, anchor) {
  closeBrowse();
  const now = settings(state.node);
  const root = el("div", "ausboss-if-browse");
  const path = el("div", "ausboss-if-browse-path");
  const list = el("div", "ausboss-if-browse-list");
  const foot = el("div", "ausboss-if-browse-foot");
  const cancel = el("button", "ausboss-if-btn", "Cancel");
  const use = el("button", "ausboss-if-btn use", "Use this folder");
  cancel.type = "button"; use.type = "button";
  foot.append(cancel, use);
  root.append(path, list, foot);
  const abort = new AbortController();
  openBrowse = { root, abort };
  let at = now.folder;

  const show = async (folder) => {
    let data = null;
    try {
      const response = await api.fetchApi(foldersAddress({ source: now.source, folder }));
      if (response.ok) data = await response.json();
    } catch { /* shown as an empty list below */ }
    if (openBrowse?.root !== root) return;
    if (!data && folder) return show("");          // a folder that is gone: start at the top
    at = data?.folder ?? "";
    path.replaceChildren(document.createTextNode(`${now.source} / `), el("b", "", at || "(the folder itself)"));
    list.replaceChildren();
    if (at) {
      const up = el("button", "ausboss-if-browse-row up", "↑ up");
      up.type = "button";
      up.addEventListener("click", () => show(parentOf(at)));
      list.append(up);
    }
    const folders = Array.isArray(data?.folders) ? data.folders : [];
    for (const name of folders) {
      const row = el("button", "ausboss-if-browse-row", name);
      row.type = "button"; row.title = name;
      row.addEventListener("click", () => show(childOf(at, name)));
      list.append(row);
    }
    if (!folders.length) list.append(el("div", "ausboss-if-browse-none", "No folders inside this one."));
  };

  use.addEventListener("click", () => {
    if (write(state.node, "folder", at)) notifyAusbossChange();
    closeBrowse();
  });
  cancel.addEventListener("click", closeBrowse);
  document.body.append(root);
  const box = (anchor ?? state.root).getBoundingClientRect();
  root.style.left = `${Math.max(8, Math.min(window.innerWidth - 278, box.left))}px`;
  root.style.top = `${Math.max(8, Math.min(window.innerHeight - 338, box.bottom + 4))}px`;
  window.addEventListener("pointerdown", (event) => { if (!root.contains(event.target)) closeBrowse(); }, { capture: true, signal: abort.signal });
  window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeBrowse(); }, { capture: true, signal: abort.signal });
  root.addEventListener("wheel", (event) => event.stopPropagation(), { signal: abort.signal });
  await show(at);
}

// --- the panel -------------------------------------------------------------------
function buildPanel(node) {
  if (node.__ausbossImageFolder) return node.__ausbossImageFolder;
  ensureCss();
  const root = el("div", "ausboss-if");
  const bar = el("div", "ausboss-if-bar");
  const chip = el("span", "ausboss-if-chip", "");
  const all = el("button", "ausboss-if-btn", "All");
  const none = el("button", "ausboss-if-btn", "None");
  const add = el("button", "ausboss-if-btn", "Add");
  const reload = el("button", "ausboss-if-btn", "↻");
  all.title = "Pick every picture in the folder. Pictures added later are in too.";
  none.title = "Pick none, then click the ones you want.";
  reload.title = "Look in the folder again.";
  for (const button of [all, none, add, reload]) button.type = "button";
  const picker = el("input");
  picker.type = "file"; picker.multiple = true; picker.accept = "image/*"; picker.style.display = "none";
  bar.append(chip, el("span", "ausboss-if-gap"), all, none, add, reload);
  const grid = el("div", "ausboss-if-grid");
  root.append(bar, grid, picker);

  const widget = node.addDOMWidget(PANEL, PANEL, root, { serialize: false, hideOnZoom: false });
  keepDomWidgetWidthAuto(widget);
  // The gallery is not a value: the picked names live in the `pictures` widget.
  widget.serialize = false;
  // A viewport onto the folder: it takes the node's spare height.
  fillNodeHeight(widget, { minWidth: MIN_WIDTH, minHeight: () => MIN_HEIGHT, minNodeSize: [MIN_WIDTH, 90], exactMinWidth: true });

  const abort = new AbortController();
  const state = node.__ausbossImageFolder = {
    node, root, widget, chip, grid, add, abort,
    alive: true, list: [], names: [], cells: new Map(), done: new Set(), limit: SHOWN_STEP,
    shown: { source: "input", folder: "", subfolders: false, sort: "name" },
    token: 0, timer: null, busy: true, error: "", full: false, last: null, loadedLine: "", key: "",
  };
  // A tile's picture is fetched when it scrolls near the view.
  state.watcher = typeof IntersectionObserver === "function"
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target.firstChild;
        if (img?.dataset?.src) { img.src = img.dataset.src; delete img.dataset.src; }
        state.watcher.unobserve(entry.target);
      }
    }, { root: grid, rootMargin: "160px" })
    : null;

  const signal = abort.signal;
  grid.addEventListener("click", (event) => {
    const cell = event.target.closest?.(".ausboss-if-cell");
    if (!cell) return;
    const name = cell.dataset.name;
    const picked = parsePicked(settings(node).pictures);
    const on = !isPicked(picked, name);
    const next = event.shiftKey && state.last && state.last !== name
      ? pickRange(picked, state.names, state.last, name, on)
      : togglePick(picked, state.names, name);
    state.last = name;
    setPicked(state, next);
  }, { signal });
  // With one per run, a double click makes a picture the next one to load.
  grid.addEventListener("dblclick", (event) => {
    const cell = event.target.closest?.(".ausboss-if-cell");
    if (!cell || settings(node).run !== "one per run") return;
    const name = cell.dataset.name;
    let picked = parsePicked(settings(node).pictures);
    if (!isPicked(picked, name)) { picked = togglePick(picked, state.names, name); setPicked(state, picked); }
    if (write(node, "position", placeOf(picked, state.names, name))) notifyAusbossChange();
    paint(state);
  }, { signal });
  all.addEventListener("click", () => setPicked(state, null), { signal });
  none.addEventListener("click", () => setPicked(state, []), { signal });
  reload.addEventListener("click", () => refresh(state), { signal });
  add.addEventListener("click", () => { if (!add.disabled) picker.click(); }, { signal });
  picker.addEventListener("change", async () => { await addFiles(state, picker.files); picker.value = ""; }, { signal });

  state.browse = (anchor) => browse(state, anchor);
  state.refresh = () => refresh(state);

  // A setting changed: the folder is read again, or only the marks move.
  for (const name of WATCHED) {
    const target = widgetOf(node, name);
    if (!target) continue;
    chainCallback(target, "callback", () => {
      if (!state.alive) return;
      const now = settings(node);
      const key = `${now.source}|${now.folder}|${now.subfolders}|${now.sort}`;
      if (key === state.key) { paint(state); return; }
      // Another folder holds other names: a pick made in the old one means nothing there.
      const moved = state.key && (now.source !== state.shown.source || now.folder !== state.shown.folder || now.subfolders !== state.shown.subfolders);
      state.key = key;
      if (moved && !state.restoring && now.pictures) write(node, "pictures", "");
      scheduleRefresh(state);
    });
  }

  // One per run: Picture moves on when a run is queued. A run of another node
  // alone leaves it where it is.
  const position = widgetOf(node, "position");
  if (position) {
    chainCallback(position, "afterQueued", (options) => {
      if (!state.alive || options?.isPartialExecution) return;
      const now = settings(node);
      if (now.run !== "one per run" || isLinked(node, "position")) return;
      const count = pickedNames(parsePicked(now.pictures), state.names).length;
      const next = nextPosition(now.position, count, now.afterRun);
      if (next !== now.position) { position.value = next; position.callback?.(next); }
    });
  }

  // Pictures dropped on the node go into the folder.
  const carriesFiles = (event) => [...(event?.dataTransfer?.types ?? [])].includes("Files");
  chainHandler(node, "onDragOver", (event) => carriesFiles(event));
  chainHandler(node, "onDragDrop", (event) => {
    const files = [...(event?.dataTransfer?.files ?? [])];
    if (!files.some((file) => String(file?.type ?? "").startsWith("image/"))) return false;
    addFiles(state, files);
    return true;
  });

  const now = settings(node);
  state.key = `${now.source}|${now.folder}|${now.subfolders}|${now.sort}`;
  rebuild(state);
  scheduleRefresh(state, 60);
  // A new node opens with room for three rows of tiles. A loaded workflow
  // sets its own size right after this.
  queueMicrotask(() => {
    if (!state.alive || state.sized) return;
    state.sized = true;
    const floor = Number(node.computeSize?.()?.[1]);
    if (Number.isFinite(floor) && node.size?.[1] <= floor + 1) node.setSize?.([Math.max(node.size[0], 340), floor + 96]);
  });
  return state;
}

app.registerExtension({
  name: "ausboss.image_folder",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      buildPanel(this);
    });
    chainCallback(nodeType.prototype, "onConfigure", function () {
      const state = buildPanel(this);
      // A loaded workflow brings its own folder and its own pick.
      state.restoring = true;
      queueMicrotask(() => {
        const now = settings(this);
        state.key = `${now.source}|${now.folder}|${now.subfolders}|${now.sort}`;
        state.restoring = false;
        scheduleRefresh(state, 30);
      });
    });
    chainCallback(nodeType.prototype, "onExecuted", function (output) {
      if (isForeignRun()) return;
      const state = this.__ausbossImageFolder;
      const note = output?.ausboss_image_folder?.[0];
      if (!state?.alive || !note) return;
      for (const name of note.names ?? []) state.done.add(name);
      const loaded = note.loaded ?? [];
      state.loadedLine = loaded.length === 1
        ? `The last run loaded picture ${loaded[0]} of ${note.count}.`
        : `The last run loaded ${loaded.length} of ${note.count} pictures.`;
      paint(state);
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      const state = this.__ausbossImageFolder;
      if (!state) return;
      state.alive = false;
      clearTimeout(state.timer);
      state.watcher?.disconnect();
      state.abort.abort();
      if (openBrowse) closeBrowse();
    });
  },
});
