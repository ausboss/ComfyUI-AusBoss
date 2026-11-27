// h3_sockets_check.mjs <port> [--vue]
//
// H3 Prompt Writer draws only the sockets in use. This puts the node on a
// real canvas and reads what is on the screen: which socket rows are drawn,
// what a run would send, and what a save would write. It fails when a row
// shows or hides against the rule (js/shared/h3_sockets.mjs), when a wire
// would be sent from the wrong output, or when the saved node changes.
//
//   <port>  the debugging port of a headless Chrome (docs/live_testing.md)
//   --vue   Nodes 2.0 instead of the classic renderer
//
// COMFY_URL points at the ComfyUI to test (default http://127.0.0.1:8188/).
// H3_LIVE_WORKFLOWS, a list of workflow files split by the path delimiter,
// adds a check that every wired output of the node in them still shows.
import { readFileSync } from "node:fs";
import { delimiter } from "node:path";
import { INPUT_NAMES, OUTPUT_NAMES, socketsToShow } from "../../js/shared/h3_sockets.mjs";

const args = process.argv.slice(2);
const port = args.find((arg) => !arg.startsWith("--"));
const vue = args.includes("--vue");
if (!port) { console.error("usage: h3_sockets_check.mjs <port> [--vue]"); process.exit(2); }

const NODE = "AUSBOSS_NODES_H3PromptWriter";
const COMFY = new URL(process.env.COMFY_URL || "http://127.0.0.1:8188/").href;
const page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => (ws.onopen = resolve));
let id = 0;
const pending = new Map();
const thrown = [];
ws.onmessage = (message) => {
  const data = JSON.parse(message.data);
  if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); return; }
  if (data.method === "Page.javascriptDialogOpening") ws.send(JSON.stringify({ id: ++id, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
  else if (data.method === "Runtime.exceptionThrown") {
    const details = data.params.exceptionDetails;
    const text = String(details.exception?.description ?? details.text ?? "");
    if (/ausboss|h3_sockets/i.test(`${text} ${details.url ?? ""}`)) thrown.push(text.slice(0, 400));
  }
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
let ready = false;
for (let i = 0; i < 240 && !ready; i++) { await sleep(500); ready = await evalJs("Boolean(window.app?.graph && window.app?.canvas && window.LiteGraph?.registered_node_types)").catch(() => false); }
if (!ready) { console.error(`ComfyUI did not come up at ${COMFY}`); ws.close(); process.exit(2); }
await sleep(2500);

const setLook = async (on) => { await evalJs(`(async () => { await window.app.extensionManager.setting.set("Comfy.VueNodes.Enabled", ${on}); return true; })()`); await sleep(on ? 1500 : 500); };
const lookBefore = await evalJs(`window.app.extensionManager.setting.get("Comfy.VueNodes.Enabled")`);
await setLook(vue);

// Helpers that live in the page for the whole run.
await evalJs(`(() => {
  const { app } = window;
  const LG = window.LiteGraph;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const vueOn = () => Boolean(app.extensionManager.setting.get("Comfy.VueNodes.Enabled"));
  const everyNode = () => { const all = []; const walk = (graph) => { for (const node of graph._nodes) { all.push(node); if (node.subgraph) walk(node.subgraph); } }; walk(app.graph); return all; };
  const writers = () => everyNode().filter((node) => node.type === ${JSON.stringify(NODE)});
  const sockets = (node) => ({
    inputs: node.inputs.map((slot, index) => ({ slot, index })).filter(({ slot }) => !slot.widget),
    outputs: node.outputs.map((slot, index) => ({ slot, index })),
  });
  // Which sockets are on the screen. Classic: the socket's dot is inside the
  // node. Nodes 2.0: the socket's row has a height.
  const shown = (node) => {
    const { inputs, outputs } = sockets(node);
    const problems = [];
    if (vueOn()) {
      const row = (side, index) => document.querySelector('[data-slot-key="' + node.id + '-' + side + '-' + index + '"]')?.closest(".lg-slot");
      const tall = (side) => ({ slot, index }) => { const element = row(side, index); if (!element) problems.push("no row for " + side + " " + slot.name); return Boolean(element && element.getBoundingClientRect().height > 0); };
      const seenIn = inputs.filter(tall("in")), seenOut = outputs.filter(tall("out"));
      // A wire ends where the frontend last measured the socket: that must
      // be the dot on the screen now.
      const rect = app.canvas.canvas.getBoundingClientRect(); const ds = app.canvas.ds;
      for (const [side, list, at] of [["in", seenIn, (i) => node.getInputPos(i)], ["out", seenOut, (i) => node.getOutputPos(i)]]) {
        for (const { slot, index } of list) {
          const dot = document.querySelector('[data-slot-key="' + node.id + '-' + side + '-' + index + '"]').getBoundingClientRect();
          const y = (dot.top + dot.height / 2 - rect.top) / ds.scale - ds.offset[1];
          const off = Math.round(at(index)[1] - y);
          if (Math.abs(off) > 2) problems.push("a wire on " + (side === "in" ? "input " : "output ") + slot.name + " ends " + Math.abs(off) + " px " + (off > 0 ? "under" : "over") + " its dot");
        }
      }
      return { inputs: seenIn.map(({ slot }) => slot.name), outputs: seenOut.map(({ slot }) => slot.name), problems };
    }
    const [x, y] = node.pos; const [w, h] = node.size;
    const inside = (pos) => pos[0] >= x - 2 && pos[0] <= x + w + 2 && pos[1] >= y && pos[1] <= y + h;
    const seenIn = inputs.filter(({ index }) => inside(node.getInputPos(index)));
    const seenOut = outputs.filter(({ index }) => inside(node.getOutputPos(index)));
    // Shown rows are stacked with no blank row between them.
    for (const [side, list, at] of [["input", seenIn, (i) => node.getInputPos(i)], ["output", seenOut, (i) => node.getOutputPos(i)]]) {
      list.forEach(({ slot, index }, order) => {
        const expected = y + (order + 0.7) * LG.NODE_SLOT_HEIGHT;
        if (Math.abs(at(index)[1] - expected) > 1) problems.push(side + " " + slot.name + " is at row y " + Math.round(at(index)[1] - y) + ", expected " + Math.round(expected - y));
      });
    }
    return { inputs: seenIn.map(({ slot }) => slot.name), outputs: seenOut.map(({ slot }) => slot.name), problems };
  };
  const wired = (node) => ({
    inputs: node.inputs.filter((slot) => !slot.widget && slot.link != null).map((slot) => slot.name),
    outputs: node.outputs.filter((slot) => (slot.links?.length ?? 0) > 0).map((slot) => slot.name),
  });
  const read = async (node, ms = 500) => { await wait(ms); app.canvas.setDirty(true, true); await wait(80); return { id: node.id, size: [...node.size], shown: shown(node), wired: wired(node) }; };
  const fresh = async () => {
    app.canvas.linkConnector?.reset?.();
    const next = app.graph.last_node_id + 50;
    app.graph.clear(); app.graph.last_node_id = next;
    const node = LG.createNode(${JSON.stringify(NODE)});
    node.pos = [0, 0]; app.graph.add(node);
    app.canvas.ds.scale = 1; app.canvas.ds.offset = [520, 160];
    window.__h3.node = node;
    return node;
  };
  const add = (type, x, y) => { const node = LG.createNode(type); node.pos = [x, y]; app.graph.add(node); return node; };
  const input = (node, name) => node.inputs.findIndex((slot) => slot.name === name);
  const output = (node, name) => node.outputs.findIndex((slot) => slot.name === name);
  window.__h3 = { wait, vueOn, everyNode, writers, shown, wired, read, fresh, add, input, output, node: null, sources: {} };
  return true;
})()`);

let failed = 0;
const sorted = (names) => [...names].sort();
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const pass = (name) => console.log(`ok    ${name}`);
const fail = (name, why) => { failed += 1; console.log(`FAIL  ${name}: ${why}`); };
const skip = (name, why) => console.log(`skip  ${name}: ${why}`);
// The screen against the rule, for a state read in the page.
const againstRule = (state) => {
  const rule = socketsToShow({ wiredInputs: state.wired.inputs, wiredOutputs: state.wired.outputs });
  const problems = [...state.shown.problems];
  if (!same(state.shown.inputs, rule.inputs)) problems.push(`inputs shown ${sorted(state.shown.inputs).join(", ")}; the rule says ${sorted(rule.inputs).join(", ")}`);
  if (!same(state.shown.outputs, rule.outputs)) problems.push(`outputs shown ${sorted(state.shown.outputs).join(", ")}; the rule says ${sorted(rule.outputs).join(", ")}`);
  return problems;
};
const check = async (name, run) => {
  try {
    const problems = (await run()) ?? [];
    if (problems === "skip") return;
    if (problems.length) fail(name, problems.join(" | ")); else pass(name);
  } catch (error) { fail(name, String(error.message ?? error).slice(0, 400)); }
};
const WIRE = `(async () => {
  const h = window.__h3; const node = h.node;
  const one = h.add("LoadImage", -420, -60), two = h.add("LoadImage", -420, 320), clip = h.add("LoadImage", -420, 700);
  one.connect(0, node, h.input(node, "picture_1"));
  two.connect(0, node, h.input(node, "picture_2"));
  clip.connect(0, node, h.input(node, "video"));
  const text = h.add("PreviewAny", 480, 0), picture = h.add("PreviewImage", 480, 160), count = h.add("PreviewAny", 480, 460);
  node.connect(h.output(node, "prompt"), text, 0);
  node.connect(h.output(node, "picture_2"), picture, 0);
  node.connect(h.output(node, "frames"), count, 0);
  h.sources = { two: two.id, picture: picture.id, text: text.id, count: count.id };
  return h.read(node);
})()`;

await check("fresh", async () => {
  const state = await evalJs(`(async () => window.__h3.read(await window.__h3.fresh(), 900))()`);
  const problems = againstRule(state);
  if (!same(state.shown.inputs, ["clip", "picture_1", "video", "voice", "song"])) problems.push(`a fresh node shows inputs ${state.shown.inputs.join(", ")}`);
  if (!same(state.shown.outputs, ["prompt", "frames", "width", "height"])) problems.push(`a fresh node shows outputs ${state.shown.outputs.join(", ")}`);
  return problems;
});

await check("wire", async () => {
  const state = await evalJs(WIRE);
  const problems = againstRule(state);
  const sent = await evalJs(`(async () => {
    const h = window.__h3; const prompt = (await window.app.graphToPrompt()).output;
    const from = (id) => Object.values(prompt[id].inputs).find((value) => Array.isArray(value) && String(value[0]) === String(h.node.id))?.[1];
    return { text: from(h.sources.text), picture: from(h.sources.picture), count: from(h.sources.count) };
  })()`);
  if (sent.text !== 0 || sent.picture !== 2 || sent.count !== 10) problems.push(`a run would read outputs ${JSON.stringify(sent)}; expected prompt 0, picture_2 2, frames 10`);
  return problems;
});

await check("saved file", async () => {
  const saved = await evalJs(`(() => {
    const saved = window.__h3.node.serialize();
    return { inputs: saved.inputs.map((slot) => slot.name), outputs: saved.outputs.map((slot) => slot.name), placed: [...saved.inputs, ...saved.outputs].filter((slot) => !slot.widget && slot.pos).map((slot) => slot.name), keys: Object.keys(saved.properties ?? {}) };
  })()`);
  const problems = [];
  if (!same(saved.inputs.filter((name) => INPUT_NAMES.includes(name)), INPUT_NAMES)) problems.push(`the saved node lists inputs ${saved.inputs.join(", ")}`);
  if (JSON.stringify(saved.outputs) !== JSON.stringify(OUTPUT_NAMES)) problems.push(`the saved node lists outputs ${saved.outputs.join(", ")}`);
  if (saved.placed.length) problems.push(`the saved node carries a position for ${saved.placed.join(", ")}`);
  if (saved.keys.some((key) => /socket/i.test(key))) problems.push(`the saved node carries a new property: ${saved.keys.join(", ")}`);
  return problems;
});

await check("unwire", async () => {
  const state = await evalJs(`(async () => {
    const h = window.__h3; const node = h.node;
    node.disconnectOutput(h.output(node, "picture_2"));
    node.disconnectInput(h.input(node, "picture_2"));
    return h.read(node);
  })()`);
  const problems = againstRule(state);
  if (state.shown.inputs.includes("picture_3")) problems.push("picture_3 still shows after picture_2 lost its wire");
  if (state.shown.outputs.includes("picture_2")) problems.push("the picture_2 output still shows after its picture lost its wire");
  return problems;
});

await check("undo", async () => {
  const result = await evalJs(`(async () => {
    const h = window.__h3; const node = await h.fresh(); await h.wait(400);
    const tracker = window.app.extensionManager.workflow?.activeWorkflow?.changeTracker;
    const commands = window.app.extensionManager.command;
    if (!tracker?.checkState || !commands?.execute) return { skip: "this frontend gives no handle on undo" };
    tracker.checkState();
    const source = h.add("LoadImage", -420, 0);
    source.connect(0, node, h.input(node, "picture_1"));
    tracker.checkState();
    const after = await h.read(h.writers()[0]);
    await commands.execute("Comfy.Undo");
    await h.wait(700);
    const writer = h.writers()[0];
    if (!writer) return { skip: "undo removed the node itself" };
    h.node = writer;
    return { after, undone: await h.read(writer) };
  })()`);
  if (result.skip) { skip("undo", result.skip); return "skip"; }
  const problems = [...againstRule(result.after).map((p) => `after wiring: ${p}`), ...againstRule(result.undone).map((p) => `after undo: ${p}`)];
  if (!result.after.shown.inputs.includes("picture_2")) problems.push("picture_2 did not appear with picture_1 wired");
  if (result.undone.wired.inputs.length === 0 && result.undone.shown.inputs.includes("picture_2")) problems.push("picture_2 still shows after the wire was undone");
  return problems;
});

await check("switch look", async () => {
  await evalJs(`(async () => { await window.__h3.fresh(); return true; })()`);
  await evalJs(WIRE);
  await setLook(!vue);
  const other = await evalJs(`window.__h3.read(window.__h3.node, 900)`);
  await setLook(vue);
  const back = await evalJs(`window.__h3.read(window.__h3.node, 900)`);
  return [...againstRule(other).map((p) => `in the other look: ${p}`), ...againstRule(back).map((p) => `back in this look: ${p}`)];
});

await check("paste and delete", async () => {
  const result = await evalJs(`(async () => {
    const h = window.__h3; const { app } = window; const original = h.node;
    const before = new Set(h.writers().map((node) => node.id));
    // A node the person made taller: its copy keeps that height.
    original.setSize([original.size[0], original.size[1] + 150]);
    await h.wait(300);
    app.canvas.selectItems?.([original]) ?? app.canvas.selectNode?.(original);
    app.canvas.copyToClipboard(); app.canvas.pasteFromClipboard();
    await h.wait(700);
    const copy = h.writers().find((node) => !before.has(node.id));
    if (!copy) return { skip: "this frontend did not paste from a script" };
    const states = { copy: await h.read(copy), original: await h.read(original, 100) };
    const originalId = original.id;
    app.graph.remove(original);
    await h.wait(400);
    h.node = copy;
    return { ...states, rule: document.getElementById("ausboss-h3-sockets")?.textContent ?? "", originalId, afterDelete: await h.read(copy, 100) };
  })()`);
  if (result.skip) { skip("paste and delete", result.skip); return "skip"; }
  const problems = [...againstRule(result.copy).map((p) => `the copy: ${p}`), ...againstRule(result.original).map((p) => `the original: ${p}`), ...againstRule(result.afterDelete).map((p) => `the copy after the delete: ${p}`)];
  if (result.rule.includes(`"${result.originalId}-in-`) || result.rule.includes(`"${result.originalId}-out-`)) problems.push("the deleted node's style rule is still on the page");
  const rows = (state) => Math.max(state.shown.inputs.length, state.shown.outputs.length);
  const least = result.original.size[1] - Math.max(0, rows(result.original) - rows(result.copy)) * 20 - 2;
  if (result.copy.size[1] < least) problems.push(`the copy is ${Math.round(result.copy.size[1])} px tall; the original is ${Math.round(result.original.size[1])} with ${rows(result.original)} rows against the copy's ${rows(result.copy)}, so at least ${Math.round(least)}`);
  return problems;
});

await check("collapse", async () => {
  await evalJs(`(async () => { await window.__h3.fresh(); return true; })()`);
  const before = await evalJs(WIRE);
  const after = await evalJs(`(async () => {
    const h = window.__h3; const node = h.node;
    node.collapse(); await h.wait(400); node.collapse();
    return h.read(node, 700);
  })()`);
  const problems = againstRule(after);
  if (!same(before.wired.inputs, after.wired.inputs) || !same(before.wired.outputs, after.wired.outputs)) problems.push("a wire was lost by collapsing the node");
  return problems;
});

await check("floor", async () => {
  const sizes = await evalJs(`(async () => {
    const h = window.__h3; const measure = (node) => {
      const panel = node.widgets?.find((widget) => widget.element)?.element;
      const scale = window.app.canvas.ds.scale || 1;
      return { height: node.size[1], least: node.computeSize()[1], panel: panel ? panel.getBoundingClientRect().height / scale : null, panelLeast: panel ? parseFloat(getComputedStyle(panel).minHeight) || 0 : null };
    };
    const wired = measure(h.node);
    const node = await h.fresh(); await h.wait(900);
    return { wired, fresh: measure(node), vue: h.vueOn() };
  })()`);
  const problems = [];
  for (const [name, size] of [["wired", sizes.wired], ["fresh", sizes.fresh]]) {
    if (!sizes.vue && size.height + 0.5 < size.least) problems.push(`the ${name} node is ${Math.round(size.height)} px tall, under its ${Math.round(size.least)} px least`);
    if (size.panel != null && size.panel + 0.5 < size.panelLeast) problems.push(`the ${name} node's panel is ${Math.round(size.panel)} px tall, under its ${Math.round(size.panelLeast)} px least`);
  }
  return problems;
});

// A real mouse drag, as a person makes it.
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, pointerType: "mouse", ...extra });
const drag = async (from, to) => {
  await mouse("mouseMoved", from.x, from.y, { buttons: 0 }); await sleep(80);
  await mouse("mousePressed", from.x, from.y, { clickCount: 1 }); await sleep(120);
  for (let step = 1; step <= 12; step++) { await mouse("mouseMoved", from.x + ((to.x - from.x) * step) / 12, from.y + ((to.y - from.y) * step) / 12); await sleep(25); }
  await sleep(150);
  await mouse("mouseReleased", to.x, to.y, { clickCount: 1 }); await sleep(500);
};
// Where a person would grab an audio source's output, and a blank spot of
// the writer's body between its socket names.
const DRAG_POINTS = `(async () => {
  const h = window.__h3; const { app } = window; const node = h.node;
  const source = h.add("LoadAudio", -420, 40 + 260 * (h.audioSources = (h.audioSources ?? 0) + 1));
  await h.wait(700); app.canvas.setDirty(true, true); await h.wait(100);
  const rect = app.canvas.canvas.getBoundingClientRect(); const ds = app.canvas.ds;
  const client = (pos) => ({ x: rect.left + (pos[0] + ds.offset[0]) * ds.scale, y: rect.top + (pos[1] + ds.offset[1]) * ds.scale });
  const dot = document.querySelector('[data-slot-key="' + source.id + '-out-0"]')?.getBoundingClientRect();
  const from = h.vueOn() && dot ? { x: dot.left + dot.width / 2, y: dot.top + dot.height / 2 } : client(source.getOutputPos(0));
  const to = client([node.pos[0] + node.size[0] / 2, node.pos[1] + 30]);
  return { from, to };
})()`;

await check("body drop", async () => {
  await evalJs(`(async () => { await window.__h3.fresh(); await window.__h3.wait(600); return true; })()`);
  const problems = [];
  await drag(...Object.values(await evalJs(DRAG_POINTS)));
  const first = await evalJs(`window.__h3.read(window.__h3.node)`);
  if (!same(first.wired.inputs, ["voice"])) problems.push(`the first audio wire dropped on the node is on ${first.wired.inputs.join(", ") || "nothing"}; expected voice`);
  problems.push(...againstRule(first).map((p) => `after the first drop: ${p}`));
  await drag(...Object.values(await evalJs(DRAG_POINTS)));
  const second = await evalJs(`window.__h3.read(window.__h3.node)`);
  if (!same(second.wired.inputs, ["voice", "song"])) problems.push(`after a second audio wire the node has ${second.wired.inputs.join(", ") || "nothing"} wired; expected voice and song`);
  // A script that wires a hidden socket on purpose is left alone.
  const scripted = await evalJs(`(async () => {
    const h = window.__h3; const node = await h.fresh(); await h.wait(400);
    const source = h.add("LoadAudio", -420, 0);
    source.connect(0, node, h.input(node, "video_sound"));
    return h.read(node);
  })()`);
  if (!same(scripted.wired.inputs, ["video_sound"])) problems.push(`a scripted wire to video_sound ended on ${scripted.wired.inputs.join(", ") || "nothing"}`);
  if (!scripted.shown.inputs.includes("video_sound")) problems.push("video_sound has a wire and does not show");
  problems.push(...againstRule(scripted).map((p) => `after the scripted wire: ${p}`));
  return problems;
});

// A wire pulled from another node's input and dropped on the writer takes a
// shown output, never one nobody can see.
await check("body drop, backwards", async () => {
  const points = await evalJs(`(async () => {
    const h = window.__h3; const { app } = window; const node = await h.fresh();
    const source = h.add("LoadAudio", -420, 40);
    source.connect(0, node, h.input(node, "voice"));
    const player = h.add("PreviewAudio", 520, 300);
    h.player = player.id;
    await h.wait(900); app.canvas.setDirty(true, true); await h.wait(100);
    const rect = app.canvas.canvas.getBoundingClientRect(); const ds = app.canvas.ds;
    const client = (pos) => ({ x: rect.left + (pos[0] + ds.offset[0]) * ds.scale, y: rect.top + (pos[1] + ds.offset[1]) * ds.scale });
    const dot = document.querySelector('[data-slot-key="' + player.id + '-in-0"]')?.getBoundingClientRect();
    const from = h.vueOn() && dot ? { x: dot.left + dot.width / 2, y: dot.top + dot.height / 2 } : client(player.getInputPos(0));
    const to = client([node.pos[0] + node.size[0] / 2, node.pos[1] + 30]);
    return { from, to };
  })()`);
  await drag(points.from, points.to);
  const state = await evalJs(`window.__h3.read(window.__h3.node)`);
  const problems = [];
  if (!same(state.wired.outputs, ["voice"])) problems.push(`an audio wire pulled from a player and dropped on the node is on output ${state.wired.outputs.join(", ") || "nothing"}; expected voice`);
  problems.push(...againstRule(state));
  return problems;
});

await check("setting", async () => {
  const SETTING = "AusBoss.H3PromptWriter.ShowEverySocket";
  const result = await evalJs(`(async () => {
    const h = window.__h3; const settings = window.app.extensionManager.setting;
    const node = await h.fresh(); await h.wait(500);
    const before = JSON.stringify(node.serialize());
    await settings.set(${JSON.stringify(SETTING)}, true);
    const all = await h.read(node, 900);
    const during = JSON.stringify(node.serialize());
    await settings.set(${JSON.stringify(SETTING)}, false);
    const back = await h.read(node, 900);
    const sizeKept = (text) => text.replace(/"size":\\[[^\\]]*\\]/, "");
    return { known: settings.get(${JSON.stringify(SETTING)}) === false, all, back, sameFile: sizeKept(before) === sizeKept(during) };
  })()`);
  const problems = [];
  if (!result.known) problems.push("the setting is not registered");
  if (!same(result.all.shown.inputs, INPUT_NAMES)) problems.push(`with the setting on the inputs shown are ${result.all.shown.inputs.join(", ")}`);
  if (!same(result.all.shown.outputs, OUTPUT_NAMES)) problems.push(`with the setting on the outputs shown are ${result.all.shown.outputs.join(", ")}`);
  problems.push(...result.all.shown.problems, ...againstRule(result.back).map((p) => `with the setting off again: ${p}`));
  if (!result.sameFile) problems.push("the saved node differs with the setting on");
  return problems;
});

// The row of picture chips under "Pictures and settings": a chip only for a
// picture or a video that is plugged in.
await check("chips", async () => {
  const SETTING = "AusBoss.H3PromptWriter.ShowEverySocket";
  const result = await evalJs(`(async () => {
    const h = window.__h3; const settings = window.app.extensionManager.setting;
    const chips = async (node, ms = 1400) => {
      await h.wait(ms);
      const row = node.__ausbossCard?.root?.querySelector(".ausboss-chips");
      const list = [...(row?.querySelectorAll(".ausboss-chip") ?? [])];
      return {
        row: Boolean(row),
        height: Math.round(row?.getBoundingClientRect().height ?? 0),
        on: list.filter((chip) => !chip.classList.contains("off")).map((chip) => chip.querySelector("b")?.textContent ?? ""),
        off: list.filter((chip) => chip.classList.contains("off")).map((chip) => chip.textContent.trim()),
      };
    };
    const node = await h.fresh();
    const empty = await chips(node);
    const one = h.add("LoadImage", -420, -60), two = h.add("LoadImage", -420, 320), clip = h.add("LoadImage", -420, 700);
    one.connect(0, node, h.input(node, "picture_1"));
    const first = await chips(node);
    two.connect(0, node, h.input(node, "picture_2"));
    clip.connect(0, node, h.input(node, "video"));
    const three = await chips(node);
    two.mode = 4;
    const off = await chips(node);
    two.mode = 0;
    node.disconnectInput(h.input(node, "picture_2"));
    node.disconnectInput(h.input(node, "video"));
    node.disconnectInput(h.input(node, "picture_1"));
    const gone = await chips(node);
    await settings.set(${JSON.stringify(SETTING)}, true);
    const all = await chips(node);
    await settings.set(${JSON.stringify(SETTING)}, false);
    const back = await chips(node);
    return { empty, first, three, off, gone, all, back };
  })()`);
  const problems = [];
  const said = (state) => `${state.on.join(", ") || "no chip"}${state.off.length ? ` and faint ${state.off.join(", ")}` : ""}${state.height ? "" : " (row not on the screen)"}`;
  const expectChips = (label, state, on, off, rowShown) => {
    if (!state.row) { problems.push(`${label}: the card has no chip row`); return; }
    if (JSON.stringify(state.on) !== JSON.stringify(on) || JSON.stringify(state.off) !== JSON.stringify(off)) problems.push(`${label}: shows ${said(state)}; expected ${on.join(", ") || "no chip"}${off.length ? ` and faint ${off.join(", ")}` : ""}`);
    if (Boolean(state.height) !== rowShown) problems.push(`${label}: the chip row is ${state.height ? "on the screen" : "not on the screen"}`);
  };
  expectChips("a new node", result.empty, [], [], false);
  expectChips("one picture", result.first, ["@1"], [], true);
  expectChips("two pictures and a video", result.three, ["@1", "@2", "video"], [], true);
  expectChips("the second picture's loader turned off", result.off, ["@1", "video"], ["@2 off"], true);
  expectChips("every wire pulled off", result.gone, [], [], false);
  expectChips("with the setting on", result.all, [], ["+ @1", "+ @2", "+ @3", "+ @4", "+ video"], true);
  expectChips("with the setting off again", result.back, [], [], false);
  return problems;
});

const live = (process.env.H3_LIVE_WORKFLOWS ?? "").split(delimiter).filter(Boolean);
if (!live.length) skip("live workflows", "set H3_LIVE_WORKFLOWS to check saved workflows");
for (const file of live) {
  await check(`live workflow ${file.split("/").pop()}`, async () => {
    const workflow = readFileSync(file, "utf-8");
    await evalJs(`(async () => { await window.app.loadGraphData(${workflow}, true, true, null, { showMissingNodesDialog: false, showMissingModelsDialog: false }); return true; })()`);
    await sleep(2500);
    const states = await evalJs(`(async () => { const h = window.__h3; const out = []; for (const node of h.writers()) { if (node.graph === window.app.canvas.graph) out.push({ ...(await h.read(node, 300)), saved: node.serialize().outputs.length }); else out.push({ id: node.id, elsewhere: true, hidden: node.outputs.filter((slot) => slot._ausbossHidden && (slot.links?.length ?? 0) > 0).map((slot) => slot.name), saved: node.serialize().outputs.length }); } return out; })()`);
    if (!states.length) return ["the workflow has no H3 Prompt Writer"];
    const problems = [];
    for (const state of states) {
      if (state.saved !== OUTPUT_NAMES.length) problems.push(`node ${state.id} would save ${state.saved} outputs`);
      if (state.elsewhere) { if (state.hidden.length) problems.push(`node ${state.id} hides wired outputs ${state.hidden.join(", ")}`); continue; }
      problems.push(...againstRule(state).map((p) => `node ${state.id}: ${p}`));
      const lost = state.wired.outputs.filter((name) => !state.shown.outputs.includes(name));
      if (lost.length) problems.push(`node ${state.id} does not show its wired outputs ${lost.join(", ")}`);
    }
    // One more picture plugged in: a row comes in the shorter column, and
    // every wire still ends on its dot.
    const more = await evalJs(`(async () => {
      const h = window.__h3; const node = h.writers().find((item) => item.graph === window.app.canvas.graph);
      if (!node) return null;
      const free = ["picture_1", "picture_2", "picture_3", "picture_4"].find((name) => node.inputs[h.input(node, name)].link == null);
      if (!free) return null;
      const picture = h.add("LoadImage", node.pos[0] - 420, node.pos[1] - 420);
      picture.connect(0, node, h.input(node, free));
      return { free, state: await h.read(node, 900) };
    })()`);
    if (more) problems.push(...againstRule(more.state).map((p) => `with a picture on ${more.free}: ${p}`));
    return problems;
  });
}

for (const text of thrown) fail("no error thrown", text);
await evalJs(`(async () => { window.app.graph.clear(); await window.app.extensionManager.setting.set("Comfy.VueNodes.Enabled", ${JSON.stringify(lookBefore ?? false)}); return true; })()`).catch(() => {});
await fetch(`http://127.0.0.1:${port}/json/close/${page.id}`).catch(() => {});
console.log(`\n${vue ? "Nodes 2.0" : "classic"}: ${failed} failed`);
ws.close();
process.exit(failed ? 1 : 0);
