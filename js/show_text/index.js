// The on-node text panel for Show Text.
//
// The backend returns the string as a ui payload, the frontend hands that to
// onExecuted, and this panel renders it on the node face. The text also lands
// in node.properties, which ride LiteGraph's default serialization, so a
// saved workflow reopens showing its last result with no custom hooks.
//
// Empty panel space is pointer-transparent so the node drags from its body
// and the wheel keeps zooming the graph; the text block itself takes the
// pointer so it can be selected and copied, which is half the point of a
// Show Text node.

import { app } from "/scripts/app.js";
import { BRAND, chainCallback, keepDomWidgetWidthAuto } from "../shared/index.mjs";
import { copyToClipboard } from "../shared/clipboard.mjs";
import { fillNodeHeight } from "../shared/panel_layout.mjs";
import { displayText, textFromExecuted } from "../shared/show_text.mjs";

const NODE_CLASS = "AUSBOSS_NODES_ShowText";
const CSS_ID = "ausboss-show-text-css";
const WIDGET_NAME = "ausboss_show_text_panel";
const TEXT_PROPERTY = "ausboss_show_text";
const PANEL_HEIGHT = 96;
const PANEL_MIN_WIDTH = 180;

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-show-text{box-sizing:border-box;width:100%;height:100%;padding:2px 6px 6px;pointer-events:none;overflow:hidden;}
.ausboss-show-text-stage{box-sizing:border-box;position:relative;display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden;border:1px solid rgba(0,180,170,.27);border-radius:6px;background:rgba(0,0,0,.28);}
.ausboss-show-text-body{flex:1;margin:0;padding:6px 30px 6px 8px;overflow-y:auto;pointer-events:auto;user-select:text;-webkit-user-select:text;cursor:text;color:#c8dddd;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;}
.ausboss-show-text-hint{margin:auto;max-width:86%;padding:6px;color:#78908e;font:11px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;}
.ausboss-show-text-note{flex:none;padding:3px 8px;border-top:1px solid rgba(0,180,170,.18);color:#78908e;font:10px/1.3 "Segoe UI",sans-serif;}
.ausboss-show-text-copy{position:absolute;top:4px;right:4px;width:22px;height:20px;padding:0;border:1px solid #3a4047;border-radius:4px;background:rgba(20,24,26,.92);color:#8ba3a1;font:12px/1 system-ui;cursor:pointer;pointer-events:auto;}
.ausboss-show-text-copy:hover{color:${BRAND};border-color:${BRAND};}
`;
  document.head.appendChild(style);
}

function render(state) {
  const text = state.node.properties?.[TEXT_PROPERTY];
  state.copy.style.display = "none";
  if (typeof text !== "string") {
    state.body.style.display = "none";
    state.note.style.display = "none";
    state.hint.style.display = "block";
    state.hint.textContent = "run the graph to see the text that arrives here";
    return;
  }
  if (text.length === 0) {
    state.body.style.display = "none";
    state.note.style.display = "none";
    state.hint.style.display = "block";
    state.hint.textContent = "the last run delivered an empty string";
    return;
  }
  const shown = displayText(text);
  state.copy.style.display = "block";
  state.hint.style.display = "none";
  state.body.style.display = "block";
  state.body.textContent = shown.text;
  state.note.style.display = shown.truncated ? "block" : "none";
  if (shown.truncated) {
    state.note.textContent =
      `showing the first ${shown.text.length.toLocaleString()} of `
      + `${text.length.toLocaleString()} characters - the output wire carries all of it`;
  }
}

function buildPanel(node) {
  if (node.__ausbossShowText) return node.__ausbossShowText;
  ensureCss();

  const root = document.createElement("div");
  root.className = "ausboss-show-text";
  const stage = document.createElement("div");
  stage.className = "ausboss-show-text-stage";
  const body = document.createElement("div");
  body.className = "ausboss-show-text-body";
  const hint = document.createElement("div");
  hint.className = "ausboss-show-text-hint";
  const note = document.createElement("div");
  note.className = "ausboss-show-text-note";
  // Copies the whole string, even when the panel shows only its start.
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "ausboss-show-text-copy";
  copy.textContent = "⧉";
  copy.title = "Copy the text";
  stage.append(body, hint, note, copy);
  root.append(stage);

  const abort = new AbortController();
  copy.addEventListener("pointerdown", (event) => event.stopPropagation(), { signal: abort.signal });
  copy.addEventListener("click", async () => {
    const copied = await copyToClipboard(node.properties?.[TEXT_PROPERTY] ?? "");
    copy.textContent = copied ? "✓" : "✕";
    setTimeout(() => { copy.textContent = "⧉"; }, copied ? 700 : 1400);
  }, { signal: abort.signal });
  // Text selection must not read as a node drag: the press stops here and
  // the browser's own selection takes over inside the block.
  body.addEventListener("pointerdown", (event) => event.stopPropagation(), {
    signal: abort.signal,
  });

  const widget = node.addDOMWidget(WIDGET_NAME, "ausboss_show_text", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => PANEL_HEIGHT,
  });
  keepDomWidgetWidthAuto(widget);
  fillNodeHeight(widget, {
    minWidth: PANEL_MIN_WIDTH,
    minHeight: PANEL_HEIGHT,
    minNodeSize: [PANEL_MIN_WIDTH, 150],
  });

  const state = (node.__ausbossShowText = { node, root, stage, body, hint, note, copy, widget, abort });
  render(state);
  return state;
}

app.registerExtension({
  name: "ausboss.show_text",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      buildPanel(this);
    });
    chainCallback(nodeType.prototype, "onConfigure", function () {
      // onNodeCreated built the panel before this node's saved properties
      // existed; re-render once they have been applied or a reloaded
      // workflow always reopens on the placeholder.
      queueMicrotask(() => {
        const state = buildPanel(this);
        if (state) render(state);
      });
    });
    chainCallback(nodeType.prototype, "onExecuted", function (message) {
      const state = buildPanel(this);
      const text = textFromExecuted(message);
      if (!state || text === null) return;
      this.properties ??= {};
      this.properties[TEXT_PROPERTY] = text;
      render(state);
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      const state = this.__ausbossShowText;
      if (!state) return;
      state.abort?.abort();
      this.__ausbossShowText = null;
    });
  },
});
