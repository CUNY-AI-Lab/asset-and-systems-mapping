export const SYSTEMS_MAPPING_LEVELS = Object.freeze([
  Object.freeze({
    id: 'micro',
    title: 'Micro-level',
    partId: 'part-1',
    description: 'People, groups, roles, activities, objects, and immediate settings the focal person directly encounters, plus direct relationships among them.',
    prompt: 'Which settings does the focal person participate in directly, and what people, groups, roles, activities, objects, and resources are part of those settings?',
    reviewInstruction: 'Find immediate settings in which the focal person participates. Then identify specific people, groups, roles, activities, objects, or resources present there and any direct interactions supported by the memo.',
    chooseInstruction: 'Each Micro-level item names one immediate setting, person, group, role, activity, object, or resource. Direct relationships describe supported interactions among those items.',
    checklist: Object.freeze([
      'Name each immediate setting and each relevant person, group, role, activity, object, or resource as a discrete map item.',
      'Describe what happens between Micro-level items with one direct verb.',
      'Record whose voices you have heard and whose are missing.',
    ]),
  }),
  Object.freeze({
    id: 'meso',
    title: 'Meso-level',
    partId: 'part-1',
    description: 'Linkages among at least two immediate settings already mapped at Micro-level, without adding a directional relationship.',
    prompt: 'Which two or more Micro-level settings form a mesosystem?',
    reviewInstruction: 'Find evidence that at least two Micro-level settings in which the focal person participates interact.',
    chooseInstruction: 'Each mesosystem uses at least two Micro-level settings already on the map and explains their interrelation without adding a directional relationship.',
    checklist: Object.freeze([
      'Use the exact names of settings already mapped at Micro-level.',
      'Group two or more settings into each mesosystem.',
      'Name the mesosystem without adding a directional relationship.',
    ]),
  }),
  Object.freeze({
    id: 'exosphere',
    title: 'Exo-level',
    partId: 'part-2',
    description: 'Outside decision settings the focal person does not participate in, whose actions change what happens in a Micro-level setting.',
    prompt: 'Which outside decision settings affect what happens in the focal person’s immediate settings?',
    reviewInstruction: 'Find a named outside decision setting, the Micro-level setting its action changes, and what changes for the focal person there.',
    chooseInstruction: 'Each Exo-level item names an outside decision setting and connects it to the Micro-level setting its action changes.',
    checklist: Object.freeze([
      'Name the outside office, agency, funder, service system, or decision-making body.',
      'Connect each outside decision setting to an immediate setting it affects.',
      'Keep decisions owned by one setting separate from broader laws, public policies, beliefs, and structures.',
    ]),
  }),
  Object.freeze({
    id: 'macrosphere',
    title: 'Macro-level',
    partId: 'part-2',
    description: 'Broader laws, public policies, economic conditions, histories, and cultural beliefs that affect more than one map item.',
    prompt: 'Which broader laws, public policies, economic conditions, histories, and cultural beliefs affect multiple map items?',
    reviewInstruction: 'Find a broader law, public policy, economic condition, history, or cultural belief that affects at least two existing map items.',
    chooseInstruction: 'Each Macro-level item names one broader condition and identifies at least two existing map items it affects.',
    checklist: Object.freeze([
      'Name broader laws, public policies, economic conditions, histories, cultural beliefs, and structures.',
      'Identify at least two map items affected by each condition and the evidence supporting that claim.',
      'Place immediate settings at Micro-level and outside decision settings at Exo-level.',
    ]),
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
