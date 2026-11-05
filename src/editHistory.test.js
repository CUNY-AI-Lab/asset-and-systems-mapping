import { describe, expect, it } from 'vitest';
import { createDefaultProject, createEvent, createPortableProject, parseProject, serializeProject, validateProject } from './domain.js';
import { recordEdit, restoreEdit, editHistoryState } from './editHistory.js';
import { EDIT_HISTORY_BYTES, EDIT_HISTORY_LIMIT } from '../shared/edit-history-contract.js';
import { beginPart2 } from './projectMemo.js';
import { buildEastHarlemDisabilityProject } from '../tests/e2e/fixtures/east-harlem-disability-project.js';

const copy = value => structuredClone(value);
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
function edited(project, mutate, label = 'Edit map', options = { coalesce: false }) {
  const next = copy(project); mutate(next); recordEdit(project, next, label, options); validateProject(next); return next;
}
function restore(project, direction = 'undo') {
  const result = restoreEdit(project, direction); expect(result.error).toBe(''); expect(result.project).not.toBeNull(); return result.project;
}

describe('durable edit undo and redo', () => {
  it('restores removal, classification, wording, notes and layout without changing identities or relationships', () => {
    const original = buildEastHarlemDisabilityProject();
    const outside = original.graph.nodes.find(node => node.scale === 'exosphere');
    let project = edited(original, draft => {
      const node = draft.graph.nodes.find(item => item.id === outside.id);
      node.type = 'institution'; node.x += 20; node.notes = 'Student correction';
      node.annotations.analytical.text = 'Keep the local distinction.';
      draft.layout = { autoFit: false, manualNodeIds: [node.id] };
    }, 'Correct a node');
    const changed = copy(project.graph);
    project = parseProject(serializeProject(project));
    expect(editHistoryState(project)).toMatchObject({ canUndo: true, canRedo: false, undoLabel: 'Correct a node' });
    project = restore(project);
    expect(project.graph).toEqual(original.graph);
    expect(project.submission).toEqual(original.submission);
    expect(editHistoryState(project)).toMatchObject({ canUndo: false, canRedo: true, redoLabel: 'Correct a node' });
    project = restore(parseProject(serializeProject(project)), 'redo');
    expect(project.graph).toEqual(changed);
    project = edited(project, draft => {
      const node = draft.graph.nodes.find(item => item.id === outside.id);
      Object.assign(node, { status: 'rejected', claimState: 'retired', reviewDecision: 'removed' });
      draft.graph.edges.filter(edge => edge.source === node.id || edge.target === node.id).forEach(edge => Object.assign(edge, { status: 'rejected', claimState: 'retired' }));
    }, 'Remove node');
    expect(restore(project).graph).toEqual(changed);
  });

  it('undoes a newly added record and redoes it in its original position', () => {
    const original = buildEastHarlemDisabilityProject();
    const project = edited(original, draft => {
      const node = copy(draft.graph.nodes[0]); node.id = 'node_new_undo'; node.label = 'New local group';
      node.annotations = { analytical: { id: 'annotation_new_undo_a', text: '' }, evidence: { id: 'annotation_new_undo_e', text: '' } };
      draft.graph.nodes.splice(1, 0, node); draft.candidates.nodes.push(copy(node));
    }, 'Add node');
    const undone = restore(project);
    expect(undone.graph).toEqual(original.graph); expect(undone.candidates).toEqual(original.candidates);
    const redone = restore(undone, 'redo');
    expect(redone.graph).toEqual(project.graph); expect(redone.candidates).toEqual(project.candidates);
  });

  it('restores retained layout modes and absent aspect fields exactly after moving a node', () => {
    const original = buildEastHarlemDisabilityProject(); original.layout = { phoneOverview: 'preserve' };
    const moved = edited(original, draft => {
      draft.graph.nodes[0].x += 60;
      draft.layout = { phoneOverview: 'preserve', autoFit: false, manualNodeIds: [draft.graph.nodes[0].id], readingAspect: 1.4 };
    }, 'Move node');
    const undone = restore(parseProject(serializeProject(moved)));
    expect(undone.layout).toEqual(original.layout); expect(undone.layout).not.toHaveProperty('readingAspect');
    expect(undone.graph).toEqual(original.graph);
    const redone = restore(undone, 'redo'); expect(redone.layout).toEqual(moved.layout); expect(redone.graph).toEqual(moved.graph);
  });

  it('stores small text deltas and coalesces typing while keeping memo revisions monotonic', () => {
    const original = createDefaultProject(); original.submission.text = 'a'.repeat(100000); original.submission.revision = 5;
    let project = edited(original, draft => { draft.submission.text += 'b'; draft.submission.revision++; }, 'Edit memo', { at: 1000 });
    project = edited(project, draft => { draft.submission.text += 'c'; draft.submission.revision++; }, 'Edit memo', { at: 1500 });
    expect(project.editHistory.past).toHaveLength(1); expect(bytes(project.editHistory)).toBeLessThan(1000);
    const undone = restore(project); expect(undone.submission.text).toBe(original.submission.text); expect(undone.submission.revision).toBe(8);
    const redone = restore(undone, 'redo'); expect(redone.submission.text).toBe(project.submission.text); expect(redone.submission.revision).toBe(9);
  });

  it('preserves separate memo history and does not record navigation or blank Part 2 creation', () => {
    const original = createDefaultProject();
    let project = edited(original, draft => { beginPart2(draft); draft.activeScale = 'exosphere'; draft.releasedScales = ['micro', 'meso', 'exosphere']; draft.stage = 1; draft.viewport.zoom = 2; });
    expect(project.editHistory).toBeUndefined();
    const firstMemo = copy(project.submission);
    project = edited(project, draft => { draft.part2Submission.text = 'An independent second memo.'; draft.part2Submission.fileName = 'second.txt'; }, 'Upload second memo');
    const undone = restore(project);
    expect(undone.submission).toEqual(firstMemo); expect(undone.part2Submission.text).toBe(''); expect(undone.part2Submission.fileName).toBeUndefined();
    expect(undone.activeScale).toBe('exosphere'); expect(undone.stage).toBe(1); expect(undone.viewport.zoom).toBe(2);
  });

  it('restores a note to its original level without navigating away from the current view', () => {
    let project = createDefaultProject(); project.reflection = ''; project.levelProgress.micro.reflection = '';
    project = edited(project, draft => { draft.reflection = 'A Micro note'; draft.levelProgress.micro.reflection = draft.reflection; }, 'Edit note');
    const next = copy(project); next.activeScale = 'meso'; next.releasedScales = ['micro', 'meso']; next.reflection = 'An existing Meso note'; next.levelProgress.meso.reflection = next.reflection;
    // Opening a view copies its already-saved note into the reflection alias.
    project.levelProgress.meso.reflection = next.reflection;
    expect(recordEdit(project, next)).toBe(false);
    const undone = restore(next);
    expect(undone.levelProgress.micro.reflection).toBe(''); expect(undone.reflection).toBe('An existing Meso note'); expect(undone.activeScale).toBe('meso');
  });

  it('clears Redo on a fresh edit, but not on a view-only update', () => {
    let project = edited(createDefaultProject(), draft => { draft.title = 'First title'; }, 'Rename map');
    project = restore(project);
    const viewed = copy(project); viewed.viewport.panX = 20; expect(recordEdit(project, viewed)).toBe(false); expect(editHistoryState(viewed).canRedo).toBe(true);
    project = edited(viewed, draft => { draft.title = 'Another title'; }, 'Rename map');
    expect(editHistoryState(project).canRedo).toBe(false);
  });

  it('rejects a conflicting or tampered edit atomically', () => {
    const project = edited(createDefaultProject(), draft => { draft.title = 'Expected title'; }, 'Rename map');
    project.title = 'A newer unrecorded title'; const before = copy(project);
    expect(restoreEdit(project).project).toBeNull(); expect(project).toEqual(before);
    for (const path of [['configs', 'builder', 'fixedPrompt'], ['graph', 'nodes', '__proto__', 'polluted'], ['activeScale']]) {
      const tampered = copy(project); tampered.editHistory.past[0].changes[0].path = path;
      expect(() => validateProject(tampered)).toThrow(/editHistory/); expect(restoreEdit(tampered).project).toBeNull();
    }
    expect({}.polluted).toBeUndefined();
  });

  it('keeps private history in backups and removes it from every shared export', () => {
    const before = createDefaultProject(); before.submission.text = 'Private earlier memo.'; before.instructor.maxSharingTier = 'public';
    const project = edited(before, draft => { draft.submission.text = 'Revised memo.'; }, 'Edit memo');
    expect(createPortableProject(project, 'private').editHistory).toEqual(project.editHistory);
    for (const tier of ['course', 'CUNY', 'public']) {
      const portable = createPortableProject(project, tier);
      expect(portable.editHistory).toBeUndefined(); expect(JSON.stringify(portable)).not.toContain('Private earlier memo.');
    }
  });

  it('bounds retained edits and leaves room inside the server request limit', () => {
    let project = createDefaultProject();
    for (let i = 0; i < 40; i++) project = edited(project, draft => { draft.title = `Title ${i}`; }, 'Rename map');
    expect(project.editHistory.past).toHaveLength(EDIT_HISTORY_LIMIT); expect(bytes(project.editHistory)).toBeLessThanOrEqual(EDIT_HISTORY_BYTES);
    const large = createDefaultProject(); large.submission.text = 'a'.repeat(50000);
    while (bytes(large) < 2 * 1024 * 1024 - 42000) large.events.push(createEvent('fixture.event', 'x'.repeat(8000)));
    validateProject(large);
    const changed = copy(large); changed.submission.text = 'b'.repeat(15000) + changed.submission.text.slice(15000);
    recordEdit(large, changed, 'Replace memo');
    expect(bytes(changed)).toBeLessThan(2 * 1024 * 1024); expect(changed.editHistory).toBeUndefined(); expect(changed.submission.text).toMatch(/^b/);
    validateProject(changed);
  });

  it('never carries another project’s history into a replacement project', () => {
    const first = edited(createDefaultProject(), draft => { draft.title = 'One'; });
    const second = createDefaultProject(); second.id = 'project_second';
    expect(recordEdit(first, second)).toBe(false); expect(second.editHistory).toBeUndefined();
  });
});
