import { describe, expect, it } from 'vitest';
import { createPortableProject, createRelationshipProcess, parseProject, serializeProject } from './domain.js';
import { nodeLabelIssue, relationshipIssue, reviseMapText } from './mapTextEditing.js';
import { buildEastHarlemDisabilityProject } from '../tests/e2e/fixtures/east-harlem-disability-project.js';

describe('map wording revisions', () => {
  it.each(['graph', 'candidates'])('synchronizes %s wording and endpoint labels without changing other work', (collection) => {
    const project = buildEastHarlemDisabilityProject();
    project.candidates = structuredClone(project.graph);
    const node = project.graph.nodes.find(item => item.type === 'person');
    const edge = project.graph.edges.find(item => item.target === node.id);
    project.reflection = 'Preserve my Field Notes.';
    project.levelProgress.macrosphere.reflection = project.reflection;
    node.annotations.analytical.text = 'Preserve this interpretation.';
    edge.annotation.text = 'Preserve this connection note.';
    const expected = structuredClone(project);
    for (const records of [expected.graph, expected.candidates]) {
      records.nodes.find(item => item.id === node.id).label = 'Neighborhood resident';
      records.edges.forEach(item => {
        if (item.source === node.id) item.sourceLabel = 'Neighborhood resident';
        if (item.target === node.id) item.targetLabel = 'Neighborhood resident';
      });
      records.edges.find(item => item.id === edge.id).verb = 'helps with daily appointments';
    }
    reviseMapText(project, collection, 'nodes', node.id, 'Neighborhood resident');
    reviseMapText(project, collection, 'edges', edge.id, 'helps with daily appointments');
    expect(project).toEqual(expected);
    expect(() => parseProject(serializeProject(project))).not.toThrow();
    expect(createPortableProject(project).graph.edges.find(item => item.id === edge.id).verb).toBe('helps with daily appointments');
  });

  it.each(['graph', 'candidates'])('handles rekeyed Exo candidates from %s without changing carried Micro records', (collection) => {
    const project = buildEastHarlemDisabilityProject();
    const carried = project.graph.nodes.find(item => item.scale === 'micro');
    const outside = project.graph.nodes.find(item => item.scale === 'exosphere');
    const edge = project.graph.edges.find(item => item.scale === 'exosphere');
    const candidate = { ...structuredClone(outside), id: carried.id };
    const candidateEdge = { ...structuredClone(edge), id: 'edge_candidate_rekeyed', source: candidate.id };
    project.candidates = { nodes: [candidate], edges: [candidateEdge] };
    const carriedBefore = structuredClone(carried);
    const originalEndpoints = [edge.source, edge.target, candidateEdge.source, candidateEdge.target];
    reviseMapText(project, collection, 'nodes', collection === 'graph' ? outside.id : candidate.id, 'Regional Mobility Scheduling Office');
    reviseMapText(project, collection, 'edges', collection === 'graph' ? edge.id : candidateEdge.id, 'funds');
    expect(outside.label).toBe(candidate.label);
    expect(edge.verb).toBe('funds');
    expect(candidateEdge.verb).toBe('funds');
    expect(edge.sourceLabel).toBe(outside.label);
    expect(candidateEdge.sourceLabel).toBe(outside.label);
    expect(carried).toEqual(carriedBefore);
    expect([edge.source, edge.target, candidateEdge.source, candidateEdge.target]).toEqual(originalEndpoints);
  });

  it('edits graph-only manual and accepted Ask connections without creating candidates', () => {
    const project = buildEastHarlemDisabilityProject();
    const edge = project.graph.edges[0];
    edge.origin = 'model suggestion';
    const expected = { ...structuredClone(edge), verb: 'helps with appointments' };
    reviseMapText(project, 'graph', 'edges', edge.id, expected.verb);
    expect(edge).toEqual(expected);
    expect(project.candidates).toEqual({ nodes: [], edges: [] });
  });

  it('keeps pending candidate endpoint repairs separate from an existing connection', () => {
    const project = buildEastHarlemDisabilityProject();
    const edge = project.graph.edges[0];
    const before = structuredClone(edge);
    const repair = { ...structuredClone(edge), target: project.graph.nodes[4].id, targetLabel: project.graph.nodes[4].label, status: 'pending' };
    project.candidates.edges = [repair];
    reviseMapText(project, 'candidates', 'edges', repair.id, 'supports');
    expect(edge).toEqual(before);
  });

  it('resolves each candidate endpoint owner when candidate and carried IDs collide', () => {
    const project = buildEastHarlemDisabilityProject();
    const carried = project.graph.nodes[0];
    const outside = project.graph.nodes.find(node => node.scale === 'exosphere');
    const edge = project.graph.edges.find(item => item.scale === 'exosphere');
    const candidate = { ...structuredClone(outside), id: carried.id };
    const rekeyedEdge = { ...structuredClone(edge), id: 'edge_candidate_rekeyed', source: candidate.id };
    const carriedEdge = structuredClone(edge);
    project.candidates = { nodes: [candidate], edges: [rekeyedEdge, carriedEdge] };
    reviseMapText(project, 'graph', 'nodes', carried.id, 'Neighborhood apartment building');
    expect(rekeyedEdge.sourceLabel).toBe(outside.label);
    reviseMapText(project, 'graph', 'nodes', outside.id, 'Regional Mobility Scheduling Office');
    expect(rekeyedEdge.sourceLabel).toBe(outside.label);
    expect(carriedEdge.sourceLabel).toBe(outside.label);
    reviseMapText(project, 'graph', 'edges', edge.id, 'funds');
    expect(carriedEdge.verb).toBe('funds');
    expect(rekeyedEdge.verb).toBe('sets rules for');
  });

  it('validates text against the item level', () => {
    const nodes = buildEastHarlemDisabilityProject().graph.nodes;
    expect(nodeLabelIssue('', nodes[0], nodes)).toMatch(/1–200/);
    expect(nodeLabelIssue('Adult Participants face delays when the Accessible Van Program is unavailable', nodes[2], nodes)).not.toBe('');
    expect(nodeLabelIssue('Regional Mobility Scheduling Office', nodes.find(item => item.scale === 'macrosphere'), nodes)).not.toBe('');
    expect(relationshipIssue('   '.trim(), { scale: 'micro' })).not.toBe('');
    expect(relationshipIssue('x'.repeat(101), { scale: 'micro' })).not.toBe('');
    expect(relationshipIssue('sets rules for', { scale: 'exosphere' })).toBe('');
    expect(relationshipIssue('laughs with', { scale: 'exosphere' })).not.toBe('');
    expect(relationshipIssue('supports', { scale: 'meso' })).toBe('');
    expect(relationshipIssue('supports', { scale: 'macrosphere' })).not.toBe('');
  });

  it('revises Meso wording while preserving arrow direction, evidence, and saved endpoint IDs', () => {
    const project = buildEastHarlemDisabilityProject();
    const edge = project.graph.edges.find(item => item.scale === 'meso');
    edge.relationshipProcess = createRelationshipProcess({ direction: 'both directions' });
    project.candidates = structuredClone(project.graph);
    const before = structuredClone(edge);
    const wording = 'exchanges information with';
    expect(relationshipIssue(wording, edge)).toBe('');
    reviseMapText(project, 'graph', 'edges', edge.id, wording);
    const saved = parseProject(serializeProject(project));
    expect(saved.graph.edges.find(item => item.id === edge.id)).toEqual({ ...before, verb: wording });
    expect(saved.candidates.edges.find(item => item.id === edge.id)).toEqual({ ...before, verb: wording });
  });
});
