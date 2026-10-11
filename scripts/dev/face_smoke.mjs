// face_smoke.mjs <port> [--vue] [--only=Type,Type]
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
//   --only=   a comma-separated list of node types
//
// Exits 1 when a node fails, 2 when the pack registered no node at all.

const args = process.argv.slice(2);
const port = args.find((arg) => !arg.startsWith("--"));
const flag = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const vue = args.includes("--vue");
const only = flag("only")?.split(",").filter(Boolean) ?? null;
if (!port) { console.error("usage: face_smoke.mjs <port> [--vue] [--only=Type,Type]"); process.exit(2); }

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

const loading = said.splice(0).filter(ofThePack);
let failed = 0;
for (const entry of loading) { failed += 1; console.log(`FAIL while the page loaded: ${entry.text}`); }

for (const type of types) {
  said.length = 0;
  const seen = await evalJs(`(async () => {
    const { app } = window;
    app.canvas.linkConnector?.reset?.();
    app.graph.clear(); app.graph.last_node_id += 50;
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
    return { size: [Math.round(node.size[0]), Math.round(node.size[1])], drawn: host ? box(host) : null, widgets: (node.widgets ?? []).length, panels };
  })()`).catch((error) => ({ error: String(error.message ?? error).slice(0, 400) }));
  await sleep(150);
  const problems = [];
  if (seen.error) problems.push(seen.error);
  else {
    if (!(seen.size[0] > 20 && seen.size[1] > 20)) problems.push(`the node's size is ${seen.size.join(" x ")}`);
    if (vue && !seen.drawn) problems.push("Nodes 2.0 drew no element for the node");
    if (seen.drawn && !(seen.drawn[0] > 20 && seen.drawn[1] > 20)) problems.push(`the node is drawn ${seen.drawn.join(" x ")}`);
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
  const sizes = seen.error ? "" : `  ${seen.size.join(" x ")}${seen.panels.length ? `, ${seen.panels.length} panel${seen.panels.length > 1 ? "s" : ""}` : ""}`;
  console.log(`${problems.length ? "FAIL" : "ok  "} ${type}${sizes}`);
  for (const problem of problems) console.log(`       ${problem}`);
  for (const entry of others) console.log(`       (console, not counted) ${entry.text.slice(0, 200)}`);
}
for (const file of lostFiles) { failed += 1; console.log(`FAIL a file of the pack did not load: ${file}`); }

await evalJs(`(async () => { window.app.graph.clear(); await window.app.extensionManager.setting.set("Comfy.VueNodes.Enabled", ${JSON.stringify(rendererBefore ?? false)}); return true; })()`).catch(() => {});
console.log(`\n${vue ? "Nodes 2.0" : "classic"}: ${types.length} nodes, ${failed} failed`);
await fetch(`http://127.0.0.1:${port}/json/close/${page.id}`).catch(() => {});
ws.close();
process.exit(failed ? 1 : 0);
