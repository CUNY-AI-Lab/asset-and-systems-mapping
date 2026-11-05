import { prepareProviderMemo } from './provider-memo.js';

export const MEMO_UPDATE_BYTES = 64 * 1024;
export const MEMO_ANALYSIS_BYTES = 64 * 1024;
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value, max = 200, empty = false) => typeof value === 'string' && value.length <= max && (empty || value.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
const scales = ['micro', 'exosphere', 'macrosphere'];
// Same non-secret source identifier used by existing saved projects.
export function memoSourceFingerprint(value, prefix = 'src') {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}
export const meaningfulMemoText = value => prepareProviderMemo(value).sourceText.replace(/\s+/gu, ' ').trim();
export const memoContentFingerprint = value => {
  const normalized = meaningfulMemoText(value);
  return `${normalized.length}:${memoSourceFingerprint(normalized, 'content')}:${memoSourceFingerprint([...normalized].reverse().join(''), 'reverse')}`;
};

// Sentence/paragraph boundaries keep a small edit from shifting every later
// fixed-width chunk. Each span always refers to the prepared current memo.
export function memoChunks(value) {
  const source = prepareProviderMemo(value).sourceText;
  const chunks = [];
  for (const match of source.matchAll(/[^\n.!?]+(?:[.!?]+(?=\s|$)|$)|[^\n]+$/gmu)) {
    const raw = match[0];
    if (!raw.trim()) continue;
    for (let offset = 0; offset < raw.length; offset += 2048) {
      const start = match.index + offset, end = Math.min(match.index + raw.length, start + 2048);
      const normalized = source.slice(start, end).replace(/\s+/gu, ' ').trim();
      chunks.push({ start, end, fingerprint: `${normalized.length}:${memoSourceFingerprint(normalized, 'chunk')}` });
    }
  }
  return chunks;
}

const generatedKeys = ['id', 'label', 'type', 'scale', 'evidence'];
export function memoAnalysisIssue(value) {
  if (!exact(value, ['version', 'sourceFingerprint', 'contentFingerprint', 'blocks', 'nodes']) || value.version !== 1) return 'invalid analysis shape';
  if (!text(value.sourceFingerprint) || !text(value.contentFingerprint)) return 'invalid analysis fingerprint';
  if (!Array.isArray(value.blocks) || value.blocks.length > 512 || value.blocks.some(item => !text(item))) return 'invalid analysis blocks';
  if (!Array.isArray(value.nodes) || value.nodes.length > 50) return 'invalid analysis nodes';
  const seen = new Set();
  for (const node of value.nodes) {
    if (!exact(node, generatedKeys) || !text(node.id) || !text(node.label) || !text(node.type, 100) || !scales.includes(node.scale) || !text(node.evidence, 500, true) || seen.has(node.id)) return 'invalid generated node baseline';
    seen.add(node.id);
  }
  if (bytes(value) > MEMO_ANALYSIS_BYTES) return 'analysis exceeds its storage limit';
  return null;
}

export function memoUpdateIssue(value, sourceMaterial, activeScale, carriedNodes) {
  if (!exact(value, ['version', 'part', 'baselineFingerprint', 'sourceFingerprint', 'passages', 'existingNodes']) || value.version !== 1) return 'invalid memo update shape';
  if (![1, 2].includes(value.part) || activeScale !== undefined && value.part !== (['exosphere', 'macrosphere'].includes(activeScale) ? 2 : 1)) return 'memo update belongs to another part';
  if (!text(value.baselineFingerprint) || !text(value.sourceFingerprint)) return 'invalid update fingerprint';
  const source = sourceMaterial === undefined ? null : prepareProviderMemo(sourceMaterial).sourceText;
  if (sourceMaterial !== undefined && value.sourceFingerprint !== memoSourceFingerprint(sourceMaterial)) return 'update source fingerprint does not match';
  if (!Array.isArray(value.passages) || value.passages.length > 512) return 'invalid changed passages';
  let end = -1;
  for (const span of value.passages) {
    if (!exact(span, ['start', 'end', 'text']) || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start < 0 || span.end <= span.start || span.start < end || !text(span.text, 131072) || span.text.length !== span.end - span.start) return 'invalid changed passage span';
    if (source !== null && source.slice(span.start, span.end) !== span.text) return 'changed passage does not match current memo';
    end = span.end;
  }
  if (!Array.isArray(value.existingNodes) || value.existingNodes.length > 50) return 'invalid existing node context';
  const seen = new Set(), carried = carriedNodes && new Map(carriedNodes.map(node => [node.id, node]));
  for (const node of value.existingNodes) {
    if (!exact(node, [...generatedKeys, 'originalLabel', 'originalType', 'originalScale', 'removed']) || !text(node.id) || !text(node.label) || !text(node.type, 100) || !scales.includes(node.scale) || !text(node.evidence, 500, true) || !text(node.originalLabel) || !text(node.originalType, 100) || !scales.includes(node.originalScale) || typeof node.removed !== 'boolean' || seen.has(node.id)) return 'invalid existing node identity';
    if (carried && !node.removed && !['label', 'type', 'scale'].every(key => carried.get(node.id)?.[key] === node[key])) return 'existing node does not match the carried map';
    seen.add(node.id);
  }
  if (bytes(value) > MEMO_UPDATE_BYTES) return 'memo update exceeds its input limit';
  return null;
}

export function changedMemoPassages(value, baseline) {
  const source = prepareProviderMemo(value).sourceText, current = memoChunks(value);
  const prior = new Map();
  for (const hash of baseline.blocks) prior.set(hash, (prior.get(hash) || 0) + 1);
  const changed = [];
  current.forEach((chunk, index) => {
    const count = prior.get(chunk.fingerprint) || 0;
    if (count) prior.set(chunk.fingerprint, count - 1); else changed.push(index);
  });
  const chosen = new Set(changed.flatMap(index => [index - 1, index, index + 1].filter(i => i >= 0 && i < current.length)));
  const ranges = [];
  for (const i of [...chosen].sort((a, b) => a - b)) {
    const chunk = current[i], previous = ranges.at(-1);
    if (previous && source.slice(previous.end, chunk.start).trim() === '') previous.end = chunk.end;
    else ranges.push({ start: chunk.start, end: chunk.end });
  }
  const passages = ranges.map(range => ({ ...range, text: source.slice(range.start, range.end) }));
  // A broad rewrite or deletion-only edit needs the complete current source;
  // never silently truncate a changed passage or infer old deleted wording.
  return bytes(passages) <= 24 * 1024 ? passages : [];
}
