import { expect, it } from 'vitest';
import { balanceStudentNodeMove, studentMapBoundaries, studentMapPositions, REGION_CAPTION } from './studentMapLayout.js';
import { PROJECT_LIMITS } from './domain.js';

const geometryFor=nodes=>new Map(nodes.map(n=>[n.id,{cardWidth:160,cardHeight:48}]));
const at=(nodes,positions)=>nodes.map(n=>({...n,...positions.get(n.id)}));
const bounds=n=>({left:n.x-80,right:n.x+80,top:n.y-24,bottom:n.y+24});
const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
function expectClear(nodes,geometry) {
  for(let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++) expect(intersects(bounds(nodes[i]),bounds(nodes[j]))).toBe(false);
  const regions=studentMapBoundaries(nodes,geometry);
  for(const node of nodes.filter(n=>n.scale!=='micro')) {
    const inner=regions[node.scale==='exosphere'?'micro':'exosphere'];
    if(!inner) continue;
    const b=bounds(node),dx=Math.max(b.left-inner.cx,inner.cx-b.right,0),dy=Math.max(b.top-inner.cy,inner.cy-b.bottom,0);
    expect((dx/inner.rx)**2+(dy/inner.ry)**2).toBeGreaterThanOrEqual(1);
    expect(intersects(b,{left:inner.cx-REGION_CAPTION.width/2,right:inner.cx+REGION_CAPTION.width/2,
      top:inner.top+REGION_CAPTION.offsetY-REGION_CAPTION.height/2,bottom:inner.top+REGION_CAPTION.offsetY+REGION_CAPTION.height/2})).toBe(false);
  }
  for(const n of nodes) for(const value of [n.x,n.y]) {
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(PROJECT_LIMITS.coordinateMin);
    expect(value).toBeLessThanOrEqual(PROJECT_LIMITS.coordinateMax);
  }
}
function nestedFixture() {
  const nodes=[['a','micro',600,500],['b','micro',800,500],['c','micro',1000,500],['d','micro',800,600],
    ['office','exosphere',800,900],['funding','macrosphere',800,1030]].map(([id,scale,x,y])=>({id,label:id,scale,x,y}));
  const geometry=geometryFor(nodes);
  return {nodes:at(nodes,studentMapPositions(nodes,[],geometry,{manualNodeIds:nodes.map(n=>n.id),readingAspect:1.8,aspectRatio:1.8})),geometry};
}

it('honors the drop location and lets a nearby card make room without moving distant cards',()=>{
  const nodes=[{id:'a',scale:'micro',x:300,y:300},{id:'b',scale:'micro',x:500,y:300},{id:'far',scale:'micro',x:900,y:700}];
  const before=structuredClone(nodes),geometry=geometryFor(nodes);
  const positions=balanceStudentNodeMove(nodes[0],{x:350,y:300},nodes,geometry);
  expect(positions.get('a')).toEqual({x:350,y:300});
  expect(positions.get('b').x).toBeCloseTo(522.01,3);
  expect(positions.get('a').y).toBe(300);expect(positions.get('b').y).toBe(300);
  expect(positions.get('far')).toEqual({x:900,y:700});
  expectClear(at(nodes,positions),geometry);
  expect(nodes).toEqual(before);
  expect(balanceStudentNodeMove(nodes[0],{x:350,y:300},[...nodes].reverse(),geometry)).toEqual(positions);
  const final=at(nodes,positions);
  expect(balanceStudentNodeMove(final[0],positions.get('a'),final,geometry)).toEqual(positions);
});

it('keeps a clear move exact and allows exact overlap when auto-fit is disabled',()=>{
  const {nodes,geometry}=nestedFixture(),moving=nodes[0];
  const requested={x:moving.x-32,y:moving.y};
  const positions=balanceStudentNodeMove(moving,requested,nodes,geometry);
  expect(positions.get(moving.id)).toEqual(requested);
  for(const n of nodes.slice(1))expect(positions.get(n.id)).toEqual({x:n.x,y:n.y});
  const free=balanceStudentNodeMove(moving,{x:nodes[1].x,y:nodes[1].y},nodes,geometry,{autoFit:false});
  expect(free.get(moving.id)).toEqual({x:nodes[1].x,y:nodes[1].y});
  for(const n of nodes.slice(1))expect(free.get(n.id)).toEqual({x:n.x,y:n.y});
});

it('lets Micro expand and adjusts newly covered Exo and Macro cards instead of refusing the move',()=>{
  const {nodes,geometry}=nestedFixture(),moving=nodes.find(n=>n.id==='d'),office=nodes.find(n=>n.id==='office');
  const requested={x:office.x,y:office.y};
  const before=structuredClone(nodes),regionsBefore=studentMapBoundaries(nodes,geometry);
  const positions=balanceStudentNodeMove(moving,requested,nodes,geometry),after=at(nodes,positions);
  expect(positions.get(moving.id)).toEqual(requested);
  expect(positions.get('office')).not.toEqual({x:office.x,y:office.y});
  const funding=nodes.find(n=>n.id==='funding');
  expect(positions.get('funding')).not.toEqual({x:funding.x,y:funding.y});
  for(const n of nodes.filter(n=>['a','b','c'].includes(n.id)))expect(positions.get(n.id)).toEqual({x:n.x,y:n.y});
  const regions=studentMapBoundaries(after,geometry);
  expect(regions.micro.rx*regions.micro.ry).toBeGreaterThan(regionsBefore.micro.rx*regionsBefore.micro.ry);
  expectClear(after,geometry);expect(nodes).toEqual(before);
  expect(balanceStudentNodeMove(after.find(n=>n.id===moving.id),requested,after,geometry)).toEqual(positions);
});

it('propagates small spacing corrections through a local chain without moving a distant card',()=>{
  const nodes=Array.from({length:8},(_,i)=>({id:`card-${i}`,scale:'micro',x:300+i*172,y:300}));
  nodes.push({id:'far',scale:'micro',x:300,y:1000});
  const geometry=geometryFor(nodes),positions=balanceStudentNodeMove(nodes[0],{x:330,y:300},nodes,geometry);
  expect(positions.get(nodes[0].id)).toEqual({x:330,y:300});
  expect(positions.get('card-1').x).toBeGreaterThan(472);
  expect(positions.get('far')).toEqual({x:300,y:1000});
  expectClear(at(nodes,positions),geometry);
});

it.each(['exosphere','macrosphere'])('keeps an inward %s move at its own side of the preceding level',scale=>{
  const {nodes,geometry}=nestedFixture(),moving=nodes.find(n=>n.scale===scale);
  const region=studentMapBoundaries(nodes,geometry)[scale==='exosphere'?'micro':'exosphere'];
  const positions=balanceStudentNodeMove(moving,{x:region.cx,y:region.cy},nodes,geometry);
  expect(positions.get(moving.id).y).toBeGreaterThan(region.cy);
  expectClear(at(nodes,positions),geometry);
});

it('uses the remaining room at a coordinate limit without saving an overlapping or invalid neighbour',()=>{
  const limit=PROJECT_LIMITS.coordinateMax;
  const nodes=[{id:'a',scale:'micro',x:limit-200,y:300},{id:'b',scale:'micro',x:limit,y:300}];
  const geometry=geometryFor(nodes),positions=balanceStudentNodeMove(nodes[0],{x:limit-150,y:300},nodes,geometry);
  expectClear(at(nodes,positions),geometry);
  expect(positions.get('b').x).toBe(limit);
});

it('does not move an already-clear outer card when Micro moves away from it',()=>{
  const nodes=[{id:'a',scale:'micro',x:300,y:300},{id:'office',scale:'exosphere',x:513,y:300}];
  const geometry=geometryFor(nodes),positions=balanceStudentNodeMove(nodes[0],{x:299,y:300},nodes,geometry);
  expect(positions.get('a')).toEqual({x:299,y:300});
  expect(positions.get('office')).toEqual({x:513,y:300});
});

it('leaves unrelated imported card and level overlaps untouched',()=>{
  const nodes=[{id:'a',scale:'micro',x:300,y:300},{id:'b',scale:'micro',x:800,y:600},
    {id:'c',scale:'micro',x:805,y:605},{id:'office',scale:'exosphere',x:500,y:450}];
  const geometry=geometryFor(nodes),positions=balanceStudentNodeMove(nodes[0],{x:290,y:300},nodes,geometry);
  expect(positions.get('a')).toEqual({x:290,y:300});
  for(const n of nodes.slice(1))expect(positions.get(n.id)).toEqual({x:n.x,y:n.y});
});
