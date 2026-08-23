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
  stableId,
  withDefaultNodeLayout,
} from './domain.js';

const STORAGE_KEY = 'systems-mapping-studio.project.v6';
const LEGACY_V5_STORAGE_KEY = 'systems-mapping-studio.project.v5';
const PERSIST_DEBOUNCE_MS = 450;

let studentSession;
let accessResponder;
let preflightEvaluationResponder;
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
      participantName: project.participantName,
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
    ...(project.activeScale === 'meso' ? {
      carriedNodes: project.graph.nodes
        .filter((node) => node.scale === 'micro' && node.status !== 'rejected' && node.claimState !== 'retired')
        .map(({ id, label, type }) => ({ id, label, type })),
    } : {}),
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
  const review = overrides.review || memoReviewFixture();
  return {
    id: EVALUATION_ID,
    review: structuredClone(review),
    configSnapshot,
    runtime: overrides.runtime || { provider: 'deterministic', model: 'STEM Splitter', createdAt },
    createdAt,
    expiresAt: overrides.expiresAt || '2027-01-16T08:00:00.000Z',
  };
}

function memoReviewFixture() {
  return {
    guidance: [{
      point: 'The memo grounds the referral in a specific handoff.',
      evidenceExcerpt: 'The school refers the student to the committee.',
    }, {
      point: 'Where does the delay enter the referral process?',
    }],
    nodes: [
      { label: 'School', type: 'organization', scale: 'meso', evidence: 'The school refers the student to the committee.' },
      { label: 'Committee', type: 'agency', scale: 'meso', evidence: 'The school refers the student to the committee.' },
    ],
    connections: [{ source: 'School', target: 'Committee', verb: 'refers students to', rationale: 'The memo names the referral directly.' }],
    example: 'One evident connection: the school refers students to the committee, because the memo names that handoff directly.',
    readiness: { ready: true, note: 'The memo already supports mapping. Continue to choose nodes and connections.' },
  };
}

function projectWithMemoReview(overrides = {}) {
  const project = createDefaultProject();
  const evaluation = evaluationRecord(evaluationPayloadFixture(project));
  project.preflight = {
    memoReview: structuredClone(evaluation.review),
    configurationSnapshot: structuredClone(evaluation.configSnapshot),
    evaluation: {
      evaluationId: evaluation.id,
      runtime: evaluation.runtime,
      createdAt: evaluation.createdAt,
      expiresAt: evaluation.expiresAt,
    },
    sourceFingerprint: project.submission.fingerprint || stableId('src', project.submission.text),
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

function makeMapProject(activeScale = 'meso') {
  const project = createDefaultProject();
  project.candidates = { nodes: [], edges: [] };
  project.graph = extractCandidates(project.submission);
  project.graph.nodes.forEach((node) => {
    if (node.scale === 'meso') node.scale = 'micro';
    node.status = 'confirmed';
    node.claimState = 'student interpretation';
  });
  project.graph.edges.forEach((edge) => {
    if (edge.scale === 'micro') edge.scale = 'meso';
    edge.status = 'confirmed';
    edge.claimState = 'student interpretation';
  });
  const levels = ['micro', 'meso', 'exosphere', 'macrosphere'];
  project.releasedScales = levels.slice(0, levels.indexOf(activeScale) + 1);
  project.activeScale = activeScale;
  if (activeScale === 'macrosphere') {
    const outerNode = project.graph.nodes.find((node) => node.scale === 'exosphere');
    const outerEdge = project.graph.edges.find((edge) => edge.scale === 'exosphere');
    if (outerNode) outerNode.scale = 'macrosphere';
    if (outerEdge) outerEdge.scale = 'macrosphere';
  }
  const activeEndpointIds = new Set(project.graph.edges
    .filter((edge) => edge.scale === activeScale)
    .flatMap((edge) => [edge.source, edge.target]));
  project.graph.nodes.sort((left, right) => Number(right.scale === activeScale || activeEndpointIds.has(right.id))
    - Number(left.scale === activeScale || activeEndpointIds.has(left.id)));
  project.graph.edges.sort((left, right) => Number(right.scale === activeScale) - Number(left.scale === activeScale));
  project.stage = 3;
  project.furthestStage = 3;
  return project;
}

function makeRevisionProject(activeScale = 'micro') {
  const project = makeMapProject(activeScale);
  const levels = ['micro', 'meso', 'exosphere', 'macrosphere'];
  const activeIndex = levels.indexOf(activeScale);
  project.completedScales = levels.slice(0, activeIndex);
  project.stage = 4;
  project.furthestStage = 4;
  project.reflection = `Stale ${activeScale} reflection`;
  if (activeScale === 'meso') {
    project.candidates = {
      nodes: [],
      edges: [structuredClone(project.graph.edges.find((edge) => edge.scale === 'meso'))],
    };
  } else {
    project.candidates = {
      nodes: [structuredClone(project.graph.nodes.find((node) => node.scale === activeScale)
        || project.graph.nodes.find((node) => node.scale === 'micro'))],
      edges: [],
    };
  }
  const evaluation = evaluationRecord(evaluationPayloadFixture(project));
  project.preflight = {
    memoReview: structuredClone(evaluation.review),
    configurationSnapshot: structuredClone(evaluation.configSnapshot),
    evaluation: {
      evaluationId: evaluation.id,
      runtime: evaluation.runtime,
      createdAt: evaluation.createdAt,
      expiresAt: evaluation.expiresAt,
    },
    sourceFingerprint: project.submission.fingerprint || stableId('src', project.submission.text),
  };
  return project;
}

function makeSixNodeMicroProject() {
  const project = makeMapProject('micro');
  const labels = [
    'East Harlem Disability Services',
    'Adult Participants',
    'Family Support Navigator',
    'Family Caregivers',
    'Lexington Avenue Program Office',
    'Accessible Van Program',
  ];
  project.graph.nodes = project.graph.nodes.slice(0, labels.length).map((node, index) => ({
    ...node,
    label: labels[index],
    scale: 'micro',
    x: 150 + (index % 3) * 270,
    y: 175 + Math.floor(index / 3) * 190,
  }));
  project.graph.edges = [];
  project.viewport = { panX: 37, panY: -22, zoom: 1.25 };
  return project;
}

function makePhoneEcologyOverviewProject() {
  const project = makeSixNodeMicroProject();
  project.releasedScales = ['micro', 'meso', 'exosphere', 'macrosphere'];
  return project;
}

function makeDenseEcologyOverviewProject() {
  const project = makePhoneEcologyOverviewProject();
  const template = project.graph.nodes[0];
  const labelsByScale = {
    micro: [
      'East Harlem Disability Services',
      'Adult Participants',
      'Family Support Navigator',
      'Family Caregivers',
      'Lexington Avenue Program Office',
      'Accessible Van Program',
    ],
    exosphere: [
      'Borough Grants Unit',
      'City Disability Services Office',
      'Public Transportation Authority',
      'Workforce Development Agency',
      'Community Health Funding Council',
      'Neighborhood Provider Network',
      'Community Advisory Council',
      'Care Coordination Partnership',
    ],
    macrosphere: [
      'State Disability Services Policy',
      'Federal Accessibility Standards',
      'Public Benefits Funding Rules',
      'Regional Housing Conditions',
      'National Employment Policy',
      'Local Transit Coalition',
      'Family Support Alliance',
    ],
  };
  project.graph.nodes = Object.entries(labelsByScale).flatMap(([scale, labels], scaleIndex) => labels.map((label, index) => ({
    ...template,
    id: `dense-${scale}-${index}`,
    label,
    scale,
    x: 150 + (index % 3) * 248,
    y: 175 + scaleIndex * 140 + Math.floor(index / 3) * 90,
    annotations: {
      analytical: { id: `annotation-dense-${scale}-${index}-analytical`, text: '' },
      evidence: { id: `annotation-dense-${scale}-${index}-evidence`, text: '' },
    },
  })));
  project.graph.edges = [];
  return project;
}

function makeCrossLayerEcologyProject() {
  const project = makeMapProject('exosphere');
  const source = project.graph.nodes.find((node) => node.scale === 'exosphere');
  const target = project.graph.nodes.find((node) => node.scale === 'micro');
  const edge = project.graph.edges[0];
  Object.assign(source, { label: 'Borough Grants Unit', x: 2660, y: 1220 });
  Object.assign(target, { label: 'East Harlem Disability Services', x: 1250, y: 1180 });
  project.graph.nodes = [target, source];
  project.graph.edges = [{
    ...edge,
    id: 'edge-cross-layer-funds',
    source: source.id,
    target: target.id,
    sourceLabel: source.label,
    targetLabel: target.label,
    verb: 'funds',
    scale: 'exosphere',
  }];
  project.viewport = { zoom: 0.85, panX: -1841, panY: -767 };
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

function installPhoneLayout(width = 390) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
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

function installResponsiveLayout(initialWidth = 1024) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: initialWidth });
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return window.innerWidth <= 600; },
    media: '(max-width: 600px)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
  return (width) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
    act(() => window.dispatchEvent(new Event('resize')));
  };
}

function viewportTransform() {
  const value = document.querySelector('.viewport-layer')?.getAttribute('transform') || '';
  const match = value.match(/^translate\((-?[\d.]+) (-?[\d.]+)\) scale\(([\d.]+)\)$/);
  if (!match) throw new Error(`Unexpected viewport transform: ${value}`);
  return { panX: Number(match[1]), panY: Number(match[2]), zoom: Number(match[3]) };
}

function translatedRectBounds(group, rect) {
  const match = (group.getAttribute('transform') || '').match(/^translate\((-?[\d.]+) (-?[\d.]+)\)$/);
  if (!match) throw new Error(`Unexpected translated group: ${group.getAttribute('transform')}`);
  const left = Number(match[1]) + Number(rect.getAttribute('x'));
  const top = Number(match[2]) + Number(rect.getAttribute('y'));
  const width = Number(rect.getAttribute('width'));
  const height = Number(rect.getAttribute('height'));
  return { left, top, right: left + width, bottom: top + height };
}

function rectsIntersect(left, right) {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top;
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
    expect(screen.getByRole('button', { name: 'Choose nodes' })).toBeVisible();
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

  it('loads the v5 browser workspace as legacy data and persists it under the v6 key', async () => {
    const legacy = createDefaultProject();
    legacy.schemaVersion = 5;
    delete legacy.participantName;
    window.localStorage.setItem(LEGACY_V5_STORAGE_KEY, JSON.stringify(legacy));

    render(<App />);
    await showResumeScreen();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Add your memo' })).toBeVisible();
    await waitFor(() => expect(storedProject()).toMatchObject({ schemaVersion: 6, participantName: '' }));
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
    await resumeSavedProject();
    expect(screen.getByRole('heading', { name: 'Add your memo' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Map title (optional)' })).toHaveValue('NYC systems and assets map');
    expect(screen.getByRole('textbox', { name: 'Student or group name (optional)' })).toHaveValue('');
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
    const guidance = await screen.findByRole('region', { name: 'What the model noticed' });
    expect(within(guidance).getAllByRole('article')).toHaveLength(2);
    expect(within(guidance).getByText('The memo grounds the referral in a specific handoff.')).toBeVisible();
    expect(within(guidance).getByText('Where does the delay enter the referral process?')).toBeVisible();
    expect(within(guidance).getByText('The school refers the student to the committee.')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Where your memo stands' })).toHaveTextContent('The memo already supports mapping');
    const scaffold = screen.getByRole('complementary', { name: 'Nodes evident in your memo' });
    expect(within(scaffold).getByLabelText('Nodes evident in the memo')).toHaveTextContent('School');
    expect(within(scaffold).queryByText('refers students to')).not.toBeInTheDocument();
    expect(within(scaffold).queryByText(/One evident connection: the school refers students to the committee/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Return to your memo' })).not.toBeInTheDocument();
    expect(screen.queryByText('Instructor guidance')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Add a note' })).not.toBeInTheDocument();
    expect(screen.queryByText('Add a note')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Note for instructor/ })).not.toBeInTheDocument();
    const visibleStageText = document.querySelector('.workspace').textContent;
    expect(visibleStageText).not.toMatch(/\bsources?\b/i);
    expect(visibleStageText).not.toMatch(/\binstructor review\b/i);
    expect(visibleStageText).not.toMatch(/\b(?:H[1-4]|C[1-8])\b/);
    expect(visibleStageText).not.toMatch(/\b(?:conditional|hold|score|scoring|criterion|criteria|checklist|hard gate)\b/i);
    expect(screen.queryByRole('tab', { name: 'Model setup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Custom project instructions/ })).not.toBeInTheDocument();
  });

  it('generates memo guidance without requiring a hidden inquiry field', async () => {
    const project = createDefaultProject();
    project.inquiry = '';
    project.stage = 1;
    project.furthestStage = 1;
    await resumeSavedProject(project);
    expect(screen.queryByRole('textbox', { name: 'Guiding inquiry' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));

    expect(await screen.findByRole('region', { name: 'What the model noticed' })).toBeVisible();
    const request = fetchMock.mock.calls.find(([path, options]) => String(path) === '/api/preflight/evaluations' && options.method === 'POST');
    expect(JSON.parse(request[1].body).inquiry).toBe('');
  });

  it('opens a non-advancing map preview and returns to the current memo stage', async () => {
    const project = createDefaultProject();
    await resumeSavedProject(project);

    const scale = screen.getByRole('combobox', { name: 'Level' });
    fireEvent.change(scale, { target: { value: 'exosphere' } });
    await waitFor(() => expect(storedProject()).toMatchObject({ activeScale: 'exosphere', releasedScales: ['micro', 'exosphere'] }));

    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(await screen.findByRole('heading', { name: 'Build the map' })).toBeVisible();
    expect(screen.getByRole('group', { name: /Exosphere map\. 0 nodes and 0 connections/ })).toBeVisible();
    expect(storedProject().stage).toBe(0);
    expect(storedProject().furthestStage).toBe(project.furthestStage);
    fireEvent.click(within(document.querySelector('.app-footer')).getByRole('button', { name: 'Back to Memo' }));
    expect(await screen.findByRole('heading', { name: 'Add your memo' })).toBeVisible();
    expect(storedProject().stage).toBe(0);
    expect(storedProject().furthestStage).toBe(project.furthestStage);
  });

  it('groups the four scale options under concise Part 1 and Part 2 labels', async () => {
    await resumeSavedProject(createDefaultProject());

    const scale = screen.getByRole('combobox', { name: 'Level' });
    const groups = scale.querySelectorAll('optgroup');
    expect([...groups].map((group) => group.label)).toEqual(['Part 1', 'Part 2']);
    expect([...groups[0].querySelectorAll('option')].map((option) => option.value)).toEqual(['micro', 'meso']);
    expect([...groups[1].querySelectorAll('option')].map((option) => option.value)).toEqual(['exosphere', 'macrosphere']);

    fireEvent.change(scale, { target: { value: 'macrosphere' } });
    await waitFor(() => expect(storedProject()).toMatchObject({ activeScale: 'macrosphere' }));
    expect(screen.queryByText('Where is your population present, and who interacts with them there?')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('keeps the memo intake limited to fields students need', async () => {
    await resumeSavedProject(createDefaultProject());

    expect(screen.getByRole('combobox', { name: 'Level' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Map title (optional)' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Student or group name (optional)' })).toBeVisible();
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

  it('shows a Micro-only Revise and Export summary without exposing stored Meso relationships', async () => {
    const project = makeRevisionProject('micro');
    const graphBefore = structuredClone(project.graph);
    const micro = graphForScale(project, 'micro');
    expect(graphBefore.edges.some((edge) => edge.scale === 'meso')).toBe(true);

    await resumeSavedProject(project);
    expect(screen.getByRole('heading', { name: 'Describe your revision. Export a copy.' })).toBeVisible();

    const currentMap = screen.getByLabelText('Current Micro map summary');
    expect(currentMap).toHaveTextContent(`${micro.nodes.length} nodes`);
    expect(currentMap).not.toHaveTextContent(/relationships?/i);
    const summary = document.querySelector('.release-summary');
    const relationshipMetric = [...summary.children]
      .find((item) => item.querySelector('span')?.textContent === 'relationships');
    expect(relationshipMetric).toBeUndefined();
    expect(storedProject().graph).toEqual(graphBefore);
  });

  it.each([
    ['micro', 'meso', 'Continue to Meso'],
    ['meso', 'exosphere', 'Continue to Exosphere'],
    ['exosphere', 'macrosphere', 'Continue to Macrosphere'],
    ['macrosphere', 'macrosphere', 'Start another Macrosphere cycle'],
  ])('completing %s resets cycle-only work and continues at %s', async (activeScale, expectedScale, cta) => {
    const project = makeRevisionProject(activeScale);
    const graphBefore = structuredClone(project.graph);
    const releasedBefore = [...project.releasedScales];
    await resumeSavedProject(project);

    const continueButton = within(document.querySelector('.app-footer')).getByRole('button', { name: cta });
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);

    // The next level continues directly at Review — the memo travels with the
    // project, so the student is never routed back through the intake form.
    await waitFor(() => expect(storedProject()).toMatchObject({
      activeScale: expectedScale,
      stage: 1,
      furthestStage: 4,
      preflight: null,
      candidates: { nodes: [], edges: [] },
      reflection: '',
    }));
    const stored = storedProject();
    expect(stored.completedScales).toEqual(expect.arrayContaining([activeScale]));
    expect(stored.graph).toEqual(graphBefore);
    if (activeScale === 'macrosphere') {
      expect(stored.releasedScales).toEqual(releasedBefore);
    } else {
      expect(stored.releasedScales).toEqual([...releasedBefore, expectedScale]);
    }
    expect(screen.getByRole('heading', { name: 'Review your memo' })).toBeVisible();
    expect(screen.getByText(`Part ${['micro', 'meso'].includes(expectedScale) ? 1 : 2} · ${expectedScale === 'micro' ? 'Micro' : expectedScale === 'meso' ? 'Meso' : expectedScale === 'exosphere' ? 'Exosphere' : 'Macrosphere'}`)).toBeVisible();
  });

  it('persists the optional student or group name and shows it in the project-link summary', async () => {
    await resumeSavedProject(createDefaultProject());
    const participant = screen.getByRole('textbox', { name: 'Student or group name (optional)' });
    fireEvent.change(participant, { target: { value: 'East Harlem mapping group' } });
    await waitFor(() => expect(storedProject().participantName).toBe('East Harlem mapping group'));

    fireEvent.click(screen.getByRole('button', { name: 'Project link' }));
    const dialog = screen.getByRole('dialog', { name: 'Project link' });
    expect(within(dialog).getByText('Student or group name (optional)')).toBeVisible();
    expect(within(dialog).getByText('East Harlem mapping group')).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Project link' }));

    cleanup();
    render(<App />);
    await showResumeScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('textbox', { name: 'Student or group name (optional)' })).toHaveValue('East Harlem mapping group');
  });

  it('keeps Map and all five stages available with guidance present and never mentions instructor review', async () => {
    const project = projectWithMemoReview();
    await resumeSavedProject(project);
    expect(screen.getByRole('region', { name: 'Where your memo stands' })).toBeVisible();
    expect(document.querySelector('.workspace').textContent).not.toMatch(/instructor review|send to instructor|note for instructor/i);
    screen.getAllByRole('button', { name: 'Choose nodes' }).forEach((button) => expect(button).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Map' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Stages' }));
    const stageMenu = screen.getByRole('dialog', { name: 'Five stages' });
    SYSTEMS_MAPPING_STAGES.forEach(({ label }) => expect(within(stageMenu).getByRole('button', { name: new RegExp(label, 'i') })).toBeEnabled());
  });

  it('keeps forward stage navigation available while optional model requests are running', async () => {
    let releaseReview;
    preflightEvaluationResponder = (body) => new Promise((resolve) => {
      releaseReview = () => resolve(jsonResponse({ evaluation: evaluationRecord(body) }, 201));
    });
    const reviewProject = createDefaultProject();
    reviewProject.stage = 1;
    reviewProject.furthestStage = 1;
    await resumeSavedProject(reviewProject);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await screen.findByText('The model is reading your memo…')).toBeVisible();
    const reviewForward = within(document.querySelector('.app-footer')).getByRole('button', { name: 'Choose nodes' });
    expect(reviewForward).toBeEnabled();
    fireEvent.click(reviewForward);
    expect(await screen.findByRole('heading', { name: 'Choose your nodes' })).toBeVisible();
    await act(async () => { releaseReview(); await Promise.resolve(); });

    cleanup();
    window.localStorage.clear();
    let releaseConnections;
    connectionSuggestionResponder = (body) => new Promise((resolve) => {
      releaseConnections = () => resolve(jsonResponse({ connections: [{
        source: body.nodes[0].id,
        target: body.nodes[1].id,
        verb: 'supports',
        rationale: 'The student described support between these nodes.',
      }] }, 201));
    });
    const connectionProject = createDefaultProject();
    connectionProject.activeScale = 'exosphere';
    connectionProject.releasedScales = ['micro', 'meso', 'exosphere'];
    connectionProject.candidates.nodes = extractCandidates(connectionProject.submission).nodes.slice(0, 2).map((node) => ({
      ...node,
      scale: 'exosphere',
      status: 'confirmed',
      claimState: 'student interpretation',
    }));
    connectionProject.stage = 2;
    connectionProject.furthestStage = 2;
    await resumeSavedProject(connectionProject);
    fireEvent.click(screen.getByRole('tab', { name: 'More connections' }));
    fireEvent.click(screen.getByRole('button', { name: 'Suggest connections' }));
    expect(screen.getByRole('button', { name: 'Refining map…' })).toBeDisabled();
    const connectionForward = within(document.querySelector('.app-footer')).getByRole('button', { name: 'Open map' });
    expect(connectionForward).toBeEnabled();
    fireEvent.click(connectionForward);
    expect(await screen.findByRole('heading', { name: 'Build the map' })).toBeVisible();
    await act(async () => { releaseConnections(); await Promise.resolve(); });
  });

  it('opens an empty map from candidate choice instead of gating on generated items', async () => {
    const project = createDefaultProject();
    project.stage = 2;
    project.furthestStage = 2;
    project.candidates = { nodes: [], edges: [] };
    await resumeSavedProject(project);

    expect(screen.getByText(/add elements yourself on the map/i)).toBeVisible();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Describe connections between nodes' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
    expect(await screen.findByRole('heading', { name: 'Build the map' })).toBeVisible();
    await waitFor(() => expect(storedProject().stage).toBe(3));
  });

  it('uses the student description to request editable connections and adds only accepted suggestions to the map', async () => {
    const project = createDefaultProject();
    project.activeScale = 'exosphere';
    project.releasedScales = ['micro', 'meso', 'exosphere'];
    const nodes = extractCandidates(project.submission).nodes.slice(0, 3).map((node) => ({
      ...node,
      scale: 'exosphere',
      status: 'confirmed',
      claimState: 'student interpretation',
    }));
    project.candidates = { nodes, edges: [] };
    project.graph = { nodes: [], edges: [] };
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);

    fireEvent.click(screen.getByRole('tab', { name: 'More connections' }));
    expect(screen.getByRole('heading', { name: 'Describe connections between nodes' })).toBeVisible();
    expect(screen.getByText(/add directions if you want the model to focus/i)).toBeVisible();
    const prompt = 'Families rely on schools, but delayed referrals make services harder to reach in this session.';
    fireEvent.click(screen.getByText('Steer the suggestions (optional)'));
    expect(screen.getByText(/prompt the custom AI model to formulate new connections/i)).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: /Describe connections between nodes/ }), { target: { value: prompt } });
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
    project.activeScale = 'exosphere';
    project.releasedScales = ['micro', 'meso', 'exosphere'];
    const longNodeLabel = 'East Harlem Disability Services coordinates transportation access across neighborhood family programs END NODE';
    const longEdgeLabel = 'coordinates referrals and follow-up support across neighborhood programs END EDGE';
    const nodes = extractCandidates(project.submission).nodes.slice(0, 3).map((node, index) => ({
      ...node,
      scale: 'exosphere',
      ...(index === 0 ? { label: longNodeLabel } : {}),
      status: 'confirmed',
      claimState: 'student interpretation',
    }));
    project.candidates = { nodes, edges: [] };
    project.graph = { nodes: [], edges: [] };
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);

    fireEvent.click(screen.getByRole('tab', { name: 'More connections' }));
    fireEvent.click(screen.getByText('Steer the suggestions (optional)'));
    fireEvent.change(screen.getByRole('textbox', { name: /Describe connections between nodes/ }), { target: { value: 'Connect these nodes using the relationships described in the memo.' } });
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

  it('shows the model text verbatim without canned praise when the review is sparse', async () => {
    const project = createDefaultProject();
    project.stage = 1;
    project.furthestStage = 1;
    preflightEvaluationResponder = (body) => jsonResponse({
      evaluation: evaluationRecord(body, {
        review: { guidance: [], nodes: [], connections: [], example: null, readiness: { ready: false, note: '' } },
      }),
    }, 201);
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    const guidance = await screen.findByRole('region', { name: 'What the model noticed' });
    expect(within(guidance).getByText(/returned no guidance this time/)).toBeVisible();
    expect(within(guidance).queryAllByRole('article')).toHaveLength(0);
    expect(guidance.textContent).not.toMatch(/\b(?:pass|complete|met|score|criterion|checklist)\b/i);
  });

  it('rejects an oversized guidance list without persisting it', async () => {
    const project = createDefaultProject();
    project.stage = 1;
    project.furthestStage = 1;
    preflightEvaluationResponder = (body) => jsonResponse({
      evaluation: evaluationRecord(body, {
        review: {
          ...memoReviewFixture(),
          guidance: Array.from({ length: 9 }, (_, index) => ({ point: `Guidance point ${index + 1}.` })),
        },
      }),
    }, 201);
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await screen.findByText(/no more than 8 items/i)).toBeVisible();
    expect(storedProject().preflight).toBeNull();
  });

  it('uses the exact evaluation envelope and keeps the stored memo review portable after reload', async () => {
    const project = createDefaultProject();
    project.participantName = 'East Harlem mapping group';
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Review memo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await screen.findByRole('region', { name: 'What the model noticed' })).toBeVisible();

    const evaluationRequest = fetchMock.mock.calls.find(([path, options]) => String(path) === '/api/preflight/evaluations' && options.method === 'POST');
    const evaluationBody = JSON.parse(evaluationRequest[1].body);
    expect(Object.keys(evaluationBody).sort()).toEqual(['activeScale', 'stageId', 'inquiry', 'projectMetadata', 'projectOverlay', 'sourceMaterial', 'sourceRecord'].sort());
    expect(Object.keys(evaluationBody.projectMetadata).sort()).toEqual(['clientUpdatedAt', 'furthestStage', 'id', 'participantName', 'projectId', 'schemaVersion', 'sharingTier', 'stage', 'submissionId', 'title'].sort());
    expect(evaluationBody.projectMetadata.participantName).toBe('East Harlem mapping group');
    expect(Object.keys(evaluationBody.sourceRecord)).toEqual(['id', 'sensitive', 'consent']);
    expect(evaluationBody.sourceRecord).not.toHaveProperty('participantName');
    expect(JSON.stringify(evaluationBody)).not.toMatch(/"(?:author|date|sourceType|sourceTitle|location|rights|evidenceOwnership)"/);
    expect(evaluationBody).toMatchObject({ activeScale: 'micro', stageId: 'review-suggestions', sourceMaterial: createDefaultProject().submission.text });
    expect(evaluationBody.projectOverlay).toMatchObject({ baseModel: 'STEM Splitter', customInstructions: createDefaultProject().configs.preflight.customInstructions, revision: 1 });
    expect(evaluationBody.projectOverlay).not.toHaveProperty('fixedPrompt');
    await waitFor(() => expect(storedProject().preflight?.evaluation?.evaluationId).toBe(EVALUATION_ID));
    const storedPreflight = storedProject().preflight;
    expect(Object.keys(storedPreflight).sort()).toEqual(['configurationSnapshot', 'evaluation', 'memoReview', 'sourceFingerprint']);
    expect(storedPreflight.memoReview).toEqual(memoReviewFixture());
    expect(storedPreflight).not.toHaveProperty('hard');
    expect(storedPreflight).not.toHaveProperty('scored');
    expect(storedPreflight).not.toHaveProperty('outcome');
    expect(storedPreflight.configurationSnapshot.projectOverlay).not.toHaveProperty('customInstructions');
    expect(storedPreflight.configurationSnapshot.projectOverlay).not.toHaveProperty('fixedPrompt');
    const portablePreflight = createPortableProject(storedProject()).preflight;
    expect(Object.keys(portablePreflight).sort()).toEqual(['configurationSnapshot', 'evaluation', 'memoReview', 'sourceFingerprint']);
    expect(portablePreflight.evaluation.evaluationId).toBe('[redacted]');
    expect(storedProject().candidates).toEqual({ nodes: [], edges: [] });

    cleanup();
    render(<App />);
    await showResumeScreen();
    expect(screen.getByLabelText('Saved project summary')).toHaveTextContent('Stage · Review');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('region', { name: 'Where your memo stands' })).toBeVisible();
    expect(screen.getByText('The memo already supports mapping. Continue to choose nodes and connections.')).toBeVisible();
  });

  it('sends the exact carried Micro node IDs when Meso guidance is generated', async () => {
    const project = createDefaultProject();
    const microNodes = extractCandidates(project.submission).nodes
      .filter((node) => node.scale === 'micro')
      .slice(0, 2)
      .map((node) => ({ ...node, status: 'confirmed', claimState: 'student interpretation' }));
    microNodes[0].label = 'Renamed family support participants';
    project.activeScale = 'meso';
    project.releasedScales = ['micro', 'meso'];
    project.graph = { nodes: microNodes, edges: [] };
    project.candidates = { nodes: [], edges: [] };
    project.preflight = null;
    project.stage = 0;
    project.furthestStage = 0;

    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Review memo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    await screen.findByRole('region', { name: 'What the model noticed' });

    const request = fetchMock.mock.calls.find(([path, options]) => String(path) === '/api/preflight/evaluations' && options.method === 'POST');
    const body = JSON.parse(request[1].body);
    expect(body.carriedNodes).toEqual(microNodes.map(({ id, label, type }) => ({ id, label, type })));
    expect(body.carriedNodes[0].id).not.toBe(stableId('node', body.carriedNodes[0].label));
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

  it.each(['ollama-cloud', 'openrouter'])('enforces the reported %s UTF-8 memo boundary before provider egress', async (provider) => {
    const project = createDefaultProject();
    project.submission.text = '😀'.repeat(33_000);
    project.stage = 1;
    project.furthestStage = 1;
    studentSession = () => ({
      ...grantedAccess(),
      persistence: 'course-server',
      suggestionRuntime: { provider, model: 'gpt-oss:120b', maxSourceBytes: 131072 },
    });
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await screen.findByText(/too large for the reported model runtime/i)).toBeVisible();
    expect(screen.getByText(/131,072 UTF-8 bytes maximum/i)).toBeVisible();
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(0);
    expect(storedProject().submission.text).toBe(project.submission.text);
  });

  it.each(['ollama-cloud', 'openrouter'])('enforces the %s UTF-8 inquiry boundary before provider egress', async (provider) => {
    const project = createDefaultProject();
    project.inquiry = '😀'.repeat(2_050);
    project.stage = 1;
    project.furthestStage = 1;
    studentSession = () => ({
      ...grantedAccess(),
      persistence: 'course-server',
      suggestionRuntime: { provider, model: 'gpt-oss:120b', maxSourceBytes: 131072 },
    });
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await screen.findByText(/guiding inquiry is too large for the reported model runtime/i)).toBeVisible();
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

  it('marks guidance refreshable after a memo edit without erasing the guidance or any work', async () => {
    const project = projectWithMemoReview();
    await resumeSavedProject(project);
    expect(screen.getByRole('region', { name: 'Where your memo stands' })).toBeVisible();
    expect(screen.queryByText(/Your memo has changed since this guidance was generated/)).not.toBeInTheDocument();

    const drawer = document.querySelector('.memo-drawer');
    drawer.open = true;
    fireEvent.change(within(drawer).getByRole('textbox', { name: /Memo text/ }), {
      target: { value: `${project.submission.text} A later correction adds one more connection.` },
    });

    expect(await screen.findByText(/Your memo has changed since this guidance was generated/)).toBeVisible();
    expect(screen.getByRole('region', { name: 'What the model noticed' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Refresh guidance' })).toBeEnabled();
    screen.getAllByRole('button', { name: 'Choose nodes' }).forEach((button) => expect(button).toBeEnabled());
    await waitFor(() => expect(storedProject().preflight.memoReview).toEqual(memoReviewFixture()));
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
    expect(await screen.findByRole('region', { name: 'What the model noticed' })).toBeVisible();
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

  it('keeps Micro node-only even when the provider returns connections', async () => {
    const project = projectWithMemoReview();
    await resumeSavedProject(project);
    expect(screen.queryByText('refers students to')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('region', { name: 'Where your memo stands' })).getByRole('button', { name: 'Choose nodes' }));
    expect(await screen.findByRole('heading', { name: 'Choose your nodes' })).toBeVisible();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Confirm how they connect' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Describe connections between nodes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Describe connections between nodes/ })).not.toBeInTheDocument();
    await waitFor(() => {
      const stored = storedProject();
      expect(stored.stage).toBe(2);
      expect(stored.candidates.nodes.map(({ label }) => label)).toEqual(expect.arrayContaining(['School', 'Committee']));
      expect(stored.candidates.nodes.every((node) => node.scale === 'micro')).toBe(true);
      expect(stored.candidates.edges).toEqual([]);
    });
    fireEvent.click(screen.getByRole('button', { name: /Keep all/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
    await waitFor(() => expect(storedProject().stage).toBe(3));
    expect(storedProject().graph.edges).toEqual([]);
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/map/connections')).toHaveLength(0);
  });

  it('carries only discrete Micro actors and objects from a proposition into review and the map', async () => {
    const project = createDefaultProject();
    project.submission.text = 'Adult Participants face delays when the Accessible Van Program is unavailable.';
    project.stage = 1;
    project.furthestStage = 1;
    const review = {
      guidance: [{ point: 'The memo names participants and a transportation program.' }],
      nodes: [],
      connections: [],
      example: null,
      readiness: { ready: false, note: 'Choose the actors and objects that belong in Micro.' },
    };
    const evaluation = evaluationRecord(evaluationPayloadFixture(project), { review });
    project.preflight = {
      memoReview: structuredClone(evaluation.review),
      configurationSnapshot: structuredClone(evaluation.configSnapshot),
      evaluation: {
        evaluationId: evaluation.id,
        runtime: evaluation.runtime,
        createdAt: evaluation.createdAt,
        expiresAt: evaluation.expiresAt,
      },
      sourceFingerprint: stableId('src', project.submission.text),
    };

    await resumeSavedProject(project);
    fireEvent.click(within(screen.getByRole('region', { name: 'Where your memo stands' })).getByRole('button', { name: 'Choose nodes' }));
    expect(await screen.findByRole('heading', { name: 'Choose your nodes' })).toBeVisible();

    const expectedLabels = ['Adult Participants', 'Accessible Van Program'];
    expect(screen.getAllByRole('textbox', { name: 'Node label' }).map((input) => input.value)).toEqual(expectedLabels);
    await waitFor(() => {
      expect(storedProject().candidates.nodes.map(({ label }) => label)).toEqual(expectedLabels);
      expect(storedProject().candidates.nodes.every((node) => node.scale === 'micro')).toBe(true);
      expect(storedProject().candidates.edges).toEqual([]);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Keep all 2 remaining' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
    expect(await screen.findByRole('heading', { name: 'Build the map' })).toBeVisible();
    await waitFor(() => {
      expect(storedProject().graph.nodes.map(({ label }) => label)).toEqual(expectedLabels);
      expect(storedProject().graph.edges).toEqual([]);
    });
    expect([...document.querySelectorAll('.graph-node')].map((node) => node.getAttribute('data-full-label'))).toEqual(expectedLabels);
  });

  it('never renders or commits a clause-like Micro node from a stored model review', async () => {
    const project = projectWithMemoReview();
    const clauseLabel = 'Adult Participants face delays when the Accessible Van Program is unavailable.';
    const discreteLabel = 'Accessible Van Program';
    project.submission.text = 'transportation access is delayed.';
    project.preflight.sourceFingerprint = stableId('src', project.submission.text);
    project.preflight.memoReview.nodes = [
      { label: clauseLabel, type: 'event', scale: 'micro', evidence: clauseLabel },
      { label: discreteLabel, type: 'resource', scale: 'micro', evidence: clauseLabel },
    ];
    project.preflight.memoReview.connections = [];
    project.preflight.memoReview.example = null;

    await resumeSavedProject(project);
    const surfacedNodes = screen.getByLabelText('Nodes evident in the memo');
    expect(within(surfacedNodes).queryByText(clauseLabel)).not.toBeInTheDocument();
    expect(within(surfacedNodes).getByText(discreteLabel)).toBeVisible();

    fireEvent.click(within(screen.getByRole('region', { name: 'Where your memo stands' })).getByRole('button', { name: 'Choose nodes' }));
    expect(await screen.findByRole('heading', { name: 'Choose your nodes' })).toBeVisible();
    expect(screen.getAllByRole('textbox', { name: 'Node label' }).map((input) => input.value)).toEqual([discreteLabel]);
    expect(screen.queryByDisplayValue(clauseLabel)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep all 1 remaining' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
    expect(await screen.findByRole('heading', { name: 'Build the map' })).toBeVisible();
    await waitFor(() => {
      expect(storedProject().graph.nodes.map(({ label }) => label)).toEqual([discreteLabel]);
      expect(storedProject().graph.edges).toEqual([]);
    });
    expect(document.querySelector('.graph-node')).toHaveAttribute('data-full-label', discreteLabel);
  });

  it('reuses exact Micro node IDs for Meso connections without creating duplicate nodes', async () => {
    const project = createDefaultProject();
    const microNodes = extractCandidates(project.submission).nodes
      .slice(0, 2)
      .map((node) => ({ ...node, scale: 'micro', status: 'confirmed', claimState: 'student interpretation' }));
    microNodes[0].label = 'Renamed family support participants';
    const [source, target] = microNodes;
    expect(source.id).not.toBe(stableId('node', source.label));
    project.activeScale = 'meso';
    project.releasedScales = ['micro', 'meso'];
    project.graph = { nodes: microNodes, edges: [] };
    project.candidates = { nodes: [], edges: [] };
    project.stage = 1;
    project.furthestStage = 1;
    const review = {
      guidance: [{ point: 'The memo names a connection between the two Micro nodes.' }],
      nodes: [],
      connections: [{ source: source.id, target: target.id, sourceLabel: source.label, targetLabel: target.label, verb: 'coordinates with', rationale: 'The memo names this connection directly.' }],
      example: `${source.label} coordinates with ${target.label}.`,
      readiness: { ready: true, note: 'The memo supports reviewing a Meso connection.' },
    };
    const evaluation = evaluationRecord(evaluationPayloadFixture(project), { review });
    project.preflight = {
      memoReview: structuredClone(review),
      configurationSnapshot: structuredClone(evaluation.configSnapshot),
      evaluation: {
        evaluationId: evaluation.id,
        runtime: evaluation.runtime,
        createdAt: evaluation.createdAt,
        expiresAt: evaluation.expiresAt,
      },
      sourceFingerprint: project.submission.fingerprint || stableId('src', project.submission.text),
    };

    await resumeSavedProject(project);
    expect(screen.getByRole('heading', { name: 'Connections evident in your memo' })).toBeVisible();
    microNodes.forEach((node) => expect(screen.getByRole('region', { name: 'Nodes carried forward from Micro' })).toHaveTextContent(node.label));
    fireEvent.click(within(screen.getByRole('region', { name: 'Where your memo stands' })).getByRole('button', { name: 'Choose connections' }));
    expect(await screen.findByRole('heading', { name: 'Confirm how they connect' })).toBeVisible();
    const carried = screen.getByRole('region', { name: 'Nodes from Micro' });
    microNodes.forEach((node) => expect(within(carried).getByText(node.label)).toBeVisible());
    expect(screen.queryByRole('tab', { name: /Nodes/ })).not.toBeInTheDocument();
    // The review's carried-ID connection plus the locally extracted
    // Family-requests-School relationship between the same carried nodes.
    expect(screen.getByRole('tab', { name: 'Connections · 2' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'More connections' })).toBeVisible();
    await waitFor(() => {
      expect(storedProject().candidates.nodes).toEqual([]);
      expect(storedProject().candidates.edges[0]).toMatchObject({ source: source.id, target: target.id, scale: 'meso' });
    });

    const connectionRow = screen.getAllByRole('article')[0];
    fireEvent.click(within(connectionRow).getByRole('button', { name: 'Keep' }));
    fireEvent.click(screen.getByRole('tab', { name: 'More connections' }));
    fireEvent.click(screen.getByRole('button', { name: 'Suggest connections' }));
    await screen.findByRole('textbox', { name: 'Connection for suggestion 1' });
    const suggestionRequest = fetchMock.mock.calls.find(([path, options]) => String(path) === '/api/map/connections' && options.method === 'POST');
    expect(JSON.parse(suggestionRequest[1].body).nodes.map(({ id }) => id)).toEqual(microNodes.map(({ id }) => id));

    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
    await waitFor(() => expect(storedProject().stage).toBe(3));
    expect(storedProject().graph.nodes.map(({ id }) => id)).toEqual(microNodes.map(({ id }) => id));
    expect(new Set(storedProject().graph.nodes.map(({ id }) => id)).size).toBe(microNodes.length);
    expect(storedProject().graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: source.id, target: target.id, verb: 'coordinates with', scale: 'meso' }),
    ]));
  });

  it('keeps an existing Micro node in Micro when an Exosphere memo names it again', async () => {
    const project = createDefaultProject();
    const existing = {
      ...extractCandidates(project.submission).nodes.find((node) => node.scale === 'micro'),
      status: 'confirmed',
      claimState: 'student interpretation',
    };
    existing.label = 'Renamed family participants';
    const originalIdentity = { id: existing.id, label: existing.label, scale: existing.scale };
    const outerLabel = 'New York City Department of Community Access';
    project.activeScale = 'exosphere';
    project.releasedScales = ['micro', 'meso', 'exosphere'];
    project.graph = { nodes: [existing], edges: [] };
    project.candidates = { nodes: [], edges: [] };
    project.instructor.requireStudentConfirmation = false;
    project.stage = 1;
    project.furthestStage = 1;
    const review = {
      guidance: [{ point: 'The memo names an indirect institutional influence.' }],
      nodes: [
        { label: existing.label, type: existing.type, scale: 'exosphere', evidence: 'The memo names the participants.' },
        { label: outerLabel, type: 'agency', scale: 'exosphere', evidence: 'The memo names the department.' },
      ],
      connections: [{ source: outerLabel, target: existing.label, verb: 'shapes access for', rationale: 'The memo describes the indirect influence.' }],
      example: `${outerLabel} shapes access for ${existing.label}.`,
      readiness: { ready: true, note: 'The memo supports an Exosphere cycle.' },
    };
    const evaluation = evaluationRecord(evaluationPayloadFixture(project), { review });
    project.preflight = {
      memoReview: structuredClone(review),
      configurationSnapshot: structuredClone(evaluation.configSnapshot),
      evaluation: {
        evaluationId: evaluation.id,
        runtime: evaluation.runtime,
        createdAt: evaluation.createdAt,
        expiresAt: evaluation.expiresAt,
      },
      sourceFingerprint: project.submission.fingerprint || stableId('src', project.submission.text),
    };

    await resumeSavedProject(project);
    fireEvent.click(within(screen.getByRole('region', { name: 'Where your memo stands' })).getByRole('button', { name: 'Choose institutions' }));
    await waitFor(() => {
      const stored = storedProject();
      expect(stored.candidates.nodes.some((node) => node.id === existing.id)).toBe(false);
      expect(stored.candidates.nodes.find((node) => node.label === outerLabel)).toMatchObject({ scale: 'exosphere', status: 'confirmed' });
      expect(stored.candidates.edges).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: stableId('node', outerLabel), target: existing.id, scale: 'exosphere' }),
      ]));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
    await waitFor(() => expect(storedProject().stage).toBe(3));
    expect(storedProject().graph.nodes.find((node) => node.id === existing.id)).toMatchObject(originalIdentity);
    expect(storedProject().graph.nodes.filter((node) => node.id === existing.id)).toHaveLength(1);
    expect(storedProject().graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: stableId('node', outerLabel), target: existing.id, scale: 'exosphere' }),
    ]));
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
    project.candidates = { nodes: extracted.nodes.slice(0, 2).map((node) => ({ ...node, scale: 'micro' })), edges: [] };
    project.graph = {
      nodes: project.candidates.nodes.map((node) => ({ ...node, status: 'confirmed', claimState: 'student interpretation' })),
      edges: [],
    };
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);
    const rows = screen.getAllByRole('article');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Remove' }));
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Keep' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
    await waitFor(() => {
      expect(storedProject().graph.nodes.find((node) => node.id === project.candidates.nodes[0].id)).toMatchObject({ status: 'rejected', claimState: 'retired' });
    });
  });

  it('keeps a relationship whose verb is outside the course vocabulary when the student chooses Keep', async () => {
    const project = createDefaultProject();
    project.activeScale = 'exosphere';
    project.releasedScales = ['micro', 'meso', 'exosphere'];
    const extracted = extractCandidates(project.submission);
    const nodes = extracted.nodes.slice(0, 2).map((node) => ({ ...node, scale: 'exosphere', status: 'confirmed', claimState: 'student interpretation' }));
    const edge = {
      ...extracted.edges[0],
      source: nodes[0].id,
      target: nodes[1].id,
      sourceLabel: nodes[0].label,
      targetLabel: nodes[1].label,
      verb: 'receives an invitation from',
      status: 'pending',
      claimState: 'inference',
      evidence: 'The memo describes the invitation directly.',
      scale: 'exosphere',
    };
    project.candidates = { nodes, edges: [edge] };
    project.graph = { nodes: [], edges: [] };
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);

    fireEvent.click(screen.getByRole('tab', { name: /Connections · 1/ }));
    const row = screen.getAllByRole('article')[0];
    fireEvent.click(within(row).getByRole('button', { name: 'Keep' }));
    expect(within(row).getByRole('button', { name: 'Keep' })).toHaveClass('is-active');
    await waitFor(() => expect(storedProject().candidates.edges[0]).toMatchObject({ status: 'confirmed', claimState: 'student interpretation' }));

    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
    await waitFor(() => expect(storedProject().graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ verb: 'receives an invitation from', status: 'confirmed', claimState: 'student interpretation' }),
    ])));
  });

  it('lays out the accepted subset on a first build without changing later saved positions', async () => {
    const project = createDefaultProject();
    const accepted = extractCandidates(project.submission).nodes.slice(0, 4).map((node) => ({
      ...node,
      scale: 'micro',
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
    const microNodes = project.graph.nodes.filter((node) => node.scale === 'micro');
    const inspector = openMapInspector();
    fireEvent.click(within(inspector).getByRole('button', { name: 'Add' }));
    const addActions = document.getElementById('inspector-add-actions');
    fireEvent.click(within(addActions).getByRole('button', { name: 'Relationship' }));
    const addForm = screen.getByRole('heading', { name: 'Add a relationship' }).parentElement;
    fireEvent.change(within(addForm).getByLabelText('From'), { target: { value: microNodes[0].id } });
    fireEvent.change(within(addForm).getByLabelText('Connection'), { target: { value: 'coordinates with' } });
    fireEvent.change(within(addForm).getByLabelText('To'), { target: { value: microNodes[1].id } });
    fireEvent.change(within(addForm).getByLabelText('Evidence or question'), { target: { value: 'The current Meso memo names this relationship.' } });
    fireEvent.click(within(addForm).getByRole('button', { name: 'Add relationship' }));
    await waitFor(() => expect(storedProject().graph.edges.at(-1)).toMatchObject({
      source: microNodes[0].id,
      target: microNodes[1].id,
      scale: 'meso',
      verb: 'coordinates with',
    }));
  });

  it('limits manual map additions to nodes in Micro and carried-node relationships in Meso', async () => {
    await openMapProject(makeMapProject('micro'));
    let inspector = openMapInspector();
    fireEvent.click(within(inspector).getByRole('button', { name: 'Add' }));
    let actions = document.getElementById('inspector-add-actions');
    expect(within(actions).getByRole('button', { name: 'Node' })).toBeVisible();
    expect(within(actions).queryByRole('button', { name: 'Relationship' })).not.toBeInTheDocument();

    cleanup();
    const project = await openMapProject(makeMapProject('meso'));
    inspector = openMapInspector();
    fireEvent.click(within(inspector).getByRole('button', { name: 'Add' }));
    actions = document.getElementById('inspector-add-actions');
    expect(within(actions).queryByRole('button', { name: 'Node' })).not.toBeInTheDocument();
    fireEvent.click(within(actions).getByRole('button', { name: 'Relationship' }));
    const addForm = screen.getByRole('heading', { name: 'Add a relationship' }).parentElement;
    const expectedLabels = project.graph.nodes
      .filter((node) => node.scale === 'micro')
      .map((node) => node.label);
    expect(within(within(addForm).getByLabelText('From')).getAllByRole('option').map((option) => option.textContent)).toEqual(expectedLabels);
    expect(within(within(addForm).getByLabelText('To')).getAllByRole('option').map((option) => option.textContent)).toEqual(expectedLabels);
  });

  it('places Meso relationship labels in the Meso annulus while their endpoints remain Micro and filters without writes', async () => {
    const project = makeMapProject('meso');
    const meso = graphForScale(project, 'meso');
    const graphBefore = structuredClone(project.graph);
    await openMapProject(project);

    expect(mapCanvas()).toHaveAttribute('data-map-mode', 'ecology');
    expect(document.querySelector('[data-ecology-layer="meso"]')).toHaveClass('is-visible');
    const renderedNodes = [...document.querySelectorAll('.graph-node')];
    expect(renderedNodes).toHaveLength(meso.nodes.length);
    renderedNodes.forEach((node) => {
      expect(node).toHaveClass('graph-node--micro');
      expect(node).toHaveAttribute('aria-label', expect.stringContaining('Micro level'));
    });

    const mesoLabels = [...document.querySelectorAll('.graph-edge-label[data-edge-scale="meso"][data-edge-route="layer-anchor"]')];
    expect(mesoLabels).toHaveLength(meso.edges.length);
    const mesoLabelBounds = [];
    mesoLabels.forEach((label) => {
      const anchorX = Number(label.getAttribute('data-anchor-x'));
      const anchorY = Number(label.getAttribute('data-anchor-y'));
      const offsetX = anchorX - 1600;
      const offsetY = anchorY - 1200;
      const insideMicro = (offsetX ** 2) / (600 ** 2) + (offsetY ** 2) / (420 ** 2);
      const insideMeso = (offsetX ** 2) / (910 ** 2) + (offsetY ** 2) / (650 ** 2);
      expect(insideMicro, `${label.getAttribute('data-full-label')} is still inside Micro`).toBeGreaterThan(1);
      expect(insideMeso, `${label.getAttribute('data-full-label')} falls outside Meso`).toBeLessThan(1);
      const edge = document.querySelector(`.graph-edge[data-graph-id="${label.getAttribute('data-edge-id')}"]`);
      expect(edge).toHaveAttribute('data-edge-route', 'layer-anchor');
      expect(edge.querySelector('.edge-line').getAttribute('d')).toContain(`L ${anchorX} ${anchorY} L`);
      const labelText = label.querySelector('.edge-label');
      expect(labelText).toHaveStyle({ fontSize: '24px' });
      expect(svgTextLines(labelText).join(' ')).toBe(label.getAttribute('data-full-label'));
      const background = label.querySelector('.edge-label-bg');
      expect(Number(background.getAttribute('height'))).toBeGreaterThanOrEqual(38);
      const bounds = {
        left: Number(background.getAttribute('x')),
        top: Number(background.getAttribute('y')),
        right: Number(background.getAttribute('x')) + Number(background.getAttribute('width')),
        bottom: Number(background.getAttribute('y')) + Number(background.getAttribute('height')),
      };
      mesoLabelBounds.push({ label: label.getAttribute('data-full-label'), bounds });
      [
        [bounds.left, bounds.top],
        [bounds.right, bounds.top],
        [bounds.left, bounds.bottom],
        [bounds.right, bounds.bottom],
      ].forEach(([cornerX, cornerY]) => {
        const cornerOffsetX = cornerX - 1600;
        const cornerOffsetY = cornerY - 1200;
        const cornerInsideMicro = (cornerOffsetX ** 2) / (600 ** 2) + (cornerOffsetY ** 2) / (420 ** 2);
        const cornerInsideMeso = (cornerOffsetX ** 2) / (910 ** 2) + (cornerOffsetY ** 2) / (650 ** 2);
        expect(cornerInsideMicro, `${label.getAttribute('data-full-label')} background crosses into Micro`).toBeGreaterThan(1);
        expect(cornerInsideMeso, `${label.getAttribute('data-full-label')} background leaves Meso`).toBeLessThan(1);
      });
    });
    for (let first = 0; first < mesoLabelBounds.length; first += 1) {
      for (let second = first + 1; second < mesoLabelBounds.length; second += 1) {
        expect(
          rectsIntersect(mesoLabelBounds[first].bounds, mesoLabelBounds[second].bounds),
          `${mesoLabelBounds[first].label} overlaps ${mesoLabelBounds[second].label}`,
        ).toBe(false);
      }
    }

    const scale = screen.getByRole('combobox', { name: 'Show map layer' });
    fireEvent.change(scale, { target: { value: 'micro' } });
    expect(document.querySelectorAll('.graph-edge[data-edge-scale="meso"]')).toHaveLength(0);
    expect(document.querySelectorAll('.graph-edge-label[data-edge-scale="meso"]')).toHaveLength(0);
    fireEvent.change(scale, { target: { value: 'meso' } });
    expect(document.querySelectorAll('.graph-edge[data-edge-scale="meso"]')).toHaveLength(meso.edges.length);
    expect(document.querySelectorAll('.graph-edge-label[data-edge-scale="meso"]')).toHaveLength(meso.edges.length);
    expect(storedProject().graph).toEqual(graphBefore);
  });

  it.each(['exosphere', 'macrosphere'])('renders the %s ecological backdrop and changes layer filters without mutating graph data', async (activeScale) => {
    const project = await openMapProject(makeMapProject(activeScale));
    const graphBefore = structuredClone(storedProject().graph);
    const scale = screen.getByRole('combobox', { name: 'Show map layer' });
    const active = graphForScale(project);
    const meso = graphForScale(project, 'meso');
    const all = graphForScale(project, 'all');
    const inspector = screen.getByLabelText('Map inspector');

    expect(scale).toHaveValue(project.activeScale);
    expect(within(scale).getAllByRole('option').map((option) => option.value)).toEqual([...project.releasedScales, 'all']);
    expect(mapCanvas()).toHaveAttribute('data-map-mode', 'ecology');
    expect(mapCanvas()).toHaveAttribute('aria-label', expect.stringContaining(`${activeScale === 'exosphere' ? 'Exosphere' : 'Macrosphere'} map. ${active.nodes.length} nodes and ${active.edges.length} ${active.edges.length === 1 ? 'connection' : 'connections'}.`));
    expect(document.querySelectorAll('[data-ecology-layer]')).toHaveLength(project.releasedScales.length);
    expect(document.querySelector(`[data-ecology-layer="${activeScale}"]`)).toHaveClass('is-visible');
    expect(document.querySelectorAll('[data-ecology-layer].is-muted')).toHaveLength(project.releasedScales.length - 1);
    const activeLabels = [...document.querySelectorAll(`.graph-edge-label[data-edge-scale="${activeScale}"][data-edge-route="layer-anchor"]`)];
    expect(activeLabels).toHaveLength(active.edges.length);
    const band = activeScale === 'exosphere'
      ? { innerRx: 910, innerRy: 650, outerRx: 1220, outerRy: 880 }
      : { innerRx: 1220, innerRy: 880, outerRx: 1540, outerRy: 1140 };
    activeLabels.forEach((label) => {
      const offsetX = Number(label.getAttribute('data-anchor-x')) - 1600;
      const offsetY = Number(label.getAttribute('data-anchor-y')) - 1200;
      const outsideInnerBand = (offsetX ** 2) / (band.innerRx ** 2) + (offsetY ** 2) / (band.innerRy ** 2);
      const insideOuterBand = (offsetX ** 2) / (band.outerRx ** 2) + (offsetY ** 2) / (band.outerRy ** 2);
      expect(outsideInnerBand, `${label.getAttribute('data-full-label')} falls inside an earlier layer`).toBeGreaterThan(1);
      expect(insideOuterBand, `${label.getAttribute('data-full-label')} falls outside ${activeScale}`).toBeLessThan(1);
    });
    expect(screen.getByText('Choose a node to see its connections.')).toBeVisible();
    expect(inspector).toHaveAttribute('aria-hidden', 'true');
    expect(inspector).toHaveAttribute('inert');
    expect(document.querySelector('.map-layout')).not.toHaveClass('has-inspector');

    fireEvent.change(scale, { target: { value: 'meso' } });
    expect(scale).toHaveValue('meso');
    expect(mapCanvas()).toHaveAttribute('aria-label', expect.stringContaining(`Meso map. ${meso.nodes.length} nodes and ${meso.edges.length} ${meso.edges.length === 1 ? 'connection' : 'connections'}.`));
    expect(document.querySelectorAll('.graph-edge-label[data-edge-scale="meso"]')).toHaveLength(meso.edges.length);

    fireEvent.change(scale, { target: { value: 'all' } });
    expect(mapCanvas()).toHaveAttribute('aria-label', expect.stringContaining(`All-layers map. ${all.nodes.length} nodes and ${all.edges.length} ${all.edges.length === 1 ? 'connection' : 'connections'}.`));
    expect(screen.getByText('Choose a node to see its connections.')).toBeVisible();
    expect(document.querySelectorAll('[data-ecology-layer].is-visible')).toHaveLength(project.releasedScales.length);
    expect(document.querySelectorAll('.graph-edge-label')).toHaveLength(0);
    expect(document.querySelectorAll('.graph-edge.is-muted')).toHaveLength(all.edges.length);
    expect(storedProject().graph).toEqual(graphBefore);
  });

  it('uses the ecological map when an outer layer is available and centers a readable layer view', async () => {
    const project = makeMapProject('meso');
    project.releasedScales.push('exosphere');
    await openMapProject(project);

    expect(mapCanvas()).toHaveAttribute('data-map-mode', 'ecology');
    fireEvent.click(screen.getByRole('button', { name: 'Center map' }));
    await waitFor(() => expect(storedProject().viewport.panX).not.toBe(0));
    const viewport = storedProject().viewport;
    expect(viewport.zoom).toBeGreaterThanOrEqual(0.25);
    expect(Math.abs((420 - viewport.panX) / viewport.zoom - 1600)).toBeLessThan(30);
    expect(Math.abs((270 - viewport.panY) / viewport.zoom - 1200)).toBeLessThan(30);
  });

  it('toggles the map into full screen, exits with Escape, and cleans up the body state', async () => {
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: vi.fn((callback) => { callback(0); return 1; }),
    });
    await openMapProject(makeMapProject('meso'));
    const mapStage = document.querySelector('.map-stage');
    const canvasWrap = document.querySelector('.canvas-wrap');
    const enter = screen.getByRole('button', { name: 'Full screen map' });

    fireEvent.click(enter);
    expect(mapStage).toHaveClass('is-fullscreen');
    expect(canvasWrap).toHaveClass('is-fullscreen');
    expect(document.body).toHaveClass('map-fullscreen-open');
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeVisible();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(mapStage).not.toHaveClass('is-fullscreen');
      expect(canvasWrap).not.toHaveClass('is-fullscreen');
      expect(document.body).not.toHaveClass('map-fullscreen-open');
    });
    expect(screen.getByRole('button', { name: 'Full screen map' })).toHaveFocus();
  });

  it('zooms out to 0.25 and keeps keyboard and pointer panning available at the overview limit', async () => {
    const project = makeSixNodeMicroProject();
    project.viewport = { zoom: 1, panX: 0, panY: 0 };
    const graphBefore = structuredClone(project.graph);
    await openMapProject(project);
    const canvas = mapCanvas();
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });

    for (let index = 0; index < 12; index += 1) fireEvent.click(zoomOut);
    await waitFor(() => expect(viewportTransform().zoom).toBe(0.25));

    const pan = screen.getByRole('button', { name: 'Pan' });
    fireEvent.click(pan);
    expect(pan).toHaveAttribute('aria-pressed', 'true');
    canvas.focus();
    const beforeKeyboardPan = viewportTransform();
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    await waitFor(() => expect(viewportTransform().panX).toBeGreaterThan(beforeKeyboardPan.panX));

    canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 840, bottom: 540, width: 840, height: 540, toJSON: () => ({}) });
    const beforePointerPan = viewportTransform();
    fireEvent.pointerDown(canvas, { pointerId: 71, button: 0, clientX: 260, clientY: 190 });
    fireEvent.pointerMove(canvas, { pointerId: 71, button: 0, clientX: 300, clientY: 225 });
    fireEvent.pointerUp(canvas, { pointerId: 71, button: 0, clientX: 300, clientY: 225 });
    await waitFor(() => {
      const afterPointerPan = viewportTransform();
      expect(afterPointerPan.panX).not.toBe(beforePointerPan.panX);
      expect(afterPointerPan.panY).not.toBe(beforePointerPan.panY);
      expect(afterPointerPan.zoom).toBe(0.25);
    });
    expect(storedProject().graph).toEqual(graphBefore);
  });

  it.each([
    ['desktop', false],
    ['phone', true],
  ])('keeps arranged ecological nodes clear of one another and every layer label on %s', async (_viewport, phone) => {
    if (phone) installPhoneLayout();
    await openMapProject(makeMapProject('exosphere'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Show map layer' }), { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Arrange map' }));
    await waitFor(() => expect(eventRequests('map_arranged')).toHaveLength(1));

    const translatedRect = (group, rect) => {
      const match = (group.getAttribute('transform') || '').match(/^translate\((-?[\d.]+) (-?[\d.]+)\)$/);
      if (!match) throw new Error(`Unexpected translated group: ${group.getAttribute('transform')}`);
      const offsetX = Number(match[1]);
      const offsetY = Number(match[2]);
      const x = offsetX + Number(rect.getAttribute('x'));
      const y = offsetY + Number(rect.getAttribute('y'));
      const width = Number(rect.getAttribute('width'));
      const height = Number(rect.getAttribute('height'));
      return { left: x, top: y, right: x + width, bottom: y + height };
    };
    const intersects = (left, right) => left.left < right.right
      && left.right > right.left
      && left.top < right.bottom
      && left.bottom > right.top;
    const labelRects = [...document.querySelectorAll('.ecology-layer__label')]
      .map((group) => translatedRect(group, group.querySelector('rect')));
    const nodeRects = [...document.querySelectorAll('.graph-node')].map((group) => ({
      id: group.getAttribute('data-full-label'),
      bounds: translatedRect(group, group.querySelector('.node-card')),
    }));
    const labelCollisions = nodeRects.flatMap(({ id, bounds }) => (
      labelRects.some((label) => intersects(bounds, label)) ? [id] : []
    ));
    const nodeCollisions = [];
    nodeRects.forEach((left, first) => nodeRects.slice(first + 1).forEach((right) => {
      if (intersects(left.bounds, right.bounds)) nodeCollisions.push(`${left.id} / ${right.id}`);
    }));

    expect(labelCollisions).toEqual([]);
    expect(nodeCollisions).toEqual([]);
  });

  it.each([320, 390, 430])('keeps a six-node all-layer ecology overview readable, separate, and on canvas at %ipx without saving it', async (width) => {
    installPhoneLayout(width);
    const project = makePhoneEcologyOverviewProject();
    await openMapProject(project);
    const durableGraph = structuredClone(storedProject().graph);
    const durableViewport = { ...storedProject().viewport };

    fireEvent.change(screen.getByRole('combobox', { name: 'Show map layer' }), { target: { value: 'all' } });
    await waitFor(() => {
      expect(document.querySelectorAll('.graph-node')).toHaveLength(6);
      expect(viewportTransform().zoom).toBe(1.5);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Center map' }));

    const view = viewportTransform();
    const visible = { left: 0, right: 840, top: -130, bottom: 670 };
    const bounds = [...document.querySelectorAll('.graph-node')].map((group) => {
      const world = translatedRectBounds(group, group.querySelector('.node-card'));
      return {
        id: group.getAttribute('data-graph-id'),
        left: world.left * view.zoom + view.panX,
        right: world.right * view.zoom + view.panX,
        top: world.top * view.zoom + view.panY,
        bottom: world.bottom * view.zoom + view.panY,
      };
    });

    bounds.forEach((nodeBounds) => {
      expect(nodeBounds.left, `${nodeBounds.id} clips at the left`).toBeGreaterThanOrEqual(visible.left);
      expect(nodeBounds.right, `${nodeBounds.id} clips at the right`).toBeLessThanOrEqual(visible.right);
      expect(nodeBounds.top, `${nodeBounds.id} clips at the top`).toBeGreaterThanOrEqual(visible.top);
      expect(nodeBounds.bottom, `${nodeBounds.id} clips at the bottom`).toBeLessThanOrEqual(visible.bottom);
    });
    bounds.forEach((left, first) => bounds.slice(first + 1).forEach((right) => {
      expect(rectsIntersect(left, right), `${left.id} overlaps ${right.id}`).toBe(false);
    }));
    [...document.querySelectorAll('.graph-node')].forEach((group) => {
      expect(svgTextLines(group.querySelector('.node-label')).join(' ')).toBe(group.getAttribute('data-full-label'));
      expect(group).not.toHaveTextContent('…');
    });
    expect(storedProject().graph).toEqual(durableGraph);
    expect(storedProject().viewport).toEqual(durableViewport);
  });

  it('reflows a dense all-layer ecology map at each phone width, clears inner and outer collisions, and restores desktop without writes', async () => {
    const resizeTo = installResponsiveLayout();
    const project = makeDenseEcologyOverviewProject();
    await openMapProject(project);
    fireEvent.change(screen.getByRole('combobox', { name: 'Show map layer' }), { target: { value: 'all' } });
    const durableGraph = structuredClone(storedProject().graph);
    const durableViewport = { ...storedProject().viewport };
    const desktopPositions = new Map(project.graph.nodes.map(({ id }) => [id, renderedNodePosition(id)]));

    for (const width of [320, 390, 430]) {
      resizeTo(width);
      await waitFor(() => {
        expect(viewportTransform().zoom).toBe(1.5);
        expect(renderedNodePosition(project.graph.nodes[0].id)).not.toEqual(desktopPositions.get(project.graph.nodes[0].id));
      });

      const nodeBounds = [...document.querySelectorAll('.graph-node')].map((group) => ({
        id: group.getAttribute('data-full-label'),
        bounds: translatedRectBounds(group, group.querySelector('.node-card')),
      }));
      const layerLabelBounds = [...document.querySelectorAll('.ecology-layer__label')]
        .map((group) => translatedRectBounds(group, group.querySelector('rect')));
      const nodeCollisions = [];
      nodeBounds.forEach((left, first) => nodeBounds.slice(first + 1).forEach((right) => {
        if (rectsIntersect(left.bounds, right.bounds)) nodeCollisions.push(`${left.id} / ${right.id}`);
      }));
      const labelCollisions = nodeBounds.flatMap(({ id, bounds }) => (
        layerLabelBounds.some((label) => rectsIntersect(bounds, label)) ? [id] : []
      ));

      expect(nodeBounds).toHaveLength(21);
      expect(nodeCollisions).toEqual([]);
      expect(labelCollisions).toEqual([]);
      [...document.querySelectorAll('.graph-node')].forEach((group) => {
        expect(svgTextLines(group.querySelector('.node-label')).join(' ')).toBe(group.getAttribute('data-full-label'));
        expect(group).not.toHaveTextContent('…');
      });
      expect(storedProject().graph).toEqual(durableGraph);
      expect(storedProject().viewport).toEqual(durableViewport);

      resizeTo(1024);
      await waitFor(() => expect(viewportTransform()).toEqual(durableViewport));
      desktopPositions.forEach((position, id) => expect(renderedNodePosition(id)).toEqual(position));
      expect(storedProject().graph).toEqual(durableGraph);
      expect(storedProject().viewport).toEqual(durableViewport);
    }
  });

  it('keeps keyboard-moved ecological nodes out of their layer label', async () => {
    await openMapProject(makeMapProject('exosphere'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Show map layer' }), { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Arrange map' }));
    const node = [...document.querySelectorAll('.graph-node--exosphere')]
      .sort((left, right) => renderedNodePosition(left.getAttribute('data-graph-id')).y - renderedNodePosition(right.getAttribute('data-graph-id')).y)[0];
    for (let step = 0; step < 80; step += 1) fireEvent.keyDown(node, { key: 'ArrowUp', shiftKey: true });

    const moved = document.querySelector(`[data-graph-id="${node.getAttribute('data-graph-id')}"]`);
    const nodePosition = renderedNodePosition(node.getAttribute('data-graph-id'));
    const nodeCard = moved.querySelector('.node-card');
    const cardBounds = {
      left: nodePosition.x + Number(nodeCard.getAttribute('x')),
      right: nodePosition.x + Number(nodeCard.getAttribute('x')) + Number(nodeCard.getAttribute('width')),
      top: nodePosition.y + Number(nodeCard.getAttribute('y')),
      bottom: nodePosition.y + Number(nodeCard.getAttribute('y')) + Number(nodeCard.getAttribute('height')),
    };
    const labelGroup = document.querySelector('[data-ecology-layer="exosphere"] .ecology-layer__label');
    const labelRect = labelGroup.querySelector('rect');
    const [, labelX, labelY] = labelGroup.getAttribute('transform').match(/^translate\((-?[\d.]+) (-?[\d.]+)\)$/);
    const labelBounds = {
      left: Number(labelX) + Number(labelRect.getAttribute('x')),
      right: Number(labelX) + Number(labelRect.getAttribute('x')) + Number(labelRect.getAttribute('width')),
      top: Number(labelY) + Number(labelRect.getAttribute('y')),
      bottom: Number(labelY) + Number(labelRect.getAttribute('y')) + Number(labelRect.getAttribute('height')),
    };
    expect(cardBounds.left < labelBounds.right
      && cardBounds.right > labelBounds.left
      && cardBounds.top < labelBounds.bottom
      && cardBounds.bottom > labelBounds.top).toBe(false);
  });

  it.each([320, 390, 430])('keeps all six Micro nodes readable, separate, and on canvas at %ipx without saving the phone layout', async (width) => {
    installPhoneLayout(width);
    const project = makeSixNodeMicroProject();
    const durablePositions = project.graph.nodes.map(({ id, x, y }) => ({ id, x, y }));
    const durableViewport = { ...project.viewport };
    await openMapProject(project);

    await waitFor(() => expect(viewportTransform().zoom).toBe(1.5));
    fireEvent.click(screen.getByRole('button', { name: 'Fit map' }));
    await waitFor(() => expect(viewportTransform().zoom).toBeGreaterThanOrEqual(0.25));

    const view = viewportTransform();
    const visible = { left: 0, right: 840, top: -130, bottom: 670 };
    const bounds = [...document.querySelectorAll('.graph-node')].map((group) => {
      const position = renderedNodePosition(group.getAttribute('data-graph-id'));
      const card = group.querySelector('.node-card');
      return {
        id: group.getAttribute('data-graph-id'),
        left: (position.x + Number(card.getAttribute('x'))) * view.zoom + view.panX,
        right: (position.x + Number(card.getAttribute('x')) + Number(card.getAttribute('width'))) * view.zoom + view.panX,
        top: (position.y + Number(card.getAttribute('y'))) * view.zoom + view.panY,
        bottom: (position.y + Number(card.getAttribute('y')) + Number(card.getAttribute('height'))) * view.zoom + view.panY,
      };
    });

    expect(bounds).toHaveLength(6);
    bounds.forEach((nodeBounds) => {
      expect(nodeBounds.left, `${nodeBounds.id} clips at the left`).toBeGreaterThanOrEqual(visible.left);
      expect(nodeBounds.right, `${nodeBounds.id} clips at the right`).toBeLessThanOrEqual(visible.right);
      expect(nodeBounds.top, `${nodeBounds.id} clips at the top`).toBeGreaterThanOrEqual(visible.top);
      expect(nodeBounds.bottom, `${nodeBounds.id} clips at the bottom`).toBeLessThanOrEqual(visible.bottom);
    });
    bounds.forEach((left, first) => bounds.slice(first + 1).forEach((right) => {
      const overlapArea = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
        * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
      expect(overlapArea, `${left.id} overlaps ${right.id}`).toBe(0);
    }));
    [...document.querySelectorAll('.graph-node')].forEach((group) => {
      expect(svgTextLines(group.querySelector('.node-label')).join(' ')).toBe(group.getAttribute('data-full-label'));
      expect(group).not.toHaveTextContent('…');
    });
    expect(storedProject().graph.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(durablePositions);
    expect(storedProject().viewport).toEqual(durableViewport);
  });

  it('uses phone-only geometry across breakpoint changes and restores the exact saved desktop map', async () => {
    const resizeTo = installResponsiveLayout();
    const project = makeSixNodeMicroProject();
    const durablePositions = project.graph.nodes.map(({ id, x, y }) => ({ id, x, y }));
    const durableViewport = { ...project.viewport };
    await openMapProject(project);

    durablePositions.forEach(({ id, x, y }) => expect(renderedNodePosition(id)).toEqual({ x, y }));
    expect(viewportTransform()).toEqual(durableViewport);

    resizeTo(390);
    await waitFor(() => expect(viewportTransform().zoom).toBe(1.5));
    expect(project.graph.nodes.some((node) => renderedNodePosition(node.id).x !== node.x)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Fit map' }));
    resizeTo(1024);
    await waitFor(() => expect(viewportTransform()).toEqual(durableViewport));
    durablePositions.forEach(({ id, x, y }) => expect(renderedNodePosition(id)).toEqual({ x, y }));
    expect(storedProject().graph.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(durablePositions);
    expect(storedProject().viewport).toEqual(durableViewport);
  });

  it('keeps the initial automatic desktop fit and a nonzero relationship geometry', async () => {
    const project = makeMapProject('meso');
    project.events.push(
      { id: 'event-desktop-fit-1', action: 'graph.committed', actor: 'student', at: '2026-08-21T18:00:00.000Z', detail: 'First cycle' },
      { id: 'event-desktop-fit-2', action: 'graph.committed', actor: 'student', at: '2026-08-21T18:05:00.000Z', detail: 'Second cycle' },
    );
    const durableViewport = { ...project.viewport };
    await openMapProject(project);

    await waitFor(() => expect(viewportTransform()).not.toEqual(durableViewport));
    const line = [...document.querySelectorAll('.graph-edge .edge-line')].find((candidate) => (
      Number(candidate.getAttribute('x1')) !== Number(candidate.getAttribute('x2'))
      && Number(candidate.getAttribute('y1')) !== Number(candidate.getAttribute('y2'))
    ));
    expect(line).toBeDefined();
    expect(Number(line.getAttribute('x1'))).not.toBe(Number(line.getAttribute('x2')));
    expect(Number(line.getAttribute('y1'))).not.toBe(Number(line.getAttribute('y2')));
    expect(storedProject().viewport).toEqual(durableViewport);
  });

  it('refits a desktop-focused relationship when crossing into phone detail and restores the durable desktop map', async () => {
    const resizeTo = installResponsiveLayout();
    const project = makeMapProject('meso');
    const durablePositions = project.graph.nodes.map(({ id, x, y }) => ({ id, x, y }));
    const durableViewport = { ...project.viewport };
    await openMapProject(project);

    const edge = document.querySelector('.graph-edge');
    edge.focus();
    fireEvent.keyDown(edge, { key: 'Enter' });
    const inspector = screen.getByLabelText('Map inspector');
    fireEvent.click(within(inspector).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(inspector).toHaveAttribute('aria-hidden', 'true'));
    expect(mapCanvas()).toHaveClass('is-detail-view');

    resizeTo(390);
    await waitFor(() => {
      expect(mapCanvas()).toHaveClass('is-detail-view');
      expect(viewportTransform().zoom).toBe(1.5);
    });
    const phoneLine = document.querySelector('.graph-edge .edge-line');
    expect(Number(phoneLine.getAttribute('x1'))).not.toBe(Number(phoneLine.getAttribute('x2')));
    const view = viewportTransform();
    [...document.querySelectorAll('.graph-node')].forEach((group) => {
      const position = renderedNodePosition(group.getAttribute('data-graph-id'));
      const card = group.querySelector('.node-card');
      const bounds = {
        left: (position.x + Number(card.getAttribute('x'))) * view.zoom + view.panX,
        right: (position.x + Number(card.getAttribute('x')) + Number(card.getAttribute('width'))) * view.zoom + view.panX,
        top: (position.y + Number(card.getAttribute('y'))) * view.zoom + view.panY,
        bottom: (position.y + Number(card.getAttribute('y')) + Number(card.getAttribute('height'))) * view.zoom + view.panY,
      };
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(840);
      expect(bounds.top).toBeGreaterThanOrEqual(-130);
      expect(bounds.bottom).toBeLessThanOrEqual(670);
    });

    resizeTo(1024);
    await waitFor(() => expect(mapCanvas()).toHaveClass('is-detail-view'));
    fireEvent.click(screen.getByRole('button', { name: 'Show full map' }));
    await waitFor(() => {
      expect(mapCanvas()).not.toHaveClass('is-detail-view');
      expect(viewportTransform()).toEqual(durableViewport);
    });
    const visibleIds = [...document.querySelectorAll('.graph-node')].map((node) => node.getAttribute('data-graph-id'));
    expect(durablePositions.filter(({ id }) => visibleIds.includes(id))
      .some(({ id, x, y }) => JSON.stringify(renderedNodePosition(id)) !== JSON.stringify({ x, y }))).toBe(true);
    expect(storedProject().graph.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(durablePositions);
    expect(storedProject().viewport).toEqual(durableViewport);
  });

  it('shows a distant cross-layer ecology relationship in a compact readable detail without changing its durable map', async () => {
    const project = makeCrossLayerEcologyProject();
    const durableGraph = structuredClone(project.graph);
    const durableViewport = { ...project.viewport };
    await openMapProject(project);

    const edge = document.querySelector('.graph-edge');
    edge.focus();
    fireEvent.keyDown(edge, { key: 'Enter' });
    const inspector = screen.getByLabelText('Map inspector');
    fireEvent.click(within(inspector).getByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(inspector).toHaveAttribute('aria-hidden', 'true');
      expect(mapCanvas()).toHaveClass('is-detail-view');
    });

    expect(document.querySelector('.ecology-layers')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Arrange map' })).not.toBeInTheDocument();
    const assertDetailInsideCanvas = () => {
      const view = viewportTransform();
      expect(view.zoom).toBeGreaterThanOrEqual(0.85);
      [...document.querySelectorAll('.graph-node')].forEach((group) => {
        const position = renderedNodePosition(group.getAttribute('data-graph-id'));
        const card = group.querySelector('.node-card');
        const bounds = {
          left: (position.x + Number(card.getAttribute('x'))) * view.zoom + view.panX,
          right: (position.x + Number(card.getAttribute('x')) + Number(card.getAttribute('width'))) * view.zoom + view.panX,
          top: (position.y + Number(card.getAttribute('y'))) * view.zoom + view.panY,
          bottom: (position.y + Number(card.getAttribute('y')) + Number(card.getAttribute('height'))) * view.zoom + view.panY,
        };
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(840);
        expect(bounds.top).toBeGreaterThanOrEqual(0);
        expect(bounds.bottom).toBeLessThanOrEqual(540);
      });
      const label = document.querySelector('.graph-edge-label');
      const background = label.querySelector('.edge-label-bg');
      const labelBounds = {
        left: Number(background.getAttribute('x')) * view.zoom + view.panX,
        right: (Number(background.getAttribute('x')) + Number(background.getAttribute('width'))) * view.zoom + view.panX,
        top: Number(background.getAttribute('y')) * view.zoom + view.panY,
        bottom: (Number(background.getAttribute('y')) + Number(background.getAttribute('height'))) * view.zoom + view.panY,
      };
      expect(svgTextLines(label.querySelector('.edge-label')).join(' ')).toBe('funds');
      expect(labelBounds.left).toBeGreaterThanOrEqual(0);
      expect(labelBounds.right).toBeLessThanOrEqual(840);
      expect(labelBounds.top).toBeGreaterThanOrEqual(0);
      expect(labelBounds.bottom).toBeLessThanOrEqual(540);
    };
    assertDetailInsideCanvas();
    expect(storedProject().graph).toEqual(durableGraph);
    expect(storedProject().viewport).toEqual(durableViewport);

    fireEvent.click(screen.getByRole('button', { name: 'Center map' }));
    assertDetailInsideCanvas();
    expect(storedProject().graph).toEqual(durableGraph);
    expect(storedProject().viewport).toEqual(durableViewport);

    fireEvent.click(screen.getByRole('button', { name: 'Show full map' }));
    await waitFor(() => {
      expect(mapCanvas()).not.toHaveClass('is-detail-view');
      expect(viewportTransform()).toEqual(durableViewport);
    });
    durableGraph.nodes.forEach(({ id, x, y }) => expect(renderedNodePosition(id)).toEqual({ x, y }));
    expect(document.querySelector('.ecology-layers')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Arrange map' })).toBeVisible();
    expect(storedProject().graph).toEqual(durableGraph);
    expect(storedProject().viewport).toEqual(durableViewport);
  });

  it('opens a relationship with Enter and keeps its complete phone detail in view after Done', async () => {
    installPhoneLayout();
    await openMapProject(makeMapProject('exosphere'));
    const edge = document.querySelector('.graph-edge[tabindex="0"]');
    edge.focus();
    fireEvent.keyDown(edge, { key: 'Enter' });
    const inspector = screen.getByLabelText('Map inspector');
    expect(inspector).toHaveClass('is-open');
    expect(within(inspector).getByRole('tab', { name: 'Relationships' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(inspector).getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(inspector).toHaveAttribute('aria-hidden', 'true'));
    expect(mapCanvas()).toHaveClass('is-detail-view');
    expect(document.querySelectorAll('.graph-node')).toHaveLength(2);
    expect(document.querySelectorAll('.graph-edge-label')).toHaveLength(1);
    const view = viewportTransform();
    const visible = { left: 0, right: 840, top: -130, bottom: 670 };
    const transformedBounds = [...document.querySelectorAll('.graph-node')].map((group) => {
      const position = renderedNodePosition(group.getAttribute('data-graph-id'));
      const card = group.querySelector('.node-card');
      return {
        left: (position.x + Number(card.getAttribute('x'))) * view.zoom + view.panX,
        right: (position.x + Number(card.getAttribute('x')) + Number(card.getAttribute('width'))) * view.zoom + view.panX,
        top: (position.y + Number(card.getAttribute('y'))) * view.zoom + view.panY,
        bottom: (position.y + Number(card.getAttribute('y')) + Number(card.getAttribute('height'))) * view.zoom + view.panY,
      };
    });
    transformedBounds.forEach((bounds) => {
      expect(bounds.left).toBeGreaterThanOrEqual(visible.left);
      expect(bounds.right).toBeLessThanOrEqual(visible.right);
      expect(bounds.top).toBeGreaterThanOrEqual(visible.top);
      expect(bounds.bottom).toBeLessThanOrEqual(visible.bottom);
    });
    const renderedLabel = document.querySelector('.graph-edge-label');
    expect(svgTextLines(renderedLabel.querySelector('.edge-label')).join(' ')).toBe(renderedLabel.getAttribute('data-full-label'));
    expect(renderedLabel).not.toHaveTextContent('…');
  });

  it('renders exact saved in-band ecological positions after reload', async () => {
    await openMapProject(makeMapProject('exosphere'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Show map layer' }), { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Arrange map' }));
    await waitFor(() => expect(eventRequests('map_arranged')).toHaveLength(1));
    await waitFor(() => expect(storedProject().events.some((event) => event.action === 'map.arranged')).toBe(true));
    const savedPositions = storedProject().graph.nodes.map(({ id, x, y }) => ({ id, x, y }));

    cleanup();
    render(<App />);
    await showResumeScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Build the map' })).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: 'Show map layer' }), { target: { value: 'all' } });

    savedPositions.forEach(({ id, x, y }) => {
      expect(document.querySelector(`[data-graph-id="${id}"]`)).toHaveAttribute('transform', `translate(${x} ${y})`);
    });
    expect(storedProject().graph.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(savedPositions);
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
    const card = renderedNode.querySelector('.node-card');

    expect(svgTextLines(renderedNode.querySelector('.node-label')).join(' ')).toBe(longNodeLabel);
    expect(renderedNode).not.toHaveTextContent('…');
    expect(renderedNode.querySelector('.node-scale-glyph')).toBeNull();
    expect(Number(card.getAttribute('height'))).toBeGreaterThan(phone ? 82 : 72);
    expect(within(inspector).getByRole('heading', { name: longNodeLabel })).toHaveTextContent(longNodeLabel);

    fireEvent.click(within(inspector).getByRole('tab', { name: 'Relationships' }));
    const relationshipButton = within(within(inspector).getByLabelText('Relationship list')).getAllByRole('button')
      .find((button) => button.textContent.includes(longEdgeLabel));
    fireEvent.click(relationshipButton);
    expect(within(within(inspector).getByLabelText('Relationship list')).getAllByRole('button')).toHaveLength(1);
    const renderedEdge = document.querySelector(`.graph-edge-label[data-edge-id="${incidentEdge.id}"]`);
    const edgeBackground = renderedEdge.querySelector('.edge-label-bg');
    const edgeText = renderedEdge.querySelector('.edge-label');
    expect(edgeText).toHaveStyle({ fontSize: phone ? '26px' : '24px' });
    expect(svgTextLines(edgeText).join(' ')).toBe(longEdgeLabel);
    expect(renderedEdge).not.toHaveTextContent('…');
    expect(Number(edgeBackground.getAttribute('height'))).toBeGreaterThan(phone ? 44 : 24);
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

    await waitFor(() => expect(storedProject().events.at(-1)).toMatchObject({ action: 'map.arranged', detail: 'Meso arranged' }));
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

  it('keeps candidates and the whole map intact when memo text changes', async () => {
    const project = createDefaultProject();
    project.candidates = extractCandidates(project.submission);
    project.candidates.nodes.forEach((node) => { if (node.scale === 'meso') node.scale = 'micro'; });
    project.candidates.edges.forEach((edge) => { if (edge.scale === 'micro') edge.scale = 'meso'; });
    project.graph = structuredClone(project.candidates);
    project.graph.nodes.forEach((node) => { node.status = 'confirmed'; node.claimState = 'student interpretation'; });
    project.graph.edges.forEach((edge) => { edge.status = 'confirmed'; edge.claimState = 'student interpretation'; });
    project.stage = 0;
    project.furthestStage = 0;
    await resumeSavedProject(project);
    fireEvent.change(screen.getByRole('textbox', { name: /Memo text/ }), { target: { value: `${project.submission.text} A later memo correction changes the evidence anchor.` } });
    await waitFor(() => {
      const stored = storedProject();
      expect(stored.submission.revision).toBe((project.submission.revision || 1) + 1);
      expect(stored.candidates.nodes).toHaveLength(project.candidates.nodes.length);
      expect(stored.candidates.edges).toHaveLength(project.candidates.edges.length);
      expect(stored.graph.nodes.every((node) => node.claimState === 'student interpretation')).toBe(true);
      expect(stored.graph.edges.every((edge) => edge.claimState === 'student interpretation')).toBe(true);
      expect(JSON.stringify(stored.graph)).not.toContain('Removed after the memo changed');
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
    expect(screen.getByRole('button', { name: 'Choose nodes' })).toBeEnabled();
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
    const project = await openMapProject(makeMapProject('micro'));
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
    const project = await openMapProject(makeMapProject('micro'));
    const node = project.graph.nodes[0];
    const svg = mapCanvas();
    const nodeElement = document.querySelector(`[data-graph-id="${node.id}"]`);
    const start = renderedNodePosition(node.id);
    const dragZoom = viewportTransform().zoom;
    const draggedPosition = { x: Math.round(start.x + 24 / dragZoom), y: Math.round(start.y + 16 / dragZoom) };
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

    await waitFor(() => expect(storedProject().graph.nodes.find((item) => item.id === node.id)).toMatchObject(draggedPosition));
    const coordinateWrites = setItem.mock.calls.filter(([key, value]) => {
      if (key !== STORAGE_KEY) return false;
      const saved = JSON.parse(value);
      return saved.graph.nodes.some((item) => item.id === node.id && item.x === draggedPosition.x && item.y === draggedPosition.y);
    });
    expect(coordinateWrites).toHaveLength(1);
    expect(eventRequests('node_moved')).toHaveLength(1);

    setItem.mockClear();
    fireEvent.pointerDown(document.querySelector(`[data-graph-id="${node.id}"]`), { pointerId: 30, button: 0, clientX: draggedPosition.x, clientY: draggedPosition.y });
    fireEvent.pointerUp(svg, { pointerId: 30, clientX: draggedPosition.x, clientY: draggedPosition.y });
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
    await waitFor(() => expect(viewportTransform().zoom).toBeGreaterThan(durableViewport.zoom));
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
    expect(within(addActions).queryByRole('button', { name: 'Node' })).not.toBeInTheDocument();
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
    const project = await openMapProject(makeMapProject('micro'));
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

  it('restores stored layout data, viewport, and annotations without mutating them on reload', async () => {
    const project = makeMapProject('meso');
    project.graph.nodes.forEach((node, index) => {
      node.x = 80 + (index % 4) * 220;
      node.y = 70 + Math.floor(index / 4) * 130;
    });
    const restoredEdge = project.graph.edges.find((edge) => edge.scale === 'meso');
    const restoredNode = project.graph.nodes.find((node) => node.id === restoredEdge.source);
    restoredNode.annotations.analytical.text = 'Restored node annotation';
    restoredEdge.annotation.text = 'Restored relationship annotation';
    project.mapAnnotation.text = 'Restored whole-map annotation';
    project.viewport = { panX: 37, panY: -22, zoom: 1.25 };
    seedProject(project);

    const assertRestored = async () => {
      render(<App />);
      await showResumeScreen();
      expect(screen.getByLabelText('Saved project summary')).toHaveTextContent('Stage · Map');
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(await screen.findByRole('heading', { name: 'Build the map' })).toBeVisible();
      const renderedNode = document.querySelector(`[data-graph-id="${restoredNode.id}"]`);
      expect(svgTextLines(renderedNode.querySelector('.node-label')).join(' ')).toBe(restoredNode.label);
      expect(storedProject().graph.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(project.graph.nodes.map(({ id, x, y }) => ({ id, x, y })));
      expect(storedProject().viewport).toEqual(project.viewport);
      const inspector = openNodeInspector(restoredNode.id);
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
      scale: 'exosphere',
      status: 'confirmed',
      claimState: 'confirmed',
    }));
    project.candidates = { nodes: [], edges: [] };
    const edgeId = stableId('edge', `${nodes[0].id}:documents:${nodes[1].id}`);
    project.graph = { nodes, edges: [{
      id: edgeId,
      source: nodes[0].id,
      target: nodes[1].id,
      sourceLabel: nodes[0].label,
      targetLabel: nodes[1].label,
      verb: 'documents',
      scale: 'exosphere',
      status: 'confirmed',
      claimState: 'confirmed',
      notes: '',
      directed: true,
      rationale: 'The memo records this relationship.',
      evidence: 'Memo sentence 1',
      annotation: { id: stableId('annotation', `edge:${edgeId}:relationship`), text: '' },
    }] };
    project.releasedScales = ['micro', 'exosphere'];
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
      expect(screen.getByText('Memo imported')).toBeInTheDocument();
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
      expect(markdown).toContain(`${nodes[0].label} **documents** ${nodes[1].label} — level: Exosphere; evidence: Memo sentence 1`);
      expect(markdown).not.toMatch(/\b(?:student interpretation|inference|contested|research lead|retired|claim_state)\b/i);
    } finally {
      if (priorCreate === undefined) delete URL.createObjectURL; else URL.createObjectURL = priorCreate;
      if (priorRevoke === undefined) delete URL.revokeObjectURL; else URL.revokeObjectURL = priorRevoke;
    }
  });
});
