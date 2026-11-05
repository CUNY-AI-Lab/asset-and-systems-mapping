import { expect, it } from 'vitest';
import { createDefaultProject, createEvent, createPortableProject, parseProject, serializeProject, validateProject } from './domain.js';
import { appendSubmittedNodes, memoUpdatePayload, memoUpdateState, memoUpdateSummary, openMemoWorkflowScale } from './memoWorkflow.js';
import { recordEdit, restoreEdit } from './editHistory.js';
import { memoAnalysisIssue, memoContentFingerprint, memoSourceFingerprint, memoUpdateIssue } from '../shared/memo-update.js';
import { nodeSubmissionInstruction, submittedReviewIssue } from '../shared/node-submission.js';

const clone = value => structuredClone(value);
const review = nodes => ({ guidance: [], nodes, connections: [], example: null, readiness: { ready: true, note: 'Nodes identified.' } });
const original = { label: 'Residents', type: 'group', scale: 'micro', evidence: 'Residents meet at the library.' };
const changedEvidence = 'Residents meet at the library every Tuesday.';
function blank() {
  const p = createDefaultProject(); p.graph = { nodes: [], edges: [] }; p.candidates = { nodes: [], edges: [] }; p.preflight = null;
  p.submission.text = original.evidence; return p;
}
function submitted() { const p = blank(); appendSubmittedNodes(p, review([original])); return p; }
function edit(p, text, key = 'submission') {
  p[key].text = text; p[key].revision = (p[key].revision || 1) + 1; p[key].fingerprint = memoSourceFingerprint(text);
}
const evidenceUpdate = p => ({ label: p.graph.nodes[0].label, type: p.graph.nodes[0].type, scale: p.graph.nodes[0].scale, existingId: p.graph.nodes[0].id, evidence: changedEvidence });

it('stores successful empty submissions and independent per-memo baselines, not draft saves', () => {
  const p = blank(); expect(memoUpdateState(p).submitted).toBe(false);
  appendSubmittedNodes(p, review([])); expect(memoUpdateState(p)).toEqual({ hasBaseline: true, changed: false, pending: false, submitted: true });
  const first = clone(p.submission.analysis); edit(p, 'Residents do not meet at the library.');
  expect(p.submission.analysis).toEqual(first); expect(memoUpdateState(p).pending).toBe(true);
  openMemoWorkflowScale(p, 'exosphere'); expect(p.part2Submission.analysis).toBeUndefined(); expect(p.part2Submission.text).toBe('');
  edit(p, 'There is insufficient evidence of an outside setting.', 'part2Submission'); appendSubmittedNodes(p, review([]));
  expect(p.submission.analysis).toEqual(first); expect(p.part2Submission.analysis.sourceFingerprint).not.toBe(first.sourceFingerprint);
  const restored = parseProject(serializeProject(p)); expect(restored.part2Submission.analysis).toEqual(p.part2Submission.analysis);
});

it('ignores whitespace-only changes but detects one-word negation, names and numbers', () => {
  const p = submitted(); edit(p, 'Residents   meet\n at the library.');
  expect(memoUpdateState(p).submitted).toBe(true);
  for (const text of ['Residents do not meet at the library.', 'Teachers meet at the library.', 'Residents meet at 3 libraries.']) {
    edit(p, text); expect(memoUpdateState(p).changed).toBe(true);
  }
  expect(memoContentFingerprint('X  y.')).toBe(memoContentFingerprint('X\ny.'));
});

it('selects exact changed passages with context and rejects forged spans or wrong memo part', () => {
  const p = submitted(); edit(p, changedEvidence + ' Neighbors meet at the park.');
  const payload = memoUpdatePayload(p);
  expect(payload.passages.map(span => span.text).join(' ')).toContain(changedEvidence);
  expect(memoUpdateIssue(payload, p.submission.text, 'micro', p.graph.nodes)).toBeNull();
  const forged = clone(payload); forged.passages[0].text = forged.passages[0].text.replace('Residents', 'Inventors');
  expect(memoUpdateIssue(forged, p.submission.text, 'micro', p.graph.nodes)).toBeTruthy();
  expect(memoUpdateIssue(payload, p.submission.text, 'exosphere', p.graph.nodes)).toMatch(/another part/);
});

it('prioritizes a new marginal subject even when the retained map already exceeds six nodes', () => {
  const p = blank();
  const locals = ['Residents', 'Teachers', 'Nurses', 'Repair workers', 'Community room', 'Apartments'].map((label, index) => ({ label, type: index < 4 ? 'group' : 'setting', scale: 'micro', evidence: `The memo identifies ${label}.` }));
  edit(p, locals.map(node => node.evidence).join(' ')); appendSubmittedNodes(p, review(locals));
  openMemoWorkflowScale(p, 'exosphere');
  const outside = [
    { label: 'Regional Housing Office', type: 'organization', scale: 'exosphere', basis: 'memo', evidence: 'Residents do not participate in Regional Housing Office staffing decisions, which delay repairs in their homes.' },
    { label: 'Universal repair access policy', type: 'policy', scale: 'macrosphere', basis: 'memo', evidence: 'Universal repair access policy requires access across all local housing developments.' },
  ];
  edit(p, outside.map(node => node.evidence).join(' '), 'part2Submission'); appendSubmittedNodes(p, review(outside));
  openMemoWorkflowScale(p, 'micro');
  const preserved = clone(p.graph), secondMemo = clone(p.part2Submission);
  const evidence = 'Residents also meet the resident advocate at the community room to organize repair requests.';
  edit(p, p.submission.text + ' ' + evidence);
  const context = memoUpdatePayload(p), instruction = nodeSubmissionInstruction('micro', context);
  expect(context.passages.some(passage => passage.text.includes(evidence))).toBe(true);
  expect(instruction).toContain('Review the changed passages first');
  expect(instruction).toContain('saved nodes supplied as context do not count against it');
  expect(instruction).toContain('A map with six or more nodes can still receive supported new nodes');
  const response = review([{ label: 'Resident advocate', type: 'role', scale: 'micro', evidence }]);
  expect(submittedReviewIssue(response, 'micro', p.submission.text, context)).toBeNull();
  expect(appendSubmittedNodes(p, response)).toBe(1);
  expect(p.graph.nodes).toHaveLength(9); expect(p.graph.nodes.slice(0, 8)).toEqual(preserved.nodes);
  expect(p.graph.edges).toEqual(preserved.edges); expect(p.part2Submission).toEqual(secondMemo);
  expect(() => validateProject(p)).not.toThrow();
});

it('refreshes only generated evidence and preserves all student fields and relationships', () => {
  const p = submitted(), node = p.graph.nodes[0]; node.label = 'Library residents'; node.type = 'person'; node.notes = 'My interpretation'; node.x = 123; node.y = 321; node.color = 'rose';
  node.annotations.analytical.text = 'A saved note';
  const before = clone(node); edit(p, changedEvidence);
  const response = review([evidenceUpdate(p)]);
  expect(memoUpdateSummary(p, response)).toEqual({ added: 0, updated: 1, preserved: 0 });
  expect(appendSubmittedNodes(p, response)).toBe(0);
  expect(p.graph.nodes[0]).toEqual({ ...before, evidence: changedEvidence, sourceFingerprint: memoSourceFingerprint(p.submission.text) });
  expect(p.graph.edges).toEqual([]);
  expect(p.submission.analysis.nodes[0]).toMatchObject({ id: node.id, label: 'Residents', type: 'group', evidence: changedEvidence });
});

it('does not overwrite manually edited evidence, resurrect removals or duplicate an original label', () => {
  const p = submitted(); p.graph.nodes[0].evidence = 'My own source note'; edit(p, changedEvidence);
  expect(memoUpdateSummary(p, review([evidenceUpdate(p)]))).toEqual({ added: 0, updated: 0, preserved: 1 });
  appendSubmittedNodes(p, review([evidenceUpdate(p)])); expect(p.graph.nodes[0].evidence).toBe('My own source note');
  p.graph.nodes[0].label = 'Renamed residents'; p.graph.nodes[0].claimState = 'retired'; p.graph.nodes[0].reviewDecision = 'removed'; p.graph.nodes[0].status = 'rejected';
  const removed = clone(p.graph.nodes[0]);
  expect(appendSubmittedNodes(p, review([{ ...original, evidence: changedEvidence }]))).toBe(0);
  expect(p.graph.nodes).toEqual([removed]);
});

it('keeps reclassified node identity while refreshing its original memo evidence', () => {
  const p = submitted(); p.graph.nodes[0].label = 'Library Services Office'; p.graph.nodes[0].type = 'institution'; p.graph.nodes[0].scale = 'exosphere';
  edit(p, changedEvidence);
  const context = memoUpdatePayload(p), response = review([evidenceUpdate(p)]);
  expect(submittedReviewIssue(response, 'micro', p.submission.text, context)).toBeNull();
  appendSubmittedNodes(p, response); expect(p.graph.nodes[0]).toMatchObject({ scale: 'exosphere', type: 'institution', evidence: changedEvidence });
});

it('rejects unknown IDs, identity edits, removed targets and relationships atomically', () => {
  const p = submitted(); edit(p, changedEvidence); const before = clone(p);
  for (const node of [{ ...evidenceUpdate(p), existingId: 'unknown' }, { ...evidenceUpdate(p), label: 'Different label' }]) {
    expect(() => appendSubmittedNodes(p, review([evidenceUpdate(p), node]))).toThrow(); expect(p).toEqual(before);
  }
  p.graph.nodes[0].claimState = 'retired'; const removed = clone(p);
  expect(() => appendSubmittedNodes(p, review([evidenceUpdate(p)]))).toThrow(/removed/); expect(p).toEqual(removed);
  expect(() => appendSubmittedNodes(p, { ...review([]), connections: [{ source: 'a', target: 'b' }] })).toThrow();
});

it('does not treat a successful first memo as a successful identical second memo', () => {
  const p = submitted(); delete p.submission.analysis;
  p.events.push({ id: 'legacy-success', action: 'preflight.completed', detail: 'Submitted memo nodes added to map', sourceFingerprint: memoSourceFingerprint(p.submission.text), configurationSnapshot: { activeScale: 'micro' } });
  expect(memoUpdateState(p).submitted).toBe(true);
  openMemoWorkflowScale(p, 'exosphere'); p.part2Submission.text = p.submission.text;
  expect(memoUpdateState(p).submitted).toBe(false);
});

it('rejects duplicate update/add identities but treats historical repeat-only results as no-ops', () => {
  const p = submitted(); p.graph.nodes[0].label = 'Library residents'; edit(p, changedEvidence);
  const before = clone(p), duplicate = { ...original, evidence: changedEvidence };
  expect(() => appendSubmittedNodes(p, review([evidenceUpdate(p), duplicate]))).toThrow(/duplicates an existing identity/);
  expect(p).toEqual(before);
  expect(appendSubmittedNodes(p, review([duplicate]))).toBe(0);
  expect(p.graph).toEqual(before.graph);
});

it('restores baseline and graph atomically with Undo/Redo after private reload', () => {
  const before = submitted(); edit(before, changedEvidence);
  const next = clone(before); appendSubmittedNodes(next, review([evidenceUpdate(next)])); recordEdit(before, next, 'Update map', { coalesce: false });
  const loaded = parseProject(serializeProject(next)); const undo = restoreEdit(loaded).project;
  expect(undo).toBeTruthy(); expect(undo.graph).toEqual(before.graph); expect(undo.submission.analysis).toEqual(before.submission.analysis);
  expect(undo.submission.text).toBe(changedEvidence); expect(memoUpdateState(undo).pending).toBe(true);
  const redo = restoreEdit(undo, 'redo').project; expect(redo.graph).toEqual(next.graph); expect(redo.submission.analysis).toEqual(next.submission.analysis);
});

it('strips historical analysis from every non-private export and validates its bounded schema', () => {
  const p = submitted(); p.instructor.maxSharingTier = 'public';
  for (const tier of ['course', 'CUNY', 'public']) { expect(createPortableProject(p, tier).submission.analysis).toBeUndefined(); }
  expect(createPortableProject(p, 'private').submission.analysis).toEqual(p.submission.analysis);
  const invalid = clone(p); invalid.submission.analysis.nodes[0].extra = 'unsupported';
  expect(memoAnalysisIssue(invalid.submission.analysis)).toBeTruthy(); expect(() => validateProject(invalid)).toThrow(/analysis/);
});

it('accepts only palette keys and preserves a custom node color through private reload and Undo', () => {
  const p = submitted(); p.graph.nodes[0].color = 'teal'; p.candidates.nodes[0].color = 'teal';
  expect(parseProject(serializeProject(p)).graph.nodes[0].color).toBe('teal');
  const next = clone(p); next.graph.nodes[0].color = 'amber'; recordEdit(p, next, 'Change color');
  expect(restoreEdit(next).project.graph.nodes[0].color).toBe('teal');
  p.graph.nodes[0].color = 'automatic'; expect(() => validateProject(p)).toThrow(/color/);
});


it.each(['micro', 'exosphere'].flatMap(scale => [false, true].map(empty => ({ scale, empty }))))('restores first $scale submission readiness with $empty empty-result flag through saved Undo/Redo', ({ scale, empty }) => {
  const before = blank();
  let node = original;
  if (scale === 'exosphere') {
    appendSubmittedNodes(before, review([original]));
    openMemoWorkflowScale(before, scale);
    node = { label: 'Equal access policy', type: 'policy', scale: 'macrosphere', basis: 'memo', evidence: 'Equal access policy requires access to services across all neighborhood settings.' };
    before.part2Submission.text = node.evidence;
  }
  const sourceKey = scale === 'micro' ? 'submission' : 'part2Submission';
  const next = clone(before); appendSubmittedNodes(next, review(empty ? [] : [node]));
  next.events.push(createEvent('preflight.completed', 'Submitted memo nodes added to map', 'student', { sourceFingerprint: memoSourceFingerprint(next[sourceKey].text), configurationSnapshot: { activeScale: scale } }));
  recordEdit(before, next, 'Submitted memo nodes added to map', { coalesce: false });
  const undone = restoreEdit(parseProject(serializeProject(next))).project;
  expect(undone).toBeTruthy(); expect(undone.graph).toEqual(before.graph);
  expect(undone[sourceKey].analysis).toBeUndefined();
  expect(memoUpdateState(undone)).toMatchObject({ hasBaseline: false, submitted: false, pending: true });
  if (scale === 'exosphere') expect(undone.submission).toEqual(before.submission);
  const redone = restoreEdit(parseProject(serializeProject(undone)), 'redo').project;
  expect(redone.graph).toEqual(next.graph); expect(redone[sourceKey].analysis).toEqual(next[sourceKey].analysis);
  expect(memoUpdateState(redone).submitted).toBe(true);
  // Readiness is not inferred only from the future stack, which new edits clear.
  const edited = clone(undone); edited.inquiry = 'A later student note'; recordEdit(undone, edited, 'Update inquiry');
  expect(edited.editHistory.future).toEqual([]);
  expect(memoUpdateState(parseProject(serializeProject(edited))).submitted).toBe(false);
});

it('keeps genuine legacy success when its first modern baseline is undone', () => {
  const before = blank();
  before.events.push(createEvent('preflight.completed', 'Submitted memo nodes added to map', 'student', { sourceFingerprint: memoSourceFingerprint(before.submission.text), configurationSnapshot: { activeScale: 'micro' } }));
  expect(memoUpdateState(before).submitted).toBe(true);
  const next = clone(before); appendSubmittedNodes(next, review([]));
  next.events.push(createEvent('preflight.completed', 'Submitted memo nodes added to map', 'student', { sourceFingerprint: memoSourceFingerprint(next.submission.text), configurationSnapshot: { activeScale: 'micro' } }));
  recordEdit(before, next, 'Submitted memo nodes added to map', { coalesce: false });
  const undone = restoreEdit(parseProject(serializeProject(next))).project;
  expect(undone.submission.analysis).toBeUndefined();
  expect(memoUpdateState(undone).submitted).toBe(true);
  expect(restoreEdit(undone, 'redo').project.submission.analysis).toEqual(next.submission.analysis);
});

it.each([false, true])('reads older generation journals while preserving only genuine prior legacy success: %s', legacy => {
  const before = blank();
  const completion = () => createEvent('preflight.completed', 'Submitted memo nodes added to map', 'student', { sourceFingerprint: memoSourceFingerprint(before.submission.text), configurationSnapshot: { activeScale: 'micro' } });
  if (legacy) before.events.push(completion());
  const next = clone(before); appendSubmittedNodes(next, review([original])); next.events.push(completion());
  recordEdit(before, next, 'Submitted memo nodes added to map', { coalesce: false });
  next.editHistory.past.at(-1).changes = next.editHistory.past.at(-1).changes.filter(change => change.path[0] !== 'memoCompletion');
  const undone = restoreEdit(parseProject(serializeProject(next))).project;
  expect(undone).toBeTruthy(); expect(undone.submission.analysis).toBeUndefined();
  expect(memoUpdateState(undone).submitted).toBe(legacy);
});
