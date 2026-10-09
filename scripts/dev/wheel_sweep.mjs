// wheel_sweep.mjs <port> [--vue] [--real] [--only=Type,Type] [--step=N] [--shots=dir] [--workflow=file.json]
// Turns the mouse wheel over every part of every node of the pack and
// reports each spot where the graph did not zoom. Run it against a ComfyUI
// tab on the headless Chrome at <port> (COMFY_URL picks the server).
//
// For each node type it creates the node alone on an empty graph, walks a
// grid of points across the whole node (title, sockets, panel, edges) and
// turns the wheel at each one. A point is "dead" when the graph was not
// asked to zoom. Dead points are grouped by the element under them, so the
// report names what swallowed the wheel. Exits 1 when any point is dead that
// is not listed in KEEPS_WHEEL.
//
// The zoom itself is held back while the sweep runs (the graph's changeScale
// only counts its calls), so the node stays put under the grid.
//
// By default the wheel event is made in the page and sent to the element
// the browser finds under the point, which is fast enough for a 4 px grid: a
// card's padding is a strip a few pixels wide, and a coarse grid steps over
// it. --real sends real wheel turns through the browser instead, about 20 a
// second, on a 12 px grid.
//
//   --vue        sweep in Nodes 2.0 instead of the classic renderer
//   --real       real wheel turns (slow), not events made in the page
//   --only=      a comma-separated list of node types
//   --step=      the grid step in pixels (default 4, or 12 with --real)
//   --shots=     a folder for one picture per node with a dead spot, the
//                dead points marked in red
//   --workflow=  sweep the nodes of this workflow as it loads (their real
//                values and sizes) instead of one fresh node per type
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const port = args.find((arg) => !arg.startsWith("--"));
const flag = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const vue = args.includes("--vue");
const only = flag("only")?.split(",").filter(Boolean) ?? null;
const real = args.includes("--real");
const step = Number(flag("step") ?? (real ? 12 : 4));
const shots = flag("shots");
const workflow = flag("workflow");
if (!port) { console.error("usage: wheel_sweep.mjs <port> [--vue] [--real] [--only=Type,Type] [--step=N] [--shots=dir] [--workflow=file.json]"); process.exit(2); }

// Parts of a face that use the wheel themselves, on purpose, as patterns for
// the "under" text of the report: a list long enough to scroll, say, when a
// workflow is swept. A point over one is reported as "kept", not as a
// failure. A fresh node has none.
const KEEPS_WHEEL = [];

const COMFY = new URL(process.env.COMFY_URL || "http://127.0.0.1:8188/").href;
const page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => (ws.onopen = resolve));
let id = 0;
const pending = new Map();
ws.onmessage = (message) => {
  const data = JSON.parse(message.data);
  if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); }
  else if (data.method === "Page.javascriptDialogOpening") ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const call = ++id;
  pending.set(call, resolve);
  ws.send(JSON.stringify({ id: call, method, params }));
  const timer = setTimeout(() => { if (pending.has(call)) { pending.delete(call); reject(new Error(`CDP timeout: ${method}`)); } }, 25000);
  timer.unref?.();
});
const evalJs = async (expression) => {
  const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails));
  return reply.result?.result?.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1800, height: 1100, deviceScaleFactor: 1, mobile: false });
await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Page.navigate", { url: COMFY });
for (let i = 0; i < 80; i++) { await sleep(500); if (await evalJs("Boolean(window.app?.graph && window.app?.canvas)")) break; }
await sleep(1500);

// The renderer is a saved setting: put it back when the sweep is over.
const rendererBefore = await evalJs(`window.app.extensionManager.setting.get("Comfy.VueNodes.Enabled")`);
await evalJs(`(async () => {
  await window.app.extensionManager.setting.set("Comfy.VueNodes.Enabled", ${vue});
  window.app.canvas.ds.changeScale = () => { window.__sweep.zooms += 1; };
  window.__sweep = {
    zooms: 0,
    home() {
      const canvas = window.app.canvas;
      canvas.ds.scale = 1; canvas.ds.offset = [160, 230]; canvas.setDirty(true, true);
    },
    frame: () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    rectOf(node) {
      const vueNode = document.querySelector('[data-node-id="' + node.id + '"]');
      if (vueNode) { const r = vueNode.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }
      const canvas = window.app.canvas; const r = canvas.canvas.getBoundingClientRect();
      const title = window.LiteGraph.NODE_TITLE_HEIGHT;
      const [ox, oy] = canvas.ds.offset; const s = canvas.ds.scale;
      return { x: r.left + (node.pos[0] + ox) * s, y: r.top + (node.pos[1] - title + oy) * s, width: node.size[0] * s, height: (node.size[1] + title) * s };
    },
    // Names the element under a point: the nearest few classes up the tree.
    describe(x, y) {
      const parts = [];
      for (let el = document.elementFromPoint(x, y), depth = 0; el && depth < 4; el = el.parentElement, depth++) {
        const cls = typeof el.className === "string" ? el.className.split(/\\s+/).filter(Boolean).slice(0, 2).join(".") : "";
        parts.push(el.tagName.toLowerCase() + (cls ? "." + cls : ""));
      }
      return parts.join(" < ");
    },
    // The wheel at every grid point of a rect, as events made in the page.
    sweep(rect, step) {
      const dead = [];
      let points = 0;
      for (let y = rect.y + 2; y < rect.y + rect.height - 1; y += step) {
        for (let x = rect.x + 2; x < rect.x + rect.width - 1; x += step) {
          const target = document.elementFromPoint(x, y);
          if (!target) continue;
          points += 1;
          this.zooms = 0;
          target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, deltaY: -120, deltaMode: 0 }));
          if (!this.zooms) dead.push({ x, y, under: this.describe(x, y) });
        }
      }
      this.zooms = 0;
      return { points, dead };
    },
    mark(points) {
      document.getElementById("__sweep_marks")?.remove();
      const layer = document.createElement("div");
      layer.id = "__sweep_marks";
      layer.style.cssText = "position:fixed;inset:0;z-index:99999;pointer-events:none";
      for (const [x, y] of points) {
        const dot = document.createElement("div");
        dot.style.cssText = "position:absolute;width:4px;height:4px;margin:-2px 0 0 -2px;border-radius:50%;background:#ff2d2d;left:" + x + "px;top:" + y + "px";
        layer.append(dot);
      }
      document.body.append(layer);
    },
  };
  return true;
})()`);
await sleep(vue ? 1500 : 300);

let targets;
if (workflow) {
  const data = fs.readFileSync(workflow, "utf-8");
  await evalJs(`(async () => { await window.app.loadGraphData(${data}, true, true, null, { showMissingNodesDialog: false, showMissingModelsDialog: false }); return true; })()`);
  await sleep(2500);
  targets = await evalJs(`window.app.graph.nodes.filter((n) => String(n.type).startsWith("AUSBOSS_NODES_")).map((n) => ({ type: n.type, id: n.id }))`);
} else {
  const types = await evalJs(`Object.keys(window.LiteGraph.registered_node_types).filter((type) => type.startsWith("AUSBOSS_NODES_")).sort()`);
  targets = types.map((type) => ({ type, id: null }));
}
if (only) targets = targets.filter((target) => only.includes(target.type));

if (shots) fs.mkdirSync(shots, { recursive: true });
let failed = 0;
for (const target of targets) {
  const rect = await evalJs(`(async () => {
    const { app } = window;
    let node;
    if (${JSON.stringify(target.id)} == null) {
      app.canvas.linkConnector?.reset?.();
      app.graph.clear(); app.graph.last_node_id += 50;
      node = window.LiteGraph.createNode(${JSON.stringify(target.type)});
      node.pos = [0, 0]; app.graph.add(node);
      window.__sweep.home();
    } else {
      node = app.graph.getNodeById(${JSON.stringify(target.id)});
      app.canvas.ds.scale = 1;
      app.canvas.ds.offset = [160 - node.pos[0], 230 - node.pos[1]];
      app.canvas.setDirty(true, true);
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
    await window.__sweep.frame();
    return window.__sweep.rectOf(node);
  })()`);
  let dead = [];
  let points = 0;
  if (real) {
    for (let y = rect.y + 2; y < rect.y + rect.height - 1; y += step) {
      for (let x = rect.x + 2; x < rect.x + rect.width - 1; x += step) {
        const px = Math.round(x), py = Math.round(y);
        if (px < 0 || py < 0 || px >= 1800 || py >= 1100) continue;
        points += 1;
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: px, y: py });
        await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: px, y: py, deltaX: 0, deltaY: -120 });
        const under = await evalJs(`(() => {
          const zoomed = window.__sweep.zooms > 0;
          window.__sweep.zooms = 0;
          return zoomed ? "" : window.__sweep.describe(${px}, ${py});
        })()`);
        if (under) dead.push({ x: px, y: py, under });
      }
    }
  } else {
    ({ points, dead } = await evalJs(`window.__sweep.sweep(${JSON.stringify(rect)}, ${step})`));
  }
  const groups = new Map();
  for (const point of dead) groups.set(point.under, (groups.get(point.under) ?? 0) + 1);
  const rows = [...groups].map(([under, count]) => ({ under, count, kept: KEEPS_WHEEL.some((rule) => rule.test(under)) }));
  const bad = rows.filter((row) => !row.kept).reduce((sum, row) => sum + row.count, 0);
  failed += bad;
  console.log(`${bad ? "DEAD" : "ok  "} ${target.type}  ${points} points, ${bad} dead${dead.length - bad ? `, ${dead.length - bad} kept on purpose` : ""}`);
  for (const row of rows) console.log(`       ${row.kept ? "kept" : "dead"} x${row.count}  ${row.under}`);
  if (shots && dead.length) {
    await evalJs(`window.__sweep.mark(${JSON.stringify(dead.map((point) => [point.x, point.y]))})`);
    const clip = { x: Math.max(0, rect.x - 14), y: Math.max(0, rect.y - 14), width: rect.width + 28, height: rect.height + 28, scale: 1 };
    const shot = await send("Page.captureScreenshot", { format: "png", clip });
    fs.writeFileSync(path.join(shots, `${target.type}${target.id == null ? "" : `_${target.id}`}_${vue ? "vue" : "classic"}.png`), Buffer.from(shot.result.data, "base64"));
    await evalJs(`document.getElementById("__sweep_marks")?.remove()`);
  }
}
console.log(`\n${vue ? "Nodes 2.0" : "classic"}: ${targets.length} nodes, ${failed} dead points`);
await evalJs(`window.app.extensionManager.setting.set("Comfy.VueNodes.Enabled", ${JSON.stringify(Boolean(rendererBefore))}).then(() => true)`);
await fetch(`http://127.0.0.1:${port}/json/close/${page.id}`).catch(() => {});
ws.close();
process.exit(failed ? 1 : 0);
