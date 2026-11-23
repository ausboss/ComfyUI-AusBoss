// Blender's keys in ComfyUI's 3D viewers. With the mouse over a viewer:
//   G move, R rotate, S scale: the model follows the mouse from where it is,
//     no click needed. X / Y / Z lock to an axis (press again for the
//     model's own axis, a third time to unlock); Shift+X / Y / Z lock to the
//     plane without that axis. Middle mouse picks the lock from the mouse:
//     hold it and slide along an axis, or click it and move (Shift: the
//     plane); click again to unlock; C unlocks. Shift held: ten times slower. Ctrl held: snap
//     (0.1, 5 degrees; with Shift 0.01, 1 degree). Type a number for an exact
//     amount (minus flips it). Click, Enter or Space keeps it; Esc or a
//     right-click puts it back. R twice: trackball.
//   Alt+G / Alt+R / Alt+S put the place, the turn or the size back.
//   Ctrl+Z / Ctrl+Shift+Z undo and redo these, while the viewer has some.
//   Numpad (or the top-row digits): 1 front, 3 right, 7 top (Ctrl: the
//     other side), 2 4 6 8 orbit by 15 degrees, 9 the other side; Home or
//     numpad . frames the model. N opens and closes the 360 strip.
//   Middle mouse orbits, Shift+middle pans, as in Blender.
// The model is the one the viewer saves as model_3d_info, so the run gets
// what the viewer shows. The maths is in js/shared/blender_transform.mjs.
import { app } from "../../../scripts/app.js";
import {
  AXES, AXIS_NAMES, PICK_PX, add, along, autoConstraint, closestOnAxis, constraintLabel, dot, nearestLocalAxis,
  nearestScreenAxis, nextConstraint, parseTyped, pickVector, rayPlane, readout, scaleFactors, screenTurn,
  snapStep, snapTo, sub, times, typeKey, unit,
} from "../shared/blender_transform.mjs";
import { FONT_UI, RADIUS_CONTROL, RADIUS_XS, THEME as T } from "../shared/theme.mjs";
import { bottomButtons } from "../shared/viewer3d_layout.mjs";

const CSS_ID = "ausboss-viewer-keys-css";
const DEG = Math.PI / 180;
// Blender's axis colours, so a lock reads the same as there.
const AXIS_COLOR = { x: "#ff3352", y: "#8bdc00", z: "#2890ff" };
const ORBIT_STEP = 15 * DEG;
const TRACKBALL = 0.01; // radians per pixel

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-vkeys-head{position:absolute;left:6px;z-index:7;max-width:calc(100% - 120px);box-sizing:border-box;height:20px;padding:0 8px;border-radius:${RADIUS_XS}px;background:rgba(30,32,34,.9);font:400 11px/20px ${FONT_UI};color:${T.ink};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums;pointer-events:none}
.ausboss-vkeys-head .lock{color:${T.inkSoft}}
.ausboss-vkeys-head .lock.x{color:#ff6b80}.ausboss-vkeys-head .lock.y{color:#a6e22e}.ausboss-vkeys-head .lock.z{color:#5aa9ff}
.ausboss-vkeys-head .pick{color:${T.brandInk}}
.ausboss-vkeys-head .typed{color:${T.onBrand};background:${T.brand};border-radius:${RADIUS_XS}px;padding:0 4px}
.ausboss-vkeys-bar{position:absolute;left:6px;z-index:7;max-width:calc(100% - 132px);box-sizing:border-box;height:20px;display:flex;align-items:center;gap:9px;padding:0 7px;border-radius:${RADIUS_XS}px;background:rgba(30,32,34,.88);font:400 10px/1 ${FONT_UI};color:${T.inkSoft};white-space:nowrap;overflow:hidden;pointer-events:none}
.ausboss-vkeys-bar span{display:inline-flex;align-items:center;gap:3px}
.ausboss-vkeys-bar kbd{font:600 9px/1 ${FONT_UI};color:${T.ink};background:rgba(255,255,255,.12);border-radius:3px;padding:2px 4px}
.ausboss-vkeys-lines{position:absolute;left:0;top:0;width:100%;height:100%;z-index:5;pointer-events:none}
.ausboss-vkeys-sheet{position:absolute;z-index:7;box-sizing:border-box;width:236px;padding:8px 10px;border-radius:${RADIUS_CONTROL}px;background:rgba(16,18,20,.94);box-shadow:0 2px 10px rgba(0,0,0,.5);font:400 11px/1.3 ${FONT_UI};color:${T.inkSoft};display:grid;grid-template-columns:auto 1fr;gap:3px 10px}
.ausboss-vkeys-sheet kbd{font:600 10px/1 ${FONT_UI};color:${T.ink};background:${T.fill};border-radius:${RADIUS_XS}px;padding:3px 5px;white-space:nowrap;justify-self:start;align-self:start}
.ausboss-vkeys-sheet .h{grid-column:1/-1;color:${T.faint};font-size:10px;margin-top:4px}
.ausboss-vkeys-sheet .h:first-child{margin-top:0}
`;
  document.head.append(style);
}

// ------------------------------------------------------------ the viewer

// Each viewer the pack has taken over has a gizmo box (js/viewer_tools)
// that knows its camera, and a 360 strip (js/viewer_pano) that knows its
// scene. The core's gizmo manager knows the model; it registers itself on
// its scene here as soon as it is used.
function patchGizmoManager() {
  const Gizmo = window.comfyAPI?.GizmoManager?.GizmoManager;
  if (!Gizmo || Gizmo.prototype.__ausbossKeys) return;
  for (const name of ["setupForModel", "setEnabled", "updateCamera", "getModelInfo", "getTransform", "applyModelTransform"]) {
    const original = Gizmo.prototype[name];
    if (typeof original !== "function") continue;
    Gizmo.prototype[name] = function (...args) {
      if (this.scene) this.scene.__ausbossGizmo = this;
      return original.apply(this, args);
    };
  }
  Gizmo.prototype.__ausbossKeys = true;
}

function modelIn(sceneManager) {
  const scene = sceneManager?.scene;
  const gizmo = scene?.__ausbossGizmo;
  if (gizmo?.targetObject?.parent) return gizmo.targetObject;
  return scene?.children?.find((child) => {
    if (child.isLight || child === sceneManager.gridHelper || !child.visible || child.name === "GizmoTransformControls") return false;
    let found = false;
    child.traverse?.((part) => { if (!found && part.isMesh && part.material?.isMeshStandardMaterial) found = true; });
    return found;
  }) ?? null;
}

function contextOf(box) {
  const helper = box?.__ausbossManager;
  const sceneManager = box?.__ausbossScene;
  const camera = helper?.getActiveCamera?.();
  const host = box?.parentElement;
  const canvas = host?.querySelector("canvas");
  if (!camera || !sceneManager || !canvas) return null;
  return { box, host, helper, sceneManager, camera, controls: helper.getControls?.() ?? null, canvas, model: modelIn(sceneManager) };
}

function viewerAt(x, y) {
  const under = document.elementFromPoint(x, y);
  if (!under) return null;
  for (const box of document.querySelectorAll("div[data-ausboss-gizmo]")) {
    const host = box.parentElement;
    if (!host || !box.__ausbossScene) continue;
    // The view and everything on it: the menu bar, the strip, the tools.
    if (host.parentElement?.parentElement?.contains(under) || host.contains(under)) {
      const rect = host.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return box;
    }
  }
  return null;
}

function redraw(ctx) {
  try { ctx.sceneManager.__ausbossViewport?.forceRender?.(); } catch { /* the next frame shows it */ }
}

// The part of the canvas the camera's picture fills: the shot's frame when
// the viewer keeps the shot's shape (bars at the sides or top), else all of it.
function frameOf(ctx) {
  const rect = ctx.canvas.getBoundingClientRect();
  const width = ctx.canvas.clientWidth || rect.width;
  const height = ctx.canvas.clientHeight || rect.height;
  const k = width ? rect.width / width : 1;
  let x = 0, y = 0, w = width, h = height;
  const viewport = ctx.sceneManager.__ausbossViewport;
  const letterbox = window.comfyAPI?.load3dViewport?.computeLetterboxedViewport;
  try {
    if (viewport && letterbox && viewport.shouldMaintainAspectRatio?.() && viewport.targetAspectRatio > 0) {
      const box = letterbox({ width, height }, viewport.targetAspectRatio);
      if (box?.width > 0 && box?.height > 0) { x = box.offsetX; w = box.width; h = box.height; y = height - box.offsetY - box.height; }
    }
  } catch { /* the whole canvas */ }
  return { left: rect.left + x * k, top: rect.top + y * k, width: w * k, height: h * k };
}
const toNdc = (frame, p) => [((p[0] - frame.left) / frame.width) * 2 - 1, 1 - ((p[1] - frame.top) / frame.height) * 2];
const toScreen = (frame, n) => [frame.left + ((n[0] + 1) / 2) * frame.width, frame.top + ((1 - n[1]) / 2) * frame.height];

function V(ctx, x = 0, y = 0, z = 0) { return new ctx.camera.position.constructor(x, y, z); }

function rayAt(ctx, frame, point) {
  const camera = ctx.camera;
  camera.updateMatrixWorld();
  const [nx, ny] = toNdc(frame, point);
  if (camera.isOrthographicCamera) {
    const origin = V(ctx, nx, ny, -1).unproject(camera);
    return { o: origin.toArray(), d: V(ctx, 0, 0, -1).applyQuaternion(camera.quaternion).toArray() };
  }
  const far = V(ctx, nx, ny, 0.5).unproject(camera);
  return { o: camera.position.toArray(), d: unit(sub(far.toArray(), camera.position.toArray())) };
}
function screenOf(ctx, frame, world) {
  const p = V(ctx, ...world).project(ctx.camera);
  return { at: toScreen(frame, [p.x, p.y]), front: p.z < 1 };
}
const viewDir = (ctx) => V(ctx, 0, 0, -1).applyQuaternion(ctx.camera.quaternion).toArray();

// The middle of the model's box, in the world.
function centreOf(model) {
  model.updateMatrixWorld(true);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const v = new model.position.constructor();
  model.traverse((part) => {
    if (!part.isMesh || !part.visible || !part.geometry) return;
    if (!part.geometry.boundingBox) part.geometry.computeBoundingBox?.();
    const b = part.geometry.boundingBox;
    if (!b) return;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      v.set(x, y, z).applyMatrix4(part.matrixWorld);
      lo[0] = Math.min(lo[0], v.x); lo[1] = Math.min(lo[1], v.y); lo[2] = Math.min(lo[2], v.z);
      hi[0] = Math.max(hi[0], v.x); hi[1] = Math.max(hi[1], v.y); hi[2] = Math.max(hi[2], v.z);
    }
  });
  if (!Number.isFinite(lo[0])) return { centre: model.position.toArray(), radius: 1 };
  return { centre: times(add(lo, hi), 0.5), radius: Math.max(1e-3, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2) };
}

// The model's own axes, in the world.
const localAxes = (ctx, quaternion) => AXIS_NAMES.map((name) => V(ctx, ...AXES[name]).applyQuaternion(quaternion).toArray());

// ---------------------------------------------------------------- history

const snapshot = (model) => ({ p: model.position.toArray(), q: model.quaternion.toArray(), s: model.scale.toArray() });
function restore(model, shot) {
  model.position.fromArray(shot.p);
  model.quaternion.fromArray(shot.q);
  model.scale.fromArray(shot.s);
  model.updateMatrixWorld(true);
}
const histories = new WeakMap();
const historyOf = (model) => {
  if (!histories.has(model)) histories.set(model, { undo: [], redo: [], first: snapshot(model) });
  return histories.get(model);
};
function remember(model, before) {
  const history = historyOf(model);
  history.undo.push(before);
  if (history.undo.length > 64) history.undo.shift();
  history.redo.length = 0;
}

// The core saves the model's place through its gizmo; tell it, and let the
// Model tab show the new turn.
function settled(ctx) {
  try { ctx.sceneManager.scene?.__ausbossGizmo?.onTransformChange?.(); } catch { /* saved with the shot anyway */ }
  ctx.box.__ausbossPano?.refresh?.();
  redraw(ctx);
}

// ------------------------------------------------------------ G / R / S

let pointer = null;
let session = null;
let swallowUntil = 0;

function begin(mode, box, at) {
  const ctx = contextOf(box);
  if (!ctx?.model) return false;
  const model = ctx.model;
  historyOf(model);
  const frame = frameOf(ctx);
  const { centre } = centreOf(model);
  const start = snapshot(model);
  // From the model's origin to its middle, in the model's own turned frame
  // (before any new size), so rotating or scaling keeps the middle in place.
  const q0 = new model.quaternion.constructor().fromArray(start.q);
  const fromPivot = V(ctx, ...sub(centre, start.p)).applyQuaternion(q0.clone().invert()).toArray();
  session = {
    mode, ctx, frame, start, centre, fromPivot, origin: [...at], mouse: [...at], real: [...at],
    constraint: null, typed: "", trackball: false, turn: 0, precise: false, snap: false,
    centreScreen: screenOf(ctx, frame, centre).at,
  };
  session.controlsWere = ctx.controls?.enabled;
  if (ctx.controls) ctx.controls.enabled = false;
  ctx.host.style.cursor = mode === "grab" ? "move" : "crosshair";
  session.head = document.createElement("div");
  session.head.className = "ausboss-vkeys-head";
  session.lines = document.createElement("canvas");
  session.lines.className = "ausboss-vkeys-lines";
  session.bar = document.createElement("div");
  session.bar.className = "ausboss-vkeys-bar";
  ctx.host.append(session.lines, session.head, session.bar);
  update();
  return true;
}

function switchMode(mode) {
  const s = session;
  if (mode === s.mode) {
    if (mode === "rotate") { s.trackball = !s.trackball; s.typed = ""; update(); }
    return;
  }
  // Blender starts the new tool from where the model began.
  restore(s.ctx.model, s.start);
  s.mode = mode;
  s.trackball = false;
  s.typed = "";
  s.turn = 0;
  s.origin = [...s.mouse];
  s.ctx.host.style.cursor = mode === "grab" ? "move" : "crosshair";
  update();
}

function finish(keep) {
  const s = session;
  if (!s) return;
  session = null;
  // A kept move can be undone from here.
  holdGraphUndo = keep || hasHistory(s.ctx.box);
  const { ctx } = s;
  if (keep) remember(ctx.model, s.start);
  else restore(ctx.model, s.start);
  if (ctx.controls) ctx.controls.enabled = s.controlsWere ?? true;
  ctx.host.style.cursor = "";
  s.head.remove();
  s.lines.remove();
  s.bar.remove();
  if (keep) settled(ctx); else { ctx.box.__ausbossPano?.refresh?.(); redraw(ctx); }
}

function axisOf(s, constraint) {
  if (!constraint) return null;
  const base = AXES[constraint.axis];
  if (constraint.space !== "local") return [...base];
  const q = new s.ctx.model.quaternion.constructor().fromArray(s.start.q);
  return unit(V(s.ctx, ...base).applyQuaternion(q).toArray());
}

// ------------------------------------------------------------ middle-mouse lock
// Blender's automatic lock: during G, R or S the middle button locks to the
// world axis the mouse moves along. Held, all three axes show and the lock
// follows the mouse until the button comes up; clicked after a move, it
// locks to that move's axis; clicked before any move, the next move picks.
// Pressed while locked, a click unlocks and a held slide picks again.

// The three world axes as drawn on screen from the model's middle.
function screenAxes(s) {
  const { ctx, frame, centre } = s;
  const from = screenOf(ctx, frame, centre);
  const reach = Math.max(1e-3, Math.hypot(...sub(ctx.camera.position.toArray(), centre))) * 0.1;
  const dirs = AXIS_NAMES.map((name) => {
    const to = screenOf(ctx, frame, add(centre, times(AXES[name], reach)));
    return from.front && to.front ? [to.at[0] - from.at[0], to.at[1] - from.at[1]] : [0, 0];
  });
  const longest = Math.max(...dirs.map((d) => Math.hypot(d[0], d[1])));
  return { dirs, minLength: Math.max(1e-3, longest * 0.12) };
}

function pickAxis(s, move, plane) {
  if (!move) return false;
  const { dirs, minLength } = screenAxes(s);
  const index = nearestScreenAxis(move, dirs, minLength);
  if (index < 0) return false;
  s.constraint = autoConstraint(AXIS_NAMES[index], plane);
  s.trackball = false; // a locked turn goes around the axis
  return true;
}

function middleDown(plane) {
  const s = session;
  s.waiting = null;
  // Picking follows the hand (s.real), not the slowed Shift move.
  s.auto = { plane, press: [...s.real], moved: false, unlock: !!s.constraint };
  // Not locked yet: a move made before the click picks at once.
  if (!s.constraint) pickAxis(s, pickVector(s.origin, null, s.mouse), plane);
  update();
}

function middleUp() {
  const s = session;
  const a = s?.auto;
  if (!a) return;
  s.auto = null;
  if (a.unlock && !a.moved) s.constraint = null;
  else if (!s.constraint) s.waiting = { plane: a.plane, press: [...s.real] };
  update();
}

// Each mouse move while the middle button is down, or after a click that
// came before any move.
function middleMove(s) {
  if (s.auto) {
    const held = pickVector(s.auto.press, s.auto.press, s.real);
    if (held) { s.auto.moved = true; pickAxis(s, held, s.auto.plane); }
  } else if (s.waiting) {
    const move = pickVector(s.waiting.press, null, s.real, PICK_PX);
    if (move && pickAxis(s, move, s.waiting.plane)) s.waiting = null;
  }
}

// G: where the mouse is now against where it started, on the plane through
// the model's middle facing the camera, along a locked axis, or on a
// locked plane.
function moveFromMouse(s) {
  const { ctx, frame, centre } = s;
  const r0 = rayAt(ctx, frame, s.origin);
  const r1 = rayAt(ctx, frame, s.mouse);
  const facing = viewDir(ctx);
  const onPlane = (normal) => {
    const t0 = rayPlane(r0.o, r0.d, centre, normal);
    const t1 = rayPlane(r1.o, r1.d, centre, normal);
    return t0 == null || t1 == null || t0 < 0 || t1 < 0 ? null : sub(along(r1.o, r1.d, t1), along(r0.o, r0.d, t0));
  };
  const free = () => onPlane(facing) ?? [0, 0, 0];
  const c = s.constraint;
  if (c?.kind === "axis") {
    const axis = axisOf(s, c);
    const t0 = closestOnAxis(r0.o, r0.d, centre, axis);
    const t1 = closestOnAxis(r1.o, r1.d, centre, axis);
    // Looking straight down the axis: follow the free move along it.
    let distance = t0 == null || t1 == null ? dot(free(), axis) : t1 - t0;
    if (s.snap) distance = snapTo(distance, snapStep("grab", s.precise));
    return times(axis, distance);
  }
  let move;
  if (c?.kind === "plane") {
    const normal = axisOf(s, c);
    move = Math.abs(dot(normal, facing)) > 0.08 ? onPlane(normal) : null;
    if (!move) { const f = free(); move = sub(f, times(normal, dot(f, normal))); }
  } else move = free();
  if (s.snap) {
    const step = snapStep("grab", s.precise);
    if (c?.space === "local") {
      // Snap along the model's own axes.
      const axes = localAxes(ctx, new ctx.model.quaternion.constructor().fromArray(s.start.q));
      move = axes.reduce((sum, axis) => add(sum, times(axis, snapTo(dot(move, axis), step))), [0, 0, 0]);
    } else move = move.map((v) => snapTo(v, step));
  }
  return move;
}

function typedMove(s, value) {
  const c = s.constraint;
  if (c?.kind === "axis") return times(axisOf(s, c), value);
  // Unlocked, a typed number moves along X (along Y when the lock leaves X out).
  const name = c?.kind === "plane" && c.axis === "x" ? "y" : "x";
  return times(c ? axisOf(s, { ...c, kind: "axis", axis: name }) : AXES[name], value);
}

function update() {
  const s = session;
  if (!s) return;
  const { ctx } = s;
  const model = ctx.model;
  restore(model, s.start);
  const typed = parseTyped(s.typed);
  const Q = model.quaternion.constructor;
  const q0 = new Q().fromArray(s.start.q);
  let value;
  if (s.mode === "grab") {
    const move = typed != null ? typedMove(s, typed) : moveFromMouse(s);
    model.position.fromArray(add(s.start.p, move));
    value = move;
    s.along = s.constraint?.kind === "axis" ? dot(move, axisOf(s, s.constraint)) : null;
  } else if (s.mode === "rotate") {
    let turn;
    if (s.trackball && typed == null) {
      const camera = ctx.camera;
      const up = V(ctx, 0, 1, 0).applyQuaternion(camera.quaternion);
      const right = V(ctx, 1, 0, 0).applyQuaternion(camera.quaternion);
      const dx = s.mouse[0] - s.origin[0];
      const dy = s.mouse[1] - s.origin[1];
      turn = new Q().setFromAxisAngle(up, dx * TRACKBALL).multiply(new Q().setFromAxisAngle(right, dy * TRACKBALL));
      value = [dx * TRACKBALL / DEG, dy * TRACKBALL / DEG];
    } else {
      const toCamera = times(viewDir(ctx), -1);
      let axis = axisOf(s, s.constraint?.kind === "axis" ? s.constraint : null) ?? toCamera;
      if (s.constraint?.kind === "plane") axis = axisOf(s, s.constraint);
      // Follow the mouse round on screen: flip when the axis points away.
      const sign = dot(axis, toCamera) < 0 ? -1 : 1;
      let degrees = typed != null ? typed : (s.turn / DEG) * sign;
      if (typed == null && s.snap) degrees = snapTo(degrees, snapStep("rotate", s.precise));
      turn = new Q().setFromAxisAngle(V(ctx, ...axis), degrees * DEG);
      value = degrees;
    }
    model.quaternion.copy(turn.clone().multiply(q0));
    // Keep the model's middle where it was.
    const offset = V(ctx, ...s.fromPivot).applyQuaternion(model.quaternion);
    model.position.fromArray(sub(s.centre, offset.toArray()));
  } else {
    const d0 = Math.hypot(s.origin[0] - s.centreScreen[0], s.origin[1] - s.centreScreen[1]);
    const d1 = Math.hypot(s.mouse[0] - s.centreScreen[0], s.mouse[1] - s.centreScreen[1]);
    let factor = typed != null ? typed : d0 > 2 ? d1 / d0 : 1;
    if (typed == null && s.snap) factor = snapTo(factor, snapStep("scale", s.precise));
    if (Math.abs(factor) < 1e-4) factor = 1e-4;
    let index = 0;
    if (s.constraint) {
      index = s.constraint.space === "local"
        ? AXIS_NAMES.indexOf(s.constraint.axis)
        : nearestLocalAxis(localAxes(ctx, q0), AXES[s.constraint.axis]);
    }
    const factors = scaleFactors(factor, s.constraint, index);
    model.scale.fromArray(s.start.s.map((v, i) => v * factors[i]));
    // fromPivot is in the model's turned frame, before its size: scale it
    // by the change and turn it back to keep the middle in place.
    const offset = V(ctx, ...s.fromPivot).multiply(V(ctx, ...factors)).applyQuaternion(q0);
    model.position.fromArray(sub(s.centre, offset.toArray()));
    value = factor;
  }
  model.updateMatrixWorld(true);
  s.value = value;
  drawHead(s);
  drawLines(s);
  redraw(ctx);
}

const esc = (text) => String(text).replace(/[<>&]/g, "");

// The keys Blender's status bar lists while a move runs.
const BAR_KEYS = {
  grab: [["LMB", "Confirm"], ["RMB", "Cancel"], ["X Y Z", "Axis"], ["⇧ X Y Z", "Plane"], ["MMB", "Auto lock"], ["C", "Clear"], ["Ctrl", "Snap"], ["⇧", "Precise"]],
  rotate: [["LMB", "Confirm"], ["RMB", "Cancel"], ["X Y Z", "Axis"], ["MMB", "Auto lock"], ["C", "Clear"], ["R", "Trackball"], ["Ctrl", "Snap"], ["⇧", "Precise"]],
  scale: [["LMB", "Confirm"], ["RMB", "Cancel"], ["X Y Z", "Axis"], ["⇧ X Y Z", "Plane"], ["MMB", "Auto lock"], ["C", "Clear"], ["Ctrl", "Snap"], ["⇧", "Precise"]],
};

// Blender's header line: one tight line at the top-left of the view, under
// the viewer's menu bar; the keys sit in a status strip at the bottom-left.
function drawHead(s) {
  const mode = s.mode === "rotate" && s.trackball && !s.typed ? "trackball" : s.mode;
  let amount;
  if (s.typed) {
    const label = { grab: "D:", rotate: "Rot:", scale: "Scale:" }[s.mode];
    amount = `${label} <span class="typed">${esc(s.typed)}|</span>`;
  } else amount = esc(readout(mode, s.value, s.constraint, s.along));
  let lock = "";
  if ((s.auto || s.waiting) && !s.constraint) lock = `<span class="pick">pick an axis: slide the mouse along it</span>`;
  else if (s.constraint) lock = `<span class="lock ${s.constraint.kind === "axis" ? s.constraint.axis : ""}">${esc(constraintLabel(s.constraint))}</span>`;
  else if (s.mode === "rotate" && mode !== "trackball") lock = `<span class="lock">around the view</span>`;
  s.head.innerHTML = `${amount}${lock ? ` &nbsp;${lock}` : ""}${s.snap ? " &nbsp;· snap" : ""}`;
  const layout = s.ctx.box.__ausbossLayout;
  s.head.style.top = `${(layout?.base ?? 40) + 6}px`;
  if (s.bar.dataset.mode !== s.mode) {
    s.bar.dataset.mode = s.mode;
    s.bar.innerHTML = BAR_KEYS[s.mode].map(([key, what]) => `<span><kbd>${key}</kbd>${what}</span>`).join("");
  }
  const line = bottomButtons(s.ctx.host);
  s.bar.style.bottom = `${line ? line.bottom + Math.max(0, (line.height - 20) / 2) : 8}px`;
}

// Blender's guides: the locked axis as a line through the model's middle,
// and for R and S a dashed line from the middle to the mouse. While the
// middle button picks, all three axes show and the picked one is bright.
function drawLines(s) {
  const { ctx, lines } = s;
  const host = ctx.host;
  const width = host.offsetWidth;
  const height = host.offsetHeight;
  const ratio = window.devicePixelRatio || 1;
  if (lines.width !== Math.round(width * ratio) || lines.height !== Math.round(height * ratio)) {
    lines.width = Math.round(width * ratio);
    lines.height = Math.round(height * ratio);
  }
  const g = lines.getContext("2d");
  if (!g) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, lines.width, lines.height);
  const rect = host.getBoundingClientRect();
  const k = width ? rect.width / width : 1;
  g.setTransform(ratio / k, 0, 0, ratio / k, -rect.left * ratio / k, -rect.top * ratio / k);
  const frame = frameOf(ctx);
  const centre = s.mode === "grab" ? add(s.centre, s.value) : s.centre;
  const middle = screenOf(ctx, frame, centre);
  const reach = Math.max(1, Math.hypot(...sub(ctx.camera.position.toArray(), centre))) * 4;
  const axisLine = (name, space, strong = true) => {
    const axis = axisOf(s, { axis: name, space });
    let a = null, b = null;
    for (let r = reach; r > 1e-3 && !(a?.front && b?.front); r /= 2) {
      a = screenOf(ctx, frame, add(centre, times(axis, r)));
      b = screenOf(ctx, frame, add(centre, times(axis, -r)));
    }
    if (!a?.front || !b?.front) return;
    g.strokeStyle = AXIS_COLOR[name];
    g.lineWidth = (strong ? 1.5 : 1) * k;
    g.globalAlpha = strong ? 0.9 : 0.45;
    g.beginPath();
    g.moveTo(...a.at);
    g.lineTo(...b.at);
    g.stroke();
  };
  const c = s.constraint;
  const picking = !!(s.auto || s.waiting);
  const on = (name) => !!c && (c.kind === "axis" ? name === c.axis : name !== c.axis);
  if (picking) for (const name of AXIS_NAMES) axisLine(name, c?.space ?? "global", on(name));
  else if (c) for (const name of AXIS_NAMES) if (on(name)) axisLine(name, c.space);
  if (middle.front) {
    g.globalAlpha = 1;
    if (s.mode !== "grab" || s.auto) {
      g.setLineDash([4 * k, 4 * k]);
      g.strokeStyle = "rgba(255,255,255,.75)";
      g.lineWidth = 1 * k;
      g.beginPath();
      g.moveTo(...middle.at);
      g.lineTo(...s.real);
      g.stroke();
      g.setLineDash([]);
    }
    g.fillStyle = T.brand;
    g.beginPath();
    g.arc(middle.at[0], middle.at[1], 3 * k, 0, Math.PI * 2);
    g.fill();
  }
}

// ------------------------------------------------------------ one-shot keys

// Back to how the model was loaded: the core's gizmo keeps that, else the
// first sight of it here.
function clear(ctx, what) {
  const model = ctx.model;
  const before = snapshot(model);
  const gizmo = ctx.sceneManager.scene?.__ausbossGizmo;
  const loaded = gizmo?.targetObject === model && gizmo.initialPosition && gizmo.initialScale
    ? { p: gizmo.initialPosition.toArray(), s: gizmo.initialScale.toArray() }
    : historyOf(model).first;
  if (what === "place") model.position.fromArray(loaded.p);
  if (what === "turn") model.quaternion.set(0, 0, 0, 1);
  if (what === "size") model.scale.fromArray(loaded.s);
  model.updateMatrixWorld(true);
  remember(model, before);
  settled(ctx);
}

function undo(ctx, redo) {
  const model = ctx.model;
  const history = histories.get(model);
  const from = redo ? history?.redo : history?.undo;
  if (!from?.length) return false;
  const now = snapshot(model);
  restore(model, from.pop());
  (redo ? history.undo : history.redo).push(now);
  settled(ctx);
  return true;
}

function orbitTarget(ctx) {
  return ctx.controls?.target ?? V(ctx, ...(ctx.model ? centreOf(ctx.model).centre : [0, 0, 0]));
}

function lookFrom(ctx, direction) {
  const camera = ctx.camera;
  const target = orbitTarget(ctx);
  const distance = camera.position.distanceTo(target) || 5;
  let d = V(ctx, ...direction).normalize();
  // Orbit controls cannot look straight along their up axis.
  if (Math.abs(d.y) > 0.999) d = V(ctx, 0, Math.sign(d.y), 1e-4).normalize();
  camera.position.copy(target).addScaledVector(d, distance);
  camera.lookAt(target);
  ctx.controls?.update?.();
  redraw(ctx);
}

function orbit(ctx, left, up) {
  const controls = ctx.controls;
  if (!controls?._rotateLeft) return;
  if (left) controls._rotateLeft(left);
  if (up) controls._rotateUp(up);
  controls.update();
  redraw(ctx);
}

function frameModel(ctx) {
  if (!ctx.model) return;
  const { centre, radius } = centreOf(ctx.model);
  const camera = ctx.camera;
  const target = V(ctx, ...centre);
  const direction = camera.position.clone().sub(orbitTarget(ctx)).normalize();
  if (camera.isPerspectiveCamera) {
    const fov = Math.min(camera.fov, camera.fov * (camera.aspect || 1)) * DEG;
    const distance = (radius / Math.sin(fov / 2)) * 1.05;
    camera.position.copy(target).addScaledVector(direction.lengthSq() ? direction : V(ctx, 0, 0, 1), distance);
  } else {
    camera.position.copy(target).addScaledVector(direction.lengthSq() ? direction : V(ctx, 0, 0, 1), radius * 4);
    const span = Math.min(camera.right - camera.left, camera.top - camera.bottom) || 2;
    camera.zoom = span / (radius * 2.1);
    camera.updateProjectionMatrix();
  }
  ctx.controls?.target?.copy?.(target);
  camera.lookAt(target);
  ctx.controls?.update?.();
  redraw(ctx);
}

// Blender's numpad, also on the top-row digits for keyboards without one.
const NUMPAD = {
  1: (ctx, other) => lookFrom(ctx, other ? [0, 0, -1] : [0, 0, 1]),
  3: (ctx, other) => lookFrom(ctx, other ? [-1, 0, 0] : [1, 0, 0]),
  7: (ctx, other) => lookFrom(ctx, other ? [0, -1, 0] : [0, 1, 0]),
  9: (ctx) => { const target = orbitTarget(ctx); lookFrom(ctx, ctx.camera.position.clone().sub(target).multiplyScalar(-1).toArray()); },
  4: (ctx) => orbit(ctx, ORBIT_STEP, 0),
  6: (ctx) => orbit(ctx, -ORBIT_STEP, 0),
  8: (ctx) => orbit(ctx, 0, ORBIT_STEP),
  2: (ctx) => orbit(ctx, 0, -ORBIT_STEP),
};
const digitOf = (code) => /^(?:Numpad|Digit)(\d)$/.exec(code)?.[1] ?? null;

// ------------------------------------------------------------ the keys sheet

const SHEET = [
  ["Mouse over the view"],
  ["G", "move the model"], ["R", "rotate it (R again: trackball)"], ["S", "scale it"],
  ["X Y Z", "lock to an axis; again: its own axis"], ["Shift X Y Z", "lock to a plane"],
  ["Middle click", "lock to the axis you move along"], ["Middle hold", "slide along an axis to lock it (Shift: plane)"],
  ["C", "unlock"],
  ["Shift", "slower"], ["Ctrl", "snap"], ["0-9 . -", "type an exact amount"],
  ["Click / Enter", "keep"], ["Esc / right-click", "cancel"],
  ["Any time"],
  ["Alt G / R / S", "put back place, turn, size"], ["Ctrl Z", "undo (Shift: redo)"],
  ["1 3 7", "front, right, top (Ctrl: other side)"], ["2 4 6 8", "orbit 15°"], ["9", "other side"],
  ["Home", "frame the model"], ["Middle drag", "orbit (Shift: pan)"], ["N", "the 360 strip"],
];
const KEY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7.5 14h9"/></svg>';

function addSheetButton(box) {
  const tools = box.__ausbossTools?.tools;
  if (!tools || tools.__ausbossKeys) return;
  tools.__ausbossKeys = true;
  const button = document.createElement("button");
  button.type = "button";
  button.title = "Blender keys: G move, R rotate, S scale. Click for the list.";
  button.innerHTML = KEY_ICON;
  let sheet = null;
  const close = () => { sheet?.remove(); sheet = null; button.classList.remove("on"); };
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (sheet) { close(); return; }
    sheet = document.createElement("div");
    sheet.className = "ausboss-vkeys-sheet";
    for (const [key, what] of SHEET) {
      if (what == null) { const h = document.createElement("div"); h.className = "h"; h.textContent = key; sheet.append(h); continue; }
      const kbd = document.createElement("kbd");
      kbd.textContent = key;
      const span = document.createElement("span");
      span.textContent = what;
      sheet.append(kbd, span);
    }
    for (const type of ["pointerdown", "mousedown"]) sheet.addEventListener(type, (e) => e.stopPropagation());
    sheet.style.top = tools.style.top || "120px";
    sheet.style.right = `${parseFloat(getComputedStyle(tools).right) + tools.offsetWidth + 8}px`;
    box.parentElement.append(sheet);
    button.classList.add("on");
  });
  document.addEventListener("pointerdown", (event) => { if (sheet && !sheet.contains(event.target) && event.target !== button) close(); }, true);
  tools.append(button);
}

// Middle mouse orbits, Shift+middle pans: three's orbit controls pan when a
// rotate drag starts with Shift held.
function blenderMouse(box) {
  const controls = box.__ausbossManager?.getControls?.();
  if (!controls?.mouseButtons || controls.__ausbossMiddle) return;
  controls.__ausbossMiddle = true;
  controls.mouseButtons.MIDDLE = 0; // THREE.MOUSE.ROTATE
}

// ------------------------------------------------------------ events

// ComfyUI's own undo listens to every key before any extension can, and
// Ctrl+Z there reloads the whole graph. It stays quiet while the mask
// editor is open; the same check keeps it quiet while the mouse is over a
// viewer whose model has moves to undo, or while a move runs, so Ctrl+Z
// undoes the move and nothing else. Anywhere else it is ComfyUI's.
let holdGraphUndo = false;
function quietGraphUndo() {
  const App = app?.constructor;
  if (!App || App.__ausbossKeysQuiet) return;
  const original = App.maskeditor_is_opended;
  try {
    App.maskeditor_is_opended = function (...args) {
      return holdGraphUndo || (typeof original === "function" ? original.apply(this, args) : false);
    };
    App.__ausbossKeysQuiet = true;
  } catch { /* then Ctrl+Z over a viewer also undoes the graph */ }
}
function hasHistory(box) {
  const model = box?.__ausbossScene ? modelIn(box.__ausbossScene) : null;
  const history = model ? histories.get(model) : null;
  return !!(history && (history.undo.length || history.redo.length));
}

const typing = () => {
  const el = document.activeElement;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};
const stop = (event) => { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); };

function onKeyDown(event) {
  if (session) {
    const s = session;
    const code = event.code;
    if (code === "Escape") { stop(event); finish(false); return; }
    if (code === "Enter" || code === "NumpadEnter" || code === "Space") { stop(event); finish(true); return; }
    if (event.key === "Shift" || event.key === "Control") {
      s.precise = event.shiftKey; s.snap = event.ctrlKey;
      update();
      return;
    }
    const letter = /^Key([A-Z])$/.exec(code)?.[1]?.toLowerCase();
    if (letter && "xyz".includes(letter)) {
      stop(event);
      s.waiting = null;
      if (s.auto) s.auto.moved = true; // the key's lock stays when the middle button comes up
      s.constraint = nextConstraint(s.constraint, letter, event.shiftKey);
      update();
      return;
    }
    if (letter === "c" && !event.ctrlKey) { stop(event); s.constraint = null; s.waiting = null; s.auto = null; update(); return; }
    if (letter === "g") { stop(event); switchMode("grab"); return; }
    if (letter === "r") { stop(event); switchMode("rotate"); return; }
    if (letter === "s") { stop(event); switchMode("scale"); return; }
    const typedKey = code === "Backspace" ? "Backspace"
      : code === "Minus" || code === "NumpadSubtract" ? "-"
        : code === "Period" || code === "NumpadDecimal" ? "."
          : digitOf(code);
    if (typedKey) {
      stop(event);
      s.typed = event.ctrlKey && code === "Backspace" ? "" : typeKey(s.typed, typedKey);
      update();
      return;
    }
    // Everything else waits until the move is done.
    if (!/^F\d+$/.test(event.key)) stop(event);
    return;
  }
  if (event.repeat && !/^(?:Numpad|Digit)/.test(event.code)) return;
  if (typing() || !pointer || event.metaKey) return;
  const box = viewerAt(pointer[0], pointer[1]);
  if (!box) return;
  const code = event.code;
  const letter = /^Key([A-Z])$/.exec(code)?.[1]?.toLowerCase();
  const plain = !event.ctrlKey && !event.altKey && !event.shiftKey;
  if (plain && (letter === "g" || letter === "r" || letter === "s")) {
    const mode = { g: "grab", r: "rotate", s: "scale" }[letter];
    if (begin(mode, box, pointer)) { holdGraphUndo = true; stop(event); }
    return;
  }
  if (plain && letter === "n" && box.__ausbossPano?.toggle) { stop(event); box.__ausbossPano.toggle(); return; }
  const ctx = contextOf(box);
  if (!ctx) return;
  if (event.altKey && !event.ctrlKey && ctx.model && (letter === "g" || letter === "r" || letter === "s")) {
    stop(event);
    clear(ctx, { g: "place", r: "turn", s: "size" }[letter]);
    return;
  }
  if (event.ctrlKey && !event.altKey && ctx.model && (letter === "z" || letter === "y")) {
    if (undo(ctx, letter === "y" || event.shiftKey)) stop(event);
    return;
  }
  if (!event.altKey && !event.shiftKey && (code === "Home" || code === "NumpadDecimal")) { stop(event); frameModel(ctx); return; }
  const digit = digitOf(code);
  if (digit && NUMPAD[digit] && !event.altKey && !event.shiftKey && (!event.ctrlKey || "137".includes(digit))) {
    stop(event);
    NUMPAD[digit](ctx, event.ctrlKey);
  }
}

function onKeyUp(event) {
  if (!session) return;
  if (event.key === "Shift" || event.key === "Control") {
    session.precise = event.shiftKey;
    session.snap = event.ctrlKey;
    update();
  }
}

function onPointerMove(event) {
  pointer = [event.clientX, event.clientY];
  const s = session;
  if (!s) {
    holdGraphUndo = hasHistory(viewerAt(pointer[0], pointer[1]));
    return;
  }
  holdGraphUndo = true;
  const scale = event.shiftKey ? 0.1 : 1;
  s.mouse[0] += (event.clientX - s.real[0]) * scale;
  s.mouse[1] += (event.clientY - s.real[1]) * scale;
  if (s.mode === "rotate") {
    // Count whole turns: the angle grows past 180 degrees as the mouse circles.
    s.turn += screenTurn(s.centreScreen, s.lastMouse ?? s.origin, s.mouse);
    s.lastMouse = [...s.mouse];
  }
  s.real = [event.clientX, event.clientY];
  s.precise = event.shiftKey;
  s.snap = event.ctrlKey;
  if (s.auto) {
    // A left click while the middle button is held keeps the move (the
    // browser sends no pointerdown for a second button); a middle release
    // missed outside the window ends the pick.
    if (event.buttons & 1) { stop(event); swallowUntil = performance.now() + 600; finish(true); return; }
    if (!(event.buttons & 4)) middleUp();
  }
  const lockWas = s.constraint;
  middleMove(s);
  if (!s.typed || s.constraint !== lockWas) update(); else drawLines(s);
}

function onPointerDown(event) {
  if (!session) return;
  stop(event);
  // The middle button picks a lock from the mouse, as in Blender.
  if (event.button === 1) { middleDown(event.shiftKey); return; }
  swallowUntil = performance.now() + 600;
  finish(event.button === 0);
}

function onPointerUp(event) {
  if (!session || event.button !== 1) return;
  stop(event);
  // The auxclick and mouseup that follow are swallowed while the move runs.
  middleUp();
}

function swallow(event) {
  if (session || performance.now() < swallowUntil) {
    stop(event);
    if (event.type === "click" || event.type === "contextmenu") swallowUntil = 0;
  }
}

function scan() {
  patchGizmoManager();
  quietGraphUndo();
  for (const box of document.querySelectorAll("div[data-ausboss-gizmo]")) {
    if (!box.__ausbossManager) continue;
    addSheetButton(box);
    blenderMouse(box);
    const model = box.__ausbossScene ? modelIn(box.__ausbossScene) : null;
    if (model) historyOf(model);
  }
}

app.registerExtension({
  name: "ausboss.viewer_keys",
  setup() {
    ensureCss();
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    for (const type of ["pointerup", "mouseup", "click", "auxclick", "contextmenu", "mousedown"]) window.addEventListener(type, swallow, true);
    window.addEventListener("blur", () => finish(false));
    setInterval(scan, 800);
  },
});
