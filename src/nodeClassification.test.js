import { describe, expect, it } from 'vitest';
import { parseProject, serializeProject, validateProject } from './domain.js';
import { reclassifyNode } from './nodeClassification.js';
import { nodeLabelIssue, reviseMapText } from './mapTextEditing.js';
import { buildEastHarlemDisabilityProject } from '../tests/e2e/fixtures/east-harlem-disability-project.js';

function fixture() {
  const project = buildEastHarlemDisabilityProject();
  const outside = project.graph.nodes.find(node => node.scale === 'exosphere');
  const counselor = { ...structuredClone(outside), id: 'node_counselor', label: 'Community counselor', type: 'resource',
    notes: 'Keep this student note.', claimState: 'inference', origin: 'model suggestion',
    annotations: { analytical: { id: 'annotation_counselor_note', text: 'Keep this interpretation.' }, evidence: { id: 'annotation_counselor_evidence', text: '' } } };
  project.graph.nodes.push(counselor);
  project.candidates.nodes.push(structuredClone(counselor));
  project.graph.edges.push({ ...structuredClone(project.graph.edges[0]), id: 'edge_counselor', source: counselor.id,
    sourceLabel: counselor.label, scale: 'macrosphere', annotation: { id: 'annotation_counselor_edge', text: 'Keep this relationship.' } });
  validateProject(project);
  return { project, counselor };
}

describe('explicit node classification corrections', () => {
  it('preserves identity, positions, evidence, notes, sources and all relationships when correcting a role', () => {
    const { project, counselor } = fixture();
    const expected = structuredClone(project);
    for (const collection of [expected.graph, expected.candidates]) {
      Object.assign(collection.nodes.find(node => node.id === counselor.id), {
        scale: 'micro', type: 'role', claimState: 'student interpretation', settingNodeIds: [], focalParticipation: 'unclear',
      });
    }
    expect(reclassifyNode(project, counselor.id, 'micro', 'role')).toBe('');
    expect(project).toEqual(expected);
    expect(parseProject(serializeProject(project)).graph).toEqual(expected.graph);
  });

  it.each([
    ['meso', 'role'], ['micro', 'policy'], ['unknown', 'resource'], ['exosphere', 'policy'], ['exosphere', 'law'], ['exosphere', 'belief'], ['exosphere', 'structure'], ['macrosphere', 'agency'],
  ])('rejects an invalid %s/%s combination without changing the project', (scale, type) => {
    const { project, counselor } = fixture(), before = structuredClone(project);
    expect(reclassifyNode(project, counselor.id, scale, type)).toMatch(/type/);
    expect(project).toEqual(before);
  });

  it('leaves a no-op and missing node unchanged', () => {
    const { project, counselor } = fixture(), before = structuredClone(project);
    expect(reclassifyNode(project, counselor.id, counselor.scale, counselor.type)).toBe('');
    expect(reclassifyNode(project, 'missing', 'micro', 'role')).toMatch(/Select a node/);
    expect(project).toEqual(before);
  });

  it.each([
    ['rejected', 'retired', 'removed'],
    ['rejected', 'inference', 'removed'],
    ['pending', 'inference', 'pending'],
    ['research lead', 'research lead', 'set aside'],
  ])('preserves the %s node’s saved mapping decision when its classification changes', (status, claimState, reviewDecision) => {
    const { project, counselor } = fixture();
    project.graph.edges = project.graph.edges.filter(edge => edge.source !== counselor.id && edge.target !== counselor.id);
    for (const records of [project.graph, project.candidates]) Object.assign(records.nodes.find(node => node.id === counselor.id), { status, claimState, reviewDecision });
    validateProject(project);
    const before = structuredClone(project);
    expect(reclassifyNode(project, counselor.id, 'micro', 'role')).toBe('');
    for (const key of ['graph', 'candidates']) {
      const old = before[key].nodes.find(node => node.id === counselor.id);
      expect(project[key].nodes.find(node => node.id === counselor.id)).toEqual({ ...old, scale: 'micro', type: 'role', settingNodeIds: [], focalParticipation: 'unclear' });
      expect(project[key].edges).toEqual(before[key].edges);
    }
  });

  it('rejects moving an endpoint out of a saved local relationship atomically', () => {
    const { project } = fixture();
    const node = project.graph.nodes.find(item => item.label === 'Peer support group');
    node.settingNodeIds = [];
    const before = structuredClone(project);
    expect(reclassifyNode(project, node.id, 'exosphere', 'resource')).toMatch(/saved connection or setting/);
    expect(project).toEqual(before);
  });

  it('preserves a node’s setting membership when a system change would discard it', () => {
    const { project } = fixture(), before = structuredClone(project);
    const node = project.graph.nodes.find(item => item.type === 'person');
    expect(reclassifyNode(project, node.id, 'exosphere', 'resource')).toMatch(/memberships/);
    expect(project).toEqual(before);
  });

  it('protects selected relationship groups when their heading is moved inward', () => {
    const { project } = fixture();
    const heading = project.graph.nodes.find(node => node.scale === 'exosphere');
    const edge = project.graph.edges.find(item => item.source === heading.id);
    edge.relationshipIds = [project.graph.edges[0].id];
    edge.target = project.graph.edges[0].source;
    edge.targetLabel = project.graph.nodes.find(node => node.id === edge.target).label;
    validateProject(project);
    const before = structuredClone(project);
    expect(reclassifyNode(project, heading.id, 'micro', 'institution')).toMatch(/saved connection or setting/);
    expect(project).toEqual(before);
  });

  it('allows institution-qualified policies while keeping the institution itself out of Macro', () => {
    const { project, counselor } = fixture();
    reviseMapText(project, 'graph', 'nodes', counselor.id, 'NYC DOE confidentiality policy');
    expect(reclassifyNode(project, counselor.id, 'macrosphere', 'policy')).toBe('');
    expect(() => validateProject(project)).not.toThrow();
    expect(nodeLabelIssue('NYC DOE', { scale: 'macrosphere', type: 'policy' }, [])).toMatch(/institution/);
  });
});
