import test from 'node:test';
import assert from 'node:assert/strict';
import { clipOutputRate, inputNumber } from '../js/shared/clip_rate.mjs';
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
