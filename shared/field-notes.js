export const FIELD_NOTES_QUESTION_LIMIT = 1200;

export const DEFAULT_FIELD_NOTES_QUESTIONS = Object.freeze({
  micro: 'Which actors, settings, perspectives, or direct relationships does your Micro map leave out? What would you observe, ask, or add to address those gaps? Identify a possible link between the focal person’s everyday settings to investigate at Meso.',
  meso: 'Which connections between the focal person’s everyday settings remain missing or uncertain? What would you observe or ask to investigate them? Identify an outside decision setting and a possible effect on a Micro setting to trace at Exo.',
  exosphere: 'Which outside decisions or pathways into everyday settings remain missing or uncertain? What evidence or perspectives would help trace them? Identify a broader policy, norm, or material condition that could shape several map items to examine at Macro.',
  macrosphere: 'Which broader conditions, perspectives, or connections does your map still leave out? Describe the evidence you would seek and the actors, relationships, or scopes you would add or revise. What will you investigate in your next mapping pass?',
});

export function fieldNotesQuestions(profile) {
  return profile?.fieldNotesQuestions || DEFAULT_FIELD_NOTES_QUESTIONS;
}

export function hasFieldNotes(project) {
  return Boolean(project.reflection?.trim());
}
