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
    ]),
  }),
  Object.freeze({
    id: 'exosphere',
    title: 'Exo-level',
    partId: 'part-2',
    description: 'Larger-scale institutions, resources, policies and conditions that shape the local map.',
    prompt: 'Which larger-scale institutions, resources, policies and conditions help explain the local nodes and relationships already mapped?',
    reviewInstruction: 'Build on the Micro and Meso map by identifying additional larger-scale nodes. Keep earlier work visible; connect the larger-scale nodes during Macro.',
    chooseInstruction: 'Choose larger-scale nodes to add to the same map. Keep their evidence and connect them during Macro.',
    checklist: Object.freeze([
      'Review the local nodes and relationships already mapped.',
      'Add larger-scale institutions, resources, policies or conditions as distinct nodes.',
      'Record evidence or questions that will help connect them during Macro.',
    ]),
  }),
  Object.freeze({
    id: 'macrosphere',
    title: 'Macro-level',
    partId: 'part-2',
    description: 'Relationships among larger-scale nodes and connections to the local map.',
    prompt: 'How do the larger-scale nodes interact, and how do they connect to the local nodes and relationships already mapped?',
    reviewInstruction: 'Connect existing larger-scale nodes and trace their relationships to earlier local nodes. Preserve the same nodes and their positions.',
    chooseInstruction: 'Choose two existing nodes, describe their relationship if known, and select its direction. Cross-scale connections are allowed.',
    checklist: Object.freeze([
      'Keep the Micro nodes, Meso relationships and Exo nodes on the map.',
      'Connect larger-scale nodes to one another and to local nodes where supported.',
      'Identify direction and evidence, leaving uncertain relationships explicit.',
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
