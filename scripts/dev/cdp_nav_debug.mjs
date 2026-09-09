// Navigate the Comfy tab in place and log every CDP event for 25 s, so a
// crash (Inspector.targetCrashed) or a dialog (Page.javascriptDialogOpening)
// shows itself.
const port = process.argv[2];
const COMFY = "http://127.0.0.1:8188/";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === "page" && t.url.startsWith(COMFY));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) { events.push(d.method); if (d.method === "Page.javascriptDialogOpening") { console.log("DIALOG:", JSON.stringify(d.params).slice(0, 200)); ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: true } })); } if (d.method === "Inspector.targetCrashed") console.log("TARGET CRASHED"); } };
const send = (method, params = {}, ms = 8000) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); r({ timeout: method }); } }, ms); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
console.log("enable:", JSON.stringify(await send("Page.enable")).slice(0, 40), JSON.stringify(await send("Runtime.enable")).slice(0, 40), JSON.stringify(await send("Inspector.enable")).slice(0, 40));
console.log("modified?", JSON.stringify(await send("Runtime.evaluate", { expression: "String(window.app?.workflowManager?.activeWorkflow?.isModified ?? window.app?.workflowManager?.activeWorkflow?.modified ?? 'n/a')", returnByValue: true })).slice(0, 120));
const nav = send("Page.navigate", { url: COMFY }, 20000);
for (let i = 0; i < 25; i++) { await wait(1000); const r = await send("Runtime.evaluate", { expression: "1+1", returnByValue: true }, 1500); if (!r.timeout) { console.log("alive at", i, "s"); break; } }
console.log("navigate:", JSON.stringify(await nav).slice(0, 160));
console.log("events:", [...new Set(events)].join(", "));
ws.close();
