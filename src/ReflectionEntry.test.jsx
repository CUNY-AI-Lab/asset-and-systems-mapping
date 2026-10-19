// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReflectionEntry, { REFLECTION_PROMPTS } from './ReflectionEntry.jsx';
import { createDefaultProject, serializeProject, parseProject } from './domain.js';

afterEach(cleanup);

describe('Notebook reflection', () => {
  it.each(Object.keys(REFLECTION_PROMPTS))('has one optional writing field at %s without invoking guidance', (scale) => {
    const project = createDefaultProject();
    project.activeScale = scale;
    const update = vi.fn();
    render(<ReflectionEntry project={project} update={update} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByRole('textbox').required).toBe(false);
    expect(screen.getByText(REFLECTION_PROMPTS[scale])).toBeTruthy();
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
});
