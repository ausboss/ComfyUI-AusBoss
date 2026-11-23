// A strip for ComfyUI's 3D viewers that drops down under the viewer's menu
// bar, Blender-style, from a small "360" tab hanging under the bar's left
// end (the bar itself is full at a normal node width), so it never covers
// the frame. Its tabs:
//   - Model: spin, tip and lean the model itself (saved with the shot, so
//     the run's 3D shot follows).
//   - Angle: turn, tilt and roll the 360 background, and its own field of
//     view, and whether the 360 moves as the camera orbits (as the viewer
//     draws it) or stays fixed in the frame like a photo backdrop.
//   - Backdrop: the 360's brightness and blur.
//   - Light: the studio lights, no light (the model's colours exactly as in
//     the photo), or the 360 itself.
//   - Colour: the model's brightness, contrast, saturation and warmth.
// The settings ride in the node's properties ("AusBoss View"), so they come
// back with the workflow. Nothing here touches a widget or the prompt.
//
// How: SceneManager.renderBackground runs once per frame before the scene.
// While a 360 setting is off its default, this file draws the panorama
// itself (three's own background drawing, in a scene of its own seen
// through a copy of the camera, which faces one fixed way when the 360 is
// fixed) and clears scene.background so the core's sky is not drawn twice.
// At its defaults the core's own sky is left alone. The look settings patch
// the model's standard materials with a colour grade, once one is used.
import { app } from "../../../scripts/app.js";
import { BRAND } from "../shared/index.mjs";
import { makeScrubInput, scrubbedValue } from "../shared/scrub_input.mjs";
import { menuBarBottom } from "../shared/viewer3d_layout.mjs";
import { FONT_UI, RADIUS_CONTROL, RADIUS_XS, THEME as T } from "../shared/theme.mjs";

const PROP = "AusBoss View";
const CSS_ID = "ausboss-viewer-pano-css";
const SCAN_MS = 800;

export const SKY_DEFAULTS = Object.freeze({ turn: 0, tilt: 0, roll: 0, fov: null, bright: 100, blur: 0, orbit: "moves", shadow: 0 });
export const ORBITS = Object.freeze(["moves", "fixed"]);
export const LIGHTS = Object.freeze(["studio", "photo", "360"]);
export const LOOK_DEFAULTS = Object.freeze({ light: "studio", strength: 100, bright: 100, contrast: 100, saturation: 100, warmth: 0 });

const ICONS = {
  sky: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="3.6" ry="8.5"/><path d="M3.5 12h17"/></svg>',
};

const isDefault = (values, defaults) => Object.keys(defaults).every((key) => values[key] === defaults[key]);
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- the sky

// The 360 is drawn by three itself, the same way the viewer draws it, in a
// scene of its own and through a copy of the camera. The copy can have its
// own field of view, so the 360 can be wider or narrower than the shot.
function makeSky(manager) {
  const scene = new manager.scene.constructor();
  return { scene, camera: null };
}

function skyActive(manager, sky) {
  return manager.backgroundRenderMode === "panorama"
    && manager.currentBackgroundType === "image"
    && !!manager.backgroundTexture
    && !isDefault(sky, SKY_DEFAULTS);
}

// The way the camera faced when the 360 was fixed, as a quaternion.
function fixedView(sky) {
  const view = sky.view;
  return Array.isArray(view) && view.length === 4 && view.every(Number.isFinite) ? view : [0, 0, 0, 1];
}

function drawSky(manager, state) {
  const camera = manager.getActiveCamera?.();
  const texture = manager.backgroundTexture;
  if (!camera?.isPerspectiveCamera || !texture?.image) return false;
  state.sky ??= makeSky(manager);
  const sky = state.sky;
  const values = state.values.sky;
  camera.updateMatrixWorld();
  sky.camera = sky.camera ? sky.camera.copy(camera) : camera.clone();
  // The viewer draws the background into the letterboxed frame, so the
  // copy covers exactly that frame.
  sky.camera.clearViewOffset();
  // Fixed: the copy always faces the same way, so orbiting the model leaves
  // the 360 where it is in the frame.
  // It holds the way the camera faced when the 360 was fixed.
  if (values.orbit === "fixed") {
    sky.camera.quaternion.fromArray(fixedView(values));
    sky.camera.updateMatrixWorld();
  }
  sky.camera.fov = values.fov ?? camera.fov;
  sky.camera.updateProjectionMatrix();
  sky.scene.background = texture;
  sky.scene.backgroundRotation?.set?.(values.tilt * DEG, values.turn * DEG, values.roll * DEG, "ZXY");
  sky.scene.backgroundIntensity = values.bright / 100;
  sky.scene.backgroundBlurriness = Math.min(1, values.blur / 100);
  manager.scene.background = null;
  manager.renderer.render(sky.scene, sky.camera);
  return true;
}

// ------------------------------------------------------------- the shadow

// A soft shadow on the floor under the model, so it stands on the 360
// instead of floating in front of it. The floor is the model's lowest point;
// the shadow covers what touches it (the lowest tenth of the model). It is
// drawn with the backdrop, before the model, so the model covers it. Pause
// for Shot draws the same shadow into the run's backdrop
// (nodes/_backdrop_helpers.py, shadow_alpha), from the patch measured here.
const SHADOW_RINGS = 16;
const SHADOW_SIDES = 48;
const GROUND_SAMPLES = 60000;
// The same curve as shadow_falloff in nodes/_backdrop_helpers.py.
export const shadowFalloff = (distance) => {
  const inside = Math.min(1, Math.max(0, 1 - distance * distance));
  return inside * inside;
};

// The floor patch under the model, in the viewer's world: the floor height
// `y`, the middle `cx`, `cz` and the half sizes `rx`, `rz`.
export function groundPatch(points) {
  let low = Infinity;
  let high = -Infinity;
  for (let i = 1; i < points.length; i += 3) { low = Math.min(low, points[i]); high = Math.max(high, points[i]); }
  if (!Number.isFinite(low)) return null;
  const tall = Math.max(high - low, 1e-6);
  const band = low + tall * 0.1;
  let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    if (points[i + 1] > band) continue;
    x0 = Math.min(x0, points[i]); x1 = Math.max(x1, points[i]);
    z0 = Math.min(z0, points[i + 2]); z1 = Math.max(z1, points[i + 2]);
  }
  const margin = tall * 0.08;
  return { y: low, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, rx: (x1 - x0) / 2 * 1.2 + margin, rz: (z1 - z0) / 2 * 1.2 + margin };
}

// Measured again only when the model or its turn changes.
function measureGround(model, state) {
  model.updateMatrixWorld(true);
  const key = `${model.uuid}:${model.matrixWorld.elements.map((v) => v.toFixed(5)).join(",")}`;
  if (state.groundKey === key) return state.ground;
  const meshes = [];
  let count = 0;
  model.traverse((part) => {
    const position = part.isMesh && part.visible ? part.geometry?.attributes?.position : null;
    if (position?.count) { meshes.push([part, position]); count += position.count; }
  });
  const stride = Math.max(1, Math.ceil(count / GROUND_SAMPLES));
  const points = [];
  for (const [part, position] of meshes) {
    const e = part.matrixWorld.elements;
    for (let i = 0; i < position.count; i += stride) {
      const x = position.getX(i); const y = position.getY(i); const z = position.getZ(i);
      points.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
    }
  }
  state.groundKey = key;
  state.ground = groundPatch(points);
  return state.ground;
}

// A disc of radius 1, black, its alpha falling off by shadowFalloff. Built
// from the classes of the viewer's own background plane.
function makeShadow(manager) {
  const plane = manager.backgroundMesh;
  const Material = manager.backgroundColorMaterial?.constructor;
  const Attribute = plane?.geometry?.attributes?.position?.constructor;
  if (!plane || !Material || !Attribute) return null;
  const geometry = new plane.geometry.constructor();
  const positions = [0, 0, 0];
  const colors = [0, 0, 0, 1];
  const index = [];
  for (let ring = 1; ring <= SHADOW_RINGS; ring += 1) {
    const r = ring / SHADOW_RINGS;
    for (let side = 0; side < SHADOW_SIDES; side += 1) {
      const a = (side / SHADOW_SIDES) * Math.PI * 2;
      positions.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      colors.push(0, 0, 0, shadowFalloff(r));
      const here = 1 + (ring - 1) * SHADOW_SIDES + side;
      const next = 1 + (ring - 1) * SHADOW_SIDES + ((side + 1) % SHADOW_SIDES);
      if (ring === 1) index.push(0, next, here);
      else index.push(here - SHADOW_SIDES, next - SHADOW_SIDES, here, next - SHADOW_SIDES, next, here);
    }
  }
  for (const name of Object.keys(geometry.attributes)) geometry.deleteAttribute(name);
  geometry.setAttribute("position", new Attribute(positions, 3));
  geometry.setAttribute("color", new Attribute(colors, 4));
  geometry.setIndex(index);
  const material = new Material({ color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, depthTest: false, side: 2 });
  const mesh = new plane.constructor(geometry, material);
  const scene = new manager.scene.constructor();
  scene.add(mesh);
  return { scene, mesh, camera: null };
}

function drawShadow(manager, state) {
  const strength = state.values.sky.shadow;
  if (!(strength > 0)) return;
  const camera = manager.getActiveCamera?.();
  const model = modelOf(manager);
  if (!camera || !model) return;
  const ground = measureGround(model, state);
  if (!ground) return;
  state.shadow ??= makeShadow(manager);
  const shadow = state.shadow;
  if (!shadow) return;
  camera.updateMatrixWorld();
  if (camera.position.y <= ground.y) return;
  shadow.mesh.position.set(ground.cx, ground.y, ground.cz);
  shadow.mesh.scale.set(ground.rx, 1, ground.rz);
  shadow.mesh.material.opacity = Math.min(1, strength / 100);
  shadow.mesh.updateMatrixWorld();
  shadow.camera = shadow.camera ? shadow.camera.copy(camera) : camera.clone();
  // With a picture behind, the viewer draws the backdrop into the
  // letterboxed frame (see drawSky); otherwise into the whole view through
  // the camera's own offset.
  if (manager.currentBackgroundType === "image") shadow.camera.clearViewOffset?.();
  manager.renderer.render(shadow.scene, shadow.camera);
}

// ---------------------------------------------------------------- the look

const LOOK_FN = `
uniform vec4 abLook;    // brightness, contrast, saturation, warmth
uniform float abUnlit;  // 1: the model's own colours, no added light
vec3 abGradeLook(vec3 c) {
  c *= abLook.x;
  vec3 g = pow(max(c, 0.0), vec3(1.0 / 2.2));
  g = (g - 0.5) * abLook.y + 0.5;
  c = pow(max(g, 0.0), vec3(2.2));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, abLook.z);
  c *= vec3(1.0 + abLook.w * 0.12, 1.0 + abLook.w * 0.02, 1.0 - abLook.w * 0.12);
  return c;
}
`;
// Shared by every viewer; each viewer sets the values just before it draws.
const lookUniform = { value: { x: 1, y: 1, z: 1, w: 0 } };
const unlitUniform = { value: 0 };

function patchMaterial(material) {
  if (!material?.isMeshStandardMaterial || material.__ausbossLook) return;
  material.__ausbossLook = true;
  const before = material.onBeforeCompile;
  material.onBeforeCompile = function (shader, renderer) {
    before?.call(this, shader, renderer);
    shader.uniforms.abLook = lookUniform;
    shader.uniforms.abUnlit = unlitUniform;
    if (!shader.fragmentShader.includes("abGradeLook")) {
      shader.fragmentShader = LOOK_FN + shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        "outgoingLight = abGradeLook(mix(outgoingLight, diffuseColor.rgb, abUnlit));\n#include <opaque_fragment>",
      );
    }
  };
  const key = material.customProgramCacheKey;
  material.customProgramCacheKey = function () { return `${key.call(this)}|ausboss-look-v2`; };
  material.needsUpdate = true;
}

// How bright a 360 is on average, so lighting the model with it gives the
// model about its own brightness: a night street lights it as much as a
// sunny one, only from other directions and in other colours.
const brightness = new WeakMap();
function meanLight(texture) {
  if (brightness.has(texture)) return brightness.get(texture);
  let mean = 0.18;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(texture.image, 0, 0, 64, 32);
    const { data } = context.getImageData(0, 0, 64, 32);
    const linear = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    let sum = 0, weights = 0;
    for (let y = 0; y < 32; y += 1) {
      const weight = Math.cos(((y + 0.5) / 32 - 0.5) * Math.PI);
      for (let x = 0; x < 64; x += 1) {
        const i = (y * 64 + x) * 4;
        sum += weight * (0.2126 * linear(data[i]) + 0.7152 * linear(data[i + 1]) + 0.0722 * linear(data[i + 2]));
        weights += weight;
      }
    }
    mean = Math.max(0.005, sum / weights);
  } catch { /* keep the middle value */ }
  brightness.set(texture, mean);
  return mean;
}

// When the 360 is fixed in the frame, its light turns with the camera: what
// lights the model from behind the camera is what the backdrop shows there.
// three turns a lookup direction by the inverse of the angles' rotation, the
// same for the backdrop and the light, so the light's rotation is the
// backdrop's lookup undone by the camera's, inverted back into angles.
function setLightTurn(manager, scene, sky) {
  const rotation = scene.environmentRotation;
  const camera = manager.getActiveCamera?.();
  if (!rotation?.set) return;
  if (!camera || sky.orbit !== "fixed") { rotation.set(sky.tilt * DEG, sky.turn * DEG, sky.roll * DEG, "ZXY"); return; }
  const Euler = rotation.constructor;
  const Matrix = camera.matrixWorld.constructor;
  camera.updateMatrixWorld();
  const backdrop = new Matrix().makeRotationFromEuler(new Euler(sky.tilt * DEG, sky.turn * DEG, sky.roll * DEG, "ZXY")).transpose()
    .multiply(new Matrix().makeRotationFromQuaternion(new camera.quaternion.constructor().fromArray(fixedView(sky))));
  const view = new Matrix().extractRotation(camera.matrixWorld).invert();
  const angles = new Euler().setFromRotationMatrix(backdrop.multiply(view).transpose(), "ZXY");
  rotation.set(angles.x, angles.y, angles.z, "ZXY");
}

function applyLook(manager, state) {
  const look = state.values.look;
  if (!isDefault(look, LOOK_DEFAULTS)) state.lookUsed = true;
  if (!state.lookUsed) return;
  if ((state.frame++ % 20) === 0 || state.dirty) {
    manager.scene.traverse((child) => {
      if (!child.isMesh) return;
      (Array.isArray(child.material) ? child.material : [child.material]).forEach(patchMaterial);
    });
  }
  lookUniform.value = { x: look.bright / 100, y: look.contrast / 100, z: look.saturation / 100, w: look.warmth / 100 };
  unlitUniform.value = look.light === "photo" ? 1 : 0;

  // Light from the 360: the panorama lights the model the way an HDRI does,
  // and the studio lights are off while it is on.
  const scene = manager.scene;
  const sky = state.values.sky;
  const from360 = look.light === "360" && manager.currentBackgroundType === "image" && manager.backgroundTexture
    && manager.backgroundRenderMode === "panorama";
  const hdriOwns = scene.environment && scene.environment !== state.envTexture;
  if (from360 && !hdriOwns) {
    const texture = manager.backgroundTexture;
    if (texture.mapping !== 303) { texture.mapping = 303; texture.needsUpdate = true; } // EquirectangularReflectionMapping
    scene.environment = texture;
    state.envTexture = texture;
    scene.environmentIntensity = Math.min(40, (look.strength / 100) / meanLight(texture));
    setLightTurn(manager, scene, sky);
    scene.traverse((child) => { if (child.isLight && child.visible) { child.visible = false; child.__ausbossHidden = true; } });
  } else if (state.envTexture) {
    if (scene.environment === state.envTexture) scene.environment = null;
    state.envTexture = null;
    scene.environmentIntensity = 1;
    scene.environmentRotation?.set?.(0, 0, 0, "XYZ");
    scene.traverse((child) => { if (child.__ausbossHidden) { child.visible = true; child.__ausbossHidden = false; } });
  }
  state.dirty = false;
}

// ------------------------------------------------------- viewer registry

const managers = new Set();

function stateOf(manager) {
  return (manager.__ausbossViewState ??= {
    values: { sky: { ...SKY_DEFAULTS }, look: { ...LOOK_DEFAULTS } },
    sky: null, skyWasOn: false, envTexture: null, lookUsed: false, frame: 0, dirty: true,
    node: null, panorama: false, restored: false, lastMode: null,
  });
}

// The core viewer drops a saved panorama while a workflow loads (it sets the
// background colour after the picture, which flips the mode back to flat),
// so the panel keeps its own note of it and puts it back once the picture
// is in. After that it follows the viewer's own Panorama button.
function keepPanorama(manager, state) {
  if (!state.node) return;
  const imageIn = manager.currentBackgroundType === "image" && !!manager.backgroundTexture;
  const mode = manager.backgroundRenderMode;
  if (!state.restored) {
    if (!imageIn) return;
    state.restored = true;
    if (state.panorama && mode !== "panorama") {
      manager.setBackgroundRenderMode("panorama");
      state.lastMode = "panorama";
      return;
    }
  }
  if (!imageIn || mode === state.lastMode) return;
  state.lastMode = mode;
  const panorama = mode === "panorama";
  if (panorama !== state.panorama) { state.panorama = panorama; writeSaved(state.node, state); }
}

function patchSceneManager() {
  const Manager = window.comfyAPI?.SceneManager?.SceneManager;
  if (!Manager) return false;
  if (Manager.prototype.__ausbossView) return true;
  const render = Manager.prototype.renderBackground;
  Manager.prototype.renderBackground = function (...args) {
    try {
      managers.add(this);
      const state = stateOf(this);
      keepPanorama(this, state);
      applyLook(this, state);
      if (skyActive(this, state.values.sky)) {
        if (drawSky(this, state)) { state.skyWasOn = true; drawShadow(this, state); return undefined; }
      } else if (state.skyWasOn) {
        // Back to the core's own sky.
        state.skyWasOn = false;
        if (this.backgroundRenderMode === "panorama" && this.currentBackgroundType === "image" && this.backgroundTexture) {
          this.scene.background = this.backgroundTexture;
        }
      }
    } catch (error) {
      console.warn("[AusBoss] 3D viewer 360 panel:", error);
    }
    const out = render.apply(this, args);
    try {
      drawShadow(this, stateOf(this));
    } catch (error) {
      console.warn("[AusBoss] 3D viewer shadow:", error);
    }
    return out;
  };
  Manager.prototype.__ausbossView = true;
  return true;
}

// The viewer only draws while the mouse is over it. The panel asks for a
// frame after a change, through the viewer that last drew this scene.
function patchViewport() {
  const Viewport = window.comfyAPI?.Viewport3d?.Viewport3d;
  if (!Viewport || Viewport.prototype.__ausbossView) return;
  const main = Viewport.prototype.renderMainScene;
  if (typeof main !== "function") return;
  Viewport.prototype.renderMainScene = function (...args) {
    if (this.sceneManager) this.sceneManager.__ausbossViewport = this;
    return main.apply(this, args);
  };
  Viewport.prototype.__ausbossView = true;
}
function redraw(manager) {
  try { manager.__ausbossViewport?.forceRender?.(); } catch { /* the next frame shows it */ }
}

function managerFor(root) {
  for (const manager of managers) {
    const canvas = manager.view?.canvas;
    if (!canvas?.isConnected) { managers.delete(manager); continue; }
    if (root.contains(canvas)) return manager;
  }
  return null;
}

// The graph node that owns a viewer's DOM. Nodes 2.0 marks its node
// elements with the id. The classic renderer floats the viewer over the
// canvas with nothing to name its node, so the node is the 3D node whose
// body sits under the viewer on screen.
const VIEWER_TYPES = new Set(["Preview3DAdvanced", "Preview3D", "Load3D", "Load3DAdvanced", "SaveGLB", "Preview3DAnimation"]);
function nodeFor(root) {
  const nodes = app.graph?._nodes ?? [];
  const id = root.closest?.("[data-node-id]")?.dataset?.nodeId;
  if (id != null) {
    const node = nodes.find((n) => String(n.id) === String(id));
    if (node) return node;
  }
  const holder = root.closest?.(".dom-widget") ?? root;
  const rect = holder.getBoundingClientRect();
  const canvas = app.canvas?.canvas?.getBoundingClientRect?.();
  const ds = app.canvas?.ds;
  if (!canvas || !ds) return null;
  let best = null;
  for (const node of nodes) {
    if (!node.widgets?.some((w) => w.type === "load3D") && !VIEWER_TYPES.has(node.type)) continue;
    const left = canvas.left + (node.pos[0] + ds.offset[0]) * ds.scale;
    const top = canvas.top + (node.pos[1] + ds.offset[1]) * ds.scale;
    const width = node.size[0] * ds.scale;
    const height = node.size[1] * ds.scale;
    const inside = rect.left >= left - 4 && rect.right <= left + width + 4 && rect.top >= top - 4 && rect.top <= top + height;
    const score = Math.abs(rect.left - left) + Math.abs(rect.right - (left + width)) + (inside ? 0 : 1e6);
    if (!best || score < best.score) best = { node, score };
  }
  return best && best.score < 1e6 ? best.node : null;
}

// ---------------------------------------------------------------- strip

function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-vstrip-btn{position:absolute;left:6px;z-index:6;display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border:0;border-radius:0 0 ${RADIUS_XS}px ${RADIUS_XS}px;background:rgba(16,18,20,.85);color:${T.inkSoft};font:600 11px/1 ${FONT_UI};cursor:pointer;white-space:nowrap}
.ausboss-vstrip-btn:hover{color:${BRAND}}
.ausboss-vstrip-btn.open{display:none}
.ausboss-vstrip-btn svg{width:13px;height:13px}
.ausboss-vstrip{position:absolute;left:0;right:0;z-index:6;display:none;box-sizing:border-box;padding:4px 8px 6px;background:rgba(16,18,20,.92);border-bottom:1px solid rgba(255,255,255,.07);font:400 11px/1.2 ${FONT_UI};color:${T.inkSoft};touch-action:none}
.ausboss-vstrip.open{display:block}
.ausboss-vstrip-head{display:flex;align-items:center;gap:2px;margin-bottom:4px}
.ausboss-vstrip-tab{height:20px;padding:0 9px;border:0;border-radius:${RADIUS_XS}px;background:transparent;color:${T.label};font:600 11px/1 ${FONT_UI};cursor:pointer;white-space:nowrap}
.ausboss-vstrip-tab.on{background:${T.brandSoft};color:${T.brandInk}}
.ausboss-vstrip-tab:hover{color:${T.ink}}
.ausboss-vstrip-sp{flex:1}
.ausboss-vstrip-act{height:20px;padding:0 7px;border:0;border-radius:${RADIUS_XS}px;background:${T.fill};color:${T.inkSoft};font:600 11px/1 ${FONT_UI};cursor:pointer}
.ausboss-vstrip-act:hover{background:${T.fillHover};color:${T.ink}}
.ausboss-vstrip-fields{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;min-height:24px}
.ausboss-vstrip-field{display:flex;align-items:center;gap:5px;flex:1 1 0;min-width:112px}
.ausboss-vstrip-field>span{flex:none;color:${T.label};font-weight:600;cursor:ew-resize;user-select:none;white-space:nowrap}
.ausboss-vstrip-field>span:hover{color:${T.ink}}
.ausboss-vstrip-field>.ausboss-scrub{flex:1 1 auto;width:auto;min-width:64px}
.ausboss-vstrip-field.wide{flex:2 1 0;min-width:190px}
.ausboss-vstrip-pill{display:grid;flex:1 1 auto;height:24px;border-radius:${RADIUS_CONTROL}px;background:${T.fill};overflow:hidden}
.ausboss-vstrip-pill button{border:0;background:transparent;color:${T.label};font:600 11px/1 ${FONT_UI};cursor:pointer}
.ausboss-vstrip-pill button.on{background:${BRAND};color:${T.onBrand}}
.ausboss-vstrip-hint{color:${T.faint};font-size:11px}
.ausboss-vstrip-keys{flex:1 0 100%;font-size:10px}
`;
  document.head.append(style);
}

const ANGLE = { title: "Angle", group: "sky", hint: "sky", fields: [
  { key: "turn", label: "Turn", min: -180, max: 180, step: 1, fineStep: 0.1, decimals: 1, unit: "°", title: "Spin the 360 around her. The camera does not move." },
  { key: "tilt", label: "Tilt", min: -180, max: 180, step: 1, fineStep: 0.1, decimals: 1, unit: "°", title: "Tip the 360 up or down, to level the horizon." },
  { key: "roll", label: "Roll", min: -180, max: 180, step: 1, fineStep: 0.1, decimals: 1, unit: "°", title: "Lean the 360 left or right, to straighten it." },
  { key: "fov", label: "FOV", min: 10, max: 150, step: 1, fineStep: 0.1, decimals: 1, unit: "°", allowEmpty: true, placeholder: "cam",
    title: "How wide the 360 looks, apart from the camera. Empty follows the camera." },
  { key: "orbit", label: "Orbit", pill: ORBITS, wide: true,
    title: "moves: the 360 turns as you orbit, like a real place. fixed: it stays put in the frame like a photo backdrop; only Turn, Tilt and Roll move it." },
] };
const BACKDROP = { title: "Backdrop", group: "sky", hint: "sky", fields: [
  { key: "bright", label: "Brightness", min: 0, max: 300, step: 5, fineStep: 1, decimals: 0, unit: "%", title: "Make the 360 darker or brighter." },
  { key: "blur", label: "Blur", min: 0, max: 100, step: 5, fineStep: 1, decimals: 0, unit: "%", title: "Soften the 360, like a shallow depth of field." },
  { key: "shadow", label: "Shadow", min: 0, max: 100, step: 5, fineStep: 1, decimals: 0, unit: "%",
    title: "A soft shadow on the floor under her, so she stands on the 360 instead of floating. Pause for Shot puts it in the run's shot too." },
] };
const LIGHT = { title: "Light", group: "look", fields: [
  { key: "light", label: "Light", pill: LIGHTS, wide: true,
    title: "studio: the viewer's own lights. photo: her colours exactly as in your picture, no added light. 360: lit by the 360 around her." },
  { key: "strength", label: "360 light", min: 0, max: 400, step: 5, fineStep: 1, decimals: 0, unit: "%", when: (look) => look.light === "360", title: "How strongly the 360 lights her." },
] };
const COLOUR = { title: "Colour", group: "look", fields: [
  { key: "bright", label: "Bright", min: 0, max: 300, step: 5, fineStep: 1, decimals: 0, unit: "%", title: "Make the model darker or brighter." },
  { key: "contrast", label: "Contrast", min: 0, max: 200, step: 5, fineStep: 1, decimals: 0, unit: "%", title: "Flatten or deepen the model's light and dark." },
  { key: "saturation", label: "Sat", min: 0, max: 200, step: 5, fineStep: 1, decimals: 0, unit: "%", title: "Saturation: less or more colour on the model." },
  { key: "warmth", label: "Warm", min: -100, max: 100, step: 5, fineStep: 1, decimals: 0, unit: "", title: "Cooler (blue) or warmer (orange) model." },
] };
// The model's own turn. These read and write the loaded model's rotation
// directly, which the viewer saves with the shot and hands to the run (its
// model_3d_info), so the 3D shot follows. Nothing extra is saved here.
const MODEL = { title: "Model", group: "model", fields: [
  { key: "spin", label: "Spin", min: -180, max: 180, step: 1, fineStep: 0.1, decimals: 1, unit: "°", title: "Turn the model around, left or right." },
  { key: "tip", label: "Tip", min: -90, max: 90, step: 1, fineStep: 0.1, decimals: 1, unit: "°", title: "Tip the model forward or back." },
  { key: "lean", label: "Lean", min: -90, max: 90, step: 1, fineStep: 0.1, decimals: 1, unit: "°", title: "Lean the model left or right." },
] };
const TABS = [MODEL, ANGLE, BACKDROP, LIGHT, COLOUR];

// The loaded model: the scene child with the model's standard materials.
function modelOf(manager) {
  return manager.scene.children.find((child) => {
    if (child.isLight || child === manager.gridHelper || !child.visible) return false;
    let found = false;
    child.traverse?.((part) => { if (!found && part.isMesh && part.material?.isMeshStandardMaterial) found = true; });
    return found;
  }) ?? null;
}
// Spin, tip and lean as one turn order (spin last), in degrees.
function readModelTurn(model) {
  const euler = new model.rotation.constructor().setFromQuaternion(model.quaternion, "YXZ");
  return { spin: euler.y / DEG, tip: euler.x / DEG, lean: euler.z / DEG };
}
function writeModelTurn(model, turn) {
  const euler = new model.rotation.constructor(turn.tip * DEG, turn.spin * DEG, turn.lean * DEG, "YXZ");
  model.quaternion.setFromEuler(euler);
  model.updateMatrixWorld(true);
}

function readSaved(node, state) {
  const saved = node?.properties?.[PROP];
  if (node?.properties?.["Scene Config"]?.backgroundRenderMode === "panorama") state.panorama = true;
  if (!saved || typeof saved !== "object") return;
  if (saved.panorama === true) state.panorama = true;
  for (const [group, defaults] of [["sky", SKY_DEFAULTS], ["look", LOOK_DEFAULTS]]) {
    const from = saved[group] ?? {};
    for (const key of Object.keys(defaults)) {
      const value = from[key];
      if (key === "light") { if (LIGHTS.includes(value)) state.values.look.light = value; }
      else if (key === "orbit") {
        if (ORBITS.includes(value)) state.values.sky.orbit = value;
        if (Array.isArray(from.view)) state.values.sky.view = fixedView(from);
      }
      else if (key === "fov") state.values.sky.fov = Number.isFinite(value) ? value : null;
      else if (Number.isFinite(value)) state.values[group][key] = value;
    }
  }
  state.dirty = true;
}

function writeSaved(node, state) {
  if (!node) return;
  node.properties ??= {};
  const skyDefault = isDefault(state.values.sky, SKY_DEFAULTS);
  const lookDefault = isDefault(state.values.look, LOOK_DEFAULTS);
  if (skyDefault && lookDefault && !state.panorama) delete node.properties[PROP];
  else node.properties[PROP] = { panorama: state.panorama, sky: { ...state.values.sky }, look: { ...state.values.look } };
  app.graph?.setDirtyCanvas?.(true, false);
}

function buildStrip(box, root, manager) {
  const state = stateOf(manager);
  const node = nodeFor(root);
  readSaved(node, state);
  state.node = node;
  // Other panels find this viewer's box by its node (js/pause_shot).
  box.__ausbossNode = node;
  box.__ausbossScene = manager;
  // Pause for Shot sends the floor patch with the shot, for its shadow.
  manager.__ausbossGround = () => {
    const model = modelOf(manager);
    return model ? measureGround(model, state) : null;
  };

  const strip = document.createElement("div");
  strip.className = "ausboss-vstrip";
  for (const type of ["pointerdown", "mousedown", "dblclick", "contextmenu"]) strip.addEventListener(type, (event) => event.stopPropagation());
  const head = document.createElement("div");
  head.className = "ausboss-vstrip-head";
  const fields = document.createElement("div");
  fields.className = "ausboss-vstrip-fields";
  strip.append(head, fields);

  const tabButtons = TABS.map((spec) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ausboss-vstrip-tab";
    button.textContent = spec.title;
    button.addEventListener("click", () => show(spec));
    return button;
  });
  const spacer = document.createElement("span");
  spacer.className = "ausboss-vstrip-sp";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "ausboss-vstrip-act";
  reset.textContent = "Reset";
  reset.title = "Put this tab back to how the viewer draws it.";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "ausboss-vstrip-act";
  close.textContent = "✕";
  close.title = "Close";
  head.append(...tabButtons, spacer, reset, close);

  let tab = MODEL;
  const camera = () => manager.getActiveCamera?.();
  // Fixing the 360 holds what the frame shows right now.
  const orbitField = ANGLE.fields.find((field) => field.key === "orbit");
  orbitField.picked = (values, option) => {
    const view = camera()?.quaternion;
    if (option === "fixed" && view) values.view = view.toArray();
  };
  const has360 = () => manager.backgroundRenderMode === "panorama" && manager.currentBackgroundType === "image";
  const changed = () => { state.dirty = true; writeSaved(node, state); redraw(manager); refreshWhen(); };
  const rows = [];
  const refreshWhen = () => rows.forEach(({ row, spec }) => { if (spec.when) row.style.display = spec.when(state.values.look) ? "" : "none"; });

  function scrubField(spec, values) {
    const row = document.createElement("label");
    row.className = "ausboss-vstrip-field";
    row.title = spec.title;
    const name = document.createElement("span");
    name.textContent = spec.label;
    const scrub = makeScrubInput({
      value: values[spec.key], min: spec.min, max: spec.max, step: spec.step, fineStep: spec.fineStep,
      decimals: spec.decimals, unit: spec.unit, unitWidth: 12, title: spec.title,
      allowEmpty: !!spec.allowEmpty, placeholder: spec.placeholder ?? "",
      emptyStart: spec.key === "fov" ? Math.round(camera()?.fov ?? 35) : 0,
      onChange: (value) => { values[spec.key] = value; changed(); },
    });
    // Drag the name to scrub as well, the way a 3D app's number fields work.
    let drag = null;
    name.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      name.setPointerCapture(event.pointerId);
      const start = values[spec.key] ?? (spec.key === "fov" ? Math.round(camera()?.fov ?? 35) : 0);
      drag = { x: event.clientX, start };
    });
    name.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const next = scrubbedValue(drag.start, event.clientX - drag.x, event.shiftKey, spec);
      if (next === values[spec.key]) return;
      values[spec.key] = next;
      scrub.set(next);
      changed();
    });
    const end = (event) => { drag = null; try { name.releasePointerCapture(event.pointerId); } catch { /* released */ } };
    name.addEventListener("pointerup", end);
    name.addEventListener("pointercancel", end);
    name.addEventListener("click", (event) => event.preventDefault());
    row.append(name, scrub.root);
    return row;
  }

  function pillField(spec, values) {
    const row = document.createElement("div");
    row.className = "ausboss-vstrip-field wide";
    row.title = spec.title;
    const name = document.createElement("span");
    name.textContent = spec.label;
    name.style.cursor = "default";
    const pill = document.createElement("div");
    pill.className = "ausboss-vstrip-pill";
    pill.style.gridTemplateColumns = `repeat(${spec.pill.length},1fr)`;
    const options = spec.pill.map((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = option;
      button.addEventListener("click", () => { values[spec.key] = option; spec.picked?.(values, option); paint(); changed(); });
      pill.append(button);
      return button;
    });
    const paint = () => options.forEach((button, i) => button.classList.toggle("on", spec.pill[i] === values[spec.key]));
    paint();
    row.append(name, pill);
    return row;
  }

  function show(spec) {
    tab = spec;
    tabButtons.forEach((button, i) => button.classList.toggle("on", TABS[i] === spec));
    fields.replaceChildren();
    rows.length = 0;
    const model = spec.group === "model" ? modelOf(manager) : null;
    if (spec.group === "model" && !model) {
      const hint = document.createElement("span");
      hint.className = "ausboss-vstrip-hint";
      hint.textContent = "Run the workflow to load the model first.";
      fields.append(hint);
    } else if (spec.hint === "sky" && !has360()) {
      const hint = document.createElement("span");
      hint.className = "ausboss-vstrip-hint";
      hint.textContent = "Load a 360 picture with BG Image, then press Panorama.";
      fields.append(hint);
    } else {
      let values = state.values[spec.group];
      if (model) {
        const turn = readModelTurn(model);
        const round = (v) => Math.round(v * 10) / 10;
        values = new Proxy({ spin: round(turn.spin), tip: round(turn.tip), lean: round(turn.lean) }, {
          set(target, key, value) {
            target[key] = value;
            writeModelTurn(model, target);
            return true;
          },
        });
      }
      for (const field of spec.fields) {
        const row = field.pill ? pillField(field, values) : scrubField(field, values);
        rows.push({ row, spec: field });
        fields.append(row);
      }
      if (model) {
        // The Blender keys (js/viewer_keys) do the rest on the model.
        const hint = document.createElement("span");
        hint.className = "ausboss-vstrip-hint ausboss-vstrip-keys";
        hint.textContent = "Mouse over the view: G move · R rotate · S scale · X Y Z lock · Esc cancel";
        fields.append(hint);
      }
      refreshWhen();
    }
    place();
  }

  reset.addEventListener("click", () => {
    if (tab.group === "model") {
      const model = modelOf(manager);
      if (model) { writeModelTurn(model, { spin: 0, tip: 0, lean: 0 }); redraw(manager); }
      show(tab);
      return;
    }
    for (const field of tab.fields) state.values[tab.group][field.key] = (tab.group === "sky" ? SKY_DEFAULTS : LOOK_DEFAULTS)[field.key];
    changed();
    show(tab);
  });

  // The button in the viewer's menu bar that opens and closes the strip.
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ausboss-vstrip-btn";
  button.title = "360 and light: turn the 360, its field of view, brightness, blur; light and colour the model.";
  button.innerHTML = `${ICONS.sky}<span>360</span><svg viewBox="0 0 10 6" style="width:9px;height:6px"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  const toggle = (open) => {
    strip.classList.toggle("open", open);
    button.classList.toggle("open", open);
    if (open) show(tab);
    place();
  };
  button.addEventListener("click", (event) => { event.stopPropagation(); toggle(!strip.classList.contains("open")); });
  close.addEventListener("click", () => toggle(false));

  // Right under the menu bar as it is drawn (js/shared/viewer3d_layout.mjs).
  function place() {
    const bottom = menuBarBottom(box.parentElement);
    if (bottom != null) {
      const top = `${bottom}px`;
      if (strip.style.top !== top) strip.style.top = top;
      if (button.style.top !== top) button.style.top = top;
    }
    box.__ausbossTools?.place?.();
  }
  box.__ausbossStripHeight = () => (strip.classList.contains("open") ? strip.offsetHeight : 0);
  box.parentElement.append(strip, button);
  // The Model tab's numbers follow a turn made with the keys (js/viewer_keys).
  const refresh = () => { if (strip.classList.contains("open") && tab.group === "model") show(tab); };
  // N opens and closes it, like Blender's sidebar (js/viewer_keys).
  box.__ausbossPano = { strip, place, refresh, toggle: () => toggle(!strip.classList.contains("open")) };
  place();
}

// A viewer that is loaded with a workflow draws once, before this file's
// patches are in, and then only while the mouse is over its node. Until it
// draws again the strip cannot find it, so each 3D node gets one short
// "mouse over" (what the core does on hover) to make it draw a frame.
const nudged = new WeakSet();
function nudgeViewers() {
  for (const node of app.graph?._nodes ?? []) {
    if (nudged.has(node) || !node.widgets?.some((widget) => widget.type === "load3D")) continue;
    nudged.add(node);
    try {
      node.onMouseEnter?.();
      requestAnimationFrame(() => requestAnimationFrame(() => node.onMouseLeave?.()));
    } catch { /* hover is only a nudge */ }
  }
}

// A viewer that came up before its node was laid out could not tell which
// node it belongs to. Keep asking, so its saved 360 and Pause for Shot's
// Continue bar find it.
function bindLate(box) {
  const node = nodeFor(box.parentElement);
  const manager = box.__ausbossScene;
  if (!node || !manager) return;
  const state = stateOf(manager);
  box.__ausbossNode = node;
  state.node = node;
  readSaved(node, state);
  box.__ausbossPano.refresh?.();
}

function scan() {
  if (!patchSceneManager()) return;
  patchViewport();
  let waiting = false;
  for (const manager of managers) {
    const state = manager.__ausbossViewState;
    if (state?.node && !state.restored) { keepPanorama(manager, state); if (state.restored) redraw(manager); }
  }
  for (const box of document.querySelectorAll("div[data-ausboss-gizmo]")) {
    if (box.__ausbossPano) {
      if (!box.__ausbossNode) bindLate(box);
      box.__ausbossPano.place();
      continue;
    }
    if (!box.__ausbossTools?.tools || !box.parentElement) continue;
    const manager = managerFor(box.parentElement);
    if (!manager) { waiting = true; continue; }
    buildStrip(box, box.parentElement, manager);
  }
  if (waiting) nudgeViewers();
}

app.registerExtension({
  name: "ausboss.viewer_pano",
  setup() {
    ensureCss();
    setInterval(scan, SCAN_MS);
  },
});
