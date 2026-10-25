// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReflectionEntry, { REFLECTION_PROMPTS } from './ReflectionEntry.jsx';
import { createDefaultProject, serializeProject, parseProject } from './domain.js';
import { LEGACY_FIELD_NOTES_QUESTIONS, PREVIOUS_FIELD_NOTES_QUESTIONS } from '../shared/field-notes.js';

afterEach(cleanup);

describe('Field Notes', () => {
  it('shows the published scale question and preserves readable notes from other scales', () => {
    const project = createDefaultProject();
    project.activeScale = 'meso';
    project.teacherGovernance = { preflight: { fieldNotesQuestions: { ...REFLECTION_PROMPTS, meso: 'Whose account of the home–school linkage is missing?' } } };
    project.levelProgress.micro.reflection = 'Ask the home attendant about direct interactions.\nKeep the observation separate from an inference.';
    const update = vi.fn();
    render(<ReflectionEntry project={project} update={update} />);
    expect(screen.getByText('Whose account of the home–school linkage is missing?')).toBeVisible();
    expect(document.getElementById('field-notes-question').textContent).toBe('Whose account of the home–school linkage is missing?');
    fireEvent.click(screen.getByText('Notes from other scales'));
    expect(screen.getByRole('heading', { name: 'Micro-level' })).toBeVisible();
    expect(screen.getByText(/Ask the home attendant/)).toBeVisible();
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ['micro', 'What did you notice while mapping the Micro scale?', 'Which nodes might help you begin mapping the Meso scale?'],
    ['meso', 'What did you notice while mapping the Meso scale?', 'Which nodes might help you begin mapping the Exo scale?'],
    ['exosphere', 'What did you notice while mapping the Exo scale?', 'Which nodes might help you begin mapping the Macro scale?'],
    ['macrosphere', 'What did you notice while mapping the Macro scale?', null],
  ])('shows the selected questions at %s as one paragraph in the required writing field', (scale, first, second) => {
    const project = createDefaultProject();
    project.activeScale = scale;
    const update = vi.fn();
    render(<ReflectionEntry project={project} update={update} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByRole('textbox').required).toBe(true);
    expect(document.getElementById('field-notes-question').textContent).toBe([first, second].filter(Boolean).join(' '));
    expect(update).not.toHaveBeenCalled();
  });

  it.each([LEGACY_FIELD_NOTES_QUESTIONS, PREVIOUS_FIELD_NOTES_QUESTIONS])('refreshes cached application defaults without rewriting saved answers or profiles (%#)', (questions) => {
    const project = createDefaultProject();
    project.activeScale = 'meso';
    project.reflection = 'My earlier note.\nI have not separated this into two answers.\n😀';
    project.levelProgress.meso.reflection = project.reflection;
    project.teacherGovernance = { preflight: { fieldNotesQuestions: { ...questions, exosphere: 'Keep this instructor-authored question exactly.' } } };
    const original = structuredClone(project);
    const update = vi.fn();
    render(<ReflectionEntry project={project} update={update} />);
    expect(document.getElementById('field-notes-question').textContent).toBe(REFLECTION_PROMPTS.meso);
    expect(screen.getByRole('textbox')).toHaveValue(original.reflection);
    expect(project).toEqual(original);
    expect(update).not.toHaveBeenCalled();
  });

  it('preserves an older labeled Macro synthesis and all other levels when editing', () => {
    const project = createDefaultProject();
    project.activeScale = 'macrosphere';
    project.releasedScales = ['micro', 'meso', 'exosphere', 'macrosphere'];
    project.reflection = 'Answer: The rules shape access.\nStrongest claim: Repeated visits.\nLimits: Missing voices.\nChanges: My earlier view changed.';
    project.levelProgress.micro.reflection = 'My original Micro reflection.';
    const old = project.reflection;
    const update = vi.fn((edit) => edit(project));
    const { unmount } = render(<ReflectionEntry project={project} update={update} />);
    expect(screen.getByRole('textbox').value).toBe(old);
    expect(update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: old + '\nNext: Ask residents.' } });
    project.levelProgress.macrosphere.reflection = project.reflection;
    unmount();
    const restored = parseProject(serializeProject(project));
    expect(restored.reflection).toBe(old + '\nNext: Ask residents.');
    expect(restored.levelProgress.micro.reflection).toBe('My original Micro reflection.');
  });

  it('explains a clipped handoff while preserving the full saved note and earlier archive', () => {
    const project = createDefaultProject();
    project.activeScale = 'exosphere';
    project.reflection = '😀'.repeat(32_000);
    project.levelProgress.micro.reflection = 'An earlier question remains available.';
    const update = vi.fn();
    render(<ReflectionEntry project={project} update={update} />);
    expect(screen.getByRole('textbox')).toHaveValue(project.reflection);
    expect(screen.getByText(/Macro-level memo review receives an opening excerpt/)).toBeVisible();
    fireEvent.click(screen.getByText('Notes from other scales'));
    expect(screen.getByText(project.levelProgress.micro.reflection)).toBeVisible();
    expect(update).not.toHaveBeenCalled();
  });
});
