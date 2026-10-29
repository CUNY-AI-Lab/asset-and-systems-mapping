// Synthetic examples exercise the current assignment without student material.
export const MESO_OBSERVED_PASSAGE = 'The parent maintains a strong email connection with the teacher, carrying updates for 24 families.';
export const MESO_MISSING_PASSAGE = 'The therapist has no phone contact with the teacher.';
export const EXO_CHAIN_PASSAGE = 'The U.S. Department of Education funds NYSED. NYSED funds NYC Public Schools. NYC Public Schools funds P.S. 101 School.';
export const ASSIGNMENT_COMPARISON_CASES = Object.freeze([
  { id: 'meso-details-and-missing-pair', activeScale: 'meso', text: `${MESO_OBSERVED_PASSAGE} The parent and teacher exchange updates in both directions. ${MESO_MISSING_PASSAGE} These are synthetic observations for a model test.`, carriedNodes: [
    { id: 'micro_parent', label: 'Parent', type: 'role', scale: 'micro' },
    { id: 'micro_teacher', label: 'Teacher', type: 'role', scale: 'micro' },
    { id: 'micro_therapist', label: 'Therapist', type: 'role', scale: 'micro' },
  ] },
  { id: 'exo-funding-chain', activeScale: 'exosphere', text: `${EXO_CHAIN_PASSAGE} The child attends P.S. 101 School and is absent from the offices where these funding decisions occur. This is a synthetic funding-path example.`, carriedNodes: [
    { id: 'micro_school', label: 'P.S. 101 School', type: 'setting', scale: 'micro' },
  ] },
]);
