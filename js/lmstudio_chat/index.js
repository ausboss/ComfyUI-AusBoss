import { app } from "/scripts/app.js";
import { chainCallback, keepDomWidgetWidthAuto } from "../shared/index.mjs";
import { hideWidget } from "../shared/widget_visibility.mjs";
import {
  loadSettings,
  makeGearRow,
  openSettingsMenu,
} from "../shared/settings_menu.mjs";

const NODE_CLASS = "AUSBOSS_NODES_LmStudioChat";
const SETTINGS_SCOPE = "lmstudio_chat";
const GEAR_MIN_WIDTH = 120;

// The gear strip is a DOM panel like any other, so it carries the same
// containment guards the panel audit enforces pack-wide.
function installStyles() {
  if (document.getElementById("ausboss-chat-styles")) return;
  const style = document.createElement("style");
  style.id = "ausboss-chat-styles";
  style.textContent = `
  .ausboss-chat-gearrow{box-sizing:border-box;overflow:hidden;width:100%;display:flex;
    align-items:center;justify-content:flex-end;padding:0 2px;}
  `;
  document.head.append(style);
}

// Every entry maps 1:1 onto a hidden standard widget of the same name, so
// values save with the workflow and reach the API like any widget; the gear
// also stores them as the defaults new nodes start from.
const SETTINGS_SCHEMA = [
  { section: "Sampling" },
  {
    key: "top_p", label: "Top-p", type: "number", default: 1, min: 0, max: 1,
    hint: "Nucleus cap. 1 leaves the server default.",
  },
  {
    key: "top_k", label: "Top-k", type: "number", default: 0, min: 0, max: 1000,
    hint: "0 leaves the server default.",
  },
  {
    key: "min_p", label: "Min-p", type: "number", default: 0, min: 0, max: 1,
    hint: "Minimum token probability. 0 leaves the server default.",
  },
  {
    key: "repeat_penalty", label: "Repeat penalty", type: "number",
    default: 1, min: 0, max: 4,
    hint: "1 leaves the server default.",
  },
  {
    key: "presence_penalty", label: "Presence penalty", type: "number",
    default: 0, min: -2, max: 2,
    hint: "0 leaves the server default.",
  },
  { section: "Thinking" },
  {
    key: "thinking_mode", label: "Thinking", type: "choice",
    default: "model default", options: ["model default", "on", "off"],
    hint: "Force hybrid reasoning models to think or answer directly.",
  },
  {
    key: "reasoning_open_tag", label: "Reasoning open tag", type: "text",
    default: "<think>",
    hint: "Text between the tags moves to the thinking output.",
  },
  {
    key: "reasoning_close_tag", label: "Reasoning close tag", type: "text",
    default: "</think>",
  },
  { section: "Memory" },
  {
    key: "idle_unload_seconds", label: "Idle unload (seconds)", type: "number",
    default: 0, min: 0, max: 86400,
    hint: "LM Studio unloads the model after idling this long. 0 keeps it loaded.",
  },
  {
    key: "free_comfy_vram", label: "Free ComfyUI VRAM first", type: "toggle",
    default: false,
    hint: "Unload cached diffusion models before the request.",
  },
];

const SETTING_KEYS = SETTINGS_SCHEMA.filter((entry) => entry.key).map((entry) => entry.key);

function advancedWidgets(node) {
  const map = {};
  for (const key of SETTING_KEYS) {
    const widget = node.widgets?.find((item) => item.name === key);
    if (widget) map[key] = widget;
  }
  return map;
}

function currentValues(widgets) {
  const values = {};
  for (const [key, widget] of Object.entries(widgets)) values[key] = widget.value;
  return values;
}

function installChatNode(node) {
  installStyles();
  const widgets = advancedWidgets(node);
  if (!Object.keys(widgets).length) return;

  // New nodes start from the stored gear defaults; a workflow restore then
  // overwrites these seeds with the saved values, which is the right order.
  const defaults = loadSettings(SETTINGS_SCOPE, SETTINGS_SCHEMA);
  for (const [key, widget] of Object.entries(widgets)) {
    widget.value = defaults[key];
    hideWidget(widget);
  }

  const { row, button } = makeGearRow("LM Studio Chat settings");
  button.addEventListener("click", () => {
    openSettingsMenu({
      scope: SETTINGS_SCOPE,
      schema: SETTINGS_SCHEMA,
      anchor: button.getBoundingClientRect(),
      title: "LM Studio Chat settings",
      initial: currentValues(widgets),
      onChange: (values, key) => {
        const keys = key ? [key] : SETTING_KEYS;
        for (const name of keys) {
          if (widgets[name]) widgets[name].value = values[name];
        }
        node.graph?.setDirtyCanvas?.(true, true);
      },
    });
  });
  row.classList.add("ausboss-chat-gearrow");
  const gearWidget = node.addDOMWidget("ausboss_chat_gear", "ausboss_chat_gear", row, {
    serialize: false,
    hideOnZoom: false,
  });
  keepDomWidgetWidthAuto(gearWidget);
  gearWidget.computeSize = (width) => [
    Math.max(GEAR_MIN_WIDTH, Number(width || node.size?.[0] || GEAR_MIN_WIDTH)),
    28,
  ];
  gearWidget.computeLayoutSize = () => ({ minWidth: GEAR_MIN_WIDTH, minHeight: 28 });
  gearWidget.options.minNodeSize = [GEAR_MIN_WIDTH, 60];

  node.setSize?.([
    Math.max(node.size?.[0] ?? 0, 300),
    node.computeSize?.()[1] ?? node.size?.[1],
  ]);
}

app.registerExtension({
  name: "AusBoss.LmStudioChat",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      installChatNode(this);
    });
  },
});
