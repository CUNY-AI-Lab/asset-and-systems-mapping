export const SYSTEMS_MAPPING_STAGES = Object.freeze([
  Object.freeze({
    id: 'add-source',
    label: 'Add memo',
    short: 'Memo',
    description: 'Students add one memo. It stays with the project through all four levels.',
  }),
  Object.freeze({
    id: 'review-suggestions',
    label: 'Review memo',
    short: 'Review',
    description: 'Students check what the memo supports and mark what remains uncertain.',
  }),
  Object.freeze({
    id: 'choose-what-to-map',
    label: 'Choose elements',
    short: 'Choose',
    description: 'Students choose supported items for the current level and check how they relate.',
  }),
  Object.freeze({
    id: 'build-map',
    label: 'Build map',
    short: 'Map',
    description: 'Students arrange the map, check how its items relate, and add evidence or notes.',
  }),
  Object.freeze({
    id: 'revise-and-export',
    label: 'Revise and export',
    short: 'Revision',
    description: 'Students record what changed, note open questions, and prepare an export.',
  }),
]);

export const SYSTEMS_MAPPING_STAGE_IDS = Object.freeze(SYSTEMS_MAPPING_STAGES.map(({ id }) => id));

export function systemsMappingStage(stageId) {
  return SYSTEMS_MAPPING_STAGES.find(({ id }) => id === stageId) ?? null;
}
