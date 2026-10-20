import React from 'react';
import { PROJECT_LIMITS } from './domain.js';
import { fieldNotesQuestions } from '../shared/field-notes.js';
import { SYSTEMS_MAPPING_LEVELS } from '../shared/systems-mapping-parts.js';
import { fieldNotesExcerpt } from '../shared/field-notes-context.js';

export { DEFAULT_FIELD_NOTES_QUESTIONS as REFLECTION_PROMPTS } from '../shared/field-notes.js';

// Keep the original string intact, including older labeled Macro syntheses.
// Viewing this component never parses, reformats or overwrites student prose.
export default function ReflectionEntry({ project, update }) {
  const question = fieldNotesQuestions(project.teacherGovernance?.preflight)[project.activeScale];
  const earlier = SYSTEMS_MAPPING_LEVELS.filter(({ id }) => id !== project.activeScale && project.levelProgress?.[id]?.reflection?.trim());
  const nextLevel = SYSTEMS_MAPPING_LEVELS[SYSTEMS_MAPPING_LEVELS.findIndex(({ id }) => id === project.activeScale) + 1];
  const excerpt = nextLevel ? fieldNotesExcerpt(project.activeScale, project.reflection) : null;
  return <section className="reflection-entry" aria-labelledby="reflection-title">
    <h2 id="reflection-title" className="sr-only">Field Notes</h2>
    <label className="field">
      <span id="field-notes-question" className="reflection-prompt">{question}</span>
      <textarea className="reflection" aria-label="Field notes (required)" aria-describedby="field-notes-question field-notes-hint" required rows="5" maxLength={PROJECT_LIMITS.promptText}
        value={project.reflection}
        onChange={(event) => update((draft) => { draft.reflection = event.target.value; })}
        onBlur={() => update(() => {}, 'reflection.revised', 'Field Notes revised')} />
    </label>
    <p id="field-notes-hint" className="field-notes-hint">Required to continue. You can return to the map while you write.</p>
    {nextLevel && <p className="field-notes-hint">{excerpt?.truncated
      ? `The ${nextLevel.title} memo review receives an opening excerpt of these notes. Your full note stays saved.`
      : `These notes carry into the ${nextLevel.title} memo review as your notes, separate from the memo.`}</p>}
    {earlier.length > 0 && <details className="field-notes-archive"><summary>Notes from other scales</summary>
      {earlier.map(({ id, title }) => <section key={id}><h3>{title}</h3><p>{project.levelProgress[id].reflection}</p></section>)}
    </details>}
  </section>;
}
