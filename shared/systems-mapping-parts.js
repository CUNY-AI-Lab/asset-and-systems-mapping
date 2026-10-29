export const SYSTEMS_MAPPING_LEVELS = Object.freeze([
  Object.freeze({
    id: 'micro',
    title: 'Micro-level',
    partId: 'part-1',
    description: 'People, groups, roles, activities, objects, resources, and immediate settings the focal person directly encounters.',
    prompt: 'Which settings does the focal person participate in directly, and what people, groups, roles, activities, objects, and resources are part of those settings?',
    reviewInstruction: 'Find immediate settings in which the focal person participates. Then identify specific people, groups, roles, activities, objects, or resources present there. Relationships are added during Meso.',
    chooseInstruction: 'Each Micro-level item names one immediate setting, person, group, role, activity, object, or resource. Keep the evidence for each item so you can connect it during Meso.',
    checklist: Object.freeze([
      'Name each immediate setting and each relevant person, group, role, activity, object, or resource as a discrete map item.',
      'Arrange the items around the focal person and record evidence for each one.',
      'Record whose voices you have heard and whose are missing.',
    ]),
  }),
  Object.freeze({
    id: 'meso',
    title: 'Meso-level',
    partId: 'part-1',
    description: 'Relationships between the people, groups, resources, and settings already mapped at Micro-level.',
    prompt: 'How do the nodes in your Micro map affect or interact with one another?',
    reviewInstruction: 'Find evidence for relationships between existing Micro nodes and describe what passes between them.',
    chooseInstruction: 'Connect two existing Micro nodes, describe their relationship, and choose a one-way or two-way arrow.',
    checklist: Object.freeze([
      'Keep the same nodes and their positions from Micro-level.',
      'Choose a first node and a second node to connect.',
      'Name the relationship, choose its direction, and record the supporting evidence.',
      'Record documented strength, channel, connecting work, family counts, and missing pairs.',
    ]),
  }),
  Object.freeze({
    id: 'exosphere',
    title: 'Exo-level',
    partId: 'part-2',
    description: 'Outside decision settings the focal person does not participate in, whose actions change what happens in a Micro-level setting.',
    prompt: 'Which outside decision settings affect what happens in the focal person’s immediate settings?',
    reviewInstruction: 'Trace named outside offices and their funding or decision paths, including the Micro-level settings affected.',
    chooseInstruction: 'Each Exo-level item names an outside decision setting and connects it to another outside office or the Micro-level setting its action changes.',
    checklist: Object.freeze([
      'Name the outside office, agency, funder, service system, or decision-making body.',
      'Trace each outside decision setting to another outside office or an immediate setting it affects.',
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
