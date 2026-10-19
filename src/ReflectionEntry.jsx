import React from 'react';
import { PROJECT_LIMITS } from './domain.js';

export const REFLECTION_PROMPTS = Object.freeze({
  micro: 'What did you notice or reconsider about participation in an everyday setting?',
  meso: 'What does the connection between these everyday settings help explain?',
  exosphere: 'How does an outside decision reach an everyday setting, and what remains uncertain?',
  macrosphere: 'What can your map now explain about your inquiry across the four levels?',
});

// Keep the original string intact, including older labeled Macro syntheses.
// Viewing this component never parses, reformats or overwrites student prose.
export default function ReflectionEntry({ project, update }) {
  return <section className="reflection-entry" aria-labelledby="reflection-title">
    <h2 id="reflection-title">Reflection</h2>
    <p className="reflection-prompt">{REFLECTION_PROMPTS[project.activeScale]}</p>
    <label className="field">
      <span className="field__label">Your reflection <small>(optional)</small></span>
      <textarea className="reflection" rows="5" maxLength={PROJECT_LIMITS.promptText}
        value={project.reflection} placeholder="A pattern, a revision, or a question to carry forward…"
        onChange={(event) => update((draft) => { draft.reflection = event.target.value; })}
        onBlur={() => update(() => {}, 'reflection.revised', 'Level reflection revised')} />
    </label>
    <details className="reflection-help"><summary>Prompts to help you reflect</summary>
      <ul><li>Which part of the map supports your interpretation?</li><li>What changed your mind, or whose perspective is missing?</li><li>What would you investigate or revise next?</li></ul>
    </details>
  </section>;
}
