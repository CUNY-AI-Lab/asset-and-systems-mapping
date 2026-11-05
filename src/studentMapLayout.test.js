import { expect, it } from 'vitest';
import { mapNodeGeometry } from './App.jsx';
import { studentMapPositions, studentMapBoundaries, attachedConnectionLayout, relationshipAttachment, contentEllipse, REGION_CAPTION } from './studentMapLayout.js';

const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
const area=(p,g)=>({left:p.x-g.cardWidth/2,right:p.x+g.cardWidth/2,top:p.y-g.cardHeight/2,bottom:p.y+g.cardHeight/2});
it.each([false,true])('separates crowded retained cards without changing the saved graph (phone=%s)',phone=>{
  const nodes=Array.from({length:13},(_,i)=>({id:`local-${i}`,scale:'micro',label:i%3?'Community support setting':'Residents and their neighborhood support staff',x:120+i%4*200,y:60+Math.floor(i/4)*75}));
  nodes.push(...Array.from({length:3},(_,i)=>({id:`policy-${i}`,scale:'exosphere',label:`District resource policy ${i+1}`,x:1600+i*300,y:400})));
  const before=structuredClone(nodes),geometry=new Map(nodes.map(n=>[n.id,mapNodeGeometry(n.label,phone)]));
  const positions=studentMapPositions(nodes,[],geometry,{phone});
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
it('preserves deliberate placement through sidebar resizing without rewriting it',()=>{
  const nodes=Array.from({length:12},(_,i)=>({id:`node-${i}`,label:'Local setting',scale:'micro',x:i*40,y:i*10}));
  const geometry=new Map(nodes.map(n=>[n.id,mapNodeGeometry(n.label)]));
  const wide=studentMapPositions(nodes,[],geometry,{aspectRatio:1.8});
  const saved=nodes.map(n=>({...n,...wide.get(n.id)}));
  saved[0].x-=40;
  const before=structuredClone(saved),layout={manualNodeIds:saved.map(n=>n.id),readingAspect:1.8};
  const restored=studentMapPositions(saved,[],geometry,{...layout,aspectRatio:1.8});
  for(const node of saved)expect(restored.get(node.id)).toEqual({x:node.x,y:node.y});
  const narrow=studentMapPositions(saved,[],geometry,{...layout,aspectRatio:.6});
  expect(narrow).toEqual(restored);
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

it('uses the width of desktop canvases when Exo and Macro are added',()=>{
  const nodes=Array.from({length:6},(_,i)=>({id:`m${i}`,label:'Local people and settings',scale:'micro',x:0,y:0}));
  for(const scale of ['exosphere','macrosphere'])for(let i=0;i<2;i++)nodes.push({id:`${scale}${i}`,label:'Broader setting or condition',scale,x:0,y:0});
  const geometry=new Map(nodes.map(n=>[n.id,{cardWidth:190,cardHeight:60}]));
  const positions=studentMapPositions(nodes,[],geometry,{aspectRatio:1.55});
  const regions=studentMapBoundaries(nodes.map(n=>({...n,...positions.get(n.id)})),geometry);
  expect(regions.macrosphere.rx/regions.macrosphere.ry).toBeGreaterThan(1.3);
  for(const n of nodes.filter(n=>n.scale!=='micro')){
    const p=positions.get(n.id),r=n.scale==='exosphere'?regions.micro:regions.exosphere;
    const b=area(p,geometry.get(n.id));
    const nearX=Math.max(b.left-r.cx,r.cx-b.right,0),nearY=Math.max(b.top-r.cy,r.cy-b.bottom,0);
    expect((nearX/r.rx)**2+(nearY/r.ry)**2).toBeGreaterThan(1);
  }
});

it('fits a lopsided arrangement in either horizontal direction without reserving empty rectangle corners',()=>{
  const bounds=[
    {left:0,right:180,top:0,bottom:50},
    {left:0,right:180,top:100,bottom:160},
    {left:600,right:740,top:80,bottom:110},
  ];
  const before=structuredClone(bounds),region=contentEllipse(bounds,20);
  const reflected=contentEllipse(bounds.map(b=>({...b,left:-b.right,right:-b.left})),20);
  expect(region.cx).toBeLessThan(320);
  expect(reflected.cx).toBeCloseTo(-region.cx,6);
  expect(reflected.rx).toBeCloseTo(region.rx,6);
  expect(reflected.ry).toBeCloseTo(region.ry,6);
  // The previous fixed-center fit took over 72,000 square-radius units.
  expect(region.rx*region.ry).toBeLessThan(61000);
  for(const b of bounds)for(const [x,y]of [[b.left,b.top],[b.right,b.top],[b.left,b.bottom],[b.right,b.bottom]]) {
    expect(((x-region.cx)/region.rx)**2+((y-region.cy)/region.ry)**2).toBeLessThan(1);
  }
  expect(bounds).toEqual(before);
});

it('encloses continuous inner contours and complete captions for uneven three-sphere maps',()=>{
  const nodes=[
    {id:'a',scale:'micro',x:250,y:210},
    {id:'b',scale:'micro',x:610,y:290},
    {id:'c',scale:'micro',x:420,y:470},
    {id:'office',scale:'exosphere',x:800,y:530},
    {id:'service',scale:'exosphere',x:170,y:600},
    {id:'policy',scale:'macrosphere',x:880,y:850},
  ];
  const geometry=new Map(nodes.map((node,index)=>[node.id,{cardWidth:index%2?190:120,cardHeight:index%3?56:82}]));
  const before=structuredClone(nodes),regions=studentMapBoundaries(nodes,geometry);
  for(const [innerScale,outerScale]of [['micro','exosphere'],['exosphere','macrosphere']]) {
    const inner=regions[innerScale],outer=regions[outerScale];
    for(let i=0;i<2048;i++) {
      const angle=2*Math.PI*i/2048,x=inner.cx+inner.rx*Math.cos(angle),y=inner.cy+inner.ry*Math.sin(angle);
      expect(((x-outer.cx)/outer.rx)**2+((y-outer.cy)/outer.ry)**2).toBeLessThan(1);
    }
    const caption={left:inner.cx-REGION_CAPTION.width/2,right:inner.cx+REGION_CAPTION.width/2,
      top:inner.top+REGION_CAPTION.offsetY-REGION_CAPTION.height/2,bottom:inner.top+REGION_CAPTION.offsetY+REGION_CAPTION.height/2};
    for(const [x,y]of [[caption.left,caption.top],[caption.right,caption.top],[caption.left,caption.bottom],[caption.right,caption.bottom]]) {
      expect(((x-outer.cx)/outer.rx)**2+((y-outer.cy)/outer.ry)**2).toBeLessThan(1);
    }
    expect(outer.top+REGION_CAPTION.offsetY+REGION_CAPTION.height/2).toBeLessThan(caption.top);
  }
  for(const node of nodes) {
    const region=regions[node.scale],b=area(node,geometry.get(node.id));
    for(const [x,y]of [[b.left,b.top],[b.right,b.top],[b.left,b.bottom],[b.right,b.bottom]]) {
      expect(((x-region.cx)/region.rx)**2+((y-region.cy)/region.ry)**2).toBeLessThan(1);
    }
  }
  expect(nodes).toEqual(before);
});
