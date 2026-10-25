import React, { useEffect, useRef, useState } from 'react';
import { PageHeading } from './ui/StudioPrimitives.jsx';
import { ApiError, apiRequest, resetTeacherPassword } from './api.js';
import { userFacingError } from './userFacingError.js';
import { institutionalLoginUrl, projectStorage } from './accountStorage.js';
import CourseStudents from './CourseStudents.jsx';
import { useVisibleRefresh } from './useVisibleRefresh.js';
import { SYSTEMS_MAPPING_STAGES } from '../shared/systems-mapping-stages.js';
import { SYSTEMS_MAPPING_LEVELS, systemsMappingLevel, systemsMappingLevelTitle } from '../shared/systems-mapping-parts.js';
import { fieldNotesQuestions, FIELD_NOTES_QUESTION_LIMIT } from '../shared/field-notes.js';
import './course-settings.css';

const DASHBOARD_SECTIONS = [
  { id: 'reviews', label: 'Submissions' },
  { id: 'guidance', label: 'Course settings' },
];
const REVIEW_DECISIONS = [
  { id: 'approve', label: 'Feedback only' },
  { id: 'revise_and_approve', label: 'Feedback and question' },
  { id: 'reject', label: 'Suggest revision' },
];

function Message({ message }) {
  if (!message) return null;
  return <p className={`teacher-message teacher-message--${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p>;
}

function ReviewColumnHeading({ id, children, actions }) {
  return <div className="review-column-heading"><h2 id={id}>{children}</h2>{actions}</div>;
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
  if (status === 'retired') return 'previous';
  return status;
}

function eventActionLabel(action) {
  return ({
    created: 'Draft created',
    updated: 'Draft saved',
    published: 'Published',
    retired: 'Replaced by a newer version',
  })[action] || action;
}

function scaleLabel(scale) {
  if (typeof scale !== 'string' || !scale) return '';
  return systemsMappingLevelTitle(scale) || `${scale[0].toUpperCase()}${scale.slice(1)}`;
}

function appendLevelNote(value, scale) {
  const title = scaleLabel(scale);
  if (!title) return value;
  const current = String(value || '').trimEnd();
  return `${current}${current ? '\n\n' : ''}${title}: `;
}

function stageModelUse(stageId, scale) {
  if (stageId === 'review-suggestions') {
    return {
      active: true,
      configKind: 'preflight',
      activeDetail: scale === 'micro'
        ? 'Uses these notes to suggest Micro-level elements and direct relationships from the memo.'
        : scale === 'meso'
          ? 'Uses these notes to suggest Meso-level linkages across at least two Micro-level settings.'
          : scale === 'exosphere'
            ? 'Uses these notes to suggest Exo-level institutions and supported institutional relationships.'
            : 'Uses these notes to suggest Macro-level conditions and the mapped elements they affect.',
    };
  }
  if (stageId === 'choose-what-to-map') {
    return {
      active: true,
      configKind: 'builder',
      activeDetail: scale === 'micro'
        ? 'Uses these notes when students request more Micro-level elements or direct relationships from the memo.'
        : scale === 'meso'
          ? 'Uses these notes when students request more Meso-level linkages across Micro-level settings.'
          : scale === 'exosphere'
            ? 'Uses these notes when students request more Exo-level institutions or institutional relationships.'
            : 'Uses these notes when students request more Macro-level conditions or change which mapped elements they affect.',
    };
  }
  return {
    active: false,
    configKind: 'preflight',
    inactiveDetail: 'This step does not call the model.',
  };
}

function runtimeEffect(runtime, stageId, scale) {
  const stageUse = stageModelUse(stageId, scale);
  if (!stageUse.active) {
    return {
      label: 'Notes are saved for this step.',
      detail: stageUse.inactiveDetail,
    };
  }
  if (['ollama-cloud', 'openrouter', 'cail-gateway'].includes(runtime?.provider)) {
    return {
      label: 'Model guidance is active.',
      detail: stageUse.activeDetail,
    };
  }
  return {
    label: 'Built-in suggestions are active.',
    detail: 'Saved notes do not affect built-in suggestions.',
  };
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
  return readableValue(submission?.projectMetadata?.participantName)
    || readableValue(submission?.projectMetadata?.title)
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
  const guidance = Array.isArray(suggestion?.guidance) ? suggestion.guidance : [];
  const nodes = Array.isArray(suggestion?.nodes) ? suggestion.nodes : [];
  const connections = Array.isArray(suggestion?.connections) ? suggestion.connections : [];
  const currentReview = guidance.length || nodes.length || connections.length || readableValue(suggestion?.readiness?.note);
  const hard = Array.isArray(suggestion?.hard) ? suggestion.hard : [];
  const scored = Array.isArray(suggestion?.scored) ? suggestion.scored : [];
  const criteria = [...hard, ...scored];
  if (!suggestion || (!currentReview && !criteria.length)) return <p className="empty-message">No review details are available.</p>;

  const legacyEvidence = uniqueValues(criteria.flatMap((criterion) => [criterion.evidence, criterion.evidenceExcerpt, criterion.evidenceLocator]));
  const legacyFollowUp = uniqueValues(criteria.flatMap((criterion) => [criterion.rationale, criterion.nextAction]));
  const legacyUncertainties = uniqueValues(criteria.flatMap((criterion) => {
    const status = readableValue(criterion.status).toLowerCase();
    const unresolved = criterion.hardBlock || criterion.missingVariable || /(?:fail|hold|missing|open|uncertain|blocked|not met)/.test(status);
    return unresolved ? [criterion.missingVariable, criterion.nextAction, criterion.rationale] : [];
  }));
  const evidence = currentReview
    ? uniqueValues([
      ...guidance.map((item) => item?.evidenceExcerpt),
      ...nodes.map((node) => node?.evidence),
      ...connections.map((connection) => connection?.rationale),
    ])
    : legacyEvidence;
  const mapIdeas = currentReview
    ? uniqueValues([
      ...nodes.map((node) => {
        const scopeLabels = (Array.isArray(node?.scope) ? node.scope : []).map((member) => readableValue(member?.label || member?.id)).filter(Boolean);
        if (node?.scale === 'meso' && scopeLabels.length) return `${readableValue(node.label)} includes ${scopeLabels.join('; ')}`;
        if (node?.scale === 'macrosphere' && scopeLabels.length) return `${readableValue(node.label)} ${readableValue(node.deontic) || 'affects'} ${scopeLabels.join('; ')}`;
        return node?.label;
      }),
      ...connections.map((connection) => `${readableValue(connection?.sourceLabel || connection?.source)} ${readableValue(connection?.verb)} ${readableValue(connection?.targetLabel || connection?.target)}`),
    ])
    : legacyFollowUp;
  const questions = currentReview
    ? uniqueValues([...guidance.map((item) => item?.point), suggestion?.readiness?.note])
    : legacyUncertainties;
  const gradedQuotations = guidance.filter(item => item?.evidenceExcerpt
    && ['normalized', 'elided'].includes(item.evidenceMatch));

  const annotation = (label, values, emptyText) => <section className="suggestion-annotation">
    <h4>{label}</h4>
    {values.length ? <ul>{values.map((value, index) => <li key={`${label}:${index}`}>{value}</li>)}</ul> : <p>{emptyText}</p>}
  </section>;

  return <details className="teacher-model-review">
    <summary>Review details</summary>
    <div className="teacher-model-review__body">
      <p className="teacher-model-review__note">Suggestions are advisory.</p>
      <div className="suggestion-review">
        {annotation(currentReview ? 'Memo evidence' : 'Evidence excerpts', evidence, 'The review did not cite a memo passage.')}
        {gradedQuotations.length > 0 && <section className="suggestion-annotation">
          <h4>Quotation matches</h4>
          <ul>{gradedQuotations.map((item, index) => <li key={index}>
            <blockquote>{item.evidenceExcerpt}</blockquote>
            <p>{item.evidenceMatch === 'elided'
              ? 'Elided quotation: matched passages in memo order with omissions. Check the omitted context.'
              : 'Normalized quotation: matched after typography or case normalization.'}</p>
          </li>)}</ul>
        </section>}
        {annotation(currentReview ? 'Map ideas' : 'Possible next step', mapIdeas, 'The review did not suggest a map item.')}
        {annotation(currentReview ? 'Questions to consider' : 'Open questions', questions, 'The review did not suggest a question.')}
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
    if (mode === 'claim' && !teacherAccess.claimEnabled) return setMessage({ type: 'error', text: 'Teacher account setup is unavailable. Ask the course administrator to restart the course server with a one-time setup code.' });
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
      setMessage({ type: 'error', text: error.status === 401
        ? mode === 'login'
          ? 'Sign-in did not work. Check your account ID and passphrase, then try again.'
          : 'Account setup could not be completed. Check your account ID and setup code, then try again.'
        : userFacingError(error, 'Sign-in could not be completed. Check your account details and try again.') });
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
    <p className="eyebrow">Instructor Console</p>
    <h1>{mode === 'login' ? 'Sign in to Instructor Console' : 'Set up teacher account'}</h1>
    <p className="lede">Enter the account ID provided by your school or program.</p>
    <div className="model-switch teacher-access-switch" role="tablist" aria-label="Instructor Console action">
      <button ref={(node) => node ? accessTabRefs.current.set('login', node) : accessTabRefs.current.delete('login')} id="teacher-access-tab-login" aria-controls="teacher-access-panel" type="button" role="tab" aria-selected={mode === 'login'} tabIndex={mode === 'login' ? 0 : -1} className={mode === 'login' ? 'is-active' : ''} onKeyDown={(event) => moveMode(event, 'login')} onClick={() => setMode('login')}>Sign in</button>
      <button ref={(node) => node ? accessTabRefs.current.set('claim', node) : accessTabRefs.current.delete('claim')} id="teacher-access-tab-claim" aria-controls="teacher-access-panel" type="button" role="tab" aria-selected={mode === 'claim'} tabIndex={mode === 'claim' ? 0 : -1} className={mode === 'claim' ? 'is-active' : ''} disabled={!teacherAccess.claimEnabled} onKeyDown={(event) => moveMode(event, 'claim')} onClick={() => setMode('claim')}>Set up account</button>
    </div>
    {!teacherAccess.claimEnabled && <p className="teacher-message">Teacher account setup is unavailable. Ask the course administrator to restart the course server with a one-time setup code. Do not save the code in project files or the browser.</p>}
    <form className="access-form" id="teacher-access-panel" role="tabpanel" aria-labelledby={`teacher-access-tab-${mode}`} onSubmit={submit}>
      <label className="field"><span className="field__label">Teacher account ID</span><input maxLength="100" autoComplete="username" value={accountId} onChange={(event) => setAccountId(event.target.value)} /></label>
      <label className="field"><span className="field__label">Passphrase</span><input maxLength="128" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></label>
      {mode === 'claim' && <><label className="field"><span className="field__label">Confirm passphrase</span><input maxLength="128" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><label className="field"><span className="field__label">One-time setup code</span><input maxLength="256" type="password" autoComplete="off" value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} /></label></>}
      <Message message={message} />
      <button type="submit" className="button" disabled={busy}>{busy ? mode === 'login' ? 'Signing in…' : 'Setting up account…' : mode === 'login' ? 'Sign in' : 'Set up account'}</button>
    </form>
  </div>;
}

function PasswordReset({ token, onComplete }) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (passphrase.length < 10) return setMessage({ type: 'error', text: 'Use a passphrase with at least 10 characters.' });
    if (passphrase !== confirmation) return setMessage({ type: 'error', text: 'The two passphrases do not match.' });
    setBusy(true);
    setMessage(null);
    try {
      await resetTeacherPassword(token, passphrase);
      setPassphrase('');
      setConfirmation('');
      onComplete();
    } catch (error) {
      setMessage({ type: 'error', text: error.status === 401
        ? 'This reset link is invalid or has expired. Ask the course administrator for a new link.'
        : userFacingError(error, 'Your passphrase could not be changed. Try again or ask for a new reset link.') });
    } finally {
      setBusy(false);
    }
  };
  return <div className="teacher-access">
    <p className="eyebrow">Instructor Console</p>
    <h1>Choose new passphrase</h1>
    <p className="lede">This password reset link can be used once. After you save the new passphrase, sign in with your teacher account ID.</p>
    <form className="access-form" onSubmit={submit}>
      <label className="field"><span className="field__label">New passphrase</span><input maxLength="128" type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></label>
      <label className="field"><span className="field__label">Confirm new passphrase</span><input maxLength="128" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      <Message message={message} />
      <button type="submit" className="button" disabled={busy}>{busy ? 'Saving…' : 'Save new passphrase'}</button>
    </form>
  </div>;
}

function ReviewSubmissions({ active = true }) {
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
  const queueGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const feedbackPending = Boolean(decision || instructorAnnotation || focusedQuestion);
  const feedbackPendingRef = useRef(feedbackPending);
  feedbackPendingRef.current = feedbackPending;

  const loadQueue = async (preferredId, { automatic = false } = {}) => {
    const generation = ++queueGeneration.current;
    setQueueLoading(true);
    setQueueError(null);
    try {
      const result = await apiRequest('/api/teacher/preflight-submissions?status=pending');
      if (generation !== queueGeneration.current) return null;
      // Feedback may start after an automatic request begins. Keep that draft
      // and its selected work; authorization failures still clear remote data.
      if (automatic && feedbackPendingRef.current) return null;
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
      if (generation !== queueGeneration.current) return null;
      detailGeneration.current++;
      setSubmissions([]); setSelectedId(null); setDetail(null); setReviewHistory([]); setLastDecision(null); setDetailLoading(false); setDetailError(null);
      setQueueError(userFacingError(error, 'Submissions could not be loaded. Select Refresh to try again.'));
      return null;
    } finally {
      if (generation === queueGeneration.current) setQueueLoading(false);
    }
  };

  useEffect(() => {
    if (active && !feedbackPending) void loadQueue(undefined, { automatic: true });
    return () => { queueGeneration.current++; };
  }, [active]);
  useVisibleRefresh(() => { if (!queueLoading && !detailLoading && !busy) void loadQueue(undefined, { automatic: true }); }, active && !feedbackPending);
  useEffect(() => {
    if (!selectedId) return undefined;
    let current = true;
    const generation = ++detailGeneration.current;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    apiRequest(`/api/teacher/preflight-submissions/${encodeURIComponent(selectedId)}`).then((result) => {
      if (!current || generation !== detailGeneration.current) return;
      setDetail(result.submission);
      setReviewHistory(Array.isArray(result.reviewEvents) ? result.reviewEvents : []);
      setDecision('');
      setInstructorAnnotation('');
      setFocusedQuestion('');
      setConflict(null);
      setMessage(null);
    }).catch((error) => {
      if (current && generation === detailGeneration.current) setDetailError(userFacingError(error, 'This submission could not be loaded. Select Refresh, then open it again.'));
    }).finally(() => {
      if (current && generation === detailGeneration.current) setDetailLoading(false);
    });
    return () => { current = false; };
  }, [selectedId]);

  const submitDecision = async (event) => {
    event.preventDefault();
    const annotation = instructorAnnotation.trim();
    const question = focusedQuestion.trim();
    if (!decision) return setMessage({ type: 'error', text: 'Choose a feedback type.' });
    if (!annotation) return setMessage({ type: 'error', text: 'Write feedback for the student before recording it.' });
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
      setMessage({ type: 'success', text: 'Feedback saved' });
      setDecision('');
      setInstructorAnnotation('');
      setFocusedQuestion('');
      await loadQueue(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const current = error.payload?.details?.current;
        setConflict(current || true);
        setMessage({ type: 'error', text: 'Another session changed this submission after you opened it. Your feedback remains in the form.' });
      } else {
        setMessage({ type: 'error', text: userFacingError(error, 'Your feedback could not be saved. Keep your text in the form and try again.') });
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
      setMessage({ type: 'success', text: `Loaded submission revision ${current.revision}. Your feedback remains in the form.` });
    } else {
      setConflict(null);
      setMessage({ type: 'error', text: 'The console could not load the current submission. Select Refresh, then try again.' });
    }
  };

  const selectSubmission = (id) => {
    if (id === selectedId) return;
    setSelectedId(id);
  };

  const lastEvents = lastDecision?.events || [];
  return <section className="review-submissions" aria-labelledby="review-submissions-heading">
    <div className={`teacher-review-grid${detail ? '' : ' teacher-review-grid--queue-only'}`}>
      <aside className="submission-queue" aria-labelledby="review-submissions-heading">
        <ReviewColumnHeading id="review-submissions-heading" actions={<button type="button" className="button button--ghost" disabled={queueLoading} onClick={() => loadQueue()}>{queueLoading ? 'Refreshing…' : 'Refresh'}</button>}>Submissions</ReviewColumnHeading>
        {(submissions.length > 0 || feedbackPending) && <p className="field__hint">{feedbackPending ? 'Refresh paused while you draft.' : 'Updates every 30 seconds.'}</p>}
        {queueError && <p className="teacher-message teacher-message--error" role="alert">{queueError}</p>}
        {queueLoading && !submissions.length ? <p className="empty-message" role="status">Loading submissions…</p> : null}
        {!queueLoading && !submissions.length && !queueError ? <p className="empty-message">No submissions yet</p> : null}
        {submissions.length ? <ol className="submission-queue__list">{submissions.map((submission, index) => <li key={submission.id}>
          <button type="button" className={selectedId === submission.id ? 'is-selected' : ''} aria-current={selectedId === submission.id ? 'true' : undefined} onClick={() => selectSubmission(submission.id)}>
            <strong>{submissionLabel(submission, index)}</strong>
            <span>{submissionContextLabel(submission)}</span>
            <small>{formatHistoryTime(submission.submittedAt)}</small>
          </button>
        </li>)}</ol> : null}
      </aside>

      {detail && <section className="student-work" aria-labelledby="student-work-heading">
        <ReviewColumnHeading id="student-work-heading">Work</ReviewColumnHeading>
        <div className="student-work__body">
          <p className="eyebrow">{submissionContextLabel(detail)}</p>
          {readableValue(detail.projectMetadata?.participantName) ? <section><h3>Student or group</h3><p>{readableValue(detail.projectMetadata.participantName)}</p></section> : null}
          {detail.inquiry ? <section><h3>Question</h3><p>{detail.inquiry}</p></section> : null}
          <section><h3>Memo</h3><p className="student-work__memo">{readableValue(detail.sourceMaterial) || 'No memo was submitted.'}</p><SuggestionReview suggestion={detail.suggestion} /></section>
          {readableValue(detail.studentAnnotation) ? <section><h3>Student note</h3><p>{readableValue(detail.studentAnnotation)}</p></section> : null}
        </div>
      </section>}

      {detail && <aside className="instructor-response" aria-labelledby="instructor-response-heading">
        <ReviewColumnHeading id="instructor-response-heading">Feedback</ReviewColumnHeading>
        <form onSubmit={submitDecision}>

          <label className="field instructor-response__guidance"><span className="field__label">Feedback for the student</span><textarea rows="7" maxLength="4000" value={instructorAnnotation} onChange={(event) => setInstructorAnnotation(event.target.value)} /></label>
          <fieldset className="review-decision"><legend>Feedback type</legend><div className="review-decision__actions">{REVIEW_DECISIONS.map((item) => <button key={item.id} type="button" aria-pressed={decision === item.id} className={decision === item.id ? 'is-selected' : ''} onClick={() => { setDecision(item.id); setMessage(null); }}>{item.label}</button>)}</div></fieldset>
          {decision === 'revise_and_approve' && <label className="field"><span className="field__label">Question for the student</span><textarea rows="5" maxLength="1000" value={focusedQuestion} onChange={(event) => setFocusedQuestion(event.target.value)} /></label>}
          <Message message={message} />
          {conflict && <div className="teacher-message teacher-message--error" role="group" aria-label="Submission conflict actions"><p>Select Reload current submission to review the newer version. Your feedback stays in the form.</p><button type="button" className="button button--ghost" onClick={reloadConflict}>Reload current submission</button></div>}
          <button type="submit" className="button" disabled={busy}>{busy ? 'Saving…' : 'Save feedback'}</button>
        </form>
        <DecisionHistory events={reviewHistory} />
      </aside>}
    </div>
    {detailLoading && <p className="review-submissions__status" role="status">Loading submission…</p>}
    {detailError && <p className="teacher-message teacher-message--error" role="alert">{detailError}</p>}
    {!detail && <Message message={message} />}
    {lastEvents.length && lastDecision?.submission?.id !== detail?.id ? <DecisionHistory events={lastEvents} title="Latest feedback" /> : null}
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
  const promptRef = useRef(null);
  const focusPromptOnLoad = useRef(false);

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
    loadCatalog().catch((error) => setMessage({ type: 'error', text: userFacingError(error, 'Course settings could not be loaded. Reopen the Instructor Console to try again.') })).finally(() => setLoading(false));
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
    }).catch((error) => setMessage({ type: 'error', text: userFacingError(error, 'These course settings could not be loaded. Select another version, then try again.') })).finally(() => setLoading(false));
  }, [selectedId]);

  useEffect(() => {
    if (focusPromptOnLoad.current && !loading && !busy && detail?.status === 'draft') {
      promptRef.current?.focus({ preventScroll: true });
      focusPromptOnLoad.current = false;
    }
  }, [loading, busy, detail]);

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
      setMessage({ type: 'error', text: userFacingError(error, 'The draft could not be created. Keep your text in the form and try again.') });
    } finally { setBusy(false); }
  };

  const editPrompts = async () => {
    setBusy(true);
    focusPromptOnLoad.current = true;
    try {
      const result = await apiRequest('/api/teacher/profiles', {
        method: 'POST',
        body: {
          name: detail.name.endsWith(' Field Notes') ? detail.name : `${detail.name.slice(0, 100)} Field Notes`,
          note: 'Adapt Field Notes to the lesson.',
          sourceProfileId: detail.id,
        },
      });
      await loadCatalog(result.profile.id);
    } catch (error) {
      focusPromptOnLoad.current = false;
      setMessage({ type: 'error', text: userFacingError(error, 'The prompts could not be opened for editing. Try Edit prompts again.') });
    } finally { setBusy(false); }
  };

  const changeNote = () => {
    if (note.trim()) return note.trim();
    const original = fieldNotesQuestions(detail.profile);
    const changed = Object.entries(fieldNotesQuestions(draft.profile))
      .filter(([scale, question]) => question !== original[scale]).map(([scale]) => scaleLabel(scale));
    return changed.length ? `Update Field Notes for ${changed.join(', ')}.` : 'Update course settings.';
  };

  const validDraft = () => {
    if (!draft?.name.trim()) {
      setMessage({ type: 'error', text: 'Name the draft before saving it.' });
      return false;
    }
    if (note.trim() && note.trim().length < 3) {
      setMessage({ type: 'error', text: 'Use at least three characters for the change note, or leave it blank.' });
      return false;
    }
    const missingScale = SYSTEMS_MAPPING_LEVELS.find(({ id }) => !fieldNotesQuestions(draft.profile)[id]?.trim());
    if (missingScale) {
      setPreviewScale(missingScale.id);
      setSelectedPartId(profileParts.find(part => part.scaleIds.includes(missingScale.id))?.id || null);
      setMessage({ type: 'error', text: `Add a Field Notes prompt for ${missingScale.title}.` });
      window.requestAnimationFrame(() => promptRef.current?.focus());
      return false;
    }
    return true;
  };

  const saveDraftVersion = async () => {
    const result = await apiRequest(`/api/teacher/profiles/${encodeURIComponent(detail.id)}`, {
      method: 'PUT',
      body: { name: draft.name.trim(), profile: draft.profile, note: changeNote(), expectedRevision: detail.revision },
    });
    setDetail(result.profile);
    setDraft({ name: result.profile.name, profile: structuredClone(result.profile.profile) });
    setEvents(result.events || []);
    setNote('');
    setConflict(null);
    return result;
  };

  const saveDraft = async () => {
    if (!validDraft()) return;
    setBusy(true);
    try {
      const result = await saveDraftVersion();
      setMessage({ type: 'success', text: `Draft revision ${result.profile.revision} saved.` });
      await loadCatalog(result.profile.id);
    } catch (error) {
      const current = error instanceof ApiError && error.status === 409 ? error.payload?.details?.current : null;
      if (current) {
        setConflict(current);
        setMessage({ type: 'error', text: 'Another session saved a newer revision of this draft. Your unsaved text remains in the editor.' });
      } else setMessage({ type: 'error', text: userFacingError(error, 'The draft could not be saved. Keep your text in the editor and try again.') });
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
    if (!validDraft()) return;
    const publicationNote = changeNote();
    setBusy(true);
    try {
      const target = dirty ? (await saveDraftVersion()).profile : detail;
      const result = await apiRequest(`/api/teacher/profiles/${encodeURIComponent(target.id)}/publish`, {
        method: 'POST',
        body: { note: publicationNote, expectedRevision: target.revision },
      });
      setDetail(result.profile);
      setDraft({ name: result.profile.name, profile: structuredClone(result.profile.profile) });
      setEvents(result.events || []);
      setNote('');
      setPreview(null);
      setMessage({ type: 'success', text: 'Published. Students will see the updated prompts.' });
      await loadCatalog(result.profile.id);
      onConfigurationChanged();
    } catch (error) {
      const current = error instanceof ApiError && error.status === 409 ? error.payload?.details?.current : null;
      if (current) setConflict(current);
      setMessage({ type: 'error', text: current ? 'Another session saved a newer revision before publication. Your unsaved text remains in the editor.' : userFacingError(error, 'These settings could not be published. Keep your changes and try again.') });
    } finally { setBusy(false); }
  };

  const loadPreview = async () => {
    setBusy(true);
    try {
      const { configKind } = stageModelUse(selectedStageId, previewScale);
      const result = await apiRequest(`/api/teacher/profiles/${encodeURIComponent(detail.id)}/preview?${new URLSearchParams({ configKind, scale: previewScale, stageId: selectedStageId })}`);
      setPreview(result);
      setMessage(null);
    } catch (error) { setMessage({ type: 'error', text: userFacingError(error, 'The preview could not be loaded. Select Preview saved section to try again.') }); }
    finally { setBusy(false); }
  };

  const profiles = catalog?.profiles || [];
  const editable = detail?.status === 'draft';
  const dirty = Boolean(editable && draft && (
    draft.name !== detail.name || JSON.stringify(draft.profile) !== JSON.stringify(detail.profile)
  ));
  useEffect(() => {
    if (!dirty) return undefined;
    const protectDraft = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, [dirty]);
  if (loading && !catalog) return <p className="empty-message">Loading course settings…</p>;
  const selectedStageIndex = Math.max(0, SYSTEMS_MAPPING_STAGES.findIndex(({ id }) => id === selectedStageId));
  const selectedStage = SYSTEMS_MAPPING_STAGES[selectedStageIndex];
  const selectedStageSettings = selectedPart?.stages?.[selectedStage.id] || { guidance: '', materials: '' };
  const stageUse = stageModelUse(selectedStageId, previewScale);
  const runtime = runtimeEffect(catalog?.runtime, selectedStageId, previewScale);
  const previewLevel = systemsMappingLevel(previewScale);
  const levelNotePrefix = `${scaleLabel(previewScale)}: `;
  const canAppendLevelNote = editable && selectedStageSettings.guidance.length + levelNotePrefix.length + 2 <= 2500;
  return <section className="model-guidance teaching-profiles course-settings" aria-labelledby="course-settings-heading" aria-busy={busy || loading}>
    <div className="section-heading"><div><h2 id="course-settings-heading">Field Notes prompts</h2><p>One question for each scale.</p></div></div>
    <Message message={message} />
    {detail && draft && <>
      <div className="course-settings__body">
        <fieldset className="course-prompt-editor" aria-label="Field Notes customization" disabled={busy || loading}>
          <label className="field course-settings__scale"><span className="field__label">Scale</span><select aria-label="Scale" value={previewScale} onChange={(event) => {
            const scale = event.target.value;
            setPreviewScale(scale);
            setSelectedPartId(profileParts.find(part => part.scaleIds.includes(scale))?.id || null);
            setPreview(null);
          }}>{SYSTEMS_MAPPING_LEVELS.map(({ id, title }) => <option key={id} value={id}>{title}</option>)}</select></label>
          <label className="field"><span className="field__label">Field Notes prompt</span>
            <textarea ref={promptRef} rows="7" maxLength={FIELD_NOTES_QUESTION_LIMIT} readOnly={!editable}
              aria-describedby="course-prompt-help" aria-invalid={message?.type === 'error' && !fieldNotesQuestions(draft.profile)[previewScale].trim() || undefined}
              value={fieldNotesQuestions(draft.profile)[previewScale]}
              onChange={(event) => {
                const question = event.target.value;
                setDraft(current => ({ ...current, profile: { ...current.profile, fieldNotesQuestions: { ...fieldNotesQuestions(current.profile), [previewScale]: question } } }));
              }} />
          </label>
          <p id="course-prompt-help" className="field__hint">Students answer this question before completing the scale.</p>
          <details className="course-student-preview"><summary>Student preview</summary>
            <div className="course-student-preview__page"><h3>Field Notes</h3><p className="course-student-preview__scale">{scaleLabel(previewScale)}</p><p className="course-student-preview__question">{fieldNotesQuestions(draft.profile)[previewScale] || 'Your prompt will appear here.'}</p></div>
          </details>
        </fieldset>
        {conflict && <div className="teacher-message teacher-message--error" role="group" aria-label="Draft conflict actions"><p>A newer revision is available. Load it only if you want to replace the text in this editor.</p><button type="button" className="button button--ghost" disabled={busy} onClick={loadConflict}>Load server revision {conflict.revision}</button></div>}
        <div className="course-settings__actions">
          <p className="course-settings__status" role="status">{busy ? 'Saving…' : editable ? dirty ? 'Unsaved changes' : 'Saved draft' : detail.status === 'active' ? 'Published prompts' : 'Previous version'}</p>
          <div>{editable ? <>
            <button type="button" className="button button--secondary" disabled={busy || loading || !dirty} onClick={saveDraft}>Save draft</button>
            <button type="button" className="button" disabled={busy || loading} onClick={publish}>Publish changes</button>
          </> : <button type="button" className="button" disabled={busy || loading} onClick={editPrompts}>Edit prompts</button>}</div>
        </div>
      </div>
      <div className="course-settings__additional">
        <details className="course-model-settings"><summary>Guidance and materials</summary>
          <fieldset className="course-model-fields" disabled={busy || loading}>
        <p className="teacher-message teacher-runtime" role="note"><strong>{runtime.label}</strong> {runtime.detail}</p>
        {selectedPart ? <>
          <div className="teacher-controls teaching-profile-controls" role="group" aria-label="Course section">
            <label><span>Part</span><select aria-label="Part" value={selectedPart.id} onChange={(event) => selectPart(event.target.value)}>{profileParts.map((part) => <option key={part.id} value={part.id}>{part.label}</option>)}</select></label>
            <label><span>Mapping step</span><select aria-label="Mapping step" value={selectedStageId} onChange={(event) => { setSelectedStageId(event.target.value); setPreview(null); }}>{SYSTEMS_MAPPING_STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label>
          </div>
          <p className="field__hint">Applies to {selectedPart.scaleIds.map(scaleLabel).join(' and ')}.</p>
        </> : <p className="teacher-message teacher-message--error" role="alert">The selected version has no course parts.</p>}
        {selectedPart && <section className="course-stage-editor" aria-labelledby={`course-stage-heading-${selectedStage.id}`}>
          <p className="course-stage-context" id={`course-stage-heading-${selectedStage.id}`}>{selectedStage.description}</p>
          <label className="field"><span className="field__label">Guidance</span><textarea rows="6" maxLength="2500" readOnly={!editable} value={selectedStageSettings.guidance} onChange={(event) => changeStage('guidance', event.target.value)} /></label>
          {editable && <div className="button-row"><button type="button" className="button button--ghost" disabled={!canAppendLevelNote} onClick={() => changeStage('guidance', appendLevelNote(selectedStageSettings.guidance, previewScale))}>Add {scaleLabel(previewScale)} note</button></div>}
          <p className="field__hint">Level definitions and map rules remain fixed.</p>
          <label className="field"><span className="field__label">Course material</span><textarea rows="7" maxLength="4000" readOnly={!editable} value={selectedStageSettings.materials} onChange={(event) => changeStage('materials', event.target.value)} /></label>
          <p className="field__hint">Use a course passage or reference.</p>
        </section>}

            <details className="course-model-preview course-model-preview-panel"><summary>Saved guidance preview</summary>

        <p><strong>{selectedPart?.label}</strong>{selectedPart ? ` · ${scaleLabel(previewScale)} · ${selectedStage.label}` : ''}</p>
        {previewLevel && <p className="field__hint">{previewLevel.description}</p>}
        {selectedPart && <label className="field"><span className="field__label">Preview level</span><select aria-label="Preview level" value={previewScale} onChange={(event) => { setPreviewScale(event.target.value); setPreview(null); }}>{selectedPart.scaleIds.map((scale) => <option key={scale} value={scale}>{scaleLabel(scale)}</option>)}</select></label>}
        <button type="button" className="button button--secondary" disabled={busy || dirty || !selectedPart} onClick={loadPreview}>Preview saved section</button>
        {preview && <div className="effective-preview" aria-label={stageUse.active ? 'Course guidance sent to the model' : 'Saved course notes'}><strong>Saved version {preview.revision}</strong><p>{preview.part.label} · {selectedStage.label} · {scaleLabel(preview.scale)}</p><div className="saved-course-settings"><strong>Instructor guidance</strong><p>{preview.guidance || 'No instructor guidance added.'}</p><strong>Course material</strong><p>{preview.materials || 'No course material added.'}</p></div></div>}
        </details>
          </fieldset>
        </details>
    <details className="teacher-history teaching-profile-versioning">
      <summary>Versions</summary>
      <div className="teacher-controls teaching-profile-controls course-version-controls">
        <label><span>Version</span><select aria-label="Version" value={selectedId || ''} disabled={busy || loading} onChange={(event) => {
          if (dirty) { setMessage({ type: 'error', text: 'Save or publish your changes before switching versions.' }); return; }
          setSelectedId(event.target.value);
        }}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profileStatusLabel(profile.status)}</option>)}</select></label>
        <button type="button" className="button button--secondary" disabled={busy || loading || dirty} onClick={() => setCreating(value => !value)}>{creating ? 'Cancel' : 'Create a draft'}</button>
      </div>
      {creating && <form className="teaching-profile-create" onSubmit={createDraft}>
        <label className="field"><span className="field__label">Draft name</span><input maxLength="120" disabled={busy || loading} value={newName} onChange={(event) => setNewName(event.target.value)} /></label>
        <label className="field"><span className="field__label">Planned changes</span><input maxLength="500" disabled={busy || loading} value={newNote} onChange={(event) => setNewNote(event.target.value)} /></label>
        <button type="submit" className="button" disabled={busy}>Create draft</button>
      </form>}
      {editable && <label className="field"><span className="field__label">Change note (optional)</span><input maxLength="500" disabled={busy || loading} value={note} onChange={(event) => setNote(event.target.value)} /></label>}
      {detail && draft && <label className="field"><span className="field__label">Version name</span><input maxLength="120" readOnly={!editable} disabled={busy || loading} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>}
      {events.length ? <ol>{events.map((event) => <li key={event.id}><strong>{eventActionLabel(event.action)}</strong><p>{event.note}</p><small>{event.actorName || 'Original settings'} · version {event.revision}<br />{formatHistoryTime(event.occurredAt)}</small></li>)}</ol> : <p className="empty-message">No changes recorded.</p>}
    </details>
      </div>
    </>}
  </section>;
}

function AuthenticatedDashboard({ user, onLogout, onConfigurationChanged, institutionalMode = false, sessionError = null }) {
  const [section, setSection] = useState('reviews');
  const [guidanceVisited, setGuidanceVisited] = useState(false);
  const [studentsVisited, setStudentsVisited] = useState(false);
  const [studentsOpen, setStudentsOpen] = useState(false);
  const sectionTabRefs = useRef(new Map());
  const accountRef = useRef(null);
  useEffect(() => {
    const closeAccount = event => {
      if (!accountRef.current?.open) return;
      if (event.type === 'pointerdown' && !accountRef.current.contains(event.target)) accountRef.current.open = false;
      if (event.type === 'keydown' && event.key === 'Escape') {
        accountRef.current.open = false;
        accountRef.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeAccount);
    document.addEventListener('keydown', closeAccount);
    return () => {
      document.removeEventListener('pointerdown', closeAccount);
      document.removeEventListener('keydown', closeAccount);
    };
  }, []);
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
  return <div className={`teacher-dashboard${section === 'guidance' ? ' teacher-dashboard--settings' : ''}`}>
    <PageHeading title="Instructor Console" actions={<details ref={accountRef} className="teacher-account"><summary>Account</summary><div><strong>{user.displayName}</strong>{institutionalMode ? <form method="post" action="/auth/logout"><button type="submit" className="button button--ghost">Sign out</button></form> : <button type="button" className="button button--ghost" onClick={onLogout}>Sign out</button>}</div></details>} />
    {sessionError && <p className="teacher-message teacher-message--error" role="alert">{sessionError}</p>}
    <div className="model-switch teacher-dashboard__sections" role="tablist" aria-label="Instructor Console sections">{DASHBOARD_SECTIONS.map((item, index) => <button ref={(node) => node ? sectionTabRefs.current.set(item.id, node) : sectionTabRefs.current.delete(item.id)} key={item.id} id={`teacher-section-tab-${item.id}`} type="button" role="tab" aria-selected={section === item.id} aria-controls={`teacher-section-panel-${item.id}`} tabIndex={section === item.id ? 0 : -1} className={section === item.id ? 'is-active' : ''} onKeyDown={(event) => moveSection(event, index)} onClick={() => activateSection(item.id)}>{item.label}</button>)}</div>
    <div id="teacher-section-panel-reviews" role="tabpanel" aria-labelledby="teacher-section-tab-reviews" hidden={section !== 'reviews'}>
      {institutionalMode && projectStorage().courseSelection?.kind === 'course' && <details className="course-progress-disclosure" onToggle={event => { setStudentsOpen(event.currentTarget.open); if (event.currentTarget.open) setStudentsVisited(true); }}>
        <summary>Saved progress</summary>
        {studentsVisited && <CourseStudents active={section === 'reviews' && studentsOpen} />}
      </details>}
      <ReviewSubmissions active={section === 'reviews'} />
    </div>
    {guidanceVisited && <div id="teacher-section-panel-guidance" role="tabpanel" aria-labelledby="teacher-section-tab-guidance" hidden={section !== 'guidance'}><TeachingProfiles onConfigurationChanged={onConfigurationChanged} /></div>}
  </div>;
}

export default function TeacherDashboard({ onConfigurationChanged, resetToken = null, onResetComplete = () => {}, institutionalMode = false }) {
  const [teacherAccess, setTeacherAccess] = useState({ mode: 'manual', claimEnabled: false });
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState(null);
  const [sessionError, setSessionError] = useState(null);
  const refreshAccess = async () => {
    if (institutionalMode) return { mode: 'institutional', claimEnabled: false };
    const result = await apiRequest('/api/auth/accounts');
    setTeacherAccess(result.teacherAccess);
    return result.teacherAccess;
  };
  useEffect(() => {
    Promise.all([refreshAccess(), apiRequest('/api/auth/me')]).then(([, result]) => setUser(result.user)).catch((error) => setFatal(userFacingError(error, 'The Instructor Console could not be opened. Reload this page to try again.'))).finally(() => setLoading(false));
  }, [institutionalMode]);
  const authenticated = (nextUser) => setUser(nextUser);
  const logout = async () => {
    setSessionError(null);
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
      setUser(null);
    } catch (error) {
      setSessionError(userFacingError(error, 'Sign-out could not be confirmed. Try signing out again before leaving this device.'));
      return;
    }
    try { await refreshAccess(); }
    catch (error) { setFatal(userFacingError(error, 'You are signed out, but the sign-in form could not be loaded. Reload this page to continue.')); }
  };
  if (resetToken && !institutionalMode) return <PasswordReset token={resetToken} onComplete={onResetComplete} />;
  if (loading) return <div className="teacher-access"><p className="empty-message">Opening the Instructor Console…</p></div>;
  if (fatal) return <div className="teacher-access"><p className="eyebrow">Server connection required</p><h1>Instructor Console unavailable</h1><p className="lede">Check the course server, then reopen the Instructor Console.</p><p className="teacher-message teacher-message--error" role="alert">{fatal}</p></div>;
  if (!user && institutionalMode) return <div className="teacher-access"><h1>Instructor access required</h1><a className="button" href={institutionalLoginUrl()}>CUNY Login</a></div>;
  return user ? <AuthenticatedDashboard user={user} onLogout={logout} onConfigurationChanged={onConfigurationChanged} institutionalMode={institutionalMode} sessionError={sessionError} /> : <AccountAccess teacherAccess={teacherAccess} onAuthenticated={authenticated} />;
}
