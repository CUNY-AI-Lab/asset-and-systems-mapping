// A reading view of the saved map. These positions never mutate its records.
const box = (p, g, gap = 0) => ({ left:p.x-g.cardWidth/2-gap, right:p.x+g.cardWidth/2+gap, top:p.y-g.cardHeight/2-gap, bottom:p.y+g.cardHeight/2+gap });
const overlaps = (a,b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const corners = b => [[b.left,b.top],[b.right,b.top],[b.left,b.bottom],[b.right,b.bottom]];
export function contentEllipse(bounds, padding = 24, fitOuter = false) {
  if (!bounds.length) return null;
  const left=Math.min(...bounds.map(b=>b.left)), right=Math.max(...bounds.map(b=>b.right));
  const top=Math.min(...bounds.map(b=>b.top)), bottom=Math.max(...bounds.map(b=>b.bottom));
  const cx=(left+right)/2,cy=(top+bottom)/2;
  const a=Math.max(140,(right-left)/2+padding),b=Math.max(100,(bottom-top)/2+padding);
  const factor=Math.max(1,...bounds.flatMap(corners).map(([x,y])=>Math.hypot((x-cx)/a,(y-cy)/b)));
  const rx=a*factor+padding,ry=b*factor+padding;
  if(fitOuter) {
    // Move the outer center toward its headings instead of leaving an empty
    // band above the local map. Every sampled inner boundary and card corner
    // remains enclosed; choose the smallest of these candidate ellipses.
    const points=bounds.flatMap(corners);
    let best={cx,cy,rx,ry,area:rx*ry};
    for(let shift=-10;shift<=10;shift++)for(let step=0;step<=24;step++) {
      const nextCy=cy+shift*(bottom-top)/40;
      const nextRx=a+step*(right-left)/80;
      const nextRy=Math.max(100,...points.map(([x,y])=>Math.abs(y-nextCy)/Math.sqrt(1-((x-cx)/nextRx)**2)));
      const area=(nextRx+padding)*(nextRy+padding);
      if(area<best.area)best={cx,cy:nextCy,rx:nextRx+padding,ry:nextRy+padding,area};
    }
    return {...best,left:best.cx-best.rx,right:best.cx+best.rx,top:best.cy-best.ry,bottom:best.cy+best.ry};
  }
  return {cx,cy,rx,ry,left:cx-rx,right:cx+rx,top:cy-ry,bottom:cy+ry};
}
export function studentMapBoundaries(nodes, geometries) {
  const local=nodes.filter(n=>n.scale==='micro');
  const micro=contentEllipse(local.map(n=>box(n,geometries.get(n.id))),20);
  const outer=nodes.filter(n=>n.scale!=='micro');
  if (!outer.length) return {micro};
  // Enclose the actual inner ellipse, not its empty bounding-box corners.
  const bounds=outer.map(n=>box(n,geometries.get(n.id),12));
  if(micro) for(let i=0;i<64;i++) {
    const angle=i*Math.PI/32,x=micro.cx+micro.rx*Math.cos(angle),y=micro.cy+micro.ry*Math.sin(angle);
    bounds.push({left:x,right:x,top:y,bottom:y});
  }
  return {micro,exosphere:contentEllipse(bounds,24,true)};
}
export function studentMapPositions(nodes, edges, geometries, {manualNodeIds=[],phoneOverview,phone=false,aspectRatio=1.8,readingAspect}={}) {
  const positions=new Map(nodes.map(n=>[n.id,{x:n.x,y:n.y}]));
  const local=nodes.filter(n=>n.scale==='micro').sort((a,b)=>a.y-b.y||a.x-b.x||a.id.localeCompare(b.id));
  const compatibleView=readingAspect === undefined ? phoneOverview === 'preserve' : Math.abs(Math.log(aspectRatio/readingAspect))<.16;
  const manual=new Set(compatibleView ? manualNodeIds : []);
  const preserveLegacy=readingAspect === undefined && phoneOverview === 'preserve';
  if(local.length && !preserveLegacy && (!compatibleView || !local.every(n=>manual.has(n.id)))) {
    const columns=Math.min(phone?3:5,Math.max(2,Math.ceil(Math.sqrt(local.length*aspectRatio*.42))));
    const cx=840;
    const cy=600;
    const rows=Math.ceil(local.length/columns);
    const counts=Array(rows).fill(Math.floor(local.length/rows));
    const middleFirst=counts.map((_,i)=>i).sort((a,b)=>Math.abs(a-(rows-1)/2)-Math.abs(b-(rows-1)/2));
    for(let i=0;i<local.length%rows;i++)counts[middleFirst[i]]++;
    let offset=0;
    const slots=counts.flatMap((count,row)=>Array.from({length:count},(_,column)=>({row,column,count,index:offset++})));
    const rowHeights=counts.map((_,row)=>Math.max(...slots.filter(s=>s.row===row).map(s=>geometries.get(local[s.index].id).cardHeight)));
    const rowGap=phone?32:48;
    const totalHeight=rowHeights.reduce((sum,h)=>sum+h,0)+rowGap*(rows-1);
    const horizontalGap=phone?40:48;
    const rowWidths=counts.map((count,row)=>slots.filter(s=>s.row===row).reduce((sum,s)=>sum+geometries.get(local[s.index].id).cardWidth,0)+horizontalGap*(count-1));
    local.forEach((n,i)=>{
      const {row,column}=slots[i];
      const rowY=Math.max(cy,totalHeight/2+100)-totalHeight/2+rowHeights.slice(0,row).reduce((sum,h)=>sum+h+rowGap,0)+rowHeights[row]/2;
      const before=slots.filter(s=>s.row===row&&s.column<column).reduce((sum,s)=>sum+geometries.get(local[s.index].id).cardWidth+horizontalGap,0);
      const x=Math.max(cx,Math.max(...rowWidths)/2+100)-rowWidths[row]/2+before+geometries.get(n.id).cardWidth/2;
      positions.set(n.id,{x:Math.round(x),y:Math.round(rowY)});
    });
  }
  const localBounds=studentMapBoundaries(local.map(n=>({...n,...positions.get(n.id)})),geometries).micro;
  const outer=nodes.filter(n=>n.scale!=='micro').sort((a,b)=>a.label.localeCompare(b.label)||a.id.localeCompare(b.id));
  if(localBounds && outer.length) {
    const pitch=Math.max(...outer.map(n=>geometries.get(n.id).cardWidth))+48;
    const rowHeight=Math.max(...outer.map(n=>geometries.get(n.id).cardHeight));
    const perRow=Math.max(1,Math.floor((localBounds.rx*1.9)/pitch));
    const placed=[];
    outer.forEach((n,i)=>{
      const row=Math.floor(i/perRow),count=Math.min(perRow,outer.length-row*perRow),g=geometries.get(n.id);
      const savedBox=box(n,g,12),dx=Math.max(savedBox.left-localBounds.cx,localBounds.cx-savedBox.right,0),dy=Math.max(savedBox.top-localBounds.cy,localBounds.cy-savedBox.bottom,0);
      if(manual.has(n.id) && (dx/localBounds.rx)**2+(dy/localBounds.ry)**2>=1 && !placed.some(b=>overlaps(savedBox,b))) {placed.push(savedBox);return;}
      const x=localBounds.cx+(i%perRow-(count-1)/2)*pitch;
      const nearX=Math.max(0,Math.abs(x-localBounds.cx)-g.cardWidth/2-16);
      const ellipseY=localBounds.ry*Math.sqrt(Math.max(0,1-(nearX/localBounds.rx)**2));
      const p={x:Math.round(x),y:Math.round(localBounds.cy+ellipseY+rowHeight/2+28+row*(rowHeight+40))};
      while(placed.some(b=>overlaps(box(p,g,12),b)))p.y+=rowHeight+40;
      positions.set(n.id,p);placed.push(box(p,g,12));
    });
  }
  return positions;
}

const segmentHits = (a,b,r) => {
  // Liang-Barsky clipping, excluding a boundary-only contact.
  const dx=b.x-a.x,dy=b.y-a.y;let lo=0,hi=1;
  for(const [p,q] of [[-dx,a.x-r.left],[dx,r.right-a.x],[-dy,a.y-r.top],[dy,r.bottom-a.y]]) {
    if(Math.abs(p)<1e-8) {if(q<=0)return false;continue;}
    const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);
    if(lo>=hi)return false;
  }
  return hi>0&&lo<1;
};
const length = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
// Wording is always on its own routed line. There are no detached callouts.
const connectionCache = new Map();
export function attachedConnectionLayout(edges,nodes,positions,geometries,labelGeometries,labelObstacles=[]) {
  const key=JSON.stringify([edges.map(e=>[e.id,e.source,e.target]),nodes.map(n=>[n.id,positions.get(n.id),geometries.get(n.id)]),[...labelGeometries],labelObstacles]);
  if(connectionCache.has(key))return connectionCache.get(key);
  const anchors=new Map(),bounds=new Map(),paths=new Map(),routeKinds=new Map(),occupied=[...labelObstacles];
  const cards=new Map(nodes.filter(n=>geometries.get(n.id).cardWidth>0).map(n=>[n.id,box(positions.get(n.id),geometries.get(n.id),10)]));
  const ports=id=>{const p=positions.get(id),g=geometries.get(id);return g.cardWidth===0?[p]:[{x:p.x-g.cardWidth/2-14,y:p.y},{x:p.x+g.cardWidth/2+14,y:p.y},{x:p.x,y:p.y-g.cardHeight/2-14},{x:p.x,y:p.y+g.cardHeight/2+14}];};
  for(const edge of edges) {
    if(!positions.has(edge.source)||!positions.has(edge.target))continue;
    const label=labelGeometries.get(edge.id)||{width:0,height:0},a=positions.get(edge.source),b=positions.get(edge.target);
    const laneLimit=label.width?16:4;
    const ys=[(a.y+b.y)/2,...[...cards.values()].flatMap(r=>[r.top-24,r.bottom+24]).sort((x,y)=>Math.abs(x-(a.y+b.y)/2)-Math.abs(y-(a.y+b.y)/2)).slice(0,laneLimit)];
    const xs=[(a.x+b.x)/2,...[...cards.values()].flatMap(r=>[r.left-24,r.right+24]).sort((x,y)=>Math.abs(x-(a.x+b.x)/2)-Math.abs(y-(a.x+b.x)/2)).slice(0,laneLimit)];
    {
      const all=[...cards.values(),...occupied];
      ys.push(Math.min(...all.map(r=>r.top))-label.height/2-20,Math.max(...all.map(r=>r.bottom))+label.height/2+20);
      xs.push(Math.min(...all.map(r=>r.left))-label.width/2-20,Math.max(...all.map(r=>r.right))+label.width/2+20);
    }
    let best=null;
    const examine=points=>{
      points=points.filter((p,i)=>!i||length(p,points[i-1])>1);
      let hits=0,total=0;
      for(let i=1;i<points.length;i++){total+=length(points[i-1],points[i]);for(const r of cards.values())if(segmentHits(points[i-1],points[i],r))hits++;}
      const candidates=[];
      for(let i=1;i<points.length;i++)for(const f of [.5,.35,.65]){
        const start=points[i-1],end=points[i],anchor={x:start.x+(end.x-start.x)*f,y:start.y+(end.y-start.y)*f};
        const area={left:anchor.x-label.width/2-6,right:anchor.x+label.width/2+6,top:anchor.y-label.height/2-5,bottom:anchor.y+label.height/2+5};
        const collisions=label.width?[...cards.values(),...occupied].filter(r=>overlaps(area,r)).length:0;
        const enough=length(start,end)>Math.max(label.width*(Math.abs(end.x-start.x)/Math.max(1,length(start,end))),label.height)+20;
        const score=hits*1e7+collisions*1e9+(enough?0:10000)+total+points.length*24+Math.abs(f-.5)*100;
        candidates.push({points,anchor,area,score});
      }
      for(const candidate of candidates)if(!best||candidate.score<best.score)best=candidate;
    };
    const starts=ports(edge.source),ends=ports(edge.target);
    for(const start of starts)for(const end of ends)examine([start,end]);
    if(label.width || !best || best.score>=1e7)for(const start of starts)for(const end of ends) {
      for(const y of ys)examine([start,{x:start.x,y},{x:end.x,y},end]);
      for(const x of xs)examine([start,{x,y:start.y},{x,y:end.y},end]);
    }
    if(best?.score>=1e7)for(const start of starts)for(const end of ends)for(const x of xs)for(const y of ys) {
      examine([start,{x:start.x,y},{x,y},{x,y:end.y},end]);
      examine([start,{x,y:start.y},{x,y},{x:end.x,y},end]);
    }
    if(!best)continue;
    anchors.set(edge.id,best.anchor);bounds.set(edge.id,best.area);
    paths.set(edge.id,{source:best.points[0],target:best.points.at(-1),points:best.points});routeKinds.set(edge.id,'attached');
    if(label.width)occupied.push(best.area);
  }
  const result={anchors,bounds,paths,routeKinds,leaders:new Map(),fallbackIds:new Set(),unplaced:new Set()};
  connectionCache.set(key,result);if(connectionCache.size>32)connectionCache.delete(connectionCache.keys().next().value);
  return result;
}

export function relationshipAttachment(layout,id) {
  const route=layout.paths.get(id),label=layout.bounds.get(id);
  if(!route)return layout.anchors.get(id);
  const segments=route.points.slice(1).map((end,i)=>({start:route.points[i],end})).sort((a,b)=>length(b.start,b.end)-length(a.start,a.end));
  for(const {start,end} of segments)for(const f of [.2,.8,.35,.65,.5]) {
    const point={x:start.x+(end.x-start.x)*f,y:start.y+(end.y-start.y)*f};
    if(!label || !overlaps({left:point.x-12,right:point.x+12,top:point.y-12,bottom:point.y+12},label))return point;
  }
  return route.source;
}
