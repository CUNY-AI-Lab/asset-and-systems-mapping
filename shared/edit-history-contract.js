export const EDIT_HISTORY_LIMIT = 30;
export const EDIT_HISTORY_BYTES = 256 * 1024;
export const MEMO_EDIT_FIELDS = Object.freeze(['title', 'author', 'date', 'sourceType', 'location', 'rights', 'sensitive', 'consent', 'evidenceOwnership', 'text', 'fileName', 'fileSize', 'analysis']);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const safeKey = key => typeof key === 'string' && key.length > 0 && key.length <= 200 && !['__proto__', 'prototype', 'constructor'].includes(key);
export function editPathAllowed(path) {
  if (!Array.isArray(path) || !path.length || path.length > 12 || !path.every(safeKey)) return false;
  const [root, field] = path;
  if (['graph', 'candidates'].includes(root)) return path.length === 2 && ['nodeOrder', 'edgeOrder'].includes(field)
    || path.length >= 3 && ['nodes', 'edges'].includes(field);
  if (['submission', 'part2Submission'].includes(root)) return path.length === 2 && MEMO_EDIT_FIELDS.includes(field) || field === 'analysis' && path.length >= 3;
  if (root === 'memoCompletion') return path.length === 2 && ['part1', 'part2'].includes(field);
  if (root === 'notes') return path.length === 2 && ['micro', 'meso', 'exosphere', 'macrosphere'].includes(field);
  if (root === 'layout') return path.length === 2 && ['autoFit', 'manualNodeIds', 'readingAspect', 'phoneOverview'].includes(field);
  return path.length === 1 && ['title', 'participantName', 'inquiry', 'mapNote'].includes(root);
}
function jsonValue(value) {
  const stack = [value]; let count = 0;
  while (stack.length) {
    const item = stack.pop();
    if (++count > 10000) return false;
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) continue;
    if (Array.isArray(item)) { stack.push(...item); continue; }
    if (!plain(item) || Object.keys(item).some(key => !safeKey(key))) return false;
    stack.push(...Object.values(item));
  }
  return true;
}
const box = value => exact(value, ['present']) && value.present === false
  || exact(value, ['present', 'value']) && value.present === true && jsonValue(value.value);
export function editHistoryIssue(history) {
  if (!exact(history, ['version', 'past', 'future']) || history.version !== 1 || !Array.isArray(history.past) || !Array.isArray(history.future)) return 'must contain version 1 and past/future edits';
  if (history.past.length + history.future.length > EDIT_HISTORY_LIMIT) return 'contains too many edits';
  const ids = new Set(); let changes = 0;
  for (const entry of [...history.past, ...history.future]) {
    if (!exact(entry, ['id', 'label', 'at', 'changes']) || !safeKey(entry.id) || ids.has(entry.id) || typeof entry.label !== 'string' || entry.label.length > 160 || !Number.isSafeInteger(entry.at) || entry.at < 0 || !Array.isArray(entry.changes) || !entry.changes.length || entry.changes.length > 2000) return 'contains an invalid edit';
    ids.add(entry.id); changes += entry.changes.length;
    if (changes > 4000) return 'contains too many changes';
    for (const change of entry.changes) {
      if (!plain(change) || !editPathAllowed(change.path)) return 'contains a disallowed edit path';
      if (change.path[0] === 'memoCompletion' && (change.kind !== 'value' || change.before?.present !== true || change.after?.present !== true || typeof change.before.value !== 'boolean' || typeof change.after.value !== 'boolean')) return 'contains invalid memo completion state';
      if (change.kind === 'value') {
        if (!exact(change, ['kind', 'path', 'before', 'after']) || !box(change.before) || !box(change.after)) return 'contains an invalid value change';
      } else if (change.kind === 'text') {
        if (!exact(change, ['kind', 'path', 'index', 'before', 'after', 'beforeHash', 'afterHash']) || !Number.isSafeInteger(change.index) || change.index < 0 || ['before', 'after', 'beforeHash', 'afterHash'].some(key => typeof change[key] !== 'string') || change.beforeHash.length > 100 || change.afterHash.length > 100) return 'contains an invalid text change';
      } else return 'contains an unknown change';
    }
  }
  if (new TextEncoder().encode(JSON.stringify(history)).byteLength > EDIT_HISTORY_BYTES) return 'exceeds the edit-history size limit';
  return '';
}
