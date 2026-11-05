import { NODE_COLORS } from '../shared/node-colors.js';

const bounds = (p, g, gap = 0) => ({left:p.x-g.cardWidth/2-gap,right:p.x+g.cardWidth/2+gap,top:p.y-g.cardHeight/2-gap,bottom:p.y+g.cardHeight/2+gap});
const overlaps = (a,b) => a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
const extent = boxes => ({left:Math.min(...boxes.map(b=>b.left)),right:Math.max(...boxes.map(b=>b.right)),top:Math.min(...boxes.map(b=>b.top)),bottom:Math.max(...boxes.map(b=>b.bottom))});
const distance = (a,b) => (a.x-b.x)**2+(a.y-b.y)**2;

// Match the existing Micro palette, including explicit student color choices.
// Grouping never changes a node's color, type, system or saved coordinates.
export function microColorGroup(node) {
  if(NODE_COLORS.includes(node.color))return node.color;
  if(['organization','institution','agency','service','place','setting'].includes(node.type))return 'teal';
  if(['activity','object','resource','dataset','event'].includes(node.type))return 'amber';
  return 'blue';
}

export function connectedMicroPositions(nodes, edges, geometries, {manual,aspectRatio,phone,labelGeometries}) {
  const degree=new Map(nodes.map(n=>[n.id,0]));
  for(const edge of edges)for(const id of new Set([edge.source,edge.target]))if(degree.has(id))degree.set(id,degree.get(id)+1);
  const connected=nodes.filter(n=>degree.get(n.id)>0).sort((a,b)=>degree.get(b.id)-degree.get(a.id)||a.id.localeCompare(b.id));
  if(!connected.length)return null;
  const isolated=nodes.filter(n=>!degree.get(n.id)).sort((a,b)=>microColorGroup(a).localeCompare(microColorGroup(b))||a.id.localeCompare(b.id));
  const ids=new Set(connected.map(n=>n.id));
  const links=edges.filter(e=>ids.has(e.source)&&ids.has(e.target)&&e.source!==e.target&&!e.relationshipIds?.length);
  const busiest=Math.max(...degree.values());
  // Reserve routing lanes as degree/density grows, instead of making the
  // router take long detours around tightly packed cards. Sparse pairs stay close.
  const pressure=Math.min(72,Math.max(0,busiest-2)*10+Math.max(0,links.length-connected.length)*3);
  const gap=(phone?40:48)+pressure;
  const width=Math.max(...connected.map(n=>geometries.get(n.id).cardWidth));
  const height=Math.max(...connected.map(n=>geometries.get(n.id).cardHeight));
  const horizontalPitch=Math.max(width+gap,...links.map(edge=>
    (geometries.get(edge.source).cardWidth+geometries.get(edge.target).cardWidth)/2+(labelGeometries?.get(edge.id)?.width||0)+36));
  const verticalPitch=height+Math.max(gap,...links.map(edge=>(labelGeometries?.get(edge.id)?.height||0)+40));
  const columns=Math.min(phone?3:5,Math.max(connected.length>=3?3:1,2*Math.round((Math.sqrt(connected.length*Math.min(2,aspectRatio)*.65)-1)/2)+1));
  const rows=2*Math.ceil((Math.ceil(connected.length/columns)-1)/2)+1;
  const center={x:840,y:600};
  const slots=Array.from({length:rows*columns},(_,i)=>({x:center.x+(i%columns-(columns-1)/2)*horizontalPitch,y:center.y+(Math.floor(i/columns)-(rows-1)/2)*verticalPitch}))
    .sort((a,b)=>distance(a,center)-distance(b,center)||a.y-b.y||a.x-b.x);
  const assigned=new Map(),remaining=[...slots];
  for(const node of connected) {
    const neighbors=links.filter(e=>e.source===node.id||e.target===node.id).map(e=>assigned.get(e.source===node.id?e.target:e.source)).filter(Boolean);
    const cost=p=>neighbors.reduce((sum,q)=>sum+distance(p,q),0)+distance(p,center)*degree.get(node.id)*.15;
    remaining.sort((a,b)=>cost(a)-cost(b)||a.y-b.y||a.x-b.x);
    assigned.set(node.id,remaining.shift());
  }
  // Shorten local connections while keeping the most connected item central.
  // Bounded passes avoid expensive force simulation or jitter during editing.
  const cost=()=>links.reduce((sum,e)=>sum+distance(assigned.get(e.source),assigned.get(e.target)),0);
  const movable=connected.filter((_,i)=>i||busiest<3);
  for(let pass=0;pass<4;pass++) {
    let improved=false,best=cost();
    for(let i=0;i<movable.length;i++)for(let j=i+1;j<Math.min(movable.length,i+24);j++) {
      const a=movable[i].id,b=movable[j].id,p=assigned.get(a),q=assigned.get(b);
      assigned.set(a,q);assigned.set(b,p);
      const next=cost();
      if(next<best-1){best=next;improved=true;}else{assigned.set(a,p);assigned.set(b,q);}
    }
    if(!improved)break;
  }
  const positions=new Map(nodes.filter(n=>manual.has(n.id)).map(n=>[n.id,{x:n.x,y:n.y}]));
  const occupied=nodes.filter(n=>manual.has(n.id)).map(n=>bounds(n,geometries.get(n.id),12));
  for(const node of connected) {
    if(manual.has(node.id))continue;
    const p={...assigned.get(node.id)},g=geometries.get(node.id);
    while(occupied.some(b=>overlaps(bounds(p,g,12),b)))p.y+=verticalPitch;
    positions.set(node.id,p);occupied.push(bounds(p,g,12));
  }
  const core=extent(connected.map(n=>bounds(positions.get(n.id),geometries.get(n.id))));
  const groups=new Map();
  for(const node of isolated.filter(n=>!manual.has(n.id))) {
    const color=microColorGroup(node);
    if(!groups.has(color))groups.set(color,[]);
    groups.get(color).push(node);
  }
  // Isolated items occupy a separate pocket beside or below the connected
  // network. Compare both orientations against the actual canvas proportions.
  const candidates=['right','bottom'].map(side=>{
    const next=new Map(positions),used=[...occupied];
    const gutter=gap+32;
    const maxWidth=Math.max(1,...isolated.map(n=>geometries.get(n.id).cardWidth));
    const perRow=side==='right'?1:Math.max(1,Math.floor((core.right-core.left+24)/(maxWidth+24)));
    let y=side==='right'?core.top:core.bottom+gutter;
    for(const group of groups.values()) {
      for(let start=0;start<group.length;start+=perRow) {
        const row=group.slice(start,start+perRow),rowWidth=row.reduce((sum,n)=>sum+geometries.get(n.id).cardWidth,0)+24*(row.length-1);
        const rowHeight=Math.max(...row.map(n=>geometries.get(n.id).cardHeight));
        let x=side==='right'?core.right+gutter:(core.left+core.right-rowWidth)/2;
        for(const node of row) {
          const g=geometries.get(node.id),p={x:x+g.cardWidth/2,y:y+rowHeight/2};
          while(used.some(b=>overlaps(bounds(p,g,12),b)))p.y+=rowHeight+32;
          next.set(node.id,p);used.push(bounds(p,g,12));x+=g.cardWidth+24;
        }
        y+=rowHeight+24;
      }
      y+=16;
    }
    const all=extent(nodes.map(n=>bounds(next.get(n.id),geometries.get(n.id))));
    return {positions:next,fit:Math.max((all.right-all.left)/Math.max(.3,aspectRatio),all.bottom-all.top)};
  });
  candidates.sort((a,b)=>a.fit-b.fit);
  return candidates[0].positions;
}
