import { expect, it } from 'vitest';
import { createDefaultProject, parseProject, serializeProject, validateProject } from './domain.js';
import { appendSubmittedNodes, openMemoWorkflowScale } from './memoWorkflow.js';
import { reviewMemoText } from './projectMemo.js';
import { submittedReviewIssue } from '../shared/node-submission.js';

const review = nodes => ({ guidance: [], nodes, connections: [], example: null, readiness: { ready: true, note: 'Nodes identified.' } });
const local = { label:'Residents', type:'group', scale:'micro', evidence:'Residents meet in the community room.' };
const outer = [
  { label:'City Housing Authority', type:'agency', scale:'exosphere', basis:'memo', evidence:'City Housing Authority allocates repair staff.' },
  { label:'Capital repair funding policy', type:'policy', scale:'macrosphere', basis:'memo', evidence:'Capital repair funding policy delays elevator repairs.' },
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
  expect(submittedReviewIssue(review(outer),'exosphere',reviewMemoText(p))).toBeNull();
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
it.each([
  { ...outer[0], scale:'macrosphere', type:'structure' },
  { ...outer[1], evidence:'Invented evidence that does not occur in the memo.' },
  { ...outer[1], scope:['node-a','node-b'] },
])('rejects wrong-level or invented second-memo content',node=>{
  expect(submittedReviewIssue(review([node]),'exosphere',outer.map(n=>n.evidence).join(' '))).toBeTruthy();
});
it('caps the initial set instead of filling the map with suggestions',()=>{
  expect(submittedReviewIssue(review(Array.from({length:7},(_,i)=>({...local,label:`Residents ${i}`}))),'micro',local.evidence)).toMatch(/limit/);
  expect(submittedReviewIssue({...review([]),guidance:[{point:'Try adding more nodes'}]},'micro',local.evidence)).toMatch(/no guidance/);
});
