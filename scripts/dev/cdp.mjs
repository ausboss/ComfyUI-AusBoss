// cdp.mjs <port> <workflow.json|-> <out.png|-> [evalFile] [waitMs]
// Opens/reuses a ComfyUI tab on the headless Chrome at <port>, optionally
// loads a workflow JSON into the graph, evaluates a JS snippet file, and
// screenshots the page. Prints the eval result as JSON.
import fs from "node:fs";
const [port, wfPath, outPng, evalFile, waitArg] = process.argv.slice(2);
const waitMs = Number(waitArg ?? 1500);
const COMFY = new URL(process.env.COMFY_URL || "http://127.0.0.1:8188/").href;
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
let page = list.find((t) => t.type === "page" && t.url.startsWith(COMFY));
if (page && process.env.CDP_RELOAD === "1") {
  // A fresh tab rather than an in-place navigation: after synthetic mouse
  // input the old tab stops answering on navigate (see cdp_nav_debug.mjs).
  await fetch(`http://127.0.0.1:${port}/json/close/${page.id}`);
  page = null;
}
if (!page) page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method === "Page.javascriptDialogOpening") { ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: true } })); } };
const send = (method, params = {}) => new Promise((r, reject) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error(`CDP timeout: ${method}`)); } }, 25000); });
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails));
  return r.result?.result?.value;
};
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1800, height: 1100, deviceScaleFactor: 1, mobile: false });
if (process.env.CDP_RELOAD === "1" || !page.url.startsWith(COMFY)) {
  await send("Network.enable"); await send("Network.clearBrowserCache"); await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Page.navigate", { url: COMFY });
  for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 500)); if (await evalJs("Boolean(window.app?.graph && window.app?.canvas)")) break; }
  await new Promise((r) => setTimeout(r, 1500));
}
if (wfPath && wfPath !== "-") {
  const wf = fs.readFileSync(wfPath, "utf-8");
  await evalJs(`(async () => { await window.app.loadGraphData(${wf}, true, true, null, { showMissingNodesDialog: false, showMissingModelsDialog: false }); return true; })()`);
  await new Promise((r) => setTimeout(r, waitMs));
}
let result = null;
if (evalFile && evalFile !== "-") {
  result = await evalJs(fs.readFileSync(evalFile, "utf-8"));
  await new Promise((r) => setTimeout(r, waitMs));
}
if (outPng && outPng !== "-") {
  const clip = result && typeof result === "object" && result.__clip ? { ...result.__clip, scale: 1 } : undefined;
  const shot = await send("Page.captureScreenshot", clip ? { format: "png", clip } : { format: "png" });
  fs.writeFileSync(outPng, Buffer.from(shot.result.data, "base64"));
}
console.log(JSON.stringify(result, null, 1));
ws.close();
