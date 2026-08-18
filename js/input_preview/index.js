// The in-node preview panel for LaMa Inpaint, Mask Refine and Select Frame.
//
// It shows this node's own result once it has one, and falls back to a
// thumbnail of whatever feeds its IMAGE/MASK input before the graph has run.
// ComfyUI's own preview for the same result is stood down (see
// shared/core_preview.mjs), so the node shows one picture, in this panel,
// rather than one here and another underneath the node.
//
// The panel is fully inert (pointer-events: none) so clicks fall through, the
// node stays draggable from its body, and wheel zoom belongs to the graph.

import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { BRAND, chainCallback, keepDomWidgetWidthAuto } from "../shared/index.mjs";
import { fillNodeHeight } from "../shared/panel_layout.mjs";
import { suppressCoreImagePreview } from "../shared/core_preview.mjs";
import { autoMaskValues } from "../shared/mask_auto.mjs";
import { setWidgetVisible } from "../shared/widget_visibility.mjs";
import {
  describeNodePreview,
  placeholderText,
  sourceFileWidget,
  upstreamNode,
} from "../shared/input_preview.mjs";

const CSS_ID = "ausboss-input-preview-css";
const WIDGET_NAME = "ausboss_input_preview";
// The panel's floor, and the node's: narrower than this and the AUTO/MORE
// buttons have nowhere to sit.
const PANEL_HEIGHT = 140;
const PANEL_MIN_WIDTH = 200;
const INPUT_SIDE = 1; // LiteGraph.INPUT

// Mask Refine opens on expand and blur alone. The other five are real
// controls, not clutter, but they answer questions most masks never ask, and
// a seven-widget node reads as seven decisions you have to make before it
// will work. They are one click away and their values are untouched while
// hidden, so a workflow that set them keeps them.
const MASK_ADVANCED_WIDGETS = [
  "fill_holes",
  "smooth",
  "black_point",
  "white_point",
  "edge_refine",
];
const ADVANCED_PROPERTY = "ausboss_show_advanced";

const NODE_CONFIG = {
  AUSBOSS_NODES_LaMaInpaint: { inputName: "image", noun: "an image" },
  AUSBOSS_NODES_RefineMask: {
    inputName: "mask",
    noun: "a mask",
    advanced: MASK_ADVANCED_WIDGETS,
    tools: [
      { label: "AUTO", title: "Set expand and blur from the mask's size", action: applyAutoValues },
      { label: "MORE", title: "Show the advanced mask controls", action: toggleAdvanced },
    ],
  },
  AUSBOSS_NODES_SelectFrame: { inputName: "frames", noun: "frames" },
};

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-input-preview{box-sizing:border-box;width:100%;height:100%;padding:2px 6px 6px;pointer-events:none;overflow:hidden;}
.ausboss-input-preview-stage{position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;overflow:hidden;border:1px solid rgba(0,180,170,.27);border-radius:6px;background:rgba(0,0,0,.28);}
.ausboss-input-preview-stage img,.ausboss-input-preview-stage video{display:none;max-width:100%;max-height:100%;object-fit:contain;}
.ausboss-input-preview-stage.show-image img{display:block;}
.ausboss-input-preview-stage.show-video video{display:block;}
.ausboss-input-preview-hint{display:none;max-width:86%;color:#78908e;font:11px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;}
.ausboss-input-preview-stage:not(.show-image):not(.show-video) .ausboss-input-preview-hint{display:block;}
.ausboss-input-preview-tools{position:absolute;right:5px;top:5px;z-index:4;display:flex;gap:4px;pointer-events:auto;opacity:.86;}
.ausboss-input-preview-tools:hover{opacity:1;}
.ausboss-input-preview-tool{box-sizing:border-box;height:20px;min-width:24px;padding:0 6px;border:1px solid rgba(0,180,170,.52);border-radius:4px;background:rgba(0,0,0,.7);color:#c8dddd;font:700 9px/18px "Segoe UI",sans-serif;cursor:pointer;}
.ausboss-input-preview-tool:hover{border-color:${BRAND};color:#fff;background:rgba(0,79,75,.78);}
.ausboss-input-preview-tool.active{border-color:${BRAND};color:${BRAND};}
.ausboss-input-preview-toast{position:absolute;left:50%;bottom:6px;z-index:5;max-width:88%;padding:3px 7px;border-radius:4px;background:rgba(0,0,0,.78);color:#b8d3d1;font:10px/1.3 "Segoe UI",sans-serif;text-align:center;transform:translateX(-50%);pointer-events:none;}
`;
  document.head.appendChild(style);
}

// --- panel tools ------------------------------------------------------------

function toast(state, text) {
  state.toast.textContent = text;
  state.toast.style.display = text ? "block" : "none";
  clearTimeout(state.toastTimer);
  if (text) state.toastTimer = setTimeout(() => toast(state, ""), 2600);
}

function widgetByName(node, name) {
  return node.widgets?.find((widget) => widget?.name === name) ?? null;
}

function setWidgetValue(node, name, value) {
  const widget = widgetByName(node, name);
  if (!widget) return false;
  widget.value = value;
  widget.callback?.(value, app.canvas, node);
  return true;
}

// The size of whatever the panel is showing - the mask's own resolution once
// the node has run, the input's before it has.
//
// The element is safe to measure: /view serves the file at its stored size
// whatever the width, height and preview parameters in the query say. Those
// are the dimensions the frontend already knew, echoed back, and the server
// reads none of them as a resize (its preview parameter only re-encodes the
// format, see server.py).
function previewSize(state) {
  if (state.img.naturalWidth > 0) {
    return { width: state.img.naturalWidth, height: state.img.naturalHeight };
  }
  if (state.video.videoWidth > 0) {
    return { width: state.video.videoWidth, height: state.video.videoHeight };
  }
  return null;
}

function applyAutoValues(state) {
  const size = previewSize(state);
  const values = size && autoMaskValues(size.width, size.height);
  if (!values) {
    // Nothing measurable on the panel means nothing to scale from. Saying so
    // beats guessing from a default resolution the mask may not have.
    toast(state, "run once so Auto can read the mask size");
    return;
  }
  setWidgetValue(state.node, "expand", values.expand);
  setWidgetValue(state.node, "blur", values.blur);
  toast(state, `${size.width}x${size.height}: expand ${values.expand}, blur ${values.blur}`);
  state.node.setDirtyCanvas?.(true, true);
}

function advancedShown(node) {
  node.properties ??= {};
  return !!node.properties[ADVANCED_PROPERTY];
}

// Apply the current advanced/simple state to the widgets. Called on build and
// on every toggle, so a reloaded workflow reopens the way it was left.
function syncAdvanced(state) {
  const names = state.advanced;
  if (!names?.length) return;
  const shown = advancedShown(state.node);
  let changed = false;
  for (const name of names) {
    const widget = widgetByName(state.node, name);
    if (widget && setWidgetVisible(widget, shown)) changed = true;
  }
  const button = state.toolButtons?.MORE;
  if (button) {
    button.textContent = shown ? "LESS" : "MORE";
    button.title = shown ? "Hide the advanced mask controls" : "Show the advanced mask controls";
    button.classList.toggle("active", shown);
  }
  if (changed) {
    // The node has to be re-measured or the freed rows leave a gap.
    state.node.setSize?.(state.node.computeSize());
    state.node.setDirtyCanvas?.(true, true);
  }
}

function toggleAdvanced(state) {
  state.node.properties ??= {};
  state.node.properties[ADVANCED_PROPERTY] = !advancedShown(state.node);
  syncAdvanced(state);
}

function buildTools(state, tools, signal) {
  const bar = document.createElement("div");
  bar.className = "ausboss-input-preview-tools";
  state.toolButtons = {};
  for (const tool of tools) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ausboss-input-preview-tool";
    button.textContent = tool.label;
    button.title = tool.title;
    // Stop the graph from seeing the click as a canvas drag on the node.
    button.addEventListener("pointerdown", (event) => event.stopPropagation(), { signal });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      tool.action(state);
    }, { signal });
    state.toolButtons[tool.label] = button;
    bar.append(button);
  }
  return bar;
}

function showHint(state, text) {
  state.stage.classList.remove("show-image", "show-video");
  state.hint.textContent = text;
}

function showMedia(state, kind) {
  state.stage.classList.toggle("show-image", kind === "image");
  state.stage.classList.toggle("show-video", kind === "video");
}

function clearMedia(state) {
  state.img.removeAttribute("src");
  state.video.pause?.();
  state.video.removeAttribute("src");
}

// Restore the watched widget's callback if our hook is still the tail of the
// chain; if someone chained after us the hook simply goes inert via
// state.alive. We never create object URLs, so there is nothing to revoke.
function unwatchSource(state) {
  const watched = state.watched;
  state.watched = null;
  if (watched && watched.widget.callback === watched.hook) {
    watched.widget.callback = watched.prior;
  }
}

function rewatchSource(state, source) {
  const widget = sourceFileWidget(source);
  if (state.watched?.widget === widget) return;
  unwatchSource(state);
  if (!widget) return;
  const prior = widget.callback;
  const hook = function (...args) {
    const result = prior?.apply(this, args);
    if (state.alive) scheduleRefresh(state);
    return result;
  };
  widget.callback = hook;
  state.watched = { widget, prior, hook };
}

function refresh(state) {
  if (!state.alive) return;
  const source = upstreamNode(state.node, state.inputName);
  rewatchSource(state, source);
  const described = describeNodePreview(state.node, state.inputName);
  if (!described) {
    clearMedia(state);
    showHint(state, placeholderText(!!source, state.noun));
    return;
  }
  const url = described.kind === "url"
    ? described.url
    : api.apiURL(`/view?${described.query}`);
  if (described.isVideo) {
    state.img.removeAttribute("src");
    if (state.video.getAttribute("src") !== url) {
      state.video.src = url;
      state.video.load?.();
    } else if (state.video.readyState >= 2) {
      showMedia(state, "video");
    }
  } else {
    state.video.pause?.();
    state.video.removeAttribute("src");
    if (state.img.getAttribute("src") !== url) {
      state.img.src = url;
    } else if (state.img.complete && state.img.naturalWidth > 0) {
      showMedia(state, "image");
    }
  }
}

// Connection and widget events can fire in bursts (and mid-load, before links
// are committed), so refreshes coalesce through one short timer.
function scheduleRefresh(state) {
  if (!state.alive) return;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = 0;
    refresh(state);
  }, 60);
}

// Refresh the panel whenever the frontend hangs new images on the node.
//
// Watching the property rather than an api event catches both routes that set
// it - the progress frames streamed during a run and the ui payload delivered
// when the node finishes - without this file having to know either event name.
function watchOwnResult(node, state) {
  let images = node.imgs;
  try {
    Object.defineProperty(node, "imgs", {
      configurable: true,
      enumerable: true,
      get: () => images,
      set: (value) => {
        images = value;
        if (state.alive) scheduleRefresh(state);
      },
    });
  } catch {
    // A frontend that has already sealed the property just means the panel
    // updates on the next connection or execution event instead.
  }
}

function buildPanel(node, config) {
  if (node.__ausbossInputPreview) return node.__ausbossInputPreview;
  ensureCss();
  suppressCoreImagePreview(node);

  const root = document.createElement("div");
  root.className = "ausboss-input-preview";
  const stage = document.createElement("div");
  stage.className = "ausboss-input-preview-stage";
  const img = document.createElement("img");
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "metadata";
  video.playsInline = true;
  const hint = document.createElement("div");
  hint.className = "ausboss-input-preview-hint";
  const toastEl = document.createElement("div");
  toastEl.className = "ausboss-input-preview-toast";
  toastEl.style.display = "none";
  stage.append(img, video, hint, toastEl);
  root.append(stage);

  const widget = node.addDOMWidget(WIDGET_NAME, "ausboss_input_preview", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => PANEL_HEIGHT,
  });
  keepDomWidgetWidthAuto(widget);
  // A floor, not a fixed height. This was a constant-height strip back when it
  // showed a thumbnail of the node's input; now that it shows the result, it is
  // a viewport onto a picture, and pinning it left dead space under every node
  // dragged taller.
  fillNodeHeight(widget, {
    minWidth: PANEL_MIN_WIDTH,
    minHeight: PANEL_HEIGHT,
    minNodeSize: [PANEL_MIN_WIDTH, 200],
  });

  const abort = new AbortController();
  const state = node.__ausbossInputPreview = {
    node,
    inputName: config.inputName,
    noun: config.noun,
    advanced: config.advanced,
    root, stage, img, video, hint, widget, abort,
    toast: toastEl,
    toastTimer: 0,
    toolButtons: null,
    watched: null,
    timer: 0,
    alive: true,
  };
  if (config.tools?.length) {
    stage.append(buildTools(state, config.tools, abort.signal));
  }
  syncAdvanced(state);

  img.addEventListener("load", () => showMedia(state, "image"));
  img.addEventListener("error", () => {
    if (img.getAttribute("src")) showHint(state, placeholderText(true, state.noun));
  });
  video.addEventListener("loadeddata", () => showMedia(state, "video"));
  video.addEventListener("error", () => {
    if (video.getAttribute("src")) showHint(state, placeholderText(true, state.noun));
  });

  watchOwnResult(node, state);
  showHint(state, placeholderText(false, state.noun));
  scheduleRefresh(state);
  return state;
}

app.registerExtension({
  name: "ausboss.input_preview",
  beforeRegisterNodeDef(nodeType, nodeData) {
    const config = NODE_CONFIG[nodeData?.name];
    if (!config) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      buildPanel(this, config);
    });
    chainCallback(nodeType.prototype, "onConnectionsChange", function (side) {
      if (side !== undefined && side !== INPUT_SIDE) return;
      const state = this.__ausbossInputPreview;
      if (state) scheduleRefresh(state);
    });
    chainCallback(nodeType.prototype, "onConfigure", function () {
      queueMicrotask(() => {
        const state = buildPanel(this, config);
        if (!state) return;
        // onNodeCreated already built the panel before this node's saved
        // properties existed, so the advanced toggle has to be re-applied
        // here or a workflow always reopens in the simple state.
        syncAdvanced(state);
        scheduleRefresh(state);
      });
    });
    chainCallback(nodeType.prototype, "onExecuted", function () {
      const state = buildPanel(this, config);
      if (state) scheduleRefresh(state);
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      const state = this.__ausbossInputPreview;
      if (!state) return;
      state.alive = false;
      if (state.timer) clearTimeout(state.timer);
      clearTimeout(state.toastTimer);
      state.timer = 0;
      state.abort?.abort();
      unwatchSource(state);
      clearMedia(state);
      this.__ausbossInputPreview = null;
    });
  },
});
