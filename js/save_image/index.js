// Save Image 🆎: one compact card in place of the widget stack.
//
// Folder (with a Browse into ComfyUI's output folder), Filename, a live
// Path preview, the name tags as small chips, the Format pills and the
// Embed workflow switch. The standard widgets stay the source of truth and
// stay serialized in their old order; the card only reads and writes them.
// When the `filename` input is linked the name comes from upstream: the
// field shows {{filename}} and the tags fold away, since an exact name is
// never decorated.
import { api } from "/scripts/api.js";
import { chooseOnServer, choiceOutcome } from "../shared/folder_access.mjs";
import { app } from "/scripts/app.js";
import { BRAND, chainCallback, keepDomWidgetWidthAuto, notifyAusbossChange } from "../shared/index.mjs";
import { hideInputsInDef, hideWidget } from "../shared/widget_visibility.mjs";
import { ensureCardCss } from "../shared/widget_card.mjs";
import {
  FORMAT_LABELS, TAGS, namingMode, previewFolder, previewName, tagsEnabled,
} from "../shared/save_image_naming.mjs";

const NODE_CLASS = "AUSBOSS_NODES_SaveImage";
const WIDGET_NAME = "ausboss_save_image_card";
const CSS_ID = "ausboss-save-image-css";
const NODE_MIN_WIDTH = 340;
// Captions, fields, the two-line preview, chips, pills, the switch row and
// the gaps between them; the frontend's wrapper insets ride on top.
const CARD_HEIGHT = 288;
const WRAPPER_INSET = 16;
const HIDDEN = [
  "filename_prefix", "format", "save_metadata", "exact_name", "on_existing",
  "output_dir", "caption", "name_counter", "name_date", "name_time", "name_size", "name_batch",
];
const FONT = `-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`;
const MONO = `ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`;

function ensureCss() {
  ensureCardCss();
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-save{box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;gap:6px;padding:8px 9px;overflow:hidden;border:1px solid rgba(0,180,170,.22);border-radius:8px;background:rgba(0,0,0,.28);font:12px/1.3 ${FONT};color:#c8dddd;pointer-events:none}
.ausboss-save-cap{height:14px;flex:none;color:#5f7674;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;user-select:none}
.ausboss-save-row{display:flex;align-items:center;gap:6px;flex:none;height:26px;pointer-events:auto}
.ausboss-save .ausboss-card-seg.ausboss-save-format{height:36px;flex:none;pointer-events:auto}
.ausboss-save .ausboss-save-format button{font-size:12px}
.ausboss-save-row.linked .ausboss-card-text{color:#8ba3a1;font-family:${MONO}}
.ausboss-save-tag{flex:none;color:${BRAND};font-size:11px;padding:0 4px;user-select:none}
.ausboss-save-preview{flex:none;padding:6px 9px;border:1px solid #2a3437;border-radius:6px;background:#0b0f10;font-family:${MONO};overflow:hidden;pointer-events:auto}
.ausboss-save-preview .folder{color:#5f7674;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ausboss-save-preview .name{color:#d8ecea;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.ausboss-save-preview.saved .name{color:${BRAND}}
.ausboss-save-chips{display:flex;flex-wrap:wrap;gap:5px;flex:none;pointer-events:auto}
.ausboss-save-chip{height:22px;padding:0 9px;border:1px solid #3a4047;border-radius:6px;background:transparent;color:#8ba3a1;font:600 10.5px/1 ${FONT};cursor:pointer;white-space:nowrap}
.ausboss-save-chip:hover{color:#fff;border-color:${BRAND}}
.ausboss-save-chip.on{background:${BRAND};border-color:${BRAND};color:#04201d}
.ausboss-save-chips.off .ausboss-save-chip{opacity:.4;pointer-events:none}
.ausboss-save-switch-row{display:flex;align-items:center;justify-content:space-between;flex:none;height:26px;padding:0 2px;pointer-events:auto}
.ausboss-save-switch{flex:none;width:30px;height:16px;border-radius:8px;border:none;background:#3a4047;cursor:pointer;position:relative;padding:0}
.ausboss-save-switch::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#9ba2aa;transition:left .12s}
.ausboss-save-switch.on{background:${BRAND}}
.ausboss-save-switch.on::after{left:16px;background:#fff}
.ausboss-save-switch:focus-visible{outline:2px solid ${BRAND};outline-offset:2px}
.ausboss-save-switch-row span{color:#8ba3a1;font-size:11px;user-select:none}
.ausboss-save-browse{position:fixed;z-index:10000;width:260px;max-height:320px;overflow:auto;padding:4px;border:1px solid #3a4047;border-radius:7px;background:#1c1f23;box-shadow:0 8px 28px rgba(0,0,0,.5);font:12px/1.3 ${FONT};color:#d8ecea}
.ausboss-save-browse-head{padding:5px 8px 6px;border-bottom:1px solid #2c3238;color:#78908e;font:10px/1 ${FONT};letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ausboss-save-browse button{display:block;width:100%;padding:6px 8px;border:none;border-radius:5px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.ausboss-save-browse button:hover{background:#2a3037}
.ausboss-save-browse button.use{color:${BRAND};font-weight:600}
.ausboss-save-browse-note{padding:6px 8px;color:#c9b27a;font:11px/1.35 ${FONT};white-space:normal}
`;
  document.head.append(style);
}

const el = (tag, className = "", text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function widget(node, name) {
  return node.widgets?.find((item) => item.name === name) ?? null;
}

function value(node, name, fallback) {
  const target = widget(node, name);
  return target ? target.value : fallback;
}

function filenameLinked(node) {
  return Boolean(node.inputs?.some((input) => input?.name === "filename" && input.link !== null && input.link !== undefined));
}

function setValue(node, name, next) {
  const target = widget(node, name);
  if (!target || target.value === next) return false;
  target.value = next;
  target.callback?.(next, app.canvas, node);
  node.graph?.setDirtyCanvas?.(true, true);
  return true;
}

function readValues(node) {
  const values = {};
  for (const name of HIDDEN) values[name] = value(node, name, undefined);
  values.filenameLinked = filenameLinked(node);
  return values;
}

// ---------- the Browse popup: subfolders of ComfyUI's output folder ----------

let openPopup = null;
function closeBrowse() {
  openPopup?.remove();
  openPopup = null;
}

async function listFolders(path) {
  const response = await api.fetchApi(`/ausboss/save_image/folders?path=${encodeURIComponent(path)}`);
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Could not list folders.");
  return response.json();
}

async function openBrowse(state, anchor) {
  closeBrowse();
  const popup = el("div", "ausboss-save-browse");
  const rect = anchor.getBoundingClientRect();
  popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 270))}px`;
  popup.style.top = `${rect.bottom + 4}px`;
  document.body.append(popup);
  openPopup = popup;
  const current = String(value(state.node, "output_dir", "")).trim().replace(/\\/g, "/");
  let path = /^([A-Za-z]:[\\/]|\/|~)/.test(current) ? "" : current.replace(/^\/+|\/+$/g, "");
  const render = async () => {
    popup.textContent = "";
    popup.append(el("div", "ausboss-save-browse-head", `ComfyUI/output/${path}`));
    const other = el("button", "", "📂 Choose another folder…");
    other.title = "Opens the system folder dialog on the ComfyUI computer. A folder chosen there stays approved for saving.";
    other.addEventListener("click", async () => {
      other.disabled = true;
      other.textContent = "Waiting for the folder dialog on the ComfyUI computer…";
      const outcome = choiceOutcome(await chooseOnServer(api, "folder"));
      if (outcome.path) {
        setValue(state.node, "output_dir", outcome.path);
        state.refresh();
        notifyAusbossChange();
        closeBrowse();
        return;
      }
      other.disabled = false;
      other.textContent = "📂 Choose another folder…";
      if (outcome.message) popup.append(el("div", "ausboss-save-browse-note", outcome.message));
    });
    popup.append(other);
    let listing;
    try {
      listing = await listFolders(path);
    } catch (error) {
      popup.append(el("div", "ausboss-save-browse-head", error.message));
      return;
    }
    path = listing.path;
    const use = el("button", "use", path ? `Use “${path}”` : "Use the output folder");
    use.addEventListener("click", () => { setValue(state.node, "output_dir", path); state.refresh(); notifyAusbossChange(); closeBrowse(); });
    popup.append(use);
    if (path) {
      const up = el("button", "", "↑ up one level");
      up.addEventListener("click", () => { path = path.split("/").slice(0, -1).join("/"); render(); });
      popup.append(up);
    }
    for (const folder of listing.folders) {
      const button = el("button", "", `📁 ${folder}`);
      button.addEventListener("click", () => { path = path ? `${path}/${folder}` : folder; render(); });
      popup.append(button);
    }
    if (!listing.folders.length) popup.append(el("div", "ausboss-save-browse-head", "no subfolders here"));
  };
  await render();
  const dismiss = (event) => {
    if (popup.contains(event.target) || event.target === anchor) return;
    closeBrowse();
    window.removeEventListener("pointerdown", dismiss, true);
  };
  window.addEventListener("pointerdown", dismiss, true);
}

// ---------- the card ----------

function textField(state, name, placeholder, title) {
  const input = el("input", "ausboss-card-text");
  input.type = "text"; input.placeholder = placeholder; input.title = title; input.spellcheck = false;
  const commit = () => {
    if (input.disabled) return;
    if (setValue(state.node, name, input.value.trim())) { state.savedPath = null; notifyAusbossChange(); }
    state.refresh();
  };
  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") input.blur();
    if (event.key === "Escape") { input.value = String(value(state.node, name, "")); input.blur(); }
  });
  return input;
}

function buildCard(node) {
  ensureCss();
  const root = el("div", "ausboss-save");
  const state = { node, root, savedPath: null, alive: true };
  node.__ausbossSaveImage = state;
  for (const name of HIDDEN) {
    const target = widget(node, name);
    if (!target) continue;
    hideWidget(target);
    // The legacy caption is a multiline DOM widget: collapsing its layout is
    // not enough, its textarea has to go too. Its value still saves.
    if (target.element) target.element.style.display = "none";
  }

  // Folder
  root.append(el("div", "ausboss-save-cap", "Folder"));
  const folderRow = el("div", "ausboss-save-row");
  const folder = textField(state, "output_dir", "ComfyUI/output", "Where to save. Empty is ComfyUI's output folder; a relative path is a subfolder of it. Any other folder must be approved once: Browse › Choose another folder… opens the system folder dialog on the ComfyUI computer.");
  const browse = el("button", "ausboss-card-btn", "Browse");
  browse.title = "Pick a subfolder of ComfyUI's output folder, or approve another folder in the system dialog";
  browse.addEventListener("click", () => openBrowse(state, browse));
  folderRow.append(folder, browse);
  root.append(folderRow);

  // Filename
  root.append(el("div", "ausboss-save-cap", "Filename"));
  const nameRow = el("div", "ausboss-save-row");
  const nameField = textField(state, "filename_prefix", "image", "The local filename; subfolders are allowed. The tags below are appended to it.");
  const nameTag = el("span", "ausboss-save-tag", "");
  nameRow.append(nameField, nameTag);
  root.append(nameRow);

  // Path preview
  root.append(el("div", "ausboss-save-cap", "Path preview"));
  const preview = el("div", "ausboss-save-preview");
  const previewFolderLine = el("div", "folder");
  const previewNameLine = el("div", "name");
  preview.append(previewFolderLine, previewNameLine);
  preview.title = "The name this save will produce; after a run, the first file it actually wrote.";
  root.append(preview);

  // Tags
  const chips = el("div", "ausboss-save-chips");
  const chipButtons = new Map();
  for (const tag of TAGS) {
    const chip = el("button", "ausboss-save-chip", tag.label);
    chip.type = "button"; chip.title = tag.title;
    chip.addEventListener("click", () => {
      if (setValue(node, tag.key, !Boolean(value(node, tag.key, false)))) { state.savedPath = null; notifyAusbossChange(); }
      state.refresh();
    });
    chips.append(chip); chipButtons.set(tag.key, chip);
  }
  root.append(chips);

  // Format: the pill alone, tall enough to read as the one big choice on
  // the card - the three names say what it is.
  const seg = el("div", "ausboss-card-seg ausboss-save-format");
  const formatButtons = new Map();
  const formatTitles = {
    png: "Lossless and most compatible. Preserves alpha and can embed the workflow for drag-back into ComfyUI.",
    "webp lossless": "Lossless and usually smaller than PNG. Preserves alpha; the workflow rides in EXIF.",
    "jxl lossless": "Lossless and compact. Needs pillow-jxl-plugin in ComfyUI's python; browser and node preview support is limited.",
  };
  for (const [key, label] of Object.entries(FORMAT_LABELS)) {
    const button = el("button", "", label);
    button.type = "button"; button.title = formatTitles[key] ?? key;
    button.addEventListener("click", () => { if (setValue(node, "format", key)) { state.savedPath = null; notifyAusbossChange(); } state.refresh(); });
    seg.append(button); formatButtons.set(key, button);
  }
  root.append(seg);

  // Embed workflow
  const switchRow = el("div", "ausboss-save-switch-row");
  const switchLabel = el("span", "", "Embed workflow");
  const toggle = el("button", "ausboss-save-switch");
  toggle.type = "button"; toggle.setAttribute("role", "switch");
  toggle.title = "On stores the prompt and workflow in the image for drag-back. Off writes a clean image for sharing or datasets.";
  toggle.addEventListener("click", () => { if (setValue(node, "save_metadata", !Boolean(value(node, "save_metadata", true)))) notifyAusbossChange(); state.refresh(); });
  switchRow.append(switchLabel, toggle);
  root.append(switchRow);

  root.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button,input,select")) event.stopPropagation();
  });

  state.refresh = () => {
    if (!state.alive) return;
    const values = readValues(node);
    const mode = namingMode({ filenameLinked: values.filenameLinked, exactName: values.exact_name });
    if (document.activeElement !== folder) folder.value = String(values.output_dir ?? "");
    nameRow.classList.toggle("linked", mode === "linked");
    nameField.disabled = mode === "linked";
    if (mode === "linked") {
      nameField.value = "{{filename}}"; nameTag.textContent = "linked";
      nameField.title = "The name comes from the filename input.";
    } else if (mode === "exact") {
      if (document.activeElement !== nameField) nameField.value = String(values.exact_name ?? "");
      nameTag.textContent = "exact";
      nameField.title = "Legacy exact_name: saved under exactly this name, no tags. Clear it to compose the name here.";
    } else {
      if (document.activeElement !== nameField) nameField.value = String(values.filename_prefix ?? "");
      nameTag.textContent = "";
      nameField.title = "The local filename; subfolders are allowed. The tags below are appended to it.";
    }
    // An exact-mode edit writes the exact name; a local-mode edit the prefix.
    nameField.dataset.target = mode === "exact" ? "exact_name" : "filename_prefix";
    if (state.savedPath) {
      const slash = state.savedPath.lastIndexOf("/");
      previewFolderLine.textContent = slash >= 0 ? (state.savedPath.startsWith("/") ? state.savedPath.slice(0, slash + 1) : `ComfyUI/output/${state.savedPath.slice(0, slash + 1)}`) : "ComfyUI/output/";
      previewNameLine.textContent = state.savedPath.slice(slash + 1);
      preview.classList.add("saved");
    } else {
      previewFolderLine.textContent = previewFolder(values);
      previewNameLine.textContent = previewName(values);
      preview.classList.remove("saved");
    }
    chips.classList.toggle("off", !tagsEnabled(values));
    for (const [key, chip] of chipButtons) chip.classList.toggle("on", Boolean(values[key]));
    for (const [key, button] of formatButtons) button.classList.toggle("on", values.format === key);
    const embed = Boolean(values.save_metadata);
    toggle.classList.toggle("on", embed); toggle.setAttribute("aria-checked", String(embed));
  };
  // The one field serves both the prefix and a legacy exact name.
  nameField.addEventListener("change", () => {
    const target = nameField.dataset.target;
    if (target === "exact_name") {
      if (setValue(node, "exact_name", nameField.value.trim())) { state.savedPath = null; notifyAusbossChange(); }
    }
    state.refresh();
  });

  const domWidget = node.addDOMWidget(WIDGET_NAME, WIDGET_NAME, root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => CARD_HEIGHT + WRAPPER_INSET,
  });
  keepDomWidgetWidthAuto(domWidget);
  // A constant-height card, pinned on purpose (tests/panel_guards.test.mjs,
  // fixedByDesign): fields and pills, not a stage that follows the node.
  domWidget.computeSize = (width) => [Math.max(NODE_MIN_WIDTH, Number(width || node.size?.[0] || NODE_MIN_WIDTH)), CARD_HEIGHT + WRAPPER_INSET];
  domWidget.computeLayoutSize = () => ({ minWidth: NODE_MIN_WIDTH, minHeight: CARD_HEIGHT + WRAPPER_INSET });
  domWidget.options.minNodeSize = [NODE_MIN_WIDTH, 120];
  // Ahead of the legacy caption textarea, which stays hidden underneath.
  const index = node.widgets.indexOf(domWidget);
  const firstDom = node.widgets.findIndex((item) => item !== domWidget && item.element);
  if (index >= 0 && firstDom >= 0 && firstDom < index) {
    node.widgets.splice(index, 1); node.widgets.splice(firstDom, 0, domWidget);
  }

  for (const name of HIDDEN) {
    const target = widget(node, name);
    if (target) chainCallback(target, "callback", () => state.refresh());
  }
  chainCallback(node, "onConfigure", () => queueMicrotask(() => {
    for (const name of HIDDEN) { const target = widget(node, name); if (target) { hideWidget(target); if (target.element) target.element.style.display = "none"; } }
    state.savedPath = null; state.refresh();
  }));
  chainCallback(node, "onConnectionsChange", () => queueMicrotask(() => state.refresh()));
  chainCallback(node, "onExecuted", (output) => {
    const saved = output?.ausboss_saved_path?.[0];
    if (typeof saved === "string" && saved) { state.savedPath = saved; state.refresh(); }
  });
  chainCallback(node, "onRemoved", () => { state.alive = false; closeBrowse(); });
  state.refresh();
  node.setSize?.([Math.max(node.size?.[0] || 0, NODE_MIN_WIDTH), node.computeSize?.()[1] || CARD_HEIGHT]);
  return state;
}

app.registerExtension({
  name: "ausboss.save_image",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    hideInputsInDef(nodeData, HIDDEN);
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      if (this.__ausbossSaveImage) return;
      buildCard(this);
    });
  },
});
