// A reading view of the saved map. These positions never mutate its records.
const box = (p, g, gap = 0) => ({ left:p.x-g.cardWidth/2-gap, right:p.x+g.cardWidth/2+gap, top:p.y-g.cardHeight/2-gap, bottom:p.y+g.cardHeight/2+gap });
const overlaps = (a,b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const corners = b => [[b.left,b.top],[b.right,b.top],[b.left,b.bottom],[b.right,b.bottom]];
export const REGION_CAPTION = Object.freeze({ width: 192, height: 36, offsetY: 6 });

export function contentEllipse(bounds, padding = 24) {
  if (!bounds.length) return null;
  const left=Math.min(...bounds.map(b=>b.left)), right=Math.max(...bounds.map(b=>b.right));
  const top=Math.min(...bounds.map(b=>b.top)), bottom=Math.max(...bounds.map(b=>b.bottom));
  const cx=(left+right)/2,cy=(top+bottom)/2;
  const points=bounds.flatMap(corners);
  const a=Math.max(REGION_CAPTION.width/2+12,(right-left)/2+padding);
  const b=Math.max(60,(bottom-top)/2+padding);
  const factor=Math.max(1,...points.map(([x,y])=>Math.hypot((x-cx)/a,(y-cy)/b)));
  let best={cx,cy,rx:a*factor,ry:b*factor};
  const area=ellipse=>(ellipse.rx+padding)*(ellipse.ry+padding);
  // Fit both axes to the occupied shape. A fixed horizontal center made a
  // sparse item at one side inflate the opposite side of every outer sphere.
  // A bounded coarse-to-fine search keeps this deterministic during resizing.
  let xStep=Math.max(8,(right-left)/8),yStep=Math.max(8,(bottom-top)/8),radiusStep=.24;
  for(let pass=0;pass<5;pass++) {
    const origin=best;
    for(const dx of [-1,0,1])for(const dy of [-1,0,1])for(const dr of [-1,0,1]) {
      const nextCx=origin.cx+dx*xStep,nextCy=origin.cy+dy*yStep;
      const reach=Math.max(nextCx-left,right-nextCx);
      const rx=Math.max(a,reach+.01,origin.rx*Math.exp(dr*radiusStep));
      const ry=Math.max(60,...points.map(([x,y])=>Math.abs(y-nextCy)/Math.sqrt(1-((x-nextCx)/rx)**2)));
      const candidate={cx:nextCx,cy:nextCy,rx,ry};
      if(Number.isFinite(ry)&&area(candidate)<area(best)-.001)best=candidate;
    }
    xStep/=2;yStep/=2;radiusStep/=2;
  }
  const rx=best.rx+padding,ry=best.ry+padding;
  return {cx:best.cx,cy:best.cy,rx,ry,left:best.cx-rx,right:best.cx+rx,top:best.cy-ry,bottom:best.cy+ry};
}
function outerBoundary(inner,nodes,geometries,scale) {
  // Circumscribed polygon vertices guarantee containment of the continuous
  // inner ellipse without reserving its empty rectangular corners.
  const bounds=nodes.map(n=>box(n,geometries.get(n.id),8));
  const circumscribed=1/Math.cos(Math.PI/64);
  if(inner)for(let i=0;i<64;i++) {
    const angle=i*Math.PI/32,x=inner.cx+inner.rx*circumscribed*Math.cos(angle),y=inner.cy+inner.ry*circumscribed*Math.sin(angle);
    bounds.push({left:x,right:x,top:y,bottom:y});
  }
  if(inner)bounds.push({left:inner.cx-REGION_CAPTION.width/2,right:inner.cx+REGION_CAPTION.width/2,
    top:inner.top+REGION_CAPTION.offsetY-REGION_CAPTION.height/2-12,
    bottom:inner.top+REGION_CAPTION.offsetY+REGION_CAPTION.height/2});
  return contentEllipse(bounds,scale==='exosphere'?18:22);
}
export function studentMapBoundaries(nodes, geometries) {
  const local=nodes.filter(n=>n.scale==='micro');
  const micro=contentEllipse(local.map(n=>box(n,geometries.get(n.id))),20);
  const outer=nodes.filter(n=>n.scale!=='micro');
  if (!outer.length) return {micro};
  const boundaries={micro};
  let inner=micro;
  for(const scale of ['exosphere','macrosphere']) {
    inner=outerBoundary(inner,outer.filter(n=>n.scale===scale),geometries,scale);
    if(inner)boundaries[scale]=inner;
  }
  return boundaries;
}

// Keep an active move in its system without rewriting saved or imported pins.
// Clamping along the gesture stops at the near boundary instead of jumping the
// card to an unrelated free slot on the other side of the map.
export function constrainStudentNodeMove(node, requested, nodes, geometries, {autoFit=true}={}) {
  if(!autoFit||!['exosphere','macrosphere'].includes(node.scale))return requested;
  const regions=studentMapBoundaries(nodes,geometries);
  const inner=regions[node.scale==='exosphere'?'micro':'exosphere'];
  if(!inner)return requested;
  const geometry=geometries.get(node.id);
  const caption={left:inner.cx-REGION_CAPTION.width/2,right:inner.cx+REGION_CAPTION.width/2,
    top:inner.top+REGION_CAPTION.offsetY-REGION_CAPTION.height/2,bottom:inner.top+REGION_CAPTION.offsetY+REGION_CAPTION.height/2};
  const clearsInner=position=>{
    const bounds=box(position,geometry,2);
    const dx=Math.max(bounds.left-inner.cx,inner.cx-bounds.right,0),dy=Math.max(bounds.top-inner.cy,inner.cy-bounds.bottom,0);
    return (dx/inner.rx)**2+(dy/inner.ry)**2>=1&&!overlaps(bounds,caption);
  };
  // A previously saved card inside a sphere remains editable; auto-fit never
  // retroactively moves it. Only a move from a valid position is constrained.
  if(clearsInner(requested)||!clearsInner(node))return requested;
  let low=0,high=1;
  for(let step=0;step<20;step++) {
    const fraction=(low+high)/2;
    const candidate={x:node.x+(requested.x-node.x)*fraction,y:node.y+(requested.y-node.y)*fraction};
    if(clearsInner(candidate))low=fraction;else high=fraction;
  }
  return {x:Math.round(node.x+(requested.x-node.x)*low),y:Math.round(node.y+(requested.y-node.y)*low)};
}

export function studentMapPositions(nodes, edges, geometries, {manualNodeIds=[],phoneOverview,phone=false,aspectRatio=1.8,readingAspect,autoFit=true}={}) {
  const positions=new Map(nodes.map(n=>[n.id,{x:n.x,y:n.y}]));
  if(!autoFit)return positions;
  const local=nodes.filter(n=>n.scale==='micro').sort((a,b)=>a.y-b.y||a.x-b.x||a.id.localeCompare(b.id));
  const compatibleView=readingAspect === undefined ? phoneOverview === 'preserve' : Math.abs(Math.log(aspectRatio/readingAspect))<.16;
  const manual=new Set(manualNodeIds);
  const preserveLegacy=readingAspect === undefined && phoneOverview === 'preserve';
  if(local.length && !preserveLegacy && (!compatibleView || !local.every(n=>manual.has(n.id)))) {
    const columns=Math.min(phone?3:5,Math.max(2,Math.ceil(Math.sqrt(local.length*aspectRatio*(phone ? .42 : .75)))));
    const cx=840;
    const cy=600;
    const rows=Math.ceil(local.length/columns);
    const counts=Array(rows).fill(Math.floor(local.length/rows));
    const middleFirst=counts.map((_,i)=>i).sort((a,b)=>Math.abs(a-(rows-1)/2)-Math.abs(b-(rows-1)/2));
    for(let i=0;i<local.length%rows;i++)counts[middleFirst[i]]++;
    let offset=0;
    const slots=counts.flatMap((count,row)=>Array.from({length:count},(_,column)=>({row,column,count,index:offset++})));
    // Keep linked local items near each other. Swap items between stable slots
    // to shorten connections; this never changes deliberately saved placement.
    const localIds=new Set(local.map(n=>n.id));
    const links=edges.filter(e=>localIds.has(e.source)&&localIds.has(e.target)&&!e.relationshipIds?.length);
    if(links.length)local.sort((a,b)=>a.id.localeCompare(b.id));
    const slotPoints=slots.map(s=>({x:(s.column-(s.count-1)/2)*240,y:s.row*130}));
    const cost=()=>{
      const index=new Map(local.map((n,i)=>[n.id,i]));
      return links.reduce((sum,e)=>{const a=slotPoints[index.get(e.source)],b=slotPoints[index.get(e.target)];return sum+(a.x-b.x)**2+(a.y-b.y)**2;},0);
    };
    if(links.length)for(let pass=0;pass<8;pass++) {
      let improved=false,best=cost();
      for(let i=0;i<local.length;i++)for(let j=i+1;j<local.length;j++) {
        [local[i],local[j]]=[local[j],local[i]];
        const next=cost();
        if(next<best-1){best=next;improved=true;}else [local[i],local[j]]=[local[j],local[i]];
      }
      if(!improved)break;
    }
    const rowHeights=counts.map((_,row)=>Math.max(...slots.filter(s=>s.row===row).map(s=>geometries.get(local[s.index].id).cardHeight)));
    const rowGap=phone?40:48;
    const totalHeight=rowHeights.reduce((sum,h)=>sum+h,0)+rowGap*(rows-1);
    const horizontalGap=phone?40:48;
    const rowWidths=counts.map((count,row)=>slots.filter(s=>s.row===row).reduce((sum,s)=>sum+geometries.get(local[s.index].id).cardWidth,0)+horizontalGap*(count-1));
    const occupied=local.filter(n=>manual.has(n.id)).map(n=>box(n,geometries.get(n.id),12));
    local.forEach((n,i)=>{
      if(manual.has(n.id))return;
      const {row,column}=slots[i];
      const rowY=Math.max(cy,totalHeight/2+100)-totalHeight/2+rowHeights.slice(0,row).reduce((sum,h)=>sum+h+rowGap,0)+rowHeights[row]/2;
      const before=slots.filter(s=>s.row===row&&s.column<column).reduce((sum,s)=>sum+geometries.get(local[s.index].id).cardWidth+horizontalGap,0);
      const x=Math.max(cx,Math.max(...rowWidths)/2+100)-rowWidths[row]/2+before+geometries.get(n.id).cardWidth/2;
      const p={x:Math.round(x),y:Math.round(rowY)};
      while(occupied.some(b=>overlaps(box(p,geometries.get(n.id),12),b)))p.y+=geometries.get(n.id).cardHeight+rowGap;
      positions.set(n.id,p);occupied.push(box(p,geometries.get(n.id),12));
    });
  }
  const micro=studentMapBoundaries(local.map(n=>({...n,...positions.get(n.id)})),geometries).micro;
  if(!micro)return positions;
  // A wide viewport does not imply free space beside a wide retained Micro
  // map. Compare complete nested layouts in all four directions, using the
  // final sphere bounds rather than a card-only rectangle. At most 16 layouts
  // are considered; saved manual positions are fixed in every candidate.
  let layouts=[{positions,inner:micro}];
  for(const scale of ['exosphere','macrosphere']) {
    const outer=nodes.filter(n=>n.scale===scale).sort((a,b)=>a.label.localeCompare(b.label)||a.id.localeCompare(b.id));
    const movable=outer.filter(n=>!manual.has(n.id));
    const directions=movable.length?['bottom','right','top','left']:['bottom'];
    layouts=layouts.flatMap(layout=>directions.map(direction=>{
      const next=new Map(layout.positions),inner=layout.inner;
      const horizontal=direction==='left'||direction==='right',sign=direction==='left'||direction==='top'?-1:1;
      const width=Math.max(0,...movable.map(n=>geometries.get(n.id).cardWidth));
      const height=Math.max(0,...movable.map(n=>geometries.get(n.id).cardHeight));
      const pitch=horizontal?height+40:width+48;
      const perRow=Math.max(1,Math.floor((horizontal?inner.ry:inner.rx)*1.9/pitch));
      const occupied=nodes.filter(n=>n.scale==='micro'||manual.has(n.id)||scale==='macrosphere'&&n.scale==='exosphere')
        .map(n=>box(next.get(n.id),geometries.get(n.id),12));
      occupied.push({left:inner.cx-REGION_CAPTION.width/2-12,right:inner.cx+REGION_CAPTION.width/2+12,
        top:inner.top+REGION_CAPTION.offsetY-REGION_CAPTION.height/2-12,bottom:inner.top+REGION_CAPTION.offsetY+REGION_CAPTION.height/2+12});
      movable.forEach((n,i)=>{
        const row=Math.floor(i/perRow),count=Math.min(perRow,movable.length-row*perRow),g=geometries.get(n.id);
        const along=(i%perRow-(count-1)/2)*pitch;
        const near=Math.max(0,Math.abs(along)-(horizontal?g.cardHeight:g.cardWidth)/2-16);
        const reach=(horizontal?inner.rx:inner.ry)*Math.sqrt(Math.max(0,1-(near/(horizontal?inner.ry:inner.rx))**2));
        const outward=reach+(horizontal?width:height)/2+28+row*((horizontal?width:height)+40);
        const p=horizontal?{x:Math.round(inner.cx+sign*outward),y:Math.round(inner.cy+along)}
          :{x:Math.round(inner.cx+along),y:Math.round(inner.cy+sign*outward)};
        // Start with every pinned card, including later levels, so a generated
        // card cannot take its position and force a manual card to move.
        while(occupied.some(b=>overlaps(box(p,g,12),b)))p[horizontal?'x':'y']+=sign*((horizontal?width:height)+40);
        next.set(n.id,p);occupied.push(box(p,g,12));
      });
      return {positions:next,inner:outerBoundary(inner,outer.map(n=>({...n,...next.get(n.id)})),geometries,scale)||inner};
    }));
  }
  const fitCost=layout=>Math.max((layout.inner.rx*2+40)/Math.max(.2,aspectRatio),layout.inner.ry*2+52);
  const connectionLength=layout=>edges.reduce((total,edge)=>{
    const a=layout.positions.get(edge.source),b=layout.positions.get(edge.target);
    return total+(a&&b?Math.hypot(a.x-b.x,a.y-b.y):0);
  },0);
  layouts.sort((a,b)=>fitCost(a)-fitCost(b)||connectionLength(a)-connectionLength(b));
  return layouts[0].positions;
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
const routeConflict = (a,b,c,d) => {
  const cross=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
  if(Math.abs(abC)<.01 && Math.abs(abD)<.01) {
    const axis=Math.abs(a.x-b.x)>Math.abs(a.y-b.y)?'x':'y';
    return Math.min(Math.max(a[axis],b[axis]),Math.max(c[axis],d[axis]))-Math.max(Math.min(a[axis],b[axis]),Math.min(c[axis],d[axis]))>2 ? 1e8 : 0;
  }
  return abC*abD < -.01 && cdA*cdB < -.01 ? 50000 : 0;
};
// Wording is always on its own routed line. There are no detached callouts.
const connectionCache = new Map();
export function attachedConnectionLayout(edges,nodes,positions,geometries,labelGeometries,labelObstacles=[]) {
  const key=JSON.stringify([edges.map(e=>[e.id,e.source,e.target]),nodes.map(n=>[n.id,positions.get(n.id),geometries.get(n.id)]),[...labelGeometries],labelObstacles]);
  if(connectionCache.has(key))return connectionCache.get(key);
  const anchors=new Map(),bounds=new Map(),paths=new Map(),routeKinds=new Map(),occupied=[...labelObstacles],segments=[];
  const cards=new Map(nodes.filter(n=>geometries.get(n.id).cardWidth>0).map(n=>[n.id,box(positions.get(n.id),geometries.get(n.id),4)]));
  const ports=(id,edgeId)=>{
    const p=positions.get(id),g=geometries.get(id),incident=edges.filter(e=>e.source===id||e.target===id).map(e=>e.id).sort();
    const offset=(incident.indexOf(edgeId)-(incident.length-1)/2)*9;
    const dx=Math.max(-g.cardWidth/2+12,Math.min(g.cardWidth/2-12,offset)),dy=Math.max(-g.cardHeight/2+10,Math.min(g.cardHeight/2-10,offset));
    return g.cardWidth===0?[p]:[{x:p.x-g.cardWidth/2-6,y:p.y+dy},{x:p.x+g.cardWidth/2+6,y:p.y+dy},{x:p.x+dx,y:p.y-g.cardHeight/2-6},{x:p.x+dx,y:p.y+g.cardHeight/2+6}];
  };
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
      let hits=0,total=0,conflicts=0;
      for(let i=1;i<points.length;i++){
        total+=length(points[i-1],points[i]);
        for(const r of [...cards.values(),...occupied])if(segmentHits(points[i-1],points[i],r))hits++;
        for(const [c,d] of segments)conflicts+=routeConflict(points[i-1],points[i],c,d);
      }
      const candidates=[];
      for(let i=1;i<points.length;i++)for(const f of [.5,.35,.65]){
        const start=points[i-1],end=points[i],anchor={x:start.x+(end.x-start.x)*f,y:start.y+(end.y-start.y)*f};
        const area={left:anchor.x-label.width/2-6,right:anchor.x+label.width/2+6,top:anchor.y-label.height/2-5,bottom:anchor.y+label.height/2+5};
        const collisions=label.width?[...cards.values(),...occupied].filter(r=>overlaps(area,r)).length+segments.filter(([c,d])=>segmentHits(c,d,area)).length:0;
        const enough=length(start,end)>Math.max(label.width*(Math.abs(end.x-start.x)/Math.max(1,length(start,end))),label.height)+20;
        const score=hits*1e10+collisions*1e12+conflicts+(enough?0:10000)+total+points.length*24+Math.abs(f-.5)*100;
        candidates.push({points,anchor,area,score});
      }
      for(const candidate of candidates)if(!best||candidate.score<best.score)best=candidate;
    };
    const starts=ports(edge.source,edge.id),ends=ports(edge.target,edge.id);
    for(const start of starts)for(const end of ends)examine([start,end]);
    if(label.width || !best || best.score>=50000)for(const start of starts)for(const end of ends) {
      for(const y of ys)examine([start,{x:start.x,y},{x:end.x,y},end]);
      for(const x of xs)examine([start,{x,y:start.y},{x,y:end.y},end]);
    }
    if(best?.score>=1e8)for(const start of starts)for(const end of ends)for(const x of xs)for(const y of ys) {
      examine([start,{x:start.x,y},{x,y},{x,y:end.y},end]);
      examine([start,{x,y:start.y},{x,y},{x:end.x,y},end]);
    }
    if(!best)continue;
    anchors.set(edge.id,best.anchor);bounds.set(edge.id,best.area);
    paths.set(edge.id,{source:best.points[0],target:best.points.at(-1),points:best.points});routeKinds.set(edge.id,'attached');
    best.points.slice(1).forEach((point,i)=>segments.push([best.points[i],point]));
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
