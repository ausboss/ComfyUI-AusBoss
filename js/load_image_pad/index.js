import { api } from "/scripts/api.js";
import { app } from "/scripts/app.js";
import { chainCallback, keepDomWidgetWidthAuto, notifyAusbossChange } from "../shared/index.mjs";
import { fillNodeHeight } from "../shared/panel_layout.mjs";
import { hideWidget } from "../shared/widget_visibility.mjs";
import { canvasHeightForWidth, parseImageReference } from "../shared/pad_canvas.mjs";
import { createPadStage } from "../shared/pad_panel.mjs";

const NODE_NAME = "AUSBOSS_NODES_LoadImagePad";
const PANEL_WIDGET = "ausboss_load_image_pad";
const PAD_MIN_WIDTH = 340;
const PANEL_CHROME = 12;
// Stage height the node opens at, plus room for the widget column above it.
const DEFAULT_NODE_HEIGHT = canvasHeightForWidth(PAD_MIN_WIDTH + 20) + PANEL_CHROME + 300;
const CSS_ID = "ausboss-loadpad-ui-v1";
const DEFAULT_SOURCE = { width: 512, height: 512 };
const CORE_IMAGE_PREVIEW_WIDGET = "$$canvas-image-preview";

function ensurePadCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-loadpad-root{box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;padding:2px 6px 6px;overflow:hidden;}
.ausboss-loadpad-root canvas{flex:1 1 auto;min-height:0;width:100%;display:block;border:1px solid rgba(0,180,170,.34);border-radius:6px;background:#0c0e10;touch-action:none;}
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

// Core's image_upload helper installs its own source preview under the
// widgets; this node draws the source itself, so keep only the useful one.
function suppressCoreImagePreview(node) {
  const previewIndex = node.widgets?.findIndex(
    (widget) => widget.name === CORE_IMAGE_PREVIEW_WIDGET,
  ) ?? -1;
  if (previewIndex >= 0) {
    node.widgets[previewIndex].onRemove?.();
    node.widgets.splice(previewIndex, 1);
  }
  if (node.__ausbossImgsSuppressed) return;
  node.__ausbossImgsSuppressed = true;
  const priorAdd = node.addCustomWidget;
  if (typeof priorAdd === "function") {
    node.addCustomWidget = function (customWidget) {
      if (customWidget?.name === CORE_IMAGE_PREVIEW_WIDGET) hideWidget(customWidget);
      return priorAdd.call(this, customWidget);
    };
  }
  Object.defineProperty(node, "imgs", {
    configurable: true,
    enumerable: true,
    get() { return undefined; },
    set() {},
  });
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

function buildPanel(node) {
  if (node.__ausbossLoadImagePad) return node.__ausbossLoadImagePad;
  const imageWidget = findWidget(node, "image");
  if (!imageWidget) return null;

  ensurePadCss();
  suppressCoreImagePreview(node);
  for (const side of ["left", "top", "right", "bottom"]) {
    hideWidget(findWidget(node, `pad_${side}`));
  }

  const root = document.createElement("div");
  root.className = "ausboss-loadpad-root";
  const canvas = document.createElement("canvas");
  root.append(canvas);

  const widget = node.addDOMWidget(PANEL_WIDGET, "ausboss_load_image_pad", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => 190,
  });
  keepDomWidgetWidthAuto(widget);
  fillNodeHeight(widget, {
    minWidth: PAD_MIN_WIDTH,
    minHeight: 190,
    minNodeSize: [PAD_MIN_WIDTH, 320],
  });

  const state = {
    node,
    canvas,
    imageWidget,
    bitmap: null,
    sourceWidth: DEFAULT_SOURCE.width,
    sourceHeight: DEFAULT_SOURCE.height,
    emptyText: "Choose or upload an image",
    loadSerial: 0,
  };
  node.__ausbossLoadImagePad = state;

  const stage = createPadStage(canvas, {
    getSource: () => ({
      bitmap: state.bitmap,
      width: state.sourceWidth,
      height: state.sourceHeight,
      known: !!state.bitmap,
      emptyText: state.bitmap ? null : state.emptyText,
    }),
    getValues: () => ({
      pad_left: numberValue(node, "pad_left"),
      pad_top: numberValue(node, "pad_top"),
      pad_right: numberValue(node, "pad_right"),
      pad_bottom: numberValue(node, "pad_bottom"),
      canvas_multiple: numberValue(node, "canvas_multiple", 8),
      target_megapixels: numberValue(node, "target_megapixels", 0),
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

  const refresh = () => {
    const serial = ++state.loadSerial;
    const reference = parseImageReference(imageWidget.value);
    if (!reference) {
      state.bitmap = null;
      state.emptyText = "Choose or upload an image";
      stage.draw();
      return;
    }
    const query = new URLSearchParams({ ...reference, t: String(Date.now()) });
    const image = new Image();
    image.onload = () => {
      if (serial !== state.loadSerial) return;
      state.bitmap = image;
      state.sourceWidth = image.naturalWidth || DEFAULT_SOURCE.width;
      state.sourceHeight = image.naturalHeight || DEFAULT_SOURCE.height;
      suppressCoreImagePreview(node);
      node.imageIndex = null;
      stage.draw();
    };
    image.onerror = () => {
      if (serial !== state.loadSerial) return;
      state.bitmap = null;
      state.emptyText = "Preview could not load this image";
      stage.draw();
    };
    image.src = api.apiURL(`/view?${query}`);
  };
  state.refresh = refresh;

  watchWidget(node, "image", refresh);
  for (const name of ["pad_left", "pad_top", "pad_right", "pad_bottom", "canvas_multiple", "target_megapixels"]) {
    watchWidget(node, name, () => stage.draw());
  }

  // computeSize()[1] is no longer the stage's height — the panel takes the
  // node's leftover space now, so the node's minimum is only the panel's
  // floor. State the opening height from the same width-derived shape the
  // stage used to pin itself to; a saved size still wins through onConfigure.
  node.setSize?.([
    Math.max(PAD_MIN_WIDTH + 20, node.size?.[0] || 0),
    Math.max(node.size?.[1] || 0, DEFAULT_NODE_HEIGHT),
  ]);
  setTimeout(refresh, 0);
  return state;
}

app.registerExtension({
  name: "ausboss.load_image_pad.panel",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_NAME) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      buildPanel(this);
    });
    chainCallback(nodeType.prototype, "onConfigure", function () {
      // Workflow restore lands widget values after creation: re-sync then.
      // Never write widget values here — restored pads must survive a load.
      queueMicrotask(() => {
        const state = buildPanel(this);
        if (state) {
          suppressCoreImagePreview(this);
          state.refresh?.();
        }
      });
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      this.__ausbossLoadImagePad?.stage?.dispose?.();
      this.__ausbossLoadImagePad = null;
    });
  },
});
