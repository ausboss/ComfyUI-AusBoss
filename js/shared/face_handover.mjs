// After undo or redo in Nodes 2.0, hand each rebuilt node its own face.
//
// Undo and redo rebuild every node in place: the frontend removes the node
// objects and makes new ones, with the same ids, from the saved state. The
// classic renderer mounts the new nodes' panels afresh. Nodes 2.0 (frontend
// 1.53) usually keeps each node's face, and the slot on that face that holds
// a DOM panel mounts an element only when the slot is first made. So after
// Ctrl+Z the face goes on showing the removed node's panel and the live
// node's panel never reaches the screen: an edit on that face changes a node
// that is gone, and the queued prompt still carries the live node's values.
//
// The hand-over: when one of our nodes is removed, the panels it has on
// screen are remembered by graph, node id and widget name. When a node is
// then configured with that id, each of its panels that is off screen takes
// the place of the remembered one, if that one still sits on this node's
// face. That is the element the frontend would have mounted itself. Nothing
// moves in the classic renderer (its panels never sit on a node face), for a
// new or pasted node, or on a frontend that mounted the new panel already.
//
// No DOM or ComfyUI imports, so node:test drives it with stand-in elements:
// an element is only asked for isConnected, replaceWith() and closest().

// Nodes 2.0 marks each node's face with the node's id.
const FACE = "[data-node-id]";

// The id of the Nodes 2.0 face an element sits on, or null when it sits on none.
export function faceIdOf(element) {
  const id = element?.closest?.(FACE)?.getAttribute?.("data-node-id");
  return id === null || id === undefined ? null : String(id);
}

function panelsOf(node) {
  return (node?.widgets ?? []).filter((widget) => widget?.name && typeof widget.element?.replaceWith === "function");
}

// Node ids repeat across a root graph and its subgraphs; widget names repeat
// across nodes. All three together name one panel.
function keyOf(node, widget) {
  return `${node.graph?.id ?? ""}\u0000${node.id}\u0000${widget.name}`;
}

// `defer` runs the clean-up after the rebuild: the frontend removes and
// rebuilds a whole graph in one synchronous configure, and the hand-over runs
// in a microtask right after it, so a timer is late enough.
export function createFaceHandover({ defer = (fn) => setTimeout(fn, 0) } = {}) {
  const left = new Map();
  let cleaning = false;
  const cleanUp = () => {
    for (const [key, elements] of left) {
      for (const element of elements) if (!element.isConnected) elements.delete(element);
      if (elements.size === 0) left.delete(key);
    }
  };
  const cleanUpSoon = () => {
    if (cleaning) return;
    cleaning = true;
    defer(() => {
      cleaning = false;
      cleanUp();
    });
  };

  return {
    // A node is going away: remember the panels it has on screen.
    remember(node) {
      if (!node) return;
      for (const widget of panelsOf(node)) {
        if (!widget.element.isConnected) continue;
        const key = keyOf(node, widget);
        if (!left.has(key)) left.set(key, new Set());
        left.get(key).add(widget.element);
      }
      cleanUpSoon();
    },
    // A node was configured: put each of its off-screen panels where the
    // frontend left the removed node's. Returns the names of the widgets
    // whose panels moved.
    handOver(node) {
      const moved = [];
      if (!node) return moved;
      const id = String(node.id);
      for (const widget of panelsOf(node)) {
        const live = widget.element;
        if (live.isConnected) continue;
        const key = keyOf(node, widget);
        const elements = left.get(key);
        if (!elements) continue;
        const stale = [...elements].find((element) => element !== live && element.isConnected && faceIdOf(element) === id);
        if (!stale) continue;
        elements.delete(stale);
        if (elements.size === 0) left.delete(key);
        stale.replaceWith(live);
        moved.push(widget.name);
      }
      return moved;
    },
    get size() {
      let count = 0;
      for (const elements of left.values()) count += elements.size;
      return count;
    },
  };
}
