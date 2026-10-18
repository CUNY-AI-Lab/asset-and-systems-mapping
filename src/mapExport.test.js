import { expect, test } from 'vitest';
import { mapExportSvg, imagePdf } from './mapExport.js';
import { createDefaultProject } from './domain.js';
test('escapes text, includes every level and scope link, and omits retired items and source memo', () => {
  const p = createDefaultProject(); p.title='<script>& title'; p.submission.text='Private source text';
  p.graph.nodes=[{id:'a',label:'Home <safe>',scale:'micro',settingNodeIds:['b']},{id:'b',label:'Coordination',scale:'meso',scopeNodeIds:['a']},{id:'c',label:'Retired secret',scale:'exosphere',claimState:'retired'}];
  p.graph.nodes.push({id:'d',label:'Rejected secret',scale:'micro',status:'rejected'});
  p.graph.edges=[{source:'a',target:'b',verb:'hidden verb',status:'rejected'}];
  const {svg}=mapExportSvg(p);
  expect(svg).toContain('&lt;script&gt;&amp; title'); expect(svg).toContain('Home &lt;safe&gt;');expect(svg).toContain('stroke-dasharray'); expect(svg).toContain('setting membership');
  expect(svg).not.toContain('Private source text'); expect(svg).not.toContain('Retired secret'); expect(svg).not.toContain('Rejected secret'); expect(svg).not.toContain('hidden verb');
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
