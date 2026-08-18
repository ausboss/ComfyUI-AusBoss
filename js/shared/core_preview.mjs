// Stand ComfyUI's own in-node previews down on nodes that draw their own.
//
// A node that returns a ui payload — or streams progress previews — gets a
// preview from the frontend automatically: an image one as the canvas widget
// named $$canvas-image-preview, a video one as the DOM widget named
// video-preview. Every AusBoss node here already presents that same result
// inside its own panel, so left alone the node shows it twice, once in the
// panel and once again underneath.
//
// The widgets are hidden rather than removed. The frontend re-adds a preview
// whenever it finds none and the node has images, so removing one just brings
// it back on the next frame; a hidden widget is still found by name and left
// alone. Its value is untouched either way, and neither serializes.

export const CORE_VIDEO_PREVIEW_WIDGET = "video-preview";
export const CORE_IMAGE_PREVIEW_WIDGET = "$$canvas-image-preview";

export function hideCanvasWidget(widget, element = null) {
  if (!widget || widget.__ausbossHidden) return;
  widget.__ausbossHidden = true;
  widget.hidden = true;
  widget._hidden = true;
  widget.computeSize = () => [0, -4];
  widget.computeLayoutSize = () => ({ minWidth: 0, minHeight: 0 });
  widget.draw = () => {};
  widget.mouse = () => false;
  if (element) element.style.display = "none";
}

// Wrap one of the node's own add*Widget methods so the named widget is hidden
// the moment the frontend creates it, and sweep any copy already present.
function suppressWidget(node, flag, method, targetName, elementOf) {
  if (!node || node[flag]) return;
  node[flag] = true;
  const prior = node[method];
  if (typeof prior === "function") {
    node[method] = function (...args) {
      const widget = prior.apply(this, args);
      if (widget?.name === targetName || args[0] === targetName) {
        hideCanvasWidget(widget, elementOf(widget, args));
      }
      return widget;
    };
  }
  for (const widget of node.widgets || []) {
    if (widget?.name === targetName) hideCanvasWidget(widget, elementOf(widget, []));
  }
}

export function suppressCoreVideoPreview(node) {
  suppressWidget(
    node,
    "__ausbossCorePreviewSuppressed",
    "addDOMWidget",
    CORE_VIDEO_PREVIEW_WIDGET,
    (widget, args) => args[2] || widget?.element || node.videoContainer,
  );
}

export function suppressCoreImagePreview(node) {
  // The image preview arrives through addCustomWidget, not addDOMWidget: it
  // is painted straight onto the graph canvas and owns no element.
  suppressWidget(
    node,
    "__ausbossCoreImagePreviewSuppressed",
    "addCustomWidget",
    CORE_IMAGE_PREVIEW_WIDGET,
    () => null,
  );
}
