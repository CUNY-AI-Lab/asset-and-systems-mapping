import { expect, it } from 'vitest';
import { nodeSubmissionInstruction, nodeSubmissionSchema, submittedReviewIssue, SUBMISSION_MACRO_ISSUE } from './node-submission.js';
import { createMemoContractRepair } from '../server/memo-contract-repair.js';

const wrap = nodes => ({ guidance: [], nodes, connections: [], example: null, readiness: { ready: true, note: 'Nodes identified.' } });
const policy = { label: 'Referral consent protocol', type: 'policy', scale: 'exosphere', basis: 'memo', evidence: 'Referral consent protocol requires permission before advisers share learners’ records with a care service.' };

it('classifies the operative policy at Exo without inventing nonparticipation in a policy', () => {
  expect(submittedReviewIssue(wrap([policy]), 'exosphere', policy.evidence)).toBeNull();
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
