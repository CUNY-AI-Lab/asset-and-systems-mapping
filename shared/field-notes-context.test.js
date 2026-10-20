// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FIELD_NOTES_CONTEXT_BYTES, fieldNotesExcerpt, previousFieldNotes, validateFieldNotesContext } from './field-notes-context.js';
import { studentJudgments, validateStudentJudgments } from './student-judgments.js';

const byteLength = value => Buffer.byteLength(JSON.stringify(value), 'utf8');

describe('previous-level Field Notes context', () => {
  it.each([['meso', 'micro'], ['exosphere', 'meso'], ['macrosphere', 'exosphere']])('carries only the immediately preceding note into %s', (activeScale, previousScale) => {
    const levelProgress = Object.fromEntries(['micro', 'meso', 'exosphere', 'macrosphere'].map(scale => [scale, { reflection: `${scale}: What evidence is missing?` }]));
    const context = previousFieldNotes({ activeScale, reflection: 'Current unfinished note', levelProgress });
    expect(context).toEqual({ scale: previousScale, text: levelProgress[previousScale].reflection, truncated: false });
    expect(validateFieldNotesContext(context, activeScale)).toEqual(context);
  });

  it('omits context at Micro and when the preceding note is absent or blank', () => {
    expect(previousFieldNotes({ activeScale: 'micro', levelProgress: { macrosphere: { reflection: 'A later note' } } })).toBeNull();
    expect(previousFieldNotes({ activeScale: 'meso' })).toBeNull();
    expect(fieldNotesExcerpt('micro', ' \n ')).toBeNull();
    expect(validateFieldNotesContext(undefined, 'meso')).toBeNull();
  });

  it.each(['😀漢字\n"\\', 'a'])('bounds serialized UTF-8 without changing a 64,000-character saved note (%s)', (unit) => {
    const saved = unit.repeat(Math.ceil(64_000 / unit.length)).slice(0, 64_000);
    const project = { activeScale: 'meso', levelProgress: { micro: { reflection: saved } } };
    const context = previousFieldNotes(project);
    expect(context.truncated).toBe(true);
    expect(byteLength(context)).toBeLessThanOrEqual(FIELD_NOTES_CONTEXT_BYTES);
    expect(saved.startsWith(context.text)).toBe(true);
    expect(context.text.isWellFormed()).toBe(true);
    expect(project.levelProgress.micro.reflection).toBe(saved);
    expect(project.levelProgress.micro.reflection).toHaveLength(64_000);
    expect(validateFieldNotesContext(context, 'meso')).toEqual(context);
  });

  it('leaves room for the app’s maximum map-choice context under the existing 16 KiB total', () => {
    const nodes = Array.from({ length: 24 }, (_, index) => ({
      id: `node_${index}`, label: 'L'.repeat(510), notes: 'N'.repeat(500), scale: 'micro', reviewDecision: 'added',
    }));
    const judgments = studentJudgments({ graph: { nodes, edges: [] }, candidates: { nodes: [], edges: [] } });
    expect(validateStudentJudgments(judgments)).toEqual(judgments);
    expect(byteLength(judgments)).toBeGreaterThan(10_000);
    const sourceMetadata = {
      id: 's'.repeat(200), sensitive: false, consent: false,
      studentJudgments: judgments, fieldNotes: fieldNotesExcerpt('micro', '😀'.repeat(32_000)),
    };
    expect(byteLength(sourceMetadata)).toBeLessThan(16 * 1024);
  });

  it.each([
    null,
    { scale: 'meso', text: 'Current note', truncated: false },
    { scale: 'macrosphere', text: 'Future note', truncated: false },
    { scale: 'micro', text: '', truncated: false },
    { scale: 'micro', text: 'Question', truncated: 'false' },
    { scale: 'micro', text: 'Question', truncated: false, instruction: 'Extra key' },
    { scale: 'micro', text: '😀'.repeat(600), truncated: true },
  ])('rejects invalid, wrong-level, or oversized context %#', value => {
    expect(() => validateFieldNotesContext(value, 'meso')).toThrow(/Invalid previous-level/);
  });
});
