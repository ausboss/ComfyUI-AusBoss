import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { BRAND, chainCallback, keepDomWidgetWidthAuto } from "../shared/index.mjs";
import {
  gearIconSvg,
  loadSettings,
  openSettingsMenu,
} from "../shared/settings_menu.mjs";
import {
  DEFAULT_STEP,
  FINE_STEP,
  MAX_ROWS,
  clampHighlight,
  commonFolderPrefix,
  filterLoras,
  groupByFolder,
  highlightedName,
  applyTemplate,
  isScrubbing,
  moveHighlight,
  moveRow,
  newRow,
  parseRows,
  parseTemplates,
  removeTemplate,
  roundStrength,
  scrubValue,
  serializeRows,
  setStrength,
  strengthOutOfRange,
  summarizeRows,
  templateFromRows,
  toggleAllRows,
  toggleAllState,
  toggleTrigger,
  upsertTemplate,
} from "../shared/lora_stack.mjs";

const NODE_CLASS = "AUSBOSS_NODES_LoraLoader";
const ROW_HEIGHT = 30;
const ROW_GAP = 6;
const ACTIONS_HEIGHT = 26;
const BAR_HEIGHT = 24;
const STACK_PADDING = 8;
const BLANK_HEIGHT = 44;
const PANEL_PADDING = 10;

// Per-node-type preferences behind the gear button; persisted in
// localStorage so they follow the user across workflows.
const SETTINGS_SCOPE = "lora_loader";
const SETTINGS_SCHEMA = [
  {
    key: "default_strength", label: "Default strength", type: "number",
    default: 1, min: -10, max: 10,
    hint: "Strength a newly added LoRA starts at.",
  },
  {
    key: "step", label: "Strength step", type: "number",
    default: 0.05, min: 0.01, max: 1,
    hint: "Scrub and arrow-key step. Shift always steps by 0.01.",
  },
  {
    key: "separate_strengths", label: "Separate model / CLIP strength",
    type: "toggle", default: false,
    hint: "Two strength boxes per row. Applies to this node and to new ones.",
  },
  {
    key: "separator", label: "Trigger word separator", type: "text",
    default: ", ", placeholder: '", "',
    hint: "Joins the trigger_words output. This node now, new nodes later.",
  },
  {
    key: "hide_extension", label: "Hide file extension", type: "toggle",
    default: true,
    hint: "Show LoRA names without .safetensors.",
  },
  {
    key: "thumbnails", label: "Preview thumbnails", type: "toggle",
    default: true,
    hint: "Poster image beside the picker while hovering a LoRA.",
  },
  {
    key: "civitai_lookup", label: "Civitai lookup button", type: "toggle",
    default: true,
    hint: "Offer the online lookup inside the info card.",
  },
];
// Narrowest node at which a row still works: toggle + picker + strength +
// info + gaps + padding. Enforced through the DOM widget's layout minimum,
// so the node cannot be resized to where the fixed-width row controls would
// hang past the right edge.
const PANEL_MIN_WIDTH = 320;

function installStyles() {
  if (document.getElementById("ausboss-lora-styles")) return;
  const style = document.createElement("style");
  style.id = "ausboss-lora-styles";
  style.textContent = `
  .ausboss-lora-panel, .ausboss-lora-panel *,
  .ausboss-lora-pop, .ausboss-lora-pop *,
  .ausboss-lora-hoverthumb { box-sizing: border-box; }
  .ausboss-lora-panel { display: flex; flex-direction: column; gap: ${ROW_GAP}px;
    width: 100%; padding: ${PANEL_PADDING}px; font: 12px system-ui; color: #d7dde2;
    overflow: hidden; }
  .ausboss-lora-row { display: flex; align-items: center; gap: 6px; height: ${ROW_HEIGHT}px; }
  .ausboss-lora-row.off { opacity: 0.45; }
  .ausboss-lora-toggle { width: 30px; height: 16px; border-radius: 8px; border: none;
    background: #3a4047; cursor: pointer; position: relative; flex: none; padding: 0; }
  .ausboss-lora-toggle::after { content: ""; position: absolute; top: 2px; left: 2px;
    width: 12px; height: 12px; border-radius: 50%; background: #9ba2aa; transition: left .12s; }
  .ausboss-lora-toggle.on { background: ${BRAND}; }
  .ausboss-lora-toggle.on::after { left: 16px; background: #fff; }
  .ausboss-lora-toggle.mixed { background: #4d6763; }
  .ausboss-lora-toggle.mixed::after { left: 9px; background: #cfd6da; }
  .ausboss-lora-actions { display: flex; height: ${ACTIONS_HEIGHT}px; }
  .ausboss-lora-bar { display: flex; align-items: center; gap: 8px; height: ${BAR_HEIGHT}px;
    padding: 0 2px; color: #9ba2aa; }
  .ausboss-lora-gear { margin-left: auto; width: 24px; height: 24px; border: 1px solid #3a4047;
    border-radius: 5px; background: #23272c; color: #9ba2aa; cursor: pointer;
    display: grid; place-items: center; flex: none; padding: 0; }
  .ausboss-lora-gear:hover { border-color: ${BRAND}; color: ${BRAND}; }
  .ausboss-lora-stack { display: flex; flex-direction: column; gap: ${ROW_GAP}px;
    padding: ${STACK_PADDING}px; border: 1px solid rgba(0,180,170,.22); border-radius: 6px;
    background: rgba(0,0,0,.38); }
  .ausboss-lora-blank { display: flex; align-items: center; justify-content: center;
    width: 100%; height: ${BLANK_HEIGHT - 2}px; border: 1px dashed #3a4047;
    border-radius: 5px; background: transparent; color: #9ba2aa; font: italic 12px system-ui;
    text-align: center; padding: 0 10px; cursor: pointer; }
  .ausboss-lora-blank:hover { border-color: ${BRAND}; color: ${BRAND}; }
  .ausboss-lora-strength.out-of-range { color: #ffb26b; border-color: #7a5230; }
  .ausboss-lora-folder { padding: 6px 8px 2px; color: #9ba2aa; font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.04em; }
  .ausboss-lora-hoverthumb { position: fixed; z-index: 10001; max-width: 180px;
    max-height: 180px; border-radius: 6px; border: 1px solid #3a4047;
    box-shadow: 0 8px 28px rgba(0,0,0,.5); pointer-events: none; background: #1c1f23; }
  .ausboss-lora-range { display: flex; align-items: center; gap: 6px; }
  .ausboss-lora-range input { width: 56px; height: 24px; border: 1px solid #3a4047;
    border-radius: 5px; background: #23272c; color: inherit; text-align: center; outline: none; }
  .ausboss-lora-range input:focus { border-color: ${BRAND}; }
  .ausboss-lora-name { flex: 1 1 auto; min-width: 0; height: 24px; border: 1px solid #3a4047;
    border-radius: 5px; background: #23272c; color: inherit; text-align: left; padding: 0 8px;
    cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ausboss-lora-name:hover { border-color: ${BRAND}; }
  .ausboss-lora-name.missing { color: #ff8a80; }
  .ausboss-lora-name.empty { color: #9ba2aa; font-style: italic; }
  .ausboss-lora-strength { width: 52px; height: 24px; border: 1px solid #3a4047; border-radius: 5px;
    background: #23272c; color: inherit; text-align: center; cursor: ew-resize; flex: none;
    user-select: none; }
  .ausboss-lora-strength:focus { cursor: text; border-color: ${BRAND}; outline: none;
    user-select: text; }
  .ausboss-lora-info { width: 24px; height: 24px; border: 1px solid #3a4047; border-radius: 5px;
    background: #23272c; color: #9ba2aa; cursor: pointer; flex: none;
    font: 700 11px system-ui; }
  .ausboss-lora-info:hover { border-color: ${BRAND}; color: ${BRAND}; }
  .ausboss-lora-add { flex: none; height: ${ACTIONS_HEIGHT}px; border: 1px solid ${BRAND};
    border-radius: 6px; background: ${BRAND}; color: #06211f; font: 600 12px system-ui;
    cursor: pointer; padding: 0 12px; white-space: nowrap; box-shadow: 0 1px 0 rgba(0,0,0,.35); }
  .ausboss-lora-add:hover { background: #00c9be; border-color: #00c9be; }
  .ausboss-lora-add:active { transform: translateY(1px); box-shadow: none; }
  .ausboss-lora-add:focus-visible { outline: 2px solid #9becf5; outline-offset: 1px; }
  .ausboss-lora-add:disabled { opacity: 0.4; cursor: default; }
  .ausboss-lora-actions .ausboss-lora-add { flex: 1 1 auto; }
  .ausboss-lora-summary { color: #9ba2aa; flex: 1 1 auto; text-align: right; }
  .ausboss-lora-pop { position: fixed; z-index: 10000; background: #1c1f23;
    border: 1px solid #3a4047; border-radius: 7px; box-shadow: 0 8px 28px rgba(0,0,0,.5);
    font: 12px system-ui; color: #d7dde2; display: flex; flex-direction: column; }
  .ausboss-lora-search { margin: 8px; height: 26px; border: 1px solid #3a4047; border-radius: 5px;
    background: #23272c; color: inherit; padding: 0 8px; outline: none; }
  .ausboss-lora-search:focus { border-color: ${BRAND}; }
  .ausboss-lora-list { overflow-y: auto; max-height: 48vh; padding: 0 4px 6px; }
  .ausboss-lora-option { padding: 5px 8px; border-radius: 4px; cursor: pointer; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; }
  .ausboss-lora-option.highlight { background: #2c3238; }
  .ausboss-lora-option.current { color: ${BRAND}; }
  .ausboss-lora-empty { padding: 10px; color: #9ba2aa; font-style: italic; }
  .ausboss-lora-menu { min-width: 140px; padding: 4px; }
  /* Direct children only - those are the plain list rows. Buttons that sit
     inside a wrapper row (Save, apply, delete) are specialized and keep their
     own look; as a blanket descendant rule this outranked them and forced
     width:100%, which clipped the Save button and stretched the delete x. */
  .ausboss-lora-menu > button { display: block; width: 100%; text-align: left; border: none;
    background: transparent; color: inherit; padding: 6px 8px; border-radius: 4px; cursor: pointer; }
  .ausboss-lora-menu > button:hover:not(:disabled) { background: #2c3238; }
  .ausboss-lora-menu button:disabled { opacity: 0.35; cursor: default; }
  .ausboss-lora-templates { min-width: 240px; padding: 8px; gap: 6px; display: flex;
    flex-direction: column; }
  .ausboss-lora-template-row { display: flex; align-items: center; gap: 4px; }
  .ausboss-lora-template-row > button:first-child { flex: 1 1 auto; min-width: 0; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; text-align: left; border: none;
    background: transparent; color: inherit; padding: 6px 8px; border-radius: 4px; cursor: pointer; }
  .ausboss-lora-template-row > button:first-child:hover { background: #2c3238; }
  .ausboss-lora-template-x { flex: none; width: 22px; height: 22px; border: none; border-radius: 4px;
    background: transparent; color: #9ba2aa; cursor: pointer; font-size: 14px; line-height: 1; }
  .ausboss-lora-template-x:hover { background: #2c3238; color: #ff8a80; }
  .ausboss-lora-card { width: 300px; padding: 10px; gap: 8px; }
  .ausboss-lora-card img { max-width: 100%; max-height: 180px; object-fit: contain;
    border-radius: 5px; align-self: center; }
  .ausboss-lora-card h4 { margin: 0; font-size: 12px; color: #fff; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  .ausboss-lora-meta { color: #9ba2aa; }
  .ausboss-lora-civitai-link { color: ${BRAND}; text-decoration: none; align-self: flex-start; }
  .ausboss-lora-civitai-link:hover { text-decoration: underline; }
  .ausboss-lora-chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .ausboss-lora-chip { border: 1px solid #3a4047; border-radius: 10px; background: #23272c;
    color: inherit; cursor: pointer; padding: 2px 8px; font-size: 11px; }
  .ausboss-lora-chip.active { border-color: ${BRAND}; color: ${BRAND}; }
  .ausboss-lora-fetch { align-self: flex-start; }
  .ausboss-lora-custom { display: flex; gap: 6px; align-items: center; }
  .ausboss-lora-custom input { flex: 1 1 auto; min-width: 0; height: ${ACTIONS_HEIGHT}px;
    border: 1px solid #3a4047; box-sizing: border-box;
    border-radius: 5px; background: #23272c; color: inherit; padding: 0 8px; outline: none; }
  .ausboss-lora-custom input:focus { border-color: ${BRAND}; }
  `;
  document.head.append(style);
}

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function stripExtension(name) {
  return name.replace(/\.(safetensors|sft|ckpt|pt)$/i, "");
}

function hideWidget(widget) {
  if (!widget || widget.__ausbossHidden) return;
  widget.__ausbossHidden = true;
  widget.hidden = true;
  widget.computeSize = () => [0, -4];
  widget.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, minWidth: 0 });
  if (widget.element) widget.element.style.display = "none";
  if (widget.inputEl) widget.inputEl.style.display = "none";
}

async function fetchLoraList() {
  const response = await api.fetchApi("/ausboss/lora/list");
  const data = await response.json();
  return Array.isArray(data.loras) ? data.loras : [];
}

// One shared popup slot: opening any popup closes the previous one, and every
// listener hangs off one AbortController so teardown cannot leak.
let activePopup = null;

function closePopup() {
  if (!activePopup) return;
  activePopup.abort.abort();
  activePopup.element.remove();
  activePopup = null;
}

function openPopup(element, anchorRect, { width } = {}) {
  closePopup();
  const abort = new AbortController();
  element.classList.add("ausboss-lora-pop");
  if (width) element.style.width = `${width}px`;
  document.body.append(element);
  const place = () => {
    const popRect = element.getBoundingClientRect();
    let left = Math.min(anchorRect.left, window.innerWidth - popRect.width - 8);
    let top = anchorRect.bottom + 4;
    if (top + popRect.height > window.innerHeight - 8) {
      top = Math.max(8, anchorRect.top - popRect.height - 4);
    }
    element.style.left = `${Math.max(8, left)}px`;
    element.style.top = `${top}px`;
  };
  place();
  requestAnimationFrame(place);
  document.addEventListener(
    "pointerdown",
    (event) => { if (!element.contains(event.target)) closePopup(); },
    { capture: true, signal: abort.signal }
  );
  window.addEventListener(
    "keydown",
    (event) => { if (event.key === "Escape") { event.stopPropagation(); closePopup(); } },
    { capture: true, signal: abort.signal }
  );
  activePopup = { element, abort };
  return { place };
}

function commitRows(state, rows, { structural = false } = {}) {
  state.rows = rows;
  state.widget.value = serializeRows(rows);
  state.node.graph?.setDirtyCanvas(true, true);
  if (structural) renderRows(state);
  else updateRowValues(state);
}

function linked(state) {
  return state.node.properties?.ausbossLoraLinked !== false;
}

// Display names honor the hide-extension preference everywhere at once.
function displayName(state, name) {
  return state.settings?.hide_extension === false ? name : stripExtension(name);
}

function panelHeight(state) {
  const inner = state.rows.length
    ? state.rows.length * (ROW_HEIGHT + ROW_GAP) - ROW_GAP
    : BLANK_HEIGHT;
  const stack = inner + STACK_PADDING * 2 + 2; // +2 for the stack border
  return (
    PANEL_PADDING * 2 +
    ACTIONS_HEIGHT + ROW_GAP +
    BAR_HEIGHT + ROW_GAP +
    stack
  );
}

function fitNode(state) {
  const width = Math.max(320, state.node.size?.[0] || 320);
  const height = state.node.computeSize ? state.node.computeSize()[1] : panelHeight(state) + 80;
  state.node.setSize?.([width, height]);
  state.node.graph?.setDirtyCanvas(true, true);
}

// ---------- suggested strength ranges ----------

// One cached range per LoRA name; null = known-absent, undefined = not yet
// fetched. Filled lazily from the info route so rows can tint out-of-range
// strengths without a request per render.
const rangeCache = new Map();
const rangeFetches = new Set();

function ensureRange(state, name) {
  if (!name || rangeCache.has(name) || rangeFetches.has(name)) return;
  rangeFetches.add(name);
  api.fetchApi(`/ausboss/lora/info?name=${encodeURIComponent(name)}`)
    .then((response) => response.json())
    .then((data) => {
      rangeCache.set(name, data.ok ? data.info.range ?? null : null);
      updateRowValues(state);
    })
    .catch(() => rangeCache.set(name, null))
    .finally(() => rangeFetches.delete(name));
}

function applyRangeTint(input, row, key) {
  const range = rangeCache.get(row.name);
  input.classList.toggle("out-of-range", strengthOutOfRange(row[key], range ?? null));
  input.title = range && (range.min !== null || range.max !== null)
    ? `Suggested range ${range.min ?? "any"} to ${range.max ?? "any"}. ` + input.dataset.baseTitle
    : input.dataset.baseTitle;
}

// ---------- strength boxes ----------

function strengthBox(state, index, key) {
  const input = el("input", "ausboss-lora-strength");
  input.value = state.rows[index][key].toFixed(2);
  input.dataset.baseTitle = key === "strength"
    ? "Model strength. Drag left/right to scrub, click to type, arrows to step. Shift = fine."
    : "CLIP strength. Drag left/right to scrub, click to type, arrows to step. Shift = fine.";
  input.readOnly = true;
  ensureRange(state, state.rows[index].name);
  applyRangeTint(input, state.rows[index], key);

  const commitValue = (value, structural = false) => {
    let rows = state.rows;
    if (key === "strength") rows = setStrength(rows, index, value, linked(state));
    else rows = rows.map((row, i) => (i === index ? { ...row, strength_clip: roundStrength(value) } : row));
    commitRows(state, rows, { structural });
  };

  let drag = null;
  input.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !input.readOnly) return;
    drag = { x: event.clientX, y: event.clientY, start: state.rows[index][key], scrubbed: false };
    input.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  input.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.scrubbed && isScrubbing(dx, dy)) drag.scrubbed = true;
    if (drag.scrubbed) {
      commitValue(scrubValue(drag.start, dx, event.shiftKey, state.settings?.step));
    }
  });
  const endDrag = (event) => {
    if (!drag) return;
    try { input.releasePointerCapture(event.pointerId); } catch {}
    const wasClick = !drag.scrubbed;
    drag = null;
    if (wasClick) {
      input.readOnly = false;
      input.focus();
      input.select();
    }
  };
  input.addEventListener("pointerup", endDrag);
  input.addEventListener("pointercancel", endDrag);

  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") input.blur();
    else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const coarse = state.settings?.step ?? DEFAULT_STEP;
      const step = (event.shiftKey ? FINE_STEP : coarse) * (event.key === "ArrowUp" ? 1 : -1);
      commitValue(state.rows[index][key] + step);
      input.value = state.rows[index][key].toFixed(2);
      input.select();
    }
  });
  input.addEventListener("blur", () => {
    if (!input.readOnly) {
      const number = Number(input.value);
      if (Number.isFinite(number)) commitValue(number);
      input.readOnly = true;
    }
    input.value = state.rows[index][key].toFixed(2);
  });
  return input;
}

// ---------- picker ----------

function openPicker(state, index, anchor) {
  const pop = el("div");
  const search = el("input", "ausboss-lora-search");
  search.placeholder = "Search LoRAs...";
  const list = el("div", "ausboss-lora-list");
  list.append(el("div", "ausboss-lora-empty", "Loading..."));
  pop.append(search, list);
  const anchorRect = anchor.getBoundingClientRect();
  const { place } = openPopup(pop, anchorRect, { width: Math.max(260, Math.min(380, anchorRect.width + 80)) });
  search.focus();

  let names = [];
  let filtered = [];
  let highlight = -1;

  // One floating poster image per picker; repositioned beside the popup on
  // hover, hidden when a LoRA has no preview file.
  const hoverThumb = el("img", "ausboss-lora-hoverthumb");
  hoverThumb.alt = "";
  hoverThumb.style.display = "none";
  hoverThumb.addEventListener("error", () => { hoverThumb.style.display = "none"; });
  pop.append(hoverThumb);

  const showThumb = (name, optionRect) => {
    if (state.settings?.thumbnails === false) return;
    const popRect = pop.getBoundingClientRect();
    const left = popRect.right + 188 <= window.innerWidth ? popRect.right + 6 : popRect.left - 188;
    hoverThumb.style.left = `${Math.max(4, left)}px`;
    hoverThumb.style.top = `${Math.min(optionRect.top, window.innerHeight - 190)}px`;
    hoverThumb.style.display = "";
    hoverThumb.src = api.apiURL(`/ausboss/lora/thumb?name=${encodeURIComponent(name)}`);
  };

  const pick = (name) => {
    if (!name) return;
    closePopup();
    const rows = state.rows.map((row, i) =>
      // A different file means different trigger words: clear the old ones.
      i === index ? { ...row, name, triggers: name === row.name ? row.triggers : "" } : row
    );
    commitRows(state, rows, { structural: true });
  };

  const appendOption = (name, flatIndex, label) => {
    const option = el("div", "ausboss-lora-option", displayName(state, label));
    option.title = name;
    if (flatIndex === highlight) option.classList.add("highlight");
    if (name === state.rows[index].name) option.classList.add("current");
    option.addEventListener("pointerenter", () => {
      if (highlight !== flatIndex) {
        highlight = flatIndex;
        renderList();
      }
      showThumb(name, option.getBoundingClientRect());
    });
    option.addEventListener("click", () => pick(name));
    option.dataset.ausbossFlat = String(flatIndex);
    list.append(option);
  };

  const renderList = () => {
    filtered = filterLoras(names, search.value);
    highlight = clampHighlight(highlight, filtered.length);
    list.textContent = "";
    hoverThumb.style.display = "none";
    if (!filtered.length) {
      list.append(el("div", "ausboss-lora-empty",
        names.length ? "No matches." : "Put LoRA files in models/loras."));
      return;
    }
    const searching = search.value.trim() !== "";
    if (searching) {
      // Flat results: strip whatever folder prefix every match shares.
      const prefix = commonFolderPrefix(filtered);
      filtered.forEach((name, i) => appendOption(name, i, name.slice(prefix.length)));
    } else {
      // Browse view: bucket by top folder with quiet headers. The grouped
      // display order becomes the keyboard order, so `filtered` is rebuilt
      // to match and arrow/Enter navigation stays consistent with what's
      // on screen (root files can interleave folders in sorted order).
      const groups = groupByFolder(filtered);
      filtered = groups.flatMap((group) => group.names);
      highlight = clampHighlight(highlight, filtered.length);
      let flatIndex = 0;
      for (const group of groups) {
        if (group.folder) list.append(el("div", "ausboss-lora-folder", group.folder));
        for (const name of group.names) {
          const label = group.folder ? name.slice(group.folder.length + 1) : name;
          appendOption(name, flatIndex, label);
          flatIndex += 1;
        }
      }
    }
    list.querySelector(`[data-ausboss-flat="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
    place();
  };

  search.addEventListener("input", () => { highlight = -1; renderList(); });
  search.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      highlight = moveHighlight(highlight, event.key === "ArrowDown" ? 1 : -1, filtered.length);
      renderList();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      highlight = event.key === "Home" ? 0 : filtered.length - 1;
      renderList();
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(highlightedName(filtered, highlight) ?? filtered[0]);
    }
  });

  // Always refetch on open: a stale session cache is how renamed files keep
  // haunting pickers.
  fetchLoraList()
    .then((fetched) => {
      names = fetched;
      const currentIndex = filterLoras(names, "").indexOf(state.rows[index].name);
      highlight = currentIndex >= 0 ? currentIndex : -1;
      renderList();
    })
    .catch(() => {
      list.textContent = "";
      list.append(el("div", "ausboss-lora-empty", "Could not list LoRAs."));
    });
}

// ---------- info card ----------

function openInfo(state, index, anchor) {
  const row = state.rows[index];
  if (!row.name) return;
  const card = el("div", "ausboss-lora-card");
  card.append(el("div", "ausboss-lora-empty", "Loading..."));
  openPopup(card, anchor.getBoundingClientRect());

  const render = (info) => {
    card.textContent = "";
    const image = el("img");
    image.alt = "";
    image.src = api.apiURL(`/ausboss/lora/thumb?name=${encodeURIComponent(row.name)}`);
    image.addEventListener("error", () => image.remove());
    if (info.has_preview) card.append(image);
    card.append(el("h4", "", info.civitai_title || displayName(state, row.name)));
    if (info.base_model) card.append(el("div", "ausboss-lora-meta", `Base model: ${info.base_model}`));
    if (Number.isInteger(info.civitai_model_id)) {
      const link = el("a", "ausboss-lora-civitai-link", "View on Civitai ↗");
      const version = Number.isInteger(info.civitai_version_id)
        ? `?modelVersionId=${info.civitai_version_id}` : "";
      link.href = `https://civitai.com/models/${info.civitai_model_id}${version}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      card.append(link);
    }

    const chipSection = (label, words) => {
      if (!words?.length) return;
      card.append(el("div", "ausboss-lora-meta", label));
      const chips = el("div", "ausboss-lora-chips");
      for (const word of words) {
        const chip = el("button", "ausboss-lora-chip", word);
        chip.type = "button";
        chip.title = "Toggle this trigger word into the row's output";
        const refresh = () => chip.classList.toggle(
          "active",
          state.rows[index].triggers.toLowerCase().split(",").map((part) => part.trim()).includes(word.toLowerCase())
        );
        refresh();
        chip.addEventListener("click", () => {
          const rows = state.rows.map((entry, i) =>
            i === index ? { ...entry, triggers: toggleTrigger(entry.triggers, word) } : entry
          );
          commitRows(state, rows);
          refresh();
        });
        chips.append(chip);
      }
      card.append(chips);
    };
    chipSection("From the file", info.file_triggers);
    chipSection("From Civitai", info.civitai_triggers);
    chipSection("Your words", info.custom_triggers);

    if (state.settings?.civitai_lookup !== false) {
      const label = info.has_civitai ? "Refresh Civitai info" : "Fetch Civitai info";
      const fetchButton = el("button", "ausboss-lora-add ausboss-lora-fetch", label);
      fetchButton.type = "button";
      fetchButton.addEventListener("click", async () => {
        fetchButton.disabled = true;
        fetchButton.textContent = "Fetching...";
        try {
          const response = await api.fetchApi("/ausboss/lora/civitai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: row.name }),
          });
          const data = await response.json();
          if (!data.ok) throw new Error(data.error || "fetch failed");
          if (data.info?.found === false) {
            fetchButton.textContent = "Not found on Civitai";
            return;
          }
          load();
        } catch (error) {
          fetchButton.textContent = "Civitai lookup failed";
        }
      });
      card.append(fetchButton);
    }

    const range = el("div", "ausboss-lora-range");
    range.append(el("span", "ausboss-lora-meta", "Suggested strength"));
    const bound = (key, placeholder) => {
      const inputEl = el("input");
      inputEl.type = "number";
      inputEl.step = "0.05";
      inputEl.placeholder = placeholder;
      const current = info.range?.[key];
      if (current !== null && current !== undefined) inputEl.value = String(current);
      inputEl.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") inputEl.blur();
      });
      inputEl.addEventListener("change", async () => {
        const minValue = Number(range.querySelector("[data-bound=min]").value);
        const maxValue = Number(range.querySelector("[data-bound=max]").value);
        const payload = {
          name: row.name,
          words: info.custom_triggers || [],
          min: range.querySelector("[data-bound=min]").value === "" ? null : minValue,
          max: range.querySelector("[data-bound=max]").value === "" ? null : maxValue,
        };
        try {
          await api.fetchApi("/ausboss/lora/triggers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          rangeCache.delete(row.name);
          ensureRange(state, row.name);
        } catch {}
      });
      inputEl.dataset.bound = key;
      return inputEl;
    };
    range.append(bound("min", "min"), el("span", "ausboss-lora-meta", "to"), bound("max", "max"));
    range.title = "Advisory range for this LoRA; out-of-range strengths tint orange on the row.";
    card.append(range);

    const custom = el("div", "ausboss-lora-custom");
    const wordInput = el("input");
    wordInput.placeholder = "Add your own trigger word...";
    wordInput.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") addButton.click();
    });
    const addButton = el("button", "ausboss-lora-add", "Add");
    addButton.type = "button";
    addButton.addEventListener("click", async () => {
      const word = wordInput.value.trim();
      if (!word) return;
      wordInput.value = "";
      const words = [...(info.custom_triggers || []), word];
      try {
        await api.fetchApi("/ausboss/lora/triggers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: row.name, words }),
        });
      } catch {}
      const rows = state.rows.map((entry, i) =>
        i === index ? { ...entry, triggers: toggleTrigger(entry.triggers, word) } : entry
      );
      commitRows(state, rows);
      load();
    });
    custom.append(wordInput, addButton);
    card.append(custom);
  };

  const load = () => {
    api.fetchApi(`/ausboss/lora/info?name=${encodeURIComponent(row.name)}`)
      .then((response) => response.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error);
        render(data.info);
      })
      .catch(() => {
        card.textContent = "";
        card.append(el("div", "ausboss-lora-empty", "Could not read LoRA info."));
      });
  };
  load();
}

// ---------- templates ----------

const TEMPLATES_KEY = "AusBoss.lora_loader.templates";

function loadTemplates() {
  try {
    return parseTemplates(window.localStorage?.getItem(TEMPLATES_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveTemplates(list) {
  try {
    window.localStorage?.setItem(TEMPLATES_KEY, JSON.stringify(list));
  } catch {}
}

function openTemplates(state, anchor) {
  const menu = el("div", "ausboss-lora-menu ausboss-lora-templates");
  const rebuild = () => {
    menu.textContent = "";
    const saveRow = el("div", "ausboss-lora-custom");
    const nameInput = el("input");
    nameInput.placeholder = "Save current as...";
    nameInput.title = "Name this stack; saving over an existing name replaces it";
    const saveButton = el("button", "ausboss-lora-add", "Save");
    saveButton.type = "button";
    const save = () => {
      const template = templateFromRows(nameInput.value, state.rows);
      if (!template) return;
      saveTemplates(upsertTemplate(loadTemplates(), template));
      nameInput.value = "";
      rebuild();
    };
    saveButton.addEventListener("click", save);
    nameInput.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") save();
    });
    saveRow.append(nameInput, saveButton);
    menu.append(saveRow);

    const templates = loadTemplates();
    if (!templates.length) {
      menu.append(el("div", "ausboss-lora-empty", "No saved templates yet."));
      return;
    }
    for (const template of templates) {
      const row = el("div", "ausboss-lora-template-row");
      const apply = el("button", "", template.name);
      apply.type = "button";
      apply.title = `Replace this node's rows with "${template.name}" (${template.rows.length} LoRA${template.rows.length === 1 ? "" : "s"})`;
      apply.addEventListener("click", () => {
        closePopup();
        commitRows(state, applyTemplate(template), { structural: true });
        fitNode(state);
      });
      const remove = el("button", "ausboss-lora-template-x", "×");
      remove.type = "button";
      remove.title = `Delete "${template.name}"`;
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        saveTemplates(removeTemplate(loadTemplates(), template.name));
        rebuild();
      });
      row.append(apply, remove);
      menu.append(row);
    }
  };
  rebuild();
  openPopup(menu, anchor.getBoundingClientRect(), { width: 240 });
  menu.querySelector("input")?.focus();
}

// ---------- row menu ----------

function openRowMenu(state, index, event) {
  const menu = el("div", "ausboss-lora-menu");
  const item = (label, action, disabled = false) => {
    const button = el("button", "", label);
    button.type = "button";
    button.disabled = disabled;
    button.addEventListener("click", () => { closePopup(); action(); });
    menu.append(button);
  };
  item("Move up", () => commitRows(state, moveRow(state.rows, index, -1), { structural: true }), index === 0);
  item("Move down", () => commitRows(state, moveRow(state.rows, index, 1), { structural: true }),
    index === state.rows.length - 1);
  item("Duplicate", () => {
    const copy = { ...state.rows[index], id: newRow().id };
    const rows = state.rows.slice();
    rows.splice(index + 1, 0, copy);
    commitRows(state, rows, { structural: true });
    fitNode(state);
  }, state.rows.length >= MAX_ROWS);
  item("Remove", () => {
    const rows = state.rows.slice();
    rows.splice(index, 1);
    commitRows(state, rows, { structural: true });
    fitNode(state);
  });
  openPopup(menu, { left: event.clientX, top: event.clientY, bottom: event.clientY, width: 0 });
}

// ---------- rendering ----------

function updateRowValues(state) {
  state.panel.querySelectorAll(".ausboss-lora-strength").forEach((input) => {
    if (input.readOnly && input.__ausbossRead) input.value = input.__ausbossRead();
    if (input.__ausbossTint) input.__ausbossTint();
  });
  const summary = state.panel.querySelector(".ausboss-lora-summary");
  if (summary) summary.textContent = summarizeRows(state.rows);
  const master = state.panel.querySelector(".ausboss-lora-master");
  if (master) {
    const overall = toggleAllState(state.rows);
    master.classList.toggle("on", overall === "on");
    master.classList.toggle("mixed", overall === "mixed");
  }
}

function openSettings(state, anchor) {
  openSettingsMenu({
    scope: SETTINGS_SCOPE,
    schema: SETTINGS_SCHEMA,
    anchor: anchor.getBoundingClientRect(),
    title: "LoRA Loader settings",
    // The menu reflects THIS node's live state where the two overlap.
    initial: {
      ...state.settings,
      separate_strengths: !linked(state),
      ...(state.separatorWidget ? { separator: state.separatorWidget.value } : {}),
    },
    onChange: (values, key) => {
      state.settings = values;
      // Two settings also steer this node's own serialized state, so the
      // change takes effect here immediately, not just on future nodes.
      if (key === "separate_strengths" || key === null) {
        state.node.properties.ausbossLoraLinked = !values.separate_strengths;
        if (!values.separate_strengths) {
          commitRows(
            state,
            state.rows.map((row) => ({ ...row, strength_clip: row.strength })),
          );
        }
      }
      if ((key === "separator" || key === null) && state.separatorWidget) {
        state.separatorWidget.value = values.separator;
      }
      renderRows(state);
      fitNode(state);
    },
  });
}

function renderRows(state) {
  const panel = state.panel;
  panel.textContent = "";

  const addRowAndPick = () => {
    if (state.rows.length >= MAX_ROWS) return;
    const strength = roundStrength(state.settings?.default_strength ?? 1);
    const row = { ...newRow(), strength, strength_clip: strength };
    commitRows(state, [...state.rows, row], { structural: true });
    fitNode(state);
    const pickers = state.panel.querySelectorAll(".ausboss-lora-name");
    pickers[pickers.length - 1]?.click();
  };

  const actions = el("div", "ausboss-lora-actions");
  const add = el("button", "ausboss-lora-add", "+ Add LoRA");
  add.type = "button";
  add.disabled = state.rows.length >= MAX_ROWS;
  add.addEventListener("click", addRowAndPick);
  actions.append(add);
  panel.append(actions);

  const bar = el("div", "ausboss-lora-bar");
  const overall = toggleAllState(state.rows);
  const master = el(
    "button",
    `ausboss-lora-toggle ausboss-lora-master${overall === "on" ? " on" : overall === "mixed" ? " mixed" : ""}`
  );
  master.type = "button";
  master.title = "Toggle every LoRA: mixed or off turns all on, on turns all off";
  master.addEventListener("click", () => {
    commitRows(state, toggleAllRows(state.rows), { structural: true });
  });
  const templates = el("button", "ausboss-lora-gear", "▤");
  templates.type = "button";
  templates.title = "LoRA templates: save this stack, or apply a saved one";
  templates.addEventListener("click", () => openTemplates(state, templates));
  const gear = el("button", "ausboss-lora-gear");
  gear.type = "button";
  gear.title = "LoRA Loader settings";
  gear.innerHTML = gearIconSvg();
  gear.addEventListener("click", () => openSettings(state, gear));
  bar.append(master, el("span", "ausboss-lora-summary", summarizeRows(state.rows)), templates, gear);
  panel.append(bar);

  const stack = el("div", "ausboss-lora-stack");
  if (!state.rows.length) {
    const blank = el("button", "ausboss-lora-blank", "No LoRAs yet");
    blank.type = "button";
    blank.title = "Add a LoRA";
    blank.addEventListener("click", addRowAndPick);
    stack.append(blank);
  }

  state.rows.forEach((row, index) => {
    const rowElement = el("div", "ausboss-lora-row");
    if (!row.enabled) rowElement.classList.add("off");

    const toggle = el("button", `ausboss-lora-toggle${row.enabled ? " on" : ""}`);
    toggle.type = "button";
    toggle.title = "Enable or disable this LoRA";
    toggle.addEventListener("click", () => {
      const rows = state.rows.map((entry, i) =>
        i === index ? { ...entry, enabled: !entry.enabled } : entry
      );
      commitRows(state, rows, { structural: true });
    });

    const name = el("button", "ausboss-lora-name", row.name ? displayName(state, row.name) : "choose a LoRA...");
    name.type = "button";
    name.title = row.name || "Pick a LoRA from models/loras";
    if (!row.name) name.classList.add("empty");
    name.addEventListener("click", () => openPicker(state, index, name));

    const strength = strengthBox(state, index, "strength");
    strength.__ausbossRead = () => state.rows[index]?.strength.toFixed(2) ?? "1.00";
    strength.__ausbossTint = () => state.rows[index] && applyRangeTint(strength, state.rows[index], "strength");
    rowElement.append(toggle, name, strength);
    if (!linked(state)) {
      const clip = strengthBox(state, index, "strength_clip");
      clip.__ausbossRead = () => state.rows[index]?.strength_clip.toFixed(2) ?? "1.00";
      clip.__ausbossTint = () => state.rows[index] && applyRangeTint(clip, state.rows[index], "strength_clip");
      rowElement.append(clip);
    }

    const info = el("button", "ausboss-lora-info", "i");
    info.type = "button";
    info.title = "Preview, base model, and trigger words";
    info.addEventListener("click", () => openInfo(state, index, info));
    rowElement.append(info);

    rowElement.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openRowMenu(state, index, event);
    });
    stack.append(rowElement);
  });

  panel.append(stack);
}

// ---------- node install ----------

function installLoraNode(node) {
  installStyles();
  const widget = node.widgets?.find((item) => item.name === "loras");
  if (!widget) return;
  hideWidget(widget);

  const settings = loadSettings(SETTINGS_SCOPE, SETTINGS_SCHEMA);
  const panel = el("div", "ausboss-lora-panel");
  const state = { node, widget, panel, rows: parseRows(widget.value), settings };
  node.__ausbossLoraState = state;
  if (node.properties && node.properties.ausbossLoraLinked === undefined) {
    node.properties.ausbossLoraLinked = !settings.separate_strengths;
  }

  // The separator rides a hidden standard widget so save/load and the API
  // format see it; a workflow restore overwrites this seed right after.
  const separatorWidget = node.widgets?.find((item) => item.name === "trigger_separator");
  if (separatorWidget) {
    hideWidget(separatorWidget);
    separatorWidget.value = settings.separator;
    state.separatorWidget = separatorWidget;
  }

  const domWidget = node.addDOMWidget("ausboss_lora_rows", "ausboss_lora_rows", panel, {
    serialize: false,
    hideOnZoom: false,
  });
  keepDomWidgetWidthAuto(domWidget);
  // The same minimum through every sizing path the frontends consult -
  // legacy computeSize, modern computeLayoutSize, and the resize clamp -
  // so the panel and the node can never disagree about how narrow is legal.
  // Without the layout minimum, the node could be dragged below the panel's
  // floor while the panel held its width, and the row's fixed-width strength
  // and info controls hung past the node's right edge.
  domWidget.computeSize = (width) => [
    Math.max(PANEL_MIN_WIDTH, Number(width || node.size?.[0] || PANEL_MIN_WIDTH)),
    panelHeight(state),
  ];
  domWidget.computeLayoutSize = () => ({
    minWidth: PANEL_MIN_WIDTH,
    minHeight: panelHeight(state),
  });
  domWidget.options.minNodeSize = [PANEL_MIN_WIDTH, 160];

  renderRows(state);
  node.setSize?.([Math.max(336, node.size?.[0] || 336), node.computeSize?.()[1] || 220]);

  // Workflow restore lands widget values after creation: re-read then.
  chainCallback(node, "onConfigure", function () {
    state.rows = parseRows(widget.value);
    renderRows(state);
    requestAnimationFrame(() => fitNode(state));
  });
  chainCallback(node, "onRemoved", () => closePopup());
}

app.registerExtension({
  name: "AusBoss.LoraLoader",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      installLoraNode(this);
    });
  },
});
