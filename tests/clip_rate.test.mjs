import test from 'node:test';
import assert from 'node:assert/strict';
import { clipOutputRate, inputNumber, linkOrigin } from '../js/shared/clip_rate.mjs';
function linked(type='PrimitiveFloat', value=24) {
  const source={type,widgets:[{name:'value',value}]};
  return {inputs:[{name:'force_rate',link:1}],graph:{links:{1:{origin_id:2,origin_slot:0}},getNodeById:()=>source}};
}
test('distinguishes forced, unchanged and thinned rates',()=>{
  assert.equal(clipOutputRate(linked(),60),24);
  assert.equal(clipOutputRate(linked(),60,2),12);
  assert.equal(clipOutputRate(linked('PrimitiveInt',0),60),60);
  assert.equal(clipOutputRate({},60,2),30);
});
test('does not guess calculated or invalid rates',()=>{
  for(const n of [linked('MathExpression'),linked('PrimitiveFloat',NaN),linked('PrimitiveFloat',-1),linked('PrimitiveFloat',1001)]) assert.equal(clipOutputRate(n,60),null);
  assert.equal(clipOutputRate({},0),null);
});
test('handles reroutes, cycles, upstream changes and linked thinning',()=>{
  const node=linked(); const source=node.graph.getNodeById();
  source.widgets[0].value=30; assert.equal(clipOutputRate(node,60),30);
  const reroute={type:'Reroute',inputs:[{link:3}]};
  node.graph.links[3]={origin_id:4,origin_slot:0};
  node.graph.getNodeById=id=>id===2?reroute:source;
  assert.equal(clipOutputRate(node,60),30);
  reroute.inputs[0].link=1;assert.equal(clipOutputRate(node,60),null);
  node.inputs.push({name:'every_nth',link:3});
  source.widgets[0].value=2;reroute.inputs[0].link=3;
  assert.equal(clipOutputRate(node,60),1);
});

test('reads linked fixed frames from AusBoss numeric cards without evaluating calculations',()=>{
  const node=linked('AUSBOSS_NODES_Integer',120); node.inputs[0].name='fixed_frames';
  assert.equal(inputNumber(node,'fixed_frames',0),120);
  const source=node.graph.getNodeById(); source.widgets[0].value=97;
  assert.equal(inputNumber(node,'fixed_frames',0),97);
  source.inputs=[{name:'value',link:9}];
  assert.equal(inputNumber(node,'fixed_frames',0),null);
  node.inputs[0].link=null;
  assert.equal(inputNumber(node,'fixed_frames',0),0);
});

test('a rate typed inside a subgraph counts as typed (Person Swap: Pick the model files -> video fps 24)', () => {
  const literal = { id: 222, type: 'AUSBOSS_NODES_Integer', mode: 0, inputs: [{ name: 'value', link: null }], widgets: [{ name: 'value', value: 24 }] };
  const inner = { links: new Map([[391, { origin_id: 222, origin_slot: 0 }]]), outputs: [{}, {}, { linkIds: [391] }], getNodeById: (id) => (id === 222 ? literal : null) };
  const box = { id: 146, mode: 0, type: 'subgraph-id', subgraph: inner, isSubgraphNode: () => true };
  const clip = { inputs: [{ name: 'force_rate', link: 7 }], graph: { links: { 7: { origin_id: 146, origin_slot: 2 } }, getNodeById: (id) => (id === 146 ? box : null) } };
  assert.equal(inputNumber(clip, 'force_rate', 0), 24);
  assert.equal(clipOutputRate(clip, 60, 1), 24);
  // A calculation inside the subgraph stays unknown.
  literal.type = 'AUSBOSS_NODES_MathExpression';
  assert.equal(inputNumber(clip, 'force_rate', 0), null);
});

test('an older Primitive node and a Reroute both carry a typed number', () => {
  const primitive = { id: 5, type: 'PrimitiveNode', mode: 0, widgets: [{ name: 'max_seconds', value: 7.5 }] };
  const reroute = { id: 6, type: 'Reroute', mode: 0, inputs: [{ link: 2 }] };
  const graph = { links: { 1: { origin_id: 6, origin_slot: 0 }, 2: { origin_id: 5, origin_slot: 0 } }, getNodeById: (id) => ({ 5: primitive, 6: reroute })[id] ?? null };
  const audio = { inputs: [{ name: 'max_seconds', widget: { name: 'max_seconds' }, link: 1 }], graph };
  assert.equal(inputNumber(audio, 'max_seconds', 0), 7.5);
  assert.deepEqual(linkOrigin(audio, 'max_seconds'), { node: primitive, slot: 0 });
  // Not linked: the caller's own value. Bypassed: unknown.
  assert.equal(linkOrigin({ inputs: [{ name: 'max_seconds', link: null }] }, 'max_seconds'), undefined);
  primitive.mode = 4;
  assert.equal(inputNumber(audio, 'max_seconds', 0), null);
});

test('Layout Boxes reads a size from inside a subgraph', async () => {
  const { wiredNumber } = await import('../js/shared/layout_boxes.mjs');
  const latent = { id: 9, type: 'EmptyLatentImage', mode: 0, outputs: [{ name: 'LATENT' }], widgets: [{ name: 'width', value: 1024 }] };
  const sizes = { id: 8, type: 'AUSBOSS_NODES_Integer', mode: 0, outputs: [{ name: 'int' }], inputs: [{ name: 'value', link: null }], widgets: [{ name: 'value', value: 832 }] };
  const inner = { links: new Map([[50, { origin_id: 8, origin_slot: 0 }]]), outputs: [{ linkIds: [50] }], getNodeById: (id) => ({ 8: sizes, 9: latent })[id] ?? null };
  const box = { id: 3, mode: 0, type: 'subgraph-id', subgraph: inner, isSubgraphNode: () => true };
  const node = { inputs: [{ name: 'width', link: 4 }], graph: { links: { 4: { origin_id: 3, origin_slot: 0 } }, getNodeById: (id) => (id === 3 ? box : null) } };
  assert.equal(wiredNumber(node, 'width'), 832);
});
