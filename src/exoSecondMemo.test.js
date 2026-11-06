import { expect, it } from 'vitest';
import { createDefaultProject, validateProject } from './domain.js';
import { appendSubmittedNodes, memoUpdateState } from './memoWorkflow.js';
import { submittedReviewIssue } from '../shared/node-submission.js';
import { canConnectAtScale } from '../shared/mapping-grammar.js';
import { relationshipGroupIssue } from '../shared/relationship-groups.js';

// Reproduction of the production failure of 6 November 2026 (release e43d9ae):
// a second memo written in ordinary prose added nothing at Exo, because every
// outside office without a quoted nonparticipation chain was rejected.
const review = nodes => ({ guidance: [], nodes, connections: [], example: null, readiness: { ready: true, note: 'Nodes identified.' } });
const first = 'Tenants meet the building manager in the lobby every week.';
const second = 'The District Housing Office sets the repair budget for our building. The Riverside Community Foundation funds the after-school program.';
const exo = (label, type, evidence) => ({ label, type, scale: 'exosphere', basis: 'memo', evidence });
const offices = [
  exo('District Housing Office', 'agency', 'The District Housing Office sets the repair budget for our building.'),
  exo('Riverside Community Foundation', 'organization', 'The Riverside Community Foundation funds the after-school program.'),
];

function mapAfterFirstMemo() {
  const project = createDefaultProject();
  project.activeScale = 'micro';
  project.submission.text = first;
  appendSubmittedNodes(project, review([
    { label: 'Tenants', type: 'group', scale: 'micro', evidence: first },
    { label: 'Building manager', type: 'role', scale: 'micro', evidence: first },
  ]));
  return project;
}

it('adds outside offices from an ordinary second memo to the map at Exo', () => {
  const project = mapAfterFirstMemo();
  const earlier = structuredClone(project.graph.nodes);
  project.activeScale = 'exosphere';
  project.part2Submission = { ...structuredClone(project.submission), id: 'submission-part2-test', text: second };
  delete project.part2Submission.analysis;
  const carried = project.graph.nodes.map(({ id, label, type, scale }) => ({ id, label, type, scale }));
  expect(submittedReviewIssue(review(offices), 'exosphere', second, undefined, carried)).toBeNull();
  expect(appendSubmittedNodes(project, review(offices))).toBe(2);
  validateProject(project);
  expect(project.graph.nodes.filter(node => node.scale === 'exosphere').map(node => node.label)).toEqual(offices.map(node => node.label));
  // Earlier Micro work is carried forward unchanged.
  expect(project.graph.nodes.slice(0, earlier.length)).toEqual(earlier);
  expect(memoUpdateState(project).submitted).toBe(true);
});

it('still withholds an office the focal participants take part in, with a reason', () => {
  const source = `${second} Tenants attend District Housing Office meetings.`;
  expect(submittedReviewIssue(review(offices), 'exosphere', source)).toMatch(/nodes\[0\]\.evidence describes focal participants taking part/);
});

it('keeps earlier Micro nodes and Meso relationships available as connection targets at Exo and Macro', () => {
  const project = mapAfterFirstMemo();
  const [tenants, manager] = project.graph.nodes;
  for (const scale of ['meso', 'exosphere', 'macrosphere']) {
    expect(canConnectAtScale(scale, tenants)).toBe(true);
    expect(canConnectAtScale(scale, manager)).toBe(true);
  }
  const meso = { id: 'edge-local', source: tenants.id, target: manager.id, scale: 'meso', status: 'confirmed', claimState: 'inference' };
  const office = { id: 'node-office', label: 'District Housing Office', type: 'agency', scale: 'exosphere', status: 'confirmed', claimState: 'inference' };
  const condition = { id: 'node-condition', label: 'Housing disinvestment', type: 'economic condition', scale: 'macrosphere', status: 'confirmed', claimState: 'inference' };
  const nodes = [...project.graph.nodes, office, condition];
  expect(relationshipGroupIssue({ source: office.id, target: tenants.id, relationshipIds: [meso.id] }, nodes, [meso], 'exosphere')).toBeNull();
  expect(relationshipGroupIssue({ source: condition.id, target: manager.id, relationshipIds: [meso.id] }, nodes, [meso], 'macrosphere')).toBeNull();
});
