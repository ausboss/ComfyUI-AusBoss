import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { BRAND, chainCallback, keepDomWidgetWidthAuto, notifyAusbossChange } from "../shared/index.mjs";
import { WIDGET_FRAME, fillNodeHeight } from "../shared/panel_layout.mjs";
import { hideWidget as collapseWidget } from "../shared/widget_visibility.mjs";
import {
  closeSettingsMenu,
  gearIconSvg,
  loadSettings,
  openSettingsMenu,
} from "../shared/settings_menu.mjs";
import {
  BYPASS_MODE,
  DEFAULT_STEP,
  FINE_STEP,
  MAX_ROWS,
  MUTE_MODE,
  clampHighlight,
  commonFolderPrefix,
  filterLoras,
  formatFileSize,
  groupByFolder,
  highlightedName,
  hoverRowIndex,
  applyTemplate,
  cycleMasterToggle,
  duplicateLoraKeys,
  importNeedsSeparateStrengths,
  importSummary,
  isScrubbing,
  loaderLoraEntries,
  mergeImportedRows,
  moveHighlight,
  moveRow,
  newRow,
  parseRows,
  parseTemplates,
  removeTemplate,
  reorderRows,
  roundStrength,
  resolveLoraName,
  scrubValue,
  serializeRows,
  setStrength,
  shortLoraName,
  snapshotEnabled,
  strengthBarBackground,
  strengthBarScale,
  thumbPosition,
  strengthOutOfRange,
  summarizeRows,
  templateFromRows,
  toggleAllState,
  toggleTrigger,
  upsertTemplate,
} from "../shared/lora_stack.mjs";

const NODE_CLASS = "AUSBOSS_NODES_LoraLoader";
const ROW_HEIGHT = 30;
const ROW_GAP = 6;
const ACTIONS_HEIGHT = 26;
const GROUP_HEIGHT = 36;
const STACK_PADDING = 8;
const BLANK_HEIGHT = 44;
const PANEL_PADDING = 10;
// How many of the slot band's pixels the panel climbs back up into. Three output slots reserve 66px of node height before the first
// widget, and the band's whole middle is empty - so the control bar rides
// there (like Pixaroma's controls do) and the row stack starts at the
// band's bottom edge. 52 puts the 36px bar at y 24..60, clear of the title
// and flush with the band.
const BAND_RECLAIM = 52;

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
    // persist:false - this mirrors THE OPEN NODE's linked state, so it must
    // never become the stored default: new nodes always start unified. (An
    // absorb can flip a node whose imported rows patch model and CLIP
    // differently; that flip stays on that node.)
    key: "separate_strengths", label: "Separate model / CLIP strength",
    type: "toggle", default: false, persist: false,
    hint: "Two strength boxes per row on this node. New nodes always start "
      + "unified.",
  },
  {
    key: "strength_bars", label: "Strength bars", type: "toggle",
    default: true,
    hint: "Center-zero bar behind each name: teal grows right for positive "
      + "strength, red grows left for negative, scaled so the stack's "
      + "largest magnitude spans the field (never less than 1.0).",
  },
  {
    key: "separator", label: "Trigger word separator", type: "text",
    default: ", ", placeholder: '", "',
    hint: "Joins the triggers output. This node now, new nodes later.",
  },
  {
    key: "hide_extension", label: "Hide file extension", type: "toggle",
    default: true,
    hint: "Show LoRA names without .safetensors.",
  },
  {
    key: "hide_folders", label: "Hide folder names", type: "toggle",
    default: true,
    hint: "Rows show just the file name; the full path stays in the "
      + "tooltip and the picker keeps its folders.",
  },
  {
    key: "name_scrub", label: "Scrub strength on the name", type: "toggle",
    default: true,
    hint: "Drag left/right on a row's name to change its model strength - "
      + "the bar rides along. A plain click still opens the picker.",
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
  .ausboss-lora-panel { width: 100%; height: 100%;
    font: 12px system-ui; color: #d7dde2; pointer-events: none; }
  /* The body is the panel's layout box: it fences every child and carries
     the overflow clip. height: 100% tracks whatever box the frontend
     allocates, so a short allocation shrinks the stack instead of
     chopping its bottom border. */
  /* pointer-events: the panel overlays the slot band's middle (see
     BAND_RECLAIM), so everything down to the body passes clicks through to
     the canvas - slot dots stay wirable, empty band areas still drag the
     node - and the three real surfaces opt back in below. The wrapper rule
     needs !important because the frontend writes pointer-events: auto
     inline on its own wrapper each frame; pointer-events does not inherit,
     so the interactive children stay clickable regardless. */
  .dom-widget:has(> .ausboss-lora-panel) { pointer-events: none !important; }
  .ausboss-lora-body { display: flex; flex-direction: column; gap: ${ROW_GAP}px;
    box-sizing: border-box; width: 100%; height: 100%; padding: ${PANEL_PADDING}px;
    overflow: hidden; pointer-events: none; }
  .ausboss-lora-bargroup, .ausboss-lora-stack,
  .ausboss-lora-actions { pointer-events: auto; }
  .ausboss-lora-row { flex: none; display: flex; align-items: center; gap: 6px; height: ${ROW_HEIGHT}px; }
  .ausboss-lora-row.off { opacity: 0.45; }
  .ausboss-lora-row.dragging { opacity: 0.55; }
  .ausboss-lora-grip { width: 14px; height: 24px; border: none; background: transparent;
    color: #5c646c; cursor: grab; flex: none; padding: 0; display: grid; place-items: center;
    touch-action: none; }
  .ausboss-lora-grip:hover { color: #9ba2aa; }
  .ausboss-lora-row.dragging .ausboss-lora-grip { cursor: grabbing; }
  .ausboss-lora-toggle { width: 30px; height: 16px; border-radius: 8px; border: none;
    background: #3a4047; cursor: pointer; position: relative; flex: none; padding: 0; }
  .ausboss-lora-toggle::after { content: ""; position: absolute; top: 2px; left: 2px;
    width: 12px; height: 12px; border-radius: 50%; background: #9ba2aa; transition: left .12s; }
  .ausboss-lora-toggle.on { background: ${BRAND}; }
  .ausboss-lora-toggle.on::after { left: 16px; background: #fff; }
  .ausboss-lora-toggle.mixed { background: #4d6763; }
  .ausboss-lora-toggle.mixed::after { left: 9px; background: #cfd6da; }
  /* Inside the stack container, pinned to its bottom edge: the auto margin
     soaks up whatever free height the stack was handed. */
  .ausboss-lora-actions { flex: none; display: flex; height: ${ACTIONS_HEIGHT}px;
    margin-top: auto; }
  /* The control bar is the panel's first row, sitting directly on top of
     the stack; the bordered group inside it holds the controls as one
     centered cluster. */
  .ausboss-lora-bar { flex: none; display: flex; justify-content: center; }
  /* The group stretches toward the panel width but stops short of the slot
     labels it rides between (see BAND_RECLAIM); the summary flexes in the
     middle so the controls spread instead of huddling. */
  .ausboss-lora-bargroup { display: flex; align-items: center;
    gap: 8px; min-width: 0; flex: 1 1 auto;
    max-width: min(440px, calc(100% - 116px)); height: ${GROUP_HEIGHT}px; padding: 0 10px;
    border: 1px solid #3a4047; border-radius: 7px; background: rgba(255,255,255,.05);
    color: #9ba2aa; }
  .ausboss-lora-gear { width: 24px; height: 24px; border: 1px solid #3a4047;
    border-radius: 5px; background: #23272c; color: #9ba2aa; cursor: pointer;
    display: grid; place-items: center; flex: none; padding: 0; }
  .ausboss-lora-gear:hover { border-color: ${BRAND}; color: ${BRAND}; }
  .ausboss-lora-stack { flex: 1 1 auto; min-height: 0; overflow: hidden;
    display: flex; flex-direction: column; gap: ${ROW_GAP}px;
    padding: ${STACK_PADDING}px; border: 1px solid rgba(0,180,170,.22); border-radius: 6px;
    background: rgba(0,0,0,.38); }
  .ausboss-lora-blank { flex: 1 1 auto; display: flex; align-items: center; justify-content: center;
    width: 100%; min-height: ${BLANK_HEIGHT}px; border: 1px dashed #3a4047;
    border-radius: 5px; background: transparent; color: #9ba2aa; font: italic 12px system-ui;
    text-align: center; padding: 0 10px; cursor: pointer; }
  .ausboss-lora-blank:hover { border-color: ${BRAND}; color: ${BRAND}; }
  .ausboss-lora-strength.out-of-range { color: #ffb26b; }
  .ausboss-lora-strengthbox.out-of-range { border-color: #7a5230; }
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
    cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    touch-action: none; }
  .ausboss-lora-name:hover { border-color: ${BRAND}; }
  .ausboss-lora-name.missing { color: #ff8a80; }
  .ausboss-lora-name.moved { border-style: dashed; border-color: #3c6663; }
  .ausboss-lora-name.dup { border-color: #f0a11e;
    box-shadow: inset 0 0 0 1px rgba(240,161,30,.4); }
  .ausboss-lora-name.empty { color: #9ba2aa; font-style: italic; }
  .ausboss-lora-strengthbox { display: flex; width: 66px; height: 24px; border: 1px solid #3a4047;
    border-radius: 5px; background: #23272c; overflow: hidden; flex: none; }
  .ausboss-lora-strengthbox:focus-within { border-color: ${BRAND}; }
  .ausboss-lora-strength { flex: 1 1 auto; min-width: 0; height: 100%; border: none; padding: 0;
    background: transparent; color: inherit; text-align: center; cursor: ew-resize;
    user-select: none; }
  .ausboss-lora-strength:focus { cursor: text; outline: none; user-select: text; }
  .ausboss-lora-step { flex: none; width: 14px; display: flex; flex-direction: column;
    border-left: 1px solid #3a4047; }
  .ausboss-lora-step button { flex: 1 1 0; border: none; background: transparent; color: #9ba2aa;
    cursor: pointer; padding: 0; display: grid; place-items: center; }
  .ausboss-lora-step button:hover { color: ${BRAND}; background: rgba(255,255,255,.05); }
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
  .ausboss-lora-summary { color: #9ba2aa; flex: 1 1 auto; min-width: 0; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; text-align: center; }
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


// Six-dot drag grip, hand-drawn like the shared gear so no glyph font is
// trusted to have it.
function gripIconSvg() {
  const dots = [2, 7, 12].flatMap((y) => [2, 6].map((x) => `<circle cx="${x}" cy="${y}" r="1.3"/>`));
  return `<svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" aria-hidden="true">${dots.join("")}</svg>`;
}

// Stepper chevrons, hand-drawn for the same reason.
function chevronIconSvg(up) {
  const points = up ? "1.5,4 4.5,1 7.5,4" : "1.5,1 4.5,4 7.5,1";
  return `<svg width="9" height="5" viewBox="0 0 9 5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="${points}"/></svg>`;
}

// The shared collapse handles the sizing hooks; a text widget can also carry
// a DOM element on some frontends, so blank that too.
function hideWidget(widget) {
  if (!widget) return;
  collapseWidget(widget);
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
  hideHoverThumb();
  if (!activePopup) return;
  activePopup.abort.abort();
  activePopup.element.remove();
  activePopup = null;
}

// ---------- hover thumbnail ----------

// One floating preview image for the whole pack tab, shared by row hover and
// the picker. Fixed-positioned and pointer-events: none, so it can never
// shift layout or steal the cursor; it stays hidden until the image actually
// loads, so a LoRA without a sidecar preview shows nothing at all.
let hoverThumb = null;

function ensureHoverThumb() {
  if (hoverThumb) return hoverThumb;
  hoverThumb = el("img", "ausboss-lora-hoverthumb");
  hoverThumb.alt = "";
  hoverThumb.style.display = "none";
  hoverThumb.addEventListener("load", () => {
    if (hoverThumb.dataset.show === "1") hoverThumb.style.display = "";
  });
  hoverThumb.addEventListener("error", () => { hoverThumb.style.display = "none"; });
  document.body.append(hoverThumb);
  return hoverThumb;
}

function moveHoverThumb(x, y) {
  if (!hoverThumb || hoverThumb.dataset.show !== "1") return;
  const spot = thumbPosition(x, y, window.innerWidth, window.innerHeight);
  hoverThumb.style.left = `${spot.left}px`;
  hoverThumb.style.top = `${spot.top}px`;
}

function showHoverThumb(state, name, x, y) {
  if (!name || state.settings?.thumbnails === false) return;
  const thumb = ensureHoverThumb();
  thumb.dataset.show = "1";
  if (thumb.dataset.name !== name) {
    thumb.dataset.name = name;
    thumb.style.display = "none";
    thumb.src = api.apiURL(
      `/ausboss/lora/thumb?name=${encodeURIComponent(effectiveLoraName(state, name))}`);
  } else if (thumb.complete && thumb.naturalWidth > 0) {
    thumb.style.display = "";
  }
  moveHoverThumb(x, y);
}

function hideHoverThumb() {
  if (!hoverThumb) return;
  hoverThumb.dataset.show = "0";
  hoverThumb.style.display = "none";
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

// Picker options honor only hide-extension: their folder context is the
// disambiguator (group headers, search prefixes), so it stays.
function displayName(state, name) {
  return shortLoraName(name, {
    hideFolders: false,
    hideExtension: state.settings?.hide_extension !== false,
  });
}

// A row's label (and the info card title) also hides the folder by
// default; the full path lives in the tooltip.
function rowLabel(state, name) {
  return shortLoraName(name, {
    hideFolders: state.settings?.hide_folders !== false,
    hideExtension: state.settings?.hide_extension !== false,
  });
}

// Each named row's fit against the install's lora list,
// cached per name; refreshAvailable clears the cache when the list changes.
function nameStatus(state, name) {
  if (!name || !Array.isArray(state.available)) return null;
  if (!state.nameStatus) state.nameStatus = new Map();
  if (!state.nameStatus.has(name)) {
    state.nameStatus.set(name, resolveLoraName(name, state.available));
  }
  return state.nameStatus.get(name);
}

// The name the SERVER should be asked about: a remapped row's saved path
// would 404 on the thumb/info routes (they may be served by the public
// pack's copy, which resolves strictly), so ask with the resolved one.
function effectiveLoraName(state, name) {
  const status = nameStatus(state, name);
  return status?.status === "remapped" ? status.name : name;
}

function refreshAvailable(state) {
  fetchLoraList()
    .then((names) => {
      state.available = names;
      state.nameStatus = new Map();
      decorateRows(state);
      // Rows whose range lookup 404ed under the stale path get a second
      // chance under the resolved one.
      for (const row of state.rows) {
        if (!row.name) continue;
        if (nameStatus(state, row.name)?.status === "remapped"
            && rangeCache.get(row.name) === null) {
          rangeCache.delete(row.name);
          ensureRange(state, row.name);
        }
      }
    })
    .catch(() => {});
}

// CSS pixels the panel needs to show every row with no scrolling. The add
// button lives inside the stack now, so its height (plus the gap above it)
// counts inside the stack box.
function panelHeight(state) {
  const inner = state.rows.length
    ? state.rows.length * (ROW_HEIGHT + ROW_GAP) - ROW_GAP
    : BLANK_HEIGHT;
  const stack = inner + ROW_GAP + ACTIONS_HEIGHT + STACK_PADDING * 2 + 2; // +2 border
  return PANEL_PADDING * 2 + GROUP_HEIGHT + ROW_GAP + stack;
}

function fitNode(state) {
  const width = Math.max(320, state.node.size?.[0] || 320);
  const height = state.node.computeSize
    ? state.node.computeSize()[1]
    : panelHeight(state) + WIDGET_FRAME + 80;
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
  api.fetchApi(`/ausboss/lora/info?name=${encodeURIComponent(effectiveLoraName(state, name))}`)
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
  const outside = strengthOutOfRange(row[key], range ?? null);
  input.classList.toggle("out-of-range", outside);
  // The border moved to the wrapper when the stepper arrived; tint it too.
  input.closest(".ausboss-lora-strengthbox")?.classList.toggle("out-of-range", outside);
  input.title = range && (range.min !== null || range.max !== null)
    ? `Suggested range ${range.min ?? "any"} to ${range.max ?? "any"}. ` + input.dataset.baseTitle
    : input.dataset.baseTitle;
}

// ---------- strength boxes ----------

function strengthBox(state, index, key) {
  const box = el("div", "ausboss-lora-strengthbox");
  const input = el("input", "ausboss-lora-strength");
  input.value = state.rows[index][key].toFixed(2);
  input.dataset.baseTitle = key === "strength"
    ? "Model strength. Drag left/right to scrub, click to type, arrows to step. Shift = fine."
    : "CLIP strength. Drag left/right to scrub, click to type, arrows to step. Shift = fine.";
  input.readOnly = true;
  input.__ausbossRead = () => state.rows[index]?.[key].toFixed(2) ?? "1.00";
  input.__ausbossTint = () => state.rows[index] && applyRangeTint(input, state.rows[index], key);
  ensureRange(state, state.rows[index].name);

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

  // Click-to-step arrows: the third way to set a strength, next to scrubbing
  // and typing. Steps by the configured step (gear menu); Shift steps fine.
  const steps = el("div", "ausboss-lora-step");
  const stepButton = (direction) => {
    const button = el("button");
    button.type = "button";
    button.tabIndex = -1;
    button.title = `Strength ${direction > 0 ? "up" : "down"} one step. Shift = fine.`;
    button.innerHTML = chevronIconSvg(direction > 0);
    button.addEventListener("click", (event) => {
      const coarse = state.settings?.step ?? DEFAULT_STEP;
      commitValue(state.rows[index][key] + (event.shiftKey ? FINE_STEP : coarse) * direction);
      input.value = state.rows[index][key].toFixed(2);
    });
    return button;
  };
  steps.append(stepButton(1), stepButton(-1));
  box.append(input, steps);
  applyRangeTint(input, state.rows[index], key);
  return box;
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
    option.addEventListener("pointerenter", (event) => {
      if (highlight !== flatIndex) {
        // Class swap, never renderList(): a hover-time rebuild repositioned
        // the popup and blinked the thumbnail on every row crossed, and a
        // rebuild landing between mousedown and click detaches the option
        // mid-gesture, killing that click.
        list.querySelector(".ausboss-lora-option.highlight")?.classList.remove("highlight");
        highlight = flatIndex;
        option.classList.add("highlight");
      }
      showHoverThumb(state, name, event.clientX, event.clientY);
    });
    option.addEventListener("pointermove", (event) => {
      showHoverThumb(state, name, event.clientX, event.clientY);
    });
    option.addEventListener("pointerleave", hideHoverThumb);
    option.addEventListener("click", () => pick(name));
    option.dataset.ausbossFlat = String(flatIndex);
    list.append(option);
  };

  const renderList = () => {
    filtered = filterLoras(names, search.value);
    highlight = clampHighlight(highlight, filtered.length);
    list.textContent = "";
    hideHoverThumb();
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
      // The picker's fresh list is also the row decorator's fresh list.
      state.available = fetched;
      state.nameStatus = new Map();
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
  // Every server call in the card goes through the resolved name, so the
  // card works for a moved file too.
  const serverName = effectiveLoraName(state, row.name);
  const card = el("div", "ausboss-lora-card");
  card.append(el("div", "ausboss-lora-empty", "Loading..."));
  openPopup(card, anchor.getBoundingClientRect());

  const render = (info) => {
    card.textContent = "";
    const image = el("img");
    image.alt = "";
    image.src = api.apiURL(`/ausboss/lora/thumb?name=${encodeURIComponent(serverName)}`);
    image.addEventListener("error", () => image.remove());
    if (info.has_preview) card.append(image);
    card.append(el("h4", "", info.civitai_title || rowLabel(state, row.name)));
    if (info.base_model) card.append(el("div", "ausboss-lora-meta", `Base model: ${info.base_model}`));
    const size = formatFileSize(info.size_bytes);
    if (size) {
      const when = Number.isFinite(info.mtime)
        ? ` · modified ${new Date(info.mtime * 1000).toLocaleDateString()}`
        : "";
      card.append(el("div", "ausboss-lora-meta", `${size}${when}`));
    }
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
            body: JSON.stringify({ name: serverName }),
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
          name: serverName,
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
          body: JSON.stringify({ name: serverName, words }),
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
    api.fetchApi(`/ausboss/lora/info?name=${encodeURIComponent(serverName)}`)
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

// Per-row decoration. The strength bar behind each name (inline styles,
// not CSS classes - every bar's geometry is data-driven; the pure math
// lives in js/shared/lora_stack.mjs), the amber duplicate ring,
// and the moved/missing tint against the install's list. Runs on every
// value update - the bar scale can change whenever any row's strength does.
function decorateRows(state) {
  const showBars = state.settings?.strength_bars !== false;
  const scale = strengthBarScale(state.rows);
  const dups = duplicateLoraKeys(state.rows);
  state.panel.querySelectorAll(".ausboss-lora-name").forEach((button, index) => {
    const row = state.rows[index];
    if (!row?.name) {
      button.style.background = "";
      button.classList.remove("dup", "moved", "missing");
      return;
    }
    const notes = [row.name];
    if (showBars) {
      button.style.background = strengthBarBackground(row.strength, scale);
      notes.push(`Model strength ${row.strength.toFixed(2)}; `
        + `bar edges are ±${scale.toFixed(2)}`);
    } else {
      button.style.background = "";
    }
    const dup = dups.has(row.name.toLowerCase());
    button.classList.toggle("dup", dup);
    if (dup) notes.push("Duplicate: another row loads this same LoRA.");
    const status = nameStatus(state, row.name);
    button.classList.toggle("moved", status?.status === "remapped");
    button.classList.toggle(
      "missing",
      status?.status === "missing" || status?.status === "ambiguous",
    );
    if (status?.status === "remapped") {
      notes.push(`Not at its saved path; the run will use "${status.name}".`);
    } else if (status?.status === "missing") {
      notes.push("No matching file in models/loras - this row is skipped at run time.");
    } else if (status?.status === "ambiguous") {
      notes.push("Several files match this name - pick one to settle it.");
    }
    button.title = notes.join("\n");
  });
}

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
  decorateRows(state);
}

// ---------- absorb the loader chain ----------

// The graph walk stays here (it needs live LiteGraph objects); which node
// types contribute rows and how is pure logic in lora_stack.mjs.
const IMPORT_SOURCE_TYPES = new Set([
  "LoraLoader",
  "LoraLoaderModelOnly",
  "Power Lora Loader (rgthree)",
  "PixaromaLoraLoader",
  "AUSBOSS_NODES_LoraLoader",
  // The lab fork serializes the same stack; absorbing one keeps working
  // for anyone with both packs installed.
  "AUSBOSS_LAB_LoraLoader",
]);

function upstreamModelNode(node) {
  const graph = node.graph;
  if (!graph) return null;
  const input = node.inputs?.find((entry) => entry?.name === "model") ?? node.inputs?.[0];
  const linkId = input?.link;
  if (linkId === null || linkId === undefined) return null;
  const link = graph.links?.[linkId] ?? graph._links?.get?.(linkId);
  if (!link) return null;
  return graph.getNodeById?.(link.origin_id) ?? null;
}

// Loader nodes feeding the model input, nearest-first. Reroutes are walked
// through; already-bypassed loaders stay in the chain (bypass passes the
// model through, so the walk continues past them) but contribute no rows.
function collectUpstreamLoaders(node) {
  const chain = [];
  const seen = new Set([node.id]);
  let current = upstreamModelNode(node);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const type = String(current.type ?? current.comfyClass ?? "");
    if (type === "Reroute") {
      current = upstreamModelNode(current);
      continue;
    }
    if (!IMPORT_SOURCE_TYPES.has(type)) break;
    chain.push(current);
    current = upstreamModelNode(current);
  }
  return chain;
}

// The single node this node's model output feeds - and only when it feeds
// exactly one. A fan-out ends the walk: bypassing a loader on one branch
// would silently change what every other branch computes.
function downstreamModelNode(node) {
  const graph = node.graph;
  if (!graph) return null;
  const output = node.outputs?.find((entry) => entry?.name === "model")
    ?? node.outputs?.[0];
  const links = output?.links;
  if (!Array.isArray(links) || links.length !== 1) return null;
  const link = graph.links?.[links[0]] ?? graph._links?.get?.(links[0]);
  if (!link) return null;
  return graph.getNodeById?.(link.target_id) ?? null;
}

// Loader nodes the model output feeds, nearest-first (= their apply order).
// Same rules as upstream: Reroutes pass through, an unrecognized type or a
// fan-out ends the walk.
function collectDownstreamLoaders(node) {
  const chain = [];
  const seen = new Set([node.id]);
  let current = downstreamModelNode(node);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const type = String(current.type ?? current.comfyClass ?? "");
    if (type === "Reroute") {
      current = downstreamModelNode(current);
      continue;
    }
    if (!IMPORT_SOURCE_TYPES.has(type)) break;
    chain.push(current);
    current = downstreamModelNode(current);
  }
  return chain;
}

// Circular reconnect arrow, hand-drawn like the shared gear so no glyph
// font is trusted to have it.
function reloadIconSvg() {
  return (
    '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M13.4 8a5.4 5.4 0 1 1-1.8-4"/><polyline points="13.6 1.4 13.6 4.6 10.4 4.6"/></svg>'
  );
}

// Re-check every row against a FRESH lora list and repair
// what it can. A row whose file moved (or was restored after being missing)
// reconnects by rewriting the row to the resolved path - exactly what
// deleting and re-adding the row did by hand. Wired to the bar's reconnect
// button and to ComfyUI's own R refresh; quiet mode only toasts when it
// actually repaired something.
async function runReconnect(state, { quiet = false } = {}) {
  let list;
  try {
    list = await fetchLoraList();
  } catch {
    if (!quiet) loraToast("Could not refresh the LoRA list.");
    return;
  }
  state.available = list;
  state.nameStatus = new Map();
  let repaired = 0;
  const rows = state.rows.map((row) => {
    if (!row.name) return row;
    const fit = resolveLoraName(row.name, list);
    if (fit.status !== "remapped") return row;
    repaired += 1;
    rangeCache.delete(row.name);
    return { ...row, name: fit.name };
  });
  const unresolved = rows.filter(
    (row) => row.name && resolveLoraName(row.name, list).status !== "exact",
  ).length;
  if (repaired) {
    commitRows(state, rows, { structural: true });
    notifyAusbossChange();
  } else {
    decorateRows(state);
  }
  if (!quiet || repaired) {
    const lead = repaired
      ? `Reconnected ${repaired} LoRA path${repaired === 1 ? "" : "s"}`
      : "LoRA list refreshed";
    if (unresolved) {
      loraToast(`${lead}; ${unresolved} row${unresolved === 1 ? "" : "s"} still missing.`);
    } else {
      loraToast(repaired ? `${lead}.` : `${lead}; every row points at a real file.`);
    }
  }
}

function loraToast(detail) {
  const toaster = app.extensionManager?.toast;
  if (toaster?.add) {
    toaster.add({ severity: "info", summary: "LoRA Loader \u{1F18E}", detail, life: 7000 });
  } else {
    console.log(`[AusBoss] ${detail}`);
  }
}

async function runImportChain(state) {
  // A bypassed or muted loader is not shaping the current render; importing
  // its rows would change the image. Leave it alone.
  const isActive = (loader) =>
    loader.mode !== BYPASS_MODE && loader.mode !== MUTE_MODE;
  const activeUp = collectUpstreamLoaders(state.node).filter(isActive);
  const activeDown = collectDownstreamLoaders(state.node).filter(isActive);
  const entriesOf = (loader) => loaderLoraEntries({
    type: String(loader.type ?? loader.comfyClass ?? ""),
    widgets: (loader.widgets ?? []).map((widget) => ({
      name: widget.name,
      value: widget.value,
    })),
  }) ?? [];
  // Upstream walks nearest-first, so reversed = the order the chain applies
  // them; downstream nearest-first already IS its apply order.
  const upEntries = activeUp.slice().reverse().flatMap(entriesOf);
  const downEntries = activeDown.flatMap(entriesOf);
  if (!upEntries.length && !downEntries.length) {
    loraToast(importSummary({}));
    return;
  }
  let available = [];
  try {
    available = await fetchLoraList();
    state.available = available;
    state.nameStatus = new Map();
  } catch {
    // Offline: names import verbatim; the rows tint and the run-time
    // resolver gets the next chance.
  }
  let remapped = 0;
  let missing = 0;
  let ambiguous = 0;
  const resolve = (item) => {
    if (!available.length) return { ...item };
    const fit = resolveLoraName(item.name, available);
    if (fit.status === "remapped") remapped += 1;
    else if (fit.status === "missing") missing += 1;
    else if (fit.status === "ambiguous") ambiguous += 1;
    return { ...item, name: fit.name };
  };
  const upResolved = upEntries.map(resolve);
  const downResolved = downEntries.map(resolve);
  // Upstream rows apply before this stack, downstream rows after; the
  // dedupe accumulates across both merges so nothing lands twice.
  const beforeMerge = mergeImportedRows(state.rows, upResolved);
  const afterMerge = mergeImportedRows(beforeMerge.rows, downResolved,
    { position: "after" });
  // Rows that patch model and CLIP differently need both boxes visible, or
  // the difference is invisible and lost on the first scrub. The flip is
  // node-local (unified stays the default for new nodes) and the toast
  // names it so it never reads as a settings change.
  let separated = false;
  if (importNeedsSeparateStrengths([...upResolved, ...downResolved])
      && linked(state)) {
    state.node.properties.ausbossLoraLinked = false;
    separated = true;
  }
  const absorbed = [...activeUp, ...activeDown];
  for (const loader of absorbed) loader.mode = BYPASS_MODE;
  commitRows(state, afterMerge.rows, { structural: true });
  fitNode(state);
  notifyAusbossChange();
  loraToast(importSummary({
    added: beforeMerge.added + afterMerge.added,
    skipped: beforeMerge.skipped + afterMerge.skipped,
    bypassed: absorbed.length,
    remapped,
    missing,
    ambiguous,
  }) + (separated
    ? " An imported row patches model and CLIP differently, so this node "
      + "now shows both strength boxes."
    : ""));
}

function openSettings(state, anchor) {
  // The import action rides the gear menu but is per-node and one-shot, so
  // the schema is composed per call; persistence still uses SETTINGS_SCHEMA.
  const menuSchema = [
    ...SETTINGS_SCHEMA,
    {
      key: "_import_chain",
      label: "Absorb chain LoRAs",
      type: "action",
      button: "Absorb",
      hint: "Pull every LoRA loader wired into this node's model chain - "
        + "upstream and downstream - into this stack and bypass those "
        + "nodes; the graph keeps computing the same thing.",
      onAction: () => {
        closeSettingsMenu();
        runImportChain(state);
      },
    },
  ];
  openSettingsMenu({
    scope: SETTINGS_SCOPE,
    schema: menuSchema,
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
  const body = el("div", "ausboss-lora-body");
  panel.append(body);

  const addRowAndPick = () => {
    if (state.rows.length >= MAX_ROWS) return;
    const strength = roundStrength(state.settings?.default_strength ?? 1);
    const row = { ...newRow(), strength, strength_clip: strength };
    commitRows(state, [...state.rows, row], { structural: true });
    fitNode(state);
    const pickers = state.panel.querySelectorAll(".ausboss-lora-name");
    pickers[pickers.length - 1]?.click();
  };

  const bar = el("div", "ausboss-lora-bar");
  const overall = toggleAllState(state.rows);
  const master = el(
    "button",
    `ausboss-lora-toggle ausboss-lora-master${overall === "on" ? " on" : overall === "mixed" ? " mixed" : ""}`
  );
  master.type = "button";
  master.title = "Toggle every LoRA: mixed saves your setup and turns all on; "
    + "on turns all off; off brings your saved setup back";
  // The master pill remembers the mixed setup it destroys,
  // so an accidental click is always one more click from home.
  master.addEventListener("click", () => {
    const cycled = cycleMasterToggle(state.rows, state.toggleSnapshot);
    state.toggleSnapshot = cycled.snapshot;
    commitRows(state, cycled.rows, { structural: true });
  });
  const templates = el("button", "ausboss-lora-gear", "▤");
  templates.type = "button";
  templates.title = "LoRA templates: save this stack, or apply a saved one";
  templates.addEventListener("click", () => openTemplates(state, templates));
  const recheck = el("button", "ausboss-lora-gear");
  recheck.type = "button";
  recheck.title = "Re-check LoRA files: refresh the list and reconnect rows "
    + "whose files moved or came back";
  recheck.innerHTML = reloadIconSvg();
  recheck.addEventListener("click", () => runReconnect(state));
  const gear = el("button", "ausboss-lora-gear");
  gear.type = "button";
  gear.title = "LoRA Loader settings";
  gear.innerHTML = gearIconSvg();
  gear.addEventListener("click", () => openSettings(state, gear));
  const group = el("div", "ausboss-lora-bargroup");
  group.append(templates, master, el("span", "ausboss-lora-summary", summarizeRows(state.rows)), recheck, gear);
  bar.append(group);
  body.append(bar);

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

    const grip = el("button", "ausboss-lora-grip");
    grip.type = "button";
    grip.title = "Drag to reorder";
    grip.innerHTML = gripIconSvg();
    grip.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || state.rows.length < 2) return;
      event.preventDefault();
      hideHoverThumb();
      rowElement.classList.add("dragging");
      let current = index;
      const abort = new AbortController();
      const rowElements = () => Array.from(stack.querySelectorAll(".ausboss-lora-row"));
      const onMove = (moveEvent) => {
        const elements = rowElements();
        const centers = elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return rect.top + rect.height / 2;
        });
        const target = hoverRowIndex(centers, moveEvent.clientY);
        if (target === current || target < 0) return;
        // Live preview shuffles only the DOM; the serialized stack changes
        // once, on drop, so an abandoned drag never dirties the widget.
        if (target > current) elements[target].after(rowElement);
        else elements[target].before(rowElement);
        current = target;
      };
      const finish = (commit) => {
        abort.abort();
        rowElement.classList.remove("dragging");
        if (current === index) return;
        if (commit) commitRows(state, reorderRows(state.rows, index, current), { structural: true });
        else renderRows(state);
      };
      // The gesture listens on the window, capture phase - never through
      // setPointerCapture on the grip. The preview above reparents the row,
      // and a reparent removes the grip from the document for an instant,
      // which silently releases its pointer capture: the pointerup then
      // never reached the grip, the drop never committed, and the row rode
      // the cursor until the next render snapped it back.
      window.addEventListener("pointermove", onMove, { capture: true, signal: abort.signal });
      window.addEventListener("pointerup", () => finish(true), { capture: true, signal: abort.signal });
      window.addEventListener("pointercancel", () => finish(false), { capture: true, signal: abort.signal });
    });

    const toggle = el("button", `ausboss-lora-toggle${row.enabled ? " on" : ""}`);
    toggle.type = "button";
    toggle.title = "Enable or disable this LoRA";
    toggle.addEventListener("click", () => {
      const rows = state.rows.map((entry, i) =>
        i === index ? { ...entry, enabled: !entry.enabled } : entry
      );
      // Every hand-made toggle refreshes the master pill's memory.
      state.toggleSnapshot = snapshotEnabled(rows);
      commitRows(state, rows, { structural: true });
    });

    const name = el("button", "ausboss-lora-name", row.name ? rowLabel(state, row.name) : "choose a LoRA...");
    name.type = "button";
    name.title = row.name || "Pick a LoRA from models/loras";
    if (!row.name) name.classList.add("empty");
    // The name is also a scrub surface - the bar behind it
    // makes it the natural drag target for model strength. The shared dead
    // zone keeps a plain click a click, which still opens the picker; a
    // scrub that ends on the button swallows the click it fires.
    let nameDrag = null;
    name.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !row.name
          || state.settings?.name_scrub === false) return;
      nameDrag = { x: event.clientX, y: event.clientY,
                   start: state.rows[index].strength, scrubbed: false };
      name.setPointerCapture(event.pointerId);
    });
    name.addEventListener("pointermove", (event) => {
      if (!nameDrag) {
        showHoverThumb(state, row.name, event.clientX, event.clientY);
        return;
      }
      const dx = event.clientX - nameDrag.x;
      const dy = event.clientY - nameDrag.y;
      if (!nameDrag.scrubbed && isScrubbing(dx, dy)) {
        nameDrag.scrubbed = true;
        hideHoverThumb();
      }
      if (nameDrag.scrubbed) {
        commitRows(state, setStrength(
          state.rows,
          index,
          scrubValue(nameDrag.start, dx, event.shiftKey, state.settings?.step),
          linked(state),
        ));
      }
    });
    const endNameDrag = (event) => {
      if (!nameDrag) return;
      try { name.releasePointerCapture(event.pointerId); } catch {}
      if (nameDrag.scrubbed) name.dataset.ausbossScrubbed = "1";
      nameDrag = null;
    };
    name.addEventListener("pointerup", endNameDrag);
    name.addEventListener("pointercancel", endNameDrag);
    name.addEventListener("click", () => {
      if (name.dataset.ausbossScrubbed) {
        delete name.dataset.ausbossScrubbed;
        return;
      }
      openPicker(state, index, name);
    });
    name.addEventListener("pointerenter", (event) =>
      showHoverThumb(state, row.name, event.clientX, event.clientY));
    name.addEventListener("pointerleave", hideHoverThumb);

    rowElement.append(grip, toggle, name, strengthBox(state, index, "strength"));
    if (!linked(state)) rowElement.append(strengthBox(state, index, "strength_clip"));

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
  // The add button lives INSIDE the stack container and pins to its bottom
  // edge (margin-top: auto), so it stays put however tall the node is
  // dragged - the stack absorbs the free height above it.
  const actions = el("div", "ausboss-lora-actions");
  const add = el("button", "ausboss-lora-add", "+ LoRA");
  add.type = "button";
  add.disabled = state.rows.length >= MAX_ROWS;
  add.addEventListener("click", addRowAndPick);
  actions.append(add);
  stack.append(actions);
  body.append(stack);
  decorateRows(state);
}

// ---------- node install ----------

function installLoraNode(node) {
  installStyles();
  const widget = node.widgets?.find((item) => item.name === "loras");
  if (!widget) return;
  hideWidget(widget);

  const settings = loadSettings(SETTINGS_SCOPE, SETTINGS_SCHEMA);
  // Unified strengths are the hard default: separate_strengths is per-node
  // (persist:false in the schema), so any stored value is legacy noise from
  // before it stopped persisting - never a reason to split a fresh node.
  settings.separate_strengths = false;
  const panel = el("div", "ausboss-lora-panel");
  const state = { node, widget, panel, rows: parseRows(widget.value), settings };
  state.toggleSnapshot = snapshotEnabled(state.rows);
  node.__ausbossLoraState = state;
  if (node.properties && node.properties.ausbossLoraLinked === undefined) {
    node.properties.ausbossLoraLinked = true;
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
    getMinHeight: () => panelHeight(state) + WIDGET_FRAME - BAND_RECLAIM,
  });
  keepDomWidgetWidthAuto(domWidget);
  // fillNodeHeight, not a pinned computeSize: the panel joins the layout's
  // free-space split, follows the node when it is dragged taller (the add
  // button stays on the bottom edge), and a floor that carries WIDGET_FRAME
  // guarantees the element box never comes up short of the rows. The width
  // minimum rides the same call so the node cannot shrink to where the row's
  // fixed-width controls would hang past its right edge. The floor sheds
  // BAND_RECLAIM because that many pixels come out of the slot band, not
  // out of the space below it.
  fillNodeHeight(domWidget, {
    minWidth: PANEL_MIN_WIDTH,
    minHeight: () => panelHeight(state) + WIDGET_FRAME - BAND_RECLAIM,
    minNodeSize: [PANEL_MIN_WIDTH, 160],
  });
  // Climb the panel up into the slot band. The layout
  // assigns this widget a y below the last output slot and a height from
  // the free-space split; these getters show the element BAND_RECLAIM
  // higher and taller than assigned, in canvas units, so the offset scales
  // with zoom and the panel's bottom edge stays exactly where the layout
  // put it. Writes keep landing in the backing values, so the layout's own
  // accounting never sees the shift.
  {
    let assignedY = Number(domWidget.y) || 0;
    Object.defineProperty(domWidget, "y", {
      configurable: true,
      get: () => Math.max(14, assignedY - BAND_RECLAIM),
      set: (value) => { assignedY = Number(value) || 0; },
    });
  }
  // The wrapper's height still comes from the layout (its computedHeight
  // feeds node sizing, so it cannot be inflated without a feedback loop);
  // the y pin moves the whole box up, leaving it BAND_RECLAIM short at the
  // bottom. The panel stretches past its wrapper by exactly that much -
  // inner CSS pixels are pre-transform canvas units, so this stays correct
  // at every zoom.
  panel.style.height = `calc(100% + ${BAND_RECLAIM}px)`;

  renderRows(state);
  refreshAvailable(state);
  node.setSize?.([Math.max(336, node.size?.[0] || 336), node.computeSize?.()[1] || 220]);

  // Workflow restore lands widget values after creation: re-read then.
  chainCallback(node, "onConfigure", function () {
    state.rows = parseRows(widget.value);
    state.toggleSnapshot = snapshotEnabled(state.rows);
    renderRows(state);
    refreshAvailable(state);
    requestAnimationFrame(() => fitNode(state));
  });
  chainCallback(node, "onRemoved", () => closePopup());
  // ComfyUI's R refresh re-reads node definitions; ride it so files that
  // moved or came back reconnect without touching the node by hand.
  chainCallback(node, "refreshComboInNode", function () {
    runReconnect(state, { quiet: true });
  });
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
