import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { chainCallback, keepDomWidgetWidthAuto, notifyAusbossChange } from "../shared/index.mjs";
import { hideWidget } from "../shared/widget_visibility.mjs";
import { canvasHeightForWidth, findPadPreview, padEmptyStateText } from "../shared/pad_canvas.mjs";
import { createPadStage } from "../shared/pad_panel.mjs";

const NODE_NAME = "AUSBOSS_NODES_PadImage";
const PANEL_WIDGET = "ausboss_pad_image_stage";
const PROPERTY_KEY = "ausboss_pad_preview";
const PAD_MIN_WIDTH = 340;
const PANEL_CHROME = 12;
const CSS_ID = "ausboss-padimage-ui-v1";
const DEFAULT_SOURCE = { width: 512, height: 512 };

function ensurePadCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-padimage-root{box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;padding:2px 6px 6px;overflow:hidden;}
.ausboss-padimage-root canvas{flex:1 1 auto;min-height:0;width:100%;display:block;border:1px solid rgba(0,180,170,.34);border-radius:6px;background:#0c0e10;touch-action:none;}
`;
  document.head.appendChild(style);
}

function findWidget(node, name) {
  return node.widgets?.find((widget) => widget.name === name);
}

function numberValue(node, name, fallback = 0) {
  const value = Number(findWidget(node, name)?.value);
  return Number.isFinite(value) ? value : fallback;
}

function isImageWired(node) {
  const input = node.inputs?.find((candidate) => candidate?.name === "image");
  return input?.link != null;
}

function watchWidget(node, name, onChange) {
  const target = findWidget(node, name);
  if (!target || target.__ausbossPadWatch) return;
  target.__ausbossPadWatch = true;
  const prior = target.callback;
  target.callback = function (...args) {
    const result = prior?.apply(this, args);
    onChange();
    return result;
  };
}

function loadPreview(state, preview) {
  const serial = ++state.loadSerial;
  state.sourceWidth = preview.width;
  state.sourceHeight = preview.height;
  state.known = true;
  const query = new URLSearchParams({
    filename: preview.filename,
    subfolder: preview.subfolder,
    type: preview.type,
    t: String(Date.now()),
  });
  const image = new Image();
  image.onload = () => {
    if (serial !== state.loadSerial) return;
    state.bitmap = image;
    state.stage.draw();
  };
  image.onerror = () => {
    // Temp previews vanish on server restart: keep the cached geometry and
    // fall back to the wireframe until the next run refreshes the file.
    if (serial !== state.loadSerial) return;
    state.bitmap = null;
    state.stage.draw();
  };
  image.src = api.apiURL(`/view?${query}`);
  state.stage.draw();
}

function buildPanel(node) {
  if (node.__ausbossPadImage) return node.__ausbossPadImage;
  if (!findWidget(node, "pad_left")) return null;

  ensurePadCss();
  for (const side of ["left", "top", "right", "bottom"]) {
    hideWidget(findWidget(node, `pad_${side}`));
  }

  const root = document.createElement("div");
  root.className = "ausboss-padimage-root";
  const canvas = document.createElement("canvas");
  root.append(canvas);

  const widget = node.addDOMWidget(PANEL_WIDGET, "ausboss_pad_image_stage", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => 190,
  });
  keepDomWidgetWidthAuto(widget);
  widget.computeSize = (width) => {
    const resolvedWidth = Math.max(PAD_MIN_WIDTH, Number(width || node.size?.[0] || PAD_MIN_WIDTH));
    return [resolvedWidth, canvasHeightForWidth(resolvedWidth) + PANEL_CHROME];
  };
  widget.computeLayoutSize = () => ({
    minWidth: PAD_MIN_WIDTH,
    minHeight: 190,
  });
  widget.options ??= {};
  widget.options.minNodeSize = [PAD_MIN_WIDTH, 300];

  const state = {
    node,
    canvas,
    bitmap: null,
    known: false,
    sourceWidth: DEFAULT_SOURCE.width,
    sourceHeight: DEFAULT_SOURCE.height,
    loadSerial: 0,
  };
  node.__ausbossPadImage = state;

  const stage = createPadStage(canvas, {
    getSource: () => ({
      bitmap: state.bitmap,
      width: state.sourceWidth,
      height: state.sourceHeight,
      known: state.known,
      emptyText: state.bitmap ? null : padEmptyStateText(isImageWired(node)),
    }),
    getValues: () => ({
      pad_left: numberValue(node, "pad_left"),
      pad_top: numberValue(node, "pad_top"),
      pad_right: numberValue(node, "pad_right"),
      pad_bottom: numberValue(node, "pad_bottom"),
      canvas_multiple: 1,
      target_megapixels: 0,
    }),
    writePad: (side, value) => {
      const target = findWidget(node, `pad_${side}`);
      if (!target) return;
      target.value = value;
      target.callback?.(value);
    },
    onGestureEnd: () => {
      notifyAusbossChange();
      node.setDirtyCanvas?.(true, true);
    },
  });
  state.stage = stage;

  for (const side of ["left", "top", "right", "bottom"]) {
    watchWidget(node, `pad_${side}`, () => stage.draw());
  }
  chainCallback(node, "onConnectionsChange", () => stage.draw());

  // Last execution's preview survives in properties (structural parts only;
  // the cache buster is fresh at use), so a reloaded workflow shows the real
  // bitmap without waiting for a run — while the server still has the file.
  const cached = node.properties?.[PROPERTY_KEY];
  if (cached?.filename && cached.width >= 1 && cached.height >= 1) {
    loadPreview(state, cached);
  } else {
    node.setSize?.([
      Math.max(PAD_MIN_WIDTH + 20, node.size?.[0] || 0),
      node.computeSize?.()[1] || 400,
    ]);
    setTimeout(() => stage.draw(), 0);
  }
  return state;
}

app.registerExtension({
  name: "ausboss.pad_image.stage",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_NAME) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      buildPanel(this);
    });
    chainCallback(nodeType.prototype, "onConfigure", function () {
      // Workflow restore lands widget values and properties after creation:
      // re-read then. Never write widget values from this path.
      queueMicrotask(() => {
        const state = buildPanel(this);
        if (!state) return;
        const cached = this.properties?.[PROPERTY_KEY];
        if (cached?.filename && !state.bitmap) loadPreview(state, cached);
        else state.stage.draw();
      });
    });
    chainCallback(nodeType.prototype, "onExecuted", function (message) {
      const state = buildPanel(this);
      if (!state) return;
      const preview = findPadPreview(message);
      if (!preview) return;
      this.properties ??= {};
      this.properties[PROPERTY_KEY] = preview;
      loadPreview(state, preview);
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      this.__ausbossPadImage?.stage?.dispose?.();
      this.__ausbossPadImage = null;
    });
  },
});
