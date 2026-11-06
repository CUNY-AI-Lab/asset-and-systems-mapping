import { expect, it } from 'vitest';
import { nodeSubmissionInstruction, submittedReviewIssue } from './node-submission.js';

const office = 'Northside Housing Office';
const wrap = nodes => ({ guidance: [], nodes, connections: [], example: null, readiness: { ready: true, note: 'Nodes identified.' } });
const micro = evidence => ({ label: office, type: 'institution', scale: 'micro', evidence });
const exo = evidence => ({ label: office, type: 'institution', scale: 'exosphere', basis: 'memo', evidence });
const direct = 'Residents meet staff at Northside Housing Office every week to discuss repairs in their own buildings.';
const indirect = 'Residents do not participate in Northside Housing Office allocation decisions, which delay repairs in their buildings.';

it('uses the same office name as Micro for direct participation and Exo only for a quoted indirect chain', () => {
  expect(submittedReviewIssue(wrap([micro(direct)]), 'micro', direct)).toBeNull();
  expect(submittedReviewIssue(wrap([exo(direct)]), 'exosphere', direct)).toMatch(/participants taking part/);
  expect(submittedReviewIssue(wrap([exo(indirect)]), 'exosphere', indirect)).toBeNull();
  expect(submittedReviewIssue(wrap([micro(indirect)]), 'micro', indirect)).toMatch(/outside decision setting/);
});

it.each([
  'Northside Housing Office is mentioned in the memo.',
  'Northside Housing Office allocates repair staff.',
  'Residents do not participate in Northside Housing Office meetings.',
  'Northside Housing Office allocation decisions delay repairs in residents’ buildings.',
])('places a named office with no described participation at Exo: %s', evidence => {
  expect(submittedReviewIssue(wrap([exo(evidence)]), 'exosphere', evidence)).toBeNull();
});

it('does not confuse a staff-only meeting with focal participation', () => {
  const evidence = 'Northside Housing Office holds staff-only meetings to allocate contractors; its decisions delay repairs in residents’ buildings.';
  expect(submittedReviewIssue(wrap([exo(evidence)]), 'exosphere', evidence)).toBeNull();
});

it('rejects a contrary resident board role even when the model selects only the indirect sentence', () => {
  const text = indirect + ' One resident also serves as a voting member of Northside Housing Office allocation board.';
  expect(submittedReviewIssue(wrap([exo(indirect)]), 'exosphere', text)).toMatch(/participants taking part/);
});

it('respects an explicit negative statement about resident participation without changing its words', () => {
  const evidence = 'Residents never attend Northside Housing Office budget meetings, whose funding decisions delay building repairs.';
  expect(submittedReviewIssue(wrap([exo(evidence)]), 'exosphere', evidence)).toBeNull();
  expect(submittedReviewIssue(wrap([exo(evidence.replace('never ', ''))]), 'exosphere', evidence)).toBeTruthy();
});

it('places a policy at Exo separately from its administering office', () => {
  const evidence = 'The Regional Housing Finance Rule governs repair eligibility across many buildings.';
  expect(submittedReviewIssue(wrap([{ label: 'Regional Housing Finance Rule', type: 'policy', scale: 'exosphere', basis: 'memo', evidence }]), 'exosphere', evidence)).toBeNull();
  expect(submittedReviewIssue(wrap([{ ...exo(indirect), scale: 'macrosphere', type: 'policy' }]), 'exosphere', indirect)).toMatch(/person or institution/);
});

it('requests a source-grounded explanation through the bounded evidence field, never an extra suggestion queue', () => {
  const prompt = nodeSubmissionInstruction('exosphere');
  expect(prompt).toContain('CLASSIFICATION PROOF');
  expect(prompt).toContain('The concise evidence quote is the classification explanation');
  expect(prompt).toContain('return no separate commentary');
  expect(submittedReviewIssue(wrap([]), 'exosphere', 'A housing office is mentioned.')).toBeNull();
});

it('reads stored node-only evaluations and live submissions of a named outside agency alike', () => {
  const node = { label: 'City Housing Authority', type: 'agency', scale: 'exosphere', basis: 'memo', evidence: 'City Housing Authority allocates repair staff.' };
  expect(submittedReviewIssue(wrap([node]), 'exosphere')).toBeNull();
  expect(submittedReviewIssue(wrap([node]), 'exosphere', node.evidence)).toBeNull();
});

it.each([
  'Residents do not participate in school board decisions. Northside Housing Office allocates funding, which delays repairs in their buildings.',
  'Residents do not participate in school board decisions; Northside Housing Office allocates funding, which delays repairs in their buildings.',
  'Residents do not participate in school board decisions, while Northside Housing Office allocates funding, which delays repairs in their buildings.',
])('places a named office at Exo beside another setting’s nonparticipation: %s', evidence => {
  expect(submittedReviewIssue(wrap([exo(evidence)]), 'exosphere', evidence)).toBeNull();
});

it.each(['These decisions delay repairs in their buildings.', 'Northside Housing Office allocates repair staff, affecting repair visits to residents at home.'])('allows the same named setting’s directly following consequence: %s', consequence => {
  const evidence = `Residents do not participate in Northside Housing Office allocation decisions. ${consequence}`;
  expect(submittedReviewIssue(wrap([exo(evidence)]), 'exosphere', evidence)).toBeNull();
});

const labOffice = 'Lab account administration office';
const labEvidence = 'A hypothetical Lab account administration office decides whether workshop accounts can use the Sandbox. Nia does not work in or attend this office.';
const labSource = `The focal participant is still Nia from the first memo. ${labEvidence}`;
const labNode = { label: labOffice, type: 'organization', scale: 'exosphere', basis: 'memo', evidence: labEvidence };

it('accepts a source-named functional office and an explicitly identified focal person across adjacent sentences', () => {
  expect(submittedReviewIssue(wrap([labNode]), 'exosphere', labSource)).toBeNull();
  expect(submittedReviewIssue(wrap([labNode]), 'exosphere')).toBeNull();
});

it.each([
  labEvidence,
  `The focal participant is still Nia. A hypothetical Lab account administration office is mentioned. Nia does not work in or attend this office.`,
  `The focal participant is still Nia. A hypothetical Lab account administration office refers decisions to the school board. Nia does not attend this board.`,
])('places a source-named office at Exo when no participation in it is described', source => {
  const evidence = source.replace(/^The focal participant is still Nia\.\s*/u, '');
  expect(submittedReviewIssue(wrap([{ ...labNode, evidence }]), 'exosphere', source)).toBeNull();
});

it('withholds a source-named office when the named focal person takes part in it', () => {
  const source = `The focal participant is still Nia. ${labEvidence} Nia also attends Lab account administration office meetings.`;
  const evidence = source.replace(/^The focal participant is still Nia\.\s*/u, '');
  expect(submittedReviewIssue(wrap([{ ...labNode, evidence }]), 'exosphere', source)).toMatch(/taking part/);
});

it('does not accept an invented functional office name from a generic mention', () => {
  const node = { ...labNode, evidence: 'An office decides access.' };
  expect(submittedReviewIssue(wrap([node]), 'exosphere', node.evidence)).toMatch(/not a named institution/);
});

it('distinguishes another office from a reference to the same outside setting', () => {
  const node = { ...exo(''), label: 'Harbor Allocation Board', evidence: 'Students do not participate in Harbor Allocation Board decisions, which limit their workshop hours.' };
  const check = continuation => submittedReviewIssue(wrap([node]), 'exosphere', node.evidence + ' ' + continuation);
  expect(check('Students visit the housing office.')).toBeNull();
  expect(check('Students attend this board.')).toMatch(/taking part/);
  expect(check('A campus office convenes a different board. Students attend this board.')).toBeNull();
});

it.each(['Apprentices', '学徒', 'A.J.'])('uses the retained Micro participant %s as context for a second-memo quotation', label => {
  const evidence = `${label} do not participate in Northside Housing Office decisions, which limit their workshop hours.`;
  const carried = { id: 'participant', label, type: 'group', scale: 'micro' };
  const check = (source, map, quote = source) => submittedReviewIssue(wrap([exo(quote)]), 'exosphere', source, undefined, [map]);
  expect(check(evidence, carried)).toBeNull();
  expect(check(evidence, { ...carried, type: 'object' })).toBeNull();
  expect(check('Decisions are discussed.', carried, evidence)).toBeTruthy();
  expect(check(`${label} visit Northside Housing Office.`, carried)).toBeTruthy();
  expect(check(`${label} are mentioned alongside Northside Housing Office.`, carried)).toBeNull();
});
