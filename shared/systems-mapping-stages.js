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
    label: 'choose map elements',
    short: 'Choose',
    description: 'Students decide which supported map elements to keep. Micro includes discrete actors, objects, activities, roles, groups, and immediate settings, along with direct relationships. Meso includes mesosystems formed by at least two Micro settings and no relationship edges. Exosphere includes institutions and supported institutional actions. Macrosphere includes broader conditions and the mapped elements they affect.',
  }),
  Object.freeze({
    id: 'build-map',
    label: 'build map',
    short: 'Map',
    description: 'Students arrange and annotate map elements. Micro includes direct relationships. Each Meso item names a mesosystem and identifies its included Micro settings without adding a relationship verb. Exosphere includes institutional relationships. Macrosphere shows which mapped elements each broader condition affects.',
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
