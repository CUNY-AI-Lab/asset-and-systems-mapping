import { expect, it } from 'vitest';
import { nodeSubmissionInstruction, nodeSubmissionSchema, submittedReviewIssue, SUBMISSION_MACRO_ISSUE } from './node-submission.js';
import { createMemoContractRepair } from '../server/memo-contract-repair.js';

const wrap = nodes => ({ guidance: [], nodes, connections: [], example: null, readiness: { ready: true, note: 'Nodes identified.' } });
const policy = { label: 'Referral consent protocol', type: 'policy', scale: 'exosphere', basis: 'memo', evidence: 'Referral consent protocol requires permission before advisers share learners’ records with a care service.' };

it.each([
  'Instructors apply for course access; the Lab reviews requests against capacity and the proposed teaching activity. Approval enables an invitation link, which students use with CUNY Login.',
  'The coordinator reviews course applications. Approval activates account access for students.',
  'After application review, approval unlocks class access.',
  'Approval enables an invitation link following the request review.',
  'Course applications are reviewed by the coordinator. Approval enables program access.',
])('accepts the documented review-to-approval access operation: %s', evidence => {
  const node = { ...policy, label: 'Class-access approval policy', evidence };
  expect(submittedReviewIssue(wrap([node]), 'exosphere', evidence)).toBeNull();
});

it.each([
  'Approval is discussed.',
  'Approval enables class access.',
  'The coordinator reviews applications. Chat enables learning.',
  'The coordinator reviews applications. Approval enables better outcomes.',
  'Applications are discussed. Approval enables an invitation link.',
  'The coordinator reviews applications. Approval could enable account access.',
  'The coordinator reviews applications. We hope approval enables account access.',
])('withholds vague approval or unrelated enabling prose: %s', evidence => {
  const node = { ...policy, label: 'Class-access approval policy', evidence };
  expect(submittedReviewIssue(wrap([node]), 'exosphere', evidence)).toBeTruthy();
});

it('classifies the operative policy at Exo without inventing nonparticipation in a policy', () => {
  expect(submittedReviewIssue(wrap([policy]), 'exosphere', policy.evidence)).toBeNull();
});

it.each([
  ['Class access duration', 'Class access lasts for approved course dates.'],
  ['Application review requirement', 'Access depends on an application review.'],
  ['Undergraduate class access', 'Undergraduates currently enter through approved classes rather than individual applications.'],
])('recognizes the operative access condition in factual public-facing prose: %s', (label, evidence) => {
  expect(submittedReviewIssue(wrap([{ ...policy, label, evidence }]), 'exosphere', evidence)).toBeNull();
});

it.each([
  'Access to a class is discussed.',
  'Class access should last for approved course dates.',
  'Could access depend on an application review?',
  'We recommend that access depends on an application review.',
])('does not turn an access mention, question or recommendation into an established rule: %s', evidence => {
  expect(submittedReviewIssue(wrap([{ ...policy, label: 'Class access conditions', evidence }]), 'exosphere', evidence)).toBeTruthy();
});

it.each([
  ['workshop account access policy', 'A hypothetical workshop account access policy determines the authorization that the office applies before Nia can use the Sandbox.'],
  ['course approval rule', "A hypothetical course approval rule determines whether the facilitator can arrange Sandbox access for the workshop's peer review circle."],
])('accepts the specific authorization operation in the illustrative Lab policy: %s', (label, evidence) => {
  expect(submittedReviewIssue(wrap([{ ...policy, label, evidence }]), 'exosphere', evidence)).toBeNull();
});

it.each(['policy', 'structure', 'culture', 'belief'])('rejects a policy mislabeled as Macro/%s and supports bounded repair', type => {
  const node = { ...policy, type, scale: 'macrosphere' };
  const issue = submittedReviewIssue(wrap([node]), 'exosphere', node.evidence);
  expect(issue).toBe(`nodes[0].label ${SUBMISSION_MACRO_ISSUE}`);
  expect(createMemoContractRepair(wrap([node]), issue, 'exosphere')).toEqual({ path: 'nodes[0].label', value: policy.label });
});

it.each([
  ['Mental-health stigma', 'culture', 'Mental-health stigma is a cultural pattern that associates seeking care with weakness and deters learners from meeting advisers.'],
  ['Individual self-reliance', 'belief', 'Families describe an enduring belief in individual self-reliance that discourages learners from requesting support.'],
  ['Unequal neighborhood investment', 'structure', 'Unequal neighborhood investment has concentrated care resources in wealthy areas, limiting learners’ access elsewhere.'],
])('retains the independently evidenced Macro condition %s', (label, type, evidence) => {
  expect(submittedReviewIssue(wrap([{ label, type, evidence, scale: 'macrosphere', basis: 'memo' }]), 'exosphere', evidence)).toBeNull();
});

it.each(['We should adopt a referral consent protocol.', 'What policy would help learners?', 'A policy is mentioned.'])('withholds unestablished policy evidence: %s', evidence => {
  expect(submittedReviewIssue(wrap([{ ...policy, evidence }]), 'exosphere', evidence)).toBeTruthy();
  expect(submittedReviewIssue(wrap([]), 'exosphere', evidence)).toBeNull();
});

it('preserves stored Macro policies and exact existing identity updates without silently moving them', () => {
  const old = { ...policy, scale: 'macrosphere' };
  expect(submittedReviewIssue(wrap([old]), 'exosphere')).toBeNull();
  const context = { passages: [{ text: old.evidence }], existingNodes: [{ ...old, id: 'saved-policy' }] };
  const update = { ...old, existingId: 'saved-policy' };
  const before = structuredClone(context);
  expect(submittedReviewIssue(wrap([update]), 'exosphere', old.evidence, context)).toBeNull();
  expect(context).toEqual(before);
  const variants = nodeSubmissionSchema('exosphere', 0, context).properties.nodes.items.oneOf;
  expect(variants[0].properties.type.enum).toContain('policy');
  expect(variants[1].properties.type.enum).not.toContain('policy');
  expect(variants[2].properties.existingId.enum).toEqual(['saved-policy']);
});

it('carries the same corrected course convention into initial and incremental prompts', () => {
  for (const update of [undefined, { existingNodes: [] }]) {
    const prompt = nodeSubmissionInstruction('exosphere', update);
    expect(prompt).toContain('Policies and offices are Exo, not Macro');
    expect(prompt).toContain('Never disguise a policy as type structure or belief');
    expect(prompt).toContain('never infer that pattern from the policy alone');
    expect(prompt).not.toContain('A policy is ALWAYS macrosphere');
    expect(prompt).toContain('Students decide and draw ALL relationships');
  }
});

it('requires the operation to be established in the quoted passage that describes it', () => {
  const label = 'Picking permission rule';
  const check = evidence => submittedReviewIssue(wrap([{ ...policy, label, evidence }]), 'exosphere', evidence);
  expect(check('The orchard opens in June. We should require permission for picking.')).toBeTruthy();
  expect(check('Does picking require permission? The orchard opens in June.')).toBeTruthy();
  expect(check('Picking requires permission. We should change the hours.')).toBeNull();
});
