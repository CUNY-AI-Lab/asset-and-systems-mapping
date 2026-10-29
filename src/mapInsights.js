import { relationshipDescription } from './relationshipDirection.js';
import { SYSTEMS_MAPPING_SCALE_IDS } from '../shared/systems-mapping-parts.js';

export function isLiveMapItem(item) {
  return item.status !== 'rejected' && item.claimState !== 'retired';
}

export function hasMapEvidence(item) {
  return Boolean([item.evidence, item.evidenceExcerpt].some((value) => String(value || '').trim())
    || item.claimEvidence?.some((record) => String(record.sourcePassage || '').trim())
    || item.evidenceRefs?.some((record) => [record.evidence, record.evidenceExcerpt].some((value) => String(value || '').trim())));
}

export function needsEvidenceReview(item) {
  return !hasMapEvidence(item) || ['research lead', 'inference', 'contested'].includes(item.claimState)
    || ['pending', 'research lead'].includes(item.status);
}

// Index recorded relationships, scopes, and setting memberships separately.
// Traversing a scope never creates a directional or causal graph edge.
export function indexMapConnections(graph) {
  const nodes = graph.nodes.filter(isLiveMapItem);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const links = [];
  const byNode = new Map(nodes.map((node) => [node.id, []]));
  const add = (link) => {
    if (link.source === link.target || !nodeById.has(link.source) || !nodeById.has(link.target)) return;
    links.push(link);
    byNode.get(link.source).push(link);
    byNode.get(link.target).push(link);
  };
  graph.edges.filter(isLiveMapItem).forEach((edge) => add({
    id: `edge:${edge.id}`, kind: 'relationship', source: edge.source, target: edge.target, edge,
  }));
  nodes.forEach((node) => {
    if (['meso', 'macrosphere'].includes(node.scale)) {
      new Set(node.scopeNodeIds || []).forEach((target) => add({
        id: `scope:${node.id}:${target}`, kind: node.scale === 'meso' ? 'mesosystem' : 'condition',
        source: node.id, target,
      }));
    }
    if (node.scale === 'micro') {
      new Set(node.settingNodeIds || []).forEach((target) => add({
        id: `setting:${node.id}:${target}`, kind: 'setting', source: node.id, target,
      }));
    }
  });
  return { nodes, nodeById, links, byNode };
}

export function describeMapConnection(link, nodeId, nodeById) {
  const source = nodeById.get(link.source);
  const target = nodeById.get(link.target);
  const outgoing = link.source === nodeId;
  const other = outgoing ? target : source;
  if (link.kind === 'relationship') return {
    group: 'Direct relationships and decision pathways', kind: 'edge', id: link.edge.id,
    label: relationshipDescription(link.edge, source.label, target.label), scale: link.edge.scale,
  };
  const groups = {
    mesosystem: outgoing ? 'Included Micro settings' : 'Part of mesosystems',
    condition: outgoing ? 'Affected map items' : 'Broader conditions',
    setting: outgoing ? 'Immediate settings' : 'People and elements in this setting',
  };
  return { group: groups[link.kind], kind: 'node', id: other.id, label: other.label, scale: other.scale };
}

export function summarizeMap(project) {
  const index = indexMapConnections(project.graph);
  const edges = index.links.filter((link) => link.kind === 'relationship').map((link) => link.edge);
  const levels = SYSTEMS_MAPPING_SCALE_IDS.map((scale) => {
    const nodes = index.nodes.filter((node) => node.scale === scale);
    const relationships = edges.filter((edge) => edge.scale === scale);
    return {
      scale, nodes: nodes.length, relationships: relationships.length,
      scopeLinks: index.links.filter((link) => ['mesosystem', 'condition'].includes(link.kind)
        && index.nodeById.get(link.source).scale === scale).length,
      evidenceToReview: [...nodes, ...relationships].filter(needsEvidenceReview).length,
      setAside: [...project.candidates.nodes, ...project.candidates.edges]
        .filter((item) => item.scale === scale && item.status === 'research lead'
          && !project.graph[item.source ? 'edges' : 'nodes'].some((mapped) => mapped.id === item.id && isLiveMapItem(mapped))).length,
    };
  });
  return {
    levels, nodes: index.nodes.length, relationships: edges.length,
    crossLevelLinks: index.links.filter((link) => index.nodeById.get(link.source).scale !== index.nodeById.get(link.target).scale).length,
    evidenceToReview: [...index.nodes, ...edges].filter(needsEvidenceReview).length,
  };
}
