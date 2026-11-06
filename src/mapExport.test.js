import {beforeAll, afterAll, expect, test, vi} from 'vitest';
import {imagePdf} from './mapExport.js';
import {projectMapImage} from './App.jsx';
import {createDefaultProject} from './domain.js';
import {groupProject} from '../tests/fixtures/group-project.js';
import {NODE_COLORS} from '../shared/node-colors.js';

// DOM-only tests cover the drawing contract. The browser regression compares
// actual bounds, paint and connector paths, with the real fonts loaded.
beforeAll(()=>{vi.stubGlobal('requestAnimationFrame',cb=>setTimeout(cb,0));Object.defineProperty(SVGElement.prototype,'getBBox',{configurable:true,value:()=>({x:-120,y:-36,width:1810,height:630})});});
afterAll(()=>{delete SVGElement.prototype.getBBox;vi.unstubAllGlobals();});
const parsed=async p=>new DOMParser().parseFromString((await projectMapImage(p)).svg,'image/svg+xml');
function pair(direction='source to target') {
 const p=createDefaultProject();p.title='Test <map>';p.layout={autoFit:false};
 p.graph.nodes=[{id:'a',x:1400,y:280,scale:'micro',label:'Resident'},{id:'b',x:190,y:510,scale:'micro',label:'Teacher'}];
 p.graph.edges=[{id:'e',source:'a',target:'b',scale:'meso',verb:'talks with',relationshipProcess:{direction}}];
 return p;
}
test.each(NODE_COLORS)('keeps the chosen %s color, manual geometry and label in the actual canvas drawing',async color=>{
 const p=pair();p.graph.nodes[0].color=color;const before=structuredClone(p);
 const doc=await parsed(p);
 const a=doc.querySelector('[data-graph-id="a"]');expect(a.getAttribute('transform')).toBe('translate(1400 280)');
 expect(a.getAttribute('data-node-color')).toBe(color);
 expect(doc.querySelector('[data-graph-id="b"]').getAttribute('transform')).toBe('translate(190 510)');
 expect(doc.querySelector('[data-edge-id="e"]').textContent).toContain('talks with');expect(p).toEqual(before);
});
test.each([['source to target',false,true],['target to source',true,false],['both directions',true,true],['not yet known',false,false],['varies',false,false]])('preserves %s direction, including unknown and varying direction symbols',async(direction,start,end)=>{
 const doc=await parsed(pair(direction)), line=doc.querySelector('[data-graph-id="e"] path:last-child');
 expect(line.hasAttribute('marker-start')).toBe(start);expect(line.hasAttribute('marker-end')).toBe(end);
 expect(doc.querySelector('marker').getAttribute('orient')).toBe('auto-start-reverse');
 if(!start&&!end)expect(doc.querySelector('[data-edge-id="e"] title')?.textContent).toContain(direction);
});
test('frames exactly the drawing and shows only the system regions that exist',async()=>{
 const p=pair();const doc=await parsed(p);
 expect(doc.documentElement.getAttribute('viewBox')).toBe('-138 -54 1846 666');
 expect(doc.querySelectorAll('[data-ecology-layer]')).toHaveLength(1);
 p.graph.nodes.push({id:'office',label:'Access office',scale:'exosphere',x:1550,y:750});
 const exo=await parsed(p);expect(exo.querySelectorAll('[data-ecology-layer]')).toHaveLength(2);
 expect(exo.querySelector('[data-ecology-layer="macrosphere"]')).toBeNull();
});
test('uses exactly the selected relationships as group branches, and labels each group once',async()=>{
 const p=groupProject(), group=p.graph.edges.at(-1);const doc=await parsed(p);
 expect(doc.querySelectorAll('ellipse')).toHaveLength(3);
 expect([...doc.querySelectorAll('[data-group-member]')].map(n=>n.getAttribute('data-group-member')).sort()).toEqual([...group.relationshipIds].sort());
 expect(doc.querySelectorAll(`[data-edge-id="${group.id}"]`)).toHaveLength(1);
 expect(doc.querySelector(`[data-edge-id="${group.id}"]`).textContent).toContain(group.verb);
 group.relationshipIds=group.relationshipIds.slice(1);expect((await parsed(p)).querySelectorAll('[data-group-member]')).toHaveLength(1);
});
test('keeps earlier Meso and scope descriptions while omitting private source, retired records and editor controls',async()=>{
 const p=pair();p.submission.text='DO NOT INCLUDE MEMO';p.graph.nodes[0].evidence='PRIVATE PASSAGE';
 p.graph.nodes.push({id:'legacy',label:'Coordination',scale:'meso',scopeNodeIds:['a']},{id:'removed',label:'Retired secret',scale:'micro',claimState:'retired'});
 p.graph.nodes[0].settingNodeIds=['b'];p.graph.edges.push({...p.graph.edges[0],id:'removed-edge',verb:'secret verb',status:'rejected'});
 const {svg}=await projectMapImage(p);
 expect(svg).toContain('Test &lt;map&gt;');expect(svg).toContain('Preserved Meso record: Coordination');expect(svg).toContain('setting membership');
 for(const privateText of ['DO NOT INCLUDE MEMO','PRIVATE PASSAGE','Retired secret','secret verb','aria-keyshortcuts','tabindex='])expect(svg).not.toContain(privateText);
 expect(document.querySelector('[aria-hidden="true"].map-stage')).toBeNull();
});
test('retains missing, count and process details without drawing an invented arrow',async()=>{
 const p=pair('both directions');Object.assign(p.graph.edges[0].relationshipProcess,{connectionStatus:'missing',familyCount:34,channel:'Paper form',strength:'contested'});
 const d=await parsed(p);const line=d.querySelector('[data-graph-id="e"] path:last-child');
 expect(line.hasAttribute('marker-start')).toBe(false);expect(line.hasAttribute('marker-end')).toBe(false);
 expect(d.querySelector('desc').textContent).toMatch(/Families: 34/);expect(d.querySelector('desc').textContent).toMatch(/Channel: Paper form/);
});
test('PDF offsets resolve to each object and the embedded image stream has its exact byte length', async () => {
  const blob=imagePdf(new Uint8Array([255,216,255,217]),100,100);
  // jsdom Blob exposes FileReader rather than arrayBuffer.
  const buffer=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsArrayBuffer(blob);});
  const text=new TextDecoder('latin1').decode(buffer);
  expect(text).toMatch(/^%PDF-1.4/); expect(text).toContain('/Length 4');
  const xref=Number(/startxref\n(\d+)/.exec(text)[1]);expect(text.slice(xref, xref+4)).toBe('xref');
  const offsets=text.slice(xref).split('\n').slice(3,8).map(line=>Number(line.slice(0,10)));
  offsets.forEach((offset,i)=>expect(text.slice(offset,offset+7)).toBe(`${i+1} 0 obj`));
});
