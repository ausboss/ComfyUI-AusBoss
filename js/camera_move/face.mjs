// Camera Move's face: the shot on the node, steered by grabbing it.
//
// Drag the picture to turn the camera round, pinch or scroll to pull back,
// two fingers or Shift to pan, tap a spot to circle round it. Top right, as
// in Blender: an axis ball, a magnifier, a hand, and a camera that puts you
// back on your own shot. Under it the time bar with its keys.
//
// No app import: index.js hands in where the camera is kept, how to run the
// node and how to reach a file, so the same face sits on the node or on the
// box that holds it.
//
// The stage is the one part of the node that keeps the mouse wheel (it zooms
// the camera, as in Blender); its root carries no "ausboss-" class, so the
// pack's wheel hand-off leaves it alone. The controls under it do carry one,
// and the wheel there zooms the graph as everywhere else.

import { makeScrubInput } from "../shared/scrub_input.mjs";
import {
  K0, LIM, SAME_KEY, camAt, cameraText, clamp, describe, keyAt, mv, parseCamera, pastLoraRange,
  pivotFromPixel, pose, rot, setKeyAt, toCam, unpackDepth,
} from "./camera_math.mjs";

export const MIN_WIDTH = 380; // the play row on one line, with "243 / 243" frames
export const MIN_STAGE = 184;
export const CONTROLS_HEIGHT = 168;
const FPS = 24; // H3 renders at 24 frames a second; only playback speed uses it
const MAG = 0xFFFF00FF;

const CSS = `
.acm-face{position:relative;display:flex;flex-direction:column;width:100%;height:100%;box-sizing:border-box;
  --acm-teal:#4fb3a9;--acm-teal-dim:#2b605b;--acm-line:#34413f;--acm-fg:#e3e9e8;--acm-muted:#92a2a1;--acm-amber:#e2a94c;
  --acm-stage:#0c0f10;--acm-panel:#1f2629;--acm-head:#283236;color:var(--acm-fg);font:12.5px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.acm-face *{box-sizing:border-box}
.acm-stage{position:relative;flex:1 1 auto;min-height:${MIN_STAGE}px;background:var(--acm-stage);border-radius:6px;overflow:hidden;
  touch-action:none;user-select:none;-webkit-user-select:none}
.acm-stage>canvas.acm-pic{position:absolute;display:block;cursor:grab}
.acm-stage>canvas.acm-pic:active{cursor:grabbing}
.acm-pivot{position:absolute;width:18px;height:18px;margin:-9px 0 0 -9px;border:2px solid var(--acm-teal);border-radius:50%;pointer-events:none;box-shadow:0 0 0 1px rgba(0,0,0,.6)}
.acm-pivot::after{content:"";position:absolute;left:50%;top:50%;width:3px;height:3px;margin:-1.5px;background:var(--acm-teal);border-radius:50%}
.acm-nav{position:absolute;top:6px;right:6px;display:flex;flex-direction:column;align-items:center;gap:5px}
.acm-nav canvas{width:64px;height:64px;cursor:grab;touch-action:none;margin-bottom:1px}
.acm-nav button,.acm-helpbtn{width:30px;height:30px;border-radius:50%;border:1px solid rgba(146,162,161,.4);background:rgba(12,15,16,.62);
  color:var(--acm-fg);padding:0;display:grid;place-items:center;touch-action:none;box-shadow:0 1px 6px rgba(0,0,0,.45);cursor:pointer}
.acm-nav button svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.acm-nav button:hover,.acm-helpbtn:hover{border-color:var(--acm-teal)}
.acm-nav button.on,.acm-helpbtn[aria-expanded="true"]{background:var(--acm-teal-dim);border-color:var(--acm-teal)}
.acm-nav .pan{cursor:move}.acm-nav .zoom{cursor:ns-resize}
.acm-helpbtn{position:absolute;top:6px;left:6px;width:24px;height:24px;font:600 12px system-ui,sans-serif}
.acm-inset{position:absolute;left:6px;bottom:6px;width:36%;border:1px solid var(--acm-line);border-radius:5px;overflow:hidden;background:var(--acm-stage);
  box-shadow:0 2px 10px rgba(0,0,0,.5);pointer-events:none}
.acm-inset canvas{display:block;width:100%;height:auto}
.acm-tag{position:absolute;top:4px;left:5px;font-size:10px;color:var(--acm-muted);background:rgba(12,15,16,.7);padding:1px 5px;border-radius:4px;pointer-events:none}
.acm-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:16px;text-align:center;color:var(--acm-muted);line-height:1.4}
.acm-empty b{color:var(--acm-fg);font-weight:600;font-size:13px}
.ausboss-camera-move-controls{flex:0 0 auto;display:flex;flex-direction:column;gap:6px;padding:7px 0 2px}
.acm-readout{display:flex;justify-content:space-between;gap:8px;font-size:11.5px;color:var(--acm-fg);font-variant-numeric:tabular-nums;min-height:15px}
.acm-readout .acm-where{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.acm-readout .acm-pink{color:var(--acm-muted);flex:0 0 auto}
.acm-warn{color:var(--acm-amber);font-size:11.5px;line-height:15px;height:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.acm-back{display:flex;align-items:center;gap:8px}
.acm-back>span{width:40px;color:var(--acm-muted)}
.acm-track{position:relative;height:34px;background:var(--acm-stage);border:1px solid var(--acm-line);border-radius:6px;touch-action:none;cursor:pointer}
.acm-track .acm-fill{position:absolute;top:15px;height:2px;left:8px;right:8px;background:var(--acm-line)}
.acm-track .acm-inner{position:absolute;left:8px;right:8px;top:0;bottom:0}
.acm-track .acm-key{position:absolute;top:10px;width:12px;height:12px;margin-left:-6px;transform:rotate(45deg);background:var(--acm-teal);border:1px solid #0c0f10;cursor:ew-resize}
.acm-track .acm-key.on{background:#bfe9e4}
.acm-track .acm-head{position:absolute;top:2px;bottom:2px;width:2px;margin-left:-1px;background:var(--acm-fg);pointer-events:none}
.acm-track .acm-head::before{content:"";position:absolute;top:-2px;left:-4px;width:10px;height:6px;background:var(--acm-fg);border-radius:2px}
.acm-row{display:flex;align-items:center;gap:6px}
.acm-row>.acm-keynav,.acm-row>.acm-btn{flex:none;white-space:nowrap}
.acm-btn{border:1px solid var(--acm-line);background:var(--acm-head);color:var(--acm-fg);font:inherit;font-size:12.5px;padding:6px 10px;border-radius:6px;cursor:pointer;line-height:1.1}
.acm-btn:disabled{opacity:.4;cursor:default}
.acm-btn.primary{background:var(--acm-teal-dim);border-color:var(--acm-teal-dim)}
.acm-keynav{display:inline-flex;border:1px solid var(--acm-line);border-radius:6px;background:var(--acm-head);overflow:hidden}
.acm-keynav button{width:32px;height:29px;border:0;background:transparent;color:var(--acm-fg);padding:0;display:grid;place-items:center;cursor:pointer}
.acm-keynav button+button{border-left:1px solid var(--acm-line)}
.acm-keynav button:disabled{color:var(--acm-muted);opacity:.35;cursor:default}
.acm-keynav button:not(:disabled):hover{background:var(--acm-panel)}
.acm-keynav svg{width:14px;height:14px}
.acm-keynav .dia svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.6}
.acm-keynav .dia.on svg{fill:#bfe9e4;stroke:#bfe9e4}
.acm-keynav .arr svg{fill:currentColor}
.acm-keynav.transport .play{width:36px;background:var(--acm-teal-dim);font-size:12px}
.acm-keynav.transport .play:hover{background:var(--acm-teal)}
.acm-keynav.transport .loop{color:var(--acm-muted)}
.acm-keynav.transport .loop svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.acm-keynav.transport .loop[aria-pressed="true"]{color:#bfe9e4;background:var(--acm-teal-dim)}
.acm-time{margin-left:auto;font-size:11.5px;color:var(--acm-muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.acm-help{position:absolute;top:36px;left:6px;right:6px;z-index:5;background:#172023;border:1px solid var(--acm-line);border-radius:8px;
  padding:10px 12px 12px;box-shadow:0 8px 28px rgba(0,0,0,.55);max-height:calc(100% - 44px);overflow:auto}
.acm-help-h{display:flex;justify-content:space-between;align-items:center;font-weight:600;font-size:13px;margin-bottom:6px}
.acm-help-x{border:0;background:transparent;color:var(--acm-muted);font-size:20px;line-height:1;cursor:pointer;padding:0 2px}
.acm-help dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:7px 12px;font-size:12.5px;line-height:1.4}
.acm-help dt{color:var(--acm-teal);font-weight:600}.acm-help dd{margin:0}
.acm-nav,.acm-keynav,.acm-btn,.acm-helpbtn{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
.acm-tip{position:fixed;z-index:10000;max-width:250px;background:#0a0d0e;color:#e3e9e8;border:1px solid #34413f;border-radius:6px;
  padding:5px 8px;font:12px/1.35 system-ui,sans-serif;pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.5)}
.acm-face [hidden],.acm-tip[hidden]{display:none!important}
`;

function ensureCss() {
  if (document.getElementById("ausboss-camera-move-css")) return;
  const style = document.createElement("style");
  style.id = "ausboss-camera-move-css";
  style.textContent = CSS;
  document.head.append(style);
}

const el = (tag, cls, attrs = {}) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") e.textContent = v;
    else if (k === "html") e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  return e;
};

const NAV_ICONS = {
  zoom: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>',
  pan: '<svg viewBox="0 0 24 24"><path d="M7.5 12.5V6.3a1.25 1.25 0 0 1 2.5 0v5M10 11.3V4.8a1.25 1.25 0 0 1 2.5 0v6.5M12.5 11.3V5.6a1.25 1.25 0 0 1 2.5 0v6M15 11.8V8a1.25 1.25 0 0 1 2.5 0v5.5c0 3.9-2.6 6.8-6.3 6.8h-.6c-2.1 0-3.6-.9-4.8-2.6l-2.4-3.5a1.35 1.35 0 0 1 2.1-1.7l2 2.3"/></svg>',
  shot: '<svg viewBox="0 0 24 24"><rect x="2.8" y="7.3" width="12.6" height="9.4" rx="1.8"/><path d="M15.4 10.6 21 7.8v8.4l-5.6-2.8"/></svg>',
};
const NAV_TIPS = { zoom: "Zoom: drag up to push in, down to pull back", pan: "Pan: drag to slide the camera", shot: "Back to your own shot" };
const GZ = 64;
// Blender's names for the scene's directions: X to the right, Y into the picture, Z up.
const AXES = [
  { n: "X", v: [1, 0, 0], col: "#e05561", pos: { az: 90, el: 0 }, neg: { az: -90, el: 0 } },
  { n: "Y", v: [0, 0, 1], col: "#86b84a", pos: null, neg: { az: 0, el: 0 } }, // nothing to see from behind the scene
  { n: "Z", v: [0, -1, 0], col: "#4b8fdf", pos: { az: 0, el: LIM.el[1] }, neg: { az: 0, el: LIM.el[0] } },
];
const SUB = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]];
const VIEW = { az: -58, el: 28 }; // the corner map looks at the scene from the left

// ---------- tooltips: hover on a computer, press and hold a button on a phone ----------
let tipEl = null, tipTimer = 0, tipFor = null, tipXY = [0, 0], tipHeld = false;
function tip() {
  if (!tipEl || !tipEl.isConnected) {
    tipEl = el("div", "acm-tip", { role: "tooltip" });
    tipEl.hidden = true;
    document.body.append(tipEl);
  }
  return tipEl;
}
function placeTip(target) {
  const t = target.dataset.tip, box = tip();
  if (!t || !target.isConnected) return hideTip();
  box.textContent = t;
  box.hidden = false;
  const r = target.getBoundingClientRect(), tw = box.offsetWidth, th = box.offsetHeight, atPtr = target.dataset.tipAt === "pointer";
  if (target.closest(".acm-nav")) { // the column top right: the tip opens to its left and covers no other button
    box.style.left = `${Math.max(8, r.left - tw - 8)}px`;
    box.style.top = `${r.top + r.height / 2 - th / 2}px`;
    return;
  }
  const ax = atPtr ? tipXY[0] : r.left + r.width / 2;
  const below = atPtr ? tipXY[1] + 22 : r.bottom + 8, above = atPtr ? tipXY[1] - th - 12 : r.top - th - 8;
  box.style.left = `${clamp(ax - tw / 2, 8, innerWidth - tw - 8)}px`;
  box.style.top = `${below + th > innerHeight - 8 ? above : below}px`;
}
function hideTip() { clearTimeout(tipTimer); if (tipEl) tipEl.hidden = true; tipFor = null; }
const armTip = (target, ms) => { clearTimeout(tipTimer); tipFor = target; tipTimer = setTimeout(() => placeTip(target), ms); };
function wireTips(root) {
  const targetOf = (e) => e.target?.closest?.("[data-tip]") ?? null;
  root.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    tipXY = [e.clientX, e.clientY];
    if (e.buttons) { if (tipFor) hideTip(); return; }
    const t = targetOf(e);
    if (!t) { if (tipFor) hideTip(); return; }
    if (t !== tipFor) { hideTip(); armTip(t, t.dataset.tipAt === "pointer" ? 900 : 450); }
    else if (t.dataset.tipAt === "pointer") { hideTip(); armTip(t, 900); } // over a picture the tip waits until the mouse rests
  }, true);
  root.addEventListener("pointerleave", hideTip);
  root.addEventListener("pointerdown", (e) => {
    hideTip();
    if (e.pointerType === "mouse") return;
    const t = targetOf(e);
    if (!t || t.dataset.tipAt === "pointer") return;
    const x0 = e.clientX, y0 = e.clientY;
    armTip(t, 500);
    const done = () => { removeEventListener("pointermove", move, true); removeEventListener("pointerup", up, true); removeEventListener("pointercancel", up, true); };
    const move = (m) => { if (Math.hypot(m.clientX - x0, m.clientY - y0) > 8) { clearTimeout(tipTimer); done(); } };
    const up = () => {
      if (tipEl && !tipEl.hidden) { tipHeld = true; setTimeout(() => { tipHeld = false; }, 400); setTimeout(hideTip, 1600); } else clearTimeout(tipTimer);
      done();
    };
    addEventListener("pointermove", move, true); addEventListener("pointerup", up, true); addEventListener("pointercancel", up, true);
  }, true);
  // A hold that showed a tip is not a click.
  root.addEventListener("click", (e) => { if (tipHeld) { tipHeld = false; e.preventDefault(); e.stopPropagation(); } }, true);
  root.addEventListener("contextmenu", (e) => { if (e.target.closest?.(".acm-nav, .acm-keynav, .acm-btn")) e.preventDefault(); });
}

// ---------- one frame of the clip, as points ----------
async function loadFrame(entry, info, view, blobOf) {
  const W = info.w, H = info.h;
  const picture = new Image();
  picture.decoding = "async";
  const pictureReady = new Promise((ok, fail) => { picture.onload = ok; picture.onerror = () => fail(new Error("picture")); });
  picture.src = view(entry.color);
  const depthBlob = await blobOf(entry.depth);
  const depthBitmap = await createImageBitmap(depthBlob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  await pictureReady;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  g.drawImage(picture, 0, 0, W, H);
  const rgba = new Uint32Array(g.getImageData(0, 0, W, H).data.buffer.slice(0));
  g.clearRect(0, 0, W, H);
  g.drawImage(depthBitmap, 0, 0, W, H);
  const { z, valid } = unpackDepth(g.getImageData(0, 0, W, H).data, W * H, info.zmin, info.zmax, info.far);
  // the corner map leaves out what is very far away
  const zs = [];
  for (let i = 0; i < W * H; i += 5) if (valid[i]) zs.push(z[i]);
  zs.sort((a, b) => a - b);
  const zcap = Math.min(zs[Math.floor(zs.length * 0.97)] || info.far, (zs[zs.length >> 1] || 1) * 3.5);
  return { ...entry, W, H, z, valid, rgba, zcap, picture };
}

// ---------- the face ----------
// opts: read() -> camera text, write(text), run() -> Promise<boolean>,
// view(fileEntry) -> url, onSize() when the floor changes.
export function mountCameraFace(opts) {
  ensureCss();
  const root = el("div", "acm-face");
  const stage = el("div", "acm-stage");
  const pic = el("canvas", "acm-pic", { "data-tip": "Drag to turn · Shift-drag to pan · wheel to zoom · click a spot to circle round it", "data-tip-at": "pointer" });
  const picCtx = pic.getContext("2d");
  const pivotMark = el("div", "acm-pivot");
  const nav = el("div", "acm-nav");
  const gizmo = el("canvas", "", { "data-tip": "Drag to turn. Click an axis to look from that side.", role: "img", "aria-label": "Axis ball: drag to turn the camera, tap an axis to look from that side" });
  gizmo.width = GZ * 2; gizmo.height = GZ * 2;
  const gctx = gizmo.getContext("2d");
  nav.append(gizmo);
  const inset = el("div", "acm-inset");
  const out = el("canvas");
  out.width = 360; out.height = 225;
  const outCtx = out.getContext("2d");
  const outImg = outCtx.createImageData(out.width, out.height);
  const outZ = new Float32Array(out.width * out.height);
  inset.append(out, el("span", "acm-tag", { text: "where the camera is" }));
  const helpBtn = el("button", "acm-helpbtn", { text: "?", "aria-label": "How to steer", "aria-expanded": "false", "data-tip": "How to steer" });
  const empty = el("div", "acm-empty");
  stage.append(pic, pivotMark, inset, nav, helpBtn, empty);

  const controls = el("div", "ausboss-camera-move-controls");
  const readout = el("div", "acm-readout");
  const where = el("span", "acm-where");
  const pink = el("span", "acm-pink", { "data-tip": "How much of the frame the camera never saw. The LoRA paints it in." });
  readout.append(where, pink);
  // Always one line tall, empty or not, so a warning never pushes the controls down.
  const warn = el("div", "acm-warn");
  const backRow = el("div", "acm-back");
  const back = makeScrubInput({
    value: 0, min: LIM.back[0], max: LIM.back[1], step: 0.05, fineStep: 0.01, decimals: 2, unit: "×", unitWidth: 14, width: 132,
    title: "How far the camera pulls back from what it circles. Below 0 pushes in.",
    onChange: (v) => { stopPlay(); setCam({ ...camAt(keys, p), back: v }); },
  });
  backRow.append(el("span", "", { text: "Back" }), back.root);
  const track = el("div", "acm-track", { "data-tip": "Click to put a key here. Drag to move the time bar, or drag a key to change its time.", "data-tip-at": "pointer" });
  const inner = el("div", "acm-inner");
  const head = el("div", "acm-head");
  inner.append(head);
  track.append(el("div", "acm-fill"), inner);
  const row = el("div", "acm-row");
  const transport = el("span", "acm-keynav transport", { role: "group", "aria-label": "Playback" });
  const toStartBtn = el("button", "arr", { "aria-label": "Back to the start", "data-tip": "Back to the start", html: '<svg viewBox="0 0 14 14"><path d="M2.5 2.5h1.6v9H2.5zM11.5 2.5v9L5 7z"/></svg>' });
  const play = el("button", "play", { text: "▶", "aria-label": "Play", "data-tip": "Play" });
  const loop = el("button", "loop", { "aria-label": "Play on a loop", "aria-pressed": "false", "data-tip": "Play on a loop", html: '<svg viewBox="0 0 16 16"><path d="M3 9.5V7a2.5 2.5 0 0 1 2.5-2.5H12M10 2.5l2 2-2 2M13 6.5V9a2.5 2.5 0 0 1-2.5 2.5H4M6 13.5l-2-2 2-2"/></svg>' });
  transport.append(toStartBtn, play, loop);
  const keynav = el("span", "acm-keynav", { role: "group", "aria-label": "Keys" });
  const prevKey = el("button", "arr", { "aria-label": "Previous key", "data-tip": "Previous key", html: '<svg viewBox="0 0 14 14"><path d="M10 2.5v9L3.5 7z"/></svg>' });
  const toggleKey = el("button", "dia", { "aria-label": "Add a key here", "data-tip": "Add a key here", html: '<svg viewBox="0 0 16 16"><path d="M8 1.8 14.2 8 8 14.2 1.8 8z"/></svg>' });
  const nextKey = el("button", "arr", { "aria-label": "Next key", "data-tip": "Next key", html: '<svg viewBox="0 0 14 14"><path d="M4 2.5v9L10.5 7z"/></svg>' });
  keynav.append(prevKey, toggleKey, nextKey);
  const reset = el("button", "acm-btn", { text: "Start over", "data-tip": "One key again, on your own shot" });
  const time = el("span", "acm-time", { "data-tip": "Frame at the time bar" });
  row.append(transport, keynav, reset, time);
  controls.append(readout, warn, backRow, track, row);
  const help = el("div", "acm-help");
  help.hidden = true;
  root.append(stage, controls, help);
  wireTips(root);

  // ---------- state ----------
  let keys = [], pivotSpec = null, lastText = null, p = 0, playing = false, lastT = 0, dirty = true, alive = true;
  let info = null, frames = [], shown = null, pivot = [0, 0, 2], pinkPct = 0, status = "idle", statusNote = "";
  let flashText = "", flashUntil = 0, gBalls = [], gHot = false, hovered = false, overFace = false, looping = false, needsWrite = false;
  let buf = null; // z, colour and source pixel of the moved view
  const fallbackLens = { W: 416, H: 234, fx: 380, fy: 380, cx: 208, cy: 117 };

  function readCamera() {
    const text = opts.read();
    if (text === lastText) return;
    lastText = text;
    const parsed = parseCamera(text);
    keys = parsed.keys;
    pivotSpec = parsed.pivot;
    resolvePivot();
    dirty = true;
  }
  function writeSoon() { needsWrite = true; dirty = true; }
  function flushWrite() {
    if (!needsWrite) return;
    needsWrite = false;
    const text = cameraText({ keys, pivot: pivotSpec });
    lastText = text;
    if (text !== opts.read()) opts.write(text);
  }
  function setCam(cam) { setKeyAt(keys, p, cam); writeSoon(); }

  function lens() { return shown ?? (info ? { ...fallbackLens, ...info.frames[0], W: info.w, H: info.h } : fallbackLens); }
  function resolvePivot() {
    if (!info) { pivot = [0, 0, 2]; return; }
    if (!pivotSpec) { pivot = info.pivot_auto?.slice() ?? [0, 0, 2]; return; }
    if (info.pivot_from && Math.abs(info.pivot_from.u - pivotSpec.u) < 1e-4 && Math.abs(info.pivot_from.v - pivotSpec.v) < 1e-4
      && Math.abs(info.pivot_from.t - pivotSpec.t) < 1e-4) { pivot = info.pivot.slice(); return; }
    const f = nearestLoaded(pivotSpec.t);
    const found = f && pivotFromPixel(f, pivotSpec.u, pivotSpec.v);
    if (found) pivot = found;
  }

  // ---------- frames ----------
  function nearestFrame(t) {
    let best = null;
    for (const f of frames) if (!best || Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
    return best;
  }
  function nearestLoaded(t) {
    let best = null;
    for (const f of frames) if (f.data && (!best || Math.abs(f.t - t) < Math.abs(best.t - t))) best = f;
    return best?.data ?? null;
  }
  async function loadAll(payload) {
    const order = [...frames].sort((a, b) => Math.abs(a.t - p) - Math.abs(b.t - p));
    let failed = 0, next = 0;
    // Four at a time, the frames nearest the time bar first.
    const worker = async () => {
      while (next < order.length) {
        const f = order[next++];
        if (info !== payload) return;
        try { f.data = await loadFrame(f.entry, payload, opts.view, opts.blob); } catch { failed++; }
        if (info !== payload) return;
        if (f.data && status !== "ready") { status = "ready"; resolvePivot(); }
        dirty = true;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (info !== payload) return;
    if (failed === frames.length) { info = null; frames = []; shown = null; status = "idle"; statusNote = "The last run's pictures are gone. Run it again to see your clip."; dirty = true; }
  }

  // ---------- the camera's view ----------
  function fitPicture() {
    const L = lens(), sw = stage.clientWidth, sh = stage.clientHeight;
    if (!sw || !sh) return null;
    const s = Math.min(sw / L.W, sh / L.H), w = L.W * s, h = L.H * s, x = (sw - w) / 2, y = (sh - h) / 2;
    Object.assign(pic.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    inset.hidden = !shown || sw < 300 || sh < MIN_STAGE;
    return { x, y, w, h };
  }
  function renderPreview(cam, fit) {
    const f = shown;
    if (!f) { pic.hidden = true; pivotMark.hidden = true; return; }
    pic.hidden = false;
    const { W, H, z, rgba, fx, fy, cx, cy } = f;
    if (!buf || buf.W !== W || buf.H !== H) {
      buf = { W, H, zbuf: new Float32Array(W * H), cbuf: new Uint32Array(W * H), ibuf: new Int32Array(W * H), fill: new Uint8Array(W * H), img: picCtx.createImageData(W, H) };
      pic.width = W; pic.height = H;
      buf.img = picCtx.createImageData(W, H);
    }
    const { zbuf, cbuf, ibuf, fill, img } = buf;
    const { R, C } = pose(cam, pivot);
    const [r0, r1, r2, r3, r4, r5, r6, r7, r8] = R, [Cx, Cy, Cz] = C;
    zbuf.fill(Infinity); ibuf.fill(-1);
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
      const zz = z[i], c = rgba[i];
      for (let s = 0; s < 4; s++) {
        const X = (x + 0.5 + SUB[s][0] - cx) / fx * zz - Cx, Y = (y + 0.5 + SUB[s][1] - cy) / fy * zz - Cy, Z = zz - Cz;
        const zc = r2 * X + r5 * Y + r8 * Z;
        if (zc <= 1e-3) continue;
        const u = fx * (r0 * X + r3 * Y + r6 * Z) / zc + cx, v = fy * (r1 * X + r4 * Y + r7 * Z) / zc + cy;
        if (u < 0 || v < 0 || u >= W || v >= H) continue;
        const idx = (v | 0) * W + (u | 0);
        if (zc < zbuf[idx]) { zbuf[idx] = zc; cbuf[idx] = c; ibuf[idx] = i; }
      }
    }
    for (let i = 0; i < W * H; i++) fill[i] = zbuf[i] < Infinity ? 1 : 0;
    // fill one-pixel cracks: a gap mostly surrounded by picture takes their average (two passes, like the node)
    for (let pass = 0; pass < 2; pass++) {
      const was = fill.slice(), src = cbuf.slice();
      let any = false;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (was[i]) continue;
        let n = 0, r = 0, g = 0, b = 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const q = i + oy * W + ox;
          if (!was[q]) continue;
          const c = src[q]; n++; r += c & 255; g += (c >>> 8) & 255; b += (c >>> 16) & 255;
        }
        if (n >= 5) { cbuf[i] = 0xFF000000 | ((b / n) << 16) | ((g / n) << 8) | (r / n); fill[i] = 1; any = true; }
      }
      if (!any) break;
    }
    const o = new Uint32Array(img.data.buffer);
    let holes = 0;
    for (let i = 0; i < W * H; i++) { if (fill[i]) o[i] = cbuf[i]; else { o[i] = MAG; holes++; } }
    picCtx.putImageData(img, 0, 0);
    pinkPct = 100 * holes / (W * H);
    const q = toCam(R, C, pivot);
    if (fit && q[2] > 1e-3) {
      pivotMark.hidden = false;
      pivotMark.style.left = `${fit.x + fit.w * (fx * q[0] / q[2] + cx) / W}px`;
      pivotMark.style.top = `${fit.y + fit.h * (fy * q[1] / q[2] + cy) / H}px`;
    } else pivotMark.hidden = true;
  }

  // ---------- the corner map: your scene from the side, and the camera in it ----------
  function viewer() {
    const P = pivot, d = Math.hypot(P[0], P[1], P[2]), T = [P[0] * 0.55, P[1] * 0.55, P[2] * 0.55];
    const R = rot(VIEW.az, VIEW.el), b = mv(R, [0, 0, -d * 2.3]);
    return { R, C: [T[0] + b[0], T[1] + b[1], T[2] + b[2]], f: 0.95 * out.width };
  }
  function proj(V, P) {
    const q = toCam(V.R, V.C, P);
    return q[2] <= 1e-3 ? null : [V.f * q[0] / q[2] + out.width / 2, V.f * q[1] / q[2] + out.height / 2, q[2]];
  }
  function frustum(V, cam, color, width) {
    const L = lens(), { R, C } = pose(cam, pivot), s = Math.hypot(...pivot) * 0.3;
    const corners = [[0, 0], [L.W, 0], [L.W, L.H], [0, L.H]].map(([x, y]) => {
      const l = mv(R, [(x - L.cx) / L.fx * s, (y - L.cy) / L.fy * s, s]);
      return proj(V, [C[0] + l[0], C[1] + l[1], C[2] + l[2]]);
    });
    const a = proj(V, C);
    if (!a || corners.some((c) => !c)) return;
    outCtx.strokeStyle = color; outCtx.lineWidth = width; outCtx.beginPath();
    for (const c of corners) { outCtx.moveTo(a[0], a[1]); outCtx.lineTo(c[0], c[1]); }
    outCtx.moveTo(corners[0][0], corners[0][1]);
    for (const c of [...corners.slice(1), corners[0]]) outCtx.lineTo(c[0], c[1]);
    outCtx.stroke();
    // a small roof on the top edge, so up and down never mix
    outCtx.fillStyle = color; outCtx.beginPath(); outCtx.moveTo(corners[0][0], corners[0][1]); outCtx.lineTo(corners[1][0], corners[1][1]);
    const up = mv(R, [0, -L.H / 2 / L.fy * s * 1.35, s]), ut = proj(V, [C[0] + up[0], C[1] + up[1], C[2] + up[2]]);
    if (ut) { outCtx.lineTo(ut[0], ut[1]); outCtx.closePath(); outCtx.globalAlpha = 0.6; outCtx.fill(); outCtx.globalAlpha = 1; }
  }
  function renderOutside(cam) {
    if (inset.hidden) return;
    const w = out.width, h = out.height, V = viewer(), o = new Uint32Array(outImg.data.buffer);
    o.fill(0xFF100D0C); outZ.fill(Infinity);
    const f = shown;
    if (f) {
      const { W, H, z, valid, rgba, zcap, fx, fy, cx, cy } = f, [r0, r1, r2, r3, r4, r5, r6, r7, r8] = V.R, [Cx, Cy, Cz] = V.C;
      for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
        const i = y * W + x, zz = z[i];
        if (!valid[i] || zz > zcap) continue;
        const dx = (x + 0.5 - cx) / fx * zz - Cx, dy = (y + 0.5 - cy) / fy * zz - Cy, dz = zz - Cz, zc = r2 * dx + r5 * dy + r8 * dz;
        if (zc <= 1e-3) continue;
        const u = V.f * (r0 * dx + r3 * dy + r6 * dz) / zc + w / 2, v = V.f * (r1 * dx + r4 * dy + r7 * dz) / zc + h / 2;
        const sz = clamp(Math.round(V.f * (zz / fx * 2.2) / zc), 1, 4), x0 = (u - sz / 2) | 0, y0 = (v - sz / 2) | 0;
        for (let yy = y0; yy < y0 + sz; yy++) {
          if (yy < 0 || yy >= h) continue;
          for (let xx = x0; xx < x0 + sz; xx++) { if (xx < 0 || xx >= w) continue; const q = yy * w + xx; if (zc < outZ[q]) { outZ[q] = zc; o[q] = rgba[i]; } }
        }
      }
    }
    outCtx.putImageData(outImg, 0, 0);
    frustum(V, { ...K0 }, "rgba(200,210,210,.55)", 1.5);
    const project = (c) => proj(V, pose(c, pivot).C);
    outCtx.strokeStyle = "rgba(79,179,169,.9)"; outCtx.lineWidth = 2; outCtx.setLineDash([5, 4]); outCtx.beginPath();
    let first = true;
    for (let i = 0; i <= 48; i++) {
      const q = project(camAt(keys, i / 48));
      if (!q) { first = true; continue; }
      if (first) outCtx.moveTo(q[0], q[1]); else outCtx.lineTo(q[0], q[1]);
      first = false;
    }
    outCtx.stroke(); outCtx.setLineDash([]);
    for (const k of keys) {
      const q = project(k);
      if (!q) continue;
      outCtx.save(); outCtx.translate(q[0], q[1]); outCtx.rotate(Math.PI / 4);
      outCtx.fillStyle = Math.abs(k.t - p) < SAME_KEY ? "#bfe9e4" : "#4fb3a9"; outCtx.strokeStyle = "#0c0f10"; outCtx.lineWidth = 1.5;
      outCtx.fillRect(-5, -5, 10, 10); outCtx.strokeRect(-5, -5, 10, 10); outCtx.restore();
    }
    const pv = proj(V, pivot), cc = project(cam);
    if (pv && cc) { outCtx.strokeStyle = "rgba(79,179,169,.45)"; outCtx.lineWidth = 1; outCtx.beginPath(); outCtx.moveTo(cc[0], cc[1]); outCtx.lineTo(pv[0], pv[1]); outCtx.stroke(); }
    frustum(V, cam, "#4fb3a9", 2.5);
  }

  // ---------- the axis ball ----------
  function drawGizmo(cam) {
    const g = gctx, c = GZ / 2, L = 21, R = rot(cam.az, cam.el);
    g.setTransform(2, 0, 0, 2, 0, 0); g.clearRect(0, 0, GZ, GZ);
    g.fillStyle = gHot ? "rgba(146,162,161,.26)" : "rgba(12,15,16,.42)"; g.beginPath(); g.arc(c, c, c - 1, 0, 7); g.fill();
    gBalls = [];
    for (const a of AXES) for (const sg of [1, -1]) {
      const w = [a.v[0] * sg, a.v[1] * sg, a.v[2] * sg]; // the direction as the camera sees it
      const q = [R[0] * w[0] + R[3] * w[1] + R[6] * w[2], R[1] * w[0] + R[4] * w[1] + R[7] * w[2], R[2] * w[0] + R[5] * w[1] + R[8] * w[2]];
      gBalls.push({ a, sg, x: c + q[0] * L, y: c + q[1] * L, z: q[2], view: sg > 0 ? a.pos : a.neg });
    }
    gBalls.sort((m, n) => n.z - m.z); // far balls first, near ones on top
    for (const b of gBalls) {
      if (b.sg > 0) { g.strokeStyle = b.a.col; g.lineWidth = 2; g.beginPath(); g.moveTo(c, c); g.lineTo(b.x, b.y); g.stroke(); }
      g.beginPath(); g.arc(b.x, b.y, b.sg > 0 ? 7 : 6, 0, 7);
      if (b.sg > 0) {
        g.fillStyle = b.a.col; g.fill();
        g.fillStyle = "#0c0f10"; g.font = "bold 9px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(b.a.n, b.x, b.y + 0.5);
      } else { g.globalAlpha = 0.35; g.fillStyle = b.a.col; g.fill(); g.globalAlpha = 1; g.strokeStyle = b.a.col; g.lineWidth = 1.2; g.stroke(); }
    }
  }

  // ---------- gestures ----------
  const picRect = () => pic.getBoundingClientRect();
  function panBy(cam, dx, dy) { // the spot you circle stays under your finger
    const L = lens(), r = picRect(), d = Math.hypot(...pivot), zz = Math.max(0.05 * d, pivot[2] + cam.back * d);
    const du = dx * L.W / (r.width || 1), dv = dy * L.H / (r.height || 1);
    return { px: (cam.px || 0) - du * zz / (L.fx * d), py: (cam.py || 0) - dv * zz / (L.fy * d) };
  }
  function dragTo(kind, cam, dx, dy) {
    const r = picRect(), w = r.width || stage.clientWidth || 1, h = r.height || stage.clientHeight || 1;
    if (kind === "orbit") setCam({ ...cam, az: cam.az - dx * 90 / w, el: cam.el + dy * 90 / w }); // the picture follows your finger
    else if (kind === "pan") setCam({ ...cam, ...panBy(cam, dx, dy) });
    else if (kind === "zoom") setCam({ ...cam, back: cam.back + dy / h * 2.4 }); // up = in, down = back
  }
  const kindFor = (e) => (e.shiftKey ? "pan" : (e.ctrlKey || e.metaKey) ? "zoom" : "orbit");
  (() => {
    const pts = new Map();
    let g = null;
    const begin = (kind, carry) => {
      const v = [...pts.values()], cam = camAt(keys, p);
      if (v.length >= 2) {
        const [a, b] = v;
        g = { kind: "pinch", cam, d: Math.max(8, Math.hypot(a[0] - b[0], a[1] - b[1])), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, moved: true, multi: true };
      } else if (v.length === 1) g = { kind, cam, x: v[0][0], y: v[0][1], moved: Boolean(carry), multi: Boolean(carry) };
      else g = null;
    };
    pic.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); }); // no auto-scroll on middle click
    pic.addEventListener("pointerdown", (e) => {
      if (e.button > 1) return;
      e.preventDefault(); e.stopPropagation();
      pic.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); stopPlay();
      begin(kindFor(e));
    });
    pic.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId) || !g) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (g.kind === "pinch") {
        const [a, b] = [...pts.values()], d = Math.max(8, Math.hypot(a[0] - b[0], a[1] - b[1]));
        const c = { ...g.cam, back: g.cam.back - Math.log(d / g.d) * 0.9 };
        Object.assign(c, panBy(g.cam, (a[0] + b[0]) / 2 - g.mx, (a[1] + b[1]) / 2 - g.my));
        setCam(c);
        return;
      }
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.moved && Math.hypot(dx, dy) < 5) return;
      g.moved = true;
      dragTo(g.kind, g.cam, dx, dy);
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size === 0) {
        if (g && !g.moved && !g.multi && g.kind === "orbit" && e.type === "pointerup" && e.button === 0) pickPivot(e);
        g = null;
        return;
      }
      begin("orbit", true); // a finger left: carry on from here
    };
    pic.addEventListener("pointerup", up);
    pic.addEventListener("pointercancel", up);
  })();
  function pickPivot(e) { // tap: circle round what you tapped
    const f = shown, r = picRect();
    if (!f || !buf || !r.width) return;
    const x = ((e.clientX - r.left) / r.width * f.W) | 0, y = ((e.clientY - r.top) / r.height * f.H) | 0;
    if (x < 0 || y < 0 || x >= f.W || y >= f.H) return;
    let best = -1;
    for (let rr = 0; rr <= 3 && best < 0; rr++) for (let oy = -rr; oy <= rr && best < 0; oy++) for (let ox = -rr; ox <= rr; ox++) {
      const xx = x + ox, yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= f.W || yy >= f.H) continue;
      const i = buf.ibuf[yy * f.W + xx];
      if (i >= 0) { best = i; break; }
    }
    if (best < 0 || !f.valid[best]) return; // sky: nothing to circle
    const spec = { u: ((best % f.W) + 0.5) / f.W, v: (Math.floor(best / f.W) + 0.5) / f.H, t: f.t };
    const found = pivotFromPixel(f, spec.u, spec.v);
    if (!found) return;
    pivotSpec = spec; pivot = found;
    writeSoon();
  }
  stage.addEventListener("wheel", (e) => {
    e.preventDefault(); e.stopPropagation(); stopPlay();
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1, c = camAt(keys, p);
    if (e.shiftKey) { const a = (e.deltaY || e.deltaX) * unit; setCam({ ...c, ...panBy(c, 0, -a * 0.4) }); return; } // Shift + wheel pans up and down
    setCam({ ...c, back: c.back + e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0008) }); // wheel, and a trackpad pinch (Ctrl), zoom
  }, { passive: false });
  stage.addEventListener("gesturestart", (e) => e.preventDefault()); // Safari: never zoom the page instead
  stage.addEventListener("pointerdown", (e) => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); } });
  stage.addEventListener("pointerenter", () => { hovered = true; });
  stage.addEventListener("pointerleave", () => { hovered = false; });
  // Blender's numpad, while the pointer is over the picture.
  const onKey = (e) => {
    if (!hovered || !alive || e.altKey || e.target?.closest?.("input, textarea, select, [contenteditable]")) return;
    const c = camAt(keys, p), w = picRect().width || 300, step = 15, pan = e.ctrlKey || e.metaKey;
    const go = { Numpad4: [-1, 0], Numpad6: [1, 0], Numpad8: [0, 1], Numpad2: [0, -1] }[e.code];
    if (go) setCam(pan ? { ...c, ...panBy(c, -go[0] * w * 0.1, go[1] * w * 0.1) } : { ...c, az: c.az + go[0] * step, el: c.el + go[1] * step });
    else if (e.code === "NumpadAdd" || e.code === "NumpadSubtract") setCam({ ...c, back: c.back + (e.code === "NumpadAdd" ? -0.1 : 0.1) });
    else if (e.code === "Numpad1" && !pan) setCam({ ...c, az: 0, el: 0 }); // front
    else if (e.code === "Numpad3") setCam({ ...c, az: pan ? -90 : 90, el: 0 }); // right, Ctrl: left
    else if (e.code === "Numpad7") setCam({ ...c, az: 0, el: pan ? LIM.el[0] : LIM.el[1] }); // top, Ctrl: bottom
    else if (e.code === "Numpad0") setCam({ ...K0 }); // your own shot
    else if (e.key === "Escape" && !help.hidden) { openHelp(false); }
    else return;
    e.preventDefault(); e.stopPropagation(); stopPlay();
  };
  window.addEventListener("keydown", onKey, true);
  // Space plays and pauses, Home goes to the start, while the pointer is over the face.
  // Held there, Space would otherwise start a canvas pan.
  root.addEventListener("pointerenter", () => { overFace = true; });
  root.addEventListener("pointerleave", () => { overFace = false; });
  const onPlayKey = (e) => {
    if (!overFace || !alive || e.altKey || e.ctrlKey || e.metaKey || e.repeat && e.code === "Space") return;
    if (e.target?.closest?.("input, textarea, select, button, [contenteditable]")) return;
    if (e.key === "Home") toStart();
    else if (e.code === "Space") play.click();
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  window.addEventListener("keydown", onPlayKey, true);

  // the axis ball: drag turns, a tap on an axis looks from that side
  (() => {
    let g = null;
    gizmo.addEventListener("pointerenter", () => { gHot = true; dirty = true; });
    gizmo.addEventListener("pointerleave", () => { if (!g) { gHot = false; dirty = true; } });
    gizmo.addEventListener("pointerdown", (e) => {
      if (e.button > 1) return;
      e.preventDefault(); e.stopPropagation();
      gizmo.setPointerCapture(e.pointerId); stopPlay(); gHot = true; dirty = true;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, cam: camAt(keys, p), moved: false };
    });
    gizmo.addEventListener("pointermove", (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.moved && Math.hypot(dx, dy) < 4) return;
      g.moved = true;
      dragTo("orbit", g.cam, dx * 1.5, dy * 1.5);
    });
    const end = (e) => {
      if (!g || e.pointerId !== g.id) return;
      if (!g.moved && e.type === "pointerup" && (e.pointerType === "mouse" || !tipEl || tipEl.hidden)) {
        const r = gizmo.getBoundingClientRect(), x = (e.clientX - r.left) * GZ / r.width, y = (e.clientY - r.top) * GZ / r.height;
        let hit = null;
        for (const b of gBalls) if (Math.hypot(b.x - x, b.y - y) <= 9) hit = b;
        if (hit?.view) setCam({ ...camAt(keys, p), ...hit.view });
        else if (hit) flash("Nothing behind: the camera never saw the back.");
      }
      g = null;
      if (e.pointerType !== "mouse") gHot = false;
      dirty = true;
    };
    gizmo.addEventListener("pointerup", end);
    gizmo.addEventListener("pointercancel", end);
  })();
  for (const kind of ["zoom", "pan", "shot"]) {
    const b = el("button", kind, { html: NAV_ICONS[kind], "data-tip": NAV_TIPS[kind], "aria-label": NAV_TIPS[kind] });
    nav.append(b);
    if (kind === "shot") { b.onclick = (e) => { e.stopPropagation(); stopPlay(); setCam({ ...K0 }); }; continue; }
    let g = null;
    b.addEventListener("pointerdown", (e) => {
      if (e.button > 1) return;
      e.preventDefault(); e.stopPropagation();
      b.setPointerCapture(e.pointerId); stopPlay(); b.classList.add("on");
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, cam: camAt(keys, p) };
    });
    b.addEventListener("pointermove", (e) => {
      if (!g || e.pointerId !== g.id) return;
      const m = kind === "pan" ? 1 : 1.5;
      dragTo(kind, g.cam, (e.clientX - g.x) * m, (e.clientY - g.y) * m);
    });
    const end = (e) => { if (g && e.pointerId === g.id) { g = null; b.classList.remove("on"); } };
    b.addEventListener("pointerup", end);
    b.addEventListener("pointercancel", end);
  }
  function flash(text) { flashText = text; flashUntil = performance.now() + 2600; dirty = true; setTimeout(() => { dirty = true; }, 2700); }

  // ---------- the ? : the whole how-to, out of the way until asked for ----------
  function buildHelp() {
    help.innerHTML = "";
    const h = el("div", "acm-help-h", { text: "How to steer" });
    const x = el("button", "acm-help-x", { text: "×", "aria-label": "Close" });
    x.onclick = () => openHelp(false);
    h.append(x);
    const dl = el("dl");
    const rows = [
      ["Picture", "Drag to turn the camera round. Pinch or scroll to pull back or push in; two fingers or Shift pan. Tap a spot to circle round it."],
      ["Top right", "Drag the axis ball to turn, or tap an axis to look from that side. Drag the magnifier to zoom and the hand to pan. The camera puts you back on your own shot."],
      ["Keys", "Click the time bar to put a key there, or drag the time bar and move the camera. ◆ adds or removes a key, ◀ ▶ jump between keys. Drag a key along the bar to change its time."],
      ["Play", "⏮ goes back to the start, ▶ plays, and the loop button plays it round and round."],
      ["Mouse", "Like Blender: middle-drag turns, Shift pans, Ctrl zooms, the wheel zooms. Numpad 4 6 8 2 turn, + − zoom, 1 3 7 front, right, top, 0 your own shot. Space plays, Home goes to the start."],
      ["Pink", "What the camera never saw. The CrossView-Warp LoRA paints it in."],
    ];
    for (const [k, v] of rows) dl.append(el("dt", "", { text: k }), el("dd", "", { text: v }));
    help.append(h, dl);
  }
  function openHelp(open) { if (open) buildHelp(); help.hidden = !open; helpBtn.setAttribute("aria-expanded", String(open)); }
  helpBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  helpBtn.onclick = (e) => { e.stopPropagation(); openHelp(help.hidden); };
  const closeHelp = (e) => { if (!help.hidden && !help.contains(e.target) && !helpBtn.contains(e.target)) openHelp(false); };
  document.addEventListener("pointerdown", closeHelp, true);

  // ---------- the time bar ----------
  let keyEls = [];
  function drawTrack() {
    for (const k of keyEls) k.remove();
    keyEls = [];
    for (const k of keys) {
      const d = el("div", `acm-key${Math.abs(k.t - p) < SAME_KEY ? " on" : ""}`);
      d.style.left = `${k.t * 100}%`;
      inner.insertBefore(d, head);
      keyEls.push(d);
    }
    head.style.left = `${p * 100}%`;
    const count = info?.count ?? 0;
    time.textContent = count ? `${Math.round(p * (count - 1)) + 1} / ${count}` : `${Math.round(p * 100)}%`;
    // the diamond is filled while the time bar sits on a key, hollow when it does not
    const on = keyAt(keys, p) >= 0;
    toggleKey.classList.toggle("on", on);
    const tipText = !on ? "Add a key here" : keys.length > 1 ? "Remove this key" : "The last key stays";
    toggleKey.dataset.tip = tipText; toggleKey.setAttribute("aria-label", tipText);
    toggleKey.disabled = on && keys.length < 2;
    prevKey.disabled = !keys.some((k) => k.t < p - SAME_KEY);
    nextKey.disabled = !keys.some((k) => k.t > p + SAME_KEY);
  }
  (() => {
    let drag = null;
    const tAt = (e) => { const r = inner.getBoundingClientRect(); return clamp((e.clientX - r.left) / (r.width || 1), 0, 1); };
    const set = (e) => { let t = tAt(e); for (const k of keys) if (Math.abs(k.t - t) < 0.03) t = k.t; p = t; dirty = true; };
    track.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      track.setPointerCapture(e.pointerId); stopPlay();
      const r = inner.getBoundingClientRect();
      let hit = null, best = 11; // press on a key to grab it; anywhere else moves the time bar
      for (const k of keys) { const d = Math.abs(r.left + k.t * r.width - e.clientX); if (d < best) { best = d; hit = k; } }
      drag = { key: hit, x: e.clientX, moved: false };
      if (hit) { p = hit.t; dirty = true; } else set(e);
    });
    track.addEventListener("pointermove", (e) => {
      if (!drag) return;
      if (!drag.key) { if (Math.abs(e.clientX - drag.x) >= 4) drag.moved = true; set(e); return; }
      if (!drag.moved && Math.abs(e.clientX - drag.x) < 4) return;
      drag.moved = true; // a key slides between its neighbours and never jumps over one
      const i = keys.indexOf(drag.key), lo = i > 0 ? keys[i - 1].t + 0.02 : 0, hi = i < keys.length - 1 ? keys[i + 1].t - 0.02 : 1;
      drag.key.t = clamp(tAt(e), lo, hi); p = drag.key.t;
      writeSoon();
    });
    // A click on an empty spot of the bar puts a key there; a drag only moves the time bar.
    const end = (e) => {
      if (drag && !drag.key && !drag.moved && e.type === "pointerup" && keyAt(keys, p) < 0) setCam(camAt(keys, p));
      drag = null;
    };
    track.addEventListener("pointerup", end);
    track.addEventListener("pointercancel", end);
  })();
  const playLabel = (on) => { play.textContent = on ? "❚❚" : "▶"; play.dataset.tip = on ? "Pause" : "Play"; play.setAttribute("aria-label", play.dataset.tip); };
  function stopPlay() { if (playing) { playing = false; playLabel(false); } }
  play.onclick = () => {
    if (playing) { stopPlay(); return; }
    if (p >= 0.999) p = 0;
    playing = true; lastT = performance.now(); playLabel(true);
  };
  loop.onclick = () => {
    looping = !looping;
    loop.setAttribute("aria-pressed", String(looping));
    loop.dataset.tip = looping ? "Looping: click to play once" : "Play on a loop";
    loop.setAttribute("aria-label", loop.dataset.tip);
  };
  const toStart = () => { p = 0; lastT = performance.now(); dirty = true; }; // playing carries on from the start
  toStartBtn.onclick = toStart;
  toggleKey.onclick = () => { // add a key at the time bar, or remove the one it sits on
    stopPlay();
    const i = keyAt(keys, p);
    if (i < 0) setCam(camAt(keys, p));
    else if (keys.length > 1) { keys.splice(i, 1); writeSoon(); }
  };
  const jump = (dir) => {
    stopPlay();
    const k = dir < 0 ? [...keys].reverse().find((x) => x.t < p - SAME_KEY) : keys.find((x) => x.t > p + SAME_KEY);
    if (k) { p = k.t; dirty = true; }
  };
  prevKey.onclick = () => jump(-1);
  nextKey.onclick = () => jump(1);
  reset.onclick = () => {
    stopPlay();
    keys.length = 0; keys.push({ t: 0, ...K0 });
    pivotSpec = null; resolvePivot(); p = 0;
    writeSoon();
  };
  for (const b of [play, prevKey, toggleKey, nextKey, reset]) b.addEventListener("pointerdown", (e) => e.stopPropagation());

  // ---------- before there is a clip to look at ----------
  function drawEmpty() {
    const show = status !== "ready";
    empty.hidden = !show;
    if (!show) return;
    const key = `${status}|${statusNote}`;
    if (empty.dataset.key === key) return;
    empty.dataset.key = key;
    empty.innerHTML = "";
    if (status === "running") {
      empty.append(el("b", "", { text: "Reading the depth…" }), el("span", "", { text: "MoGe looks at every frame once. A long clip takes a while." }));
      return;
    }
    if (status === "loading") { empty.append(el("b", "", { text: "Loading your clip…" })); return; }
    const go = el("button", "acm-btn primary", { text: "Show my clip", "data-tip": "Runs this node and the depth before it, not the whole workflow" });
    go.addEventListener("pointerdown", (e) => e.stopPropagation());
    go.onclick = async (e) => {
      e.stopPropagation();
      status = "running"; statusNote = ""; dirty = true;
      let ok = false;
      try { ok = await opts.run(); } catch { ok = false; }
      if (!ok && status === "running") { status = "idle"; statusNote = "It did not run. Pick a clip in Load Video, and check MoGe Inference is connected."; dirty = true; }
    };
    empty.append(el("b", "", { text: "Steer the camera on your clip" }), el("span", "", { text: statusNote || "Run the depth once to see your first frame here." }), go);
  }

  // ---------- loop ----------
  function frame(now) {
    if (!alive) return;
    requestAnimationFrame(frame);
    if (!root.isConnected) return;
    readCamera();
    if (playing) {
      const dur = Math.max(1, (info?.count ?? 121) / FPS);
      p += (now - lastT) / 1000 / dur; lastT = now; dirty = true;
      if (p >= 1) { if (looping) p %= 1; else { p = 1; stopPlay(); } }
    }
    flushWrite();
    if (!dirty) return;
    if (root.offsetParent === null && !root.getClientRects().length) return;
    dirty = false;
    const cam = camAt(keys, p);
    const want = nearestLoaded(p);
    // a new run's frames take over as they load; until then the last ones stay up
    if (want && want !== shown) shown = want;
    if (!info) shown = null;
    const fit = fitPicture();
    drawEmpty();
    renderPreview(cam, fit);
    drawGizmo(cam);
    renderOutside(cam);
    drawTrack();
    where.textContent = describe(cam);
    pink.textContent = shown ? `pink ${pinkPct.toFixed(0)}%` : "";
    const over = pastLoraRange(cam), fl = performance.now() < flashUntil;
    const warnText = fl ? flashText : over ? "Past the LoRA's range: it learned up to 45° of turn, 30° up and 20° down." : "";
    if (warn.textContent !== warnText) { warn.textContent = warnText; warn.dataset.tip = warnText; }
    if (!warnText) delete warn.dataset.tip;
    back.set(cam.back);
  }
  const resize = new ResizeObserver(() => { dirty = true; });
  resize.observe(stage);
  requestAnimationFrame(frame);

  return {
    root,
    // What a run of the node sent back: the frames to look at.
    takeScene(payload) {
      if (!payload || !Array.isArray(payload.frames) || !payload.frames.length) return;
      info = payload;
      frames = payload.frames.map((entry) => ({ t: entry.t, entry, data: null }));
      shown = null;
      if (status !== "ready") status = "loading";
      resolvePivot();
      dirty = true;
      loadAll(payload);
    },
    runFailed(note) {
      if (status !== "running") return;
      status = "idle"; statusNote = note || "It did not run. Pick a clip in Load Video, and check MoGe Inference is connected."; dirty = true;
    },
    running() { if (status !== "ready") { status = "running"; dirty = true; } },
    refresh() { lastText = null; dirty = true; },
    get hasScene() { return Boolean(info); },
    // The least height the face needs: the picture's least, and the controls as they measure.
    floor() { return MIN_STAGE + (controls.offsetHeight || CONTROLS_HEIGHT); },
    destroy() {
      alive = false;
      resize.disconnect();
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", onPlayKey, true);
      document.removeEventListener("pointerdown", closeHelp, true);
      hideTip();
    },
  };
}
