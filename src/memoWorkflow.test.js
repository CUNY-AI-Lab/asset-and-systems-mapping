import { expect, it } from 'vitest';
import { createDefaultProject, parseProject, serializeProject, validateProject } from './domain.js';
import { appendSubmittedNodes, openMemoWorkflowScale } from './memoWorkflow.js';
import { activeSubmission } from './projectMemo.js';
import { submittedReviewIssue, nodeSubmissionSchema, nodeSubmissionInstruction, EXO_SETTING_TYPES, EXO_NODE_TYPES, MACRO_CONDITION_TYPES } from '../shared/node-submission.js';

const review = nodes => ({ guidance: [], nodes, connections: [], example: null, readiness: { ready: true, note: 'Nodes identified.' } });
const local = { label:'Residents', type:'group', scale:'micro', evidence:'Residents meet in the community room.' };
const outer = [
  { label:'City Housing Authority', type:'agency', scale:'exosphere', basis:'memo', evidence:'Residents do not participate in City Housing Authority allocation decisions, which delay repairs in their buildings.' },
  { label:'Unequal housing investment', type:'structure', scale:'macrosphere', basis:'memo', evidence:'Unequal housing investment delays elevator repairs.' },
];
function blank() {
  const p=createDefaultProject(); p.graph={nodes:[],edges:[]}; p.candidates={nodes:[],edges:[]}; p.preflight=null;
  p.submission.text=local.evidence; p.submission.fileName='first.pdf'; return p;
}
it('adds submitted nodes immediately, without creating relationships or replacing saved work',()=>{
  const p=blank(); appendSubmittedNodes(p,review([local]));
  expect(p.graph.nodes).toHaveLength(1); expect(p.graph.edges).toEqual([]);
  const first=structuredClone(p.graph.nodes[0]); first.x=125;first.y=320;first.notes='Student note';p.graph.nodes[0]=first;
  const memo1=structuredClone(p.submission);
  openMemoWorkflowScale(p,'meso'); p.reflection='Student observation';
  openMemoWorkflowScale(p,'exosphere'); p.part2Submission.text=outer.map(n=>n.evidence).join(' ');p.part2Submission.fileName='second.pdf';
  expect(submittedReviewIssue(review(outer),'exosphere',activeSubmission(p).text)).toBeNull();
  appendSubmittedNodes(p,review(outer));
  expect(p.graph.nodes[0]).toEqual(first);expect(p.submission).toEqual(memo1);expect(p.graph.edges).toEqual([]);
  for(const scale of ['macrosphere','micro','meso','exosphere'])openMemoWorkflowScale(p,scale);
  const restored=parseProject(serializeProject(p));
  expect(restored.submission).toEqual(memo1);expect(restored.part2Submission).toEqual(p.part2Submission);
  expect(restored.graph).toEqual(p.graph);expect(restored.levelProgress.meso.reflection).toBe('Student observation');
  expect(restored.graph.nodes.every(n=>n.status==='confirmed')).toBe(true);
  expect(()=>validateProject(restored)).not.toThrow();
});
it('never maps provider relationships, even when an old auto-add preference is enabled',()=>{
  const p=blank(),before=structuredClone(p);
  expect(()=>appendSubmittedNodes(p,{...review([local]),connections:[{source:'a',target:'b',verb:'supports'}]})).toThrow(/cannot contain relationships/);
  expect(p).toEqual(before);
});
it('does not duplicate nodes on resubmission or revive a student-deleted node',()=>{
  const p=blank();appendSubmittedNodes(p,review([local]));
  p.graph.nodes[0].claimState='retired';p.graph.nodes[0].status='rejected';
  expect(appendSubmittedNodes(p,review([local]))).toBe(0);expect(p.graph.nodes).toHaveLength(1);
});
it('permits manual connections before any field notes are written',()=>{
  const p=blank();for(const scale of ['meso','exosphere','macrosphere']){openMemoWorkflowScale(p,scale);expect(p.activeScale).toBe(scale);expect(p.reflection).toBe('');}
  expect(()=>validateProject(p)).not.toThrow();
});
it.each(['micro', 'exosphere'])('restores an unsubmitted %s memo edit after navigation and reload', scale => {
  let project = blank();
  appendSubmittedNodes(project, review([local]));
  if (scale === 'exosphere') {
    openMemoWorkflowScale(project, scale);
    project.part2Submission.text = outer.map(node => node.evidence).join(' ');
    appendSubmittedNodes(project, review(outer));
  }
  project.stage = 1;
  activeSubmission(project).text += ' This revision has not been submitted.';
  const nextScale = scale === 'micro' ? 'meso' : 'macrosphere';
  openMemoWorkflowScale(project, nextScale);
  project = parseProject(serializeProject(project));
  openMemoWorkflowScale(project, scale);
  expect(project.stage).toBe(1);
  expect(activeSubmission(project).text).toContain('This revision has not been submitted.');
  appendSubmittedNodes(project, review([]));
  openMemoWorkflowScale(project, nextScale);
  openMemoWorkflowScale(project, scale);
  expect(project.stage).toBe(3);
});
it.each([2,3])('returns completed legacy stage %i maps to their node view', stage => {
  const project = blank();
  appendSubmittedNodes(project, review([local]));
  project.stage = stage;
  openMemoWorkflowScale(project, 'meso');
  openMemoWorkflowScale(project, 'micro');
  expect(project.stage).toBe(3);
});
it.each([
  { ...outer[0], scale:'macrosphere', type:'structure' },
  { ...outer[1], evidence:'Invented evidence that does not occur in the memo.' },
  { ...outer[1], scope:['node-a','node-b'] },
])('rejects wrong-level or invented second-memo content',node=>{
  expect(submittedReviewIssue(review([node]),'exosphere',outer.map(n=>n.evidence).join(' '))).toBeTruthy();
});
it('caps the initial set instead of filling the map with suggestions',()=>{
  expect(submittedReviewIssue(review(Array.from({length:11},(_,i)=>({...local,label:`Residents ${i}`}))),'micro',local.evidence)).toMatch(/limit/);
  expect(submittedReviewIssue({...review([]),guidance:[{point:'Try adding more nodes'}]},'micro',local.evidence)).toMatch(/no guidance/);
});

it.each(['government', 'schools', 'big institutions'])('rejects an unspecified Exo setting: %s',label=>{
  const node = {...outer[0], label, evidence: `${label} should help.`};
  expect(submittedReviewIssue(review([node]),'exosphere',node.evidence)).toMatch(/not a named institution/);
});
it('accepts an empty grounded result when Part 2 provides only broad wishes',()=>{
  expect(submittedReviewIssue(review([]),'exosphere','Schools need more funding. Government should help.')).toBeNull();
});

it.each(['government', 'schools', 'big institutions', 'society'])('cannot disguise generic Exo %s as a resource', label => {
  const node = { ...outer[0], label, type: 'resource', evidence: `${label} should help.` };
  expect(submittedReviewIssue(review([node]), 'exosphere', node.evidence)).toMatch(/not a named institution/);
});

it.each(EXO_SETTING_TYPES)('rejects the reported community counselor misclassification under Exo type %s', type => {
  const evidence = 'This fictional protocol requires recorded permission before Centralized School Response Clinicians share a student case with a community counselor.';
  const node = { label: 'Community counselor', type, scale: 'exosphere', basis: 'memo', evidence };
  expect(submittedReviewIssue(review([node]), 'exosphere', evidence)).toBe('nodes[0].label names a person or role, not an outside setting or resource.');
});

it.each([
  ['Guidance counselors', 'Guidance counselors meet with students.'],
  ['Licensed community counselors', 'Licensed community counselors receive referrals.'],
  ['Centralized School Response Clinicians', 'Centralized School Response Clinicians share a student case.'],
  ['Classroom teachers', 'Classroom teachers support students.'],
  ['Rosa Alvarez', 'Rosa Alvarez is a community counselor who receives student referrals.'],
])('does not turn the participant %s into an outside resource', (label, evidence) => {
  const node = { label, type: 'resource', scale: 'exosphere', basis: 'memo', evidence };
  expect(submittedReviewIssue(review([node]), 'exosphere', evidence)).toMatch(/person or role/);
});

it('keeps local roles eligible for Micro and asks Part 2 to omit them without generating relationships', () => {
  const node = { label: 'Community counselor', type: 'role', scale: 'micro', evidence: 'A community counselor meets with students.' };
  expect(submittedReviewIssue(review([node]), 'micro', node.evidence)).toBeNull();
  const instruction = nodeSubmissionInstruction('exosphere');
  expect(instruction).toContain('Omit these local participants from this second-memo output');
  expect(instruction).toContain('return NO links, scopes, memberships or recommendations');
  expect(nodeSubmissionSchema('exosphere').properties.nodes.items.oneOf.map(node => node.properties.scale.enum)).toEqual([['exosphere'], ['macrosphere']]);
});

it('asks a second memo for both levels across every kind of node, with at least one Macro node', () => {
  const instruction = nodeSubmissionInstruction('exosphere');
  expect(instruction).toContain('return BOTH');
  expect(instruction).toContain('MUST include at least one Macro node');
  expect(instruction).not.toContain('in any mix of levels');
  // The kinds come from the level type lists, not from any one memo.
  expect(instruction).toContain(`Exo covers every kind of outside setting, resource or rule the memo evidences: ${EXO_NODE_TYPES.join(', ')}.`);
  expect(instruction).toContain(`Macro covers every kind of broader condition the memo evidences: ${MACRO_CONDITION_TYPES.join(', ')}.`);
  // Every Macro kind is accepted when the memo states the condition.
  const stated = 'Families describe a lasting stigma around asking for help, which shapes who uses the centre.';
  MACRO_CONDITION_TYPES.forEach((type) => {
    expect(submittedReviewIssue(review([{ label: 'Stigma around asking for help', type, scale: 'macrosphere', evidence: stated, basis: 'memo' }]), 'exosphere', stated)).toBeNull();
  });
});

it.each([
  ['District Counseling Office', 'institution', 'Students do not participate in District Counseling Office staffing decisions, which limit counseling in their schools.'],
  ['Community Counselor Referral Service', 'service', 'Families do not participate in Community Counselor Referral Service decisions, which delay care in local clinics.'],
  ['School Counselor Association', 'organization', 'Students do not participate in School Counselor Association training decisions, which change counseling in their schools.'],
  ['School counselor training fund', 'resource', 'Students do not participate in School counselor training fund decisions, which reduce training for counselors in their schools.'],
  ['City Housing Authority', 'agency', 'Residents do not participate in City Housing Authority allocation decisions, which delay repairs in their buildings.'],
])('preserves the specifically identified outside setting or resource %s', (label, type, evidence) => {
  expect(submittedReviewIssue(review([{ label, type, evidence, scale: 'exosphere', basis: 'memo' }]), 'exosphere', evidence)).toBeNull();
});

it.each([
  ['Divya Patel', 'structure', 'Divya Patel teaches social studies at the school.', /person or institution/],
  ['Rosa Alvarez', 'culture', 'Rosa Alvarez is a teacher at the school.', /person or institution/],
  ['school funding policy', 'policy', 'Schools need more funding and the government should help.', /policy or law|established condition/],
  ['Family communication belief', 'belief', 'Families need better communication.', /policy or law|established condition/],
  ['School funding policy', 'policy', 'School funding policy should prioritize families.', /policy or law|established condition/],
  ['School funding policy', 'policy', 'School funding policy should provide more support.', /policy or law|established condition/],
  ['School funding policy', 'policy', 'Schools should receive more support under a proposed School funding policy.', /policy or law|established condition/],
  ['School allocation policy', 'policy', 'What policy governs school allocation?', /policy or law|established condition/],
])('rejects a mislabeled or unestablished Macro condition: %s', (label, type, evidence, issue) => {
  expect(submittedReviewIssue(review([{ label, type, evidence, scale: 'macrosphere', basis: 'memo' }]), 'exosphere', evidence)).toMatch(issue);
});

it.each([
  ['NYC DOE confidentiality policy', 'policy', 'NYC DOE confidentiality policy requires recorded permission before sharing case details.'],
  ['CUNY affordability policy', 'policy', 'CUNY affordability policy provides tuition assistance.'],
  ['Individuals with Disabilities Education Act', 'law', 'Individuals with Disabilities Education Act requires individualized education programs.'],
  ['Divya Patel Act', 'law', 'The fictional Divya Patel Act requires accessible school buildings.'],
  ['Structural Racism', 'structure', 'Structural racism restricts access to housing and education.'],
  ['Per-pupil funding formula', 'policy', 'Funding is allocated per pupil, reducing the allocation when enrollment falls.'],
  ['Respect for elders', 'belief', 'Families believe children should show respect for elders.'],
  ['Unpredictable work schedules', 'economic condition', 'Unpredictable work schedules reduce time available for school meetings.'],
  ['Structural racism', 'structure', 'Structural racism means Black residents need more documentation to obtain housing assistance.'],
  ['Financial insecurity', 'economic condition', 'Financial insecurity means families need more time to pay rent.'],
  ['School confidentiality policy', 'policy', 'Parents should provide written permission under the School confidentiality policy.'],
  ['Community counselor confidentiality protocol', 'policy', 'Community counselor confidentiality protocol requires recorded permission before sharing a student case.'],
])('places grounded policies at Exo and broader conditions at Macro: %s', (label, type, evidence) => {
  const scale = ['policy', 'law'].includes(type) ? 'exosphere' : 'macrosphere';
  const node = { label, type, evidence, scale, basis: 'memo' };
  expect(submittedReviewIssue(review([node]), 'exosphere', evidence)).toBeNull();
  const project = blank(); openMemoWorkflowScale(project, 'exosphere'); project.part2Submission.text = evidence;
  appendSubmittedNodes(project, review([node]));
  const restored = parseProject(serializeProject(project));
  expect(restored.graph.nodes[0]).toMatchObject({ label, type, scale, status: 'confirmed' });
  expect(restored.candidates.nodes[0]).toMatchObject({ label, type, scale });
});

it('keeps the institution itself out of Macro even when submitted with policy type', () => {
  const node = { ...outer[1], label: 'NYC DOE', type: 'policy', evidence: 'NYC DOE administers the confidentiality policy.' };
  expect(submittedReviewIssue(review([node]), 'exosphere', node.evidence)).toMatch(/person or institution/);
});

it('retains a specifically identified outside resource', () => {
  const node = { ...outer[0], label: 'City repair reserve fund', type: 'resource', evidence: 'Residents do not participate in City repair reserve fund allocation decisions, which delay emergency repairs in their buildings.' };
  expect(submittedReviewIssue(review([node]), 'exosphere', node.evidence)).toBeNull();
});

it('keeps Exo and Macro type choices paired with their level in the model schema',()=>{
  const [exo,macro]=nodeSubmissionSchema('exosphere').properties.nodes.items.oneOf;
  expect(exo.properties.scale.enum).toEqual(['exosphere']);
  expect(exo.properties.type.enum).toContain('policy');
  expect(macro.properties.scale.enum).toEqual(['macrosphere']);
  expect(macro.properties.type.enum).not.toContain('policy');
  expect(macro.properties.type.enum).not.toContain('agency');
});

it('explains how to repair bundled Micro roles without inventing or dropping evidence',()=>{
  const issue=submittedReviewIssue(review([{...local,label:'Teachers and school staff'}]),'micro','Teachers and school staff work with residents.');
  expect(issue).toContain('Do not bundle different roles');
  expect(issue).toContain('choose one supported role or return separate nodes');
});
