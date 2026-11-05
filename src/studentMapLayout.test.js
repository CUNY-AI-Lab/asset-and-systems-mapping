import { expect, it } from 'vitest';
import { mapNodeGeometry } from './App.jsx';
import { studentMapPositions, studentMapBoundaries, constrainStudentNodeMove, attachedConnectionLayout, relationshipAttachment, contentEllipse, REGION_CAPTION } from './studentMapLayout.js';

const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
const area=(p,g)=>({left:p.x-g.cardWidth/2,right:p.x+g.cardWidth/2,top:p.y-g.cardHeight/2,bottom:p.y+g.cardHeight/2});

it('reserves measured verb width so a simple hub does not need sweeping detours',()=>{
  const nodes=['Nia','Workshop','Sandbox','Peer circle'].map((label,i)=>({id:`lab-${i}`,label,scale:'micro',x:0,y:0}));
  const edges=nodes.slice(1).map((node,i)=>({id:`link-${i}`,source:nodes[0].id,target:node.id,verb:'participates in'}));
  const geometry=new Map(nodes.map(n=>[n.id,{cardWidth:180,cardHeight:48}]));
  const labels=new Map(edges.map(e=>[e.id,{width:180,height:32}]));
  const positions=studentMapPositions(nodes,edges,geometry,{labelGeometries:labels});
  const routes=attachedConnectionLayout(edges,nodes,positions,geometry,labels);
  for(const edge of edges) {
    const points=routes.paths.get(edge.id).points;
    const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
    const length=points.slice(1).reduce((sum,p,i)=>sum+distance(points[i],p),0);
    expect(length/distance(points[0],points.at(-1))).toBeLessThan(1.2);
  }
  for(const label of routes.bounds.values())for(const node of nodes)expect(intersects(label,area(positions.get(node.id),geometry.get(node.id)))).toBe(false);
});

function hubFixture() {
  const labels=['Maya','Coordinator Lee','Librarian Jo','Neighborhood library','Community garden','Library workshop','Shared calendar','Gardening books','Tools','Seeds','Storage room','Volunteer handbook'];
  const types=['person','person','person','setting','setting','activity','object','object','object','object','setting','object'];
  const nodes=labels.map((label,i)=>({id:`n${i}`,label,type:types[i],scale:'micro',x:300+i*50,y:400}));
  const pairs=[[1,0],[1,6],[2,0],[2,7],[0,3],[0,4],[0,5]];
  const edges=pairs.map(([source,target],i)=>({id:`e${i}`,source:`n${source}`,target:`n${target}`}));
  return {nodes,edges,geometry:new Map(nodes.map(n=>[n.id,mapNodeGeometry(n.label)]))};
}

it.each([1.8,.7])('centers a busy participant and groups isolated cards outside its routes at aspect %s',aspectRatio=>{
  const {nodes,edges,geometry}=hubFixture(),before=structuredClone(nodes);
  const positions=studentMapPositions(nodes,edges,geometry,{aspectRatio,phone:aspectRatio<1});
  const core=nodes.slice(0,8).map(n=>area(positions.get(n.id),geometry.get(n.id)));
  const b={left:Math.min(...core.map(b=>b.left)),right:Math.max(...core.map(b=>b.right)),top:Math.min(...core.map(b=>b.top)),bottom:Math.max(...core.map(b=>b.bottom))};
  const hub=positions.get('n0');
  expect(Math.abs(hub.x-(b.left+b.right)/2)).toBeLessThan((b.right-b.left)*.2);
  expect(Math.abs(hub.y-(b.top+b.bottom)/2)).toBeLessThan((b.bottom-b.top)*.2);
  const isolated=nodes.slice(8).map(n=>area(positions.get(n.id),geometry.get(n.id)));
  expect(isolated.every(r=>r.left>b.right+40)||isolated.every(r=>r.top>b.bottom+40)).toBe(true);
  const boxes=nodes.map(n=>area(positions.get(n.id),geometry.get(n.id)));
  expect(boxes.some((b,i)=>boxes.slice(i+1).some(other=>intersects(b,other)))).toBe(false);
  const routes=attachedConnectionLayout(edges,nodes,positions,geometry,new Map(edges.map(e=>[e.id,{width:105,height:28}])));
  for(const route of routes.paths.values())for(let i=1;i<route.points.length;i++) {
    const a=route.points[i-1],b=route.points[i];
    for(let t=0;t<=100;t++) {
      const p={x:a.x+(b.x-a.x)*t/100,y:a.y+(b.y-a.y)*t/100};
      expect(isolated.some(r=>p.x>r.left&&p.x<r.right&&p.y>r.top&&p.y<r.bottom)).toBe(false);
    }
  }
  expect(nodes).toEqual(before);
  expect(studentMapPositions(nodes,edges,geometry,{aspectRatio,phone:aspectRatio<1})).toEqual(positions);
});

it('expands routing room for a denser connected microsystem without changing card sizes',()=>{
  const {nodes:all,geometry}=hubFixture(),nodes=all.slice(0,6);
  const chain=nodes.slice(1).map((n,i)=>({id:`e${i}`,source:nodes[i].id,target:n.id}));
  const dense=[...chain,...nodes.slice(2).map((n,i)=>({id:`h${i}`,source:'n0',target:n.id}))];
  const region=edges=>{const p=studentMapPositions(nodes,edges,geometry,{aspectRatio:1.8});return studentMapBoundaries(nodes.map(n=>({...n,...p.get(n.id)})),geometry).micro;};
  const sparse=region(chain),busy=region(dense);
  expect(busy.rx*busy.ry).toBeGreaterThan(sparse.rx*sparse.ry*1.2);
});

it('keeps explicit placement and auto-fit-off positions when connections change',()=>{
  const {nodes,edges,geometry}=hubFixture();
  const manualNodeIds=nodes.map(n=>n.id),readingAspect=1.8;
  for(const options of [{manualNodeIds,readingAspect},{autoFit:false}]) {
    const positions=studentMapPositions(nodes,edges,geometry,options);
    for(const n of nodes)expect(positions.get(n.id)).toEqual({x:n.x,y:n.y});
  }
});
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

// Synthetic card sizes and coordinate proportions from the retained-layout
// failure. No memo text, names or source evidence are included in this fixture.
function retainedReadingFixture(tall=false) {
  const coordinates=[[544,656],[571,544],[1052,544],[840,656],[783,544]];
  const nodes=coordinates.map(([x,y],i)=>({id:`local-${i}`,label:`Local item ${i+1}`,scale:'micro',
    x:tall?800+y-600:x,y:tall?600+x-800:y}));
  nodes.push({id:'office',label:'Outside resource office',scale:'exosphere',x:238,y:335},
    {id:'policy-a',label:'Resource distribution rule',scale:'macrosphere',x:420,y:140},
    {id:'policy-b',label:'Coordination requirement',scale:'macrosphere',x:602,y:335});
  const geometry=new Map(nodes.map(n=>[n.id,{cardWidth:n.id==='local-1'?104:224,
    cardHeight:['local-1','local-2'].includes(n.id)?42:64}]));
  const layout={aspectRatio:1.5288461538461537,readingAspect:1.5288461538461537,
    manualNodeIds:[...coordinates.map((_,i)=>`local-${i}`),'removed-local']};
  return {nodes,geometry,layout};
}

it('keeps a retained shallow Micro map readable when outer levels are added beside the notebook',()=>{
  const {nodes,geometry,layout}=retainedReadingFixture(),before=structuredClone(nodes);
  const positions=studentMapPositions(nodes,[],geometry,layout);
  const displayed=nodes.map(n=>({...n,...positions.get(n.id)}));
  const regions=studentMapBoundaries(displayed,geometry),outer=regions.macrosphere;
  // 1280×720 workspace, 304px notebook, 955×625 measured canvas. Match the
  // map's existing fit padding and SVG scale, rather than asserting a side.
  const canvasWidth=955,canvasHeight=625,viewWidth=800;
  const zoom=Math.min(760/(outer.rx*2+40),(viewWidth/canvasWidth*canvasHeight-96)/(outer.ry*2+40));
  expect(22*zoom*canvasWidth/viewWidth).toBeGreaterThanOrEqual(12);
  expect(outer.rx/outer.ry).toBeLessThan(2.3);
  for(const node of nodes.filter(n=>n.scale==='micro'))expect(positions.get(node.id)).toEqual({x:node.x,y:node.y});
  const cards=displayed.map(n=>area(n,geometry.get(n.id)));
  expect(cards.some((card,i)=>cards.slice(i+1).some(other=>intersects(card,other)))).toBe(false);
  for(const node of displayed.filter(n=>n.scale!=='micro')) {
    const inner=regions[node.scale==='exosphere'?'micro':'exosphere'],card=area(node,geometry.get(node.id));
    const dx=Math.max(card.left-inner.cx,inner.cx-card.right,0),dy=Math.max(card.top-inner.cy,inner.cy-card.bottom,0);
    expect((dx/inner.rx)**2+(dy/inner.ry)**2).toBeGreaterThan(1);
  }
  for(const [innerKey,outerKey]of [['micro','exosphere'],['exosphere','macrosphere']]) {
    const inner=regions[innerKey],boundary=regions[outerKey];
    for(let i=0;i<256;i++) {
      const angle=2*Math.PI*i/256,x=inner.cx+inner.rx*Math.cos(angle),y=inner.cy+inner.ry*Math.sin(angle);
      expect(((x-boundary.cx)/boundary.rx)**2+((y-boundary.cy)/boundary.ry)**2).toBeLessThan(1);
    }
  }
  for(const boundary of Object.values(regions)) {
    const caption={left:boundary.cx-REGION_CAPTION.width/2,right:boundary.cx+REGION_CAPTION.width/2,
      top:boundary.top+REGION_CAPTION.offsetY-REGION_CAPTION.height/2,bottom:boundary.top+REGION_CAPTION.offsetY+REGION_CAPTION.height/2};
    expect(cards.some(card=>intersects(card,caption))).toBe(false);
  }
  expect(nodes).toEqual(before);
  expect(studentMapPositions(nodes,[],geometry,layout)).toEqual(positions);
});

it('uses available width for tall retained Micro content instead of always stacking outer levels',()=>{
  const {nodes,geometry,layout}=retainedReadingFixture(true);
  const positions=studentMapPositions(nodes,[],geometry,layout),regions=studentMapBoundaries(nodes.map(n=>({...n,...positions.get(n.id)})),geometry);
  expect(regions.macrosphere.rx/regions.macrosphere.ry).toBeGreaterThan(.95);
  expect(regions.macrosphere.ry/regions.micro.ry).toBeLessThan(1.45);
  for(const node of nodes.filter(n=>n.scale==='micro'))expect(positions.get(node.id)).toEqual({x:node.x,y:node.y});
});

it('never moves a pinned outer card and leaves the entire saved layout exact with auto-fit off',()=>{
  const {nodes,geometry,layout}=retainedReadingFixture();
  const office=nodes.find(n=>n.id==='office');Object.assign(office,{x:850,y:590});
  layout.manualNodeIds.push(office.id);
  const before=structuredClone(nodes),positions=studentMapPositions(nodes,[],geometry,layout);
  expect(positions.get(office.id)).toEqual({x:850,y:590});
  const fixed=studentMapPositions(nodes,[],geometry,{...layout,autoFit:false});
  for(const node of nodes)expect(fixed.get(node.id)).toEqual({x:node.x,y:node.y});
  expect(nodes).toEqual(before);
});

it.each(['exosphere','macrosphere'])('keeps legal %s moves exact and stops an inward move at the preceding sphere',scale=>{
  const {nodes,geometry,layout}=retainedReadingFixture();
  const positions=studentMapPositions(nodes,[],geometry,layout);
  const displayed=nodes.map(n=>({...n,...positions.get(n.id)}));
  const moving=displayed.find(n=>n.scale===scale),before=structuredClone(displayed);
  const inner=studentMapBoundaries(displayed,geometry)[scale==='exosphere'?'micro':'exosphere'];
  const legal={x:moving.x+8,y:moving.y+24};
  expect(constrainStudentNodeMove(moving,legal,displayed,geometry)).toEqual(legal);
  const inward={x:inner.cx,y:inner.cy};
  const stopped=constrainStudentNodeMove(moving,inward,displayed,geometry);
  expect(stopped).not.toEqual(inward);
  expect(Math.hypot(stopped.x-inward.x,stopped.y-inward.y)).toBeLessThan(Math.hypot(moving.x-inward.x,moving.y-inward.y));
  const bounds=area(stopped,geometry.get(moving.id));
  const dx=Math.max(bounds.left-inner.cx,inner.cx-bounds.right,0),dy=Math.max(bounds.top-inner.cy,inner.cy-bounds.bottom,0);
  expect((dx/inner.rx)**2+(dy/inner.ry)**2).toBeGreaterThanOrEqual(1);
  expect(constrainStudentNodeMove(moving,inward,displayed,geometry,{autoFit:false})).toEqual(inward);
  expect(displayed).toEqual(before);
});

it('adds an unpinned Exo card without enclosing retained Macro cards in the Exo sphere',()=>{
  // World card dimensions measured from the fictional ten-node Dev case.
  // The smaller bottom placement previously engulfed both pinned Macro cards.
  const measured=[
    ['micro',841,656,174.1529998779297,42],['micro',1075,544,224,64],
    ['micro',1087,656,174.89425659179688,42],['micro',617,656,224,64],
    ['micro',840,544,150.6991424560547,42],['micro',605,544,224,64],
    ['exosphere',840,804,224,64],['macrosphere',704,941,224,90],
    ['macrosphere',976,941,224,64],['exosphere',420,270,217.16812133789062,42],
  ];
  const nodes=measured.map(([scale,x,y],i)=>({id:`item-${i}`,label:`Item ${i}`,scale,x,y}));
  const geometry=new Map(measured.map(([,x,y,cardWidth,cardHeight],i)=>[`item-${i}`,{cardWidth,cardHeight}]));
  const before=structuredClone(nodes),layout={manualNodeIds:nodes.slice(0,9).map(n=>n.id),readingAspect:1.5288461538461537,aspectRatio:1.5288461538461537};
  const positions=studentMapPositions(nodes,[],geometry,layout),displayed=nodes.map(n=>({...n,...positions.get(n.id)}));
  const regions=studentMapBoundaries(displayed,geometry);
  for(const node of nodes.slice(0,9))expect(positions.get(node.id)).toEqual({x:node.x,y:node.y});
  for(const node of displayed.filter(n=>n.scale!=='micro')) {
    const inner=regions[node.scale==='exosphere'?'micro':'exosphere'],card=area(node,geometry.get(node.id));
    const dx=Math.max(card.left-inner.cx,inner.cx-card.right,0),dy=Math.max(card.top-inner.cy,inner.cy-card.bottom,0);
    expect((dx/inner.rx)**2+(dy/inner.ry)**2).toBeGreaterThanOrEqual(1);
  }
  const cards=displayed.map(n=>area(n,geometry.get(n.id)));
  expect(cards.some((card,i)=>cards.slice(i+1).some(other=>intersects(card,other)))).toBe(false);
  const outer=regions.macrosphere,zoom=Math.min(760/(outer.rx*2+40),(800/955*625-96)/(outer.ry*2+40));
  expect(22*zoom*955/800).toBeGreaterThanOrEqual(12);
  expect(nodes).toEqual(before);
  expect(studentMapPositions(nodes,[],geometry,layout)).toEqual(positions);
});

it('reveals cumulative spheres as their nodes arrive without an empty Macro ring',()=>{
  const micro={id:'local',label:'Learners',scale:'micro',x:300,y:300};
  const exo={id:'rule',label:'Referral consent protocol',scale:'exosphere',x:300,y:550};
  const macro={id:'norm',label:'Mental-health stigma',scale:'macrosphere',x:300,y:800};
  const geometry=new Map([micro,exo,macro].map(n=>[n.id,mapNodeGeometry(n.label)]));
  expect(Object.keys(studentMapBoundaries([micro],geometry))).toEqual(['micro']);
  expect(Object.keys(studentMapBoundaries([micro,exo],geometry))).toEqual(['micro','exosphere']);
  expect(Object.keys(studentMapBoundaries([micro,exo,macro],geometry))).toEqual(['micro','exosphere','macrosphere']);
  expect(Object.keys(studentMapBoundaries([micro,macro],geometry))).toEqual(['micro','exosphere','macrosphere']);
});
