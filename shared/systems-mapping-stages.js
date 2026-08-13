export const SYSTEMS_MAPPING_STAGES = Object.freeze([
  Object.freeze({
    id: 'add-source',
    label: 'choose a scale and add a source',
    short: 'Source',
    description: 'Students choose a scale, add a source, and record the details needed to use it in the map.',
  }),
  Object.freeze({
    id: 'review-suggestions',
    label: 'review source with your instructor',
    short: 'Review',
    description: 'Students identify what the source supports, what remains uncertain, and what they want to ask their instructor.',
  }),
  Object.freeze({
    id: 'choose-what-to-map',
    label: 'choose nodes and describe connections',
    short: 'Connections',
    description: 'Students choose supported nodes and relationships, then describe connections for the custom AI model to suggest.',
  }),
  Object.freeze({
    id: 'build-map',
    label: 'build map',
    short: 'Map',
    description: 'Students arrange, connect, and annotate map elements while linking claims to evidence.',
  }),
  Object.freeze({
    id: 'revise-and-export',
    label: 'revise and export',
    short: 'Revision',
    description: 'Students reconsider claims, record what changed, and decide what can be shared.',
  }),
]);

export const SYSTEMS_MAPPING_STAGE_IDS = Object.freeze(SYSTEMS_MAPPING_STAGES.map(({ id }) => id));

export function systemsMappingStage(stageId) {
  return SYSTEMS_MAPPING_STAGES.find(({ id }) => id === stageId) ?? null;
}
