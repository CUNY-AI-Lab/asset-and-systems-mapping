import { expect, it } from 'vitest';
import { MACRO_CONDITION_TYPES, MACRO_PASS_INSTRUCTION, nodeSubmissionInstruction, submittedReviewIssue } from './node-submission.js';

const review = nodes => ({ guidance: [], nodes, connections: [], example: null, readiness: { ready: true, note: 'Nodes identified.' } });
const exo = (label, evidence) => ({ label, evidence, type: 'organization', scale: 'exosphere', basis: 'memo' });
const names = ['Teaching and Learning Center', 'American Social History Project / Center for Media and Learning'];
const indirect = label => `Students do not participate in ${label} allocation decisions, which limit access to their course chat.`;
const administrators = 'CUNY AI Lab is jointly administered by Graduate Center Digital Initiatives, the Teaching and Learning Center, the Mina Rees Library, and the American Social History Project / Center for Media and Learning.';
// This is the expanded memo's explicit limit, not evidence of nonparticipation.
const unknown = "It does not establish whether a particular student participates in any of those units, so their names alone cannot establish that student's direct or indirect relationship to an office.";

it.each(names)('recognizes the source-named institution %s and still requires its indirect participation chain', label => {
  const evidence = indirect(label);
  expect(submittedReviewIssue(review([exo(label, evidence)]), 'exosphere', evidence)).toBeNull();
});

it.each(names)('places %s at Exo when the expanded memo describes no student participation in it', label => {
  expect(submittedReviewIssue(review([exo(label, administrators)]), 'exosphere', `${administrators} ${unknown}`)).toBeNull();
});

it.each(names)('rejects direct participation in %s even when a separate excerpt describes indirect decisions', label => {
  const evidence = indirect(label);
  const source = `${evidence} Students attend ${label} allocation meetings.`;
  expect(submittedReviewIssue(review([exo(label, evidence)]), 'exosphere', source)).toMatch(/participants taking part/);
});

it.each(names)('requires %s in the narrative, not only in a bibliography or generated quote', label => {
  const evidence = indirect(label);
  const source = `Students use the course chat.\n\nReferences\n${label}. (2026). Annual report.`;
  expect(submittedReviewIssue(review([exo(label, evidence)]), 'exosphere', source)).toBeTruthy();
  expect(submittedReviewIssue(review([exo(label, evidence)]), 'exosphere', 'Students use the course chat.')).toMatch(/not a named institution/);
});

it.each(['government', 'institutions', 'community center'])('keeps generic outside labels unsupported: %s', label => {
  const evidence = indirect(label);
  expect(submittedReviewIssue(review([exo(label, evidence)]), 'exosphere', evidence)).toMatch(/not a named institution/);
});

it('reads accepted institution names from the saved quotation when replaying a review', () => {
  const node = exo(names[0], indirect(names[0]));
  expect(submittedReviewIssue(review([node]), 'exosphere')).toBeNull();
});

it('preserves an existing student identity during evidence updates', () => {
  const node = { ...exo(names[0], administrators), existingId: 'student-owned-node' };
  const context = { passages: [{ text: administrators }], existingNodes: [{ id: node.existingId, label: node.label, type: node.type, scale: node.scale, removed: false }] };
  expect(submittedReviewIssue(review([node]), 'exosphere', administrators, context)).toBeNull();
});

it('extracts separate Micro participants and a noun resource while rejecting their combined role or action', () => {
  const evidence = 'CUNY students use the Sandbox. CUNY instructors prepare course configurations.';
  const node = label => ({ label, evidence, scale: 'micro', type: 'group' });
  for (const label of ['CUNY students', 'CUNY instructors', 'Sandbox', 'course configurations']) {
    expect(submittedReviewIssue(review([node(label)]), 'micro', evidence)).toBeNull();
  }
  for (const label of ['CUNY students and instructors', 'CUNY students use the Sandbox']) {
    expect(submittedReviewIssue(review([node(label)]), 'micro', evidence)).toMatch(/\.label /);
  }
});

it.each(['micro', 'exosphere'])('asks for source-grounded noun extraction and explicit uncertainty at %s', scale => {
  const prompt = nodeSubmissionInstruction(scale);
  expect(prompt).toContain('each supported noun phrase is its own label');
  expect(prompt).toContain('Place that institution at Exo unless the source describes the focal participants taking part in it');
  expect(prompt).toContain('existingId entries must preserve its exact identity');
});

it('distinguishes an administrator with no described participation from a separately established access rule in the second memo prompt', () => {
  const prompt = nodeSubmissionInstruction('exosphere');
  expect(prompt).toContain('participation in an office is unknown, omit that office as an automatic Exo node');
  expect(prompt).toContain('an Exo policy node may quote that exact passage');
  expect(nodeSubmissionInstruction('micro')).not.toContain('SECOND MEMO EVIDENCE');
});

it('states its rules without worked examples, so no one field or memo shapes the answer', () => {
  for (const scale of ['micro', 'exosphere']) {
    // `example: null` is a field of the answer format, not a worked example.
    const prompt = nodeSubmissionInstruction(scale);
    expect(prompt).not.toMatch(/\bsuch as\b|\bfor example\b|\bexamples?:(?! null)|\bcounterexamples?:|\be\.g\.|if a memo says/i);
  }
  // The Macro pass is held to the same rule and takes its kinds from the type constant.
  expect(MACRO_PASS_INSTRUCTION).not.toMatch(/\bsuch as\b|\bfor example\b|\bexamples?:|\bcounterexamples?:|\be\.g\.|if a memo says/i);
  expect(MACRO_PASS_INSTRUCTION).toContain(MACRO_CONDITION_TYPES.join(', '));
});

it('places the narrative-named Eco Impact Estimator repository at Exo', () => {
  const label = 'Eco Impact Estimator repository';
  const evidence = "The organization's Eco Impact Estimator repository documents another administrative dependency behind the immediate interface.";
  expect(submittedReviewIssue(review([exo(label, evidence)]), 'exosphere', evidence)).toBeNull();
});

it.each(['Eco Impact Estimator repository', 'Regional Model Registry'])('recognizes a specifically named source repository or registry with complete proof: %s', label => {
  const evidence = `Students do not participate in ${label} allocation decisions, which limit access to their course chat.`;
  expect(submittedReviewIssue(review([exo(label, evidence)]), 'exosphere', evidence)).toBeNull();
  expect(submittedReviewIssue(review([exo(label, evidence)]), 'exosphere', 'Students use a course chat.')).toMatch(/not a named institution/);
});

it.each(['repository', 'model registry', 'public model registry', 'shared code repository'])('rejects a generic repository or registry without a proper source qualifier: %s', label => {
  const evidence = indirect(label);
  expect(submittedReviewIssue(review([exo(label, evidence)]), 'exosphere', evidence)).toMatch(/not a named institution/);
});

it('prioritizes supported Exo nodes and allows a standalone operative policy', () => {
  const prompt = nodeSubmissionInstruction('exosphere');
  expect(prompt).toContain('include every supported new Exo node');
  expect(prompt).not.toMatch(/one to three|at most 3 at each level/);
  expect(prompt).toContain('A single evidenced operative policy can stand alone');
  expect(prompt).toContain('omit such an item when the memo describes no decision or effect, rather than changing its type');
  expect(prompt).toContain('A named office that decides something affecting the local setting is Exo');
});
