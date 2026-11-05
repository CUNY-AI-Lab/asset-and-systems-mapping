import { SCALE_ORDER, stableId, withDefaultNodeLayout } from './domain.js';
import { activeSubmission, beginPart2 } from './projectMemo.js';

export const MEMO_WORKFLOW = Object.freeze({
  micro: { title: 'Micro · local nodes', instruction: 'Submit your first memo to add people, places and resources to the map.', next: 'Next: Meso · draw relationships' },
  meso: { title: 'Meso · local relationships', instruction: 'Select a node on the map, choose Connect from, then select the other node.', next: 'Next: Exo · add second memo' },
  exosphere: { title: 'Exo · outside settings', instruction: 'Submit your second memo to add Exo settings and Macro conditions. Then select an Exo node and connect it to the local relationships it affects.', next: 'Next: Macro · broader conditions' },
  macrosphere: { title: 'Macro · broader conditions', instruction: 'Connect policies, values and broader conditions to the settings or local relationships they affect. Choose a node, then Connect from.', next: 'Finish map' },
});

// A submitted memo may append nodes. It can never create, retire or rewrite
// relationships, or replace a student's existing nodes and saved placement.
export function appendSubmittedNodes(project, review) {
  if (!['micro', 'exosphere'].includes(project.activeScale)) throw new Error('Relationships are created by students.');
  if (review.connections?.length) throw new Error('A node submission cannot contain relationships.');
  const existing = new Set([...project.graph.nodes, ...project.candidates.nodes.filter(node => ['rejected', 'research lead'].includes(node.status))].map(node => `${node.scale}:${node.label.trim().toLocaleLowerCase()}`));
  const fingerprint = stableId('src', activeSubmission(project).text);
  const added = [];
  for (const node of review.nodes || []) {
    if (!(project.activeScale === 'micro' ? node.scale === 'micro' : ['exosphere', 'macrosphere'].includes(node.scale))) throw new Error('The memo returned a node for another step.');
    const key = `${node.scale}:${node.label.trim().toLocaleLowerCase()}`;
    if (existing.has(key)) continue;
    existing.add(key);
    const id = stableId('node', key);
    if (project.graph.nodes.some(item => item.id === id)) throw new Error('The memo returned a conflicting node.');
    added.push({ id, label: node.label, type: node.type, scale: node.scale,
      status: 'confirmed', claimState: 'inference', origin: 'model suggestion', reviewDecision: 'added',
      evidence: node.evidence || '', sourceFingerprint: fingerprint, notes: '',
      ...(node.scale === 'micro' ? { focalParticipation: 'unclear', settingNodeIds: [] } : { basis: node.basis || 'memo' }),
      annotations: { analytical: { id: stableId('annotation', `${id}:analytical`), text: '' }, evidence: { id: stableId('annotation', `${id}:evidence`), text: '' } },
    });
  }
  const placed = withDefaultNodeLayout(added);
  project.graph.nodes.push(...placed);
  const ids = new Set(placed.map(node => node.id));
  project.candidates.nodes = project.candidates.nodes.filter(node => !ids.has(node.id));
  project.candidates.nodes.push(...structuredClone(placed));
  if (project.activeScale === 'exosphere') project.releasedScales = [...SCALE_ORDER];
  project.stage = 3;
  project.furthestStage = Math.max(project.furthestStage || 0, 3);
  return placed.length;
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
