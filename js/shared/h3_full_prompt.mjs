// H3 Prompt Writer's two tabs. Simple is the card as it always was: your
// lines, the chips and the menus. Full prompt shows the prompt the node wrote
// on its last run, in a box you can change; whatever you type there is what
// H3 gets, until Reset to written. The `full_prompt` widget underneath holds
// the edit (empty when there is none), so it saves and loads like any value.
import { app } from "../../../scripts/app.js";
import { chainCallback, notifyAusbossChange } from "./index.mjs";
import { keepKeyInField } from "./canvas_passthrough.mjs";
import { compactAction } from "./panel_controls.mjs";
import { THEME as T } from "./theme.mjs";
import { commitWidgetValue } from "./widget_card_math.mjs";
import { FULL, SIMPLE, TAB_PROPERTY, WRITTEN_PROPERTY, boxText, editValue, isEdited, promptTab, writtenFromOutput } from "./h3_full_prompt_math.mjs";

export { FULL, SIMPLE, isEdited, promptTab };

const CSS_ID = "ausboss-h3-full-prompt-css";
const EDITED_NOTE = "Edited by you. This text is sent as it is; the Simple tab is not used until you reset.";

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-prompt-tabs .dot{display:inline-block;width:6px;height:6px;margin-left:6px;border-radius:3px;background:${T.warn};vertical-align:1px}
.ausboss-prompt-tabs .dot[hidden]{display:none}
.ausboss-full-prompt{display:flex;flex-direction:column;gap:6px;height:100%;min-height:0}
.ausboss-full-prompt-area{display:block;flex:1 1 auto;width:100%;min-width:0;min-height:0;padding:5px 8px;box-sizing:border-box;border:1px solid transparent;border-radius:6px;background:${T.fill};color:${T.ink};font:11.5px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;resize:none;overflow:auto}
.ausboss-full-prompt-area:focus{outline:none;border-color:${T.brand}}
.ausboss-full-prompt-area::placeholder{color:${T.faint}}
.ausboss-full-prompt-note{flex:none;padding:5px 8px;border-radius:5px;background:${T.warnSoft};color:${T.warnInk};font-size:11px;line-height:1.35}
.ausboss-full-prompt-note[hidden]{display:none}
.ausboss-full-prompt-foot{flex:none;display:flex;align-items:center;gap:8px;min-height:24px}
.ausboss-full-prompt-foot span{flex:1 1 auto;min-width:0;color:${T.faint};font-size:11px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.ausboss-simple-edited{display:flex;align-items:center;height:100%;padding:0 8px;box-sizing:border-box;border-radius:5px;background:${T.warnSoft};color:${T.warnInk};font-size:11px;line-height:1.3}
`;
  document.head.append(style);
}

const widgetOf = (node, name) => node.widgets?.find((widget) => widget.name === name) ?? null;
const redraw = (node) => (node.__ausbossCard?.refreshByHand ?? node.__ausbossCard?.refresh)?.();
const writtenOf = (node) => String(node.properties?.[WRITTEN_PROPERTY] ?? "");

function setEdit(node, value) {
  const widget = widgetOf(node, "full_prompt");
  if (!widget || widget.value === value) return;
  commitWidgetValue(node, widget, value, app?.canvas);
  node.graph?.setDirtyCanvas?.(true, true);
}

// The tab switch at the top of the card. The open tab is a display choice
// kept on the node, not a value: it changes nothing that is sent.
export function promptTabs(node) {
  ensureCss();
  const element = document.createElement("div");
  element.className = "ausboss-card-seg ausboss-prompt-tabs";
  const make = (tab, label, title) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.title = title;
    button.addEventListener("click", () => {
      if (promptTab(node) === tab) return;
      node.properties ??= {};
      node.properties[TAB_PROPERTY] = tab;
      redraw(node);
    });
    element.append(button);
    return button;
  };
  const simple = make(SIMPLE, "Simple", "Your lines, the pictures and the menus. The node writes the full prompt from them.");
  const full = make(FULL, "Full prompt", "The prompt the node wrote on its last run. Change it here to send your own.");
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.title = "Edited: this text is sent instead of the Simple tab.";
  full.append(dot);
  return {
    element,
    sync(values) {
      const tab = promptTab(node);
      simple.classList.toggle("on", tab === SIMPLE);
      full.classList.toggle("on", tab === FULL);
      dot.hidden = !isEdited(values);
    },
  };
}

// One line on the Simple tab while an edit is being sent instead.
export function simpleEditedNote() {
  ensureCss();
  const element = document.createElement("div");
  element.className = "ausboss-simple-edited";
  element.textContent = "Full prompt is edited, so these lines are not used until you reset it there.";
  return { element };
}

// The Full prompt tab: the box, a note while it holds an edit, and Reset.
export function fullPromptBox(node) {
  ensureCss();
  const element = document.createElement("div");
  element.className = "ausboss-full-prompt";
  const area = document.createElement("textarea");
  // Not the card's own textarea class: the script's colouring takes the
  // first box with that class, and it belongs to the script.
  area.className = "ausboss-full-prompt-area";
  area.spellcheck = false;
  area.placeholder = "Run the workflow once and the prompt the node writes shows here. Change it to send your own.";
  area.title = "What H3 gets. Type here to send your own text instead of the node's.";
  const note = document.createElement("div");
  note.className = "ausboss-full-prompt-note";
  note.textContent = EDITED_NOTE;
  const foot = document.createElement("div");
  foot.className = "ausboss-full-prompt-foot";
  const hint = document.createElement("span");
  hint.textContent = "Filled in after each run.";
  const reset = compactAction("Reset to written", "Throw your edit away and send what the Simple tab writes again.");
  foot.append(hint, reset);
  element.append(area, note, foot);

  area.addEventListener("input", () => {
    setEdit(node, editValue(area.value, writtenOf(node)));
    redraw(node);
  });
  area.addEventListener("change", () => notifyAusbossChange());
  area.addEventListener("keydown", (event) => {
    keepKeyInField(event, { weights: true });
    if (event.key === "Escape") area.blur();
  });
  // Leaving the box shows what is sent: emptied, it is the written prompt again.
  area.addEventListener("blur", () => redraw(node));
  reset.addEventListener("click", () => {
    setEdit(node, "");
    area.value = writtenOf(node);
    notifyAusbossChange();
    redraw(node);
  });

  // Each run hands back the prompt the node wrote. It is kept on the node, so
  // a saved workflow opens with it.
  chainCallback(node, "onExecuted", (output) => {
    const written = writtenFromOutput(output);
    if (written === null) return;
    node.properties ??= {};
    node.properties[WRITTEN_PROPERTY] = written;
    redraw(node);
  });

  return {
    element,
    sync(values) {
      const edited = isEdited(values);
      if (document.activeElement !== area) area.value = boxText(values, writtenOf(node));
      note.hidden = !edited;
      reset.disabled = !edited;
    },
  };
}
