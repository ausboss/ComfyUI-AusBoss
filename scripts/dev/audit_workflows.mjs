// Load each example on a real canvas; export the actual API graph and a
// screenshot, and report missing classes, overlaps and exposed number widgets.
// node scripts/dev/audit_workflows.mjs <cdp-port> <output-dir> [workflow.json ...]
import fs from "node:fs";
import path from "node:path";

const [port, outDir, ...requested] = process.argv.slice(2);
if (!port || !outDir) throw new Error("Expected CDP port and output directory");
fs.mkdirSync(outDir, { recursive: true });
const root = new URL(process.env.COMFY_URL || "http://127.0.0.1:8188/").href;
const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const tab = tabs.find(t => t.type === "page" && t.url.startsWith(root));
if (!tab) throw new Error("Open ComfyUI with cdp.mjs first");
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(resolve => { ws.onopen = resolve; });
let serial = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (pending.has(message.id)) {
    const { resolve, reject, timer } = pending.get(message.id);
    clearTimeout(timer); pending.delete(message.id);
    message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
  } else if (message.method === "Runtime.exceptionThrown") {
    exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  } else if (message.method === "Page.javascriptDialogOpening") {
    void send("Page.handleJavaScriptDialog", { accept: true });
  }
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 45000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result?.value;
}
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 3200, height: 1800, deviceScaleFactor: 1, mobile: false });
const files = requested.length ? requested : fs.readdirSync("example_workflows").filter(p => p.endsWith(".json")).sort().map(p => path.join("example_workflows", p));
const reports = [];
try {
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    exceptions.length = 0;
    const report = await evaluate(`(async () => {
      const app = window.app;
      app.canvas.linkConnector?.reset();
      await app.loadGraphData(${JSON.stringify(data)}, true, true, null, {showMissingNodesDialog:false,showMissingModelsDialog:false});
      await new Promise(r => setTimeout(r, 900));
      const nodes = app.graph._nodes;
      const overlaps = [];
      for (let i=0;i<nodes.length;i++) for (const b of nodes.slice(i+1)) {
        const a=nodes[i];
        if (Math.min(a.pos[0]+a.size[0],b.pos[0]+b.size[0]) > Math.max(a.pos[0],b.pos[0])+1 &&
            Math.min(a.pos[1]+a.size[1],b.pos[1]+b.size[1]) > Math.max(a.pos[1]-30,b.pos[1]-30)+1) overlaps.push([a.id,b.id]);
      }
      const x0=Math.min(...nodes.map(n=>n.pos[0]))-40, y0=Math.min(...nodes.map(n=>n.pos[1]))-100;
      const x1=Math.max(...nodes.map(n=>n.pos[0]+n.size[0]))+40, y1=Math.max(...nodes.map(n=>n.pos[1]+n.size[1]))+40;
      const canvas=app.canvas.canvas;
      const scale=Math.min((canvas.clientWidth-180)/(x1-x0),(canvas.clientHeight-280)/(y1-y0),1);
      app.canvas.ds.scale=scale; app.canvas.ds.offset=[-x0+80/scale,-y0+180/scale];app.canvas.setDirty(true,true);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return {overlaps, missing:nodes.filter(n=>n.has_errors).map(n=>({id:n.id,type:n.type})),
        nodes:nodes.map(n=>({id:n.id,type:n.type,pos:[...n.pos],size:[...n.size],
          classicNumbers:n.type.startsWith('AUSBOSS_NODES_') ? (n.widgets??[]).filter(w=>w.type==='number' && !w.hidden).map(w=>w.name):[]})),
        prompt:await app.graphToPrompt()};
    })()`);
    const stem = path.basename(file, ".json");
    fs.writeFileSync(path.join(outDir, `${stem}.api.json`), JSON.stringify(report.prompt.output, null, 2)+"\n");
    fs.writeFileSync(path.join(outDir, `${stem}.loaded.json`), JSON.stringify(report.prompt.workflow, null, 2)+"\n");
    delete report.prompt;
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(outDir, `${stem}.png`), Buffer.from(shot.data, "base64"));
    reports.push({ file, ...report, exceptions: [...exceptions] });
    console.log(JSON.stringify({file,overlaps:report.overlaps,missing:report.missing,exceptions}));
  }
} finally {
  fs.writeFileSync(path.join(outDir, "canvas-audit.json"), JSON.stringify(reports,null,2)+"\n");
  ws.close();
}
const failures = reports.filter(report => report.overlaps.length || report.missing.length ||
  report.exceptions.length || report.nodes.some(node => node.classicNumbers.length));
console.log(`${reports.length - failures.length}/${reports.length} canvas audits passed.`);
if (failures.length) process.exitCode = 1;
