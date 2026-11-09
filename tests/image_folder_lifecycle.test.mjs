import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { getEventListeners, setMaxListeners } from 'node:events';
import test from 'node:test';
import * as helpers from '../js/shared/image_folder.mjs';
import * as scope from '../js/shared/prompt_scope.mjs';
import * as math from '../js/shared/widget_card_math.mjs';
import * as layout from '../js/shared/panel_layout.mjs';
class Element extends EventTarget {
  constructor(tag = 'div') {
    super(); setMaxListeners(0, this); this.tagName = tag.toUpperCase(); this.children = []; this.style = {}; this.dataset = {}; this.className = ''; this.textContent = ''; this.parentElement = null; this.isConnected = true;
    this.classList = {
      contains: name => this.className.split(' ').includes(name),
      add: name => { if (!this.classList.contains(name)) this.className += ` ${name}`; },
      remove: name => { this.className = this.className.split(' ').filter(x => x !== name).join(' '); },
      toggle: (name, on) => on ? this.classList.add(name) : this.classList.remove(name)
    };
  }
  append(...items) { for (const item of items) { this.children.push(item); item.parentElement = this; } }
  appendChild(item) { this.append(item); return item; }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this); this.isConnected = false; }
  contains(target) { return this === target || this.children.some(x => x.contains(target)); }
  matches(query) { return query.startsWith('.') ? this.classList.contains(query.slice(1)) : this.tagName.toLowerCase() === query; }
  closest(query) { return this.matches(query) ? this : this.parentElement?.closest(query) ?? null; }
  querySelector(query) { for (const child of this.children) { if (child.matches(query)) return child; const found = child.querySelector(query); if (found) return found; } return null; }
  get firstChild() { return this.children[0]; }
  get lastChild() { return this.children.at(-1); }
  getBoundingClientRect() { return {left: 20, top: 20, bottom: 200, width: 340}; }
  click() { this.dispatchEvent(new Event('click')); }
}

function harness() {
  const timers = new Map(); let timerId = 0;
  const document = { head: new Element('head'), body: new Element('body'), createElement: tag => new Element(tag), createTextNode: text => Object.assign(new Element('text'), {textContent: text}), getElementById: () => null };
  const window = Object.assign(new EventTarget(), {innerWidth: 1000, innerHeight: 800});
  const messages = [];
  const app = {canvas: {}, registerExtension(extension) { this.extension = extension; }, extensionManager: {toast: {add(message) { messages.push(message); }}}};
  const pending = [];
  const api = {apiURL: x => x, fetchApi: (url, options) => new Promise((resolve, reject) => pending.push({url, options, resolve, reject}))};
  class FormData { constructor() { this.fields = {}; } append(key, value) { this.fields[key] = value; } }
  const context = vm.createContext({console, document, window, app, api, AbortController: class extends AbortController { constructor() { super(); setMaxListeners(0, this.signal); } }, performance, FormData, queueMicrotask, ...helpers, ...scope, commitWidgetValue: math.commitWidgetValue, fillNodeHeight: layout.fillNodeHeight,
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, {fn, delay}); return id; }, clearTimeout: id => timers.delete(id)});
  function strip(source) { return source.replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, ''); }
  vm.runInContext(strip(fs.readFileSync(new URL('../js/shared/index.mjs', import.meta.url), 'utf8')), context);
  vm.runInContext(strip(fs.readFileSync(new URL('../js/image_folder/index.js', import.meta.url), 'utf8')) + '\nglobalThis.review = {buildPanel, refresh, write, copyFolder, addFiles, browse, closeBrowse, addMenu, closeMenu, askBig, closeAsk, paint, scheduleRefresh};', context);
  const r = context.review;
  class FolderNode {
    constructor(values = {}) {
      this.widgets = Object.entries({source:'input', folder:'', subfolders:false, sort:'name', pictures:'', run:'all in one run', position:1, after_run:'next', at_the_end:'stop the run', ...values}).map(([name,value]) => ({name,value}));
      this.inputs = []; this.size = [340,400]; this.onNodeCreated();
    }
    addDOMWidget(name, type, element, options) { const w = {name,type,element,options,node:this}; this.widgets.push(w); return w; }
    computeSize() { return [320,300]; }
    setSize(size) { this.size = size; }
  }
  app.extension.beforeRegisterNodeDef(FolderNode, {name:'AUSBOSS_NODES_ImageFolder'});
  const value = (node, name) => node.widgets.find(w => w.name === name).value;
  const flush = async () => { for (let i=0;i<10;i++) await Promise.resolve(); };
  const ok = data => ({ok:true, json:async () => data});
  const newNode = values => { const n = new FolderNode(values); timers.clear(); return n; };
  const image = name => ({file:{name,size:1,type:'image/png'},folder:''});

  return {r, newNode, pending, messages, document, window, timers, value, flush, ok, image};
}

for (const change of ['edit', 'configure']) {
  test(`a pending listing cannot overwrite a later ${change}`, async () => {
    const {r, newNode, pending, value, ok, flush} = harness();
    const n = newNode({folder: 'a//'}), s = n.__ausbossImageFolder;
    const task = r.refresh(s), old = pending.shift();
    if (change === 'edit') r.write(n, 'folder', 'b');
    else {
      n.widgets.find(w => w.name === 'folder').value = 'b';
      n.onConfigure({size: [320, 400]});
      await flush();
    }
    old.resolve(ok({source: 'input', folder: 'a', pictures: [{name: 'old.png'}]}));
    await task;
    assert.equal(value(n, 'folder'), 'b');
    assert.equal(s.list.length, 0);
  });
}

test('folder copies lock before confirmation and release after completion', async () => {
  const {r, newNode, pending, value, ok, flush, image} = harness();
  const n = newNode(), s = n.__ausbossImageFolder;
  const first = r.copyFolder(s, 'first', [image('a.png')]);
  const second = r.copyFolder(s, 'second', [image('b.png')]);
  await flush();
  assert.equal(pending.length, 1);
  pending.shift().resolve(ok({name: 'a.png'}));
  await Promise.all([first, second]);
  assert.equal(value(n, 'folder'), 'first');
  const third = r.copyFolder(s, 'third', [image('c.png')]);
  await flush();
  assert.equal(pending.length, 1);
  pending.shift().resolve(ok({name: 'c.png'}));
  await third;
  assert.equal(value(n, 'folder'), 'third');
});

test('confirmation also holds the folder-copy lock', async () => {
  const {r, newNode, pending, ok, flush, image} = harness();
  const s = newNode().__ausbossImageFolder;
  const first = r.copyFolder(s, 'big', Array.from({length: 301}, () => image('a.png')));
  const second = r.copyFolder(s, 'second', [image('b.png')]);
  await flush();
  assert.equal(pending.length, 0);
  r.closeAsk(false);
  await Promise.all([first, second]);
  const next = r.copyFolder(s, 'next', [image('c.png')]);
  await flush();
  pending.shift().resolve(ok({name: 'c.png'}));
  await next;
});

for (const at_the_end of ['stop the run', 'start over']) {
  test(`queue advancement ignores missing and stale listings with ${at_the_end}`, () => {
    const {newNode, value} = harness();
    const n = newNode({run: 'one per run', at_the_end}), s = n.__ausbossImageFolder;
    const position = n.widgets.find(w => w.name === 'position');
    for (let i = 1; i <= 3; i++) {
      assert.equal(value(n, 'position'), i);
      position.afterQueued({isPartialExecution: false});
    }
    s.names = ['a.png', 'b.png'];
    n.inputs.push({name: 'folder', link: 42});
    for (let i = 4; i <= 8; i++) {
      assert.equal(value(n, 'position'), i);
      position.afterQueued({isPartialExecution: false});
    }
    position.afterQueued({isPartialExecution: true});
    assert.equal(value(n, 'position'), 9);
    n.inputs.push({name: 'position', link: 43});
    position.afterQueued({isPartialExecution: false});
    assert.equal(value(n, 'position'), 9);
  });
}

test('removing a node stops loose uploads and completion work', async () => {
  const {r, newNode, pending, messages, ok} = harness();
  const n = newNode(), s = n.__ausbossImageFolder;
  const task = r.addFiles(s, [{name: 'a.png'}, {name: 'b.png'}]);
  const first = pending.shift();
  n.onRemoved();
  first.resolve(ok({name: 'a.png'}));
  // Let a broken implementation finish so a failure does not leave a pending test.
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const extra = pending.splice(0);
  for (const request of extra) request.resolve(ok({name: 'b.png'}));
  await task;
  assert.equal(extra.length, 0);
  assert.equal(messages.length, 0);
});

test('Browse accepts only the newest navigation response', async () => {
  const {r, newNode, pending, document, value, ok, flush} = harness();
  const n = newNode({folder: 'album'});
  const task = r.browse(n.__ausbossImageFolder);
  pending.shift().resolve(ok({source: 'input', folder: 'album', folders: ['a', 'b']}));
  await task;
  const root = document.body.querySelector('.ausboss-if-browse');
  const list = root.querySelector('.ausboss-if-browse-list');
  list.children.find(x => x.textContent === 'a').click();
  list.children.find(x => x.textContent === 'b').click();
  const a = pending.shift(), b = pending.shift();
  b.resolve(ok({source: 'input', folder: 'album/b', folders: []}));
  await flush();
  a.resolve(ok({source: 'input', folder: 'album/a', folders: []}));
  await flush();
  root.querySelector('.use').click();
  assert.equal(value(n, 'folder'), 'album/b');
});

test('Browse keeps the returned source through navigation and selection', async () => {
  const {r, newNode, pending, document, value, ok, flush} = harness();
  const n = newNode({folder: '/server/output/album'});
  const task = r.browse(n.__ausbossImageFolder);
  pending.shift().resolve(ok({source: 'output', folder: 'album', folders: ['child']}));
  await task;
  const root = document.body.querySelector('.ausboss-if-browse');
  root.querySelector('.ausboss-if-browse-list').children.find(x => x.textContent === 'child').click();
  const request = pending.shift();
  assert.match(request.url, /source=output/);
  request.resolve(ok({source: 'output', folder: 'album/child', folders: []}));
  await flush();
  root.querySelector('.use').click();
  assert.equal(value(n, 'source'), 'output');
  assert.equal(value(n, 'folder'), 'album/child');
});

for (const kind of ['menu', 'browse', 'ask']) {
  test(`removal closes only the owner's ${kind}, even with a connected grid`, async () => {
    const {r, newNode, pending, document, window, ok, image} = harness();
    const a = newNode(), b = newNode(), s = b.__ausbossImageFolder;
    let task;
    if (kind === 'menu') r.addMenu(s, s.add);
    if (kind === 'browse') {
      task = r.browse(s);
      pending.shift().resolve(ok({source: 'input', folder: '', folders: []}));
      await task;
    }
    if (kind === 'ask') task = r.askBig(s, 'big', Array.from({length: 301}, () => image('a.png')));
    const selector = `.ausboss-if-${kind}`;
    const listenerCount = getEventListeners(window, 'keydown').length;
    assert.ok(listenerCount > 0);
    a.onRemoved();
    assert.ok(document.body.querySelector(selector));
    assert.equal(getEventListeners(window, 'keydown').length, listenerCount);
    assert.equal(s.grid.isConnected, true);
    b.onRemoved();
    assert.equal(document.body.querySelector(selector), null);
    assert.equal(getEventListeners(window, 'keydown').length, 0);
    if (kind === 'ask') assert.equal(await task, false);
    window.dispatchEvent(new Event('keydown'));
  });
}

test('completion marks reset for another folder and reject old results', async () => {
  const {r, newNode, pending, ok} = harness();
  const n = newNode({folder: 'album-a'}), s = n.__ausbossImageFolder;
  const note = {count: 1, loaded: [1], names: ['same.png'], context: {source: 'input', folder: 'album-a', subfolders: false}};
  n.onExecuted({ausboss_image_folder: [note]});
  assert.equal(s.done.has('same.png'), true);
  r.write(n, 'folder', 'album-b');
  assert.equal(s.done.size, 0);
  assert.equal(s.loadedLine, '');
  n.onExecuted({ausboss_image_folder: [note]});
  assert.equal(s.done.size, 0);
  const task = r.refresh(s);
  pending.shift().resolve(ok({source: 'input', folder: 'album-b', pictures: [{name: 'same.png'}]}));
  await task;
  assert.equal(s.cells.get('same.png').classList.contains('done'), false);
  n.onExecuted({ausboss_image_folder: [{...note, context: {...note.context, folder: 'album-b'}}]});
  assert.equal(s.done.has('same.png'), true);
});
