import { expect, it } from 'vitest';
import { createDefaultProject, parseProject, serializeProject, createPortableProject, stableId } from './domain.js';
import { activeSubmission, beginPart2, reviewMemoText } from './projectMemo.js';
import { preflightEvaluationPayload, mapCheckPayload } from './App.jsx';
import { cacheMemoDraft, restoreMemoDraft } from './memoDraft.js';
import { relationshipGroupIssue } from '../shared/relationship-groups.js';
import { buildEastHarlemDisabilityProject } from '../tests/e2e/fixtures/east-harlem-disability-project.js';
import { STRONG_MACRO_MEMO } from '../tests/fixtures/two-memo-cases.js';

import { groupProject } from '../tests/fixtures/group-project.js';

it('keeps both memos, local graph identity/geometry, evidence and per-level notes through recovery and export', () => {
  const p = groupProject(), graph = structuredClone(p.graph), first = structuredClone(p.submission);
  beginPart2(p); p.part2Submission.text = STRONG_MACRO_MEMO;
  p.part2Submission.fingerprint = stableId('src', STRONG_MACRO_MEMO);
  beginPart2(p); // Re-entering Part 2 must not clear its file or fingerprint.
  expect(activeSubmission(p)).toBe(p.part2Submission);
  const payload = preflightEvaluationPayload(p);
  expect(payload.sourceMaterial).toContain(first.text);
  expect(payload.sourceMaterial).toContain(STRONG_MACRO_MEMO);
  expect(payload.carriedConnections.find(edge => edge.id === 'macro-group').relationshipIds).toHaveLength(2);
  expect(mapCheckPayload(p, 'gaps').relationships.find(edge => edge.id === 'macro-group').relationshipIds).toEqual(graph.edges.at(-1).relationshipIds);
  const restored = parseProject(serializeProject(p));
  expect(restored.submission).toEqual(first);
  expect(restored.part2Submission).toEqual(p.part2Submission);
  expect(restored.graph).toEqual(graph);
  expect(parseProject(JSON.stringify(createPortableProject(restored, 'private'))).graph).toEqual(graph);
  restored.activeScale = 'meso'; expect(activeSubmission(restored)).toEqual(first);
});

it('bounds and validates groups and prevents deletion of a referenced relationship', () => {
  const p = groupProject();
  expect(() => serializeProject(p)).not.toThrow();
  const group = p.graph.edges.at(-1);
  expect(relationshipGroupIssue({ ...group, relationshipIds: ['invented'] }, p.graph.nodes, p.graph.edges)).toMatch(/live Meso/);
  const local = p.graph.edges.find(edge => edge.id === group.relationshipIds[0]);
  local.claimState = 'retired';
  expect(() => serializeProject(p)).toThrow(/live Meso/);
});

it('restores an unsaved Part 2 draft without replacing Part 1 or the graph', () => {
  const p = groupProject(); beginPart2(p);
  const edited = structuredClone(p); edited.part2Submission.text = STRONG_MACRO_MEMO;
  edited.updatedAt = new Date(Date.parse(p.updatedAt) + 1000).toISOString();
  const map = new Map(); const storage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) };
  expect(cacheMemoDraft(storage, edited, p)).toBe(true);
  const recovered = restoreMemoDraft(storage, p);
  expect(recovered.part2Submission.text).toBe(STRONG_MACRO_MEMO);
  expect(recovered.submission).toEqual(p.submission); expect(recovered.graph).toEqual(p.graph);
});

it('does not lose Part 2 behind a Part 1 reference list and redacts both sources when either is private', () => {
  const p = createDefaultProject(); p.activeScale = 'exosphere'; p.releasedScales = ['micro', 'meso', 'exosphere'];
  p.submission.text = 'Teachers support families.\n\nReferences\nSmith, A. (2025). Example source. https://example.org/source';
  beginPart2(p); p.part2Submission.text = STRONG_MACRO_MEMO; p.part2Submission.sensitive = true;
  expect(reviewMemoText(p)).toContain(STRONG_MACRO_MEMO);
  const portable = createPortableProject(p, 'course');
  expect(portable.submission.text).toBe(''); expect(portable.part2Submission.text).toBe('');
  expect(parseProject(JSON.stringify(portable)).part2Submission.text).toBe('');
});
