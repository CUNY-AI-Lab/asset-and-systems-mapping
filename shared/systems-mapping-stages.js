export const SYSTEMS_MAPPING_STAGES = Object.freeze([
  Object.freeze({
    id: 'add-source',
    label: 'add your memo',
    short: 'Memo',
    description: 'Students choose a scale and add the memo they will use to begin the map.',
  }),
  Object.freeze({
    id: 'review-suggestions',
    label: 'review your memo',
    short: 'Review',
    description: 'Students identify what the memo supports, what remains uncertain, and what they want to ask their instructor.',
  }),
  Object.freeze({
    id: 'choose-what-to-map',
    label: 'choose nodes and connections',
    short: 'Connections',
    description: 'Students choose supported nodes first, then confirm and edit how those nodes connect, and can ask the custom AI model for further connection suggestions.',
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
