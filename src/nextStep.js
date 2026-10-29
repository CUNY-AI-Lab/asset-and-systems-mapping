import { SCALE_ORDER, SCALES, isExosphereDecisionPathway } from './domain.js';
import { isLiveMapItem, needsEvidenceReview } from './mapInsights.js';
import { requiresInitialModel, requiresLevelModel } from './mappingCycle.js';
import { hasFieldNotes } from '../shared/field-notes.js';

// The Studio shows one computed next action instead of a five-step footer.
// Every rule reads saved project state; none depends on a model response.
// Stage numbers stay the record of progress; the panel mode is derived from them.

const STRUCTURE_MISSING = Object.freeze({
  micro: 'an element from your memo',
  meso: 'a relationship between two Micro items',
  exosphere: 'an outside decision setting with a pathway into a Micro setting',
  macrosphere: 'a broader condition scoped to two map items',
});

export const PANEL_MODES = Object.freeze(['suggestions', 'inspector', 'review']);

const liveNodes = (project, scale) => project.graph.nodes.filter((node) => isLiveMapItem(node) && node.scale === scale);
const liveEdges = (project, scale) => project.graph.edges.filter((edge) => isLiveMapItem(edge) && edge.scale === scale);

export function levelStructureStatus(project, scale = project.activeScale) {
  const nodes = liveNodes(project, scale);
  let ready = false;
  if (scale === 'micro') ready = nodes.length > 0;
  else if (scale === 'meso') ready = liveEdges(project, scale).some((edge) => edge.source !== edge.target && project.graph.nodes.some((node) => node.id === edge.source && node.scale === 'micro' && isLiveMapItem(node)) && project.graph.nodes.some((node) => node.id === edge.target && node.scale === 'micro' && isLiveMapItem(node)));
  else if (scale === 'macrosphere') ready = nodes.some((node) => new Set(node.scopeNodeIds || []).size >= 2);
  else if (scale === 'exosphere') {
    const nodeById = new Map(project.graph.nodes.filter(isLiveMapItem).map((node) => [node.id, node]));
    ready = nodes.length > 0 && liveEdges(project, scale)
      .some((edge) => isExosphereDecisionPathway(nodeById.get(edge.source), nodeById.get(edge.target)));
  }
  return { ready, missing: ready ? null : STRUCTURE_MISSING[scale] };
}

export function undecidedCandidates(project, scale = project.activeScale) {
  return [...project.candidates.nodes, ...project.candidates.edges]
    .filter((item) => item.scale === scale && item.status === 'pending');
}

export function evidenceGaps(project, scale = project.activeScale) {
  return [...liveNodes(project, scale), ...liveEdges(project, scale)].filter(needsEvidenceReview);
}

export function levelRailState(project) {
  return SCALE_ORDER.map((scale) => {
    const current = project.activeScale === scale;
    const complete = project.completedScales.includes(scale);
    const released = project.releasedScales.includes(scale);
    return {
      scale,
      label: SCALES[scale].label,
      current,
      complete,
      state: current ? 'current' : complete ? 'complete' : released ? 'available' : 'locked',
      stage: project.levelProgress?.[scale]?.stage ?? (current ? project.stage : 1),
    };
  });
}

export function panelModeForStage(stage) {
  if (stage <= 2) return 'suggestions';
  if (stage === 3) return 'inspector';
  return 'review';
}

export function stageForPanelMode(mode, project) {
  if (mode === 'suggestions') return requiresLevelModel(project) ? 1 : 2;
  if (mode === 'inspector') return 3;
  return 4;
}

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

export function nextStep(project, { reviewBusy = false, retryPending = false, initialModelRequired = requiresInitialModel(project) } = {}) {
  const scale = project.activeScale;
  const label = SCALES[scale].label;
  const hasMemo = Boolean(project.submission.text.trim());
  const nextScale = SCALE_ORDER[SCALE_ORDER.indexOf(scale) + 1] || null;
  if (project.stage === 0) {
    return { id: 'start-review', label: 'Memo review', detail: hasMemo ? `Read the memo for ${label}` : 'Add a memo to begin', blocking: false };
  }
  if (project.stage === 1) {
    const needsModel = requiresLevelModel(project);
    const blocking = Boolean(reviewBusy) || retryPending || (initialModelRequired && !hasMemo);
    return {
      id: needsModel ? 'read-memo' : 'prepare-candidates',
      label: 'Continue →',
      detail: !hasMemo ? 'Add a memo to begin' : reviewBusy ? 'Reading your memo…' : retryPending ? 'Waiting before the next attempt' : needsModel ? `Read the memo for ${label}` : 'Review the suggestions',
      blocking,
    };
  }
  if (project.stage === 2) {
    const undecided = undecidedCandidates(project, scale).length;
    return { id: 'open-map', label: 'Open map', detail: undecided ? `${plural(undecided, 'suggestion')} to decide` : 'Choose what enters the map', blocking: false };
  }
  if (project.stage === 3) {
    const structure = levelStructureStatus(project, scale);
    const gaps = evidenceGaps(project, scale).length;
    return {
      id: 'review-level',
      label: 'Field Notes',
      detail: !structure.ready ? `Add ${structure.missing}` : gaps ? `${plural(gaps, 'item')} need${gaps === 1 ? 's' : ''} evidence` : `${label} is ready to review`,
      blocking: false,
      structureReady: structure.ready,
    };
  }
  if (nextScale) return { id: 'continue-level', label: `Continue to ${SCALES[nextScale].label}`, detail: hasFieldNotes(project) ? `${label} reviewed` : 'Add Field Notes to continue', blocking: !hasFieldNotes(project) };
  if (project.completedScales.includes(scale)) return { id: 'project-complete', label: 'Project complete', detail: 'Export or revise any level', blocking: true };
  return { id: 'complete-level', label: `Complete ${label}`, detail: hasFieldNotes(project) ? 'Finish the cumulative map' : 'Add Field Notes to finish', blocking: !hasFieldNotes(project) };
}
