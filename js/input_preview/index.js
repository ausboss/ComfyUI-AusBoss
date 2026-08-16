// Upstream input preview for Refine Mask and LaMa Inpaint.
//
// Both nodes show nothing until the graph runs; this panel resolves the node
// feeding their IMAGE/MASK input and shows a best-effort thumbnail of it. The
// panel is fully inert (pointer-events: none) so clicks fall through, the node
// stays draggable from its body, and wheel zoom belongs to the graph.

import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { chainCallback } from "../shared/index.mjs";
import {
  describeSourcePreview,
  placeholderText,
  sourceFileWidget,
  upstreamNode,
} from "../shared/input_preview.mjs";

const CSS_ID = "ausboss-input-preview-css";
const WIDGET_NAME = "ausboss_input_preview";
const PANEL_HEIGHT = 140;
const INPUT_SIDE = 1; // LiteGraph.INPUT
const NODE_CONFIG = {
  AUSBOSS_NODES_LaMaInpaint: { inputName: "image", noun: "an image" },
  AUSBOSS_NODES_RefineMask: { inputName: "mask", noun: "a mask" },
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
`;
  document.head.appendChild(style);
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
  const described = describeSourcePreview(source);
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

function buildPanel(node, config) {
  if (node.__ausbossInputPreview) return node.__ausbossInputPreview;
  ensureCss();

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
  stage.append(img, video, hint);
  root.append(stage);

  const widget = node.addDOMWidget(WIDGET_NAME, "ausboss_input_preview", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => PANEL_HEIGHT,
  });
  widget.computeSize = (width) => [Number(width || node.size?.[0] || 0), PANEL_HEIGHT];

  const state = node.__ausbossInputPreview = {
    node,
    inputName: config.inputName,
    noun: config.noun,
    root, stage, img, video, hint, widget,
    watched: null,
    timer: 0,
    alive: true,
  };

  img.addEventListener("load", () => showMedia(state, "image"));
  img.addEventListener("error", () => {
    if (img.getAttribute("src")) showHint(state, placeholderText(true, state.noun));
  });
  video.addEventListener("loadeddata", () => showMedia(state, "video"));
  video.addEventListener("error", () => {
    if (video.getAttribute("src")) showHint(state, placeholderText(true, state.noun));
  });

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
        if (state) scheduleRefresh(state);
      });
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      const state = this.__ausbossInputPreview;
      if (!state) return;
      state.alive = false;
      if (state.timer) clearTimeout(state.timer);
      state.timer = 0;
      unwatchSource(state);
      clearMedia(state);
      this.__ausbossInputPreview = null;
    });
  },
});
