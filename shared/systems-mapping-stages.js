export const SYSTEMS_MAPPING_STAGES = Object.freeze([
  Object.freeze({
    id: 'add-source',
    label: 'add your memo',
    short: 'Memo',
    description: 'Students choose a level and add the memo they will use to begin the map.',
  }),
  Object.freeze({
    id: 'review-suggestions',
    label: 'review your memo',
    short: 'Review',
    description: 'Students check what the memo supports and what remains uncertain.',
  }),
  Object.freeze({
    id: 'choose-what-to-map',
    label: 'choose nodes and describe connections',
    short: 'Choose',
    description: 'Students choose supported map elements. Micro uses nodes only; later levels add and refine connections.',
  }),
  Object.freeze({
    id: 'build-map',
    label: 'build map',
    short: 'Map',
    description: 'Students arrange and annotate map elements. From Meso onward, they can also work with connections.',
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
