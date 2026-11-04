import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as math from "../js/shared/touch_math.mjs";
import * as brush from "../js/shared/brush.mjs";

const source = readFileSync(new URL("../js/shared/touch_stage.mjs", import.meta.url), "utf8");
const strip = (text) => text.replace(/^import\s+[\s\S]*?\sfrom\s+["'][^"']+["'];\s*/gm, "").replace(/^export /gm, "");

function stage() {
  const timers = new Map();
  let nextTimer = 0;
  const context = vm.createContext({
    ...math, ...brush, console, URLSearchParams, Uint8Array, Uint32Array, Float32Array,
    Map, Set, WeakMap, WeakSet, Promise,
    performance: { now: () => 1000 },
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, queueMicrotask,
    api: { apiURL: (path) => path }, notifyAusbossChange() {},
    chainCallback(target, name, fn) {
      const prior = target[name];
      target[name] = function (...args) { const result = prior?.apply(this, args); fn.apply(this, args); return result; };
    },
  });
  vm.runInContext(strip(source), context);
  const run = (code) => vm.runInContext(code, context);
  return { context, timers, run };
}

test("late piece and picture downloads cannot replace a newer note", async () => {
  const { context, run } = stage();
  const downloads = new Map();
  context.downloads = downloads;
  run(`
    loadImage = url => new Promise(resolve => downloads.set(new URLSearchParams(url.split('?')[1]).get('filename'), resolve));
    readPixels = (_image, w, h) => new Uint8Array(w*h*4).fill(255);
    syncState = () => {};
    show = (_face, entry) => { globalThis.shown = entry.pieces.list[0].name; };
    const face = {alive:true,flying:[],turn:0,sourceEpoch:0,node:{widgets:[]}};
    const base = {key:'4x4-picture',width:4,height:4,scale:1,stamp:''};
    globalThis.entry = pictureFor(base, face);
    const note = (name, more) => ({...base,picture:{filename:name+'.jpg'},pieces:{list:[{x:1,y:1,kind:'name',name,sure:1}],planes:[{filename:name+'.png'}],more}});
    globalThis.oldJob = takeNote(face, note('old', true));
    globalThis.newJob = takeNote(face, note('new', false));
  `);
  downloads.get("new.jpg")({});
  downloads.get("new.png")({});
  await context.newJob;
  downloads.get("old.jpg")({});
  downloads.get("old.png")({});
  await context.oldJob;
  assert.equal(context.shown, "new");
  assert.equal(context.entry.pieces.list[0].name, "new");
  assert.equal(context.entry.file, "new.jpg");
  assert.equal(context.entry.scoped, true);
});

test("selection, area and fine caches belong to each face", () => {
  const { run } = stage();
  run(`
    const note = {key:'same-picture',width:2,height:2,scale:1};
    const first = pictureFor(note, {});
    const second = pictureFor(note, {});
    const text = encodeTouches(first.key,[{t:'subject',op:1}]);
    const state = {pic:first,items:decodeTouches(text).items,stamp:stampOf(text),stamps:prefixStamps(first.key,decodeTouches(text).items)};
    remember(first,state.stamp,Uint8Array.from([1,0,0,0]));
    keepArea(first,'subject',Uint8Array.from([1,0,0,0]));
    first.fine = {made:'first model'};
    remember(second,state.stamp,Uint8Array.from([0,0,0,1]));
    keepArea(second,'subject',Uint8Array.from([0,0,0,1]));
    second.fine = {made:'second model'};
    resolve(state);
    globalThis.result = {raw:Array.from(state.raw),area:Array.from(first.areas.get('subject')),fine:first.fine.made};
  `);
  const result = JSON.parse(run("JSON.stringify(result)"));
  assert.deepEqual(result, { raw: [1, 0, 0, 0], area: [1, 0, 0, 0], fine: "first model" });
});

test("late selection and fine downloads cannot overwrite the current stamp", async () => {
  const { context, run } = stage();
  const downloads = context.downloads = new Map();
  run(`
    loadImage = url => new Promise(resolve => downloads.set(new URLSearchParams(url.split('?')[1]).get('filename'), resolve));
    readPixels = (image, w, h) => new Uint8Array(w*h*4).fill(image.value);
    syncState = () => {}; show = () => {};
    const face = {alive:true,flying:[],turn:0,sourceEpoch:0,node:{widgets:[]}};
    const base = {key:'2x2-picture',width:2,height:2,scale:1,stamp:'same',picture:{filename:'picture.jpg'}};
    globalThis.entry = pictureFor(base,face);
    entry.image = {}; entry.file = 'picture.jpg';
    const note = name => ({...base,selection:{filename:name+'-selection.png'},fine:{file:{filename:name+'-fine.png'},made:name}});
    globalThis.oldJob = takeNote(face,note('old'));
    globalThis.newJob = takeNote(face,note('new'));
  `);
  downloads.get("new-selection.png")({ value: 0 });
  downloads.get("new-fine.png")({ value: 0 });
  await context.newJob;
  downloads.get("old-selection.png")({ value: 255 });
  downloads.get("old-fine.png")({ value: 255 });
  await context.oldJob;
  assert.deepEqual([...context.entry.states.get("same")], [0, 0, 0, 0]);
  assert.equal(context.entry.fine.made, "new");
});

test("restored picks never schedule fine processing", () => {
  const { context, timers, run } = stage();
  run(`
    adopt = () => false; readItems = () => {}; resolve = () => {};
    syncState = () => {}; refreshHover = () => {}; draw = () => {}; drawInk = () => {};
    settings = () => ({fine:'model.safetensors'}); fineOf = () => null;
    globalThis.requested = [];
    requestRun = (_face, ask) => requested.push(ask);
    const pic = {key:'picture',piecesTag:''};
    const face = {alive:true,pic,node:{},items:[{t:'paint',op:1,r:10,pts:[[1,1]]}],exact:true,stamp:'same',shownPieces:'',pending:[],inFlight:false};
    show(face,pic,{stamp:'same'},null,{restored:true});
  `);
  for (const { fn } of [...timers.values()]) fn();
  assert.deepEqual([...context.requested], []);
});

test("source subscriptions release removed faces while the loader survives", () => {
  const { context, run } = stage();
  run(`
    globalThis.reads = 0;
    globalThis.priorCalls = 0;
    const loader = {widgets:[{name:'image',value:'picture.png',callback(){priorCalls++;}}]};
    ownLoaderNode = () => loader;
    for (let n=0;n<100;n++) {
      const face = {node:{},watchedSources:new WeakSet(),forgetSources:[],host:{},get alive(){reads++;return false;}};
      followOwnLoader(face);
      for (const forget of face.forgetSources) forget();
    }
    loader.widgets[0].callback();
  `);
  assert.equal(context.reads, 0);
  assert.equal(context.priorCalls, 1);
});

test("plain Load Image subscriptions are removable too", async () => {
  const { context, run } = stage();
  run(`
    globalThis.reads = 0;
    const widget = {};
    loaderSource = () => null; loaderWidget = () => widget;
    for (let n=0;n<100;n++) {
      const face = {node:{},sourceUrl:'',watchedSources:new WeakSet(),forgetSources:[],get alive(){reads++;return false;}};
      syncSource(face);
      for (const forget of face.forgetSources) forget();
    }
    widget.callback();
  `);
  await Promise.resolve();
  assert.equal(context.reads, 0);
});

test("destroy cancels the pending click and releases source subscriptions", () => {
  const { context, timers, run } = stage();
  run(`
    globalThis.forgotten = 0; globalThis.aborted = false;
    globalThis.face = {alive:true,pendingTimer:setTimeout(()=>{},500),forgetSources:[()=>forgotten++]};
    globalThis.abort = {abort(){aborted=true;}};
  `);
  const start = source.indexOf("  face.destroy = () => {");
  const end = source.indexOf("\n  };", start) + "\n  };".length;
  run(source.slice(start, end));
  context.face.destroy();
  assert.equal(context.face.alive, false);
  assert.equal(timers.size, 0);
  assert.equal(context.forgotten, 1);
  assert.equal(context.aborted, true);
});

test("Clear is enabled for malformed stored touches and erases the text", () => {
  const { context, run } = stage();
  run(`
    const toggle = {toggle(){}};
    globalThis.face = {node:{},pic:null,items:[],pending:[],past:[],touches:{value:'{'},host:{},
      undo:{},clear:{},toolSwitch:{set(){},root:{classList:toggle}},softField:{classList:toggle},softBox:{set(){}},
      subjectButton:{},backgroundButton:{},eye:{classList:toggle},size:{set(){}},view:'tint'};
    syncTools(face);
  `);
  assert.equal(context.face.clear.disabled, false);
  run(`
    dropPending = () => {}; syncReadout = () => {}; syncState = () => {}; refreshHover = () => {};
    button = (_class, _text, _title, click) => ({click});
    globalThis.signal = null;
  `);
  const start = source.indexOf("  face.clear = button(");
  const end = source.indexOf("  }, signal);", start) + "  }, signal);".length;
  run(source.slice(start, end));
  context.face.clear.click();
  assert.equal(context.face.touches.value, "");
});

test("named pieces of one through four pixels can be added and removed", () => {
  for (let size = 1; size <= 4; size++) {
    const planes = [new Uint32Array(size).fill(1)];
    const sizes = math.pieceSizes(planes, 1);
    assert.equal(math.pieceAt(planes, 0, { sizes, inside: [0] }), 0);
    assert.equal(math.pieceAt(planes, 0, { sizes, inside: [size], adding: false }), 0);
    assert.equal(math.pieceAt(planes, 0, { sizes, inside: [size] }), -1);
    assert.equal(math.pieceAt(planes, 0, { sizes, inside: [0], adding: false }), -1);
  }
});
