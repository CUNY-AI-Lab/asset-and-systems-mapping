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
    <h2 id="reflection-title" className="sr-only">Reflection</h2>
    <label className="field">
      <span className="reflection-prompt">{REFLECTION_PROMPTS[project.activeScale]}</span>
      <textarea className="reflection" aria-label="Your reflection (optional)" rows="5" maxLength={PROJECT_LIMITS.promptText}
        value={project.reflection} placeholder="Write a reflection (optional)…"
        onChange={(event) => update((draft) => { draft.reflection = event.target.value; })}
        onBlur={() => update(() => {}, 'reflection.revised', 'Level reflection revised')} />
    </label>

  </section>;
}
