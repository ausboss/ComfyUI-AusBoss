// Lets the graph keep its mouse gestures while the pointer is over one of the
// pack's panels.
//
// A panel or card that takes the mouse (a picture stage, a number box, a
// button) also takes the mouse wheel, so the graph stopped zooming the moment
// the pointer crossed it. ComfyUI forwards those gestures for its own text
// boxes only. These helpers decide what to hand back to the graph; the entry
// in js/canvas_passthrough/ wires them to the page.

// The wheel belongs to the panel while it can still scroll that way (a long
// text box, a list of rows), or while a text field has the keyboard.
export function canScrollFurther(element, deltaY) {
  if (!element || !deltaY) return false;
  const room = element.scrollHeight - element.clientHeight;
  if (room <= 1) return false;
  return deltaY > 0 ? element.scrollTop + element.clientHeight < element.scrollHeight - 1 : element.scrollTop > 0;
}

// Does the wheel belong to something inside the panel, between the target
// and the panel's own root? `styleOf` is getComputedStyle, passed in so this
// stays testable without a page.
export function panelKeepsWheel(target, event, { root, styleOf, activeElement }) {
  for (let element = target; element && element !== root; element = element.parentElement) {
    const tag = String(element.tagName ?? "").toUpperCase();
    if ((tag === "TEXTAREA" || tag === "INPUT") && element === activeElement) return true;
    const overflow = styleOf(element)?.overflowY;
    if ((overflow === "auto" || overflow === "scroll") && canScrollFurther(element, event.deltaY)) return true;
  }
  return false;
}

// Gestures that start over a panel and still mean "move the graph": the
// middle button (pan), and Ctrl + Shift + left button (drag-zoom) when the
// user has that shortcut switched on.
export function graphDragStarts(event, { dragZoomEnabled }) {
  if (event.button === 1 || event.buttons === 4) return true;
  return Boolean(dragZoomEnabled && event.ctrlKey && event.shiftKey && !event.altKey && event.buttons);
}

// Where one of the pack's panels sits: the frontend wraps every classic DOM
// widget in a .dom-widget, and in Nodes 2.0 (Vue nodes) a panel sits inside the
// node's .lg-node-widgets. The pack's panels all carry an "ausboss-" class on
// their root. Returns that root (the outermost "ausboss-" element under the
// wrapper), or null for anything that is not one of ours (core's own text
// boxes forward the wheel themselves).
export function panelRoot(target) {
  const host = target?.closest?.(".dom-widget, .lg-node-widgets");
  if (!host) return null;
  let root = null;
  for (let element = target; element && element !== host; element = element.parentElement) {
    if (String(element.className).includes("ausboss-")) root = element;
  }
  return root;
}
