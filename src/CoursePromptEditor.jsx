import React, { useEffect, useId, useState } from 'react';
import { Action, Disclosure } from './ui/StudioPrimitives.jsx';
import { userFacingError } from './userFacingError.js';

export default function CoursePromptEditor({ course, request }) {
  const id = useId();
  const [prompt, setPrompt] = useState(null);
  const [amendment, setAmendment] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Loading course guidance…');
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState(null);

  useEffect(() => {
    let cancelled = false;
    request('/api/cloud/course-prompt').then(({ prompt }) => {
      if (cancelled) return;
      setPrompt(prompt);
      setAmendment(prompt.amendment);
      setStatus('');
    }).catch(failure => {
      if (!cancelled) {
        setError(userFacingError(failure, 'Course guidance could not be loaded. Reload to try again.'));
        setStatus('');
      }
    });
    return () => { cancelled = true; };
  }, [request]);

  const save = async (expectedRevision) => {
    if (amendment.length > 2000 || !changeNote.trim() || changeNote.trim().length > 240) {
      setError('Keep guidance within 2,000 characters and add a change note of 1 to 240 characters.');
      return;
    }
    setBusy(true); setError(''); setStatus('Saving course guidance…');
    try {
      const { prompt: saved } = await request('/api/cloud/course-prompt', {
        method: 'PUT', body: { amendment, expectedRevision, changeNote: changeNote.trim() },
      });
      setPrompt(saved);
      setAmendment(saved.amendment);
      setChangeNote('');
      setLatest(null);
      setConflict(false);
      setStatus('Course guidance saved.');
    } catch (failure) {
      setStatus('');
      if (failure.status === 409) {
        setConflict(true); setLatest(null);
        setError('Someone saved a newer version. Your draft is still here. Review the latest guidance before saving again.');
      } else {
        setError(userFacingError(failure, 'Course guidance could not be saved. Your draft is still here. Try again.'));
      }
    } finally { setBusy(false); }
  };

  const reviewLatest = async () => {
    setBusy(true); setError('');
    try {
      const { prompt } = await request('/api/cloud/course-prompt');
      setLatest(prompt);
    } catch (failure) {
      setError(userFacingError(failure, 'The latest guidance could not be loaded. Your draft is still here. Try again.'));
    } finally { setBusy(false); }
  };

  return <Disclosure title="Course guidance" className="course-prompt-editor">
    <p>Add instructions for {course.name}. They apply only to this course and supplement the app’s mapping rules.</p>
    {prompt && <form onSubmit={event => { event.preventDefault(); if (!conflict) void save(prompt.revision); }}>
      <label className="field" htmlFor={`${id}-guidance`}><span className="field__label">Additional course guidance</span>
        <textarea id={`${id}-guidance`} rows={7} value={amendment} maxLength={2000} disabled={busy} onChange={event => { setAmendment(event.target.value); setStatus(''); }} aria-describedby={`${id}-limit`} />
      </label>
      <p id={`${id}-limit`}>{amendment.length.toLocaleString()} of 2,000 characters</p>
      <label className="field" htmlFor={`${id}-note`}><span className="field__label">Change note</span>
        <input id={`${id}-note`} value={changeNote} maxLength={240} disabled={busy} onChange={event => setChangeNote(event.target.value)} placeholder="What changed?" />
      </label>
      <Action type="submit" disabled={busy || conflict || !changeNote.trim() || amendment === prompt.amendment}>Save guidance</Action>
    </form>}
    {conflict && !latest && <Action variant="secondary" disabled={busy} onClick={reviewLatest}>Review latest guidance</Action>}
    {latest && <section aria-label="Compare saved guidance">
      <label className="field" htmlFor={`${id}-latest`}><span className="field__label">Latest saved guidance</span>
        <textarea id={`${id}-latest`} rows={7} value={latest.amendment} readOnly />
      </label>
      <p>Compare this version with your draft above. Saving your draft replaces this version.</p>
      <Action disabled={busy || !changeNote.trim()} onClick={() => save(latest.revision)}>Save my draft as next version</Action>
    </section>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert" className="account-error">{error}</p>}
  </Disclosure>;
}
