export const SYSTEMS_MAPPING_LEVELS = Object.freeze([
  Object.freeze({
    id: 'micro',
    title: 'Micro-level',
    partId: 'part-1',
    description: 'People, roles, activities, objects, and immediate settings the focal person directly encounters, plus direct relationships among them.',
  }),
  Object.freeze({
    id: 'meso',
    title: 'Meso-level',
    partId: 'part-1',
    description: 'Linkages among at least two immediate settings already mapped at Micro-level, without adding a directional relationship.',
  }),
  Object.freeze({
    id: 'exosphere',
    title: 'Exo-level',
    partId: 'part-2',
    description: 'Outside decision settings the focal person does not participate in, whose actions change what happens in a Micro-level setting.',
  }),
  Object.freeze({
    id: 'macrosphere',
    title: 'Macro-level',
    partId: 'part-2',
    description: 'Broader laws, public policies, economic conditions, histories, and cultural beliefs that affect more than one map item.',
  }),
]);

export const SYSTEMS_MAPPING_PARTS = Object.freeze([
  Object.freeze({
    id: 'part-1',
    label: 'Part 1',
    scaleIds: Object.freeze(['micro', 'meso']),
  }),
  Object.freeze({
    id: 'part-2',
    label: 'Part 2',
    scaleIds: Object.freeze(['exosphere', 'macrosphere']),
  }),
]);

export const SYSTEMS_MAPPING_SCALE_IDS = Object.freeze(
  SYSTEMS_MAPPING_PARTS.flatMap(({ scaleIds }) => scaleIds),
);

export function systemsMappingLevel(scaleId) {
  return SYSTEMS_MAPPING_LEVELS.find((level) => level.id === scaleId) ?? null;
}

export function systemsMappingLevelTitle(scaleId) {
  return systemsMappingLevel(scaleId)?.title ?? '';
}

export function systemsMappingPartForScale(scaleId, parts = SYSTEMS_MAPPING_PARTS) {
  return parts.find((part) => part.scaleIds.includes(scaleId)) ?? null;
}
