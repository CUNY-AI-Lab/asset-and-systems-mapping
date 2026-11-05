import { createEvent, stableId, validateProject, SCALE_ORDER } from './domain.js';
import { EDIT_HISTORY_LIMIT, EDIT_HISTORY_BYTES, MEMO_EDIT_FIELDS, editHistoryIssue } from '../shared/edit-history-contract.js';

const empty = () => ({ version: 1, past: [], future: [] });
const clone = value => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const saveBytes = project => bytes({ project: JSON.stringify(project), revision: Number.MAX_SAFE_INTEGER });
const hash = value => `${value.length}:${stableId('text', value)}`;
const own = (value, key) => value != null && Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function memo(source) {
  return Object.fromEntries(MEMO_EDIT_FIELDS.map(key => [key, key === 'analysis' ? clone(source?.analysis ?? null) : source?.[key] ?? (['sensitive', 'consent'].includes(key) ? false : key === 'fileSize' ? 0 : '')]));
}
function records(collection) {
  return { nodes: Object.fromEntries(collection.nodes.map(item => [item.id, clone(item)])), nodeOrder: collection.nodes.map(item => item.id),
    edges: Object.fromEntries(collection.edges.map(item => [item.id, clone(item)])), edgeOrder: collection.edges.map(item => item.id) };
}
function snapshot(project) {
  return { graph: records(project.graph), candidates: records(project.candidates), submission: memo(project.submission), part2Submission: memo(project.part2Submission),
    title: project.title, participantName: project.participantName || '', inquiry: project.inquiry,
    notes: Object.fromEntries(SCALE_ORDER.map(scale => [scale, scale === project.activeScale ? project.reflection : project.levelProgress[scale].reflection])),
    mapNote: project.mapAnnotation.text, layout: clone(project.layout || {}) };
}
function difference(before, after, path = [], changes = []) {
  if (equal(before, after)) return changes;
  if (object(before) && object(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (own(before, key) && own(after, key)) difference(before[key], after[key], [...path, key], changes);
      else changes.push({ kind: 'value', path: [...path, key], before: own(before, key) ? { present: true, value: before[key] } : { present: false }, after: own(after, key) ? { present: true, value: after[key] } : { present: false } });
    }
  } else if (typeof before === 'string' && typeof after === 'string') {
    let index = 0, suffix = 0;
    while (index < before.length && index < after.length && before[index] === after[index]) index++;
    while (suffix < before.length - index && suffix < after.length - index && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
    changes.push({ kind: 'text', path, index, before: before.slice(index, before.length - suffix), after: after.slice(index, after.length - suffix), beforeHash: hash(before), afterHash: hash(after) });
  } else changes.push({ kind: 'value', path, before: { present: true, value: before }, after: { present: true, value: after } });
  return changes;
}
function applyChanges(state, changes, direction) {
  const undo = direction === 'undo';
  for (const change of undo ? [...changes].reverse() : changes) {
    let parent = state;
    for (const key of change.path.slice(0, -1)) {
      if (!own(parent, key) || !object(parent[key])) throw new Error('This edit no longer matches the current map.');
      parent = parent[key];
    }
    const key = change.path.at(-1), before = undo ? change.after : change.before, after = undo ? change.before : change.after;
    if (change.kind === 'text') {
      const value = parent[key], expectedHash = undo ? change.afterHash : change.beforeHash;
      if (typeof value !== 'string' || hash(value) !== expectedHash || value.slice(change.index, change.index + before.length) !== before) throw new Error('This edit no longer matches the current text.');
      parent[key] = value.slice(0, change.index) + after + value.slice(change.index + before.length);
      if (hash(parent[key]) !== (undo ? change.beforeHash : change.afterHash)) throw new Error('This edit could not be restored.');
    } else {
      if (own(parent, key) !== before.present || before.present && !equal(parent[key], before.value)) throw new Error('This edit no longer matches the current map.');
      if (after.present) parent[key] = clone(after.value); else delete parent[key];
    }
  }
  return state;
}
function applySnapshot(project, state) {
  const previous = snapshot(project);
  for (const key of ['graph', 'candidates']) project[key] = { nodes: state[key].nodeOrder.map(id => state[key].nodes[id]), edges: state[key].edgeOrder.map(id => state[key].edges[id]) };
  for (const key of ['submission', 'part2Submission']) {
    if (!project[key]) continue;
    const changedText = project[key].text !== state[key].text;
    for (const field of MEMO_EDIT_FIELDS) {
      if (equal(previous[key][field], state[key][field])) continue;
      if (['fileName', 'fileSize', 'analysis'].includes(field) && !state[key][field]) delete project[key][field];
      else project[key][field] = state[key][field];
    }
    if (changedText) { project[key].revision = (project[key].revision || 1) + 1; project[key].fingerprint = stableId('src', project[key].text); }
  }
  for (const key of ['title', 'participantName', 'inquiry']) if (!equal(previous[key], state[key])) project[key] = state[key];
  for (const scale of SCALE_ORDER) project.levelProgress[scale].reflection = state.notes[scale];
  project.reflection = state.notes[project.activeScale];
  project.mapAnnotation.text = state.mapNote;
  if (!equal(previous.layout, state.layout)) {
    if (Object.keys(state.layout).length) project.layout = clone(state.layout); else delete project.layout;
  }
}

/** Record only editable values; navigation and transient view state are absent. */
export function recordEdit(before, after, label = 'Edit map', { at = Date.now(), coalesce = true } = {}) {
  if (before.id !== after.id) return false;
  const previous = snapshot(before), current = snapshot(after), changes = difference(previous, current);
  if (!changes.length) return false;
  const history = before.editHistory && !editHistoryIssue(before.editHistory) ? clone(before.editHistory) : empty();
  const boundedLabel = String(label || 'Edit map').slice(0, 160);
  let entry = { id: stableId('edit', `${at}:${Math.random()}`), label: boundedLabel, at, changes };
  const last = history.past.at(-1);
  if (coalesce && changes.length === 1 && changes[0].kind === 'text' && last?.changes.length === 1 && last.changes[0].kind === 'text' && last.label === boundedLabel && at - last.at >= 0 && at - last.at < 1500 && equal(last.changes[0].path, changes[0].path) && !history.future.length) {
    try { entry = { ...last, at, changes: difference(applyChanges(clone(previous), last.changes, 'undo'), current) }; history.past.pop(); } catch { /* Keep edits separate if the earlier text changed. */ }
  }
  history.future = [];
  if (entry.changes.length) history.past.push(entry);
  after.editHistory = history;
  // Leave transport headroom for the request envelope and server metadata.
  while (history.past.length && (history.past.length > EDIT_HISTORY_LIMIT || bytes(history) > EDIT_HISTORY_BYTES || saveBytes(after) > 2 * 1024 * 1024 - 32768 || editHistoryIssue(history))) history.past.shift();
  // The generic project traversal limit also applies to history values.
  if (history.past.length) {
    try { validateProject(after); } catch { history.past = []; }
  }
  if (!history.past.length) delete after.editHistory;
  return Boolean(history.past.length);
}

export function editHistoryState(project) {
  const history = project.editHistory;
  if (!history || editHistoryIssue(history)) return { canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' };
  return { canUndo: Boolean(history.past.length), canRedo: Boolean(history.future.length), undoLabel: history.past.at(-1)?.label || '', redoLabel: history.future.at(-1)?.label || '' };
}

/** Undo/redo never invokes a model and never mutates the caller on failure. */
export function restoreEdit(project, direction = 'undo') {
  if (!['undo', 'redo'].includes(direction)) return { project: null, error: 'Choose Undo or Redo.' };
  const history = project.editHistory;
  if (!history || editHistoryIssue(history)) return { project: null, error: 'There is no saved edit to restore.' };
  const source = direction === 'undo' ? 'past' : 'future', target = direction === 'undo' ? 'future' : 'past';
  const entry = history[source].at(-1);
  if (!entry) return { project: null, error: `Nothing to ${direction}.` };
  try {
    const next = clone(project);
    applySnapshot(next, applyChanges(snapshot(project), entry.changes, direction));
    next.editHistory[source].pop(); next.editHistory[target].push(entry);
    next.updatedAt = new Date(Math.max(Date.now(), Date.parse(project.updatedAt) + 1)).toISOString();
    next.events.push(createEvent(`edit.${direction}`, `${direction === 'undo' ? 'Undid' : 'Redid'} ${entry.label}`));
    if (next.events.length > 500) next.events = next.events.slice(-500);
    validateProject(next);
    return { project: next, error: '' };
  } catch (error) { return { project: null, error: error.message.startsWith('This edit') ? error.message : 'This edit conflicts with the current map. Your work has been kept.' }; }
}
