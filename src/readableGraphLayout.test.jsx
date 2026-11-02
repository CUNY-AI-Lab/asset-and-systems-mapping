import { expect, it } from 'vitest';
import { readableMapPositions, mapNodeGeometry } from './App.jsx';
import { layoutQuality, readableNodePositions, straightConnectionLayout } from './readableGraphLayout.js';
import { buildEastHarlemDisabilityProject } from '../tests/e2e/fixtures/east-harlem-disability-project.js';
import { denseCumulativeProject } from '../tests/e2e/fixtures/readable-cumulative-project.js';

function cumulative() {
  const project=buildEastHarlemDisabilityProject();
  const nodes=project.graph.nodes.filter(node=>node.scale!=='meso');
  const policy=nodes.find(node=>node.scale==='macrosphere');policy.scale='exosphere';
  const agency=nodes.find(node=>node.scale==='exosphere'&&node.id!==policy.id);
  const local=nodes.find(node=>node.scale==='micro');
  const edges=[...project.graph.edges,
    {id:'macro-agency-policy',source:agency.id,target:policy.id,verb:'administers',scale:'macrosphere'},
    {id:'macro-policy-local',source:policy.id,target:local.id,verb:'supports',scale:'macrosphere'},
  ];
  return {nodes,edges};
}
it.each([false,true])('arranges cumulative links without card intersections and repeats deterministically (phone=%s)', phone=>{
  const {nodes,edges}=cumulative();
  const geometry=new Map(nodes.map(node=>[node.id,mapNodeGeometry(node.label,phone)]));
  const positions=readableMapPositions(nodes,edges,phone);
  const quality=layoutQuality(nodes,edges,positions,geometry);
  expect(quality.nodeOverlaps).toBe(0);expect(quality.throughNodes).toBe(0);
  expect([...readableMapPositions([...nodes].reverse(),[...edges].reverse(),phone)].sort()).toEqual([...positions].sort());
  expect([...readableMapPositions(nodes.map(node=>({...node,...positions.get(node.id)})),edges,phone)].sort()).toEqual([...positions].sort());
});
it('preserves deliberately moved nodes and the graph records',()=>{
  const {nodes,edges}=cumulative(),before=structuredClone({nodes,edges});
  const positions=readableMapPositions(nodes,edges,true,undefined,{manualNodeIds:nodes.map(node=>node.id)});
  for(const node of nodes) expect(positions.get(node.id)).toEqual({x:node.x,y:node.y});
  expect({nodes,edges}).toEqual(before);
});
it('keeps reciprocal connectors straight and separate, with labels clear of cards',()=>{
  const nodes=[{id:'a',scale:'micro'},{id:'b',scale:'micro'}];
  const positions=new Map([['a',{x:0,y:0}],['b',{x:500,y:0}]]);
  const geometry=new Map(nodes.map(node=>[node.id,{cardWidth:180,cardHeight:80}]));
  const edges=[{id:'ab',source:'a',target:'b',verb:'supports',scale:'meso'},{id:'ba',source:'b',target:'a',verb:'informs',scale:'meso'}];
  const labels=new Map(edges.map(edge=>[edge.id,{width:100,height:30}]));
  const result=straightConnectionLayout(edges,nodes,positions,geometry,labels);
  expect(result.unplaced.size).toBe(0);
  expect(result.paths.get('ab').points).toHaveLength(2);expect(result.paths.get('ba').points).toHaveLength(2);
  expect(result.paths.get('ab').source.y).not.toBe(result.paths.get('ba').target.y);
});
it('reduces crossings by ordering measured slots without changing scale membership',()=>{
  const nodes=['a','b','c','d'].map(id=>({id,scale:'micro'}));
  const initial=new Map([['a',{x:0,y:0}],['b',{x:400,y:0}],['c',{x:0,y:300}],['d',{x:400,y:300}]]);
  const geometry=new Map(nodes.map(node=>[node.id,{cardWidth:150,cardHeight:80}]));
  const edges=[{id:'ad',source:'a',target:'d',scale:'meso'},{id:'bc',source:'b',target:'c',scale:'meso'}];
  const result=readableNodePositions(nodes,edges,initial,geometry);
  expect(layoutQuality(nodes,edges,result,geometry).crossings).toBeLessThan(layoutQuality(nodes,edges,initial,geometry).crossings);
  expect(nodes.every(node=>node.scale==='micro')).toBe(true);
});

it.each([false,true])('improves a dense cumulative map without changing records (phone=%s)', phone=>{
  const {graph}=denseCumulativeProject(),before=structuredClone(graph);
  const geometry=new Map(graph.nodes.map(node=>[node.id,mapNodeGeometry(node.label,phone)]));
  const initial=new Map(graph.nodes.map(node=>[node.id,{x:node.x,y:node.y}]));
  const positions=readableMapPositions(graph.nodes,graph.edges,phone);
  const quality=layoutQuality(graph.nodes,graph.edges,positions,geometry);
  const original=layoutQuality(graph.nodes,graph.edges,initial,geometry);
  expect(quality.nodeOverlaps).toBe(0);
  expect(quality.throughNodes).toBeLessThan(original.throughNodes);
  expect(quality.crossings).toBeLessThanOrEqual(original.crossings);
  expect([...readableMapPositions(graph.nodes,graph.edges,phone)]).toEqual([...positions]);
  expect(graph).toEqual(before);
});
