import { isLiveMapItem } from './mapInsights.js';
import { SCALE_ORDER, stableId, withDefaultNodeLayout, validateProject } from './domain.js';
import { activeSubmission, beginPart2 } from './projectMemo.js';
import { memoAnalysisIssue, memoContentFingerprint, memoSourceFingerprint, memoChunks, changedMemoPassages, memoUpdateIssue } from '../shared/memo-update.js';
import { SUBMISSION_NODE_LIMIT, submittedReviewIssue } from '../shared/node-submission.js';

export const MEMO_WORKFLOW = Object.freeze({
  micro: { title: 'Micro · local nodes', instruction: 'Submit your first memo to add people, places and resources to the map.', next: 'Next: Meso · draw relationships' },
  meso: { title: 'Meso · local relationships', instruction: 'Double-click a node, or select it and choose Connect from, then click the node it connects to. Double-click empty space to add a missing node.', next: 'Next: Exo · add second memo' },
  exosphere: { title: 'Exo · policies and offices', instruction: 'Submit your second memo to add Exo policies and offices, plus Macro conditions. Then double-click an Exo node and click the local relationship line or node it affects.', next: 'Next: Macro · broader conditions' },
  macrosphere: { title: 'Macro · broader conditions', instruction: 'Double-click a condition and click the relationship line or setting it shapes. Add a missing condition by double-clicking outside the Exo region. You can still edit or remove anything on the map.', next: 'Finish map' },
});

// A submitted memo may append nodes. It can never create, retire or rewrite
// relationships, or replace a student's existing nodes and saved placement.
export function memoUpdateState(project) {
  const submission = activeSubmission(project), analysis = submission.analysis;
  const hasBaseline = Boolean(analysis && !memoAnalysisIssue(analysis));
  const fingerprint = memoSourceFingerprint(submission.text);
  const outer = ['exosphere', 'macrosphere'].includes(project.activeScale);
  const belongsToPart = scale => scale ? ['exosphere', 'macrosphere'].includes(scale) === outer : !outer && !project.part2Submission;
  const restored = project.events.slice().reverse().flatMap(event => ['edit.undo', 'edit.redo'].includes(event.action) && Array.isArray(event.memoSubmissionState) ? event.memoSubmissionState : [])
    .find(state => state?.part === (outer ? 2 : 1) && state.sourceFingerprint === fingerprint && typeof state.submitted === 'boolean');
  const legacySubmitted = !hasBaseline && (restored ? restored.submitted : Boolean(project.preflight?.evaluation && project.preflight.sourceFingerprint === fingerprint && belongsToPart(project.preflight.configurationSnapshot?.activeScale)
    || project.events.some(event => event.action === 'preflight.completed' && event.detail === 'Submitted memo nodes added to map' && event.sourceFingerprint === fingerprint && belongsToPart(event.configurationSnapshot?.activeScale))));
  const changed = hasBaseline ? analysis.contentFingerprint !== memoContentFingerprint(submission.text) : Boolean(submission.text.trim()) && !legacySubmitted;
  return { hasBaseline, changed, pending: changed, submitted: hasBaseline ? !changed : legacySubmitted };
}

export function memoUpdatePayload(project) {
  const submission = activeSubmission(project), analysis = submission.analysis;
  if (!analysis || memoAnalysisIssue(analysis)) return undefined;
  const byId = new Map(project.graph.nodes.map(node => [node.id, node]));
  const payload = { version: 1, part: ['exosphere', 'macrosphere'].includes(project.activeScale) ? 2 : 1,
    baselineFingerprint: analysis.sourceFingerprint, sourceFingerprint: memoSourceFingerprint(submission.text),
    passages: changedMemoPassages(submission.text, analysis),
    existingNodes: analysis.nodes.flatMap(original => {
      const current = byId.get(original.id);
      if (!current) return [];
      return [{ id: current.id, label: current.label, type: current.type, scale: current.scale, evidence: original.evidence,
        originalLabel: original.label, originalType: original.type, originalScale: original.scale,
        removed: current.status === 'rejected' || current.claimState === 'retired' || current.reviewDecision === 'removed' }];
    }),
  };
  // Preserve all identities. Broad passages may fall back to the full current
  // source, but identity/removal context is never silently truncated.
  if (memoUpdateIssue(payload, submission.text, project.activeScale)) payload.passages = [];
  const issue = memoUpdateIssue(payload, submission.text, project.activeScale);
  if (issue) throw new Error(`The memo update could not be prepared: ${issue}. Your saved work is unchanged.`);
  return payload;
}

export function carriedSubmissionNodes(project) {
  return project.graph.nodes.filter(isLiveMapItem).map(({ id, label, type, scale }) => ({ id, label, type, scale }));
}

function submittedPlan(project, review) {
  if (!['micro', 'exosphere'].includes(project.activeScale)) throw new Error('Relationships are created by students.');
  if (review.connections?.length) throw new Error('A node submission cannot contain relationships.');
  const next = structuredClone(project), source = activeSubmission(next), previous = source.analysis;
  const baseline = previous && !memoAnalysisIssue(previous) ? previous.nodes : [];
  const originals = new Map(baseline.map(node => [node.id, structuredClone(node)]));
  const context = memoUpdatePayload(project);
  const reviewIssue = submittedReviewIssue(review, project.activeScale, source.text, context, carriedSubmissionNodes(project));
  if (reviewIssue) throw new Error(`The memo update could not be applied: ${reviewIssue}`);
  const existing = new Set([...project.graph.nodes, ...project.candidates.nodes.filter(node => ['rejected', 'research lead'].includes(node.status))].map(node => `${node.scale}:${node.label.trim().toLocaleLowerCase()}`));
  for (const node of baseline) existing.add(`${node.scale}:${node.label.trim().toLocaleLowerCase()}`);
  const knownLabels = new Set((context?.existingNodes || []).flatMap(node => [node.label, node.originalLabel]).map(label => label.trim().toLocaleLowerCase()));
  const fingerprint = stableId('src', activeSubmission(project).text);
  const added = [];
  let updated = 0, preserved = 0;
  const seenUpdates = new Set();
  for (const node of review.nodes || []) {
    if (node.existingId !== undefined) {
      const original = originals.get(node.existingId), current = next.graph.nodes.find(item => item.id === node.existingId);
      const known = context?.existingNodes.find(item => item.id === node.existingId);
      if (!original || !current || !known || known.removed || seenUpdates.has(node.existingId)
        || !['label', 'type', 'scale'].every(key => node[key] === current[key])) throw new Error('The memo returned an unknown or changed node identity.');
      seenUpdates.add(node.existingId);
      if (current.evidence === original.evidence) {
        if (current.evidence !== node.evidence) {
          current.evidence = node.evidence; current.sourceFingerprint = fingerprint; updated++;
          const candidate = next.candidates.nodes.find(item => item.id === current.id);
          if (candidate && candidate.evidence === original.evidence) { candidate.evidence = node.evidence; candidate.sourceFingerprint = fingerprint; }
        }
        originals.set(node.existingId, { ...original, evidence: node.evidence });
      } else preserved++;
      continue;
    }
    if (!(project.activeScale === 'micro' ? node.scale === 'micro' : ['exosphere', 'macrosphere'].includes(node.scale))) throw new Error('The memo returned a node for another step.');
    const key = `${node.scale}:${node.label.trim().toLocaleLowerCase()}`;
    if (existing.has(key) || knownLabels.has(node.label.trim().toLocaleLowerCase())) { preserved++; continue; }
    existing.add(key);
    const id = stableId('node', key);
    // The original deterministic ID remains an identity even after a student
    // renamed, reclassified or removed its record.
    if (project.graph.nodes.some(item => item.id === id)) { preserved++; continue; }
    added.push({ id, label: node.label, type: node.type, scale: node.scale,
      status: 'confirmed', claimState: 'inference', origin: 'model suggestion', reviewDecision: 'added',
      evidence: node.evidence || '', sourceFingerprint: fingerprint, notes: '',
      ...(node.scale === 'micro' ? { focalParticipation: 'unclear', settingNodeIds: [] } : { basis: node.basis || 'memo' }),
      annotations: { analytical: { id: stableId('annotation', `${id}:analytical`), text: '' }, evidence: { id: stableId('annotation', `${id}:evidence`), text: '' } },
    });
    originals.set(id, { id, label: node.label, type: node.type, scale: node.scale, evidence: node.evidence || '' });
  }
  const placed = withDefaultNodeLayout(added);
  next.graph.nodes.push(...placed);
  const ids = new Set(placed.map(node => node.id));
  next.candidates.nodes = next.candidates.nodes.filter(node => !ids.has(node.id));
  next.candidates.nodes.push(...structuredClone(placed));
  const blocks = memoChunks(source.text).map(chunk => chunk.fingerprint);
  source.analysis = { version: 1, sourceFingerprint: fingerprint, contentFingerprint: memoContentFingerprint(source.text),
    blocks: blocks.length <= 512 ? blocks : [], nodes: [...originals.values()] };
  if (project.activeScale === 'exosphere') next.releasedScales = [...SCALE_ORDER];
  next.stage = 3;
  next.furthestStage = Math.max(project.furthestStage || 0, 3);
  validateProject(next);
  // Check the escaped cloud-write envelope before accepting any additions.
  if (new TextEncoder().encode(JSON.stringify({ project: JSON.stringify(next), revision: Number.MAX_SAFE_INTEGER })).byteLength > 2 * 1024 * 1024 - 8192) throw new Error('This memo update exceeds the project save limit. Your saved work is unchanged.');
  return { next, summary: { added: placed.length, updated, preserved } };
}

export function memoUpdateSummary(project, review) { return submittedPlan(project, review).summary; }

// Student-facing wording for the server's fixed left-out reasons.
// Student copy, pending approval in docs/student-copy.md.
const WITHHELD_REASON_TEXT = Object.freeze({
  outside_setting: 'An outside office, so it belongs at Exo',
  participation_conflict: 'People in the memo take part in it, so it belongs at Micro',
  participation_unknown: 'The memo says it is unclear whether people take part in it',
  setting_unnamed: 'The quote does not name it',
  policy_operation: 'The quote does not show how the rule works here',
  narrative_quote: 'The quote is not word for word from the memo',
  evidence_limit: 'The quote runs over 500 characters',
  established_condition: 'The memo puts it as a wish or a question, not as fact',
  label_format: 'The name is a sentence or lumps several things together',
  identity_duplicate: 'Already on the map',
  existing_identity: 'It would change a node already on the map',
  scale_type: 'Its type does not fit this level',
  node_shape: 'The entry came back incomplete',
  node_limit: `The submission was already full at ${SUBMISSION_NODE_LIMIT} nodes`,
  // No longer assigned; kept for maps saved before the reasons were split.
  outside_participation: 'The memo does not make clear which level it belongs at',
  unsupported: 'Dropped when the memo was read a second time',
});
export function withheldNodeReason(reason) { return WITHHELD_REASON_TEXT[reason] || 'Did not pass the evidence checks'; }
export function withheldNodes(project) {
  const items = project?.preflight?.evaluation?.runtime?.withheldNodes;
  return Array.isArray(items) ? items : [];
}

// Steps open one at a time. A student can return to any step already opened
// and move on to the next one, but never skip past the work in between.
export function reachableWorkflowScales(project) {
  const first = memoUpdateState({ ...project, activeScale: 'micro' });
  const second = memoUpdateState({ ...project, activeScale: 'exosphere' });
  const firstMemoReady = first.submitted || first.hasBaseline || second.submitted || second.hasBaseline;
  if (!firstMemoReady) return ['micro'];
  const index = scale => SCALE_ORDER.indexOf(scale);
  const furthestOpened = Math.max(0, ...(project.releasedScales || []).map(index), index(project.activeScale));
  const furthestCompleted = Math.max(-1, ...(project.completedScales || []).map(index));
  const reach = Math.max(1, furthestOpened, furthestCompleted + 1);
  return SCALE_ORDER.filter((_, position) => position <= reach);
}

// Whether the current step shows the work it asks for, so the next step can
// be offered without pushing a student who has not started yet.
export function workflowStepReady(project) {
  const live = project.graph.nodes.filter(isLiveMapItem);
  const liveIds = new Set(live.map(node => node.id));
  const liveEdges = project.graph.edges.filter(edge => liveIds.has(edge.source) && liveIds.has(edge.target));
  const atScale = scale => live.some(node => node.scale === scale);
  const state = memoUpdateState(project);
  switch (project.activeScale) {
    case 'micro': return state.submitted && atScale('micro');
    case 'meso': return liveEdges.some(edge => !edge.relationshipIds?.length && live.find(node => node.id === edge.source)?.scale === 'micro');
    case 'exosphere': return state.submitted && (atScale('exosphere') || atScale('macrosphere'));
    case 'macrosphere': return atScale('macrosphere') || atScale('exosphere');
    default: return false;
  }
}

// One line in the corner of the map says what to do next at this step. It
// changes with the map, so a student is never told to do work already done.
export const WORKFLOW_GUIDE = Object.freeze({
  memo: 'Open Memo and add its nodes to the map to continue.',
  micro: 'Select a node to edit it. Double-click the canvas to add a node.',
  meso: 'Double-click a node to connect it. Double-click the canvas to add a node.',
  exosphere: 'Double-click an Exo node, then click the local relationship it affects.',
  macrosphere: 'Double-click a condition, then click the relationship or setting it shapes.',
  newNode: 'New node. Click the map to cancel.',
  newRelationship: 'New relationship',
});
export function workflowGuide(project, { addMode = null, pendingNode = false } = {}) {
  if (addMode === 'edge') return WORKFLOW_GUIDE.newRelationship;
  if (addMode === 'node' && pendingNode) return WORKFLOW_GUIDE.newNode;
  if (['micro', 'exosphere'].includes(project.activeScale) && !memoUpdateState(project).submitted) return WORKFLOW_GUIDE.memo;
  return WORKFLOW_GUIDE[project.activeScale] || WORKFLOW_GUIDE.micro;
}

export function appendSubmittedNodes(project, review) {
  const { next, summary } = submittedPlan(project, review);
  Object.assign(project, next);
  return summary.added;
}

export function openMemoWorkflowScale(project, scale) {
  if (!SCALE_ORDER.includes(scale)) return;
  project.levelProgress[project.activeScale] = { stage: project.stage, reflection: project.reflection };
  if (['exosphere', 'macrosphere'].includes(scale)) beginPart2(project);
  project.activeScale = scale;
  project.reflection = project.levelProgress[scale]?.reflection || '';
  // Editing a memo is saved as stage 1. Keep that entry open when returning
  // to its node step, while legacy review-stage maps open their mapped work.
  project.stage = ['micro', 'exosphere'].includes(scale) && project.levelProgress[scale]?.stage === 1 ? 1 : 3;
  project.furthestStage = Math.max(project.furthestStage || 0, 3);
  project.releasedScales = SCALE_ORDER.filter(item => project.releasedScales.includes(item) || SCALE_ORDER.indexOf(item) <= SCALE_ORDER.indexOf(scale));
  project.preflight = null;
}
