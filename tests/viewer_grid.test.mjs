import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("gridHeight uses the measured floor and returns zero without a usable height", () => {
  const source = readFileSync(new URL("../js/viewer_pano/index.js", import.meta.url), "utf8")
    .replace(/^import .*;$/gm, "")
    .replace(/^export /gm, "");
  const { gridHeight } = vm.runInNewContext(source + "\n({ gridHeight })", {
    app: { registerExtension() {} },
  });

  for (const y of [-1.75, 0, 2.5]) assert.equal(gridHeight({ y }), y);
  for (const ground of [null, undefined, {}, { y: NaN }, { y: Infinity }, { y: -Infinity }, { y: "3" }]) {
    assert.equal(gridHeight(ground), 0);
  }
});

// A stand-in for ComfyUI's SceneManager: a grid, one model standing from
// y = -0.5 to 0.5, and a capture that reads the grid partway through.
function loadPatched() {
  const source = readFileSync(new URL("../js/viewer_pano/index.js", import.meta.url), "utf8")
    .replace(/^import .*;$/gm, "")
    .replace(/^export /gm, "");
  class Manager {
    constructor() {
      const points = [0, -0.5, 0, 0, 0.5, 0, 0.2, -0.5, 0.1];
      const part = {
        isMesh: true, visible: true, material: { isMeshStandardMaterial: true },
        matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
        geometry: { attributes: { position: { count: 3, getX: (i) => points[i * 3], getY: (i) => points[i * 3 + 1], getZ: (i) => points[i * 3 + 2] } } },
      };
      const model = { uuid: "m", visible: true, matrixWorld: part.matrixWorld, updateMatrixWorld() {}, traverse(fn) { fn(model); fn(part); } };
      this.gridHelper = { visible: true, position: { y: 0 }, updateMatrixWorld() {} };
      this.scene = { children: [this.gridHelper, model] };
      this.seen = [];
    }
    renderBackground() { this.seen.push(this.gridHelper.position.y); }
    captureScene() {
      if (this.fail) throw new Error("capture failed");
      this.renderBackground();
      return Promise.resolve().then(() => { this.renderBackground(); return { scene: "data" }; });
    }
  }
  const context = { app: { registerExtension() {} }, window: { comfyAPI: { SceneManager: { SceneManager: Manager } } }, console };
  vm.runInNewContext(source + "\n;this.patchSceneManager = patchSceneManager;", context);
  assert.equal(context.patchSceneManager(), true);
  return Manager;
}

test("the grid stands at the model's feet on screen and at 0 in a capture", async () => {
  const Manager = loadPatched();
  const manager = new Manager();
  manager.renderBackground();
  assert.equal(manager.gridHelper.position.y, -0.5);
  manager.seen.length = 0;
  const shot = await manager.captureScene(64, 64);
  assert.deepEqual(shot, { scene: "data" });
  assert.deepEqual(manager.seen, [0, 0]);
  assert.equal(manager.__ausbossCapturing, 0);
  manager.renderBackground();
  assert.equal(manager.gridHelper.position.y, -0.5);
});

test("a capture that throws still lets the grid go back to the feet", () => {
  const Manager = loadPatched();
  const manager = new Manager();
  manager.fail = true;
  assert.throws(() => manager.captureScene(64, 64), /capture failed/);
  assert.equal(manager.__ausbossCapturing, 0);
  manager.renderBackground();
  assert.equal(manager.gridHelper.position.y, -0.5);
});
