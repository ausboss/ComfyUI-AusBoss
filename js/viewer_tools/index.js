// ComfyUI's 3D viewers, laid out like a 3D app's viewport: the axis gizmo
// moves from the bottom-left to the top-right corner (click an axis to look
// along it, as before), and a small column of tools sits under it:
//   - zoom: drag up or down on the magnifier to move the camera in or out,
//   - pan: drag on the hand to slide the view,
//   - drag on the gizmo to orbit; a click still picks an axis view,
//   - grid: show or hide the floor grid (it presses the viewer's own
//     "Show grid", so the menu bar and the saved setting follow).
// Nothing is saved by this file and no widget changes; it only moves the
// camera the viewer already owns.
import { app } from "../../../scripts/app.js";
import { BRAND } from "../shared/index.mjs";
import { menuBarBottom } from "../shared/viewer3d_layout.mjs";

const CSS_ID = "ausboss-viewer-tools-css";
const SCAN_MS = 800;
// The core viewer's gizmo box: a 128 px square pinned to the bottom-left.
// Moved, it is drawn at three quarters of that size and tucked into the
// top-right corner: the axes end EDGE px from the view's right edge and
// BELOW px under the menu bar (or the open 360 strip). The square has empty
// room around the axes (PAD px at the drawn size), so the box hangs a little
// past the edge. The click area is scaled with CSS the same way, which is
// what the core's axis click reads (the box's on-screen rectangle).
const GIZMO_SCALE = 0.75;
const GIZMO_SIZE = 128 * GIZMO_SCALE;
const GIZMO_PAD = 18;
const GIZMO_EDGE = 8;
const GIZMO_BELOW = 6;
// The tools column, centred under the axes.
const TOOL_SIZE = 28;
const TOOLS_RIGHT = GIZMO_EDGE + (GIZMO_SIZE / 2 - GIZMO_PAD) - TOOL_SIZE / 2;
const TOOLS_BELOW = GIZMO_BELOW + GIZMO_SIZE - 2 * GIZMO_PAD + 10;
const isGizmoBox = (el) => el.style.position === "absolute" && el.style.width === "128px" && el.style.height === "128px"
  && el.style.bottom === "0px" && el.style.left === "0px";

const ICONS = {
  zoom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5M10.5 8v5M8 10.5h5"/></svg>',
  pan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12.5V6a1.4 1.4 0 0 1 2.8 0v5.5M10.8 11V4.6a1.4 1.4 0 0 1 2.8 0V11M13.6 11V5.6a1.4 1.4 0 0 1 2.8 0V12M16.4 11.5V8.4a1.4 1.4 0 0 1 2.8 0v5.8c0 3.6-2.6 6.3-6.2 6.3h-.8c-2 0-3.4-.8-4.6-2.3l-3-4a1.45 1.45 0 0 1 2.2-1.9L8 13.6"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 9.5L21 9.5M2 14.5h20M8.5 4L5.5 20M15.5 4l3 16M4.5 5h15l2.5 14H2z"/></svg>',
};

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-vtools{position:absolute;top:124px;right:${TOOLS_RIGHT}px;display:flex;flex-direction:column;gap:6px;z-index:5}
.ausboss-vtools button{width:${TOOL_SIZE}px;height:${TOOL_SIZE}px;padding:6px;box-sizing:border-box;border-radius:50%;border:1px solid rgba(255,255,255,.08);background:rgba(20,22,22,.72);color:#c8cccc;cursor:pointer;display:grid;place-items:center;touch-action:none}
.ausboss-vtools button svg{width:100%;height:100%;display:block}
.ausboss-vtools button:hover{color:${BRAND};border-color:${BRAND}}
.ausboss-vtools button.drag{cursor:grab}
.ausboss-vtools button.drag:active{cursor:grabbing;color:${BRAND};border-color:${BRAND}}
.ausboss-vtools button.on{color:#7fe9e2;background:rgba(0,180,170,.22);border-color:${BRAND}}
`;
  document.head.append(style);
}

// The axis gizmo draws itself into the view's bottom-left corner. For a box
// this file has moved, draw it in the top-right corner instead; everything
// else is the core's own render.
function patchGizmoRender() {
  const Manager = window.comfyAPI?.ViewHelperManager?.ViewHelperManager;
  if (!Manager) return false;
  if (Manager.prototype.__ausbossTopRight) return true;
  const render = Manager.prototype.render;
  Manager.prototype.render = function (renderer, size) {
    const box = this.viewHelperContainer;
    if (box && typeof box === "object") box.__ausbossManager = this;
    const helper = this.viewHelper;
    if (!box?.dataset?.ausbossGizmo || !helper?.isViewHelper || !this.savedViewport || !this.helperCamera) {
      return render.call(this, renderer, size);
    }
    // Older frontends hand over the three.js renderer itself; newer ones
    // (1.58+) a view that holds it as `.renderer` and owns the viewport.
    const gl = typeof renderer?.clearDepth === "function" ? renderer : renderer?.renderer;
    if (typeof gl?.clearDepth !== "function" || typeof renderer.getViewport !== "function") {
      return render.call(this, renderer, size);
    }
    helper.quaternion.copy(this.getActiveCamera().quaternion).invert();
    helper.updateMatrixWorld();
    gl.clearDepth();
    const { x, y, z, w } = renderer.getViewport(this.savedViewport) ?? this.savedViewport;
    // Where the box is drawn on screen, in the canvas's own pixels (the
    // viewport counts up from the bottom).
    const width = gl.domElement?.clientWidth || x + z;
    const height = gl.domElement?.clientHeight || y + w;
    const top = Number(box.dataset.ausbossTop) || 0;
    const right = Number(box.dataset.ausbossRight) || 0;
    renderer.setViewport(width - right - GIZMO_SIZE, height - top - GIZMO_SIZE, GIZMO_SIZE, GIZMO_SIZE);
    gl.render(helper, this.helperCamera);
    renderer.setViewport(x, y, z, w);
  };
  Manager.prototype.__ausbossTopRight = true;
  return true;
}

function placeGizmo(box) {
  // Under the menu bar as it is drawn; the 360 strip (js/viewer_pano/) opens
  // under the bar, and the gizmo and the tools step down under it.
  const bar = menuBarBottom(box.parentElement);
  if (bar == null) return;
  const base = bar + (box.__ausbossStripHeight?.() ?? 0);
  const top = base + GIZMO_BELOW - GIZMO_PAD;
  const right = GIZMO_EDGE - GIZMO_PAD;
  if (String(top) === box.dataset.ausbossTop && String(right) === box.dataset.ausbossRight) return;
  box.dataset.ausbossTop = String(top);
  box.dataset.ausbossRight = String(right);
  box.style.top = `${top}px`;
  box.style.right = `${right}px`;
  const tools = box.__ausbossTools?.tools;
  if (tools) tools.style.top = `${base + TOOLS_BELOW}px`;
  box.__ausbossLayout = { base };
}

// The viewer's own "Show grid" button, found by its icon (its text is translated).
const gridButton = (root) => root?.querySelector?.('i[class*="lucide--grid-3x3"]')?.closest("button") ?? null;
function viewerRoot(box) {
  let el = box.parentElement;
  for (let i = 0; el && i < 12; i += 1, el = el.parentElement) if (gridButton(el)) return el;
  return null;
}

function dragButton(kind, title, onDrag) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "drag";
  button.title = title;
  button.innerHTML = ICONS[kind];
  let last = null;
  button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    last = [event.clientX, event.clientY];
  });
  button.addEventListener("pointermove", (event) => {
    if (!last) return;
    const dx = event.clientX - last[0], dy = event.clientY - last[1];
    last = [event.clientX, event.clientY];
    if (dx || dy) onDrag(dx, dy);
  });
  const end = (event) => { last = null; try { button.releasePointerCapture(event.pointerId); } catch { /* already released */ } };
  button.addEventListener("pointerup", end);
  button.addEventListener("pointercancel", end);
  return button;
}

function addTools(box) {
  const controls = () => box.__ausbossManager?.getControls?.();
  const tools = document.createElement("div");
  tools.className = "ausboss-vtools";
  // Keep the graph from starting a node drag or a box select under the tools.
  for (const type of ["pointerdown", "mousedown"]) tools.addEventListener(type, (event) => event.stopPropagation());

  const zoom = dragButton("zoom", "Zoom: drag up to move in, down to move out.", (_dx, dy) => {
    const c = controls();
    if (!c?._dollyIn) return;
    const scale = Math.pow(0.985, Math.abs(dy));
    if (dy < 0) c._dollyIn(scale); else c._dollyOut(scale);
    c.update();
  });
  const pan = dragButton("pan", "Pan: drag to slide the view.", (dx, dy) => {
    const c = controls();
    if (!c?._pan) return;
    c._pan(dx, dy);
    c.update();
  });
  const grid = document.createElement("button");
  grid.type = "button";
  grid.title = "Show or hide the floor grid.";
  grid.innerHTML = ICONS.grid;
  grid.addEventListener("pointerdown", (event) => event.stopPropagation());
  grid.addEventListener("click", (event) => {
    event.stopPropagation();
    gridButton(viewerRoot(box))?.click();
  });
  // Follow the core button's pressed state as soon as it changes.
  let watched = null;
  const watch = new MutationObserver(() => syncGrid());
  const syncGrid = () => {
    const core = gridButton(viewerRoot(box));
    if (core !== watched) {
      watch.disconnect();
      watched = core;
      if (core) watch.observe(core, { attributes: true, attributeFilter: ["aria-pressed"] });
    }
    grid.style.display = core ? "" : "none";
    grid.classList.toggle("on", core?.getAttribute("aria-pressed") === "true");
  };
  tools.append(zoom, pan, grid);
  box.parentElement.append(tools);
  box.__ausbossTools = { tools, syncGrid, place: () => placeGizmo(box) };
  syncGrid();
}

// Drag on the gizmo to orbit, as in a 3D app; a click without a drag still
// picks an axis view.
function addGizmoOrbit(box) {
  let drag = null;
  box.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, moved: false, id: event.pointerId };
  });
  box.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) { drag.moved = true; try { box.setPointerCapture(drag.id); } catch { /* not ours */ } }
    drag.x = event.clientX;
    drag.y = event.clientY;
    const c = box.__ausbossManager?.getControls?.();
    if (!c?._rotateLeft) return;
    const size = c.domElement?.clientHeight || 400;
    c._rotateLeft((2 * Math.PI * dx) / size);
    c._rotateUp((2 * Math.PI * dy) / size);
    c.update();
    event.stopPropagation();
  });
  const end = (event) => {
    if (drag?.moved) {
      // Keep the core's click-to-axis from firing after a drag.
      event.stopImmediatePropagation();
      try { box.releasePointerCapture(drag.id); } catch { /* released */ }
    }
    drag = null;
  };
  box.addEventListener("pointerup", end, true);
  box.addEventListener("pointercancel", end, true);
  box.addEventListener("click", (event) => { if (box.__ausbossDragged) event.stopImmediatePropagation(); }, true);
}

function scan() {
  if (!patchGizmoRender()) return;
  for (const box of document.querySelectorAll("div[style*='128px']")) {
    if (box.dataset.ausbossGizmo) { placeGizmo(box); box.__ausbossTools?.syncGrid(); continue; }
    if (!isGizmoBox(box) || !box.parentElement) continue;
    box.dataset.ausbossGizmo = "top-right";
    box.style.bottom = "auto";
    box.style.left = "auto";
    box.style.top = "0px";
    box.style.right = "0px";
    box.style.transformOrigin = "top right";
    box.style.transform = `scale(${GIZMO_SCALE})`;
    // Under the 360 strip and the tools where the empty room overlaps them.
    box.style.zIndex = "4";
    addTools(box);
    addGizmoOrbit(box);
    placeGizmo(box);
  }
}

app.registerExtension({
  name: "ausboss.viewer_tools",
  setup() {
    ensureCss();
    setInterval(scan, SCAN_MS);
  },
});
