export const RELATIONSHIP_PROCESS_TEXT_FIELDS = Object.freeze([
  'frequency', 'duration', 'direction', 'conditions', 'changeOverTime', 'channel', 'connectingWork',
]);
export const RELATIONSHIP_STRENGTHS = Object.freeze(['strong', 'weak', 'contested', 'unknown']);
export const RELATIONSHIP_STATUSES = Object.freeze(['observed', 'missing', 'unknown']);
export const RELATIONSHIP_PROCESS_FIELDS = Object.freeze([...RELATIONSHIP_PROCESS_TEXT_FIELDS, 'strength', 'familyCount', 'connectionStatus']);

export function relationshipProcessIssue(process) {
  if (!process || typeof process !== 'object' || Array.isArray(process)) return 'must be an object';
  for (const [field, value] of Object.entries(process)) {
    if (!RELATIONSHIP_PROCESS_FIELDS.includes(field)) return `${field} is not an allowed schema field`;
    if (RELATIONSHIP_PROCESS_TEXT_FIELDS.includes(field) && (typeof value !== 'string' || value.length > 1000)) return `${field} must be bounded text`;
    if (field === 'strength' && !RELATIONSHIP_STRENGTHS.includes(value)) return 'strength must be strong, weak, contested, or unknown';
    if (field === 'connectionStatus' && !RELATIONSHIP_STATUSES.includes(value)) return 'connectionStatus must be observed, missing, or unknown';
    if (field === 'familyCount' && value !== null && (!Number.isSafeInteger(value) || value < 0)) return 'familyCount must be a nonnegative integer or null';
  }
  return null;
}


// Model transport sometimes represents an unknown optional field as null.
// Normalize only that representation and explicit direction synonyms; preserve
// every other value so schema and source checks can reject it visibly.
export function normalizeGeneratedRelationshipProcess(process) {
  if (!process || typeof process !== 'object' || Array.isArray(process)) return process;
  const normalized = { ...process };
  for (const field of RELATIONSHIP_PROCESS_TEXT_FIELDS) if (normalized[field] === null) normalized[field] = '';
  for (const field of ['strength', 'connectionStatus']) if (normalized[field] === null) normalized[field] = 'unknown';
  const directions = {
    unknown: 'not yet known', 'not yet known': 'not yet known', varies: 'varies',
    'both directions': 'both directions', bidirectional: 'both directions', 'two-way': 'both directions', 'two way': 'both directions', '↔': 'both directions',
    'source to target': 'source to target', 'source-to-target': 'source to target', 'source_to_target': 'source to target', '→': 'source to target',
    'target to source': 'target to source', 'target-to-source': 'target to source', 'target_to_source': 'target to source', '←': 'target to source',
  };
  if (typeof normalized.direction === 'string') normalized.direction = directions[normalized.direction.trim().toLowerCase()] || normalized.direction;
  return normalized;
}


export function relationshipDescription(edge, sourceLabel = edge.sourceLabel, targetLabel = edge.targetLabel) {
  if (edge.relationshipIds?.length) targetLabel = `${edge.relationshipIds.length} local ${edge.relationshipIds.length === 1 ? 'relationship' : 'relationships'}`;
  const direction = edge.relationshipProcess?.direction || 'source to target';
  if (edge.relationshipProcess?.connectionStatus === 'missing') return `Missing connection between ${sourceLabel} and ${targetLabel}: ${edge.verb}`;
  if (direction === 'target to source') return `${targetLabel} ${edge.verb} ${sourceLabel}`;
  if (!['source to target', 'both directions'].includes(direction)) return `${sourceLabel} — ${edge.verb} — ${targetLabel}, ${direction === 'varies' ? 'direction varies' : direction === 'not yet known' ? 'direction not yet known' : `direction: ${direction}`}`;
  const description = `${sourceLabel} ${edge.verb} ${targetLabel}`;
  return direction === 'both directions' ? `${description}, both directions` : description;
}
