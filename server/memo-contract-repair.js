import { MEMO_REVIEW_GUIDANCE_LIMIT, MEMO_REVIEW_SCALE_LIMITS } from '../shared/memo-review-limits.js';

export const MEMO_CONTRACT_REPAIR_BYTES = 2 * 1024;
const size = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keysAre = (value, required, optional = []) => plain(value)
  && required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const jsonType = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const maximum = (path, scale) => path === 'guidance' ? MEMO_REVIEW_GUIDANCE_LIMIT : MEMO_REVIEW_SCALE_LIMITS[scale]?.[path];
const shortString = value => typeof value === 'string' && value.length <= 200;

function jsonData(root) {
  const stack = [{ value: root, depth: 0 }], seen = new Set();
  let count = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    if (++count > 2048 || depth > 32) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') continue;
    if (typeof value === 'number') { if (!Number.isFinite(value)) return false; continue; }
    if ((!Array.isArray(value) && !plain(value)) || seen.has(value)) return false;
    seen.add(value);
    const remaining = 2048 - count - stack.length;
    if (Array.isArray(value)) {
      if (value.length > remaining) return false;
      for (const nested of value) stack.push({ value: nested, depth: depth + 1 });
    } else {
      const keys = Object.keys(value);
      if (keys.length > remaining) return false;
      for (const key of keys) stack.push({ value: value[key], depth: depth + 1 });
    }
  }
  return true;
}

/** Validate the finite correction envelope; rejected values remain untrusted JSON data. */
export function isMemoContractRepair(value, activeScale) {
  try {
    if (!plain(value) || typeof value.path !== 'string' || !MEMO_REVIEW_SCALE_LIMITS[activeScale] || !jsonData(value)
      || size(value) > MEMO_CONTRACT_REPAIR_BYTES) return false;
    if (['guidance', 'nodes', 'connections'].includes(value.path)) {
      if (!keysAre(value, ['path', 'observedType', 'observedCount', 'maximumCount'], ['value', 'valueOmitted'])
        || !['array', 'object', 'string', 'number', 'boolean', 'null'].includes(value.observedType)
        || value.maximumCount !== maximum(value.path, activeScale)
        || (value.observedType === 'array'
          ? !Number.isSafeInteger(value.observedCount) || value.observedCount <= value.maximumCount
          : value.observedCount !== null)) return false;
      if (Object.hasOwn(value, 'value')) {
        return !Object.hasOwn(value, 'valueOmitted') && jsonType(value.value) === value.observedType
          && (value.observedType !== 'array' || value.value.length === value.observedCount);
      }
      return value.valueOmitted === true;
    }
    if (!keysAre(value, ['path', 'value'])) return false;
    if (/^nodes\[\d{1,2}\]\.label$/u.test(value.path)) return shortString(value.value);
    if (/^nodes\[\d{1,2}\]\.evidence$/u.test(value.path)) return keysAre(value.value, ['label', 'evidence'])
      && shortString(value.value.label) && typeof value.value.evidence === 'string' && value.value.evidence.length <= 500;
    if (/^guidance\[\d{1,2}\]\.evidenceExcerpt$/u.test(value.path)) return typeof value.value === 'string' && value.value.length <= 500;
    if (/^connections\[\d{1,2}\]$/u.test(value.path)) return keysAre(value.value, ['source', 'target'])
      && shortString(value.value.source) && shortString(value.value.target);
    return false;
  } catch { return false; }
}

/** Select only the failed field, never replay or repair the complete model response. */
export function createMemoContractRepair(review, message, activeScale) {
  if (!plain(review) || !MEMO_REVIEW_SCALE_LIMITS[activeScale]) return null;
  let path;
  if (message === `guidance must contain no more than ${MEMO_REVIEW_GUIDANCE_LIMIT} items.`) path = 'guidance';
  else if (message === `nodes exceeds the ${activeScale} limit.`) path = 'nodes';
  else if (message === `connections exceeds the ${activeScale} limit.`
    || message === `${activeScale} review must return an empty connections array.`) path = 'connections';
  if (path) {
    const failed = review[path];
    const repair = { path, observedType: jsonType(failed), observedCount: Array.isArray(failed) ? failed.length : null,
      maximumCount: maximum(path, activeScale), value: failed };
    if (isMemoContractRepair(repair, activeScale)) return repair;
    delete repair.value;
    repair.valueOmitted = true;
    return isMemoContractRepair(repair, activeScale) ? repair : null;
  }
  const label = /^nodes\[(\d{1,2})\]\.label (?:must name a complete map element rather than a statement|is a reference, action, clause, fragment, or non-entity Micro label|is not a named institution or service system|names a person or role, not an outside setting or resource|names a person or institution, not a Macro condition|does not name a broader condition|duplicates an existing or proposed element|must name one local participant, group, setting or resource\. Do not bundle different roles, named people or settings with and; choose one supported role or return separate nodes within the six-node limit\. Do not use a sentence or an action as the label)\.$/u.exec(message);
  if (label && Array.isArray(review.nodes)) {
    const repair = { path: `nodes[${label[1]}].label`, value: review.nodes[Number(label[1])]?.label };
    return isMemoContractRepair(repair, activeScale) ? repair : null;
  }
  const nodeEvidence = /^nodes\[(\d{1,2})\]\.evidence (?:must quote the supplied narrative, not a bibliography or an invented explanation|must describe an established condition, not only a wish, recommendation or research question)\.$/u.exec(message);
  if (nodeEvidence && Array.isArray(review.nodes)) {
    const node = review.nodes[Number(nodeEvidence[1])];
    const repair = { path: `nodes[${nodeEvidence[1]}].evidence`, value: { label: node?.label, evidence: node?.evidence } };
    return isMemoContractRepair(repair, activeScale) ? repair : null;
  }
  const excerpt = /^guidance\[(\d{1,2})\]\.evidenceExcerpt (?:must quote the supplied memo; Field Notes are not memo evidence|cites only a bibliography entry; use a narrative passage about the mapped situation|must quote a narrative passage during evidence repair)\.$/u.exec(message);
  if (excerpt && Array.isArray(review.guidance)) {
    const repair = { path: `guidance[${excerpt[1]}].evidenceExcerpt`, value: review.guidance[Number(excerpt[1])]?.evidenceExcerpt };
    return isMemoContractRepair(repair, activeScale) ? repair : null;
  }
  const endpoint = /^connections\[(\d{1,2})\] (?:does not use two different accepted-node endpoints|does not stay within Micro|must use exact carried Micro node IDs|must connect an outside decision setting to a supplied Micro setting or another outside decision setting)\.$/u.exec(message);
  if (endpoint && Array.isArray(review.connections)) {
    const failed = review.connections[Number(endpoint[1])];
    const repair = { path: `connections[${endpoint[1]}]`, value: { source: failed?.source, target: failed?.target } };
    return isMemoContractRepair(repair, activeScale) ? repair : null;
  }
  return null;
}

export function memoContractRepairContext(context, repair, byteLimit) {
  if (!repair) return context;
  const combined = { ...context, contractRepair: repair };
  return size(combined) <= byteLimit ? combined : context;
}
