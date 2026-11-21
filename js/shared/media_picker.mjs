// Media picker: the Source list of the nodes that load a file from
// ComfyUI's input folder (Load Image + Pad, Load Video, the crop / rotate /
// pad editors). A native <select> draws its option list itself, so hovering
// a name there has no events and nothing to show - you pick by filename
// alone. This list previews the file under the pointer (or the arrow keys)
// beside it, a picture for images and a muted loop for videos, and narrows
// as you type.
//
// The combo widget stays the single source of truth: the picker reads its
// options when it opens and hands the chosen value back through onChange.
// Pure decisions live in media_list.mjs for node:test; this file is the DOM.

import { BRAND } from "./index.mjs";
import { THEME } from "./theme.mjs";
import { isAppShortcut, keepKeyInField } from "./canvas_passthrough.mjs";
import { browseMediaRows, mediaFolderOf, mediaLabel, moveHighlight, visibleMediaRange } from "./media_list.mjs";

const CSS_ID = "ausboss-media-picker-css";
const ROW_HEIGHT = 26; // fixed-height rows for virtual scrolling
const OVERSCAN = 8; // rows above and below the scroll window
const PREVIEW_DELAY_MS = 70; // skimming down the list does not start a load per row
const MONO = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';

let openMenu = null;

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-media-pick{display:flex;align-items:center;min-width:0;text-align:left;cursor:pointer}
.ausboss-media-pick-text{flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.ausboss-media-pick-text.empty{color:#6f8886;font-weight:500}
.ausboss-media-pick.open{border-color:${BRAND}}
.ausboss-media-menu{position:fixed;z-index:10000;display:flex;gap:8px;padding:6px;border:1px solid #3a4047;border-radius:8px;background:#1c1f23;box-shadow:0 10px 32px rgba(0,0,0,.55);color:#d7dde2;font:12px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.ausboss-media-col{display:flex;flex-direction:column;gap:6px;width:280px;min-width:0}
.ausboss-media-filter{box-sizing:border-box;width:100%;height:28px;padding:0 8px;border:1px solid #2a3437;border-radius:6px;outline:0;background:#0b0f10;color:#eef7f6;font:12px ${MONO}}
.ausboss-media-filter:focus{border-color:${BRAND}}
.ausboss-media-list{max-height:min(320px,50vh);overflow:auto;overscroll-behavior:contain}
.ausboss-media-space{position:relative;width:100%}
.ausboss-media-space .ausboss-media-item{position:absolute;left:0;right:0;box-sizing:border-box;height:26px;align-items:center}
.ausboss-media-path{padding:0 5px 2px;min-height:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6f8886;font:10px ui-monospace,monospace}
.ausboss-media-navigation{font-weight:600}
.ausboss-media-folder-icon{flex:none;display:flex;align-items:center;width:20px;color:${THEME.faint}}
.ausboss-media-folder-icon svg{width:12px;height:12px}
.ausboss-media-item{display:flex;min-width:0;padding:5px 8px;border-radius:5px;cursor:pointer;white-space:nowrap;font:12px ${MONO}}
.ausboss-media-item.hot{background:#2c3238;color:#fff}
.ausboss-media-item.current .ausboss-media-name{color:${BRAND}}
.ausboss-media-folder{flex:none;color:#6f8886}
.ausboss-media-name{min-width:0;overflow:hidden;text-overflow:ellipsis}
.ausboss-media-more{padding:6px 8px;color:#6f8886;font-size:11px}
.ausboss-media-pane{display:flex;flex-direction:column;gap:6px;width:240px}
.ausboss-media-stage{display:flex;align-items:center;justify-content:center;height:240px;overflow:hidden;border:1px solid #2a3437;border-radius:6px;background:#0b0f10 repeating-conic-gradient(#151a1c 0 25%,#0b0f10 0 50%) 0 0/16px 16px}
.ausboss-media-stage img,.ausboss-media-stage video{display:block;max-width:100%;max-height:100%;object-fit:contain}
.ausboss-media-caption{min-height:14px;color:#8ba3a1;font:11px ${MONO};text-align:center}
.ausboss-media-note{padding:0 12px;color:#6f8886;font-size:11px;text-align:center}
`;
  document.head.appendChild(style);
}

// Folder and "up one folder" marks for the list, drawn in the text colour.
const ICONS = {
  folder: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 3a1 1 0 0 1 1-1h2.6l1.2 1.2H10a1 1 0 0 1 1 1V9a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  back: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 10V2.5M2.5 6 6 2.5 9.5 6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function closeMediaMenu() {
  openMenu?.close();
}

/**
 * @param {object} options
 * @param {"image"|"video"} options.kind what the list holds; videos preview as a muted loop
 * @param {string} [options.className] extra classes for the button, e.g. the look of the select it replaces
 * @param {string} options.placeholder button text when nothing is chosen
 * @param {(value: string) => string} options.viewUrl URL that serves one value (ComfyUI's /view)
 * @param {() => unknown[]} options.getOptions the combo's current values, read on open
 * @param {() => unknown} options.getValue the chosen value
 * @param {(value: string) => void} options.onChange writes a newly chosen value back to the widget
 * @param {string} [options.label] accessible name
 * @param {() => Promise<unknown[]>} [options.loadOptions] a fresh list, asked for each time the list opens;
 *   the list opens with getOptions() and is drawn again when this answers
 * @param {string} [options.folder] the folder the list holds, for its "nothing here" lines
 * @param {string} [options.emptyNote] the line an empty list shows
 */
export function createMediaPicker({ kind = "image", className = "", placeholder, viewUrl, getOptions, getValue, onChange, label, loadOptions, folder = "input", emptyNote }) {
  ensureCss();
  const noun = kind === "video" ? "video" : "image";
  const button = el("button", `ausboss-media-pick ${className}`.trim());
  button.type = "button";
  button.setAttribute("aria-haspopup", "listbox");
  if (label) button.setAttribute("aria-label", label);
  const text = el("span", "ausboss-media-pick-text");
  button.append(text);

  // Inside the output folder's own list, the " [output]" at the end of every
  // name says nothing: it is left off what is shown.
  const tail = folder === "input" ? "" : ` [${folder}]`;
  const bare = (value) => (tail && value.endsWith(tail) ? value.slice(0, -tail.length) : value);

  const refresh = (value = getValue()) => {
    const shown = value == null ? "" : bare(String(value));
    text.textContent = shown || placeholder;
    text.classList.toggle("empty", !shown);
    button.title = shown ? `${shown}\nClick to choose another ${noun}` : placeholder;
  };

  const open = () => {
    closeMediaMenu();
    let all = (getOptions() || []).map(String);
    const current = String(getValue() ?? "");
    const menu = el("div", "ausboss-media-menu");
    const column = el("div", "ausboss-media-col");
    const filter = el("input", "ausboss-media-filter");
    filter.type = "text";
    filter.spellcheck = false;
    const nameFilter = () => {
      filter.placeholder = all.length ? `Filter ${all.length} ${noun}${all.length === 1 ? "" : "s"}…` : `No ${noun}s in the ${folder} folder`;
    };
    nameFilter();
    filter.setAttribute("aria-label", `Filter ${noun}s`);
    const list = el("div", "ausboss-media-list");
    list.setAttribute("role", "listbox");
    const pathBar = el("div", "ausboss-media-path");
    column.append(filter, pathBar, list);
    const pane = el("div", "ausboss-media-pane");
    const stage = el("div", "ausboss-media-stage");
    const caption = el("div", "ausboss-media-caption");
    pane.append(stage, caption);
    menu.append(column, pane);

    let shown = [];
    // The folder on show, only UI state; the widget keeps the full file name.
    // It opens where the current pick sits.
    let directory = all.includes(current) ? mediaFolderOf(current, bare) : [];
    const items = new Map();
    let highlight = -1;
    let timer = null;
    let serial = 0;

    const showPreview = (value) => {
      const mine = ++serial;
      stage.replaceChildren();
      caption.textContent = "";
      if (value == null) return;
      const failed = () => {
        if (mine !== serial) return;
        stage.replaceChildren(el("div", "ausboss-media-note", `Can't preview this ${noun}`));
      };
      if (kind === "video") {
        const video = document.createElement("video");
        video.muted = true;
        video.loop = true;
        video.autoplay = true;
        video.playsInline = true;
        video.preload = "auto";
        video.addEventListener("loadedmetadata", () => {
          if (mine !== serial) return;
          const seconds = Number.isFinite(video.duration) ? ` · ${video.duration.toFixed(1)} s` : "";
          caption.textContent = `${video.videoWidth} × ${video.videoHeight}${seconds}`;
        });
        video.addEventListener("error", failed);
        video.src = viewUrl(value);
        stage.append(video);
      } else {
        const image = new Image();
        image.decoding = "async";
        image.alt = "";
        image.addEventListener("load", () => {
          if (mine === serial) caption.textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
        });
        image.addEventListener("error", failed);
        image.src = viewUrl(value);
        stage.append(image);
      }
    };

    // ComfyUI's own select widgets use a virtualizer for long lists. Do the
    // same here with a fixed row height, retaining AusBoss's own preview and
    // widget-commit logic. All filenames stay in `shown`; only visible DOM
    // rows (plus a small buffer) are created.
    let viewport = null;
    let visibleRange = "";

    const navigate = (entry) => {
      directory = entry.directory;
      filter.value = "";
      render(true);
      filter.focus();
    };
    const activate = (entry) => {
      if (!entry) return;
      if (entry.kind === "file") choose(entry.value);
      else navigate(entry);
    };

    const renderViewport = () => {
      if (!viewport) return;
      const visibleHeight = list.clientHeight || 320;
      const { first, last } = visibleMediaRange(shown.length, list.scrollTop, visibleHeight, ROW_HEIGHT, OVERSCAN);
      const range = `${first}:${last}`;
      if (range === visibleRange) return;
      visibleRange = range;
      const fragment = document.createDocumentFragment();
      const searching = Boolean(filter.value.trim());
      items.clear();
      for (let index = first; index < last; index++) {
        const entry = shown[index];
        const value = entry.value;
        const { folder: under, name } = entry.kind === "file"
          ? mediaLabel(bare(value)) : { folder: "", name: entry.label };
        const item = el("div", "ausboss-media-item");
        item.setAttribute("role", "option");
        item.setAttribute("aria-posinset", String(index + 1));
        item.setAttribute("aria-setsize", String(shown.length));
        item.title = entry.kind === "file" ? bare(value) :
          entry.kind === "back" ? "Go to parent folder" : `Open folder: ${entry.label}`;
        item.style.top = `${index * ROW_HEIGHT}px`;
        if (index === highlight) item.classList.add("hot");
        if (entry.kind === "file" && value === current) {
          item.classList.add("current");
          item.setAttribute("aria-selected", "true");
        }
        if (entry.kind !== "file") {
          item.classList.add("ausboss-media-navigation");
          const icon = el("span", "ausboss-media-folder-icon");
          icon.innerHTML = ICONS[entry.kind === "back" ? "back" : "folder"];
          item.append(icon);
        }
        // Inside a folder the path bar already names it; a search shows it.
        if (under && searching) item.append(el("span", "ausboss-media-folder", under));
        item.append(el("span", "ausboss-media-name", entry.kind === "folder" ? `${name}/` : name));
        item.addEventListener("mousemove", () => setHighlight(index, false));
        item.addEventListener("click", () => activate(entry));
        fragment.append(item);
        items.set(index, item);
      }
      viewport.replaceChildren(fragment);
    };

    const setHighlight = (index, scroll) => {
      if (scroll && index >= 0 && index < shown.length) {
        const top = index * ROW_HEIGHT;
        const height = list.clientHeight || 320;
        if (top < list.scrollTop) list.scrollTop = top;
        else if (top + ROW_HEIGHT > list.scrollTop + height) {
          list.scrollTop = Math.max(0, top + ROW_HEIGHT - height);
        }
        renderViewport();
      }
      if (index === highlight) return;
      items.get(highlight)?.classList.remove("hot");
      highlight = index;
      clearTimeout(timer);
      const item = items.get(index);
      if (!item) {
        const entry = index >= 0 ? shown[index] : null;
        showPreview(entry?.kind === "file" ? entry.value : null);
        return;
      }
      item.classList.add("hot");
      const entry = shown[index];
      timer = setTimeout(() => showPreview(entry?.kind === "file" ? entry.value : null), PREVIEW_DELAY_MS);
    };

    const render = (startAtTop = false) => {
      shown = browseMediaRows(all, filter.value, directory, bare);
      pathBar.textContent = filter.value.trim() ? "Search all folders" :
        [folder.charAt(0).toUpperCase() + folder.slice(1), ...directory].join(" / ");
      list.replaceChildren();
      list.scrollTop = 0;
      items.clear();
      highlight = -1;
      clearTimeout(timer);
      viewport = null;
      visibleRange = "";
      if (!shown.length) {
        list.append(el("div", "ausboss-media-more", all.length ? "No matches" : emptyNote || `Upload ${noun === "video" ? "a video" : "an image"} and it shows up here`));
        showPreview(null);
        return;
      }
      viewport = el("div", "ausboss-media-space");
      viewport.style.height = `${shown.length * ROW_HEIGHT}px`;
      list.append(viewport);
      // Preserve AusBoss's original behaviour: bring the selected file into
      // view when opening or filtering, otherwise start at the first match.
      const selected = shown.findIndex((entry) => entry.kind === "file" && entry.value === current);
      const start = startAtTop === true ? 0 : selected >= 0 ? selected : 0;
      renderViewport();
      setHighlight(start, true);
    };
    list.addEventListener("scroll", renderViewport, { passive: true });

    const abort = new AbortController();
    const close = () => {
      clearTimeout(timer);
      abort.abort();
      menu.querySelector("video")?.pause();
      menu.remove();
      button.classList.remove("open");
      if (openMenu?.menu === menu) openMenu = null;
    };
    const choose = (value) => {
      close();
      if (value !== String(getValue() ?? "")) onChange(value);
      refresh(value);
      button.focus();
    };

    filter.addEventListener("input", render);
    filter.addEventListener("keydown", (event) => {
      keepKeyInField(event); // typing and editing keys stay in the filter (Delete, Ctrl+A…)
      if (isAppShortcut(event)) return; // Ctrl + Enter runs the workflow, it does not pick
      const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 }[event.key];
      if (step) {
        event.preventDefault();
        setHighlight(moveHighlight(highlight, step, shown.length), true);
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (highlight >= 0) activate(shown[highlight]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
        button.focus();
      }
    });
    menu.addEventListener("pointerdown", (event) => event.stopPropagation());
    const outside = (event) => !menu.contains(event.target) && !button.contains(event.target);
    window.addEventListener("pointerdown", (event) => { if (outside(event)) close(); }, { capture: true, signal: abort.signal });
    window.addEventListener("wheel", (event) => { if (outside(event)) close(); }, { capture: true, passive: true, signal: abort.signal });
    window.addEventListener("resize", close, { signal: abort.signal });
    window.addEventListener("blur", close, { signal: abort.signal });

    openMenu = { owner: button, menu, close };
    button.classList.add("open");
    document.body.append(menu);
    render();
    if (loadOptions) {
      Promise.resolve().then(loadOptions).then((values) => {
        const fresh = (values || []).map(String);
        if (abort.signal.aborted || (fresh.length === all.length && fresh.every((value, index) => value === all[index]))) return;
        all = fresh;
        nameFilter();
        render();
      }).catch(() => {});
    }
    // Under the button, or above it when the window runs out; kept on screen.
    const box = button.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    let top = box.bottom + 4;
    if (top + height > window.innerHeight - 8 && box.top - height - 4 >= 8) top = box.top - height - 4;
    menu.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    filter.focus();
  };

  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.addEventListener("click", () => (openMenu?.owner === button ? openMenu.close() : open()));
  refresh();

  const closeOwn = () => {
    if (openMenu?.owner === button) openMenu.close();
  };
  return { element: button, refresh, close: closeOwn, dispose: closeOwn };
}
