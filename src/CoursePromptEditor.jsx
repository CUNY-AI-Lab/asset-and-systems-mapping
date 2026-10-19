import React, { useEffect, useId, useState } from 'react';
import { Action, Disclosure } from './ui/StudioPrimitives.jsx';
import { SYSTEMS_MAPPING_STAGES } from '../shared/systems-mapping-stages.js';
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
  const [history, setHistory] = useState(null);
  const [selectedRevision, setSelectedRevision] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewKind, setPreviewKind] = useState('preflight');
  const [previewScale, setPreviewScale] = useState('micro');
  const [previewStage, setPreviewStage] = useState('review-suggestions');


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
      setHistory(null); setSelectedRevision(null); setPreview(null);
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

  const loadHistory = async () => {
    setBusy(true); setError('');
    try { const result = await request('/api/cloud/course-prompt/history'); setHistory(result.history); }
    catch (failure) { setError(userFacingError(failure, 'Version history could not be loaded. Try again.')); }
    finally { setBusy(false); }
  };
  const inspectPrompt = async () => {
    setBusy(true); setError('');
    try { setPreview(await request(`/api/teacher/prompt-preview?configKind=${previewKind}&scale=${previewScale}&stageId=${previewStage}`)); }
    catch (failure) { setError(userFacingError(failure, 'The system prompt could not be loaded. Try again.')); }
    finally { setBusy(false); }
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
    {prompt && <section aria-label="Guidance version history">
      <p>Published version {prompt.revision}. Saving guidance publishes it for subsequent requests in this course.</p>
      <Action variant="secondary" disabled={busy} onClick={loadHistory}>Load version history</Action>
      {history && <ul>{history.map(version => <li key={version.revision}>
        <Action variant="secondary" disabled={busy} onClick={() => setSelectedRevision(version)}>Compare version {version.revision}</Action>
        <span> {version.changeNote} · {version.updatedByName || 'Course instructor'} · {version.updatedAt}</span>
      </li>)}</ul>}
      {history?.length === 0 && <p>Publish course guidance to begin its version history.</p>}
      {selectedRevision && <div>
        <label className="field">Published guidance<textarea value={prompt.amendment} readOnly rows={5} /></label>
        <label className="field">Version {selectedRevision.revision} guidance<textarea value={selectedRevision.amendment} readOnly rows={5} /></label>
        <Action variant="secondary" disabled={busy || selectedRevision.amendment === prompt.amendment} onClick={() => {
          setAmendment(selectedRevision.amendment); setChangeNote(`Restore version ${selectedRevision.revision}`);
          setStatus('Earlier guidance copied into your draft. Review it, then save to publish a new version.');
        }}>Restore into draft</Action>
      </div>}
    </section>}
    <section aria-label="System prompt inspection">
      <label className="field">Prompt purpose<select disabled={busy} value={previewKind} onChange={event => { setPreviewKind(event.target.value); setPreviewStage(event.target.value === 'preflight' ? 'review-suggestions' : 'build-map'); setPreview(null); }}>
        <option value="preflight">Memo review</option><option value="builder">Map building</option>
      </select></label>
      <label className="field">Prompt level<select disabled={busy} value={previewScale} onChange={event => { setPreviewScale(event.target.value); setPreview(null); }}>
        {['micro', 'meso', 'exosphere', 'macrosphere'].map(scale => <option key={scale} value={scale}>{scale}</option>)}
      </select></label>
      <label className="field">Prompt stage<select disabled={busy} value={previewStage} onChange={event => { setPreviewStage(event.target.value); setPreview(null); }}>
        {SYSTEMS_MAPPING_STAGES.map(stage => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
      </select></label>
      <Action variant="secondary" disabled={busy} onClick={inspectPrompt}>Inspect system prompt</Action>
      {preview && <div>
        <label className="field">Base system prompt<textarea readOnly value={preview.basePrompt} rows={12} /></label>
        <p>Base version: {preview.baseFingerprint}</p>
        <label className="field">Effective system prompt<textarea readOnly value={preview.effectivePrompt} rows={12} /></label>
        <p>Effective version: {preview.effectiveFingerprint}</p>
      </div>}
    </section>
    {status && <p role="status">{status}</p>}
    {error && <p role="alert" className="account-error">{error}</p>}
  </Disclosure>;
}
