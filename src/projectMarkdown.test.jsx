import { expect, test } from 'vitest';
import { projectMarkdown } from './App.jsx';
import { createPortableProject, SCALE_ORDER, SCALES } from './domain.js';
import { buildEastHarlemDisabilityProject } from '../tests/e2e/fixtures/east-harlem-disability-project.js';

test('exports saved Field Notes for every level and uses the current active edit', () => {
  const project = buildEastHarlemDisabilityProject();
  for (const scale of SCALE_ORDER) project.levelProgress[scale].reflection = `Saved ${scale} observations.`;
  project.reflection = 'Current active observations.';
  const markdown = projectMarkdown(createPortableProject(project, 'private'));
  for (const scale of SCALE_ORDER) {
    expect(markdown).toContain(`### ${SCALES[scale].label}`);
    expect(markdown).toContain(scale === project.activeScale ? project.reflection : project.levelProgress[scale].reflection);
  }
  expect(markdown).not.toContain(`Saved ${project.activeScale} observations.`);
});

test('exports the current map while keeping removed items in the private JSON record', () => {
  const project = buildEastHarlemDisabilityProject();
  const hiddenEdge = project.graph.edges.find(edge => edge.scale === 'meso');
  const retired = project.graph.nodes.find(node => node.id === hiddenEdge.source);
  retired.claimState = 'retired';
  retired.status = 'rejected';
  hiddenEdge.verb = 'REMOVED RELATIONSHIP';
  hiddenEdge.claimState = 'retired';
  hiddenEdge.status = 'rejected';
  // Match normal removal of a node from the scopes of surviving structures.
  for (const node of project.graph.nodes) {
    if (node.scopeNodeIds) node.scopeNodeIds = node.scopeNodeIds.filter(id => id !== retired.id);
    if (node.scale === 'macrosphere' && node.scopeNodeIds.length < 2) node.claimState = 'retired';
  }
  const portable = createPortableProject(project, 'private');
  const markdown = projectMarkdown(portable);
  expect(markdown).not.toContain(`**${retired.label}**`);
  expect(markdown).not.toContain('REMOVED RELATIONSHIP');
  expect(portable.graph.nodes.find(node => node.id === retired.id).claimState).toBe('retired');
});

test('retains audience redaction for earlier and current Field Notes', () => {
  const project = buildEastHarlemDisabilityProject();
  project.submission.sensitive = true;
  project.submission.consent = false;
  project.instructor.maxSharingTier = 'public';
  for (const scale of SCALE_ORDER) project.levelProgress[scale].reflection = `Private ${scale} observation.`;
  project.reflection = 'Private active observation.';
  const markdown = projectMarkdown(createPortableProject(project, 'public'));
  expect(markdown).toContain('[redacted]');
  expect(markdown).not.toContain('Private active observation.');
  for (const scale of SCALE_ORDER) expect(markdown).not.toContain(`Private ${scale} observation.`);
});
