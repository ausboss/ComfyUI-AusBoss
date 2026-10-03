// Graph zoom and pan over the pack's panels.
//
// The mouse wheel and the Ctrl + Shift drag-zoom shortcut reach the graph only
// from the empty canvas; a panel that takes the mouse swallowed them, so
// zooming stopped over Compare, the crop previews, the video viewers and every
// control on a card. One listener here hands those gestures back, the same way
// ComfyUI does for its own text boxes. A panel that wants the wheel for itself
// (a scrolling list, a focused text field, an editor) still keeps it.
import { app } from "/scripts/app.js";
import { graphDragStarts, panelKeepsWheel, panelRoot } from "../shared/canvas_passthrough.mjs";

let forwardedPointer = null;

function canvas() {
  return app.canvas ?? null;
}

function onWheel(event) {
  const target = event.target;
  const root = panelRoot(target);
  const lgCanvas = canvas();
  if (!root || !lgCanvas || event.defaultPrevented) return;
  if (panelKeepsWheel(target, event, { root, styleOf: (el) => getComputedStyle(el), activeElement: document.activeElement })) return;
  event.preventDefault();
  lgCanvas.processMouseWheel(event);
}

function onPointerDown(event) {
  const lgCanvas = canvas();
  if (!lgCanvas || !panelRoot(event.target)) return;
  if (!graphDragStarts(event, { dragZoomEnabled: lgCanvas.dragZoomEnabled })) return;
  forwardedPointer = event.pointerId;
  event.preventDefault();
  event.stopPropagation();
  lgCanvas.processMouseDown(event);
}

function onPointerMove(event) {
  if (forwardedPointer !== event.pointerId) return;
  canvas()?.processMouseMove(event);
}

function onPointerEnd(event) {
  if (forwardedPointer !== event.pointerId) return;
  forwardedPointer = null;
  canvas()?.processMouseUp(event);
}

app.registerExtension({
  name: "AusBoss.CanvasPassthrough",
  setup() {
    // The wheel listener sits in the bubble phase so a panel's own handler
    // (stopPropagation / preventDefault) always gets the first say.
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerEnd, true);
    window.addEventListener("pointercancel", onPointerEnd, true);
  },
});
