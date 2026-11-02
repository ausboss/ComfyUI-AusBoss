// The outline of a node or group as people see it: { x, y, w, h } in graph
// units, title bar included.
//
// The classic look draws a node at its measured bounds (boundingRect). Nodes
// 2.0 draws each node as an element on the page, which can run past those
// bounds (its frame, a footer), so there the element itself is measured.
// Groups are drawn on the canvas in both looks.

function graphRectOf(element, canvas) {
  const box = element.getBoundingClientRect();
  if (!(box.width > 0) || !(box.height > 0)) return null;
  const view = canvas.canvas.getBoundingClientRect();
  const { scale, offset } = canvas.ds;
  return {
    x: (box.left - view.left) / scale - offset[0],
    y: (box.top - view.top) / scale - offset[1],
    w: box.width / scale,
    h: box.height / scale,
  };
}

export function boundsOf(item) {
  const box = item?.boundingRect;
  if (!box || !(box[2] > 0) || !(box[3] > 0)) return null;
  return { x: box[0], y: box[1], w: box[2], h: box[3] };
}

// Nodes 2.0's node elements by node id, found in one pass for measuring many.
export function nodeElements() {
  const elements = new Map();
  if (globalThis.LiteGraph?.vueNodesMode !== true) return elements;
  for (const element of document.querySelectorAll("[data-node-id]")) elements.set(element.getAttribute("data-node-id"), element);
  return elements;
}

export function outlineOf(item, canvas, { node = true, elements = null } = {}) {
  if (node && globalThis.LiteGraph?.vueNodesMode === true && item?.id != null && canvas?.canvas && canvas.ds) {
    const element = elements
      ? elements.get(String(item.id))
      : document.querySelector(`[data-node-id="${CSS.escape(String(item.id))}"]`);
    const rect = element && graphRectOf(element, canvas);
    if (rect) return rect;
  }
  return boundsOf(item);
}
