export const SYSTEMS_MAPPING_STAGES = Object.freeze([
  Object.freeze({
    id: 'add-source',
    label: 'Add memo',
    short: 'Memo',
    description: 'Set your focus and add a memo for all four levels',
  }),
  Object.freeze({
    id: 'review-suggestions',
    label: 'Review memo',
    short: 'Review',
    description: 'Review memo evidence and optional guidance',
  }),
  Object.freeze({
    id: 'choose-what-to-map',
    label: 'Choose elements',
    short: 'Choose',
    description: 'Choose supported map items and set questions aside',
  }),
  Object.freeze({
    id: 'build-map',
    label: 'Build map',
    short: 'Map',
    description: 'Arrange items, trace connections, and record evidence',
  }),
  Object.freeze({
    id: 'revise-and-export',
    label: 'Review and export',
    short: 'Export',
    description: 'Review this level and export the full map',
  }),
]);

export const SYSTEMS_MAPPING_STAGE_IDS = Object.freeze(SYSTEMS_MAPPING_STAGES.map(({ id }) => id));

export function systemsMappingStage(stageId) {
  return SYSTEMS_MAPPING_STAGES.find(({ id }) => id === stageId) ?? null;
}
