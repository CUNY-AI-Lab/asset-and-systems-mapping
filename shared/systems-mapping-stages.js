export const SYSTEMS_MAPPING_STAGES = Object.freeze([
  Object.freeze({
    id: 'choose-scale',
    label: 'Choose a scale',
    short: 'Scale',
    description: 'Students choose the scale that bounds the work they will do next.',
  }),
  Object.freeze({
    id: 'add-source',
    label: 'Add a source',
    short: 'Source',
    description: 'Students add the source, describe its use, and state the question guiding their reading.',
  }),
  Object.freeze({
    id: 'review-suggestions',
    label: 'Review suggestions',
    short: 'Suggestions',
    description: 'Students read source-grounded prompts before sending their work to the instructor.',
  }),
  Object.freeze({
    id: 'check-instructor-response',
    label: "Check your instructor's response",
    short: 'Response',
    description: 'Students read the instructor response and return to the source when revision is needed.',
  }),
  Object.freeze({
    id: 'choose-what-to-map',
    label: 'Choose what to map',
    short: 'Candidates',
    description: 'Students decide which proposed actors and relationships belong on the map.',
  }),
  Object.freeze({
    id: 'build-map',
    label: 'Build the map',
    short: 'Map',
    description: 'Students arrange, connect, and annotate the map while preserving links to evidence.',
  }),
  Object.freeze({
    id: 'revise-and-export',
    label: 'Revise and export',
    short: 'Revision',
    description: 'Students revisit claims, record what changed, and choose what to share.',
  }),
]);

export const SYSTEMS_MAPPING_STAGE_IDS = Object.freeze(SYSTEMS_MAPPING_STAGES.map(({ id }) => id));

export function systemsMappingStage(stageId) {
  return SYSTEMS_MAPPING_STAGES.find(({ id }) => id === stageId) ?? null;
}
