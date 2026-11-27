// face_smoke.mjs <port> [--vue] [--blocked-reads] [--only=Type,Type]
// Puts one of each of the pack's nodes on an empty graph and checks that its
// face comes up. Run it against a ComfyUI tab on the headless Chrome at
// <port> (COMFY_URL picks the server). No model is needed and nothing is
// queued, so it runs on a machine without a GPU.
//
// For each node type a node is made alone on an empty graph. It passes when
//   - the node exists and has a real size,
//   - every panel it shows is on the page with a size of its own,
//   - nothing threw while it was made (an uncaught error, or an error on the
//     console that names the pack),
//   - and no file of the pack failed to load.
// Other console errors are printed and do not fail the run: a new ComfyUI
// often says things of its own.
//
//   --vue     Nodes 2.0 instead of the classic renderer
//   --blocked-reads
//             acts like a privacy browser (Firefox's fingerprint protection,
//             canvas blockers) that hands back blank pixels when a page reads
//             a canvas. Every node that loads a picture gets a sample picture,
//             and fails when its face then draws no picture: the bug that
//             left Image Crop + Rotate + Pad's stage empty in those browsers.
//   --only=   a comma-separated list of node types
//
// Exits 1 when a node fails, 2 when the pack registered no node at all.

const args = process.argv.slice(2);
const port = args.find((arg) => !arg.startsWith("--"));
const flag = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const vue = args.includes("--vue");
const blockedReads = args.includes("--blocked-reads");
const only = flag("only")?.split(",").filter(Boolean) ?? null;
if (!port) { console.error("usage: face_smoke.mjs <port> [--vue] [--blocked-reads] [--only=Type,Type]"); process.exit(2); }

const COMFY = new URL(process.env.COMFY_URL || "http://127.0.0.1:8188/").href;
const page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => (ws.onopen = resolve));
let id = 0;
const pending = new Map();
const said = [];        // what the page said or threw, in order
const lostFiles = [];   // files of the pack that did not load
const requests = new Map();
const OF_THE_PACK = /ausboss/i;
ws.onmessage = (message) => {
  const data = JSON.parse(message.data);
  if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); return; }
  if (data.method === "Page.javascriptDialogOpening") ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
  else if (data.method === "Runtime.exceptionThrown") {
    const details = data.params.exceptionDetails;
    said.push({ thrown: true, text: String(details.exception?.description ?? details.text ?? "").slice(0, 600), url: details.url ?? "" });
  } else if (data.method === "Runtime.consoleAPICalled" && data.params.type === "error") {
    const stack = (data.params.stackTrace?.callFrames ?? []).map((frame) => frame.url).join(" ");
    said.push({ thrown: false, text: data.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ").slice(0, 600), url: stack });
  } else if (data.method === "Network.requestWillBeSent") requests.set(data.params.requestId, data.params.request.url);
  else if (data.method === "Network.responseReceived" && data.params.response.status >= 400 && OF_THE_PACK.test(data.params.response.url)) lostFiles.push(`${data.params.response.status} ${data.params.response.url}`);
  else if (data.method === "Network.loadingFailed" && !data.params.canceled && OF_THE_PACK.test(requests.get(data.params.requestId) ?? "")) lostFiles.push(`${data.params.errorText} ${requests.get(data.params.requestId)}`);
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
const ofThePack = (entry) => OF_THE_PACK.test(entry.text) || OF_THE_PACK.test(entry.url);

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1800, height: 1100, deviceScaleFactor: 1, mobile: false });
await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true });
// Blank every pixel read the page makes, before any of its code runs. The
// smoke test keeps the real read for itself, to see what a face drew.
if (blockedReads) {
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const real = CanvasRenderingContext2D.prototype.getImageData;
    Object.defineProperty(window, "__faceSmokeRealRead", { value: real });
    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
      const data = real.apply(this, args); data.data.fill(0); return data;
    };
  })();` });
}
await send("Page.navigate", { url: COMFY });
let ready = false;
for (let i = 0; i < 240 && !ready; i++) { await sleep(500); ready = await evalJs("Boolean(window.app?.graph && window.app?.canvas && window.LiteGraph?.registered_node_types)").catch(() => false); }
if (!ready) { console.error(`ComfyUI did not come up at ${COMFY}`); ws.close(); process.exit(2); }
await sleep(2500);

// The renderer is a saved setting: put it back when the run is over.
const rendererBefore = await evalJs(`window.app.extensionManager.setting.get("Comfy.VueNodes.Enabled")`);
await evalJs(`(async () => { await window.app.extensionManager.setting.set("Comfy.VueNodes.Enabled", ${vue}); return true; })()`);
await sleep(vue ? 1500 : 300);

let types = await evalJs(`Object.keys(window.LiteGraph.registered_node_types).filter((type) => type.startsWith("AUSBOSS_NODES_")).sort()`);
if (!types.length) { console.error("The pack registered no node on this page."); ws.close(); process.exit(2); }
if (only) {
  types = types.filter((type) => only.includes(type));
  if (!types.length) { console.error(`None of ${only.join(", ")} is a node of the pack on this page.`); ws.close(); process.exit(2); }
}

// The sample picture for --blocked-reads, put in ComfyUI's input folder.
const SAMPLE = "ausboss_face_smoke.png";
if (blockedReads) {
  const { readFileSync } = await import("node:fs");
  const bytes = readFileSync(new URL("../../example_workflows/inputs/ausboss_pier_sunrise.png", import.meta.url)).toString("base64");
  const uploaded = await evalJs(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(bytes)}), (c) => c.charCodeAt(0));
    const body = new FormData();
    body.append("image", new Blob([bytes], { type: "image/png" }), ${JSON.stringify(SAMPLE)});
    body.append("overwrite", "true");
    const response = await window.comfyAPI.api.api.fetchApi("/upload/image", { method: "POST", body });
    return response.ok;
  })()`).catch((error) => String(error.message ?? error));
  if (uploaded !== true) { console.error(`Could not upload the sample picture: ${uploaded}`); ws.close(); process.exit(2); }
}
// How many different colours a face's canvases show, read with the real
// pixel read. With the sample picture a face that drew it shows 350 or more;
// the empty crop stage of the bug, with its handles and tint, showed 100.
const PICTURE_COLOURS = 200;

const loading = said.splice(0).filter(ofThePack);
let failed = 0;
for (const entry of loading) { failed += 1; console.log(`FAIL while the page loaded: ${entry.text}`); }

for (const type of types) {
  said.length = 0;
  const seen = await evalJs(`(async () => {
    const { app } = window;
    app.canvas.linkConnector?.reset?.();
    // clear() resets the counter, but frontend preview caches can outlive
    // the graph. Reserve fresh ids before clearing so probes stay isolated.
    const nextNodeId = app.graph.last_node_id + 50;
    app.graph.clear(); app.graph.last_node_id = nextNodeId;
    let node;
    try { node = window.LiteGraph.createNode(${JSON.stringify(type)}); } catch (error) { return { error: "createNode threw: " + (error?.message ?? error) }; }
    if (!node) return { error: "createNode gave nothing" };
    node.pos = [0, 0]; app.graph.add(node);
    app.canvas.ds.scale = 1; app.canvas.ds.offset = [160, 230]; app.canvas.setDirty(true, true);
    await new Promise((resolve) => setTimeout(resolve, 800));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const box = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
    const host = document.querySelector('[data-node-id="' + node.id + '"]');
    // A standard widget that a card stands in for is hidden; Nodes 2.0 does
    // not put a hidden widget on the page at all, so only the others count.
    const panels = (node.widgets ?? []).filter((widget) => widget.element instanceof Element && !widget.hidden).map((widget) => ({
      name: widget.name,
      onPage: widget.element.isConnected,
      shown: widget.element.isConnected && getComputedStyle(widget.element).display !== "none",
      size: widget.element.isConnected ? box(widget.element) : [0, 0],
    }));
    let colours = null;
    const source = ${blockedReads} ? (node.widgets ?? []).find((widget) => widget.name === "image" && Array.isArray(widget.options?.values)) : null;
    if (source) {
      if (!source.options.values.includes(${JSON.stringify(SAMPLE)})) source.options.values.push(${JSON.stringify(SAMPLE)});
      source.value = ${JSON.stringify(SAMPLE)}; source.callback?.(source.value);
      app.canvas.setDirty(true, true);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const canvases = (node.widgets ?? []).filter((widget) => widget.element instanceof Element)
        .flatMap((widget) => [widget.element, ...widget.element.querySelectorAll("canvas")])
        .filter((el) => el instanceof HTMLCanvasElement && el.width > 0 && el.height > 0);
      if (canvases.length) {
        colours = 0;
        for (const canvas of canvases) {
          const data = window.__faceSmokeRealRead.call(canvas.getContext("2d"), 0, 0, canvas.width, canvas.height).data;
          const seen = new Set();
          for (let i = 0; i < data.length; i += 4 * 7) seen.add((data[i] >> 3) << 10 | (data[i + 1] >> 3) << 5 | data[i + 2] >> 3);
          colours = Math.max(colours, seen.size);
        }
      }
    }
    return { size: [Math.round(node.size[0]), Math.round(node.size[1])], drawn: host ? box(host) : null, widgets: (node.widgets ?? []).length, panels, colours };
  })()`).catch((error) => ({ error: String(error.message ?? error).slice(0, 400) }));
  await sleep(150);
  const problems = [];
  if (seen.error) problems.push(seen.error);
  else {
    if (!(seen.size[0] > 20 && seen.size[1] > 20)) problems.push(`the node's size is ${seen.size.join(" x ")}`);
    if (["AUSBOSS_NODES_CalloutTile", "AUSBOSS_NODES_WorkflowNoteTile"].includes(type) && seen.size[1] > 120) {
      problems.push("a new tile must start as a compact button, not a full-height note");
    }
    if (vue && !seen.drawn) problems.push("Nodes 2.0 drew no element for the node");
    if (seen.drawn && !(seen.drawn[0] > 20 && seen.drawn[1] > 20)) problems.push(`the node is drawn ${seen.drawn.join(" x ")}`);
    if (seen.colours != null && seen.colours < PICTURE_COLOURS) {
      problems.push(`with pixel reads blocked its face drew no picture (${seen.colours} colours on its canvas)`);
    }
    for (const panel of seen.panels) {
      if (!panel.onPage) problems.push(`its panel '${panel.name}' is not on the page`);
      else if (panel.shown && !(panel.size[0] > 4 && panel.size[1] > 4)) problems.push(`its panel '${panel.name}' is ${panel.size.join(" x ")}`);
    }
  }
  for (const entry of said) {
    if (entry.thrown || ofThePack(entry)) problems.push(`${entry.thrown ? "threw" : "console error"}: ${entry.text}`);
  }
  const others = said.filter((entry) => !entry.thrown && !ofThePack(entry));
  failed += problems.length ? 1 : 0;
  const sizes = seen.error ? "" : `  ${seen.size.join(" x ")}${seen.panels.length ? `, ${seen.panels.length} panel${seen.panels.length > 1 ? "s" : ""}` : ""}${seen.colours != null ? `, ${seen.colours} colours` : ""}`;
  console.log(`${problems.length ? "FAIL" : "ok  "} ${type}${sizes}`);
  for (const problem of problems) console.log(`       ${problem}`);
  for (const entry of others) console.log(`       (console, not counted) ${entry.text.slice(0, 200)}`);
}
for (const file of lostFiles) { failed += 1; console.log(`FAIL a file of the pack did not load: ${file}`); }

await evalJs(`(async () => { window.app.graph.clear(); await window.app.extensionManager.setting.set("Comfy.VueNodes.Enabled", ${JSON.stringify(rendererBefore ?? false)}); return true; })()`).catch(() => {});
console.log(`\n${vue ? "Nodes 2.0" : "classic"}${blockedReads ? ", pixel reads blocked" : ""}: ${types.length} nodes, ${failed} failed`);
await fetch(`http://127.0.0.1:${port}/json/close/${page.id}`).catch(() => {});
ws.close();
process.exit(failed ? 1 : 0);
