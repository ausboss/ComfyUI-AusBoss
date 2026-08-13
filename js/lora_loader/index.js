import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { BRAND, chainCallback } from "../shared/index.mjs";
import {
  DEFAULT_STEP,
  FINE_STEP,
  MAX_ROWS,
  clampHighlight,
  filterLoras,
  highlightedName,
  isScrubbing,
  moveHighlight,
  moveRow,
  newRow,
  parseRows,
  roundStrength,
  scrubValue,
  serializeRows,
  setStrength,
  summarizeRows,
  toggleTrigger,
} from "../shared/lora_stack.mjs";

const NODE_CLASS = "AUSBOSS_NODES_LoraLoader";
const ROW_HEIGHT = 30;
const ROW_GAP = 6;
const FOOTER_HEIGHT = 34;
const PANEL_PADDING = 10;

function installStyles() {
  if (document.getElementById("ausboss-lora-styles")) return;
  const style = document.createElement("style");
  style.id = "ausboss-lora-styles";
  style.textContent = `
  .ausboss-lora-panel { display: flex; flex-direction: column; gap: ${ROW_GAP}px;
    padding: ${PANEL_PADDING}px; font: 12px system-ui; color: #d7dde2; }
  .ausboss-lora-row { display: flex; align-items: center; gap: 6px; height: ${ROW_HEIGHT}px; }
  .ausboss-lora-row.off { opacity: 0.45; }
  .ausboss-lora-toggle { width: 30px; height: 16px; border-radius: 8px; border: none;
    background: #3a4047; cursor: pointer; position: relative; flex: none; padding: 0; }
  .ausboss-lora-toggle::after { content: ""; position: absolute; top: 2px; left: 2px;
    width: 12px; height: 12px; border-radius: 50%; background: #9ba2aa; transition: left .12s; }
  .ausboss-lora-toggle.on { background: ${BRAND}; }
  .ausboss-lora-toggle.on::after { left: 16px; background: #fff; }
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
    background: #23272c; color: #9ba2aa; cursor: pointer; flex: none; font-style: italic;
    font-family: Georgia, serif; }
  .ausboss-lora-info:hover { border-color: ${BRAND}; color: ${BRAND}; }
  .ausboss-lora-footer { display: flex; align-items: center; gap: 8px; height: ${FOOTER_HEIGHT - ROW_GAP}px; }
  .ausboss-lora-add { height: 24px; border: 1px solid ${BRAND}; border-radius: 5px;
    background: transparent; color: ${BRAND}; cursor: pointer; padding: 0 10px; }
  .ausboss-lora-add:hover { background: ${BRAND}; color: #08211f; }
  .ausboss-lora-add:disabled { opacity: 0.4; cursor: default; }
  .ausboss-lora-summary { color: #9ba2aa; flex: 1 1 auto; text-align: right; }
  .ausboss-lora-link { height: 24px; border: 1px solid #3a4047; border-radius: 5px;
    background: #23272c; color: #9ba2aa; cursor: pointer; padding: 0 8px; }
  .ausboss-lora-link.on { color: ${BRAND}; border-color: ${BRAND}; }
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
  .ausboss-lora-menu button { display: block; width: 100%; text-align: left; border: none;
    background: transparent; color: inherit; padding: 6px 8px; border-radius: 4px; cursor: pointer; }
  .ausboss-lora-menu button:hover:not(:disabled) { background: #2c3238; }
  .ausboss-lora-menu button:disabled { opacity: 0.35; cursor: default; }
  .ausboss-lora-card { width: 300px; padding: 10px; gap: 8px; }
  .ausboss-lora-card img { max-width: 100%; max-height: 180px; object-fit: contain;
    border-radius: 5px; align-self: center; }
  .ausboss-lora-card h4 { margin: 0; font-size: 12px; color: #fff; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  .ausboss-lora-meta { color: #9ba2aa; }
  .ausboss-lora-chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .ausboss-lora-chip { border: 1px solid #3a4047; border-radius: 10px; background: #23272c;
    color: inherit; cursor: pointer; padding: 2px 8px; font-size: 11px; }
  .ausboss-lora-chip.active { border-color: ${BRAND}; color: ${BRAND}; }
  .ausboss-lora-fetch { align-self: flex-start; }
  .ausboss-lora-custom { display: flex; gap: 6px; }
  .ausboss-lora-custom input { flex: 1 1 auto; height: 24px; border: 1px solid #3a4047;
    border-radius: 5px; background: #23272c; color: inherit; padding: 0 8px; outline: none; }
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

function panelHeight(state) {
  const rows = Math.max(1, state.rows.length);
  return PANEL_PADDING * 2 + rows * (ROW_HEIGHT + ROW_GAP) + FOOTER_HEIGHT;
}

function fitNode(state) {
  const width = Math.max(320, state.node.size?.[0] || 320);
  const height = state.node.computeSize ? state.node.computeSize()[1] : panelHeight(state) + 80;
  state.node.setSize?.([width, height]);
  state.node.graph?.setDirtyCanvas(true, true);
}

// ---------- strength boxes ----------

function strengthBox(state, index, key) {
  const input = el("input", "ausboss-lora-strength");
  input.value = state.rows[index][key].toFixed(2);
  input.title = key === "strength"
    ? "Model strength. Drag left/right to scrub, click to type, arrows to step. Shift = fine."
    : "CLIP strength. Drag left/right to scrub, click to type, arrows to step. Shift = fine.";
  input.readOnly = true;

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
    if (drag.scrubbed) commitValue(scrubValue(drag.start, dx, event.shiftKey));
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
      const step = (event.shiftKey ? FINE_STEP : DEFAULT_STEP) * (event.key === "ArrowUp" ? 1 : -1);
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

  const pick = (name) => {
    if (!name) return;
    closePopup();
    const rows = state.rows.map((row, i) =>
      // A different file means different trigger words: clear the old ones.
      i === index ? { ...row, name, triggers: name === row.name ? row.triggers : "" } : row
    );
    commitRows(state, rows, { structural: true });
  };

  const renderList = () => {
    filtered = filterLoras(names, search.value);
    highlight = clampHighlight(highlight, filtered.length);
    list.textContent = "";
    if (!filtered.length) {
      list.append(el("div", "ausboss-lora-empty",
        names.length ? "No matches." : "Put LoRA files in models/loras."));
      return;
    }
    filtered.forEach((name, i) => {
      const option = el("div", "ausboss-lora-option", stripExtension(name));
      option.title = name;
      if (i === highlight) option.classList.add("highlight");
      if (name === state.rows[index].name) option.classList.add("current");
      option.addEventListener("pointerenter", () => {
        highlight = i;
        renderList();
      });
      option.addEventListener("click", () => pick(name));
      list.append(option);
    });
    list.children[highlight]?.scrollIntoView({ block: "nearest" });
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
    card.append(el("h4", "", info.civitai_title || stripExtension(row.name)));
    if (info.base_model) card.append(el("div", "ausboss-lora-meta", `Base model: ${info.base_model}`));

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

    if (!info.has_civitai) {
      const fetchButton = el("button", "ausboss-lora-add ausboss-lora-fetch", "Fetch Civitai info");
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
          load();
        } catch (error) {
          fetchButton.textContent = "Not found on Civitai";
        }
      });
      card.append(fetchButton);
    }

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
  });
  const summary = state.panel.querySelector(".ausboss-lora-summary");
  if (summary) summary.textContent = summarizeRows(state.rows);
}

function renderRows(state) {
  const panel = state.panel;
  panel.textContent = "";
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

    const name = el("button", "ausboss-lora-name", row.name ? stripExtension(row.name) : "choose a LoRA...");
    name.type = "button";
    name.title = row.name || "Pick a LoRA from models/loras";
    if (!row.name) name.classList.add("empty");
    name.addEventListener("click", () => openPicker(state, index, name));

    const strength = strengthBox(state, index, "strength");
    strength.__ausbossRead = () => state.rows[index]?.strength.toFixed(2) ?? "1.00";
    rowElement.append(toggle, name, strength);
    if (!linked(state)) {
      const clip = strengthBox(state, index, "strength_clip");
      clip.__ausbossRead = () => state.rows[index]?.strength_clip.toFixed(2) ?? "1.00";
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
    panel.append(rowElement);
  });

  const footer = el("div", "ausboss-lora-footer");
  const add = el("button", "ausboss-lora-add", "+ Add LoRA");
  add.type = "button";
  add.disabled = state.rows.length >= MAX_ROWS;
  add.addEventListener("click", () => {
    commitRows(state, [...state.rows, newRow()], { structural: true });
    fitNode(state);
    const pickers = state.panel.querySelectorAll(".ausboss-lora-name");
    pickers[pickers.length - 1]?.click();
  });
  const link = el("button", `ausboss-lora-link${linked(state) ? " on" : ""}`, "linked");
  link.type = "button";
  link.title = "Linked: one strength drives model and CLIP. Unlink for separate CLIP strength.";
  link.addEventListener("click", () => {
    state.node.properties.ausbossLoraLinked = !linked(state);
    if (linked(state)) {
      commitRows(state, state.rows.map((row) => ({ ...row, strength_clip: row.strength })),
        { structural: true });
    } else {
      renderRows(state);
    }
  });
  const summary = el("span", "ausboss-lora-summary", summarizeRows(state.rows));
  footer.append(add, link, summary);
  panel.append(footer);
}

// ---------- node install ----------

function installLoraNode(node) {
  installStyles();
  const widget = node.widgets?.find((item) => item.name === "loras");
  if (!widget) return;
  hideWidget(widget);

  const panel = el("div", "ausboss-lora-panel");
  const state = { node, widget, panel, rows: parseRows(widget.value) };
  node.__ausbossLoraState = state;
  if (node.properties && node.properties.ausbossLoraLinked === undefined) {
    node.properties.ausbossLoraLinked = true;
  }

  const domWidget = node.addDOMWidget("ausboss_lora_rows", "ausboss_lora_rows", panel, {
    serialize: false,
    hideOnZoom: false,
  });
  domWidget.computeSize = (width) => [Math.max(300, width), panelHeight(state)];

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
