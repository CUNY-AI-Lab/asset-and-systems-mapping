export const SYSTEMS_MAPPING_STAGES = Object.freeze([
  Object.freeze({
    id: 'add-source',
    label: 'Add memo',
    short: 'Memo',
    description: 'Set your focus and add the memo you will use across all four levels.',
  }),
  Object.freeze({
    id: 'review-suggestions',
    label: 'Review memo',
    short: 'Review',
    description: 'Check the evidence. Generate optional guidance or continue with your own reading.',
  }),
  Object.freeze({
    id: 'choose-what-to-map',
    label: 'Choose elements',
    short: 'Choose',
    description: 'Review suggestions, add supported items, and set open questions aside.',
  }),
  Object.freeze({
    id: 'build-map',
    label: 'Build map',
    short: 'Map',
    description: 'Arrange items, trace connections, and record evidence or notes.',
  }),
  Object.freeze({
    id: 'revise-and-export',
    label: 'Revise and export',
    short: 'Revision',
    description: 'Review this level alongside earlier work, record changes, and export a copy.',
  }),
]);

export const SYSTEMS_MAPPING_STAGE_IDS = Object.freeze(SYSTEMS_MAPPING_STAGES.map(({ id }) => id));

export function systemsMappingStage(stageId) {
  return SYSTEMS_MAPPING_STAGES.find(({ id }) => id === stageId) ?? null;
}
