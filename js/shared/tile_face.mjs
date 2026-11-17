import { app } from "../../../scripts/app.js";

// Classic paints the node behind the DOM widget. Override only drawing properties
// on this instance so saved colors, titles and the node type remain usable.
const originalDescriptors = new WeakMap();

export function setTileFace(node, root, enabled, onEdit) {
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
    // Snap into line and Line up use the card people see, not the
    // transparent node around it (js/shared/outline.mjs).
    node.ausbossOutlineElement = root.querySelector(".ausboss-callout-card,.ausboss-note-card") || root;
    installTileDrag(node, root, listeners.signal, onEdit);
    installTileResize(node, root, listeners.signal);
    originalDescriptors.set(node, { descriptors, listeners });
  } else {
    previous.listeners.abort();
    delete node.ausbossOutlineElement;
    for (const [key, descriptor] of previous.descriptors) {
      if (descriptor) Object.defineProperty(node, key, descriptor);
      else delete node[key];
    }
    originalDescriptors.delete(node);
  }
  node.setDirtyCanvas?.(true, true);
}

function skipBadges() {}

// Sent from a tile's own drag after each move: js/snap_lines/ lines it up.
export const TILE_MOVE = "ausboss-tile-move";

// A normal node moves by its header. Give the tile that gesture while
// keeping a short click on a link or the info button as its usual action.
function installTileDrag(node, root, signal, onEdit) {
  let press;
  let lastClick;
  let suppressClick = false;
  const capture = { capture: true, signal };
  root.addEventListener("pointerdown", (event) => {
    suppressClick = false;
    if (!event.isPrimary || event.button !== 0 || node.pinned || app.canvas?.read_only) return;
    if (event.target.closest(".ausboss-callout-editor,.ausboss-callout-tools,.ausboss-note-edit,.ausboss-tile-resize")) return;
    if (onEdit && !event.target.closest("a,button") && lastClick
      && event.timeStamp - lastClick.time < 500
      && Math.hypot(event.clientX - lastClick.x, event.clientY - lastClick.y) < 8) {
      lastClick = null;
      event.preventDefault();
      event.stopPropagation();
      onEdit();
      return;
    }
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
    // The move stops here (Nodes 2.0 would pan the canvas with it), so tell
    // Snap into line separately, after the tile has been placed.
    root.dispatchEvent(new CustomEvent(TILE_MOVE, { bubbles: true, detail: event }));
  }, capture);
  const finish = (event) => {
    if (event.pointerId !== press?.id) return;
    if (press.moving) {
      node.graph?.afterChange?.();
      suppressClick = true;
      lastClick = null;
    } else {
      lastClick = { time: event.timeStamp, x: event.clientX, y: event.clientY };
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

// Put the resize target on the visible corner. The native node corner lies
// outside a frameless tile and is almost impossible to find without a frame.
function installTileResize(node, root, signal) {
  const face = root.querySelector(".ausboss-callout-card,.ausboss-note-card") || root;
  const grip = document.createElement("button");
  grip.type = "button";
  grip.className = "ausboss-tile-resize";
  grip.setAttribute("aria-label", "Resize tile");
  grip.title = "Drag to resize. Arrow keys resize; Shift makes smaller changes.";
  face.append(grip);
  let drag;
  const minimum = () => {
    // Use the same floor as the native corner, including widget margins.
    // Older saved tiles can be smaller: touching their grip must not jump.
    const floor = node.computeSize?.() ?? [200, 72];
    return floor.map((value, axis) => Math.min(value, node.size[axis]));
  };
  const resize = (width, height, floor) => {
    node.setSize?.([Math.max(floor[0], width), Math.max(floor[1], height)]);
    node.setDirtyCanvas?.(true, true);
  };
  grip.addEventListener("pointerdown", event => {
    event.stopPropagation();
    if (event.button !== 0 || node.pinned || app.canvas?.read_only) return;
    event.preventDefault();
    node.graph?.beforeChange?.();
    app.canvas?.selectNode?.(node);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY,
      size: [...node.size], floor: minimum(), zoom: app.canvas?.ds?.scale || 1 };
    grip.setPointerCapture(event.pointerId);
  });
  grip.addEventListener("pointermove", event => {
    if (event.pointerId !== drag?.id) return;
    event.stopPropagation();
    resize(drag.size[0] + (event.clientX - drag.x) / drag.zoom,
      drag.size[1] + (event.clientY - drag.y) / drag.zoom, drag.floor);
  });
  const finish = event => {
    if (event.pointerId !== drag?.id) return;
    drag = null;
    node.graph?.afterChange?.();
  };
  grip.addEventListener("pointerup", finish);
  grip.addEventListener("pointercancel", finish);
  grip.addEventListener("lostpointercapture", finish);
  grip.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); });
  grip.addEventListener("keydown", event => {
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault();
    event.stopPropagation();
    if (node.pinned || app.canvas?.read_only) return;
    const step = event.shiftKey ? 1 : 10;
    node.graph?.beforeChange?.();
    resize(node.size[0] + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
      node.size[1] + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0), minimum());
    node.graph?.afterChange?.();
  });
  signal.addEventListener("abort", () => { if (drag) node.graph?.afterChange?.(); grip.remove(); }, { once: true });
}

// Nodes 2.0 always adds a title's height to --node-height, even when a tile
// hides the title. Remove that unused reservation: otherwise an 88px saved
// tile gains a 30px tail and overlaps the next tile. Vue also positions the
// host at saved y minus the title height. Restore that headerless origin
// with an independent translation so faces cannot cover group headings.
// Keep the saved size and
// the native selection/resize targets, rather than changing the graph.
// Its in-body pack badges also consume 20px that Classic paints outside the
// panel. Decorative tiles and callouts use that room for their own face.
// The node-body test id and direct mt-auto badge wrapper are from the pinned
// frontend's LGraphNode.vue/NodeBadges.vue; no other node body is affected.
export const TILE_FACE_CSS = `
.ausboss-tile-face :is(.ausboss-callout-card,.ausboss-note-head){pointer-events:auto;touch-action:none;cursor:grab;}
.ausboss-tile-face{user-select:none;}
.ausboss-tile-resize{position:absolute;right:1px;bottom:1px;z-index:4;width:22px;height:22px;padding:0;border:0;border-radius:3px;background:transparent;color:#9fb9b6;opacity:.65;cursor:nwse-resize;touch-action:none;pointer-events:auto;}
.ausboss-tile-resize::after{content:"";position:absolute;right:4px;bottom:4px;width:9px;height:9px;background:repeating-linear-gradient(135deg,transparent 0 3px,currentColor 3px 4px,transparent 4px 6px);clip-path:polygon(100% 0,100% 100%,0 100%);}
.ausboss-tile-resize:hover,.ausboss-tile-resize:focus-visible{opacity:1;background:#00b4aa33;outline:1px solid #00b4aa;outline-offset:-1px;}
.lg-node:has(.ausboss-tile-face){filter:none;}
.lg-node:has(.ausboss-tile-face):not([data-collapsed]){min-height:calc(var(--node-height) - ${globalThis.LiteGraph?.NODE_TITLE_HEIGHT ?? 30}px);translate:0 ${globalThis.LiteGraph?.NODE_TITLE_HEIGHT ?? 30}px;}
.lg-node:has(.ausboss-tile-face,.ausboss-callout) [data-testid^="node-body-"]>.mt-auto{display:none;}
.lg-node:has(.ausboss-tile-face) [data-testid="node-inner-wrapper"],
.lg-node:has(.ausboss-tile-face) .bg-component-node-background{background:transparent!important;box-shadow:none;}
.lg-node:has(.ausboss-tile-face) .lg-node-header{display:none;}
`;
