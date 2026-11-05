import { useCallback, useLayoutEffect, useRef, useState } from 'react';

const VIEW_LIMIT = 40;
const KINDS = new Set(['memo', 'notebook', 'tools', 'item', 'map', 'node-form', 'relationship-form', 'connected-node']);

// Navigation records contain only view identities, never an earlier graph,
// memo, annotation or model result. Back cannot undo a student's work.
export function workspaceViewSnapshot(view) {
  const kind = KINDS.has(view.kind) ? view.kind : 'notebook';
  const selection = kind === 'item' && ['node', 'edge'].includes(view.selection?.kind) && typeof view.selection.id === 'string'
    ? { kind: view.selection.kind, id: view.selection.id } : null;
  return { scale: view.scale, stage: view.stage, kind: kind === 'item' && !selection ? 'notebook' : kind, selection };
}

const keyOf = view => JSON.stringify(workspaceViewSnapshot(view));

export function useWorkspaceViewHistory({ scopeKey, view, enabled = true }) {
  const current = workspaceViewSnapshot(view);
  const viewKey = keyOf(current);
  const history = useRef({ scopeKey, current, past: [], pending: null });
  const [, changed] = useState(0);
  const refresh = () => changed(value => value + 1);

  useLayoutEffect(() => {
    const record = history.current;
    if (!enabled || record.scopeKey !== scopeKey) {
      history.current = { scopeKey, current, past: [], pending: null };
      refresh();
      return;
    }
    if (record.pending) {
      // Parent scale changes and local panel resets may render separately.
      // Do not turn those intermediate states into new Back destinations.
      if (keyOf(record.pending) === viewKey) {
        record.current = current;
        record.pending = null;
        refresh();
      }
      return;
    }
    if (keyOf(record.current) === viewKey) return;
    const next = record.current.scale !== current.scale && !['memo', 'tools'].includes(current.kind)
      ? { ...current, kind: 'notebook', selection: null } : current;
    record.past = [...record.past, record.current].slice(-VIEW_LIMIT);
    record.current = next;
    refresh();
  }, [scopeKey, viewKey, enabled]);

  const goBack = useCallback((resolve = destination => destination) => {
    const record = history.current;
    if (!enabled || record.scopeKey !== scopeKey || record.pending || !record.past.length) return null;
    const destination = workspaceViewSnapshot(resolve(record.past.pop()));
    record.pending = destination;
    refresh();
    return destination;
  }, [scopeKey, enabled]);

  const record = history.current;
  return {
    canGoBack: enabled && record.scopeKey === scopeKey && !record.pending && record.past.length > 0,
    pendingView: record.scopeKey === scopeKey ? record.pending : null,
    goBack,
  };
}
