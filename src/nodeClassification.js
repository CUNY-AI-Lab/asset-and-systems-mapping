import { MICRO_NODE_TYPES, validateProject } from './domain.js';
import { EXO_NODE_TYPES, MACRO_CONDITION_TYPES } from '../shared/node-submission.js';
import { correspondingNode, nodeLabelIssue } from './mapTextEditing.js';

const CLASSIFICATION_TYPES = Object.freeze({ micro: MICRO_NODE_TYPES, exosphere: EXO_NODE_TYPES, macrosphere: MACRO_CONDITION_TYPES });
export function nodeClassificationTypes(scale) {
  return CLASSIFICATION_TYPES[scale] || [];
}

// An explicit student correction keeps the node's identity, evidence, placement
// and relationships. Test the whole change before touching the saved project.
export function reclassifyNode(project, id, scale, type) {
  if (!nodeClassificationTypes(scale).includes(type)) {
    return 'Choose a type that belongs in this system.';
  }
  const next = structuredClone(project);
  const node = next.graph.nodes.find(item => item.id === id);
  if (!node) return 'Select a node to change its classification.';
  if (node.scale === scale && node.type === type) return '';
  const labelIssue = nodeLabelIssue(node.label, { ...node, scale, type }, next.graph.nodes);
  if (labelIssue) return labelIssue;
  const candidate = correspondingNode(node, next.candidates.nodes);
  for (const item of [node, candidate].filter(Boolean)) {
    if (scale !== item.scale && ((item.scopeNodeIds || []).length || (item.settingNodeIds || []).length || item.mesoExplanation?.trim() || item.deontic?.trim())) {
      return 'Update this node’s setting or group memberships before changing its system.';
    }
    if (scale !== item.scale) {
      delete item.scopeNodeIds;
      delete item.deontic;
      delete item.mesoExplanation;
      if (scale === 'micro') {
        item.settingNodeIds = [];
        item.focalParticipation = 'unclear';
      } else {
        delete item.settingNodeIds;
        delete item.focalParticipation;
      }
    }
    item.scale = scale;
    item.type = type;
    // Changing classification is not an Add to map action. Preserve removed,
    // pending and set-aside decisions in both the graph and candidate record.
    if (item.status === 'confirmed' && item.claimState !== 'retired' && !['removed', 'set aside'].includes(item.reviewDecision)) {
      item.claimState = 'student interpretation';
    }
  }
  try { validateProject(next); }
  catch { return 'This change conflicts with a saved connection or setting. Update that connection or setting first.'; }
  project.graph = next.graph;
  project.candidates = next.candidates;
  return '';
}
