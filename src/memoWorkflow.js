import { SCALE_ORDER, stableId, withDefaultNodeLayout, validateProject } from './domain.js';
import { activeSubmission, beginPart2 } from './projectMemo.js';
import { memoAnalysisIssue, memoContentFingerprint, memoSourceFingerprint, memoChunks, changedMemoPassages, memoUpdateIssue } from '../shared/memo-update.js';
import { submittedReviewIssue } from '../shared/node-submission.js';

export const MEMO_WORKFLOW = Object.freeze({
  micro: { title: 'Micro · local nodes', instruction: 'Submit your first memo to add people, places and resources to the map.', next: 'Next: Meso · draw relationships' },
  meso: { title: 'Meso · local relationships', instruction: 'Select a node on the map, choose Connect from, then select the other node.', next: 'Next: Exo · add second memo' },
  exosphere: { title: 'Exo · outside settings', instruction: 'Submit your second memo to add Exo settings and Macro conditions. Then select an Exo node and connect it to the local relationships it affects.', next: 'Next: Macro · broader conditions' },
  macrosphere: { title: 'Macro · broader conditions', instruction: 'Connect policies, values and broader conditions to the settings or local relationships they affect. Choose a node, then Connect from.', next: 'Finish map' },
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

function submittedPlan(project, review) {
  if (!['micro', 'exosphere'].includes(project.activeScale)) throw new Error('Relationships are created by students.');
  if (review.connections?.length) throw new Error('A node submission cannot contain relationships.');
  const next = structuredClone(project), source = activeSubmission(next), previous = source.analysis;
  const baseline = previous && !memoAnalysisIssue(previous) ? previous.nodes : [];
  const originals = new Map(baseline.map(node => [node.id, structuredClone(node)]));
  const context = memoUpdatePayload(project);
  const reviewIssue = submittedReviewIssue(review, project.activeScale, source.text, context);
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
