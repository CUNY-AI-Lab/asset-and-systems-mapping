import React, { useEffect, useRef, useState } from 'react';
import { PROJECT_LIMITS } from './domain.js';
import { fieldNotesQuestions } from '../shared/field-notes.js';
import { SYSTEMS_MAPPING_LEVELS } from '../shared/systems-mapping-parts.js';
import { fieldNotesExcerpt } from '../shared/field-notes-context.js';

export { DEFAULT_FIELD_NOTES_QUESTIONS as REFLECTION_PROMPTS } from '../shared/field-notes.js';

// Keep the original string intact, including older labeled Macro syntheses.
// Viewing this component never parses, reformats or overwrites student prose.
export default function ReflectionEntry({ project, update, onSave, saveState }) {
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const revision = useRef(saveState?.savedRevision || 0);
  useEffect(() => { setDirty(false); setSaved(false); }, [project.id, project.activeScale]);
  useEffect(() => {
    if (dirty && saveState?.status === 'saved' && saveState.savedRevision > revision.current) { setDirty(false); setSaved(true); }
  }, [dirty, saveState?.status, saveState?.savedRevision]);
  const failed = ['error', 'validation'].includes(saveState?.status);
  const question = fieldNotesQuestions(project.teacherGovernance?.preflight)[project.activeScale];
  const earlier = SYSTEMS_MAPPING_LEVELS.filter(({ id }) => id !== project.activeScale && project.levelProgress?.[id]?.reflection?.trim());
  const nextLevel = SYSTEMS_MAPPING_LEVELS[SYSTEMS_MAPPING_LEVELS.findIndex(({ id }) => id === project.activeScale) + 1];
  const excerpt = nextLevel ? fieldNotesExcerpt(project.activeScale, project.reflection) : null;
  return <section className="reflection-entry" aria-labelledby="reflection-title">
    <h2 id="reflection-title" className="sr-only">Field Notes</h2>
    <label className="field">
      <span id="field-notes-question" className="reflection-prompt">{question}</span>
      <textarea className="reflection" aria-label="Field notes (required)" aria-describedby="field-notes-question" required rows="5" maxLength={PROJECT_LIMITS.promptText}
        value={project.reflection}
        onChange={(event) => { revision.current = saveState?.savedRevision || 0; setDirty(true); setSaved(false); update((draft) => { draft.reflection = event.target.value; }); }}
        onBlur={() => update(() => {}, 'reflection.revised', 'Field Notes revised')} />
    </label>
    {onSave && <div className="annotation-actions"><button type="button" className="button button--secondary" disabled={!dirty && !failed} onClick={() => { if (onSave() === true) { setDirty(false); setSaved(true); } }}>Save note</button><span role="status">{failed ? saveState.message : dirty ? 'Saving…' : saved ? 'Saved' : ''}</span></div>}
    {nextLevel && excerpt?.truncated && <p className="field-notes-hint">The {nextLevel.title} memo review receives an opening excerpt of these notes. Your full note stays saved.</p>}
    {earlier.length > 0 && <details className="field-notes-archive"><summary>Previous notes</summary>
      {earlier.map(({ id, title }) => <section key={id}><h3>{title}</h3><p>{project.levelProgress[id].reflection}</p></section>)}
    </details>}
  </section>;
}
