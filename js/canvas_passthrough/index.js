// Graph zoom and pan over the pack's panels, and files dropped on them.
//
// The mouse wheel and the Ctrl + Shift drag-zoom shortcut reach the graph only
// from the empty canvas; a panel that takes the mouse swallowed them, so
// zooming stopped over Compare, the crop previews, the video viewers and every
// control on a card. One listener here hands those gestures back, the same way
// ComfyUI does for its own text boxes. A panel that wants the wheel for itself
// (a scrolling list, a focused text field, an editor) still keeps it.
//
// A file dragged in from the desktop has the same problem in the classic
// renderer: dropped on a node's title it loads into the node, dropped on the
// node's panel (the picture, the controls) it missed the node. The drop
// listeners here hand it to the node under the pointer.
import { app } from "/scripts/app.js";
import {
  dragCarriesFiles, graphDragStarts, panelKeepsWheel, panelNeedsDropHelp, panelRoot,
} from "../shared/canvas_passthrough.mjs";
import { showToast } from "../shared/index.mjs";

let forwardedPointer = null;
// The node a dragged file is over while the pointer is on its panel.
let dropNode = null;

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

// The node a panel belongs to, found the way the canvas finds the node under
// a drag: by where the pointer is.
function nodeUnder(event) {
  const lgCanvas = canvas();
  const graph = lgCanvas?.graph;
  if (!graph || typeof lgCanvas.adjustMouseEvent !== "function") return null;
  lgCanvas.adjustMouseEvent(event);
  if (!Number.isFinite(event.canvasX) || !Number.isFinite(event.canvasY)) return null;
  return graph.getNodeOnPos?.(event.canvasX, event.canvasY) ?? null;
}

// The node that takes this dragged file, or null when the drag is not ours
// to help with: no files, not over one of the pack's classic panels, or a
// node that does not take files.
function takerOf(event) {
  if (!dragCarriesFiles(event) || !panelNeedsDropHelp(event.target)) return null;
  const node = nodeUnder(event);
  if (typeof node?.onDragDrop !== "function" || !node.onDragOver?.(event)) return null;
  return node;
}

// ComfyUI outlines the node a file is dragged over; keep that outline while
// the pointer is on the node's panel.
function markDropNode(node) {
  if (dropNode === node) return;
  dropNode = node;
  if ("dragOverNode" in app) app.dragOverNode = node;
  canvas()?.graph?.setDirtyCanvas?.(false, true);
}

function onDragOver(event) {
  const node = takerOf(event);
  if (!node) {
    if (dropNode && panelRoot(event.target)) markDropNode(null);
    return;
  }
  // Without this the browser refuses the drop.
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  markDropNode(node);
}

async function onDrop(event) {
  const node = takerOf(event);
  if (!node) return;
  // The node gets the file. ComfyUI's own handler would add a Load Image
  // node for it, or open it as a workflow.
  event.preventDefault();
  event.stopPropagation();
  markDropNode(null);
  const file = event.dataTransfer?.files?.[0] ?? null;
  try {
    if (await node.onDragDrop(event)) return;
    // Not a file this node takes (a workflow dropped on a loader): let
    // ComfyUI open it, as it does for a drop on the node's title.
    if (file && file.type !== "image/bmp") await app.handleFile?.(file);
  } catch (error) {
    showToast({ severity: "error", detail: `That file could not be loaded: ${error?.message ?? error}`, life: 8000 });
  }
}

function onDragEnd() {
  if (dropNode) markDropNode(null);
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
    // Capture phase: ComfyUI's own drop listener sits on the document and
    // must not also act on a file the node took.
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("drop", onDrop, true);
    window.addEventListener("dragend", onDragEnd, true);
    window.addEventListener("dragleave", (event) => { if (!event.relatedTarget) onDragEnd(); }, true);
  },
});
