// Camera Move: the camera maths the face shares with the node.
//
// The same keys, pose and easing as nodes/_camera_move_helpers.py, so the
// picture on the node is the shot the warp makes. No DOM and no app import:
// tests/camera_move.test.mjs runs it under node:test.
//
// Axes are OpenCV's: x right, y down, z into the picture. A key is
// { t, az, el, back, px, py }: t from 0 to 1 over the clip, turn and rise in
// degrees, back and the pan in distances to the pivot.

export const LIM = { az: [-90, 90], el: [-30, 60], back: [-0.6, 2], px: [-1, 1], py: [-1, 1] };
export const K0 = { az: 0, el: 0, back: 0, px: 0, py: 0 };
export const FIELDS = Object.keys(K0);
// Two keys this close on the clip are the same key.
export const SAME_KEY = 0.015;
export const MAX_KEYS = 64;
export const LORA_RANGE = { az: 45, up: 30, down: -20 };
export const DEFAULT_KEYS = [{ t: 0, ...K0 }, { t: 1, ...K0, az: 30, el: 5 }];

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function cleanKey(raw) {
  const key = { t: clamp(num(raw?.t), 0, 1) };
  for (const name of FIELDS) key[name] = clamp(num(raw?.[name]), ...LIM[name]);
  return key;
}

// The camera a node holds: { keys, pivot }. Unreadable text gives the default move.
export function parseCamera(text) {
  let data = null;
  if (text && typeof text === "object") data = text;
  else if (typeof text === "string" && text.trim()) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  const fallback = !data || !Array.isArray(data.keys) || !data.keys.length;
  if (fallback) data = { keys: DEFAULT_KEYS, pivot: null };
  const keys = [];
  for (const raw of data.keys.slice(0, MAX_KEYS)) {
    const key = cleanKey(raw);
    const same = keys.find((k) => Math.abs(k.t - key.t) < SAME_KEY);
    if (same) Object.assign(same, key);
    else keys.push(key);
  }
  keys.sort((a, b) => a.t - b.t);
  const p = data.pivot;
  const pivot = p && typeof p === "object" && "u" in p && "v" in p
    ? { u: clamp(num(p.u, 0.5), 0, 1), v: clamp(num(p.v, 0.5), 0, 1), t: clamp(num(p.t), 0, 1) }
    : null;
  return { keys, pivot, fallback };
}

const round = (v, places) => Math.round(v * 10 ** places) / 10 ** places;

export function cameraText({ keys, pivot }) {
  const out = {
    v: 1,
    keys: keys.map((k) => ({ t: round(k.t, 4), az: round(k.az, 2), el: round(k.el, 2), back: round(k.back, 3), px: round(k.px, 3), py: round(k.py, 3) })),
    pivot: pivot ? { u: round(pivot.u, 4), v: round(pivot.v, 4), t: round(pivot.t, 4) } : null,
  };
  return JSON.stringify(out);
}

// How fast one field moves as it passes each key: zero at the first and last
// key (a gentle start and end) and where the field turns back or holds (it
// never runs past a key); elsewhere it keeps its speed through the key, so a
// move made of several keys does not slow down at each one.
function keySlopes(ts, ys) {
  const n = ys.length, m = new Array(n).fill(0);
  for (let k = 1; k < n - 1; k++) {
    const h0 = ts[k] - ts[k - 1], h1 = ts[k + 1] - ts[k];
    if (h0 <= 0 || h1 <= 0) continue;
    const d0 = (ys[k] - ys[k - 1]) / h0, d1 = (ys[k + 1] - ys[k]) / h1;
    if (d0 * d1 > 0) m[k] = 3 * (h0 + h1) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1);
  }
  return m;
}

// Where the camera is at moment t: through every key, gently at the ends.
// Same maths as camera_at in nodes/_camera_move_helpers.py.
export function camAt(keys, t) {
  if (!keys.length) return { ...K0 };
  const n = keys.length;
  const pick = (k) => { const o = {}; for (const f of FIELDS) o[f] = k[f] || 0; return o; };
  if (n === 1 || t <= keys[0].t) return pick(keys[0]);
  if (t >= keys[n - 1].t) return pick(keys[n - 1]);
  const ts = keys.map((k) => k.t);
  for (let i = 0; i < n - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t >= a.t && t <= b.t) {
      const h = Math.max(1e-6, b.t - a.t), s = (t - a.t) / h;
      const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
      const o = {};
      for (const f of FIELDS) {
        const m = keySlopes(ts, keys.map((k) => k[f] || 0));
        o[f] = h00 * (a[f] || 0) + h10 * h * m[i] + h01 * (b[f] || 0) + h11 * h * m[i + 1];
      }
      return o;
    }
  }
  return pick(keys[n - 1]);
}

export const keyAt = (keys, t) => keys.findIndex((k) => Math.abs(k.t - t) < SAME_KEY);

// Moving the camera at the time bar sets the key there, or adds one.
export function setKeyAt(keys, t, cam) {
  const c = {};
  for (const f of FIELDS) c[f] = clamp(num(cam[f]), ...LIM[f]);
  const i = keyAt(keys, t);
  if (i >= 0) { Object.assign(keys[i], c); return keys; }
  if (keys.length >= MAX_KEYS) return keys;
  keys.push({ t: clamp(t, 0, 1), ...c });
  keys.sort((a, b) => a.t - b.t);
  return keys;
}

export const pastLoraRange = (c) => Math.abs(c.az) > LORA_RANGE.az || c.el > LORA_RANGE.up || c.el < LORA_RANGE.down;

// R = Ry(-az) Rx(-el), row-major.
export function rot(az, el) {
  const th = -az * Math.PI / 180, ph = -el * Math.PI / 180;
  const ct = Math.cos(th), st = Math.sin(th), cp = Math.cos(ph), sp = Math.sin(ph);
  return [ct, st * sp, st * cp, 0, cp, -sp, -st, ct * sp, ct * cp];
}
export const mv = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];

// The moved camera's rotation R and centre C. Pan slides the camera in its own frame.
export function pose(cam, pivot) {
  const R = rot(cam.az, cam.el), p = pivot, Rp = mv(R, p), d = Math.hypot(p[0], p[1], p[2]);
  const b = mv(R, [(cam.px || 0) * d, (cam.py || 0) * d, -(cam.back || 0) * d]);
  return { R, C: [p[0] - Rp[0] + b[0], p[1] - Rp[1] + b[1], p[2] - Rp[2] + b[2]] };
}

// A world point in the moved camera: R^T (P - C).
export function toCam(R, C, P) {
  const d = [P[0] - C[0], P[1] - C[1], P[2] - C[2]];
  return [R[0] * d[0] + R[3] * d[1] + R[6] * d[2], R[1] * d[0] + R[4] * d[1] + R[7] * d[2], R[2] * d[0] + R[5] * d[1] + R[8] * d[2]];
}

// The node's depth picture: red is the high byte, green the low one, on a log
// scale from zmin to zmax; 0 is no depth (sky), which sits at `far`.
export function unpackDepth(rgba, count, zmin, zmax, far) {
  const z = new Float32Array(count), valid = new Uint8Array(count);
  const lmin = Math.log(zmin), lr = Math.log(zmax) - lmin;
  for (let i = 0; i < count; i++) {
    const q = rgba[i * 4] * 256 + rgba[i * 4 + 1];
    if (q === 0) z[i] = far;
    else { z[i] = Math.exp(lmin + (q - 1) / 65534 * lr); valid[i] = 1; }
  }
  return { z, valid };
}

// The 3D spot under a pixel of a frame: the middle of the nearest depth found
// within three pixels, as the node does it. Null over sky.
export function pivotFromPixel(frame, u, v) {
  const { W, H, z, valid, fx, fy, cx, cy } = frame;
  const x = clamp(Math.floor(u * W), 0, W - 1), y = clamp(Math.floor(v * H), 0, H - 1);
  for (let r = 0; r <= 3; r++) {
    const found = [];
    for (let yy = Math.max(0, y - r); yy <= Math.min(H - 1, y + r); yy++) {
      for (let xx = Math.max(0, x - r); xx <= Math.min(W - 1, x + r); xx++) if (valid[yy * W + xx]) found.push(z[yy * W + xx]);
    }
    if (found.length) {
      found.sort((a, b) => a - b);
      const depth = found.length % 2 ? found[found.length >> 1] : (found[found.length / 2 - 1] + found[found.length / 2]) / 2;
      return [(x + 0.5 - cx) / fx * depth, (y + 0.5 - cy) / fy * depth, depth];
    }
  }
  return null;
}

// Words for where the camera is.
export function fmtAz(v) { const r = Math.round(v); return r === 0 ? "0°" : `${Math.abs(r)}° ${r > 0 ? "right" : "left"}`; }
export function fmtEl(v) { const r = Math.round(v); return r === 0 ? "0°" : `${Math.abs(r)}° ${r > 0 ? "up" : "down"}`; }
export function describe(c) {
  const part = (v, neg, pos) => (Math.abs(v) < 0.005 ? "" : `${Math.abs(v).toFixed(2)} ${v > 0 ? pos : neg}`);
  const pan = [part(c.px, "left", "right"), part(c.py, "up", "down")].filter(Boolean).join(", ");
  return `Turn ${fmtAz(c.az)} · Rise ${fmtEl(c.el)} · ${c.back < -0.004 ? "In" : "Back"} ${Math.abs(c.back).toFixed(2)}×${pan ? ` · Pan ${pan}` : ""}`;
}
