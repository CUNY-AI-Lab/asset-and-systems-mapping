import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiRequest } from './api.js';

const CONFIG_KINDS = [
  { id: 'preflight', label: 'Preflight evaluator' },
  { id: 'builder', label: 'Graph builder' },
];
const SCOPES = ['global', 'micro', 'meso', 'macro', 'integration'];
const DASHBOARD_SECTIONS = [
  { id: 'reviews', label: 'Review submissions' },
  { id: 'guidance', label: 'Edit model prompts' },
];
const REVIEW_DECISIONS = [
  { id: 'approve', label: 'Approve' },
  { id: 'revise_and_approve', label: 'Approve with a question' },
  { id: 'reject', label: 'Reject' },
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

function DecisionHistory({ events, title = 'Decision history' }) {
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
  if (!suggestion || !criteria.length) return <p className="empty-message">No preflight suggestion was submitted.</p>;

  const evidence = uniqueValues(criteria.flatMap((criterion) => [criterion.evidence, criterion.evidenceExcerpt, criterion.evidenceLocator]));
  const modelSuggestions = uniqueValues(criteria.flatMap((criterion) => [criterion.rationale, criterion.nextAction]));
  const uncertainties = uniqueValues(criteria.flatMap((criterion) => {
    const status = readableValue(criterion.status).toLowerCase();
    const unresolved = criterion.hardBlock || criterion.missingVariable || /(?:fail|hold|missing|open|uncertain|blocked|not met)/.test(status);
    return unresolved ? [criterion.missingVariable, criterion.nextAction, criterion.rationale] : [];
  }));
  const hardGateSummary = suggestion.hardPass ? 'all hard gates met' : 'one or more hard gates unmet';

  const annotation = (label, values, emptyText) => <section className="suggestion-annotation">
    <h4>{label}</h4>
    {values.length ? <ul>{values.map((value, index) => <li key={`${label}:${index}`}>{value}</li>)}</ul> : <p>{emptyText}</p>}
  </section>;

  return <details className="teacher-model-review">
    <summary>Model review details</summary>
    <div className="teacher-model-review__body">
      <p className="teacher-model-review__note">Use these details as reference. You decide what the student should revisit.</p>
      <div className="suggestion-review">
        <p className="suggestion-review__summary"><strong>{suggestion.outcome}</strong> · {suggestion.score} of {scored.length} scored criteria met · threshold {suggestion.threshold} · {hardGateSummary}</p>
        {annotation('Evidence excerpts', evidence, 'No supporting evidence was recorded.')}
        {annotation('Possible redirects', modelSuggestions, 'No redirect was generated.')}
        {annotation('Open questions', uncertainties, 'No unresolved question was recorded.')}
        <details className="suggestion-criteria">
          <summary>Criterion details · {criteria.length}</summary>
          <ol>{criteria.map((criterion, index) => <li key={criterion.id || `criterion:${index}`}>
            <strong>{criterion.id || `Criterion ${index + 1}`} · {criterion.status}</strong>
            {readableValue(criterion.evidence) && <p><span>Evidence</span><br />{readableValue(criterion.evidence)}</p>}
            {readableValue(criterion.rationale) && <p><span>Rationale</span><br />{readableValue(criterion.rationale)}</p>}
            {readableValue(criterion.nextAction) && <p><span>Next action</span><br />{readableValue(criterion.nextAction)}</p>}
          </li>)}</ol>
        </details>
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
    if (mode === 'claim' && !bootstrapToken) return setMessage({ type: 'error', text: 'Enter the one-time server bootstrap token.' });
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
    <p className="eyebrow">Teacher access</p>
    <h1>{mode === 'login' ? 'Sign in to teacher configuration.' : 'Claim a teacher account.'}</h1>
    <p className="lede">Enter the account ID supplied outside the student application. Passphrases and bootstrap tokens are sent only to the authenticated classroom server and are never stored in browser project data.</p>
    <div className="model-switch teacher-access-switch" role="tablist" aria-label="Teacher access action">
      <button ref={(node) => node ? accessTabRefs.current.set('login', node) : accessTabRefs.current.delete('login')} id="teacher-access-tab-login" aria-controls="teacher-access-panel" type="button" role="tab" aria-selected={mode === 'login'} tabIndex={mode === 'login' ? 0 : -1} className={mode === 'login' ? 'is-active' : ''} onKeyDown={(event) => moveMode(event, 'login')} onClick={() => setMode('login')}>Sign in</button>
      <button ref={(node) => node ? accessTabRefs.current.set('claim', node) : accessTabRefs.current.delete('claim')} id="teacher-access-tab-claim" aria-controls="teacher-access-panel" type="button" role="tab" aria-selected={mode === 'claim'} tabIndex={mode === 'claim' ? 0 : -1} className={mode === 'claim' ? 'is-active' : ''} disabled={!teacherAccess.claimEnabled} onKeyDown={(event) => moveMode(event, 'claim')} onClick={() => setMode('claim')}>Claim account</button>
    </div>
    {!teacherAccess.claimEnabled && <p className="teacher-message">Account claiming is disabled. To claim an unclaimed teacher account, restart the service with a temporary bootstrap token; do not place that token in source or browser storage.</p>}
    <form className="access-form" id="teacher-access-panel" role="tabpanel" aria-labelledby={`teacher-access-tab-${mode}`} onSubmit={submit}>
      <label className="field"><span className="field__label">Teacher account ID</span><input maxLength="100" autoComplete="username" value={accountId} onChange={(event) => setAccountId(event.target.value)} /></label>
      <label className="field"><span className="field__label">Passphrase</span><input maxLength="128" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></label>
      {mode === 'claim' && <><label className="field"><span className="field__label">Confirm passphrase</span><input maxLength="128" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><label className="field"><span className="field__label">Server bootstrap token</span><input maxLength="256" type="password" autoComplete="off" value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} /></label></>}
      <Message message={message} />
      <button type="submit" className="button" disabled={busy}>{busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Claim account'}</button>
    </form>
  </div>;
}

function ModuleEditor({ module, onSaved, onConflictReloaded }) {
  const [content, setContent] = useState(module?.content || '');
  const [changeNote, setChangeNote] = useState('');
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(null);
  useEffect(() => {
    setContent(module?.content || '');
    setChangeNote('');
    setMessage(null);
    setConflict(null);
  }, [module?.id]);
  if (!module) return <p className="empty-message">Choose a module to edit.</p>;
  const dirty = content !== module.content;
  const save = async () => {
    if (!dirty) return setMessage({ type: 'error', text: 'Change the module content before saving a revision.' });
    if (!changeNote.trim()) return setMessage({ type: 'error', text: 'Add a change note before saving.' });
    setBusy(true);
    setConflict(null);
    try {
      const note = changeNote.trim();
      const result = await apiRequest(`/api/teacher/modules/${encodeURIComponent(module.id)}`, { method: 'PUT', body: { content, changeNote: note, expectedRevision: module.revision } });
      setContent(result.module.content);
      setMessage({ type: 'success', text: `Revision ${result.module.revision} saved.` });
      setChangeNote('');
      onSaved(result.module, note);
    } catch (error) {
      const current = error instanceof ApiError && error.status === 409 ? error.payload?.details?.current : null;
      if (current) {
        setConflict(current);
        setMessage({ type: 'error', text: `Revision ${current.revision} is now on the server. Your unsaved draft remains in the editor.` });
      } else {
        setMessage({ type: 'error', text: error instanceof ApiError && error.status === 409 ? 'This module changed in another session. Reload the dashboard before saving again.' : error.message });
      }
    } finally {
      setBusy(false);
    }
  };
  const loadConflict = () => {
    setContent(conflict.content);
    setChangeNote('');
    onConflictReloaded(conflict);
    setConflict(null);
    setMessage({ type: 'success', text: `Loaded server revision ${conflict.revision}. The previous local draft was replaced.` });
  };
  return <section className="module-editor">
    <header className="module-editor__head"><div><p className="eyebrow">{module.configKind} · {module.scale}</p><h2>{module.label}</h2><p>{module.description}</p></div><dl><div><dt>Revision</dt><dd>{module.revision}</dd></div><div><dt>Fingerprint</dt><dd>{module.fingerprint}</dd></div></dl></header>
    <label className="field"><span className="field__label">Module instructions</span><textarea className="prompt-editor" maxLength="20000" rows="15" value={content} onChange={(event) => setContent(event.target.value)} /></label>
    <p className="field__hint">This editable module is composed beneath fixed privacy, grounding, and schema guardrails.</p>
    <label className="field"><span className="field__label">Change note</span><input maxLength="500" value={changeNote} onChange={(event) => setChangeNote(event.target.value)} placeholder="What changed, and why?" /></label>
    <Message message={message} />
    {conflict && <div className="teacher-message teacher-message--error" role="group" aria-label="Revision conflict actions"><strong>Server revision {conflict.revision}</strong><p>Loading it will replace the unsaved text currently visible above.</p><button type="button" className="button button--ghost" onClick={loadConflict}>Load server revision {conflict.revision}</button></div>}
    <div className="button-row"><button type="button" className="button button--ghost" disabled={!dirty || busy} onClick={() => { setContent(module.content); setMessage(null); }}>Discard draft</button><button type="button" className="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save revision'}</button></div>
  </section>;
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
    if (!decision) return setMessage({ type: 'error', text: 'Choose a decision.' });
    if (!annotation) return setMessage({ type: 'error', text: 'Add a focus for the student before recording a decision.' });
    if (decision === 'revise_and_approve' && !question) return setMessage({ type: 'error', text: 'Add a question for the student before recording this decision.' });
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
      setMessage({ type: 'success', text: 'Decision recorded. The pending queue has been refreshed.' });
      setDecision('');
      setInstructorAnnotation('');
      setFocusedQuestion('');
      await loadQueue(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const current = error.payload?.details?.current;
        setConflict(current || true);
        setMessage({ type: 'error', text: 'This submission changed in another session. Your decision draft remains available.' });
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
      setMessage({ type: 'success', text: `Loaded submission revision ${current.revision}. Your decision draft remains available.` });
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
            <span>Review suggestions · {submission.activeScale}</span>
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
          <section><h3>Inquiry</h3><p>{detail.inquiry || 'No inquiry was submitted.'}</p></section>
          <section><h3>Memo excerpt</h3><p className="student-work__memo">{readableValue(detail.sourceMaterial) || 'No memo excerpt was submitted.'}</p><SuggestionReview suggestion={detail.suggestion} /></section>
          <section><h3>Student note</h3><p>{readableValue(detail.studentAnnotation) || 'No student note was submitted.'}</p></section>
        </div>}
      </section>

      <aside className="instructor-response" aria-labelledby="instructor-response-heading">
        <h2 id="instructor-response-heading">Write to the student.</h2>
        {detail ? <form onSubmit={submitDecision}>
          <p className="instructor-response__prompt">Name one focus for the student. Choose “Approve with a question” only when you want them to carry a question into the map. The student decides how to revise.</p>
          <label className="field instructor-response__guidance"><span className="field__label">Focus for the student</span><textarea rows="7" maxLength="4000" value={instructorAnnotation} onChange={(event) => setInstructorAnnotation(event.target.value)} /></label>
          <fieldset className="review-decision"><legend>Decision</legend><div className="review-decision__actions" role="group" aria-label="Submission decision">{REVIEW_DECISIONS.map((item) => <button key={item.id} type="button" aria-pressed={decision === item.id} className={decision === item.id ? 'is-selected' : ''} onClick={() => { setDecision(item.id); setMessage(null); }}>{item.label}</button>)}</div></fieldset>
          {decision === 'revise_and_approve' && <label className="field"><span className="field__label">Question for the student</span><textarea rows="5" maxLength="1000" value={focusedQuestion} onChange={(event) => setFocusedQuestion(event.target.value)} /></label>}
          <Message message={message} />
          {conflict && <div className="teacher-message teacher-message--error" role="group" aria-label="Submission conflict actions"><p>The server has a newer revision. Reload it before submitting the preserved draft again.</p><button type="button" className="button button--ghost" onClick={reloadConflict}>Reload current submission</button></div>}
          <button type="submit" className="button" disabled={busy}>{busy ? 'Recording…' : 'Record decision'}</button>
        </form> : <Message message={message} />}
        <DecisionHistory events={reviewHistory} />
        {lastEvents.length && lastDecision?.submission?.id !== detail?.id ? <DecisionHistory events={lastEvents} title="Latest recorded decision" /> : null}
      </aside>
    </div>
  </section>;
}

function ModelGuidance({ user, onConfigurationChanged }) {
  const [modules, setModules] = useState([]);
  const [history, setHistory] = useState([]);
  const [kind, setKind] = useState('preflight');
  const [scope, setScope] = useState('global');
  const [selectedId, setSelectedId] = useState(null);
  const [effective, setEffective] = useState(null);
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(true);
  const kindTabRefs = useRef(new Map());
  const load = async () => {
    setLoading(true);
    const [moduleResult, historyResult] = await Promise.allSettled([
      apiRequest('/api/teacher/modules'),
      apiRequest('/api/teacher/history?limit=60'),
    ]);
    if (moduleResult.status === 'fulfilled') {
      setModules(Array.isArray(moduleResult.value.modules) ? moduleResult.value.modules : []);
      if (historyResult.status === 'fulfilled') {
        setHistory(Array.isArray(historyResult.value.history) ? historyResult.value.history : []);
        setMessage(null);
      } else {
        setHistory([]);
        setMessage({ type: 'error', text: `Modules loaded, but revision history is unavailable: ${historyResult.reason.message}` });
      }
    } else {
      setModules([]);
      setHistory([]);
      setMessage({ type: 'error', text: moduleResult.reason.message });
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  const visibleModules = useMemo(() => modules.filter((module) => module.configKind === kind && module.scale === scope), [modules, kind, scope]);
  const selected = visibleModules.find((module) => module.id === selectedId) || visibleModules[0];
  useEffect(() => { setSelectedId(visibleModules[0]?.id || null); setEffective(null); }, [kind, scope, visibleModules[0]?.id]);
  const preview = async () => {
    try {
      const result = await apiRequest(`/api/teacher/effective?${new URLSearchParams({ configKind: kind, scale: scope === 'global' ? 'micro' : scope })}`);
      setEffective(result);
    } catch (error) { setMessage({ type: 'error', text: error.message }); }
  };
  const saved = (next, changeNote) => {
    setModules((current) => current.map((module) => module.id === next.id ? next : module));
    setHistory((current) => [{ id: `${next.id}:${next.revision}`, moduleId: next.id, label: next.label, configKind: next.configKind, scale: next.scale, revision: next.revision, changeNote, changedByName: user.displayName, changedAt: next.updatedAt }, ...current]);
    setEffective(null);
    onConfigurationChanged();
  };
  const conflictReloaded = (next) => {
    setModules((current) => current.map((module) => module.id === next.id ? next : module));
    setEffective(null);
  };
  const moveKind = (event, index) => {
    const nextIndex = rovingIndex(event, index, CONFIG_KINDS.length);
    if (nextIndex === null) return;
    event.preventDefault();
    const next = CONFIG_KINDS[nextIndex];
    setKind(next.id);
    kindTabRefs.current.get(next.id)?.focus();
  };
  if (loading) return <p className="empty-message">Loading model prompts…</p>;
  return <section className="model-guidance" aria-labelledby="model-guidance-heading">
    <div className="section-heading"><div><p className="eyebrow">Edit model prompts</p><h2 id="model-guidance-heading">Choose a prompt to edit.</h2></div></div>
    <Message message={message} />
    <div className="teacher-controls">
      <div className="model-switch" role="tablist" aria-label="Configuration system">{CONFIG_KINDS.map((config, index) => <button ref={(node) => node ? kindTabRefs.current.set(config.id, node) : kindTabRefs.current.delete(config.id)} key={config.id} id={`teacher-config-tab-${config.id}`} type="button" role="tab" aria-selected={kind === config.id} aria-controls="teacher-config-panel" tabIndex={kind === config.id ? 0 : -1} className={kind === config.id ? 'is-active' : ''} onKeyDown={(event) => moveKind(event, index)} onClick={() => setKind(config.id)}>{config.label}</button>)}</div>
      <label><span>Applies to</span><select value={scope} onChange={(event) => setScope(event.target.value)}>{SCOPES.map((scale) => <option key={scale} value={scale}>{scale === 'global' ? 'All scales' : `${scale[0].toUpperCase()}${scale.slice(1)} scale`}</option>)}</select></label>
      <label><span>Module</span><select aria-label="Module" value={selected?.id || ''} onChange={(event) => { setSelectedId(event.target.value); setEffective(null); }}>{visibleModules.map((module) => <option key={module.id} value={module.id}>{module.label} · v{module.revision}</option>)}</select></label>
      <button type="button" className="button button--secondary" onClick={preview}>Preview prompt in use</button>
    </div>
    <div className="teacher-workbench" id="teacher-config-panel" role="tabpanel" aria-labelledby={`teacher-config-tab-${kind}`}>
      <ModuleEditor module={selected} onSaved={saved} onConflictReloaded={conflictReloaded} />
      <details className="teacher-history"><summary>Shared revision history · {history.length}</summary>{history.length ? <ol>{history.slice(0, 18).map((entry) => {
        const changedAt = entry.changedAt || entry.updatedAt;
        const changedBy = entry.changedByName || entry.updatedByName || 'Source baseline';
        return <li key={entry.id || `${entry.moduleId}:${entry.revision}:${changedAt || 'unknown'}`}><strong>{entry.label || entry.moduleLabel || 'Prompt module'}</strong><p>{entry.changeNote || 'Revision recorded'}</p><small>{changedBy} · v{entry.revision}<br />{formatHistoryTime(changedAt)}</small></li>;
      })}</ol> : <p className="empty-message">No revision history is available.</p>}</details>
    </div>
    {effective && <section className="effective-preview"><div><p className="eyebrow">Prompt in use · {effective.configKind} · {effective.scale}</p><h2>Prompt in use</h2><dl><div><dt>Fingerprint</dt><dd>{effective.fingerprint}</dd></div><div><dt>Revision</dt><dd>{effective.revision}</dd></div></dl></div><pre>{effective.effectivePrompt}</pre></section>}
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
    <div className="teacher-dashboard__title"><div><p className="eyebrow">Teacher customization</p><h1>Teacher dashboard</h1></div><div className="teacher-session"><span>Signed in as</span><strong>{user.displayName}</strong><button type="button" className="button button--ghost" onClick={onLogout}>Sign out</button></div></div>
    <div className="model-switch teacher-dashboard__sections" role="tablist" aria-label="Teacher dashboard sections">{DASHBOARD_SECTIONS.map((item, index) => <button ref={(node) => node ? sectionTabRefs.current.set(item.id, node) : sectionTabRefs.current.delete(item.id)} key={item.id} id={`teacher-section-tab-${item.id}`} type="button" role="tab" aria-selected={section === item.id} aria-controls={`teacher-section-panel-${item.id}`} tabIndex={section === item.id ? 0 : -1} className={section === item.id ? 'is-active' : ''} onKeyDown={(event) => moveSection(event, index)} onClick={() => activateSection(item.id)}>{item.label}</button>)}</div>
    <div id="teacher-section-panel-reviews" role="tabpanel" aria-labelledby="teacher-section-tab-reviews" hidden={section !== 'reviews'}><ReviewSubmissions /></div>
    {guidanceVisited && <div id="teacher-section-panel-guidance" role="tabpanel" aria-labelledby="teacher-section-tab-guidance" hidden={section !== 'guidance'}><ModelGuidance user={user} onConfigurationChanged={onConfigurationChanged} /></div>}
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
  if (loading) return <div className="teacher-access"><p className="empty-message">Connecting to teacher configuration…</p></div>;
  if (fatal) return <div className="teacher-access"><p className="eyebrow">Server connection required</p><h1>Teacher configuration is unavailable.</h1><p className="lede">{fatal}. Check the authenticated classroom server, then reopen this dashboard.</p></div>;
  return user ? <AuthenticatedDashboard user={user} onLogout={logout} onConfigurationChanged={onConfigurationChanged} /> : <AccountAccess teacherAccess={teacherAccess} onAuthenticated={authenticated} />;
}
