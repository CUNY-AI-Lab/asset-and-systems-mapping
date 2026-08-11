import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CLAIM_STATES,
  NODE_TYPES,
  PROJECT_LIMITS,
  SCALE_ORDER,
  SCALES,
  configFingerprint,
  createPortableProject,
  createDefaultProject,
  createEvent,
  extractCandidates,
  parseProject,
  serializePortableProject,
  serializeProject,
  stableId,
  validateProject,
  withDefaultNodeLayout,
} from './domain.js';
import TeacherDashboard from './TeacherDashboard.jsx';
import { SYSTEMS_MAPPING_STAGES } from '../shared/systems-mapping-stages.js';
import {
  ApiError,
  createPreflightEvaluation,
  endStudentAccess,
  getPreflightSubmission,
  getPublicConfiguration,
  getStudentSession,
  recordPrototypeEvent,
  requestStudentAccess,
  submitPreflightSubmission,
} from './api.js';

const STORAGE_KEY = 'systems-mapping-studio.project.v2';
const LEGACY_STORAGE_KEY = 'systems-mapping-studio.project.v1';
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_CHARACTERS = 500_000;
const MAX_PROJECT_BYTES = 8 * 1024 * 1024;
const MAX_EVALUATION_POST_BYTES = 700 * 1024;
const MAX_EVALUATION_INQUIRY_CHARACTERS = 8_000;
const MAX_EVALUATION_INQUIRY_BYTES = 8_192;
const MAX_EVALUATION_CUSTOM_INSTRUCTIONS = 16_000;
const PERSIST_DEBOUNCE_MS = 450;
const ANNOTATION_COMMIT_DEBOUNCE_MS = 280;
const CONFIG_TEXT_LIMIT = 500;
const NODE_LABEL_LIMIT = 200;
const RELATIONSHIP_VERB_LIMIT = 100;
const FILE_NAME_LIMIT = 255;
const RELATION_VOCABULARY_TEXT_LIMIT = PROJECT_LIMITS.relationVocabulary * (RELATIONSHIP_VERB_LIMIT + 2);
const VIEWPORT_LIMITS = { minZoom: 0.5, maxZoom: 2, minPan: -840, maxPan: 840 };

const STAGES = SYSTEMS_MAPPING_STAGES;

const REVIEW_STATUSES = ['pending', 'approved', 'rejected'];
const REVIEW_DECISIONS = ['approve', 'revise_and_approve', 'reject'];

function preserveRejectedReview(draft) {
  return draft.preflight?.review?.decision === 'reject';
}

function invalidatePreflight(draft) {
  if (!preserveRejectedReview(draft)) draft.preflight = null;
}

function loadProject() {
  try {
    const current = window.localStorage.getItem(STORAGE_KEY);
    const legacy = current === null ? window.localStorage.getItem(LEGACY_STORAGE_KEY) : null;
    const saved = current ?? legacy;
    if (saved === null) {
      return { project: createDefaultProject(), loadError: null, recovery: null, hasSavedProject: false, persistenceBlocked: false, sourceKey: null };
    }
    try {
      return {
        project: parseProject(saved),
        loadError: null,
        recovery: null,
        hasSavedProject: true,
        persistenceBlocked: false,
        sourceKey: current === null ? LEGACY_STORAGE_KEY : STORAGE_KEY,
      };
    } catch (error) {
      return {
        project: createDefaultProject(),
        loadError: `The previous browser workspace could not be validated: ${error.message}`,
        recovery: saved,
        hasSavedProject: false,
        persistenceBlocked: true,
        sourceKey: current === null ? LEGACY_STORAGE_KEY : STORAGE_KEY,
      };
    }
  } catch (error) {
    return {
      project: createDefaultProject(),
      loadError: `Browser storage is unavailable: ${error.message}`,
      recovery: null,
      hasSavedProject: false,
      persistenceBlocked: true,
      sourceKey: null,
    };
  }
}

function handleCompositeKey(event, values, current, onChange) {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (!keys.includes(event.key) || values.length < 2) return;
  event.preventDefault();
  const index = Math.max(0, values.indexOf(current));
  const backwards = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1 : (index + (backwards ? -1 : 1) + values.length) % values.length;
  const next = values[nextIndex];
  const container = event.currentTarget.parentElement;
  onChange(next);
  window.setTimeout(() => container?.querySelector(`[data-composite-value="${next}"]`)?.focus(), 0);
}

function invalidateSubmissionDerived(draft, field, value) {
  const textChanged = field === 'text' && draft.submission.text !== value;
  draft.submission[field] = value;
  invalidatePreflight(draft);
  if (!textChanged) return;
  draft.submission.revision = (draft.submission.revision || 1) + 1;
  draft.submission.fingerprint = stableId('src', value);
  draft.candidates = { nodes: [], edges: [] };
  draft.graph.nodes.forEach((node) => {
    if (node.sourceFingerprint || String(node.evidence || '').startsWith('Memo sentence')) {
      node.claimState = 'retired';
      node.notes = [node.notes, 'Retired after the source memo changed; regenerate to re-anchor evidence.'].filter(Boolean).join(' ');
    }
  });
  draft.graph.edges.forEach((edge) => {
    if (edge.sourceFingerprint || String(edge.evidence || '').startsWith('Memo sentence')) {
      edge.claimState = 'retired';
      edge.notes = [edge.notes, 'Retired after the source memo changed; regenerate to re-anchor evidence.'].filter(Boolean).join(' ');
    }
  });
}

function configurationSnapshot(project, kind) {
  const local = project.configs[kind];
  const shared = project.teacherGovernance?.[kind] || null;
  return {
    kind,
    activeScale: project.activeScale,
    capturedAt: new Date().toISOString(),
    shared: shared ? {
      fingerprint: shared.fingerprint,
      revision: shared.revision,
      moduleVersions: shared.moduleVersions,
    } : null,
    projectOverlay: {
      id: local.id,
      profileVersion: local.profileVersion,
      outputSchemaVersion: local.outputSchemaVersion,
      label: local.label,
      provider: local.provider,
      baseModel: local.baseModel,
      fixedPrompt: local.fixedPrompt,
      customInstructions: local.customInstructions,
      contextLimit: local.contextLimit,
      confidenceThreshold: local.confidenceThreshold,
      relationVocabulary: [...local.relationVocabulary],
      revision: local.revision,
      fingerprint: local.fingerprint,
    },
    effectiveFingerprint: stableId('run', `${shared?.fingerprint || 'local'}:${configFingerprint(local)}:${project.activeScale}`),
  };
}

function projectMetadataForReview(project) {
  return {
    id: project.id,
    projectId: project.id,
    submissionId: project.submission.id,
    title: project.title,
    author: project.submission.author,
    date: project.submission.date,
    sourceType: project.submission.sourceType,
    sourceTitle: project.submission.title,
    sharingTier: project.sharingTier,
    schemaVersion: project.schemaVersion,
    stage: project.stage,
    furthestStage: project.furthestStage ?? project.stage,
    clientUpdatedAt: project.updatedAt,
  };
}

function sourceRecordForEvaluation(submission) {
  return {
    id: submission.id,
    title: submission.title,
    author: submission.author,
    date: submission.date,
    sourceType: submission.sourceType,
    location: submission.location,
    rights: submission.rights,
    sensitive: submission.sensitive,
    consent: submission.consent,
    evidenceOwnership: submission.evidenceOwnership,
  };
}

function projectOverlayForEvaluation(config) {
  return {
    id: config.id,
    profileVersion: config.profileVersion,
    outputSchemaVersion: config.outputSchemaVersion,
    label: config.label,
    provider: config.provider,
    baseModel: config.baseModel,
    customInstructions: config.customInstructions,
    contextLimit: config.contextLimit,
    confidenceThreshold: config.confidenceThreshold,
    relationVocabulary: [...config.relationVocabulary],
    revision: config.revision,
    fingerprint: config.fingerprint,
  };
}

function preflightEvaluationPayload(project) {
  return {
    projectMetadata: projectMetadataForReview(project),
    activeScale: project.activeScale,
    stageId: STAGES[project.stage]?.id || 'review-suggestions',
    inquiry: project.inquiry,
    sourceRecord: sourceRecordForEvaluation(project.submission),
    sourceMaterial: project.submission.text,
    projectOverlay: projectOverlayForEvaluation(project.configs.preflight),
  };
}

function authoritativeEvaluationKey(project) {
  const payload = preflightEvaluationPayload(project);
  const { clientUpdatedAt: _clientUpdatedAt, stage: _stage, furthestStage: _furthestStage, ...stableMetadata } = payload.projectMetadata;
  return stableId('evaluation-request', JSON.stringify({ ...payload, projectMetadata: stableMetadata }));
}

function hasUsableEvaluation(preflight, now = Date.now()) {
  const evaluation = preflight?.evaluation;
  return Boolean(evaluation
    && /^[A-Za-z0-9_-]{32}$/.test(evaluation.evaluationId)
    && Number.isFinite(Date.parse(evaluation.expiresAt))
    && Date.parse(evaluation.expiresAt) > now);
}

function normalizePreflightEvaluation(evaluation, project) {
  if (!evaluation || typeof evaluation !== 'object' || Array.isArray(evaluation)) throw new Error('The classroom server returned an invalid suggestion evaluation.');
  const expectedKeys = ['id', 'redirects', 'configSnapshot', 'runtime', 'createdAt', 'expiresAt'];
  if (Object.keys(evaluation).length !== expectedKeys.length || expectedKeys.some((key) => !Object.hasOwn(evaluation, key))) {
    throw new Error('The classroom server returned an invalid suggestion-evaluation shape.');
  }
  if (typeof evaluation.id !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(evaluation.id)) throw new Error('The classroom server returned an invalid evaluation identifier.');
  if (!Array.isArray(evaluation.redirects) || !evaluation.configSnapshot || !evaluation.runtime) throw new Error('The classroom server returned an incomplete suggestion evaluation.');
  const preflight = {
    redirects: structuredClone(evaluation.redirects),
    configurationSnapshot: structuredClone(evaluation.configSnapshot),
    evaluation: {
    evaluationId: evaluation.id,
    runtime: structuredClone(evaluation.runtime),
    createdAt: evaluation.createdAt,
    expiresAt: evaluation.expiresAt,
    },
    review: null,
  };
  const candidate = structuredClone(project);
  candidate.preflight = preflight;
  validateProject(candidate);
  return preflight;
}

function normalizeReviewSubmission(submission, projectId) {
  if (!submission || typeof submission !== 'object' || Array.isArray(submission)) throw new Error('The classroom server returned an invalid instructor-review record.');
  const expectedKeys = ['id', 'projectId', 'status', 'decision', 'revision', 'submittedAt', 'updatedAt', 'reviewedAt', 'instructorAnnotation', 'focusedQuestion'];
  if (Object.keys(submission).length !== expectedKeys.length || expectedKeys.some((key) => !Object.hasOwn(submission, key))) {
    throw new Error('The classroom server returned an invalid instructor-review shape.');
  }
  if (typeof submission.id !== 'string' || !submission.id || submission.id.length > 200) throw new Error('The classroom server returned an invalid review identifier.');
  if (submission.projectId !== projectId) throw new Error('The instructor-review record does not belong to this project.');
  if (!REVIEW_STATUSES.includes(submission.status)) throw new Error('The classroom server returned an invalid review status.');
  if (!Number.isInteger(submission.revision) || submission.revision < 1) throw new Error('The classroom server returned an invalid review revision.');
  if (typeof submission.submittedAt !== 'string' || !submission.submittedAt) throw new Error('The classroom server returned an invalid review timestamp.');
  if (typeof submission.updatedAt !== 'string' || Number.isNaN(Date.parse(submission.updatedAt))) throw new Error('The classroom server returned an invalid review-update timestamp.');
  if (submission.reviewedAt !== null && (typeof submission.reviewedAt !== 'string' || Number.isNaN(Date.parse(submission.reviewedAt)))) throw new Error('The classroom server returned an invalid reviewed timestamp.');
  const decision = submission.decision ?? undefined;
  const instructorAnnotation = submission.instructorAnnotation ?? undefined;
  const focusedQuestion = submission.focusedQuestion ?? undefined;
  if (decision !== undefined && !REVIEW_DECISIONS.includes(decision)) throw new Error('The classroom server returned an invalid instructor decision.');
  if (instructorAnnotation !== undefined && (typeof instructorAnnotation !== 'string' || !instructorAnnotation.trim() || instructorAnnotation.length > PROJECT_LIMITS.reviewText)) throw new Error('The classroom server returned an invalid instructor annotation.');
  if (focusedQuestion !== undefined && (typeof focusedQuestion !== 'string' || !focusedQuestion.trim() || focusedQuestion.length > PROJECT_LIMITS.focusedQuestion)) throw new Error('The classroom server returned an invalid focused question.');
  if (submission.status === 'pending' && (decision !== undefined || instructorAnnotation !== undefined || focusedQuestion !== undefined)) throw new Error('The classroom server returned an inconsistent pending review.');
  if (submission.status === 'approved' && !['approve', 'revise_and_approve'].includes(decision)) throw new Error('The classroom server returned an inconsistent approval.');
  if (submission.status === 'rejected' && decision !== 'reject') throw new Error('The classroom server returned an inconsistent rejection.');
  if (submission.status !== 'pending' && instructorAnnotation === undefined) throw new Error('The classroom server returned a decision without instructor guidance.');
  if (decision === 'revise_and_approve' && focusedQuestion === undefined) throw new Error('The classroom server returned a revision decision without a focused question.');
  if (decision !== 'revise_and_approve' && focusedQuestion !== undefined) throw new Error('The classroom server returned a focused question for an incompatible decision.');
  return {
    submissionId: submission.id,
    status: submission.status,
    revision: submission.revision,
    submittedAt: submission.submittedAt,
    ...(decision !== undefined ? { decision } : {}),
    ...(instructorAnnotation !== undefined ? { instructorAnnotation } : {}),
    ...(focusedQuestion !== undefined ? { focusedQuestion } : {}),
  };
}

function createBlankProject() {
  const project = createDefaultProject();
  project.id = `project_${Date.now().toString(36)}`;
  project.mapAnnotation = { id: stableId('annotation', `${project.id}:map`), text: '' };
  project.title = 'Untitled systems map';
  project.inquiry = '';
  project.stage = 0;
  project.furthestStage = 0;
  project.submission = {
    id: `submission_${Date.now().toString(36)}`,
    title: '',
    author: '',
    date: '',
    sourceType: 'course memo',
    location: '',
    rights: 'Course use only',
    sensitive: false,
    consent: false,
    evidenceOwnership: '',
    text: '',
    fileName: '',
    fileSize: 0,
    revision: 1,
    fingerprint: stableId('src', ''),
  };
  project.preflight = null;
  project.candidates = { nodes: [], edges: [] };
  project.graph = { nodes: [], edges: [] };
  project.reflection = '';
  project.events = [createEvent('project.created', 'Started a blank local project')];
  return project;
}

function Icon({ name, size = 18 }) {
  const paths = {
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    back: <path d="m15 18-6-6 6-6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    upload: <><path d="M12 16V4m-4 4 4-4 4 4" /><path d="M4 15v5h16v-5" /></>,
    download: <><path d="M12 4v12m-4-4 4 4 4-4" /><path d="M4 19h16" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  };
  return <svg aria-hidden="true" className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function Modal({ open, title, onClose, children, wide = false }) {
  const closeRef = useRef(null);
  const modalRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(modalRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])') || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const previous = document.activeElement;
    window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={modalRef} className={`modal ${wide ? 'modal--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal__head">
          <h2 id="modal-title">{title}</h2>
          <button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label={`Close ${title}`}><Icon name="close" /></button>
        </header>
        <div className="modal__body">{children}</div>
      </section>
    </div>
  );
}

function Field({ label, hint, children, className = '' }) {
  return <label className={`field ${className}`}><span className="field__label">{label}</span>{children}{hint && <span className="field__hint">{hint}</span>}</label>;
}

function AccessFrame({ children, onTeacher }) {
  return <div className="access-shell">
    <header className="access-header">
      <span className="brand__mark" aria-hidden="true">sm</span>
      <strong>Systems Mapping</strong>
      <button type="button" className="access-header__teacher" onClick={onTeacher}>Teacher access</button>
    </header>
    {children}
  </div>;
}

function ClassAccessScreen({ state, onSubmit, onTeacher }) {
  const [code, setCode] = useState('');
  const inputRef = useRef(null);
  useEffect(() => {
    if (state.status !== 'checking') inputRef.current?.focus();
  }, [state.status, state.message]);
  const submit = async (event) => {
    event.preventDefault();
    const value = code.trim();
    if (!value) return;
    const accepted = await onSubmit(value);
    if (!accepted) {
      setCode('');
      inputRef.current?.focus();
    }
  };
  return <AccessFrame onTeacher={onTeacher}>
    <main className="access-main" id="workspace">
      <p className="eyebrow">Classroom access</p>
      <h1>Enter your class code.</h1>
      <p className="lede">This code opens the class workspace on this device. It does not identify you and is not strong authentication.</p>
      <form className="class-code-form" onSubmit={submit}>
        <Field label="Class code">
          <input ref={inputRef} maxLength="32" autoComplete="one-time-code" autoCapitalize="none" spellCheck="false" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Class code" disabled={state.status === 'checking' || state.status === 'submitting'} />
        </Field>
        {state.message && <p className={`access-message access-message--${state.kind || 'info'}`} role={state.kind === 'error' ? 'alert' : 'status'}>{state.message}</p>}
        <button className="button access-primary" type="submit" disabled={!code.trim() || state.status === 'checking' || state.status === 'submitting'}>{state.status === 'checking' ? 'Checking class access…' : state.status === 'submitting' ? 'Checking code…' : 'Continue'}</button>
      </form>
      <div className="access-boundary"><Icon name="lock" /><span>Classroom access · expires automatically</span></div>
      <details className="access-help"><summary>Having trouble?</summary><p>Confirm that the classroom server is available, then ask the teacher for the current class code. A failed code never erases the project saved in this browser.</p></details>
    </main>
  </AccessFrame>;
}

function ResumeScreen({ project, hasSavedProject, access, saveState, prototypeLogState, onResume, onStart, onTeacher, onEndAccess, onRecovery }) {
  const sourceCount = hasSavedProject && (project.submission?.text?.trim() || project.submission?.title?.trim()) ? 1 : 0;
  const expiry = typeof access?.expiresAt === 'string' ? new Date(access.expiresAt) : null;
  const expiryLabel = expiry && !Number.isNaN(expiry.getTime()) ? expiry.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'automatically';
  const prototypeServer = access?.persistence === 'course-server' ? 'course server' : 'local prototype server';
  return <AccessFrame onTeacher={onTeacher}>
    <main className="resume-main" id="workspace">
      <p className="eyebrow">Class workspace open</p>
      <h1>{hasSavedProject ? 'Keep working on your map.' : 'Start a systems map.'}</h1>
      <h2>{hasSavedProject ? project.title : 'A new local project'}</h2>
      <div className="resume-meta" aria-label="Saved project summary">
        <span><i className="resume-stage-mark" />Stage {project.stage + 1} of {STAGES.length} · <strong>{STAGES[project.stage].label}</strong></span>
        <span><Icon name="history" />{sourceCount} {sourceCount === 1 ? 'source' : 'sources'} · {hasSavedProject ? 'local recovery available' : 'not started'}</span>
      </div>
      {saveState.status === 'error' && <button type="button" className="recovery-notice" onClick={onRecovery}><strong>Local recovery needs attention</strong><span>{saveState.message}</span></button>}
      {hasSavedProject ? <>
        <p className="resume-description">Your map, notes, and node positions are saved in this browser.</p>
        <section className="current-work" aria-label="Current work"><strong>Current work</strong><span>{STAGES[project.stage].label}</span><p>Earlier completed stages remain available to revisit.</p></section>
      </> : <p className="resume-description">Choose a scale to begin. This browser saves your project as you work.</p>}
      <aside className={`logging-disclosure ${prototypeLogState.status === 'degraded' ? 'logging-disclosure--degraded' : ''}`} role="status"><Icon name="history" /><div><strong>{prototypeLogState.status === 'degraded' ? `Prototype logging unavailable · ${prototypeLogState.dropped} ${prototypeLogState.dropped === 1 ? 'event' : 'events'} not recorded` : 'Prototype logging is best effort · no student identity'}</strong><p>Canonical stage changes and bounded interaction events are sent to the {prototypeServer} when it is available. Source text and annotations are never included.</p></div></aside>
      <div className="resume-actions">
        <button type="button" className="button access-primary" onClick={hasSavedProject ? onResume : onStart}>{hasSavedProject ? `Continue to ${STAGES[project.stage].label.toLowerCase()}` : 'Start a project'}</button>
        {hasSavedProject && <button type="button" className="resume-secondary" onClick={onStart}>Start another project</button>}
      </div>
      <div className="access-session-line"><span>Class access expires at {expiryLabel}.</span><button type="button" onClick={onEndAccess}>End class access</button></div>
    </main>
  </AccessFrame>;
}

function download(name, contents, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function projectMarkdown(project) {
  const nodeLines = project.graph.nodes.map((node) => {
    const annotations = [node.annotations?.analytical?.text && `analysis: ${node.annotations.analytical.text}`, node.annotations?.evidence?.text && `evidence note: ${node.annotations.evidence.text}`].filter(Boolean).join('; ');
    return `- **${node.label}** — ${node.type}; ${node.scale}; ${node.claimState}; evidence: ${node.evidence || 'unresolved'}${annotations ? `; ${annotations}` : ''}`;
  });
  const edgeLines = project.graph.edges.map((edge) => `- ${edge.sourceLabel} **${edge.verb}** ${edge.targetLabel} — ${edge.claimState}; evidence: ${edge.evidence || 'unresolved'}${edge.annotation?.text ? `; annotation: ${edge.annotation.text}` : ''}`);
  const redactionLines = project.portableExport?.redactions?.map((entry) => `- ${entry.path}: ${entry.reason}`).join('\n') || '- None';
  return `# ${project.title}\n\n${project.inquiry}\n\n## Source\n\n- ${project.submission.title}\n- Author: ${project.submission.author}\n- Date: ${project.submission.date}\n- Location: ${project.submission.location}\n\n## Map annotation\n\n${project.mapAnnotation?.text || 'Not yet written'}\n\n## Nodes\n\n${nodeLines.join('\n') || '- None confirmed'}\n\n## Relationships\n\n${edgeLines.join('\n') || '- None confirmed'}\n\n## Reflection\n\n${project.reflection || 'Not yet written'}\n\n## Unresolved questions\n\n${project.candidates.edges.filter((edge) => edge.status === 'research lead').map((edge) => `- ${edge.sourceLabel} ${edge.verb} ${edge.targetLabel}`).join('\n') || '- None recorded'}\n\n## Export redactions\n\n${redactionLines}\n`;
}

export function graphCsv(project) {
  const inert = (value) => {
    const text = String(value ?? '');
    return /^(?:[\t\r\n]|[ \t\r\n]*[=+\-@])/.test(text) ? `'${text}` : text;
  };
  const quote = (value) => `"${inert(value).replaceAll('"', '""')}"`;
  const rows = [['record_type', 'id', 'label_or_source', 'type_or_verb', 'target', 'scale', 'claim_state', 'evidence', 'analytical_annotation', 'evidence_annotation']];
  project.graph.nodes.forEach((node) => rows.push(['node', node.id, node.label, node.type, '', node.scale, node.claimState, node.evidence, node.annotations?.analytical?.text || '', node.annotations?.evidence?.text || '']));
  project.graph.edges.forEach((edge) => rows.push(['edge', edge.id, edge.sourceLabel, edge.verb, edge.targetLabel, edge.scale, edge.claimState, edge.evidence, edge.annotation?.text || '', '']));
  rows.push(['map', project.mapAnnotation?.id || 'map', project.title, '', '', '', '', '', project.mapAnnotation?.text || '', '']);
  return rows.map((row) => row.map(quote).join(',')).join('\n');
}

function ScaleStage({ project, update }) {
  const canSelect = (scale) => project.releasedScales.includes(scale);
  const availableScales = SCALE_ORDER.filter(canSelect);
  const selectScale = (scale) => update((draft) => { draft.activeScale = scale; invalidatePreflight(draft); }, 'scale.selected', SCALES[scale].label);
  return (
    <div className="narrow stage-enter">
      <p className="eyebrow">Choose a scale</p>
      <h1>Choose the current scale.</h1>
      <p className="lede">Choose the scale for this map. Your instructor opens each scale in order.</p>
      <div className="scale-list" role="radiogroup" aria-label="Mapping scale">
        {SCALE_ORDER.map((scale, index) => {
          const unlocked = canSelect(scale);
          const selected = project.activeScale === scale;
          return (
            <button
              className={`scale-row ${selected ? 'is-selected' : ''}`}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              data-composite-value={scale}
              disabled={!unlocked}
              key={scale}
              onClick={() => selectScale(scale)}
              onKeyDown={(event) => handleCompositeKey(event, availableScales, project.activeScale, selectScale)}
            >
              <span className="scale-row__index">0{index + 1}</span>
              <span className="scale-row__body"><strong>{SCALES[scale].label}</strong><span>{SCALES[scale].description}</span></span>
              <span className="scale-row__state">{selected ? 'Current' : unlocked ? 'Available' : <><Icon name="lock" size={15} /> Withheld</>}</span>
            </button>
          );
        })}
      </div>
      <aside className="withheld-note"><strong>Available later</strong><span>Your instructor may open comparison, timeline, geography, and theory of change later.</span></aside>
    </div>
  );
}

async function readSourceFile(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    if (result.value.length > MAX_SOURCE_CHARACTERS) throw new Error('The extracted DOCX text is too large. Use an excerpt of 500,000 characters or fewer.');
    return { text: result.value, notice: result.messages.length ? 'DOCX imported with conversion notices; compare against the original.' : 'DOCX text imported locally.' };
  }
  if (['txt', 'md', 'html', 'htm', 'json'].includes(extension)) {
    const raw = await file.text();
    if (extension === 'html' || extension === 'htm') {
      const text = new DOMParser().parseFromString(raw, 'text/html').body.textContent || '';
      if (text.length > MAX_SOURCE_CHARACTERS) throw new Error('The extracted HTML text is too large. Use an excerpt of 500,000 characters or fewer.');
      return { text, notice: 'HTML text imported locally.' };
    }
    if (raw.length > MAX_SOURCE_CHARACTERS) throw new Error('The source text is too large. Use an excerpt of 500,000 characters or fewer.');
    return { text: raw, notice: `${extension.toUpperCase()} text imported locally.` };
  }
  if (extension === 'pdf') return { text: '', notice: 'This PDF needs text extraction or OCR. Paste its text below before generating suggestions.' };
  throw new Error('Supported source files are DOCX, TXT, MD, HTML, JSON, and text-readable PDF by paste.');
}

function IntakeStage({ project, update, toast }) {
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [fileNotice, setFileNotice] = useState('Files are read in this browser and are not uploaded.');
  const setSubmission = (field, value) => update((draft) => { invalidateSubmissionDerived(draft, field, value); });
  const setProjectField = (field, value) => update((draft) => {
    draft[field] = value;
    invalidatePreflight(draft);
  });
  const onFile = async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      if (file.name.length > FILE_NAME_LIMIT) throw new Error(`Choose a source whose file name is ${FILE_NAME_LIMIT} characters or fewer.`);
      if (file.size > MAX_SOURCE_BYTES) throw new Error('Choose a source file smaller than 5 MB, or paste a bounded excerpt.');
      const result = await readSourceFile(file);
      update((draft) => {
        invalidateSubmissionDerived(draft, 'text', result.text || draft.submission.text);
        draft.submission.title = draft.submission.title || file.name;
        draft.submission.location = `Local file: ${file.name}`;
        draft.submission.fileName = file.name;
        draft.submission.fileSize = file.size;
      }, 'source.imported', file.name);
      setFileNotice(result.notice);
      toast(result.notice);
    } catch (error) {
      setFileNotice(error.message);
      toast(error.message, 'error');
    } finally {
      event.target.value = '';
    }
  };
  return (
    <div className="wide stage-enter">
      <p className="eyebrow">Add a source · {SCALES[project.activeScale].label}</p>
      <h1>Add a memo. Record the source.</h1>
      <p className="lede">Import or paste the memo, then record its title, creator, date, location, rights, and sensitivity. Your source file stays on this machine.</p>
      {project.preflight?.review?.decision === 'reject' && <section className="teacher-message" aria-label="What your instructor wrote"><strong>Your instructor asked for changes.</strong><p>{project.preflight.review.instructorAnnotation}</p>{project.preflight.review.focusedQuestion && <><h2>Question from your instructor</h2><p>{project.preflight.review.focusedQuestion}</p></>}<small>Revise only what you choose. Your instructor did not change the memo or map.</small></section>}
      <div className="field-pair project-context-fields">
        <Field label="Project title"><input maxLength={CONFIG_TEXT_LIMIT} value={project.title} onChange={(event) => setProjectField('title', event.target.value)} /></Field>
        <Field label="Guiding inquiry"><input maxLength={MAX_EVALUATION_INQUIRY_CHARACTERS} value={project.inquiry} onChange={(event) => setProjectField('inquiry', event.target.value)} /></Field>
      </div>
      <div className="intake-grid">
        <div>
          <label className="upload-zone">
            <input type="file" accept=".docx,.txt,.md,.html,.htm,.json,.pdf" onChange={onFile} />
            <Icon name="upload" size={26} />
            <strong>{project.submission.fileName || 'Choose a memo'}</strong>
            <span>DOCX, TXT, MD, HTML, JSON, or PDF</span>
          </label>
          <p className="privacy-note" role="status">{fileNotice}</p>
          <Field label="Memo text" hint={`${project.submission.text.trim().split(/\s+/).filter(Boolean).length.toLocaleString()} words · edits stay local`}>
            <textarea className="memo-text" maxLength="500000" value={project.submission.text} onChange={(event) => setSubmission('text', event.target.value)} rows="15" />
          </Field>
        </div>
        <aside className="source-panel">
          <button type="button" className="disclosure-button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>
            <span><span className="eyebrow">Source record</span><strong>{detailsOpen ? 'Hide details' : 'Show details'}</strong></span><span aria-hidden="true">{detailsOpen ? '−' : '+'}</span>
          </button>
          {detailsOpen && <div className="source-fields">
            <Field label="Source title"><input maxLength={CONFIG_TEXT_LIMIT} value={project.submission.title} onChange={(event) => setSubmission('title', event.target.value)} /></Field>
            <div className="field-pair">
              <Field label="Author or creator"><input maxLength={CONFIG_TEXT_LIMIT} value={project.submission.author} onChange={(event) => setSubmission('author', event.target.value)} /></Field>
              <Field label="Date" hint="YYYY-MM-DD"><input inputMode="numeric" maxLength="10" placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" value={project.submission.date} onChange={(event) => setSubmission('date', event.target.value)} /></Field>
            </div>
            <Field label="Source type"><select value={project.submission.sourceType} onChange={(event) => setSubmission('sourceType', event.target.value)}><option>course memo</option><option>interview</option><option>public data</option><option>policy or law</option><option>secondary source</option></select></Field>
            <Field label="Source location"><input maxLength={PROJECT_LIMITS.metadataText} value={project.submission.location} onChange={(event) => setSubmission('location', event.target.value)} /></Field>
            <Field label="Rights or intended use"><input maxLength={PROJECT_LIMITS.metadataText} value={project.submission.rights} onChange={(event) => setSubmission('rights', event.target.value)} /></Field>
            <label className="check-row"><input type="checkbox" checked={project.submission.sensitive} onChange={(event) => setSubmission('sensitive', event.target.checked)} /><span><strong>Contains sensitive or interview-derived material</strong><small>This activates a separate consent gate.</small></span></label>
            {project.submission.sensitive && <label className="check-row"><input type="checkbox" checked={project.submission.consent} onChange={(event) => setSubmission('consent', event.target.checked)} /><span><strong>Consent or privacy-safe treatment documented</strong><small>Non-private exports apply conservative redactions and include a manifest for review.</small></span></label>}
          </div>}
        </aside>
      </div>
    </div>
  );
}

function SuggestionGuidance({ redirects }) {
  const headingId = stableId('suggestion-region', 'return-to-source');
  return <div className="criteria-list"><section aria-labelledby={headingId}>
    <h2 id={headingId}>Return to the source</h2>
    {redirects.length ? redirects.map((redirect, index) => {
      const promptId = stableId('redirective-prompt', `${index}:${redirect.action}`);
      return <article className="criterion-row" key={promptId} aria-labelledby={promptId}>
        <div><div className="criterion-row__title"><h3 id={promptId}>{redirect.action}</h3></div>{redirect.evidenceExcerpt && <blockquote><span className="sr-only">Source passage: </span>{redirect.evidenceExcerpt}</blockquote>}</div>
      </article>;
    }) : <p className="empty-message">Use your note to tell the instructor where you want feedback.</p>}
  </section></div>;
}

function suggestionRuntimeDescription(runtime, persistence) {
  const serverLabel = persistence === 'course-server' ? 'course server' : 'local classroom server';
  if (runtime?.provider === 'ollama-cloud') {
    const model = typeof runtime.model === 'string' && runtime.model ? ` The server reports provider model ${runtime.model}.` : '';
    return `Generating suggestions sends the memo, inquiry, source metadata, active teacher prompt, and project overlay from the ${serverLabel} to Ollama Cloud.${model}`;
  }
  if (runtime?.provider === 'deterministic') {
    return `Generating suggestions applies fixed STEM Splitter rules on the ${serverLabel}. The source does not leave that server for a model provider; teacher prompt and project-instruction edits are provenance only and do not change the deterministic rule set.`;
  }
  return `The ${serverLabel} has not reported the suggestion runtime yet. Check class access before generating suggestions.`;
}

function suggestionRuntimeLabel(runtime) {
  if (runtime?.provider === 'ollama-cloud') return `Ollama Cloud${runtime.model ? ` · ${runtime.model}` : ''}`;
  if (runtime?.provider === 'deterministic') return 'STEM Splitter · deterministic';
  return 'Classroom server decides at generation';
}

function ModelSetup({ project, update, toast, suggestionRuntime, persistence }) {
  const [kind, setKind] = useState('preflight');
  const makeDraft = (config, draftKind) => ({ ...config, draftKind, dirty: false, staleRevision: null, baseRevision: config.revision, changeNote: '', relationVocabulary: config.relationVocabulary.join(', ') });
  const [draft, setDraft] = useState(() => makeDraft(project.configs.preflight, 'preflight'));
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    const config = project.configs[kind];
    setDraft((current) => {
      if (current.draftKind === kind && current.dirty && current.baseRevision !== config.revision) return { ...current, staleRevision: config.revision };
      return makeDraft(config, kind);
    });
    setPreview(false);
  }, [kind, project.configs[kind].revision]);
  const change = (field, value) => setDraft((current) => ({ ...current, [field]: value, dirty: true }));
  const save = () => {
    const label = draft.label.trim();
    const baseModel = draft.baseModel.trim();
    const contextLimit = Number(draft.contextLimit);
    const confidenceThreshold = Number(draft.confidenceThreshold);
    const relationVocabulary = draft.relationVocabulary.split(',').map((item) => item.trim()).filter(Boolean);
    if (!draft.changeNote?.trim()) {
      toast('Add a change note before saving this configuration.', 'error');
      return;
    }
    if (!label || !baseModel) {
      toast('Configuration name and base-model reference are required.', 'error');
      return;
    }
    if (kind === 'preflight' && draft.customInstructions.length > MAX_EVALUATION_CUSTOM_INSTRUCTIONS) {
      toast(`Suggestion-model custom instructions must be ${MAX_EVALUATION_CUSTOM_INSTRUCTIONS.toLocaleString()} characters or fewer.`, 'error');
      return;
    }
    if (!Number.isFinite(contextLimit) || contextLimit < 1000 || contextLimit > 200000) {
      toast('Context limit must be a whole number from 1,000 to 200,000.', 'error');
      return;
    }
    if (!Number.isInteger(contextLimit)) {
      toast('Context limit must be a whole number from 1,000 to 200,000.', 'error');
      return;
    }
    if (!Number.isFinite(confidenceThreshold) || confidenceThreshold < 0 || confidenceThreshold > 1) {
      toast('Confidence threshold must be a number from 0 to 1.', 'error');
      return;
    }
    if (!relationVocabulary.length || relationVocabulary.length > PROJECT_LIMITS.relationVocabulary) {
      toast(`Relationship vocabulary must contain 1–${PROJECT_LIMITS.relationVocabulary} comma-separated terms.`, 'error');
      return;
    }
    if (relationVocabulary.some((verb) => verb.length > RELATIONSHIP_VERB_LIMIT)) {
      toast(`Each relationship term must be ${RELATIONSHIP_VERB_LIMIT} characters or fewer.`, 'error');
      return;
    }
    if (new Set(relationVocabulary).size !== relationVocabulary.length) {
      toast('Relationship vocabulary cannot contain duplicate terms.', 'error');
      return;
    }
    if ((project.configs[kind].history || []).length >= PROJECT_LIMITS.configHistory) {
      toast(`This configuration already contains the maximum ${PROJECT_LIMITS.configHistory} retained revisions. Export the project before starting a fresh configuration history.`, 'error');
      return;
    }
    if (draft.staleRevision || draft.baseRevision !== project.configs[kind].revision) {
      toast('This project configuration changed in another session. Reload the current revision before saving.', 'error');
      return;
    }
    update((projectDraft) => {
      const previous = projectDraft.configs[kind];
      if (previous.revision !== draft.baseRevision) return;
      const next = {
        ...previous,
        label,
        baseModel,
        customInstructions: draft.customInstructions.trim(),
        contextLimit,
        confidenceThreshold,
        relationVocabulary,
        revision: previous.revision + 1,
        changeNote: draft.changeNote.trim(),
        history: [...(previous.history || []), { revision: previous.revision, fingerprint: previous.fingerprint, changeNote: previous.changeNote, snapshot: { ...previous, history: undefined }, at: new Date().toISOString() }],
      };
      next.fingerprint = configFingerprint(next);
      projectDraft.configs[kind] = next;
      invalidatePreflight(projectDraft);
    }, 'config.revised', `${kind}: ${draft.changeNote}`);
    setDraft((current) => ({ ...current, dirty: false, staleRevision: null, baseRevision: current.baseRevision + 1, changeNote: '' }));
    toast('Configuration revision saved. Generate fresh suggestions before sending for review.');
  };
  const config = project.configs[kind];
  const shared = project.teacherGovernance?.[kind];
  const chooseKind = (nextKind) => setKind(nextKind);
  const loadCurrentRevision = () => {
    setDraft(makeDraft(project.configs[kind], kind));
    toast(`Loaded project ${kind} revision ${project.configs[kind].revision}.`);
  };
  return <div className="model-setup">
    <div className="model-switch" role="tablist" aria-label="Model configurations">
      <button id="project-config-tab-preflight" role="tab" aria-controls="project-config-panel" aria-selected={kind === 'preflight'} tabIndex={kind === 'preflight' ? 0 : -1} data-composite-value="preflight" className={kind === 'preflight' ? 'is-active' : ''} onKeyDown={(event) => handleCompositeKey(event, ['preflight', 'builder'], kind, chooseKind)} onClick={() => chooseKind('preflight')}>Suggestion model</button>
      <button id="project-config-tab-builder" role="tab" aria-controls="project-config-panel" aria-selected={kind === 'builder'} tabIndex={kind === 'builder' ? 0 : -1} data-composite-value="builder" className={kind === 'builder' ? 'is-active' : ''} onKeyDown={(event) => handleCompositeKey(event, ['preflight', 'builder'], kind, chooseKind)} onClick={() => chooseKind('builder')}>Graph builder</button>
    </div>
    <div id="project-config-panel" className="model-grid" role="tabpanel" aria-labelledby={`project-config-tab-${kind}`}>
      <div className="model-form">
        <div className="config-line"><span>Runtime</span><strong>{suggestionRuntimeLabel(suggestionRuntime)}</strong></div>
        <p className="privacy-note">STEM Splitter is the versioned product configuration. {suggestionRuntimeDescription(suggestionRuntime, persistence)}</p>
        <Field label="Configuration name"><input maxLength={CONFIG_TEXT_LIMIT} value={draft.label} onChange={(event) => change('label', event.target.value)} /></Field>
        <Field label="Base-model reference"><input maxLength={CONFIG_TEXT_LIMIT} value={draft.baseModel} onChange={(event) => change('baseModel', event.target.value)} /></Field>
        <div className="field-pair">
          <Field label="Context limit"><input type="number" min="1000" max="200000" value={draft.contextLimit} onChange={(event) => change('contextLimit', event.target.value)} /></Field>
          <Field label="Confidence threshold"><input type="number" min="0" max="1" step="0.01" value={draft.confidenceThreshold} onChange={(event) => change('confidenceThreshold', event.target.value)} /></Field>
        </div>
        <Field label="Custom project instructions" hint="Project overlay beneath the shared teacher configuration"><textarea rows="5" maxLength={kind === 'preflight' ? MAX_EVALUATION_CUSTOM_INSTRUCTIONS : PROJECT_LIMITS.promptText} value={draft.customInstructions} onChange={(event) => change('customInstructions', event.target.value)} /></Field>
        <Field label="Relationship vocabulary" hint="Comma-separated, schema constrained"><textarea rows="4" maxLength={RELATION_VOCABULARY_TEXT_LIMIT} value={draft.relationVocabulary} onChange={(event) => change('relationVocabulary', event.target.value)} /></Field>
        <Field label="Change note" hint="Required for append-only history"><input maxLength={PROJECT_LIMITS.rationaleText} value={draft.changeNote || ''} onChange={(event) => change('changeNote', event.target.value)} /></Field>
        {draft.staleRevision && <div className="teacher-message teacher-message--error" role="alert"><strong>Project revision {draft.staleRevision} is now current.</strong><p>Your unsaved draft remains in the editor and cannot overwrite it.</p><button type="button" className="button button--ghost" onClick={loadCurrentRevision}>Load project revision {draft.staleRevision}</button></div>}
        <div className="button-row"><button className="button button--secondary" type="button" onClick={() => setPreview(!preview)}>{preview ? 'Hide effective prompt' : 'Preview effective prompt'}</button><button className="button" type="button" onClick={save}>Save revision</button></div>
      </div>
      <aside className="guardrail-panel">
        <p className="eyebrow">Shared teacher base · read only here</p>
        <pre>{shared ? 'The authenticated classroom server supplied this configuration fingerprint. Teacher-authored prompt text remains inside the teacher boundary.' : config.fixedPrompt}</pre>
        <dl className="config-meta"><div><dt>Project revision</dt><dd>{config.revision}</dd></div><div><dt>Project fingerprint</dt><dd>{config.fingerprint}</dd></div><div><dt>Shared revision</dt><dd>{shared?.revision || 'Local fallback'}</dd></div><div><dt>Shared fingerprint</dt><dd>{shared?.fingerprint || 'Server unavailable'}</dd></div><div><dt>Provider seam</dt><dd>{config.provider}</dd></div></dl>
        {preview && <div className="effective-prompt"><strong>Project overlay preview</strong><p>{config.fixedPrompt}</p><hr /><p>PROJECT OVERLAY</p><p>{draft.customInstructions}</p><p className="privacy-note">{suggestionRuntime?.provider === 'ollama-cloud'
          ? 'The shared teacher base and project overlay govern Ollama Cloud suggestion generation by server-supplied revision and fingerprint; private prompt text stays outside this browser workspace.'
          : suggestionRuntime?.provider === 'deterministic'
            ? 'In deterministic mode, shared teacher and project prompt edits are recorded as provenance only; they do not change the fixed rule set.'
            : 'The classroom server has not reported whether prompt edits govern suggestion generation.'}</p></div>}
        {config.history?.length > 0 && <details><summary>Revision history ({config.history.length})</summary><ol className="history-list">{[...config.history].reverse().map((entry) => <li key={`${entry.revision}-${entry.at}`}><strong>v{entry.revision}</strong> {entry.changeNote}<small>{entry.fingerprint}</small></li>)}</ol></details>}
      </aside>
    </div>
  </div>;
}

function SuggestionReviewStage({ project, update, toast, studentAnnotation, setStudentAnnotation, persistence, retentionDays, suggestionRuntime }) {
  const [panel, setPanel] = useState('suggestions');
  const review = project.preflight?.review;
  const hasSuggestions = project.preflight && !review;
  const evaluationReady = hasUsableEvaluation(project.preflight);
  const actualRuntime = project.preflight?.evaluation?.runtime || suggestionRuntime;
  const storageLabel = persistence === 'course-server' ? 'course server' : 'local classroom server';
  const retentionDisclosure = Number.isInteger(retentionDays?.pending) && Number.isInteger(retentionDays?.decided)
    ? `Pending snapshots are removed after ${retentionDays.pending} days; decided snapshots are removed after ${retentionDays.decided} days.`
    : 'Snapshot retention is set by the classroom server.';
  const evaluationRetention = Number.isFinite(retentionDays?.evaluation)
    ? `An unsubmitted evaluation expires after ${retentionDays.evaluation} day${retentionDays.evaluation === 1 ? '' : 's'}.`
    : 'Unsubmitted evaluations expire on the classroom server.';
  return <div className="wide stage-enter">
    <p className="eyebrow">Review suggestions · {SCALES[project.activeScale].label}</p>
    <h1>Read the prompts with the memo.</h1>
    <p className="lede">Read the prompts with your memo. Tell your instructor where you want feedback.</p>
    <div className="subnav" role="tablist" aria-label="Suggestions and model setup"><button id="suggestion-tab-suggestions" role="tab" aria-controls="suggestion-panel" aria-selected={panel === 'suggestions'} tabIndex={panel === 'suggestions' ? 0 : -1} data-composite-value="suggestions" className={panel === 'suggestions' ? 'is-active' : ''} onKeyDown={(event) => handleCompositeKey(event, ['suggestions', 'model'], panel, setPanel)} onClick={() => setPanel('suggestions')}>Suggestions</button><button id="suggestion-tab-model" role="tab" aria-controls="suggestion-panel" aria-selected={panel === 'model'} tabIndex={panel === 'model' ? 0 : -1} data-composite-value="model" className={panel === 'model' ? 'is-active' : ''} onKeyDown={(event) => handleCompositeKey(event, ['suggestions', 'model'], panel, setPanel)} onClick={() => setPanel('model')}>Model setup</button></div>
    <div id="suggestion-panel" role="tabpanel" aria-labelledby={`suggestion-tab-${panel}`}>{panel === 'suggestions' ? <div className="preflight-grid">
      <section>{hasSuggestions ? <SuggestionGuidance redirects={project.preflight.redirects} /> : <p className="empty-message">Generate suggestions to open focused source prompts for this memo.</p>}</section>
      <aside className="dry-run-panel"><p className="eyebrow">Send to your instructor</p><h2>Add a note.</h2><p className="privacy-note">{suggestionRuntimeDescription(actualRuntime, persistence)}</p>{hasSuggestions && <Field label="Note for instructor" hint={`${studentAnnotation.length.toLocaleString()} of ${PROJECT_LIMITS.annotationText.toLocaleString()} characters`}><textarea rows="8" maxLength={PROJECT_LIMITS.annotationText} value={studentAnnotation} onChange={(event) => setStudentAnnotation(event.target.value)} /></Field>}{hasSuggestions && !evaluationReady && <p className="teacher-message teacher-message--error" role="alert">These suggestions do not have a current server evaluation. Generate fresh suggestions before sending them for instructor review.</p>}<p className="privacy-note">{hasSuggestions ? `Sending stores the memo and your note on the ${storageLabel} for instructor review.` : `Generating temporarily stores the memo and source record on the ${storageLabel}.`} {hasSuggestions ? retentionDisclosure : evaluationRetention}</p></aside>
    </div> : <ModelSetup project={project} update={update} toast={toast} suggestionRuntime={actualRuntime} persistence={persistence} />}</div>
  </div>;
}

function InstructorResponseStage({ project }) {
  const review = project.preflight?.review;
  return <div className="narrow stage-enter">
    <p className="eyebrow">Check your instructor's response</p>
    <h1>{review?.status === 'approved' ? 'Your instructor responded.' : 'Your instructor has not responded yet.'}</h1>
    {review?.status === 'pending' ? <><p className="lede">Your instructor is reviewing the submitted snapshot. Your memo and map stay unchanged.</p><section className="teacher-message" aria-live="polite"><strong>Waiting for your instructor</strong><p>Use “Check instructor response” to look for an update.</p></section></> : <><p className="lede">Read guidance before next steps.</p><section className="teacher-message" aria-label="Instructor guidance"><strong>Instructor guidance</strong><p>{review?.instructorAnnotation}</p>{review?.focusedQuestion && <><h2>Question from your instructor</h2><p>{review.focusedQuestion}</p></>}<small>This guidance did not change your memo or map.</small></section></>}
  </div>;
}

function CandidateStage({ project, update, toast }) {
  const [kind, setKind] = useState('edges');
  const candidates = project.candidates[kind];
  const setStatus = (id, status) => {
    const current = project.candidates[kind].find((candidate) => candidate.id === id);
    if (!current) return;
    if (status === 'research lead' && !project.instructor.allowResearchLeads) return toast('Research leads are disabled for this project.', 'error');
    if ((status === 'confirmed' || status === 'research lead') && project.instructor.evidenceRequired && !current.evidence) return toast('Add an evidence locator before advancing this candidate.', 'error');
    const allowed = kind === 'nodes' || project.configs.builder.relationVocabulary.includes(current.verb.trim().toLowerCase());
    if (status === 'confirmed' && !allowed && !project.instructor.allowResearchLeads) return toast('This relationship is outside the configured vocabulary and research leads are disabled.', 'error');
    update((draft) => {
      const item = draft.candidates[kind].find((candidate) => candidate.id === id);
      item.status = status === 'confirmed' && !allowed ? 'research lead' : status;
      item.claimState = item.status === 'research lead' ? 'research lead' : item.status === 'confirmed' ? 'student interpretation' : item.claimState;
    }, `candidate.${status}`, id);
  };
  const edit = (id, field, value) => update((draft) => {
    const item = draft.candidates[kind].find((candidate) => candidate.id === id);
    const previousLabel = item.label;
    item[field] = value;
    if (kind === 'nodes' && field === 'label') {
      draft.candidates.edges.forEach((edge) => {
        if (edge.source === id) edge.sourceLabel = value;
        if (edge.target === id) edge.targetLabel = value;
      });
      item.notes = item.notes || `Label revised from ${previousLabel}`;
    }
  });
  const confirmAll = () => update((draft) => {
    draft.candidates.nodes.forEach((item) => {
      if (!draft.instructor.evidenceRequired || item.evidence) { item.status = 'confirmed'; item.claimState = 'student interpretation'; }
    });
    draft.candidates.edges.forEach((item) => {
      const allowed = draft.configs.builder.relationVocabulary.includes(item.verb.trim().toLowerCase());
      const evidenceReady = !draft.instructor.evidenceRequired || item.evidence;
      item.status = evidenceReady && allowed ? 'confirmed' : evidenceReady && draft.instructor.allowResearchLeads ? 'research lead' : 'pending';
      item.claimState = item.status === 'confirmed' ? 'student interpretation' : item.status === 'research lead' ? 'research lead' : item.claimState;
    });
  }, 'candidates.batch-confirmed', 'All grounded candidates');
  const decided = [...project.candidates.nodes, ...project.candidates.edges].filter((item) => item.status !== 'pending').length;
  const total = project.candidates.nodes.length + project.candidates.edges.length;
  return <div className="wide stage-enter">
    <p className="eyebrow">Choose what to map · {decided} of {total} decided</p>
    <div className="stage-title-row"><div><h1>Choose nodes and relationships for the map.</h1><p className="lede">Review each proposed node and relationship. Accept, edit, reject, or mark it as a research lead.</p></div><button className="button button--secondary" type="button" onClick={confirmAll}>Accept all grounded items</button></div>
    <div className="subnav" role="tablist" aria-label="Candidate types"><button id="candidate-tab-nodes" role="tab" aria-controls="candidate-panel" aria-selected={kind === 'nodes'} tabIndex={kind === 'nodes' ? 0 : -1} data-composite-value="nodes" className={kind === 'nodes' ? 'is-active' : ''} onKeyDown={(event) => handleCompositeKey(event, ['nodes', 'edges'], kind, setKind)} onClick={() => setKind('nodes')}>Nodes · {project.candidates.nodes.length}</button><button id="candidate-tab-edges" role="tab" aria-controls="candidate-panel" aria-selected={kind === 'edges'} tabIndex={kind === 'edges' ? 0 : -1} data-composite-value="edges" className={kind === 'edges' ? 'is-active' : ''} onKeyDown={(event) => handleCompositeKey(event, ['nodes', 'edges'], kind, setKind)} onClick={() => setKind('edges')}>Relationships · {project.candidates.edges.length}</button></div>
    <div id="candidate-panel" className="candidate-list" role="tabpanel" aria-labelledby={`candidate-tab-${kind}`}>
      {candidates.map((item, index) => <article className={`candidate-row candidate-row--${item.status.replaceAll(' ', '-')}`} key={item.id}>
        <div className="candidate-row__count">{String(index + 1).padStart(2, '0')}</div>
        <div className="candidate-row__main">
          {kind === 'nodes' ? <div className="candidate-expression"><input aria-label="Node label" maxLength={NODE_LABEL_LIMIT} value={item.label} onChange={(event) => edit(item.id, 'label', event.target.value)} /><span>is a</span><select aria-label="Node type" value={item.type} onChange={(event) => edit(item.id, 'type', event.target.value)}>{NODE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></div> : <div className="candidate-expression candidate-expression--edge"><strong>{item.sourceLabel}</strong><input aria-label="Relationship verb" maxLength={RELATIONSHIP_VERB_LIMIT} value={item.verb} onChange={(event) => edit(item.id, 'verb', event.target.value)} /><strong>{item.targetLabel}</strong></div>}
          <p><span className="evidence-chip">{item.evidence || 'Evidence unresolved'}</span> · {SCALES[item.scale]?.label || item.scale}</p>
          <Field label="Reviewer note"><input maxLength={PROJECT_LIMITS.noteText} value={item.notes || ''} placeholder="Optional reason or condition" onChange={(event) => edit(item.id, 'notes', event.target.value)} /></Field>
        </div>
        <div className="candidate-actions" aria-label={`Decision for ${kind === 'nodes' ? item.label : `${item.sourceLabel} ${item.verb} ${item.targetLabel}`}`}>
          <button className={item.status === 'confirmed' ? 'is-active' : ''} type="button" onClick={() => setStatus(item.id, 'confirmed')}>Accept</button>
          {project.instructor.allowResearchLeads && <button className={item.status === 'research lead' ? 'is-active' : ''} type="button" onClick={() => setStatus(item.id, 'research lead')}>Research lead</button>}
          <button className={item.status === 'rejected' ? 'is-active' : ''} type="button" onClick={() => setStatus(item.id, 'rejected')}>Reject</button>
        </div>
      </article>)}
      {!candidates.length && <p className="empty-message">No {kind} were proposed. Return to the memo and add explicit actors and relationships.</p>}
    </div>
    <p className="privacy-note">The graph builder uses fixed rules. It does not call an external model.</p>
  </div>;
}

const GRAPH_WIDTH = 840;
const GRAPH_HEIGHT = 540;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function stateClass(value) {
  return String(value || 'confirmed').replaceAll(' ', '-');
}

function ScaleGlyph({ scale, x = -57, y = 0, size = 6 }) {
  if (scale === 'micro') return <circle className="node-scale-glyph" cx={x} cy={y} r={size} />;
  if (scale === 'meso') return <rect className="node-scale-glyph" x={x - size} y={y - size} width={size * 2} height={size * 2} />;
  if (scale === 'macro') return <path className="node-scale-glyph" d={`M${x} ${y - size - 2} L${x + size + 2} ${y} L${x} ${y + size + 2} L${x - size - 2} ${y} Z`} />;
  return <g className="node-scale-glyph"><circle cx={x - (size / 2)} cy={y} r={size} /><circle cx={x + (size * .66)} cy={y} r={size} /></g>;
}

function AnnotationField({ annotationId, label, value, hint, placeholder, onDraftValue, onCommit, onFlush, onPersisted, persistenceStatus, persistenceMessage, savedRevision = 0 }) {
  const [draft, setDraft] = useState(value || '');
  const [pending, setPending] = useState(false);
  const dirtyRef = useRef(false);
  const committedRef = useRef(false);
  const commitTimerRef = useRef(null);
  const savedRevisionRef = useRef(savedRevision);
  const callbacksRef = useRef({ onDraftValue, onCommit, onFlush, onPersisted, savedRevision });
  callbacksRef.current = { onDraftValue, onCommit, onFlush, onPersisted, savedRevision };

  const markPersisted = (updateState = true) => {
    dirtyRef.current = false;
    committedRef.current = false;
    if (updateState) setPending(false);
    callbacksRef.current.onPersisted?.();
  };
  const commit = () => {
    window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = null;
    if (!dirtyRef.current || committedRef.current) return committedRef.current;
    savedRevisionRef.current = callbacksRef.current.savedRevision;
    const committed = callbacksRef.current.onCommit?.() !== false;
    committedRef.current = committed;
    return committed;
  };
  const flush = (updateState = true) => {
    if (!dirtyRef.current) return true;
    commit();
    const saved = callbacksRef.current.onFlush?.() === true;
    if (saved && committedRef.current) markPersisted(updateState);
    return saved;
  };

  useEffect(() => {
    setDraft(value || '');
    setPending(false);
    dirtyRef.current = false;
    committedRef.current = false;
    savedRevisionRef.current = savedRevision;
  }, [annotationId]);
  useEffect(() => {
    if (!dirtyRef.current) setDraft(value || '');
  }, [value]);
  useEffect(() => {
    if (pending && committedRef.current && persistenceStatus === 'saved' && savedRevision > savedRevisionRef.current) {
      markPersisted();
    }
  }, [pending, persistenceStatus, savedRevision]);
  useEffect(() => () => {
    window.clearTimeout(commitTimerRef.current);
    if (dirtyRef.current) flush(false);
  }, []);
  const change = (event) => {
    const next = event.target.value;
    dirtyRef.current = true;
    committedRef.current = false;
    setDraft(next);
    setPending(true);
    callbacksRef.current.onDraftValue?.(next);
    window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(commit, ANNOTATION_COMMIT_DEBOUNCE_MS);
  };
  const fieldId = stableId('annotation-field', annotationId);
  const statusId = stableId('annotation-status', annotationId);
  const hintId = hint ? stableId('annotation-hint', annotationId) : null;
  const failed = persistenceStatus === 'error' || persistenceStatus === 'validation';
  const queued = pending;
  const statusText = failed ? persistenceMessage : queued ? 'Queued for local save' : 'Saved on this device';
  return <div className="field annotation-field">
    <label className="field__label" htmlFor={fieldId}>{label}</label>
    <textarea id={fieldId} rows="4" maxLength={PROJECT_LIMITS.annotationText} value={draft} onChange={change} onBlur={() => flush()} aria-describedby={[statusId, hintId].filter(Boolean).join(' ')} placeholder={placeholder} />
    <span id={statusId} className={`annotation-save annotation-save--${failed ? 'error' : queued ? 'queued' : 'saved'}`} role="status">{statusText}</span>
    {hint && <span id={hintId} className="field__hint">{hint}</span>}
  </div>;
}

function GraphCanvas({ nodes, edges, selection, onSelect, onMoveNode, viewport, phoneLayout, panMode, onViewportChange, onAnnounce }) {
  const svgRef = useRef(null);
  const interactionRef = useRef(null);
  const frameRef = useRef(null);
  const [transientNode, setTransientNode] = useState(null);
  const [transientViewport, setTransientViewport] = useState(null);
  const shownViewport = transientViewport || viewport;
  const positions = useMemo(() => new Map(nodes.map((node) => [node.id, transientNode?.id === node.id ? { x: transientNode.x, y: transientNode.y } : { x: node.x, y: node.y }])), [nodes, transientNode]);
  useEffect(() => () => window.cancelAnimationFrame(frameRef.current), []);
  const schedule = (callback) => {
    if (frameRef.current) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      callback();
    });
  };
  const clientPoint = (clientX, clientY) => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM?.();
    if (matrix?.inverse && svg?.createSVGPoint) {
      const point = svg.createSVGPoint();
      point.x = clientX;
      point.y = clientY;
      const transformed = point.matrixTransform(matrix.inverse());
      return { x: transformed.x, y: transformed.y };
    }
    const rect = svg.getBoundingClientRect();
    const fallbackViewBox = phoneLayout
      ? { x: 0, y: -130, width: 840, height: 800 }
      : { x: 0, y: 0, width: GRAPH_WIDTH, height: GRAPH_HEIGHT };
    const viewBox = svg.viewBox?.baseVal?.width ? svg.viewBox.baseVal : fallbackViewBox;
    const uniformScale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height) || 1;
    const renderedWidth = viewBox.width * uniformScale;
    const renderedHeight = viewBox.height * uniformScale;
    const offsetX = rect.left + (rect.width - renderedWidth) / 2;
    const offsetY = rect.top + (rect.height - renderedHeight) / 2;
    return { x: viewBox.x + (clientX - offsetX) / uniformScale, y: viewBox.y + (clientY - offsetY) / uniformScale };
  };
  const viewDelta = (event, divideByZoom = false) => {
    const current = clientPoint(event.clientX, event.clientY);
    const x = current.x - interactionRef.current.startSvgX;
    const y = current.y - interactionRef.current.startSvgY;
    return divideByZoom ? { x: x / shownViewport.zoom, y: y / shownViewport.zoom } : { x, y };
  };
  const beginNode = (event, node) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onSelect('node', node.id, false);
    const start = clientPoint(event.clientX, event.clientY);
    interactionRef.current = {
      kind: 'node', pointerId: event.pointerId, captureTarget: event.currentTarget,
      nodeId: node.id, startClientX: event.clientX, startClientY: event.clientY,
      startSvgX: start.x, startSvgY: start.y,
      originX: node.x, originY: node.y, latestX: node.x, latestY: node.y, moved: false,
    };
  };
  const beginPan = (event) => {
    if (!panMode || (event.button !== undefined && event.button !== 0)) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const start = clientPoint(event.clientX, event.clientY);
    interactionRef.current = {
      kind: 'pan', pointerId: event.pointerId, captureTarget: event.currentTarget,
      startClientX: event.clientX, startClientY: event.clientY,
      startSvgX: start.x, startSvgY: start.y,
      originX: viewport.panX, originY: viewport.panY, latestX: viewport.panX, latestY: viewport.panY, moved: false,
    };
  };
  const movePointer = (event) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const rawDistance = Math.hypot(event.clientX - interaction.startClientX, event.clientY - interaction.startClientY);
    if (rawDistance < 4 && !interaction.moved) return;
    interaction.moved = true;
    if (interaction.kind === 'node') {
      const delta = viewDelta(event, true);
      interaction.latestX = clamp(Math.round(interaction.originX + delta.x), 48, GRAPH_WIDTH - 48);
      interaction.latestY = clamp(Math.round(interaction.originY + delta.y), 42, GRAPH_HEIGHT - 42);
      schedule(() => setTransientNode({ id: interaction.nodeId, x: interaction.latestX, y: interaction.latestY }));
    } else {
      const delta = viewDelta(event);
      interaction.latestX = clamp(interaction.originX + delta.x, VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan);
      interaction.latestY = clamp(interaction.originY + delta.y, VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan);
      schedule(() => setTransientViewport({ ...viewport, panX: interaction.latestX, panY: interaction.latestY }));
    }
  };
  const finishPointer = (event, cancelled = false) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    interaction.captureTarget?.releasePointerCapture?.(event.pointerId);
    interactionRef.current = null;
    window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (!cancelled && interaction.moved && interaction.kind === 'node') onMoveNode(interaction.nodeId, interaction.latestX, interaction.latestY, 'pointer');
    if (!cancelled && !interaction.moved && interaction.kind === 'node') onSelect('node', interaction.nodeId, true);
    if (!cancelled && interaction.moved && interaction.kind === 'pan') onViewportChange({ ...viewport, panX: interaction.latestX, panY: interaction.latestY });
    setTransientNode(null);
    setTransientViewport(null);
  };
  const keyboardNode = (event, node) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect('node', node.id, true);
      return;
    }
    const deltas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!deltas[event.key]) return;
    event.preventDefault();
    const step = event.shiftKey ? 24 : 8;
    const [dx, dy] = deltas[event.key];
    const x = clamp(node.x + dx * step, 48, GRAPH_WIDTH - 48);
    const y = clamp(node.y + dy * step, 42, GRAPH_HEIGHT - 42);
    onSelect('node', node.id, false);
    onMoveNode(node.id, x, y, 'keyboard');
    onAnnounce(`${node.label} moved to x ${x}, y ${y}.`);
  };
  const phoneNode = phoneLayout ? { cardX: -110, cardY: -34, cardWidth: 220, cardHeight: 68, cardRadius: 13, ringX: -120, ringY: -45, ringWidth: 240, ringHeight: 90, ringRadius: 16 } : { cardX: -78, cardY: -29, cardWidth: 156, cardHeight: 58, cardRadius: 8, ringX: -84, ringY: -35, ringWidth: 168, ringHeight: 70, ringRadius: 10 };
  const graphViewBox = phoneLayout ? '0 -130 840 800' : `0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`;
  return <svg ref={svgRef} tabIndex="-1" className={`graph-canvas ${panMode ? 'is-panning' : ''}`} role="group" aria-label={`Systems map with ${nodes.length} ${nodes.length === 1 ? 'node' : 'nodes'} and ${edges.length} ${edges.length === 1 ? 'relationship' : 'relationships'}. Tab to a node or relationship. Arrow keys move a focused node by 8 pixels; Shift plus an arrow moves it by 24.`} viewBox={graphViewBox} onPointerDown={beginPan} onPointerMove={movePointer} onPointerUp={finishPointer} onPointerCancel={(event) => finishPointer(event, true)}>
    <title>Interactive systems map</title>
    <defs><marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 z" /></marker></defs>
    <g className="viewport-layer" transform={`translate(${shownViewport.panX} ${shownViewport.panY}) scale(${shownViewport.zoom})`}>
      <g className="edges">{edges.map((edge) => {
        const source = positions.get(edge.source);
        const target = positions.get(edge.target);
        if (!source || !target) return null;
        const deltaX = target.x - source.x;
        const deltaY = target.y - source.y;
        const length = Math.max(1, Math.hypot(deltaX, deltaY));
        const unitX = deltaX / length;
        const unitY = deltaY / length;
        const x1 = source.x + unitX * 78;
        const y1 = source.y + unitY * 30;
        const x2 = target.x - unitX * 88;
        const y2 = target.y - unitY * 34;
        const midX = (source.x + target.x) / 2;
        const midY = (source.y + target.y) / 2;
        const selected = selection?.kind === 'edge' && selection.id === edge.id;
        return <g key={edge.id} data-graph-id={edge.id} role="button" tabIndex="0" aria-label={`${edge.sourceLabel} ${edge.verb} ${edge.targetLabel}, ${edge.claimState} relationship`} className={`graph-edge graph-edge--${stateClass(edge.claimState)} ${selected ? 'is-selected' : ''}`} onPointerDown={(event) => { event.stopPropagation(); onSelect('edge', edge.id, true); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect('edge', edge.id, true); } }}>
          <line className="edge-hit" x1={x1} y1={y1} x2={x2} y2={y2} />
          {selected && <line className="edge-selection-halo" x1={x1} y1={y1} x2={x2} y2={y2} />}
          <line className="edge-line" x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#arrowhead)" />
          <rect className="edge-label-bg" x={midX - (phoneLayout ? 78 : 48)} y={midY - (phoneLayout ? 20 : 13)} width={phoneLayout ? 156 : 96} height={phoneLayout ? 38 : 24} rx={phoneLayout ? 6 : 2} />
          <text className="edge-label" x={midX} y={midY + (phoneLayout ? 8 : 4)}>{edge.verb.length > (phoneLayout ? 12 : 18) ? `${edge.verb.slice(0, phoneLayout ? 11 : 17)}…` : edge.verb}</text>
        </g>;
      })}</g>
      <g className="nodes">{nodes.map((node) => {
        const position = positions.get(node.id);
        const selected = selection?.kind === 'node' && selection.id === node.id;
        const evidenceState = node.evidence ? 'evidence recorded' : 'evidence unresolved';
        return <g key={node.id} data-graph-id={node.id} role="button" tabIndex="0" aria-label={`${node.label}, ${node.type}, ${node.scale} scale, ${node.claimState}, ${evidenceState}, position x ${Math.round(position.x)} y ${Math.round(position.y)}`} aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight" className={`graph-node graph-node--${node.scale} graph-node--${stateClass(node.claimState)} ${selected ? 'is-selected' : ''}`} transform={`translate(${position.x} ${position.y})`} onPointerDown={(event) => beginNode(event, node)} onKeyDown={(event) => keyboardNode(event, node)}>
          {selected && <rect className="node-selection-ring" x={phoneNode.ringX} y={phoneNode.ringY} width={phoneNode.ringWidth} height={phoneNode.ringHeight} rx={phoneNode.ringRadius} />}
          <rect className="node-card" x={phoneNode.cardX} y={phoneNode.cardY} width={phoneNode.cardWidth} height={phoneNode.cardHeight} rx={phoneNode.cardRadius} />
          <ScaleGlyph scale={node.scale} x={phoneLayout ? -84 : -57} size={phoneLayout ? 12 : 6} />
          <text x={phoneLayout ? 8 : 10} y={phoneLayout ? 7 : -4} className="node-label">{node.label.length > (phoneLayout ? 12 : 19) ? `${node.label.slice(0, phoneLayout ? 11 : 18)}…` : node.label}</text>
          {!phoneLayout && <text x="10" y="13" className="node-type">{node.type} · {node.claimState}</text>}
          <text x={phoneLayout ? -84 : -57} y={phoneLayout ? 25 : 20} className="node-evidence">{node.evidence ? 'E' : '?'}</text>
        </g>;
      })}</g>
    </g>
  </svg>;
}

function sameGraphVisuals(previous, next) {
  if (previous.phoneLayout !== next.phoneLayout) return false;
  if (previous.panMode !== next.panMode) return false;
  if (previous.interactionMode !== next.interactionMode) return false;
  if (previous.selection?.kind !== next.selection?.kind || previous.selection?.id !== next.selection?.id) return false;
  if (previous.viewport.panX !== next.viewport.panX || previous.viewport.panY !== next.viewport.panY || previous.viewport.zoom !== next.viewport.zoom) return false;
  if (previous.nodes.length !== next.nodes.length || previous.edges.length !== next.edges.length) return false;
  for (let index = 0; index < previous.nodes.length; index += 1) {
    const a = previous.nodes[index]; const b = next.nodes[index];
    if (a.id !== b.id || a.x !== b.x || a.y !== b.y || a.label !== b.label || a.type !== b.type || a.scale !== b.scale || a.claimState !== b.claimState || Boolean(a.evidence) !== Boolean(b.evidence)) return false;
  }
  for (let index = 0; index < previous.edges.length; index += 1) {
    const a = previous.edges[index]; const b = next.edges[index];
    if (a.id !== b.id || a.source !== b.source || a.target !== b.target || a.verb !== b.verb || a.claimState !== b.claimState || a.sourceLabel !== b.sourceLabel || a.targetLabel !== b.targetLabel) return false;
  }
  return true;
}

const MemoGraphCanvas = React.memo(GraphCanvas, sameGraphVisuals);

const LEGEND_STATE_PATTERNS = {
  confirmed: undefined,
  'student interpretation': '14 4',
  inference: '3 3',
  contested: '11 3 2 3',
  'research lead': '6 5',
  retired: '2 6',
};

function LegendStateSample({ state }) {
  if (state === 'selected') return <svg className="legend-state-sample is-selected" viewBox="0 0 40 18" aria-hidden="true"><rect x="3" y="3" width="34" height="12" rx="3" fill="none" stroke="currentColor" strokeWidth="3" /><line x1="8" y1="9" x2="32" y2="9" stroke="currentColor" strokeWidth="6" opacity=".35" /><line x1="8" y1="9" x2="32" y2="9" stroke="currentColor" strokeWidth="1.5" /></svg>;
  return <svg className={`legend-state-sample ${state === 'retired' ? 'is-retired' : ''}`} viewBox="0 0 40 18" aria-hidden="true"><line x1="3" y1="9" x2="37" y2="9" stroke="currentColor" strokeWidth="2.25" strokeDasharray={LEGEND_STATE_PATTERNS[state]} /></svg>;
}

function MapLegend() {
  return <div className="legend-grid">
    <section><h3>Scale · hue and shape</h3><ul><li><i className="legend-symbol legend-symbol--micro" /><span><strong>Micro</strong> · teal circle</span></li><li><i className="legend-symbol legend-symbol--meso" /><span><strong>Meso</strong> · amber square</span></li><li><i className="legend-symbol legend-symbol--macro" /><span><strong>Macro</strong> · plum diamond</span></li><li><i className="legend-symbol legend-symbol--integration" /><span><strong>Integration</strong> · black double circle</span></li></ul></section>
    <section><h3>Claim state · outline and line</h3><ul className="legend-states"><li><LegendStateSample state="confirmed" />Confirmed · solid</li><li><LegendStateSample state="student interpretation" />Student interpretation · long dash</li><li><LegendStateSample state="inference" />Inference · short dash</li><li><LegendStateSample state="contested" />Contested · dash-dot</li><li><LegendStateSample state="research lead" />Research lead · open dash</li><li><LegendStateSample state="retired" />Retired · faded dot</li><li><LegendStateSample state="selected" />Selected · teal outer ring or line halo</li></ul><p><strong>E</strong> marks recorded evidence; <strong>?</strong> marks unresolved evidence. Relationships use the same state line styles and explicit text.</p></section>
  </div>;
}

function usePhoneLayout() {
  const read = () => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(max-width: 600px)')?.matches ?? window.innerWidth <= 600;
  };
  const [phoneLayout, setPhoneLayout] = useState(read);
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 600px)');
    const change = () => setPhoneLayout(read());
    query?.addEventListener?.('change', change);
    window.addEventListener('resize', change);
    return () => {
      query?.removeEventListener?.('change', change);
      window.removeEventListener('resize', change);
    };
  }, []);
  return phoneLayout;
}

function fitViewport(nodes, targetHeight = 390) {
  if (!nodes.length) return { panX: 0, panY: 0, zoom: 1 };
  const minX = Math.min(...nodes.map((node) => node.x));
  const maxX = Math.max(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxY = Math.max(...nodes.map((node) => node.y));
  const zoom = clamp(Math.min(1.4, 650 / Math.max(220, maxX - minX + 180), targetHeight / Math.max(150, maxY - minY + 120)), VIEWPORT_LIMITS.minZoom, VIEWPORT_LIMITS.maxZoom);
  return {
    zoom,
    panX: clamp(GRAPH_WIDTH / 2 - ((minX + maxX) / 2) * zoom, VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan),
    panY: clamp(targetHeight === 240 ? 130 - ((minY + maxY) / 2) * zoom : GRAPH_HEIGHT / 2 - ((minY + maxY) / 2) * zoom, VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan),
  };
}

const INSPECTOR_TABS = ['node', 'relationships', 'map'];

function MapStage({ project, update, toast, logPrototype, saveState, stageAnnotationDraft, commitAnnotationDrafts, flushSave }) {
  const [selection, setSelection] = useState(project.graph.nodes[0] ? { kind: 'node', id: project.graph.nodes[0].id } : null);
  const [scaleFilter, setScaleFilter] = useState(project.activeScale);
  const [claimFilter, setClaimFilter] = useState('active');
  const [inspectorTab, setInspectorTab] = useState('node');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [phoneViewport, setPhoneViewport] = useState(null);
  const [annotationDisclosure, setAnnotationDisclosure] = useState('analytical');
  const [panMode, setPanMode] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [addMode, setAddMode] = useState(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [newNode, setNewNode] = useState({ label: '', type: 'organization', scale: project.activeScale, evidence: '', claimState: 'research lead' });
  const [newEdge, setNewEdge] = useState({ source: project.graph.nodes[0]?.id || '', target: project.graph.nodes[1]?.id || '', verb: 'provides', evidence: '', claimState: 'research lead' });
  const canvasWrapRef = useRef(null);
  const inspectorRef = useRef(null);
  const phoneLayout = usePhoneLayout();
  const scaleEdgeIds = useMemo(() => new Set(project.graph.edges.filter((edge) => scaleFilter === 'all' || edge.scale === scaleFilter).flatMap((edge) => [edge.source, edge.target])), [project.graph.edges, scaleFilter]);
  const visibleNodes = useMemo(() => project.graph.nodes.filter((node) => {
    const scaleMatches = scaleFilter === 'all' || node.scale === scaleFilter || scaleEdgeIds.has(node.id);
    const stateMatches = claimFilter === 'all' || (claimFilter === 'active' ? node.claimState !== 'retired' : node.claimState === claimFilter);
    return scaleMatches && stateMatches;
  }), [project.graph.nodes, scaleFilter, scaleEdgeIds, claimFilter]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(() => project.graph.edges.filter((edge) => {
    const stateMatches = claimFilter === 'all' || (claimFilter === 'active' ? edge.claimState !== 'retired' : edge.claimState === claimFilter);
    return (scaleFilter === 'all' || edge.scale === scaleFilter) && visibleIds.has(edge.source) && visibleIds.has(edge.target) && stateMatches;
  }), [project.graph.edges, scaleFilter, visibleIds, claimFilter]);
  useEffect(() => {
    if (phoneLayout && drawerOpen) setPhoneViewport(fitViewport(visibleNodes.length ? visibleNodes : project.graph.nodes, 240));
    else setPhoneViewport(null);
    // Refit only when the drawer opens or the layout crosses the phone breakpoint.
    // Annotation edits clone graph records but must not reset an in-progress pan/zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phoneLayout, drawerOpen]);
  useEffect(() => {
    if (!phoneLayout || !drawerOpen) return undefined;
    const frame = window.requestAnimationFrame(() => inspectorRef.current?.querySelector('[role="tab"][aria-selected="true"]')?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [phoneLayout, drawerOpen]);
  const selectedNode = selection?.kind === 'node' ? project.graph.nodes.find((node) => node.id === selection.id) : null;
  const selectedEdge = selection?.kind === 'edge' ? project.graph.edges.find((edge) => edge.id === selection.id) : null;
  const relatedEdges = selectedNode ? project.graph.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id) : project.graph.edges;
  const selectItem = useCallback((kind, id, openInspector = true) => {
    setSelection({ kind, id });
    setInspectorTab(kind === 'edge' ? 'relationships' : 'node');
    setAnnotationDisclosure('analytical');
    if (openInspector) {
      setLegendOpen(false);
      setCreateMenuOpen(false);
      setPanMode(false);
      setDrawerOpen(true);
    }
  }, []);
  const closeInspector = useCallback(() => {
    setDrawerOpen(false);
    window.requestAnimationFrame(() => {
      const targets = canvasWrapRef.current?.querySelectorAll('[data-graph-id]') || [];
      const target = selection?.id ? [...targets].find((element) => element.getAttribute('data-graph-id') === selection.id) : null;
      (target || canvasWrapRef.current?.querySelector('.graph-canvas'))?.focus();
    });
  }, [selection]);
  const moveNode = useCallback((id, x, y, method) => {
    update((draft) => {
      const node = draft.graph.nodes.find((item) => item.id === id);
      if (node) { node.x = x; node.y = y; }
    });
    logPrototype('node_moved', { keyboard: method === 'keyboard', pointer: method === 'pointer' });
  }, [update, logPrototype]);
  const changeViewport = useCallback((next) => {
    const bounded = {
      panX: clamp(Math.round(next.panX), VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan),
      panY: clamp(Math.round(next.panY), VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan),
      zoom: clamp(Number(next.zoom.toFixed(2)), VIEWPORT_LIMITS.minZoom, VIEWPORT_LIMITS.maxZoom),
    };
    if (phoneLayout && drawerOpen) setPhoneViewport(bounded);
    update((draft) => { draft.viewport = bounded; });
    logPrototype('viewport_changed');
  }, [update, logPrototype, phoneLayout, drawerOpen]);
  const zoomBy = (amount) => {
    const current = phoneLayout && drawerOpen && phoneViewport ? phoneViewport : project.viewport;
    const zoom = clamp(current.zoom + amount, VIEWPORT_LIMITS.minZoom, VIEWPORT_LIMITS.maxZoom);
    const mapCenterX = (GRAPH_WIDTH / 2 - current.panX) / current.zoom;
    const mapCenterY = (GRAPH_HEIGHT / 2 - current.panY) / current.zoom;
    changeViewport({ zoom, panX: GRAPH_WIDTH / 2 - mapCenterX * zoom, panY: GRAPH_HEIGHT / 2 - mapCenterY * zoom });
  };
  const fitMap = () => {
    const nodes = visibleNodes.length ? visibleNodes : project.graph.nodes;
    changeViewport(fitViewport(nodes));
  };
  const editNode = (field, value) => update((draft) => {
    const node = draft.graph.nodes.find((item) => item.id === selection?.id);
    if (!node) return;
    node[field] = value;
    if (field === 'label') draft.graph.edges.forEach((edge) => {
      if (edge.source === node.id) edge.sourceLabel = value;
      if (edge.target === node.id) edge.targetLabel = value;
    });
  });
  const commitAnnotations = () => commitAnnotationDrafts().changed;
  const addNode = () => {
    if (!project.instructor.allowResearchLeads) return toast('Research leads are disabled for this project.', 'error');
    if (project.graph.nodes.length >= PROJECT_LIMITS.nodes) return toast(`This map already contains the maximum ${PROJECT_LIMITS.nodes} nodes.`, 'error');
    if (!newNode.label.trim()) return toast('Name the node before adding it.', 'error');
    if (project.instructor.evidenceRequired && !newNode.evidence.trim()) return toast('Add an evidence locator or research question before adding the node.', 'error');
    const id = stableId('node', `${newNode.label}:${Date.now()}`);
    update((draft) => {
      draft.graph.nodes = withDefaultNodeLayout([...draft.graph.nodes, { ...newNode, label: newNode.label.trim(), id, status: 'confirmed', notes: '' }]);
    }, 'node.added', newNode.label.trim());
    setSelection({ kind: 'node', id });
    setNewEdge((current) => ({
      ...current,
      source: current.source || id,
      target: !current.target || current.target === current.source ? id : current.target,
    }));
    setNewNode({ label: '', type: 'organization', scale: project.activeScale, evidence: '', claimState: 'research lead' });
    setAddMode(null);
    toast('Node added as a research lead.');
  };
  const addEdge = () => {
    if (!project.instructor.allowResearchLeads) return toast('Research leads are disabled for this project.', 'error');
    if (project.graph.edges.length >= PROJECT_LIMITS.edges) return toast(`This map already contains the maximum ${PROJECT_LIMITS.edges} relationships.`, 'error');
    const source = project.graph.nodes.find((node) => node.id === newEdge.source);
    const target = project.graph.nodes.find((node) => node.id === newEdge.target);
    if (!source || !target || source.id === target.id) return toast('Choose two different nodes.', 'error');
    if (!newEdge.verb.trim()) return toast('Name the relationship with an accountable verb.', 'error');
    if (project.instructor.evidenceRequired && !newEdge.evidence.trim()) return toast('Add an evidence locator or research question before adding the relationship.', 'error');
    const id = stableId('edge', `${newEdge.source}:${newEdge.verb}:${newEdge.target}:${Date.now()}`);
    update((draft) => { draft.graph.edges.push({ ...newEdge, id, sourceLabel: source.label, targetLabel: target.label, scale: source.scale, status: 'confirmed', notes: '', annotation: { id: stableId('annotation', `edge:${id}:relationship`), text: '' } }); }, 'edge.added', `${source.label} ${newEdge.verb} ${target.label}`);
    setSelection({ kind: 'edge', id });
    setInspectorTab('relationships');
    setAddMode(null);
    toast('Relationship added as a research lead.');
  };
  const canvasViewport = phoneLayout && drawerOpen && phoneViewport ? phoneViewport : project.viewport;
  const setTab = (tab) => {
    setInspectorTab(tab);
    setAddMode(null);
    setCreateMenuOpen(false);
  };
  const annotationProps = {
    onCommit: commitAnnotations,
    onFlush: flushSave,
    onPersisted: () => logPrototype('annotation_saved'),
    persistenceStatus: saveState.status,
    persistenceMessage: saveState.message,
    savedRevision: saveState.savedRevision || 0,
  };
  return <div className="map-stage stage-enter">
    <div className="map-toolbar"><h1>Build the map</h1><div className="map-toolbar__controls"><label><span>Scale</span><select value={scaleFilter} onChange={(event) => setScaleFilter(event.target.value)}><option value="all">All released</option>{project.releasedScales.map((scale) => <option key={scale} value={scale}>{SCALES[scale].label}</option>)}</select></label><label><span>State</span><select value={claimFilter} onChange={(event) => setClaimFilter(event.target.value)}><option value="active">Active claims</option><option value="all">All states</option>{CLAIM_STATES.map((state) => <option key={state}>{state}</option>)}</select></label></div></div>
    <div className="map-layout">
      <section ref={canvasWrapRef} className={`canvas-wrap ${phoneLayout && drawerOpen ? 'is-inspector-open' : ''}`} aria-label="Map canvas and controls">
        <MemoGraphCanvas nodes={visibleNodes} edges={visibleEdges} selection={selection} onSelect={selectItem} onMoveNode={moveNode} viewport={canvasViewport} phoneLayout={phoneLayout} interactionMode={phoneLayout && drawerOpen ? 'phone-drawer' : 'durable'} panMode={panMode} onViewportChange={changeViewport} onAnnounce={setAnnouncement} />
        <div className="canvas-controls" role="toolbar" aria-label="Map view controls" aria-hidden={phoneLayout && drawerOpen ? 'true' : undefined} inert={phoneLayout && drawerOpen}><button type="button" aria-pressed={panMode} className={panMode ? 'is-active' : ''} onClick={() => setPanMode((current) => !current)}>Pan</button><button type="button" aria-label="Zoom out" onClick={() => zoomBy(-0.15)}>−</button><button type="button" aria-label="Zoom in" onClick={() => zoomBy(0.15)}>+</button><button type="button" onClick={fitMap}>Fit map</button><button type="button" aria-expanded={legendOpen} onClick={() => setLegendOpen((current) => { const opening = !current; if (opening) { setDrawerOpen(false); setCreateMenuOpen(false); } return opening; })}>Legend</button><button className="phone-inspector-trigger" type="button" aria-expanded={drawerOpen} onClick={() => { if (!project.graph.nodes.length) setInspectorTab('map'); setLegendOpen(false); setDrawerOpen(true); }}>Inspect</button></div>
        {legendOpen && <aside className="map-legend" aria-label="Map legend"><div className="map-legend__head"><strong>Legend</strong><button type="button" onClick={() => setLegendOpen(false)} aria-label="Close map legend"><Icon name="close" /></button></div><MapLegend /></aside>}
        <div className="sr-only" aria-live="polite">{announcement}</div>
      </section>
      <aside ref={inspectorRef} className={`inspector ${drawerOpen ? 'is-open' : ''}`} aria-label="Map inspector" aria-hidden={phoneLayout && !drawerOpen ? 'true' : undefined} inert={phoneLayout && !drawerOpen} onKeyDown={(event) => { if (event.key === 'Escape' && drawerOpen) { event.preventDefault(); closeInspector(); } }}>
        <div className="inspector__head"><h2>{selectedNode?.label || (selectedEdge ? `${selectedEdge.sourceLabel} → ${selectedEdge.targetLabel}` : 'Evolving map')}</h2>{project.instructor.allowResearchLeads && <><div className="inline-actions inspector-create-actions"><button className="icon-button" type="button" title="Add node" aria-label="Add node" onClick={() => { setAddMode(addMode === 'node' ? null : 'node'); setDrawerOpen(true); }}><Icon name="plus" /></button><button className="edge-add" type="button" title="Add relationship" aria-label="Add relationship" onClick={() => { setAddMode(addMode === 'edge' ? null : 'edge'); setDrawerOpen(true); }}>↗</button></div><div className="inspector-add-menu"><button type="button" aria-expanded={createMenuOpen} aria-controls="inspector-add-actions" onClick={() => setCreateMenuOpen((current) => !current)}>Add</button>{createMenuOpen && <div id="inspector-add-actions"><button type="button" onClick={() => { setAddMode('node'); setCreateMenuOpen(false); }}>Node</button><button type="button" onClick={() => { setAddMode('edge'); setCreateMenuOpen(false); }}>Relationship</button></div>}</div></>}<button className="inspector-done" type="button" onClick={closeInspector}>Done</button></div>
        <div className="inspector-tabs" role="tablist" aria-label="Annotation target">{INSPECTOR_TABS.map((tab) => <button key={tab} id={`map-inspector-tab-${tab}`} type="button" role="tab" aria-selected={inspectorTab === tab} aria-controls={`map-inspector-panel-${tab}`} tabIndex={inspectorTab === tab ? 0 : -1} data-composite-value={tab} onClick={() => setTab(tab)} onKeyDown={(event) => handleCompositeKey(event, INSPECTOR_TABS, inspectorTab, setTab)}>{tab === 'relationships' ? 'Relationships' : tab[0].toUpperCase() + tab.slice(1)}</button>)}</div>
        {addMode === 'node' && <div className="add-form"><h3>Add a research lead</h3><Field label="Label"><input maxLength={NODE_LABEL_LIMIT} value={newNode.label} onChange={(event) => setNewNode((current) => ({ ...current, label: event.target.value }))} /></Field><div className="field-pair"><Field label="Type"><select value={newNode.type} onChange={(event) => setNewNode((current) => ({ ...current, type: event.target.value }))}>{NODE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></Field><Field label="Scale"><select value={newNode.scale} onChange={(event) => setNewNode((current) => ({ ...current, scale: event.target.value }))}>{project.releasedScales.map((scale) => <option key={scale}>{scale}</option>)}</select></Field></div><Field label="Evidence or research question"><textarea maxLength={PROJECT_LIMITS.noteText} rows="3" value={newNode.evidence} onChange={(event) => setNewNode((current) => ({ ...current, evidence: event.target.value }))} /></Field><button className="button" type="button" onClick={addNode}>Add node</button></div>}
        {addMode === 'edge' && <div className="add-form"><h3>Add a relationship</h3><Field label="Source"><select value={newEdge.source} onChange={(event) => setNewEdge((current) => ({ ...current, source: event.target.value }))}>{project.graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field><Field label="Accountable verb"><input maxLength={RELATIONSHIP_VERB_LIMIT} value={newEdge.verb} onChange={(event) => setNewEdge((current) => ({ ...current, verb: event.target.value }))} /></Field><Field label="Target"><select value={newEdge.target} onChange={(event) => setNewEdge((current) => ({ ...current, target: event.target.value }))}>{project.graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field><Field label="Evidence or research question"><textarea maxLength={PROJECT_LIMITS.noteText} rows="3" value={newEdge.evidence} onChange={(event) => setNewEdge((current) => ({ ...current, evidence: event.target.value }))} /></Field><button className="button" type="button" onClick={addEdge}>Add relationship</button></div>}
        {!addMode && inspectorTab === 'node' && <div id="map-inspector-panel-node" className="inspector__body" role="tabpanel" aria-labelledby="map-inspector-tab-node">{selectedNode ? <>
          <details className="node-summary"><summary><span>Summary</span><strong>{selectedNode.type} · {selectedNode.claimState}</strong></summary><div className="node-summary__body"><Field label="Label"><input maxLength={NODE_LABEL_LIMIT} value={selectedNode.label} onChange={(event) => editNode('label', event.target.value)} /></Field><div className="field-pair"><Field label="Type"><select value={selectedNode.type} onChange={(event) => editNode('type', event.target.value)}>{NODE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></Field><Field label="Scale"><select value={selectedNode.scale} onChange={(event) => editNode('scale', event.target.value)}>{project.releasedScales.map((scale) => <option key={scale}>{scale}</option>)}</select></Field></div><Field label="Claim state"><select value={selectedNode.claimState} onChange={(event) => editNode('claimState', event.target.value)}>{CLAIM_STATES.filter((state) => project.instructor.allowResearchLeads || state !== 'research lead').map((state) => <option key={state}>{state}</option>)}</select></Field><div className="provenance-block"><span>Evidence locator</span><p>{selectedNode.evidence || 'No evidence locator yet.'}</p>{selectedNode.notes && <><span>Reviewer note</span><p>{selectedNode.notes}</p></>}</div></div></details>
          <section className="annotation-disclosure"><button type="button" aria-expanded={annotationDisclosure === 'analytical'} aria-controls="node-analytical-annotation" onClick={() => setAnnotationDisclosure((current) => current === 'analytical' ? null : 'analytical')}><span>Analytical annotation</span><Icon name={annotationDisclosure === 'analytical' ? 'close' : 'plus'} /></button>{annotationDisclosure === 'analytical' && <div id="node-analytical-annotation"><AnnotationField key={selectedNode.annotations.analytical.id} annotationId={selectedNode.annotations.analytical.id} label="Analysis" value={selectedNode.annotations.analytical.text} placeholder="What does this actor change in the inquiry?" onDraftValue={(text) => stageAnnotationDraft(selectedNode.annotations.analytical.id, text)} {...annotationProps} /></div>}</section>
          <section className="annotation-disclosure"><button type="button" aria-expanded={annotationDisclosure === 'evidence'} aria-controls="node-evidence-annotation" onClick={() => setAnnotationDisclosure((current) => current === 'evidence' ? null : 'evidence')}><span>Evidence annotation</span><Icon name={annotationDisclosure === 'evidence' ? 'close' : 'plus'} /></button>{annotationDisclosure === 'evidence' && <div id="node-evidence-annotation"><AnnotationField key={selectedNode.annotations.evidence.id} annotationId={selectedNode.annotations.evidence.id} label="Evidence" value={selectedNode.annotations.evidence.text} placeholder="How does the evidence support, limit, or complicate this node?" onDraftValue={(text) => stageAnnotationDraft(selectedNode.annotations.evidence.id, text)} {...annotationProps} /></div>}</section>
        </> : <p className="empty-message">Choose a node on the map to inspect and annotate it.</p>}</div>}
        {!addMode && inspectorTab === 'relationships' && <div id="map-inspector-panel-relationships" className="inspector__body" role="tabpanel" aria-labelledby="map-inspector-tab-relationships"><div className="relationship-picker" aria-label="Relationship list">{relatedEdges.map((edge) => <button type="button" key={edge.id} className={selectedEdge?.id === edge.id ? 'is-selected' : ''} onClick={() => selectItem('edge', edge.id)}><span>{edge.sourceLabel} <strong>{edge.verb}</strong> {edge.targetLabel}</span><small>{edge.claimState}</small></button>)}</div>{selectedEdge ? <><details className="node-summary"><summary><span>Summary</span><strong>{selectedEdge.claimState}</strong></summary><div className="node-summary__body"><div className="provenance-block"><span>Evidence locator</span><p>{selectedEdge.evidence || 'No evidence locator yet.'}</p></div><Field label="Relationship claim state"><select value={selectedEdge.claimState} onChange={(event) => update((draft) => { const edge = draft.graph.edges.find((item) => item.id === selectedEdge.id); if (edge) edge.claimState = event.target.value; })}>{CLAIM_STATES.map((state) => <option key={state}>{state}</option>)}</select></Field></div></details><AnnotationField key={selectedEdge.annotation.id} annotationId={selectedEdge.annotation.id} label="Relationship annotation" value={selectedEdge.annotation.text} placeholder="What does this relationship explain, and what remains uncertain?" onDraftValue={(text) => stageAnnotationDraft(selectedEdge.annotation.id, text)} {...annotationProps} /></> : <p className="empty-message">Choose a relationship on the map or from this list to annotate it.</p>}</div>}
        {!addMode && inspectorTab === 'map' && <div id="map-inspector-panel-map" className="inspector__body" role="tabpanel" aria-labelledby="map-inspector-tab-map"><div className="map-summary"><strong>{project.graph.nodes.length}</strong><span>nodes</span><strong>{project.graph.edges.length}</strong><span>relationships</span></div><AnnotationField key={project.mapAnnotation.id} annotationId={project.mapAnnotation.id} label="Map note" value={project.mapAnnotation.text} hint="Write about a pattern, boundary, contradiction, or question across the map." placeholder="Across the map, I notice…" onDraftValue={(text) => stageAnnotationDraft(project.mapAnnotation.id, text)} {...annotationProps} /></div>}
      </aside>
    </div>
  </div>;
}

function RevisionStage({ project, update, replaceProject, toast, logPrototype }) {
  const [importError, setImportError] = useState('');
  const confirmed = project.graph.nodes.filter((node) => node.claimState !== 'research lead' && node.claimState !== 'retired').length;
  const leads = project.graph.nodes.filter((node) => node.claimState === 'research lead').length + project.graph.edges.filter((edge) => edge.claimState === 'research lead').length;
  const onImport = async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      if (file.name.length > FILE_NAME_LIMIT) throw new Error(`Choose a project whose file name is ${FILE_NAME_LIMIT} characters or fewer.`);
      if (file.size > MAX_PROJECT_BYTES) throw new Error('Choose a Systems Mapping JSON file smaller than 8 MB.');
      const imported = parseProject(await file.text());
      replaceProject(imported, file.name);
      setImportError('');
      toast('Project imported and validated.');
    } catch (error) { setImportError(error.message); toast(error.message, 'error'); }
    event.target.value = '';
  };
  const tiers = ['private', 'course', 'CUNY', 'public'];
  const maxIndex = tiers.indexOf(project.instructor.maxSharingTier);
  const exportProject = (format) => {
    try {
      const portable = createPortableProject(project, project.sharingTier);
      if (format === 'json') download(`${project.id}.json`, serializePortableProject(project, project.sharingTier));
      if (format === 'csv') download(`${project.id}.csv`, graphCsv(portable), 'text/csv');
      if (format === 'markdown') download(`${project.id}.md`, projectMarkdown(portable), 'text/markdown');
      logPrototype('project_exported', { nodeCount: portable.graph.nodes.length, relationshipCount: portable.graph.edges.length });
      toast(portable.portableExport.redacted ? `Export created with ${portable.portableExport.redactions.length} recorded redactions.` : 'Export created with no required redactions.');
    } catch (error) {
      toast(`Export blocked: ${error.message}`, 'error');
    }
  };
  return <div className="wide stage-enter">
    <p className="eyebrow">Revise and export</p>
    <h1>Describe your revision. Export a copy.</h1>
    <p className="lede">Describe what changed. Check the sharing tier. Then export a copy.</p>
    <div className="revision-grid">
      <section>
        <div className="before-after"><div><span>Before mapping</span><p>{project.submission.text.split(/[.!?]/).filter((sentence) => sentence.trim()).length} memo statements were available for review.</p></div><Icon name="arrow" size={24} /><div><span>Current graph</span><p>{project.graph.nodes.length} nodes and {project.graph.edges.length} relationships are recorded.</p></div></div>
        <Field label="What changed in your explanation?" hint="Required to complete this release"><textarea className="reflection" rows="8" maxLength={PROJECT_LIMITS.promptText} value={project.reflection} onChange={(event) => update((draft) => { draft.reflection = event.target.value; })} onBlur={() => update(() => {}, 'reflection.revised', 'Release reflection')} placeholder="I first understood… The map now shows… I still need to investigate…" /></Field>
        <div className="release-summary"><div><strong>{confirmed}</strong><span>grounded nodes</span></div><div><strong>{project.graph.edges.length}</strong><span>relationships</span></div><div><strong>{leads}</strong><span>research leads</span></div><div><strong>{project.events.length}</strong><span>recorded events</span></div></div>
        <div className="sharing-row"><Field label="Sharing tier"><select value={project.sharingTier} onChange={(event) => update((draft) => { draft.sharingTier = event.target.value; }, 'sharing.changed', event.target.value)}>{tiers.map((tier, index) => <option key={tier} disabled={index > maxIndex}>{tier}{index > maxIndex ? ' · instructor locked' : ''}</option>)}</select></Field><p>Exports omit original file bytes. Review sensitive evidence before moving beyond private or course use.</p></div>
      </section>
      <aside className="history-panel"><div className="history-panel__head"><div><p className="eyebrow">Revision history</p><h2>{project.events.length} events</h2></div><Icon name="history" /></div><ol className="timeline">{[...project.events].reverse().slice(0, 14).map((event) => <li key={event.id}><span className="timeline__dot" /><div><strong>{event.action.replaceAll('.', ' ')}</strong><p>{event.detail}</p><small>{new Date(event.at).toLocaleString()} · {event.actor}</small></div></li>)}</ol></aside>
    </div>
    <section className="export-strip"><div><p className="eyebrow">Export a copy</p><h2>Export a copy.</h2><p>Choose JSON, CSV, or Markdown for a copy of the map.</p></div><div className="export-actions"><button className="button button--secondary" onClick={() => exportProject('json')}><Icon name="download" />JSON</button><button className="button button--secondary" onClick={() => exportProject('csv')}><Icon name="download" />CSV</button><button className="button button--secondary" onClick={() => exportProject('markdown')}><Icon name="download" />Markdown</button><label className="button button--ghost"><Icon name="upload" />Import JSON<input type="file" accept=".json,application/json" onChange={onImport} /></label></div>{importError && <p className="error-text">{importError}</p>}</section>
  </div>;
}

function InstructorPanel({ project, update, toast, onNewProject }) {
  const set = (field, value) => update((draft) => { draft.instructor[field] = value; invalidatePreflight(draft); }, 'instructor.setting', `${field}: ${value}`, 'instructor');
  const setReadinessThreshold = (value) => {
    const threshold = Number(value);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 8) return;
    set('readinessThreshold', threshold);
  };
  const release = (scale) => update((draft) => {
    if (!draft.releasedScales.includes(scale)) draft.releasedScales.push(scale);
  }, 'release.opened', SCALES[scale].label, 'instructor');
  return <div className="instructor-panel">
    <p className="privacy-note">Instructor controls are local to this project. Changes invalidate the gate record when they affect readiness.</p>
    <div className="settings-section"><p className="eyebrow">Readiness and evidence</p><Field label="Readiness threshold"><input type="number" min="1" max="8" step="1" value={project.instructor.readinessThreshold} onChange={(event) => setReadinessThreshold(event.target.value)} /></Field><div className="config-line"><span>Hard gates</span><strong>H1–H4 required</strong></div><label className="check-row"><input type="checkbox" checked={project.instructor.evidenceRequired} onChange={(event) => set('evidenceRequired', event.target.checked)} /><span><strong>Require evidence locators</strong><small>Claims cannot advance on confidence alone.</small></span></label><label className="check-row"><input type="checkbox" checked={project.instructor.requireStudentConfirmation} onChange={(event) => set('requireStudentConfirmation', event.target.checked)} /><span><strong>Require student confirmation</strong><small>Model operations remain proposals.</small></span></label></div>
    <div className="settings-section"><p className="eyebrow">Privacy and publication</p><Field label="Maximum sharing tier"><select value={project.instructor.maxSharingTier} onChange={(event) => set('maxSharingTier', event.target.value)}><option>private</option><option>course</option><option>CUNY</option><option>public</option></select></Field><label className="check-row"><input type="checkbox" checked={project.instructor.allowResearchLeads} onChange={(event) => set('allowResearchLeads', event.target.checked)} /><span><strong>Allow unsupported research leads</strong><small>Leads remain visually and semantically distinct.</small></span></label></div>
    <div className="settings-section"><p className="eyebrow">Sequential releases</p><div className="release-controls">{SCALE_ORDER.map((scale, index) => { const open = project.releasedScales.includes(scale); const previousOpen = index === 0 || project.releasedScales.includes(SCALE_ORDER[index - 1]); return <button key={scale} className={open ? 'is-open' : ''} disabled={open || !previousOpen} onClick={() => release(scale)}>{open ? <Icon name="check" size={15} /> : <Icon name="lock" size={15} />}{SCALES[scale].label}</button>; })}</div></div>
    <div className="settings-section"><p className="eyebrow">Model contracts</p><dl className="config-summary"><div><dt>Evaluator</dt><dd>{project.configs.preflight.label} · v{project.configs.preflight.revision}</dd></div><div><dt>Builder</dt><dd>{project.configs.builder.label} · v{project.configs.builder.revision}</dd></div><div><dt>Runtime</dt><dd>{suggestionRuntimeLabel(project.preflight?.evaluation?.runtime)}</dd></div></dl><button type="button" className="button button--secondary" onClick={() => toast('Open “Review suggestions,” then “Model setup,” to revise either contract.')}>Where to edit</button></div>
    <div className="settings-section"><p className="eyebrow">Project data</p><p className="privacy-note">Create a separate local project without changing the model presets. Export the current project first if you need to retain it.</p><button type="button" className="button button--secondary" onClick={onNewProject}>New project…</button></div>
  </div>;
}

function applyAnnotationDrafts(project, drafts, updatedAt = new Date().toISOString()) {
  if (!drafts.size) return null;
  const next = structuredClone(project);
  let matches = 0;
  const apply = (annotation) => {
    if (!annotation || !drafts.has(annotation.id)) return;
    annotation.text = drafts.get(annotation.id);
    matches += 1;
  };
  [next.candidates?.nodes, next.graph?.nodes].forEach((nodes) => nodes?.forEach((node) => {
    apply(node.annotations?.analytical);
    apply(node.annotations?.evidence);
  }));
  [next.candidates?.edges, next.graph?.edges].forEach((edges) => edges?.forEach((edge) => apply(edge.annotation)));
  apply(next.mapAnnotation);
  if (!matches) return null;
  next.updatedAt = updatedAt;
  return next;
}

function App() {
  const [initialLoad] = useState(loadProject);
  const [project, setProject] = useState(initialLoad.project);
  const [modal, setModal] = useState(null);
  const [toastState, setToastState] = useState(null);
  const [teacherOpen, setTeacherOpen] = useState(false);
  const [accessState, setAccessState] = useState({ status: 'checking', access: null, message: 'Checking this device’s class access…', kind: 'info' });
  const [workspaceStarted, setWorkspaceStarted] = useState(false);
  const [hasSavedProject, setHasSavedProject] = useState(initialLoad.hasSavedProject);
  const [persistenceBlocked, setPersistenceBlocked] = useState(initialLoad.persistenceBlocked);
  const [pendingNewProject, setPendingNewProject] = useState(false);
  const [prototypeLogState, setPrototypeLogState] = useState({ status: 'active', dropped: 0 });
  const [studentAnnotation, setStudentAnnotation] = useState('');
  const [reviewBusy, setReviewBusy] = useState(null);
  const [saveState, setSaveState] = useState({
    status: initialLoad.loadError ? 'error' : initialLoad.hasSavedProject ? 'saved' : 'idle',
    message: initialLoad.loadError || (initialLoad.hasSavedProject ? 'Project saved on this device' : 'Project not started'),
    recovery: initialLoad.recovery,
    savedRevision: 0,
  });
  const toastTimer = useRef(null);
  const persistTimer = useRef(null);
  const pendingAnnotationsRef = useRef(new Map());
  const prototypeLogNoticeRef = useRef({ lastShownAt: 0, sequence: 0, lastFailure: 0 });
  const accessGenerationRef = useRef(0);
  const projectRef = useRef(project);
  const workspaceRef = useRef(null);
  projectRef.current = project;
  const toast = useCallback((message, type = 'success') => {
    window.clearTimeout(toastTimer.current);
    setToastState({ message, type });
    toastTimer.current = window.setTimeout(() => setToastState(null), 3200);
  }, []);

  const stageAnnotationDraft = useCallback((annotationId, text) => {
    const firstPendingDraft = pendingAnnotationsRef.current.size === 0;
    pendingAnnotationsRef.current.set(annotationId, text);
    if (firstPendingDraft) {
      setSaveState((current) => current.status === 'error' || current.status === 'validation'
        ? current
        : { ...current, status: 'saving', message: 'Annotation queued for local save…' });
    }
  }, []);

  const commitPendingAnnotations = useCallback(() => {
    if (!pendingAnnotationsRef.current.size) return { project: projectRef.current, changed: false };
    const drafts = new Map(pendingAnnotationsRef.current);
    pendingAnnotationsRef.current.clear();
    const updatedAt = new Date().toISOString();
    const base = projectRef.current;
    const preview = applyAnnotationDrafts(base, drafts, updatedAt);
    if (!preview) return { project: base, changed: false };
    let committedProject = preview;
    projectRef.current = preview;
    setProject((current) => {
      if (current === base) return preview;
      const rebased = applyAnnotationDrafts(current, drafts, updatedAt) || current;
      projectRef.current = rebased;
      committedProject = rebased;
      return rebased;
    });
    return { project: committedProject, changed: true };
  }, []);

  useEffect(() => {
    let active = true;
    const generation = ++accessGenerationRef.current;
    getStudentSession().then((result) => {
      if (!active || generation !== accessGenerationRef.current) return;
      setAccessState(result.access
        ? { status: 'granted', access: result.access, message: null, kind: 'info' }
        : { status: 'required', access: null, message: null, kind: 'info' });
    }).catch(() => {
      if (active && generation === accessGenerationRef.current) setAccessState({ status: 'unavailable', access: null, message: 'The classroom server is unavailable. Try again after it is restored; your saved project is unchanged.', kind: 'error' });
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (accessState.status !== 'granted' || typeof accessState.access?.expiresAt !== 'string') return undefined;
    const remaining = Date.parse(accessState.access.expiresAt) - Date.now();
    if (remaining <= 0) {
      accessGenerationRef.current += 1;
      setReviewBusy(null);
      setWorkspaceStarted(false);
      setAccessState({ status: 'expired', access: null, message: 'Class access expired. Enter the current class code to continue; your project is still preserved.', kind: 'error' });
      return undefined;
    }
    const timer = window.setTimeout(() => {
      accessGenerationRef.current += 1;
      setReviewBusy(null);
      setWorkspaceStarted(false);
      setAccessState({ status: 'expired', access: null, message: 'Class access expired. Enter the current class code to continue; your project is still preserved.', kind: 'error' });
    }, Math.min(remaining, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [accessState.status, accessState.access?.expiresAt]);

  const persistNow = useCallback((snapshot = projectRef.current) => {
    if (!workspaceStarted || persistenceBlocked) return false;
    let serialized;
    try {
      serialized = serializeProject(snapshot);
    } catch (error) {
      setSaveState((current) => ({ ...current, status: 'validation', message: `Complete the current required field to save: ${error.message}` }));
      return false;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, serialized);
      setHasSavedProject(true);
      setSaveState((current) => ({ ...current, status: 'saved', message: 'Project saved on this device', savedRevision: (current.savedRevision || 0) + 1 }));
      return true;
    } catch (error) {
      setPersistenceBlocked(true);
      setSaveState((current) => ({ ...current, status: 'error', message: `Local save failed: ${error.message}`, recovery: current.recovery || serialized }));
      return false;
    }
  }, [workspaceStarted, persistenceBlocked]);

  const flushPersistence = useCallback(() => {
    window.clearTimeout(persistTimer.current);
    const committed = commitPendingAnnotations();
    return persistNow(committed.project);
  }, [commitPendingAnnotations, persistNow]);

  useEffect(() => {
    if (!workspaceStarted || persistenceBlocked) return undefined;
    setSaveState((current) => ({ ...current, status: 'saving', message: 'Saving project on this device…' }));
    window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(persistNow, PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(persistTimer.current);
  }, [project, workspaceStarted, persistenceBlocked, persistNow]);

  useEffect(() => {
    window.addEventListener('pagehide', flushPersistence);
    return () => window.removeEventListener('pagehide', flushPersistence);
  }, [flushPersistence]);

  useEffect(() => () => {
    flushPersistence();
  }, [flushPersistence]);

  useEffect(() => () => {
    window.clearTimeout(toastTimer.current);
    window.clearTimeout(persistTimer.current);
  }, []);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        const incoming = parseProject(event.newValue);
        setHasSavedProject(true);
        setProject((current) => Date.parse(incoming.updatedAt || 0) > Date.parse(current.updatedAt || 0) ? incoming : current);
      } catch {
        setPersistenceBlocked(true);
        setSaveState((current) => ({ ...current, status: 'error', message: 'Another browser session wrote an invalid project. The current workspace was preserved.', recovery: event.newValue }));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  useEffect(() => {
    if (workspaceStarted || teacherOpen) workspaceRef.current?.focus();
  }, [project.stage, teacherOpen, workspaceStarted]);

  const refreshPublicConfigurations = useCallback(async () => {
    const scale = project.activeScale;
    const stageId = STAGES[project.stage]?.id || 'choose-scale';
    try {
      const [preflight, builder] = await Promise.all([
        getPublicConfiguration('preflight', scale, stageId),
        getPublicConfiguration('builder', scale, stageId),
      ]);
      setProject((current) => {
        if (current.activeScale !== scale) return current;
        if (current.teacherGovernance?.preflight?.fingerprint === preflight.fingerprint && current.teacherGovernance?.builder?.fingerprint === builder.fingerprint) return current;
        const next = structuredClone(current);
        next.teacherGovernance = { preflight, builder, refreshedAt: new Date().toISOString() };
        next.updatedAt = new Date().toISOString();
        return next;
      });
      return true;
    } catch {
      return false;
    }
  }, [project.activeScale, project.stage]);
  useEffect(() => {
    if (workspaceStarted && accessState.status === 'granted') refreshPublicConfigurations();
  }, [workspaceStarted, accessState.status, refreshPublicConfigurations]);

  const markPrototypeFailure = useCallback((sequence) => {
    prototypeLogNoticeRef.current.lastFailure = Math.max(prototypeLogNoticeRef.current.lastFailure, sequence);
    setPrototypeLogState((current) => ({ status: 'degraded', dropped: Math.min(99, current.dropped + 1) }));
    const now = Date.now();
    if (now - prototypeLogNoticeRef.current.lastShownAt >= 15_000) {
      prototypeLogNoticeRef.current.lastShownAt = now;
      toast('Prototype logging is temporarily unavailable. Local project saving continues.', 'error');
    }
  }, [toast]);

  const logPrototype = useCallback((event, metadata = undefined, stageOverride = undefined) => {
    if (accessState.status !== 'granted') return Promise.resolve(false);
    const stage = stageOverride || STAGES[projectRef.current.stage]?.label;
    const sequence = ++prototypeLogNoticeRef.current.sequence;
    const accessGeneration = accessGenerationRef.current;
    return recordPrototypeEvent(event, stage, metadata).then(() => {
      if (accessGeneration !== accessGenerationRef.current) return false;
      if (sequence > prototypeLogNoticeRef.current.lastFailure) {
        setPrototypeLogState((current) => current.status === 'active' ? current : { status: 'active', dropped: 0 });
      }
      return true;
    }).catch(async (error) => {
      if (error instanceof ApiError && error.status === 401) {
        if (accessGeneration !== accessGenerationRef.current) return false;
        try {
          const currentSession = await getStudentSession();
          if (accessGeneration !== accessGenerationRef.current) return false;
          if (currentSession.access) {
            setAccessState({ status: 'granted', access: currentSession.access, message: null, kind: 'info' });
            return false;
          }
          accessGenerationRef.current += 1;
          setReviewBusy(null);
          setWorkspaceStarted(false);
          setAccessState({ status: 'expired', access: null, message: 'Class access expired. Enter the current class code to continue; your project is still preserved.', kind: 'error' });
          return false;
        } catch {
          markPrototypeFailure(sequence);
          return false;
        }
      }
      markPrototypeFailure(sequence);
      return false;
    });
  }, [accessState.status, markPrototypeFailure]);

  const update = useCallback((mutator, action, detail, actor = 'student', metadata = null) => setProject((current) => {
    const next = structuredClone(current);
    mutator(next);
    next.updatedAt = new Date().toISOString();
    if (action) next.events.push(createEvent(action, detail, actor, metadata));
    if (next.events.length > 500) next.events = next.events.slice(-500);
    return next;
  }), []);

  const recordStageTransition = useCallback((fromStage, toStage, { completed = false, success = true } = {}) => {
    if (completed) logPrototype('stage_completed', { fromStage, toStage, success }, STAGES[fromStage].label);
    logPrototype('stage_viewed', { fromStage, toStage }, STAGES[toStage].label);
  }, [logPrototype]);

  const setStage = (stage, options = {}) => {
    const fromStage = project.stage;
    update((draft) => {
      draft.stage = stage;
      draft.furthestStage = Math.max(draft.furthestStage || 0, stage);
    }, 'stage.opened', STAGES[stage].label);
    recordStageTransition(fromStage, stage, options);
  };

  const handleReviewApiError = async (error, accessGeneration, retryLabel = 'instructor-review request') => {
    if (error instanceof ApiError && error.status === 401 && accessGeneration === accessGenerationRef.current) {
      try {
        const session = await getStudentSession();
        if (accessGeneration !== accessGenerationRef.current) return;
        if (session.access) {
          setAccessState({ status: 'granted', access: session.access, message: null, kind: 'info' });
          toast(`Class access is still valid. Retry the ${retryLabel}.`, 'error');
          return;
        }
        accessGenerationRef.current += 1;
        setReviewBusy(null);
        setWorkspaceStarted(false);
        setAccessState({ status: 'expired', access: null, message: 'Class access expired. Enter the current class code to continue; your project is still preserved.', kind: 'error' });
        return;
      } catch {
        toast('The classroom server could not confirm access. Your local project remains active; retry when the server is available.', 'error');
        return;
      }
    }
    toast(error instanceof Error ? error.message : 'The instructor-review request could not be completed.', 'error');
  };

  const generateSuggestions = async () => {
    const payload = preflightEvaluationPayload(project);
    const encoder = new TextEncoder();
    const sourceBytes = encoder.encode(payload.sourceMaterial).byteLength;
    if (payload.inquiry.length > MAX_EVALUATION_INQUIRY_CHARACTERS) {
      toast(`The guiding inquiry must be ${MAX_EVALUATION_INQUIRY_CHARACTERS.toLocaleString()} characters or fewer before generating suggestions.`, 'error');
      return;
    }
    if (payload.projectOverlay.customInstructions.length > MAX_EVALUATION_CUSTOM_INSTRUCTIONS) {
      toast(`Suggestion-model custom instructions must be ${MAX_EVALUATION_CUSTOM_INSTRUCTIONS.toLocaleString()} characters or fewer before generating suggestions.`, 'error');
      return;
    }
    const runtime = accessState.access?.suggestionRuntime;
    if (runtime?.provider === 'ollama-cloud' && encoder.encode(payload.inquiry).byteLength > MAX_EVALUATION_INQUIRY_BYTES) {
      toast(`The guiding inquiry is too large for the reported Ollama Cloud runtime (${MAX_EVALUATION_INQUIRY_BYTES.toLocaleString()} UTF-8 bytes maximum). Shorten the inquiry before generating suggestions.`, 'error');
      return;
    }
    if (runtime?.provider === 'ollama-cloud' && Number.isInteger(runtime.maxSourceBytes) && sourceBytes > runtime.maxSourceBytes) {
      toast(`This memo is too large for the reported Ollama Cloud runtime (${runtime.maxSourceBytes.toLocaleString()} UTF-8 bytes maximum). Shorten the memo or use a focused source excerpt; your local project remains unchanged.`, 'error');
      return;
    }
    if (encoder.encode(JSON.stringify(payload)).byteLength > MAX_EVALUATION_POST_BYTES) {
      toast('The suggestion evaluation request is too large to send. Shorten the memo or use a focused source excerpt; your local project remains unchanged.', 'error');
      return;
    }
    const accessGeneration = accessGenerationRef.current;
    const requestKey = authoritativeEvaluationKey(project);
    setReviewBusy('evaluating');
    try {
      const response = await createPreflightEvaluation(payload);
      if (!response || !Object.hasOwn(response, 'evaluation')) throw new Error('The classroom server returned an invalid suggestion-evaluation response.');
      if (accessGeneration !== accessGenerationRef.current || projectRef.current.id !== project.id) return;
      if (authoritativeEvaluationKey(projectRef.current) !== requestKey) {
        toast('The memo or model setup changed while suggestions were generated. Generate again from the current project.', 'error');
        return;
      }
      const result = normalizePreflightEvaluation(response.evaluation, projectRef.current);
      update((draft) => { draft.preflight = result; }, 'preflight.completed', 'Source prompts generated', 'student', {
        configurationSnapshot: result.configurationSnapshot,
        runtime: result.evaluation.runtime,
        evaluation: { createdAt: result.evaluation.createdAt, expiresAt: result.evaluation.expiresAt },
      });
      setStudentAnnotation('');
      toast('Prompts are ready for your review.');
    } catch (error) {
      await handleReviewApiError(error, accessGeneration, 'suggestion request');
    } finally {
      if (accessGeneration === accessGenerationRef.current) setReviewBusy(null);
    }
  };

  const sendForInstructorReview = async () => {
    if (!project.preflight || project.preflight.review) return;
    if (!hasUsableEvaluation(project.preflight)) {
      if (project.preflight.evaluation && project.preflight.evaluation.evaluationId !== '[unavailable]') {
        update((draft) => {
          if (draft.preflight?.evaluation) draft.preflight.evaluation.evaluationId = '[unavailable]';
        }, 'preflight.evaluation-unavailable', 'Evaluation is not current');
      }
      toast('This evaluation expired, was already used, or is not server-authoritative. Generate fresh suggestions before sending for instructor review.', 'error');
      return;
    }
    const accessGeneration = accessGenerationRef.current;
    const payload = {
      evaluationId: project.preflight.evaluation.evaluationId,
      studentAnnotation,
    };
    setReviewBusy('submitting');
    try {
      const response = await submitPreflightSubmission(payload);
      if (!response || !Object.hasOwn(response, 'submission')) throw new Error('The classroom server returned an invalid instructor-review response.');
      if (accessGeneration !== accessGenerationRef.current || projectRef.current.id !== project.id) return;
      const review = normalizeReviewSubmission(response.submission, project.id);
      update((draft) => {
        if (!draft.preflight) return;
        draft.preflight.review = review;
        draft.stage = 3;
        draft.furthestStage = Math.max(draft.furthestStage || 0, 3);
      }, 'preflight.review-submitted', 'Sent suggestion snapshot for instructor review', 'student', { status: review.status, revision: review.revision });
      recordStageTransition(2, 3, { completed: true });
      toast('Suggestions sent for instructor review.');
    } catch (error) {
      if (error instanceof ApiError && [409, 410].includes(error.status)) {
        update((draft) => {
          if (draft.preflight?.evaluation) draft.preflight.evaluation.evaluationId = '[unavailable]';
        }, 'preflight.evaluation-unavailable', 'Evaluation expired or was already used');
        toast('This evaluation expired or was already used. Generate fresh suggestions before sending for instructor review.', 'error');
      } else {
        await handleReviewApiError(error, accessGeneration);
      }
    } finally {
      if (accessGeneration === accessGenerationRef.current) setReviewBusy(null);
    }
  };

  const checkInstructorResponse = async () => {
    const submissionId = project.preflight?.review?.submissionId;
    if (!submissionId || submissionId === '[redacted]') return toast('This portable copy does not contain the private review capability. Return to the original browser workspace to check the response.', 'error');
    const accessGeneration = accessGenerationRef.current;
    setReviewBusy('refreshing');
    try {
      const response = await getPreflightSubmission(submissionId);
      if (!response || !Object.hasOwn(response, 'submission')) throw new Error('The classroom server returned an invalid instructor-review response.');
      if (accessGeneration !== accessGenerationRef.current || projectRef.current.id !== project.id) return;
      const review = normalizeReviewSubmission(response.submission, project.id);
      const rejected = review.status === 'rejected';
      update((draft) => {
        if (!draft.preflight) return;
        draft.preflight.review = review;
        draft.stage = rejected ? 1 : 3;
        draft.furthestStage = Math.max(draft.furthestStage || 0, 3);
      }, 'preflight.review-refreshed', rejected ? 'Instructor requested source revision' : `Instructor review ${review.status}`, 'student', { status: review.status, revision: review.revision, ...(review.decision ? { decision: review.decision } : {}) });
      if (rejected) {
        recordStageTransition(3, 1, { completed: true, success: false });
        toast('The instructor returned guidance. Your memo and map were not changed.', 'error');
      } else if (review.status === 'approved') {
        toast(review.decision === 'revise_and_approve' ? 'Instructor guidance is ready. Review it before generating candidates.' : 'Instructor review is complete. Candidate generation is available.');
      } else {
        toast('Instructor review is still pending.');
      }
    } catch (error) {
      await handleReviewApiError(error, accessGeneration);
    } finally {
      if (accessGeneration === accessGenerationRef.current) setReviewBusy(null);
    }
  };

  const prepareCandidates = () => {
    const review = project.preflight?.review;
    if (review?.status !== 'approved' || !['approve', 'revise_and_approve'].includes(review.decision)) {
      toast('Instructor approval is required before candidate generation.', 'error');
      return;
    }
    const extracted = extractCandidates(project.submission);
    const edges = extracted.edges.filter((edge) => edge.scale === project.activeScale);
    const requiredNodeIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
    const candidates = {
      nodes: extracted.nodes.filter((node) => node.scale === project.activeScale || requiredNodeIds.has(node.id)),
      edges,
    };
    if (!candidates.nodes.length) {
      toast('No source-grounded actors were found at this scale. Add explicit actor-to-actor statements before generating candidates.', 'error');
      return;
    }
    const snapshot = configurationSnapshot(project, 'builder');
    if (!project.instructor.requireStudentConfirmation) {
      candidates.nodes.forEach((node) => { node.status = 'confirmed'; node.claimState = 'student interpretation'; });
      candidates.edges.forEach((edge) => {
        const allowed = project.configs.builder.relationVocabulary.includes(edge.verb.trim().toLowerCase());
        edge.status = allowed ? 'confirmed' : project.instructor.allowResearchLeads ? 'research lead' : 'pending';
        edge.claimState = edge.status === 'confirmed' ? 'student interpretation' : edge.status === 'research lead' ? 'research lead' : edge.claimState;
      });
    }
    update((draft) => { draft.candidates = candidates; draft.stage = 4; draft.furthestStage = Math.max(draft.furthestStage || 0, 4); }, 'candidates.generated', `${candidates.nodes.length} nodes and ${candidates.edges.length} relationships`, 'student', { configurationSnapshot: snapshot, sourceFingerprint: project.submission.fingerprint || stableId('src', project.submission.text) });
    recordStageTransition(project.stage, 4, { completed: true });
    toast('Source-grounded candidates are ready for review.');
  };

  const commitGraph = () => {
    const acceptedNodes = project.candidates.nodes.filter((item) => item.status === 'confirmed' || item.status === 'research lead');
    const ids = new Set(acceptedNodes.map((node) => node.id));
    const acceptedEdges = project.candidates.edges.filter((item) => (item.status === 'confirmed' || item.status === 'research lead') && ids.has(item.source) && ids.has(item.target));
    if (!acceptedNodes.length) return toast('Confirm at least one node before opening the map.', 'error');
    const reviewedNodeIds = new Set(project.candidates.nodes.map((node) => node.id));
    const reviewedEdgeIds = new Set(project.candidates.edges.map((edge) => edge.id));
    const snapshot = configurationSnapshot(project, 'builder');
    update((draft) => {
      const priorNodeById = new Map(draft.graph.nodes.map((node) => [node.id, node]));
      const priorEdgeById = new Map(draft.graph.edges.map((edge) => [edge.id, edge]));
      const positionedAcceptedNodes = priorNodeById.size === 0
        ? withDefaultNodeLayout(acceptedNodes.map(({ x: _x, y: _y, ...node }) => node))
        : acceptedNodes;
      const nextNodes = positionedAcceptedNodes.map((node) => {
        const prior = priorNodeById.get(node.id);
        return { ...node, x: prior?.x ?? node.x, y: prior?.y ?? node.y, annotations: prior?.annotations ?? node.annotations, notes: node.notes || prior?.notes || '', claimState: node.status === 'research lead' ? 'research lead' : node.claimState };
      });
      const nextEdges = acceptedEdges.map((edge) => {
        const prior = priorEdgeById.get(edge.id);
        return { ...edge, annotation: prior?.annotation ?? edge.annotation, notes: edge.notes || prior?.notes || '', claimState: edge.status === 'research lead' ? 'research lead' : edge.claimState };
      });
      const nodeIds = new Set(nextNodes.map((node) => node.id));
      const edgeIds = new Set(nextEdges.map((edge) => edge.id));
      const retiredNodeIds = new Set([...reviewedNodeIds].filter((id) => !nodeIds.has(id)));
      const priorNodes = draft.graph.nodes.map((node) => retiredNodeIds.has(node.id) ? { ...node, status: 'rejected', claimState: 'retired', notes: [node.notes, 'Retired during candidate review.'].filter(Boolean).join(' ') } : node);
      const priorEdges = draft.graph.edges.map((edge) => ((reviewedEdgeIds.has(edge.id) && !edgeIds.has(edge.id)) || retiredNodeIds.has(edge.source) || retiredNodeIds.has(edge.target)) ? { ...edge, status: 'rejected', claimState: 'retired', notes: [edge.notes, 'Retired during candidate review.'].filter(Boolean).join(' ') } : edge);
      draft.graph.nodes = [...priorNodes.filter((node) => !nodeIds.has(node.id)), ...nextNodes];
      draft.graph.edges = [...priorEdges.filter((edge) => !edgeIds.has(edge.id)), ...nextEdges];
      draft.stage = 5;
      draft.furthestStage = Math.max(draft.furthestStage || 0, 5);
    }, 'graph.committed', `${acceptedNodes.length} nodes and ${acceptedEdges.length} relationships confirmed`, 'student', { configurationSnapshot: snapshot, operations: { nodes: acceptedNodes.map((node) => node.id), edges: acceptedEdges.map((edge) => edge.id), retiredNodes: [...reviewedNodeIds].filter((id) => !ids.has(id)) } });
    recordStageTransition(project.stage, 5, { completed: true });
    toast('Confirmed operations added to the durable graph.');
  };

  const primary = async () => {
    switch (project.stage) {
      case 0: setStage(1, { completed: true }); break;
      case 1: setStage(2, { completed: true }); break;
      case 2:
        if (!project.preflight || project.preflight.review?.decision === 'reject' || (!project.preflight.review && !hasUsableEvaluation(project.preflight))) await generateSuggestions();
        else if (!project.preflight.review) await sendForInstructorReview();
        else if (project.preflight.review.status === 'approved') prepareCandidates();
        else setStage(3);
        break;
      case 3:
        if (project.preflight?.review?.status === 'approved') prepareCandidates();
        else await checkInstructorResponse();
        break;
      case 4: commitGraph(); break;
      case 5: setStage(6, { completed: true }); break;
      case 6:
        if (!project.reflection.trim()) toast('Name the analytical change before finishing this release.', 'error');
        else {
          update((draft) => {
            if (!draft.completedScales.includes(draft.activeScale)) draft.completedScales.push(draft.activeScale);
          }, 'release.completed', SCALES[project.activeScale].label);
          logPrototype('stage_completed', { fromStage: 6, toStage: 6, success: true }, STAGES[6].label);
          toast('Release saved with its provenance and revision history.');
        }
        break;
      default: break;
    }
  };

  const primaryLabel = (() => {
    if (project.stage === 2) {
      if (reviewBusy === 'evaluating') return 'Generating suggestions…';
      if (reviewBusy === 'submitting') return 'Sending for instructor review…';
      if (!project.preflight || project.preflight.review?.decision === 'reject') return 'Generate suggestions';
      if (!project.preflight.review && !hasUsableEvaluation(project.preflight)) return 'Generate fresh suggestions';
      return !project.preflight.review ? 'Send for instructor review' : project.preflight.review.status === 'approved' ? 'Generate candidates' : 'Open instructor response';
    }
    if (project.stage === 3) return project.preflight?.review?.status === 'approved' ? 'Generate candidates' : reviewBusy === 'refreshing' ? 'Checking instructor response…' : 'Check instructor response';
    if (project.stage === 4) return 'Build confirmed map';
    if (project.stage === 5) return 'Review revision';
    if (project.stage === 6) return 'Finish release';
    return 'Continue';
  })();

  const backDisabled = project.stage === 0;
  const canPrimary = !reviewBusy && (project.stage !== 1 || project.submission.text.trim().length >= 80);
  const replaceProject = useCallback((imported, fileName = 'Imported project') => {
    const next = structuredClone(imported);
    next.updatedAt = new Date().toISOString();
    next.events = [...(next.events || []), createEvent('project.imported', fileName)].slice(-500);
    setProject(next);
    setStudentAnnotation('');
    setReviewBusy(null);
    logPrototype('project_imported', { stageIndex: next.stage, nodeCount: next.graph.nodes.length, edgeCount: next.graph.edges.length }, STAGES[next.stage].label);
    logPrototype('stage_viewed', { fromStage: projectRef.current.stage, toStage: next.stage }, STAGES[next.stage].label);
  }, [logPrototype]);
  const screen = [
    <ScaleStage project={project} update={update} />,
    <IntakeStage project={project} update={update} toast={toast} />,
    <SuggestionReviewStage project={project} update={update} toast={toast} studentAnnotation={studentAnnotation} setStudentAnnotation={setStudentAnnotation} persistence={accessState.access?.persistence} retentionDays={accessState.access?.retentionDays} suggestionRuntime={accessState.access?.suggestionRuntime} />,
    <InstructorResponseStage project={project} />,
    <CandidateStage project={project} update={update} toast={toast} />,
    <MapStage project={project} update={update} toast={toast} logPrototype={logPrototype} saveState={saveState} stageAnnotationDraft={stageAnnotationDraft} commitAnnotationDrafts={commitPendingAnnotations} flushSave={flushPersistence} />,
    <RevisionStage project={project} update={update} replaceProject={replaceProject} toast={toast} logPrototype={logPrototype} />,
  ][project.stage];

  const refreshAfterTeacherChange = async () => {
    const refreshed = await refreshPublicConfigurations();
    toast(refreshed ? 'Shared teacher configuration refreshed for this project.' : 'Revision saved, but the project snapshot could not be refreshed yet.', refreshed ? 'success' : 'error');
  };

  const submitClassCode = async (code) => {
    const generation = ++accessGenerationRef.current;
    setAccessState({ status: 'submitting', access: null, message: null, kind: 'info' });
    try {
      const result = await requestStudentAccess(code);
      if (generation !== accessGenerationRef.current) return false;
      setAccessState({ status: 'granted', access: result.access, message: null, kind: 'info' });
      setReviewBusy(null);
      setPrototypeLogState({ status: 'active', dropped: 0 });
      setWorkspaceStarted(false);
      return true;
    } catch (error) {
      if (generation !== accessGenerationRef.current) return false;
      const retryAfter = error instanceof ApiError ? error.payload?.retryAfterSeconds : null;
      const throttled = error instanceof ApiError && error.status === 429;
      const unavailable = !(error instanceof ApiError);
      setAccessState({
        status: throttled ? 'throttled' : unavailable ? 'unavailable' : 'required',
        access: null,
        message: throttled
          ? `Too many attempts. Try again${retryAfter ? ` in ${retryAfter} seconds` : ' shortly'}. Your saved project is unchanged.`
          : unavailable ? 'The classroom server is unavailable. Try again after it is restored; your saved project is unchanged.' : 'That class code was not accepted. Check the code and try again.',
        kind: 'error',
      });
      return false;
    }
  };

  const endAccess = async () => {
    const generation = ++accessGenerationRef.current;
    try { await endStudentAccess(); } catch { /* Local expiry still removes the UI grant. */ }
    if (generation !== accessGenerationRef.current) return;
    setReviewBusy(null);
    setWorkspaceStarted(false);
    setAccessState({ status: 'required', access: null, message: 'Class access ended. Your project remains saved on this device.', kind: 'info' });
  };

  const resumeProject = () => {
    setWorkspaceStarted(true);
    logPrototype('project_resumed', { stageIndex: project.stage, nodeCount: project.graph.nodes.length, edgeCount: project.graph.edges.length }, STAGES[project.stage].label);
  };

  const startBlankProject = () => {
    const fromStage = projectRef.current.stage;
    const blank = createBlankProject();
    setProject(blank);
    setStudentAnnotation('');
    setReviewBusy(null);
    setHasSavedProject(false);
    setWorkspaceStarted(true);
    setPendingNewProject(false);
    setModal(null);
    logPrototype('project_started', { stageIndex: 0, nodeCount: 0, edgeCount: 0 }, STAGES[0].label);
    logPrototype('stage_viewed', { fromStage, toStage: 0 }, STAGES[0].label);
    toast('Blank local project created.');
  };

  const requestNewProject = () => {
    setPendingNewProject(true);
    if (persistenceBlocked) setModal('storage');
    else if (hasSavedProject) setModal('new-project');
    else startBlankProject();
  };

  const continueInMemory = () => {
    if (pendingNewProject) startBlankProject();
    else {
      setWorkspaceStarted(true);
      setModal(null);
    }
    setSaveState((current) => ({ ...current, status: 'error', message: 'Working in memory only. Export a recovery copy before closing this page.' }));
  };

  const preserveRecoveryAndEnableStorage = () => {
    try {
      if (saveState.recovery) {
        const recoveryKey = `systems-mapping-studio.recovery.${Date.now()}`;
        window.localStorage.setItem(recoveryKey, saveState.recovery);
      }
      setPersistenceBlocked(false);
      setSaveState((current) => ({ ...current, status: 'saving', message: 'Preparing a new versioned browser recovery…', recovery: saveState.recovery }));
      if (pendingNewProject) startBlankProject();
      else setModal(null);
    } catch (error) {
      setSaveState((current) => ({ ...current, status: 'error', message: `Browser storage is still unavailable: ${error.message}` }));
    }
  };

  const recoveryModal = <Modal open={modal === 'storage'} title="Local save recovery" onClose={() => setModal(null)}>
    <div className="confirm-panel">
      <p>{saveState.message}</p>
      <p>No invalid or unavailable storage value will be overwritten automatically. Download the preserved bytes, continue in memory, or explicitly preserve them under a separate recovery key before enabling a new versioned save.</p>
      <div className="button-stack">
        {saveState.recovery && <button type="button" className="button button--secondary" onClick={() => download('systems-mapping-prior-recovery.json', saveState.recovery)}>Download prior data</button>}
        <button type="button" className="button button--secondary" onClick={() => download(`${project.id}-recovery.json`, serializeProject(project))}>Download current project</button>
        <button type="button" className="button button--ghost" onClick={continueInMemory}>Continue in memory only</button>
        <button type="button" className="button" onClick={preserveRecoveryAndEnableStorage}>{saveState.recovery ? 'Preserve prior bytes and enable saving' : 'Retry browser storage'}</button>
      </div>
    </div>
  </Modal>;

  if (teacherOpen) return <div className="app-shell">
    <header className="app-header">
      <a href="#workspace" className="brand" aria-label="Systems Mapping Teacher Console home"><span className="brand__mark">sm</span><span><strong>Systems Mapping</strong><small>Teacher customization</small></span></a>
      <button className="text-button" type="button" onClick={() => setTeacherOpen(false)}><Icon name="back" />Back to class access</button>
    </header>
    <main ref={workspaceRef} tabIndex="-1" id="workspace" className="workspace workspace--teacher"><TeacherDashboard onConfigurationChanged={refreshAfterTeacherChange} /></main>
  </div>;

  if (accessState.status !== 'granted') return <ClassAccessScreen state={accessState} onSubmit={submitClassCode} onTeacher={() => setTeacherOpen(true)} />;

  if (!workspaceStarted) return <>
    <ResumeScreen project={project} hasSavedProject={hasSavedProject} access={accessState.access} saveState={saveState} prototypeLogState={prototypeLogState} onResume={resumeProject} onStart={requestNewProject} onTeacher={() => setTeacherOpen(true)} onEndAccess={endAccess} onRecovery={() => setModal('storage')} />
    {recoveryModal}
    <Modal open={modal === 'new-project'} title="Start another project" onClose={() => { setPendingNewProject(false); setModal(null); }}>
      <div className="confirm-panel"><p>This replaces the current browser workspace with a blank local project. Export the current project first if you need a separate portable copy.</p><div className="button-row"><button type="button" className="button button--ghost" onClick={() => { setPendingNewProject(false); setModal(null); }}>Cancel</button><button type="button" className="button" onClick={startBlankProject}>Start another project</button></div></div>
    </Modal>
  </>;

  return <div className="app-shell">
    <header className="app-header">
      <a href="#workspace" className="brand" aria-label="Systems Mapping home"><span className="brand__mark">sm</span><span><strong>Systems Mapping</strong><small>{project.title}</small></span></a>
      <div className="header-actions">
        {saveState.status === 'error' ? <button className="save-state save-state--error" type="button" onClick={() => setModal('storage')}><i />Local save needs attention</button> : saveState.status === 'validation' ? <span className="save-state save-state--error"><i />Complete the current field to save</span> : <span className="save-state"><i />{saveState.status === 'saving' ? 'Saving…' : 'Saved on device'}</span>}
        {prototypeLogState.status === 'degraded' && <span className="prototype-log-state" role="status"><strong aria-hidden="true">!</strong><span>Prototype log unavailable · {prototypeLogState.dropped} dropped</span></span>}
        <button className="text-button" type="button" onClick={() => setTeacherOpen(true)}><Icon name="settings" />Teacher access</button><button className="text-button" type="button" onClick={() => setModal('stages')}><Icon name="menu" />Stages</button>
      </div>
    </header>
    <div className="progress-track" aria-label={`Stage ${project.stage + 1} of ${STAGES.length}`}>{STAGES.map((stage, index) => <span key={stage.label} className={index <= project.stage ? 'is-active' : ''} />)}</div>
    <div className="sr-only" aria-live="polite">Stage {project.stage + 1} of {STAGES.length}: {STAGES[project.stage].label}</div>
    <main ref={workspaceRef} tabIndex="-1" id="workspace" className={`workspace workspace--stage-${project.stage}`}>{screen}</main>
    <footer className="app-footer"><div className="footer-context"><span>{project.stage + 1} of {STAGES.length}</span><strong>{STAGES[project.stage].label}</strong></div><div className="footer-actions"><button className="button button--ghost" type="button" disabled={backDisabled} onClick={() => setStage(project.stage - 1)}><Icon name="back" />Back</button><button className="button" type="button" disabled={!canPrimary} onClick={primary}>{primaryLabel}<Icon name="arrow" /></button></div></footer>
    <Modal open={modal === 'stages'} title="Stages" onClose={() => setModal(null)}>
      <ol className="stage-menu">{STAGES.map((stage, index) => { const accessible = index <= Math.max(project.furthestStage || 0, project.stage); return <li key={stage.label}><button disabled={!accessible} className={index === project.stage ? 'is-current' : ''} onClick={() => { setStage(index); setModal(null); }}><span>0{index + 1}</span><strong>{stage.label}</strong>{index === project.stage ? <em>Current</em> : accessible ? null : <Icon name="lock" size={15} />}</button></li>; })}</ol>
    </Modal>
    <Modal open={modal === 'new-project'} title="Start a new project" onClose={() => setModal(null)}>
      <div className="confirm-panel"><p>This replaces the current browser workspace with a blank local project. It does not delete any JSON, CSV, or Markdown files you already exported.</p><div className="button-row"><button type="button" className="button button--ghost" onClick={() => setModal(null)}>Cancel</button><button type="button" className="button" onClick={startBlankProject}>Start blank project</button></div></div>
    </Modal>
    {recoveryModal}
    <div className={`toast toast--${toastState?.type || 'success'} ${toastState ? 'is-visible' : ''}`} role="status" aria-live="polite">{toastState?.type === 'success' && <Icon name="check" />}{toastState?.message}</div>
  </div>;
}

export default App;
