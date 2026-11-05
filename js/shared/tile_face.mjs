import { app } from "../../../scripts/app.js";

// Classic paints the node behind the DOM widget. Override only drawing properties
// on this instance so saved colors, titles and the node type remain usable.
const originalDescriptors = new WeakMap();

export function setTileFace(node, root, enabled) {
  root.classList.toggle("ausboss-tile-face", enabled);
  const previous = originalDescriptors.get(node);
  if (enabled === Boolean(previous)) return;
  if (enabled) {
    const properties = {
      title_mode: () => globalThis.LiteGraph?.NO_TITLE ?? 1,
      renderingBgColor: () => "transparent",
      drawBadges: () => skipBadges,
    };
    const descriptors = new Map();
    for (const [key, get] of Object.entries(properties)) {
      const own = Object.getOwnPropertyDescriptor(node, key);
      descriptors.set(key, own);
      Object.defineProperty(node, key, {
        configurable: true,
        get() {
          if (!node.flags?.collapsed) return get();
          if (own) return own.get ? own.get.call(node) : own.value;
          return Reflect.get(Object.getPrototypeOf(node), key, node);
        },
      });
    }
    const listeners = new AbortController();
    installTileDrag(node, root, listeners.signal);
    originalDescriptors.set(node, { descriptors, listeners });
  } else {
    previous.listeners.abort();
    for (const [key, descriptor] of previous.descriptors) {
      if (descriptor) Object.defineProperty(node, key, descriptor);
      else delete node[key];
    }
    originalDescriptors.delete(node);
  }
  node.setDirtyCanvas?.(true, true);
}

function skipBadges() {}

// A normal node moves by its header. Give the tile that gesture while
// keeping a short click on a link or the info button as its usual action.
function installTileDrag(node, root, signal) {
  let press;
  let suppressClick = false;
  const capture = { capture: true, signal };
  root.addEventListener("pointerdown", (event) => {
    suppressClick = false;
    if (!event.isPrimary || event.button !== 0 || node.pinned || app.canvas?.read_only) return;
    if (event.target.closest(".ausboss-callout-editor,.ausboss-callout-tools,.ausboss-note-edit")) return;
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, moving: false };
    const target = event.target.closest("a,button") || root;
    target.setPointerCapture(event.pointerId);
    event.stopPropagation();
  }, capture);
  root.addEventListener("pointermove", (event) => {
    if (event.pointerId !== press?.id) return;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if (!press.moving) {
      if (Math.hypot(dx, dy) < 5) return;
      press.moving = true;
      node.graph?.beforeChange?.();
      if (!node.selected) app.canvas?.selectNode?.(node, event.shiftKey);
      const selected = Array.from(app.canvas?.selectedItems ?? []);
      press.starts = (selected.includes(node) ? selected : [node])
        .filter(item => item.pos && !item.pinned)
        .map(item => ({ item, x: item.pos[0], y: item.pos[1] }));
    }
    const zoom = app.canvas?.ds?.scale || 1;
    for (const start of press.starts) start.item.pos = [start.x + dx / zoom, start.y + dy / zoom];
    node.setDirtyCanvas?.(true, true);
    event.stopPropagation();
  }, capture);
  const finish = (event) => {
    if (event.pointerId !== press?.id) return;
    if (press.moving) {
      node.graph?.afterChange?.();
      suppressClick = true;
    }
    press = null;
  };
  root.addEventListener("pointerup", finish, capture);
  root.addEventListener("lostpointercapture", finish, capture);
  root.addEventListener("click", (event) => {
    if (suppressClick) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClick = false;
    } else if (!event.target.closest("a,button,.ausboss-callout-editor")) {
      app.canvas?.selectNode?.(node, event.shiftKey);
    }
  }, capture);
  root.addEventListener("dragstart", (event) => {
    if (press) event.preventDefault();
  }, { signal });
  root.addEventListener("contextmenu", (event) => {
    if (event.target.closest("textarea,input")) return;
    event.preventDefault();
    event.stopPropagation();
    app.canvas?.processContextMenu?.(node, event);
  }, { signal });
}

// Nodes 2.0 draws its own DOM frame. Keep native move, selection and resize
// targets on the node, and show only the widget inside that frame.
export const TILE_FACE_CSS = `
.ausboss-tile-face :is(.ausboss-callout-card,.ausboss-note-head){pointer-events:auto;touch-action:none;cursor:grab;}
.lg-node:has(.ausboss-tile-face){filter:none;}
.lg-node:has(.ausboss-tile-face) [data-testid="node-inner-wrapper"],
.lg-node:has(.ausboss-tile-face) .bg-component-node-background{background:transparent!important;box-shadow:none;}
.lg-node:has(.ausboss-tile-face) .lg-node-header,
.lg-node:has(.ausboss-tile-face) .bg-component-node-background>div:last-child:not(.lg-node-widgets){display:none;}
`;
