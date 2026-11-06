import { expect, it } from 'vitest';
import { nodeSubmissionInstruction, submittedReviewIssue } from './node-submission.js';

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

it.each(names)('recognizes %s in the expanded memo but withholds classification where participation is unknown', label => {
  expect(submittedReviewIssue(review([exo(label, administrators)]), 'exosphere', `${administrators} ${unknown}`)).toMatch(/\.evidence .*nonparticipation/);
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
  expect(prompt).toContain('supported noun labels include Students, Instructors, Course chat and Course configurations');
  expect(prompt).toContain('If the source leaves participation in that institution unknown, omit the automatic Exo setting');
  expect(prompt).toContain('existingId entries must preserve its exact identity');
});

it('distinguishes unknown administrator participation from a separately established access rule in the second memo prompt', () => {
  const prompt = nodeSubmissionInstruction('exosphere');
  expect(prompt).toContain('omit Access Board as an automatic Exo node');
  expect(prompt).toContain('an Exo policy named Course access approval rule may use that exact passage');
  expect(nodeSubmissionInstruction('micro')).not.toContain('SECOND MEMO EVIDENCE EXAMPLE');
});

it('recognizes the narrative-named Eco Impact Estimator repository without inferring its participation chain', () => {
  const label = 'Eco Impact Estimator repository';
  const evidence = "The organization's Eco Impact Estimator repository documents another administrative dependency behind the immediate interface.";
  expect(submittedReviewIssue(review([exo(label, evidence)]), 'exosphere', evidence)).toMatch(/\.evidence .*nonparticipation/);
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
  expect(prompt).toContain('choose only the strongest one to three supported new Exo nodes');
  expect(prompt).toContain('A single evidenced operative policy can stand alone');
  expect(prompt).toContain('Omit unsupported repositories, registries and administrators rather than changing their type');
});
