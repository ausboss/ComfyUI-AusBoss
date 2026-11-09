// Camera Move's face maths must match the node's (nodes/_camera_move_helpers.py).
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_KEYS, K0, LIM, camAt, cameraText, keyAt, parseCamera, pastLoraRange, pivotFromPixel, pose, setKeyAt, toCam, unpackDepth,
} from "../js/camera_move/camera_math.mjs";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("pose matches the node's numbers", () => {
  // From nodes/_camera_move_helpers.pose with the same key and pivot.
  const { R, C } = pose({ az: 33, el: -12, back: 0.4, px: 0.2, py: -0.1 }, [0.3, -0.2, 2.0]);
  const R_py = [0.838670567945424, -0.11323682265532711, -0.532737365365924, 0, 0.9781476007338057, -0.20791169081775934,
    0.5446390350150271, 0.17436941582062362, 0.8203436038418747];
  R.forEach((v, i) => close(v, R_py[i]));
  [1.8881747404128695, 0.3816804134905334, -0.250127706778845].forEach((v, i) => close(C[i], v));
});

test("easing between keys matches the node's", () => {
  const { keys } = parseCamera({ keys: [{ t: 0 }, { t: 0.4, az: 20, el: 10, back: 0.5 }, { t: 1, az: -10, px: 0.3 }] });
  const c = camAt(keys, 0.3);
  close(c.az, 16.875); close(c.el, 8.4375); close(c.back, 0.421875);
});

test("the camera keeps moving through a key, the same as the node", () => {
  const { keys } = parseCamera({ keys: [{ t: 0 }, { t: 0.3, az: 12 }, { t: 0.6, az: 25, el: 5 }, { t: 1, az: 40, el: 5, back: 0.4 }] });
  // From nodes/_camera_move_helpers.camera_at with the same keys.
  close(camAt(keys, 0.45).az, 18.547068965517244); close(camAt(keys, 0.8).az, 34.51724137931035);
  close(camAt(keys, 0.8).back, 0.2);
  const steady = parseCamera({ keys: [{ t: 0 }, { t: 0.5, az: 20 }, { t: 1, az: 40 }] }).keys;
  assert.ok((camAt(steady, 0.51).az - camAt(steady, 0.49).az) / 0.02 > 35);
});

test("the pivot stays where it was on screen", () => {
  const pivot = [0.3, -0.2, 2], d = Math.hypot(...pivot);
  const cam = { az: 40, el: 15, back: 0.5, px: 0, py: 0 };
  const { R, C } = pose(cam, pivot);
  const q = toCam(R, C, pivot);
  close(q[0], 0.3); close(q[1], -0.2); close(q[2], 2 + 0.5 * d);
});

test("unreadable camera text falls back to the default move", () => {
  for (const text of ["", "nope", "[]", '{"keys":[]}', null]) {
    const parsed = parseCamera(text);
    assert.equal(parsed.fallback, true);
    assert.equal(parsed.keys.length, DEFAULT_KEYS.length);
  }
});

test("camera text round-trips, clamped and sorted", () => {
  const parsed = parseCamera({ keys: [{ t: 0.9, az: 300 }, { t: 0.1, el: -90, back: 5 }], pivot: { u: 0.25, v: 2, t: 0.5 } });
  assert.deepEqual(parsed.keys.map((k) => k.t), [0.1, 0.9]);
  assert.equal(parsed.keys[1].az, LIM.az[1]);
  assert.equal(parsed.keys[0].el, LIM.el[0]);
  assert.deepEqual(parsed.pivot, { u: 0.25, v: 1, t: 0.5 });
  const again = parseCamera(cameraText(parsed));
  assert.deepEqual(again.keys, parsed.keys);
  assert.deepEqual(again.pivot, parsed.pivot);
});

test("moving the camera at the time bar sets or adds a key", () => {
  const keys = [{ t: 0, ...K0 }, { t: 1, ...K0 }];
  setKeyAt(keys, 0.5, { az: 10 });
  assert.equal(keys.length, 3);
  assert.equal(keys[1].t, 0.5);
  setKeyAt(keys, 0.505, { az: 99 });
  assert.equal(keys.length, 3);
  assert.equal(keys[1].az, 90);
  assert.equal(keyAt(keys, 0.51), 1);
  assert.equal(keyAt(keys, 0.6), -1);
});

test("the LoRA's range", () => {
  assert.equal(pastLoraRange({ az: 45, el: 30 }), false);
  assert.equal(pastLoraRange({ az: 46, el: 0 }), true);
  assert.equal(pastLoraRange({ az: 0, el: -21 }), true);
});

test("the depth picture reads back as the node wrote it", () => {
  // q = 1 is zmin, q = 65535 is zmax, 0 is sky.
  const rgba = new Uint8ClampedArray([0, 1, 0, 255, 255, 255, 0, 255, 0, 0, 0, 255]);
  const { z, valid } = unpackDepth(rgba, 3, 0.5, 40, 99);
  close(z[0], 0.5, 1e-6); close(z[1], 40, 1e-4); assert.equal(z[2], 99);
  assert.deepEqual([...valid], [1, 1, 0]);
});

test("a tapped pixel becomes a point in front of the camera", () => {
  const W = 4, H = 2, z = new Float32Array([2, 2, 2, 2, 2, 2, 2, 2]), valid = new Uint8Array([0, 0, 0, 0, 0, 1, 0, 0]);
  const frame = { W, H, z, valid, fx: 2, fy: 2, cx: 2, cy: 1 };
  const p = pivotFromPixel(frame, 0.1, 0.9);
  assert.ok(p);
  close(p[2], 2);
  assert.equal(pivotFromPixel({ ...frame, valid: new Uint8Array(8) }, 0.5, 0.5), null);
});
