import { expect, it } from 'vitest';
import { mapNodeGeometry } from './App.jsx';
import { studentMapPositions, studentMapBoundaries, attachedConnectionLayout, relationshipAttachment } from './studentMapLayout.js';

const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
const area=(p,g)=>({left:p.x-g.cardWidth/2,right:p.x+g.cardWidth/2,top:p.y-g.cardHeight/2,bottom:p.y+g.cardHeight/2});
it.each([false,true])('separates crowded retained cards without changing the saved graph (phone=%s)',phone=>{
  const nodes=Array.from({length:13},(_,i)=>({id:`local-${i}`,scale:'micro',label:i%3?'Community support setting':'Residents and their neighborhood support staff',x:120+i%4*200,y:60+Math.floor(i/4)*75}));
  nodes.push(...Array.from({length:3},(_,i)=>({id:`policy-${i}`,scale:'exosphere',label:`District resource policy ${i+1}`,x:1600+i*300,y:400})));
  const before=structuredClone(nodes),geometry=new Map(nodes.map(n=>[n.id,mapNodeGeometry(n.label,phone)]));
  const positions=studentMapPositions(nodes,[],geometry,{manualNodeIds:nodes.filter(n=>n.scale==='micro').map(n=>n.id),phone});
  const boxes=nodes.map(n=>area(positions.get(n.id),geometry.get(n.id)));
  expect(boxes.some((b,i)=>boxes.slice(i+1).some(other=>intersects(b,other)))).toBe(false);
  const regions=studentMapBoundaries(nodes.map(n=>({...n,...positions.get(n.id)})),geometry);
  expect(regions.micro.rx*regions.micro.ry/(regions.exosphere.rx*regions.exosphere.ry)).toBeGreaterThan(phone ? .55 : .60);
  for(const node of nodes){const r=node.scale==='micro'?regions.micro:regions.exosphere,b=area(positions.get(node.id),geometry.get(node.id));for(const [x,y]of [[b.left,b.top],[b.right,b.top],[b.left,b.bottom],[b.right,b.bottom]])expect(((x-r.cx)/r.rx)**2+((y-r.cy)/r.ry)**2).toBeLessThanOrEqual(1);}
  expect(nodes).toEqual(before);
});
it('uses compact cards for short names and enough room for long names',()=>{
  const short=mapNodeGeometry('Parents'),long=mapNodeGeometry('Public high school students in their local school district');
  expect(short.cardWidth).toBeLessThan(130);expect(short.cardHeight).toBeLessThan(50);
  expect(long.cardHeight).toBeGreaterThan(short.cardHeight);expect(long.cardWidth).toBeLessThanOrEqual(224);
});
it('preserves deliberate placement at the same aspect and adapts a narrower canvas without rewriting it',()=>{
  const nodes=Array.from({length:12},(_,i)=>({id:`node-${i}`,label:'Local setting',scale:'micro',x:i*40,y:i*10}));
  const geometry=new Map(nodes.map(n=>[n.id,mapNodeGeometry(n.label)]));
  const wide=studentMapPositions(nodes,[],geometry,{aspectRatio:1.8});
  const saved=nodes.map(n=>({...n,...wide.get(n.id)}));
  saved[0].x-=40;
  const before=structuredClone(saved),layout={manualNodeIds:saved.map(n=>n.id),readingAspect:1.8};
  const restored=studentMapPositions(saved,[],geometry,{...layout,aspectRatio:1.8});
  for(const node of saved)expect(restored.get(node.id)).toEqual({x:node.x,y:node.y});
  const narrow=studentMapPositions(saved,[],geometry,{...layout,aspectRatio:.6});
  expect(new Set([...narrow.values()].map(p=>p.y)).size).toBeGreaterThan(new Set([...wide.values()].map(p=>p.y)).size);
  const boxes=saved.map(n=>area(narrow.get(n.id),geometry.get(n.id)));
  expect(boxes.some((b,i)=>boxes.slice(i+1).some(other=>intersects(b,other)))).toBe(false);
  expect(saved).toEqual(before);
  expect(studentMapPositions(saved,[],geometry,{...layout,aspectRatio:1.8})).toEqual(restored);
});
it('keeps wording on its routed connection and reserves earlier labels',()=>{
  const nodes=[{id:'a'},{id:'b'},{id:'obstacle'}],positions=new Map([['a',{x:0,y:0}],['b',{x:700,y:0}],['obstacle',{x:350,y:0}]]);
  const geometry=new Map(nodes.map(n=>[n.id,{cardWidth:160,cardHeight:60}])),edge={id:'ab',source:'a',target:'b'};
  const reserved={left:230,right:470,top:-125,bottom:-65};
  const result=attachedConnectionLayout([edge],nodes,positions,geometry,new Map([['ab',{width:200,height:32}]]),[reserved]);
  const anchor=result.anchors.get('ab'),points=result.paths.get('ab').points;
  expect(points.slice(1).some((b,i)=>{const a=points[i];return Math.abs(Math.hypot(anchor.x-a.x,anchor.y-a.y)+Math.hypot(b.x-anchor.x,b.y-anchor.y)-Math.hypot(b.x-a.x,b.y-a.y))<.01;})).toBe(true);
  expect(result.leaders.size).toBe(0);expect(intersects(result.bounds.get('ab'),reserved)).toBe(false);
  const join=relationshipAttachment(result,'ab');expect(join).toBeTruthy();expect(join).not.toEqual(anchor);
});

it('keeps connected local pairs nearby without moving saved manual placements',()=>{
  const nodes=Array.from({length:12},(_,i)=>({id:`n${i}`,label:'Local participant',scale:'micro',x:i*160,y:200}));
  const geometry=new Map(nodes.map(n=>[n.id,{cardWidth:140,cardHeight:50}]));
  const edges=Array.from({length:6},(_,i)=>({id:`e${i}`,source:`n${i}`,target:`n${11-i}`}));
  const positions=studentMapPositions(nodes,edges,geometry,{aspectRatio:1.8});
  for(const e of edges){const a=positions.get(e.source),b=positions.get(e.target);expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeLessThan(240);}
  const saved=nodes.map(n=>({...n,...positions.get(n.id)}));
  saved[0].x+=30;saved[0].y-=30;
  const preserved=studentMapPositions(saved,edges,geometry,{manualNodeIds:saved.map(n=>n.id),readingAspect:1.8,aspectRatio:1.8});
  expect(preserved.get(saved[0].id)).toEqual({x:saved[0].x,y:saved[0].y});
});
