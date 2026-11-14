import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { clipSetsDuration, linkSource } from '../js/shared/h3_duration.mjs';

const graphWith = (mode = 0, useMap = false) => {
  const source = { id: 150, mode };
  const link = { origin_id: 150 };
  return { source, node: { inputs: [{name:'video', link:8}], graph: {
    ...(useMap ? {_links:new Map([[8,link]])} : {links:{8:link}}),
    getNodeById:id=>id===150?source:null,
  } } };
};
test('only the three backend duration overrides use the clip', () => {
  const {node}=graphWith();
  for(const job of ['swap the person','new voice','change something']) assert.equal(clipSetsDuration(node,{video_job:job}),true);
  for(const job of ['copy its moves','keep going','',undefined]) assert.equal(clipSetsDuration(node,{video_job:job}),false);
});
test('Full Video OFF/bypassed/missing/disconnected restore seconds; both link stores work', () => {
  for(const map of [false,true]) {
    const {node,source}=graphWith(0,map);
    assert.equal(linkSource(node,'video'),source);
    const values={video_job:'swap the person',seconds:12};
    for(const mode of [2,4]) {source.mode=mode;assert.equal(clipSetsDuration(node,values),false);}
    source.mode=0;assert.equal(clipSetsDuration(node,values),true);
    node.graph.getNodeById=()=>null;assert.equal(clipSetsDuration(node,values),false);
    node.inputs[0].link=null;assert.equal(clipSetsDuration(node,values),false);
    assert.deepEqual(values,{video_job:'swap the person',seconds:12});
  }
});
test('the predicate preserves widgets, socket IDs and literal linked Length', () => {
  const {node}=graphWith();node.widgets=[{name:'seconds',value:12}];
  node.inputs.push({name:'seconds',link:19,widget:{name:'seconds'}});
  const before=JSON.stringify(node, (k,v)=>k==='graph'?undefined:v);
  clipSetsDuration(node,{video_job:'new voice',seconds:12});
  assert.equal(JSON.stringify(node,(k,v)=>k==='graph'?undefined:v),before);
});

// Run the actual timeline module with only host/DOM boundaries replaced. The
// request cancellation, live wire checks and transition logic remain real.
class Element {
 constructor(){this.children=[];this.style={setProperty(){}};this.classList={toggle(){},remove(){},add(){}};this._text='';}
 append(...children){this.children.push(...children);}
 set textContent(text){this._text=String(text);this.children=[];}
 get textContent(){return this._text+this.children.map(c=>c.textContent??'').join('');}
 addEventListener(){}
}
test('timeline omits guessed duration/retiming and rejects an old async report; old timeline returns on Video OFF', async()=>{
 const realDocument=globalThis.document;
 globalThis.document={getElementById:()=>true,createElement:()=>new Element()};
 const timers=[];const intervals=[];const requests=[];const pending=[];
 globalThis.__h3DurationTest={
   api:{fetchApi:async(_url,opts)=>{requests.push(JSON.parse(opts.body));return await new Promise(resolve=>pending.push(resolve));}},
   app:{},chainCallback(){},
   attachScriptColours:()=>({area:null,layer:null,sync(){},dispose(){}}),
   attachScriptAssist:()=>({dispose(){}}),
   setTimeout:fn=>{timers.push(fn);return fn;},clearTimeout:fn=>{const i=timers.indexOf(fn);if(i>=0)timers.splice(i,1);},
   setInterval:fn=>{intervals.push(fn);return fn;},clearInterval(){},
 };
 try {
   let source=readFileSync(new URL('../js/shared/moment_strip.mjs',import.meta.url),'utf8');
   source=source.replace(/^import .*;$/gm,line=>{
     if(line.includes('h3_duration.mjs')||line.includes('moment_strip_math.mjs')||line.includes('widget_card_math.mjs'))
       return line.replace(/"\.\/(.*?)"/,(_m,file)=>JSON.stringify(new URL('../js/shared/'+file,import.meta.url).href));
     if(line.includes('api.js'))return 'const {api}=globalThis.__h3DurationTest;';
     if(line.includes('app.js'))return 'const {app}=globalThis.__h3DurationTest;';
     if(line.includes('index.mjs'))return 'const BRAND="#0ba", {chainCallback}=globalThis.__h3DurationTest;';
     if(line.includes('script_assist.mjs'))return 'const {attachScriptAssist}=globalThis.__h3DurationTest;';
     if(line.includes('script_colours.mjs'))return 'const {attachScriptColours}=globalThis.__h3DurationTest;';
     throw new Error('Unmocked host import '+line);
   });
   source='const {setTimeout,clearTimeout,setInterval,clearInterval}=globalThis.__h3DurationTest;\n'+source;
   const {momentStrip}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
   const {node,source:video}=graphWith();let refreshes=0;node.__ausbossCard={refresh(){refreshes++;}};
   const panel=momentStrip(node), [ruler,track,note]=panel.element.children;
   const values={seconds:12,script:'She walks.',video_job:'copy its moves'};
   panel.sync(values);assert.equal(timers.length,1);timers.shift()();await Promise.resolve();
   assert.equal(requests[0].seconds,12);
   panel.sync({...values,video_job:'swap the person'});
   assert.equal(ruler.children.length,0);assert.equal(track.textContent,'Length comes from the clip');
   assert.doesNotMatch(panel.element.textContent,/12|one take/);assert.equal(timers.length,0);
   pending.shift()({ok:true,json:async()=>({seconds:12,moments:[{start:0,end:12,text:'She walks',line:0}]})});
   await new Promise(resolve=>setImmediate(resolve));
   assert.equal(track.textContent,'Length comes from the clip');assert.ok(refreshes>0);
   video.mode=4;intervals[0]();assert.equal(timers.length,1);
   timers.shift()();await Promise.resolve();assert.equal(requests.at(-1).seconds,12);
   assert.equal(requests.at(-1).video,'');
   pending.shift()({ok:true,json:async()=>({seconds:12,moments:[{start:0,end:12,text:'She walks',line:0}]})});
   await new Promise(resolve=>setImmediate(resolve));
   assert.match(note.textContent,/12 s/);assert.ok(ruler.children.length>0);
 } finally {globalThis.document=realDocument;delete globalThis.__h3DurationTest;}
});

// Exercise the actual numeric-row builder with scrub/DOM boundaries stubbed;
// this catches a read-only display that overwrites the serialized widget.
test('Length row replaces the whole number+unit, preserves its value, and restores its control',()=>{
 const code=readFileSync(new URL('../js/shared/widget_card.mjs',import.meta.url),'utf8');
 const start=code.indexOf('const buildScrub = ')+ 'const buildScrub = '.length;
 const end=code.indexOf('\n  const buildSegment',start);
 const body=code.slice(start,end).trim().replace(/;$/,'');
 const {node,source}=graphWith();node.widgets=[{name:'seconds',value:12,options:{min:5,max:15}}];
 const scrub={root:{style:{}},set(value){this.shown=value;}};
 const makeElement=()=>({style:{},setAttribute(name,value){this[name]=value;}});
 const into={children:[],append(x){this.children.push(x);}};
 const builder=new Function('node','findWidget','isFloatWidget','scrubSteps','makeScrubInput','UNIT_SLOT_WIDTH','el','setWidget', 'return '+body)(
   node,()=>node.widgets[0],()=>false,()=>({step:1,decimals:0}),()=>scrub,24,makeElement,()=>{throw Error('read-only display wrote widget');}
 );
 const row={title:'Length',readOnlyText:(n,v)=>clipSetsDuration(n,v)?'From the clip':'',readOnlyTitle:'From incoming clip',suffix:'s'};
 const sync=builder('seconds',row,into);
 const values={seconds:12,video_job:'swap the person'};
 sync(values);assert.equal(scrub.root.style.display,'none');assert.equal(into.children[1].textContent,'From the clip');
 assert.equal(into.children[1].role,'status');assert.equal(node.widgets[0].value,12);
 for(const mode of [2,4]){source.mode=mode;sync(values);assert.equal(scrub.root.style.display,'');assert.equal(into.children[1].style.display,'none');assert.equal(scrub.shown,12);}
 source.mode=0;sync({...values,video_job:'keep going'});assert.equal(scrub.root.style.display,'');
 assert.equal(node.widgets[0].value,12);assert.equal(node.inputs[0].link,8);
});

test('H3 makes 5 + 17n frames, rounding a clip down (Python video_frames)', async () => {
  const { h3VideoFrames, clipLengthWords } = await import('../js/shared/h3_duration.mjs');
  assert.equal(h3VideoFrames(48), 39);
  assert.equal(h3VideoFrames(39), 39);
  assert.equal(h3VideoFrames(56), 56);
  assert.equal(h3VideoFrames(10), 22);
  assert.equal(h3VideoFrames(1000), 360 - ((360 - 5) % 17));
  const words = clipLengthWords({ frames: 48, startSeconds: 1, endSeconds: 3, roomFrames: 74 });
  assert.equal(words.title, "H3 makes 39 of the clip's 48 frames · 1.63 s");
  assert.match(words.note, /Stops at 2\.63 s.*1\.63 s or 2\.33 s/);
  assert.equal(clipLengthWords({ frames: 39, startSeconds: 0, endSeconds: 1.625 }).warn, false);
  assert.equal(clipLengthWords(null), null);
});
