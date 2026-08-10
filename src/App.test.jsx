import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import {
  configFingerprint,
  createDefaultProject,
  createPortableProject,
  extractCandidates,
  serializeProject,
  withDefaultNodeLayout,
} from './domain.js';

const STORAGE_KEY = 'systems-mapping-studio.project.v2';
const PERSIST_DEBOUNCE_MS = 450;

let studentSession;
let accessResponder;
let preflightEvaluationResponder;
let preflightPostResponder;
let preflightGetResponder;
let prototypeResponder;
let fetchMock;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function publicConfiguration(path) {
  const params = new URL(path, 'http://local.test').searchParams;
  const configKind = params.get('configKind');
  return {
    configKind,
    scale: params.get('scale'),
    fingerprint: `${configKind}-shared-fingerprint`,
    guardrailsFingerprint: `${configKind}-guardrails-fingerprint`,
    revision: 1,
    moduleVersions: Array.from({ length: 12 }, (_, index) => ({ id: `${configKind}-${index}`, revision: 1, fingerprint: `module-${index}` })),
  };
}

const EVALUATION_ID = '0123456789abcdefghijklmnopqrstuv';

function grantedAccess(offsetMs = 60 * 60 * 1000) {
  return {
    expiresAt: new Date(Date.now() + offsetMs).toISOString(),
    persistence: 'local-server',
    retentionDays: { evaluation: 1, pending: 30, decided: 180 },
    suggestionRuntime: { provider: 'deterministic', model: 'STEM Splitter' },
  };
}

function evaluationPayloadFixture(project = createDefaultProject()) {
  const config = project.configs.preflight;
  return {
    projectMetadata: {
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
    },
    activeScale: project.activeScale,
    inquiry: project.inquiry,
    sourceRecord: Object.fromEntries(['id', 'title', 'author', 'date', 'sourceType', 'location', 'rights', 'sensitive', 'consent', 'evidenceOwnership'].map((key) => [key, project.submission[key]])),
    sourceMaterial: project.submission.text,
    projectOverlay: {
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
    },
  };
}

function evaluationRecord(payload = evaluationPayloadFixture(), overrides = {}) {
  const createdAt = overrides.createdAt || '2027-01-15T08:00:00.000Z';
  const { customInstructions: _customInstructions, ...storedOverlay } = payload.projectOverlay;
  const configSnapshot = overrides.configSnapshot || {
    kind: 'preflight',
    activeScale: payload.activeScale,
    capturedAt: createdAt,
    shared: {
      fingerprint: 'preflight-shared-fingerprint',
      revision: 3,
      moduleVersions: Array.from({ length: 12 }, (_, index) => ({ id: `teacher-module-${index}`, revision: index + 1, fingerprint: `teacher-module-fingerprint-${index}` })),
    },
    projectOverlay: storedOverlay,
    effectiveFingerprint: 'effective-server-fingerprint',
  };
  const redirects = overrides.redirects || [{
    action: 'Clarify which actor performs the referral.',
    evidenceExcerpt: 'The school refers the student to the committee.',
  }];
  return {
    id: EVALUATION_ID,
    redirects: structuredClone(redirects),
    configSnapshot,
    runtime: overrides.runtime || { provider: 'deterministic', model: 'STEM Splitter', createdAt },
    createdAt,
    expiresAt: overrides.expiresAt || '2027-01-16T08:00:00.000Z',
  };
}

function redirectFixture() {
  return [{
    action: 'Add the missing source title and location.',
    evidenceExcerpt: 'The memo begins without a complete source record.',
  }, {
    action: 'Separate the source claim from your interpretation.',
    evidenceExcerpt: 'According to the memo, the school administers services.',
  }, {
    action: 'Name a second actor-to-actor relationship.',
    evidenceExcerpt: 'The school refers the student to the committee.',
  }];
}

function reviewRecord(projectId = 'project_cali_demo', overrides = {}) {
  return {
    id: 'review_0123456789abcdefghijklmnop',
    projectId,
    status: 'pending',
    decision: null,
    revision: 1,
    submittedAt: '2026-08-09T12:00:00.000Z',
    updatedAt: '2026-08-09T12:00:00.000Z',
    reviewedAt: null,
    instructorAnnotation: null,
    focusedQuestion: null,
    ...overrides,
  };
}

function projectAwaitingReview(overrides = {}) {
  const project = createDefaultProject();
  const evaluation = evaluationRecord(evaluationPayloadFixture(project));
  project.preflight = {
    redirects: structuredClone(evaluation.redirects),
    configurationSnapshot: structuredClone(evaluation.configSnapshot),
    evaluation: {
      evaluationId: evaluation.id,
      runtime: evaluation.runtime,
      createdAt: evaluation.createdAt,
      expiresAt: evaluation.expiresAt,
    },
    review: {
      submissionId: 'review_0123456789abcdefghijklmnop',
      status: 'pending',
      revision: 1,
      submittedAt: '2026-08-09T12:00:00.000Z',
    },
  };
  project.stage = 3;
  project.furthestStage = 3;
  return Object.assign(project, overrides);
}

function defaultFetch(path, options = {}) {
  const requestPath = String(path);
  if (requestPath === '/api/student/session') {
    const access = typeof studentSession === 'function' ? studentSession() : studentSession;
    return jsonResponse({ access });
  }
  if (requestPath === '/api/student/access') {
    const { code } = JSON.parse(options.body);
    return accessResponder(code);
  }
  if (requestPath === '/api/student/logout') return jsonResponse({ ok: true });
  if (requestPath === '/api/preflight/evaluations' && options.method === 'POST') return preflightEvaluationResponder(JSON.parse(options.body));
  if (requestPath === '/api/preflight/submissions' && options.method === 'POST') return preflightPostResponder(JSON.parse(options.body));
  if (requestPath.startsWith('/api/preflight/submissions/')) return preflightGetResponder(decodeURIComponent(requestPath.split('/').at(-1)));
  if (requestPath.startsWith('/api/config/public?')) return jsonResponse(publicConfiguration(requestPath));
  if (requestPath === '/api/prototype/events') return prototypeResponder(options);
  return jsonResponse({ error: `Unexpected fetch: ${requestPath}` }, 500);
}

function seedProject(project = createDefaultProject(), key = STORAGE_KEY) {
  window.localStorage.setItem(key, serializeProject(project));
  return project;
}

function storedProject() {
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value ? JSON.parse(value) : null;
}

async function showResumeScreen() {
  expect(await screen.findByRole('heading', { name: /Keep working on your map|Start a systems map/ })).toBeVisible();
}

async function resumeSavedProject(project = createDefaultProject()) {
  seedProject(project);
  render(<App />);
  await showResumeScreen();
  fireEvent.click(screen.getByRole('button', { name: /^Continue to / }));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Keep working on your map.' })).not.toBeInTheDocument());
  return project;
}

function makeMapProject() {
  const project = createDefaultProject();
  project.candidates = { nodes: [], edges: [] };
  project.graph = extractCandidates(project.submission);
  project.graph.nodes.forEach((node) => {
    node.status = 'confirmed';
    node.claimState = 'student interpretation';
  });
  project.graph.edges.forEach((edge) => {
    edge.status = 'confirmed';
    edge.claimState = 'student interpretation';
  });
  project.releasedScales = ['micro', 'meso', 'macro'];
  project.activeScale = 'macro';
  project.stage = 5;
  project.furthestStage = 5;
  return project;
}

async function openMapProject(project = makeMapProject()) {
  await resumeSavedProject(project);
  expect(await screen.findByRole('heading', { name: 'Build the map' })).toBeVisible();
  return project;
}

function annotationStatus(field) {
  const ids = field.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) || [];
  const statusId = ids.find((id) => id.startsWith('annotation-status_'));
  return statusId ? document.getElementById(statusId) : null;
}

function selectAnnotationTarget(target) {
  if (target === 'node') return screen.getByRole('textbox', { name: /^Analysis/ });
  if (target === 'edge') {
    fireEvent.click(screen.getByRole('tab', { name: 'Relationships' }));
    const panel = screen.getByRole('tabpanel', { name: 'Relationships' });
    const picker = within(panel).getByLabelText('Relationship list');
    fireEvent.click(within(picker).getAllByRole('button')[0]);
    return screen.getByRole('textbox', { name: /^Relationship annotation/ });
  }
  fireEvent.click(screen.getByRole('tab', { name: 'Map' }));
  return screen.getByRole('textbox', { name: /^Evolving-map annotation/ });
}

function storedAnnotation(target, project) {
  const stored = storedProject();
  if (target === 'node') return stored.graph.nodes.find((node) => node.id === project.graph.nodes[0].id).annotations.analytical.text;
  if (target === 'edge') return stored.graph.edges.find((edge) => edge.id === project.graph.edges[0].id).annotation.text;
  return stored.mapAnnotation.text;
}

function eventRequests(name) {
  return fetchMock.mock.calls
    .filter(([path]) => String(path) === '/api/prototype/events')
    .map(([, options]) => ({ options, body: JSON.parse(options.body) }))
    .filter(({ body }) => body.event === name);
}

function installAnimationFrameStub() {
  Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, writable: true, value: vi.fn(() => 1) });
  Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, writable: true, value: vi.fn() });
}

function installPhoneLayout() {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 });
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true,
    media: '(max-width: 600px)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

function viewportTransform() {
  const value = document.querySelector('.viewport-layer')?.getAttribute('transform') || '';
  const match = value.match(/^translate\((-?[\d.]+) (-?[\d.]+)\) scale\(([\d.]+)\)$/);
  if (!match) throw new Error(`Unexpected viewport transform: ${value}`);
  return { panX: Number(match[1]), panY: Number(match[2]), zoom: Number(match[3]) };
}

function bytesContain(haystack, needle) {
  outer: for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[start + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}

describe('Systems Mapping workflow', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1024 });
    window.localStorage.clear();
    studentSession = () => grantedAccess();
    accessResponder = (code) => code === '101'
      ? jsonResponse({ access: grantedAccess() }, 201)
      : jsonResponse({ error: 'Invalid class code.' }, 401);
    preflightEvaluationResponder = (body) => jsonResponse({ evaluation: evaluationRecord(body) }, 201);
    preflightPostResponder = () => jsonResponse({ submission: reviewRecord() }, 201);
    preflightGetResponder = () => jsonResponse({ submission: reviewRecord() });
    prototypeResponder = () => jsonResponse({ accepted: true }, 202);
    fetchMock = vi.fn(defaultFetch);
    vi.stubGlobal('fetch', fetchMock);
    installAnimationFrameStub();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('requires an async class-code exchange, keeps rejected codes out of storage, and resumes the saved stage after success', async () => {
    const project = createDefaultProject();
    project.stage = 1;
    project.furthestStage = 1;
    seedProject(project);
    studentSession = null;

    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Enter your class code.' })).toBeVisible();
    const code = screen.getByRole('textbox', { name: 'Class code' });
    fireEvent.change(code, { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That class code was not accepted');
    expect(code).toHaveValue('');
    expect(window.localStorage.getItem('classCode')).toBeNull();
    expect(window.sessionStorage.getItem('classCode')).toBeNull();

    fireEvent.change(code, { target: { value: '101' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Keep working on your map.' })).toBeVisible();
    expect(screen.getByText(/Stage 2 of 7/)).toHaveTextContent('Add a source');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to add a source' }));
    expect(await screen.findByRole('heading', { name: 'Add a memo and source record.' })).toBeVisible();

    const attempts = fetchMock.mock.calls.filter(([path]) => String(path) === '/api/student/access');
    expect(attempts.map(([, options]) => JSON.parse(options.body))).toEqual([{ code: '999' }, { code: '101' }]);
    expect(attempts.every(([, options]) => options.credentials === 'same-origin')).toBe(true);
  });

  it('passes a hosted high-entropy alphanumeric class code unchanged', async () => {
    const hostedCode = 'CALI-7qN4vP9xR2mK8sT';
    seedProject(createDefaultProject());
    studentSession = null;
    accessResponder = (code) => code === hostedCode
      ? jsonResponse({ access: { ...grantedAccess(), persistence: 'course-server', suggestionRuntime: { provider: 'ollama-cloud', model: 'gpt-oss:120b', maxSourceBytes: 131072 } } }, 201)
      : jsonResponse({ error: 'Invalid class code.' }, 401);
    render(<App />);
    const input = await screen.findByRole('textbox', { name: 'Class code' });
    expect(input).toHaveAttribute('maxlength', '32');
    expect(input).not.toHaveAttribute('pattern');
    fireEvent.change(input, { target: { value: hostedCode } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await showResumeScreen();
    expect(screen.getByText(/sent to the course server/i)).toBeVisible();
    const request = fetchMock.mock.calls.find(([path]) => String(path) === '/api/student/access');
    expect(JSON.parse(request[1].body)).toEqual({ code: hostedCode });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to choose a scale' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText(/sends the memo, inquiry, source metadata, active teacher prompt, and project overlay from the course server to Ollama Cloud/i)).toBeVisible();
    expect(screen.getByText(/provider model gpt-oss:120b/i)).toBeVisible();
    expect(screen.getByText(/unsubmitted evaluation expires after 1 day/i)).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Model setup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview effective prompt' }));
    expect(screen.getByText(/shared teacher base and project overlay govern Ollama Cloud suggestion generation/i)).toBeVisible();
    expect(document.body).not.toHaveTextContent('Local deterministic · zero egress');
  });

  it('starts a blank project only after a granted session and explicit start action', async () => {
    render(<App />);
    await showResumeScreen();
    expect(screen.getByRole('heading', { name: 'Start a systems map.' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Choose the current scale.' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start a project' }));
    expect(await screen.findByRole('heading', { name: 'Choose the current scale.' })).toBeVisible();
    expect(screen.getByText('Untitled systems map', { selector: '.brand small' })).toBeVisible();
    await waitFor(() => expect(storedProject()).toMatchObject({ title: 'Untitled systems map', stage: 0 }));
  });

  it('expires an ISO-timestamped class grant at the exact fake-clock boundary without erasing local project bytes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T16:00:00.000Z'));
    const project = seedProject(createDefaultProject());
    const priorBytes = window.localStorage.getItem(STORAGE_KEY);
    studentSession = { expiresAt: '2026-08-08T16:01:00.000Z' };

    render(<App />);
    for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('heading', { name: 'Keep working on your map.' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to choose a scale' }));
    expect(screen.getByRole('heading', { name: 'Choose the current scale.' })).toBeVisible();

    act(() => vi.advanceTimersByTime(59_999));
    expect(screen.getByRole('heading', { name: 'Choose the current scale.' })).toBeVisible();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('heading', { name: 'Enter your class code.' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Class access expired');
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY))).toMatchObject({
      id: project.id,
      title: project.title,
      stage: project.stage,
      graph: project.graph,
    });
    expect(JSON.parse(priorBytes).id).toBe(project.id);
  });

  it('uses canonical stage labels and renders annotation guidance without checklist identifiers or scores', async () => {
    preflightEvaluationResponder = (body) => jsonResponse({
      evaluation: evaluationRecord(body, { redirects: redirectFixture() }),
    }, 201);
    await resumeSavedProject();
    expect(screen.getByRole('heading', { name: 'Choose the current scale.' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Add a memo and source record.' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Project title' })).toHaveValue('NYC systems and assets map');
    fireEvent.change(screen.getByRole('textbox', { name: 'Project title' }), { target: { value: 'Family service access map' } });
    expect(screen.getByText('Family service access map', { selector: '.brand small' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Guiding inquiry' })).toHaveValue('How do systems shape access to special-education services in NYC?');
    expect(screen.getByRole('textbox', { name: 'Guiding inquiry' })).toHaveAttribute('maxlength', '8000');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Review suggestions beside the memo.' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Stages' }));
    const stageMenu = screen.getByRole('dialog', { name: 'Stages' });
    ['Choose a scale', 'Add a source', 'Review suggestions', "Check your instructor's response", 'Choose what to map', 'Build the map', 'Revise and export'].forEach((label) => expect(within(stageMenu).getByText(label)).toBeVisible());
    fireEvent.click(within(stageMenu).getByRole('button', { name: 'Close Stages' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate suggestions' }));
    const guidance = await screen.findByRole('region', { name: 'Return to the source' });
    expect(within(guidance).getAllByRole('article')).toHaveLength(3);
    expect(within(guidance).getByRole('heading', { name: 'Add the missing source title and location.' })).toBeVisible();
    expect(within(guidance).getByRole('heading', { name: 'Separate the source claim from your interpretation.' })).toBeVisible();
    expect(within(guidance).getByRole('heading', { name: 'Name a second actor-to-actor relationship.' })).toBeVisible();
    expect(within(guidance).getByText('According to the memo, the school administers services.')).toBeVisible();
    expect(within(guidance).queryByText('Keep this completed item as written.')).not.toBeInTheDocument();
    expect(within(guidance).queryByText('Narrow the inquiry to one decision point.')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What the memo establishes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What the model suggests' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What remains uncertain' })).not.toBeInTheDocument();
    expect(screen.getByText('Send to your instructor')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Add a note.' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /Note for instructor/ })).toHaveAttribute('maxlength', '4000');
    const visibleStageText = document.querySelector('.workspace').textContent;
    expect(visibleStageText).not.toMatch(/\b(?:H[1-4]|C[1-8])\b/);
    expect(visibleStageText).not.toMatch(/\b(?:pass|conditional|hold|score|scoring|criterion|criteria|checklist|hard gate)\b/i);
    fireEvent.click(screen.getByRole('tab', { name: 'Model setup' }));
    expect(screen.getByRole('tab', { name: 'Suggestion model' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Base-model reference')).toHaveValue('STEM Splitter');
    expect(screen.getByRole('textbox', { name: /Custom project instructions/ })).toHaveAttribute('maxlength', '16000');
    expect(screen.getByText('STEM Splitter · deterministic')).toBeVisible();
    expect(screen.getByText(/teacher prompt and project-instruction edits are provenance only and do not change the deterministic rule set/i)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Preview effective prompt' }));
    expect(screen.getByText(/prompt edits are recorded as provenance only; they do not change the fixed rule set/i)).toBeVisible();
    expect(screen.queryByText(/shared teacher base and project overlay govern Ollama Cloud/i)).not.toBeInTheDocument();
  });

  it('shows no praise or inventory when the server returns no redirect', async () => {
    const project = createDefaultProject();
    project.stage = 2;
    project.furthestStage = 2;
    preflightEvaluationResponder = (body) => jsonResponse({ evaluation: evaluationRecord(body, { redirects: [] }) }, 201);
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate suggestions' }));
    const guidance = await screen.findByRole('region', { name: 'Return to the source' });
    expect(within(guidance).getByText('Use your note to tell the instructor where you want feedback.')).toBeVisible();
    expect(within(guidance).queryAllByRole('article')).toHaveLength(0);
    expect(guidance.textContent).not.toMatch(/\b(?:pass|complete|met|score|criterion|checklist)\b/i);
  });

  it('rejects more than three server redirects without persisting them', async () => {
    const project = createDefaultProject();
    project.stage = 2;
    project.furthestStage = 2;
    preflightEvaluationResponder = (body) => jsonResponse({
      evaluation: evaluationRecord(body, {
        redirects: Array.from({ length: 4 }, (_, index) => ({ action: `Return to source point ${index + 1}.` })),
      }),
    }, 201);
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate suggestions' }));
    expect(await screen.findByText(/no more than 3 redirects/i)).toBeVisible();
    expect(storedProject().preflight).toBeNull();
  });

  it('uses the exact authoritative evaluation and capability-only submission envelopes, then restores the pending gate after reload', async () => {
    await resumeSavedProject();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate suggestions' }));
    expect(await screen.findByRole('heading', { name: 'Return to the source' })).toBeVisible();

    const evaluationRequest = fetchMock.mock.calls.find(([path, options]) => String(path) === '/api/preflight/evaluations' && options.method === 'POST');
    const evaluationBody = JSON.parse(evaluationRequest[1].body);
    expect(Object.keys(evaluationBody).sort()).toEqual(['activeScale', 'inquiry', 'projectMetadata', 'projectOverlay', 'sourceMaterial', 'sourceRecord'].sort());
    expect(Object.keys(evaluationBody.projectMetadata).sort()).toEqual(['author', 'clientUpdatedAt', 'date', 'furthestStage', 'id', 'projectId', 'schemaVersion', 'sharingTier', 'sourceTitle', 'sourceType', 'stage', 'submissionId', 'title'].sort());
    expect(Object.keys(evaluationBody.sourceRecord)).toEqual(['id', 'title', 'author', 'date', 'sourceType', 'location', 'rights', 'sensitive', 'consent', 'evidenceOwnership']);
    expect(evaluationBody).toMatchObject({ activeScale: 'micro', sourceMaterial: createDefaultProject().submission.text });
    expect(evaluationBody.projectOverlay).toMatchObject({ baseModel: 'STEM Splitter', customInstructions: createDefaultProject().configs.preflight.customInstructions, revision: 1 });
    expect(evaluationBody.projectOverlay).not.toHaveProperty('fixedPrompt');
    await waitFor(() => expect(storedProject().preflight?.evaluation?.evaluationId).toBe(EVALUATION_ID));
    const storedPreflight = storedProject().preflight;
    expect(Object.keys(storedPreflight).sort()).toEqual(['configurationSnapshot', 'evaluation', 'redirects', 'review']);
    expect(storedPreflight.redirects).toEqual([{ action: 'Clarify which actor performs the referral.', evidenceExcerpt: 'The school refers the student to the committee.' }]);
    expect(storedPreflight).not.toHaveProperty('hard');
    expect(storedPreflight).not.toHaveProperty('scored');
    expect(storedPreflight).not.toHaveProperty('outcome');
    expect(storedPreflight.configurationSnapshot.projectOverlay).not.toHaveProperty('customInstructions');
    expect(storedPreflight.configurationSnapshot.projectOverlay).not.toHaveProperty('fixedPrompt');
    const portablePreflight = createPortableProject(storedProject()).preflight;
    expect(Object.keys(portablePreflight).sort()).toEqual(['configurationSnapshot', 'evaluation', 'redirects', 'review']);
    expect(portablePreflight.evaluation.evaluationId).toBe('[redacted]');

    fireEvent.change(screen.getByRole('textbox', { name: /Note for instructor/ }), { target: { value: 'Please review the uncertainty around referrals.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send for instructor review' }));
    expect(await screen.findByRole('heading', { name: 'Your suggestions are awaiting review.' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Check instructor response' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Generate candidates' })).not.toBeInTheDocument();

    const request = fetchMock.mock.calls.find(([path, options]) => String(path) === '/api/preflight/submissions' && options.method === 'POST');
    const body = JSON.parse(request[1].body);
    expect(body).toEqual({ evaluationId: EVALUATION_ID, studentAnnotation: 'Please review the uncertainty around referrals.' });
    expect(body).not.toHaveProperty('suggestion');
    expect(body).not.toHaveProperty('configSnapshot');
    await waitFor(() => expect(storedProject().preflight.review).toMatchObject({ submissionId: 'review_0123456789abcdefghijklmnop', status: 'pending', revision: 1 }));
    expect(storedProject().preflight.evaluation).toMatchObject({ evaluationId: EVALUATION_ID, runtime: { provider: 'deterministic', model: 'STEM Splitter' } });
    expect(storedProject().candidates).toEqual({ nodes: [], edges: [] });

    cleanup();
    render(<App />);
    await showResumeScreen();
    expect(screen.getByText(/Stage 4 of 7/)).toHaveTextContent("Check your instructor's response");
    fireEvent.click(screen.getByRole('button', { name: "Continue to check your instructor's response" }));
    expect(await screen.findByRole('heading', { name: 'Your suggestions are awaiting review.' })).toBeVisible();
  });

  it('blocks an oversized evaluation request without truncating the local memo', async () => {
    const project = createDefaultProject();
    project.submission.text = '😀'.repeat(180_000);
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate suggestions' }));
    expect(await screen.findByText(/suggestion evaluation request is too large to send/i)).toBeVisible();
    expect(screen.getByText(/Shorten the memo or use a focused source excerpt/i)).toBeVisible();
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(0);
    expect(storedProject().submission.text).toBe(project.submission.text);
  });

  it('enforces the reported Ollama Cloud UTF-8 source boundary before provider egress', async () => {
    const project = createDefaultProject();
    project.submission.text = '😀'.repeat(33_000);
    project.stage = 2;
    project.furthestStage = 2;
    studentSession = () => ({
      ...grantedAccess(),
      persistence: 'course-server',
      suggestionRuntime: { provider: 'ollama-cloud', model: 'gpt-oss:120b', maxSourceBytes: 131072 },
    });
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate suggestions' }));
    expect(await screen.findByText(/too large for the reported Ollama Cloud runtime/i)).toBeVisible();
    expect(screen.getByText(/131,072 UTF-8 bytes maximum/i)).toBeVisible();
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(0);
    expect(storedProject().submission.text).toBe(project.submission.text);
  });

  it('enforces the Ollama Cloud UTF-8 inquiry boundary before provider egress', async () => {
    const project = createDefaultProject();
    project.inquiry = '😀'.repeat(2_050);
    project.stage = 2;
    project.furthestStage = 2;
    studentSession = () => ({
      ...grantedAccess(),
      persistence: 'course-server',
      suggestionRuntime: { provider: 'ollama-cloud', model: 'gpt-oss:120b', maxSourceBytes: 131072 },
    });
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate suggestions' }));
    expect(await screen.findByText(/guiding inquiry is too large for the reported Ollama Cloud runtime/i)).toBeVisible();
    expect(screen.getByText(/8,192 UTF-8 bytes maximum/i)).toBeVisible();
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(0);
  });

  it('keeps oversized imported project instructions out of the evaluation request', async () => {
    const project = createDefaultProject();
    project.configs.preflight.customInstructions = 'x'.repeat(16_001);
    project.configs.preflight.fingerprint = configFingerprint(project.configs.preflight);
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate suggestions' }));
    expect(await screen.findByText(/custom instructions must be 16,000 characters or fewer before generating suggestions/i)).toBeVisible();
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(0);
  });

  it('keeps the project editable and reports an authoritative evaluation failure without creating local suggestions', async () => {
    const project = createDefaultProject();
    project.stage = 2;
    project.furthestStage = 2;
    preflightEvaluationResponder = () => jsonResponse({ error: 'Suggestion generation is temporarily unavailable.' }, 502);
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate suggestions' }));
    expect(await screen.findByText('Suggestion generation is temporarily unavailable.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Generate suggestions' })).toBeEnabled();
    expect(storedProject().preflight).toBeNull();
  });

  it('requires fresh generation when the stored authoritative evaluation has expired', async () => {
    const project = createDefaultProject();
    const payload = evaluationPayloadFixture(project);
    const evaluation = evaluationRecord(payload, {
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });
    project.preflight = {
      redirects: structuredClone(evaluation.redirects),
      configurationSnapshot: structuredClone(evaluation.configSnapshot),
      evaluation: {
        evaluationId: evaluation.id,
        runtime: evaluation.runtime,
        createdAt: evaluation.createdAt,
        expiresAt: evaluation.expiresAt,
      },
      review: null,
    };
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);
    expect(screen.getByRole('button', { name: 'Generate fresh suggestions' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Generate fresh suggestions before sending');
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/submissions')).toHaveLength(0);
  });

  it('marks a consumed or unavailable evaluation stale and prompts fresh generation', async () => {
    const project = createDefaultProject();
    project.stage = 2;
    project.furthestStage = 2;
    preflightPostResponder = () => jsonResponse({ error: 'The preflight evaluation is unavailable, expired, or already used.' }, 409);
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate suggestions' }));
    expect(await screen.findByRole('heading', { name: 'Return to the source' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Send for instructor review' }));
    expect(await screen.findByText(/evaluation expired or was already used/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Generate fresh suggestions' })).toBeVisible();
    await waitFor(() => expect(storedProject().preflight.evaluation.evaluationId).toBe('[unavailable]'));
  });

  it('stores the shared and project configuration snapshots with a preflight event', async () => {
    await resumeSavedProject();
    await waitFor(() => {
      const configCalls = fetchMock.mock.calls.filter(([path]) => String(path).startsWith('/api/config/public?'));
      expect(configCalls).toHaveLength(2);
    });
    await waitFor(() => expect(storedProject().teacherGovernance?.preflight?.moduleVersions).toHaveLength(12));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate suggestions' }));
    expect(await screen.findByRole('heading', { name: 'Return to the source' })).toBeVisible();
    await waitFor(() => {
      const event = [...storedProject().events].reverse().find((entry) => entry.action === 'preflight.completed');
      expect(event.configurationSnapshot.shared).toMatchObject({ fingerprint: 'preflight-shared-fingerprint', revision: 3 });
      expect(event.configurationSnapshot.shared.moduleVersions).toHaveLength(12);
      expect(event.configurationSnapshot.projectOverlay).toMatchObject({ profileVersion: '1.0.0', outputSchemaVersion: 'systems-mapping.preflight-result.v1' });
      expect(event.configurationSnapshot.projectOverlay).not.toHaveProperty('fixedPrompt');
      expect(event.configurationSnapshot.projectOverlay).not.toHaveProperty('customInstructions');
      expect(event.configurationSnapshot.effectiveFingerprint).toBe('effective-server-fingerprint');
      expect(event.runtime).toMatchObject({ provider: 'deterministic', model: 'STEM Splitter' });
    });
  });

  it.each([
    ['approve', undefined, 'The source grounding is sufficient.'],
    ['revise_and_approve', 'Treat the referral as a contested handoff, then confirm each candidate.', 'Proceed with the bounded revision in mind.'],
  ])('uses an instructor %s response as guidance without changing memo, graph, or stored redirects', async (decision, focusedQuestion, instructorAnnotation) => {
    const project = projectAwaitingReview();
    const originalMemo = project.submission.text;
    const originalGraph = structuredClone(project.graph);
    const originalRedirects = structuredClone(project.preflight.redirects);
    preflightGetResponder = () => jsonResponse({ submission: reviewRecord(project.id, {
      status: 'approved',
      decision,
      revision: 2,
      reviewedAt: '2026-08-09T13:00:00.000Z',
      instructorAnnotation,
      focusedQuestion: focusedQuestion ?? null,
    }) });

    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Check instructor response' }));
    expect(await screen.findByRole('heading', { name: 'Your instructor responded.' })).toBeVisible();
    expect(screen.getByText(instructorAnnotation)).toBeVisible();
    if (focusedQuestion) {
      expect(screen.getByRole('heading', { name: 'Question from your instructor' })).toBeVisible();
      expect(screen.getByText(focusedQuestion)).toBeVisible();
    }
    expect(screen.queryByRole('heading', { name: 'Revised suggestion' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate candidates' })).toBeVisible();
    await waitFor(() => expect(storedProject().preflight.review).toMatchObject({ status: 'approved', decision, revision: 2 }));
    expect(storedProject().submission.text).toBe(originalMemo);
    expect(storedProject().graph).toEqual(originalGraph);
    expect(storedProject().preflight.redirects).toEqual(originalRedirects);

    fireEvent.click(screen.getByRole('button', { name: 'Generate candidates' }));
    expect(await screen.findByRole('heading', { name: 'Review graph candidates.' })).toBeVisible();
  });

  it('returns a rejected review to source intake with instructor annotation and no silent memo or graph edits', async () => {
    const project = projectAwaitingReview();
    const originalMemo = project.submission.text;
    const originalGraph = structuredClone(project.graph);
    preflightGetResponder = () => jsonResponse({ submission: reviewRecord(project.id, {
      status: 'rejected',
      decision: 'reject',
      revision: 2,
      reviewedAt: '2026-08-09T13:00:00.000Z',
      instructorAnnotation: 'Clarify which actor performs the second handoff, then submit again.',
    }) });

    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Check instructor response' }));
    expect(await screen.findByRole('heading', { name: 'Add a memo and source record.' })).toBeVisible();
    expect(screen.getByText('Clarify which actor performs the second handoff, then submit again.')).toBeVisible();
    await waitFor(() => expect(storedProject()).toMatchObject({ stage: 1, preflight: { review: { status: 'rejected', decision: 'reject', revision: 2 } } }));
    expect(storedProject().submission.text).toBe(originalMemo);
    expect(storedProject().graph).toEqual(originalGraph);
    fireEvent.change(screen.getByRole('textbox', { name: /Memo text/ }), { target: { value: `${originalMemo}\nStudent-authored clarification.` } });
    expect(screen.getByText('Clarify which actor performs the second handoff, then submit again.')).toBeVisible();
  });

  it('recovers a pending review after class-session renewal using only the stored review capability', async () => {
    const project = projectAwaitingReview();
    seedProject(project);
    studentSession = null;
    preflightGetResponder = (submissionId) => jsonResponse({ submission: reviewRecord(project.id, {
      id: submissionId,
      status: 'approved',
      decision: 'approve',
      revision: 2,
      reviewedAt: '2026-08-09T13:00:00.000Z',
      instructorAnnotation: 'Renewed access can retrieve this minimized status.',
    }) });
    render(<App />);
    const code = await screen.findByRole('textbox', { name: 'Class code' });
    fireEvent.change(code, { target: { value: '101' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await showResumeScreen();
    fireEvent.click(screen.getByRole('button', { name: "Continue to check your instructor's response" }));
    fireEvent.click(screen.getByRole('button', { name: 'Check instructor response' }));
    expect(await screen.findByText('Renewed access can retrieve this minimized status.')).toBeVisible();
    const getRequest = fetchMock.mock.calls.find(([path]) => String(path).startsWith('/api/preflight/submissions/review_'));
    expect(String(getRequest[0])).toBe(`/api/preflight/submissions/${project.preflight.review.submissionId}`);
  });

  it('keeps a newly valid class grant active when a stale prototype 401 reads back a valid session', async () => {
    seedProject(createDefaultProject());
    let sessionReads = 0;
    studentSession = () => {
      sessionReads += 1;
      return sessionReads === 1 ? null : grantedAccess();
    };
    prototypeResponder = () => jsonResponse({ error: 'Expired prototype event session.' }, 401);
    render(<App />);
    const code = await screen.findByRole('textbox', { name: 'Class code' });
    fireEvent.change(code, { target: { value: '101' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await showResumeScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to choose a scale' }));
    expect(await screen.findByRole('heading', { name: 'Choose the current scale.' })).toBeVisible();
    await waitFor(() => expect(sessionReads).toBeGreaterThanOrEqual(2));
    expect(screen.queryByRole('heading', { name: 'Enter your class code.' })).not.toBeInTheDocument();
  });

  it('expires workspace access after a prototype 401 only when session readback is null', async () => {
    seedProject(createDefaultProject());
    let sessionReads = 0;
    studentSession = () => {
      sessionReads += 1;
      return sessionReads === 1 ? grantedAccess() : null;
    };
    prototypeResponder = () => jsonResponse({ error: 'Expired prototype event session.' }, 401);
    render(<App />);
    await showResumeScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to choose a scale' }));
    expect(await screen.findByRole('heading', { name: 'Enter your class code.' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Class access expired');
    expect(sessionReads).toBeGreaterThanOrEqual(2);
  });

  it('does not overwrite invalid saved bytes until the user explicitly chooses a recovery action', async () => {
    const invalidBytes = '{"schemaVersion":2,"title":';
    window.localStorage.setItem(STORAGE_KEY, invalidBytes);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    render(<App />);
    await showResumeScreen();
    expect(screen.getByRole('button', { name: /Local recovery needs attention/ })).toBeVisible();
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, PERSIST_DEBOUNCE_MS + 30)); });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(invalidBytes);
    expect(setItem.mock.calls.filter(([key]) => key === STORAGE_KEY)).toHaveLength(0);
  });

  it('reports local persistence failure and offers recovery instead of claiming success', async () => {
    const project = seedProject(createDefaultProject());
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    render(<App />);
    await showResumeScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to choose a scale' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const recovery = await screen.findByRole('button', { name: 'Local save needs attention' });
    fireEvent.click(recovery);
    expect(screen.getByRole('dialog', { name: 'Local save recovery' })).toBeVisible();
    expect(screen.getByText(/No invalid or unavailable storage value will be overwritten automatically/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Download current project' })).toBeVisible();
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)).id).toBe(project.id);
  });

  it('retires a previously committed candidate when the reviewer later rejects it', async () => {
    const project = createDefaultProject();
    const extracted = extractCandidates(project.submission);
    project.candidates = { nodes: extracted.nodes.slice(0, 2), edges: [] };
    project.graph = {
      nodes: project.candidates.nodes.map((node) => ({ ...node, status: 'confirmed', claimState: 'student interpretation' })),
      edges: [],
    };
    project.stage = 4;
    project.furthestStage = 4;
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('tab', { name: /Nodes · 2/ }));
    const rows = screen.getAllByRole('article');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Reject' }));
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Accept' }));
    fireEvent.click(screen.getByRole('button', { name: 'Build confirmed map' }));
    await waitFor(() => {
      expect(storedProject().graph.nodes.find((node) => node.id === project.candidates.nodes[0].id)).toMatchObject({ status: 'rejected', claimState: 'retired' });
    });
  });

  it('lays out the accepted subset on a first build without changing later saved positions', async () => {
    const project = createDefaultProject();
    const accepted = extractCandidates(project.submission).nodes.slice(0, 4).map((node) => ({
      ...node,
      x: 500,
      y: 300,
      status: 'confirmed',
      claimState: 'student interpretation',
    }));
    project.candidates = { nodes: accepted, edges: [] };
    project.graph = { nodes: [], edges: [] };
    project.stage = 4;
    project.furthestStage = 4;
    const expected = withDefaultNodeLayout(accepted.map(({ x: _x, y: _y, ...node }) => node));

    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Build confirmed map' }));

    await waitFor(() => expect(storedProject().stage).toBe(5));
    const committed = storedProject().graph.nodes;
    expect(committed.map(({ id, x, y }) => ({ id, x, y })))
      .toEqual(expected.map(({ id, x, y }) => ({ id, x, y })));
    expect(new Set(committed.map(({ x, y }) => `${x},${y}`)).size).toBe(committed.length);
  });

  it('invalidates candidates and retires memo-linked graph records when source text changes', async () => {
    const project = createDefaultProject();
    project.candidates = extractCandidates(project.submission);
    project.graph = structuredClone(project.candidates);
    project.graph.nodes.forEach((node) => { node.status = 'confirmed'; node.claimState = 'student interpretation'; });
    project.graph.edges.forEach((edge) => { edge.status = 'confirmed'; edge.claimState = 'student interpretation'; });
    project.stage = 1;
    project.furthestStage = 1;
    await resumeSavedProject(project);
    fireEvent.change(screen.getByRole('textbox', { name: /Memo text/ }), { target: { value: `${project.submission.text} A later source correction changes the evidence anchor.` } });
    await waitFor(() => {
      const stored = storedProject();
      expect(stored.candidates).toEqual({ nodes: [], edges: [] });
      expect(stored.graph.nodes.every((node) => node.claimState === 'retired')).toBe(true);
      expect(stored.graph.edges.every((edge) => edge.claimState === 'retired')).toBe(true);
    });
  });

  it('preserves a dirty model draft and blocks a stale cross-tab revision', async () => {
    const project = createDefaultProject();
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('tab', { name: 'Model setup' }));

    const instructions = screen.getByRole('textbox', { name: /Custom project instructions/ });
    fireEvent.change(instructions, { target: { value: 'Unsaved local interpretation rules.' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Change note/ }), { target: { value: 'Local draft' } });

    const incoming = structuredClone(project);
    incoming.updatedAt = new Date(Date.now() + 10_000).toISOString();
    incoming.configs.preflight = {
      ...incoming.configs.preflight,
      customInstructions: 'External revision instructions.',
      revision: 2,
      changeNote: 'External revision',
    };
    incoming.configs.preflight.fingerprint = configFingerprint(incoming.configs.preflight);
    const incomingBytes = serializeProject(incoming);
    window.localStorage.setItem(STORAGE_KEY, incomingBytes);
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: incomingBytes }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Project revision 2 is now current.');
    expect(instructions).toHaveValue('Unsaved local interpretation rules.');
    fireEvent.click(screen.getByRole('button', { name: 'Save revision' }));
    expect(await screen.findByText(/changed in another session/i)).toBeVisible();
    expect(storedProject().configs.preflight).toMatchObject({ revision: 2, customInstructions: 'External revision instructions.' });

    fireEvent.click(screen.getByRole('button', { name: 'Load project revision 2' }));
    expect(instructions).toHaveValue('External revision instructions.');
  });

  it.each(['node', 'edge', 'map'])('reports queued then actual saved state for %s annotations and persists the text', async (target) => {
    const project = await openMapProject();
    const field = selectAnnotationTarget(target);
    const text = `${target} annotation saved locally`;
    fireEvent.change(field, { target: { value: text } });
    expect(annotationStatus(field)).toHaveTextContent('Queued for local save');
    await waitFor(() => expect(annotationStatus(field)).toHaveTextContent('Saved on this device'));
    expect(storedAnnotation(target, project)).toBe(text);
  });

  it.each(['node', 'edge', 'map'])('changes queued %s annotation status to the actual persistence error', async (target) => {
    const project = seedProject(makeMapProject());
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    render(<App />);
    await showResumeScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to build the map' }));
    expect(await screen.findByRole('heading', { name: 'Build the map' })).toBeVisible();
    const field = selectAnnotationTarget(target);
    fireEvent.change(field, { target: { value: `${target} unsaved annotation` } });
    expect(annotationStatus(field)).toHaveTextContent('Queued for local save');
    await waitFor(() => expect(annotationStatus(field)).toHaveTextContent('Local save failed: Quota exceeded'));
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)).id).toBe(project.id);
  });

  it('retries persistence after a temporarily erased required field is corrected', async () => {
    const project = await openMapProject();
    const priorLabel = project.graph.nodes[0].label;
    const label = screen.getByRole('textbox', { name: 'Label' });
    expect(label).toHaveValue(priorLabel);
    fireEvent.change(label, { target: { value: '' } });
    await screen.findByText('Complete the current field to save');
    expect(storedProject().graph.nodes.find((node) => node.id === project.graph.nodes[0].id).label).toBe(priorLabel);

    fireEvent.change(label, { target: { value: 'Corrected actor label' } });
    await waitFor(() => expect(screen.getByText('Saved on device')).toBeVisible());
    await waitFor(() => expect(storedProject().graph.nodes.find((node) => node.id === project.graph.nodes[0].id).label).toBe('Corrected actor label'));
  });

  it('moves a node through the CTM path and sends the accepted, minimized prototype-event request', async () => {
    const project = await openMapProject();
    const node = project.graph.nodes[0];
    const svg = screen.getByRole('group', { name: /Systems map with/ });
    const nodeElement = document.querySelector(`[data-graph-id="${node.id}"]`);
    svg.getScreenCTM = () => ({ inverse: () => ({}) });
    svg.createSVGPoint = () => ({
      x: 0,
      y: 0,
      matrixTransform() { return { x: (this.x - 11) / 2, y: (this.y - 13) / 3 }; },
    });

    fireEvent.pointerDown(nodeElement, { pointerId: 41, button: 0, clientX: 11 + node.x * 2, clientY: 13 + node.y * 3 });
    fireEvent.pointerMove(svg, { pointerId: 41, clientX: 11 + node.x * 2 + 32, clientY: 13 + node.y * 3 + 27 });
    fireEvent.pointerUp(svg, { pointerId: 41, clientX: 11 + node.x * 2 + 32, clientY: 13 + node.y * 3 + 27 });

    await waitFor(() => expect(document.querySelector(`[data-graph-id="${node.id}"]`)).toHaveAttribute('transform', `translate(${node.x + 16} ${node.y + 9})`));
    await waitFor(() => expect(eventRequests('node_moved')).toHaveLength(1));
    expect(eventRequests('node_moved')[0].body).toEqual({
      event: 'node_moved',
      stage: 'Build the map',
      metadata: { keyboard: false, pointer: true },
    });
    expect(eventRequests('node_moved')[0].options).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(eventRequests('node_moved')[0].options.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.stringify(eventRequests('node_moved')[0].body)).not.toMatch(/source|annotation|label/i);
  });

  it('keeps the phone drawer closed for a real drag, commits one coordinate write, then opens on tap and durably zooms and pans', async () => {
    installPhoneLayout();
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: vi.fn((callback) => { callback(0); return 1; }),
    });
    const project = await openMapProject();
    const node = project.graph.nodes[0];
    const svg = screen.getByRole('group', { name: /Systems map with/ });
    const nodeElement = document.querySelector(`[data-graph-id="${node.id}"]`);
    const inspector = screen.getByLabelText('Map inspector');
    svg.getScreenCTM = () => ({ inverse: () => ({}) });
    svg.createSVGPoint = () => ({
      x: 0,
      y: 0,
      matrixTransform() { return { x: this.x, y: this.y }; },
    });

    await waitFor(() => expect(storedProject().teacherGovernance?.preflight).toBeTruthy());
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, PERSIST_DEBOUNCE_MS + 30)); });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    expect(inspector).toHaveAttribute('aria-hidden', 'true');
    expect(inspector).not.toHaveClass('is-open');
    fireEvent.pointerDown(nodeElement, { pointerId: 29, button: 0, clientX: node.x, clientY: node.y });
    expect(inspector).toHaveAttribute('aria-hidden', 'true');
    fireEvent.pointerMove(svg, { pointerId: 29, clientX: node.x + 24, clientY: node.y + 16 });
    expect(inspector).toHaveAttribute('aria-hidden', 'true');
    fireEvent.pointerUp(svg, { pointerId: 29, clientX: node.x + 24, clientY: node.y + 16 });
    expect(inspector).toHaveAttribute('aria-hidden', 'true');
    expect(inspector).not.toHaveClass('is-open');

    await waitFor(() => expect(storedProject().graph.nodes.find((item) => item.id === node.id)).toMatchObject({ x: node.x + 24, y: node.y + 16 }));
    const coordinateWrites = setItem.mock.calls.filter(([key, value]) => {
      if (key !== STORAGE_KEY) return false;
      const saved = JSON.parse(value);
      return saved.graph.nodes.some((item) => item.id === node.id && item.x === node.x + 24 && item.y === node.y + 16);
    });
    expect(coordinateWrites).toHaveLength(1);
    expect(eventRequests('node_moved')).toHaveLength(1);

    setItem.mockClear();
    fireEvent.pointerDown(document.querySelector(`[data-graph-id="${node.id}"]`), { pointerId: 30, button: 0, clientX: node.x + 24, clientY: node.y + 16 });
    fireEvent.pointerUp(svg, { pointerId: 30, clientX: node.x + 24, clientY: node.y + 16 });
    await waitFor(() => expect(inspector).toHaveClass('is-open'));
    expect(inspector).not.toHaveAttribute('aria-hidden');

    const mapControls = document.querySelector('.canvas-controls');
    expect(mapControls).toHaveAttribute('aria-hidden', 'true');
    expect(mapControls).toHaveAttribute('inert');
    expect(screen.queryByRole('toolbar', { name: 'Map view controls' })).not.toBeInTheDocument();
    fireEvent.click(within(inspector).getByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(inspector).toHaveAttribute('aria-hidden', 'true');
      expect(mapControls).not.toHaveAttribute('aria-hidden');
      expect(mapControls).not.toHaveAttribute('inert');
      expect(document.querySelector(`[data-graph-id="${node.id}"]`)).toHaveFocus();
    });

    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    const pan = screen.getByRole('button', { name: 'Pan' });
    const durableViewport = viewportTransform();
    expect(zoomIn).toBeVisible();
    expect(pan).toBeVisible();
    fireEvent.click(zoomIn);
    fireEvent.click(pan);
    expect(pan).toHaveAttribute('aria-pressed', 'true');
    const beforePan = viewportTransform();
    fireEvent.pointerDown(svg, { pointerId: 31, button: 0, clientX: 300, clientY: 210 });
    fireEvent.pointerMove(svg, { pointerId: 31, clientX: 318, clientY: 222 });
    fireEvent.pointerUp(svg, { pointerId: 31, clientX: 318, clientY: 222 });

    await waitFor(() => {
      const afterPan = viewportTransform();
      expect(afterPan.zoom).toBeGreaterThan(durableViewport.zoom);
      expect(afterPan.panX).not.toBe(beforePan.panX);
      expect(afterPan.panY).not.toBe(beforePan.panY);
    });
    const expectedViewport = viewportTransform();
    await waitFor(() => expect(storedProject().viewport).toEqual(expectedViewport));
    const viewportWrites = setItem.mock.calls.filter(([key, value]) => key === STORAGE_KEY && JSON.stringify(JSON.parse(value).viewport) === JSON.stringify(expectedViewport));
    expect(viewportWrites).toHaveLength(1);
  });

  it('keeps the closed phone inspector out of navigation and provides roving tabs plus deterministic focus return', async () => {
    installPhoneLayout();
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: vi.fn((callback) => { callback(0); return 1; }),
    });
    const project = await openMapProject();
    const node = project.graph.nodes[0];
    const nodeElement = document.querySelector(`[data-graph-id="${node.id}"]`);
    const svg = screen.getByRole('group', { name: /Systems map with/ });
    const inspector = screen.getByLabelText('Map inspector');
    svg.getScreenCTM = () => ({ inverse: () => ({}) });
    svg.createSVGPoint = () => ({
      x: 0,
      y: 0,
      matrixTransform() { return { x: this.x, y: this.y }; },
    });

    const legendButton = screen.getByRole('button', { name: 'Legend' });
    fireEvent.click(legendButton);
    expect(screen.getByLabelText('Map legend')).toBeVisible();
    expect(inspector).toHaveAttribute('aria-hidden', 'true');
    expect(inspector).toHaveAttribute('inert');
    fireEvent.pointerDown(nodeElement, { pointerId: 51, button: 0, clientX: node.x, clientY: node.y });
    fireEvent.pointerUp(svg, { pointerId: 51, clientX: node.x, clientY: node.y });
    await waitFor(() => expect(inspector).toHaveClass('is-open'));
    expect(screen.queryByLabelText('Map legend')).not.toBeInTheDocument();
    expect(inspector).not.toHaveAttribute('aria-hidden');
    expect(inspector).not.toHaveAttribute('inert');

    const addDisclosure = within(inspector).getByRole('button', { name: 'Add' });
    expect(addDisclosure).toHaveAttribute('aria-controls', 'inspector-add-actions');
    expect(addDisclosure).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(addDisclosure);
    expect(addDisclosure).toHaveAttribute('aria-expanded', 'true');
    const addActions = document.getElementById('inspector-add-actions');
    expect(within(addActions).getByRole('button', { name: 'Node' })).toBeVisible();
    expect(within(addActions).getByRole('button', { name: 'Relationship' })).toBeVisible();
    fireEvent.click(addDisclosure);
    expect(addDisclosure).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('inspector-add-actions')).toBeNull();

    const tabs = within(inspector).getAllByRole('tab');
    const [nodeTab, relationshipsTab, mapTab] = tabs;
    const expectOnlyTabStop = (expected) => {
      expect(tabs.filter((tab) => tab.tabIndex === 0)).toEqual([expected]);
    };
    expectOnlyTabStop(nodeTab);
    nodeTab.focus();
    fireEvent.keyDown(nodeTab, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(relationshipsTab).toHaveAttribute('aria-selected', 'true');
      expect(relationshipsTab).toHaveFocus();
    });
    expectOnlyTabStop(relationshipsTab);

    fireEvent.keyDown(relationshipsTab, { key: 'End' });
    await waitFor(() => {
      expect(mapTab).toHaveAttribute('aria-selected', 'true');
      expect(mapTab).toHaveFocus();
    });
    expectOnlyTabStop(mapTab);

    fireEvent.keyDown(mapTab, { key: 'Home' });
    await waitFor(() => {
      expect(nodeTab).toHaveAttribute('aria-selected', 'true');
      expect(nodeTab).toHaveFocus();
    });
    expectOnlyTabStop(nodeTab);

    fireEvent.keyDown(nodeTab, { key: 'Escape' });
    await waitFor(() => expect(inspector).toHaveAttribute('aria-hidden', 'true'));
    expect(inspector).toHaveAttribute('inert');

    fireEvent.pointerDown(nodeElement, { pointerId: 52, button: 0, clientX: node.x, clientY: node.y });
    fireEvent.pointerUp(svg, { pointerId: 52, clientX: node.x, clientY: node.y });
    await waitFor(() => expect(inspector).toHaveClass('is-open'));
    fireEvent.click(within(inspector).getByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(inspector).toHaveAttribute('aria-hidden', 'true');
      expect(nodeElement).toHaveFocus();
    });
  });

  it('uses meet-style letterboxing in the no-CTM fallback for a nonmatching aspect ratio', async () => {
    const project = await openMapProject();
    const node = project.graph.nodes[0];
    const svg = screen.getByRole('group', { name: /Systems map with/ });
    const nodeElement = document.querySelector(`[data-graph-id="${node.id}"]`);
    svg.getScreenCTM = () => null;
    svg.getBoundingClientRect = () => ({ left: 100, top: 50, width: 420, height: 540, right: 520, bottom: 590, x: 100, y: 50, toJSON() {} });
    const startX = 100 + node.x * 0.5;
    const startY = 185 + node.y * 0.5;

    fireEvent.pointerDown(nodeElement, { pointerId: 7, button: 0, clientX: startX, clientY: startY });
    fireEvent.pointerMove(svg, { pointerId: 7, clientX: startX + 20, clientY: startY + 15 });
    fireEvent.pointerUp(svg, { pointerId: 7, clientX: startX + 20, clientY: startY + 15 });

    await waitFor(() => expect(document.querySelector(`[data-graph-id="${node.id}"]`)).toHaveAttribute('transform', `translate(${node.x + 40} ${node.y + 30})`));
  });

  it('supports fine and coarse keyboard movement and persists the final coordinates', async () => {
    const project = await openMapProject();
    const node = project.graph.nodes[0];
    const nodeElement = document.querySelector(`[data-graph-id="${node.id}"]`);
    nodeElement.focus();
    fireEvent.keyDown(nodeElement, { key: 'ArrowRight' });
    fireEvent.keyDown(nodeElement, { key: 'ArrowDown', shiftKey: true });

    expect(nodeElement).toHaveFocus();
    await waitFor(() => expect(document.querySelector(`[data-graph-id="${node.id}"]`)).toHaveAttribute('transform', `translate(${node.x + 8} ${node.y + 24})`));
    expect(screen.getByText(`${node.label} moved to x ${node.x + 8}, y ${node.y + 24}.`)).toBeInTheDocument();
    await waitFor(() => expect(storedProject().graph.nodes.find((item) => item.id === node.id)).toMatchObject({ x: node.x + 8, y: node.y + 24 }));
  });

  it('restores stage, layout, viewport, and node, relationship, and map annotations after reload', async () => {
    const project = makeMapProject();
    project.graph.nodes[0].x = 123;
    project.graph.nodes[0].y = 234;
    project.graph.nodes[0].annotations.analytical.text = 'Restored node annotation';
    project.graph.edges[0].annotation.text = 'Restored relationship annotation';
    project.mapAnnotation.text = 'Restored whole-map annotation';
    project.viewport = { panX: 37, panY: -22, zoom: 1.25 };
    seedProject(project);

    const assertRestored = async () => {
      render(<App />);
      await showResumeScreen();
      expect(screen.getByText(/Stage 6 of 7/)).toHaveTextContent('Build the map');
      fireEvent.click(screen.getByRole('button', { name: 'Continue to build the map' }));
      expect(await screen.findByRole('heading', { name: 'Build the map' })).toBeVisible();
      expect(document.querySelector(`[data-graph-id="${project.graph.nodes[0].id}"]`)).toHaveAttribute('transform', 'translate(123 234)');
      expect(document.querySelector('.viewport-layer')).toHaveAttribute('transform', 'translate(37 -22) scale(1.25)');
      expect(screen.getByRole('textbox', { name: /^Analysis/ })).toHaveValue('Restored node annotation');
      fireEvent.click(screen.getByRole('tab', { name: 'Relationships' }));
      const relationshipPanel = screen.getByRole('tabpanel', { name: 'Relationships' });
      fireEvent.click(within(within(relationshipPanel).getByLabelText('Relationship list')).getAllByRole('button')[0]);
      expect(screen.getByRole('textbox', { name: /^Relationship annotation/ })).toHaveValue('Restored relationship annotation');
      fireEvent.click(screen.getByRole('tab', { name: 'Map' }));
      expect(screen.getByRole('textbox', { name: /^Evolving-map annotation/ })).toHaveValue('Restored whole-map annotation');
    };

    await assertRestored();
    cleanup();
    await assertRestored();
  });

  it('neutralizes spreadsheet formulas at the CSV byte boundary, including control and leading-whitespace variants', async () => {
    const dangerous = ['=cmd', '+cmd', '-cmd', '@cmd', '\tcmd', '\rcmd', '\ncmd', '  =cmd', ' \t+cmd'];
    const project = createDefaultProject();
    const baseNodes = extractCandidates(project.submission).nodes;
    const nodes = dangerous.map((label, index) => ({
      ...baseNodes[index % baseNodes.length],
      id: `${baseNodes[index % baseNodes.length].id}-csv-${index}`,
      annotations: {
        analytical: { id: `annotation-csv-analysis-${index}`, text: '' },
        evidence: { id: `annotation-csv-evidence-${index}`, text: '' },
      },
      label,
      status: 'confirmed',
      claimState: 'confirmed',
    }));
    project.candidates = { nodes: [], edges: [] };
    project.graph = { nodes, edges: [] };
    project.stage = 6;
    project.furthestStage = 6;
    const blobs = [];
    class CapturedBlob {
      constructor(parts, options = {}) { this.parts = parts; this.type = options.type || ''; blobs.push(this); }
    }
    vi.stubGlobal('Blob', CapturedBlob);
    const priorCreate = URL.createObjectURL;
    const priorRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:captured-csv');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    try {
      await resumeSavedProject(project);
      fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
      expect(blobs).toHaveLength(1);
      expect(blobs[0].type).toBe('text/csv');
      const csv = blobs[0].parts.join('');
      const bytes = new TextEncoder().encode(csv);
      const encoder = new TextEncoder();
      dangerous.forEach((value) => {
        expect(bytesContain(bytes, encoder.encode(`"'${value}"`)), `missing byte-neutralized CSV cell for ${JSON.stringify(value)}`).toBe(true);
      });
      expect(bytesContain(bytes, encoder.encode('"node"'))).toBe(true);
      expect(bytesContain(bytes, encoder.encode('"\'=cmd"'))).toBe(true);
    } finally {
      if (priorCreate === undefined) delete URL.createObjectURL; else URL.createObjectURL = priorCreate;
      if (priorRevoke === undefined) delete URL.revokeObjectURL; else URL.revokeObjectURL = priorRevoke;
    }
  });
});
