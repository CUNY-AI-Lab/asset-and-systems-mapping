import React, { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from './api.js';
import { SYSTEMS_MAPPING_STAGES } from '../shared/systems-mapping-stages.js';

const DASHBOARD_SECTIONS = [
  { id: 'reviews', label: 'Review submissions' },
  { id: 'guidance', label: 'Course settings' },
];
const REVIEW_DECISIONS = [
  { id: 'approve', label: 'Add feedback' },
  { id: 'revise_and_approve', label: 'Add feedback and a question' },
  { id: 'reject', label: 'Recommend another pass' },
];

function Message({ message }) {
  if (!message) return null;
  return <p className={`teacher-message teacher-message--${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p>;
}

function rovingIndex(event, currentIndex, length) {
  if (!length) return null;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') return (currentIndex + 1) % length;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') return (currentIndex - 1 + length) % length;
  if (event.key === 'Home') return 0;
  if (event.key === 'End') return length - 1;
  return null;
}

function formatHistoryTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function profileStatusLabel(status) {
  if (status === 'active') return 'published';
  if (status === 'retired') return 'earlier';
  return status;
}

function scaleLabel(scale) {
  return typeof scale === 'string' && scale
    ? `${scale[0].toUpperCase()}${scale.slice(1)}`
    : '';
}

function scaleListLabel(scales = []) {
  const labels = scales.map(scaleLabel).filter(Boolean);
  if (labels.length < 2) return labels[0] || '';
  return `${labels.slice(0, -1).join(', ')}${labels.length > 2 ? ',' : ''} and ${labels.at(-1)}`;
}

function submissionPart(submission) {
  if (submission?.coursePart) return submission.coursePart;
  return submission?.configSnapshot?.shared?.courseParts?.find(({ scaleIds }) => scaleIds.includes(submission.activeScale)) || null;
}

function submissionContextLabel(submission) {
  const part = submissionPart(submission);
  return [part?.label, scaleLabel(submission?.activeScale)].filter(Boolean).join(' · ');
}

function readableValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(readableValue).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    for (const key of ['text', 'excerpt', 'evidenceExcerpt', 'label', 'value', 'locator']) {
      const readable = readableValue(value[key]);
      if (readable) return readable;
    }
  }
  return '';
}

function uniqueValues(values) {
  return [...new Set(values.map(readableValue).filter(Boolean))];
}

function submissionLabel(submission, index = 0) {
  return readableValue(submission?.projectMetadata?.title)
    || readableValue(submission?.projectMetadata?.projectTitle)
    || `Submission ${String(index + 1).padStart(2, '0')}`;
}

function DecisionHistory({ events, title = 'Feedback history' }) {
  if (!events?.length) return null;
  return <section className="review-history" aria-label={title}>
    <h3>{title}</h3>
    <ol>{events.map((event) => {
      const decision = REVIEW_DECISIONS.find((item) => item.id === event.decision)?.label || event.decision;
      return <li key={event.id || `${event.toRevision}:${event.decidedAt}`}>
        <strong>{decision}</strong>
        <p>{event.instructorAnnotation}</p>
        {event.focusedQuestion && <p><span>Question for the student</span><br />{event.focusedQuestion}</p>}
        <small>{formatHistoryTime(event.decidedAt)}{event.reviewingTeacher?.displayName ? ` · ${event.reviewingTeacher.displayName}` : ''}</small>
      </li>;
    })}</ol>
  </section>;
}

function SuggestionReview({ suggestion }) {
  const hard = Array.isArray(suggestion?.hard) ? suggestion.hard : [];
  const scored = Array.isArray(suggestion?.scored) ? suggestion.scored : [];
  const criteria = [...hard, ...scored];
  if (!suggestion || !criteria.length) return <p className="empty-message">No guidance was submitted.</p>;

  const evidence = uniqueValues(criteria.flatMap((criterion) => [criterion.evidence, criterion.evidenceExcerpt, criterion.evidenceLocator]));
  const followUp = uniqueValues(criteria.flatMap((criterion) => [criterion.rationale, criterion.nextAction]));
  const uncertainties = uniqueValues(criteria.flatMap((criterion) => {
    const status = readableValue(criterion.status).toLowerCase();
    const unresolved = criterion.hardBlock || criterion.missingVariable || /(?:fail|hold|missing|open|uncertain|blocked|not met)/.test(status);
    return unresolved ? [criterion.missingVariable, criterion.nextAction, criterion.rationale] : [];
  }));

  const annotation = (label, values, emptyText) => <section className="suggestion-annotation">
    <h4>{label}</h4>
    {values.length ? <ul>{values.map((value, index) => <li key={`${label}:${index}`}>{value}</li>)}</ul> : <p>{emptyText}</p>}
  </section>;

  return <details className="teacher-model-review">
    <summary>Review details</summary>
    <div className="teacher-model-review__body">
      <p className="teacher-model-review__note">Use these details as reference. You decide what the student should revisit.</p>
      <div className="suggestion-review">
        {annotation('Evidence excerpts', evidence, 'No supporting evidence was recorded.')}
        {annotation('Possible follow-up', followUp, 'No follow-up was suggested.')}
        {annotation('Open questions', uncertainties, 'No unresolved question was recorded.')}
      </div>
    </div>
  </details>;
}

function AccountAccess({ teacherAccess, onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [accountId, setAccountId] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [bootstrapToken, setBootstrapToken] = useState('');
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const accessTabRefs = useRef(new Map());
  useEffect(() => {
    setPassphrase('');
    setConfirmation('');
    setBootstrapToken('');
    setMessage(null);
  }, [mode]);
  const submit = async (event) => {
    event.preventDefault();
    const userId = accountId.trim();
    if (!userId) return setMessage({ type: 'error', text: 'Enter the teacher account ID.' });
    if (passphrase.length < 10) return setMessage({ type: 'error', text: 'Use a passphrase with at least 10 characters.' });
    if (mode === 'claim' && !teacherAccess.claimEnabled) return setMessage({ type: 'error', text: 'Teacher account claiming is disabled for this server start.' });
    if (mode === 'claim' && passphrase !== confirmation) return setMessage({ type: 'error', text: 'The two passphrases do not match.' });
    if (mode === 'claim' && !bootstrapToken) return setMessage({ type: 'error', text: 'Enter the one-time setup code.' });
    setBusy(true);
    setMessage(null);
    try {
      const result = await apiRequest(mode === 'login' ? '/api/auth/login' : '/api/auth/claim', {
        method: 'POST',
        body: mode === 'login' ? { userId, passphrase } : { userId, passphrase, bootstrapToken },
      });
      setPassphrase('');
      setConfirmation('');
      setBootstrapToken('');
      onAuthenticated(result.user);
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  };
  const moveMode = (event, currentMode) => {
    const enabledModes = teacherAccess.claimEnabled ? ['login', 'claim'] : ['login'];
    const currentIndex = Math.max(0, enabledModes.indexOf(currentMode));
    const nextIndex = rovingIndex(event, currentIndex, enabledModes.length);
    if (nextIndex === null) return;
    event.preventDefault();
    const nextMode = enabledModes[nextIndex];
    setMode(nextMode);
    accessTabRefs.current.get(nextMode)?.focus();
  };
  return <div className="teacher-access">
    <p className="eyebrow">Teacher Console</p>
    <h1>{mode === 'login' ? 'Sign in to Teacher Console' : 'Set up a teacher account'}</h1>
    <p className="lede">Use the account ID provided by your school or program.</p>
    <div className="model-switch teacher-access-switch" role="tablist" aria-label="Teacher Console action">
      <button ref={(node) => node ? accessTabRefs.current.set('login', node) : accessTabRefs.current.delete('login')} id="teacher-access-tab-login" aria-controls="teacher-access-panel" type="button" role="tab" aria-selected={mode === 'login'} tabIndex={mode === 'login' ? 0 : -1} className={mode === 'login' ? 'is-active' : ''} onKeyDown={(event) => moveMode(event, 'login')} onClick={() => setMode('login')}>Sign in</button>
      <button ref={(node) => node ? accessTabRefs.current.set('claim', node) : accessTabRefs.current.delete('claim')} id="teacher-access-tab-claim" aria-controls="teacher-access-panel" type="button" role="tab" aria-selected={mode === 'claim'} tabIndex={mode === 'claim' ? 0 : -1} className={mode === 'claim' ? 'is-active' : ''} disabled={!teacherAccess.claimEnabled} onKeyDown={(event) => moveMode(event, 'claim')} onClick={() => setMode('claim')}>Claim account</button>
    </div>
    {!teacherAccess.claimEnabled && <p className="teacher-message">Account setup is currently unavailable. To set up an unclaimed account, restart the service with a temporary setup code. Do not save that code in the project files or browser.</p>}
    <form className="access-form" id="teacher-access-panel" role="tabpanel" aria-labelledby={`teacher-access-tab-${mode}`} onSubmit={submit}>
      <label className="field"><span className="field__label">Teacher account ID</span><input maxLength="100" autoComplete="username" value={accountId} onChange={(event) => setAccountId(event.target.value)} /></label>
      <label className="field"><span className="field__label">Passphrase</span><input maxLength="128" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></label>
      {mode === 'claim' && <><label className="field"><span className="field__label">Confirm passphrase</span><input maxLength="128" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><label className="field"><span className="field__label">One-time setup code</span><input maxLength="256" type="password" autoComplete="off" value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} /></label></>}
      <Message message={message} />
      <button type="submit" className="button" disabled={busy}>{busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Claim account'}</button>
    </form>
  </div>;
}

function ReviewSubmissions() {
  const [submissions, setSubmissions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reviewHistory, setReviewHistory] = useState([]);
  const [lastDecision, setLastDecision] = useState(null);
  const [decision, setDecision] = useState('');
  const [instructorAnnotation, setInstructorAnnotation] = useState('');
  const [focusedQuestion, setFocusedQuestion] = useState('');
  const [message, setMessage] = useState(null);
  const [queueError, setQueueError] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(null);

  const loadQueue = async (preferredId) => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      const result = await apiRequest('/api/teacher/preflight-submissions?status=pending');
      const nextSubmissions = Array.isArray(result?.submissions) ? result.submissions : [];
      setSubmissions(nextSubmissions);
      const requestedId = preferredId === undefined ? selectedId : preferredId;
      const nextId = nextSubmissions.some((submission) => submission.id === requestedId)
        ? requestedId
        : nextSubmissions[0]?.id || null;
      setSelectedId(nextId);
      if (!nextId) {
        setDetail(null);
        setReviewHistory([]);
      }
      return nextSubmissions;
    } catch (error) {
      setQueueError(error.message);
      return null;
    } finally {
      setQueueLoading(false);
    }
  };

  useEffect(() => { loadQueue(null); }, []);
  useEffect(() => {
    if (!selectedId) return undefined;
    let current = true;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    apiRequest(`/api/teacher/preflight-submissions/${encodeURIComponent(selectedId)}`).then((result) => {
      if (!current) return;
      setDetail(result.submission);
      setReviewHistory(Array.isArray(result.reviewEvents) ? result.reviewEvents : []);
      setDecision('');
      setInstructorAnnotation('');
      setFocusedQuestion('');
      setConflict(null);
      setMessage(null);
    }).catch((error) => {
      if (current) setDetailError(error.message);
    }).finally(() => {
      if (current) setDetailLoading(false);
    });
    return () => { current = false; };
  }, [selectedId]);

  const submitDecision = async (event) => {
    event.preventDefault();
    const annotation = instructorAnnotation.trim();
    const question = focusedQuestion.trim();
    if (!decision) return setMessage({ type: 'error', text: 'Choose a feedback type.' });
    if (!annotation) return setMessage({ type: 'error', text: 'Add a focus for the student before recording feedback.' });
    if (decision === 'revise_and_approve' && !question) return setMessage({ type: 'error', text: 'Add a question for the student before recording this feedback.' });
    setBusy(true);
    setMessage(null);
    setConflict(null);
    try {
      const result = await apiRequest(`/api/teacher/preflight-submissions/${encodeURIComponent(detail.id)}/decision`, {
        method: 'POST',
        body: {
          decision,
          instructorAnnotation: annotation,
          ...(decision === 'revise_and_approve' ? { focusedQuestion: question } : {}),
          expectedRevision: detail.revision,
        },
      });
      const events = Array.isArray(result.reviewEvents) ? result.reviewEvents : [];
      setLastDecision({ submission: result.submission, events });
      setMessage({ type: 'success', text: 'Feedback recorded. The pending queue has been refreshed.' });
      setDecision('');
      setInstructorAnnotation('');
      setFocusedQuestion('');
      await loadQueue(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const current = error.payload?.details?.current;
        setConflict(current || true);
        setMessage({ type: 'error', text: 'This submission changed in another session. Your feedback draft remains available.' });
      } else {
        setMessage({ type: 'error', text: error.message });
      }
    } finally {
      setBusy(false);
    }
  };

  const reloadConflict = () => {
    const current = conflict?.submission || conflict;
    if (current && typeof current === 'object') {
      setDetail(current);
      if (Array.isArray(conflict.reviewEvents)) setReviewHistory(conflict.reviewEvents);
      setConflict(null);
      setMessage({ type: 'success', text: `Loaded submission revision ${current.revision}. Your feedback draft remains available.` });
    } else {
      setConflict(null);
      setMessage({ type: 'error', text: 'The current submission could not be loaded. Refresh the queue and try again.' });
    }
  };

  const selectSubmission = (id) => {
    if (id === selectedId) return;
    setSelectedId(id);
  };

  const lastEvents = lastDecision?.events || [];
  return <section className="review-submissions" aria-labelledby="review-submissions-heading">
    <div className="teacher-review-grid">
      <aside className="submission-queue" aria-labelledby="review-submissions-heading">
        <div className="section-heading"><div><p className="eyebrow">Review submissions</p><h2 id="review-submissions-heading">Waiting for review</h2></div><button type="button" className="button button--ghost" disabled={queueLoading} onClick={() => loadQueue()}>{queueLoading ? 'Refreshing…' : 'Refresh'}</button></div>
        {queueError && <p className="teacher-message teacher-message--error" role="alert">{queueError}</p>}
        {queueLoading && !submissions.length ? <p className="empty-message">Loading pending submissions…</p> : null}
        {!queueLoading && !submissions.length && !queueError ? <p className="empty-message">No submissions are waiting for review.</p> : null}
        {submissions.length ? <ol className="submission-queue__list">{submissions.map((submission, index) => <li key={submission.id}>
          <button type="button" className={selectedId === submission.id ? 'is-selected' : ''} aria-current={selectedId === submission.id ? 'true' : undefined} onClick={() => selectSubmission(submission.id)}>
            <strong>{submissionLabel(submission, index)}</strong>
            <span>{submissionContextLabel(submission)}</span>
            <small>{formatHistoryTime(submission.submittedAt)}</small>
          </button>
        </li>)}</ol> : null}
      </aside>

      <section className="student-work" aria-labelledby="student-work-heading">
        <h2 id="student-work-heading">Student work</h2>
        {detailLoading && <p className="empty-message">Loading student work…</p>}
        {detailError && <p className="teacher-message teacher-message--error" role="alert">{detailError}</p>}
        {!detailLoading && !detail && !detailError && <p className="empty-message">Choose a pending submission to review its details.</p>}
        {detail && <div className="student-work__body">
          <p className="eyebrow">{submissionContextLabel(detail)}</p>
          {detail.inquiry ? <section><h3>Question from earlier work</h3><p>{detail.inquiry}</p></section> : null}
          <section><h3>Memo</h3><p className="student-work__memo">{readableValue(detail.sourceMaterial) || 'No memo was submitted.'}</p><SuggestionReview suggestion={detail.suggestion} /></section>
          <section><h3>Student note</h3><p>{readableValue(detail.studentAnnotation) || 'No student note was submitted.'}</p></section>
        </div>}
      </section>

      <aside className="instructor-response" aria-labelledby="instructor-response-heading">
        <h2 id="instructor-response-heading">Write to the student.</h2>
        {detail ? <form onSubmit={submitDecision}>
          <p className="instructor-response__prompt">Name one focus for the student. Students can continue while feedback is pending and decide how to use your response.</p>
          <label className="field instructor-response__guidance"><span className="field__label">Focus for the student</span><textarea rows="7" maxLength="4000" value={instructorAnnotation} onChange={(event) => setInstructorAnnotation(event.target.value)} /></label>
          <fieldset className="review-decision"><legend>Feedback type</legend><div className="review-decision__actions">{REVIEW_DECISIONS.map((item) => <button key={item.id} type="button" aria-pressed={decision === item.id} className={decision === item.id ? 'is-selected' : ''} onClick={() => { setDecision(item.id); setMessage(null); }}>{item.label}</button>)}</div></fieldset>
          {decision === 'revise_and_approve' && <label className="field"><span className="field__label">Question for the student</span><textarea rows="5" maxLength="1000" value={focusedQuestion} onChange={(event) => setFocusedQuestion(event.target.value)} /></label>}
          <Message message={message} />
          {conflict && <div className="teacher-message teacher-message--error" role="group" aria-label="Submission conflict actions"><p>The server has a newer revision. Reload it before submitting the preserved draft again.</p><button type="button" className="button button--ghost" onClick={reloadConflict}>Reload current submission</button></div>}
          <button type="submit" className="button" disabled={busy}>{busy ? 'Recording…' : 'Record feedback'}</button>
        </form> : <Message message={message} />}
        <DecisionHistory events={reviewHistory} />
        {lastEvents.length && lastDecision?.submission?.id !== detail?.id ? <DecisionHistory events={lastEvents} title="Latest feedback" /> : null}
      </aside>
    </div>
  </section>;
}

function TeachingProfiles({ onConfigurationChanged }) {
  const [catalog, setCatalog] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [events, setEvents] = useState([]);
  const [draft, setDraft] = useState(null);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newNote, setNewNote] = useState('');
  const [previewScale, setPreviewScale] = useState('micro');
  const [preview, setPreview] = useState(null);
  const [selectedPartId, setSelectedPartId] = useState(null);
  const [selectedStageId, setSelectedStageId] = useState(SYSTEMS_MAPPING_STAGES[0].id);

  const loadCatalog = async (preferredId = null) => {
    const result = await apiRequest('/api/teacher/profiles');
    setCatalog(result);
    const available = Array.isArray(result.profiles) ? result.profiles : [];
    const nextId = preferredId && available.some(({ id }) => id === preferredId)
      ? preferredId
      : result.activeProfileId || available[0]?.id || null;
    setSelectedId(nextId);
    return nextId;
  };

  useEffect(() => {
    setLoading(true);
    loadCatalog().catch((error) => setMessage({ type: 'error', text: error.message })).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDraft(null);
      setEvents([]);
      return;
    }
    setLoading(true);
    setPreview(null);
    apiRequest(`/api/teacher/profiles/${encodeURIComponent(selectedId)}`).then((result) => {
      setDetail(result.profile);
      setDraft({ name: result.profile.name, profile: structuredClone(result.profile.profile) });
      setEvents(Array.isArray(result.events) ? result.events : []);
      setConflict(null);
      setMessage(null);
    }).catch((error) => setMessage({ type: 'error', text: error.message })).finally(() => setLoading(false));
  }, [selectedId]);

  const profileParts = Array.isArray(draft?.profile?.parts) ? draft.profile.parts : [];
  const selectedPart = profileParts.find(({ id }) => id === selectedPartId) || profileParts[0] || null;

  useEffect(() => {
    if (!selectedPart) return;
    if (selectedPart.id !== selectedPartId) setSelectedPartId(selectedPart.id);
    if (!selectedPart.scaleIds.includes(previewScale)) setPreviewScale(selectedPart.scaleIds[0]);
  }, [previewScale, selectedPart, selectedPartId]);

  const selectPart = (partId) => {
    const part = profileParts.find(({ id }) => id === partId);
    if (!part) return;
    setSelectedPartId(part.id);
    if (!part.scaleIds.includes(previewScale)) setPreviewScale(part.scaleIds[0]);
    setPreview(null);
  };

  const changePartLabel = (value) => {
    if (!selectedPart) return;
    setDraft((current) => ({
      ...current,
      profile: {
        ...current.profile,
        parts: current.profile.parts.map((part) => part.id === selectedPart.id ? { ...part, label: value } : part),
      },
    }));
    setPreview(null);
  };

  const changeStage = (field, value) => {
    if (!selectedPart) return;
    setDraft((current) => ({
      ...current,
      profile: {
        ...current.profile,
        parts: current.profile.parts.map((part) => part.id === selectedPart.id ? {
          ...part,
          stages: {
            ...part.stages,
            [selectedStageId]: { ...part.stages[selectedStageId], [field]: value },
          },
        } : part),
      },
    }));
    setPreview(null);
  };

  const createDraft = async (event) => {
    event.preventDefault();
    if (!newName.trim()) return setMessage({ type: 'error', text: 'Name the draft before creating it.' });
    if (newNote.trim().length < 3) return setMessage({ type: 'error', text: 'Add a short note about what you plan to change.' });
    setBusy(true);
    try {
      const result = await apiRequest('/api/teacher/profiles', {
        method: 'POST',
        body: { name: newName.trim(), note: newNote.trim(), ...(selectedId ? { sourceProfileId: selectedId } : {}) },
      });
      setCreating(false);
      setNewName('');
      setNewNote('');
      await loadCatalog(result.profile.id);
      setMessage({ type: 'success', text: 'Draft created. Published course settings are unchanged.' });
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally { setBusy(false); }
  };

  const saveDraft = async () => {
    if (!draft?.name.trim()) return setMessage({ type: 'error', text: 'Name the draft before saving it.' });
    if (note.trim().length < 3) return setMessage({ type: 'error', text: 'Add a short change note before saving.' });
    setBusy(true);
    try {
      const result = await apiRequest(`/api/teacher/profiles/${encodeURIComponent(detail.id)}`, {
        method: 'PUT',
        body: { name: draft.name.trim(), profile: draft.profile, note: note.trim(), expectedRevision: detail.revision },
      });
      setDetail(result.profile);
      setDraft({ name: result.profile.name, profile: structuredClone(result.profile.profile) });
      setEvents(result.events || []);
      setNote('');
      setConflict(null);
      setMessage({ type: 'success', text: `Draft revision ${result.profile.revision} saved.` });
      await loadCatalog(result.profile.id);
    } catch (error) {
      const current = error instanceof ApiError && error.status === 409 ? error.payload?.details?.current : null;
      if (current) {
        setConflict(current);
        setMessage({ type: 'error', text: 'This draft changed in another session. Your unsaved text remains in the editor.' });
      } else setMessage({ type: 'error', text: error.message });
    } finally { setBusy(false); }
  };

  const loadConflict = () => {
    setDetail(conflict);
    setDraft({ name: conflict.name, profile: structuredClone(conflict.profile) });
    setConflict(null);
    setPreview(null);
    setMessage({ type: 'success', text: `Loaded draft revision ${conflict.revision}.` });
  };

  const publish = async () => {
    if (note.trim().length < 3) return setMessage({ type: 'error', text: 'Add a short publication note.' });
    setBusy(true);
    try {
      const result = await apiRequest(`/api/teacher/profiles/${encodeURIComponent(detail.id)}/publish`, {
        method: 'POST',
        body: { note: note.trim(), expectedRevision: detail.revision },
      });
      setDetail(result.profile);
      setDraft({ name: result.profile.name, profile: structuredClone(result.profile.profile) });
      setEvents(result.events || []);
      setNote('');
      setPreview(null);
      setMessage({ type: 'success', text: 'Draft published. Student guidance now uses these section settings.' });
      await loadCatalog(result.profile.id);
      onConfigurationChanged();
    } catch (error) {
      const current = error instanceof ApiError && error.status === 409 ? error.payload?.details?.current : null;
      if (current) setConflict(current);
      setMessage({ type: 'error', text: current ? 'This draft changed before publication. Your unsaved text remains in the editor.' : error.message });
    } finally { setBusy(false); }
  };

  const loadPreview = async () => {
    setBusy(true);
    try {
      const selectedStageIndex = SYSTEMS_MAPPING_STAGES.findIndex(({ id }) => id === selectedStageId);
      const configKind = selectedStageIndex >= 4 ? 'builder' : 'preflight';
      const result = await apiRequest(`/api/teacher/profiles/${encodeURIComponent(detail.id)}/preview?${new URLSearchParams({ configKind, scale: previewScale, stageId: selectedStageId })}`);
      setPreview(result);
      setMessage(null);
    } catch (error) { setMessage({ type: 'error', text: error.message }); }
    finally { setBusy(false); }
  };

  if (loading && !catalog) return <p className="empty-message">Loading course settings…</p>;
  const profiles = catalog?.profiles || [];
  const editable = detail?.status === 'draft';
  const dirty = Boolean(editable && draft && (
    draft.name !== detail.name || JSON.stringify(draft.profile) !== JSON.stringify(detail.profile)
  ));
  const selectedStageIndex = Math.max(0, SYSTEMS_MAPPING_STAGES.findIndex(({ id }) => id === selectedStageId));
  const selectedStage = SYSTEMS_MAPPING_STAGES[selectedStageIndex];
  const selectedStageSettings = selectedPart?.stages?.[selectedStage.id] || { guidance: '', materials: '' };
  return <section className="model-guidance teaching-profiles" aria-labelledby="course-settings-heading">
    <div className="section-heading"><div><h2 id="course-settings-heading">Course settings</h2><p>Adapt guidance and course material for this exercise and its relationship to the broader course.</p></div></div>
    <Message message={message} />
    <div className="teacher-controls teaching-profile-controls">
      <label><span>Version</span><select aria-label="Version" value={selectedId || ''} onChange={(event) => setSelectedId(event.target.value)}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profileStatusLabel(profile.status)}</option>)}</select></label>
      <button type="button" className="button button--secondary" onClick={() => setCreating((value) => !value)}>{creating ? 'Cancel' : 'Create a draft'}</button>
    </div>
    {creating && <form className="teaching-profile-create" onSubmit={createDraft}>
      <label className="field"><span className="field__label">Draft name</span><input maxLength="120" value={newName} onChange={(event) => setNewName(event.target.value)} /></label>
      <label className="field"><span className="field__label">What do you plan to change?</span><input maxLength="500" value={newNote} onChange={(event) => setNewNote(event.target.value)} /></label>
      <button type="submit" className="button" disabled={busy}>Create draft</button>
    </form>}
    {detail && draft && <div className="teacher-workbench teaching-profile-workbench">
      <div className="teaching-profile-editor">
        <div className="section-heading"><div><h3>{detail.name}</h3><p>{profileStatusLabel(detail.status)} · revision {detail.revision}</p></div></div>
        <label className="field"><span className="field__label">Name</span><input maxLength="120" readOnly={!editable} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
        <p className="field__hint">Adjust each section separately as the course, assignment, or class session changes.</p>
        {selectedPart ? <>
          <div className="teacher-controls teaching-profile-controls">
            <label><span>Part</span><select aria-label="Part" value={selectedPart.id} onChange={(event) => selectPart(event.target.value)}>{profileParts.map((part) => <option key={part.id} value={part.id}>{part.label}</option>)}</select></label>
          </div>
          <label className="field"><span className="field__label">Part name</span><input maxLength="120" readOnly={!editable} value={selectedPart.label} onChange={(event) => changePartLabel(event.target.value)} /></label>
          <label className="field"><span className="field__label">Included scales</span><input readOnly value={scaleListLabel(selectedPart.scaleIds)} /></label>
          <nav className="course-stage-nav" aria-label={`${selectedPart.label} sections`}><ol>{SYSTEMS_MAPPING_STAGES.map((stage) => <li key={stage.id}><button type="button" aria-label={stage.label} className={stage.id === selectedStageId ? 'is-active' : ''} aria-current={stage.id === selectedStageId ? 'step' : undefined} onClick={() => { setSelectedStageId(stage.id); setPreview(null); }}><strong>{stage.label}</strong></button></li>)}</ol></nav>
        </> : <p className="teacher-message teacher-message--error" role="alert">This course settings version does not include any parts.</p>}
        {selectedPart && <section className="course-stage-editor" aria-labelledby={`course-stage-heading-${selectedStage.id}`}>
          <div><h4 id={`course-stage-heading-${selectedStage.id}`}>{selectedStage.label}</h4><p>{selectedStage.description}</p></div>
          <label className="field"><span className="field__label">What guidance should students receive in this section?</span><textarea rows="6" maxLength="2500" readOnly={!editable} value={selectedStageSettings.guidance} onChange={(event) => changeStage('guidance', event.target.value)} /></label>
          <label className="field"><span className="field__label">What course material should support this section?</span><textarea rows="7" maxLength="4000" readOnly={!editable} value={selectedStageSettings.materials} onChange={(event) => changeStage('materials', event.target.value)} /></label>
          <p className="field__hint">Paste a passage or other text for this section.</p>
        </section>}
        {editable && <label className="field"><span className="field__label">Change note</span><input maxLength="500" value={note} onChange={(event) => setNote(event.target.value)} /></label>}
        {dirty && <p className="field__hint">Save this draft before previewing or publishing it.</p>}
        {conflict && <div className="teacher-message teacher-message--error" role="group" aria-label="Draft conflict actions"><p>Loading the server revision will replace the draft currently visible above.</p><button type="button" className="button button--ghost" onClick={loadConflict}>Load server revision {conflict.revision}</button></div>}
        <div className="teacher-actions">
          {editable && <button type="button" className="button button--secondary" disabled={busy || !dirty} onClick={saveDraft}>Save draft</button>}
          {editable && <button type="button" className="button" disabled={busy || dirty} onClick={publish}>Publish draft</button>}
        </div>
      </div>
      <aside className="teaching-profile-preview">
        <h3>Preview this section</h3>
        <p><strong>{selectedPart?.label}</strong>{selectedPart ? ` · ${selectedStage.label}` : ''}</p>
        {selectedPart && <label><span>Scale</span><select value={previewScale} onChange={(event) => { setPreviewScale(event.target.value); setPreview(null); }}>{selectedPart.scaleIds.map((scale) => <option key={scale} value={scale}>{scaleLabel(scale)}</option>)}</select></label>}
        <button type="button" className="button button--secondary" disabled={busy || dirty || !selectedPart} onClick={loadPreview}>Check saved version</button>
        {preview && <div className="effective-preview"><strong>Saved version {preview.revision}</strong><p>{selectedPart?.label} · {selectedStage.label} · {scaleLabel(previewScale)}</p></div>}
        <details className="teacher-history"><summary>Change history · {events.length}</summary>{events.length ? <ol>{events.map((event) => <li key={event.id}><strong>{event.action}</strong><p>{event.note}</p><small>{event.actorName || 'Original settings'} · version {event.revision}<br />{formatHistoryTime(event.occurredAt)}</small></li>)}</ol> : <p className="empty-message">No change history is available.</p>}</details>
      </aside>
    </div>}
  </section>;
}

function AuthenticatedDashboard({ user, onLogout, onConfigurationChanged }) {
  const [section, setSection] = useState('reviews');
  const [guidanceVisited, setGuidanceVisited] = useState(false);
  const sectionTabRefs = useRef(new Map());
  const activateSection = (nextSection) => {
    setSection(nextSection);
    if (nextSection === 'guidance') setGuidanceVisited(true);
  };
  const moveSection = (event, index) => {
    const nextIndex = rovingIndex(event, index, DASHBOARD_SECTIONS.length);
    if (nextIndex === null) return;
    event.preventDefault();
    const next = DASHBOARD_SECTIONS[nextIndex];
    activateSection(next.id);
    sectionTabRefs.current.get(next.id)?.focus();
  };
  return <div className="teacher-dashboard">
    <div className="teacher-dashboard__title"><div><p className="eyebrow">Instructor tools</p><h1>Teacher Console</h1><p className="lede">Review student work and provide feedback to help them refine and develop first drafts of their systems map.</p></div><div className="teacher-session"><span>Signed in as</span><strong>{user.displayName}</strong><button type="button" className="button button--ghost" onClick={onLogout}>Sign out</button></div></div>
    <div className="model-switch teacher-dashboard__sections" role="tablist" aria-label="Teacher Console sections">{DASHBOARD_SECTIONS.map((item, index) => <button ref={(node) => node ? sectionTabRefs.current.set(item.id, node) : sectionTabRefs.current.delete(item.id)} key={item.id} id={`teacher-section-tab-${item.id}`} type="button" role="tab" aria-selected={section === item.id} aria-controls={`teacher-section-panel-${item.id}`} tabIndex={section === item.id ? 0 : -1} className={section === item.id ? 'is-active' : ''} onKeyDown={(event) => moveSection(event, index)} onClick={() => activateSection(item.id)}>{item.label}</button>)}</div>
    <div id="teacher-section-panel-reviews" role="tabpanel" aria-labelledby="teacher-section-tab-reviews" hidden={section !== 'reviews'}><ReviewSubmissions /></div>
    {guidanceVisited && <div id="teacher-section-panel-guidance" role="tabpanel" aria-labelledby="teacher-section-tab-guidance" hidden={section !== 'guidance'}><TeachingProfiles onConfigurationChanged={onConfigurationChanged} /></div>}
  </div>;
}

export default function TeacherDashboard({ onConfigurationChanged }) {
  const [teacherAccess, setTeacherAccess] = useState({ mode: 'manual', claimEnabled: false });
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState(null);
  const refreshAccess = async () => {
    const result = await apiRequest('/api/auth/accounts');
    setTeacherAccess(result.teacherAccess);
    return result.teacherAccess;
  };
  useEffect(() => {
    Promise.all([refreshAccess(), apiRequest('/api/auth/me')]).then(([, result]) => setUser(result.user)).catch((error) => setFatal(error.message)).finally(() => setLoading(false));
  }, []);
  const authenticated = (nextUser) => setUser(nextUser);
  const logout = async () => {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    setUser(null);
    await refreshAccess();
  };
  if (loading) return <div className="teacher-access"><p className="empty-message">Opening the Teacher Console…</p></div>;
  if (fatal) return <div className="teacher-access"><p className="eyebrow">Server connection required</p><h1>The Teacher Console is unavailable.</h1><p className="lede">{fatal}. Check the course server, then reopen the console.</p></div>;
  return user ? <AuthenticatedDashboard user={user} onLogout={logout} onConfigurationChanged={onConfigurationChanged} /> : <AccountAccess teacherAccess={teacherAccess} onAuthenticated={authenticated} />;
}
