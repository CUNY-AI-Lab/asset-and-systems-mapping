import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createDefaultProject } from './domain.js';
import { useAccountStorage, releaseAccountStorage } from './accountStorage.js';
import { readRelationshipDraft, relationshipDraftKey, useRelationshipDraft } from './relationshipDraft.js';

afterEach(() => { cleanup(); releaseAccountStorage(); localStorage.clear(); vi.restoreAllMocks(); });
const project = () => ({ ...createDefaultProject(), activeScale: 'meso' });
it('retains an unfinished relationship across unmount, scale navigation and reload, including blank wording', () => {
  const p = project(); const error = vi.fn();
  const hook = renderHook(({ value }) => useRelationshipDraft(value, error), { initialProps: { value: p } });
  act(() => hook.result.current.start('source'));
  act(() => hook.result.current.setDraft({ ...hook.result.current.draft, target: 'target', verb: '' }));
  const draft = hook.result.current.draft;
  hook.rerender({ value: { ...p, activeScale: 'micro' } }); expect(hook.result.current.draft).toBeNull();
  hook.rerender({ value: p }); expect(hook.result.current.draft).toEqual(draft);
  hook.unmount();
  const reopened = renderHook(() => useRelationshipDraft(p, error));
  expect(reopened.result.current.draft).toEqual(draft);
  act(() => reopened.result.current.start('different-source'));
  expect(reopened.result.current.draft).toEqual(draft);
  expect(error).not.toHaveBeenCalled();
});
it('keeps completion recovery until the committed edge survives reload and removes only on explicit discard', () => {
  const p = project(); const hook = renderHook(({ value }) => useRelationshipDraft(value, vi.fn()), { initialProps: { value: p } });
  act(() => hook.result.current.start('source')); const draft = hook.result.current.draft;
  hook.rerender({ value: { ...p, graph: { ...p.graph, edges: [{ id: draft.id }] } } });
  expect(hook.result.current.draft).toBeNull();
  expect(readRelationshipDraft(localStorage, p)).toEqual(draft);
  hook.rerender({ value: p }); expect(hook.result.current.draft).toEqual(draft);
  act(() => hook.result.current.discard());
  expect(localStorage.getItem(relationshipDraftKey(p))).toBeNull(); expect(hook.result.current.draft).toBeNull();
});
it('never exposes drafts in a different account, project, or recreated project', () => {
  const p = project(); useAccountStorage('account-one');
  const hook = renderHook(() => useRelationshipDraft(p, vi.fn()));
  act(() => hook.result.current.start('private-source')); const draft = hook.result.current.draft; hook.unmount();
  useAccountStorage('account-two');
  const other = renderHook(() => useRelationshipDraft(p, vi.fn())); expect(other.result.current.draft).toBeNull(); other.unmount();
  useAccountStorage('account-one');
  const original = renderHook(({ value }) => useRelationshipDraft(value, vi.fn()), { initialProps: { value: p } });
  expect(original.result.current.draft).toEqual(draft);
  original.rerender({ value: { ...p, id: 'different' } }); expect(original.result.current.draft).toBeNull();
  original.rerender({ value: { ...p, createdAt: '2000-01-01T00:00:00.000Z' } }); expect(original.result.current.draft).toBeNull();
});
it('retains in-memory work and reports cache failure; failed discard does not silently clear it', () => {
  const p = project(), error = vi.fn(); const hook = renderHook(() => useRelationshipDraft(p, error));
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  act(() => hook.result.current.start('source')); expect(hook.result.current.draft.source).toBe('source'); expect(error).toHaveBeenCalledTimes(1);
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
  act(() => hook.result.current.discard()); expect(hook.result.current.draft.source).toBe('source'); expect(error).toHaveBeenCalledTimes(2);
});
