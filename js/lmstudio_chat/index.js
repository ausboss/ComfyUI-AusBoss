import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { chainCallback, keepDomWidgetWidthAuto, BRAND } from "../shared/index.mjs";
import { hideWidget } from "../shared/widget_visibility.mjs";
import {
  gearIconSvg,
  loadSettings,
  openSettingsMenu,
} from "../shared/settings_menu.mjs";

const NODE_CLASS = "AUSBOSS_NODES_LmStudioChat";
const SETTINGS_SCOPE = "lmstudio_chat";
const TOOLBAR_MIN_WIDTH = 200;

// The endpoint toolbar is a DOM panel like any other, so it carries the same
// containment guards the panel audit enforces pack-wide.
function installStyles() {
  if (document.getElementById("ausboss-chat-styles")) return;
  const style = document.createElement("style");
  style.id = "ausboss-chat-styles";
  style.textContent = `
  .ausboss-chat-toolbar{box-sizing:border-box;overflow:hidden;width:100%;
    display:flex;align-items:center;gap:6px;padding:2px;font:12px system-ui;color:#9ba2aa;}
  .ausboss-chat-toolbar *{box-sizing:border-box;}
  .ausboss-chat-dot{width:9px;height:9px;border-radius:50%;flex:none;
    background:#3a4047;transition:background .15s;}
  .ausboss-chat-dot.ok{background:#27c93f;box-shadow:0 0 5px rgba(39,201,63,.6);}
  .ausboss-chat-dot.fail{background:#ff5f56;box-shadow:0 0 5px rgba(255,95,86,.6);}
  .ausboss-chat-btn{height:22px;line-height:20px;border:1px solid #3a4047;border-radius:5px;
    background:#23272c;color:#d7dde2;cursor:pointer;padding:0 10px;font:11px system-ui;flex:none;}
  .ausboss-chat-btn:hover{border-color:${BRAND};color:${BRAND};}
  .ausboss-chat-btn:disabled{opacity:.45;cursor:default;}
  .ausboss-chat-gap{flex:1 1 auto;min-width:0;}
  .ausboss-chat-gearbtn{width:24px;height:24px;border:1px solid #3a4047;border-radius:5px;
    background:#23272c;color:#9ba2aa;cursor:pointer;display:grid;place-items:center;
    flex:none;padding:0;}
  .ausboss-chat-gearbtn:hover{border-color:${BRAND};color:${BRAND};}
  .ausboss-chat-pop{position:fixed;z-index:10000;background:#1c1f23;border:1px solid #3a4047;
    border-radius:7px;box-shadow:0 8px 28px rgba(0,0,0,.5);font:12px system-ui;color:#d7dde2;
    display:flex;flex-direction:column;min-width:220px;max-width:380px;}
  .ausboss-chat-list{overflow-y:auto;max-height:44vh;padding:4px;}
  .ausboss-chat-option{padding:5px 8px;border-radius:4px;cursor:pointer;white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis;}
  .ausboss-chat-option:hover{background:#2c3238;}
  .ausboss-chat-option.current{color:${BRAND};}
  .ausboss-chat-note{padding:9px 10px;color:#9ba2aa;font-style:italic;}
  `;
  document.head.append(style);
}

// Every entry maps 1:1 onto a hidden standard widget of the same name, so
// values save with the workflow and reach the API like any widget; the gear
// also stores them as the defaults new nodes start from.
const SETTINGS_SCHEMA = [
  // Each sampler is an override: unticked sends nothing and the server's own
  // setting stands. `neutral` is that off value - and it is also each
  // sampler's no-op value, so the payload is identical either way and old
  // workflows keep loading unchanged. `active` mirrors LM Studio's defaults.
  { section: "Sampling" },
  {
    key: "top_p", label: "Top-p", type: "number", default: 1, min: 0, max: 1,
    neutral: 1, active: 0.95, slider: true, step: 0.01,
    hint: "Nucleus cap: consider only the most likely tokens summing to this.",
  },
  {
    key: "top_k", label: "Top-k", type: "number", default: 0, min: 0, max: 1000,
    neutral: 0, active: 40,
    hint: "Consider only this many top tokens.",
  },
  {
    key: "min_p", label: "Min-p", type: "number", default: 0, min: 0, max: 1,
    neutral: 0, active: 0.05, slider: true, step: 0.01,
    hint: "Drop tokens below this share of the top token's probability.",
  },
  {
    key: "repeat_penalty", label: "Repeat penalty", type: "number",
    default: 1, min: 0, max: 4, neutral: 1, active: 1.1,
    hint: "Above 1 discourages repeating what it already said.",
  },
  {
    key: "presence_penalty", label: "Presence penalty", type: "number",
    default: 0, min: -2, max: 2, neutral: 0, active: 0.5,
    hint: "Above 0 pushes toward new topics.",
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
    hint: "LM Studio unloads the model after idling this long. 0 keeps it "
      + "loaded. The node's unload_llm switch overrides this with 1s.",
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

function toast(severity, summary, detail) {
  try {
    app.extensionManager?.toast?.add?.({ severity, summary, detail, life: 4500 });
  } catch (_error) {
    // No toast store on this frontend: the status dot still tells the story.
  }
}

async function fetchModels(endpoint) {
  const response = await api.fetchApi("/ausboss/lmstudio/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || "endpoint test failed");
  return data.models ?? [];
}

// One floating popup at a time, torn down through one AbortController.
let activePicker = null;

function closePicker() {
  if (!activePicker) return;
  activePicker.abort.abort();
  activePicker.element.remove();
  activePicker = null;
}

function openModelPicker(anchorRect, models, current, onPick) {
  closePicker();
  const pop = document.createElement("div");
  pop.className = "ausboss-chat-pop";
  const list = document.createElement("div");
  list.className = "ausboss-chat-list";
  if (!models.length) {
    const note = document.createElement("div");
    note.className = "ausboss-chat-note";
    note.textContent = "The server reports no models.";
    pop.append(note);
  }
  for (const name of models) {
    const option = document.createElement("div");
    option.className = `ausboss-chat-option${name === current ? " current" : ""}`;
    option.textContent = name;
    option.title = name;
    option.addEventListener("click", () => { closePicker(); onPick(name); });
    list.append(option);
  }
  pop.append(list);
  document.body.append(pop);
  const place = () => {
    const rect = pop.getBoundingClientRect();
    let left = Math.min(anchorRect.left, window.innerWidth - rect.width - 8);
    let top = anchorRect.bottom + 4;
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, anchorRect.top - rect.height - 4);
    }
    pop.style.left = `${Math.max(8, left)}px`;
    pop.style.top = `${top}px`;
  };
  place();
  requestAnimationFrame(place);
  const abort = new AbortController();
  document.addEventListener(
    "pointerdown",
    (event) => { if (!pop.contains(event.target)) closePicker(); },
    { capture: true, signal: abort.signal },
  );
  window.addEventListener(
    "keydown",
    (event) => { if (event.key === "Escape") { event.stopPropagation(); closePicker(); } },
    { capture: true, signal: abort.signal },
  );
  activePicker = { element: pop, abort };
}

function buildToolbar(node, widgets) {
  const endpointWidget = node.widgets?.find((item) => item.name === "endpoint");
  const modelWidget = node.widgets?.find((item) => item.name === "model");

  const row = document.createElement("div");
  row.className = "ausboss-chat-toolbar";
  const dot = document.createElement("span");
  dot.className = "ausboss-chat-dot";
  dot.title = "Endpoint status: gray untested, green reachable, red failed";

  const test = document.createElement("button");
  test.type = "button";
  test.className = "ausboss-chat-btn";
  test.textContent = "Test";
  test.title = "Check the endpoint by asking it for its model list";
  test.addEventListener("click", async () => {
    test.disabled = true;
    dot.className = "ausboss-chat-dot";
    try {
      const models = await fetchModels(endpointWidget?.value ?? "");
      dot.className = "ausboss-chat-dot ok";
      toast("success", "LM Studio endpoint OK",
        models.length ? `${models.length} model(s) available.` : "Reachable; no models loaded.");
    } catch (error) {
      dot.className = "ausboss-chat-dot fail";
      toast("warn", "LM Studio endpoint failed", String(error?.message ?? error));
    } finally {
      test.disabled = false;
    }
  });

  const load = document.createElement("button");
  load.type = "button";
  load.className = "ausboss-chat-btn";
  load.textContent = "Models";
  load.title = "List the server's models and pick one into the model field";
  load.addEventListener("click", async () => {
    load.disabled = true;
    try {
      const models = await fetchModels(endpointWidget?.value ?? "");
      dot.className = "ausboss-chat-dot ok";
      openModelPicker(load.getBoundingClientRect(), models, modelWidget?.value, (name) => {
        if (modelWidget) {
          modelWidget.value = name;
          modelWidget.callback?.(name);
        }
        node.graph?.setDirtyCanvas?.(true, true);
      });
    } catch (error) {
      dot.className = "ausboss-chat-dot fail";
      toast("warn", "LM Studio endpoint failed", String(error?.message ?? error));
    } finally {
      load.disabled = false;
    }
  });

  const gap = document.createElement("span");
  gap.className = "ausboss-chat-gap";

  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "ausboss-chat-gearbtn";
  gear.title = "LM Studio Chat settings";
  gear.innerHTML = gearIconSvg();
  gear.addEventListener("click", () => {
    openSettingsMenu({
      scope: SETTINGS_SCOPE,
      schema: SETTINGS_SCHEMA,
      anchor: gear.getBoundingClientRect(),
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

  row.append(dot, test, load, gap, gear);
  return row;
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

  const row = buildToolbar(node, widgets);
  // The frontend keeps ~16px of a DOM widget's declared height as wrapper
  // margins, so the 22px buttons need 48 declared to get a 32px box —
  // measured live against the deployed frontend, not assumed.
  const TOOLBAR_DECLARED_HEIGHT = 48;
  const toolbarWidget = node.addDOMWidget("ausboss_chat_toolbar", "ausboss_chat_toolbar", row, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => TOOLBAR_DECLARED_HEIGHT,
  });
  keepDomWidgetWidthAuto(toolbarWidget);
  toolbarWidget.computeSize = (width) => [
    Math.max(TOOLBAR_MIN_WIDTH, Number(width || node.size?.[0] || TOOLBAR_MIN_WIDTH)),
    TOOLBAR_DECLARED_HEIGHT,
  ];
  toolbarWidget.computeLayoutSize = () => ({
    minWidth: TOOLBAR_MIN_WIDTH,
    minHeight: TOOLBAR_DECLARED_HEIGHT,
  });
  toolbarWidget.options.minNodeSize = [TOOLBAR_MIN_WIDTH, 60];

  // The toolbar belongs directly under the endpoint field, not at the node's
  // tail where addDOMWidget appends it.
  const list = node.widgets ?? [];
  const from = list.indexOf(toolbarWidget);
  const endpointAt = list.findIndex((item) => item.name === "endpoint");
  if (from >= 0 && endpointAt >= 0 && from !== endpointAt + 1) {
    list.splice(from, 1);
    list.splice(endpointAt + 1, 0, toolbarWidget);
  }

  chainCallback(node, "onRemoved", () => closePicker());

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
