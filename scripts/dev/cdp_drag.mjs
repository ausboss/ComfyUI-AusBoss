// cdp_drag.mjs <port> <setupEval> <midPng|-> <afterPng|-> [checkEval]
// setupEval must return { from:{x,y}, to:{x,y}, __clip }. Presses the mouse
// at `from`, moves to `to` in steps, screenshots mid-drag, releases, then
// evaluates checkEval and screenshots again.
import fs from "node:fs";
const [port, setupFile, midPng, afterPng, checkFile] = process.argv.slice(2);
const COMFY = new URL(process.env.COMFY_URL || "http://127.0.0.1:8188/").href;
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === "page" && t.url.startsWith(COMFY));
if (!page) throw new Error("no comfy tab");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method === "Page.javascriptDialogOpening") { ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: true } })); } };
const send = (method, params = {}) => new Promise((r, reject) => { const i = ++id; const timer = setTimeout(() => { pending.delete(i); reject(new Error(`CDP timeout: ${method}`)); }, 25000); pending.set(i, (d) => { clearTimeout(timer); r(d); }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails));
  return r.result?.result?.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (file, clip) => { if (!file || file === "-") return; const s = await send("Page.captureScreenshot", clip ? { format: "png", clip: { ...clip, scale: 1 } } : { format: "png" }); fs.writeFileSync(file, Buffer.from(s.result.data, "base64")); };
await evalJs("(() => { try { app.canvas.linkConnector?.reset?.(); } catch {} return true; })()");
await send("Page.enable");
const setup = await evalJs(fs.readFileSync(setupFile, "utf-8"));
const { from, to, __clip } = setup;
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, pointerType: "mouse", ...extra });
await mouse("mouseMoved", from.x, from.y, { buttons: 0 });
await wait(80);
await mouse("mousePressed", from.x, from.y, { clickCount: 1 });
await wait(80);
const steps = 12;
for (let i = 1; i <= steps; i++) { await mouse("mouseMoved", from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await wait(30); }
await wait(250);
try { await shot(midPng, __clip); } finally { await mouse("mouseReleased", to.x, to.y, { clickCount: 1 }); }
await wait(400);
let check = null;
if (checkFile && checkFile !== "-") check = await evalJs(fs.readFileSync(checkFile, "utf-8"));
await wait(300);
await shot(afterPng, __clip);
console.log(JSON.stringify({ setup: { from, to }, check }, null, 1));
ws.close();
