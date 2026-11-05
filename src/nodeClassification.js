import { isNodeTypeAllowedAtScale, validateProject } from './domain.js';
import { correspondingNode, nodeLabelIssue } from './mapTextEditing.js';

// An explicit student correction keeps the node's identity, evidence, placement
// and relationships. Test the whole change before touching the saved project.
export function reclassifyNode(project, id, scale, type) {
  if (!['micro', 'exosphere', 'macrosphere'].includes(scale) || !isNodeTypeAllowedAtScale(type, scale)) {
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
    item.reviewDecision = 'added';
    item.claimState = 'student interpretation';
  }
  try { validateProject(next); }
  catch { return 'This change conflicts with a saved connection or setting. Update that connection or setting first.'; }
  project.graph = next.graph;
  project.candidates = next.candidates;
  return '';
}
