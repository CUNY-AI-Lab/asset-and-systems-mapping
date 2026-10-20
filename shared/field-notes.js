export const FIELD_NOTES_QUESTION_LIMIT = 1200;

export const LEGACY_FIELD_NOTES_QUESTIONS = Object.freeze({
  micro: 'Which actors, settings, perspectives, or direct relationships does your Micro map leave out? What would you observe, ask, or add to address those gaps? Identify a possible link between the focal person’s everyday settings to investigate at Meso.',
  meso: 'Which connections between the focal person’s everyday settings remain missing or uncertain? What would you observe or ask to investigate them? Identify an outside decision setting and a possible effect on a Micro setting to trace at Exo.',
  exosphere: 'Which outside decisions or pathways into everyday settings remain missing or uncertain? What evidence or perspectives would help trace them? Identify a broader policy, norm, or material condition that could shape several map items to examine at Macro.',
  macrosphere: 'Which broader conditions, perspectives, or connections does your map still leave out? Describe the evidence you would seek and the actors, relationships, or scopes you would add or revise. What will you investigate in your next mapping pass?',
});

export const DEFAULT_FIELD_NOTES_QUESTIONS = Object.freeze({
  micro: 'What would you add or clarify about the people, resources, settings, or direct interactions in your Micro map? Name the item or relationship, evidence you have, and what you still need to check. Are there two mapped settings whose linkage you could investigate at Meso? If not, note what you need to learn first.',
  meso: 'What would you add or clarify about a linkage among two or more mapped Micro settings? Name the settings and the evidence for how they connect; leave unverified links as questions. Is there an outside decision setting worth investigating at Exo? If so, name it and what you would need to trace its effect on one of these settings.',
  exosphere: 'What would you add or clarify about an outside decision setting and its effect on a mapped Micro setting? Name the decision, the affected setting, and evidence you have or need. Might a broader policy, norm, history, or economic condition affect several map items? Note what you would investigate at Macro, or what remains unknown.',
  macrosphere: 'What would you add or clarify about a broader condition and the two or more map items it affects? Record evidence you have and what remains uncertain. Which person, relationship, setting, or source needs another look, and what would you add or revise in your next mapping pass?',
});

// Only exact application defaults advance. An instructor's replacement remains
// unchanged, even when another scale still uses an older default.
export function upgradeFieldNotesQuestions(questions) {
  if (!questions) return questions;
  return Object.fromEntries(Object.entries(questions).map(([scale, question]) => [
    scale, question === LEGACY_FIELD_NOTES_QUESTIONS[scale] ? DEFAULT_FIELD_NOTES_QUESTIONS[scale] : question,
  ]));
}

export function fieldNotesQuestions(profile) {
  return profile?.fieldNotesQuestions || DEFAULT_FIELD_NOTES_QUESTIONS;
}

export function hasFieldNotes(project) {
  return Boolean(project.reflection?.trim());
}
