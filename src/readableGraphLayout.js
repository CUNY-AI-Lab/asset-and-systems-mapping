const compare = (a, b) => String(a).localeCompare(String(b));
const distance = (a, b) => Math.hypot(a.x-b.x, a.y-b.y);
const box = (point, geometry, padding=0) => ({left:point.x-geometry.cardWidth/2-padding,right:point.x+geometry.cardWidth/2+padding,top:point.y-geometry.cardHeight/2-padding,bottom:point.y+geometry.cardHeight/2+padding});
const overlap = (a,b) => a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;
const orient = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
export const segmentsCross = (a,b,c,d) => orient(a,b,c)*orient(a,b,d)<-1e-6 && orient(c,d,a)*orient(c,d,b)<-1e-6;
export function segmentIntersectsBox(a,b,r) {
  if (Math.max(a.x,b.x)<=r.left || Math.min(a.x,b.x)>=r.right || Math.max(a.y,b.y)<=r.top || Math.min(a.y,b.y)>=r.bottom) return false;
  if ((a.x>r.left&&a.x<r.right&&a.y>r.top&&a.y<r.bottom)||(b.x>r.left&&b.x<r.right&&b.y>r.top&&b.y<r.bottom)) return true;
  const points=[{x:r.left,y:r.top},{x:r.right,y:r.top},{x:r.right,y:r.bottom},{x:r.left,y:r.bottom}];
  return points.some((p,i)=>segmentsCross(a,b,p,points[(i+1)%4]));
}

export function layoutQuality(nodes, edges, positions, geometries) {
  const boxes=new Map(nodes.map(n=>[n.id,box(positions.get(n.id),geometries.get(n.id),8)]));
  const links=edges.filter(e=>positions.has(e.source)&&positions.has(e.target));
  let nodeOverlaps=0, crossings=0, throughNodes=0, length=0;
  for(let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++) if(overlap(boxes.get(nodes[i].id),boxes.get(nodes[j].id))) nodeOverlaps++;
  for(let i=0;i<links.length;i++) {
    const e=links[i],a=positions.get(e.source),b=positions.get(e.target);length+=distance(a,b);
    for(const [id,bounds] of boxes) if(id!==e.source&&id!==e.target&&segmentIntersectsBox(a,b,bounds)) throughNodes++;
    for(let j=i+1;j<links.length;j++) {
      const f=links[j];if([e.source,e.target].includes(f.source)||[e.source,e.target].includes(f.target)) continue;
      if(segmentsCross(a,b,positions.get(f.source),positions.get(f.target))) crossings++;
    }
  }
  return {nodeOverlaps,crossings,throughNodes,length};
}
const cost = quality => quality.nodeOverlaps*1e9+quality.throughNodes*1e6+quality.crossings*10000+quality.length;

// Stable, scale-constrained slot ordering. The renderer supplies measured slots
// and valid outer-band candidates; no simulation runs after a drag or edit.
export function readableNodePositions(nodes, edges, initial, geometries, {manualIds=[],candidates=new Map()}={}) {
  const positions=new Map(nodes.map(n=>[n.id,{...(initial.get(n.id)||{x:n.x,y:n.y})}]));
  const pinned=new Set(manualIds);
  for(const node of nodes) if(pinned.has(node.id)) positions.set(node.id,{x:node.x,y:node.y});
  const local=nodes.filter(n=>n.scale==='micro').sort((a,b)=>compare(a.id,b.id));
  const localIds=new Set(local.map(n=>n.id));
  const localEdges=edges.filter(e=>['micro','meso'].includes(e.scale)&&localIds.has(e.source)&&localIds.has(e.target));
  const scoreLocal=()=>cost(layoutQuality(local,localEdges,positions,geometries));
  if(local.length<=24) {
    for(let pass=0;pass<3;pass++) {
      let improved=false, best=scoreLocal();
      for(let i=0;i<local.length;i++) for(let j=i+1;j<local.length;j++) {
        const a=local[i].id,b=local[j].id;if(pinned.has(a)||pinned.has(b)) continue;
        const pa=positions.get(a),pb=positions.get(b);positions.set(a,pb);positions.set(b,pa);
        const next=scoreLocal();
        if(next<best-1e-6) {best=next;improved=true;} else {positions.set(a,pa);positions.set(b,pb);}
      }
      if(!improved) break;
    }
  }
  const outer=nodes.filter(n=>n.scale!=='micro'&&!pinned.has(n.id)).sort((a,b)=>compare(a.scale,b.scale)||compare(a.id,b.id));
  for(let pass=0;pass<3;pass++) {
    let improved=false;
    for(const node of outer) {
      let chosen=positions.get(node.id),best=cost(layoutQuality(nodes,edges,positions,geometries));
      for(const candidate of candidates.get(node.id)||[]) {
        positions.set(node.id,candidate);
        const next=cost(layoutQuality(nodes,edges,positions,geometries));
        if(next<best-1e-6) {best=next;chosen=candidate;improved=true;}
      }
      positions.set(node.id,chosen);
    }
    if(!improved) break;
  }
  // Connected outer nodes sometimes have to move together to leave a blocked
  // corridor. A bounded pair search escapes that local minimum deterministically.
  if(nodes.length<=24 && outer.length<=8) {
    const available=new Set(outer.map(node=>node.id)),seen=new Set();
    for(const edge of [...edges].sort((a,b)=>compare(a.id,b.id))) {
      if(!available.has(edge.source)||!available.has(edge.target)) continue;
      const key=[edge.source,edge.target].sort(compare).join('|');if(seen.has(key)) continue;seen.add(key);
      let a=positions.get(edge.source),b=positions.get(edge.target),best=cost(layoutQuality(nodes,edges,positions,geometries));
      for(const ca of candidates.get(edge.source)||[a]) for(const cb of candidates.get(edge.target)||[b]) {
        positions.set(edge.source,ca);positions.set(edge.target,cb);
        const next=cost(layoutQuality(nodes,edges,positions,geometries));
        if(next<best-1e-6) {best=next;a=ca;b=cb;}
      }
      positions.set(edge.source,a);positions.set(edge.target,b);
    }
  }
  return positions;
}

function port(center,toward,geometry,offset,padding) {
  const dx=toward.x-center.x,dy=toward.y-center.y,length=Math.max(1,Math.hypot(dx,dy));
  const unit={x:dx/length,y:dy/length},normal={x:-unit.y,y:unit.x};
  const halfWidth=geometry.cardWidth/2,halfHeight=geometry.cardHeight/2;
  const safeOffset=Math.max(-Math.min(halfWidth,halfHeight)*.6,Math.min(Math.min(halfWidth,halfHeight)*.6,offset));
  const shift={x:normal.x*safeOffset,y:normal.y*safeOffset};
  const tx=Math.abs(unit.x)>1e-8?(Math.sign(unit.x)*halfWidth-shift.x)/unit.x:Infinity;
  const ty=Math.abs(unit.y)>1e-8?(Math.sign(unit.y)*halfHeight-shift.y)/unit.y:Infinity;
  const t=Math.min(tx,ty)+padding;
  return {x:center.x+shift.x+unit.x*t,y:center.y+shift.y+unit.y*t};
}

// Connections remain straight. Labels may use a short perpendicular leader;
// label placement never reroutes an edge around the graph.
export function straightConnectionLayout(edges,nodes,positions,nodeGeometry,labelGeometry) {
  const anchors=new Map(),bounds=new Map(),paths=new Map(),leaders=new Map(),routeKinds=new Map(),fallbackIds=new Set(),unplaced=new Set();
  const cards=new Map(nodes.map(n=>[n.id,box(positions.get(n.id),nodeGeometry.get(n.id),10)]));
  const groups=new Map();
  for(const edge of edges) { const key=[edge.source,edge.target].sort(compare).join('|');const group=groups.get(key)||[];group.push(edge);groups.set(key,group); }
  for(const group of groups.values()) group.sort((a,b)=>compare(a.id,b.id));
  const records=edges.filter(e=>positions.has(e.source)&&positions.has(e.target)&&e.source!==e.target).map(edge=>{
    const a=positions.get(edge.source),b=positions.get(edge.target),group=groups.get([edge.source,edge.target].sort(compare).join('|'));
    const offset=(group.indexOf(edge)-(group.length-1)/2)*18;
    const canonical=edge.source<edge.target?1:-1;
    const source=port(a,b,nodeGeometry.get(edge.source),offset*canonical,5);
    const target=port(b,a,nodeGeometry.get(edge.target),-offset*canonical,12);
    const length=distance(source,target),geometry=labelGeometry.get(edge.id);
    return {edge,source,target,length,geometry,slack:length-geometry.width};
  }).sort((a,b)=>['micro','meso','exosphere','macrosphere'].indexOf(a.edge.scale)-['micro','meso','exosphere','macrosphere'].indexOf(b.edge.scale)||a.slack-b.slack||compare(a.edge.id,b.edge.id));
  const occupied=[];
  for(const {edge,source,target,length,geometry} of records) {
    const dx=target.x-source.x,dy=target.y-source.y,normal={x:-dy/Math.max(1,length),y:dx/Math.max(1,length)};
    let chosen=null;
    const offsets=[0,geometry.height/2+12,-geometry.height/2-12];
    for(let step=1;step<=8;step++) offsets.push((geometry.height+18)*step,-(geometry.height+18)*step);
    for(const offset of offsets) for(const fraction of [.5,.35,.65,.22,.78,.1,.9]) {
      const point={x:source.x+dx*fraction,y:source.y+dy*fraction};
      const anchor={x:point.x+normal.x*offset,y:point.y+normal.y*offset};
      const area={left:anchor.x-geometry.width/2-5,right:anchor.x+geometry.width/2+5,top:anchor.y-geometry.height/2-5,bottom:anchor.y+geometry.height/2+5};
      const collisions=[...cards.values()].filter(card=>overlap(area,card)).length+occupied.filter(other=>overlap(area,other)).length;
      const intersections=records.filter(other=>other.edge.id!==edge.id&&segmentIntersectsBox(other.source,other.target,area)).length;
      const score=collisions*1e7+intersections*300+Math.abs(offset)*2+Math.abs(fraction-.5)*length;
      if(!chosen||score<chosen.score) chosen={anchor,area,point,offset,score,collisions};
    }
    anchors.set(edge.id,chosen.anchor);bounds.set(edge.id,chosen.area);occupied.push(chosen.area);
    paths.set(edge.id,{source,target,points:[source,target]});routeKinds.set(edge.id,'straight');
    if(Math.abs(chosen.offset)>1) leaders.set(edge.id,{source:chosen.point,target:{x:chosen.anchor.x-normal.x*geometry.height/2*Math.sign(chosen.offset),y:chosen.anchor.y-normal.y*geometry.height/2*Math.sign(chosen.offset)}});
    if(chosen.collisions) {fallbackIds.add(edge.id);unplaced.add(edge.id);}
  }
  return {anchors,bounds,paths,leaders,routeKinds,fallbackIds,unplaced};
}
