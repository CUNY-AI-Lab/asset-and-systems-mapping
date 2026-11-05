import { afterEach, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useWorkspaceViewHistory, workspaceViewSnapshot } from './workspaceViewHistory.js';

afterEach(cleanup);
const notebook = { scale: 'micro', stage: 3, kind: 'notebook' };
const item = { ...notebook, kind: 'item', selection: { kind: 'node', id: 'counselor' } };
const tools = { ...notebook, kind: 'tools' };
const mount = () => renderHook(props => useWorkspaceViewHistory(props), { initialProps: { scopeKey: 'project-one', view: notebook } });

it('returns from Tools to the selected item, then to the same system Notebook', () => {
  const hook = mount();
  expect(hook.result.current.canGoBack).toBe(false);
  hook.rerender({ scopeKey: 'project-one', view: item });
  hook.rerender({ scopeKey: 'project-one', view: tools });
  let destination;
  act(() => { destination = hook.result.current.goBack(); });
  expect(destination).toEqual(workspaceViewSnapshot(item));
  expect(hook.result.current.canGoBack).toBe(false);
  hook.rerender({ scopeKey: 'project-one', view: item });
  expect(hook.result.current.pendingView).toBeNull();
  act(() => { destination = hook.result.current.goBack(); });
  expect(destination).toEqual(workspaceViewSnapshot(notebook));
  hook.rerender({ scopeKey: 'project-one', view: notebook });
  expect(hook.result.current.canGoBack).toBe(false);
});

it('ignores graph edits and retains only view identities', () => {
  const hook = mount();
  const view = { ...notebook, graph: { nodes: [{ label: 'Changed' }] }, memo: 'A newer memo', selection: { kind: 'node', id: 'hidden' } };
  hook.rerender({ scopeKey: 'project-one', view });
  expect(hook.result.current.canGoBack).toBe(false);
  expect(workspaceViewSnapshot(view)).toEqual({ ...notebook, selection: null });
});

it('restores a visited scale and memo view without recording scale-reset renders', () => {
  const hook = mount();
  const memo = { ...notebook, stage: 1 };
  hook.rerender({ scopeKey: 'project-one', view: memo });
  hook.rerender({ scopeKey: 'project-one', view: { ...notebook, scale: 'exosphere' } });
  act(() => { hook.result.current.goBack(); });
  expect(hook.result.current.pendingView).toEqual(workspaceViewSnapshot(memo));
  hook.rerender({ scopeKey: 'project-one', view: { ...notebook, scale: 'exosphere', kind: 'tools' } });
  hook.rerender({ scopeKey: 'project-one', view: { ...notebook, kind: 'item', selection: item.selection } });
  expect(hook.result.current.pendingView).toEqual(workspaceViewSnapshot(memo));
  hook.rerender({ scopeKey: 'project-one', view: memo });
  expect(hook.result.current.pendingView).toBeNull();
  let destination;
  act(() => { destination = hook.result.current.goBack(); });
  expect(destination).toEqual(workspaceViewSnapshot(notebook));
});

it('drops another project’s destinations and any pending replay', () => {
  const hook = mount();
  hook.rerender({ scopeKey: 'project-one', view: item });
  act(() => { hook.result.current.goBack(); });
  hook.rerender({ scopeKey: 'project-two', view: tools });
  expect(hook.result.current.canGoBack).toBe(false);
  expect(hook.result.current.pendingView).toBeNull();
  let destination;
  act(() => { destination = hook.result.current.goBack(); });
  expect(destination).toBeNull();
});

it('bounds navigation memory and makes a new branch after Back', () => {
  const hook = mount();
  for (let i = 0; i < 45; i++) hook.rerender({ scopeKey: 'project-one', view: { ...item, selection: { kind: 'node', id: `node-${i}` } } });
  act(() => { hook.result.current.goBack(); });
  const prior = hook.result.current.pendingView;
  hook.rerender({ scopeKey: 'project-one', view: prior });
  hook.rerender({ scopeKey: 'project-one', view: tools });
  act(() => { hook.result.current.goBack(); });
  expect(hook.result.current.pendingView).toEqual(prior);
  hook.rerender({ scopeKey: 'project-one', view: prior });
  let count = 0;
  while (hook.result.current.canGoBack) {
    act(() => { hook.result.current.goBack(); });
    hook.rerender({ scopeKey: 'project-one', view: hook.result.current.pendingView });
    count++;
  }
  expect(count).toBe(39);
});
