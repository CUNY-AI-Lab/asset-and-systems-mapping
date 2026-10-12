import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CoursePromptEditor from './CoursePromptEditor.jsx';

const course = { id: 'course-a', name: 'Synthetic course A' };
const original = { amendment: 'Use examples from the course readings.', revision: 3, updatedAt: null, changeNote: 'Initial guidance' };

afterEach(cleanup);

async function mount(request) {
  render(<CoursePromptEditor course={course} request={request} />);
  fireEvent.click(screen.getByText('Course guidance', { selector: 'summary' }));
  return screen.findByLabelText('Additional course guidance');
}

describe('course guidance editor', () => {
  it('saves an appendix with a bounded change note and expected revision', async () => {
    const request = vi.fn(async (_, options) => ({ prompt: options?.method === 'PUT' ? { ...original, ...options.body, revision: 4 } : original }));
    const field = await mount(request);
    expect(field).toHaveAttribute('maxLength', '2000');
    expect(screen.getByLabelText('Change note')).toHaveAttribute('maxLength', '240');
    expect(screen.getByRole('button', { name: 'Save guidance' })).toBeDisabled();
    fireEvent.change(field, { target: { value: 'Name the setting before describing the relationship.' } });
    fireEvent.change(screen.getByLabelText('Change note'), { target: { value: '  Clarify examples  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save guidance' }));
    await screen.findByText('Course guidance saved.');
    expect(request).toHaveBeenLastCalledWith('/api/cloud/course-prompt', {
      method: 'PUT', body: { amendment: 'Name the setting before describing the relationship.', expectedRevision: 3, changeNote: 'Clarify examples' },
    });
    expect(screen.getByLabelText('Change note')).toHaveValue('');
  });

  it('retains a conflicting draft and requires reviewing the latest version before an explicit save', async () => {
    let writes = 0;
    let reads = 0;
    const latest = { ...original, amendment: 'New guidance from another instructor.', revision: 4 };
    const request = vi.fn(async (_, options) => {
      if (options?.method === 'PUT') {
        if (++writes === 1) throw Object.assign(new Error('machine_revision_conflict'), { status: 409 });
        return { prompt: { ...latest, ...options.body, revision: 5 } };
      }
      return { prompt: ++reads === 1 ? original : latest };
    });
    const field = await mount(request);
    fireEvent.change(field, { target: { value: 'My unsaved guidance.' } });
    fireEvent.change(screen.getByLabelText('Change note'), { target: { value: 'Explain immediate settings' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save guidance' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your draft is still here.');
    expect(field).toHaveValue('My unsaved guidance.');
    expect(screen.getByLabelText('Change note')).toHaveValue('Explain immediate settings');
    expect(screen.getByRole('button', { name: 'Save guidance' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Review latest guidance' }));
    expect(await screen.findByLabelText('Latest saved guidance')).toHaveValue(latest.amendment);
    expect(field).toHaveValue('My unsaved guidance.');
    expect(writes).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save my draft as next version' }));
    await screen.findByText('Course guidance saved.');
    expect(request).toHaveBeenLastCalledWith('/api/cloud/course-prompt', {
      method: 'PUT', body: { amendment: 'My unsaved guidance.', expectedRevision: 4, changeNote: 'Explain immediate settings' },
    });
  });

  it('keeps a draft when saving fails and does not display server diagnostics', async () => {
    const request = vi.fn(async (_, options) => {
      if (options?.method === 'PUT') throw Object.assign(new Error('sql_internal_diagnostic secret body'), { status: 503, payload: { error: 'sql_internal_diagnostic secret body' } });
      return { prompt: original };
    });
    const field = await mount(request);
    fireEvent.change(field, { target: { value: 'Keep my draft.' } });
    fireEvent.change(screen.getByLabelText('Change note'), { target: { value: 'Examples' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save guidance' }));
    await screen.findByRole('alert');
    expect(field).toHaveValue('Keep my draft.');
    expect(document.body).not.toHaveTextContent('sql_internal_diagnostic');
    expect(document.body).not.toHaveTextContent('secret body');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save guidance' })).toBeEnabled());
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not offer edits when loading guidance is denied', async () => {
    const request = vi.fn().mockRejectedValue(Object.assign(new Error('not_owner'), { status: 403, payload: { details: { code: 'course_owner_required' } } }));
    render(<CoursePromptEditor course={course} request={request} />);
    fireEvent.click(screen.getByText('Course guidance', { selector: 'summary' }));
    await screen.findByRole('alert');
    expect(screen.queryByLabelText('Additional course guidance')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save guidance' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('not_owner');
  });
});
