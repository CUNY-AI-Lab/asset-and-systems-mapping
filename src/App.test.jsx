import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import { SYSTEMS_MAPPING_STAGES } from '../shared/systems-mapping-stages.js';
import {
  configFingerprint,
  createDefaultProject,
  createPortableProject,
  extractCandidates,
  serializeProject,
  withDefaultNodeLayout,
} from './domain.js';

const STORAGE_KEY = 'systems-mapping-studio.project.v5';
const PERSIST_DEBOUNCE_MS = 450;

let studentSession;
let accessResponder;
let preflightEvaluationResponder;
let preflightPostResponder;
let preflightGetResponder;
let connectionSuggestionResponder;
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
      sharingTier: project.sharingTier,
      schemaVersion: project.schemaVersion,
      stage: project.stage,
      furthestStage: project.furthestStage ?? project.stage,
      clientUpdatedAt: project.updatedAt,
    },
    activeScale: project.activeScale,
    stageId: SYSTEMS_MAPPING_STAGES[project.stage]?.id || 'add-source',
    inquiry: project.inquiry,
    sourceRecord: Object.fromEntries(['id', 'sensitive', 'consent'].map((key) => [key, project.submission[key]])),
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
    stageId: payload.stageId,
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
    action: 'Clarify who performs the referral.',
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
    action: 'Add more detail to the memo.',
    evidenceExcerpt: 'The memo needs one more specific example.',
  }, {
    action: 'Separate what the memo describes from your interpretation.',
    evidenceExcerpt: 'According to the memo, the school administers services.',
  }, {
    action: 'Name a second connection.',
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
  project.stage = 1;
  project.furthestStage = 1;
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
  if (requestPath === '/api/map/connections' && options.method === 'POST') return connectionSuggestionResponder(JSON.parse(options.body));
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
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
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
  project.stage = 3;
  project.furthestStage = 3;
  return project;
}

async function openMapProject(project = makeMapProject()) {
  await resumeSavedProject(project);
  expect(await screen.findByRole('heading', { name: 'Build the map' })).toBeVisible();
  return project;
}

function mapCanvas() {
  return screen.getByRole('group', { name: /\bmap\. \d+ nodes? and \d+ connections?/i });
}

function svgTextLines(element) {
  return [...element.querySelectorAll('tspan')].map((line) => line.textContent);
}

function renderedNodePosition(nodeId) {
  const transform = document.querySelector(`[data-graph-id="${nodeId}"]`)?.getAttribute('transform') || '';
  const match = transform.match(/^translate\((-?[\d.]+) (-?[\d.]+)\)$/);
  if (!match) throw new Error(`Unexpected node transform for ${nodeId}: ${transform}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

function graphForScale(project, scale = project.activeScale) {
  const scales = new Set(scale === 'all' ? project.releasedScales : [scale]);
  const edges = project.graph.edges.filter((edge) => scales.has(edge.scale) && edge.claimState !== 'retired');
  const endpointIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const nodes = project.graph.nodes.filter((node) => (scales.has(node.scale) || endpointIds.has(node.id)) && node.claimState !== 'retired');
  return { nodes, edges };
}

function openNodeInspector(nodeId = document.querySelector('.graph-node')?.getAttribute('data-graph-id')) {
  const node = document.querySelector(`[data-graph-id="${nodeId}"]`);
  if (!node) throw new Error(`Visible node not found: ${nodeId}`);
  node.focus();
  fireEvent.keyDown(node, { key: 'Enter' });
  return screen.getByLabelText('Map inspector');
}

function openEdgeInspector(edgeId = document.querySelector('.graph-edge')?.getAttribute('data-graph-id')) {
  const edge = document.querySelector(`[data-graph-id="${edgeId}"]`);
  if (!edge) throw new Error(`Visible relationship not found: ${edgeId}`);
  fireEvent.pointerDown(edge, { pointerId: 91, button: 0 });
  return screen.getByLabelText('Map inspector');
}

function openMapInspector() {
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  return screen.getByLabelText('Map inspector');
}

function annotationStatus(field) {
  const ids = field.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) || [];
  const statusId = ids.find((id) => id.startsWith('annotation-status_'));
  return statusId ? document.getElementById(statusId) : null;
}

function selectAnnotationTarget(target) {
  if (target === 'node') {
    const inspector = openNodeInspector();
    return within(inspector).getByRole('textbox', { name: /^Annotation/ });
  }
  if (target === 'edge') {
    const inspector = openEdgeInspector();
    const panel = within(inspector).getByRole('tabpanel', { name: 'Relationships' });
    return within(panel).getByRole('textbox', { name: 'Annotation' });
  }
  const inspector = openMapInspector();
  return within(inspector).getByRole('textbox', { name: /^Map note/ });
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
    connectionSuggestionResponder = (body) => jsonResponse({ connections: [{
      source: body.nodes[0].id,
      target: body.nodes[1].id,
      verb: 'supports',
      rationale: 'The student described support between these nodes.',
    }] }, 201);
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
    expect(await screen.findByRole('heading', { name: 'Enter your class code' })).toBeVisible();
    const code = screen.getByRole('textbox', { name: 'Class code' });
    fireEvent.change(code, { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code did not work');
    expect(code).toHaveValue('');
    expect(window.localStorage.getItem('classCode')).toBeNull();
    expect(window.sessionStorage.getItem('classCode')).toBeNull();

    fireEvent.change(code, { target: { value: '101' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Keep working on your map.' })).toBeVisible();
    expect(screen.getByLabelText('Saved project summary')).toHaveTextContent('Stage · Review');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Review your memo' })).toBeVisible();

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
    expect(screen.getByLabelText('Saved project summary')).toHaveTextContent('Part 1 · Micro');
    expect(screen.queryByText(/instructor reviews submitted work/i)).not.toBeInTheDocument();
    const request = fetchMock.mock.calls.find(([path]) => String(path) === '/api/student/access');
    expect(JSON.parse(request[1].body)).toEqual({ code: hostedCode });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review memo' }));
    expect(screen.getByRole('heading', { name: 'Review your memo' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Generate guidance' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Choose nodes and connections' })).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'Model setup' })).not.toBeInTheDocument();
  });

  it('starts a blank project only after a granted session and explicit start action', async () => {
    render(<App />);
    await showResumeScreen();
    expect(screen.getByRole('heading', { name: 'Start a systems map.' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Add your memo' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByRole('heading', { name: 'Add your memo' })).toBeVisible();
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
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Add your memo' })).toBeVisible();

    act(() => vi.advanceTimersByTime(59_999));
    expect(screen.getByRole('heading', { name: 'Add your memo' })).toBeVisible();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('heading', { name: 'Enter your class code' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your class code to continue');
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
    expect(screen.getByRole('heading', { name: 'Add your memo' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Map title (optional)' })).toHaveValue('NYC systems and assets map');
    fireEvent.change(screen.getByRole('textbox', { name: 'Map title (optional)' }), { target: { value: 'Family service access map' } });
    expect(screen.getByText('Family service access map', { selector: '.brand small' })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Guiding inquiry' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Memo text/ })).toBeVisible();
    expect(screen.getByText(/Aim for 500–600 words/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Review memo' }));
    expect(screen.getByRole('heading', { name: 'Review your memo' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Stages' }));
    const stageMenu = screen.getByRole('dialog', { name: 'Five stages' });
    ['add your memo', 'review your memo', 'choose nodes and describe connections', 'build map', 'revise and export'].forEach((label) => expect(within(stageMenu).getByText(label)).toBeVisible());
    within(stageMenu).getAllByRole('button').filter((button) => button.textContent !== 'Close').forEach((button) => expect(button).toBeEnabled());
    fireEvent.click(within(stageMenu).getByRole('button', { name: 'Close Five stages' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    const guidance = await screen.findByRole('region', { name: 'Return to your memo' });
    expect(within(guidance).getAllByRole('article')).toHaveLength(3);
    expect(within(guidance).getByRole('heading', { name: 'Add more detail to the memo.' })).toBeVisible();
    expect(within(guidance).getByRole('heading', { name: 'Separate what the memo describes from your interpretation.' })).toBeVisible();
    expect(within(guidance).getByRole('heading', { name: 'Name a second connection.' })).toBeVisible();
    expect(within(guidance).getByText('According to the memo, the school administers services.')).toBeVisible();
    expect(within(guidance).queryByText('Keep this completed item as written.')).not.toBeInTheDocument();
    expect(within(guidance).queryByText('Narrow the inquiry to one decision point.')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What the source establishes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What the model suggests' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What remains uncertain' })).not.toBeInTheDocument();
    expect(screen.getByText('Instructor guidance')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Add a note' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /Note for instructor/ })).toHaveAttribute('maxlength', '4000');
    const visibleStageText = document.querySelector('.workspace').textContent;
    expect(visibleStageText).not.toMatch(/\bsources?\b/i);
    expect(visibleStageText).not.toMatch(/\b(?:H[1-4]|C[1-8])\b/);
    expect(visibleStageText).not.toMatch(/\b(?:pass|conditional|hold|score|scoring|criterion|criteria|checklist|hard gate)\b/i);
    expect(screen.queryByRole('tab', { name: 'Model setup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Custom project instructions/ })).not.toBeInTheDocument();
  });

  it('generates memo guidance without requiring a hidden inquiry field', async () => {
    const project = createDefaultProject();
    project.inquiry = '';
    project.stage = 1;
    project.furthestStage = 1;
    preflightEvaluationResponder = (body) => jsonResponse({
      evaluation: evaluationRecord(body, { redirects: redirectFixture() }),
    }, 201);

    await resumeSavedProject(project);
    expect(screen.queryByRole('textbox', { name: 'Guiding inquiry' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));

    expect(await screen.findByRole('region', { name: 'Return to your memo' })).toBeVisible();
    const request = fetchMock.mock.calls.find(([path, options]) => String(path) === '/api/preflight/evaluations' && options.method === 'POST');
    expect(JSON.parse(request[1].body).inquiry).toBe('');
  });

  it('opens a non-advancing map preview and returns to the current memo stage', async () => {
    const project = createDefaultProject();
    await resumeSavedProject(project);

    const scale = screen.getByRole('combobox', { name: 'Scale' });
    fireEvent.change(scale, { target: { value: 'macro' } });
    await waitFor(() => expect(storedProject()).toMatchObject({ activeScale: 'macro', releasedScales: ['micro', 'macro'] }));

    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(await screen.findByRole('heading', { name: 'Build the map' })).toBeVisible();
    expect(screen.getByRole('group', { name: /Macro map\. 0 nodes and 0 connections/ })).toBeVisible();
    expect(storedProject().stage).toBe(0);
    expect(storedProject().furthestStage).toBe(project.furthestStage);
    fireEvent.click(within(document.querySelector('.app-footer')).getByRole('button', { name: 'Back to Memo' }));
    expect(await screen.findByRole('heading', { name: 'Add your memo' })).toBeVisible();
    expect(storedProject().stage).toBe(0);
    expect(storedProject().furthestStage).toBe(project.furthestStage);
  });

  it('groups the four scale options under concise Part 1 and Part 2 labels', async () => {
    await resumeSavedProject(createDefaultProject());

    const scale = screen.getByRole('combobox', { name: 'Scale' });
    const groups = scale.querySelectorAll('optgroup');
    expect([...groups].map((group) => group.label)).toEqual(['Part 1', 'Part 2']);
    expect([...groups[0].querySelectorAll('option')].map((option) => option.value)).toEqual(['micro', 'meso']);
    expect([...groups[1].querySelectorAll('option')].map((option) => option.value)).toEqual(['macro', 'integration']);

    fireEvent.change(scale, { target: { value: 'integration' } });
    await waitFor(() => expect(storedProject()).toMatchObject({ activeScale: 'integration' }));
    expect(screen.queryByText('Where is your population present, and who interacts with them there?')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('keeps the memo intake limited to fields students need', async () => {
    await resumeSavedProject(createDefaultProject());

    expect(screen.getByRole('combobox', { name: 'Scale' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Map title (optional)' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /Memo text/ })).toBeVisible();
    expect(screen.queryByLabelText('Author or creator')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Type of material')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Where did you find it?')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Rights or intended use')).not.toBeInTheDocument();

    const privacy = screen.getByRole('button', { name: /Privacy/ });
    expect(privacy).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(privacy);
    expect(screen.getByRole('checkbox', { name: /private or identifying information/i })).toBeVisible();
    expect(screen.queryByLabelText('Author or creator')).not.toBeInTheDocument();
  });

  it('keeps Map and all five stages available while instructor review is pending', async () => {
    const project = projectAwaitingReview();
    await resumeSavedProject(project);
    expect(screen.getByText('Your instructor can review this draft while you keep working.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Choose nodes and connections' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Map' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Stages' }));
    const stageMenu = screen.getByRole('dialog', { name: 'Five stages' });
    SYSTEMS_MAPPING_STAGES.forEach(({ label }) => expect(within(stageMenu).getByRole('button', { name: new RegExp(label, 'i') })).toBeEnabled());
  });

  it('keeps Map and all five stages available after instructor returns work', async () => {
    const project = projectAwaitingReview();
    project.preflight.review = {
      submissionId: 'review_0123456789abcdefghijklmnop',
      status: 'rejected',
      decision: 'reject',
      revision: 2,
      submittedAt: '2026-08-09T12:00:00.000Z',
      instructorAnnotation: 'Clarify one connection, then keep refining your map.',
    };

    await resumeSavedProject(project);
    expect(screen.getByText('Clarify one connection, then keep refining your map.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Choose nodes and connections' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Map' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Stages' }));
    const stageMenu = screen.getByRole('dialog', { name: 'Five stages' });
    SYSTEMS_MAPPING_STAGES.forEach(({ label }) => expect(within(stageMenu).getByRole('button', { name: new RegExp(label, 'i') })).toBeEnabled());
  });

  it('opens an empty map from candidate choice instead of gating on generated items', async () => {
    const project = createDefaultProject();
    project.stage = 2;
    project.furthestStage = 2;
    project.candidates = { nodes: [], edges: [] };
    await resumeSavedProject(project);

    expect(screen.getByText(/open the map and add supported elements yourself/i)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Describe connections between nodes' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
    expect(await screen.findByRole('heading', { name: 'Build the map' })).toBeVisible();
    await waitFor(() => expect(storedProject().stage).toBe(3));
  });

  it('uses the student description to request editable connections and adds only accepted suggestions to the map', async () => {
    const project = createDefaultProject();
    const nodes = extractCandidates(project.submission).nodes.slice(0, 3).map((node) => ({
      ...node,
      status: 'confirmed',
      claimState: 'student interpretation',
    }));
    project.candidates = { nodes, edges: [] };
    project.graph = { nodes: [], edges: [] };
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);

    expect(screen.getByRole('heading', { name: 'Describe connections between nodes' })).toBeVisible();
    expect(screen.getByText(/prompt the custom AI model to formulate new connections/i)).toBeVisible();
    const prompt = 'Families rely on schools, but delayed referrals make services harder to reach in this session.';
    fireEvent.change(screen.getByRole('textbox', { name: 'How do these nodes connect?' }), { target: { value: prompt } });
    fireEvent.click(screen.getByRole('button', { name: 'Suggest connections' }));

    const verb = await screen.findByRole('textbox', { name: 'Connection for suggestion 1' });
    expect(verb).toHaveValue('supports');
    expect(screen.getByRole('button', { name: 'Refine map' })).toBeVisible();
    const request = fetchMock.mock.calls.find(([path, options]) => String(path) === '/api/map/connections' && options.method === 'POST');
    const body = JSON.parse(request[1].body);
    expect(body).toMatchObject({ activeScale: project.activeScale, inquiry: project.inquiry, prompt });
    expect(body.nodes.map(({ id }) => id)).toEqual(nodes.map(({ id }) => id));
    expect(body.relationships).toEqual([]);
    expect(body.projectOverlay).toMatchObject({ id: project.configs.builder.id, customInstructions: project.configs.builder.customInstructions });
    expect(body.projectOverlay).not.toHaveProperty('fixedPrompt');

    fireEvent.change(verb, { target: { value: 'helps families reach' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(screen.getByRole('img', { name: /3 nodes and 1 connections/ })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
    expect(await screen.findByRole('heading', { name: 'Build the map' })).toBeVisible();
    await waitFor(() => expect(storedProject().graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ verb: 'helps families reach', status: 'confirmed', claimState: 'student interpretation' }),
    ])));
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toContain(prompt);
  });

  it('shows complete node and relationship text in the connection preview without ellipses', async () => {
    const project = createDefaultProject();
    const longNodeLabel = 'East Harlem Disability Services coordinates transportation access across neighborhood family programs END NODE';
    const longEdgeLabel = 'coordinates referrals and follow-up support across neighborhood programs END EDGE';
    const nodes = extractCandidates(project.submission).nodes.slice(0, 3).map((node, index) => ({
      ...node,
      ...(index === 0 ? { label: longNodeLabel } : {}),
      status: 'confirmed',
      claimState: 'student interpretation',
    }));
    project.candidates = { nodes, edges: [] };
    project.graph = { nodes: [], edges: [] };
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);

    fireEvent.change(screen.getByRole('textbox', { name: 'How do these nodes connect?' }), { target: { value: 'Connect these nodes using the relationships described in the memo.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Suggest connections' }));
    const verb = await screen.findByRole('textbox', { name: 'Connection for suggestion 1' });
    fireEvent.change(verb, { target: { value: longEdgeLabel } });

    const previewNode = document.querySelector(`.connection-preview__node[data-full-label="${longNodeLabel}"]`);
    const previewEdge = document.querySelector(`.connection-preview__label[data-full-label="${longEdgeLabel}"]`);
    expect(svgTextLines(previewNode).join(' ')).toBe(longNodeLabel);
    expect(svgTextLines(previewEdge).join(' ')).toBe(longEdgeLabel);
    expect(previewNode).not.toHaveTextContent('…');
    expect(previewEdge).not.toHaveTextContent('…');
    expect(Number(previewNode.querySelector('rect').getAttribute('height'))).toBeGreaterThan(72);
    expect(Number(previewEdge.querySelector('rect').getAttribute('height'))).toBeGreaterThan(24);
  });

  it('shows no praise or inventory when the server returns no redirect', async () => {
    const project = createDefaultProject();
    project.stage = 1;
    project.furthestStage = 1;
    preflightEvaluationResponder = (body) => jsonResponse({ evaluation: evaluationRecord(body, { redirects: [] }) }, 201);
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    const guidance = await screen.findByRole('region', { name: 'Return to your memo' });
    expect(within(guidance).getByText('Use your note to tell the instructor where you want feedback.')).toBeVisible();
    expect(within(guidance).queryAllByRole('article')).toHaveLength(0);
    expect(guidance.textContent).not.toMatch(/\b(?:pass|complete|met|score|criterion|checklist)\b/i);
  });

  it('rejects more than three server redirects without persisting them', async () => {
    const project = createDefaultProject();
    project.stage = 1;
    project.furthestStage = 1;
    preflightEvaluationResponder = (body) => jsonResponse({
      evaluation: evaluationRecord(body, {
        redirects: Array.from({ length: 4 }, (_, index) => ({ action: `Return to memo point ${index + 1}.` })),
      }),
    }, 201);
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await screen.findByText(/no more than 3 redirects/i)).toBeVisible();
    expect(storedProject().preflight).toBeNull();
  });

  it('uses exact evaluation and submission envelopes while pending review leaves mapping available after reload', async () => {
    await resumeSavedProject();
    fireEvent.click(screen.getByRole('button', { name: 'Review memo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await screen.findByRole('heading', { name: 'Return to your memo' })).toBeVisible();

    const evaluationRequest = fetchMock.mock.calls.find(([path, options]) => String(path) === '/api/preflight/evaluations' && options.method === 'POST');
    const evaluationBody = JSON.parse(evaluationRequest[1].body);
    expect(Object.keys(evaluationBody).sort()).toEqual(['activeScale', 'stageId', 'inquiry', 'projectMetadata', 'projectOverlay', 'sourceMaterial', 'sourceRecord'].sort());
    expect(Object.keys(evaluationBody.projectMetadata).sort()).toEqual(['clientUpdatedAt', 'furthestStage', 'id', 'projectId', 'schemaVersion', 'sharingTier', 'stage', 'submissionId', 'title'].sort());
    expect(Object.keys(evaluationBody.sourceRecord)).toEqual(['id', 'sensitive', 'consent']);
    expect(JSON.stringify(evaluationBody)).not.toMatch(/"(?:author|date|sourceType|sourceTitle|location|rights|evidenceOwnership)"/);
    expect(evaluationBody).toMatchObject({ activeScale: 'micro', stageId: 'review-suggestions', sourceMaterial: createDefaultProject().submission.text });
    expect(evaluationBody.projectOverlay).toMatchObject({ baseModel: 'STEM Splitter', customInstructions: createDefaultProject().configs.preflight.customInstructions, revision: 1 });
    expect(evaluationBody.projectOverlay).not.toHaveProperty('fixedPrompt');
    await waitFor(() => expect(storedProject().preflight?.evaluation?.evaluationId).toBe(EVALUATION_ID));
    const storedPreflight = storedProject().preflight;
    expect(Object.keys(storedPreflight).sort()).toEqual(['configurationSnapshot', 'evaluation', 'redirects', 'review']);
    expect(storedPreflight.redirects).toEqual([{ action: 'Clarify who performs the referral.', evidenceExcerpt: 'The school refers the student to the committee.' }]);
    expect(storedPreflight).not.toHaveProperty('hard');
    expect(storedPreflight).not.toHaveProperty('scored');
    expect(storedPreflight).not.toHaveProperty('outcome');
    expect(storedPreflight.configurationSnapshot.projectOverlay).not.toHaveProperty('customInstructions');
    expect(storedPreflight.configurationSnapshot.projectOverlay).not.toHaveProperty('fixedPrompt');
    const portablePreflight = createPortableProject(storedProject()).preflight;
    expect(Object.keys(portablePreflight).sort()).toEqual(['configurationSnapshot', 'evaluation', 'redirects', 'review']);
    expect(portablePreflight.evaluation.evaluationId).toBe('[redacted]');

    fireEvent.change(screen.getByRole('textbox', { name: /Note for instructor/ }), { target: { value: 'Please review the uncertainty around referrals.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to instructor' }));
    expect(await screen.findByRole('heading', { name: 'Waiting for your instructor' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Check response' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Choose nodes and connections' })).toBeVisible();

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
    expect(screen.getByLabelText('Saved project summary')).toHaveTextContent('Stage · Review');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Waiting for your instructor' })).toBeVisible();
  });

  it('blocks an oversized evaluation request without truncating the local memo', async () => {
    const project = createDefaultProject();
    project.submission.text = '😀'.repeat(180_000);
    project.stage = 1;
    project.furthestStage = 1;
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await screen.findByText(/guidance request is too large to send/i)).toBeVisible();
    expect(screen.getByText(/Shorten the memo/i)).toBeVisible();
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(0);
    expect(storedProject().submission.text).toBe(project.submission.text);
  });

  it('enforces the reported Ollama Cloud UTF-8 memo boundary before provider egress', async () => {
    const project = createDefaultProject();
    project.submission.text = '😀'.repeat(33_000);
    project.stage = 1;
    project.furthestStage = 1;
    studentSession = () => ({
      ...grantedAccess(),
      persistence: 'course-server',
      suggestionRuntime: { provider: 'ollama-cloud', model: 'gpt-oss:120b', maxSourceBytes: 131072 },
    });
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await screen.findByText(/too large for the reported Ollama Cloud runtime/i)).toBeVisible();
    expect(screen.getByText(/131,072 UTF-8 bytes maximum/i)).toBeVisible();
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(0);
    expect(storedProject().submission.text).toBe(project.submission.text);
  });

  it('enforces the Ollama Cloud UTF-8 inquiry boundary before provider egress', async () => {
    const project = createDefaultProject();
    project.inquiry = '😀'.repeat(2_050);
    project.stage = 1;
    project.furthestStage = 1;
    studentSession = () => ({
      ...grantedAccess(),
      persistence: 'course-server',
      suggestionRuntime: { provider: 'ollama-cloud', model: 'gpt-oss:120b', maxSourceBytes: 131072 },
    });
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await screen.findByText(/guiding inquiry is too large for the reported Ollama Cloud runtime/i)).toBeVisible();
    expect(screen.getByText(/8,192 UTF-8 bytes maximum/i)).toBeVisible();
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(0);
  });

  it('keeps oversized imported project instructions out of the evaluation request', async () => {
    const project = createDefaultProject();
    project.configs.preflight.customInstructions = 'x'.repeat(16_001);
    project.configs.preflight.fingerprint = configFingerprint(project.configs.preflight);
    project.stage = 1;
    project.furthestStage = 1;
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await screen.findByText(/custom instructions must be 16,000 characters or fewer before generating suggestions/i)).toBeVisible();
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(0);
  });

  it('keeps the project editable and reports an authoritative evaluation failure without creating local suggestions', async () => {
    const project = createDefaultProject();
    project.stage = 1;
    project.furthestStage = 1;
    preflightEvaluationResponder = () => jsonResponse({ error: 'Suggestion generation is temporarily unavailable.' }, 502);
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await screen.findByText('Suggestion generation is temporarily unavailable.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Generate guidance' })).toBeEnabled();
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
    project.stage = 1;
    project.furthestStage = 1;
    await resumeSavedProject(project);
    expect(screen.getByRole('button', { name: 'Generate current guidance' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Generate current guidance before sending');
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/submissions')).toHaveLength(0);
  });

  it('marks a consumed or unavailable evaluation stale and prompts fresh generation', async () => {
    const project = createDefaultProject();
    project.stage = 1;
    project.furthestStage = 1;
    preflightPostResponder = () => jsonResponse({ error: 'The preflight evaluation is unavailable, expired, or already used.' }, 409);
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await screen.findByRole('heading', { name: 'Return to your memo' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Send to instructor' }));
    expect(await screen.findByText(/evaluation expired or was already used/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Generate current guidance' })).toBeVisible();
    await waitFor(() => expect(storedProject().preflight.evaluation.evaluationId).toBe('[unavailable]'));
  });

  it('stores the shared and project configuration snapshots with a preflight event', async () => {
    await resumeSavedProject();
    await waitFor(() => {
      const configCalls = fetchMock.mock.calls.filter(([path]) => String(path).startsWith('/api/config/public?'));
      expect(configCalls).toHaveLength(2);
    });
    await waitFor(() => expect(storedProject().teacherGovernance?.preflight?.moduleVersions).toHaveLength(12));
    fireEvent.click(screen.getByRole('button', { name: 'Review memo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await screen.findByRole('heading', { name: 'Return to your memo' })).toBeVisible();
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
    ['approve', undefined, 'The memo provides enough support.'],
    ['revise_and_approve', 'Treat the referral as a contested handoff, then confirm each candidate.', 'Proceed with the bounded revision in mind.'],
  ])('uses an instructor %s response as guidance without changing the memo, graph, or stored redirects', async (decision, focusedQuestion, instructorAnnotation) => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Check response' }));
    expect(await screen.findByRole('heading', { name: "Read your instructor's response" })).toBeVisible();
    expect(screen.getByText(instructorAnnotation)).toBeVisible();
    if (focusedQuestion) {
      expect(screen.getByRole('heading', { name: 'Question from your instructor' })).toBeVisible();
      expect(screen.getByText(focusedQuestion)).toBeVisible();
    }
    expect(screen.queryByRole('heading', { name: 'Revised suggestion' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose nodes and connections' })).toBeVisible();
    await waitFor(() => expect(storedProject().preflight.review).toMatchObject({ status: 'approved', decision, revision: 2 }));
    expect(storedProject().submission.text).toBe(originalMemo);
    expect(storedProject().graph).toEqual(originalGraph);
    expect(storedProject().preflight.redirects).toEqual(originalRedirects);

    fireEvent.click(screen.getByRole('button', { name: 'Choose nodes and connections' }));
    expect(await screen.findByRole('heading', { name: 'Choose nodes and describe connections' })).toBeVisible();
  });

  it('keeps rejected review guidance in the review section without redirecting or editing the memo or map', async () => {
    const project = projectAwaitingReview();
    const originalMemo = project.submission.text;
    const originalGraph = structuredClone(project.graph);
    preflightGetResponder = () => jsonResponse({ submission: reviewRecord(project.id, {
      status: 'rejected',
      decision: 'reject',
      revision: 2,
      reviewedAt: '2026-08-09T13:00:00.000Z',
      instructorAnnotation: 'Clarify who performs the second handoff, then submit again.',
    }) });

    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Check response' }));
    expect(await screen.findByRole('heading', { name: "Read your instructor's response" })).toBeVisible();
    expect(screen.getByText('Clarify who performs the second handoff, then submit again.')).toBeVisible();
    await waitFor(() => expect(storedProject()).toMatchObject({ stage: 1, preflight: { review: { status: 'rejected', decision: 'reject', revision: 2 } } }));
    expect(storedProject().submission.text).toBe(originalMemo);
    expect(storedProject().graph).toEqual(originalGraph);
    expect(screen.getByRole('button', { name: 'Choose nodes and connections' })).toBeVisible();
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
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check response' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Add your memo' })).toBeVisible();
    await waitFor(() => expect(sessionReads).toBeGreaterThanOrEqual(2));
    expect(screen.queryByRole('heading', { name: 'Enter your class code' })).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Enter your class code' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your class code to continue');
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
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review memo' }));
    const recovery = await screen.findByRole('button', { name: 'Save needs attention' });
    fireEvent.click(recovery);
    expect(screen.getByRole('dialog', { name: 'Save recovery' })).toBeVisible();
    expect(screen.getByText(/You can download a copy, keep working without saving, or try saving again/i)).toBeVisible();
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
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('tab', { name: /Nodes · 2/ }));
    const rows = screen.getAllByRole('article');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Remove' }));
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Keep' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
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
    project.stage = 2;
    project.furthestStage = 2;
    const expected = withDefaultNodeLayout(accepted.map(({ x: _x, y: _y, ...node }) => node));

    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));

    await waitFor(() => expect(storedProject().stage).toBe(3));
    const committed = storedProject().graph.nodes;
    expect(committed.map(({ id, x, y }) => ({ id, x, y })))
      .toEqual(expected.map(({ id, x, y }) => ({ id, x, y })));
    expect(new Set(committed.map(({ x, y }) => `${x},${y}`)).size).toBe(committed.length);
  });

  it('records a manually added relationship in the current scale layer', async () => {
    const project = await openMapProject();
    const inspector = openMapInspector();
    fireEvent.click(within(inspector).getByRole('button', { name: 'Add relationship' }));
    const addForm = screen.getByRole('heading', { name: 'Add a relationship' }).parentElement;
    fireEvent.change(within(addForm).getByLabelText('From'), { target: { value: project.graph.nodes[0].id } });
    fireEvent.change(within(addForm).getByLabelText('Connection'), { target: { value: 'coordinates with' } });
    fireEvent.change(within(addForm).getByLabelText('To'), { target: { value: project.graph.nodes[1].id } });
    fireEvent.change(within(addForm).getByLabelText('Evidence or question'), { target: { value: 'The current Macro memo names this relationship.' } });
    fireEvent.click(within(addForm).getByRole('button', { name: 'Add relationship' }));
    await waitFor(() => expect(storedProject().graph.edges.at(-1)).toMatchObject({ scale: 'macro', verb: 'coordinates with' }));
  });

  it('opens with a label-free active-scale overview, keeps the inspector closed, and makes all scales explicit', async () => {
    const project = await openMapProject();
    const graphBefore = structuredClone(storedProject().graph);
    const scale = screen.getByRole('combobox', { name: 'Show map scale' });
    const active = graphForScale(project);
    const meso = graphForScale(project, 'meso');
    const all = graphForScale(project, 'all');
    const inspector = screen.getByLabelText('Map inspector');

    expect(scale).toHaveValue(project.activeScale);
    expect(within(scale).getAllByRole('option').at(-1)).toHaveValue('all');
    expect(mapCanvas()).toHaveAttribute('aria-label', expect.stringContaining(`Macro map. ${active.nodes.length} nodes and ${active.edges.length} connections.`));
    expect(document.querySelectorAll('.graph-edge-label')).toHaveLength(0);
    expect(document.querySelectorAll('.graph-edge.is-muted')).toHaveLength(active.edges.length);
    expect(inspector).toHaveAttribute('aria-hidden', 'true');
    expect(inspector).toHaveAttribute('inert');
    expect(document.querySelector('.map-layout')).not.toHaveClass('has-inspector');

    fireEvent.change(scale, { target: { value: 'meso' } });
    expect(scale).toHaveValue('meso');
    expect(mapCanvas()).toHaveAttribute('aria-label', expect.stringContaining(`Meso map. ${meso.nodes.length} nodes and ${meso.edges.length} connections.`));
    expect(document.querySelectorAll('.graph-edge-label')).toHaveLength(0);

    fireEvent.change(scale, { target: { value: 'all' } });
    expect(mapCanvas()).toHaveAttribute('aria-label', expect.stringContaining(`All-scales map. ${all.nodes.length} nodes and ${all.edges.length} connections.`));
    expect(screen.getByText('Choose a node to see its connections.')).toBeVisible();
    expect(document.querySelectorAll('.graph-edge-label')).toHaveLength(0);
    expect(document.querySelectorAll('.graph-edge.is-muted')).toHaveLength(all.edges.length);
    expect(storedProject().graph).toEqual(graphBefore);
  });

  it('focuses a node on its one-hop neighborhood and restores the active-scale view without changing graph data', async () => {
    const project = await openMapProject();
    const active = graphForScale(project);
    const focusNode = active.nodes.find((node) => active.edges.some((edge) => edge.source === node.id || edge.target === node.id));
    const incident = active.edges.filter((edge) => edge.source === focusNode.id || edge.target === focusNode.id);
    const focusedNodeIds = new Set([focusNode.id, ...incident.flatMap((edge) => [edge.source, edge.target])]);
    const graphBefore = structuredClone(storedProject().graph);

    const inspector = openNodeInspector(focusNode.id);
    const focusBar = document.querySelector('.map-focus-bar');
    expect(focusBar).toHaveTextContent(`Showing connections for ${focusNode.label}.`);
    expect(inspector).not.toHaveAttribute('aria-hidden');
    expect(document.querySelector('.map-layout')).toHaveClass('has-inspector');
    expect([...document.querySelectorAll('.graph-node')].map((node) => node.getAttribute('data-graph-id')).sort()).toEqual([...focusedNodeIds].sort());
    expect([...document.querySelectorAll('.graph-edge')].map((edge) => edge.getAttribute('data-graph-id')).sort()).toEqual(incident.map((edge) => edge.id).sort());
    expect(document.querySelectorAll('.graph-edge-label')).toHaveLength(incident.length);
    expect(storedProject().graph).toEqual(graphBefore);

    fireEvent.click(screen.getByRole('button', { name: 'Show full map' }));
    expect(document.querySelector('.map-focus-bar')).toBeNull();
    expect(screen.getByLabelText('Map inspector')).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelector('.map-layout')).not.toHaveClass('has-inspector');
    expect(document.querySelectorAll('.graph-node')).toHaveLength(active.nodes.length);
    expect(document.querySelectorAll('.graph-edge')).toHaveLength(active.edges.length);
    expect(storedProject().graph).toEqual(graphBefore);
  });

  it.each([
    ['desktop', false],
    ['phone', true],
  ])('renders complete map labels with separate, dynamically sized cards on %s', async (_viewport, phone) => {
    if (phone) installPhoneLayout();
    const project = makeMapProject();
    const active = graphForScale(project);
    const incidentEdge = active.edges[0];
    const sourceNode = project.graph.nodes.find((node) => node.id === incidentEdge.source);
    const longNodeLabel = 'East Harlem Disability Services coordinates transportation access across neighborhood family programs END NODE';
    const longEdgeLabel = 'coordinates referrals and follow-up support across neighborhood programs END EDGE';
    sourceNode.label = longNodeLabel;
    incidentEdge.verb = longEdgeLabel;
    project.graph.edges.forEach((edge) => {
      if (edge.source === sourceNode.id) edge.sourceLabel = longNodeLabel;
      if (edge.target === sourceNode.id) edge.targetLabel = longNodeLabel;
    });

    await openMapProject(project);
    const inspector = openNodeInspector(sourceNode.id);
    const renderedNode = document.querySelector(`.graph-node[data-graph-id="${sourceNode.id}"]`);
    const renderedEdge = document.querySelector(`.graph-edge-label[data-edge-id="${incidentEdge.id}"]`);
    const card = renderedNode.querySelector('.node-card');
    const edgeBackground = renderedEdge.querySelector('.edge-label-bg');

    expect(svgTextLines(renderedNode.querySelector('.node-label')).join(' ')).toBe(longNodeLabel);
    expect(svgTextLines(renderedEdge.querySelector('.edge-label')).join(' ')).toBe(longEdgeLabel);
    expect(renderedNode).not.toHaveTextContent('…');
    expect(renderedEdge).not.toHaveTextContent('…');
    expect(renderedNode.querySelector('.node-scale-glyph')).toBeNull();
    expect(Number(card.getAttribute('height'))).toBeGreaterThan(phone ? 82 : 72);
    expect(Number(edgeBackground.getAttribute('height'))).toBeGreaterThan(phone ? 44 : 24);
    expect(within(inspector).getByRole('heading', { name: longNodeLabel })).toHaveTextContent(longNodeLabel);

    fireEvent.click(within(inspector).getByRole('tab', { name: 'Relationships' }));
    const relationshipButton = within(within(inspector).getByLabelText('Relationship list')).getAllByRole('button')
      .find((button) => button.textContent.includes(longEdgeLabel));
    fireEvent.click(relationshipButton);
    const summary = [...inspector.querySelectorAll('.node-summary')]
      .find((details) => details.querySelector('summary')?.textContent.includes(longEdgeLabel));
    expect(summary.querySelector('summary strong')).toHaveTextContent(longEdgeLabel);
  });

  it('preserves every character in maximum-length unbroken map labels', async () => {
    const project = makeMapProject();
    const active = graphForScale(project);
    const incidentEdge = active.edges[0];
    const sourceNode = project.graph.nodes.find((node) => node.id === incidentEdge.source);
    const nodeLabel = 'N'.repeat(200);
    const edgeLabel = 'R'.repeat(100);
    sourceNode.label = nodeLabel;
    incidentEdge.verb = edgeLabel;
    project.graph.edges.forEach((edge) => {
      if (edge.source === sourceNode.id) edge.sourceLabel = nodeLabel;
      if (edge.target === sourceNode.id) edge.targetLabel = nodeLabel;
    });

    await openMapProject(project);
    openNodeInspector(sourceNode.id);
    const renderedNode = document.querySelector(`.graph-node[data-graph-id="${sourceNode.id}"] .node-label`);
    const renderedEdge = document.querySelector(`.graph-edge-label[data-edge-id="${incidentEdge.id}"] .edge-label`);

    expect(svgTextLines(renderedNode).join('')).toBe(nodeLabel);
    expect(svgTextLines(renderedEdge).join('')).toBe(edgeLabel);
    expect(renderedNode).not.toHaveTextContent('…');
    expect(renderedEdge).not.toHaveTextContent('…');
  });

  it('arranges the visible scale without moving hidden scales and persists one explicit arrangement event', async () => {
    const project = await openMapProject();
    const before = structuredClone(storedProject());
    const visibleIds = new Set([...document.querySelectorAll('.graph-node')].map((node) => node.getAttribute('data-graph-id')));
    const visibleBefore = before.graph.nodes.filter((node) => visibleIds.has(node.id));
    const hiddenBefore = before.graph.nodes.filter((node) => !visibleIds.has(node.id));
    expect(before.graph).toEqual(project.graph);
    expect(before.viewport).toEqual(project.viewport);

    fireEvent.click(screen.getByRole('button', { name: 'Arrange map' }));

    await waitFor(() => expect(storedProject().events.at(-1)).toMatchObject({ action: 'map.arranged', detail: 'Macro arranged' }));
    const arranged = storedProject();
    const arrangedVisible = arranged.graph.nodes.filter((node) => visibleIds.has(node.id));
    const arrangedHidden = arranged.graph.nodes.filter((node) => !visibleIds.has(node.id));
    expect(arrangedVisible.map(({ id, x, y }) => ({ id, x, y }))).not.toEqual(visibleBefore.map(({ id, x, y }) => ({ id, x, y })));
    expect(arrangedHidden.map(({ id, x, y }) => ({ id, x, y }))).toEqual(hiddenBefore.map(({ id, x, y }) => ({ id, x, y })));
    for (let first = 0; first < arrangedVisible.length; first += 1) {
      expect(renderedNodePosition(arrangedVisible[first].id)).toEqual({ x: arrangedVisible[first].x, y: arrangedVisible[first].y });
      for (let second = first + 1; second < arrangedVisible.length; second += 1) {
        const horizontalClearance = Math.abs(arrangedVisible[first].x - arrangedVisible[second].x);
        const verticalClearance = Math.abs(arrangedVisible[first].y - arrangedVisible[second].y);
        expect(horizontalClearance >= 184 || verticalClearance >= 72, `${arrangedVisible[first].label} overlaps ${arrangedVisible[second].label}`).toBe(true);
      }
    }
    expect(arranged.viewport).toMatchObject({ zoom: expect.any(Number), panX: expect.any(Number), panY: expect.any(Number) });
    await waitFor(() => expect(eventRequests('map_arranged')).toHaveLength(1));
  });

  it('hides internal claim-state language behind simple remove and return actions', async () => {
    const project = makeMapProject();
    const removedEdge = project.graph.edges[0];
    removedEdge.status = 'rejected';
    removedEdge.claimState = 'retired';
    await openMapProject(project);

    ['Active claims', 'All states', 'Claim state', 'student interpretation', 'inference', 'contested', 'research lead', 'retired'].forEach((label) => {
      expect(screen.queryByText(label, { exact: true })).not.toBeInTheDocument();
    });
    expect(document.querySelector(`[data-graph-id="${removedEdge.id}"]`)).toBeNull();

    const showRemoved = screen.getByRole('checkbox', { name: 'Show removed items' });
    expect(showRemoved).not.toBeChecked();
    fireEvent.click(showRemoved);
    const removedElement = document.querySelector(`[data-graph-id="${removedEdge.id}"]`);
    expect(removedElement).toBeTruthy();
    fireEvent.pointerDown(removedElement, { pointerId: 1, button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Return to map' }));
    await waitFor(() => expect(storedProject().graph.edges.find((edge) => edge.id === removedEdge.id)).toMatchObject({ status: 'confirmed', claimState: 'student interpretation' }));
  });

  it('invalidates current candidates and retires only the edited scale layer when memo text changes', async () => {
    const project = createDefaultProject();
    project.candidates = extractCandidates(project.submission);
    project.graph = structuredClone(project.candidates);
    project.graph.nodes.forEach((node) => { node.status = 'confirmed'; node.claimState = 'student interpretation'; });
    project.graph.edges.forEach((edge) => { edge.status = 'confirmed'; edge.claimState = 'student interpretation'; });
    project.stage = 0;
    project.furthestStage = 0;
    await resumeSavedProject(project);
    fireEvent.change(screen.getByRole('textbox', { name: /Memo text/ }), { target: { value: `${project.submission.text} A later memo correction changes the evidence anchor.` } });
    await waitFor(() => {
      const stored = storedProject();
      expect(stored.candidates).toEqual({ nodes: [], edges: [] });
      expect(stored.graph.nodes.filter((node) => node.scale === project.activeScale).every((node) => node.claimState === 'retired')).toBe(true);
      expect(stored.graph.edges.filter((edge) => edge.scale === project.activeScale).every((edge) => edge.claimState === 'retired')).toBe(true);
      expect(stored.graph.nodes.some((node) => node.scale !== project.activeScale && node.claimState === 'student interpretation')).toBe(true);
      expect(stored.graph.edges.some((edge) => edge.scale !== project.activeScale && edge.claimState === 'student interpretation')).toBe(true);
    });
  });

  it('keeps model configuration outside the student review section', async () => {
    const project = createDefaultProject();
    project.stage = 1;
    project.furthestStage = 1;
    await resumeSavedProject(project);
    expect(screen.getByRole('heading', { name: 'Review your memo' })).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'Model setup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Custom project instructions/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose nodes and connections' })).toBeEnabled();
  });

  it.each(['node', 'edge', 'map'])('shows annotation saving only while work is pending and persists the text for %s', async (target) => {
    const project = await openMapProject();
    const field = selectAnnotationTarget(target);
    const text = `${target} annotation saved locally`;
    fireEvent.change(field, { target: { value: text } });
    expect(annotationStatus(field)).toHaveTextContent('Saving…');
    await waitFor(() => expect(annotationStatus(field)).toBeNull());
    expect(storedAnnotation(target, project)).toBe(text);
  });

  it.each(['node', 'edge', 'map'])('changes queued %s annotation status to the actual persistence error', async (target) => {
    const project = seedProject(makeMapProject());
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    render(<App />);
    await showResumeScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Build the map' })).toBeVisible();
    const field = selectAnnotationTarget(target);
    fireEvent.change(field, { target: { value: `${target} unsaved annotation` } });
    expect(annotationStatus(field)).toHaveTextContent('Saving…');
    await waitFor(() => expect(annotationStatus(field)).toHaveTextContent('Local save failed: Quota exceeded'));
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)).id).toBe(project.id);
  });

  it('retries persistence after a temporarily erased required field is corrected', async () => {
    const project = await openMapProject();
    const priorLabel = project.graph.nodes[0].label;
    const inspector = openNodeInspector(project.graph.nodes[0].id);
    fireEvent.click(within(inspector).getByText('Summary', { selector: 'span' }));
    const label = within(inspector).getByRole('textbox', { name: 'Label' });
    expect(label).toHaveValue(priorLabel);
    fireEvent.change(label, { target: { value: '' } });
    await screen.findByText('Complete the current field to save');
    expect(storedProject().graph.nodes.find((node) => node.id === project.graph.nodes[0].id).label).toBe(priorLabel);

    fireEvent.change(label, { target: { value: 'Corrected organization label' } });
    await waitFor(() => expect(screen.queryByText('Complete the current field to save')).not.toBeInTheDocument());
    await waitFor(() => expect(storedProject().graph.nodes.find((node) => node.id === project.graph.nodes[0].id).label).toBe('Corrected organization label'));
  });

  it('moves a node through the CTM path and sends the accepted, minimized prototype-event request', async () => {
    const project = await openMapProject();
    const node = project.graph.nodes[0];
    const svg = mapCanvas();
    const nodeElement = document.querySelector(`[data-graph-id="${node.id}"]`);
    const start = renderedNodePosition(node.id);
    svg.getScreenCTM = () => ({ inverse: () => ({}) });
    svg.createSVGPoint = () => ({
      x: 0,
      y: 0,
      matrixTransform() { return { x: (this.x - 11) / 2, y: (this.y - 13) / 3 }; },
    });

    fireEvent.pointerDown(nodeElement, { pointerId: 41, button: 0, clientX: 11 + start.x * 2, clientY: 13 + start.y * 3 });
    fireEvent.pointerMove(svg, { pointerId: 41, clientX: 11 + start.x * 2 + 32, clientY: 13 + start.y * 3 + 27 });
    fireEvent.pointerUp(svg, { pointerId: 41, clientX: 11 + start.x * 2 + 32, clientY: 13 + start.y * 3 + 27 });

    await waitFor(() => expect(document.querySelector(`[data-graph-id="${node.id}"]`)).toHaveAttribute('transform', `translate(${start.x + 16} ${start.y + 9})`));
    await waitFor(() => expect(eventRequests('node_moved')).toHaveLength(1));
    expect(eventRequests('node_moved')[0].body).toEqual({
      event: 'node_moved',
      stage: 'build map',
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
    const svg = mapCanvas();
    const nodeElement = document.querySelector(`[data-graph-id="${node.id}"]`);
    const start = renderedNodePosition(node.id);
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
    fireEvent.pointerDown(nodeElement, { pointerId: 29, button: 0, clientX: start.x, clientY: start.y });
    expect(inspector).toHaveAttribute('aria-hidden', 'true');
    fireEvent.pointerMove(svg, { pointerId: 29, clientX: start.x + 24, clientY: start.y + 16 });
    expect(inspector).toHaveAttribute('aria-hidden', 'true');
    fireEvent.pointerUp(svg, { pointerId: 29, clientX: start.x + 24, clientY: start.y + 16 });
    expect(inspector).toHaveAttribute('aria-hidden', 'true');
    expect(inspector).not.toHaveClass('is-open');

    await waitFor(() => expect(storedProject().graph.nodes.find((item) => item.id === node.id)).toMatchObject({ x: start.x + 24, y: start.y + 16 }));
    const coordinateWrites = setItem.mock.calls.filter(([key, value]) => {
      if (key !== STORAGE_KEY) return false;
      const saved = JSON.parse(value);
      return saved.graph.nodes.some((item) => item.id === node.id && item.x === start.x + 24 && item.y === start.y + 16);
    });
    expect(coordinateWrites).toHaveLength(1);
    expect(eventRequests('node_moved')).toHaveLength(1);

    setItem.mockClear();
    fireEvent.pointerDown(document.querySelector(`[data-graph-id="${node.id}"]`), { pointerId: 30, button: 0, clientX: start.x + 24, clientY: start.y + 16 });
    fireEvent.pointerUp(svg, { pointerId: 30, clientX: start.x + 24, clientY: start.y + 16 });
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
    const position = renderedNodePosition(node.id);
    const svg = mapCanvas();
    const inspector = screen.getByLabelText('Map inspector');
    svg.getScreenCTM = () => ({ inverse: () => ({}) });
    svg.createSVGPoint = () => ({
      x: 0,
      y: 0,
      matrixTransform() { return { x: this.x, y: this.y }; },
    });

    const keyButton = screen.getByRole('button', { name: 'Map key' });
    fireEvent.click(keyButton);
    expect(screen.getByLabelText('Map key')).toBeVisible();
    expect(inspector).toHaveAttribute('aria-hidden', 'true');
    expect(inspector).toHaveAttribute('inert');
    fireEvent.pointerDown(nodeElement, { pointerId: 51, button: 0, clientX: position.x, clientY: position.y });
    fireEvent.pointerUp(svg, { pointerId: 51, clientX: position.x, clientY: position.y });
    await waitFor(() => expect(inspector).toHaveClass('is-open'));
    expect(screen.queryByLabelText('Map key')).not.toBeInTheDocument();
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

    fireEvent.pointerDown(nodeElement, { pointerId: 52, button: 0, clientX: position.x, clientY: position.y });
    fireEvent.pointerUp(svg, { pointerId: 52, clientX: position.x, clientY: position.y });
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
    const svg = mapCanvas();
    const nodeElement = document.querySelector(`[data-graph-id="${node.id}"]`);
    const position = renderedNodePosition(node.id);
    svg.getScreenCTM = () => null;
    svg.getBoundingClientRect = () => ({ left: 100, top: 50, width: 420, height: 540, right: 520, bottom: 590, x: 100, y: 50, toJSON() {} });
    const startX = 100 + position.x * 0.5;
    const startY = 185 + position.y * 0.5;

    fireEvent.pointerDown(nodeElement, { pointerId: 7, button: 0, clientX: startX, clientY: startY });
    fireEvent.pointerMove(svg, { pointerId: 7, clientX: startX + 20, clientY: startY + 15 });
    fireEvent.pointerUp(svg, { pointerId: 7, clientX: startX + 20, clientY: startY + 15 });

    await waitFor(() => expect(document.querySelector(`[data-graph-id="${node.id}"]`)).toHaveAttribute('transform', `translate(${position.x + 40} ${position.y + 30})`));
  });

  it('supports fine and coarse keyboard movement and persists the final coordinates', async () => {
    const project = await openMapProject();
    const node = project.graph.nodes[0];
    const nodeElement = document.querySelector(`[data-graph-id="${node.id}"]`);
    const start = renderedNodePosition(node.id);
    nodeElement.focus();
    fireEvent.keyDown(nodeElement, { key: 'ArrowRight' });
    fireEvent.keyDown(nodeElement, { key: 'ArrowDown', shiftKey: true });

    expect(nodeElement).toHaveFocus();
    await waitFor(() => expect(document.querySelector(`[data-graph-id="${node.id}"]`)).toHaveAttribute('transform', `translate(${start.x + 8} ${start.y + 24})`));
    expect(screen.getByText(`${node.label} moved to x ${start.x + 8}, y ${start.y + 24}.`)).toBeInTheDocument();
    await waitFor(() => expect(storedProject().graph.nodes.find((item) => item.id === node.id)).toMatchObject({ x: start.x + 8, y: start.y + 24 }));
  });

  it('restores a readable saved layout, viewport, and annotations without rearranging on reload', async () => {
    const project = makeMapProject();
    project.graph.nodes.forEach((node, index) => {
      node.x = 80 + (index % 4) * 220;
      node.y = 70 + Math.floor(index / 4) * 130;
    });
    const savedPosition = { x: project.graph.nodes[0].x, y: project.graph.nodes[0].y };
    project.graph.nodes[0].annotations.analytical.text = 'Restored node annotation';
    project.graph.edges[0].annotation.text = 'Restored relationship annotation';
    project.mapAnnotation.text = 'Restored whole-map annotation';
    project.viewport = { panX: 37, panY: -22, zoom: 1.25 };
    seedProject(project);

    const assertRestored = async () => {
      render(<App />);
      await showResumeScreen();
      expect(screen.getByLabelText('Saved project summary')).toHaveTextContent('Stage · Map');
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(await screen.findByRole('heading', { name: 'Build the map' })).toBeVisible();
      expect(document.querySelector(`[data-graph-id="${project.graph.nodes[0].id}"]`)).toHaveAttribute('transform', `translate(${savedPosition.x} ${savedPosition.y})`);
      expect(document.querySelector('.viewport-layer')).toHaveAttribute('transform', 'translate(37 -22) scale(1.25)');
      expect(storedProject().graph.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(project.graph.nodes.map(({ id, x, y }) => ({ id, x, y })));
      expect(storedProject().viewport).toEqual(project.viewport);
      const inspector = openNodeInspector(project.graph.nodes[0].id);
      expect(within(inspector).getByRole('textbox', { name: /^Annotation/ })).toHaveValue('Restored node annotation');
      fireEvent.click(within(inspector).getByRole('tab', { name: 'Relationships' }));
      const relationshipPanel = within(inspector).getByRole('tabpanel', { name: 'Relationships' });
      fireEvent.click(within(within(relationshipPanel).getByLabelText('Relationship list')).getAllByRole('button')[0]);
      expect(within(relationshipPanel).getByRole('textbox', { name: 'Annotation' })).toHaveValue('Restored relationship annotation');
      fireEvent.click(within(inspector).getByRole('tab', { name: 'Map' }));
      expect(within(inspector).getByRole('textbox', { name: /^Map note/ })).toHaveValue('Restored whole-map annotation');
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
    project.events.push({
      id: 'evt_legacy_source_imported',
      action: 'source.imported',
      detail: 'field-memo.docx',
      actor: 'student',
      at: '2026-08-17T12:00:00.000Z',
    });
    project.stage = 4;
    project.furthestStage = 4;
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
      expect(screen.getByText('nodes on map')).toBeVisible();
      expect(screen.getByText('items needing evidence')).toBeVisible();
      expect(screen.getByText('memo imported')).toBeInTheDocument();
      expect(screen.queryByText('source imported')).not.toBeInTheDocument();
      expect(screen.queryByText('research leads')).not.toBeInTheDocument();
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
      expect(csv).toContain('"label_or_from"');
      expect(csv).not.toContain('label_or_source');
      expect(csv).not.toContain('claim_state');
      expect(csv).not.toContain('"confirmed"');

      fireEvent.click(screen.getByRole('button', { name: 'Markdown' }));
      expect(blobs).toHaveLength(2);
      const markdown = blobs[1].parts.join('');
      expect(markdown).toContain('## Memo');
      expect(markdown).not.toMatch(/^## Source\b/m);
      expect(markdown).toContain('## Items needing evidence');
      expect(markdown).not.toMatch(/\b(?:student interpretation|inference|contested|research lead|retired|claim_state)\b/i);
    } finally {
      if (priorCreate === undefined) delete URL.createObjectURL; else URL.createObjectURL = priorCreate;
      if (priorRevoke === undefined) delete URL.revokeObjectURL; else URL.revokeObjectURL = priorRevoke;
    }
  });
});
