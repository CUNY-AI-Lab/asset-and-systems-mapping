import { expect, it } from 'vitest';
import { createDefaultProject } from '../src/domain.js';
import { appendSubmittedNodes } from '../src/memoWorkflow.js';
import { createMemoContractRepair } from '../server/memo-contract-repair.js';
import { nodeSubmissionInstruction, submittedReviewIssue, SUBMISSION_SUBJECT_ISSUE } from './node-submission.js';

const wrap = nodes => ({ guidance: [], nodes, connections: [], example: null, readiness: { ready: true, note: 'Nodes identified.' } });
// Regression labels from live acceptance, with synthetic source sentences only.
const bundles = [
  ['Academic support centers (ABCMath, New York Tutoring Center)', 'service'],
  ['Principals/Assistant Principals', 'group'],
  ['The Door Bronx Youth Center counselors/caseworkers', 'group'],
];
const nodeFor = (label, type = 'group') => ({ label, type, scale: 'micro', evidence: `In this synthetic example, the memo names ${label}.` });

it.each(bundles)('rejects a new bundled subject and carries its exact label into bounded repair: %s', (label, type) => {
  const node = nodeFor(label, type), response = wrap([node]), before = structuredClone(response);
  const issue = submittedReviewIssue(response, 'micro', node.evidence);
  expect(issue).toBe(`nodes[0].label ${SUBMISSION_SUBJECT_ISSUE}`);
  expect(createMemoContractRepair(response, issue, 'micro')).toEqual({ path: 'nodes[0].label', value: label });
  expect(response).toEqual(before);
});

it.each([
  ['Parents/guardians', 'group'],
  ['Black and Latino residents', 'group'],
  ['Centralized School Response Clinicians (CSRCs)', 'group'],
  ['University of California, Berkeley', 'organization'],
  ['The Door Bronx Youth Center (Bronx)', 'organization'],
  ['Academic support centers (Flushing, Queens)', 'service'],
  ['School Counselors/Caseworkers Association', 'organization'],
  ['Case workers/caseworkers', 'role'],
  ['ABCMath', 'organization'],
  ['New York Tutoring Center', 'organization'],
])('keeps a single population, official name, alias or locality qualifier valid: %s', (label, type) => {
  const node = nodeFor(label, type);
  expect(submittedReviewIssue(wrap([node]), 'micro', node.evidence)).toBeNull();
});

it.each(bundles)('keeps earlier stored reviews and exact student identity echoes readable: %s', (label, type) => {
  const node = nodeFor(label, type);
  expect(submittedReviewIssue(wrap([node]), 'micro')).toBeNull();
  const existing = { ...node, existingId: 'saved-subject' };
  const context = { passages: [{ text: node.evidence }], existingNodes: [{ id: existing.existingId, label, type, scale: 'micro', removed: false }] };
  expect(submittedReviewIssue(wrap([existing]), 'micro', node.evidence, context)).toBeNull();
});

it('rejects the whole proposed transaction without changing graph, memo baseline or manual records', () => {
  const project = createDefaultProject();
  project.graph = { nodes: [], edges: [] }; project.candidates = { nodes: [], edges: [] };
  const residents = nodeFor('Residents');
  project.submission.text = residents.evidence;
  appendSubmittedNodes(project, wrap([residents]));
  Object.assign(project.graph.nodes[0], { label: 'Resident group', color: 'purple', notes: 'Keep this wording.', x: 123, y: 456 });
  const bundled = nodeFor(...bundles[0]), newNode = nodeFor('Teachers', 'role');
  project.submission.text += `\n${newNode.evidence}\n${bundled.evidence}`;
  const before = structuredClone(project);
  expect(() => appendSubmittedNodes(project, wrap([newNode, bundled]))).toThrow(/one supported subject/);
  expect(project).toEqual(before);
});

it('keeps the same subject restriction in initial and corrective prompts without rewriting existing nodes', () => {
  for (const scale of ['micro', 'exosphere']) {
    const instruction = nodeSubmissionInstruction(scale, { existingNodes: [] });
    expect(instruction).toContain('ONE SUBJECT PER NEW NODE');
    expect(instruction).toContain('return separate nodes with their own evidence');
    expect(instruction).toContain('Do not invent an umbrella name');
    expect(instruction).toContain('Never split or rename an existing student node');
  }
});
