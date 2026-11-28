// H3 Prompt Writer 🆎: the gear in the card's corner.
//
//   Sockets    in use | all. The same choice as the ComfyUI setting "Show
//              every socket on H3 Prompt Writer" (js/h3_sockets), so it
//              holds for every writer on this browser.
//   The model  what the small model on clip is asked, four wordings. Each
//              opens in an editor; an edited one is saved in this node's
//              hidden model_asks input, so a shared workflow asks the same.
//              Empty means the built-in wording.
import { api } from "../../../scripts/api.js";
import { app } from "../../../scripts/app.js";
import { SHOW_ALL } from "./h3_sockets.mjs";
import { LONGEST_ASK, editedAsks, readAsks, wordingWarning, writeAsks } from "./h3_writer_gear_math.mjs";
import { showToast } from "./index.mjs";
import { gearIconSvg, openSettingsMenu, closeSettingsMenu } from "./settings_menu.mjs";
import { FONT_UI, THEME } from "./theme.mjs";

const CSS_ID = "ausboss-h3-gear-css";
const TITLE = "H3 Prompt Writer settings";
// The gear's width and the gap beside it, kept free at the end of the tabs.
const CORNER_RESERVE = 30;

export const ASKS = [
  { key: "describe", label: "Describe a new person", hint: "In a swap, writes how a new person looks from their picture." },
  { key: "next", label: "Fill in the next moments", hint: "After one typed line, writes what happens next. {seconds}, {first} and {count} are filled in." },
  { key: "heard", label: "Hear the place", hint: "Writes the steady sound of the place. {lines} is filled in." },
  { key: "tidy", label: "Tidy up my lines", hint: "Instructions for Tidy up my lines, under More." },
];

let builtIn = null;
async function builtInAsks() {
  if (builtIn) return builtIn;
  const response = await api.fetchApi("/ausboss/h3_writer/asks");
  if (!response.ok) throw new Error("no built-in wording");
  builtIn = await response.json();
  return builtIn;
}

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-card.has-corner .ausboss-prompt-tabs{width:calc(100% - ${CORNER_RESERVE}px)}
.ausboss-ask-back{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;background:rgba(0,0,0,.45)}
.ausboss-ask{width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 48px);display:flex;flex-direction:column;gap:8px;padding:12px;box-sizing:border-box;border:1px solid ${THEME.rule};border-radius:10px;background:#1f2326;color:${THEME.inkSoft};font:13px/1.4 ${FONT_UI};box-shadow:0 12px 36px rgba(0,0,0,.55)}
.ausboss-ask h3{margin:0;font-size:14px;color:${THEME.ink}}
.ausboss-ask p{margin:0;font-size:11px;color:${THEME.faint}}
.ausboss-ask textarea{min-height:240px;flex:1 1 auto;resize:vertical;padding:8px;box-sizing:border-box;border:1px solid ${THEME.brand};border-radius:6px;outline:none;background:#0b0f10;color:${THEME.ink};font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.ausboss-ask-row{display:flex;gap:6px;align-items:center}
.ausboss-ask-row .gap{flex:1}
.ausboss-ask button{all:unset;flex:none;white-space:nowrap;padding:5px 11px;border-radius:6px;background:${THEME.fill};color:${THEME.inkSoft};font-weight:600;font-size:12px;cursor:pointer}
.ausboss-ask button:hover{background:${THEME.fillHover}}
.ausboss-ask button.save{background:${THEME.brand};color:${THEME.onBrand}}
.ausboss-ask .state{font-size:11px;color:${THEME.faint}}
.ausboss-ask .state.warn{color:${THEME.warn}}
`;
  document.head.append(style);
}

// The editor for one wording: the node's own, or the built-in one to start
// from. Save keeps it on the node; Back to built-in empties it.
function openEditor(node, card, ask, built) {
  ensureCss();
  const back = document.createElement("div");
  back.className = "ausboss-ask-back";
  const box = document.createElement("div");
  box.className = "ausboss-ask";
  const title = document.createElement("h3");
  title.textContent = ask.label;
  const hint = document.createElement("p");
  hint.textContent = `${ask.hint} Only used when a text model is plugged into clip. Saved in this node.`;
  const area = document.createElement("textarea");
  const own = readAsks(card.values().model_asks)[ask.key];
  area.maxLength = LONGEST_ASK;
  area.value = (own ?? built).slice(0, LONGEST_ASK);
  area.spellcheck = false;
  const opened = area.value;
  const state = document.createElement("span");
  state.className = "state";
  const button = (label, className, run) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    if (className) element.className = className;
    element.addEventListener("click", run);
    return element;
  };
  const saveButton = button("Save", "save", () => save(area.value));
  // Escape or a click outside over typing that is not saved, and Save over a
  // wording that drops a name the writer fills in, each say so once; the
  // second press goes ahead.
  let leaving = false;
  let saving = false;
  const warn = (words) => {
    state.textContent = words;
    state.classList.toggle("warn", true);
  };
  const showState = () => {
    leaving = false;
    saving = false;
    saveButton.textContent = "Save";
    state.classList.toggle("warn", false);
    const words = area.value.trim() === built.trim() || !area.value.trim() ? "Built-in wording" : "Your wording";
    state.textContent = area.value.length >= LONGEST_ASK ? `${words}, at the ${LONGEST_ASK.toLocaleString()} letter limit` : words;
  };
  showState();
  area.addEventListener("input", showState);
  const close = () => back.remove();
  const leave = () => {
    if (leaving || area.value === opened) return close();
    showState();
    leaving = true;
    warn("Not saved yet. Press Esc again to close without saving.");
  };
  const save = (words) => {
    // The built-in wording, or nothing, is stored as nothing, so a later
    // release's better wording reaches this node.
    const kept = words.trim() && words.trim() !== built.trim() ? words : "";
    const problem = kept ? wordingWarning(ask.key, kept, built) : "";
    if (problem && !saving) {
      showState();
      saving = true;
      saveButton.textContent = "Save anyway";
      warn(problem);
      return;
    }
    card.setWidget("model_asks", writeAsks(card.values().model_asks, ask.key, kept));
    card.refresh();
    close();
  };
  // The editor is a window of its own: no key reaches ComfyUI while it is
  // open (Ctrl+Enter would queue the old wording; here it saves), Tab stays
  // inside it, and Escape closes it from any of its controls.
  back.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      leave();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      save(area.value);
    } else if (event.key === "Tab") {
      const stops = [...box.querySelectorAll("textarea, button")];
      const at = stops.indexOf(document.activeElement);
      const next = (at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length;
      event.preventDefault();
      stops[next].focus();
    }
  });
  const row = document.createElement("div");
  row.className = "ausboss-ask-row";
  const gap = document.createElement("span");
  gap.className = "gap";
  row.append(
    button("Back to built-in", "", () => { area.value = built; showState(); }),
    state, gap,
    button("Cancel", "", close),
    saveButton,
  );
  box.append(title, hint, area, row);
  back.append(box);
  back.addEventListener("pointerdown", (event) => { if (event.target === back) leave(); });
  document.body.append(back);
  area.focus();
}

// The card's corner: { element, sync } for mountWidgetCard's corner option.
export function writerGear(node, card) {
  ensureCss();
  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "ausboss-card-gear";
  gear.title = TITLE;
  gear.innerHTML = gearIconSvg();
  const open = async () => {
    let built;
    try {
      built = await builtInAsks();
    } catch {
      built = null;
    }
    const edited = editedAsks(card.values().model_asks);
    const schema = [
      { section: "Display (this browser)" },
      {
        key: "sockets", label: "Sockets", type: "choice", options: ["in use", "all"], default: "in use", persist: false,
        hint: "In use shows the sockets you use and the next free picture.",
      },
      { section: "What the model on clip is asked (saved in this node)" },
      ...ASKS.map((ask) => ({
        key: `ask_${ask.key}`, label: ask.label, type: "action", button: "Edit",
        hint: built ? (edited.has(ask.key) ? "Your wording." : "Built-in wording.") : "Restart ComfyUI to edit this.",
        onAction: () => {
          if (!built) return;
          closeSettingsMenu();
          openEditor(node, card, ask, built[ask.key] ?? "");
        },
      })),
    ];
    openSettingsMenu({
      scope: "h3_writer",
      schema,
      anchor: gear.getBoundingClientRect(),
      title: TITLE,
      initial: { sockets: app.extensionManager?.setting?.get?.(SHOW_ALL) ? "all" : "in use" },
      onChange: (values, key) => {
        if (key === "sockets") app.extensionManager?.setting?.set?.(SHOW_ALL, values.sockets === "all");
        else if (key === null) reset();
      },
    });
  };
  // The menu's Reset: the sockets back to "in use" and every wording back
  // to built-in, as one undo step, then the menu again to show it.
  const reset = async () => {
    try {
      await app.extensionManager?.setting?.set?.(SHOW_ALL, false);
    } catch {
      // The menu shows what the setting holds.
    }
    if (editedAsks(card.values().model_asks).size) {
      card.setWidget("model_asks", "");
      card.refresh();
      showToast({ summary: "H3 Prompt Writer", detail: "The model's wordings are back to built-in. Ctrl+Z brings yours back." });
    }
    closeSettingsMenu();
    await open();
  };
  gear.addEventListener("click", open);
  // Only the tabs make room for the gear (the style above); the rows under
  // them keep the card's full width.
  return { element: gear, sync: () => 0 };
}
