import { expect, test } from 'vitest';
import { mapExportSvg, imagePdf } from './mapExport.js';
import { createDefaultProject } from './domain.js';
test('escapes text, preserves earlier Meso records and scope links, and omits retired items and source memo', () => {
  const p = createDefaultProject(); p.title='<script>& title'; p.submission.text='Private source text';
  p.graph.nodes=[{id:'a',label:'Home <safe>',scale:'micro',settingNodeIds:['b']},{id:'b',label:'Coordination',scale:'meso',scopeNodeIds:['a']},{id:'c',label:'Retired secret',scale:'exosphere',claimState:'retired'}];
  p.graph.nodes.push({id:'setting',label:'School setting',scale:'micro'});
  p.graph.nodes[0].settingNodeIds = ['setting'];
  p.graph.nodes.push({id:'d',label:'Rejected secret',scale:'micro',status:'rejected'});
  p.graph.edges=[{source:'a',target:'b',verb:'hidden verb',status:'rejected'}];
  const {svg}=mapExportSvg(p);
  expect(svg).toContain('&lt;script&gt;&amp; title'); expect(svg).toContain('Home &lt;safe&gt;');expect(svg).toContain('stroke-dasharray'); expect(svg).toContain('setting membership');
  expect(svg).not.toContain('Private source text'); expect(svg).not.toContain('Retired secret'); expect(svg).not.toContain('Rejected secret'); expect(svg).not.toContain('hidden verb');
  expect(svg).toContain('Preserved Meso records from earlier maps');
  expect(svg).not.toMatch(/>Meso<\/text>/);
});
test('exports Micro items and Meso links inside one shared circle with no separate Meso column', () => {
  const project = createDefaultProject();
  project.graph.nodes = Array.from({ length: 8 }, (_, index) => ({ id: `node-${index}`, label: `Mapped person ${index + 1}`, scale: 'micro' }));
  project.graph.edges = project.graph.nodes.slice(1).map((node, index) => ({ source: 'node-0', target: node.id, scale: 'meso', verb: `connection ${index + 1}` }));
  const { svg, width } = mapExportSvg(project);
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const circle = document.querySelector('[data-export-layer="micro"] ellipse');
  expect(document.querySelectorAll('ellipse')).toHaveLength(1);
  expect(document.querySelectorAll('[data-export-layer="meso"]')).toHaveLength(0);
  expect(svg).toContain('Map · 8 items · 7 connections');
  expect(svg).toContain('Micro items · Meso relationships');
  expect(width).toBe(900);
  const [cx, cy, rx, ry] = ['cx', 'cy', 'rx', 'ry'].map(name => Number(circle.getAttribute(name)));
  expect(cx - rx).toBeGreaterThan(0);
  expect(cx + rx).toBeLessThan(width);
  for (const card of document.querySelectorAll('rect[fill="#dbeafe"]')) {
    const [x, y, cardWidth, cardHeight] = ['x', 'y', 'width', 'height'].map(name => Number(card.getAttribute(name)));
    for (const [px, py] of [[x, y], [x + cardWidth, y], [x, y + cardHeight], [x + cardWidth, y + cardHeight]]) {
      expect(((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2).toBeLessThan(1);
    }
  }
});
test('the exported map does not show a saved audience setting', () => {
  const project = createDefaultProject();
  project.sharingTier = 'course';
  project.graph.nodes = [{ id: 'a', label: 'Community center', scale: 'micro' }];
  const { svg } = mapExportSvg(project);
  expect(svg).toContain('Community center');
  expect(svg).toContain('Map · 1 item · 0 connections');
  expect(svg).toContain('>Connections</text>');
  expect(svg).not.toContain('Export audience');
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

test('preserves the Macro action and names the condition before each affected item', () => {
  const project = createDefaultProject();
  project.graph.nodes = [
    { id: 'a', label: 'School', scale: 'micro' },
    { id: 'b', label: 'Clinic', scale: 'micro' },
    { id: 'law', label: 'Privacy law', scale: 'macrosphere', deontic: 'prohibits', scopeNodeIds: ['a', 'b'] },
  ];
  const { svg } = mapExportSvg(project);
  const text = [...new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('tspan')].map(node => node.textContent).join(' ');
  expect(text).toContain('Privacy law — prohibits — School');
  expect(text).toContain('Privacy law — prohibits — Clinic');
  expect(text).not.toContain('— scope —');
});

test.each([
  ['source to target', false, true, 'Resident talks with Teacher'],
  ['target to source', true, false, 'Teacher talks with Resident'],
  ['both directions', true, true, 'Resident talks with Teacher, both directions'],
  ['not yet known', false, false, 'Resident — talks with — Teacher, direction not yet known'],
  ['varies', false, false, 'Resident — talks with — Teacher, direction varies'],
])('exports %s with matching arrowheads and legend', (direction, start, end, description) => {
  const p = createDefaultProject();
  p.graph.nodes = [{ id: 'a', label: 'Resident', scale: 'micro' }, { id: 'b', label: 'Teacher', scale: 'micro' }];
  p.graph.edges = [{ id: 'edge', source: 'a', target: 'b', verb: 'talks with', scale: 'meso', relationshipProcess: { direction } }];
  const { svg } = mapExportSvg(p);
  expect(svg.includes('marker-start="url(#arrow)"')).toBe(start);
  expect(svg.includes('marker-end="url(#arrow)"')).toBe(end);
  expect(svg).toContain(description);
  expect(svg).not.toContain('←');
  expect(svg).toContain('orient="auto-start-reverse"');
});

test('exports missing pairs without arrowheads, keeps connector details and explains count width', () => {
  const p = createDefaultProject();
  p.graph.nodes = [{ id: 'a', label: 'Assistant principal', scale: 'micro' }, { id: 'b', label: 'Parent', scale: 'micro' }];
  p.graph.edges = [{ id: 'edge', source: 'a', target: 'b', verb: 'exchanges forms with', scale: 'meso', relationshipProcess: {
    direction: 'both directions', connectionStatus: 'missing', strength: 'contested', familyCount: 34, channel: 'Paper form', connectingWork: 'Parent',
  } }];
  const { svg } = mapExportSvg(p);
  expect(svg).toContain('Missing connection between Assistant principal and Parent');
  expect(svg).toContain('stroke-dasharray="6 4"');
  expect(svg).not.toContain('marker-start="url(#arrow)"');
  expect(svg).not.toContain('marker-end="url(#arrow)"');
  const visibleText = [...new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('tspan')].map(node => node.textContent).join(' ');
  for (const text of ['Strength: contested', 'Families: 34', 'Channel: Paper form', 'Connecting work: Parent', 'Wider lines represent more recorded families']) expect(visibleText).toContain(text);
});
