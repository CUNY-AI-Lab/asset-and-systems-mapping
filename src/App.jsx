import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  NODE_TYPES,
  PROJECT_LIMITS,
  SCALE_ORDER,
  SCALE_PARTS,
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
import { SYSTEMS_MAPPING_STAGES } from '../shared/systems-mapping-stages.js';
import {
  ApiError,
  createPreflightEvaluation,
  endStudentAccess,
  getPublicConfiguration,
  getStudentSession,
  recordPrototypeEvent,
  requestStudentAccess,
  suggestMapConnections,
} from './api.js';

const STORAGE_KEY = 'systems-mapping-studio.project.v5';
const LEGACY_STORAGE_KEYS = [
  'systems-mapping-studio.project.v4',
  'systems-mapping-studio.project.v3',
  'systems-mapping-studio.project.v2',
  'systems-mapping-studio.project.v1',
];
const MAX_MEMO_BYTES = 5 * 1024 * 1024;
const MAX_MEMO_CHARACTERS = 500_000;
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
const VIEWPORT_LIMITS = { minZoom: 0.25, maxZoom: 2, minPan: -5000, maxPan: 5000 };

const STAGES = SYSTEMS_MAPPING_STAGES;
const TeacherDashboard = lazy(() => import('./TeacherDashboard.jsx'));

function invalidatePreflight(draft) {
  draft.preflight = null;
}

function memoFingerprint(submission) {
  return submission.fingerprint || stableId('src', submission.text);
}

function loadProject() {
  try {
    const current = window.localStorage.getItem(STORAGE_KEY);
    const legacyEntry = current === null
      ? LEGACY_STORAGE_KEYS.map((key) => [key, window.localStorage.getItem(key)]).find(([, value]) => value !== null)
      : null;
    const saved = current ?? legacyEntry?.[1] ?? null;
    const sourceKey = current !== null ? STORAGE_KEY : legacyEntry?.[0] ?? null;
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
        sourceKey,
      };
    } catch (error) {
      return {
        project: createDefaultProject(),
        loadError: `The previous browser workspace could not be validated: ${error.message}`,
        recovery: saved,
        hasSavedProject: false,
        persistenceBlocked: true,
        sourceKey,
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
  if (!textChanged) return;
  // Editing the memo never removes existing work. Guidance and candidates
  // simply become refreshable against the new fingerprint.
  draft.submission.revision = (draft.submission.revision || 1) + 1;
  draft.submission.fingerprint = stableId('src', value);
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
      ...(shared.courseParts ? { courseParts: structuredClone(shared.courseParts) } : {}),
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

function coursePartsForProject(project) {
  return project.teacherGovernance?.preflight?.courseParts || SCALE_PARTS;
}

function coursePartForScale(project, scale = project.activeScale) {
  return coursePartsForProject(project).find((part) => part.scaleIds.includes(scale)) || SCALE_PARTS[0];
}

function projectMetadataForReview(project) {
  return {
    id: project.id,
    projectId: project.id,
    submissionId: project.submission.id,
    title: project.title,
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
    sensitive: submission.sensitive,
    consent: submission.consent,
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

function memoPromptExcerpt(text) {
  const collapsed = String(text || '').replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 4000) return collapsed;
  const prefix = collapsed.slice(0, 4001);
  const boundary = prefix.lastIndexOf(' ');
  return (boundary > 2000 ? prefix.slice(0, boundary) : collapsed.slice(0, 4000)).trim();
}

function nodesForConnectionPrompt(project) {
  const selected = project.candidates.nodes
    .filter((node) => node.status === 'confirmed' || node.status === 'research lead');
  const active = project.graph.nodes
    .filter((node) => node.status !== 'rejected' && node.claimState !== 'retired' && node.scale === project.activeScale);
  return [...new Map([...active, ...selected].map((node) => [node.id, node])).values()];
}

function connectionSuggestionPayload(project, prompt) {
  const nodes = nodesForConnectionPrompt(project);
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    activeScale: project.activeScale,
    inquiry: project.inquiry,
    prompt,
    nodes: nodes.map(({ id, label, type }) => ({ id, label, type })),
    relationships: [...project.graph.edges, ...project.candidates.edges]
      .filter((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired' && nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .filter((edge, index, edges) => edges.findIndex((candidate) => candidate.source === edge.source && candidate.target === edge.target && candidate.verb.trim().toLocaleLowerCase() === edge.verb.trim().toLocaleLowerCase()) === index)
      .map(({ source, target, verb }) => ({ source, target, verb })),
    projectOverlay: projectOverlayForEvaluation(project.configs.builder),
  };
}

function normalizeConnectionSuggestions(response, project) {
  if (!response || typeof response !== 'object' || Array.isArray(response) || Object.keys(response).length !== 1 || !Array.isArray(response.connections)) {
    throw new Error('The classroom server returned invalid connection suggestions.');
  }
  if (response.connections.length > 12) throw new Error('The classroom server returned too many connection suggestions.');
  const nodeById = new Map(nodesForConnectionPrompt(project).map((node) => [node.id, node]));
  const existingConnections = new Set(project.graph.edges
    .filter((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired')
    .map(({ source, target, verb }) => `${source}\u0000${verb.trim().toLocaleLowerCase()}\u0000${target}`));
  const seen = new Set();
  return response.connections.map((connection, index) => {
    if (!connection || typeof connection !== 'object' || Array.isArray(connection)) throw new Error('The classroom server returned an invalid connection.');
    const keys = Object.keys(connection).sort();
    if (keys.join(',') !== ['rationale', 'source', 'target', 'verb'].join(',')) throw new Error('The classroom server returned an invalid connection.');
    const source = nodeById.get(connection.source);
    const target = nodeById.get(connection.target);
    if (!source || !target || source.id === target.id || typeof connection.verb !== 'string' || !connection.verb.trim() || connection.verb.length > RELATIONSHIP_VERB_LIMIT || typeof connection.rationale !== 'string' || !connection.rationale.trim() || connection.rationale.length > 1000) {
      throw new Error('The classroom server returned an invalid connection.');
    }
    const key = `${source.id}\u0000${connection.verb.trim().toLocaleLowerCase()}\u0000${target.id}`;
    if (seen.has(key)) throw new Error('The classroom server returned duplicate connection suggestions.');
    seen.add(key);
    const id = stableId('edge', `${source.id}:${connection.verb.trim()}:${target.id}:${index}`);
    return {
      id,
      source: source.id,
      target: target.id,
      sourceLabel: source.label,
      targetLabel: target.label,
      verb: connection.verb.trim(),
      scale: project.activeScale,
      status: 'pending',
      claimState: 'inference',
      notes: '',
      directed: true,
      rationale: connection.rationale.trim(),
      annotation: { id: stableId('annotation', `edge:${id}:relationship`), text: '' },
    };
  }).filter(({ source, target, verb }) => !existingConnections.has(`${source}\u0000${verb.toLocaleLowerCase()}\u0000${target}`));
}

function authoritativeEvaluationKey(project) {
  const payload = preflightEvaluationPayload(project);
  const { clientUpdatedAt: _clientUpdatedAt, stage: _stage, furthestStage: _furthestStage, ...stableMetadata } = payload.projectMetadata;
  return stableId('evaluation-request', JSON.stringify({ ...payload, projectMetadata: stableMetadata }));
}

function normalizePreflightEvaluation(evaluation, project) {
  if (!evaluation || typeof evaluation !== 'object' || Array.isArray(evaluation)) throw new Error('The classroom server returned an invalid memo review.');
  const expectedKeys = ['id', 'review', 'configSnapshot', 'runtime', 'createdAt', 'expiresAt'];
  if (Object.keys(evaluation).length !== expectedKeys.length || expectedKeys.some((key) => !Object.hasOwn(evaluation, key))) {
    throw new Error('The classroom server returned an invalid memo-review shape.');
  }
  if (typeof evaluation.id !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(evaluation.id)) throw new Error('The classroom server returned an invalid evaluation identifier.');
  if (!evaluation.review || typeof evaluation.review !== 'object' || Array.isArray(evaluation.review) || !evaluation.configSnapshot || !evaluation.runtime) {
    throw new Error('The classroom server returned an incomplete memo review.');
  }
  const preflight = {
    memoReview: structuredClone(evaluation.review),
    configurationSnapshot: structuredClone(evaluation.configSnapshot),
    evaluation: {
      evaluationId: evaluation.id,
      runtime: structuredClone(evaluation.runtime),
      createdAt: evaluation.createdAt,
      expiresAt: evaluation.expiresAt,
    },
    sourceFingerprint: memoFingerprint(project.submission),
  };
  const candidate = structuredClone(project);
  candidate.preflight = preflight;
  validateProject(candidate);
  return preflight;
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
    sourceType: '',
    location: '',
    rights: '',
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
  project.events = [createEvent('project.created', 'Started a blank project')];
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
    map: <><circle cx="6" cy="8" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="13" cy="17" r="2" /><path d="m8 8 8-1M7 10l5 5m2 0 3-6" /></>,
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
      <button type="button" className="access-header__teacher" onClick={onTeacher}>Teacher Console</button>
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
      <h1>Enter your class code</h1>
      <form className="class-code-form" onSubmit={submit}>
        <Field label="Class code">
          <input ref={inputRef} maxLength="32" autoComplete="one-time-code" autoCapitalize="none" spellCheck="false" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Class code" disabled={state.status === 'checking' || state.status === 'submitting'} />
        </Field>
        {state.message && <p className={`access-message access-message--${state.kind || 'info'}`} role={state.kind === 'error' ? 'alert' : 'status'}>{state.message}</p>}
        <button className="button access-primary" type="submit" disabled={!code.trim() || state.status === 'checking' || state.status === 'submitting'}>{state.status === 'checking' ? 'Checking class access…' : state.status === 'submitting' ? 'Checking code…' : 'Continue'}</button>
      </form>
      <details className="access-help"><summary>Having trouble?</summary><p>Ask your teacher for the current class code.</p></details>
    </main>
  </AccessFrame>;
}

function ResumeScreen({ project, hasSavedProject, saveState, onResume, onStart, onTeacher, onEndAccess, onRecovery }) {
  const memoCount = hasSavedProject && (project.submission?.text?.trim() || project.submission?.title?.trim()) ? 1 : 0;
  return <AccessFrame onTeacher={onTeacher}>
    <main className="resume-main" id="workspace">
      <p className="eyebrow">Class workspace open</p>
      <h1>{hasSavedProject ? 'Keep working on your map.' : 'Start a systems map.'}</h1>
      <h2>{hasSavedProject ? project.title : 'A new project'}</h2>
      <div className="resume-meta" aria-label="Saved project summary">
        <span><i className="resume-stage-mark" /><strong>{coursePartForScale(project).label} · {SCALES[project.activeScale].label}</strong></span>
        <span>Stage · {STAGES[project.stage].short}</span>
        <span><Icon name="history" />{memoCount} {memoCount === 1 ? 'memo' : 'memos'}</span>
      </div>
      {saveState.status === 'error' && <button type="button" className="recovery-notice" onClick={onRecovery}><strong>Local recovery needs attention</strong><span>{saveState.message}</span></button>}
      <div className="resume-actions">
        <button type="button" className="button access-primary" onClick={hasSavedProject ? onResume : onStart}>{hasSavedProject ? 'Continue' : 'Start'}</button>
        {hasSavedProject && <button type="button" className="resume-secondary" onClick={onStart}>Start another project</button>}
      </div>
      <div className="access-session-line"><button type="button" onClick={onEndAccess}>End class access</button></div>
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
    return `- **${node.label}** — ${node.type}; ${node.scale}; evidence: ${node.evidence || 'needs evidence'}${annotations ? `; ${annotations}` : ''}`;
  });
  const edgeLines = project.graph.edges.map((edge) => `- ${edge.sourceLabel} **${edge.verb}** ${edge.targetLabel} — evidence: ${edge.evidence || 'needs evidence'}${edge.annotation?.text ? `; annotation: ${edge.annotation.text}` : ''}`);
  const redactionLines = project.portableExport?.redactions?.map((entry) => `- ${entry.path}: ${entry.reason}`).join('\n') || '- None';
  return `# ${project.title}\n\n${project.inquiry ? `${project.inquiry}\n\n` : ''}## Memo\n\n${project.submission.text || 'Not yet written'}\n\n## Map annotation\n\n${project.mapAnnotation?.text || 'Not yet written'}\n\n## Nodes\n\n${nodeLines.join('\n') || '- None added'}\n\n## Relationships\n\n${edgeLines.join('\n') || '- None added'}\n\n## Reflection\n\n${project.reflection || 'Not yet written'}\n\n## Items needing evidence\n\n${project.candidates.edges.filter((edge) => edge.status === 'research lead').map((edge) => `- ${edge.sourceLabel} ${edge.verb} ${edge.targetLabel}`).join('\n') || '- None recorded'}\n\n## Export redactions\n\n${redactionLines}\n`;
}

export function graphCsv(project) {
  const inert = (value) => {
    const text = String(value ?? '');
    return /^(?:[\t\r\n]|[ \t\r\n]*[=+\-@])/.test(text) ? `'${text}` : text;
  };
  const quote = (value) => `"${inert(value).replaceAll('"', '""')}"`;
  const rows = [['record_type', 'id', 'label_or_from', 'type_or_verb', 'target', 'scale', 'evidence', 'annotation', 'evidence_annotation']];
  project.graph.nodes.forEach((node) => rows.push(['node', node.id, node.label, node.type, '', node.scale, node.evidence, node.annotations?.analytical?.text || '', node.annotations?.evidence?.text || '']));
  project.graph.edges.forEach((edge) => rows.push(['edge', edge.id, edge.sourceLabel, edge.verb, edge.targetLabel, edge.scale, edge.evidence, edge.annotation?.text || '', '']));
  rows.push(['map', project.mapAnnotation?.id || 'map', project.title, '', '', '', '', project.mapAnnotation?.text || '', '']);
  return rows.map((row) => row.map(quote).join(',')).join('\n');
}

function ScaleChooser({ project, update }) {
  const selectScale = (scale) => update((draft) => {
    draft.activeScale = scale;
    if (!draft.releasedScales.includes(scale)) draft.releasedScales.push(scale);
    invalidatePreflight(draft);
  }, 'scale.selected', SCALES[scale].label);
  return (
    <Field label="Scale" className="scale-chooser">
      <select value={project.activeScale} onChange={(event) => selectScale(event.target.value)}>
        {coursePartsForProject(project).map((part) => <optgroup key={part.id} label={part.label}>
          {part.scaleIds.map((scale) => <option key={scale} value={scale}>{SCALES[scale].label}</option>)}
        </optgroup>)}
      </select>
    </Field>
  );
}

async function readMemoFile(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    if (result.value.length > MAX_MEMO_CHARACTERS) throw new Error('The extracted DOCX text is too large. Use an excerpt of 500,000 characters or fewer.');
    return { text: result.value, notice: result.messages.length ? 'DOCX imported with conversion notices; compare against the original.' : 'DOCX text imported.' };
  }
  if (['txt', 'md', 'html', 'htm', 'json'].includes(extension)) {
    const raw = await file.text();
    if (extension === 'html' || extension === 'htm') {
      const text = new DOMParser().parseFromString(raw, 'text/html').body.textContent || '';
      if (text.length > MAX_MEMO_CHARACTERS) throw new Error('The extracted HTML text is too large. Use an excerpt of 500,000 characters or fewer.');
      return { text, notice: 'HTML text imported.' };
    }
    if (raw.length > MAX_MEMO_CHARACTERS) throw new Error('The memo is too large. Use 500,000 characters or fewer.');
    return { text: raw, notice: `${extension.toUpperCase()} memo imported.` };
  }
  if (extension === 'pdf') return { text: '', notice: 'This PDF needs text extraction or OCR. Paste the memo text below.' };
  throw new Error('You can import DOCX, TXT, MD, HTML, or JSON files. For a PDF, paste text that can be read and selected.');
}

function IntakeStage({ project, update, toast }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [fileNotice, setFileNotice] = useState('');
  const setSubmission = (field, value) => update((draft) => { invalidateSubmissionDerived(draft, field, value); });
  const setProjectField = (field, value) => update((draft) => {
    draft[field] = value;
    invalidatePreflight(draft);
  });
  const onFile = async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      if (file.name.length > FILE_NAME_LIMIT) throw new Error(`Choose a memo whose file name is ${FILE_NAME_LIMIT} characters or fewer.`);
      if (file.size > MAX_MEMO_BYTES) throw new Error('Choose a file smaller than 5 MB, or paste a shorter memo.');
      const result = await readMemoFile(file);
      update((draft) => {
        invalidateSubmissionDerived(draft, 'text', result.text || draft.submission.text);
        draft.submission.title = draft.submission.title || file.name;
        draft.submission.location = `Local file: ${file.name}`;
        draft.submission.fileName = file.name;
        draft.submission.fileSize = file.size;
      }, 'memo.imported', file.name);
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
    <div className="wide stage-enter intake-stage">
      <p className="eyebrow">Start here</p>
      <h1>Add your memo</h1>
      <p className="lede lede--compact">Choose a scale, then upload your memo or paste it below.</p>
      <ScaleChooser project={project} update={update} />
      <div className="project-context-fields">
        <Field label="Map title (optional)"><input maxLength={CONFIG_TEXT_LIMIT} value={project.title} onChange={(event) => setProjectField('title', event.target.value)} /></Field>
      </div>
      <div className="intake-grid">
        <div>
          <label className="upload-zone">
            <input type="file" accept=".docx,.txt,.md,.html,.htm,.json,.pdf" onChange={onFile} />
            <Icon name="upload" size={26} />
            <strong>{project.submission.fileName || 'Upload a memo'}</strong>
            <span>DOCX, TXT, MD, HTML, JSON, or PDF</span>
          </label>
          {fileNotice && <p className="privacy-note" role="status">{fileNotice}</p>}
          <Field label="Memo text" hint={`${project.submission.text.trim().split(/\s+/).filter(Boolean).length.toLocaleString()} words · Aim for 500–600 words.`}>
            <textarea className="memo-text" maxLength="500000" value={project.submission.text} onChange={(event) => setSubmission('text', event.target.value)} rows="15" />
          </Field>
        </div>
        <aside className="memo-panel">
          <button type="button" className="disclosure-button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>
            <span><strong>Privacy</strong><small>Open only if the memo includes private information</small></span><span aria-hidden="true">{detailsOpen ? '−' : '+'}</span>
          </button>
          {detailsOpen && <div className="memo-fields">
            <label className="check-row"><input type="checkbox" checked={project.submission.sensitive} onChange={(event) => setSubmission('sensitive', event.target.checked)} /><span><strong>This memo includes private or identifying information</strong><small>Mark this before sharing or exporting.</small></span></label>
            {project.submission.sensitive && <label className="check-row"><input type="checkbox" checked={project.submission.consent} onChange={(event) => setSubmission('consent', event.target.checked)} /><span><strong>Ready to share</strong><small>Permission is recorded or identifying details were removed.</small></span></label>}
          </div>}
        </aside>
      </div>
    </div>
  );
}

function MemoDrawer({ project, update, hint }) {
  const words = project.submission.text.trim().split(/\s+/).filter(Boolean).length;
  return <details className="memo-drawer">
    <summary>
      <span className="memo-drawer__title"><strong>Your memo</strong><small>{words.toLocaleString()} {words === 1 ? 'word' : 'words'} · open to read or edit</small></span>
      <span className="memo-drawer__mark" aria-hidden="true" />
    </summary>
    <Field label="Memo text" hint={hint || 'Edits stay in your project and never remove existing work. Refresh the guidance whenever you want the model to reread the memo.'}>
      <textarea className="memo-text" maxLength="500000" rows="12" value={project.submission.text} onChange={(event) => update((draft) => { invalidateSubmissionDerived(draft, 'text', event.target.value); })} />
    </Field>
  </details>;
}

function suggestionRuntimeDescription(runtime, persistence) {
  return 'Generate guidance when you are ready to review the memo.';
}

function suggestionRuntimeLabel(runtime) {
  return 'Course guidance';
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
        <p className="privacy-note">Edit the guidance used for this project.</p>
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
        <pre>{shared ? 'Course settings are available.' : config.fixedPrompt}</pre>
        <dl className="config-meta"><div><dt>Project revision</dt><dd>{config.revision}</dd></div><div><dt>Project fingerprint</dt><dd>{config.fingerprint}</dd></div><div><dt>Shared revision</dt><dd>{shared?.revision || 'Local fallback'}</dd></div><div><dt>Shared fingerprint</dt><dd>{shared?.fingerprint || 'Server unavailable'}</dd></div><div><dt>Provider seam</dt><dd>{config.provider}</dd></div></dl>
        {preview && <div className="effective-prompt"><strong>Project guidance</strong><p>{draft.customInstructions}</p></div>}
        {config.history?.length > 0 && <details><summary>Revision history ({config.history.length})</summary><ol className="history-list">{[...config.history].reverse().map((entry) => <li key={`${entry.revision}-${entry.at}`}><strong>v{entry.revision}</strong> {entry.changeNote}<small>{entry.fingerprint}</small></li>)}</ol></details>}
      </aside>
    </div>
  </div>;
}

function ReviewMemoStage({ project, update, reviewBusy, onGenerate, onContinue }) {
  const review = project.preflight?.memoReview;
  const stale = Boolean(project.preflight && project.preflight.sourceFingerprint !== memoFingerprint(project.submission));
  const coursePart = coursePartForScale(project);
  const busy = reviewBusy === 'evaluating';
  const hasMemo = Boolean(project.submission.text.trim());
  return <div className="wide stage-enter">
    <p className="eyebrow">{coursePart.label} · {SCALES[project.activeScale].label}</p>
    <h1>Review your memo</h1>
    <p className="lede">Check what your memo supports, note what is uncertain, and decide what to ask your instructor.</p>
    <MemoDrawer project={project} update={update} />
    {!hasMemo && <p className="empty-message">Add memo text above to begin. The model reads the memo and surfaces the nodes and connections already evident in it.</p>}
    {busy && !review && <p className="review-progress" role="status">The model is reading your memo…</p>}
    {review && <>
      <section className={`readiness-banner ${review.readiness.ready && !stale ? 'is-ready' : ''}`} aria-label="Where your memo stands">
        <div className="readiness-banner__text">
          {review.readiness.note && <p>{review.readiness.note}</p>}
          {stale && <p className="readiness-banner__stale" role="status">Your memo has changed since this guidance was generated. Refresh to have the model reread it — your edits are never lost.</p>}
        </div>
        <div className="button-row">
          <button type="button" className="button button--secondary" disabled={busy || !hasMemo} onClick={onGenerate}>{busy ? 'Rereading your memo…' : 'Refresh guidance'}</button>
          <button type="button" className="button" onClick={onContinue}>Choose nodes and connections<Icon name="arrow" /></button>
        </div>
      </section>
      <div className="preflight-grid">
        <section className="memo-guidance" aria-labelledby="memo-guidance-title">
          <h2 id="memo-guidance-title">What the model noticed</h2>
          {review.guidance.length ? review.guidance.map((item, index) => (
            <article className="criterion-row" key={stableId('guidance', `${index}:${item.point}`)}>
              <div>
                <p>{item.point}</p>
                {item.evidenceExcerpt && <blockquote><span className="sr-only">Passage from your memo. </span>{item.evidenceExcerpt}</blockquote>}
              </div>
            </article>
          )) : <p className="empty-message">The model returned no guidance this time. Refresh to try again.</p>}
        </section>
        <aside className="memo-scaffold" aria-labelledby="memo-scaffold-title">
          <p className="eyebrow">Taking shape</p>
          <h2 id="memo-scaffold-title">Nodes and connections evident in your memo</h2>
          {review.nodes.length ? <div className="connection-node-list" aria-label="Nodes evident in the memo">{review.nodes.map((node) => <span key={node.label}>{node.label}</span>)}</div> : <p className="empty-message">No elements surfaced yet. Expand the memo above and refresh, or add elements yourself at the next stage.</p>}
          {review.connections.length > 0 && <ul className="memo-scaffold__connections">{review.connections.map((connection, index) => (
            <li key={stableId('scaffold-edge', `${index}:${connection.source}:${connection.verb}:${connection.target}`)}>
              <span className="memo-scaffold__claim"><strong>{connection.source}</strong> <em>{connection.verb}</em> <strong>{connection.target}</strong></span>
              {connection.rationale && <small>{connection.rationale}</small>}
            </li>
          ))}</ul>}
          {review.example && <div className="memo-scaffold__example"><p className="eyebrow">Worked example</p><p>{review.example}</p></div>}
          <p className="privacy-note">These are suggestions grounded in your memo. At the next stage you decide what to keep, edit, or remove — nothing is added for you.</p>
        </aside>
      </div>
    </>}
    {!review && !busy && hasMemo && <div className="button-row"><button className="button" type="button" onClick={onGenerate}>Generate guidance</button></div>}
  </div>;
}

const CANDIDATE_STEPS = ['nodes', 'edges', 'suggest'];

function CandidateStage({ project, update, toast, prompt, onPromptChange, busy, suggestions, onSuggest, onEdit, onDecision, onRefreshCandidates, refreshBusy }) {
  const [step, setStep] = useState('nodes');
  const setStatus = (kind, id, status) => {
    const current = project.candidates[kind].find((candidate) => candidate.id === id);
    if (!current) return;
    if (status === 'research lead' && !project.instructor.allowResearchLeads) return toast('Items needing more evidence are turned off for this project.', 'error');
    if ((status === 'confirmed' || status === 'research lead') && project.instructor.evidenceRequired && !current.evidence) return toast('Add evidence before moving this item forward.', 'error');
    update((draft) => {
      const item = draft.candidates[kind].find((candidate) => candidate.id === id);
      item.status = status;
      item.claimState = status === 'research lead' ? 'research lead' : status === 'confirmed' ? 'student interpretation' : item.claimState;
    }, `candidate.${status}`, id);
  };
  const edit = (kind, id, field, value) => update((draft) => {
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
  const keepAllRemaining = (kind) => update((draft) => {
    draft.candidates[kind].forEach((item) => {
      if (item.status !== 'pending') return;
      if (draft.instructor.evidenceRequired && !item.evidence) return;
      item.status = 'confirmed';
      item.claimState = 'student interpretation';
    });
  }, 'candidates.batch-confirmed', kind === 'nodes' ? 'Remaining nodes kept' : 'Remaining connections kept');
  const counts = Object.fromEntries(['nodes', 'edges'].map((kind) => {
    const items = project.candidates[kind];
    return [kind, {
      total: items.length,
      decided: items.filter((item) => item.status !== 'pending').length,
      remaining: items.filter((item) => item.status === 'pending').length,
    }];
  }));
  const stepCopy = {
    nodes: {
      tab: `Nodes · ${counts.nodes.total}`,
      title: 'Choose your nodes',
      lede: 'These nodes come from your memo. Keep, rename, or remove each one — connections come next, and nothing joins the map until you decide.',
    },
    edges: {
      tab: `Connections · ${counts.edges.total}`,
      title: 'Confirm how they connect',
      lede: 'Each connection links two kept nodes with wording from your memo. Edit the wording so it says what you mean, keep what is right, and remove what is not — this is where you describe the connections.',
    },
    suggest: {
      tab: 'More connections',
      title: 'Ask for more connections',
      lede: 'Optional. Your kept connections already describe the map. If something still feels missing, ask for suggestions — with nothing written, the model reads your memo directly, and nothing joins the map until you accept it.',
    },
  };
  const candidateRows = (kind) => project.candidates[kind].map((item, index) => <article className={`candidate-row candidate-row--${item.status.replaceAll(' ', '-')}`} key={item.id}>
    <div className="candidate-row__count">{String(index + 1).padStart(2, '0')}</div>
    <div className="candidate-row__main">
      {kind === 'nodes' ? <div className="candidate-expression"><input aria-label="Node label" maxLength={NODE_LABEL_LIMIT} value={item.label} onChange={(event) => edit(kind, item.id, 'label', event.target.value)} /><span>is a</span><select aria-label="Node type" value={item.type} onChange={(event) => edit(kind, item.id, 'type', event.target.value)}>{NODE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></div> : <div className="candidate-expression candidate-expression--edge"><strong>{item.sourceLabel}</strong><input aria-label="Relationship verb" maxLength={RELATIONSHIP_VERB_LIMIT} value={item.verb} onChange={(event) => edit(kind, item.id, 'verb', event.target.value)} /><strong>{item.targetLabel}</strong></div>}
      <p><span className="evidence-chip">{item.evidence || 'Evidence unresolved'}</span> · {SCALES[item.scale]?.label || item.scale}</p>
      <details className="candidate-note">
        <summary>{item.notes ? 'Note added' : 'Add a note'}</summary>
        <Field label="Reviewer note"><input maxLength={PROJECT_LIMITS.noteText} value={item.notes || ''} placeholder="Optional reason or condition" onChange={(event) => edit(kind, item.id, 'notes', event.target.value)} /></Field>
      </details>
    </div>
    <div className="candidate-actions" aria-label={`Decision for ${kind === 'nodes' ? item.label : `${item.sourceLabel} ${item.verb} ${item.targetLabel}`}`}>
      <button className={item.status === 'confirmed' ? 'is-active' : ''} type="button" onClick={() => setStatus(kind, item.id, 'confirmed')}>Keep</button>
      {project.instructor.allowResearchLeads && <button className={item.status === 'research lead' ? 'is-active' : ''} type="button" onClick={() => setStatus(kind, item.id, 'research lead')}>Needs more evidence</button>}
      <button className={item.status === 'rejected' ? 'is-active' : ''} type="button" onClick={() => setStatus(kind, item.id, 'rejected')}>Remove</button>
    </div>
  </article>);
  const decisionStep = step === 'nodes' || step === 'edges';
  return <div className="wide stage-enter">
    <p className="eyebrow">Choose what to map · step {CANDIDATE_STEPS.indexOf(step) + 1} of {CANDIDATE_STEPS.length}</p>
    <div className="stage-title-row"><div><h1>{stepCopy[step].title}</h1><p className="lede">{stepCopy[step].lede}</p></div></div>
    <div className="subnav candidate-steps" role="tablist" aria-label="Choose what to map">
      {CANDIDATE_STEPS.map((id) => <button key={id} id={`candidate-tab-${id}`} role="tab" aria-controls="candidate-panel" aria-selected={step === id} tabIndex={step === id ? 0 : -1} data-composite-value={id} className={step === id ? 'is-active' : ''} onKeyDown={(event) => handleCompositeKey(event, CANDIDATE_STEPS, step, setStep)} onClick={() => setStep(id)}>{stepCopy[id].tab}</button>)}
    </div>
    {decisionStep && <>
      <MemoDrawer project={project} update={update} hint="Edit the memo here whenever you want, then use “Reread memo” to refresh these suggestions. Your decisions on kept items are preserved." />
      <div className="button-row candidate-refresh-row">
        <button className="button button--secondary" type="button" disabled={Boolean(refreshBusy)} onClick={onRefreshCandidates}>{refreshBusy ? 'Rereading memo…' : 'Reread memo for new suggestions'}</button>
      </div>
    </>}
    <div id="candidate-panel" role="tabpanel" aria-labelledby={`candidate-tab-${step}`}>
      {decisionStep && <>
        {counts[step].total > 0 && <p className="candidate-progress" role="status">{counts[step].decided} of {counts[step].total} decided</p>}
        <div className="candidate-list">
          {candidateRows(step)}
          {!counts[step].total && <p className="empty-message">{step === 'nodes'
            ? 'No nodes yet. Open your memo above to add detail and choose “Reread memo,” or add elements yourself on the map — nothing blocks you from continuing.'
            : 'No connections came from your memo yet. Continue to ask the model for suggestions, or add relationships yourself on the map.'}</p>}
        </div>
        <div className="button-row candidate-step-actions">
          {counts[step].remaining > 0 && <button className="button button--secondary" type="button" onClick={() => keepAllRemaining(step)}>Keep all {counts[step].remaining} remaining</button>}
          <button className="button" type="button" onClick={() => setStep(step === 'nodes' ? 'edges' : 'suggest')}>{step === 'nodes' ? 'Continue to connections' : 'Continue'}<Icon name="arrow" /></button>
        </div>
      </>}
      {step === 'suggest' && <ConnectionStage project={project} prompt={prompt} onPromptChange={onPromptChange} busy={busy} suggestions={suggestions} onSuggest={onSuggest} onEdit={onEdit} onDecision={onDecision} />}
    </div>
  </div>;
}

const GRAPH_WIDTH = 840;
const GRAPH_HEIGHT = 540;
// The visible window stays 840x540; nodes may live and move in a larger world
// so maps with many cards are not forced to overlap inside one screen.
const WORLD_WIDTH = 2520;
const WORLD_HEIGHT = 1620;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function stateClass(value) {
  return value === 'retired' ? 'retired' : 'current';
}

function splitMapLabel(value, maximum = 20) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return ['Untitled'];
  const lines = [];
  let current = '';
  const addPiece = (piece) => {
    const candidate = current ? `${current} ${piece}` : piece;
    if (candidate.length <= maximum) {
      current = candidate;
      return;
    }
    if (current) lines.push(current);
    current = piece;
  };
  words.forEach((word) => {
    if (word.length <= maximum) {
      addPiece(word);
      return;
    }
    if (current) {
      lines.push(current);
      current = '';
    }
    for (let start = 0; start < word.length; start += maximum) {
      const piece = word.slice(start, start + maximum);
      if (piece.length === maximum || start + maximum < word.length) lines.push(piece);
      else current = piece;
    }
  });
  if (current) lines.push(current);
  return lines;
}

function mapNodeGeometry(label, phoneLayout = false) {
  const lines = splitMapLabel(label, phoneLayout ? 18 : 28);
  const lineHeight = phoneLayout ? 24 : 15;
  const cardWidth = phoneLayout ? 272 : 224;
  const minimumHeight = phoneLayout ? 82 : 72;
  const cardHeight = Math.max(minimumHeight, lines.length * lineHeight + (phoneLayout ? 28 : 24));
  return {
    lines,
    lineHeight,
    cardWidth,
    cardHeight,
    cardX: -(cardWidth / 2),
    cardY: -(cardHeight / 2),
    cardRadius: phoneLayout ? 13 : 8,
    labelStartY: -((lines.length - 1) * lineHeight) / 2 + (phoneLayout ? 8 : 4),
    ringX: -(cardWidth / 2) - (phoneLayout ? 10 : 6),
    ringY: -(cardHeight / 2) - (phoneLayout ? 8 : 6),
    ringWidth: cardWidth + (phoneLayout ? 20 : 12),
    ringHeight: cardHeight + (phoneLayout ? 16 : 12),
    ringRadius: phoneLayout ? 16 : 10,
  };
}

function mapEdgeLabelGeometry(label, phoneLayout = false) {
  const lines = splitMapLabel(label, phoneLayout ? 18 : 24);
  const lineHeight = phoneLayout ? 28 : 15;
  const longestLine = Math.max(...lines.map((line) => line.length));
  const width = clamp(
    longestLine * (phoneLayout ? 13 : 6.5) + (phoneLayout ? 30 : 24),
    phoneLayout ? 110 : 64,
    phoneLayout ? 270 : 200,
  );
  const height = Math.max(phoneLayout ? 44 : 24, lines.length * lineHeight + (phoneLayout ? 32 : 10));
  return {
    lines,
    lineHeight,
    width,
    height,
    startY: -((lines.length - 1) * lineHeight) / 2 + (phoneLayout ? 8 : 4),
  };
}

function arrangedMapPositions(nodes, groupByScale, maximumColumns = 5, phoneLayout = false) {
  if (!nodes.length) return new Map();
  const sortNodes = (items) => [...items].sort((a, b) => a.y - b.y || a.label.localeCompare(b.label));
  const orderedNodes = groupByScale
    ? ['micro', 'meso', 'macro', 'integration'].flatMap((scale) => sortNodes(nodes.filter((node) => node.scale === scale)))
    : sortNodes(nodes);
  const positions = new Map();
  const columns = Math.max(1, Math.min(maximumColumns, Math.ceil(Math.sqrt(orderedNodes.length)), orderedNodes.length));
  // Column pitch is card width plus breathing room, never a division of the
  // window: large maps spread into the world and the viewport zooms to fit.
  const columnPitch = phoneLayout ? 308 : 268;
  const rows = Math.ceil(orderedNodes.length / columns);
  const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(...orderedNodes
    .slice(row * columns, (row + 1) * columns)
    .map((node) => mapNodeGeometry(node.label, phoneLayout).cardHeight)));
  const verticalGap = phoneLayout ? 30 : 26;
  const contentHeight = rowHeights.reduce((total, height) => total + height, 0) + verticalGap * Math.max(0, rows - 1);
  const contentWidth = columns * columnPitch;
  const startX = Math.max(24, (GRAPH_WIDTH - contentWidth) / 2);
  let cursorY = Math.max(24, (GRAPH_HEIGHT - contentHeight) / 2);
  rowHeights.forEach((rowHeight, row) => {
    const centerY = cursorY + rowHeight / 2;
    orderedNodes.slice(row * columns, (row + 1) * columns).forEach((node, column) => {
      positions.set(node.id, {
        x: Math.round(startX + columnPitch * (column + 0.5)),
        y: Math.round(centerY),
      });
    });
    cursorY += rowHeight + verticalGap;
  });
  return positions;
}

function mapNodesOverlap(nodes, phoneLayout = false) {
  for (let first = 0; first < nodes.length; first += 1) {
    for (let second = first + 1; second < nodes.length; second += 1) {
      const firstGeometry = mapNodeGeometry(nodes[first].label, phoneLayout);
      const secondGeometry = mapNodeGeometry(nodes[second].label, phoneLayout);
      if (
        Math.abs(nodes[first].x - nodes[second].x) < (firstGeometry.cardWidth + secondGeometry.cardWidth) / 2 + 12
        && Math.abs(nodes[first].y - nodes[second].y) < (firstGeometry.cardHeight + secondGeometry.cardHeight) / 2 + 12
      ) return true;
    }
  }
  return false;
}

function mapNeedsReadableOverview(nodes, events = [], phoneLayout = false) {
  if (nodes.length < 12 || new Set(nodes.map((node) => node.scale)).size < 2) return false;
  const memoBatches = new Set(nodes.map((node) => node.sourceFingerprint).filter(Boolean)).size;
  const committedCycles = events.filter((event) => event.action === 'graph.committed').length;
  if (memoBatches < 2 && committedCycles < 2) return false;
  let overlaps = 0;
  for (let first = 0; first < nodes.length; first += 1) {
    for (let second = first + 1; second < nodes.length; second += 1) {
      const firstGeometry = mapNodeGeometry(nodes[first].label, phoneLayout);
      const secondGeometry = mapNodeGeometry(nodes[second].label, phoneLayout);
      if (
        Math.abs(nodes[first].x - nodes[second].x) < (firstGeometry.cardWidth + secondGeometry.cardWidth) / 2 + 12
        && Math.abs(nodes[first].y - nodes[second].y) < (firstGeometry.cardHeight + secondGeometry.cardHeight) / 2 + 12
      ) {
        overlaps += 1;
        if (overlaps >= 3) return true;
      }
    }
  }
  return false;
}

function ConnectionPreview({ nodes, edges, suggestions }) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const shownEdges = [
    ...edges.filter((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired'),
    ...suggestions.filter((edge) => edge.status !== 'rejected'),
  ].filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target));
  const shownEdgeLayouts = shownEdges.map((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    const proposed = suggestions.some((suggestion) => suggestion.id === edge.id);
    return {
      edge,
      source,
      target,
      proposed,
      midX: (source.x + target.x) / 2,
      midY: (source.y + target.y) / 2,
    };
  });
  const nodeBounds = nodes.map((node) => {
    const geometry = mapNodeGeometry(node.label);
    return {
      left: node.x + geometry.cardX,
      right: node.x + geometry.cardX + geometry.cardWidth,
      top: node.y + geometry.cardY,
      bottom: node.y + geometry.cardY + geometry.cardHeight,
    };
  });
  const previewViewBox = nodeBounds.length
    ? (() => {
      const minX = Math.min(...nodeBounds.map(({ left }) => left)) - 24;
      const minY = Math.min(...nodeBounds.map(({ top }) => top)) - 24;
      const width = Math.max(GRAPH_WIDTH, Math.max(...nodeBounds.map(({ right }) => right)) + 24 - minX);
      const height = Math.max(GRAPH_HEIGHT, Math.max(...nodeBounds.map(({ bottom }) => bottom)) + 24 - minY);
      return `${minX} ${minY} ${width} ${height}`;
    })()
    : `0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`;
  return <div className="connection-preview" role="img" aria-label={`Preview with ${nodes.length} nodes and ${shownEdges.length} connections`}>
    <svg viewBox={previewViewBox} aria-hidden="true" focusable="false">
      <defs><marker id="connection-preview-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" /></marker></defs>
      <g className="connection-preview__lines">{shownEdgeLayouts.map(({ edge, source, target, proposed }) => <g key={edge.id} className={`connection-preview__edge ${proposed ? 'is-proposed' : 'is-existing'} ${edge.status === 'confirmed' ? 'is-accepted' : ''}`}>
        <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} markerEnd="url(#connection-preview-arrow)" />
      </g>)}</g>
      <g className="connection-preview__labels">{shownEdgeLayouts.map(({ edge, proposed, midX, midY }) => {
        const geometry = mapEdgeLabelGeometry(edge.verb);
        const labelY = midY - 10;
        return <g key={edge.id} data-full-label={edge.verb} className={`connection-preview__label ${proposed ? 'is-proposed' : 'is-existing'} ${edge.status === 'confirmed' ? 'is-accepted' : ''}`}>
          <rect x={midX - (geometry.width / 2)} y={labelY - (geometry.height / 2)} width={geometry.width} height={geometry.height} rx="4" />
          <text x={midX}>{geometry.lines.map((line, lineIndex) => <tspan key={`${edge.id}-preview-line-${lineIndex}`} x={midX} y={labelY + geometry.startY + lineIndex * geometry.lineHeight}>{line}</tspan>)}</text>
        </g>;
      })}</g>
      {nodes.map((node) => {
        const geometry = mapNodeGeometry(node.label);
        return <g key={node.id} data-full-label={node.label} className="connection-preview__node" transform={`translate(${node.x} ${node.y})`}>
          <rect x={geometry.cardX} y={geometry.cardY} width={geometry.cardWidth} height={geometry.cardHeight} rx="12" />
          <text textAnchor="middle">{geometry.lines.map((line, lineIndex) => <tspan key={`${node.id}-preview-line-${lineIndex}`} x="0" y={geometry.labelStartY + lineIndex * geometry.lineHeight}>{line}</tspan>)}</text>
        </g>;
      })}
    </svg>
  </div>;
}

function ConnectionStage({ project, prompt, onPromptChange, busy, suggestions, onSuggest, onEdit, onDecision }) {
  const nodes = nodesForConnectionPrompt(project);
  const nodeIds = new Set(nodes.map((node) => node.id));
  // Connections kept at the previous step count as existing here, so the
  // preview stays continuous with the student's decisions before "Open map."
  const keptCandidateEdges = project.candidates.edges
    .filter((edge) => (edge.status === 'confirmed' || edge.status === 'research lead') && nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const edges = [...new Map([...project.graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)), ...keptCandidateEdges]
    .map((edge) => [edge.id, edge])).values()];
  const accepted = suggestions.filter((suggestion) => suggestion.status === 'confirmed').length;
  return <section className="connection-stage" aria-label="More connection suggestions">
    <p className="eyebrow">{nodes.length} kept nodes · {edges.filter((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired').length} existing connections</p>
    <div className="connection-stage__layout">
      <section className="connection-prompt-panel">
        {nodes.length < 2 && <p className="teacher-message" role="status">Keep at least two nodes and the model can suggest connections between them.</p>}
        <button type="button" className="button" disabled={busy || nodes.length < 2} onClick={onSuggest}>{busy ? 'Suggesting connections…' : suggestions.length ? 'Suggest more connections' : 'Suggest connections'}</button>
        <details className="connection-hint">
          <summary>Steer the suggestions (optional)</summary>
          <Field label="How do these nodes connect?" hint="Only needed if you want to point the model somewhere specific — otherwise it reads your memo.">
            <textarea rows="6" maxLength="4000" value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder="For example: Families ask schools for evaluations, while delays make it harder to reach services." />
          </Field>
        </details>
        <div className="connection-node-list" aria-label="Nodes included in this request">{nodes.map((node) => <span key={node.id}>{node.label}</span>)}</div>
      </section>
      <section className="connection-preview-panel" aria-labelledby="connection-preview-title">
        <div className="connection-preview-panel__title"><div><p className="eyebrow">Preview</p><h2 id="connection-preview-title">Connections taking shape</h2></div>{suggestions.length > 0 && <strong>{accepted} accepted</strong>}</div>
        <ConnectionPreview nodes={nodes} edges={edges} suggestions={suggestions} />
      </section>
    </div>
    <section className="connection-suggestions" aria-labelledby="connection-suggestions-title">
      <div className="stage-title-row"><div><p className="eyebrow">Review</p><h2 id="connection-suggestions-title">Suggested connections</h2></div></div>
      {suggestions.map((item, index) => <article className={`candidate-row candidate-row--${item.status.replaceAll(' ', '-')}`} key={item.id}>
        <div className="candidate-row__count">{String(index + 1).padStart(2, '0')}</div>
        <div className="candidate-row__main">
          <div className="candidate-expression candidate-expression--edge connection-expression">
            <select aria-label={`Starting node for suggestion ${index + 1}`} value={item.source} onChange={(event) => onEdit(item.id, 'source', event.target.value)}>{nodes.filter((node) => node.id !== item.target).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select>
            <input aria-label={`Connection for suggestion ${index + 1}`} maxLength={RELATIONSHIP_VERB_LIMIT} value={item.verb} onChange={(event) => onEdit(item.id, 'verb', event.target.value)} />
            <select aria-label={`Ending node for suggestion ${index + 1}`} value={item.target} onChange={(event) => onEdit(item.id, 'target', event.target.value)}>{nodes.filter((node) => node.id !== item.source).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select>
          </div>
          <p>{item.rationale}</p>
        </div>
        <div className="candidate-actions" aria-label={`Decision for ${item.sourceLabel} ${item.verb} ${item.targetLabel}`}>
          <button className={item.status === 'confirmed' ? 'is-active' : ''} type="button" onClick={() => onDecision(item.id, 'confirmed')}>Accept</button>
          <button className={item.status === 'rejected' ? 'is-active' : ''} type="button" onClick={() => onDecision(item.id, 'rejected')}>Reject</button>
        </div>
      </article>)}
      {!suggestions.length && <p className="empty-message">Choose “Suggest connections” to see proposals here. Accepted connections appear in the preview and join the map when you continue.</p>}
    </section>
  </section>;
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
  const hintId = hint ? stableId('annotation-hint', annotationId) : null;
  const failed = persistenceStatus === 'error' || persistenceStatus === 'validation';
  const queued = pending;
  const statusText = failed ? persistenceMessage : queued ? 'Saving…' : '';
  const statusId = statusText ? stableId('annotation-status', annotationId) : null;
  return <div className="field annotation-field">
    <label className="field__label" htmlFor={fieldId}>{label}</label>
    <textarea id={fieldId} rows="4" maxLength={PROJECT_LIMITS.annotationText} value={draft} onChange={change} onBlur={() => flush()} aria-describedby={[statusId, hintId].filter(Boolean).join(' ')} placeholder={placeholder} />
    {statusText && <span id={statusId} className={`annotation-save annotation-save--${failed ? 'error' : 'queued'}`} role="status">{statusText}</span>}
    {hint && <span id={hintId} className="field__hint">{hint}</span>}
  </div>;
}

function GraphCanvas({ nodes, edges, selection, onSelect, onMoveNode, viewport, phoneLayout, mapLabel, panMode, onViewportChange, onAnnounce }) {
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
    const geometry = mapNodeGeometry(node.label, phoneLayout);
    interactionRef.current = {
      kind: 'node', pointerId: event.pointerId, captureTarget: event.currentTarget,
      nodeId: node.id, startClientX: event.clientX, startClientY: event.clientY,
      startSvgX: start.x, startSvgY: start.y,
      originX: node.x, originY: node.y, latestX: node.x, latestY: node.y, moved: false,
      halfWidth: geometry.cardWidth / 2,
      halfHeight: geometry.cardHeight / 2,
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
      interaction.latestX = clamp(Math.round(interaction.originX + delta.x), interaction.halfWidth + 8, WORLD_WIDTH - interaction.halfWidth - 8);
      interaction.latestY = clamp(Math.round(interaction.originY + delta.y), interaction.halfHeight + 8, WORLD_HEIGHT - interaction.halfHeight - 8);
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
    const geometry = mapNodeGeometry(node.label, phoneLayout);
    const x = clamp(node.x + dx * step, geometry.cardWidth / 2 + 8, WORLD_WIDTH - geometry.cardWidth / 2 - 8);
    const y = clamp(node.y + dy * step, geometry.cardHeight / 2 + 8, WORLD_HEIGHT - geometry.cardHeight / 2 - 8);
    onSelect('node', node.id, false);
    onMoveNode(node.id, x, y, 'keyboard');
    onAnnounce(`${node.label} moved to x ${x}, y ${y}.`);
  };
  const graphViewBox = phoneLayout ? '0 -130 840 800' : `0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`;
  const nodeVisuals = new Map(nodes.map((node) => [node.id, {
    position: positions.get(node.id),
    geometry: mapNodeGeometry(node.label, phoneLayout),
  }]));
  const edgeVisuals = edges.map((edge) => {
    const source = nodeVisuals.get(edge.source);
    const target = nodeVisuals.get(edge.target);
    if (!source?.position || !target?.position) return null;
    const deltaX = target.position.x - source.position.x;
    const deltaY = target.position.y - source.position.y;
    const absoluteX = Math.max(.001, Math.abs(deltaX));
    const absoluteY = Math.max(.001, Math.abs(deltaY));
    const sourceFactor = Math.min(
      .45,
      (source.geometry.cardWidth / 2) / absoluteX,
      (source.geometry.cardHeight / 2) / absoluteY,
    );
    const targetFactor = Math.min(
      .45,
      ((target.geometry.cardWidth / 2) + (phoneLayout ? 16 : 10)) / absoluteX,
      ((target.geometry.cardHeight / 2) + (phoneLayout ? 8 : 5)) / absoluteY,
    );
    return {
      edge,
      x1: source.position.x + deltaX * sourceFactor,
      y1: source.position.y + deltaY * sourceFactor,
      x2: target.position.x - deltaX * targetFactor,
      y2: target.position.y - deltaY * targetFactor,
      midX: (source.position.x + target.position.x) / 2,
      midY: (source.position.y + target.position.y) / 2,
      selected: selection?.kind === 'edge' && selection.id === edge.id,
    };
  }).filter(Boolean);
  return <svg ref={svgRef} tabIndex="-1" className={`graph-canvas ${panMode ? 'is-panning' : ''}`} role="group" aria-label={`${mapLabel}. ${nodes.length} ${nodes.length === 1 ? 'node' : 'nodes'} and ${edges.length} ${edges.length === 1 ? 'connection' : 'connections'}. Choose a node for details. Arrow keys move a focused node by 8 pixels; Shift plus an arrow moves it by 24.`} viewBox={graphViewBox} onPointerDown={beginPan} onPointerMove={movePointer} onPointerUp={finishPointer} onPointerCancel={(event) => finishPointer(event, true)}>
    <title>Interactive systems map</title>
    <defs><marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 z" /></marker></defs>
    <g className="viewport-layer" transform={`translate(${shownViewport.panX} ${shownViewport.panY}) scale(${shownViewport.zoom})`}>
      <g className="edges">{edgeVisuals.map(({ edge, x1, y1, x2, y2, selected }) => <g key={edge.id} data-graph-id={edge.id} role="button" tabIndex="-1" aria-label={`${edge.sourceLabel} ${edge.verb} ${edge.targetLabel}, ${edge.scale} scale relationship`} className={`graph-edge graph-edge--${stateClass(edge.claimState)} ${edge.visualMuted ? 'is-muted' : ''} ${selected ? 'is-selected' : ''}`} onPointerDown={(event) => { event.stopPropagation(); onSelect('edge', edge.id, true); }}>
        <line className="edge-hit" x1={x1} y1={y1} x2={x2} y2={y2} />
        {selected && <line className="edge-selection-halo" x1={x1} y1={y1} x2={x2} y2={y2} />}
        <line className="edge-line" x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#arrowhead)" />
      </g>)}</g>
      <g className="edge-labels" aria-hidden="true">{edgeVisuals.filter(({ edge }) => edge.showLabel !== false).map(({ edge, midX, midY, selected }) => {
        const geometry = mapEdgeLabelGeometry(edge.verb, phoneLayout);
        return <g key={edge.id} data-edge-id={edge.id} data-full-label={edge.verb} className={`graph-edge-label ${selected ? 'is-selected' : ''}`}>
          <rect className="edge-label-bg" x={midX - (geometry.width / 2)} y={midY - (geometry.height / 2)} width={geometry.width} height={geometry.height} rx={phoneLayout ? 6 : 2} />
          <text className="edge-label" x={midX}>{geometry.lines.map((line, lineIndex) => <tspan key={`${edge.id}-line-${lineIndex}`} x={midX} y={midY + geometry.startY + lineIndex * geometry.lineHeight}>{line}</tspan>)}</text>
        </g>;
      })}</g>
      <g className="nodes">{nodes.map((node) => {
        const { position, geometry } = nodeVisuals.get(node.id);
        const selected = selection?.kind === 'node' && selection.id === node.id;
        const evidenceState = node.evidence ? 'evidence recorded' : 'evidence unresolved';
        return <g key={node.id} data-graph-id={node.id} data-full-label={node.label} role="button" tabIndex="0" aria-label={`${node.label}, ${node.type}, ${node.scale} scale, ${evidenceState}`} aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight" className={`graph-node graph-node--${node.scale} graph-node--${stateClass(node.claimState)} ${node.visualMuted ? 'is-muted' : ''} ${selected ? 'is-selected' : ''}`} transform={`translate(${position.x} ${position.y})`} onPointerDown={(event) => beginNode(event, node)} onKeyDown={(event) => keyboardNode(event, node)}>
          {selected && <rect className="node-selection-ring" x={geometry.ringX} y={geometry.ringY} width={geometry.ringWidth} height={geometry.ringHeight} rx={geometry.ringRadius} />}
          <rect className="node-card" x={geometry.cardX} y={geometry.cardY} width={geometry.cardWidth} height={geometry.cardHeight} rx={geometry.cardRadius} />
          <text className="node-label">{geometry.lines.map((line, lineIndex) => <tspan key={`${node.id}-line-${lineIndex}`} x="0" y={geometry.labelStartY + lineIndex * geometry.lineHeight}>{line}</tspan>)}</text>
        </g>;
      })}</g>
    </g>
  </svg>;
}

function sameGraphVisuals(previous, next) {
  if (previous.phoneLayout !== next.phoneLayout) return false;
  if (previous.mapLabel !== next.mapLabel) return false;
  if (previous.panMode !== next.panMode) return false;
  if (previous.interactionMode !== next.interactionMode) return false;
  if (previous.selection?.kind !== next.selection?.kind || previous.selection?.id !== next.selection?.id) return false;
  if (previous.viewport.panX !== next.viewport.panX || previous.viewport.panY !== next.viewport.panY || previous.viewport.zoom !== next.viewport.zoom) return false;
  if (previous.nodes.length !== next.nodes.length || previous.edges.length !== next.edges.length) return false;
  for (let index = 0; index < previous.nodes.length; index += 1) {
    const a = previous.nodes[index]; const b = next.nodes[index];
    if (a.id !== b.id || a.x !== b.x || a.y !== b.y || a.label !== b.label || a.type !== b.type || a.scale !== b.scale || a.claimState !== b.claimState || Boolean(a.evidence) !== Boolean(b.evidence) || a.visualMuted !== b.visualMuted) return false;
  }
  for (let index = 0; index < previous.edges.length; index += 1) {
    const a = previous.edges[index]; const b = next.edges[index];
    if (a.id !== b.id || a.source !== b.source || a.target !== b.target || a.verb !== b.verb || a.claimState !== b.claimState || a.sourceLabel !== b.sourceLabel || a.targetLabel !== b.targetLabel || a.showLabel !== b.showLabel || a.visualMuted !== b.visualMuted) return false;
  }
  if (previous.onMoveNode !== next.onMoveNode) return false;
  return true;
}

const MemoGraphCanvas = React.memo(GraphCanvas, sameGraphVisuals);

function MapLegend() {
  return <div className="legend-grid">
    <section><h3>Scale</h3><ul><li><i className="legend-symbol legend-symbol--micro" /><span>Micro</span></li><li><i className="legend-symbol legend-symbol--meso" /><span>Meso</span></li><li><i className="legend-symbol legend-symbol--macro" /><span>Macro</span></li><li><i className="legend-symbol legend-symbol--integration" /><span>Integration</span></li></ul></section>
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

function fitViewport(nodes, targetHeight = 440, phoneLayout = false) {
  if (!nodes.length) return { panX: 0, panY: 0, zoom: 1 };
  const bounds = nodes.map((node) => {
    const geometry = mapNodeGeometry(node.label, phoneLayout);
    return {
      left: node.x - geometry.cardWidth / 2,
      right: node.x + geometry.cardWidth / 2,
      top: node.y - geometry.cardHeight / 2,
      bottom: node.y + geometry.cardHeight / 2,
    };
  });
  const minX = Math.min(...bounds.map(({ left }) => left));
  const maxX = Math.max(...bounds.map(({ right }) => right));
  const minY = Math.min(...bounds.map(({ top }) => top));
  const maxY = Math.max(...bounds.map(({ bottom }) => bottom));
  const zoom = clamp(Math.min(1.4, 760 / Math.max(240, maxX - minX + 40), targetHeight / Math.max(170, maxY - minY + 40)), VIEWPORT_LIMITS.minZoom, VIEWPORT_LIMITS.maxZoom);
  return {
    zoom,
    panX: clamp(GRAPH_WIDTH / 2 - ((minX + maxX) / 2) * zoom, VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan),
    panY: clamp(targetHeight === 240 ? 130 - ((minY + maxY) / 2) * zoom : GRAPH_HEIGHT / 2 - ((minY + maxY) / 2) * zoom, VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan),
  };
}

const INSPECTOR_TABS = ['node', 'relationships', 'map'];

function MapStage({ project, update, toast, logPrototype, saveState, stageAnnotationDraft, commitAnnotationDrafts, flushSave }) {
  const [selection, setSelection] = useState(null);
  const [focus, setFocus] = useState(null);
  const [visibleScale, setVisibleScale] = useState(() => project.releasedScales.includes(project.activeScale) ? project.activeScale : 'all');
  const [showRemoved, setShowRemoved] = useState(false);
  const [inspectorTab, setInspectorTab] = useState('map');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [phoneViewport, setPhoneViewport] = useState(null);
  const [mapViewport, setMapViewport] = useState(null);
  const [automaticPositions, setAutomaticPositions] = useState(null);
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
  const initialLayoutCheckedRef = useRef(false);
  const phoneLayout = usePhoneLayout();
  const hasRemovedItems = project.graph.nodes.some((node) => node.claimState === 'retired') || project.graph.edges.some((edge) => edge.claimState === 'retired');
  const visibleScaleSet = useMemo(() => new Set(visibleScale === 'all' ? project.releasedScales : [visibleScale]), [project.releasedScales, visibleScale]);
  const scaleEdgeIds = useMemo(() => new Set(project.graph.edges
    .filter((edge) => visibleScaleSet.has(edge.scale) && (showRemoved || edge.claimState !== 'retired'))
    .flatMap((edge) => [edge.source, edge.target])), [project.graph.edges, visibleScaleSet, showRemoved]);
  const scaleNodes = useMemo(() => project.graph.nodes.filter((node) => {
    const scaleMatches = visibleScaleSet.has(node.scale) || scaleEdgeIds.has(node.id);
    return scaleMatches && (showRemoved || node.claimState !== 'retired');
  }), [project.graph.nodes, visibleScaleSet, scaleEdgeIds, showRemoved]);
  const scaleNodeIds = useMemo(() => new Set(scaleNodes.map((node) => node.id)), [scaleNodes]);
  const scaleEdges = useMemo(() => project.graph.edges.filter((edge) => visibleScaleSet.has(edge.scale)
    && scaleNodeIds.has(edge.source)
    && scaleNodeIds.has(edge.target)
    && (showRemoved || edge.claimState !== 'retired')), [project.graph.edges, visibleScaleSet, scaleNodeIds, showRemoved]);
  const focusedEdgeIds = useMemo(() => {
    if (!focus) return new Set();
    if (focus.kind === 'edge') return new Set(scaleEdges.some((edge) => edge.id === focus.id) ? [focus.id] : []);
    return new Set(scaleEdges.filter((edge) => edge.source === focus.id || edge.target === focus.id).map((edge) => edge.id));
  }, [focus, scaleEdges]);
  const focusedNodeIds = useMemo(() => {
    if (!focus) return new Set();
    const ids = new Set(focus.kind === 'node' && scaleNodeIds.has(focus.id) ? [focus.id] : []);
    scaleEdges.forEach((edge) => {
      if (!focusedEdgeIds.has(edge.id)) return;
      ids.add(edge.source);
      ids.add(edge.target);
    });
    return ids;
  }, [focus, focusedEdgeIds, scaleEdges, scaleNodeIds]);
  const focusActive = focusedNodeIds.size > 0;
  const visibleNodes = useMemo(() => focusActive ? scaleNodes.filter((node) => focusedNodeIds.has(node.id)) : scaleNodes, [focusActive, scaleNodes, focusedNodeIds]);
  const displayedNodes = useMemo(() => visibleNodes.map((node) => ({ ...node, ...(automaticPositions?.get(node.id) || {}) })), [automaticPositions, visibleNodes]);
  const visibleEdges = useMemo(() => {
    const shown = focusActive ? scaleEdges.filter((edge) => focusedEdgeIds.has(edge.id)) : scaleEdges;
    return shown.map((edge) => ({ ...edge, showLabel: focusActive, visualMuted: !focusActive }));
  }, [focusActive, scaleEdges, focusedEdgeIds]);
  useEffect(() => {
    if (initialLayoutCheckedRef.current) return;
    initialLayoutCheckedRef.current = true;
    const currentNodes = project.graph.nodes.filter((node) => node.status !== 'rejected' && node.claimState !== 'retired');
    const positions = mapNeedsReadableOverview(currentNodes, project.events, phoneLayout)
      ? arrangedMapPositions(currentNodes, new Set(currentNodes.map((node) => node.scale)).size > 1, phoneLayout ? 3 : 5, phoneLayout)
      : null;
    const positionedNodes = currentNodes.map((node) => ({ ...node, ...(positions?.get(node.id) || {}) }));
    const nextScaleEdges = project.graph.edges.filter((edge) => edge.status !== 'rejected'
      && edge.claimState !== 'retired'
      && (visibleScale === 'all' ? project.releasedScales.includes(edge.scale) : edge.scale === visibleScale));
    const endpointIds = new Set(nextScaleEdges.flatMap((edge) => [edge.source, edge.target]));
    const nextVisibleNodes = positionedNodes.filter((node) => visibleScale === 'all'
      ? project.releasedScales.includes(node.scale)
      : node.scale === visibleScale || endpointIds.has(node.id));
    setAutomaticPositions(positions);
    if (positions) setMapViewport(fitViewport(nextVisibleNodes.length ? nextVisibleNodes : positionedNodes, phoneLayout ? 650 : 440, phoneLayout));
  }, [phoneLayout, project.events, project.graph.edges, project.graph.nodes, project.releasedScales, visibleScale]);
  useEffect(() => {
    if (phoneLayout && drawerOpen) setPhoneViewport(fitViewport(displayedNodes.length ? displayedNodes : project.graph.nodes, 240, true));
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
  const focusedNode = focus?.kind === 'node' ? project.graph.nodes.find((node) => node.id === focus.id) : null;
  const focusedEdge = focus?.kind === 'edge' ? project.graph.edges.find((edge) => edge.id === focus.id) : null;
  const selectedItemRemoved = (selectedNode || selectedEdge)?.claimState === 'retired';
  const relatedEdges = project.graph.edges
    .filter((edge) => showRemoved || edge.claimState !== 'retired')
    .filter((edge) => selectedNode ? edge.source === selectedNode.id || edge.target === selectedNode.id : true);
  const selectItem = useCallback((kind, id, openInspector = true) => {
    setSelection({ kind, id });
    setInspectorTab(kind === 'edge' ? 'relationships' : 'node');
    setAnnotationDisclosure('analytical');
    if (openInspector) {
      setFocus({ kind, id });
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
  const showFullMap = useCallback(() => {
    setFocus(null);
    setSelection(null);
    setInspectorTab('map');
    setDrawerOpen(false);
    const nodes = scaleNodes.map((node) => ({ ...node, ...(automaticPositions?.get(node.id) || {}) }));
    setMapViewport(fitViewport(nodes.length ? nodes : project.graph.nodes, phoneLayout ? 650 : 440, phoneLayout));
    window.requestAnimationFrame(() => canvasWrapRef.current?.querySelector('.graph-canvas')?.focus());
  }, [automaticPositions, phoneLayout, project.graph.nodes, scaleNodes]);
  const changeVisibleScale = (nextScale) => {
    const nextEdges = project.graph.edges.filter((edge) => edge.status !== 'rejected'
      && edge.claimState !== 'retired'
      && (nextScale === 'all' ? project.releasedScales.includes(edge.scale) : edge.scale === nextScale));
    const endpointIds = new Set(nextEdges.flatMap((edge) => [edge.source, edge.target]));
    const nextNodes = project.graph.nodes.filter((node) => node.status !== 'rejected'
      && node.claimState !== 'retired'
      && (nextScale === 'all' ? project.releasedScales.includes(node.scale) : node.scale === nextScale || endpointIds.has(node.id)))
      .map((node) => ({ ...node, ...(automaticPositions?.get(node.id) || {}) }));
    setVisibleScale(nextScale);
    setFocus(null);
    setSelection(null);
    setInspectorTab('map');
    setDrawerOpen(false);
    setMapViewport(fitViewport(nextNodes, phoneLayout ? 650 : 440, phoneLayout));
  };
  const moveNode = useCallback((id, x, y, method) => {
    update((draft) => {
      if (automaticPositions) draft.graph.nodes.forEach((node) => {
        const position = automaticPositions.get(node.id);
        if (position) Object.assign(node, position);
      });
      const node = draft.graph.nodes.find((item) => item.id === id);
      if (node) { node.x = x; node.y = y; }
    });
    setAutomaticPositions(null);
    logPrototype('node_moved', { keyboard: method === 'keyboard', pointer: method === 'pointer' });
  }, [automaticPositions, update, logPrototype]);
  const changeViewport = useCallback((next) => {
    const bounded = {
      panX: clamp(Math.round(next.panX), VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan),
      panY: clamp(Math.round(next.panY), VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan),
      zoom: clamp(Number(next.zoom.toFixed(2)), VIEWPORT_LIMITS.minZoom, VIEWPORT_LIMITS.maxZoom),
    };
    if (phoneLayout && drawerOpen) setPhoneViewport(bounded);
    setMapViewport(null);
    update((draft) => { draft.viewport = bounded; });
    logPrototype('viewport_changed');
  }, [update, logPrototype, phoneLayout, drawerOpen]);
  const zoomBy = (amount) => {
    const current = phoneLayout && drawerOpen && phoneViewport ? phoneViewport : mapViewport || project.viewport;
    const zoom = clamp(current.zoom + amount, VIEWPORT_LIMITS.minZoom, VIEWPORT_LIMITS.maxZoom);
    const mapCenterX = (GRAPH_WIDTH / 2 - current.panX) / current.zoom;
    const mapCenterY = (GRAPH_HEIGHT / 2 - current.panY) / current.zoom;
    changeViewport({ zoom, panX: GRAPH_WIDTH / 2 - mapCenterX * zoom, panY: GRAPH_HEIGHT / 2 - mapCenterY * zoom });
  };
  const fitMap = () => {
    const nodes = displayedNodes.length ? displayedNodes : project.graph.nodes;
    changeViewport(fitViewport(nodes, phoneLayout ? 650 : 440, phoneLayout));
  };
  const arrangeMap = () => {
    const nodes = visibleNodes.length ? visibleNodes : project.graph.nodes.filter((node) => showRemoved || node.claimState !== 'retired');
    const positions = arrangedMapPositions(nodes, visibleScale === 'all' && !phoneLayout, phoneLayout ? (visibleScale !== 'all' ? 2 : 3) : 5, phoneLayout);
    const arrangedNodes = nodes.map((node) => ({ ...node, ...positions.get(node.id) }));
    const nextViewport = fitViewport(arrangedNodes, phoneLayout ? 650 : 440, phoneLayout);
    update((draft) => {
      if (automaticPositions) draft.graph.nodes.forEach((node) => {
        const position = automaticPositions.get(node.id);
        if (position) Object.assign(node, position);
      });
      draft.graph.nodes.forEach((node) => {
        const position = positions.get(node.id);
        if (position) Object.assign(node, position);
      });
      draft.viewport = nextViewport;
    }, 'map.arranged', visibleScale === 'all' ? 'All scales arranged' : `${SCALES[visibleScale]?.label || visibleScale} arranged`);
    setAutomaticPositions(null);
    setMapViewport(null);
    if (phoneLayout && drawerOpen) setPhoneViewport(nextViewport);
    logPrototype('map_arranged');
    toast(visibleScale === 'all' ? 'Map arranged by scale.' : 'Map arranged.');
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
  const setSelectedRemoved = (removed) => {
    if (!selection) return;
    update((draft) => {
      const items = selection.kind === 'node' ? draft.graph.nodes : draft.graph.edges;
      const item = items.find((candidate) => candidate.id === selection.id);
      if (!item) return;
      item.status = removed ? 'rejected' : 'confirmed';
      item.claimState = removed ? 'retired' : 'student interpretation';
    }, removed ? 'map.item.removed' : 'map.item.restored', selection.id);
    if (removed && !showRemoved) {
      setSelection(null);
      setFocus(null);
      setInspectorTab('map');
      setDrawerOpen(false);
    }
    toast(removed ? 'Item removed from the map.' : 'Item returned to the map.');
  };
  const commitAnnotations = () => commitAnnotationDrafts().changed;
  const addNode = () => {
    if (!project.instructor.allowResearchLeads) return toast('Items needing more evidence are turned off for this project.', 'error');
    if (project.graph.nodes.length >= PROJECT_LIMITS.nodes) return toast(`This map already contains the maximum ${PROJECT_LIMITS.nodes} nodes.`, 'error');
    if (!newNode.label.trim()) return toast('Name the node before adding it.', 'error');
    if (project.instructor.evidenceRequired && !newNode.evidence.trim()) return toast('Add evidence or a question before adding the node.', 'error');
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
    toast('Node added.');
  };
  const addEdge = () => {
    if (!project.instructor.allowResearchLeads) return toast('Items needing more evidence are turned off for this project.', 'error');
    if (project.graph.edges.length >= PROJECT_LIMITS.edges) return toast(`This map already contains the maximum ${PROJECT_LIMITS.edges} relationships.`, 'error');
    const source = project.graph.nodes.find((node) => node.id === newEdge.source);
    const target = project.graph.nodes.find((node) => node.id === newEdge.target);
    if (!source || !target || source.id === target.id) return toast('Choose two different nodes.', 'error');
    if (!newEdge.verb.trim()) return toast('Describe the connection before adding the relationship.', 'error');
    if (project.instructor.evidenceRequired && !newEdge.evidence.trim()) return toast('Add evidence or a question before adding the relationship.', 'error');
    const id = stableId('edge', `${newEdge.source}:${newEdge.verb}:${newEdge.target}:${Date.now()}`);
    update((draft) => { draft.graph.edges.push({ ...newEdge, id, sourceLabel: source.label, targetLabel: target.label, scale: project.activeScale, status: 'confirmed', notes: '', annotation: { id: stableId('annotation', `edge:${id}:relationship`), text: '' } }); }, 'edge.added', `${source.label} ${newEdge.verb} ${target.label}`);
    setSelection({ kind: 'edge', id });
    setInspectorTab('relationships');
    setAddMode(null);
    toast('Relationship added.');
  };
  const canvasViewport = phoneLayout && drawerOpen && phoneViewport ? phoneViewport : mapViewport || project.viewport;
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
  const mapLabel = visibleScale === 'all' ? 'All-scales map' : `${SCALES[visibleScale]?.label || visibleScale} map`;
  const focusLabel = focusedNode?.label || (focusedEdge ? `${focusedEdge.sourceLabel} to ${focusedEdge.targetLabel}` : '');
  return <div className={`map-stage stage-enter ${focusActive || visibleScale === 'all' ? 'has-map-context' : ''}`}>
    <MemoDrawer project={project} update={update} hint="The memo travels with the map. Edit it here whenever the map surfaces something new." />
    <div className="map-toolbar"><h1>Build the map</h1><div className="map-toolbar__controls"><label><span>Show</span><select aria-label="Show map scale" value={visibleScale} onChange={(event) => changeVisibleScale(event.target.value)}>{project.releasedScales.map((scale) => <option key={scale} value={scale}>{SCALES[scale].label}</option>)}<option value="all">All scales</option></select></label>{hasRemovedItems && <label className="map-removed-toggle"><input type="checkbox" checked={showRemoved} onChange={(event) => setShowRemoved(event.target.checked)} /><span>Show removed items</span></label>}</div></div>
    {focusActive ? <div className="map-focus-bar" role="status"><span>Showing connections for <strong>{focusLabel}</strong>.</span><button type="button" onClick={showFullMap}>Show full map</button></div> : visibleScale === 'all' ? <p className="map-overview-hint">Choose a node to see its connections.</p> : null}
    <div className={`map-layout ${drawerOpen ? 'has-inspector' : ''}`}>
      <section ref={canvasWrapRef} className={`canvas-wrap ${phoneLayout && drawerOpen ? 'is-inspector-open' : ''}`} aria-label="Map canvas and controls">
        <MemoGraphCanvas nodes={displayedNodes} edges={visibleEdges} selection={selection} onSelect={selectItem} onMoveNode={moveNode} viewport={canvasViewport} phoneLayout={phoneLayout} mapLabel={mapLabel} interactionMode={phoneLayout && drawerOpen ? 'phone-drawer' : 'durable'} panMode={panMode} onViewportChange={changeViewport} onAnnounce={setAnnouncement} />
        <div className="canvas-controls" role="toolbar" aria-label="Map view controls" aria-hidden={phoneLayout && drawerOpen ? 'true' : undefined} inert={phoneLayout && drawerOpen}><button type="button" aria-pressed={panMode} className={panMode ? 'is-active' : ''} onClick={() => setPanMode((current) => !current)}>Pan</button><button type="button" aria-label="Zoom out" onClick={() => zoomBy(-0.15)}>−</button><button type="button" aria-label="Zoom in" onClick={() => zoomBy(0.15)}>+</button><button type="button" onClick={arrangeMap}>Arrange map</button><button type="button" onClick={fitMap}>Fit map</button><button type="button" aria-expanded={legendOpen} onClick={() => setLegendOpen((current) => { const opening = !current; if (opening) { setDrawerOpen(false); setCreateMenuOpen(false); } return opening; })}>Map key</button><button className="phone-inspector-trigger" type="button" aria-expanded={drawerOpen} onClick={() => { if (!project.graph.nodes.length) setInspectorTab('map'); setLegendOpen(false); setDrawerOpen(true); }}>Details</button></div>
        {legendOpen && <aside className="map-legend" aria-label="Map key"><div className="map-legend__head"><strong>Map key</strong><button type="button" onClick={() => setLegendOpen(false)} aria-label="Close map key"><Icon name="close" /></button></div><MapLegend /></aside>}
        <div className="sr-only" aria-live="polite">{announcement}</div>
      </section>
      <aside ref={inspectorRef} className={`inspector ${drawerOpen ? 'is-open' : ''}`} aria-label="Map inspector" aria-hidden={!drawerOpen ? 'true' : undefined} inert={!drawerOpen} onKeyDown={(event) => { if (event.key === 'Escape' && drawerOpen) { event.preventDefault(); closeInspector(); } }}>
        <div className="inspector__head">
          <h2>{selectedNode?.label || (selectedEdge ? `${selectedEdge.sourceLabel} → ${selectedEdge.targetLabel}` : 'Evolving map')}</h2>
          <div className="inspector__actions">
            {project.instructor.allowResearchLeads && <div className="inspector-add-menu"><button type="button" aria-expanded={createMenuOpen} aria-controls="inspector-add-actions" onClick={() => setCreateMenuOpen((current) => !current)}>Add</button>{createMenuOpen && <div id="inspector-add-actions"><button type="button" onClick={() => { setAddMode('node'); setCreateMenuOpen(false); }}>Node</button><button type="button" onClick={() => { setAddMode('edge'); setCreateMenuOpen(false); }}>Relationship</button></div>}</div>}
            <button className="inspector-done" type="button" onClick={closeInspector}>Done</button>
          </div>
        </div>
        <div className="inspector-tabs" role="tablist" aria-label="Annotation target">{INSPECTOR_TABS.map((tab) => <button key={tab} id={`map-inspector-tab-${tab}`} type="button" role="tab" aria-selected={inspectorTab === tab} aria-controls={`map-inspector-panel-${tab}`} tabIndex={inspectorTab === tab ? 0 : -1} data-composite-value={tab} onClick={() => setTab(tab)} onKeyDown={(event) => handleCompositeKey(event, INSPECTOR_TABS, inspectorTab, setTab)}>{tab === 'relationships' ? 'Relationships' : tab[0].toUpperCase() + tab.slice(1)}</button>)}</div>
        {addMode === 'node' && <div className="add-form"><h3>Add a node</h3><Field label="Label"><input maxLength={NODE_LABEL_LIMIT} value={newNode.label} onChange={(event) => setNewNode((current) => ({ ...current, label: event.target.value }))} /></Field><div className="field-pair"><Field label="Type"><select value={newNode.type} onChange={(event) => setNewNode((current) => ({ ...current, type: event.target.value }))}>{NODE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></Field><Field label="Scale"><select value={newNode.scale} onChange={(event) => setNewNode((current) => ({ ...current, scale: event.target.value }))}>{project.releasedScales.map((scale) => <option key={scale}>{scale}</option>)}</select></Field></div><Field label="Evidence or question"><textarea maxLength={PROJECT_LIMITS.noteText} rows="3" value={newNode.evidence} onChange={(event) => setNewNode((current) => ({ ...current, evidence: event.target.value }))} /></Field><button className="button" type="button" onClick={addNode}>Add node</button></div>}
        {addMode === 'edge' && <div className="add-form"><h3>Add a relationship</h3><Field label="From"><select value={newEdge.source} onChange={(event) => setNewEdge((current) => ({ ...current, source: event.target.value }))}>{project.graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field><Field label="Connection"><input maxLength={RELATIONSHIP_VERB_LIMIT} value={newEdge.verb} onChange={(event) => setNewEdge((current) => ({ ...current, verb: event.target.value }))} /></Field><Field label="To"><select value={newEdge.target} onChange={(event) => setNewEdge((current) => ({ ...current, target: event.target.value }))}>{project.graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field><Field label="Evidence or question"><textarea maxLength={PROJECT_LIMITS.noteText} rows="3" value={newEdge.evidence} onChange={(event) => setNewEdge((current) => ({ ...current, evidence: event.target.value }))} /></Field><button className="button" type="button" onClick={addEdge}>Add relationship</button></div>}
        {!addMode && inspectorTab === 'node' && <div id="map-inspector-panel-node" className="inspector__body" role="tabpanel" aria-labelledby="map-inspector-tab-node">{selectedNode ? <>
          <details className="node-summary"><summary><span>Summary</span><strong>{selectedNode.type}</strong></summary><div className="node-summary__body"><Field label="Label"><input maxLength={NODE_LABEL_LIMIT} value={selectedNode.label} onChange={(event) => editNode('label', event.target.value)} /></Field><div className="field-pair"><Field label="Type"><select value={selectedNode.type} onChange={(event) => editNode('type', event.target.value)}>{NODE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></Field><Field label="Scale"><select value={selectedNode.scale} onChange={(event) => editNode('scale', event.target.value)}>{project.releasedScales.map((scale) => <option key={scale}>{SCALES[scale].label}</option>)}</select></Field></div><div className="provenance-block"><span>Evidence</span><p>{selectedNode.evidence || 'No evidence added yet.'}</p>{selectedNode.notes && <><span>Reviewer note</span><p>{selectedNode.notes}</p></>}</div></div></details>
          <button className="map-item-action" type="button" onClick={() => setSelectedRemoved(!selectedItemRemoved)}>{selectedItemRemoved ? 'Return to map' : 'Remove from map'}</button>
          <section className="annotation-disclosure"><button type="button" aria-expanded={annotationDisclosure === 'analytical'} aria-controls="node-analytical-annotation" onClick={() => setAnnotationDisclosure((current) => current === 'analytical' ? null : 'analytical')}><span>Annotation</span><Icon name={annotationDisclosure === 'analytical' ? 'close' : 'plus'} /></button>{annotationDisclosure === 'analytical' && <div id="node-analytical-annotation"><AnnotationField key={selectedNode.annotations.analytical.id} annotationId={selectedNode.annotations.analytical.id} label="Annotation" value={selectedNode.annotations.analytical.text} onDraftValue={(text) => stageAnnotationDraft(selectedNode.annotations.analytical.id, text)} {...annotationProps} /></div>}</section>
          <section className="annotation-disclosure"><button type="button" aria-expanded={annotationDisclosure === 'evidence'} aria-controls="node-evidence-annotation" onClick={() => setAnnotationDisclosure((current) => current === 'evidence' ? null : 'evidence')}><span>Evidence</span><Icon name={annotationDisclosure === 'evidence' ? 'close' : 'plus'} /></button>{annotationDisclosure === 'evidence' && <div id="node-evidence-annotation"><AnnotationField key={selectedNode.annotations.evidence.id} annotationId={selectedNode.annotations.evidence.id} label="Evidence" value={selectedNode.annotations.evidence.text} placeholder="How does the evidence support, limit, or complicate this node?" onDraftValue={(text) => stageAnnotationDraft(selectedNode.annotations.evidence.id, text)} {...annotationProps} /></div>}</section>
        </> : <p className="empty-message">Choose a node on the map to inspect and annotate it.</p>}</div>}
        {!addMode && inspectorTab === 'relationships' && <div id="map-inspector-panel-relationships" className="inspector__body" role="tabpanel" aria-labelledby="map-inspector-tab-relationships"><div className="relationship-picker" aria-label="Relationship list">{relatedEdges.map((edge) => <button type="button" key={edge.id} className={selectedEdge?.id === edge.id ? 'is-selected' : ''} onClick={() => selectItem('edge', edge.id)}><span>{edge.sourceLabel} <strong>{edge.verb}</strong> {edge.targetLabel}</span></button>)}</div>{selectedEdge ? <><details className="node-summary"><summary><span>Summary</span><strong>{selectedEdge.verb}</strong></summary><div className="node-summary__body"><div className="provenance-block"><span>Evidence</span><p>{selectedEdge.evidence || 'No evidence added yet.'}</p></div></div></details><button className="map-item-action" type="button" onClick={() => setSelectedRemoved(!selectedItemRemoved)}>{selectedItemRemoved ? 'Return to map' : 'Remove from map'}</button><AnnotationField key={selectedEdge.annotation.id} annotationId={selectedEdge.annotation.id} label="Annotation" value={selectedEdge.annotation.text} placeholder="What does this relationship explain, and what remains uncertain?" onDraftValue={(text) => stageAnnotationDraft(selectedEdge.annotation.id, text)} {...annotationProps} /></> : <p className="empty-message">Choose a relationship on the map or from this list to annotate it.</p>}</div>}
        {!addMode && inspectorTab === 'map' && <div id="map-inspector-panel-map" className="inspector__body" role="tabpanel" aria-labelledby="map-inspector-tab-map"><div className="map-summary"><strong>{project.graph.nodes.length}</strong><span>nodes</span><strong>{project.graph.edges.length}</strong><span>relationships</span></div><AnnotationField key={project.mapAnnotation.id} annotationId={project.mapAnnotation.id} label="Map note" value={project.mapAnnotation.text} hint="Write about a pattern, boundary, contradiction, or question across the map." placeholder="Across the map, I notice…" onDraftValue={(text) => stageAnnotationDraft(project.mapAnnotation.id, text)} {...annotationProps} /></div>}
      </aside>
    </div>
  </div>;
}

function RevisionStage({ project, update, replaceProject, toast, logPrototype }) {
  const [importError, setImportError] = useState('');
  const currentNodes = project.graph.nodes.filter((node) => node.claimState !== 'retired').length;
  const needsEvidence = project.graph.nodes.filter((node) => node.claimState === 'research lead').length + project.graph.edges.filter((edge) => edge.claimState === 'research lead').length;
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
    <p className="lede">Describe what changed, then export a copy.</p>
    <MemoDrawer project={project} update={update} />
    <div className="revision-grid">
      <section>
        <div className="before-after"><div><span>Memo</span><p>{project.submission.text.split(/[.!?]/).filter((sentence) => sentence.trim()).length} memo statements were available for review.</p></div><Icon name="arrow" size={24} /><div><span>Current map</span><p>{project.graph.nodes.length} nodes and {project.graph.edges.length} relationships are recorded.</p></div></div>
        <Field label="What changed in your explanation?" hint="Optional note for this scale cycle"><textarea className="reflection" rows="8" maxLength={PROJECT_LIMITS.promptText} value={project.reflection} onChange={(event) => update((draft) => { draft.reflection = event.target.value; })} onBlur={() => update(() => {}, 'reflection.revised', 'Scale-cycle reflection')} placeholder="I first understood… The map now shows… I still need to investigate…" /></Field>
        <div className="release-summary"><div><strong>{currentNodes}</strong><span>nodes on map</span></div><div><strong>{project.graph.edges.length}</strong><span>relationships</span></div><div><strong>{needsEvidence}</strong><span>items needing evidence</span></div><div><strong>{project.events.length}</strong><span>changes</span></div></div>
        <div className="sharing-row"><Field label="Who can receive this copy?"><select value={project.sharingTier} onChange={(event) => update((draft) => { draft.sharingTier = event.target.value; }, 'sharing.changed', event.target.value)}>{tiers.map((tier, index) => <option key={tier} value={tier} disabled={index > maxIndex}>{tier === 'private' ? 'Only me' : tier === 'course' ? 'Class' : tier === 'public' ? 'Public' : 'CUNY'}{index > maxIndex ? ' · unavailable' : ''}</option>)}</select></Field></div>
      </section>
      <details className="history-panel"><summary><span>Revision history</span><strong>{project.events.length} changes</strong></summary><ol className="timeline">{[...project.events].reverse().slice(0, 14).map((event) => <li key={event.id}><span className="timeline__dot" /><div><strong>{event.action === 'source.imported' ? 'memo imported' : event.action.replaceAll('.', ' ')}</strong><p>{event.detail}</p><small>{new Date(event.at).toLocaleString()} · {event.actor}</small></div></li>)}</ol></details>
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
    <p className="privacy-note">Instructor controls are local to this project. Changes refresh the guidance and evidence settings used for later work.</p>
    <div className="settings-section"><p className="eyebrow">Readiness and evidence</p><Field label="Readiness threshold"><input type="number" min="1" max="8" step="1" value={project.instructor.readinessThreshold} onChange={(event) => setReadinessThreshold(event.target.value)} /></Field><div className="config-line"><span>Required checks</span><strong>H1–H4</strong></div><label className="check-row"><input type="checkbox" checked={project.instructor.evidenceRequired} onChange={(event) => set('evidenceRequired', event.target.checked)} /><span><strong>Require evidence</strong><small>Students must add evidence before moving a claim forward.</small></span></label><label className="check-row"><input type="checkbox" checked={project.instructor.requireStudentConfirmation} onChange={(event) => set('requireStudentConfirmation', event.target.checked)} /><span><strong>Require student confirmation</strong><small>Suggestions remain choices until the student confirms them.</small></span></label></div>
    <div className="settings-section"><p className="eyebrow">Privacy and publication</p><Field label="Maximum sharing tier"><select value={project.instructor.maxSharingTier} onChange={(event) => set('maxSharingTier', event.target.value)}><option>private</option><option>course</option><option>CUNY</option><option>public</option></select></Field><label className="check-row"><input type="checkbox" checked={project.instructor.allowResearchLeads} onChange={(event) => set('allowResearchLeads', event.target.checked)} /><span><strong>Allow items needing more evidence</strong><small>Keep these items visually distinct.</small></span></label></div>
    <div className="settings-section"><p className="eyebrow">Scale layers</p><div className="release-controls">{SCALE_ORDER.map((scale) => { const open = project.releasedScales.includes(scale); return <button key={scale} className={open ? 'is-open' : ''} disabled={open} onClick={() => release(scale)}>{open ? <Icon name="check" size={15} /> : <Icon name="plus" size={15} />}{SCALES[scale].label}</button>; })}</div></div>
    <div className="settings-section"><p className="eyebrow">Model contracts</p><dl className="config-summary"><div><dt>Evaluator</dt><dd>{project.configs.preflight.label} · v{project.configs.preflight.revision}</dd></div><div><dt>Builder</dt><dd>{project.configs.builder.label} · v{project.configs.builder.revision}</dd></div><div><dt>Runtime</dt><dd>{suggestionRuntimeLabel(project.preflight?.evaluation?.runtime)}</dd></div></dl><button type="button" className="button button--secondary" onClick={() => toast('Open “Review your memo,” then “Model setup,” to revise either contract.')}>Where to edit</button></div>
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
  const [accessState, setAccessState] = useState({ status: 'checking', access: null, message: 'Loading…', kind: 'info' });
  const [workspaceStarted, setWorkspaceStarted] = useState(false);
  const [mapPreviewOpen, setMapPreviewOpen] = useState(false);
  const [hasSavedProject, setHasSavedProject] = useState(initialLoad.hasSavedProject);
  const [persistenceBlocked, setPersistenceBlocked] = useState(initialLoad.persistenceBlocked);
  const [pendingNewProject, setPendingNewProject] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(null);
  const [connectionPrompt, setConnectionPrompt] = useState('');
  const [connectionSuggestions, setConnectionSuggestions] = useState([]);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [saveState, setSaveState] = useState({
    status: initialLoad.loadError ? 'error' : initialLoad.hasSavedProject ? 'saved' : 'idle',
    message: initialLoad.loadError || (initialLoad.hasSavedProject ? 'Project saved on this device' : 'Project not started'),
    recovery: initialLoad.recovery,
    savedRevision: 0,
  });
  const toastTimer = useRef(null);
  const persistTimer = useRef(null);
  const pendingAnnotationsRef = useRef(new Map());
  const prototypeLogNoticeRef = useRef({ sequence: 0, lastFailure: 0 });
  const accessGenerationRef = useRef(0);
  const autoReviewKeyRef = useRef('');
  const projectRef = useRef(project);
  const connectionPromptRef = useRef(connectionPrompt);
  const workspaceRef = useRef(null);
  projectRef.current = project;
  connectionPromptRef.current = connectionPrompt;
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
      if (active && generation === accessGenerationRef.current) setAccessState({ status: 'unavailable', access: null, message: 'The class workspace is unavailable. Try again later.', kind: 'error' });
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (accessState.status !== 'granted' || typeof accessState.access?.expiresAt !== 'string') return undefined;
    const remaining = Date.parse(accessState.access.expiresAt) - Date.now();
    if (remaining <= 0) {
      accessGenerationRef.current += 1;
      setReviewBusy(null);
      setConnectionBusy(false);
      setWorkspaceStarted(false);
      setMapPreviewOpen(false);
      setAccessState({ status: 'expired', access: null, message: 'Enter your class code to continue.', kind: 'error' });
      return undefined;
    }
    const timer = window.setTimeout(() => {
      accessGenerationRef.current += 1;
      setReviewBusy(null);
      setConnectionBusy(false);
      setWorkspaceStarted(false);
      setMapPreviewOpen(false);
      setAccessState({ status: 'expired', access: null, message: 'Enter your class code to continue.', kind: 'error' });
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
  }, [project.stage, teacherOpen, workspaceStarted, mapPreviewOpen]);

  const refreshPublicConfigurations = useCallback(async () => {
    const scale = project.activeScale;
    const stageId = STAGES[project.stage]?.id || 'add-source';
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
  }, []);

  const logPrototype = useCallback((event, metadata = undefined, stageOverride = undefined) => {
    if (accessState.status !== 'granted') return Promise.resolve(false);
    const stage = stageOverride || STAGES[projectRef.current.stage]?.label;
    const sequence = ++prototypeLogNoticeRef.current.sequence;
    const accessGeneration = accessGenerationRef.current;
    return recordPrototypeEvent(event, stage, metadata).then(() => {
      if (accessGeneration !== accessGenerationRef.current) return false;
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
          setConnectionBusy(false);
          setWorkspaceStarted(false);
          setMapPreviewOpen(false);
          setAccessState({ status: 'expired', access: null, message: 'Enter your class code to continue.', kind: 'error' });
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
    if (!Number.isInteger(stage) || stage < 0 || stage >= STAGES.length) return false;
    const fromStage = project.stage;
    setMapPreviewOpen(false);
    update((draft) => {
      draft.stage = stage;
      draft.furthestStage = Math.max(draft.furthestStage || 0, stage);
    }, 'stage.opened', STAGES[stage].label);
    recordStageTransition(fromStage, stage, options);
    return true;
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
        setConnectionBusy(false);
        setWorkspaceStarted(false);
        setMapPreviewOpen(false);
        setAccessState({ status: 'expired', access: null, message: 'Enter your class code to continue.', kind: 'error' });
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
      toast(`This memo is too large for the reported Ollama Cloud runtime (${runtime.maxSourceBytes.toLocaleString()} UTF-8 bytes maximum). Shorten the memo; your local project remains unchanged.`, 'error');
      return;
    }
    if (encoder.encode(JSON.stringify(payload)).byteLength > MAX_EVALUATION_POST_BYTES) {
      toast('The guidance request is too large to send. Shorten the memo; your local project remains unchanged.', 'error');
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
        toast('The memo or model setup changed while guidance was generated. Generate again from the current project.', 'error');
        return;
      }
      const result = normalizePreflightEvaluation(response.evaluation, projectRef.current);
      update((draft) => { draft.preflight = result; }, 'preflight.completed', 'Memo guidance generated', 'student', {
        configurationSnapshot: result.configurationSnapshot,
        runtime: result.evaluation.runtime,
        evaluation: { createdAt: result.evaluation.createdAt, expiresAt: result.evaluation.expiresAt },
      });
      toast('Guidance is ready.');
      return true;
    } catch (error) {
      await handleReviewApiError(error, accessGeneration, 'guidance request');
      return false;
    } finally {
      if (accessGeneration === accessGenerationRef.current) setReviewBusy(null);
    }
  };

  const generateConnectionSuggestions = async () => {
    const effectivePrompt = connectionPrompt.trim() || memoPromptExcerpt(project.submission.text);
    if (!effectivePrompt) return toast('Write a sentence about how the nodes connect, or add memo text first.', 'error');
    const payload = connectionSuggestionPayload(project, effectivePrompt);
    if (payload.nodes.length < 2) return toast('Keep at least two nodes before requesting connections.', 'error');
    if (payload.nodes.length > 50) return toast('Choose 50 or fewer nodes for one connection request.', 'error');
    if (payload.projectOverlay.customInstructions.length > MAX_EVALUATION_CUSTOM_INSTRUCTIONS) {
      return toast('Project instructions are too long for connection suggestions. Ask your instructor to shorten them.', 'error');
    }
    const accessGeneration = accessGenerationRef.current;
    const requestKey = stableId('connection-request', JSON.stringify(payload));
    setConnectionBusy(true);
    try {
      const response = await suggestMapConnections(payload);
      if (accessGeneration !== accessGenerationRef.current || projectRef.current.id !== project.id) return;
      if (stableId('connection-request', JSON.stringify(connectionSuggestionPayload(projectRef.current, connectionPromptRef.current.trim() || memoPromptExcerpt(projectRef.current.submission.text)))) !== requestKey) {
        toast('The nodes or description changed while suggestions were being prepared. Request them again.', 'error');
        return;
      }
      const normalized = normalizeConnectionSuggestions(response, projectRef.current);
      setConnectionSuggestions(normalized);
      toast(normalized.length ? 'Connections are ready for your review.' : 'No connections were suggested. Add more detail and try again.');
    } catch (error) {
      await handleReviewApiError(error, accessGeneration, 'connection request');
    } finally {
      if (accessGeneration === accessGenerationRef.current) setConnectionBusy(false);
    }
  };

  const editConnectionSuggestion = (id, field, value) => {
    const nodeById = new Map(nodesForConnectionPrompt(projectRef.current).map((node) => [node.id, node]));
    setConnectionSuggestions((current) => current.map((suggestion) => {
      if (suggestion.id !== id) return suggestion;
      const next = { ...suggestion, [field]: value, status: 'pending', claimState: 'inference' };
      if (field === 'source') next.sourceLabel = nodeById.get(value)?.label || next.sourceLabel;
      if (field === 'target') next.targetLabel = nodeById.get(value)?.label || next.targetLabel;
      if (field === 'source' || field === 'target' || field === 'verb') next.rationale = 'You edited this suggestion.';
      return next;
    }));
  };

  const decideConnectionSuggestion = (id, status) => {
    setConnectionSuggestions((current) => current.map((suggestion) => suggestion.id === id
      ? { ...suggestion, status, claimState: status === 'confirmed' ? 'student interpretation' : 'inference' }
      : suggestion));
  };

  // Scaffolding begins as soon as the student reaches the review stage: the
  // model reads the memo once per fingerprint without waiting for a click.
  useEffect(() => {
    if (project.stage !== 1 || accessState.status !== 'granted' || !workspaceStarted || reviewBusy) return undefined;
    if (project.submission.text.trim().length < 40) return undefined;
    if (project.preflight?.memoReview) return undefined;
    const key = `${project.id}:${memoFingerprint(project.submission)}:${project.activeScale}`;
    if (autoReviewKeyRef.current === key) return undefined;
    const timer = window.setTimeout(() => {
      autoReviewKeyRef.current = key;
      generateSuggestions();
    }, 700);
    return () => window.clearTimeout(timer);
    // The fingerprint key guards against repeats; generateSuggestions is recreated per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.stage, project.id, project.submission.fingerprint, project.activeScale, project.preflight, accessState.status, workspaceStarted, reviewBusy]);

  const buildCandidatesFromProject = (currentProject) => {
    const extracted = extractCandidates(currentProject.submission);
    const review = currentProject.preflight?.memoReview;
    const fingerprint = memoFingerprint(currentProject.submission);
    const nodeById = new Map();
    (review?.nodes || []).forEach((node) => {
      const id = stableId('node', node.label);
      if (nodeById.has(id)) return;
      nodeById.set(id, {
        id,
        label: node.label,
        type: node.type,
        scale: node.scale,
        status: 'pending',
        claimState: 'inference',
        evidence: node.evidence || '',
        sourceFingerprint: fingerprint,
        notes: '',
      });
    });
    extracted.nodes.forEach((node) => {
      if (!nodeById.has(node.id)) nodeById.set(node.id, { ...node, sourceFingerprint: node.sourceFingerprint || fingerprint });
    });
    const edgeKeyOf = (edge) => `${edge.source}::${edge.verb.trim().toLocaleLowerCase()}::${edge.target}`;
    const edgeByKey = new Map();
    (review?.connections || []).forEach((connection) => {
      const source = stableId('node', connection.source);
      const target = stableId('node', connection.target);
      if (!nodeById.has(source) || !nodeById.has(target) || source === target) return;
      const id = stableId('edge', `${connection.source}:${connection.verb}:${connection.target}`);
      const edge = {
        id,
        source,
        target,
        sourceLabel: nodeById.get(source).label,
        targetLabel: nodeById.get(target).label,
        verb: connection.verb,
        scale: nodeById.get(source).scale,
        status: 'pending',
        claimState: 'inference',
        directed: true,
        rationale: connection.rationale || '',
        evidence: connection.rationale || '',
        sourceFingerprint: fingerprint,
        notes: '',
        annotation: { id: stableId('annotation', `edge:${id}:relationship`), text: '' },
      };
      if (!edgeByKey.has(edgeKeyOf(edge))) edgeByKey.set(edgeKeyOf(edge), edge);
    });
    extracted.edges.forEach((edge) => {
      if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) return;
      const key = edgeKeyOf(edge);
      if (!edgeByKey.has(key)) edgeByKey.set(key, { ...edge, sourceFingerprint: edge.sourceFingerprint || fingerprint });
    });
    // Decisions already made on matching items survive a reread.
    const priorNodes = new Map(currentProject.candidates.nodes.map((node) => [node.id, node]));
    const priorEdges = new Map(currentProject.candidates.edges.map((edge) => [edge.id, edge]));
    const nodes = withDefaultNodeLayout([...nodeById.values()].map((node) => {
      const prior = priorNodes.get(node.id);
      return prior ? { ...node, status: prior.status, claimState: prior.claimState, notes: prior.notes || node.notes } : node;
    }));
    const edges = [...edgeByKey.values()].map((edge) => {
      const prior = priorEdges.get(edge.id);
      return prior ? { ...edge, status: prior.status, claimState: prior.claimState, notes: prior.notes || edge.notes } : edge;
    });
    return { nodes, edges };
  };

  const applyConfirmationDefaults = (candidates, currentProject) => {
    if (currentProject.instructor.requireStudentConfirmation) return candidates;
    candidates.nodes.forEach((node) => {
      if (node.status === 'pending') { node.status = 'confirmed'; node.claimState = 'student interpretation'; }
    });
    candidates.edges.forEach((edge) => {
      if (edge.status === 'pending') { edge.status = 'confirmed'; edge.claimState = 'student interpretation'; }
    });
    return candidates;
  };

  const prepareCandidates = () => {
    const candidates = applyConfirmationDefaults(buildCandidatesFromProject(project), project);
    const snapshot = configurationSnapshot(project, 'builder');
    update((draft) => { draft.candidates = candidates; draft.stage = 2; draft.furthestStage = Math.max(draft.furthestStage || 0, 2); }, 'candidates.generated', `${candidates.nodes.length} nodes and ${candidates.edges.length} relationships`, 'student', { configurationSnapshot: snapshot, sourceFingerprint: memoFingerprint(project.submission) });
    recordStageTransition(project.stage, 2, { completed: true });
    toast(candidates.nodes.length ? 'Nodes and connections from your memo are ready for review.' : 'No items surfaced yet. Add elements yourself, or edit the memo and reread it.');
  };

  const refreshCandidatesFromMemo = async () => {
    await generateSuggestions();
    const current = projectRef.current;
    const candidates = applyConfirmationDefaults(buildCandidatesFromProject(current), current);
    update((draft) => { draft.candidates = candidates; }, 'candidates.refreshed', `${candidates.nodes.length} nodes and ${candidates.edges.length} relationships`, 'student', { sourceFingerprint: memoFingerprint(current.submission) });
    toast(candidates.nodes.length ? 'Suggestions refreshed from your memo.' : 'The reread surfaced no items yet. You can still add elements yourself.');
  };

  const commitMapSelections = () => {
    const acceptedNodes = project.candidates.nodes.filter((item) => item.status === 'confirmed' || item.status === 'research lead');
    const ids = new Set(acceptedNodes.map((node) => node.id));
    const acceptedEdges = project.candidates.edges.filter((item) => (item.status === 'confirmed' || item.status === 'research lead') && ids.has(item.source) && ids.has(item.target));
    const acceptedSuggestions = connectionSuggestions.filter((edge) => edge.status === 'confirmed' && edge.verb.trim() && edge.source !== edge.target);
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
      const currentNodes = draft.graph.nodes.filter((node) => node.status !== 'rejected' && node.claimState !== 'retired');
      if (mapNodesOverlap(currentNodes)) {
        const repairedPositions = arrangedMapPositions(currentNodes, new Set(currentNodes.map((node) => node.scale)).size > 1);
        draft.graph.nodes.forEach((node) => {
          const position = repairedPositions.get(node.id);
          if (position) Object.assign(node, position);
        });
      }
      draft.graph.edges = [...priorEdges.filter((edge) => !edgeIds.has(edge.id)), ...nextEdges];
      const graphNodeIds = new Set(draft.graph.nodes.filter((node) => node.status !== 'rejected' && node.claimState !== 'retired').map((node) => node.id));
      const existingIds = new Set(draft.graph.edges.map((edge) => edge.id));
      const existingConnections = new Set(draft.graph.edges
        .filter((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired')
        .map((edge) => `${edge.source}\u0000${edge.verb.trim().toLocaleLowerCase()}\u0000${edge.target}`));
      acceptedSuggestions.forEach((edge) => {
        if (!graphNodeIds.has(edge.source) || !graphNodeIds.has(edge.target)) return;
        const key = `${edge.source}\u0000${edge.verb.trim().toLocaleLowerCase()}\u0000${edge.target}`;
        if (existingIds.has(edge.id) || existingConnections.has(key)) return;
        draft.graph.edges.push({ ...edge, verb: edge.verb.trim(), status: 'confirmed', claimState: 'student interpretation' });
        existingIds.add(edge.id);
        existingConnections.add(key);
      });
      draft.stage = 3;
      draft.furthestStage = Math.max(draft.furthestStage || 0, 3);
    }, 'graph.committed', `${acceptedNodes.length} nodes, ${acceptedEdges.length} relationships, and ${acceptedSuggestions.length} suggested connections confirmed`, 'student', {
      configurationSnapshot: snapshot,
      operations: {
        nodes: acceptedNodes.map((node) => node.id),
        edges: acceptedEdges.map((edge) => edge.id),
        suggestedEdges: acceptedSuggestions.map((edge) => edge.id),
        retiredNodes: [...reviewedNodeIds].filter((id) => !ids.has(id)),
      },
    });
    setConnectionPrompt('');
    setConnectionSuggestions([]);
    recordStageTransition(project.stage, 3, { completed: true });
    const pendingCount = [...project.candidates.nodes, ...project.candidates.edges].filter((item) => item.status === 'pending').length;
    const pendingNote = pendingCount ? ` ${pendingCount} undecided ${pendingCount === 1 ? 'item' : 'items'} stayed off the map.` : '';
    toast(acceptedNodes.length || acceptedSuggestions.length ? `Selections added to the map.${pendingNote}` : `Map opened without adding selections.${pendingNote}`);
  };

  const primary = async () => {
    switch (project.stage) {
      case 0: setStage(1, { completed: true }); break;
      case 1: prepareCandidates(); break;
      case 2: commitMapSelections(); break;
      case 3: setStage(4, { completed: true }); break;
      case 4:
        update((draft) => {
          if (!draft.completedScales.includes(draft.activeScale)) draft.completedScales.push(draft.activeScale);
          draft.stage = 0;
          draft.furthestStage = Math.max(draft.furthestStage || 0, 4);
          draft.preflight = null;
          draft.reflection = '';
        }, 'scale.cycle-completed', SCALES[project.activeScale].label);
        setConnectionPrompt('');
        setConnectionSuggestions([]);
        recordStageTransition(4, 0, { completed: true });
        toast('Cycle saved. Choose where to focus next.');
        break;
      default: break;
    }
  };

  const primaryLabel = (() => {
    if (project.stage === 0) return 'Review memo';
    if (project.stage === 1) return 'Choose nodes and connections';
    if (project.stage === 2) return 'Open map';
    if (project.stage === 3) return 'Revise and export';
    return 'Start another cycle';
  })();

  const backDisabled = project.stage === 0;
  const canPrimary = !reviewBusy && !connectionBusy;
  const replaceProject = useCallback((imported, fileName = 'Imported project') => {
    const next = structuredClone(imported);
    next.updatedAt = new Date().toISOString();
    next.events = [...(next.events || []), createEvent('project.imported', fileName)].slice(-500);
    setProject(next);
    setReviewBusy(null);
    setConnectionBusy(false);
    setConnectionPrompt('');
    setConnectionSuggestions([]);
    setMapPreviewOpen(false);
    logPrototype('project_imported', { stageIndex: next.stage, nodeCount: next.graph.nodes.length, edgeCount: next.graph.edges.length }, STAGES[next.stage].label);
    logPrototype('stage_viewed', { fromStage: projectRef.current.stage, toStage: next.stage }, STAGES[next.stage].label);
  }, [logPrototype]);
  const stageScreens = [
    <IntakeStage project={project} update={update} toast={toast} />,
    <ReviewMemoStage project={project} update={update} reviewBusy={reviewBusy} onGenerate={generateSuggestions} onContinue={primary} />,
    <CandidateStage project={project} update={update} toast={toast} prompt={connectionPrompt} onPromptChange={setConnectionPrompt} busy={connectionBusy} suggestions={connectionSuggestions} onSuggest={generateConnectionSuggestions} onEdit={editConnectionSuggestion} onDecision={decideConnectionSuggestion} onRefreshCandidates={refreshCandidatesFromMemo} refreshBusy={Boolean(reviewBusy)} />,
    <MapStage project={project} update={update} toast={toast} logPrototype={logPrototype} saveState={saveState} stageAnnotationDraft={stageAnnotationDraft} commitAnnotationDrafts={commitPendingAnnotations} flushSave={flushPersistence} />,
    <RevisionStage project={project} update={update} replaceProject={replaceProject} toast={toast} logPrototype={logPrototype} />,
  ];
  const screen = mapPreviewOpen ? stageScreens[3] : stageScreens[project.stage];
  const displayedStage = mapPreviewOpen ? 3 : project.stage;
  const returnFromMapPreview = () => {
    setMapPreviewOpen(false);
    logPrototype('map_preview_closed', { stageIndex: project.stage }, STAGES[project.stage].label);
  };
  const openMapPreview = () => {
    if (project.stage === 3) {
      workspaceRef.current?.focus();
      return;
    }
    setMapPreviewOpen(true);
    logPrototype('map_previewed', { stageIndex: project.stage, nodeCount: project.graph.nodes.length, edgeCount: project.graph.edges.length }, STAGES[project.stage].label);
  };

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
      setConnectionBusy(false);
      setWorkspaceStarted(false);
      setMapPreviewOpen(false);
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
          ? `Too many attempts. Try again${retryAfter ? ` in ${retryAfter} seconds` : ' shortly'}.`
          : unavailable ? 'The class workspace is unavailable. Try again later.' : 'That code did not work. Check it and try again.',
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
    setConnectionBusy(false);
    setWorkspaceStarted(false);
    setMapPreviewOpen(false);
    setAccessState({ status: 'required', access: null, message: 'Enter your class code to continue.', kind: 'info' });
  };

  const resumeProject = () => {
    setMapPreviewOpen(false);
    setWorkspaceStarted(true);
    logPrototype('project_resumed', { stageIndex: project.stage, nodeCount: project.graph.nodes.length, edgeCount: project.graph.edges.length }, STAGES[project.stage].label);
  };

  const startBlankProject = () => {
    const fromStage = projectRef.current.stage;
    const blank = createBlankProject();
    setProject(blank);
    setReviewBusy(null);
    setConnectionPrompt('');
    setConnectionSuggestions([]);
    setConnectionBusy(false);
    setMapPreviewOpen(false);
    setHasSavedProject(false);
    setWorkspaceStarted(true);
    setPendingNewProject(false);
    setModal(null);
    logPrototype('project_started', { stageIndex: 0, nodeCount: 0, edgeCount: 0 }, STAGES[0].label);
    logPrototype('stage_viewed', { fromStage, toStage: 0 }, STAGES[0].label);
    toast('Blank project created.');
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
    setSaveState((current) => ({ ...current, status: 'error', message: 'Changes are not being saved. Download a copy before closing this page.' }));
  };

  const preserveRecoveryAndEnableStorage = () => {
    try {
      if (saveState.recovery) {
        const recoveryKey = `systems-mapping-studio.recovery.${Date.now()}`;
        window.localStorage.setItem(recoveryKey, saveState.recovery);
      }
      setPersistenceBlocked(false);
      setSaveState((current) => ({ ...current, status: 'saving', message: 'Trying to save…', recovery: saveState.recovery }));
      if (pendingNewProject) startBlankProject();
      else setModal(null);
    } catch (error) {
      setSaveState((current) => ({ ...current, status: 'error', message: `Saving is still unavailable: ${error.message}` }));
    }
  };

  const recoveryModal = <Modal open={modal === 'storage'} title="Save recovery" onClose={() => setModal(null)}>
    <div className="confirm-panel">
      <p>{saveState.message}</p>
      <p>Choose how to continue. You can download a copy, keep working without saving, or try saving again.</p>
      <div className="button-stack">
        {saveState.recovery && <button type="button" className="button button--secondary" onClick={() => download('systems-mapping-prior-recovery.json', saveState.recovery)}>Download earlier copy</button>}
        <button type="button" className="button button--secondary" onClick={() => download(`${project.id}-recovery.json`, serializeProject(project))}>Download current project</button>
        <button type="button" className="button button--ghost" onClick={continueInMemory}>Keep working without saving</button>
        <button type="button" className="button" onClick={preserveRecoveryAndEnableStorage}>{saveState.recovery ? 'Save earlier copy and try again' : 'Try saving again'}</button>
      </div>
    </div>
  </Modal>;

  if (teacherOpen) return <div className="app-shell">
    <header className="app-header">
      <a href="#workspace" className="brand" aria-label="Systems Mapping Teacher Console home"><span className="brand__mark">sm</span><span><strong>Systems Mapping</strong><small>Teacher Console</small></span></a>
      <button className="text-button" type="button" onClick={() => setTeacherOpen(false)}><Icon name="back" />Back to class access</button>
    </header>
    <main ref={workspaceRef} tabIndex="-1" id="workspace" className="workspace workspace--teacher">
      <Suspense fallback={<p role="status">Loading Teacher Console…</p>}><TeacherDashboard onConfigurationChanged={refreshAfterTeacherChange} /></Suspense>
    </main>
  </div>;

  if (accessState.status !== 'granted') return <ClassAccessScreen state={accessState} onSubmit={submitClassCode} onTeacher={() => setTeacherOpen(true)} />;

  if (!workspaceStarted) return <>
    <ResumeScreen project={project} hasSavedProject={hasSavedProject} saveState={saveState} onResume={resumeProject} onStart={requestNewProject} onTeacher={() => setTeacherOpen(true)} onEndAccess={endAccess} onRecovery={() => setModal('storage')} />
    {recoveryModal}
    <Modal open={modal === 'new-project'} title="Start another project" onClose={() => { setPendingNewProject(false); setModal(null); }}>
      <div className="confirm-panel"><p>This replaces the current workspace with a blank project. Export the current project first if you need a separate copy.</p><div className="button-row"><button type="button" className="button button--ghost" onClick={() => { setPendingNewProject(false); setModal(null); }}>Cancel</button><button type="button" className="button" onClick={startBlankProject}>Start another project</button></div></div>
    </Modal>
  </>;

  return <div className="app-shell">
    <header className="app-header">
      <a href="#workspace" className="brand" aria-label="Systems Mapping home"><span className="brand__mark">sm</span><span><strong>Systems Mapping</strong><small>{project.title}</small></span></a>
      <div className="header-actions">
        {saveState.status === 'error' ? <button className="save-state save-state--error" type="button" onClick={() => setModal('storage')}><i />Save needs attention</button> : saveState.status === 'validation' ? <span className="save-state save-state--error"><i />Complete the current field to save</span> : saveState.status === 'saving' ? <span className="save-state"><i />Saving…</span> : null}
        <button className="text-button" type="button" aria-current={!mapPreviewOpen && project.stage === 3 ? 'page' : undefined} aria-label={mapPreviewOpen ? `Back to ${STAGES[project.stage].short}` : 'Map'} onClick={mapPreviewOpen ? returnFromMapPreview : openMapPreview}><Icon name={mapPreviewOpen ? 'back' : 'map'} />{mapPreviewOpen ? `Back to ${STAGES[project.stage].short}` : 'Map'}</button><button className="text-button" type="button" onClick={() => { setMapPreviewOpen(false); setTeacherOpen(true); }}><Icon name="settings" />Teacher Console</button><button className="text-button" type="button" onClick={() => setModal('stages')}><Icon name="menu" />Stages</button>
      </div>
    </header>
    <div className="sr-only" aria-live="polite">{mapPreviewOpen ? `Viewing map. Current stage remains ${STAGES[project.stage].label}.` : `Current section ${STAGES[project.stage].label}`}</div>
    <main ref={workspaceRef} tabIndex="-1" id="workspace" className={`workspace workspace--stage-${displayedStage}`}>{screen}</main>
    <footer className="app-footer">{mapPreviewOpen ? <><div className="footer-context"><strong>Map preview</strong><span>Current stage · {STAGES[project.stage].short}</span></div><div className="footer-actions"><button className="button" type="button" onClick={returnFromMapPreview}><Icon name="back" />Back to {STAGES[project.stage].short}</button></div></> : <><div className="footer-context"><strong>{STAGES[project.stage].label}</strong></div><div className="footer-actions"><button className="button button--ghost" type="button" disabled={backDisabled} onClick={() => setStage(project.stage - 1)}><Icon name="back" />Back</button><button className="button" type="button" disabled={!canPrimary} onClick={primary}>{primaryLabel}<Icon name="arrow" /></button></div></>}</footer>
    <Modal open={modal === 'stages'} title="Five stages" onClose={() => setModal(null)}>
      <ol className="stage-menu">{STAGES.map((stage, index) => {
        return <li key={stage.id}><button className={index === project.stage ? 'is-current' : ''} onClick={() => { if (setStage(index)) setModal(null); }}><strong>{stage.label}</strong>{index === project.stage ? <em>Current</em> : null}</button></li>;
      })}</ol>
    </Modal>
    <Modal open={modal === 'new-project'} title="Start a new project" onClose={() => setModal(null)}>
      <div className="confirm-panel"><p>This replaces the current workspace with a blank project. It does not delete any JSON, CSV, or Markdown files you already exported.</p><div className="button-row"><button type="button" className="button button--ghost" onClick={() => setModal(null)}>Cancel</button><button type="button" className="button" onClick={startBlankProject}>Start blank project</button></div></div>
    </Modal>
    {recoveryModal}
    <div className={`toast toast--${toastState?.type || 'success'} ${toastState ? 'is-visible' : ''}`} role="status" aria-live="polite">{toastState?.type === 'success' && <Icon name="check" />}{toastState?.message}</div>
  </div>;
}

export default App;
