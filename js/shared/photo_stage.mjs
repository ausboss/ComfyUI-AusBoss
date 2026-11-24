// Your own photo behind the model in the 3D viewer, lined up with it: the
// viewer's side of Pause for Shot's photo backdrop (nodes/_stage_helpers.py).
//
// The photo (with the person taken out) is laid on a simple stage around the
// camera that took it: a flat floor at the model's feet, everything else far
// away. Each pixel of the viewer is a ray from its camera; where it meets the
// floor, or else far away, that point is looked up in the photo through the
// photo's own camera. What the photo never saw comes from the 360 when there
// is one, else from the photo's nearest edge. Pause for Shot casts the same
// rays for the run's backdrop, so what the viewer shows is what the run gets.
//
// It is drawn as the viewer's background (a full-frame quad before the
// model), built from the classes of three objects the viewer already holds,
// since the page does not hand three.js to extensions.

export const BACKGROUNDS = Object.freeze(["photo", "360", "360 floor"]);

// The choice in force: Pause for Shot's Background, where photo needs your
// photo and falls back to the 360 far away without it (background_choice).
export function backgroundChoice(mode, hasPhoto) {
  const chosen = BACKGROUNDS.includes(mode) ? mode : "photo";
  return chosen === "photo" && !hasPhoto ? "360" : chosen;
}

// A camera as Render Mesh reads it: its eye, and right, up and forward from
// its position towards its target with +Y up, and the tangent of half its
// vertical view narrowed by zoom. Null without a usable one.
export function stageFrame(camera) {
  const p = camera?.position;
  if (!p || ![p.x, p.y, p.z].every(Number.isFinite)) return null;
  const t = camera.target ?? { x: 0, y: 0, z: 0 };
  const eye = [p.x, p.y, p.z];
  let f = [t.x - p.x, t.y - p.y, t.z - p.z];
  const fl = Math.hypot(...f);
  if (!(fl > 1e-9)) return null;
  f = f.map((v) => v / fl);
  let up = Math.abs(f[1]) < 0.99 ? [0, 1, 0] : [0, 0, 1];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let right = cross(f, up);
  const rl = Math.hypot(...right);
  right = right.map((v) => v / rl);
  up = cross(right, f);
  const fov = Math.min(170, Math.max(1, Number.isFinite(camera.fov) ? camera.fov : 40));
  const zoom = Math.max(1e-3, Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1);
  return { eye, right, up, forward: f, tan: Math.tan((fov * Math.PI) / 360) / zoom };
}

// Where a vector from the photo camera's eye lands in the photo: [u, v] from
// 0 to 1 (v = 1 at the top), or null behind the camera.
export function photoUv(frame, vector, aspect) {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = dot(vector, frame.forward);
  if (!(z > 1e-9)) return null;
  return [
    (dot(vector, frame.right) / (z * frame.tan * aspect) + 1) / 2,
    (dot(vector, frame.up) / (z * frame.tan) + 1) / 2,
  ];
}

// three.js Matrix4.makeRotationFromEuler for order "ZXY", row by row (the
// 360's Turn, Tilt and Roll; _backdrop_helpers.euler_zxy_matrix).
export function eulerZXY(x, y, z) {
  const a = Math.cos(x); const b = Math.sin(x);
  const c = Math.cos(y); const d = Math.sin(y);
  const e = Math.cos(z); const f = Math.sin(z);
  const ce = c * e; const cf = c * f; const de = d * e; const df = d * f;
  return [
    ce - df * b, -a * f, de + cf * b,
    cf + de * b, a * e, df - ce * b,
    -a * d, b, a * c,
  ];
}

const VERTEX = `
varying vec2 abNdc;
`;
const FRAGMENT = `
varying vec2 abNdc;
uniform mat4 abCam;
uniform float abTan;
uniform float abAspect;
uniform float abFloorY;
uniform float abHasFloor;
uniform sampler2D abPlate;
uniform float abHasPlate;
uniform vec3 abPEye;
uniform vec3 abPRight;
uniform vec3 abPUp;
uniform vec3 abPFwd;
uniform float abPTan;
uniform float abPAspect;
uniform sampler2D abPano;
uniform float abHasPano;
uniform mat3 abSky;
uniform float abBright;
uniform vec3 abMean;
vec3 abStage() {
  vec3 ray = (abCam * vec4(abNdc.x * abTan * abAspect, abNdc.y * abTan, -1.0, 0.0)).xyz;
  vec3 eye = abCam[3].xyz;
  vec3 seen = normalize(ray);
  if (abHasFloor > 0.5 && eye.y > abFloorY && ray.y < 0.0) {
    seen = eye + ray * ((abFloorY - eye.y) / ray.y) - abPEye;
  }
  float z = dot(seen, abPFwd);
  vec2 uv = vec2(0.5);
  bool front = abHasPlate > 0.5 && z > 1e-6;
  if (front) uv = vec2(dot(seen, abPRight) / (z * abPTan * abPAspect), dot(seen, abPUp) / (z * abPTan)) * 0.5 + 0.5;
  if (front && uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) return texture2D(abPlate, uv).rgb;
  if (abHasPano > 0.5) {
    vec3 d = normalize(seen * abSky);
    vec2 pv = vec2(atan(d.z, d.x) / 6.28318530718 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.14159265359 + 0.5);
    return texture2D(abPano, pv).rgb * abBright;
  }
  if (front) {
    // Past the photo's edge: the edge, fading into a soft blur of it (the
    // texture's smallest pictures), as the run does (_stage_helpers.edge_fill).
    vec2 past = max(-uv, uv - 1.0);
    float out_ = max(past.x, past.y / abPAspect);
    vec2 edge = clamp(uv, 0.0, 1.0);
    return mix(texture2D(abPlate, edge).rgb, texture2D(abPlate, edge, 6.0).rgb, clamp(out_ / 0.12, 0.0, 1.0));
  }
  return abMean;
}
`;

function texturesIn(manager) {
  const found = [];
  if (manager.backgroundTexture?.isTexture) found.push(manager.backgroundTexture);
  manager.scene?.traverse?.((part) => {
    for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
      if (material?.map?.isTexture) found.push(material.map);
    }
  });
  return found;
}

// A three Texture class, borrowed from a texture the viewer already holds
// (the 360, or the model's own colours). Null until there is one.
function textureClass(manager) {
  for (const texture of texturesIn(manager)) {
    if (texture.constructor && !texture.isCompressedTexture && !texture.isDataTexture) return texture;
  }
  return null;
}

function makeQuad(manager) {
  const plane = manager.backgroundMesh;
  const Material = manager.backgroundColorMaterial?.constructor;
  const Attribute = plane?.geometry?.attributes?.position?.constructor;
  const Matrix3 = manager.scene?.normalMatrix?.constructor;
  const Matrix4 = manager.scene?.matrix?.constructor;
  if (!plane || !Material || !Attribute || !Matrix3 || !Matrix4) return null;
  const geometry = new plane.geometry.constructor();
  for (const name of Object.keys(geometry.attributes)) geometry.deleteAttribute(name);
  geometry.setAttribute("position", new Attribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const material = new Material({ color: 0xffffff, depthTest: false, depthWrite: false, side: 2, toneMapped: false });
  const uniforms = {
    abCam: { value: new Matrix4() }, abTan: { value: 1 }, abAspect: { value: 1 },
    abFloorY: { value: 0 }, abHasFloor: { value: 0 },
    abPlate: { value: null }, abHasPlate: { value: 0 },
    abPEye: { value: { x: 0, y: 0, z: 0 } }, abPRight: { value: { x: 1, y: 0, z: 0 } }, abPUp: { value: { x: 0, y: 1, z: 0 } },
    abPFwd: { value: { x: 0, y: 0, z: -1 } }, abPTan: { value: 1 }, abPAspect: { value: 1 },
    abPano: { value: null }, abHasPano: { value: 0 }, abSky: { value: new Matrix3() }, abBright: { value: 1 },
    abMean: { value: { x: 0.5, y: 0.5, z: 0.5 } },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERTEX + shader.vertexShader.replace(
      "#include <project_vertex>",
      "abNdc = position.xy;\n\tvec4 mvPosition = vec4(position, 1.0);\n\tgl_Position = vec4(position.xy, 0.0, 1.0);",
    );
    shader.fragmentShader = FRAGMENT + shader.fragmentShader.replace(
      "#include <map_fragment>",
      "diffuseColor.rgb = abStage();",
    );
  };
  material.customProgramCacheKey = () => "ausboss-photo-stage";
  const mesh = new plane.constructor(geometry, material);
  mesh.frustumCulled = false;
  const scene = new manager.scene.constructor();
  scene.add(mesh);
  return { scene, mesh, uniforms, camera: null, plateUrl: null, plateTexture: null, loading: null };
}

function loadPlate(manager, stage, url) {
  if (stage.plateUrl === url) return;
  const Like = textureClass(manager);
  if (!Like) return;
  stage.plateUrl = url;
  stage.plateTexture?.dispose?.();
  stage.plateTexture = null;
  const image = new Image();
  image.onload = () => {
    if (stage.plateUrl !== url) return;
    const texture = new Like.constructor(image);
    texture.colorSpace = manager.backgroundTexture?.colorSpace ?? Like.colorSpace;
    texture.needsUpdate = true;
    stage.plateTexture = texture;
    // The plate's average colour, for what lies behind the photo's camera.
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1; canvas.height = 1;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      const lin = (c) => ((c / 255) <= 0.04045 ? (c / 255) / 12.92 : (((c / 255) + 0.055) / 1.055) ** 2.4);
      stage.uniforms.abMean.value = { x: lin(r), y: lin(g), z: lin(b) };
    } catch {
      // Grey then.
    }
    manager.__ausbossViewport?.forceRender?.();
  };
  image.src = url;
}

// Draws the stage as the viewer's background. False when it cannot (no
// camera yet, nothing to show, or no texture class to borrow yet).
export function drawStage(manager, state, data, floorY, sky) {
  const camera = manager.getActiveCamera?.();
  const photo = stageFrame(data?.camera);
  if (!camera?.isPerspectiveCamera || !photo) return false;
  state.stage ??= makeQuad(manager);
  const stage = state.stage;
  if (!stage) return false;
  if (data.plate) loadPlate(manager, stage, data.plate);
  const plate = data.plate ? stage.plateTexture : null;
  const pano = manager.backgroundRenderMode === "panorama" && manager.currentBackgroundType === "image"
    ? manager.backgroundTexture : null;
  const choice = backgroundChoice(data.choice?.(), !!data.plate);
  const usePlate = choice === "photo" && !!plate;
  if (!usePlate && !pano) return false;
  camera.updateMatrixWorld();
  stage.camera = stage.camera ? stage.camera.copy(camera) : camera.clone();
  stage.camera.clearViewOffset();
  stage.camera.updateMatrixWorld();
  const u = stage.uniforms;
  u.abCam.value.copy(stage.camera.matrixWorld);
  u.abTan.value = Math.tan((stage.camera.fov * Math.PI) / 360) / (stage.camera.zoom || 1);
  u.abAspect.value = stage.camera.aspect;
  u.abHasFloor.value = Number.isFinite(floorY) ? 1 : 0;
  u.abFloorY.value = Number.isFinite(floorY) ? floorY : 0;
  u.abHasPlate.value = usePlate ? 1 : 0;
  u.abPlate.value = usePlate ? plate : null;
  const vec = (a) => ({ x: a[0], y: a[1], z: a[2] });
  u.abPEye.value = vec(photo.eye);
  u.abPRight.value = vec(photo.right);
  u.abPUp.value = vec(photo.up);
  u.abPFwd.value = vec(photo.forward);
  u.abPTan.value = photo.tan;
  const image = plate?.image;
  u.abPAspect.value = image?.width && image?.height ? image.width / image.height
    : (Number.isFinite(data.camera.aspect) ? data.camera.aspect : 1);
  u.abHasPano.value = pano ? 1 : 0;
  u.abPano.value = pano;
  const m = eulerZXY(((sky.tilt ?? 0) * Math.PI) / 180, ((sky.turn ?? 0) * Math.PI) / 180, ((sky.roll ?? 0) * Math.PI) / 180);
  // GLSL's seen * abSky multiplies by the transpose, which turns a world
  // direction into the 360's own, as the run does.
  u.abSky.value.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
  u.abBright.value = (sky.bright ?? 100) / 100;
  manager.scene.background = null;
  manager.renderer.render(stage.scene, stage.camera);
  return true;
}
