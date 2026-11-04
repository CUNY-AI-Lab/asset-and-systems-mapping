import { test, expect, captureSourceRenderedScreenshot, scanAccessibility, assertNoAccessibilityViolations } from './support/test.js';
import { STORAGE_KEY } from '../../src/projectLibrary.js';
import { parseProject } from '../../src/domain.js';
import { buildEastHarlemDisabilityProject } from './fixtures/east-harlem-disability-project.js';
import { HOUSING_MACRO_MEMO } from '../fixtures/two-memo-cases.js';
import { notebookSection, showMap, projectMenu, editSelected } from './support/notebook.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const read = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
async function openProject(page, project) {
  await page.addInitScript(({key, value}) => {
    if (!localStorage.getItem('two-memo-seeded')) { localStorage.setItem(key, value); localStorage.setItem('two-memo-seeded', '1'); }
  }, { key: STORAGE_KEY, value: JSON.stringify(project) });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Class code' }).fill('101');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('article', { name: project.title }).getByRole('button', { name: 'Open project' }).click();
}
function localProject() {
  const p = buildEastHarlemDisabilityProject();
  p.activeScale = 'meso'; p.stage = 3; p.furthestStage = 4; p.completedScales = ['micro']; p.preflight = null;
  p.graph.nodes = p.graph.nodes.filter(node => node.scale === 'micro');
  p.graph.edges = p.graph.edges.filter(edge => edge.scale === 'meso');
  p.candidates = { nodes: [], edges: [] };
  p.instructor.requireStudentConfirmation = false;
  for (const scale of p.releasedScales) p.levelProgress[scale] = { stage: 3, reflection: 'Synthetic test interpretation, still to verify.' };
  return p;
}
async function memoPanel(page) {
  await notebookSection(page, 'suggestions');
  const panel = page.locator('.memo-drawer');
  if (!(await panel.evaluate(el => el.open))) await panel.locator(':scope > summary').click();
  return panel;
}

test('two memos retain the local map, model groups can be edited, and downloads retain group membership', async ({ page, makeAxeBuilder }, testInfo) => {
  const p = localProject(), original = structuredClone(p.graph);
  let macroInput;
  // Controlled model output; the server still supplies the real evaluation envelope.
  await page.route('**/api/preflight/evaluations', async route => {
    const input = route.request().postDataJSON();
    const response = await route.fetch(); const body = await response.json();
    expect(response.status()).toBe(201);
    const base = { guidance: [{ point: 'Check how repair priorities affect these local exchanges' }], nodes: [], connections: [], example: null, readiness: { ready: true, note: 'Check these suggestions against the memo.' } };
    if (input.activeScale === 'exosphere') base.nodes = [{ label: 'Repair prioritization policy', type: 'policy', scale: 'exosphere', evidence: 'The synthetic policy sets priorities for local repairs.', basis: 'inference' }];
    if (input.activeScale === 'macrosphere') {
      macroInput = input;
      const heading = input.carriedNodes.find(node => node.label === 'Repair prioritization policy');
      const members = input.carriedConnections.filter(edge => edge.scale === 'meso').slice(0, 2);
      const target = input.carriedNodes.find(node => node.id === members[0].source);
      base.connections = [{ source: heading.id, sourceLabel: heading.label, target: target.id, targetLabel: target.label,
        verb: 'sets priorities for', rationale: 'A synthetic policy may shape these exchanges; its effects still need verification.',
        relationshipIds: members.map(edge => edge.id), relationshipProcess: { direction: 'source to target' } }];
    }
    body.evaluation.review = base; await route.fulfill({ response, json: body });
  });
  await openProject(page, p);
  let panel = await memoPanel(page);
  const first = 'Synthetic local memo. Residents report repairs to a residents association, which contacts maintenance staff.';
  await panel.getByLabel('Upload Part 1 memo').setInputFiles({ name: 'local-memo.txt', mimeType: 'text/plain', buffer: Buffer.from(first) });
  await expect(panel.getByRole('textbox', { name: /^Memo/ })).toHaveValue(first);
  expect((await read(page)).graph).toEqual(original);
  await page.getByRole('combobox', { name: 'Work level', exact: true }).selectOption('exosphere');
  panel = await memoPanel(page);
  await panel.getByRole('button', { name: 'Add Part 2 memo' }).click();
  await panel.getByLabel('Upload Part 2 memo').setInputFiles({ name: 'macro-memo.txt', mimeType: 'text/plain', buffer: Buffer.from(HOUSING_MACRO_MEMO) });
  await expect(panel.getByRole('textbox', { name: /^Memo/ })).toHaveValue(HOUSING_MACRO_MEMO);
  await expect.poll(async () => (await read(page)).submission.text).toBe(first);
  expect((await read(page)).graph).toEqual(original);
  await page.getByRole('button', { name: 'Generate guidance', exact: true }).click();
  await page.getByRole('button', { name: 'Continue →', exact: true }).click();
  await expect.poll(async () => (await read(page)).graph.nodes.length).toBe(original.nodes.length + 1);
  await page.getByRole('combobox', { name: 'Work level', exact: true }).selectOption('macrosphere');
  await notebookSection(page, 'suggestions');
  await page.getByRole('button', { name: 'Generate guidance', exact: true }).click();
  await page.getByRole('button', { name: 'Continue →', exact: true }).click();
  await expect.poll(async () => (await read(page)).graph.edges.some(edge => edge.relationshipIds?.length === 2)).toBe(true);
  expect(macroInput.sourceMaterial).toContain(first); expect(macroInput.sourceMaterial).toContain(HOUSING_MACRO_MEMO);
  const grouped = (await read(page)).graph.edges.find(edge => edge.relationshipIds);
  await showMap(page);
  await expect(page.locator('.ecology-layer')).toHaveCount(2);
  await expect(page.locator('.ecology-layer__label')).toContainText(['Macrosystem', 'Microsystem']);
  await expect(page.locator('.relationship-group-vector')).toHaveCount(2);
  await captureSourceRenderedScreenshot(page, testInfo, 'Two spheres and model-proposed relationship group');
  await page.locator(`[data-graph-id="${grouped.id}"]`).focus();
  await page.locator(`[data-graph-id="${grouped.id}"]`).press('Enter');
  await editSelected(page);
  const picker = page.getByRole('group', { name: 'Local relationships', exact: true });
  const selected = picker.locator('input:checked');
  await selected.last().uncheck();
  await expect.poll(async () => (await read(page)).graph.edges.find(edge => edge.id === grouped.id).relationshipIds.length).toBe(1);
  await showMap(page);
  await expect(page.locator('.relationship-group-vector')).toHaveCount(1);
  assertNoAccessibilityViolations(await scanAccessibility(page, makeAxeBuilder, testInfo, 'Editable macrosystem groups'));
  const saved = await read(page);
  for (const node of original.nodes) expect(saved.graph.nodes.find(item => item.id === node.id)).toEqual(node);
  for (const edge of original.edges) expect(saved.graph.edges.find(item => item.id === edge.id)).toEqual(edge);
  await page.reload();
  await page.getByRole('article', { name: p.title }).getByRole('button', { name: 'Open project' }).click();
  expect((await read(page)).graph).toEqual(saved.graph);
  expect((await read(page)).part2Submission.text).toBe(HOUSING_MACRO_MEMO);
  await showMap(page);
  await captureSourceRenderedScreenshot(page, testInfo, 'Manual group edit survives reload');
  await notebookSection(page, 'suggestions');
  const commitsBefore = (await read(page)).events.filter(event => event.action === 'graph.committed').length;
  await page.locator('.notebook-refresh > summary').click();
  await page.getByRole('button', { name: 'Reread memo', exact: true }).click();
  await expect.poll(async () => (await read(page)).events.filter(event => event.action === 'graph.committed').length).toBe(commitsBefore + 1);
  await expect.poll(async () => (await read(page)).graph.edges.filter(edge => edge.id === grouped.id).length).toBe(1);
  expect((await read(page)).graph.edges.find(edge => edge.id === grouped.id).relationshipIds).toEqual(saved.graph.edges.find(edge => edge.id === grouped.id).relationshipIds);
  await showMap(page);
  // The same group can be made entirely by hand, with its draft recovered.
  const heading = saved.graph.nodes.find(node => node.label === 'Repair prioritization policy');
  await page.locator(`[data-graph-id="${heading.id}"]`).press('Enter');
  await editSelected(page);
  await page.getByRole('button', { name: `Connect from ${heading.label}`, exact: true }).click();
  await page.locator(`[data-graph-id="${original.nodes[0].id}"]`).press('Enter');
  await editSelected(page);
  let form = page.locator('.add-form');
  await form.getByRole('checkbox', { name: 'Connect local relationships under a macrosystem heading' }).check();
  const checks = form.getByRole('group', { name: 'Local relationships', exact: true }).getByRole('checkbox');
  await checks.nth(1).check(); await checks.nth(2).check();
  await form.getByRole('textbox', { name: 'Relationship', exact: true }).fill('may limit');
  await form.getByRole('textbox', { name: 'Evidence or question' }).fill('Synthetic student question: verify which repair exchanges the policy affects.');
  await form.getByRole('combobox', { name: 'Direction', exact: true }).selectOption('varies');
  await page.reload();
  await page.getByRole('article', { name: p.title }).getByRole('button', { name: 'Open project' }).click();
  await showMap(page);
  await page.getByRole('button', { name: 'Resume relationship', exact: true }).click();
  form = page.locator('.add-form');
  await expect(form.getByRole('group', { name: 'Local relationships', exact: true }).locator('input:checked')).toHaveCount(2);
  await form.getByRole('button', { name: 'Add relationship', exact: true }).click();
  await expect.poll(async () => (await read(page)).graph.edges.filter(edge => edge.relationshipIds).length).toBe(2);
  const final = await read(page);
  const manual = final.graph.edges.find(edge => edge.verb === 'may limit');
  expect(manual.origin).toBe('student entry'); expect(manual.relationshipProcess.direction).toBe('varies');
  expect(manual.claimEvidence[0].sourcePassage).toContain('Synthetic student question');
  await projectMenu(page, 'Export & share');
  const exports = page.getByRole('dialog', { name: 'Export & share' });
  for (const format of ['JSON', 'Markdown', 'PNG image', 'PDF']) {
    const pending = page.waitForEvent('download');
    await exports.getByRole('button', { name: new RegExp(`^${format}`) }).click();
    const file = await pending, data = await readFile(await file.path());
    if (format === 'JSON') {
      const restored = parseProject(data.toString('utf8'));
      expect(restored.graph).toEqual(final.graph);
      expect(restored.submission.text).toBe(first); expect(restored.part2Submission.text).toBe(HOUSING_MACRO_MEMO);
    } else if (format === 'Markdown') {
      const text = data.toString('utf8'); expect(text).toContain(first); expect(text).toContain(HOUSING_MACRO_MEMO);
      expect(text).toContain('may limit'); expect(text).toContain('grouped local relationships');
    } else {
      expect(data.length).toBeGreaterThan(1000);
      expect(data.subarray(0, 8).toString(format === 'PDF' ? 'ascii' : 'hex')).toBe(format === 'PDF' ? '%PDF-1.4' : '89504e470d0a1a0a');
      await file.saveAs(testInfo.outputPath(format === 'PDF' ? 'two-spheres.pdf' : 'two-spheres.png'));
    }
  }
});

const realFiles = [
  ['Amina Asad - Layer_2_Mesosystem_Table_Template.docx.pdf', /Door|counselor/i],
  ['Chloe, Leslie, Ximena - EDUC210 Assignment 2 Layer 1 — Microsystem.pdf', /Flushing/],
  ['Micro Memo.pdf', /Bronx/],
  ['Microsystem EDITED.pdf.pdf', /Johnson|Harlem/],
];
test('retained local coordinates stay inside two fitted spheres after Part 2', async ({ page }, testInfo) => {
  const p = localProject();
  p.activeScale = 'macrosphere';
  p.graph.nodes.forEach((node, index) => { node.x = 120 + index % 3 * 300; node.y = 120 + Math.floor(index / 3) * 180; });
  p.graph.nodes.push({ ...structuredClone(p.graph.nodes[0]), id: 'retained-policy', label: 'Repair allocation policy', scale: 'exosphere', type: 'policy', x: 1300, y: 360,
    annotations: { analytical: { id: 'retained-policy-analytical', text: '' }, evidence: { id: 'retained-policy-evidence', text: '' } } });
  p.layout = { manualNodeIds: p.graph.nodes.filter(node => node.scale === 'micro').map(node => node.id) };
  parseProject(JSON.stringify(p));
  const original = structuredClone(p.graph);
  await openProject(page, p);
  await showMap(page);
  await page.locator('.graph-canvas').press('0');
  await expect(page.locator('.ecology-layer')).toHaveCount(2);
  const geometry = await page.locator('.graph-canvas').evaluate(svg => {
    const rings = Object.fromEntries([...svg.querySelectorAll('[data-ecology-layer]')].map(group => {
      const e = group.querySelector('ellipse');
      return [group.dataset.ecologyLayer, Object.fromEntries(['cx','cy','rx','ry'].map(key => [key, Number(e.getAttribute(key))]))];
    }));
    const outside = [...svg.querySelectorAll('.graph-node')].flatMap(node => {
      const [x,y] = node.getAttribute('transform').match(/-?[\d.]+/g).map(Number);
      const card = node.querySelector('.node-card');
      const left = x + Number(card.getAttribute('x')), top = y + Number(card.getAttribute('y'));
      const right = left + Number(card.getAttribute('width')), bottom = top + Number(card.getAttribute('height'));
      const ring = rings[node.classList.contains('graph-node--micro') ? 'micro' : 'exosphere'];
      return [[left,top],[right,top],[left,bottom],[right,bottom]].some(([px,py]) => ((px-ring.cx)/ring.rx)**2 + ((py-ring.cy)/ring.ry)**2 > 1.001) ? [node.dataset.graphId] : [];
    });
    const viewport = svg.getBoundingClientRect();
    const outer = svg.querySelector('[data-ecology-layer="exosphere"] ellipse').getBoundingClientRect();
    const overflow = Math.max(viewport.left - outer.left, outer.right - viewport.right, viewport.top - outer.top, outer.bottom - viewport.bottom, 0);
    const heading = svg.querySelector('[data-graph-id="retained-policy"]');
    const [hx, hy] = heading.getAttribute('transform').match(/-?[\d.]+/g).map(Number);
    const card = heading.querySelector('.node-card');
    const left = hx + Number(card.getAttribute('x')), top = hy + Number(card.getAttribute('y'));
    const dx = Math.max(left-rings.micro.cx, rings.micro.cx-left-Number(card.getAttribute('width')), 0);
    const dy = Math.max(top-rings.micro.cy, rings.micro.cy-top-Number(card.getAttribute('height')), 0);
    return { outside, center: rings.micro.cx, overflow, headingOutsideMicro: (dx/rings.micro.rx)**2 + (dy/rings.micro.ry)**2 };
  });
  expect(geometry.outside).toEqual([]);
  expect(geometry.center).toBeLessThan(1000);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  expect(geometry.headingOutsideMicro).toBeGreaterThanOrEqual(1);
  expect((await read(page)).graph).toEqual(original);
  await captureSourceRenderedScreenshot(page, testInfo, 'Retained graph inside fitted two-sphere outlines');
  const first = original.nodes[0];
  await page.locator(`[data-graph-id="${first.id}"]`).press('ArrowRight');
  await expect.poll(async () => (await read(page)).graph.nodes.find(node => node.id === first.id).x).toBe(first.x + 8);
  expect((await read(page)).graph.nodes.find(node => node.id === first.id).y).toBe(first.y);
});
test('an older project uploading Part 2 from memo entry retains its first memo and map', async ({ page }) => {
  const p = localProject(); p.activeScale = 'exosphere'; p.stage = 0;
  p.levelProgress.exosphere.stage = 0;
  await openProject(page, p);
  await page.locator('.upload-zone input').setInputFiles({ name: 'second-memo.txt', mimeType: 'text/plain', buffer: Buffer.from(HOUSING_MACRO_MEMO) });
  await expect.poll(async () => (await read(page)).part2Submission?.text).toBe(HOUSING_MACRO_MEMO);
  const saved = await read(page);
  expect(saved.submission).toEqual(p.submission); expect(saved.graph).toEqual(p.graph);
  await page.reload();
  expect((await read(page)).part2Submission.text).toBe(HOUSING_MACRO_MEMO);
});
for (const [filename, expected] of realFiles) test(`instructor example uploads at Meso: ${filename}`, async ({ page }) => {
  test.skip(!process.env.SYSTEMS_MAPPING_REAL_MEMOS_DIR, 'Local instructor examples are intentionally excluded from the repository.');
  const p = localProject(); await openProject(page, p);
  const panel = await memoPanel(page);
  await panel.getByLabel('Upload Part 1 memo').setInputFiles(join(process.env.SYSTEMS_MAPPING_REAL_MEMOS_DIR, filename));
  await expect(panel.getByRole('textbox', { name: /^Memo/ })).toHaveValue(expected);
  await expect.poll(async () => (await read(page)).submission.fileName).toBe(filename);
  const saved = await read(page);
  expect(saved.graph).toEqual(p.graph); expect(saved.submission.fileName).toBe(filename);
  await page.reload();
  expect((await read(page)).submission.text).toBe(saved.submission.text);
});
