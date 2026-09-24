// Pre-arm the debugger on a blank tab, navigate to ComfyUI, and if the page
// stops answering, pause it and print where it is spinning.
const port = process.argv[2];
const COMFY = new URL(process.env.COMFY_URL || "http://127.0.0.1:8188/").href;
const page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) events.push(d); };
const send = (method, params = {}, ms = 5000) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); r({ timeout: method }); } }, ms); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
console.log("enable:", JSON.stringify(await send("Debugger.enable")).slice(0, 60), JSON.stringify(await send("Runtime.enable")).slice(0, 40), JSON.stringify(await send("Page.enable")).slice(0, 40));
await send("Emulation.setDeviceMetricsOverride", { width: 1800, height: 1100, deviceScaleFactor: 1, mobile: false });
await send("Network.enable"); await send("Network.clearBrowserCache"); await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Page.navigate", { url: COMFY });
let hung = false;
for (let i = 0; i < 40; i++) {
  await wait(1000);
  const r = await send("Runtime.evaluate", { expression: "Boolean(window.app?.graph?._nodes?.length)", returnByValue: true }, 3000);
  if (r.timeout) { hung = true; console.log("no answer at", i, "s"); break; }
  if (r.result?.result?.value) { console.log("graph up at", i, "s, nodes:", r.result.result.value); }
}
if (!hung) { console.log("page never hung"); ws.close(); process.exit(0); }
const p = await send("Debugger.pause", {}, 3000);
console.log("pause:", JSON.stringify(p).slice(0, 80));
for (let i = 0; i < 20 && !events.some((e) => e.method === "Debugger.paused"); i++) await wait(250);
const paused = events.find((e) => e.method === "Debugger.paused");
if (!paused) { console.log("no paused event; events:", [...new Set(events.map((e) => e.method))].join(",")); ws.close(); process.exit(0); }
console.log("PAUSED, reason", paused.params.reason);
for (const f of paused.params.callFrames.slice(0, 20)) console.log("  ", (f.functionName || "(anon)").padEnd(34), f.url.split("/").slice(-2).join("/"), f.location.lineNumber + ":" + f.location.columnNumber);
const top = paused.params.callFrames[0];
const probe = await send("Debugger.evaluateOnCallFrame", { callFrameId: top.callFrameId, expression: "(() => { try { return JSON.stringify({ this: this?.constructor?.name, title: this?.title, name: this?.name, keys: Object.keys(this ?? {}).slice(0, 12) }); } catch (e) { return String(e); } })()", returnByValue: true }, 4000);
console.log("top this:", JSON.stringify(probe.result?.result?.value ?? probe).slice(0, 400));
for (const f of paused.params.callFrames.slice(0, 6)) {
  const scope = await send("Debugger.evaluateOnCallFrame", { callFrameId: f.callFrameId, expression: "(() => { try { const o = {}; for (const k of ['name','widget','w','i','index','y','height','h','size','count']) { try { o[k] = typeof eval(k) === 'object' ? (eval(k)?.name ?? eval(k)?.constructor?.name) : eval(k); } catch {} } return JSON.stringify(o); } catch (e) { return String(e); } })()", returnByValue: true }, 4000);
  console.log("  locals@" + (f.functionName || "anon") + ":", JSON.stringify(scope.result?.result?.value ?? scope).slice(0, 300));
}
ws.close();
