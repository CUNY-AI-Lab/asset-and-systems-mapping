export const MAX_GROUP_RELATIONSHIPS = 24;
const live = item => item && item.status !== 'rejected' && item.claimState !== 'retired';

export function relationshipIdsIssue(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_GROUP_RELATIONSHIPS
    || ids.some(id => typeof id !== 'string' || !id || id.length > 200)
    || new Set(ids).size !== ids.length) return 'Choose between 1 and 24 distinct local relationships.';
  return null;
}

// target remains a real local endpoint as a stable serialization anchor.
// relationshipIds, not that anchor, define the highlighted connection's scope.
export function relationshipGroupIssue(connection, nodes, relationships, scale = connection.scale) {
  if (connection.relationshipIds === undefined) return null;
  const shape = relationshipIdsIssue(connection.relationshipIds);
  if (shape) return shape;
  if (scale !== 'macrosphere') return 'Relationship groups belong to Macro.';
  const heading = nodes.find(node => node.id === connection.source);
  if (!live(heading) || !['exosphere', 'macrosphere'].includes(heading.scale)) return 'Choose a live macrosystem heading.';
  const byId = new Map(relationships.map(edge => [edge.id, edge]));
  const selected = connection.relationshipIds.map(id => byId.get(id));
  if (selected.some(edge => !live(edge) || edge.scale !== 'meso' || edge.relationshipIds)) return 'Choose live Meso relationships already on the map.';
  const liveNodeIds = new Set(nodes.filter(live).map(node => node.id));
  if (selected.some(edge => !liveNodeIds.has(edge.source) || !liveNodeIds.has(edge.target))) return 'Restore the local relationship endpoints first.';
  if (!selected.some(edge => [edge.source, edge.target].includes(connection.target))) return 'The group anchor must belong to a selected relationship.';
  return null;
}

export function groupedRelationships(connection, relationships) {
  const ids = new Set(connection.relationshipIds || []);
  return relationships.filter(edge => ids.has(edge.id));
}
