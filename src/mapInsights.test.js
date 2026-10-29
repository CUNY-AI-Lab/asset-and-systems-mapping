import { describe, expect, it } from 'vitest';
import { describeMapConnection, indexMapConnections, needsEvidenceReview, summarizeMap } from './mapInsights.js';
import { buildEastHarlemDisabilityProject } from '../tests/e2e/fixtures/east-harlem-disability-project.js';

describe('recorded connections across levels', () => {
  it('indexes incoming and outgoing scopes, memberships, and relationships without changing the graph', () => {
    const project = buildEastHarlemDisabilityProject();
    const original = structuredClone(project.graph);
    const index = indexMapConnections(project.graph);
    const home = project.graph.nodes.find((node) => node.label === 'Apartment building');
    const connections = index.byNode.get(home.id).map((link) => describeMapConnection(link, home.id, index.nodeById));
    expect(connections.map((item) => item.group)).toEqual(expect.arrayContaining(['Part of mesosystems', 'Broader conditions', 'People and elements in this setting']));
    expect(connections.find((item) => item.group === 'Broader conditions')).toMatchObject({ kind: 'node', label: 'State home care reimbursement policy' });
    expect(index.links.filter((link) => link.kind === 'relationship')).toHaveLength(5);
    expect(project.graph).toEqual(original);
  });

  it('ignores removed nodes, removed edges, broken endpoints, and duplicate scope members', () => {
    const project = buildEastHarlemDisabilityProject();
    const macro = project.graph.nodes.find((node) => node.scale === 'macrosphere');
    macro.scopeNodeIds.push(macro.scopeNodeIds[0], 'missing-node');
    project.graph.nodes.find((node) => node.label === 'Home attendant').claimState = 'retired';
    project.graph.edges.find((edge) => edge.scale === 'exosphere').status = 'rejected';
    const index = indexMapConnections(project.graph);
    expect(index.links.filter((link) => link.kind === 'condition')).toHaveLength(2);
    expect(index.links.filter((link) => link.kind === 'relationship')).toHaveLength(3);
    expect(index.byNode.has('missing-node')).toBe(false);
  });

  it('summarizes cumulative and level-specific results with evidence review kept separate from map size', () => {
    const project = buildEastHarlemDisabilityProject();
    const resident = project.graph.nodes.find((node) => node.label === 'Resident');
    resident.claimState = 'contested';
    project.candidates.nodes.push({ id: 'pending-question', scale: 'micro', status: 'research lead' });
    const summary = summarizeMap(project);
    expect(summary).toMatchObject({ nodes: 9, relationships: 5, crossLevelLinks: 6, evidenceToReview: 1 });
    expect(summary.levels.find((level) => level.scale === 'micro')).toMatchObject({ nodes: 6, relationships: 0, evidenceToReview: 1, setAside: 1 });
    expect(summary.levels.find((level) => level.scale === 'meso')).toMatchObject({ nodes: 1, relationships: 4, scopeLinks: 2 });
  });

  it('counts additive evidence passages while retaining contested or inferred claims for review', () => {
    const item = { status: 'confirmed', claimState: 'student interpretation', claimEvidence: [{ sourcePassage: 'A recorded passage.' }] };
    expect(needsEvidenceReview(item)).toBe(false);
    expect(needsEvidenceReview({ ...item, claimState: 'inference' })).toBe(true);
    expect(needsEvidenceReview({ ...item, claimState: 'contested' })).toBe(true);
    expect(needsEvidenceReview({ ...item, claimEvidence: [{ interpretation: 'An interpretation without a passage.' }] })).toBe(true);
  });
});
