import { MEMO_REVIEW_GUIDANCE_LIMIT, MEMO_REVIEW_SCALE_LIMITS } from '../shared/memo-review-limits.js';
import { SUBMISSION_SUBJECT_ISSUE, SUBMISSION_MACRO_ISSUE, SUBMISSION_NODE_LIMIT, submittedReviewIssue } from '../shared/node-submission.js';
import { isNodeTypeAllowedAtScale, WITHHELD_NODE_REASONS } from '../src/domain.js';

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
const boundedText = (value, maximum) => typeof value === 'string' && value.trim() && value.length <= maximum
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
const nodeRules = new Set(WITHHELD_NODE_REASONS.filter(rule => rule !== 'unsupported'));

function nodeIssuesValid(repair) {
  const present = Object.hasOwn(repair, 'nodeIssues') || Object.hasOwn(repair, 'omittedCount');
  if (!present) return true;
  if (!/^nodes\[[0-5]\]\.(?:label|evidence|type|scale|existingId)$/u.test(repair.path)
    || !Array.isArray(repair.nodeIssues) || repair.nodeIssues.length > SUBMISSION_NODE_LIMIT
    || !Number.isSafeInteger(repair.omittedCount) || repair.omittedCount < 0
    || repair.nodeIssues.length + repair.omittedCount > SUBMISSION_NODE_LIMIT) return false;
  const indexes = new Set();
  return repair.nodeIssues.every(issue => {
    if (!keysAre(issue, ['path', 'label', 'rule']) || !shortString(issue.label) || !issue.label.length || !nodeRules.has(issue.rule)) return false;
    const match = /^nodes\[([0-5])\](?:\.(?:label|evidence|type|scale|existingId))?$/u.exec(issue.path);
    if (!match || indexes.has(match[1])) return false;
    indexes.add(match[1]);
    return true;
  });
}

function supportedNodesValid(repair, scale) {
  const present = Object.hasOwn(repair, 'supportedNodes') || Object.hasOwn(repair, 'omittedSupportedCount');
  if (!present) return true;
  if (!['micro', 'exosphere'].includes(scale)
    || !/^nodes\[[0-5]\]\.(?:label|evidence|type|scale|existingId)$/u.test(repair.path)
    || !Array.isArray(repair.supportedNodes) || repair.supportedNodes.length > SUBMISSION_NODE_LIMIT
    || !Number.isSafeInteger(repair.omittedSupportedCount) || repair.omittedSupportedCount < 0
    || repair.supportedNodes.length + repair.omittedSupportedCount > SUBMISSION_NODE_LIMIT * 2) return false;
  const fields = scale === 'micro' ? ['label', 'type', 'scale', 'evidence'] : ['label', 'type', 'scale', 'evidence', 'basis'];
  return repair.supportedNodes.every(node => keysAre(node, fields, ['existingId'])
    && boundedText(node.label, 200) && boundedText(node.evidence, 500)
    && isNodeTypeAllowedAtScale(node.type, node.scale)
    && (scale === 'micro' || node.basis === 'memo')
    && (Object.hasOwn(node, 'existingId')
      ? boundedText(node.existingId, 200)
      : scale === 'micro' ? node.scale === 'micro' : ['exosphere', 'macrosphere'].includes(node.scale)));
}

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
    if (!nodeIssuesValid(value) || !supportedNodesValid(value, activeScale)) return false;
    const optional = ['nodeIssues', 'omittedCount', 'supportedNodes', 'omittedSupportedCount'];
    if (/^nodes\[[0-5]\]\.(?:label|evidence|type|scale|existingId)$/u.test(value.path) && value.valueOmitted === true) {
      return keysAre(value, ['path', 'valueOmitted'], optional);
    }
    if (!keysAre(value, ['path', 'value'], optional)) return false;
    if (/^nodes\[\d{1,2}\]\.label$/u.test(value.path)) return shortString(value.value);
    if (/^nodes\[\d{1,2}\]\.evidence$/u.test(value.path)) return keysAre(value.value, ['label', 'evidence'])
      && shortString(value.value.label) && typeof value.value.evidence === 'string' && value.value.evidence.length <= 500;
    if (/^guidance\[\d{1,2}\]\.evidenceExcerpt$/u.test(value.path)) return typeof value.value === 'string' && value.value.length <= 500;
    if (/^connections\[\d{1,2}\]$/u.test(value.path)) return keysAre(value.value, ['source', 'target'])
      && shortString(value.value.source) && shortString(value.value.target);
    return false;
  } catch { return false; }
}

/**
 * Name the proposals from rejected attempts that the accepted response left
 * out, each with the fixed rule that excluded it. A proposal the model dropped
 * on repair without a rule of its own was unsupported by the source.
 */
// When the last attempt still fails on one proposed node, the rest of the
// response is kept and that node is left out with its reason, instead of the
// whole submission failing. Only node-indexed issues are salvageable; a
// malformed response is not. Returns null when nothing can be kept safely.
export function salvageNodeSubmission(review, activeScale, sourceText, memoUpdate, carriedNodes = []) {
  if (!plain(review) || !Array.isArray(review.nodes)) return null;
  let kept = { ...review, nodes: [...review.nodes] };
  const dropped = [];
  for (let pass = 0; pass <= review.nodes.length; pass++) {
    const issue = submittedReviewIssue(kept, activeScale, sourceText, memoUpdate, carriedNodes);
    if (!issue) return { review: kept, dropped };
    const failed = /^nodes\[(\d{1,2})\]/u.exec(issue);
    if (!failed || Number(failed[1]) >= kept.nodes.length) return null;
    // An identity problem (an unknown, removed, renamed or duplicated existing
    // node) is a contract failure, never an evidence judgment: fail closed.
    if (['identity_duplicate', 'existing_identity'].includes(nodeIssueRule(issue))) return null;
    const [node] = kept.nodes.splice(Number(failed[1]), 1);
    if (plain(node) && node.existingId === undefined && boundedText(node.label, 200)) dropped.push({ label: node.label, reason: nodeIssueRule(issue) });
    kept = { ...kept, nodes: [...kept.nodes] };
  }
  return null;
}

export function withheldSubmissionNodes(rejectedAttempts, accepted, activeScale, sourceText, memoUpdate, carriedNodes = []) {
  const identity = node => node?.existingId !== undefined ? `id:${node.existingId}`
    : `label:${String(node?.label ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase()}`;
  const kept = new Set((accepted?.nodes || []).map(identity));
  const withheld = [];
  const seen = new Set();
  for (const { review, message } of rejectedAttempts) {
    if (!plain(review) || !Array.isArray(review.nodes)) continue;
    const failed = /^nodes\[(\d{1,2})\]/u.exec(String(message ?? ''));
    for (const [index, node] of review.nodes.entries()) {
      if (!plain(node) || node.existingId !== undefined) continue;
      const key = identity(node);
      if (kept.has(key) || seen.has(key) || !boundedText(node.label, 200)) continue;
      seen.add(key);
      const own = submittedReviewIssue({ ...review, nodes: [node] }, activeScale, sourceText, memoUpdate, carriedNodes);
      const reason = own && /^nodes\[0\]/u.test(own) ? nodeIssueRule(own)
        : failed && Number(failed[1]) === index ? nodeIssueRule(message)
          : 'unsupported';
      withheld.push({ label: node.label, reason });
      if (withheld.length >= SUBMISSION_NODE_LIMIT) return withheld;
    }
  }
  return withheld;
}

function nodeIssueRule(message) {
  if (/nonparticipation|names this outside setting|participants taking part|outside decision setting/u.test(message)) return 'outside_participation';
  if (/specific established policy and its operation/u.test(message)) return 'policy_operation';
  if (/\.evidence must quote the supplied narrative within 500 characters/u.test(message)) return 'evidence_limit';
  if (/\.evidence .*quote/u.test(message)) return 'narrative_quote';
  if (/established condition/u.test(message)) return 'established_condition';
  if (/duplicates/u.test(message)) return 'identity_duplicate';
  if (/existingId|preserve the existing node/u.test(message)) return 'existing_identity';
  if (/\.label /u.test(message)) return 'label_format';
  if (/\.scale|\.type/u.test(message)) return 'scale_type';
  return 'node_shape';
}

/** Supplement the primary failure with per-node checks; acceptance still validates the full review. */
export function createNodeSubmissionRepair(review, message, activeScale, sourceText, memoUpdate, previousRepair, carriedNodes = []) {
  const primary = createMemoContractRepair(review, message, activeScale);
  const failed = /^nodes\[([0-5])\]\.(label|evidence|type|scale|existingId)\b/u.exec(message);
  if (!failed || !['micro', 'exosphere'].includes(activeScale) || !plain(review)
    || !Array.isArray(review.nodes) || review.nodes.length > SUBMISSION_NODE_LIMIT
    || !Array.isArray(review.guidance) || review.guidance.length
    || !Array.isArray(review.connections) || review.connections.length || review.example !== null) return primary;
  const failedLabel = review.nodes[Number(failed[1])]?.label;
  const base = primary || (failed[2] === 'label' && shortString(failedLabel)
    ? { path: `nodes[${failed[1]}].label`, value: failedLabel }
    : { path: `nodes[${failed[1]}].${failed[2]}`, valueOmitted: true });
  const issues = [];
  const supportedNodes = [];
  let omittedCount = 0;
  let omittedSupportedCount = 0;
  const retainSupported = node => {
    if (supportedNodes.some(current => ['label', 'type', 'scale', 'existingId'].every(key => current[key] === node[key]))) return;
    if (submittedReviewIssue({ ...review, nodes: [node] }, activeScale, sourceText, memoUpdate, carriedNodes)) return;
    if (!submittedReviewIssue({ ...review, nodes: [...supportedNodes, node] }, activeScale, sourceText, memoUpdate, carriedNodes)) {
      supportedNodes.push(structuredClone(node));
    } else omittedSupportedCount += 1;
  };
  for (const node of previousRepair?.supportedNodes || []) retainSupported(node);
  for (const [index, node] of review.nodes.entries()) {
    const issue = submittedReviewIssue({ ...review, nodes: [node] }, activeScale, sourceText, memoUpdate, carriedNodes);
    if (!issue) {
      // Avoid presenting a globally rejected duplicate or over-limit entry as
      // compatible support. This context never changes the rejected response.
      if (index === Number(failed[1])) continue;
      retainSupported(node);
      continue;
    }
    if (!/^nodes\[0\]/u.test(issue)) continue;
    if (primary && index === Number(failed[1])) continue;
    if (!shortString(node?.label) || !node.label.length) { omittedCount += 1; continue; }
    const path = /^nodes\[0\](?:\.(?:label|evidence|type|scale|existingId))?/u.exec(issue)[0].replace('nodes[0]', `nodes[${index}]`);
    issues.push({ path, label: node.label, rule: nodeIssueRule(issue) });
  }
  if (!issues.length && !omittedCount && !supportedNodes.length && !omittedSupportedCount) return base;
  const repair = { ...base,
    ...(issues.length || omittedCount ? { nodeIssues: issues, omittedCount } : {}),
    ...(supportedNodes.length || omittedSupportedCount ? { supportedNodes, omittedSupportedCount } : {}) };
  while (size(repair) > MEMO_CONTRACT_REPAIR_BYTES && issues.length) {
    issues.pop(); repair.omittedCount += 1;
  }
  while (size(repair) > MEMO_CONTRACT_REPAIR_BYTES && supportedNodes.length) {
    supportedNodes.pop(); repair.omittedSupportedCount += 1;
  }
  if (size(repair) > MEMO_CONTRACT_REPAIR_BYTES) {
    delete repair.value; repair.valueOmitted = true;
  }
  return isMemoContractRepair(repair, activeScale) ? repair : base;
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
  const subject = /^nodes\[(\d{1,2})\]\.label /u.exec(message);
  const label = subject && [SUBMISSION_SUBJECT_ISSUE, SUBMISSION_MACRO_ISSUE].some(issue => message === `nodes[${subject[1]}].label ${issue}`) ? subject
    : /^nodes\[(\d{1,2})\]\.label (?:must name a complete map element rather than a statement|is a reference, action, clause, fragment, or non-entity Micro label|is not a named institution or service system|names a person or role, not an outside setting or resource|names a person or institution, not a Macro condition|does not name a broader condition|duplicates an existing or proposed element|must name one local participant, group, setting or resource\. Do not bundle different roles, named people or settings with and; choose one supported role or return separate nodes within the six-node limit\. Do not use a sentence or an action as the label)\.$/u.exec(message);
  if (label && Array.isArray(review.nodes)) {
    const repair = { path: `nodes[${label[1]}].label`, value: review.nodes[Number(label[1])]?.label };
    return isMemoContractRepair(repair, activeScale) ? repair : null;
  }
  const nodeEvidence = /^nodes\[(\d{1,2})\]\.evidence (?:must quote the supplied narrative, not a bibliography or an invented explanation|must describe an established condition, not only a wish, recommendation or research question|must describe a specific established policy and its operation in the focal situation|must quote the focal participants’ nonparticipation in this named outside setting, not another setting|must quote the focal participants’ nonparticipation in an outside decision and its indirect effect on their local setting|describes focal participants taking part in the setting; do not classify that setting as Exo)\.$/u.exec(message);
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
  if (repair.nodeIssues || repair.supportedNodes) {
    const fitted = { ...repair,
      ...(repair.nodeIssues ? { nodeIssues: [...repair.nodeIssues] } : {}),
      ...(repair.supportedNodes ? { supportedNodes: [...repair.supportedNodes] } : {}) };
    combined.contractRepair = fitted;
    while (size(combined) > byteLimit && fitted.nodeIssues?.length) {
      fitted.nodeIssues.pop(); fitted.omittedCount += 1;
    }
    while (size(combined) > byteLimit && fitted.supportedNodes?.length) {
      fitted.supportedNodes.pop(); fitted.omittedSupportedCount += 1;
    }
    if (size(combined) > byteLimit) { delete fitted.value; fitted.valueOmitted = true; }
  }
  return size(combined) <= byteLimit ? combined : context;
}
