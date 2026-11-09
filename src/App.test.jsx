import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { createBlankProject, graphCsv, preflightEvaluationPayload, connectionSuggestionPayload, mapCheckPayload } from './App.jsx';
import { GUIDANCE_REQUEST_TIMEOUT_MS } from './api.js';
import { INSTITUTIONAL_RESUME_COOLDOWN_MS, INSTITUTIONAL_SESSION_TIMEOUT_MS } from './studentSession.js';
import { SYSTEMS_MAPPING_STAGES } from '../shared/systems-mapping-stages.js';
import { DEFAULT_FIELD_NOTES_QUESTIONS } from '../shared/field-notes.js';
import { fieldNotesExcerpt } from '../shared/field-notes-context.js';
import {
  configFingerprint,
  createDefaultProject,
  createLevelProgress,
  createPortableProject,
  extractCandidates,
  MICRO_SETTING_NODE_TYPES,
  parseProject,
  PROJECT_LIMITS,
  SCALE_ORDER,
  serializeProject,
  stableId,
  validateProject,
  withDefaultNodeLayout,
} from './domain.js';
import { loadLibraryProject, loadProjectLibrary, loadStoredLink, rememberStoredLink, saveProjectToLibrary } from './projectLibrary.js';
import { memoDraftKey } from './memoDraft.js';
import { releaseAccountStorage, useAccountStorage } from './accountStorage.js';
import { appendSubmittedNodes, openMemoWorkflowScale, memoUpdateState } from './memoWorkflow.js';
import { recordEdit, restoreEdit } from './editHistory.js';
import { groupProject } from '../tests/fixtures/group-project.js';

function expectAttachedRelationship(edge) {
  const group = document.querySelector(`.graph-edge[data-graph-id="${edge.id}"]`);
  fireEvent.keyDown(group, {key:'Enter'});
  const label = document.querySelector(`.graph-edge-label[data-edge-id="${edge.id}"]`);
  expect(group).toHaveAttribute('data-edge-route', 'attached');
  const values = group.querySelector('.edge-line').getAttribute('d').match(/-?[\d.]+/g).map(Number);
  const points = Array.from({length:values.length/2},(_,i)=>({x:values[i*2],y:values[i*2+1]}));
  const anchor = {x:Number(label.getAttribute('data-anchor-x')),y:Number(label.getAttribute('data-anchor-y'))};
  const distance = (a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  expect(points.slice(1).some((b,i)=>Math.abs(distance(points[i],anchor)+distance(anchor,b)-distance(points[i],b))<.1)).toBe(true);
  expect(label.querySelector('.edge-label-leader')).toBeNull();
  expect(label).toHaveAttribute('data-full-label', edge.verb);
  if (edge.verb.trim()) {
    expect(svgTextLines(label.querySelector('.edge-label')).join('')).toBe(edge.verb);
    const bounds = svgRectBounds(label.querySelector('.edge-label-bg'));
    for (const node of document.querySelectorAll('.graph-node')) {
      expect(rectsIntersect(bounds, translatedRectBounds(node, node.querySelector('.node-card'))), `Label ${edge.id} covers ${node.getAttribute('data-graph-id')}`).toBe(false);
    }
  }
  expect(group).not.toHaveClass('is-muted', 'is-dimmed');
}
function renderedPositions() {
  return new Map([...document.querySelectorAll('.graph-node')].map(node => [node.getAttribute('data-graph-id'), renderedNodePosition(node.getAttribute('data-graph-id'))]));
}

async function memoReviewDetails() {
  await screen.findByText('Guidance and evidence');
  const details = document.querySelector('.review-details');
  if (!details.open) fireEvent.click(details.querySelector('summary'));
  return details;
}

function openDetails(selector) {
  const details = document.querySelector(selector);
  if (details && !details.open) fireEvent.click(details.querySelector('summary'));
  return details;
}
function notebookOption(label) {
  workActions();
  return screen.getByRole('option', { name: label, exact: true });
}
function openExports() {
  openProjectMenu('Export & share');
  expect(screen.getByRole('combobox', { name: 'File format' })).toBeVisible();
}
function candidateLabels() {
  const labels = [];
  const previous = screen.queryByRole('button', {name: 'Previous suggestion'});
  while (previous && !previous.disabled) fireEvent.click(previous);
  do {
    labels.push(screen.getByRole('textbox', { name: 'Node label' }).value);
    const next = screen.queryByRole('button', {name: 'Next suggestion'});
    if (!next || next.disabled) break;
    fireEvent.click(next);
  } while (labels.length < 50);
  while (previous && !previous.disabled) fireEvent.click(previous);
  return labels;
}
function acceptAllCandidates() {
  do {
    const row = document.querySelector('.candidate-list article');
    fireEvent.click(within(row).getByRole('button', {name: 'Add to map'}));
    const next = screen.queryByRole('button', {name: 'Next suggestion'});
    if (!next || next.disabled) break;
    fireEvent.click(next);
  } while (true);
}

const STORAGE_KEY = 'systems-mapping-studio.project.v6';
const LEGACY_V5_STORAGE_KEY = 'systems-mapping-studio.project.v5';
const PERSIST_DEBOUNCE_MS = 450;

let studentSession;
let accessResponder;
let preflightEvaluationResponder;
let connectionSuggestionResponder;
let mapCheckResponder;
let publicConfigurationResponder;
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
    ...(['micro', 'meso'].includes(project.activeScale) ? {
      carriedNodes: project.graph.nodes
        .filter((node) => node.scale === 'micro' && node.status !== 'rejected' && node.claimState !== 'retired')
        .map(({ id, label, type, scale }) => ({ id, label, type, scale })),
    } : {}),
    ...(project.graph.edges.some((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired') ? {
      carriedConnections: project.graph.edges
        .filter((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired')
        .map(({ source, target, sourceLabel, targetLabel, verb, scale }) => ({ source, target, sourceLabel, targetLabel, verb, scale })),
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
  const review = overrides.review || memoReviewFixture(payload.activeScale, payload.carriedNodes || []);
  return {
    id: EVALUATION_ID,
    review: structuredClone(review),
    configSnapshot,
    runtime: overrides.runtime || { provider: 'deterministic', model: 'STEM Splitter', createdAt },
    createdAt,
    expiresAt: overrides.expiresAt || '2027-01-16T08:00:00.000Z',
  };
}

function memoReviewFixture(activeScale = 'micro', carriedNodes = []) {
  if (activeScale === 'meso') {
    const [source, target] = carriedNodes.filter(node => node.scale === 'micro').slice(0, 2);
    return {
      guidance: [{ point: 'Connect the people and settings already on the Micro map.' }],
      nodes: [],
      connections: source && target ? [{ source: source.id, target: target.id, sourceLabel: source.label, targetLabel: target.label, verb: 'coordinates with', rationale: 'The memo describes coordination between these mapped items.' }] : [],
      example: null,
      readiness: { ready: Boolean(source && target), note: source && target ? 'The memo supports one Meso relationship.' : 'Add two Micro items before connecting them.' },
    };
  }
  if (activeScale === 'exosphere') {
    const anchor = carriedNodes.find((node) => node.scale === 'micro' && MICRO_SETTING_NODE_TYPES.includes(node.type));
    if (!anchor) return {
      guidance: [{ point: 'Identify an immediate Micro-level setting before tracing an outside decision pathway.' }],
      nodes: [], connections: [], example: null,
      readiness: { ready: false, note: 'An outside decision setting needs a pathway to a carried Micro-level setting.' },
    };
    return {
      guidance: [{ point: 'The memo identifies an institution that affects a mapped setting.' }],
      nodes: [{ label: 'New York State Education Department', type: 'agency', scale: 'exosphere', evidence: 'The memo names the department.' }],
      connections: [{ source: 'New York State Education Department', target: anchor.label, sourceLabel: 'New York State Education Department', targetLabel: anchor.label, verb: 'sets rules for', rationale: 'The department sets rules that reach this immediate setting.' }],
      example: null,
      readiness: { ready: true, note: 'The memo supports one Exosphere institution.' },
    };
  }
  if (activeScale === 'macrosphere') {
    const scope = carriedNodes.filter((node) => node.scale !== 'macrosphere').slice(0, 2).map(({ id, label }) => ({ id, label }));
    if (scope.length < 2) return {
      guidance: [{ point: 'Map at least two elements before naming a broader condition that affects them.' }],
      nodes: [], connections: [], example: null,
      readiness: { ready: false, note: 'A Macro-level condition needs at least two mapped elements.' },
    };
    return {
      guidance: [{ point: 'The memo identifies a policy that affects several mapped elements.' }],
      nodes: [{ label: 'State education policy', type: 'policy', scale: 'macrosphere', evidence: 'The memo describes the policy.', deontic: 'shapes', scope }],
      connections: [],
      example: null,
      readiness: { ready: true, note: 'The memo supports one Macrosphere item.' },
    };
  }
  return {
    guidance: [{
      point: 'The memo grounds the referral in a specific handoff.',
      evidenceExcerpt: 'The school refers the student to the committee.',
    }, {
      point: 'Where does the delay enter the referral process?',
    }],
    nodes: [
      { label: 'School', type: 'setting', scale: 'micro', evidence: 'The school refers the student to the committee.' },
      { label: 'Committee', type: 'group', scale: 'micro', evidence: 'The school refers the student to the committee.' },
    ],
    connections: [],
    example: null,
    readiness: { ready: true, note: 'The memo already supports mapping. Continue to choose nodes and connections.' },
  };
}

function projectWithMemoReview(overrides = {}) {
  const project = createDefaultProject();
  project.instructor.requireStudentConfirmation = true;
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
  if (requestPath === '/api/map/check' && options.method === 'POST') return mapCheckResponder(JSON.parse(options.body));
  if (requestPath.startsWith('/api/config/public?')) return publicConfigurationResponder(requestPath);
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
  expect(await screen.findByRole('heading', { name: 'Projects' })).toBeVisible();
}

function openProjectFromList(title = null) {
  const card = title
    ? screen.getByRole('article', { name: title })
    : screen.getAllByRole('article')[0];
  fireEvent.click(within(card).getByRole('button', { name: 'Open project' }));
}

function openNotebookSection(mode) {
  const nav = screen.getByRole('navigation', { name: 'Workspace', exact: true });
  fireEvent.click(within(nav).getByRole('button', { name: 'Notebook', exact: true }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Notebook section' }), { target: { value: mode } });
}

function workActions() {
  const nav = screen.queryByRole('navigation', { name: 'Workspace', exact: true });
  if (!nav) return within(document.querySelector('.app-footer'));
  fireEvent.click(within(nav).getByRole('button', { name: 'Notebook', exact: true }));
  return within(document.querySelector('#map-inspector'));
}

function memoNextAction() {
  workActions();
  return document.querySelector('#map-inspector .notebook-next') || document.querySelector('#map-inspector [data-next-action]');
}

function mapLayer() {
  const menu = document.querySelector('.notebook-map-tools');
  if (menu && !menu.open) fireEvent.click(menu.querySelector('summary'));
  return screen.getByRole('combobox', { name: 'Show map layer' });
}

function footerAction(id) {
  if (id === 'review-level') return within(screen.getByRole('navigation', { name: 'Workspace', exact: true })).getByRole('button', { name: 'Notebook', exact: true });
  const nav = screen.queryByRole('navigation', { name: 'Workspace', exact: true });
  if (nav) fireEvent.click(within(nav).getByRole('button', { name: 'Notebook', exact: true }));
  return document.querySelector(`[data-next-action="${id}"]`);
}

function openWorkLevelMenu() {
  return screen.getByRole('combobox', { name: 'Work level' });
}

function openProjectMenu(name) {
  const summary = document.querySelector('.project-menu > summary');
  if (summary && !summary.parentElement.open) fireEvent.click(summary);
  fireEvent.click(screen.getByRole('button', { name, exact: true }));
}

function mapTool(name) {
  const menu = document.querySelector('.notebook-map-tools');
  if (menu && !menu.open) fireEvent.click(menu.querySelector('summary'));
  return screen.getByRole('button', { name, exact: true });
}

function openProjectLink() {
  openProjectMenu('Progress');
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Progress' })).getByRole('button', { name: 'Project link' }));
  return screen.getByRole('dialog', { name: 'Project link' });
}

async function resumeSavedProject(project = createDefaultProject()) {
  seedProject(project);
  render(<App />);
  await showResumeScreen();
  openProjectFromList(project.title);
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Projects' })).not.toBeInTheDocument());
  return project;
}

function pendingMemoFile(name = 'memo.txt') {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { file: { name, size: 30, text: () => promise }, resolve, reject };
}

function uploadMemo(pending) {
  fireEvent.change(document.querySelector('.upload-zone input[type=file]'), { target: { files: [pending.file] } });
}

function makeMapProject(activeScale = 'exosphere') {
  const project = createDefaultProject();
  project.instructor.requireStudentConfirmation = true;
  project.candidates = { nodes: [], edges: [] };
  const extracted = extractCandidates(project.submission);
  const levels = ['micro', 'meso', 'exosphere', 'macrosphere'];
  const activeIndex = levels.indexOf(activeScale);
  project.releasedScales = levels.slice(0, activeIndex + 1);
  project.activeScale = activeScale;
  const nodes = extracted.nodes.map((node) => ({
    ...node,
    scale: node.scale === 'exosphere' ? 'exosphere' : 'micro',
    status: 'confirmed',
    claimState: 'student interpretation',
  }));
  const settingCandidates = nodes.filter((node) => node.scale === 'micro' && node.type === 'setting').slice(0, 2);
  while (activeIndex >= 1 && settingCandidates.length < 2) {
    const template = structuredClone(settingCandidates[0] || nodes.find((node) => node.scale === 'micro'));
    const settingNumber = settingCandidates.length + 1;
    const addedSetting = {
      ...template,
      id: `node_immediate_setting_${settingNumber}`,
      label: settingNumber === 1 ? 'Home setting' : 'Family support meeting room',
      type: 'setting',
      scale: 'micro',
      x: 240 + settingNumber * 240,
      y: 320 + settingNumber * 100,
      annotations: {
        analytical: { id: `annotation_immediate_setting_${settingNumber}_analytical`, text: '' },
        evidence: { id: `annotation_immediate_setting_${settingNumber}_evidence`, text: '' },
      },
    };
    nodes.push(addedSetting);
    settingCandidates.push(addedSetting);
  }
  settingCandidates.forEach((node) => { node.type = 'setting'; });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  // The shared map fixture adds its one valid Exo pathway explicitly below.
  // Extracted outer edges may join arbitrary named items and therefore are not
  // suitable committed Exo fixtures under the decision-setting-to-Micro rule.
  const edges = extracted.edges.filter((edge) => edge.scale !== 'exosphere').map((edge) => ({
    ...edge,
    scale: edge.scale === 'exosphere' ? 'exosphere' : 'meso',
    sourceLabel: nodeById.get(edge.source)?.label || edge.sourceLabel,
    targetLabel: nodeById.get(edge.target)?.label || edge.targetLabel,
    status: 'confirmed',
    claimState: 'student interpretation',
  }));
  const microSettings = nodes.filter((node) => node.scale === 'micro' && node.type === 'setting');
  if (activeIndex >= 1) {
    const template = structuredClone(microSettings[0]);
    nodes.push({
      ...template,
      id: 'node_meso_school_family_coordination',
      label: 'School–family coordination',
      type: 'mesosystem',
      scale: 'meso',
      mesoExplanation: '',
      x: 2360,
      y: 1200,
      scopeNodeIds: microSettings.slice(0, 2).map((node) => node.id),
      annotations: {
        analytical: { id: 'annotation_meso_coordination_analytical', text: '' },
        evidence: { id: 'annotation_meso_coordination_evidence', text: '' },
      },
    });
  }
  if (activeIndex >= 2) {
    const template = structuredClone(microSettings[0]);
    const exosphereNode = {
      ...template,
      id: 'node_exo_state_education_department',
      label: 'New York State Education Department',
      type: 'agency',
      scale: 'exosphere',
      x: 2720,
      y: 1200,
      annotations: {
        analytical: { id: 'annotation_exo_state_education_department_analytical', text: '' },
        evidence: { id: 'annotation_exo_state_education_department_evidence', text: '' },
      },
    };
    nodes.push(exosphereNode);
    edges.push({
      ...structuredClone(edges[0]),
      id: 'edge_exo_state_rules_immediate_setting',
      source: exosphereNode.id,
      target: microSettings[0].id,
      sourceLabel: exosphereNode.label,
      targetLabel: microSettings[0].label,
      verb: 'sets rules for',
      scale: 'exosphere',
      status: 'confirmed',
      claimState: 'student interpretation',
      annotation: { id: 'annotation_edge_exo_state_rules_immediate_setting', text: '' },
    });
  }
  if (activeIndex >= 3) {
    const template = structuredClone(nodes.find((node) => node.scale === 'exosphere') || microSettings[0]);
    nodes.push({
      ...template,
      id: 'node_macro_state_education_policy',
      label: 'State education policy',
      type: 'policy',
      scale: 'macrosphere',
      x: 2940,
      y: 1200,
      deontic: 'shapes',
      scopeNodeIds: microSettings.slice(0, 2).map((node) => node.id),
      annotations: {
        analytical: { id: 'annotation_macro_policy_analytical', text: '' },
        evidence: { id: 'annotation_macro_policy_evidence', text: '' },
      },
    });
  }
  project.graph = {
    nodes: nodes.filter((node) => levels.indexOf(node.scale) <= activeIndex),
    edges: edges.filter((edge) => levels.indexOf(edge.scale) <= activeIndex),
  };
  const activeEndpointIds = new Set(project.graph.edges
    .filter((edge) => edge.scale === activeScale)
    .flatMap((edge) => [edge.source, edge.target]));
  project.graph.nodes.sort((left, right) => Number(right.scale === activeScale || activeEndpointIds.has(right.id))
    - Number(left.scale === activeScale || activeEndpointIds.has(left.id)));
  project.graph.edges.sort((left, right) => Number(right.scale === activeScale) - Number(left.scale === activeScale));
  project.stage = 3;
  project.furthestStage = 3;
  project.levelProgress = createLevelProgress({ activeScale, stage: 3, reflection: '' });
  project.releasedScales.forEach((scale) => {
    project.levelProgress[scale] = { stage: 3, reflection: '' };
  });
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
  project.levelProgress[activeScale] = { stage: 4, reflection: project.reflection };
  if (activeScale === 'meso') {
    project.candidates = {
      nodes: [structuredClone(project.graph.nodes.find((node) => node.scale === 'meso'))],
      edges: [],
    };
  } else {
    project.candidates = {
      nodes: [structuredClone(project.graph.nodes.find((node) => node.scale === activeScale)
        || project.graph.nodes.find((node) => node.scale === 'micro'))],
      edges: [],
    };
  }
  const evaluation = evaluationRecord(evaluationPayloadFixture(project), {
    review: memoReviewFixture(activeScale, project.graph.nodes),
  });
  if (activeScale === 'micro') {
    evaluation.review.nodes = project.graph.nodes
      .filter((node) => node.scale === 'micro')
      .slice(0, 2)
      .map(({ label, type, scale, evidence }) => ({ label, type, scale, evidence }));
    evaluation.review.connections = [];
    evaluation.review.example = null;
  }
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

function makeCandidateValidationProject() {
  const project = makeMapProject('micro');
  const template = structuredClone(project.graph.nodes.find((node) => node.scale === 'micro'));
  const candidate = {
    ...template,
    id: 'node_pending_peer_navigator_validation',
    label: 'Pending peer navigator',
    type: 'person',
    status: 'pending',
    claimState: 'inference',
    annotations: {
      analytical: { id: 'annotation_pending_peer_navigator_validation_analytical', text: '' },
      evidence: { id: 'annotation_pending_peer_navigator_validation_evidence', text: '' },
    },
  };
  project.candidates = { nodes: [candidate], edges: [] };
  project.stage = 2;
  project.furthestStage = 2;
  return { project, candidate };
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

function makePhoneEcologyWithLegacyScope() {
  const project = makePhoneEcologyOverviewProject();
  const template = structuredClone(project.graph.nodes[0]);
  project.graph.nodes.push({ ...template, id: 'legacy-housing-scope', label: 'High housing costs', scale: 'macrosphere', type: 'economic condition', deontic: 'shapes', scopeNodeIds: project.graph.nodes.slice(0,2).map(node => node.id), x: 1700, y: 1700, annotations: { analytical: { id: 'legacy-scope-analytical', text: '' }, evidence: { id: 'legacy-scope-evidence', text: '' } } });
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
      'Borough Grants Administration Office',
      'City Disability Services Office',
      'Public Transportation Authority',
      'Workforce Development Agency',
      'Community Health Funding Office',
      'Neighborhood Provider Network Office',
      'Community Advisory Board Office',
      'Care Coordination Partnership Office',
    ],
    macrosphere: [
      'Statewide disability eligibility rules',
      'Federal Accessibility Standards',
      'Public Benefits Funding Rules',
      'Regional Housing Conditions',
      'National Employment Policy',
      'Limited regional transit access',
      'Family caregiving expectations',
    ],
  };
  project.graph.nodes = Object.entries(labelsByScale).flatMap(([scale, labels], scaleIndex) => labels.map((label, index) => ({
    ...template,
    id: `dense-${scale}-${index}`,
    label,
    type: scale === 'exosphere' ? 'institution' : scale === 'macrosphere' ? 'structure' : template.type,
    scale,
    x: 150 + (index % 3) * 248,
    y: 175 + scaleIndex * 140 + Math.floor(index / 3) * 90,
    ...(scale === 'macrosphere' ? {
      deontic: 'shapes',
      scopeNodeIds: ['dense-micro-0', 'dense-micro-1'],
    } : {}),
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
  Object.assign(source, { label: 'Borough Grants Administration Office', x: 2660, y: 1220 });
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

function makeDenseFocusedMesoProject(edgeCount = 12) {
  const project = makeMapProject('exosphere');
  project.activeScale = 'meso';
  const nodeTemplate = project.graph.nodes.find((node) => node.scale === 'micro');
  const edgeTemplate = project.graph.edges.find((edge) => edge.scale === 'exosphere');
  const focusNode = {
    ...structuredClone(nodeTemplate),
    id: 'node-dense-focus',
    label: 'u/DalekSupreme23',
    type: 'person',
    x: 420,
    y: 270,
    annotations: {
      analytical: { id: 'annotation-dense-focus-analytical', text: '' },
      evidence: { id: 'annotation-dense-focus-evidence', text: '' },
    },
  };
  const neighbors = Array.from({ length: edgeCount }, (_, index) => ({
    ...structuredClone(nodeTemplate),
    id: `node-dense-neighbor-${index + 1}`,
    label: `Peer support setting ${index + 1}`,
    type: 'group',
    x: 120 + (index % 4) * 200,
    y: 90 + Math.floor(index / 4) * 150,
    annotations: {
      analytical: { id: `annotation-dense-neighbor-${index + 1}-analytical`, text: '' },
      evidence: { id: `annotation-dense-neighbor-${index + 1}-evidence`, text: '' },
    },
  }));
  project.graph = {
    nodes: [focusNode, ...neighbors],
    edges: neighbors.map((neighbor, index) => ({
      ...structuredClone(edgeTemplate),
      id: `edge-dense-focus-${index + 1}`,
      source: focusNode.id,
      target: neighbor.id,
      sourceLabel: focusNode.label,
      targetLabel: neighbor.label,
      verb: `seeks help from setting ${index + 1}`,
      scale: 'meso',
      annotation: { id: `annotation-edge-dense-focus-${index + 1}`, text: '' },
    })),
  };
  return project;
}

async function openMapProject(project = makeMapProject()) {
  await resumeSavedProject(project);
  expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
  return project;
}

function mapCanvas() {
  return screen.getByRole('group', { name: /\bmap\. (?:\d+ nodes?|\d+ mesosystems?)/i });
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

function expectNodesInsideEcologyRings() {
  const levels = ['micro', 'exosphere', 'macrosphere'];
  const rings = new Map(levels.flatMap(level => {
    const ellipse = document.querySelector(`[data-ecology-layer="${level}"] ellipse`);
    if (!ellipse) return [];
    return [[level, Object.fromEntries(['cx', 'cy', 'rx', 'ry'].map(key => [key, Number(ellipse.getAttribute(key))]))]];
  }));
  document.querySelectorAll('.graph-node').forEach(group => {
    const scale = levels.find(level => group.classList.contains(`graph-node--${level}`));
    if (!scale) throw new Error(`Missing scale for ${group.getAttribute('data-full-label')}`);
    const position = renderedNodePosition(group.getAttribute('data-graph-id'));
    const card = group.querySelector('.node-card');
    const rect = {
      left: position.x + Number(card.getAttribute('x')),
      right: position.x + Number(card.getAttribute('x')) + Number(card.getAttribute('width')),
      top: position.y + Number(card.getAttribute('y')),
      bottom: position.y + Number(card.getAttribute('y')) + Number(card.getAttribute('height')),
    };
    const ring = rings.get(scale);
    if (!ring) throw new Error(`Missing ${scale} ellipse for ${group.getAttribute('data-full-label')}`);
    const corners = [[rect.left, rect.top], [rect.right, rect.top], [rect.left, rect.bottom], [rect.right, rect.bottom]];
    const outer = Math.max(...corners.map(([x, y]) => ((x - ring.cx) / ring.rx) ** 2 + ((y - ring.cy) / ring.ry) ** 2));
    const label = group.getAttribute('data-full-label');
    expect(outer, `${label} card leaves ${scale} boundary`).toBeLessThanOrEqual(1.001);
    const inner = rings.get(levels[levels.indexOf(scale) - 1]);
    if (!inner) return;
    const dx = Math.max(rect.left - inner.cx, inner.cx - rect.right, 0);
    const dy = Math.max(rect.top - inner.cy, inner.cy - rect.bottom, 0);
    expect((dx / inner.rx) ** 2 + (dy / inner.ry) ** 2, `${label} card enters preceding layer`).toBeGreaterThanOrEqual(.999);
  });
}

function graphForScale(project, scale = project.activeScale) {
  const order = ['micro', 'meso', 'exosphere', 'macrosphere'];
  const scales = new Set(scale === 'all' ? project.releasedScales : project.releasedScales.filter(level => order.indexOf(level) <= order.indexOf(scale)));
  const edges = project.graph.edges.filter((edge) => scale !== 'micro' && scales.has(edge.scale) && edge.claimState !== 'retired');
  const endpointIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const scopeIds = new Set(project.graph.nodes.filter((node) => node.scale === 'macrosphere' && scales.has(node.scale) && node.claimState !== 'retired').flatMap((node) => node.scopeNodeIds || []));
  const nodes = project.graph.nodes.filter((node) => node.scale !== 'meso' && (scales.has(node.scale) || (scale === 'meso' && node.scale === 'micro') || endpointIds.has(node.id) || scopeIds.has(node.id)) && node.claimState !== 'retired');
  return { nodes, edges };
}

function openNodeInspector(nodeId = document.querySelector('.graph-node')?.getAttribute('data-graph-id')) {
  const node = document.querySelector(`[data-graph-id="${nodeId}"]`);
  if (!node) throw new Error(`Visible node not found: ${nodeId}`);
  node.focus();
  fireEvent.keyDown(node, { key: 'Enter' });
  const edit = screen.queryByRole('button', { name: 'Edit', exact: true });
  if (edit) fireEvent.click(edit);
  return screen.getByLabelText('Notebook');
}

function openEdgeInspector(edgeId = document.querySelector('.graph-edge')?.getAttribute('data-graph-id')) {
  const edge = document.querySelector(`[data-graph-id="${edgeId}"]`);
  if (!edge) throw new Error(`Visible relationship not found: ${edgeId}`);
  fireEvent.pointerDown(edge, { pointerId: 91, button: 0 });
  fireEvent.pointerUp(edge, { pointerId: 91, button: 0 });
  const edit = screen.queryByRole('button', { name: 'Edit', exact: true });
  if (edit) fireEvent.click(edit);
  return screen.getByLabelText('Notebook');
}

function openMapInspector() {
  fireEvent.click(mapTool('Add item'));
  return screen.getByLabelText('Notebook');
}

function openEvidenceRecords(inspector) {
  const editor = inspector.querySelector('.node-summary') || [...inspector.querySelectorAll('details')].find(el => el.querySelector('summary')?.textContent === 'Connection details');
  if (editor && !editor.open) fireEvent.click(editor.querySelector('summary'));
  const summary = within(inspector).getByText('Evidence and questions');
  if (!summary.closest('details').open) fireEvent.click(summary);
  return within(inspector).getByRole('region', { name: 'Evidence records' });
}

function annotationStatus(field) {
  const ids = field.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) || [];
  const statusId = ids.find((id) => id.startsWith('annotation-status_'));
  return statusId ? document.getElementById(statusId) : null;
}

function selectAnnotationTarget(target) {
  if (target === 'node') {
    const inspector = openNodeInspector();
    return within(inspector).getByRole('textbox', { name: /^Interpretation/ });
  }
  if (target === 'edge') {
    const inspector = openEdgeInspector();
    const panel = within(inspector).getByRole('region', { name: 'Connections' });
    return within(panel).getByRole('textbox', { name: 'Interpretation' });
  }
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Workspace', exact: true })).getByRole('button', { name: 'Notebook', exact: true }));
  openDetails('.saved-map-note');
  return screen.getByRole('textbox', { name: /^Map note/ });
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

function svgRectBounds(rect) {
  const left = Number(rect.getAttribute('x'));
  const top = Number(rect.getAttribute('y'));
  const width = Number(rect.getAttribute('width'));
  const height = Number(rect.getAttribute('height'));
  return { left, top, right: left + width, bottom: top + height };
}

function transformedRectBounds(bounds, view = viewportTransform()) {
  return {
    left: bounds.left * view.zoom + view.panX,
    right: bounds.right * view.zoom + view.panX,
    top: bounds.top * view.zoom + view.panY,
    bottom: bounds.bottom * view.zoom + view.panY,
  };
}

function visibleMapBounds() {
  const values = (mapCanvas().getAttribute('viewBox') || '0 0 840 540').split(/\s+/).map(Number);
  const [left, top, width, height] = values;
  return { left, top, right: left + width, bottom: top + height };
}

function expectVisibleNodesAndConnectionLabelsInsideCanvas() {
  const visible = visibleMapBounds();
  const assertInside = (bounds, label) => {
    const rendered = transformedRectBounds(bounds);
    expect(rendered.left, `${label} clips at the left`).toBeGreaterThanOrEqual(visible.left);
    expect(rendered.right, `${label} clips at the right`).toBeLessThanOrEqual(visible.right);
    expect(rendered.top, `${label} clips at the top`).toBeGreaterThanOrEqual(visible.top);
    expect(rendered.bottom, `${label} clips at the bottom`).toBeLessThanOrEqual(visible.bottom);
  };
  [...document.querySelectorAll('.graph-node')].forEach((group) => {
    assertInside(
      translatedRectBounds(group, group.querySelector('.node-card')),
      `Node ${group.getAttribute('data-full-label')}`,
    );
  });
  [...document.querySelectorAll('.graph-edge-label')].forEach((group) => {
    assertInside(
      svgRectBounds(group.querySelector('.edge-label-bg')),
      `Connection ${group.getAttribute('data-full-label')}`,
    );
  });
}

function rectsIntersect(left, right) {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top;
}

function segmentCrossesRectInterior(start, end, bounds) {
  const inset = .5;
  const axes = [
    [start.x, end.x - start.x, bounds.left + inset, bounds.right - inset],
    [start.y, end.y - start.y, bounds.top + inset, bounds.bottom - inset],
  ];
  let near = 0;
  let far = 1;
  for (const [origin, delta, minimum, maximum] of axes) {
    if (minimum >= maximum) return false;
    if (Math.abs(delta) < .0001) {
      if (origin <= minimum || origin >= maximum) return false;
      continue;
    }
    const first = (minimum - origin) / delta;
    const second = (maximum - origin) / delta;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near >= far) return false;
  }
  return far > 0 && near < 1;
}

function focusedRoutePoints(path) {
  return [...String(path).matchAll(/[ML]\s+(-?[\d.]+)\s+(-?[\d.]+)/g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
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
    mapCheckResponder = () => jsonResponse({ error: 'Map check not stubbed' }, 500);
    publicConfigurationResponder = (path) => jsonResponse(publicConfiguration(path));
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1024 });
    window.history.replaceState(null, '', '/');
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
    releaseAccountStorage();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('runs the account memo workflow without a suggestion queue, required notes or automatic links', async () => {
    const project=createBlankProject();project.title='Node submission acceptance';
    project.submission.text='Residents meet in the community room.';project.submission.fileName='first.pdf';project.submission.fingerprint=stableId('src',project.submission.text);seedProject(project);
    const submissions=[];
    preflightEvaluationResponder=body=>{
      submissions.push(body);
      const nodes=body.activeScale==='micro' ? [{label:'Residents',type:'group',scale:'micro',evidence:project.submission.text},{label:'Community room',type:'setting',scale:'micro',evidence:project.submission.text}]
        : [{label:'City Housing Authority',type:'agency',scale:'exosphere',basis:'memo',evidence:'Residents do not participate in City Housing Authority staffing meetings. City Housing Authority allocates repair staff, affecting repair visits to residents at home.'},{label:'Unequal housing investment',type:'structure',scale:'macrosphere',basis:'memo',evidence:'Unequal housing investment delays elevator repairs.'}];
      return jsonResponse({evaluation:evaluationRecord(body,{review:{guidance:[],nodes,connections:[],example:null,readiness:{ready:true,note:'Nodes identified.'}}})},201);
    };
    render(<App memoFirstWorkflow startInWorkspace />);
    fireEvent.click(await screen.findByRole('button',{name:'Submit memo and add nodes',exact:true}));
    await waitFor(()=>expect(document.querySelectorAll('.graph-node')).toHaveLength(2));
    expect(screen.queryByText('Set aside')).not.toBeInTheDocument();expect(screen.queryByText('Suggestions')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Map',exact:true})).not.toBeInTheDocument();
    expect(document.querySelector('.map-reading-guide')).toHaveTextContent('Select a node to edit it.');
    expect(document.querySelector('.graph-canvas').getAttribute('aria-label')).not.toContain('connections');
    fireEvent.keyDown([...document.querySelectorAll('.graph-node')].find(node=>node.textContent.includes('Residents')),{key:'Enter'});
    fireEvent.doubleClick([...document.querySelectorAll('.graph-node')].find(node=>node.textContent.includes('Residents')));
    fireEvent.click(await screen.findByRole('button',{name:'Remove',exact:true}));
    expect(document.querySelectorAll('.graph-node')).toHaveLength(1);
    expect(screen.queryByRole('button',{name:'Remove',exact:true})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Add to map',exact:true})).toBeVisible();
    await waitFor(()=>expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).graph.nodes.find(node=>node.label==='Residents').claimState).toBe('retired'));
    fireEvent.click(screen.getByRole('button',{name:'Add to map',exact:true}));
    expect(document.querySelectorAll('.graph-node')).toHaveLength(2);
    expect(screen.queryByRole('button',{name:'Add to map',exact:true})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Remove',exact:true})).toBeVisible();
    expect(screen.getByRole('button',{name:'Continue',exact:true}).closest('.notebook-task-top')).not.toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Continue'}));
    expect(await screen.findByRole('heading',{name:'Meso · local relationships'})).toBeVisible();
    expect(submissions).toHaveLength(1);expect(document.querySelectorAll('.graph-edge')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button',{name:'Continue'}));
    fireEvent.change(await screen.findByRole('textbox',{name:'Second memo',exact:true}),{target:{value:'Residents do not participate in City Housing Authority staffing meetings. City Housing Authority allocates repair staff, affecting repair visits to residents at home. Unequal housing investment delays elevator repairs.'}});
    fireEvent.click(screen.getByRole('button',{name:'Submit memo and add nodes',exact:true}));
    await waitFor(()=>expect(document.querySelectorAll('.graph-node')).toHaveLength(4));
    expect(submissions).toHaveLength(2);expect(submissions[1].workflowMode).toBe('student-nodes-v1');expect(submissions[1].sourceMaterial).not.toContain(project.submission.text);expect(submissions[1].carriedNodes.map(n=>n.label)).toContain('Residents');
    expect(document.querySelectorAll('.graph-edge')).toHaveLength(0);
    expect(document.querySelectorAll('.ecology-layers [data-ecology-layer]')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button',{name:'Continue'}));
    expect(await screen.findByRole('heading',{name:'Macro · broader conditions'})).toBeVisible();expect(submissions).toHaveLength(2);
    fireEvent.click(screen.getByRole('button',{name:'Hide sidebar'}));
    expect(screen.queryByRole('complementary',{name:'Notebook'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Notebook',exact:true}));
    expect(screen.getByRole('complementary',{name:'Notebook'})).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Tools',exact:true}));
    expect(within(screen.getByRole('complementary',{name:'Notebook'})).getByRole('region',{name:'Map tools'})).toBeVisible();
    expect(document.querySelector('.notebook-tools-panel')).toBeNull();
    expect(screen.getByRole('checkbox',{name:'Auto-fit layout'})).toBeChecked();
    fireEvent.keyDown([...document.querySelectorAll('.graph-node')].find(node=>node.textContent.includes('Unequal housing investment')),{key:'Enter'});
    expect(screen.queryByRole('region',{name:'Map tools'})).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button',{name:'Remove',exact:true}));
    expect(screen.getByRole('button',{name:'Add to map',exact:true})).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Add to map',exact:true}));
    expect(screen.getByRole('button',{name:'Remove',exact:true})).toBeVisible();
    await waitFor(()=>expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).part2Submission.text).toContain('Unequal housing investment'));
  });

  it('shows saved-request progress beside the sticky memo action and clears busy state after a pending failure', async () => {
    const project = createBlankProject();
    project.submission.text = 'Residents meet in the community room.';
    project.submission.fingerprint = stableId('src', project.submission.text);
    seedProject(project);
    const api = await import('./api.js');
    let progress, rejectRequest;
    vi.spyOn(api, 'createPreflightEvaluation').mockImplementation((_body, options) => {
      progress = options.onProgress;
      return new Promise((_resolve, reject) => { rejectRequest = reject; });
    });
    render(<App memoFirstWorkflow startInWorkspace />);
    fireEvent.click(await screen.findByRole('button', { name: 'Submit memo and add nodes', exact: true }));
    const action = document.querySelector('.memo-action-row');
    expect(action.closest('.notebook-task-top')).not.toBeNull();
    await waitFor(() => expect(within(action).getByRole('status')).toHaveTextContent('Saving your generation request…'));
    expect(within(action).getByRole('button', { name: 'Updating map…' })).toBeDisabled();
    for (const message of ['Reading memo (attempt 1 of 3)…', 'Reconnecting to your saved request…', '']) {
      await act(async () => progress(message));
      expect(within(action).getByRole('status')).toHaveTextContent(message || 'Reading your memo…');
    }
    await act(async () => rejectRequest(new api.ApiError('Your request is saved. Reopen this map to check its progress.', 503, { details: { code: 'guidance_pending' } })));
    expect(await screen.findByText('Your request is saved. Reopen this map to check its progress.')).toBeVisible();
    expect(within(action).getByRole('button', { name: 'Submit memo and add nodes' })).toBeEnabled();
    expect(within(action).queryByRole('status')).toBeNull();
    expect(storedProject().graph.nodes).toEqual([]);
    expect(storedProject().submission.analysis).toBeUndefined();
  });

  it('uses Back for visited account views and preserves edits when returning across systems', async () => {
    const project = createBlankProject();
    project.submission.text = 'Residents meet in the community room.';
    project.submission.fingerprint = stableId('src', project.submission.text);
    appendSubmittedNodes(project,{guidance:[],example:null,readiness:{ready:true,note:'Nodes identified.'},nodes:[{label:'Residents',type:'group',scale:'micro',evidence:project.submission.text},{label:'Community room',type:'setting',scale:'micro',evidence:project.submission.text}],connections:[]});
    seedProject(project);
    render(<App memoFirstWorkflow startInWorkspace />);
    await screen.findByRole('heading',{name:'Micro · local nodes'});
    expect(screen.getByRole('button',{name:'Back',exact:true})).toBeDisabled();
    const openResident = () => fireEvent.keyDown(document.querySelector(`[data-graph-id="${project.graph.nodes[0].id}"]`),{key:'Enter'});
    openResident();
    fireEvent.click(screen.getByRole('button',{name:'Tools',exact:true}));
    expect(screen.getByRole('region',{name:'Map tools'})).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Back',exact:true}));
    expect(await screen.findByRole('textbox',{name:'Label',exact:true})).toHaveValue('Residents');
    expect(screen.queryByRole('region',{name:'Map tools'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Back',exact:true}));
    expect(await screen.findByRole('heading',{name:'Micro · local nodes'})).toBeVisible();
    expect(screen.getByRole('button',{name:'Back',exact:true})).toBeDisabled();
    openResident();
    fireEvent.change(screen.getByRole('textbox',{name:'Label',exact:true}),{target:{value:'Neighbors'}});
    fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));
    await waitFor(()=>expect(storedProject().graph.nodes[0].label).toBe('Neighbors'));
    const editedGraph = structuredClone(storedProject().graph);
    fireEvent.click(screen.getByRole('button',{name:'Continue',exact:true}));
    expect(await screen.findByRole('heading',{name:'Meso · local relationships'})).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Back',exact:true}));
    expect(await screen.findByRole('textbox',{name:'Label',exact:true})).toHaveValue('Neighbors');
    await waitFor(()=>expect(storedProject().activeScale).toBe('micro'));
    expect(storedProject().graph).toEqual(editedGraph);
    expect(storedProject().submission.text).toBe(project.submission.text);
  });

  it('returns to the visited memo editor without replacing its newer text', async () => {
    const project = createBlankProject();
    project.submission.text = 'Residents meet in the community room.';
    project.submission.fingerprint = stableId('src', project.submission.text);
    appendSubmittedNodes(project,{guidance:[],example:null,readiness:{ready:true,note:'Nodes identified.'},nodes:[{label:'Residents',type:'group',scale:'micro',evidence:project.submission.text}],connections:[]});
    seedProject(project);
    render(<App memoFirstWorkflow startInWorkspace />);
    fireEvent.click(await screen.findByRole('button',{name:'Memo',exact:true}));
    const revised = `${project.submission.text} They discuss repairs.`;
    fireEvent.change(screen.getByRole('textbox',{name:'First memo',exact:true}),{target:{value:revised}});
    fireEvent.click(screen.getByRole('button',{name:'Tools',exact:true}));
    await screen.findByRole('region',{name:'Map tools'});
    fireEvent.click(screen.getByRole('button',{name:'Back',exact:true}));
    expect(await screen.findByRole('textbox',{name:'First memo',exact:true})).toHaveValue(revised);
    await waitFor(()=>expect(storedProject().submission.text).toBe(revised));
    expect(storedProject().graph).toEqual(project.graph);
    expect(screen.getByRole('button',{name:'Continue',exact:true})).toBeDisabled();
  });

  it('undoes and redoes account classification and clears Redo after a new edit', async () => {
    const project = createBlankProject();
    project.submission.text = 'Residents meet in the community room. A community counselor receives a referral.';
    project.submission.fingerprint = stableId('src',project.submission.text);
    appendSubmittedNodes(project,{guidance:[],example:null,readiness:{ready:true,note:'Nodes identified.'},nodes:[{label:'Residents',type:'group',scale:'micro',evidence:project.submission.text},{label:'Community counselor',type:'role',scale:'micro',evidence:'A community counselor receives a referral.'}],connections:[]});
    openMemoWorkflowScale(project,'exosphere'); project.part2Submission.text = 'A community counselor receives a referral.';
    project.part2Submission.fingerprint = stableId('src',project.part2Submission.text);
    appendSubmittedNodes(project,{guidance:[],example:null,readiness:{ready:true,note:'Nodes identified.'},nodes:[],connections:[]});
    // A saved older misclassification remains editable; it is not a new model classification.
    for (const node of [...project.graph.nodes,...project.candidates.nodes].filter(node=>node.label==='Community counselor')) { node.scale='exosphere'; node.type='resource'; }
    const counselor = project.graph.nodes.find(node=>node.label==='Community counselor');
    const historyButton = name => within(screen.getByRole('group',{name:'Edit history'})).getByRole('button',{name,exact:true});
    seedProject(project); render(<App memoFirstWorkflow startInWorkspace />);
    await screen.findByRole('heading',{name:'Exo · policies and offices'});
    expect(historyButton('Undo')).toBeDisabled();
    fireEvent.keyDown(document.querySelector(`[data-graph-id="${counselor.id}"]`),{key:'Enter'});
    fireEvent.change(screen.getByRole('combobox',{name:'System',exact:true}),{target:{value:'micro'}});
    fireEvent.change(screen.getByRole('combobox',{name:'Type',exact:true}),{target:{value:'role'}});
    fireEvent.click(screen.getByRole('button',{name:'Save classification',exact:true}));
    await waitFor(()=>expect(storedProject().graph.nodes.find(node=>node.id===counselor.id)).toMatchObject({scale:'micro',type:'role'}));
    fireEvent.click(historyButton('Undo'));
    await waitFor(()=>expect(storedProject().graph.nodes.find(node=>node.id===counselor.id)).toEqual(counselor));
    expect(historyButton('Redo')).toBeEnabled();
    fireEvent.click(historyButton('Redo'));
    await waitFor(()=>expect(storedProject().graph.nodes.find(node=>node.id===counselor.id)).toMatchObject({scale:'micro',type:'role'}));
    fireEvent.click(historyButton('Undo'));
    fireEvent.change(screen.getByRole('textbox',{name:'Label',exact:true}),{target:{value:'Community support counselor'}});
    fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));
    expect(historyButton('Redo')).toBeDisabled();
    await waitFor(()=>expect(storedProject().graph.nodes.find(node=>node.id===counselor.id).label).toBe('Community support counselor'));
    expect(storedProject().graph.edges).toEqual(project.graph.edges);
    expect(fetchMock.mock.calls.filter(([path])=>String(path)==='/api/preflight/evaluations')).toHaveLength(0);
  });

  it('restores an account node removed before reload using the persisted Undo action', async () => {
    const project = createBlankProject(); project.submission.text = 'Residents meet in the community room.';
    project.submission.fingerprint = stableId('src',project.submission.text);
    appendSubmittedNodes(project,{guidance:[],example:null,readiness:{ready:true,note:'Nodes identified.'},nodes:[{label:'Residents',type:'group',scale:'micro',evidence:project.submission.text},{label:'Community room',type:'setting',scale:'micro',evidence:project.submission.text}],connections:[]});
    seedProject(project); render(<App memoFirstWorkflow startInWorkspace />);
    await screen.findByRole('heading',{name:'Micro · local nodes'});
    fireEvent.keyDown(document.querySelector(`[data-graph-id="${project.graph.nodes[0].id}"]`),{key:'Enter'});
    fireEvent.click(screen.getByRole('button',{name:'Remove',exact:true}));
    await waitFor(()=>expect(storedProject().graph.nodes[0].claimState).toBe('retired'));
    expect(storedProject().editHistory.past).toHaveLength(1);
    cleanup(); render(<App memoFirstWorkflow startInWorkspace />);
    await screen.findByRole('heading',{name:'Micro · local nodes'});
    expect(document.querySelectorAll('.graph-node')).toHaveLength(1);
    const history = within(screen.getByRole('group',{name:'Edit history'}));
    expect(history.getByRole('button',{name:'Undo',exact:true})).toBeEnabled();
    fireEvent.click(history.getByRole('button',{name:'Undo',exact:true}));
    await waitFor(()=>expect(storedProject().graph).toEqual(project.graph));
    expect(document.querySelectorAll('.graph-node')).toHaveLength(2);
    expect(history.getByRole('button',{name:'Redo',exact:true})).toBeEnabled();
  });

  it('persists first-generation Undo readiness and restores Continue with Redo after reload', async () => {
    const project = createBlankProject();
    project.submission.text = 'Residents meet in the community room.';
    project.submission.fingerprint = stableId('src', project.submission.text);
    seedProject(project);
    preflightEvaluationResponder = body => jsonResponse({ evaluation: evaluationRecord(body, { review: {
      guidance: [], nodes: [{ label: 'Residents', type: 'group', scale: 'micro', evidence: project.submission.text }],
      connections: [], example: null, readiness: { ready: true, note: 'Nodes identified.' },
    } }) }, 201);
    render(<App memoFirstWorkflow startInWorkspace />);
    fireEvent.click(await screen.findByRole('button', { name: 'Submit memo and add nodes', exact: true }));
    await waitFor(() => expect(storedProject().graph.nodes).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
    fireEvent.click(within(screen.getByRole('group', { name: 'Edit history' })).getByRole('button', { name: 'Undo', exact: true }));
    await waitFor(() => expect(storedProject().graph.nodes).toHaveLength(0));
    expect(storedProject().submission.analysis).toBeUndefined();
    expect(storedProject().preflight).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    cleanup(); render(<App memoFirstWorkflow startInWorkspace />);
    fireEvent.click(await screen.findByRole('button', { name: 'Memo', exact: true }));
    expect(await screen.findByRole('button', { name: 'Submit memo and add nodes', exact: true })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    fireEvent.click(within(screen.getByRole('group', { name: 'Edit history' })).getByRole('button', { name: 'Redo', exact: true }));
    await waitFor(() => expect(storedProject().graph.nodes).toHaveLength(1));
    expect(storedProject().submission.analysis).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
    cleanup(); render(<App memoFirstWorkflow startInWorkspace />);
    expect(await screen.findByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
    expect(storedProject().graph.nodes).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(1);
  });

  it('names each proposal left out of an accepted submission with its reason', async () => {
    const project = createBlankProject();
    project.submission.text = 'Residents meet in the community room. The Access Board administers the program; residents\' participation is unknown.';
    project.submission.fingerprint = stableId('src', project.submission.text);
    seedProject(project);
    preflightEvaluationResponder = body => jsonResponse({ evaluation: evaluationRecord(body, {
      review: { guidance: [], nodes: [{ label: 'Residents', type: 'group', scale: 'micro', evidence: 'Residents meet in the community room.' }], connections: [], example: null, readiness: { ready: true, note: 'Nodes identified.' } },
      runtime: { provider: 'cail-gateway', model: 'synthetic-test', createdAt: '2027-01-15T08:00:00.000Z', correctiveRetries: 1,
        withheldNodes: [{ label: 'Access Board', reason: 'outside_participation' }, { label: 'Residents want better repairs', reason: 'label_format' }] },
    }) }, 201);
    render(<App memoFirstWorkflow startInWorkspace />);
    fireEvent.click(await screen.findByRole('button', { name: 'Submit memo and add nodes', exact: true }));
    await waitFor(() => expect(storedProject().graph.nodes).toHaveLength(1));
    expect(await screen.findByText('1 node added. 2 left out; the Notebook lists them.')).toBeVisible();
    const leftOut = screen.getByRole('region', { name: 'Left out' });
    expect(within(leftOut).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'Access BoardPeople in the memo take part here, so it belongs at Micro',
      'Residents want better repairsName is a sentence or covers more than one thing',
    ]);
    expect(storedProject().preflight.evaluation.runtime.withheldNodes).toHaveLength(2);
  });

  it('retains preflight-only legacy readiness after modern baseline Undo and event pruning', () => {
    const before = createBlankProject();
    before.submission.text = 'Residents meet in the community room.';
    before.submission.fingerprint = stableId('src', before.submission.text);
    const review = { guidance: [], nodes: [], connections: [], example: null, readiness: { ready: true, note: 'Nodes identified.' } };
    const evaluation = evaluationRecord(preflightEvaluationPayload(before, true), { review });
    before.preflight = { memoReview: review, configurationSnapshot: evaluation.configSnapshot,
      evaluation: { evaluationId: evaluation.id, runtime: evaluation.runtime, createdAt: evaluation.createdAt, expiresAt: evaluation.expiresAt },
      sourceFingerprint: stableId('src', before.submission.text) };
    expect(memoUpdateState(before).submitted).toBe(true);
    const navigation = structuredClone(before); openMemoWorkflowScale(navigation, 'meso');
    expect(recordEdit(before, navigation, 'Meso opened')).toBe(false);
    expect(navigation.editHistory).toBeUndefined();
    const next = structuredClone(before); appendSubmittedNodes(next, review); recordEdit(before, next, 'Submit memo');
    const undone = restoreEdit(parseProject(serializeProject(next))).project;
    expect(undone.submission.analysis).toBeUndefined(); expect(undone.preflight).toEqual(before.preflight);
    undone.events = [];
    expect(memoUpdateState(parseProject(serializeProject(undone))).submitted).toBe(true);
  });

  it('flushes a pending account interpretation before Undo and restores the visible field', async () => {
    const project = createBlankProject(); project.submission.text = 'Residents meet in the community room.';
    project.submission.fingerprint = stableId('src',project.submission.text);
    appendSubmittedNodes(project,{guidance:[],example:null,readiness:{ready:true,note:'Nodes identified.'},nodes:[{label:'Residents',type:'group',scale:'micro',evidence:project.submission.text}],connections:[]});
    seedProject(project); render(<App memoFirstWorkflow startInWorkspace />);
    await screen.findByRole('heading',{name:'Micro · local nodes'});
    fireEvent.keyDown(document.querySelector(`[data-graph-id="${project.graph.nodes[0].id}"]`),{key:'Enter'});
    fireEvent.change(screen.getByRole('textbox',{name:'Label',exact:true}),{target:{value:'Neighbors'}});
    fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));
    await waitFor(()=>expect(storedProject().graph.nodes[0].label).toBe('Neighbors'));
    fireEvent.change(screen.getByRole('textbox',{name:'Interpretation',exact:true}),{target:{value:'An unfinished interpretation.'}});
    fireEvent.click(within(screen.getByRole('group',{name:'Edit history'})).getByRole('button',{name:'Undo',exact:true}));
    await waitFor(()=>expect(storedProject().graph.nodes[0].annotations.analytical.text).toBe(''));
    await waitFor(()=>expect(screen.getByRole('textbox',{name:'Interpretation',exact:true})).toHaveValue(''));
    expect(storedProject().graph.nodes[0].label).toBe('Neighbors');
    expect(within(screen.getByRole('group',{name:'Edit history'})).getByRole('button',{name:'Redo',exact:true})).toBeEnabled();
  });

  it('keeps account scale navigation disabled until a submitted memo has finished adding nodes', async () => {
    const project = createBlankProject();
    project.submission.text = 'Residents meet in the community room.';
    project.submission.fingerprint = stableId('src', project.submission.text);
    seedProject(project);
    let finishEvaluation;
    preflightEvaluationResponder = body => new Promise(resolve => {
      finishEvaluation = () => resolve(jsonResponse({evaluation:evaluationRecord(body,{review:{guidance:[],nodes:[{label:'Residents',type:'group',scale:'micro',evidence:project.submission.text}],connections:[],example:null,readiness:{ready:true,note:'Nodes identified.'}}})},201));
    });
    render(<App memoFirstWorkflow startInWorkspace />);
    fireEvent.click(await screen.findByRole('button',{name:'Submit memo and add nodes',exact:true}));
    fireEvent.click(screen.getByRole('button',{name:'Notebook',exact:true}));
    for (const button of within(screen.getByRole('navigation',{name:'Mapping steps'})).getAllByRole('button')) expect(button).toBeDisabled();
    expect(screen.getByRole('button',{name:'Continue',exact:true})).toBeDisabled();
    await waitFor(() => expect(finishEvaluation).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button',{name:/Meso$/}));
    fireEvent.click(screen.getByRole('button',{name:'Continue',exact:true}));
    expect(storedProject().activeScale).toBe('micro');
    await act(async () => finishEvaluation());
    await waitFor(() => expect(document.querySelectorAll('.graph-node')).toHaveLength(1));
    expect(screen.getByRole('button',{name:/Meso$/})).toBeEnabled();
    expect(screen.getByRole('button',{name:'Continue',exact:true})).toBeEnabled();
    expect(screen.queryByText(/memo or model setup changed/)).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:/Meso$/}));
    expect(await screen.findByRole('heading',{name:'Meso · local relationships'})).toBeVisible();
  });

  it('rejects a memo response when a newer memo edit is queued in the same React batch', async () => {
    const project = createBlankProject();
    const original = 'Residents meet in the community room.';
    const revised = `${original} Teachers meet families in the school.`;
    project.submission.text = original;
    project.submission.fingerprint = stableId('src', original);
    seedProject(project);
    let finishEvaluation;
    preflightEvaluationResponder = body => new Promise(resolve => {
      finishEvaluation = () => resolve(jsonResponse({ evaluation: evaluationRecord(body, { review: {
        guidance: [], nodes: [{ label: 'Residents', type: 'group', scale: 'micro', evidence: original }],
        connections: [], example: null, readiness: { ready: true, note: 'Nodes identified.' },
      } }) }, 201));
    });
    render(<App memoFirstWorkflow startInWorkspace />);
    fireEvent.click(await screen.findByRole('button', { name: 'Submit memo and add nodes', exact: true }));
    await waitFor(() => expect(finishEvaluation).toBeTypeOf('function'));
    await act(async () => {
      fireEvent.change(screen.getByRole('textbox', { name: 'First memo', exact: true }), { target: { value: revised } });
      finishEvaluation();
    });
    await waitFor(() => expect(storedProject().submission.text).toBe(revised));
    expect(storedProject().submission.analysis).toBeUndefined();
    expect(storedProject().preflight).toBeNull();
    expect(storedProject().graph.nodes).toEqual([]);
    expect(storedProject().events.some(event => event.action === 'preflight.completed')).toBe(false);
    expect(screen.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    expect(screen.queryByText(/nodes added to your map|Your map is ready/)).toBeNull();
    expect(screen.getAllByText(/memo or (?:map changed while nodes|model setup changed while guidance) (?:were|was) generated/).length).toBeGreaterThan(0);
  });

  it('checks queued memo edits again at the model-result commit boundary', async () => {
    const project = createBlankProject();
    const original = 'Residents meet in the community room.';
    const revised = `${original} Teachers meet families in the school.`;
    project.submission.text = original;
    project.submission.fingerprint = stableId('src', original);
    seedProject(project);
    preflightEvaluationResponder = body => jsonResponse({ evaluation: evaluationRecord(body, { review: {
      guidance: [], nodes: [{ label: 'Residents', type: 'group', scale: 'micro', evidence: original }],
      connections: [], example: null, readiness: { ready: true, note: 'Nodes identified.' },
    } }) }, 201);
    render(<App memoFirstWorkflow startInWorkspace />);
    const submit = await screen.findByRole('button', { name: 'Submit memo and add nodes', exact: true });
    const setItem = Storage.prototype.setItem;
    let queuedEdit = false;
    // The optional result cache is written after response validation and before
    // its React state update. Queue a real memo edit at that boundary to expose
    // the race that an earlier projectRef check alone cannot protect.
    const cacheWrite = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      setItem.call(this, key, value);
      if (!queuedEdit && key.startsWith('systems-mapping.guidance.')) {
        queuedEdit = true;
        fireEvent.change(screen.getByRole('textbox', { name: 'First memo', exact: true }), { target: { value: revised } });
      }
    });
    try {
      fireEvent.click(submit);
      await waitFor(() => expect(queuedEdit).toBe(true));
      await waitFor(() => expect(storedProject().submission.text).toBe(revised));
      expect(storedProject().submission.analysis).toBeUndefined();
      expect(storedProject().preflight).toBeNull();
      expect(storedProject().graph.nodes).toEqual([]);
      expect(storedProject().events.some(event => event.action === 'preflight.completed')).toBe(false);
      expect(screen.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
      expect(screen.getAllByText(/memo or map changed while nodes were generated/).length).toBeGreaterThan(0);
      expect(screen.queryByText(/nodes added to your map|Your map is ready/)).toBeNull();
    } finally {
      cacheWrite.mockRestore();
    }
  });

  it.each(['pending', 'complete', 'same'])('cancels a queued account submission when opening a %s project', async destination => {
    const project = createBlankProject();
    project.title = 'Queued source project';
    project.submission.text = 'Residents meet in the community room.';
    project.submission.fingerprint = stableId('src', project.submission.text);
    const other = createBlankProject();
    other.title = 'Other saved project';
    other.submission.text = 'Neighbors meet in a garden. This is a different memo.';
    other.submission.fingerprint = stableId('src', other.submission.text);
    appendSubmittedNodes(other,{guidance:[],example:null,readiness:{ready:true,note:'Nodes identified.'},nodes:[{label:'Neighbors',type:'group',scale:'micro',evidence:other.submission.text}],connections:[]});
    other.stage = destination === 'pending' ? 1 : 3;
    const records = saveProjectToLibrary(localStorage,project,[]);
    saveProjectToLibrary(localStorage,other,records);
    seedProject(project);
    let holdConfiguration = false;
    let heldRequests = 0;
    let releaseConfiguration;
    const configuration = new Promise(resolve => { releaseConfiguration = resolve; });
    publicConfigurationResponder = path => {
      if (!holdConfiguration) return jsonResponse(publicConfiguration(path));
      heldRequests += 1;
      return configuration.then(() => jsonResponse(publicConfiguration(path)));
    };
    render(<App memoFirstWorkflow startInWorkspace />);
    const submit = await screen.findByRole('button',{name:'Submit memo and add nodes',exact:true});
    holdConfiguration = true;
    fireEvent.click(submit);
    await waitFor(() => expect(heldRequests).toBeGreaterThan(0));
    expect(screen.getByRole('button',{name:'Continue',exact:true})).toBeDisabled();
    openProjectMenu('Projects');
    await showResumeScreen();
    holdConfiguration = false;
    openProjectFromList(destination === 'same' ? project.title : other.title);
    await screen.findByRole('button',{name:'Memo',exact:true});
    await act(async () => releaseConfiguration());
    await waitFor(() => expect(screen.getByRole('button',{name:'Continue',exact:true}).disabled).toBe(destination === 'same'));
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(0);
    if (destination !== 'complete') expect(screen.getByRole('textbox',{name:'First memo',exact:true})).toHaveValue(destination === 'same' ? project.submission.text : other.submission.text);
    expect(storedProject().id).toBe(destination === 'same' ? project.id : other.id);
  });

  it('keeps an edited account memo open across scale navigation and reload until it is submitted', async () => {
    const project = createBlankProject();
    project.submission.text = 'Residents meet in the community room.';
    project.submission.fingerprint = stableId('src', project.submission.text);
    appendSubmittedNodes(project,{guidance:[],example:null,readiness:{ready:true,note:'Nodes identified.'},nodes:[{label:'Residents',type:'group',scale:'micro',evidence:project.submission.text}],connections:[]});
    project.stage = 2;
    seedProject(project);
    preflightEvaluationResponder = body => jsonResponse({evaluation:evaluationRecord(body,{review:{guidance:[],nodes:[],connections:[],example:null,readiness:{ready:true,note:'No additional nodes identified.'}}})},201);
    render(<App memoFirstWorkflow startInWorkspace />);
    fireEvent.click(await screen.findByRole('button',{name:'Memo',exact:true}));
    const revised = `${project.submission.text} They discuss weekly events.`;
    fireEvent.change(screen.getByRole('textbox',{name:'First memo',exact:true}),{target:{value:revised}});
    expect(screen.getByRole('button',{name:'Continue',exact:true})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'Notebook',exact:true}));
    fireEvent.click(screen.getByRole('button',{name:/Meso$/}));
    expect(screen.getByRole('textbox',{name:'First memo',exact:true})).toHaveValue(revised);
    await waitFor(() => expect(storedProject().submission.text).toBe(revised));
    cleanup();
    render(<App memoFirstWorkflow startInWorkspace />);
    expect(await screen.findByRole('textbox',{name:'First memo',exact:true})).toHaveValue(revised);
    expect(document.querySelectorAll('.graph-node')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button',{name:'Update map',exact:true}));
    await waitFor(() => expect(screen.queryByRole('textbox',{name:'First memo',exact:true})).toBeNull());
    await waitFor(() => expect(storedProject().stage).toBe(3));
    expect(storedProject().graph.nodes).toHaveLength(1);
    expect(storedProject().graph.edges).toHaveLength(0);
  });

  it('keeps a generated second memo available while first-memo edits await an update', async () => {
    const project = createBlankProject();
    project.submission.text = 'Residents meet in the community room.';
    project.submission.fingerprint = stableId('src', project.submission.text);
    const ready = {guidance:[],example:null,readiness:{ready:true,note:'Nodes identified.'},connections:[]};
    appendSubmittedNodes(project,{...ready,nodes:[{label:'Residents',type:'group',scale:'micro',evidence:project.submission.text}]});
    openMemoWorkflowScale(project,'exosphere');
    project.part2Submission.text = 'Further research is needed about outside settings.';
    project.part2Submission.fingerprint = stableId('src', project.part2Submission.text);
    appendSubmittedNodes(project,{...ready,nodes:[]});
    project.submission.text += ' They also meet in the garden.';
    project.submission.fingerprint = stableId('src', project.submission.text);
    seedProject(project); render(<App memoFirstWorkflow startInWorkspace />);
    expect(await screen.findByRole('button',{name:'Continue',exact:true})).toBeEnabled();
    fireEvent.click(screen.getByRole('button',{name:'Memo',exact:true}));
    fireEvent.change(screen.getByRole('combobox',{name:'Memo part'}),{target:{value:'micro'}});
    expect(screen.getByRole('button',{name:'Continue',exact:true})).toBeDisabled();
    expect(screen.getByRole('textbox',{name:'First memo'})).toHaveValue(project.submission.text);
    fireEvent.change(screen.getByRole('combobox',{name:'Memo part'}),{target:{value:'exosphere'}});
    expect(screen.getByRole('button',{name:'Continue',exact:true})).toBeEnabled();
    expect(screen.getByRole('textbox',{name:'Second memo'})).toHaveValue(project.part2Submission.text);
    fireEvent.click(screen.getByRole('button',{name:'Continue',exact:true}));
    expect(await screen.findByRole('heading',{name:'Macro · broader conditions'})).toBeVisible();
    expect(screen.getByRole('button',{name:'Finish map',exact:true})).toBeEnabled();
    expect(fetchMock.mock.calls.filter(([path])=>String(path)==='/api/preflight/evaluations')).toHaveLength(0);
  });

  async function openDirectConnectionProject({ oneNode = false, autoFit = false } = {}) {
    const project = createBlankProject();
    project.submission.text = 'Residents meet in the community room.';
    project.submission.fingerprint = stableId('src', project.submission.text);
    project.instructor.evidenceRequired = false;
    project.layout = { ...project.layout, autoFit };
    appendSubmittedNodes(project,{guidance:[],example:null,readiness:{ready:true,note:'Nodes identified.'},nodes:[{label:'Residents',type:'group',scale:'micro',evidence:project.submission.text},
      ...(!oneNode ? [{label:'Community room',type:'setting',scale:'micro',evidence:project.submission.text}] : [])],connections:[]});
    seedProject(project);
    render(<App memoFirstWorkflow startInWorkspace />);
    await waitFor(() => expect(document.querySelectorAll('.graph-node')).toHaveLength(oneNode ? 1 : 2));
    return project;
  }

  it.each(['start', 'cancel'])('does not steal a newly focused target after a deferred connection %s', async action => {
    const project = await openDirectConnectionProject();
    const source = document.querySelector(`[data-graph-id="${project.graph.nodes[0].id}"]`);
    const target = document.querySelector(`[data-graph-id="${project.graph.nodes[1].id}"]`);
    const frames = [];
    window.requestAnimationFrame = vi.fn(callback => { frames.push(callback); return frames.length; });
    source.focus(); fireEvent.keyDown(source, { key: 'Enter' });
    act(() => { frames.splice(0).forEach(callback => callback(0)); });
    const connect = screen.getByRole('button', { name: 'Connect from Residents', exact: true });
    connect.focus(); fireEvent.click(connect);
    if (action === 'cancel') {
      act(() => { frames.splice(0).forEach(callback => callback(0)); });
      const cancel = screen.getByRole('button', { name: 'Cancel', exact: true });
      cancel.focus(); fireEvent.click(cancel);
    }
    target.focus();
    act(() => { frames.splice(0).forEach(callback => callback(0)); });
    expect(document.activeElement).toBe(target);
    fireEvent.keyDown(document.activeElement, { key: 'Enter' });
    if (action === 'start') {
      expect(screen.getByRole('textbox', { name: 'Relationship', exact: true })).toBeVisible();
      expect(screen.getByRole('combobox', { name: 'To', exact: true })).toHaveValue(project.graph.nodes[1].id);
    } else expect(screen.getByRole('textbox', { name: 'Label', exact: true })).toHaveValue('Community room');
  });

  it('double-clicks a Micro node then explicitly saves a student-authored relationship to another node', async () => {
    const project = await openDirectConnectionProject({autoFit:true});
    const before=project.graph.nodes.map(node=>renderedNodePosition(node.id));
    const source = document.querySelector(`[data-graph-id="${project.graph.nodes[0].id}"]`);
    const target = document.querySelector(`[data-graph-id="${project.graph.nodes[1].id}"]`);
    fireEvent.doubleClick(source);
    expect(document.querySelector('.map-connect-status')).toHaveTextContent('Residents selected');
    fireEvent.keyDown(target, { key: 'Enter' });
    expect(await screen.findByRole('heading', { name: 'New relationship' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Relationship', exact: true })).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Add relationship', exact: true }));
    expect(storedProject().graph.edges).toHaveLength(0);
    fireEvent.change(screen.getByRole('textbox', { name: 'Relationship', exact: true }), { target: { value: 'meet in' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add relationship', exact: true }));
    await waitFor(() => expect(storedProject().graph.edges).toHaveLength(1));
    expect(storedProject().activeScale).toBe('micro');
    expect(storedProject().graph.edges[0]).toMatchObject({ source: project.graph.nodes[0].id, target: project.graph.nodes[1].id, verb: 'meet in', scale: 'meso', origin: 'student entry' });
    expect(document.querySelectorAll('.graph-edge')).toHaveLength(1);
    // The first relationship never rearranges the cluster the student was looking at.
    expect(project.graph.nodes.map(node=>renderedNodePosition(node.id))).toEqual(before);
  });

  it('adds a connected node from blank canvas space in one saved edit and reverses both with Undo', async () => {
    const project = await openDirectConnectionProject({ oneNode: true });
    const source = () => document.querySelector(`[data-graph-id="${project.graph.nodes[0].id}"]`);
    fireEvent.doubleClick(source());
    const canvas = document.querySelector('.graph-canvas');
    const [viewX, viewY, viewWidth, viewHeight] = canvas.getAttribute('viewBox').split(' ').map(Number);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 100, y: 60, left: 100, top: 60, width: viewWidth, height: viewHeight, right: 100 + viewWidth, bottom: 60 + viewHeight });
    const camera = viewportTransform();
    const expectedPosition = { x: Math.round((viewX + 610 - 100 - camera.panX) / camera.zoom), y: Math.round((viewY + 410 - 60 - camera.panY) / camera.zoom) };
    fireEvent.pointerDown(canvas, { pointerId: 71, pointerType: 'mouse', button: 0, clientX: 610, clientY: 410 });
    fireEvent.pointerUp(canvas, { pointerId: 71, pointerType: 'mouse', button: 0, clientX: 610, clientY: 410 });
    expect(await screen.findByRole('heading', { name: 'New connected node' })).toBeVisible();
    expect(storedProject().graph.nodes).toHaveLength(1);
    expect(storedProject().graph.edges).toHaveLength(0);
    fireEvent.change(screen.getByRole('textbox', { name: 'Label', exact: true }), { target: { value: 'Caseworker' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add node and relationship', exact: true }));
    expect(storedProject().graph.nodes).toHaveLength(1);
    fireEvent.change(screen.getByRole('textbox', { name: 'Relationship', exact: true }), { target: { value: 'consult' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add node and relationship', exact: true }));
    await waitFor(() => expect(storedProject().graph.nodes).toHaveLength(2));
    const added = storedProject().graph.nodes.find(node => node.label === 'Caseworker');
    expect(added).toMatchObject(expectedPosition);
    expect(storedProject().graph.edges).toHaveLength(1);
    expect(storedProject().graph.edges[0]).toMatchObject({ source: project.graph.nodes[0].id, target: added.id, verb: 'consult', scale: 'meso' });
    expect(storedProject().layout.manualNodeIds).toContain(added.id);
    const history = within(screen.getByRole('group', { name: 'Edit history' }));
    fireEvent.click(history.getByRole('button', { name: 'Undo', exact: true }));
    await waitFor(() => expect(storedProject().graph.nodes).toHaveLength(1));
    expect(storedProject().graph.edges).toHaveLength(0);
    fireEvent.click(history.getByRole('button', { name: 'Redo', exact: true }));
    await waitFor(() => expect(storedProject().graph.nodes).toHaveLength(2));
    expect(storedProject().graph.nodes.find(node => node.id === added.id)).toEqual(added);
    expect(storedProject().graph.edges).toHaveLength(1);
  });

  it.each(['Cancel', 'Escape'])('abandons a new connected node with %s without changing saved work', async action => {
    const project = await openDirectConnectionProject({ oneNode: true });
    const source = document.querySelector(`[data-graph-id="${project.graph.nodes[0].id}"]`);
    fireEvent.keyDown(source, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(document.querySelector('.graph-canvas'), { key: 'n' });
    expect(await screen.findByRole('heading', { name: 'New connected node' })).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Label', exact: true }), { target: { value: 'Caseworker' } });
    if (action === 'Cancel') fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    else fireEvent.keyDown(screen.getByRole('textbox', { name: 'Label', exact: true }), { key: 'Escape' });
    expect(screen.queryByRole('heading', { name: 'New connected node' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resume relationship', exact: true })).toBeNull();
    expect(storedProject().graph).toEqual(project.graph);
  });

  it('cancels direct connection selection when the starting node is removed', async () => {
    const project = await openDirectConnectionProject();
    fireEvent.doubleClick(document.querySelector(`[data-graph-id="${project.graph.nodes[0].id}"]`));
    fireEvent.click(screen.getByRole('button', { name: 'Remove', exact: true }));
    expect(document.querySelector('.map-connect-status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resume relationship', exact: true })).toBeNull();
    await waitFor(() => expect(storedProject().graph.nodes[0].claimState).toBe('retired'));
    expect(storedProject().graph.edges).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Add to map', exact: true })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Remove', exact: true })).toBeNull();
  });

  it('saves a chosen node color on the graph and matching candidate and restores it with Undo', async () => {
    const project = await openDirectConnectionProject();
    const nodeId = project.graph.nodes[0].id;
    fireEvent.keyDown(document.querySelector(`[data-graph-id="${nodeId}"]`), { key: 'Enter' });
    fireEvent.click(within(screen.getByRole('group', { name: 'Node color' })).getByRole('radio', { name: 'Teal', exact: true }));
    await waitFor(() => expect(storedProject().graph.nodes.find(node => node.id === nodeId).color).toBe('teal'));
    expect(document.querySelector(`[data-graph-id="${nodeId}"]`)).toHaveAttribute('data-node-color', 'teal');
    const candidate = storedProject().candidates.nodes.find(node => node.id === nodeId);
    if (candidate) expect(candidate.color).toBe('teal');
    fireEvent.click(within(screen.getByRole('group', { name: 'Edit history' })).getByRole('button', { name: 'Undo', exact: true }));
    await waitFor(() => expect(storedProject().graph.nodes.find(node => node.id === nodeId).color).toBeUndefined());
    expect(document.querySelector(`[data-graph-id="${nodeId}"]`)).not.toHaveAttribute('data-node-color');
  });

  it('returns to an unfinished connected-node form but never reopens it after cancellation', async () => {
    const project = await openDirectConnectionProject({ oneNode: true });
    fireEvent.doubleClick(document.querySelector(`[data-graph-id="${project.graph.nodes[0].id}"]`));
    fireEvent.keyDown(document.querySelector('.graph-canvas'), { key: 'n' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Label', exact: true }), { target: { value: 'Caseworker' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Relationship', exact: true }), { target: { value: 'consult' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tools', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Back', exact: true }));
    expect(await screen.findByRole('heading', { name: 'New connected node' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Label', exact: true })).toHaveValue('Caseworker');
    expect(screen.getByRole('textbox', { name: 'Relationship', exact: true })).toHaveValue('consult');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Back', exact: true }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'New connected node' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Add node and relationship', exact: true })).toBeNull();
    expect(storedProject().graph).toEqual(project.graph);
  });

  it('discards a pending connected-node position when moving to another system', async () => {
    const project = await openDirectConnectionProject({ oneNode: true });
    fireEvent.doubleClick(document.querySelector(`[data-graph-id="${project.graph.nodes[0].id}"]`));
    fireEvent.keyDown(document.querySelector('.graph-canvas'), { key: 'n' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Label', exact: true }), { target: { value: 'Caseworker' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }));
    await waitFor(() => expect(storedProject().activeScale).toBe('meso'));
    fireEvent.click(screen.getByRole('button', { name: 'Back', exact: true }));
    await waitFor(() => expect(storedProject().activeScale).toBe('micro'));
    expect(screen.queryByRole('heading', { name: 'New connected node' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add node and relationship', exact: true })).toBeNull();
    expect(storedProject().graph).toEqual(project.graph);
  });

  it('requires an async class-code exchange, keeps rejected codes out of storage, and resumes the saved stage after success', async () => {
    const project = createDefaultProject();
    project.stage = 1;
    project.furthestStage = 1;
    seedProject(project);
    studentSession = null;

    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Systems Mapping' })).toBeVisible();
    const code = screen.getByRole('textbox', { name: 'Class code' });
    fireEvent.change(code, { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code did not work');
    expect(code).toHaveValue('');
    expect(window.localStorage.getItem('classCode')).toBeNull();
    expect(window.sessionStorage.getItem('classCode')).toBeNull();

    fireEvent.change(code, { target: { value: '101' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeVisible();
    expect(within(screen.getByRole('article', { name: project.title })).getByText(/Review/)).toBeVisible();
    openProjectFromList(project.title);
    expect(await screen.findByRole('heading', { name: 'Memo review' })).toBeVisible();

    const attempts = fetchMock.mock.calls.filter(([path]) => String(path) === '/api/student/access');
    expect(attempts.map(([, options]) => JSON.parse(options.body))).toEqual([{ code: '999' }, { code: '101' }]);
    expect(attempts.every(([, options]) => options.credentials === 'same-origin')).toBe(true);
  });

  it('switches between light and dark mode and retains the selected theme', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Projects' });
    const toggle = screen.getByRole('button', { name: 'Switch to dark mode' });
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(toggle);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(window.localStorage.getItem('systems-mapping.theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([false, true])('waits for the institutional session before offering CUNY Login (teacher: %s)', async (startInTeacher) => {
    const token = '0123456789abcdefghijklmnopqrstuv';
    window.history.replaceState(null, '', `/p/${token}`);
    fetchMock.mockImplementation((path, options) => String(path) === '/api/student/session' ? new Promise(() => {}) : defaultFetch(path, options));
    render(<App startInWorkspace={!startInTeacher} startInTeacher={startInTeacher} onAccountDashboard={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking sign-in');
    expect(screen.queryByRole('link', { name: 'CUNY Login' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Class code' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Ask your teacher/)).not.toBeInTheDocument();
    expect(screen.queryByText('Instructor Console')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path]) => String(path) === '/api/student/access')).toBe(false);
  });

  it.each([null, 401, 403])('uses CUNY Login rather than class access for institutional auth state %s', async (status) => {
    studentSession = null;
    if (status) fetchMock.mockImplementation((path, options) => String(path) === '/api/student/session' ? jsonResponse({ error: 'Sign-in required' }, status) : defaultFetch(path, options));
    render(<App startInWorkspace onAccountDashboard={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(status === 403 ? 'CUNY AI Lab access required' : 'Use CUNY Login to continue');
    expect(screen.getByRole('link', { name: 'CUNY Login' })).toHaveAttribute('href', '/auth/start');
    expect(screen.queryByRole('textbox', { name: 'Class code' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path]) => String(path) === '/api/student/access')).toBe(false);
  });

  it('submits the reviewed stage only after an explicit Progress action', async () => {
    const project=seedProject(makeMapProject());
    const submit=vi.fn(async () => ({recorded:true}));
    render(<App startInWorkspace onAccountDashboard={vi.fn()} onSubmitRevision={submit} />);
    await screen.findByRole('heading',{name:'Systems map'});
    expect(submit).not.toHaveBeenCalled();
    openNotebookSection('review');
    openDetails('.reflection-help:has(.map-check)');
    fireEvent.click(screen.getByRole('button',{name:'Submit revision',exact:true}));
    await waitFor(()=>expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0]).toMatchObject({id:project.id,activeScale:project.activeScale,stage:4});
    expect(await screen.findByText('Revision submitted to your instructor.')).toBeVisible();
  });

  it('retries an institutional session outage and restores the saved stage without resetting the map', async () => {
    const project = seedProject(makeMapProject());
    let reads = 0;
    fetchMock.mockImplementation((path, options) => String(path) === '/api/student/session' && ++reads === 1 ? jsonResponse({ error: 'Unavailable' }, 503) : defaultFetch(path, options));
    render(<App startInWorkspace onAccountDashboard={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in check unavailable');
    expect(screen.getByRole('link', { name: 'CUNY Login' })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Class code' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    expect(storedProject()).toMatchObject({ id: project.id, stage: project.stage, graph: project.graph, submission: project.submission });
    expect(reads).toBe(2);
  });

  it('rechecks an expiring institutional grant and resumes the same workspace when the server session is still valid', async () => {
    vi.useFakeTimers();
    const project = makeMapProject();
    project.stage = 0;
    seedProject(project);
    let reads = 0;
    let finishRefresh;
    fetchMock.mockImplementation((path, options) => {
      if (String(path) !== '/api/student/session') return defaultFetch(path, options);
      if (++reads === 1) return jsonResponse({ access: grantedAccess(60_000) });
      return new Promise(resolve => { finishRefresh = () => resolve(jsonResponse({ access: grantedAccess(60_000) })); });
    });
    render(<App startInWorkspace onAccountDashboard={vi.fn()} />);
    for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
    act(() => vi.advanceTimersByTime(59_800));
    const memo = `${project.submission.text}\nA draft survives grant refresh.`;
    fireEvent.change(screen.getByRole('textbox', { name: /^Memo/ }), { target: { value: memo } });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(reads).toBe(2);
    expect(screen.getByRole('status')).toHaveTextContent('Checking sign-in');
    expect(screen.queryByRole('link', { name: 'CUNY Login' })).not.toBeInTheDocument();
    expect(storedProject()).toMatchObject({ id: project.id, stage: 0, graph: project.graph, submission: project.submission, part2Submission: { text: memo } });
    await act(async () => { finishRefresh(); });
    expect(screen.getByRole('textbox', { name: /^Memo/ })).toHaveValue(memo);
    expect(screen.queryByRole('link', { name: 'CUNY Login' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path]) => String(path) === '/api/auth/me')).toBe(false);
  });

  it.each(['focus', 'pageshow', 'visibilitychange'])('rechecks a paused institutional workspace on %s without requiring a reload or accepting another endpoint as proof', async event => {
    const project = seedProject(makeMapProject());
    studentSession = null;
    // Settle the initial async check and passive listeners before simulating return.
    await act(async () => { render(<App startInWorkspace onAccountDashboard={vi.fn()} />); });
    expect(screen.getByRole('link', { name: 'CUNY Login' })).toBeVisible();
    studentSession = () => grantedAccess();
    await act(async () => { fireEvent(event === 'visibilitychange' ? document : window, new Event(event)); });
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    expect(storedProject()).toMatchObject({ id: project.id, graph: project.graph, stage: project.stage });
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/student/session')).toHaveLength(2);
    expect(fetchMock.mock.calls.some(([path]) => ['/api/auth/me', '/api/student/logout', '/auth/logout'].includes(String(path)))).toBe(false);
  });

  it.each([401, 403])('requires a current Systems grant when expiry revalidation returns %s even if auth/me would recognize the user', async status => {
    vi.useFakeTimers();
    seedProject(makeMapProject());
    let reads = 0;
    fetchMock.mockImplementation((path, options) => {
      if (String(path) === '/api/auth/me') return jsonResponse({ user: { id: 'recognized-synthetic-user' } });
      if (String(path) === '/api/student/session') return ++reads === 1
        ? jsonResponse({ access: grantedAccess(60_000) })
        : jsonResponse({ error: 'Sign-in required' }, status);
      return defaultFetch(path, options);
    });
    render(<App startInWorkspace onAccountDashboard={vi.fn()} />);
    for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByRole('alert')).toHaveTextContent(status === 403 ? 'CUNY AI Lab access required' : 'Use CUNY Login to continue');
    expect(screen.getByRole('link', { name: 'CUNY Login' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Systems map' })).not.toBeInTheDocument();
    expect(reads).toBe(2);
    expect(fetchMock.mock.calls.some(([path]) => String(path) === '/api/auth/me')).toBe(false);
  });

  it('bounds an expired institutional grant refresh and keeps the map recoverable when verification is unavailable', async () => {
    vi.useFakeTimers();
    const project = seedProject(makeMapProject());
    let reads = 0;
    fetchMock.mockImplementation((path, options) => String(path) === '/api/student/session'
      ? ++reads === 1 ? jsonResponse({ access: grantedAccess(60_000) }) : new Promise(() => {})
      : defaultFetch(path, options));
    render(<App startInWorkspace onAccountDashboard={vi.fn()} />);
    for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByRole('status')).toHaveTextContent('Checking sign-in');
    expect(screen.queryByRole('link', { name: 'CUNY Login' })).not.toBeInTheDocument();
    fireEvent.focus(window);
    fireEvent(window, new Event('pageshow'));
    expect(reads).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(INSTITUTIONAL_SESSION_TIMEOUT_MS); });
    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in check unavailable');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(storedProject()).toMatchObject({ id: project.id, graph: project.graph, submission: project.submission });
  });

  it('bounds return-event retries even when a paused institutional session is rejected immediately', async () => {
    vi.useFakeTimers();
    studentSession = null;
    render(<App startInWorkspace onAccountDashboard={vi.fn()} />);
    for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
    const reads = () => fetchMock.mock.calls.filter(([path]) => String(path) === '/api/student/session').length;
    expect(reads()).toBe(1);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    expect(reads()).toBe(1);
    visibility.mockReturnValue('visible');
    for (const event of ['focus', 'pageshow', 'visibilitychange', 'focus', 'pageshow']) {
      await act(async () => { fireEvent(event === 'visibilitychange' ? document : window, new Event(event)); });
    }
    expect(reads()).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(INSTITUTIONAL_RESUME_COOLDOWN_MS - 1); });
    await act(async () => { fireEvent.focus(window); });
    expect(reads()).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); fireEvent.focus(window); });
    expect(reads()).toBe(3);
    expect(screen.getByRole('link', { name: 'CUNY Login' })).toBeVisible();
  });

  it('keeps a paused institutional workspace isolated when the account changes during grant refresh', async () => {
    vi.useFakeTimers();
    const project = makeMapProject(); project.stage = 0;
    const accountA = useAccountStorage('synthetic-session-account-a');
    accountA.setItem(STORAGE_KEY, serializeProject(project));
    let reads = 0, finishRefresh, checkedCache;
    fetchMock.mockImplementation((path, options) => {
      if (String(path) !== '/api/student/session') return defaultFetch(path, options);
      if (++reads === 1) return jsonResponse({ access: grantedAccess(60_000) });
      checkedCache = new Headers(options.headers).get('x-systems-account-cache');
      return new Promise(resolve => { finishRefresh = () => resolve(jsonResponse({ error: 'Account changed', details: { code: 'account_changed' } }, 409)); });
    });
    render(<App startInWorkspace onAccountDashboard={vi.fn()} />);
    for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByRole('status')).toHaveTextContent('Checking sign-in');
    expect(checkedCache).toBe('synthetic-session-account-a');
    const accountB = useAccountStorage('synthetic-session-account-b');
    await act(async () => { finishRefresh(); });
    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in check unavailable');
    expect(screen.queryByRole('textbox', { name: /^Memo/ })).not.toBeInTheDocument();
    expect(JSON.parse(accountA.getItem(STORAGE_KEY))).toMatchObject({ id: project.id, graph: project.graph, submission: project.submission });
    expect(accountB.getItem(STORAGE_KEY)).toBeNull();
    expect(reads).toBe(2);
    await act(async () => { fireEvent.focus(window); });
    expect(checkedCache).toBe('synthetic-session-account-a');
    await act(async () => { finishRefresh(); });
    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in check unavailable');
    expect(accountB.getItem(STORAGE_KEY)).toBeNull();
    expect(reads).toBe(3);
  });

  it('ignores an older prototype 401 after an institutional grant has been refreshed', async () => {
    vi.useFakeTimers();
    seedProject(createDefaultProject());
    let reads = 0;
    studentSession = () => { reads += 1; return grantedAccess(60_000); };
    render(<App startInWorkspace onAccountDashboard={vi.fn()} />);
    for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
    const pending = [];
    prototypeResponder = () => new Promise(resolve => { pending.push(resolve); });
    fireEvent.click(screen.getByRole('button', { name: 'Memo review' }));
    expect(pending.length).toBeGreaterThan(0);
    const staleEvents = [...pending];
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(reads).toBe(2);
    await act(async () => { staleEvents.forEach(resolve => resolve(jsonResponse({ error: 'Old sign-in failure' }, 401))); });
    expect(screen.getByRole('heading', { name: 'Memo review' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'CUNY Login' })).not.toBeInTheDocument();
    expect(reads).toBe(2);
  });

  it('flushes an institutional draft at expiry before offering CUNY Login without resetting prior work', async () => {
    vi.useFakeTimers();
    const project = makeMapProject();
    project.stage = 0;
    seedProject(project);
    studentSession = grantedAccess(60_000);
    render(<App startInWorkspace onAccountDashboard={vi.fn()} />);
    for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
    act(() => vi.advanceTimersByTime(59_800));
    const revisedMemo = `${project.submission.text}\nA new memo detail remains in the recovery copy`;
    fireEvent.change(screen.getByRole('textbox', { name: /^Memo/ }), { target: { value: revisedMemo } });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByRole('alert')).toHaveTextContent('Use CUNY Login to continue');
    expect(screen.getByRole('link', { name: 'CUNY Login' })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Class code' })).not.toBeInTheDocument();
    expect(storedProject()).toMatchObject({ id: project.id, stage: 0, graph: project.graph, submission: project.submission, part2Submission: { text: revisedMemo } });
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/student/session')).toHaveLength(2);
  });

  it('returns institutional users to CUNY Login after a prototype 401 and a missing server session', async () => {
    seedProject(createDefaultProject());
    let reads = 0;
    studentSession = () => ++reads === 1 ? grantedAccess() : null;
    prototypeResponder = () => jsonResponse({ error: 'Sign-in ended' }, 401);
    render(<App startInWorkspace onAccountDashboard={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Memo' });
    fireEvent.click(screen.getByRole('button', { name: 'Memo review' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Use CUNY Login to continue');
    expect(screen.getByRole('link', { name: 'CUNY Login' })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Class code' })).not.toBeInTheDocument();
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(storedProject().submission.text).toBe(createDefaultProject().submission.text);
  });

  it.each(['node', 'edge', 'map'])('preserves a pending institutional %s annotation before sign-in expires', async (target) => {
    vi.useFakeTimers();
    const legacy = makeMapProject(); legacy.mapAnnotation.text = 'A saved map note.';
    const project = seedProject(legacy);
    studentSession = grantedAccess(60_000);
    render(<App startInWorkspace onAccountDashboard={vi.fn()} />);
    for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
    act(() => vi.advanceTimersByTime(59_800));
    const field = selectAnnotationTarget(target);
    const note = `Pending ${target} note for recovery`;
    fireEvent.change(field, { target: { value: note } });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByRole('alert')).toHaveTextContent('Use CUNY Login to continue');
    expect(storedAnnotation(target, project)).toBe(note);
    expect(storedProject().graph.nodes.map(({ id }) => id)).toEqual(project.graph.nodes.map(({ id }) => id));
    expect(storedProject().graph.edges.map(({ id }) => id)).toEqual(project.graph.edges.map(({ id }) => id));
    expect(storedProject().stage).toBe(target === 'map' ? 4 : project.stage);
  });

  it('bounds institutional guidance auth revalidation and allows outage recovery without class codes', async () => {
    vi.useFakeTimers();
    const project = seedProject(createDefaultProject());
    project.stage = 1;
    seedProject(project);
    let reads = 0;
    fetchMock.mockImplementation((path, options) => {
      if (String(path) === '/api/cloud/guidance-jobs') return jsonResponse({ error: 'Sign-in ended' }, 401);
      if (String(path) === '/api/student/session' && ++reads === 2) return new Promise(() => {});
      return defaultFetch(path, options);
    });
    preflightEvaluationResponder = () => jsonResponse({ error: 'Sign-in ended' }, 401);
    render(<App startInWorkspace onAccountDashboard={vi.fn()} />);
    for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(INSTITUTIONAL_SESSION_TIMEOUT_MS); });
    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in check unavailable');
    expect(screen.queryByRole('textbox', { name: 'Class code' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Reading memo/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('heading', { name: 'Memo review' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Generate guidance' })).not.toBeDisabled();
    expect(storedProject()).toMatchObject({ id: project.id, stage: 1, submission: project.submission });
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/cloud/guidance-jobs')).toHaveLength(1);
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
    expect(within(screen.getByRole('article', { name: 'NYC systems and assets map' })).getByText(/Micro-level/)).toBeVisible();
    expect(screen.queryByText(/instructor reviews submitted work/i)).not.toBeInTheDocument();
    const request = fetchMock.mock.calls.find(([path]) => String(path) === '/api/student/access');
    expect(JSON.parse(request[1].body)).toEqual({ code: hostedCode });
    openProjectFromList('NYC systems and assets map');
    fireEvent.click(screen.getByRole('button', { name: 'Memo review' }));
    expect(screen.getByRole('heading', { name: 'Memo review' })).toBeVisible();
    expect(screen.queryByText(/STEM Splitter|class server keeps each request|project stays on this device/i)).not.toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 750)); });
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Generate guidance' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continue →' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Model setup' })).not.toBeInTheDocument();
  });

  it('reuses unchanged validated guidance and invalidates reuse when the memo changes', async () => {
    const project = createDefaultProject();
    project.stage = 1; project.furthestStage = 1;
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    await screen.findByText('Update suggestions');
    openDetails('.notebook-refresh');
    fireEvent.click(screen.getByRole('button', { name: 'Reread memo' }));
    await waitFor(() => expect(document.querySelector('.review-details')).toBeInTheDocument());
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/preflight/evaluations')).toHaveLength(1);
    const drawer = document.querySelector('.memo-drawer');
    fireEvent.click(drawer.querySelector('summary'));
    fireEvent.change(within(drawer).getByRole('textbox', { name: /^Memo/ }), { target: { value: project.submission.text + ' Another family requests advice.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reread memo' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([path]) => path === '/api/preflight/evaluations')).toHaveLength(2));
  });

  it.each([['micro', 'meso'], ['meso', 'exosphere'], ['exosphere', 'macrosphere']])(
    'reuses the %s response at %s only until the saved Field Notes change',
    async (previousScale, activeScale) => {
      const project = makeRevisionProject(activeScale);
      const original = 'I noticed a possible delay while mapping.\nCould the existing settings help investigate it next? I plan to ask the resident.';
      const revised = original + '\nCorrection: I have not observed a delay; first ask whether reminders arrive.';
      project.stage = project.levelProgress[activeScale].stage = 1;
      project.reflection = project.levelProgress[activeScale].reflection = '';
      project.levelProgress[previousScale].reflection = original;
      project.preflight = null;
      const graphBefore = structuredClone(project.graph);
      const completedReadCount = () => storedProject().events.filter(event => event.action === 'preflight.completed').length;
      const requests = () => fetchMock.mock.calls.filter(([path]) => path === '/api/preflight/evaluations');
      preflightEvaluationResponder = body => jsonResponse({ evaluation: evaluationRecord(body, { review: {
        guidance: [{ point: body.fieldNotes.text === revised ? 'Ask whether reminders arrive before claiming a delay' : 'Investigate the possible delay without assuming it occurred' }],
        nodes: [], connections: [], example: null, readiness: { ready: false, note: 'The question needs evidence' },
      } }) }, 201);
      await resumeSavedProject(project);
      fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
      await waitFor(() => expect(storedProject().preflight?.memoReview.guidance[0].point).toContain('possible delay'));
      const firstReadCount = completedReadCount();
      openDetails('.notebook-refresh');
      fireEvent.click(screen.getByRole('button', { name: 'Reread memo' }));
      await waitFor(() => expect(completedReadCount()).toBe(firstReadCount + 1));
      expect(requests()).toHaveLength(1);
      expect(storedProject().graph).toEqual(graphBefore);
      expect(storedProject().levelProgress[previousScale].reflection).toBe(original);

      fireEvent.change(screen.getByRole('combobox', { name: 'Work level' }), { target: { value: previousScale } });
      openNotebookSection('review');
      fireEvent.change(screen.getByRole('textbox', { name: /Field notes/ }), { target: { value: revised } });
      fireEvent.change(screen.getByRole('combobox', { name: 'Work level' }), { target: { value: activeScale } });
      openNotebookSection('suggestions');
      fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
      await waitFor(() => expect(storedProject().preflight?.memoReview.guidance[0].point).toContain('before claiming a delay'));
      expect(requests()).toHaveLength(2);
      expect(requests().map(([, options]) => JSON.parse(options.body).fieldNotes.text)).toEqual([original, revised]);
      expect(requests().map(([, options]) => JSON.parse(options.body).sourceMaterial)).toEqual([project.submission.text, project.submission.text]);
      expect(storedProject().graph).toEqual(graphBefore);
      expect(storedProject().levelProgress[previousScale].reflection).toBe(revised);
    },
  );

  it('sends explicit choices forward and preserves revised labels and removals after a selective response', async () => {
    const project = projectWithMemoReview();
    await resumeSavedProject(project);
    fireEvent.click(memoNextAction());
    const nodeLabels = () => screen.getAllByRole('textbox', { name: 'Node label' });
    fireEvent.change(nodeLabels()[0], { target: { value: 'Neighborhood school' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    fireEvent.click(within(nodeLabels()[0].closest('article')).getByRole('button', { name: 'Add to map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next suggestion' }));
    expect(nodeLabels()[0]).toHaveValue('Committee');
    fireEvent.click(within(nodeLabels()[0].closest('article')).getByRole('button', { name: 'Remove' }));
    preflightEvaluationResponder = body => jsonResponse({ evaluation: evaluationRecord(body, { review: {
      guidance: [{ point: 'Check the new item against the memo' }],
      nodes: [{ label: 'Caregiver', type: 'role', scale: 'micro', evidence: 'A family requests an evaluation' }],
      connections: [], example: null, readiness: { ready: true, note: 'Ready' },
    } }) }, 201);
    openDetails('.notebook-refresh');
    fireEvent.click(screen.getByRole('button', { name: 'Reread memo' }));
    await waitFor(() => {
      const result = storedProject().preflight.memoReview.nodes.map(item => item.label);
      expect(result, [...document.querySelectorAll('[role="status"]')].map(item => item.textContent).join(' | ')).toEqual(['Caregiver']);
    });
    await waitFor(() => expect(storedProject().candidates.nodes.map((item) => item.label)).toContain('Caregiver'));
    const request = fetchMock.mock.calls.find(([path]) => path === '/api/preflight/evaluations');
    expect(JSON.parse(request[1].body).studentJudgments).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Neighborhood school', decision: 'added' }),
      expect.objectContaining({ label: 'Committee', decision: 'removed' }),
    ]));
    await waitFor(() => {
      const choices = storedProject().candidates.nodes;
      expect(choices.find(item => item.label === 'Neighborhood school')).toMatchObject({ reviewDecision: 'added' });
      expect(choices.find(item => item.label === 'Committee')).toMatchObject({ reviewDecision: 'removed' });
    });
  });

  it.each([true, false])('preserves pending and decided suggestions and the map after a feedback-only reread (confirmation=%s)', async requireConfirmation => {
    const project = projectWithMemoReview();
    project.preflight.memoReview.nodes.push({ label: 'Caregiver', type: 'role', scale: 'micro', evidence: 'A family requests an evaluation.' });
    await resumeSavedProject(project);
    fireEvent.click(memoNextAction());
    await waitFor(() => expect(storedProject().candidates.nodes).toHaveLength(3));
    const currentCard = () => screen.getByRole('textbox', { name: 'Node label' }).closest('article');
    fireEvent.click(within(currentCard()).getByRole('button', { name: 'Add to map' }));
    await waitFor(() => expect(storedProject().candidates.nodes[0].reviewDecision).toBe('added'));
    fireEvent.click(screen.getByRole('button', { name: 'Next suggestion' }));
    fireEvent.click(within(currentCard()).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(storedProject().candidates.nodes[1].reviewDecision).toBe('removed'));
    const saved = storedProject();
    expect(saved.stage).toBeGreaterThanOrEqual(2);
    expect(saved.candidates.nodes.map(item => item.reviewDecision)).toEqual(['added', 'removed', 'pending']);
    saved.instructor.requireStudentConfirmation = requireConfirmation;
    const graphBefore = structuredClone(saved.graph);
    const candidatesBefore = structuredClone(saved.candidates);
    cleanup();
    preflightEvaluationResponder = body => jsonResponse({ evaluation: evaluationRecord(body, {
      review: { guidance: [{ point: 'Check which support the caregiver provides.' }], nodes: [], connections: [], example: null,
        readiness: { ready: false, note: 'Some suggestions could not be checked.' } },
      runtime: { provider: 'cail-gateway', model: 'synthetic-test', createdAt: '2027-01-15T08:00:00.000Z', correctiveRetries: 1, feedbackOnly: true },
    }) }, 201);
    await resumeSavedProject(saved);
    openDetails('.notebook-refresh');
    fireEvent.click(screen.getByRole('button', { name: 'Reread memo' }));
    await waitFor(() => expect(storedProject().preflight?.evaluation?.runtime?.feedbackOnly).toBe(true));
    expect(screen.getByText(/^The app could not use its map suggestions/i)).toBeVisible();
    expect(storedProject().candidates).toEqual(candidatesBefore);
    expect(storedProject().graph).toEqual(graphBefore);
  });

  it.each([true, false])('can advance after an initial feedback-only review without inventing map items (confirmation=%s)', async requireConfirmation => {
    const project = createDefaultProject();
    project.stage = 1; project.furthestStage = 1;
    project.instructor.requireStudentConfirmation = requireConfirmation;
    preflightEvaluationResponder = body => jsonResponse({ evaluation: evaluationRecord(body, {
      review: { guidance: [{ point: 'What evidence supports the described contact?' }], nodes: [], connections: [], example: null,
        readiness: { ready: false, note: 'Some suggestions could not be checked.' } },
      runtime: { provider: 'cail-gateway', model: 'synthetic-test', createdAt: '2027-01-15T08:00:00.000Z', correctiveRetries: 1, feedbackOnly: true },
    }) }, 201);
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    await waitFor(() => expect(storedProject().preflight?.evaluation?.runtime?.feedbackOnly).toBe(true));
    expect(screen.getByText(/^The app could not use its map suggestions/i)).toBeVisible();
    fireEvent.click(memoNextAction());
    await waitFor(() => expect(storedProject().stage).toBeGreaterThanOrEqual(2));
    expect(storedProject().graph).toEqual({ nodes: [], edges: [] });
    expect(storedProject().candidates).toEqual({ nodes: [], edges: [] });
  });


  it('starts a blank project only after a granted session and explicit start action', async () => {
    render(<App />);
    await showResumeScreen();
    expect(screen.getByRole('heading', { name: 'Start your first map' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Memo' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start new project' }));
    expect(await screen.findByRole('heading', { name: 'Memo' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Project title' })).toHaveValue('Untitled systems map');
    await waitFor(() => expect(storedProject()).toMatchObject({ title: 'Untitled systems map', stage: 0 }));
  });

  it('starts a new project without deleting the saved project and can reopen the earlier work', async () => {
    const earlierProject = createDefaultProject();
    earlierProject.title = 'East Harlem disability resources';
    earlierProject.submission.title = 'Rosa access memo';
    earlierProject.submission.text = 'Rosa coordinates appointments with her family, home attendant, peer group, and benefits counselor.';
    seedProject(earlierProject);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeVisible();
    const earlierProjectCard = screen.getByRole('article', { name: earlierProject.title });
    expect(within(earlierProjectCard).getByRole('button', { name: 'Open project' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    expect(screen.queryByRole('dialog', { name: 'Start new project?' })).not.toBeInTheDocument();

    expect(await screen.findByRole('heading', { name: 'Memo' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Project title' })).toHaveValue('Untitled systems map');
    expect(screen.getByRole('textbox', { name: /^Memo/ })).toHaveValue('');

    openProjectMenu('Projects');
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByRole('article', { name: 'Untitled systems map' })).toBeVisible();

    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, PERSIST_DEBOUNCE_MS + 30)); });
    cleanup();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(2);

    const savedEarlierProject = screen.getByRole('article', { name: earlierProject.title });
    fireEvent.click(within(savedEarlierProject).getByRole('button', { name: 'Open project' }));

    expect(await screen.findByRole('heading', { name: 'Memo' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Project title' })).toHaveValue(earlierProject.title);
    expect(screen.getByRole('textbox', { name: /^Memo/ })).toHaveValue(earlierProject.submission.text);
  });

  it('offers a legacy singleton project from the project list before migrating it to current storage', async () => {
    const legacy = createDefaultProject();
    legacy.schemaVersion = 5;
    legacy.title = 'Legacy East Harlem map';
    legacy.submission.text = 'A legacy memo that must remain available.';
    delete legacy.participantName;
    window.localStorage.setItem(LEGACY_V5_STORAGE_KEY, JSON.stringify(legacy));

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeVisible();
    const legacyProjectCard = screen.getByRole('article', { name: legacy.title });
    fireEvent.click(within(legacyProjectCard).getByRole('button', { name: 'Open project' }));
    expect(await screen.findByRole('heading', { name: 'Memo' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Project title' })).toHaveValue(legacy.title);
    expect(screen.getByRole('textbox', { name: /^Memo/ })).toHaveValue(legacy.submission.text);
    await waitFor(() => expect(storedProject()).toMatchObject({ schemaVersion: 10, title: legacy.title, participantName: '' }));
  });

  it('loads the v5 browser workspace as legacy data and persists it under the v6 key', async () => {
    const legacy = createDefaultProject();
    legacy.schemaVersion = 5;
    delete legacy.participantName;
    window.localStorage.setItem(LEGACY_V5_STORAGE_KEY, JSON.stringify(legacy));

    render(<App />);
    await showResumeScreen();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    openProjectFromList(legacy.title);
    expect(await screen.findByRole('heading', { name: 'Memo' })).toBeVisible();
    await waitFor(() => expect(storedProject()).toMatchObject({ schemaVersion: 10, participantName: '' }));
  });

  it('expires an ISO-timestamped class grant at the exact fake-clock boundary without erasing local project bytes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T16:00:00.000Z'));
    const project = seedProject(createDefaultProject());
    const priorBytes = window.localStorage.getItem(STORAGE_KEY);
    studentSession = { expiresAt: '2026-08-08T16:01:00.000Z' };

    render(<App />);
    for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeVisible();
    openProjectFromList(project.title);
    expect(screen.getByRole('heading', { name: 'Memo' })).toBeVisible();

    act(() => vi.advanceTimersByTime(59_999));
    expect(screen.getByRole('heading', { name: 'Memo' })).toBeVisible();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('heading', { name: 'Systems Mapping' })).toBeVisible();
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
    const project = createDefaultProject();
    project.instructor.requireStudentConfirmation = true;
    await resumeSavedProject(project);
    fireEvent.click(screen.getByText('Project details', { selector: 'summary' }));
    expect(screen.getByRole('heading', { name: 'Memo' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Project title' })).toHaveValue('NYC systems and assets map');
    expect(screen.getByRole('textbox', { name: 'Name or Group Name' })).toHaveValue('');
    expect(screen.queryByRole('textbox', { name: /^Person or group/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /^Question/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /^Time period/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /^What to include/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Project title' }), { target: { value: 'Family service access map' } });
    expect(screen.getByRole('textbox', { name: 'Project title' })).toHaveValue('Family service access map');
    expect(screen.queryByRole('textbox', { name: 'Guiding inquiry' })).not.toBeInTheDocument();
    const memo = screen.getByRole('textbox', { name: /^Memo/ });
    expect(memo).toBeVisible();
    const memoWordCount = memo.value.trim().split(/\s+/).filter(Boolean).length;
    expect(memo.closest('label')).toHaveTextContent(`${memoWordCount} words`);
    fireEvent.click(screen.getByRole('button', { name: 'Memo review' }));
    expect(screen.getByRole('heading', { name: 'Memo review' })).toBeVisible();
    openProjectMenu('Progress');
    const stageMenu = screen.getByRole('dialog', { name: 'Progress' });
    ['Add memo', 'Memo review', 'Choose elements', 'Build map', 'Review and export'].forEach((label) => expect(within(stageMenu).getByText(label)).toBeVisible());
    within(stageMenu).getAllByRole('button').filter((button) => button.textContent !== 'Close').forEach((button) => expect(button).toBeEnabled());
    fireEvent.click(within(stageMenu).getByRole('button', { name: 'Close Progress' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    await screen.findByText('Guidance and evidence');
    const guidance = document.querySelector('.review-details');
    expect(guidance).toHaveAttribute('open');
    expect(guidance.querySelectorAll('.studio-feedback')).toHaveLength(2);
    expect(within(guidance).getByText('The memo grounds the referral in a specific handoff.')).toBeVisible();
    expect(within(guidance).getByText('Where does the delay enter the referral process?')).toBeVisible();
    fireEvent.click(within(guidance).getByText('Guidance and evidence'));
    expect(guidance).not.toHaveAttribute('open');
    expect(within(guidance).getByText('Where does the delay enter the referral process?')).not.toBeVisible();
    fireEvent.click(within(guidance).getByText('Guidance and evidence'));
    expect(within(guidance).getByText('Where does the delay enter the referral process?')).toBeVisible();
    expect(screen.queryByText('2 items · 1 connection')).not.toBeInTheDocument();
    expect(within(guidance).queryByText('School', { selector: 'strong' })).not.toBeInTheDocument();
    expect(within(guidance).queryByText('Committee', { selector: 'strong' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Suggestions' })).not.toBeInTheDocument();
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

  it('shows feedback-only guidance and its retry notice after a reload without changing saved map work', async () => {
    const project = makeMapProject('micro');
    project.stage = 1;
    project.furthestStage = 1;
    const originalGraph = structuredClone(project.graph);
    preflightEvaluationResponder = vi.fn(body => {
      const review = { guidance: [{ point: 'What evidence shows which families use the service?' }], nodes: [], connections: [], example: null,
        readiness: { ready: false, note: 'Map suggestions could not be returned.' } };
      const evaluation = evaluationRecord(body, { review });
      evaluation.runtime.feedbackOnly = true;
      return jsonResponse({ evaluation }, 201);
    });
    seedProject(project);
    const view = render(<App startInWorkspace />);
    await screen.findByRole('heading', { name: 'Memo review' });
    // The workspace refreshes its course settings on open. Wait until that
    // state is saved so the request key cannot change during this test's read.
    await waitFor(() => expect(storedProject().teacherGovernance?.preflight?.fingerprint).toBe('preflight-shared-fingerprint'), { timeout: 5000 });
    await waitFor(() => expect(storedProject().teacherGovernance?.builder?.fingerprint).toBe('builder-shared-fingerprint'), { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await screen.findByText('What evidence shows which families use the service?')).toBeVisible();
    const notice = /^The app could not use its map suggestions/;
    expect(screen.getByText(notice)).toBeVisible();
    expect(screen.getByText(notice)).toHaveTextContent('Check the feedback below against your memo and sources.');
    expect(screen.queryByText('No items were suggested. You can add an item yourself or reread the memo.')).not.toBeInTheDocument();
    await waitFor(() => expect(storedProject().preflight?.evaluation?.runtime?.feedbackOnly).toBe(true));
    expect(storedProject().graph).toEqual(originalGraph);
    const retry = document.querySelector('.notebook-refresh');
    fireEvent.click(within(retry).getByText('Update suggestions'));
    fireEvent.click(within(retry).getByRole('button', { name: 'Reread memo' }));
    await waitFor(() => expect(preflightEvaluationResponder).toHaveBeenCalledTimes(2));
    view.unmount();

    render(<App startInWorkspace />);
    expect(await screen.findByText('What evidence shows which families use the service?')).toBeVisible();
    expect(screen.getByText(notice)).toBeVisible();
    expect(storedProject().graph).toEqual(originalGraph);
  });

  it('preserves saved inquiry framing and sends it only after Generate guidance', async () => {
    const project = createDefaultProject();
    project.instructor.requireStudentConfirmation = true;
    project.inquiry = [
      'Focal person or group: Students seeking special-education services',
      'Map question: Where do referral delays emerge?',
      'Time period or episode: The first semester after referral',
      'Map boundary: NYC school and family interactions; clinical treatment is outside scope',
    ].join('\n');
    await resumeSavedProject(project);
    expect(storedProject().inquiry).toBe(project.inquiry);
    fireEvent.click(screen.getByRole('button', { name: 'Memo review' }));
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));

    expect(await memoReviewDetails()).toBeVisible();
    const request = fetchMock.mock.calls.find(([path, options]) => String(path) === '/api/preflight/evaluations' && options.method === 'POST');
    expect(JSON.parse(request[1].body).inquiry).toBe([
      'Focal person or group: Students seeking special-education services',
      'Map question: Where do referral delays emerge?',
      'Time period or episode: The first semester after referral',
      'Map boundary: NYC school and family interactions; clinical treatment is outside scope',
    ].join('\n'));
  });

  it('opens a non-advancing map preview after model guidance and returns to the current memo stage', async () => {
    const project = projectWithMemoReview({ stage: 1, furthestStage: 1 });
    await resumeSavedProject(project);

    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    expect(screen.getByRole('group', { name: /Micro-level map\. 0 nodes/ })).toBeVisible();
    expect(storedProject().stage).toBe(1);
    expect(storedProject().furthestStage).toBe(project.furthestStage);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Workspace', exact: true })).getByRole('button', { name: 'Notebook', exact: true }));
    expect(await screen.findByRole('heading', { name: 'Suggestions' })).toBeVisible();
    expect(storedProject().stage).toBe(1);
    expect(storedProject().furthestStage).toBe(project.furthestStage);
  });

  it('starts every new map at Micro instead of offering a scale picker', async () => {
    await resumeSavedProject(createDefaultProject());

    expect(screen.queryByRole('combobox', { name: 'Level' })).not.toBeInTheDocument();
    expect(screen.getByText(/Set the focus for your map/)).toBeVisible();
    expect(storedProject()).toMatchObject({ activeScale: 'micro', releasedScales: ['micro'], completedScales: [] });
  });

  it('keeps the memo intake limited to fields students need', async () => {
    await resumeSavedProject(createDefaultProject());
    expect(screen.getByRole('textbox', { name: 'Project title' })).not.toBeVisible();
    fireEvent.click(screen.getByText('Project details', { selector: 'summary' }));

    expect(screen.queryByRole('combobox', { name: 'Level' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Project title' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Name or Group Name' })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: /^Person or group/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /^Question/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /^Time period/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /^What to include/ })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^Memo/ })).toBeVisible();
    expect(screen.queryByLabelText('Author or creator')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Type of material')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Where did you find it?')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Rights or intended use')).not.toBeInTheDocument();

    const privacy = screen.getByRole('button', { name: /Privacy/ });
    expect(privacy).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(privacy);
    const sensitive = screen.getByRole('checkbox', { name: 'Includes private information' });
    expect(sensitive).toBeVisible();
    fireEvent.click(sensitive);
    const permission = screen.getByRole('checkbox', { name: 'I have permission to share this information, or I have removed identifying details.' });
    expect(permission).not.toBeChecked();
    fireEvent.click(permission);
    await waitFor(() => expect(storedProject().submission).toMatchObject({ sensitive: true, consent: true }));
    expect(screen.queryByLabelText('Author or creator')).not.toBeInTheDocument();
  });

  it.each([true, false])('keeps the newest concurrent memo import (older finishes first: %s)', async olderFirst => {
    await resumeSavedProject();
    const older = pendingMemoFile('older.txt');
    const newer = pendingMemoFile('newer.txt');
    uploadMemo(older);
    uploadMemo(newer);
    if (olderFirst) await act(async () => older.resolve('Older synthetic memo'));
    await act(async () => newer.resolve('Newer synthetic memo'));
    if (!olderFirst) await act(async () => older.resolve('Older synthetic memo'));
    expect(screen.getByRole('textbox', { name: /^Memo/ })).toHaveValue('Newer synthetic memo');
    await waitFor(() => expect(storedProject().submission.fileName).toBe('newer.txt'));
    expect(storedProject().events.filter(event => event.action === 'memo.imported').map(event => event.detail)).toEqual(['newer.txt']);
  });

  it.each([false, true])('preserves edits during import, including edit-and-revert (%s)', async revert => {
    await resumeSavedProject();
    const box = screen.getByRole('textbox', { name: /^Memo/ });
    const original = box.value;
    const pending = pendingMemoFile();
    uploadMemo(pending);
    fireEvent.change(box, { target: { value: 'A newer synthetic edit' } });
    if (revert) fireEvent.change(box, { target: { value: original } });
    await act(async () => pending.resolve('Stale imported memo'));
    expect(box).toHaveValue(revert ? original : 'A newer synthetic edit');
    expect(screen.queryByText('TXT memo imported.')).not.toBeInTheDocument();
    await waitFor(() => expect(storedProject().submission.text).toBe(box.value));
    expect(storedProject().events.some(event => event.action === 'memo.imported')).toBe(false);
  });

  it('discards an import after leaving intake and reopening the same project', async () => {
    const project = await resumeSavedProject();
    const pending = pendingMemoFile();
    uploadMemo(pending);
    openProjectMenu('Projects');
    await showResumeScreen();
    openProjectFromList(project.title);
    await screen.findByRole('textbox', { name: /^Memo/ });
    await act(async () => pending.resolve('Stale import after navigation'));
    expect(screen.getByRole('textbox', { name: /^Memo/ })).toHaveValue(project.submission.text);
    expect(screen.queryByText('TXT memo imported.')).not.toBeInTheDocument();
  });

  it('never imports into another project after navigation', async () => {
    const project = await resumeSavedProject();
    const pending = pendingMemoFile();
    uploadMemo(pending);
    openProjectMenu('Projects');
    await showResumeScreen();
    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    await screen.findByRole('textbox', { name: /^Memo/ });
    const original = screen.getByRole('textbox', { name: /^Memo/ }).value;
    await act(async () => pending.resolve('Stale import for a different project'));
    expect(screen.getByRole('textbox', { name: /^Memo/ })).toHaveValue(original);
    expect(storedProject().id).not.toBe(project.id);
    expect(screen.queryByText('TXT memo imported.')).not.toBeInTheDocument();
  });

  it.each(['error', 'empty'])('ignores an older import %s after a newer success', async outcome => {
    await resumeSavedProject();
    const older = pendingMemoFile('older.txt');
    const newer = pendingMemoFile('newer.txt');
    uploadMemo(older);
    uploadMemo(newer);
    await act(async () => newer.resolve('Newer memo text'));
    await act(async () => outcome === 'error' ? older.reject(new Error('synthetic failure')) : older.resolve(''));
    expect(screen.getByRole('textbox', { name: /^Memo/ })).toHaveValue('Newer memo text');
    expect(document.querySelector('p.privacy-note[role=status]')).toHaveTextContent('TXT memo imported.');
    expect(screen.queryByText(/could not be imported/)).not.toBeInTheDocument();
  });

  it('allows selecting the same file again while its first reader is pending', async () => {
    await resumeSavedProject();
    const first = pendingMemoFile();
    const second = pendingMemoFile();
    uploadMemo(first);
    uploadMemo(second);
    await act(async () => second.resolve('Second read of the same file'));
    await act(async () => first.resolve('First stale read'));
    expect(screen.getByRole('textbox', { name: /^Memo/ })).toHaveValue('Second read of the same file');
  });

  it('discards an import when institutional access expires', async () => {
    vi.useFakeTimers();
    const project = seedProject(createDefaultProject());
    studentSession = grantedAccess(1000);
    render(<App startInWorkspace onAccountDashboard={vi.fn()} />);
    for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
    const pending = pendingMemoFile();
    uploadMemo(pending);
    act(() => vi.advanceTimersByTime(1100));
    await act(async () => pending.resolve('Import from expired access'));
    expect(screen.getByRole('link', { name: 'CUNY Login' })).toBeVisible();
    expect(storedProject().submission.text).toBe(project.submission.text);
    expect(storedProject().events.some(event => event.action === 'memo.imported')).toBe(false);
    expect(screen.queryByText('TXT memo imported.')).not.toBeInTheDocument();
  });

  it('commits a memo import once under Strict Mode and announces the committed result', async () => {
    const project = seedProject(createDefaultProject());
    render(<React.StrictMode><App /></React.StrictMode>);
    await showResumeScreen();
    openProjectFromList(project.title);
    await screen.findByRole('textbox', { name: /^Memo/ });
    const pending = pendingMemoFile();
    uploadMemo(pending);
    await act(async () => pending.resolve('A synthetic Strict Mode import'));
    expect(document.querySelector('p.privacy-note[role=status]')).toHaveTextContent('TXT memo imported.');
    await waitFor(() => expect(storedProject().submission.text).toBe('A synthetic Strict Mode import'));
    expect(storedProject().events.filter(event => event.action === 'memo.imported')).toHaveLength(1);
  });

  it('labels the compact memo fork on hover and focus without changing its confirmation', async () => {
    const project = makeMapProject('micro');
    project.stage = 0;
    await resumeSavedProject(project);
    const fork = screen.getByRole('button', { name: 'New map from this memo' });
    expect(fork).toHaveClass('memo-fork__button');
    expect(fork).toHaveTextContent('');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.pointerEnter(fork.parentElement, { pointerType: 'mouse' });
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('New map from this memo');
    expect(fork).toHaveAttribute('aria-describedby', tooltip.id);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.pointerLeave(fork.parentElement);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.focus(fork);
    expect(screen.getByRole('tooltip')).toHaveTextContent('New map from this memo');
    fireEvent.keyDown(fork, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(fork).not.toHaveAttribute('aria-describedby');
    fireEvent.blur(fork);
    fireEvent.focus(fork);
    expect(screen.getByRole('tooltip')).toBeVisible();

    fireEvent.click(fork);
    const dialog = screen.getByRole('dialog', { name: 'Start new map from this memo?' });
    expect(dialog).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(storedProject().id).toBe(project.id);
    expect(storedProject().graph).toEqual(project.graph);
  });

  it('preserves prior work on memo edits and starts a separate map only after explicit confirmation', async () => {
    const project = makeMapProject('micro');
    project.stage = 1;
    project.furthestStage = 4;
    project.preflight = null;
    const previousGraph = structuredClone(project.graph);
    const previousEvents = structuredClone(project.events);
    const inquiry = project.inquiry;
    await resumeSavedProject(project);

    const revisedMemo = 'A corrected memo changes the evidence while remaining part of the same systems map progression.';
    fireEvent.change(screen.getByRole('textbox', { name: /^Memo/ }), { target: { value: revisedMemo } });

    await waitFor(() => expect(storedProject()).toMatchObject({
      activeScale: 'micro', stage: 1, furthestStage: 4, graph: previousGraph,
      submission: expect.objectContaining({ text: revisedMemo }),
    }));
    expect(storedProject().events).toEqual(previousEvents);

    fireEvent.click(screen.getByRole('button', { name: 'New map from this memo' }));
    const dialog = screen.getByRole('dialog', { name: 'Start new map from this memo?' });
    expect(within(dialog).getByText(/creates a new project at Micro with the same memo and framing/i)).toBeVisible();
    expect(within(dialog).getByText(/current project stays saved in Projects/i)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(storedProject().graph).toEqual(previousGraph);

    fireEvent.click(screen.getByRole('button', { name: 'New map from this memo' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Start new map from this memo?' })).getByRole('button', { name: 'Start new map' }));
    await waitFor(() => expect(storedProject()).toMatchObject({
      activeScale: 'micro', releasedScales: ['micro'], completedScales: [], stage: 0, furthestStage: 0,
      preflight: null, candidates: { nodes: [], edges: [] }, graph: { nodes: [], edges: [] },
      inquiry, submission: expect.objectContaining({ text: revisedMemo }),
    }));
    expect(storedProject().id).not.toBe(project.id);
    expect(storedProject().configs).toEqual(project.configs);
    expect(storedProject().events).toHaveLength(2);
    expect(storedProject().events[0]).toMatchObject({ action: 'project.created', detail: 'Started a new map from an existing memo' });
    expect(storedProject().events.at(-1)).toMatchObject({ action: 'map.restarted' });
    expect(await screen.findByRole('heading', { name: 'Memo' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Memo review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(screen.queryByRole('option', { name: 'Map notes' })).not.toBeInTheDocument();
    expect(storedProject().preflight).toBeNull();
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(0);

    openProjectMenu('Projects');
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeVisible();
    expect(screen.getByRole('article', { name: project.title })).toBeVisible();
    expect(screen.getByRole('article', { name: `${project.title} — new map` })).toBeVisible();
    openProjectFromList(project.title);
    await waitFor(() => expect(storedProject().id).toBe(project.id));
    expect(storedProject().graph).toEqual(previousGraph);
    expect(storedProject().events).toEqual(previousEvents);
    expect(storedProject().submission.text).toBe(revisedMemo);
  });

  it('preserves Meso relationships while reviewing Micro Field Notes', async () => {
    const project = makeRevisionProject('micro');
    project.graph = makeMapProject('meso').graph;
    project.releasedScales = ['micro', 'meso'];
    const graphBefore = structuredClone(project.graph);
    const meso = graphForScale(project, 'meso');
    expect(graphForScale(project, 'micro').edges).toEqual([]);
    expect(graphBefore.edges.some((edge) => edge.scale === 'meso')).toBe(true);

    await resumeSavedProject(project);
    expect(screen.getByRole('textbox', { name: 'Field notes (required)' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /Field notes/ })).toBeVisible();

    expect(screen.queryByLabelText('Current Micro-level map summary')).not.toBeInTheDocument();
    expect(storedProject().graph.edges.filter(edge => edge.scale === 'meso')).toHaveLength(meso.edges.length);
    expect(document.querySelector('.release-summary')).toBeNull();
    expect(storedProject().graph).toEqual(graphBefore);
  });

  it('refreshes a published scale question even when model fingerprints match, preserving the answer', async () => {
    const project = makeRevisionProject('micro');
    const previousAnswer = project.reflection;
    project.teacherGovernance = {
      preflight: { ...publicConfiguration('/api/config/public?configKind=preflight&scale=micro'), fieldNotesQuestions: DEFAULT_FIELD_NOTES_QUESTIONS },
      builder: { ...publicConfiguration('/api/config/public?configKind=builder&scale=micro'), fieldNotesQuestions: DEFAULT_FIELD_NOTES_QUESTIONS },
      refreshedAt: new Date().toISOString(),
    };
    const questions = { ...DEFAULT_FIELD_NOTES_QUESTIONS, micro: 'Whose direct relationships are missing from this setting?' };
    publicConfigurationResponder = path => jsonResponse({ ...publicConfiguration(path), fieldNotesQuestions: questions });
    await resumeSavedProject(project);
    expect(await screen.findByText(questions.micro)).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Field notes (required)' })).toHaveValue(previousAnswer);
    await waitFor(() => expect(storedProject().teacherGovernance.preflight.fieldNotesQuestions).toEqual(questions));
    expect(storedProject().levelProgress.micro.reflection).toBe(previousAnswer);
  });

  it('keeps the next step available from the map and explains required Field Notes before advancing', async () => {
    const project = makeMapProject('micro');
    project.stage = project.levelProgress.micro.stage = 3;
    project.reflection = project.levelProgress.micro.reflection = '';
    const graphBefore = structuredClone(project.graph);
    await resumeSavedProject(project);
    const next = screen.getByRole('button', { name: 'Field Notes', exact: true });
    expect(next.closest('.inspector__scroll')).toBeNull();
    expect(next.closest('.notebook-task-end')).toHaveTextContent('Micro-level · Nodes');
    fireEvent.click(next);
    const continueButton = screen.getByRole('button', { name: 'Continue to Meso', exact: true });
    expect(continueButton).toBeDisabled();
    expect(continueButton.closest('.notebook-task-end')).toHaveTextContent('Add Field Notes to continue');
    fireEvent.change(screen.getByRole('textbox', { name: 'Field notes (required)' }), { target: { value: 'Ask who coordinates the handoff between these settings.' } });
    expect(continueButton).toBeEnabled();
    preflightEvaluationResponder = () => new Promise(() => {});
    fireEvent.click(continueButton);
    await waitFor(() => expect(storedProject().activeScale).toBe('meso'));
    expect(storedProject().graph).toEqual(graphBefore);
    expect(storedProject().levelProgress.micro.reflection).toBe('Ask who coordinates the handoff between these settings.');
  });

  it('requires nonblank Field Notes for completion while keeping map navigation available', async () => {
    const project = makeRevisionProject('micro');
    project.reflection = project.levelProgress.micro.reflection = '';
    await resumeSavedProject(project);
    const continueButton = workActions().getByRole('button', { name: 'Continue to Meso' });
    expect(continueButton).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Field notes (required)' }), { target: { value: '  \n ' } });
    expect(continueButton).toBeDisabled();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Workspace' })).getByRole('button', { name: 'Map', exact: true }));
    expect(mapCanvas()).toBeVisible();
    workActions();
    fireEvent.change(screen.getByRole('textbox', { name: 'Field notes (required)' }), { target: { value: 'Ask the attendant about the missing home–clinic handoff.' } });
    expect(workActions().getByRole('button', { name: 'Continue to Meso' })).toBeEnabled();
  });

  it('supports a final Macrosphere synthesis in one field without losing earlier notes', async () => {
    const project = makeRevisionProject('macrosphere');
    const existing = 'Strongest claim: The memo names the handoff.\nMissing perspectives or limits: Ask the resident.';
    project.reflection = existing;
    project.levelProgress.macrosphere.reflection = existing;
    await resumeSavedProject(project);
    const field = screen.getByRole('textbox', { name: /Field notes/ });
    expect(field).toHaveValue(existing);
    expect(document.querySelectorAll('.reflection-entry textarea')).toHaveLength(1);
    fireEvent.change(field, { target: { value: existing + '\nNext: Verify agency timelines.' } });
    await waitFor(() => expect(storedProject().reflection).toBe(existing + '\nNext: Verify agency timelines.'));
    expect(storedProject().levelProgress.macrosphere.reflection).toBe(existing + '\nNext: Verify agency timelines.');
  });

  it.each([
    ['micro', 'meso', 'Continue to Meso', 'Connect Micro-level settings already on the map'],
    ['meso', 'exosphere', 'Continue to Exo-level', 'Add outside decision settings that affect Micro-level settings'],
    ['exosphere', 'macrosphere', 'Continue to Macro-level', 'Identify broader conditions that affect several map items'],
  ])('completing %s preserves accumulated work and continues at %s', async (activeScale, expectedScale, cta, nextCopy) => {
    const project = makeRevisionProject(activeScale);
    const note = `At ${activeScale}, ask what evidence supports the next map addition. This is a question, not a new memo fact.`;
    project.reflection = note;
    project.levelProgress[activeScale].reflection = note;
    const graphBefore = structuredClone(project.graph);
    const candidatesBefore = structuredClone(project.candidates);
    const releasedBefore = [...project.releasedScales];
    // The next level's memo reading starts in the same click; keep it pending
    // so the saved state at the moment of transition is observable.
    preflightEvaluationResponder = () => new Promise(() => {});
    await resumeSavedProject(project);

    const continueButton = workActions().getByRole('button', { name: cta });
    expect(continueButton).toBeEnabled();
    document.documentElement.scrollTop = 240;
    document.body.scrollTop = 240;
    fireEvent.click(continueButton);

    if (activeScale === 'meso') {
      const review = await screen.findByRole('dialog', { name: 'Review Micro and Meso' });
      expect(storedProject().activeScale).toBe('meso');
      expect(storedProject().graph).toEqual(graphBefore);
      fireEvent.click(within(review).getByRole('button', { name: 'Continue to Exo-level' }));
    }

    // The next level continues directly at Review with its memo reading already
    // under way — the student is never routed back through the intake form.
    await waitFor(() => expect(storedProject()).toMatchObject({
      activeScale: expectedScale,
      stage: 1,
      furthestStage: 4,
      preflight: null,
      reflection: '',
    }));
    if (activeScale === 'meso') {
      expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(0);
      expect(storedProject().part2Submission.text).toBe('');
      fireEvent.change(screen.getByRole('textbox', { name: /^Memo/ }), { target: { value: 'The policy extends our earlier analysis.' } });
      fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    }
    await waitFor(() => expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations').map(([, options]) => JSON.parse(options.body).activeScale)).toEqual([expectedScale]));
    const payload = JSON.parse(fetchMock.mock.calls.find(([path]) => path === '/api/preflight/evaluations')[1].body);
    expect(payload.fieldNotes).toEqual({ scale: activeScale, text: note, truncated: false });
    expect(payload.sourceMaterial).toContain(project.submission.text);
    expect(JSON.stringify(payload.sourceRecord)).not.toContain(note);
    expect(screen.getByRole('button', { name: 'Reading memo…' })).toBeDisabled();
    const stored = storedProject();
    expect(stored.candidates).toEqual(candidatesBefore);
    expect(stored.completedScales).toEqual(expect.arrayContaining([activeScale]));
    expect(stored.graph).toEqual(graphBefore);
    expect(stored.levelProgress[activeScale].reflection).toBe(note);
    expect(stored.releasedScales).toEqual([...releasedBefore, expectedScale]);
    expect(screen.getByRole('heading', { name: 'Memo review' })).toBeVisible();
    const levelLabels = { micro: 'Micro-level', meso: 'Meso-level', exosphere: 'Exo-level', macrosphere: 'Macro-level' };
    expect(screen.getByRole('combobox', { name: 'Work level' })).toHaveValue(expectedScale);
    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.body.scrollTop).toBe(0);
    expect(screen.queryByRole('region', { name: `${levelLabels[expectedScale]} progression` })).not.toBeInTheDocument();
    const handoff = openDetails('.field-notes-continuity');
    expect(within(handoff).getByText(note)).toBeVisible();
  });

  it('preserves a full long note across a failed next review, reload, and back-navigation', async () => {
    const project = makeRevisionProject('exosphere');
    const note = '😀'.repeat(32_000);
    project.reflection = note;
    project.levelProgress.exosphere.reflection = note;
    project.levelProgress.micro.reflection = 'Keep the earlier question reachable.';
    preflightEvaluationResponder = () => jsonResponse({ error: 'Guidance is temporarily unavailable. Try again later.' }, 503);
    await resumeSavedProject(project);
    expect(screen.getByText(/Only the beginning of this note will be sent with your next memo/)).toBeVisible();
    fireEvent.click(workActions().getByRole('button', { name: 'Continue to Macro-level' }));
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeEnabled();
    const calls = fetchMock.mock.calls.filter(([path]) => path === '/api/preflight/evaluations');
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0][1].body).fieldNotes).toEqual(fieldNotesExcerpt('exosphere', note));
    await waitFor(() => expect(storedProject().activeScale).toBe('macrosphere'));
    const saved = storedProject();
    expect(saved.levelProgress.exosphere.reflection).toBe(note);
    expect(saved.graph).toEqual(project.graph);
    const handoff = openDetails('.field-notes-continuity');
    expect(within(handoff).getByText(/Only this opening excerpt accompanies guidance/)).toBeVisible();
    cleanup();
    await resumeSavedProject(parseProject(JSON.stringify(saved)));
    openNotebookSection('review');
    fireEvent.click(screen.getByText('Previous notes'));
    expect(screen.getByText('Keep the earlier question reachable.')).toBeVisible();
    expect(document.querySelector('.field-notes-archive').textContent.includes(note)).toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: 'Work level' }), { target: { value: 'exosphere' } });
    openNotebookSection('review');
    expect(screen.getByRole('textbox', { name: /Field notes/ })).toHaveValue(note);
    expect(screen.getByText(/Only the beginning of this note will be sent with your next memo/)).toBeVisible();
    expect(storedProject().levelProgress.exosphere.reflection).toBe(note);
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/preflight/evaluations')).toHaveLength(1);
  });

  it('shows the Micro-level review without a redundant progression panel', async () => {
    const project = makeMapProject('micro');
    project.stage = 1;
    project.levelProgress.micro = { stage: 1, reflection: '' };
    project.preflight = null;
    await resumeSavedProject(project);

    expect(screen.getByRole('heading', { name: 'Memo review' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Micro-level progression' })).not.toBeInTheDocument();
  });

  it('completes Macrosphere once and leaves the cumulative project at its terminal review', async () => {
    const project = makeRevisionProject('macrosphere');
    const graphBefore = structuredClone(project.graph);
    const candidatesBefore = structuredClone(project.candidates);
    const preflightBefore = structuredClone(project.preflight);
    const reflectionBefore = project.reflection;
    const releasedBefore = [...project.releasedScales];
    await resumeSavedProject(project);

    const completeButton = workActions().getByRole('button', { name: 'Complete Macro-level' });
    expect(completeButton).toBeEnabled();
    fireEvent.click(completeButton);

    await waitFor(() => expect(storedProject().completedScales).toContain('macrosphere'));
    const stored = storedProject();
    expect(stored).toMatchObject({ activeScale: 'macrosphere', stage: 4, furthestStage: 4 });
    expect(stored.graph).toEqual(graphBefore);
    expect(stored.candidates).toEqual(candidatesBefore);
    expect(stored.preflight).toEqual(preflightBefore);
    expect(stored.reflection).toBe(reflectionBefore);
    expect(stored.releasedScales).toEqual(releasedBefore);
    expect(screen.getByRole('heading', { name: project.title, exact: true })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Return to map', exact: true }));
    expect(workActions().getByRole('button', { name: 'View summary' })).toBeEnabled();
  });

  it('keeps the map and notes open when the completion transaction cannot be saved', async () => {
    const project = makeRevisionProject('macrosphere'); await resumeSavedProject(project);
    const before = structuredClone(storedProject());
    const originalSet = Storage.prototype.setItem;
    const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(key,value) { if (key === STORAGE_KEY) throw new Error('Synthetic quota'); return originalSet.call(this,key,value); });
    fireEvent.click(workActions().getByRole('button', { name: 'Complete Macro-level' }));
    expect(screen.queryByRole('heading', { name: project.title, exact: true })).toBeNull();
    expect(storedProject()).toEqual(before);
    expect(screen.getByRole('textbox', { name: 'Field notes (required)' })).toHaveValue(before.reflection);
    expect(screen.getByText('Completion could not be saved. Your map and Field Notes remain available.')).toBeVisible();
    failure.mockRestore();
  });

  it('revisits a released work level with its matching visible layer while preserving cumulative data', async () => {
    const project = makeMapProject('micro');
    project.activeScale = 'exosphere';
    project.releasedScales = ['micro', 'meso', 'exosphere'];
    const template = project.graph.nodes.find((node) => node.scale === 'micro');
    project.candidates.nodes = [{
      ...structuredClone(template), id: 'node_pending_student_support_setting', label: 'Pending student support setting',
      status: 'pending', claimState: 'inference',
      annotations: {
        analytical: { id: 'annotation_pending_student_support_setting_analytical', text: '' },
        evidence: { id: 'annotation_pending_student_support_setting_evidence', text: '' },
      },
    }];
    const graphBefore = structuredClone(project.graph);
    const candidatesBefore = structuredClone(project.candidates);
    await openMapProject(project);
    const visibleLayer = mapLayer();
    fireEvent.change(visibleLayer, { target: { value: 'exosphere' } });

    expect(screen.queryByRole('button', { name: 'Instructor Console' })).not.toBeInTheDocument();
    const dialog = openWorkLevelMenu();
    fireEvent.change(dialog, { target: { value: 'micro' } });

    await waitFor(() => expect(storedProject()).toMatchObject({ activeScale: 'micro', stage: 3 }));
    expect(storedProject().graph).toEqual(graphBefore);
    expect(storedProject().candidates).toEqual(candidatesBefore);
    expect(mapLayer()).toHaveValue('micro');
    openProjectMenu('Progress');
    expect(screen.getByRole('dialog', { name: 'Progress' })).toBeVisible();
  });

  it('persists the optional student or group name and shows it in the project-link summary', async () => {
    await resumeSavedProject(createDefaultProject());
    const participant = screen.getByRole('textbox', { name: 'Name or Group Name' });
    fireEvent.change(participant, { target: { value: 'East Harlem mapping group' } });
    await waitFor(() => expect(storedProject().participantName).toBe('East Harlem mapping group'));

    const dialog = openProjectLink();
    expect(within(dialog).getByText('Name or Group Name')).toBeVisible();
    expect(within(dialog).getByText('East Harlem mapping group')).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Project link' }));

    cleanup();
    render(<App />);
    await showResumeScreen();
    openProjectFromList('NYC systems and assets map');
    expect(await screen.findByRole('textbox', { name: 'Name or Group Name' })).toHaveValue('East Harlem mapping group');
  });

  it('discloses the complete server-stored project and records revision, sync, and expiry metadata after link creation', async () => {
    const project = createDefaultProject();
    const token = 'project_link_disclosure_token';
    const updatedAt = '2027-01-15T14:30:00.000Z';
    const expiresAt = '2027-04-15T14:30:00.000Z';
    fetchMock = vi.fn((path, options = {}) => {
      if (String(path) === '/api/projects' && options.method === 'POST') {
        return jsonResponse({ token, projectId: project.id, revision: 7, updatedAt, expiresAt }, 201);
      }
      return defaultFetch(path, options);
    });
    vi.stubGlobal('fetch', fetchMock);

    await resumeSavedProject(project);
    let dialog = openProjectLink();
    expect(within(dialog).getByText(/complete project, including its memo and evidence notes, is stored on the class server for 90 days/i)).toBeVisible();
    expect(within(dialog).getByText(/opening it also requires the current class code/i)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project link' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/projects', expect.objectContaining({ method: 'POST' })));
    dialog = await screen.findByRole('dialog', { name: 'Project link' });
    expect(within(dialog).getByText(/stores the complete project on the class server: the memo, framing answers, map items, evidence notes, and revision history/i)).toBeVisible();
    expect(within(dialog).getByText(/anyone with both the link and current class code can open it/i)).toBeVisible();
    expect(within(dialog).getByText(new RegExp(token))).toBeVisible();
    const metadata = within(dialog).getByText('Last server sync').closest('dl');
    expect(within(metadata).getByText('Last server sync').nextElementSibling).toHaveTextContent(/2027/);
    expect(within(metadata).getByText('Link expires').nextElementSibling).toHaveTextContent(/2027/);
    expect(within(dialog).getByRole('status')).toHaveTextContent('Latest changes are synced to this link.');

    const createCall = fetchMock.mock.calls.find(([path, options]) => String(path) === '/api/projects' && options.method === 'POST');
    const createBody = JSON.parse(createCall[1].body);
    expect(Object.keys(createBody)).toEqual(['project']);
    expect(JSON.parse(createBody.project)).toMatchObject({ id: project.id, title: project.title, schemaVersion: project.schemaVersion });
    expect(loadStoredLink(window.localStorage, project.id)).toMatchObject({
      token,
      projectId: project.id,
      revision: 7,
      updatedAt,
      expiresAt,
      lastSyncedAt: updatedAt,
    });
  });

  it('keeps a new project link in the course pinned to the open workspace', async () => {
    const project = createDefaultProject();
    const token = 'project_link_course_scope_token';
    const storage = useAccountStorage('course-link-account', null, { kind: 'course', id: 'seminar-one' });
    storage.setItem(STORAGE_KEY, serializeProject(project));
    fetchMock = vi.fn((path, options = {}) => String(path) === '/api/projects' && options.method === 'POST'
      ? jsonResponse({ token, projectId: project.id, revision: 1, updatedAt: project.updatedAt, expiresAt: '2027-04-15T14:30:00.000Z' }, 201)
      : defaultFetch(path, options));
    vi.stubGlobal('fetch', fetchMock);
    render(<App startInWorkspace onAccountDashboard={vi.fn()} />);
    await screen.findByRole('textbox', { name: 'Name or Group Name' });
    window.history.replaceState(null, '', '/?course=another-course');
    const dialog = openProjectLink();
    expect(within(dialog).getByText('Opening this link requires CUNY Login and access to this course')).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create project link' }));
    await waitFor(() => expect(window.location.pathname).toBe(`/p/${token}`));
    expect(window.location.search).toBe('?course=seminar-one');
    expect(within(dialog).getByText(`${window.location.origin}/p/${token}?course=seminar-one`)).toBeVisible();
    expect(within(dialog).getByText('Anyone with this link and access to this course can open it after CUNY Login')).toBeVisible();
    const [, request] = fetchMock.mock.calls.find(([path, options]) => path === '/api/projects' && options.method === 'POST');
    expect(request.headers['x-systems-course']).toBe('seminar-one');
  });

  it('uses the stored revision for sync conflicts and preserves the device copy before opening the linked version', async () => {
    const project = createDefaultProject();
    project.title = 'Local East Harlem map';
    const token = 'project_link_conflict_token';
    rememberStoredLink(window.localStorage, {
      token,
      projectId: project.id,
      revision: 7,
      updatedAt: project.updatedAt,
      expiresAt: '2027-05-01T12:00:00.000Z',
      lastSyncedAt: project.updatedAt,
    });
    const remote = structuredClone(project);
    remote.title = 'Linked classroom version';
    remote.updatedAt = '2027-01-16T15:00:00.000Z';
    fetchMock = vi.fn((path, options = {}) => {
      if (String(path) === `/api/projects/${token}` && options.method === 'PUT') {
        return jsonResponse({ error: 'Project link revision conflict.' }, 409);
      }
      if (String(path) === `/api/projects/${token}` && !options.method) {
        return jsonResponse({
          token,
          projectId: project.id,
          project: serializeProject(remote),
          revision: 8,
          updatedAt: remote.updatedAt,
          expiresAt: '2027-05-01T12:00:00.000Z',
        });
      }
      return defaultFetch(path, options);
    });
    vi.stubGlobal('fetch', fetchMock);

    await resumeSavedProject(project);
    vi.useFakeTimers();
    fireEvent.change(screen.getByRole('textbox', { name: 'Name or Group Name' }), { target: { value: 'Device-side revision' } });
    await act(async () => {
      vi.advanceTimersByTime(4100);
      await Promise.resolve();
      await Promise.resolve();
    });
    vi.useRealTimers();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/projects/${token}`, expect.objectContaining({ method: 'PUT' })));
    const updateCall = fetchMock.mock.calls.find(([path, options]) => String(path) === `/api/projects/${token}` && options.method === 'PUT');
    expect(updateCall[1].headers).toMatchObject({ 'If-Match': '"7"' });
    expect(JSON.parse(updateCall[1].body)).toMatchObject({ expectedRevision: 7 });

    openProjectLink();
    let dialog = screen.getByRole('dialog', { name: 'Project link' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('This project link changed in another session. Nothing on this device was overwritten.');
    expect(within(dialog).getByRole('button', { name: 'Open linked version and preserve this device copy' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Keep this device copy and create a new link' })).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open linked version and preserve this device copy' }));

    dialog = await screen.findByRole('dialog', { name: 'Project link' });
    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('The linked version is open. The earlier device copy remains in Projects.'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Project link' }));
    openProjectMenu('Projects');
    expect(await screen.findByRole('article', { name: 'Linked classroom version' })).toBeVisible();
    expect(screen.getByRole('article', { name: 'Local East Harlem map — device copy' })).toBeVisible();
  });

  it('turns off and deletes a revisioned server link without deleting the browser project', async () => {
    const project = createDefaultProject();
    const token = 'project_link_retirement_token';
    const expiresAt = '2027-05-01T12:00:00.000Z';
    rememberStoredLink(window.localStorage, {
      token,
      projectId: project.id,
      revision: 7,
      updatedAt: project.updatedAt,
      expiresAt,
      lastSyncedAt: project.updatedAt,
    });
    fetchMock = vi.fn((path, options = {}) => {
      if (String(path) === `/api/projects/${token}/revoke` && options.method === 'POST') {
        return jsonResponse({
          token,
          projectId: project.id,
          revision: 8,
          updatedAt: '2027-01-17T12:00:00.000Z',
          expiresAt,
          revokedAt: '2027-01-17T12:00:00.000Z',
        });
      }
      if (String(path) === `/api/projects/${token}` && options.method === 'DELETE') return jsonResponse({ ok: true });
      return defaultFetch(path, options);
    });
    vi.stubGlobal('fetch', fetchMock);

    await resumeSavedProject(project);
    openProjectLink();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Project link' })).getByRole('button', { name: 'Turn off this link' }));
    const revokeDialog = screen.getByRole('dialog', { name: 'Turn off this link?' });
    expect(within(revokeDialog).getByText(/project remains saved on this device/i)).toBeVisible();
    fireEvent.click(within(revokeDialog).getByRole('button', { name: 'Turn off link' }));

    let linkDialog = await screen.findByRole('dialog', { name: 'Project link' });
    await waitFor(() => expect(within(linkDialog).getByRole('alert')).toHaveTextContent('This link is turned off. Your device copy remains in Projects.'));
    const revokeCall = fetchMock.mock.calls.find(([path, options]) => String(path) === `/api/projects/${token}/revoke` && options.method === 'POST');
    expect(revokeCall[1].headers).toMatchObject({ 'If-Match': '"7"' });
    expect(JSON.parse(revokeCall[1].body)).toEqual({ expectedRevision: 7 });

    fireEvent.click(within(linkDialog).getByRole('button', { name: 'Delete the old server copy' }));
    const deleteDialog = screen.getByRole('dialog', { name: 'Delete server copy?' });
    expect(within(deleteDialog).getByText(/copy saved in this browser remains in Projects/i)).toBeVisible();
    fireEvent.click(within(deleteDialog).getByRole('button', { name: 'Delete server copy' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('The server copy was deleted. Your device copy remains in Projects.');
    const deleteCall = fetchMock.mock.calls.find(([path, options]) => String(path) === `/api/projects/${token}` && options.method === 'DELETE');
    expect(deleteCall[1].headers).toMatchObject({ 'If-Match': '"8"' });
    expect(JSON.parse(deleteCall[1].body)).toEqual({ expectedRevision: 8 });
    expect(loadStoredLink(window.localStorage, project.id)).toBeNull();
    expect(storedProject()).toMatchObject({ id: project.id });
  });

  it('keeps Map and all five stages available with guidance present and never mentions instructor review', async () => {
    const project = projectWithMemoReview();
    await resumeSavedProject(project);
    expect(screen.getByRole('heading', { name: 'Suggestions', exact: true })).toBeVisible();
    expect(document.querySelector('.workspace').textContent).not.toMatch(/instructor review|send to instructor|note for instructor/i);
    screen.getAllByRole('button', { name: 'Continue →' }).forEach((button) => expect(button).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Map' })).toBeEnabled();

    openProjectMenu('Progress');
    const stageMenu = screen.getByRole('dialog', { name: 'Progress' });
    SYSTEMS_MAPPING_STAGES.forEach(({ label }) => expect(within(stageMenu).getByRole('button', { name: new RegExp(label, 'i') })).toBeEnabled());
  });

  it('waits for the first model response while later connection requests remain optional', async () => {
    let releaseReview;
    preflightEvaluationResponder = (body) => new Promise((resolve) => {
      releaseReview = () => resolve(jsonResponse({ evaluation: evaluationRecord(body) }, 201));
    });
    const reviewProject = createDefaultProject();
    reviewProject.instructor.requireStudentConfirmation = true;
    reviewProject.stage = 1;
    reviewProject.furthestStage = 1;
    await resumeSavedProject(reviewProject);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(screen.getByRole('button', { name: 'Reading memo…' })).toBeDisabled();
    const reviewForward = memoNextAction();
    expect(reviewForward).toBeDisabled();
    fireEvent.click(reviewForward);
    expect(screen.queryByRole('heading', { name: 'Suggestions' })).not.toBeInTheDocument();
    expect(storedProject().stage).toBe(1);
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(1);
    await act(async () => { releaseReview(); await Promise.resolve(); });
    await waitFor(() => expect(memoNextAction()).toBeEnabled());
    fireEvent.click(memoNextAction());
    expect(await screen.findByRole('heading', { name: 'Suggestions' })).toBeVisible();

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
    connectionProject.instructor.requireStudentConfirmation = true;
    connectionProject.activeScale = 'exosphere';
    connectionProject.releasedScales = ['micro', 'meso', 'exosphere'];
    const exosphereLabels = ['New York State Education Department', 'City Disability Services Office'];
    connectionProject.candidates.nodes = extractCandidates(connectionProject.submission).nodes.slice(0, 2).map((node, index) => ({
      ...node,
      label: exosphereLabels[index],
      type: index === 0 ? 'agency' : 'institution',
      scale: 'exosphere',
      status: 'confirmed',
      claimState: 'student interpretation',
    }));
    connectionProject.stage = 2;
    connectionProject.furthestStage = 2;
    await resumeSavedProject(connectionProject);
    fireEvent.change(screen.getByRole('combobox', { name: 'Suggestion type' }), { target: { value: 'suggest' } });
    fireEvent.click(screen.getByRole('button', { name: 'Suggest connections' }));
    expect(screen.getByRole('button', { name: 'Generating suggestions…' })).toBeDisabled();
    const connectionForward = workActions().getByRole('button', { name: 'Finish review' });
    expect(connectionForward).toBeEnabled();
    fireEvent.click(connectionForward);
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    await act(async () => { releaseConnections(); await Promise.resolve(); });
  });

  it('opens an empty map from candidate choice after a valid model response with no suggested items', async () => {
    const project = projectWithMemoReview();
    project.instructor.requireStudentConfirmation = true;
    project.preflight.memoReview.nodes = [];
    project.preflight.memoReview.connections = [];
    project.stage = 2;
    project.furthestStage = 2;
    project.candidates = { nodes: [], edges: [] };
    await resumeSavedProject(project);

    expect(screen.getByText('No suggested items to review. You can add an item on the map or reread the memo.')).toBeVisible();
    expect(screen.getByText('No items were suggested. You can add an item yourself or reread the memo.')).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Suggestion type' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    await waitFor(() => expect(storedProject().stage).toBe(3));
  });

  it.each([
    ['micro', 'No suggested items to review. You can add an item on the map or request suggestions.'],
    ['meso', 'No suggested connections to review. You can add a connection on the map or request suggestions.'],
    ['exosphere', 'No suggested decision settings to review. You can add a decision setting on the map or request suggestions.'],
    ['macrosphere', 'No suggested connections to review. You can add a connection on the map or request suggestions.'],
  ])('uses actionable empty-suggestion copy at %s before a memo review', async (scale, message) => {
    const project = makeMapProject(scale);
    project.stage = 2;
    project.candidates = { nodes: [], edges: [] };
    await resumeSavedProject(project);
    expect(screen.getByText(message)).toBeVisible();
  });

  it('uses the student description to request editable connections and adds only accepted suggestions to the map', async () => {
    const project = createDefaultProject();
    project.instructor.requireStudentConfirmation = true;
    project.activeScale = 'meso';
    project.releasedScales = ['micro', 'meso'];
    const nodes = extractCandidates(project.submission).nodes.slice(0, 3).map((node, index) => ({
      ...node,
      type: ['person', 'group', 'object'][index],
      scale: 'micro',
      status: 'confirmed',
      claimState: 'student interpretation',
    }));
    project.candidates = { nodes: [], edges: [] };
    project.graph = { nodes, edges: [] };
    project.stage = 2;
    project.furthestStage = 2;
    connectionSuggestionResponder = (body) => jsonResponse({ connections: [{
      source: body.nodes[0].id,
      target: body.nodes[1].id,
      verb: 'provides',
      rationale: 'The student described a direct pathway between these nodes.',
    }] }, 201);
    await resumeSavedProject(project);

    fireEvent.change(screen.getByRole('combobox', { name: 'Suggestion type' }), { target: { value: 'suggest' } });
    expect(screen.getByRole('heading', { name: 'More connections' })).toBeVisible();
    expect(screen.queryByText('Describe a missing relationship')).not.toBeInTheDocument();
    const prompt = 'Families rely on schools, but delayed referrals make services harder to reach in this session.';
    fireEvent.click(screen.getByText('Describe a relationship (optional)'));
    expect(screen.queryByText(/review and edit every suggestion before adding it to the map/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: /Describe connections between nodes/ }), { target: { value: prompt } });
    fireEvent.click(screen.getByRole('button', { name: 'Suggest connections' }));

    const verb = await screen.findByRole('textbox', { name: 'Connection for suggestion 1' });
    expect(verb).toHaveValue('provides');
    expect(screen.getByRole('button', { name: 'Generate again' })).toBeVisible();
    const request = fetchMock.mock.calls.find(([path, options]) => String(path) === '/api/map/connections' && options.method === 'POST');
    const body = JSON.parse(request[1].body);
    expect(body).toMatchObject({ activeScale: project.activeScale, inquiry: project.inquiry, prompt });
    expect(body.nodes.map(({ id }) => id)).toEqual(nodes.map(({ id }) => id));
    expect(body.relationships).toEqual([]);
    expect(body.projectOverlay).toMatchObject({ id: project.configs.builder.id, customInstructions: project.configs.builder.customInstructions });
    expect(body.projectOverlay).not.toHaveProperty('fixedPrompt');

    const addSuggestion = screen.getByRole('button', { name: 'Add to map' });
    expect(addSuggestion).not.toHaveClass('is-active');
    fireEvent.change(verb, { target: { value: 'informs' } });
    expect(addSuggestion).not.toHaveClass('is-active');
    fireEvent.click(addSuggestion);
    expect(addSuggestion).toHaveClass('is-active');
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    await waitFor(() => expect(storedProject().graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ verb: 'informs', status: 'confirmed', claimState: 'student interpretation' }),
    ])));
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toContain(prompt);
  });

  it('wraps and grows complete model-suggested connection wording while it is edited', async () => {
    const project = createDefaultProject();
    project.instructor.requireStudentConfirmation = true;
    const nodes = extractCandidates(project.submission).nodes.slice(0, 2).map((node) => ({
      ...node,
      scale: 'micro',
      status: 'confirmed',
      claimState: 'student interpretation',
    }));
    project.activeScale = 'meso';
    project.releasedScales = ['micro', 'meso'];
    project.graph = { nodes, edges: [] };
    project.candidates = { nodes: [], edges: [] };
    project.stage = 2;
    project.furthestStage = 2;
    connectionSuggestionResponder = (body) => jsonResponse({ connections: [
      {
        source: body.nodes[0].id,
        target: body.nodes[1].id,
        verb: 'engaged with for administrative guidance',
        rationale: 'The memo describes an administrative question.',
      },
      {
        source: body.nodes[1].id,
        target: body.nodes[0].id,
        verb: 'turned to when systems were unclear',
        rationale: 'The memo describes where the student sought help.',
      },
    ] }, 201);

    await resumeSavedProject(project);
    fireEvent.change(screen.getByRole('combobox', { name: 'Suggestion type' }), { target: { value: 'suggest' } });
    fireEvent.click(screen.getByRole('button', { name: 'Suggest connections' }));

    const firstVerb = await screen.findByRole('textbox', { name: 'Connection for suggestion 1' });
    expect(firstVerb).toHaveValue('engaged with for administrative guidance');
    expect(firstVerb.tagName).toBe('TEXTAREA');
    expect(firstVerb).toHaveAttribute('rows', '2');
    expect(firstVerb).toHaveClass('relationship-verb-editor');

    Object.defineProperty(firstVerb, 'scrollHeight', { configurable: true, value: 86 });
    const revisedVerb = 'engaged with for administrative guidance and registration help';
    fireEvent.input(firstVerb, { target: { value: revisedVerb } });
    await waitFor(() => {
      expect(firstVerb).toHaveValue(revisedVerb);
      expect(firstVerb).toHaveStyle({ height: '88px' });
    });
  });

  it('shows the model text verbatim without canned praise when the review is sparse', async () => {
    const project = createDefaultProject();
    project.instructor.requireStudentConfirmation = true;
    project.stage = 1;
    project.furthestStage = 1;
    preflightEvaluationResponder = (body) => jsonResponse({
      evaluation: evaluationRecord(body, {
        review: { guidance: [], nodes: [], connections: [], example: null, readiness: { ready: false, note: '' } },
      }),
    }, 201);
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    const guidance = await memoReviewDetails();
    expect(within(guidance).getByText(/No guidance returned/)).toBeVisible();
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
    expect(await screen.findByRole('alert')).toHaveTextContent('Guidance could not be completed. Try again.');
    expect(storedProject().preflight).toBeNull();
  });

  it('uses the exact evaluation envelope and keeps the stored memo review portable after reload', async () => {
    const project = createDefaultProject();
    project.instructor.requireStudentConfirmation = true;
    project.participantName = 'East Harlem mapping group';
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Memo review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await memoReviewDetails()).toBeVisible();

    const evaluationRequest = fetchMock.mock.calls.find(([path, options]) => String(path) === '/api/preflight/evaluations' && options.method === 'POST');
    const evaluationBody = JSON.parse(evaluationRequest[1].body);
    expect(Object.keys(evaluationBody).sort()).toEqual(['activeScale', 'stageId', 'inquiry', 'projectMetadata', 'projectOverlay', 'sourceMaterial', 'sourceRecord', 'studentJudgments'].sort());
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
    expect(within(screen.getByRole('article', { name: project.title })).getByText(/Review/)).toBeVisible();
    openProjectFromList(project.title);
    expect(await screen.findByRole('heading', { name: 'Suggestions', exact: true })).toBeVisible();
    expect(screen.queryByText('2 items · 1 connection')).not.toBeInTheDocument();
  });

  it('sends the exact carried Micro node IDs when Meso guidance is generated', async () => {
    const project = createDefaultProject();
    const microNodes = extractCandidates(project.submission).nodes
      .filter((node) => node.scale === 'micro')
      .slice(0, 2)
      .map((node) => ({ ...node, type: 'setting', status: 'confirmed', claimState: 'student interpretation' }));
    microNodes[0].label = 'Renamed family support participants';
    project.activeScale = 'meso';
    project.releasedScales = ['micro', 'meso'];
    project.graph = { nodes: microNodes, edges: [] };
    project.candidates = { nodes: [], edges: [] };
    project.preflight = null;
    project.stage = 0;
    project.furthestStage = 0;

    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Memo review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    await memoReviewDetails();

    const request = fetchMock.mock.calls.find(([path, options]) => String(path) === '/api/preflight/evaluations' && options.method === 'POST');
    const body = JSON.parse(request[1].body);
    expect(body.carriedNodes).toEqual(microNodes.map(({ id, label, type, scale }) => ({ id, label, type, scale })));
    expect(body.carriedNodes[0].id).not.toBe(stableId('node', body.carriedNodes[0].label));
  });

  it('sends every carried node and connection beyond the former outer-level preview slices', async () => {
    const project = makeMapProject('exosphere');
    const nodeTemplate = structuredClone(project.graph.nodes.find((node) => node.scale === 'micro'));
    const edgeTemplate = structuredClone(project.graph.edges.find((edge) => edge.scale === 'meso'));
    expect(nodeTemplate).toBeTruthy();
    expect(edgeTemplate).toBeTruthy();
    const nodes = Array.from({ length: 60 }, (_, index) => ({
      ...structuredClone(nodeTemplate),
      id: `node_carried_person_${String(index + 1).padStart(2, '0')}`,
      label: `Carried person ${index + 1}`,
      type: 'person',
      scale: 'micro',
      x: 120 + (index % 10) * 220,
      y: 120 + Math.floor(index / 10) * 220,
      focalParticipation: 'direct',
      settingNodeIds: [],
      annotations: {
        analytical: { id: `annotation_carried_person_${index + 1}_analytical`, text: '' },
        evidence: { id: `annotation_carried_person_${index + 1}_evidence`, text: '' },
      },
    }));
    const edges = Array.from({ length: 120 }, (_, index) => {
      const source = nodes[index % nodes.length];
      const target = nodes[(index + 1 + Math.floor(index / nodes.length)) % nodes.length];
      return {
        ...structuredClone(edgeTemplate),
        id: `edge_carried_${String(index + 1).padStart(3, '0')}`,
        source: source.id,
        target: target.id,
        sourceLabel: source.label,
        targetLabel: target.label,
        verb: `supports item ${index + 1}`,
        scale: 'micro',
        annotation: { id: `annotation_edge_carried_${index + 1}`, text: '' },
      };
    });
    project.graph = { nodes, edges };
    project.candidates = { nodes: [], edges: [] };
    project.preflight = null;
    project.stage = 1;
    project.furthestStage = 4;
    project.completedScales = ['micro', 'meso'];
    project.levelProgress.exosphere = { stage: 1, reflection: '' };

    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    await memoReviewDetails();

    const request = fetchMock.mock.calls.find(([path, options]) => String(path) === '/api/preflight/evaluations' && options.method === 'POST');
    const body = JSON.parse(request[1].body);
    expect(body.carriedNodes).toHaveLength(60);
    expect(body.carriedConnections).toHaveLength(120);
    expect(body.carriedNodes.at(-1)).toMatchObject({ id: nodes.at(-1).id, label: nodes.at(-1).label });
    expect(body.carriedConnections.at(-1)).toMatchObject({ source: edges.at(-1).source, target: edges.at(-1).target, verb: edges.at(-1).verb });
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
    expect(await screen.findByText(/This memo is too large to send/i)).toBeVisible();
    expect(screen.getByText(/Shorten it and try again/i)).toBeVisible();
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(0);
    expect(storedProject().submission.text).toBe(project.submission.text);
  });

  it('sends a bounded marginal update even when the preserved complete memo exceeds the provider source limit', async () => {
    const project = createBlankProject();
    project.submission.text = Array.from({ length: 65 }, (_, index) => `Residents at location ${index} ${'a'.repeat(1900)}.`).join('\n');
    project.submission.fingerprint = stableId('src', project.submission.text);
    const review = { guidance: [], nodes: [], connections: [], example: null, readiness: { ready: true, note: 'No supported nodes.' } };
    appendSubmittedNodes(project, review);
    const previousAnalysis = structuredClone(project.submission.analysis);
    project.submission.text += '\n' + Array.from({ length: 6 }, (_, index) => `Residents at new location ${index} ${'b'.repeat(1900)}.`).join('\n');
    project.submission.fingerprint = stableId('src', project.submission.text);
    expect(new TextEncoder().encode(project.submission.text).byteLength).toBeGreaterThan(131072);
    studentSession = () => ({ ...grantedAccess(), persistence: 'course-server', suggestionRuntime: { provider: 'cail-gateway', model: 'gpt-oss:120b', maxSourceBytes: 131072 } });
    preflightEvaluationResponder = body => jsonResponse({ evaluation: evaluationRecord(body, { review }) }, 201);
    seedProject(project);
    render(<App memoFirstWorkflow startInWorkspace />);
    fireEvent.click(await screen.findByRole('button', { name: 'Update map', exact: true }));
    await waitFor(() => expect(storedProject().submission.analysis.sourceFingerprint).toBe(project.submission.fingerprint));
    const request = fetchMock.mock.calls.find(([path, options]) => String(path) === '/api/preflight/evaluations' && options.method === 'POST');
    const body = JSON.parse(request[1].body);
    expect(body.sourceMaterial).toBe(project.submission.text);
    expect(body.memoUpdate.baselineFingerprint).toBe(previousAnalysis.sourceFingerprint);
    expect(body.memoUpdate.passages.length).toBeGreaterThan(0);
    expect(new TextEncoder().encode(body.memoUpdate.passages.map(passage => passage.text).join('\n\n')).byteLength).toBeLessThan(131072);
    expect(storedProject().submission.text).toBe(project.submission.text);
    expect(storedProject().graph.nodes).toEqual([]);
    expect(screen.queryByText(/This memo is too large to send/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  });

  it.each(['ollama-cloud', 'openrouter', 'cail-gateway'])('accepts a bibliography-heavy memo within the filtered %s provider limit while preserving the complete original', async (provider) => {
    const project = createDefaultProject();
    const narrative = 'Rosa meets the teacher at school (Smith, 2025).';
    const references = Array.from({ length: 2600 }, (_, index) => 'Smith, Anna. Community Schooling ' + index + '. Example University Press, 2025.').join('\n\n');
    project.submission.text = narrative + '\n\nWorks Cited\n' + references + '\n\nAppendix A. Interview transcript\nRosa visits the library with the parent.';
    expect(new TextEncoder().encode(project.submission.text).byteLength).toBeGreaterThan(131072);
    project.stage = 1;
    project.furthestStage = 1;
    studentSession = () => ({
      ...grantedAccess(), persistence: 'course-server',
      suggestionRuntime: { provider, model: 'gpt-oss:120b', maxSourceBytes: 131072 },
    });
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    await memoReviewDetails();
    const request = fetchMock.mock.calls.find(([path, options]) => String(path) === '/api/preflight/evaluations' && options.method === 'POST');
    expect(JSON.parse(request[1].body).sourceMaterial).toBe(project.submission.text);
    expect(storedProject().submission.text).toBe(project.submission.text);
    expect(screen.queryByText(/This memo is too large to send/i)).not.toBeInTheDocument();
  });

  it('keeps later narrative in the Map Check excerpt by filtering references before its length bound', () => {
    const project = makeMapProject('meso');
    const original = 'Rosa meets the teacher (Smith, 2025).\n\nWork Cited\n'
      + Array.from({ length: 90 }, (_, index) => 'Smith, Anna. Community Schooling ' + index + '. Example Press, 2025.').join('\n\n')
      + '\n\nAppendix A: Field Notes\nThe assistant principal helps the parent reach the school office.';
    project.submission.text = original;
    const payload = mapCheckPayload(project, 'whole-map');
    expect(payload.memoExcerpt).toContain('Rosa meets the teacher (Smith, 2025).');
    expect(payload.memoExcerpt).toContain('The assistant principal helps the parent reach the school office.');
    expect(payload.memoExcerpt).not.toContain('Example Press');
    expect(project.submission.text).toBe(original);
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
    expect(await screen.findByText(/guiding inquiry is too large to send/i)).toBeVisible();
    expect(screen.getByText(/Shorten it and try again/i)).toBeVisible();
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
    expect(await screen.findByText('Guidance is temporarily unavailable. Try again later.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(storedProject().preflight).toBeNull();
  });

  it('does not blame the memo for a server-side request size error', async () => {
    const project = createDefaultProject();
    project.stage = 1;
    project.furthestStage = 1;
    preflightEvaluationResponder = () => jsonResponse({ error: 'Request is too large.' }, 413);
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    await waitFor(() => expect(document.querySelector('.toast')).toHaveTextContent('The request is too large. Check the text and project details, then try again.'));
    expect(document.querySelector('.toast')).not.toHaveTextContent('Shorten the memo');
    expect(storedProject().submission.text).toBe(project.submission.text);
  });

  it.each([
    [429, 'quota_exceeded', 'The model usage limit has been reached. Try again later.'],
    [429, 'internal_throttle', 'Requests are paused. Try again later.'],
    [403, 'course_access_denied', 'This course is not available to your account. Ask your instructor to check your enrollment.'],
    [409, 'course_prompt_changed', 'The course instructions changed. Reload this page before requesting guidance again.'],
  ])('shows safe guidance copy for %s %s while preserving the memo', async (status, code, message) => {
    const project = createDefaultProject();
    project.stage = 1;
    project.furthestStage = 1;
    preflightEvaluationResponder = () => jsonResponse({ error: `${code}: private provider diagnostic`, details: { code, shouldRetry: false } }, status);
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(document.body).not.toHaveTextContent(/private provider diagnostic/);
    expect(document.body).not.toHaveTextContent(code);
    expect(storedProject().submission.text).toBe(project.submission.text);
    expect(storedProject().preflight).toBeNull();
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(1);
  });

  it('keeps arbitrary support diagnostics out of a guidance failure', async () => {
    const project = createDefaultProject();
    project.stage = 1;
    project.furthestStage = 1;
    preflightEvaluationResponder = () => jsonResponse({ error: 'UPSTREAM_FAILED', details: { code: 'guidance_unavailable', retryable: true, retryAfterSeconds: 2, supportReference: 'PRIVATE_PROVIDER_TRACE: secret diagnostic' } }, 503);
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Guidance could not be completed. Try again.');
    expect(document.querySelector('.toast')).toHaveTextContent('Guidance is unavailable. Your project is unchanged. Try again in 2 seconds.');
    expect(document.body).not.toHaveTextContent(/PRIVATE_PROVIDER_TRACE|secret diagnostic|UPSTREAM_FAILED/);
    expect(storedProject().preflight).toBeNull();
  });

  it('offers collapsed safe support details for a failed memo review without sending or saving them', async () => {
    const project = createDefaultProject();
    project.stage = 1;
    project.furthestStage = 1;
    const requestId = '87ca9905-188a-4f55-bb50-9832f245f334';
    preflightEvaluationResponder = () => jsonResponse({ error: 'PRIVATE_MODEL_RESPONSE', details: {
      code: 'guidance_contract_invalid', validationField: 'nodes[2].label', validationReason: 'label_format', requestId,
      correctiveRetries: 2, evidenceRepairAttempts: 1,
      supportReference: 'PRIVATE_PROVIDER_TRACE', response: 'PRIVATE_MEMO_PASSAGE',
    } }, 502);
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was added because a proposed node name covered more than one thing. Try again, or add the node in Tools.');
    const details = screen.getByText('Support details').closest('details');
    expect(details).not.toHaveAttribute('open');
    const callsBeforeOpening = fetchMock.mock.calls.length;
    fireEvent.click(within(details).getByText('Support details'));
    expect(details).toHaveAttribute('open');
    expect(within(details).getByText('guidance_contract_invalid')).toBeVisible();
    expect(within(details).getByText('nodes[2].label')).toBeVisible();
    expect(within(details).getByText('label_format')).toBeVisible();
    expect(within(details).getByText(requestId)).toBeVisible();
    expect(within(details).getByText('Corrective retries').nextElementSibling).toHaveTextContent('2');
    expect(within(details).getByText('Evidence repair attempts').nextElementSibling).toHaveTextContent('1');
    expect(document.body).not.toHaveTextContent(/PRIVATE_MODEL_RESPONSE|PRIVATE_PROVIDER_TRACE|PRIVATE_MEMO_PASSAGE/);
    expect(fetchMock.mock.calls).toHaveLength(callsBeforeOpening);
    expect(storedProject().submission.text).toBe(project.submission.text);
    expect(storedProject().preflight).toBeNull();
    expect(JSON.stringify(storedProject())).not.toContain(requestId);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.queryByText('Support details')).not.toBeInTheDocument();
    await screen.findByText('Support details');
  });

  it.each([
    { code: 'PRIVATE_CODE', validationField: 'nodes[0].label: PRIVATE_MEMO', validationReason: 'PRIVATE_REASON', requestId: '<script>PRIVATE_ID</script>', correctiveRetries: 3, evidenceRepairAttempts: 2 },
    { code: ['guidance_contract_invalid'], validationField: ['nodes[0].label'], validationReason: ['label_format'], requestId: ['87ca9905-188a-4f55-bb50-9832f245f334'], correctiveRetries: '2', evidenceRepairAttempts: '1' },
    { code: 'guidance_contract_invalid\nPRIVATE_CODE', validationField: 'nodes[0].evidence.privateText', validationReason: 'text_format\nPRIVATE_REASON', requestId: '87ca9905-188a-4f55-bb50-9832f245f334\nPRIVATE_ID', correctiveRetries: -1, evidenceRepairAttempts: 0.5 },
    { code: 'PRIVATE_CODE', validationField: 'nodes[0].label\n', validationReason: 'label_format\n', requestId: '87ca9905-188a-4f55-bb50-9832f245f334\n', correctiveRetries: null, evidenceRepairAttempts: null },
  ])('omits malformed memo review support values %#', async (details) => {
    const project = createDefaultProject();
    project.stage = 1;
    project.furthestStage = 1;
    preflightEvaluationResponder = () => jsonResponse({ error: 'PRIVATE_ERROR', details }, 502);
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Guidance could not be completed. Try again.');
    expect(screen.queryByText('Support details')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/PRIVATE_|privateText|<script>|nodes\[0\]/);
    expect(storedProject().preflight).toBeNull();
  });

  it.each(['failure', 'invalid output'])('does not advance the first mapping cycle after model %s', async (failure) => {
    const project = createDefaultProject();
    project.stage = 1;
    project.furthestStage = 1;
    preflightEvaluationResponder = (body) => failure === 'failure'
      ? jsonResponse({ error: 'Suggestion generation is temporarily unavailable.' }, 502)
      : jsonResponse({ evaluation: evaluationRecord(body, { review: {
        ...memoReviewFixture(),
        nodes: [{ label: 'He', type: 'person', scale: 'micro', evidence: 'He attended' }],
        connections: [],
      } }) }, 201);
    await resumeSavedProject(project);
    fireEvent.click(memoNextAction());
    if (failure === 'failure') await screen.findByText('Guidance is temporarily unavailable. Try again later.');
    else expect(await screen.findByRole('alert')).toHaveTextContent('Guidance could not be completed. Try again.');
    expect(screen.getByRole('heading', { name: 'Memo review' })).toBeVisible();
    expect(storedProject().preflight).toBeNull();
    expect(storedProject().graph).toEqual({ nodes: [], edges: [] });
    expect(storedProject().candidates).toEqual({ nodes: [], edges: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(screen.queryByRole('option', { name: 'Map notes' })).not.toBeInTheDocument();
    openProjectMenu('Progress');
    const progress = screen.getByRole('dialog', { name: 'Progress' });
    for (const label of ['Choose elements', 'Build map', 'Review and export']) {
      fireEvent.click(within(progress).getByRole('button', { name: label, exact: true }));
      expect(screen.getByRole('heading', { name: 'Memo review' })).toBeVisible();
    }
    expect(storedProject().stage).toBe(1);
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(1);
  });

  it.each([2, 3, 4])('returns an unseeded saved empty project from stage %s to Memo review', async (stage) => {
    const project = createDefaultProject();
    project.stage = stage;
    project.furthestStage = stage;
    await resumeSavedProject(project);
    expect(await screen.findByRole('heading', { name: 'Memo review' })).toBeVisible();
    await waitFor(() => expect(storedProject().stage).toBe(1));
    expect(storedProject().graph).toEqual({ nodes: [], edges: [] });
    expect(storedProject().preflight).toBeNull();
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(0);
  });

  it('returns an unseeded empty cross-tab update to Memo review without inventing guidance', async () => {
    const project = createDefaultProject();
    project.stage = 1;
    await resumeSavedProject(project);
    const incoming = structuredClone(project);
    incoming.title = 'Updated from another tab';
    incoming.stage = 4;
    incoming.furthestStage = 4;
    incoming.updatedAt = new Date(Date.now() + 1000).toISOString();
    fireEvent(window, new StorageEvent('storage', { key: STORAGE_KEY, newValue: serializeProject(incoming) }));
    expect(await screen.findByRole('heading', { name: 'Memo review' })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Field notes (required)' })).not.toBeInTheDocument();
    await waitFor(() => expect(storedProject()).toMatchObject({ title: incoming.title, stage: 1 }));
    expect(storedProject().preflight).toBeNull();
    expect(storedProject().graph).toEqual({ nodes: [], edges: [] });
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(0);
  });

  it('marks guidance refreshable after a memo edit without erasing the guidance or any work', async () => {
    const project = projectWithMemoReview();
    await resumeSavedProject(project);
    expect(screen.getByRole('heading', { name: 'Suggestions', exact: true })).toBeVisible();
    expect(screen.queryByText(/The feedback shown is for your earlier memo/)).not.toBeInTheDocument();

    const drawer = document.querySelector('.memo-drawer');
    drawer.open = true;
    fireEvent.change(within(drawer).getByRole('textbox', { name: /^Memo/ }), {
      target: { value: `${project.submission.text} A later correction adds one more connection.` },
    });

    expect(await screen.findByText(/The feedback shown is for your earlier memo/)).toBeVisible();
    expect(await memoReviewDetails()).toBeVisible();
    openDetails('.notebook-refresh');
    expect(screen.getByRole('button', { name: 'Reread memo' })).toBeEnabled();
    screen.getAllByRole('button', { name: 'Continue →' }).forEach((button) => expect(button).toBeEnabled());
    await waitFor(() => expect(storedProject().preflight.memoReview).toEqual(memoReviewFixture()));
  });

  it('stores the shared and project configuration snapshots with a preflight event', async () => {
    const project = createDefaultProject();
    project.instructor.requireStudentConfirmation = true;
    await resumeSavedProject(project);
    await waitFor(() => {
      const configCalls = fetchMock.mock.calls.filter(([path]) => String(path).startsWith('/api/config/public?'));
      expect(configCalls).toHaveLength(2);
    });
    await waitFor(() => expect(storedProject().teacherGovernance?.preflight?.moduleVersions).toHaveLength(12));
    fireEvent.click(screen.getByRole('button', { name: 'Memo review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await memoReviewDetails()).toBeVisible();
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

  it('autosaves an empty map with unpublished course guidance without requiring focal framing', async () => {
    publicConfigurationResponder = path => jsonResponse({
      ...publicConfiguration(path),
      moduleVersions: [{ id: 'course-appendix', revision: 0, fingerprint: 'empty-appendix' }],
    });
    const project = createBlankProject();
    await resumeSavedProject(project);
    await waitFor(() => expect(storedProject().teacherGovernance?.preflight.moduleVersions[0]).toMatchObject({ id: 'course-appendix', revision: 0 }));
    expect(storedProject().graph).toEqual({ nodes: [], edges: [] });
    expect(storedProject().inquiry).toBe('');
    expect(screen.queryByRole('button', { name: 'Review issue' })).not.toBeInTheDocument();
    expect(() => serializeProject(storedProject())).not.toThrow();
  });

  it.each([
    ['exosphere', 'Exo-level'],
    ['macrosphere', 'Macro-level'],
  ])('does not rescale extracted Micro items when continuing without model at %s', async (scale, levelLabel) => {
    const project = makeMapProject(scale);
    const graphBefore = structuredClone(project.graph);
    project.preflight = null;
    project.candidates = { nodes: [], edges: [] };
    project.stage = 1;
    project.furthestStage = 1;

    await resumeSavedProject(project);
    fireEvent.click(memoNextAction());
    expect(await screen.findByRole('heading', { name: 'Suggestions' })).toBeVisible();
    await waitFor(() => {
      expect(storedProject().candidates).toEqual({ nodes: [], edges: [] });
      expect(storedProject().graph).toEqual(graphBefore);
    });
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(0);
  });

  it('reviews and commits Micro nodes before connecting them in Meso', async () => {
    const project = projectWithMemoReview();
    await resumeSavedProject(project);
    expect(project.preflight.memoReview.connections).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Continue →', exact: true }));
    expect(await screen.findByRole('heading', { name: 'Suggestions' })).toBeVisible();
    expect(screen.queryByRole('option', { name: 'Connections' })).not.toBeInTheDocument();
    await waitFor(() => {
      const stored = storedProject();
      expect(stored.stage).toBe(2);
      expect(stored.candidates.nodes.map(({ label }) => label)).toEqual(['School', 'Committee']);
      expect(stored.candidates.nodes.every((node) => node.scale === 'micro' && node.status === 'pending' && node.claimState === 'inference')).toBe(true);
      expect(stored.candidates.edges).toEqual([]);
    });
    acceptAllCandidates();
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    await waitFor(() => expect(storedProject().stage).toBe(3));
    expect(storedProject().graph.nodes).toHaveLength(2);
    expect(storedProject().graph.nodes.every(node => node.status === 'confirmed')).toBe(true);
    expect(storedProject().graph.edges).toEqual([]);
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/map/connections')).toHaveLength(0);
    workActions();
    expect(await screen.findByRole('textbox', { name: 'Field notes (required)' })).toBeVisible();
  });


  it('records focal participation and immediate setting membership while reviewing Micro suggestions', async () => {
    const project = projectWithMemoReview();
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Continue →', exact: true }));
    expect(await screen.findByRole('heading', { name: 'Suggestions' })).toBeVisible();

    await waitFor(() => expect(storedProject().candidates.nodes.map((node) => node.label)).toEqual(expect.arrayContaining(['School', 'Committee'])));
    const schoolCandidate = storedProject().candidates.nodes.find((node) => node.label === 'School');
    const committeeCandidate = storedProject().candidates.nodes.find((node) => node.label === 'Committee');
    expect(schoolCandidate).toMatchObject({ focalParticipation: 'unclear', settingNodeIds: [] });
    expect(committeeCandidate).toMatchObject({ focalParticipation: 'unclear', settingNodeIds: [] });

    const schoolRow = screen.getByDisplayValue('School').closest('article');
    expect(within(schoolRow).queryByRole('combobox', { name: 'Setting for School' })).not.toBeInTheDocument();
    fireEvent.click(within(schoolRow).getByRole('button', { name: 'Add to map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next suggestion' }));
    const committeeRow = screen.getByDisplayValue('Committee').closest('article');
    fireEvent.click(within(committeeRow).getByText('Details', { selector: 'summary' }));
    fireEvent.change(within(committeeRow).getByRole('combobox', { name: 'Involvement of Committee' }), { target: { value: 'indirect' } });
    fireEvent.change(within(committeeRow).getByRole('combobox', { name: 'Setting for Committee' }), { target: { value: schoolCandidate.id } });
    await waitFor(() => expect(storedProject().candidates.nodes.find((node) => node.id === committeeCandidate.id)).toMatchObject({
      focalParticipation: 'indirect',
      settingNodeIds: [schoolCandidate.id],
    }));
    fireEvent.click(within(committeeRow).getByRole('button', { name: 'Remove Committee from School' }));
    await waitFor(() => expect(storedProject().candidates.nodes.find((node) => node.id === committeeCandidate.id).settingNodeIds).toEqual([]));
    fireEvent.change(within(committeeRow).getByRole('combobox', { name: 'Setting for Committee' }), { target: { value: schoolCandidate.id } });
    await waitFor(() => expect(storedProject().candidates.nodes.find((node) => node.id === committeeCandidate.id).settingNodeIds).toEqual([schoolCandidate.id]));

    fireEvent.click(within(committeeRow).getByRole('button', { name: 'Add to map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    await waitFor(() => expect(storedProject().graph.nodes.find((node) => node.label === 'Committee')).toMatchObject({
      focalParticipation: 'indirect',
      settingNodeIds: [schoolCandidate.id],
    }));
    const settingRegion = document.querySelector(`[data-setting-region="${schoolCandidate.id}"]`);
    expect(settingRegion).toHaveAttribute('data-member-count', '1');
    expect(settingRegion.getAttribute('d')).toMatch(/^M /);
  });


  it('persists opting out and leaves suggestions off the map until chosen', async () => {
    const project = projectWithMemoReview();
    project.instructor.requireStudentConfirmation = false;
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add suggestions automatically' }));
    await waitFor(() => expect(storedProject().instructor.requireStudentConfirmation).toBe(true));
    cleanup();
    render(<App />);
    await showResumeScreen();
    openProjectFromList();
    expect(screen.getByRole('checkbox', { name: 'Add suggestions automatically' })).not.toBeChecked();
    fireEvent.click(memoNextAction());
    expect(await screen.findByRole('heading', { name: 'Suggestions' })).toBeVisible();
    expect(storedProject().graph.nodes).toHaveLength(0);
    expect(storedProject().candidates.nodes.every((node) => node.status === 'pending')).toBe(true);
  });

  it('reopens automatic suggestions without duplicates and preserves removed and deferred decisions', async () => {
    const project = projectWithMemoReview();
    project.instructor.requireStudentConfirmation = false;
    await resumeSavedProject(project);
    fireEvent.click(memoNextAction());
    await waitFor(() => expect(storedProject().graph.nodes).toHaveLength(2));
    const initialIds = storedProject().graph.nodes.map(({ id }) => id);
    openProjectMenu('Progress');
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Progress' })).getByRole('button', { name: 'Memo review', exact: true }));
    fireEvent.click(memoNextAction());
    await waitFor(() => expect(storedProject().stage).toBe(3));
    expect(storedProject().graph.nodes.map(({ id }) => id)).toEqual(initialIds);
    expect(storedProject().graph.edges).toHaveLength(0);

    const saved = storedProject();
    saved.stage = 1;
    saved.candidates.nodes[0] = { ...saved.candidates.nodes[0], status: 'rejected', reviewDecision: 'removed', claimState: 'retired' };
    saved.candidates.nodes[1] = { ...saved.candidates.nodes[1], status: 'research lead', reviewDecision: 'set aside', claimState: 'research lead' };
    cleanup();
    await resumeSavedProject(saved);
    fireEvent.click(memoNextAction());
    await waitFor(() => expect(storedProject().stage).toBe(3));
    expect(storedProject().graph.nodes.filter((node) => node.status === 'confirmed')).toHaveLength(0);
    expect(storedProject().graph.edges.filter((edge) => edge.status === 'confirmed')).toHaveLength(0);
    expect(storedProject().candidates.nodes.map(({ reviewDecision }) => reviewDecision)).toEqual(['removed', 'set aside']);
  });

  it.each(['direct', 'indirect', 'unclear', 'not applicable'])('starts model Micro participation as unclear and preserves recorded %s participation through rereading', async (participation) => {
    const project = projectWithMemoReview();
    project.instructor.requireStudentConfirmation = false;
    await resumeSavedProject(project);
    fireEvent.click(memoNextAction());
    await waitFor(() => expect(storedProject().graph.nodes).toHaveLength(2));
    expect(storedProject().graph.nodes.every(node => node.focalParticipation === 'unclear')).toBe(true);
    expect(storedProject().candidates.nodes.every(node => node.focalParticipation === 'unclear')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Map', exact: true }));
    expect(document.querySelector(`[data-graph-id="${storedProject().graph.nodes[0].id}"]`)).toHaveAttribute('aria-label', expect.stringContaining('Unclear'));

    const saved = storedProject();
    const recordedId = saved.graph.nodes[0].id;
    saved.graph.nodes.find(node => node.id === recordedId).focalParticipation = participation;
    saved.candidates.nodes.find(node => node.id === recordedId).focalParticipation = participation;
    saved.stage = 1;
    cleanup();
    await resumeSavedProject(saved);
    fireEvent.click(screen.getByText('Update suggestions', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reread memo' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(1));
    await waitFor(() => expect(memoNextAction()).toBeEnabled());
    fireEvent.click(memoNextAction());
    await waitFor(() => expect(storedProject().stage).toBe(3));
    expect(storedProject().graph.nodes).toHaveLength(2);
    expect(storedProject().graph.nodes.find(node => node.id === recordedId).focalParticipation).toBe(participation);
    expect(storedProject().candidates.nodes.find(node => node.id === recordedId).focalParticipation).toBe(participation);
    expect(storedProject().graph.nodes.find(node => node.id !== recordedId).focalParticipation).toBe('unclear');
  });

  it('automatically builds cumulative maps through all four levels without confirming model claims', async () => {
    const project = createDefaultProject();
    project.stage = 1;
    project.furthestStage = 1;
    preflightEvaluationResponder = (body) => {
      const review = body.activeScale === 'micro' ? {
        ...memoReviewFixture(),
        nodes: [
          { label: 'Home', type: 'setting', scale: 'micro', evidence: 'The resident lives at home' },
          { label: 'Clinic', type: 'setting', scale: 'micro', evidence: 'The resident visits the clinic' },
          { label: 'Resident', type: 'person', scale: 'micro', evidence: 'The resident visits the clinic' },
        ],
        connections: [],
      } : memoReviewFixture(body.activeScale, body.carriedNodes);
      if (body.activeScale === 'exosphere') { review.connections = []; review.example = null; review.nodes.forEach(node => { node.basis = 'memo'; }); }
      if (body.activeScale === 'macrosphere') {
        review.nodes = []; review.example = null;
        const larger = body.carriedNodes.find(node => node.scale === 'exosphere');
        const local = body.carriedNodes.find(node => node.scale === 'micro');
        review.connections = [{ source: larger.id, sourceLabel: larger.label, target: local.id, targetLabel: local.label, verb: 'supports', rationale: 'The larger setting supports the local map.' }];
      }
      return jsonResponse({ evaluation: evaluationRecord(body, { review }) }, 201);
    };
    await resumeSavedProject(project);
    const scales = ['micro', 'meso', 'exosphere', 'macrosphere'];
    let prior = { nodes: [], edges: [] };
    for (const [index, scale] of scales.entries()) {
      if (index === 0) {
        fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
        await waitFor(() => expect(storedProject()?.preflight?.memoReview, `${scale}: ${document.querySelector('[role="status"]')?.textContent}`).toBeTruthy());
        await waitFor(() => expect(memoNextAction()).toBeEnabled());
        fireEvent.click(memoNextAction());
      }
      if (scale === 'exosphere') {
        expect(storedProject().part2Submission.text).toBe('');
        fireEvent.change(screen.getByRole('textbox', { name: /^Memo/ }), { target: { value: 'The outside agency supports the resident and clinic.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
        await waitFor(() => expect(storedProject().preflight?.memoReview).toBeTruthy());
        fireEvent.click(memoNextAction());
      }
      // Part 2 explicitly begins at Exo; the remaining transitions reread it.
      await waitFor(() => expect(storedProject()).toMatchObject({ activeScale: scale, stage: 3 }));
      const graph = storedProject().graph;
      expect(graph.nodes).toHaveLength([3, 3, 4, 4][index]);
      if (['meso', 'macrosphere'].includes(scale)) {
        expect(graph.nodes.filter(node => node.scale === 'meso')).toEqual([]);
        expect(graph.edges.some(edge => edge.scale === 'meso')).toBe(true);
      } else expect(graph.nodes.filter((node) => node.scale === scale).length).toBeGreaterThan(0);
      prior.nodes.forEach((node) => expect(graph.nodes.find(({ id }) => id === node.id)).toMatchObject({ label: node.label, scale: node.scale, status: node.status }));
      prior.edges.forEach((edge) => expect(graph.edges.find(({ id }) => id === edge.id)).toMatchObject(edge));
      expect([...graph.nodes, ...graph.edges].every((item) => item.claimState === 'inference' && item.reviewDecision === 'pending')).toBe(true);
      if (scale === 'macrosphere') expect(graph.edges.some(edge => edge.scale === scale)).toBe(true);
      prior = structuredClone(graph);
      if (index < 3) {
        workActions();
        fireEvent.change(screen.getByRole('textbox', { name: 'Field notes (required)' }), { target: { value: `I will investigate missing ${scale} relationships before the next scale.` } });
        fireEvent.click(workActions().getByRole('button', { name: /^Continue to / }));
        if (['meso', 'macrosphere'].includes(scale)) {
          const dialog = await screen.findByRole('dialog', { name: 'Review Micro and Meso' });
          await waitFor(() => expect(storedProject()).toMatchObject({ activeScale: 'meso', stage: 4 }));
          expect(storedProject().graph).toEqual(prior);
          fireEvent.click(within(dialog).getByRole('button', { name: 'Continue to Exo-level' }));
        }
        await waitFor(() => expect(storedProject().activeScale).toBe(scales[index + 1]));
      }
    }
    cleanup();
    render(<App />);
    await showResumeScreen();
    openProjectFromList();
    expect(storedProject().graph).toEqual(prior);
    expect(screen.getByRole('heading', { name: 'Systems map' })).toBeVisible();
  }, 20000);


  it('reads the memo before offering the single action that builds its map', async () => {
    const project = projectWithMemoReview();
    project.instructor.requireStudentConfirmation = false;
    project.preflight = null;
    await resumeSavedProject(project);
    expect(screen.queryByRole('button', { name: 'Continue without model' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Memo review' })).toBeVisible();
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(0);
    fireEvent.click(memoNextAction());
    fireEvent.click(await screen.findByRole('button', { name: 'Continue →', exact: true }));
    await waitFor(() => expect(storedProject().stage).toBe(3));
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(1);
    expect(storedProject().preflight.memoReview).toEqual(memoReviewFixture());
    expect(storedProject().graph.nodes.map(node => node.label)).toEqual(['School', 'Committee']);
    expect(storedProject().graph.edges).toEqual([]);
    expect([...storedProject().graph.nodes, ...storedProject().graph.edges].every(item => item.claimState === 'inference' && item.reviewDecision === 'pending')).toBe(true);
  });

  it('offers one disabled read action while the first model response is pending', async () => {
    const project = createDefaultProject();
    project.stage = 1;
    project.furthestStage = 1;
    let releaseReview;
    preflightEvaluationResponder = (body) => new Promise(resolve => {
      releaseReview = () => resolve(jsonResponse({ evaluation: evaluationRecord(body) }, 201));
    });
    await resumeSavedProject(project);
    const continueButton = memoNextAction();
    fireEvent.click(continueButton);
    fireEvent.click(continueButton);
    fireEvent.click(screen.getByRole('button', { name: 'Reading memo…' }));
    expect(continueButton).toBeDisabled();
    expect(storedProject().stage).toBe(1);
    expect(storedProject().preflight).toBeNull();
    expect(screen.queryByRole('option', { name: 'Map notes' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(1);
    await act(async () => { releaseReview(); await Promise.resolve(); });
    fireEvent.click(await screen.findByRole('button', { name: 'Continue →', exact: true }));
    await waitFor(() => expect(storedProject().stage).toBe(3));
    expect(storedProject().graph.nodes).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(1);
  });

  it('ends a stalled first request without opening an empty map or applying a late response', async () => {
    const project = createDefaultProject();
    project.stage = 1;
    project.furthestStage = 1;
    let releaseReview;
    preflightEvaluationResponder = body => new Promise(resolve => {
      releaseReview = () => resolve(jsonResponse({ evaluation: evaluationRecord(body) }, 201));
    });
    await resumeSavedProject(project);
    vi.useFakeTimers();
    const continueButton = memoNextAction();
    fireEvent.click(continueButton);
    expect(screen.getByRole('button', { name: 'Reading memo…' })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(GUIDANCE_REQUEST_TIMEOUT_MS); });

    expect(screen.queryByRole('button', { name: 'Reading memo…' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(continueButton).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Guidance took too long. Try again.');
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(screen.getByRole('alert')).toHaveTextContent('Guidance took too long. Try again.');
    expect(storedProject()).toMatchObject({ stage: 1, preflight: null, graph: { nodes: [], edges: [] } });
    expect(screen.queryByRole('option', { name: 'Map notes' })).not.toBeInTheDocument();

    await act(async () => { releaseReview(); await Promise.resolve(); });
    expect(storedProject().preflight).toBeNull();
    expect(storedProject().graph.nodes).toHaveLength(0);

    vi.useRealTimers();
    preflightEvaluationResponder = body => jsonResponse({ evaluation: evaluationRecord(body) }, 201);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(storedProject().preflight).not.toBeNull());
    fireEvent.click(memoNextAction());
    await waitFor(() => expect(storedProject().stage).toBe(3));
    expect(storedProject().graph.nodes).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(2);
  });

  it('reports the server deadline as a timeout and leaves the first memo ready for retry', async () => {
    const project = createDefaultProject();
    project.stage = 1;
    project.furthestStage = 1;
    preflightEvaluationResponder = () => jsonResponse({ error: 'Guidance took too long', details: { code: 'guidance_timeout', shouldRetry: false } }, 504);
    await resumeSavedProject(project);
    fireEvent.click(memoNextAction());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Guidance took too long. Try again.'));
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(storedProject()).toMatchObject({ stage: 1, preflight: null, graph: { nodes: [], edges: [] } });
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(1);
  });

  it('accepts empty Micro output and rereads the memo for Meso', async () => {
    const project = createDefaultProject();
    project.stage = 1;
    project.furthestStage = 1;
    preflightEvaluationResponder = body => jsonResponse({ evaluation: evaluationRecord(body, { review: {
      guidance: [{ point: 'Identify who participates in this setting' }],
      nodes: [], connections: [], example: null,
      readiness: { ready: false, note: 'More evidence needed' },
    } }) }, 201);
    await resumeSavedProject(project);
    fireEvent.click(memoNextAction());
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue →', exact: true }));
    await waitFor(() => expect(storedProject().stage).toBe(3));
    expect(storedProject().graph).toEqual({ nodes: [], edges: [] });
    expect(storedProject().preflight.memoReview.nodes).toEqual([]);
    expect(storedProject().events.find(event => event.action === 'preflight.completed')).toMatchObject({
      sourceFingerprint: storedProject().preflight.sourceFingerprint,
    });
    workActions();
    fireEvent.change(screen.getByRole('textbox', { name: 'Field notes (required)' }), { target: { value: 'I need to observe the settings before naming their links.' } });
    fireEvent.click(workActions().getByRole('button', { name: 'Continue to Meso' }));
    await waitFor(() => expect(storedProject()).toMatchObject({ activeScale: 'meso', stage: 3 }));
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations').map(([, options]) => JSON.parse(options.body).activeScale)).toEqual(['micro', 'meso']);
  });

  it('waits for the next level course appendix before reading the memo automatically', async () => {
    const project = createDefaultProject();
    project.stage = 1;
    project.furthestStage = 1;
    const deferred = () => { let resolve; const promise = new Promise((settle) => { resolve = settle; }); return { promise, resolve }; };
    const mesoConfiguration = deferred();
    const mesoReview = deferred();
    publicConfigurationResponder = (path) => {
      const params = new URL(path, 'http://local.test').searchParams;
      if (params.get('scale') !== 'meso') return jsonResponse(publicConfiguration(path));
      // The Meso appendix differs from Micro and arrives late, as it does when the course
      // prompt carries level-specific parts.
      return mesoConfiguration.promise.then(() => jsonResponse({ ...publicConfiguration(path), fingerprint: `${params.get('configKind')}-meso-fingerprint` }));
    };
    preflightEvaluationResponder = (body) => {
      const review = body.activeScale === 'micro' ? {
        ...memoReviewFixture(),
        nodes: [
          { label: 'Home', type: 'setting', scale: 'micro', evidence: 'The resident lives at home' },
          { label: 'Clinic', type: 'setting', scale: 'micro', evidence: 'The resident visits the clinic' },
        ],
        connections: [],
      } : memoReviewFixture(body.activeScale, body.carriedNodes);
      const response = jsonResponse({ evaluation: evaluationRecord(body, { review }) }, 201);
      return body.activeScale === 'meso' ? mesoReview.promise.then(() => response) : response;
    };
    const footer = () => workActions();
    const evaluationScales = () => fetchMock.mock.calls
      .filter(([path]) => String(path) === '/api/preflight/evaluations')
      .map(([, options]) => JSON.parse(options.body).activeScale);
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    await waitFor(() => expect(footer().getByRole('button', { name: 'Continue →' })).toBeEnabled());
    fireEvent.click(footer().getByRole('button', { name: 'Continue →' }));
    await waitFor(() => expect(storedProject()).toMatchObject({ activeScale: 'micro', stage: 3 }));
    footer();
    fireEvent.change(screen.getByRole('textbox', { name: 'Field notes (required)' }), { target: { value: 'Ask who coordinates between home and the clinic.' } });
    fireEvent.click(footer().getByRole('button', { name: 'Continue to Meso' }));
    await waitFor(() => expect(storedProject()).toMatchObject({ activeScale: 'meso', stage: 1 }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => String(path).startsWith('/api/config/public?') && String(path).includes('scale=meso'))).toBe(true));

    // No Meso read is issued while the Meso appendix is still loading: a read keyed to the
    // Micro appendix would be discarded once the Meso one landed.
    expect(evaluationScales()).toEqual(['micro']);
    mesoConfiguration.resolve();
    await waitFor(() => expect(storedProject().teacherGovernance?.preflight?.fingerprint).toBe('preflight-meso-fingerprint'));
    await waitFor(() => expect(evaluationScales()).toEqual(['micro', 'meso']));
    mesoReview.resolve();
    await waitFor(() => expect(storedProject()).toMatchObject({ activeScale: 'meso', stage: 3 }));
    expect(storedProject().graph.nodes.map(node => node.label)).toEqual(['Home', 'Clinic']);
    expect(storedProject().graph.edges).toEqual([expect.objectContaining({ scale: 'meso', verb: 'coordinates with' })]);
  });

  it('adds requested connection suggestions automatically without marking them reviewed', async () => {
    const project = makeMapProject('meso');
    project.stage = 2;
    project.furthestStage = 3;
    const initialEdgeCount = project.graph.edges.length;
    project.instructor.requireStudentConfirmation = false;
    await resumeSavedProject(project);
    fireEvent.change(screen.getByRole('combobox', { name: 'Suggestion type' }), { target: { value: 'suggest' } });
    connectionSuggestionResponder = (body) => jsonResponse({ connections: [{
      source: body.nodes[1].id, target: body.nodes[0].id, verb: 'supports', rationale: 'Support described in the memo',
    }] }, 201);
    fireEvent.click(screen.getByRole('button', { name: 'Suggest connections' }));
    await waitFor(() => expect(storedProject().graph.edges).toHaveLength(initialEdgeCount + 1));
    expect(storedProject().graph.edges.find((edge) => edge.verb === 'supports')).toMatchObject({
      status: 'confirmed', claimState: 'inference', reviewDecision: 'pending',
    });
    expect(screen.getByRole('heading', { name: 'Systems map' })).toBeVisible();
  });


  it('adds pending suggestions from an existing choice-stage project under the automatic default', async () => {
    const project = projectWithMemoReview();
    project.stage = 2;
    project.instructor.requireStudentConfirmation = false;
    const source = project.preflight.memoReview.nodes;
    project.candidates = {
      nodes: source.map((node) => ({
        ...node, id: stableId('node', node.label), x: 100, y: 100, status: 'pending', claimState: 'inference',
        origin: 'model suggestion', reviewDecision: 'pending', notes: '',
        annotations: {
          analytical: { id: stableId('annotation', node.label + ':analytical'), text: '' },
          evidence: { id: stableId('annotation', node.label + ':evidence'), text: '' },
        },
      })),
      edges: [],
    };
    await resumeSavedProject(project);
    fireEvent.click(workActions().getByRole('button', { name: 'Finish review' }));
    await waitFor(() => expect(storedProject().graph.nodes).toHaveLength(2));
    expect(storedProject().stage).toBe(3);
    expect(storedProject().graph.nodes.every((node) => node.reviewDecision === 'pending')).toBe(true);
  });

  it('adds suggestions to the map by default without recording student confirmation', async () => {
    const project = projectWithMemoReview();
    project.instructor.requireStudentConfirmation = false;
    await resumeSavedProject(project);

    expect(screen.getByRole('checkbox', { name: 'Add suggestions automatically' })).toBeChecked();
    fireEvent.click(memoNextAction());
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    await waitFor(() => {
      const stored = storedProject();
      expect(stored.graph.nodes).toHaveLength(2);
      expect(stored.graph.edges).toHaveLength(0);
      expect([...stored.graph.nodes, ...stored.graph.edges].every((item) => item.status === 'confirmed' && item.claimState === 'inference' && item.reviewDecision === 'pending')).toBe(true);
      expect(stored.stage).toBe(3);
    });
  });

  it('carries only discrete Micro actors and objects from a structured review into the map', async () => {
    const project = createDefaultProject();
    project.instructor.requireStudentConfirmation = true;
    project.submission.text = 'Adult Participants face delays when the Accessible Van Program is unavailable.';
    project.stage = 1;
    project.furthestStage = 1;
    const review = {
      guidance: [{ point: 'The memo names participants and a transportation program.' }],
      nodes: [
        { label: 'Adult Participants', type: 'person', scale: 'micro', evidence: project.submission.text },
        { label: 'Accessible van', type: 'object', scale: 'micro', evidence: project.submission.text },
      ],
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
    fireEvent.click(screen.getByRole('button', { name: 'Continue →', exact: true }));
    expect(await screen.findByRole('heading', { name: 'Suggestions' })).toBeVisible();

    const expectedLabels = ['Adult Participants', 'Accessible van'];
    expect(candidateLabels()).toEqual(expectedLabels);
    await waitFor(() => {
      expect(storedProject().candidates.nodes.map(({ label }) => label)).toEqual(expectedLabels);
      expect(storedProject().candidates.nodes.every((node) => node.scale === 'micro')).toBe(true);
      expect(storedProject().candidates.nodes.every((node) => node.status === 'pending' && node.claimState === 'inference')).toBe(true);
      expect(storedProject().candidates.edges).toEqual([]);
    });

    acceptAllCandidates();
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    await waitFor(() => {
      expect(storedProject().graph.nodes.map(({ label }) => label)).toEqual(expectedLabels);
      expect(storedProject().graph.edges).toEqual([]);
    });
    expect([...document.querySelectorAll('.graph-node')].map((node) => node.getAttribute('data-full-label'))).toEqual(expectedLabels);
  });

  it('uses the scale-aware model review as the complete Micro candidate set', async () => {
    const project = createDefaultProject();
    project.instructor.requireStudentConfirmation = true;
    project.submission.text = `Brief memo — u/DalekSupreme23

From 2020–2024, this user posted in r/CUNY every calendar year—eight submissions total. They primarily sought peer help navigating CUNY: delayed diplomas, tuition payment plans, COVID testing, course scheduling, instructors, and registration.

* Exosphere: Strong coverage of administrative systems that shape student life—graduation processing, billing, testing requirements, registration, and limited course availability.
* Macrosphere: Their 2023 account connects CUNY’s affordability/flexibility promise to broader economic pressures: employment is necessary, yet daytime scheduling makes completing a degree difficult.

Overall, the posting history documents a working student repeatedly turning to Reddit when institutional systems were unclear or incompatible with work.`;
    project.stage = 1;
    project.furthestStage = 1;
    const review = {
      guidance: [{ point: 'The memo names the student and the peer setting they use directly.' }],
      nodes: [
        { label: 'u/DalekSupreme23', type: 'person', scale: 'micro', evidence: 'This user posted in r/CUNY every calendar year.' },
        { label: 'Reddit peer group', type: 'group', scale: 'micro', evidence: 'They primarily sought peer help navigating CUNY.' },
      ],
      connections: [],
      example: null,
      readiness: { ready: true, note: 'The memo supports two Micro nodes.' },
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
    fireEvent.click(screen.getByRole('button', { name: 'Continue →', exact: true }));
    expect(await screen.findByRole('heading', { name: 'Suggestions' })).toBeVisible();

    const expectedLabels = review.nodes.map(({ label }) => label);
    expect(candidateLabels()).toEqual(expectedLabels);
    expect(screen.queryByDisplayValue('Strong Coverage of Administrative Systems')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Student Life—graduation Processing')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(storedProject().candidates.nodes.map(({ label }) => label)).toEqual(expectedLabels);
      expect(storedProject().candidates.edges).toEqual([]);
    });
  });

  it('rejects the entire memo review instead of filtering out a clause-like Micro node', async () => {
    const project = createDefaultProject();
    const clauseLabel = 'Adult Participants face delays when the Accessible Van Program is unavailable.';
    const discreteLabel = 'Accessible van';
    project.submission.text = 'transportation access is delayed.';
    project.stage = 1;
    project.furthestStage = 1;
    preflightEvaluationResponder = (body) => jsonResponse({
      evaluation: evaluationRecord(body, {
        review: {
          guidance: [{ point: 'The memo names a transportation issue.' }],
          nodes: [
            { label: clauseLabel, type: 'event', scale: 'micro', evidence: clauseLabel },
            { label: discreteLabel, type: 'object', scale: 'micro', evidence: clauseLabel },
          ],
          connections: [],
          example: null,
          readiness: { ready: false, note: 'Review the proposed elements.' },
        },
      }),
    }, 201);

    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Guidance could not be completed. Try again.');
    expect(storedProject().preflight).toBeNull();
    expect(screen.queryByText(clauseLabel)).not.toBeInTheDocument();
    expect(screen.queryByText(discreteLabel)).not.toBeInTheDocument();
  });

  it('commits a Meso relationship between exact carried Micro IDs with editable wording', async () => {
    const project = createDefaultProject();
    project.instructor.requireStudentConfirmation = true;
    const microNodes = extractCandidates(project.submission).nodes.slice(0, 2)
      .map((node, index) => ({ ...node, type: index ? 'setting' : 'person', scale: 'micro', status: 'confirmed', claimState: 'student interpretation' }));
    microNodes[0].label = 'Renamed family navigator';
    expect(microNodes[0].id).not.toBe(stableId('node', microNodes[0].label));
    project.activeScale = 'meso';
    project.releasedScales = ['micro', 'meso'];
    project.graph = { nodes: microNodes, edges: [] };
    project.candidates = { nodes: [], edges: [] };
    project.stage = 1;
    project.furthestStage = 1;
    const review = memoReviewFixture('meso', microNodes);
    const evaluation = evaluationRecord(evaluationPayloadFixture(project), { review });
    project.preflight = {
      memoReview: structuredClone(review),
      configurationSnapshot: structuredClone(evaluation.configSnapshot),
      evaluation: { evaluationId: evaluation.id, runtime: evaluation.runtime, createdAt: evaluation.createdAt, expiresAt: evaluation.expiresAt },
      sourceFingerprint: project.submission.fingerprint || stableId('src', project.submission.text),
    };
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Continue →', exact: true }));
    expect(await screen.findByRole('heading', { name: 'Suggestions' })).toBeVisible();
    openDetails('.carried-node-summary');
    const carried = screen.getByLabelText('Micro-level items available for connections');
    microNodes.forEach(node => expect(within(carried).getByText(node.label)).toBeVisible());
    fireEvent.change(screen.getByRole('combobox', { name: 'Suggestion type' }), { target: { value: 'edges' } });
    const editor = screen.getByRole('textbox', { name: 'Direct connection' });
    expect(editor).toHaveValue('coordinates with');
    fireEvent.change(editor, { target: { value: 'coordinates access with' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => {
      expect(storedProject().candidates.nodes).toEqual([]);
      expect(storedProject().candidates.edges).toEqual([expect.objectContaining({
        source: microNodes[0].id, target: microNodes[1].id, scale: 'meso', verb: 'coordinates access with',
      })]);
    });
    fireEvent.click(within(editor.closest('article')).getByRole('button', { name: 'Add to map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    await waitFor(() => expect(storedProject().stage).toBe(3));
    expect(storedProject().graph.nodes).toEqual(microNodes);
    expect(storedProject().graph.edges).toEqual([expect.objectContaining({
      source: microNodes[0].id, target: microNodes[1].id, scale: 'meso', verb: 'coordinates access with', status: 'confirmed',
    })]);
    expect(document.querySelectorAll('.graph-edge[data-edge-scale="meso"]')).toHaveLength(1);
  });


  it('keeps an existing Micro node in Micro when an Exosphere memo names it again', async () => {
    const project = createDefaultProject();
    project.instructor.requireStudentConfirmation = true;
    const existing = {
      ...extractCandidates(project.submission).nodes.find((node) => node.scale === 'micro'),
      status: 'confirmed',
      claimState: 'student interpretation',
    };
    existing.label = 'Renamed family support setting';
    existing.type = 'setting';
    const originalIdentity = { id: existing.id, label: existing.label, scale: existing.scale };
    const outerLabel = 'New York City Department of Community Access';
    project.activeScale = 'exosphere';
    project.releasedScales = ['micro', 'meso', 'exosphere'];
    project.graph = { nodes: [existing], edges: [] };
    project.candidates = { nodes: [], edges: [] };
    project.instructor.requireStudentConfirmation = true;
    project.stage = 1;
    project.furthestStage = 1;
    const review = {
      guidance: [{ point: 'The memo names an indirect institutional influence.' }],
      nodes: [
        { label: outerLabel, type: 'agency', scale: 'exosphere', evidence: 'The memo names the department.', basis: 'memo' },
      ],
      connections: [],
      example: null,
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
    expect(screen.getByRole('heading', { name: 'Suggestions' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Continue →', exact: true }));
    expect(screen.queryByText('Add decision setting', { selector: 'summary' })).toBeNull();
    await waitFor(() => {
      const stored = storedProject();
      expect(stored.candidates.nodes.some((node) => node.id === existing.id)).toBe(false);
      expect(stored.candidates.nodes.find((node) => node.label === outerLabel)).toMatchObject({ scale: 'exosphere', status: 'pending', claimState: 'inference' });
      expect(stored.candidates.edges).toEqual([]);
    });

    const institutionRow = screen.getByRole('textbox', { name: 'Node label' }).closest('article');
    fireEvent.click(within(institutionRow).getByRole('button', { name: 'Add to map' }));
    await waitFor(() => expect(storedProject().candidates.nodes.find((node) => node.label === outerLabel)).toMatchObject({ status: 'confirmed' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Suggestion type' }), { target: { value: 'edges' } });
    fireEvent.click(workActions().getByRole('button', { name: 'Finish review' }));
    await waitFor(() => expect(storedProject().stage).toBe(3));
    expect(storedProject().graph.nodes.find((node) => node.id === existing.id)).toMatchObject(originalIdentity);
    expect(storedProject().graph.nodes.filter((node) => node.id === existing.id)).toHaveLength(1);
    const committed = storedProject();
    expect(committed.graph.edges).toEqual([]);
  });

  it('preserves renamed Micro nodes and their Meso scope when Exo candidate ids collide', async () => {
    const project = makeMapProject('exosphere');
    const mesosystem = project.graph.nodes.find((node) => node.scale === 'meso');
    const scopedMicroNodes = mesosystem.scopeNodeIds.map((id) => project.graph.nodes.find((node) => node.id === id));
    scopedMicroNodes[0].label = 'Metropolitan Hospital clinic';
    scopedMicroNodes[1].label = 'East Harlem Disability Services center';
    const targetTemplate = structuredClone(scopedMicroNodes[0]);
    const pathwayTarget = {
      ...targetTemplate,
      id: 'node_community_food_pantry_a',
      label: 'Community Food Pantry Alpha',
      x: targetTemplate.x + 180,
      y: targetTemplate.y + 180,
      annotations: {
        analytical: { id: 'annotation_community_food_pantry_a_analytical', text: '' },
        evidence: { id: 'annotation_community_food_pantry_a_evidence', text: '' },
      },
    };
    project.graph.nodes.push(pathwayTarget);
    project.graph.edges.forEach((edge) => {
      if (edge.source === scopedMicroNodes[0].id) edge.sourceLabel = scopedMicroNodes[0].label;
      if (edge.target === scopedMicroNodes[0].id) edge.targetLabel = scopedMicroNodes[0].label;
      if (edge.source === scopedMicroNodes[1].id) edge.sourceLabel = scopedMicroNodes[1].label;
      if (edge.target === scopedMicroNodes[1].id) edge.targetLabel = scopedMicroNodes[1].label;
    });
    const pendingCollision = {
      ...structuredClone(scopedMicroNodes[0]),
      label: 'New York City Clinic Administration Office',
      type: 'agency',
      scale: 'exosphere',
      status: 'pending',
      claimState: 'inference',
    };
    const acceptedCollision = {
      ...structuredClone(scopedMicroNodes[1]),
      label: 'New York State Disability Services Office',
      type: 'agency',
      scale: 'exosphere',
      status: 'confirmed',
      claimState: 'student interpretation',
    };
    const pathwayId = 'edge_exo_collision_to_food_pantry';
    project.candidates = {
      nodes: [pendingCollision, acceptedCollision],
      edges: [{
        id: pathwayId,
        source: acceptedCollision.id,
        target: pathwayTarget.id,
        sourceLabel: acceptedCollision.label,
        targetLabel: pathwayTarget.label,
        verb: 'sets rules for',
        scale: 'exosphere',
        status: 'confirmed',
        claimState: 'student interpretation',
        notes: '',
        directed: true,
        rationale: 'The office sets rules for the pantry setting.',
        evidence: 'Memo sentence 4',
        annotation: { id: 'annotation_edge_exo_collision_to_food_pantry', text: '' },
      }],
    };
    project.stage = 2;
    project.furthestStage = 2;

    expect(() => parseProject(serializeProject(project))).not.toThrow();
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    await waitFor(() => expect(storedProject().stage).toBe(3));

    const stored = storedProject();
    scopedMicroNodes.forEach((node) => expect(stored.graph.nodes.find((item) => item.id === node.id)).toMatchObject({
      label: node.label,
      scale: 'micro',
      status: 'confirmed',
      claimState: 'student interpretation',
    }));
    expect(stored.graph.nodes.find((node) => node.id === mesosystem.id)).toMatchObject({
      scale: 'meso',
      status: 'confirmed',
      claimState: 'student interpretation',
      scopeNodeIds: mesosystem.scopeNodeIds,
    });
    const committedInstitution = stored.graph.nodes.find((node) => node.label === acceptedCollision.label);
    expect(committedInstitution).toMatchObject({ scale: 'exosphere', status: 'confirmed' });
    expect(committedInstitution.id).not.toBe(acceptedCollision.id);
    expect(stored.graph.nodes.some((node) => node.label === pendingCollision.label)).toBe(false);
    expect(stored.graph.edges.find((edge) => edge.verb === 'sets rules for' && edge.target === pathwayTarget.id)).toMatchObject({
      source: committedInstitution.id,
      scale: 'exosphere',
      status: 'confirmed',
    });
  });

  it('renames a mapped Micro candidate everywhere before reopening the cumulative map', async () => {
    const project = makeMapProject('exosphere');
    const relationship = project.graph.edges.find((edge) => edge.scale === 'meso');
    const mappedNode = project.graph.nodes.find((node) => node.id === relationship.source);
    const priorLabel = mappedNode.label;
    const revisedLabel = 'Peer navigator Alpha';
    project.activeScale = 'micro';
    project.stage = 2;
    project.furthestStage = 4;
    project.levelProgress.micro = { stage: 2, reflection: '' };
    project.candidates = {
      nodes: [structuredClone(mappedNode)],
      edges: [structuredClone(relationship)],
    };
    await resumeSavedProject(project);

    fireEvent.change(screen.getByDisplayValue(priorLabel), { target: { value: revisedLabel } });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => {
      const stored = storedProject();
      expect(stored.candidates.nodes.find((node) => node.id === mappedNode.id)?.label).toBe(revisedLabel);
      expect(stored.graph.nodes.find((node) => node.id === mappedNode.id)?.label).toBe(revisedLabel);
      expect(stored.candidates.edges.filter((edge) => edge.source === mappedNode.id || edge.target === mappedNode.id)
        .every((edge) => edge.source === mappedNode.id ? edge.sourceLabel === revisedLabel : edge.targetLabel === revisedLabel)).toBe(true);
      expect(stored.graph.edges.filter((edge) => edge.source === mappedNode.id || edge.target === mappedNode.id)
        .every((edge) => edge.source === mappedNode.id ? edge.sourceLabel === revisedLabel : edge.targetLabel === revisedLabel)).toBe(true);
      expect(() => validateProject(stored)).not.toThrow();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    await waitFor(() => expect(storedProject().stage).toBe(3));
    const reopened = storedProject();
    expect(reopened.graph.nodes.find((node) => node.id === mappedNode.id)?.label).toBe(revisedLabel);
    expect(reopened.graph.nodes.some((node) => node.scale === 'meso')).toBe(true);
    expect(reopened.graph.nodes.some((node) => node.scale === 'exosphere')).toBe(true);
    expect(() => validateProject(reopened)).not.toThrow();
    expect(() => validateProject(createPortableProject(reopened))).not.toThrow();
  });

  it('blocks removing a mapped Micro setting type while later-level work depends on it', async () => {
    const project = makeMapProject('exosphere');
    const exospherePathway = project.graph.edges.find((edge) => edge.scale === 'exosphere');
    const mappedSetting = project.graph.nodes.find((node) => node.id === exospherePathway.target);
    const mesosystem = project.graph.nodes.find((node) => node.scale === 'meso' && (node.scopeNodeIds || []).includes(mappedSetting.id));
    expect(MICRO_SETTING_NODE_TYPES).toContain(mappedSetting.type);
    expect(mesosystem).toBeTruthy();
    project.activeScale = 'micro';
    project.stage = 2;
    project.furthestStage = 4;
    project.levelProgress.micro = { stage: 2, reflection: '' };
    project.candidates = { nodes: [structuredClone(mappedSetting)], edges: [] };
    await resumeSavedProject(project);

    fireEvent.change(screen.getByRole('combobox', { name: 'Node type' }), { target: { value: 'person' } });
    expect(screen.getByText(/Review or remove connected map work before changing this setting type/)).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Node type' })).toHaveValue(mappedSetting.type);
    expect(storedProject().candidates.nodes[0].type).toBe(mappedSetting.type);
    expect(storedProject().graph.nodes.find((node) => node.id === mappedSetting.id)?.type).toBe(mappedSetting.type);
    expect(() => validateProject(storedProject())).not.toThrow();

    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    await waitFor(() => expect(storedProject().stage).toBe(3));
    const reopened = storedProject();
    expect(reopened.graph.nodes.find((node) => node.id === mappedSetting.id)?.type).toBe(mappedSetting.type);
    expect(reopened.graph.nodes.find((node) => node.id === mesosystem.id)?.scopeNodeIds).toContain(mappedSetting.id);
    expect(reopened.graph.edges.find((edge) => edge.id === exospherePathway.id)).toMatchObject({
      source: exospherePathway.source,
      target: mappedSetting.id,
    });
    expect(() => validateProject(reopened)).not.toThrow();
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
    openProjectFromList('NYC systems and assets map');
    expect(await screen.findByRole('heading', { name: 'Memo' })).toBeVisible();
    await waitFor(() => expect(sessionReads).toBeGreaterThanOrEqual(2));
    expect(screen.queryByRole('heading', { name: 'Systems Mapping' })).not.toBeInTheDocument();
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
    openProjectFromList('NYC systems and assets map');
    expect(await screen.findByRole('heading', { name: 'Systems Mapping' })).toBeVisible();
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
    openProjectFromList(project.title);
    fireEvent.click(screen.getByRole('button', { name: 'Memo review' }));
    const recovery = await screen.findByRole('button', { name: 'Recover project' });
    fireEvent.click(recovery);
    expect(screen.getByRole('dialog', { name: 'Save recovery' })).toBeVisible();
    expect(screen.getByText(/You can download a copy, keep working without saving, or try saving again/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Download private recovery' })).toBeVisible();
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
    fireEvent.click(screen.getByRole('button', { name: 'Next suggestion' }));
    fireEvent.click(within(document.querySelector('.candidate-list article')).getByRole('button', { name: 'Add to map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    await waitFor(() => {
      expect(storedProject().graph.nodes.find((node) => node.id === project.candidates.nodes[0].id)).toMatchObject({ status: 'rejected', claimState: 'retired' });
    });
  });

  it('keeps a direct Micro relationship whose verb is outside the course vocabulary when the student chooses Keep', async () => {
    const project = createDefaultProject();
    project.activeScale = 'meso';
    project.releasedScales = ['micro', 'meso'];
    const extracted = extractCandidates(project.submission);
    const nodes = extracted.nodes.slice(0, 2).map((node) => ({ ...node, scale: 'micro', status: 'confirmed', claimState: 'student interpretation' }));
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
      scale: 'meso',
    };
    project.candidates = { nodes: [], edges: [edge] };
    project.graph = { nodes, edges: [] };
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);

    fireEvent.change(screen.getByRole('combobox', { name: 'Suggestion type' }), { target: { value: 'edges' } });
    const row = screen.getAllByRole('article')[0];
    fireEvent.click(within(row).getByRole('button', { name: 'Add to map' }));
    expect(within(row).getByRole('button', { name: 'Add to map' })).toHaveClass('is-active');
    await waitFor(() => expect(storedProject().candidates.edges[0]).toMatchObject({ status: 'confirmed', claimState: 'student interpretation' }));

    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));

    await waitFor(() => expect(storedProject().stage).toBe(3));
    const committed = storedProject().graph.nodes;
    expect(committed.map(({ id, x, y }) => ({ id, x, y })))
      .toEqual(expected.map(({ id, x, y }) => ({ id, x, y })));
    expect(new Set(committed.map(({ x, y }) => `${x},${y}`)).size).toBe(committed.length);
  });

  it('places a colliding new Exo node while preserving every existing map coordinate', async () => {
    const project = makeMapProject('exosphere');
    project.layout = {manualNodeIds: project.graph.nodes.map(node => node.id)};
    const micro = project.graph.nodes.find(node => node.scale === 'micro');
    const candidate = {
      ...structuredClone(micro),
      id: 'node_added_borough_access_office',
      label: 'Borough Access Office',
      type: 'agency',
      scale: 'exosphere',
      status: 'confirmed',
      claimState: 'student interpretation',
      annotations: {
        analytical: { id: 'annotation_added_borough_access_office_analytical', text: '' },
        evidence: { id: 'annotation_added_borough_access_office_evidence', text: '' },
      },
    };
    const priorPositions = project.graph.nodes.map(({ id, x, y }) => ({ id, x, y }));
    project.candidates = { nodes: [candidate], edges: [] };
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    await waitFor(() => expect(storedProject().stage).toBe(3));
    const saved = storedProject();
    expect(saved.graph.nodes.filter(node => node.id !== candidate.id).map(({ id, x, y }) => ({ id, x, y }))).toEqual(priorPositions);
    const added = saved.graph.nodes.find(node => node.id === candidate.id);
    expect(added).toMatchObject({ label: candidate.label, scale: 'exosphere' });
    expect({ x: added.x, y: added.y }).not.toEqual({ x: micro.x, y: micro.y });
    for (const prior of priorPositions) {
      expect(Math.abs(added.x - prior.x) >= 224 || Math.abs(added.y - prior.y) >= 72).toBe(true);
    }
    cleanup();
    const obstructed = structuredClone(project);
    const blocker = obstructed.graph.nodes.find(node => node.scale === 'micro' && node.id !== micro.id);
    Object.assign(blocker, { x: added.x, y: added.y });
    const obstructedPositions = obstructed.graph.nodes.map(({ id, x, y }) => ({ id, x, y }));
    await resumeSavedProject(obstructed);
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    await waitFor(() => expect(storedProject().stage).toBe(3));
    const retained = storedProject();
    expect(retained.graph.nodes.filter(node => node.id !== candidate.id).map(({ id, x, y }) => ({ id, x, y }))).toEqual(obstructedPositions);
    const separatelyPlaced = retained.graph.nodes.find(node => node.id === candidate.id);
    for (const prior of obstructedPositions.filter(item => obstructed.graph.nodes.find(node => node.id === item.id)?.scale !== 'meso')) {
      expect(Math.abs(separatelyPlaced.x - prior.x) >= 224 || Math.abs(separatelyPlaced.y - prior.y) >= 72).toBe(true);
    }
    fireEvent.change(screen.getByRole('combobox', { name: 'Work level' }), { target: { value: 'micro' } });
    for (const node of retained.graph.nodes.filter(node => node.scale === 'micro')) {
      expect(storedProject().graph.nodes.find(item => item.id === node.id)).toMatchObject({ x: node.x, y: node.y });
    }
  });

  it('records a manually added direct relationship in Meso', async () => {
    const project = await openMapProject(makeMapProject('meso'));
    const microNodes = project.graph.nodes.filter((node) => node.scale === 'micro');
    const inspector = openMapInspector();
    fireEvent.click(within(inspector).getByRole('button', { name: 'Add' }));
    const addActions = document.getElementById('inspector-add-actions');
    fireEvent.click(within(addActions).getByRole('button', { name: 'Relationship' }));
    const addForm = screen.getByRole('heading', { name: 'New relationship' }).parentElement;
    fireEvent.change(within(addForm).getByLabelText('From'), { target: { value: microNodes[0].id } });
    fireEvent.change(within(addForm).getByLabelText('Relationship'), { target: { value: 'coordinates with' } });
    fireEvent.change(within(addForm).getByLabelText('To'), { target: { value: microNodes[1].id } });
    expect(within(addForm).queryByLabelText('Evidence or question')).not.toBeInTheDocument();
    fireEvent.click(within(addForm).getByRole('button', { name: 'Add relationship' }));
    await waitFor(() => expect(storedProject().graph.edges.at(-1)).toMatchObject({
      source: microNodes[0].id,
      target: microNodes[1].id,
      scale: 'meso',
      verb: 'coordinates with',
    }));
  });

  it('offsets two visible Micro relationships between the same node pair in the network map', async () => {
    const project = makeMapProject('meso');
    const baseEdge = structuredClone(project.graph.edges.find((edge) => edge.scale === 'meso'));
    const endpointIds = new Set([baseEdge.source, baseEdge.target]);
    const relationships = [
      { id: 'edge_parallel_documents', verb: 'documents access barriers for' },
      { id: 'edge_parallel_coordinates', verb: 'coordinates support planning with' },
    ].map(({ id, verb }) => ({
      ...structuredClone(baseEdge),
      id,
      verb,
      annotation: { id: `annotation_${id}`, text: '' },
    }));
    project.graph = {
      nodes: project.graph.nodes.filter((node) => endpointIds.has(node.id)),
      edges: relationships,
    };

    await openMapProject(project);

    expect(mapCanvas()).toHaveAttribute('data-map-mode', 'network');
    fireEvent.keyDown(document.querySelector(`[data-graph-id="${baseEdge.source}"]`), {key:'Enter'});
    const labels = relationships.map((edge) => document.querySelector(`.graph-edge-label[data-edge-id="${edge.id}"]`));
    const paths = relationships.map((edge) => document.querySelector(`.graph-edge[data-graph-id="${edge.id}"] .edge-line`).getAttribute('d'));
    const anchors = labels.map((label) => `${label.getAttribute('data-anchor-x')},${label.getAttribute('data-anchor-y')}`);
    const labelBounds = labels.map((label) => svgRectBounds(label.querySelector('.edge-label-bg')));

    labels.forEach((label, index) => {
      expect(label).toHaveAttribute('data-edge-route', 'attached');
      expect(label).toHaveAttribute('data-full-label', relationships[index].verb);
      expect(svgTextLines(label.querySelector('.edge-label')).join('')).toBe(relationships[index].verb);
      expect(label).not.toHaveTextContent('…');
    });
    expect(new Set(anchors)).toHaveLength(relationships.length);
    expect(new Set(paths)).toHaveLength(relationships.length);
    expect(rectsIntersect(labelBounds[0], labelBounds[1])).toBe(false);
  });

  it('keeps a dense Meso overview stable and lights every incident relationship on selection', async () => {
    const project = makeDenseFocusedMesoProject(5);
    const graphBefore = structuredClone(project.graph);
    await openMapProject(project);
    if (storedProject().releasedScales.length > 1) fireEvent.change(mapLayer(), { target: { value: 'meso' } });
    fireEvent.click(mapTool('Arrange map'));
    await waitFor(() => expect(eventRequests('map_arranged')).toHaveLength(1));
    fireEvent.click(mapTool('Fit map'));
    fireEvent.click(mapTool('Full screen map'));

    expect(document.querySelectorAll('.graph-edge')).toHaveLength(project.graph.edges.length);
    expect(document.querySelectorAll('.graph-edge-label')).toHaveLength(0);
    expect(document.querySelector('[data-ecology-layer="meso"]')).toBeNull();

    const renderedBefore = [...document.querySelectorAll('.graph-node')].map((node) => node.getAttribute('data-graph-id'));
    const renderedEdgeIds = new Set([...document.querySelectorAll('.graph-edge')].map((edge) => edge.getAttribute('data-graph-id')));
    const incident = project.graph.edges.filter((edge) => renderedEdgeIds.has(edge.id) && (edge.source === 'node-dense-focus' || edge.target === 'node-dense-focus'));
    const inspector = openNodeInspector('node-dense-focus');
    fireEvent.click(within(inspector).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(inspector).not.toHaveAttribute('aria-hidden'));

    // Desktop keeps the whole band on the canvas, dims what is outside the one-hop
    // neighbourhood, and labels every incident relationship at once.
    expect(mapCanvas()).not.toHaveClass('is-detail-view');
    expect([...document.querySelectorAll('.graph-node')].map((node) => node.getAttribute('data-graph-id'))).toEqual(renderedBefore);
    const labels = [...document.querySelectorAll('.graph-edge-label')];
    expect(labels.map((label) => label.getAttribute('data-edge-id')).sort()).toEqual(incident.map((edge) => edge.id).sort());
    labels.forEach((label) => {
      const edge = incident.find((candidate) => candidate.id === label.getAttribute('data-edge-id'));
      expect(svgTextLines(label.querySelector('.edge-label')).join('')).toBe(edge.verb);
    });
    const neighbourhood = new Set(['node-dense-focus', ...incident.flatMap((edge) => [edge.source, edge.target])]);
    [...document.querySelectorAll('.graph-node')].forEach((node) => {
      if (neighbourhood.has(node.getAttribute('data-graph-id'))) expect(node).not.toHaveClass('is-dimmed');
      else expect(node).not.toHaveClass('is-dimmed');
    });
    [...document.querySelectorAll('.graph-edge')].forEach((edge) => {
      if (incident.some((candidate) => candidate.id === edge.getAttribute('data-graph-id'))) expect(edge).not.toHaveClass('is-dimmed');
      else expect(edge).not.toHaveClass('is-dimmed');
    });
    expect(storedProject().graph.nodes.map(({ id, label, type, scale }) => ({ id, label, type, scale })))
      .toEqual(graphBefore.nodes.map(({ id, label, type, scale }) => ({ id, label, type, scale })));
  });

  it('adds larger-scale Exo nodes without requiring a premature relationship', async () => {
    const project = await openMapProject(makeMapProject('exosphere'));
    const original = structuredClone(project.graph);
    const inspector = openMapInspector();
    fireEvent.click(within(inspector).getByRole('button', { name: 'Add' }));
    fireEvent.click(within(document.getElementById('inspector-add-actions')).getByRole('button', { name: 'Node' }));
    const form = screen.getByRole('heading', { name: 'New node' }).parentElement;
    fireEvent.change(within(form).getByLabelText('Label'), { target: { value: 'Regional transit funding' } });
    fireEvent.change(within(form).getByLabelText('Type'), { target: { value: 'resource' } });
    fireEvent.change(within(form).getByLabelText('Evidence or question'), { target: { value: 'Investigate the regional funding decision.' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add node' }));
    await waitFor(() => expect(storedProject().graph.nodes).toHaveLength(original.nodes.length + 1));
    expect(storedProject().graph.nodes.find(node => node.label === 'Regional transit funding')).toMatchObject({ scale: 'exosphere', type: 'resource', status: 'confirmed' });
    expect(storedProject().graph.edges).toEqual(original.edges);
    original.nodes.forEach(node => expect(storedProject().graph.nodes.find(n => n.id === node.id)).toEqual(node));
  });

  it('surfaces Micro participation and setting membership in manual add and node inspection', async () => {
    const project = makeMapProject('micro');
    const setting = project.graph.nodes.find((node) => node.scale === 'micro' && MICRO_SETTING_NODE_TYPES.includes(node.type));
    setting.focalParticipation = 'direct';
    setting.settingNodeIds = [];
    await openMapProject(project);

    const inspector = openMapInspector();
    fireEvent.click(within(inspector).getByRole('button', { name: 'Add' }));
    fireEvent.click(within(document.getElementById('inspector-add-actions')).getByRole('button', { name: 'Node' }));
    const addForm = screen.getByRole('heading', { name: 'New node' }).parentElement;
    expect(within(addForm).getByRole('combobox', { name: 'Involvement of this item' })).toHaveValue('direct');
    fireEvent.change(within(addForm).getByLabelText('Label'), { target: { value: 'Peer navigator' } });
    fireEvent.change(within(addForm).getByRole('combobox', { name: 'Involvement of Peer navigator' }), { target: { value: 'indirect' } });
    fireEvent.change(within(addForm).getByRole('combobox', { name: 'Setting for Peer navigator' }), { target: { value: setting.id } });
    fireEvent.change(within(addForm).getByLabelText('Evidence or question'), { target: { value: 'The memo identifies the peer navigator in this setting.' } });
    fireEvent.click(within(addForm).getByRole('button', { name: 'Add node' }));

    await waitFor(() => expect(storedProject().graph.nodes.find((node) => node.label === 'Peer navigator')).toMatchObject({
      focalParticipation: 'indirect',
      settingNodeIds: [setting.id],
      origin: 'student entry',
    }));
    const added = storedProject().graph.nodes.find((node) => node.label === 'Peer navigator');
    expect(within(inspector).queryByRole('combobox', { name: 'Involvement of Peer navigator' })).toBeNull();
    expect(storedProject().graph.nodes.find(node => node.id === added.id)).toMatchObject({ focalParticipation: 'indirect', settingNodeIds: [setting.id] });
    const settingRegion = document.querySelector(`[data-setting-region="${setting.id}"]`);
    expect(settingRegion).toHaveAttribute('data-member-count', '1');
    expect(settingRegion.getAttribute('d')).toMatch(/^M /);
    // The Setting choice is drawn as a line from the new node to its setting.
    const settingLine = document.querySelector(`[data-setting-line="${added.id}:${setting.id}"]`);
    expect(settingLine).toHaveAttribute('data-setting-of', added.id);
    expect(Number(settingLine.getAttribute('x1'))).not.toBeNaN();
    expect(document.querySelectorAll('[data-setting-line]')).toHaveLength(1);
  });

  it('offers Micro node creation and Meso relationship creation', async () => {
    await openMapProject(makeMapProject('micro'));
    let inspector = openMapInspector();
    fireEvent.click(within(inspector).getByRole('button', { name: 'Add' }));
    const actions = document.getElementById('inspector-add-actions');
    expect(within(actions).getByRole('button', { name: 'Node' })).toBeVisible();
    expect(within(actions).queryByRole('button', { name: 'Relationship' })).toBeNull();
    cleanup();
    const meso = await openMapProject(makeMapProject('meso'));
    expect(screen.queryByRole('button', { name: /^Connect from / })).toBeNull();
    const source = meso.graph.nodes.find(node => node.scale === 'micro');
    openNodeInspector(source.id);
    expect(screen.getByRole('button', { name: `Connect from ${source.label}`, exact: true })).toBeEnabled();
  });

  it('renders all Micro nodes and Meso relationships while preserving legacy linkage records', async () => {
    const project = makeMapProject('meso');
    const legacy = project.graph.nodes.find(node => node.scale === 'meso');
    const graphBefore = structuredClone(project.graph);
    await openMapProject(project);
    expect(mapCanvas()).toHaveAttribute('data-map-mode', 'network');
    expect(mapLayer()).toHaveValue('meso');
    expect(document.querySelector('[data-ecology-layer="meso"]')).toBeNull();
    expect(document.querySelector(`[data-graph-id="${legacy.id}"]`)).toBeNull();
    expect(document.querySelectorAll('.graph-node')).toHaveLength(project.graph.nodes.filter(node => node.scale === 'micro').length);
    expect(document.querySelectorAll('.graph-edge')).toHaveLength(project.graph.edges.length);
    expect(storedProject().graph).toEqual(graphBefore);
  });

  it.each(['exosphere', 'macrosphere'])('renders the %s ecological backdrop and changes layer filters without mutating graph data', async (activeScale) => {
    const project = await openMapProject(makeMapProject(activeScale));
    const graphBefore = structuredClone(storedProject().graph);
    const scale = mapLayer();
    const active = { nodes: project.graph.nodes.filter(node => node.scale !== 'meso' && SCALE_ORDER.indexOf(node.scale) <= SCALE_ORDER.indexOf(activeScale)), edges: project.graph.edges.filter(edge => SCALE_ORDER.indexOf(edge.scale) <= SCALE_ORDER.indexOf(activeScale)) };
    const meso = graphForScale(project, 'meso');
    const all = graphForScale(project, 'all');
    const inspector = screen.getByLabelText('Notebook');

    expect(scale).toHaveValue(activeScale);
    fireEvent.change(scale, { target: { value: 'all' } });
    expect(within(scale).getAllByRole('option').map((option) => option.value)).toEqual(['all', ...project.releasedScales]);
    expect(mapCanvas()).toHaveAttribute('data-map-mode', 'ecology');
    expect(mapCanvas()).toHaveAttribute('aria-label', expect.stringContaining(`All-layers map. ${all.nodes.length} nodes and ${all.edges.length} ${all.edges.length === 1 ? 'connection' : 'connections'}.`));
    fireEvent.change(scale, { target: { value: activeScale } });
    expect(mapCanvas()).toHaveAttribute('aria-label', expect.stringContaining(`${activeScale === 'exosphere' ? 'Exo-level' : 'Macro-level'} map. ${active.nodes.length} nodes and ${active.edges.length} ${active.edges.length === 1 ? 'connection' : 'connections'}.`));
    expect(document.querySelectorAll('[data-ecology-layer]')).toHaveLength(activeScale === 'exosphere' ? 2 : 3);
    expect(Boolean(document.querySelector('[data-ecology-layer="macrosphere"]'))).toBe(activeScale === 'macrosphere');
    expect(document.querySelector('[data-ecology-layer="exosphere"]')).toHaveClass('is-visible');
    expect(document.querySelectorAll('.graph-node.is-dimmed, .graph-edge.is-dimmed')).toHaveLength(0);
    expect(document.querySelectorAll('.graph-edge-label')).toHaveLength(0);
    for (const edge of active.edges) expectAttachedRelationship(edge);
    fireEvent.click(screen.getByRole('button',{name:'Clear highlight',exact:true}));
    expect(screen.getByText(activeScale === 'exosphere'
      ? 'Select an item to inspect its connections'
      : 'Select a condition to view affected items')).toBeVisible();
    expect(inspector).not.toHaveAttribute('aria-hidden');
    expect(inspector).not.toHaveAttribute('inert');
    expect(document.querySelector('.map-layout')).toHaveClass('has-inspector');

    fireEvent.change(scale, { target: { value: 'meso' } });
    expect(scale).toHaveValue('meso');
    expect(mapCanvas()).toHaveAttribute('aria-label', expect.stringContaining(`Meso-level map. ${meso.nodes.length} nodes and ${meso.edges.length} connections.`));
    expect(document.querySelectorAll('.graph-edge-label[data-edge-scale="meso"]')).toHaveLength(0);

    fireEvent.change(scale, { target: { value: 'all' } });
    expect(mapCanvas()).toHaveAttribute('aria-label', expect.stringContaining(`All-layers map. ${all.nodes.length} nodes and ${all.edges.length} ${all.edges.length === 1 ? 'connection' : 'connections'}.`));
    expect(screen.getByText('Select an item to inspect its connections')).toBeVisible();
    expect(document.querySelectorAll('[data-ecology-layer].is-visible')).toHaveLength(activeScale === 'exosphere' ? 2 : 3);
    expect(document.querySelectorAll('.graph-edge-label')).toHaveLength(0);
    expect(document.querySelectorAll('.graph-edge.is-muted')).toHaveLength(0);
    expect(storedProject().graph).toEqual(graphBefore);
  });

  it('opens a progressed map at its current work level with a transient fit without changing the saved viewport', async () => {
    const project = makeMapProject('meso');
    project.releasedScales.push('exosphere');
    project.viewport = { zoom: 0.15, panX: -2400, panY: 1900 };
    const durableViewport = { ...project.viewport };
    await openMapProject(project);

    expect(mapCanvas()).toHaveAttribute('data-map-mode', 'network');
    expect(mapLayer()).toHaveValue('meso');
    await waitFor(() => {
      expect(viewportTransform()).not.toEqual(durableViewport);
      expectVisibleNodesAndConnectionLabelsInsideCanvas();
    });
    expect(storedProject().viewport).toEqual(durableViewport);
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
    const enter = mapTool('Full screen map');

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
    expect(document.querySelector('.notebook-map-tools > summary')).toHaveFocus();
  });

  it('zooms out to 0.15 and keeps keyboard and pointer panning available at the overview limit', async () => {
    const project = makeSixNodeMicroProject();
    project.viewport = { zoom: 1, panX: 0, panY: 0 };
    const graphBefore = structuredClone(project.graph);
    await openMapProject(project);
    const canvas = mapCanvas();
    const zoomOut = mapTool('Zoom out');

    for (let index = 0; index < 12; index += 1) fireEvent.click(zoomOut);
    await waitFor(() => expect(viewportTransform().zoom).toBe(PROJECT_LIMITS.zoomMin));

    expect(screen.queryByRole('button', { name: 'Pan' })).not.toBeInTheDocument();
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
      expect(afterPointerPan.zoom).toBe(PROJECT_LIMITS.zoomMin);
    });
    expect(storedProject().graph).toEqual(graphBefore);
  });

  it('fits visible nodes and connection labels without requiring complete rings in normal and full-screen views', async () => {
    const project = makeMapProject('macrosphere');
    await openMapProject(project);
    fireEvent.change(mapLayer(), { target: { value: 'exosphere' } });
    fireEvent.click(mapTool('Arrange map'));
    await waitFor(() => expect(eventRequests('map_arranged')).toHaveLength(1));

    fireEvent.click(mapTool('Fit map'));
    await waitFor(() => expectVisibleNodesAndConnectionLabelsInsideCanvas());
    expectAttachedRelationship(project.graph.edges.find(edge => document.querySelector(`[data-graph-id="${edge.id}"]`)));
    const fittedFilteredViewport = { ...storedProject().viewport };

    fireEvent.click(mapTool('Full screen map'));
    expect(document.querySelector('.map-stage')).toHaveClass('is-fullscreen');
    await waitFor(() => expectVisibleNodesAndConnectionLabelsInsideCanvas());
    expect(storedProject().viewport).toEqual(fittedFilteredViewport);
    fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }));

    fireEvent.change(mapLayer(), { target: { value: 'all' } });
    await waitFor(() => expect(mapLayer()).toHaveValue('all'));
    fireEvent.click(mapTool('Arrange map'));
    await waitFor(() => expect(eventRequests('map_arranged')).toHaveLength(2));
    fireEvent.click(mapTool('Fit map'));
    await waitFor(() => expectVisibleNodesAndConnectionLabelsInsideCanvas());
    const fittedAllViewport = { ...storedProject().viewport };

    fireEvent.click(mapTool('Full screen map'));
    await waitFor(() => expectVisibleNodesAndConnectionLabelsInsideCanvas());
    expect(storedProject().viewport).toEqual(fittedAllViewport);
  });

  it.each([
    ['desktop', false],
    ['phone', true],
  ])('keeps arranged ecological nodes clear of one another and every layer label on %s', async (_viewport, phone) => {
    if (phone) installPhoneLayout();
    await openMapProject(makeMapProject('exosphere'));
    fireEvent.change(mapLayer(), { target: { value: 'all' } });
    fireEvent.click(mapTool('Arrange map'));
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
    expectNodesInsideEcologyRings();
  });

  it('keeps the three content-sized boundaries stable when zooming and separates their labels', async () => {
    installPhoneLayout(390);
    await openMapProject(makePhoneEcologyWithLegacyScope());
    fireEvent.change(mapLayer(), {target:{value:'all'}});
    const boundaries = () => [...document.querySelectorAll('[data-ecology-layer] ellipse')].map(e=>e.outerHTML);
    const before = boundaries();
    const badges = [...document.querySelectorAll('.ecology-layer__label')].map(g=>translatedRectBounds(g,g.querySelector('rect')));
    expect(badges).toHaveLength(3);
    expect(rectsIntersect(badges[0],badges[1])).toBe(false);
    expectNodesInsideEcologyRings();
    const zoom = viewportTransform().zoom;
    fireEvent.click(mapTool('Zoom out'));
    expect(viewportTransform().zoom).toBeLessThan(zoom);
    expect(boundaries()).toEqual(before);
    expectNodesInsideEcologyRings();
  });

  it('fits content-sized ecological boundaries across phone and desktop without rewriting the graph', async () => {
    const resizeTo = installResponsiveLayout();
    await openMapProject(makePhoneEcologyWithLegacyScope());
    fireEvent.change(mapLayer(), {target:{value:'all'}});
    const graph = structuredClone(storedProject().graph);
    for(const width of [390,1024]) {
      resizeTo(width);
      fireEvent.click(mapTool('Fit map'));
      await waitFor(()=>expectVisibleNodesAndConnectionLabelsInsideCanvas());
      expectNodesInsideEcologyRings();
      expect(storedProject().graph).toEqual(graph);
    }
  });

  it.each([320, 390, 430])('keeps a six-node all-layer ecology overview readable, separate, and on canvas at %ipx without saving it', async (width) => {
    installPhoneLayout(width);
    const project = makePhoneEcologyOverviewProject();
    await openMapProject(project);
    const durableGraph = structuredClone(storedProject().graph);
    const durableViewport = { ...storedProject().viewport };

    fireEvent.change(mapLayer(), { target: { value: 'all' } });
    await waitFor(() => {
      expect(document.querySelectorAll('.graph-node')).toHaveLength(6);
      expectVisibleNodesAndConnectionLabelsInsideCanvas();
    });
    fireEvent.click(mapTool('Fit map'));
    await waitFor(() => expectVisibleNodesAndConnectionLabelsInsideCanvas());

    const view = viewportTransform();
    const visible = { left: 0, right: 840, top: -430, bottom: 970 };
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
      expect(svgTextLines(group.querySelector('.node-label')).join('')).toBe(group.getAttribute('data-full-label'));
      expect(group).not.toHaveTextContent('…');
    });
    expect(storedProject().graph).toEqual(durableGraph);
    expect(storedProject().viewport).toEqual(durableViewport);
  });

  it('reflows a dense all-layer ecology map at each phone width, clears inner and outer collisions, and restores desktop without writes', async () => {
    const resizeTo = installResponsiveLayout();
    const project = makeDenseEcologyOverviewProject();
    await openMapProject(project);
    fireEvent.change(mapLayer(), { target: { value: 'all' } });
    const durableGraph = structuredClone(storedProject().graph);
    const durableViewport = { ...storedProject().viewport };
    const desktopPositions = new Map(project.graph.nodes.map(({ id }) => [id, renderedNodePosition(id)]));
    const desktopViewport = viewportTransform();

    for (const width of [320, 390, 430]) {
      resizeTo(width);
      await waitFor(() => {
        expect(renderedNodePosition(project.graph.nodes[0].id)).not.toEqual(desktopPositions.get(project.graph.nodes[0].id));
        expect(viewportTransform().zoom).toBeGreaterThanOrEqual(PROJECT_LIMITS.zoomMin);
      });

      fireEvent.click(mapTool('Fit map'));
      await waitFor(() => expectVisibleNodesAndConnectionLabelsInsideCanvas());
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
        expect(svgTextLines(group.querySelector('.node-label')).join('')).toBe(group.getAttribute('data-full-label'));
        expect(group).not.toHaveTextContent('…');
      });
      expect(storedProject().graph).toEqual(durableGraph);
      expect(storedProject().viewport).toEqual(durableViewport);

      resizeTo(1024);
      await waitFor(() => expect(viewportTransform()).toEqual(desktopViewport));
      desktopPositions.forEach((position, id) => expect(renderedNodePosition(id)).toEqual(position));
      expect(storedProject().graph).toEqual(durableGraph);
      expect(storedProject().viewport).toEqual(durableViewport);
    }
  });

  it('keeps keyboard-moved ecological nodes out of their layer label', async () => {
    await openMapProject(makeMapProject('exosphere'));
    fireEvent.change(mapLayer(), { target: { value: 'all' } });
    fireEvent.click(mapTool('Arrange map'));
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
    expectNodesInsideEcologyRings();
  }, 15000);

  it.each([320, 390, 430])('keeps all six Micro nodes readable, separate, and on canvas at %ipx without saving the phone layout', async (width) => {
    installPhoneLayout(width);
    const project = makeSixNodeMicroProject();
    const durablePositions = project.graph.nodes.map(({ id, x, y }) => ({ id, x, y }));
    const durableViewport = { ...project.viewport };
    await openMapProject(project);

    await waitFor(() => expectVisibleNodesAndConnectionLabelsInsideCanvas());
    fireEvent.click(mapTool('Fit map'));
    await waitFor(() => expectVisibleNodesAndConnectionLabelsInsideCanvas());

    const view = viewportTransform();
    const visible = { left: 0, right: 840, top: -430, bottom: 970 };
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
      expect(svgTextLines(group.querySelector('.node-label')).join('')).toBe(group.getAttribute('data-full-label'));
      expect(group).not.toHaveTextContent('…');
    });
    expect(storedProject().graph.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(durablePositions);
    expect(storedProject().viewport).toEqual(durableViewport);
  });

  it('restores the same automatic desktop arrangement after phone resizing without writing graph coordinates', async () => {
    const resizeTo = installResponsiveLayout();
    const project = makeSixNodeMicroProject();
    const durableGraph = structuredClone(project.graph), durableViewport = {...project.viewport};
    await openMapProject(project);
    const desktop = renderedPositions();
    await waitFor(() => expectVisibleNodesAndConnectionLabelsInsideCanvas());
    resizeTo(390);
    await waitFor(() => expectVisibleNodesAndConnectionLabelsInsideCanvas());
    expect([...renderedPositions()]).not.toEqual([...desktop]);
    fireEvent.click(mapTool('Fit map'));
    resizeTo(1024);
    await waitFor(() => expect([...renderedPositions()]).toEqual([...desktop]));
    expect(storedProject().graph).toEqual(durableGraph);
    expect(storedProject().viewport).toEqual(durableViewport);
  });

  it('keeps the initial automatic desktop fit and a nonzero relationship geometry', async () => {
    const project = makeMapProject('exosphere');
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
    expectVisibleNodesAndConnectionLabelsInsideCanvas();
    expect(storedProject().viewport).toEqual(durableViewport);
  });

  it('keeps the cumulative graph visible when a selected relationship crosses the phone breakpoint', async () => {
    const resizeTo = installResponsiveLayout();
    const project = makeMapProject('exosphere'), before = structuredClone(project.graph);
    await openMapProject(project);
    const positions = renderedPositions();
    const edge = project.graph.edges.find(item => document.querySelector(`.graph-edge[data-graph-id="${item.id}"]`));
    const element = document.querySelector(`.graph-edge[data-graph-id="${edge.id}"]`);
    fireEvent.keyDown(element, {key:'Enter'});
    expect(screen.getByLabelText('Notebook')).not.toHaveAttribute('aria-hidden');
    expect([...renderedPositions()]).toEqual([...positions]);
    for (const width of [390, 1024]) {
      resizeTo(width);
      fireEvent.click(mapTool('Fit map'));
      await waitFor(() => expectVisibleNodesAndConnectionLabelsInsideCanvas());
      expect(mapCanvas()).not.toHaveClass('is-detail-view');
      expect(document.querySelectorAll('.graph-node')).toHaveLength(positions.size);
      expect(document.querySelectorAll('.is-dimmed, .graph-edge.is-muted')).toHaveLength(0);
      expectAttachedRelationship(edge);
    }
    expect([...renderedPositions()]).toEqual([...positions]);
    expect(storedProject().graph).toEqual(before);
  });

  it('shows a straight cross-scale relationship without hiding the cumulative phone map', async () => {
    installPhoneLayout();
    const project = makeCrossLayerEcologyProject(), before = structuredClone(project.graph);
    await openMapProject(project);
    const positions = renderedPositions();
    const edge = project.graph.edges.find(item => document.querySelector(`.graph-edge[data-graph-id="${item.id}"]`));
    fireEvent.keyDown(document.querySelector(`.graph-edge[data-graph-id="${edge.id}"]`), {key:'Enter'});
    expect(screen.getByLabelText('Notebook')).not.toHaveAttribute('aria-hidden');
    expect(mapCanvas()).not.toHaveClass('is-detail-view');
    expect([...renderedPositions()]).toEqual([...positions]);
    expect(document.querySelector('.ecology-layers')).not.toBeNull();
    expectAttachedRelationship(edge);
    fireEvent.click(mapTool('Fit map'));
    await waitFor(() => expectVisibleNodesAndConnectionLabelsInsideCanvas());
    expect(storedProject().graph).toEqual(before);
  });

  it.each([
    ['meso', 'determines daytime course availability for'],
  ])('keeps the complete %s relationship label clear of both endpoint cards when selected on desktop', async (activeScale, verb) => {
    const project = makeMapProject('exosphere');
    project.activeScale = activeScale;
    const edge = project.graph.edges.find((candidate) => candidate.scale === activeScale);
    const activeGraph = graphForScale(project);
    edge.verb = verb;
    const graphBefore = structuredClone(project.graph);
    await openMapProject(project);
    fireEvent.change(mapLayer(), { target: { value: activeScale } });

    expect(document.querySelector(`.graph-edge-label[data-edge-id="${edge.id}"]`)).toBeNull();
    expectAttachedRelationship(edge);
    const expectClearOverviewLabel = () => expectAttachedRelationship(edge);

    const renderedEdge = document.querySelector(`.graph-edge[data-graph-id="${edge.id}"]`);
    renderedEdge.focus();
    fireEvent.keyDown(renderedEdge, { key: 'Enter' });
    const inspector = screen.getByLabelText('Notebook');
    if (screen.queryByRole('button', { name: 'Edit', exact: true })) fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
    fireEvent.click(within(inspector).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(inspector).not.toHaveAttribute('aria-hidden'));

    // Desktop keeps the whole layer on the canvas; the selected relationship keeps its
    // complete, clear label while everything outside it dims.
    expect(mapCanvas()).not.toHaveClass('is-detail-view');
    expect(document.querySelectorAll('.graph-node')).toHaveLength(activeGraph.nodes.length);
    expect(document.querySelectorAll('.graph-edge')).toHaveLength(activeGraph.edges.length);
    expect([...document.querySelectorAll('.graph-edge-label')].map((label) => label.getAttribute('data-edge-id')).sort()).toEqual([edge.id]);
    expectClearOverviewLabel(document.querySelector(`.graph-edge-label[data-edge-id="${edge.id}"]`));
    expect(document.querySelector(`.graph-edge[data-graph-id="${edge.id}"]`)).not.toHaveClass('is-dimmed');
    activeGraph.nodes.forEach(node => expect(document.querySelector(`.graph-node[data-graph-id="${node.id}"]`)).not.toHaveClass('is-dimmed'));
    expect(storedProject().graph).toEqual(graphBefore);

    fireEvent.click(mapTool('Fit map'));
    await waitFor(() => expect(document.querySelector('.map-focus-bar')).toBeNull());
    expect(document.querySelector('.is-dimmed')).toBeNull();
    expectClearOverviewLabel(document.querySelector(`.graph-edge-label[data-edge-id="${edge.id}"]`));
    expect(document.querySelectorAll('.graph-node')).toHaveLength(activeGraph.nodes.length);
    expect(document.querySelectorAll('.graph-edge')).toHaveLength(activeGraph.edges.length);
    expect(storedProject().graph).toEqual(graphBefore);
  });

  it('permits intentional dragging with attached wording and restores exact positions with undo and redo', async () => {
    const project = makeMapProject('meso');
    const source = structuredClone(project.graph.nodes.find(node => node.label === 'Family'));
    const target = structuredClone(project.graph.nodes.find(node => node.label === 'School'));
    const edge = structuredClone(project.graph.edges.find(item => item.source === source.id && item.target === target.id));
    Object.assign(source, {x:200,y:270}); Object.assign(target, {x:720,y:270});
    edge.verb = 'determines daytime course availability for';
    project.graph = {nodes:[source,target],edges:[edge]}; project.candidates = {nodes:[],edges:[]};
    project.layout = {phoneOverview:'preserve',manualNodeIds:[source.id,target.id]};
    await openMapProject(project);
    const canvas=mapCanvas(), element=document.querySelector(`.graph-node[data-graph-id="${target.id}"]`);
    canvas.getScreenCTM=()=>({inverse:()=>({})});
    canvas.createSVGPoint=()=>({x:0,y:0,matrixTransform(){return {x:this.x,y:this.y};}});
    const zoom = viewportTransform().zoom;
    fireEvent.pointerDown(element,{pointerId:81,button:0,clientX:720,clientY:270});
    fireEvent.pointerMove(canvas,{pointerId:81,clientX:720-200*zoom,clientY:270});
    fireEvent.pointerUp(canvas,{pointerId:81,clientX:720-200*zoom,clientY:270});
    await waitFor(() => expect(renderedNodePosition(target.id)).toEqual({x:520,y:270}));
    expectAttachedRelationship(edge);
    expect(renderedNodePosition(source.id)).toEqual({x:200,y:270});
    await waitFor(() => expect(storedProject().graph.nodes.find(node=>node.id===target.id)).toMatchObject({x:520,y:270}));
    fireEvent.keyDown(canvas,{key:'z',ctrlKey:true});
    await waitFor(() => expect(renderedNodePosition(target.id)).toEqual({x:720,y:270}));
    fireEvent.keyDown(canvas,{key:'z',ctrlKey:true,shiftKey:true});
    await waitFor(() => expect(renderedNodePosition(target.id)).toEqual({x:520,y:270}));
    expectAttachedRelationship(edge);
  });

  it('retains a complete maximum-length relationship label clear of cards on the cumulative phone map', async () => {
    installPhoneLayout();
    const project=makeMapProject('exosphere'); project.activeScale='meso';
    const edge=project.graph.edges.find(item=>item.scale==='meso'); edge.verb='R'.repeat(100);
    const before=structuredClone(project.graph);
    await openMapProject(project);
    fireEvent.keyDown(document.querySelector(`.graph-edge[data-graph-id="${edge.id}"]`),{key:'Enter'});
    expect(mapCanvas()).not.toHaveClass('is-detail-view');
    expectAttachedRelationship(edge);
    fireEvent.click(mapTool('Fit map'));
    await waitFor(() => expectVisibleNodesAndConnectionLabelsInsideCanvas());
    const zoomOut=mapTool('Zoom out');
    for(let step=0;step<30&&!zoomOut.disabled;step++) fireEvent.click(zoomOut);
    expect(viewportTransform().zoom).toBe(PROJECT_LIMITS.zoomMin);
    expect(zoomOut).toBeDisabled();
    expectAttachedRelationship(edge);
    expect(storedProject().graph).toEqual(before);
  });

  it('keeps every node and connection present while following each relationship in a dense phone map', async () => {
    installPhoneLayout();
    const project=makeDenseFocusedMesoProject(), before=structuredClone(project.graph);
    await openMapProject(project);
    const positions=renderedPositions(),visited=new Set();
    for(const edge of project.graph.edges){
      const inspector=openNodeInspector('node-dense-focus');
      const connections=openDetails('.map-connections');
      fireEvent.click(within(connections).getByText(`${edge.sourceLabel} ${edge.verb} ${edge.targetLabel}`,{selector:'strong'}).closest('button'));
      expect(document.querySelectorAll('.graph-node')).toHaveLength(project.graph.nodes.length);
      expect(document.querySelectorAll('.graph-edge')).toHaveLength(project.graph.edges.length);
      expect([...renderedPositions()]).toEqual([...positions]);
      expectAttachedRelationship(edge);visited.add(edge.id);
      expect(mapCanvas()).not.toHaveClass('is-detail-view');
      if(screen.queryByRole('button',{name:'Edit',exact:true})) fireEvent.click(screen.getByRole('button',{name:'Edit',exact:true}));
      fireEvent.click(within(inspector).getByRole('button',{name:'Done'}));
      expect(document.querySelector('.map-focus-bar')).toBeNull();
    }
    expect([...visited].sort()).toEqual(project.graph.edges.map(edge=>edge.id).sort());
    expect(storedProject().graph).toEqual(before);
  }, 15000);

  it('keeps the phone overview when adding a contextual relationship and preserves its inspected viewport during annotation updates', async () => {
    installPhoneLayout();
    const project = makeDenseFocusedMesoProject(2);
    const secondNeighbor = project.graph.nodes.find((node) => node.id === 'node-dense-neighbor-2');
    project.graph.edges = project.graph.edges.slice(0, 1);
    await openMapProject(project);

    let inspector = openNodeInspector('node-dense-focus');
    if (screen.queryByRole('button', { name: 'Edit', exact: true })) fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
    fireEvent.click(within(inspector).getByRole('button', { name: 'Done' }));
    expect(mapCanvas()).not.toHaveClass('is-detail-view');
    expect(document.querySelectorAll('.graph-node')).toHaveLength(project.graph.nodes.length);
    const zoomOut = mapTool('Zoom out');
    for (let step = 0; step < 30 && !zoomOut.disabled; step += 1) fireEvent.click(zoomOut);
    expect(viewportTransform().zoom).toBe(PROJECT_LIMITS.zoomMin);
    const manuallyAdjustedViewport = viewportTransform();

    inspector = openNodeInspector('node-dense-focus');
    const source = project.graph.nodes.find(node => node.id === 'node-dense-focus');
    fireEvent.click(within(inspector).getByRole('button', { name: `Connect from ${source.label}`, exact: true }));
    fireEvent.keyDown(document.querySelector(`[data-graph-id="${secondNeighbor.id}"]`), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
    const addForm = screen.getByRole('heading', { name: 'New relationship' }).parentElement;
    expect(within(addForm).getByLabelText('From')).toHaveValue('node-dense-focus');
    fireEvent.change(within(addForm).getByLabelText('Relationship'), { target: { value: 'coordinates new support with' } });
    expect(within(addForm).getByLabelText('To')).toHaveValue(secondNeighbor.id);
    fireEvent.change(within(addForm).getByLabelText('Direction'), { target: { value: 'source to target' } });
    fireEvent.click(within(addForm).getByRole('button', { name: 'Add relationship' }));

    await waitFor(() => expect(storedProject().graph.edges).toHaveLength(2));
    expect(document.querySelectorAll('.graph-node')).toHaveLength(project.graph.nodes.length);
    expect(document.querySelectorAll('.graph-edge')).toHaveLength(2);
    const addedEdge = storedProject().graph.edges.at(-1);
    if (screen.queryByRole('button', { name: 'Edit', exact: true })) fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
    fireEvent.click(within(inspector).getByRole('button', { name: 'Done' }));
    inspector = openNodeInspector(source.id);
    const connections = openDetails('.map-connections');
    expect(within(connections).getAllByRole('button')).toHaveLength(2);
    fireEvent.click(within(connections).getByText(`${addedEdge.sourceLabel} ${addedEdge.verb} ${addedEdge.targetLabel}`, { selector: 'strong' }).closest('button'));
    expect(mapCanvas()).not.toHaveClass('is-detail-view');
    await waitFor(() => expect(viewportTransform()).not.toEqual(manuallyAdjustedViewport));
    expectAttachedRelationship(addedEdge);
    const refittedViewport = viewportTransform();

    const relationshipPanel = within(inspector).getByRole('region', { name: 'Connections' });
    const annotation = within(relationshipPanel).getByRole('textbox', { name: 'Interpretation' });
    fireEvent.change(annotation, { target: { value: 'Annotation-only edits must not recenter the focused relationship.' } });
    expect(annotationStatus(annotation)).toHaveTextContent('Saving…');
    await waitFor(() => expect(annotationStatus(annotation)).toHaveTextContent('Saved'));
    expect(viewportTransform()).toEqual(refittedViewport);

    if (screen.queryByRole('button', { name: 'Edit', exact: true })) fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
    fireEvent.click(within(inspector).getByRole('button', { name: 'Done' }));
    expect(document.querySelector(`.graph-edge[data-graph-id="${addedEdge.id}"]`)).toHaveAttribute('aria-pressed','true');
    expect([...document.querySelectorAll('.graph-node')].map((node) => node.getAttribute('data-graph-id')).sort())
      .toEqual(project.graph.nodes.map(node=>node.id).sort());
    expectAttachedRelationship(addedEdge);
    fireEvent.click(mapTool('Fit map'));
    expectVisibleNodesAndConnectionLabelsInsideCanvas();
  });

  it('selects a relationship with Enter without changing Notebook state and preserves the whole map after editing', async () => {
    installPhoneLayout();
    const project=makeMapProject('exosphere'); await openMapProject(project);
    const graph=structuredClone(storedProject().graph), positions=renderedPositions();
    const edge=document.querySelector('.graph-edge[tabindex="0"]');
    edge.focus();fireEvent.keyDown(edge,{key:'Enter'});
    expect(edge).toHaveAttribute('aria-pressed','true');
    expect(screen.getByLabelText('Notebook')).not.toHaveAttribute('aria-hidden');
    fireEvent.click(screen.getByRole('button',{name:'Edit',exact:true}));
    const inspector=screen.getByLabelText('Notebook');
    expect(within(inspector).getByRole('region',{name:'Connections'})).toBeVisible();
    fireEvent.click(within(inspector).getByRole('button',{name:'Done'}));
    expect(inspector).not.toHaveAttribute('aria-hidden');
    expect(mapCanvas()).not.toHaveClass('is-detail-view');
    expect([...renderedPositions()]).toEqual([...positions]);
    for(const item of project.graph.edges.filter(item=>document.querySelector(`.graph-edge[data-graph-id="${item.id}"]`))) expectAttachedRelationship(item);
    expect(storedProject().graph).toEqual(graph);
  });

  it('renders exact saved in-band ecological positions after reload', async () => {
    await openMapProject(makeMapProject('exosphere'));
    fireEvent.change(mapLayer(), { target: { value: 'all' } });
    fireEvent.click(mapTool('Arrange map'));
    await waitFor(() => expect(eventRequests('map_arranged')).toHaveLength(1));
    await waitFor(() => expect(storedProject().events.some((event) => event.action === 'map.arranged')).toBe(true));
    const savedPositions = storedProject().graph.nodes.map(({ id, x, y }) => ({ id, x, y }));

    cleanup();
    render(<App />);
    await showResumeScreen();
    openProjectFromList('NYC systems and assets map');
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    fireEvent.change(mapLayer(), { target: { value: 'all' } });

    savedPositions.filter(({ id }) => storedProject().graph.nodes.find(node => node.id === id)?.scale !== 'meso').forEach(({ id, x, y }) => {
      expect(document.querySelector(`[data-graph-id="${id}"]`)).toHaveAttribute('transform', `translate(${x} ${y})`);
    });
    expect(storedProject().graph.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(savedPositions);
  });

  it('keeps earlier work fully visible and keeps Notebook under user control when selecting and editing a node', async () => {
    const project=await openMapProject();
    const positions=renderedPositions(), before=structuredClone(storedProject().graph);
    const node=project.graph.nodes.find(item=>positions.has(item.id));
    fireEvent.keyDown(document.querySelector(`.graph-node[data-graph-id="${node.id}"]`),{key:'Enter'});
    expect(screen.getByLabelText('Notebook')).not.toHaveAttribute('aria-hidden');
    expect(document.querySelectorAll('.is-dimmed, .graph-edge.is-muted')).toHaveLength(0);
    expect([...renderedPositions()]).toEqual([...positions]);
    const inspector=openNodeInspector(node.id);
    expect(inspector).not.toHaveAttribute('aria-hidden');
    const visibleEdges=project.graph.edges.filter(edge=>positions.has(edge.source)&&positions.has(edge.target));
    expect(document.querySelectorAll('.graph-edge-label')).toHaveLength(visibleEdges.filter(edge=>edge.source===node.id||edge.target===node.id).length);
    for(const edge of visibleEdges) expectAttachedRelationship(edge);
    fireEvent.click(within(inspector).getByRole('button',{name:'Done'}));
    expect(document.querySelector('.map-focus-bar')).toBeNull();
    expect([...renderedPositions()]).toEqual([...positions]);
    expect(storedProject().graph).toEqual(before);
  });

  it.each([
    ['desktop', false],
    ['phone', true],
  ])('renders complete map labels with separate, dynamically sized cards on %s', async (_viewport, phone) => {
    if (phone) installPhoneLayout();
    const project = makeMapProject('exosphere');
    project.activeScale = 'meso';
    const active = { nodes: project.graph.nodes.filter(node => node.scale !== 'meso' && SCALE_ORDER.indexOf(node.scale) <= SCALE_ORDER.indexOf(project.activeScale)), edges: project.graph.edges.filter(edge => SCALE_ORDER.indexOf(edge.scale) <= SCALE_ORDER.indexOf(project.activeScale)) };
    const incidentEdge = active.edges[0];
    const sourceNode = project.graph.nodes.find((node) => node.id === incidentEdge.source);
    const longNodeLabel = 'East Harlem community resource room with transportation and family program materials END NODE';
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

    expect(svgTextLines(renderedNode.querySelector('.node-label')).join('')).toBe(longNodeLabel);
    expect(renderedNode).not.toHaveTextContent('…');
    expect(renderedNode.querySelector('.node-scale-glyph')).toBeNull();
    expect(Number(card.getAttribute('height'))).toBeGreaterThan(phone ? 82 : 72);
    expect(within(inspector).getByText(longNodeLabel, { selector: '.item-editor-title p' })).toHaveTextContent(longNodeLabel);

    openEdgeInspector(incidentEdge.id);
    expect(within(inspector).getByText(new RegExp(longEdgeLabel), { selector: '.item-editor-title p' })).toHaveTextContent(longEdgeLabel);
    const renderedEdge = document.querySelector(`.graph-edge-label[data-edge-id="${incidentEdge.id}"]`);
    const edgeBackground = renderedEdge.querySelector('.edge-label-bg');
    const edgeText = renderedEdge.querySelector('.edge-label');
    expect(edgeText).toHaveStyle({ fontSize: phone ? '26px' : '18px' });
    expect(svgTextLines(edgeText).join('')).toBe(longEdgeLabel);
    expect(renderedEdge).not.toHaveTextContent('…');
    expect(Number(edgeBackground.getAttribute('height'))).toBeGreaterThan(phone ? 44 : 24);
    expect(within(inspector).getByText(new RegExp(longEdgeLabel), { selector: '.item-editor-title p' })).not.toHaveTextContent('…');
  });

  it('preserves every character in maximum-length unbroken map labels', async () => {
    const project = makeMapProject('exosphere');
    project.activeScale = 'meso';
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

    fireEvent.click(mapTool('Arrange map'));

    await waitFor(() => expect(storedProject().events.at(-1)).toMatchObject({ action: 'map.arranged', detail: 'Exo-level arranged' }));
    const arranged = storedProject();
    const arrangedVisible = arranged.graph.nodes.filter((node) => visibleIds.has(node.id));
    const arrangedHidden = arranged.graph.nodes.filter((node) => !visibleIds.has(node.id));
    expect(arrangedVisible.map(({ id, x, y }) => ({ id, x, y }))).not.toEqual(visibleBefore.map(({ id, x, y }) => ({ id, x, y })));
    expect(arrangedHidden.map(({ id, x, y }) => ({ id, x, y }))).toEqual(hiddenBefore.map(({ id, x, y }) => ({ id, x, y })));
    for (let first = 0; first < arrangedVisible.length; first += 1) {
      expect(renderedNodePosition(arrangedVisible[first].id)).toEqual({ x: arrangedVisible[first].x, y: arrangedVisible[first].y });
      for (let second = first + 1; second < arrangedVisible.length; second += 1) {
        const firstNode = document.querySelector(`.graph-node[data-graph-id="${arrangedVisible[first].id}"]`);
        const secondNode = document.querySelector(`.graph-node[data-graph-id="${arrangedVisible[second].id}"]`);
        // Cards now fit their wording. Compare their actual bounds instead of
        // the former fixed 184-by-72 footprint, including room between cards.
        const firstBounds = translatedRectBounds(firstNode, firstNode.querySelector('.node-card'));
        const secondBounds = translatedRectBounds(secondNode, secondNode.querySelector('.node-card'));
        const paddedBounds = { left: firstBounds.left - 12, right: firstBounds.right + 12, top: firstBounds.top - 12, bottom: firstBounds.bottom + 12 };
        expect(rectsIntersect(paddedBounds, secondBounds), `${arrangedVisible[first].label} overlaps ${arrangedVisible[second].label}`).toBe(false);
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
    fireEvent.pointerUp(removedElement, { pointerId: 1, button: 0 });
    if (screen.queryByRole('button', { name: 'Edit', exact: true })) fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Return to map' }));
    await waitFor(() => expect(storedProject().graph.edges.find((edge) => edge.id === removedEdge.id)).toMatchObject({ status: 'confirmed', claimState: 'student interpretation' }));
  });

  it('deletes a selected node recoverably and ignores Delete while editing or composing', async () => {
    window.requestAnimationFrame = vi.fn(callback => { callback(0); return 1; });
    const project = makeMapProject('micro');
    project.graph.edges = []; project.candidates.edges = [];
    project.graph.nodes = project.graph.nodes.filter(node => node.scale === 'micro').map(node => ({ ...node, settingNodeIds: [] }));
    const node = project.graph.nodes[0];
    await openMapProject(project);
    let inspector = openNodeInspector(node.id);
    const input = within(inspector).getByRole('textbox', { name: 'Interpretation' });
    fireEvent.keyDown(input, { key: 'Delete' }); fireEvent.keyDown(input, { key: 'Backspace' });
    expect(storedProject().graph.nodes.find(n => n.id === node.id).status).toBe('confirmed');
    fireEvent.click(within(inspector).getByRole('button', { name: 'Done' }));
    const element = document.querySelector(`[data-graph-id="${node.id}"]`);
    element.focus(); fireEvent.keyDown(element, { key: 'Delete', isComposing: true });
    expect(storedProject().graph.nodes.find(n => n.id === node.id).status).toBe('confirmed');
    fireEvent.keyDown(element, { key: 'Backspace' });
    await waitFor(() => expect(storedProject().graph.nodes.find(n => n.id === node.id)).toMatchObject({ status: 'rejected', claimState: 'retired' }));
    const removed = storedProject().graph.nodes.find(n => n.id === node.id);
    expect(removed.annotations).toEqual(node.annotations); expect(removed.evidence).toBe(node.evidence);
    await waitFor(() => expect(mapCanvas()).toHaveFocus());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show removed items' }));
    inspector = openNodeInspector(node.id);
    fireEvent.click(within(inspector).getByRole('button', { name: 'Return to map' }));
    await waitFor(() => expect(storedProject().graph.nodes.find(n => n.id === node.id).status).toBe('confirmed'));
    fireEvent.click(within(inspector).getByRole('button', { name: 'Delete', exact: true }));
    await waitFor(() => expect(storedProject().graph.nodes.find(n => n.id === node.id).status).toBe('rejected'));
    const saved = parseProject(serializeProject(storedProject())); cleanup(); await openMapProject(saved);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show removed items' }));
    inspector = openNodeInspector(node.id);
    fireEvent.click(within(inspector).getByRole('button', { name: 'Return to map' }));
    await waitFor(() => expect(storedProject().graph.nodes.find(n => n.id === node.id).status).toBe('confirmed'));
  });

  it('protects connected relationships when Delete is pressed on their selected node', async () => {
    const project = makeMapProject('meso'); await openMapProject(project);
    const edge = project.graph.edges.find(e => e.scale === 'meso');
    openNodeInspector(edge.source);
    fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
    expect(storedProject().graph).toEqual(project.graph);
    expect(screen.getByText(/before removing/)).toBeVisible();
  });

  it.each(['meso', 'exosphere'])('keeps blank relationship wording through %s save and reload', async scale => {
    const project = makeMapProject(scale), edge = project.graph.edges.find(e => e.scale === scale);
    edge.verb = '';
    const saved = parseProject(serializeProject(project));
    expect(saved.graph.edges.find(e => e.id === edge.id)).toMatchObject({ verb: '', status: 'confirmed' });
    expect(saved.graph.edges.find(e => e.id === edge.id).relationshipProcess).toEqual(edge.relationshipProcess);
  });

  it('keeps candidates and the whole map intact when memo text changes', async () => {
    const project = makeMapProject('exosphere');
    const template = project.graph.nodes.find((node) => node.scale === 'micro');
    const candidateNode = {
      ...structuredClone(template),
      id: 'node_pending_peer_navigator',
      label: 'Pending peer navigator',
      type: 'person',
      status: 'pending',
      claimState: 'inference',
      annotations: {
        analytical: { id: 'annotation_pending_peer_navigator_analytical', text: '' },
        evidence: { id: 'annotation_pending_peer_navigator_evidence', text: '' },
      },
    };
    const target = project.graph.nodes.find((node) => node.scale === 'micro' && node.id !== template.id);
    const edgeTemplate = project.graph.edges.find((edge) => edge.scale === 'meso');
    const candidateEdge = {
      ...structuredClone(edgeTemplate),
      id: 'edge_pending_peer_support',
      source: candidateNode.id,
      sourceLabel: candidateNode.label,
      target: target.id,
      targetLabel: target.label,
      status: 'pending',
      claimState: 'inference',
      annotation: { id: 'annotation_pending_peer_support', text: '' },
    };
    project.candidates = { nodes: [candidateNode], edges: [candidateEdge] };
    project.stage = 0;
    project.furthestStage = 0;
    await resumeSavedProject(project);
    fireEvent.change(screen.getByRole('textbox', { name: /^Memo/ }), { target: { value: `${project.submission.text} A later memo correction changes the evidence anchor.` } });
    await waitFor(() => {
      const stored = storedProject();
      expect(stored.submission).toEqual(project.submission);
      expect(stored.part2Submission.revision).toBe(2);
      expect(stored.part2Submission.text).toContain('A later memo correction');
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
    expect(screen.getByRole('heading', { name: 'Memo review' })).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'Model setup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Custom project instructions/ })).not.toBeInTheDocument();
    expect(memoNextAction()).toBeEnabled();
  });

  it('restores an immediate memo journal and current step after reload when a full save is unavailable', async () => {
    const project = makeMapProject('micro');
    project.stage = 0;
    seedProject(project);
    const view = render(<App startInWorkspace />);
    await screen.findByRole('heading', { name: 'Memo' });
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === STORAGE_KEY) throw new DOMException('Full save unavailable');
      return setItem.call(this, key, value);
    });
    const memo = `${project.submission.text}\nA student detail survives immediate reload`;
    fireEvent.change(screen.getByRole('textbox', { name: /^Memo/ }), { target: { value: memo } });
    expect(JSON.parse(localStorage.getItem(memoDraftKey(project.id))).draft.submission.text).toBe(memo);
    expect(storedProject().submission.text).toBe(project.submission.text);
    fireEvent.click(screen.getByRole('button', { name: 'Memo review', exact: true }));
    expect(await screen.findByRole('heading', { name: 'Memo review' })).toBeVisible();
    expect(JSON.parse(localStorage.getItem(memoDraftKey(project.id))).draft.stage).toBe(1);
    view.unmount();

    render(<App startInWorkspace />);
    expect(await screen.findByRole('heading', { name: 'Memo review' })).toBeVisible();
    openProjectMenu('Progress');
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Progress' })).getByRole('button', { name: 'Add memo' }));
    expect(await screen.findByRole('heading', { name: 'Memo' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /^Memo/ })).toHaveValue(memo);
    expect(storedProject().graph).toEqual(project.graph);
  });

  it('retains an edited memo and its current step after returning through Projects', async () => {
    const project = makeMapProject('micro');
    project.stage = 0;
    await resumeSavedProject(project);
    const memo = `${project.submission.text}\nA student revision before returning to Projects`;
    fireEvent.change(screen.getByRole('textbox', { name: /^Memo/ }), { target: { value: memo } });
    fireEvent.click(screen.getByRole('button', { name: 'Memo review', exact: true }));
    await screen.findByRole('heading', { name: 'Memo review' });
    fireEvent.click(screen.getByRole('button', { name: 'Projects', exact: true }));
    await showResumeScreen();
    openProjectFromList(project.title);
    expect(await screen.findByRole('heading', { name: 'Memo review' })).toBeVisible();
    expect(storedProject()).toMatchObject({ id: project.id, stage: 1, submission: { text: memo }, graph: project.graph });
  });

  it('explicitly saves a new map note and exposes it immediately in Notebook', async () => {
    const project = makeMapProject(); project.mapAnnotation.text = '';
    await openMapProject(project);
    const field = selectAnnotationTarget('map');
    fireEvent.change(field, { target: { value: 'Synthetic note saved by the student.' } });
    fireEvent.click(within(field.closest('.annotation-field')).getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(annotationStatus(field)).toHaveTextContent('Saved'));
    expect(storedProject().mapAnnotation.text).toBe('Synthetic note saved by the student.');
    openNotebookSection('review');
    fireEvent.click(screen.getByText('Saved map note'));
    expect(screen.getByRole('textbox', { name: 'Map note' })).toHaveValue('Synthetic note saved by the student.');
  });

  it.each(['node', 'edge', 'map'])('shows annotation saving only while work is pending and persists the text for %s', async (target) => {
    const legacy = makeMapProject(); legacy.mapAnnotation.text = 'A saved map note.';
    const project = await openMapProject(legacy);
    const field = selectAnnotationTarget(target);
    const text = `${target} annotation saved locally`;
    fireEvent.change(field, { target: { value: text } });
    expect(annotationStatus(field)).toHaveTextContent('Saving…');
    await waitFor(() => expect(annotationStatus(field)).toHaveTextContent('Saved'));
    expect(storedAnnotation(target, project)).toBe(text);
  });

  it.each(['node', 'edge', 'map'])('changes queued %s annotation status to the actual persistence error', async (target) => {
    const legacy = makeMapProject(); legacy.mapAnnotation.text = 'A saved map note.';
    const project = seedProject(legacy);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    render(<App />);
    await showResumeScreen();
    openProjectFromList(project.title);
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    const field = selectAnnotationTarget(target);
    fireEvent.change(field, { target: { value: `${target} unsaved annotation` } });
    expect(annotationStatus(field)).toHaveTextContent(/Saving…|Draft cache unavailable; keep this page open|The project opened, but browser storage could not update its saved record\./);
    await waitFor(() => expect(annotationStatus(field)).toHaveTextContent('The project opened, but browser storage could not update its saved record.'));
    expect(annotationStatus(field)).not.toHaveTextContent('Quota exceeded');
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)).id).toBe(project.id);
  });

  it('keeps invalid candidate label drafts local and saves a corrected label explicitly', async () => {
    const { project, candidate } = makeCandidateValidationProject();
    await resumeSavedProject(project);
    const label = screen.getByRole('textbox', { name: 'Node label' });
    fireEvent.change(label, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a label of 1–200 characters.');
    expect(storedProject().candidates.nodes.find(node => node.id === candidate.id).label).toBe(candidate.label);
    expect(screen.queryByRole('button', { name: 'Review issue' })).not.toBeInTheDocument();
    fireEvent.change(label, { target: { value: 'Corrected peer navigator' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(storedProject().candidates.nodes.find(node => node.id === candidate.id).label).toBe('Corrected peer navigator'));
  });

  it('keeps raw project validation text out of the interface when link creation is blocked', async () => {
    const { project } = makeCandidateValidationProject();
    await resumeSavedProject(project);
    openDetails('.candidate-note:not(.candidate-evidence)');
    fireEvent.change(screen.getByRole('textbox', { name: 'Annotation', exact: true }), { target: { value: 'x'.repeat(PROJECT_LIMITS.noteText + 1) } });
    await screen.findByRole('button', { name: 'Review issue' });

    openProjectLink();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Project link' })).getByRole('button', { name: 'Create project link' }));

    const dialog = screen.getByRole('dialog', { name: 'Save needs attention' });
    expect(within(dialog).getByText('The project link was not created because one map item needs attention.')).toBeVisible();
    expect(within(dialog).queryByText('Technical details')).not.toBeInTheDocument();
    expect(dialog).not.toHaveTextContent('Invalid Systems Mapping project:');
    expect(document.querySelector('.toast')).not.toHaveTextContent('Invalid Systems Mapping project:');
    expect(fetchMock.mock.calls.some(([path, options]) => String(path) === '/api/projects' && options.method === 'POST')).toBe(false);
  });

  it('keeps raw project validation text out of the interface when export is blocked', async () => {
    const { project } = makeCandidateValidationProject();
    await resumeSavedProject(project);
    openDetails('.candidate-note:not(.candidate-evidence)');
    fireEvent.change(screen.getByRole('textbox', { name: 'Annotation', exact: true }), { target: { value: 'x'.repeat(PROJECT_LIMITS.noteText + 1) } });
    await screen.findByRole('button', { name: 'Review issue' });

    openProjectMenu('Progress');
    const stages = screen.getByRole('dialog', { name: 'Progress' });
    fireEvent.click(within(stages).getByRole('button', { name: /review and export/i }));
    expect(await screen.findByRole('textbox', { name: 'Field notes (required)' })).toBeVisible();
    openExports();
    fireEvent.change(screen.getByRole('combobox',{name:'File format'}),{target:{value:'json'}}); fireEvent.click(screen.getByRole('button',{name:'Download',exact:true}));

    const dialog = await screen.findByRole('dialog', { name: 'Save needs attention' });
    expect(within(dialog).getByText('The export was not created because one map item needs attention.')).toBeVisible();
    expect(within(dialog).queryByText('Technical details')).not.toBeInTheDocument();
    expect(dialog).not.toHaveTextContent('Invalid Systems Mapping project:');
    expect(document.querySelector('.toast')).not.toHaveTextContent('Invalid Systems Mapping project:');
  });

  it.each(['validation', 'storage'])('does not announce JSON import success when the current map cannot be archived (%s)', async failure => {
    const { project } = makeCandidateValidationProject();
    await resumeSavedProject(project);
    if (failure === 'validation') {
      openDetails('.candidate-note:not(.candidate-evidence)');
      fireEvent.change(screen.getByRole('textbox', { name: 'Annotation', exact: true }), { target: { value: 'x'.repeat(PROJECT_LIMITS.noteText + 1) } });
      await screen.findByRole('button', { name: 'Review issue' });
    } else {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Synthetic quota failure', 'QuotaExceededError'); });
    }
    openExports();
    const imported = makeMapProject();
    imported.id = 'synthetic-imported-map';
    fireEvent.change(document.querySelector('.export-dropdown__import input'), { target: { files: [{ name: 'synthetic.json', size: 1000, text: async () => serializeProject(imported) }] } });
    await screen.findByText('The project was not imported. Your current map remains open. Resolve the save warning and try again.');
    expect(document.querySelector('.toast')).not.toHaveTextContent('Project imported and validated.');
    expect(storedProject().id).toBe(project.id);
    expect(fetchMock.mock.calls.some(([path, options]) => String(path) === '/api/prototype/events' && JSON.parse(options.body).event === 'project_imported')).toBe(false);
  });

  it('keeps a separately reopenable recovery when importing an older same-ID project', async () => {
    const current = makeMapProject();
    current.submission.text = 'Latest synthetic memo';
    current.reflection = 'Latest synthetic notes';
    await resumeSavedProject(current);
    openExports();
    const imported = structuredClone(current);
    imported.submission.text = 'Older synthetic memo';
    imported.reflection = 'Older synthetic notes';
    fireEvent.change(document.querySelector('.export-dropdown__import input'), { target: { files: [{ name: 'older.json', size: 1000, text: async () => serializeProject(imported) }] } });
    await waitFor(() => expect(storedProject().submission.text).toBe('Older synthetic memo'));
    const records = loadProjectLibrary(window.localStorage, storedProject(), true);
    const recovery = loadLibraryProject(window.localStorage, records.find(record => record.id.startsWith('recovery_')));
    expect(recovery.submission.text).toBe(current.submission.text);
    expect(recovery.reflection).toBe(current.reflection);
    expect(recovery.graph).toEqual(current.graph);
    cleanup();
    render(<App />);
    await showResumeScreen();
    openProjectFromList(records.find(record => record.id === recovery.id).title);
    await waitFor(() => expect(storedProject().id).toBe(recovery.id));
    expect(storedProject().submission.text).toBe(current.submission.text);
    expect(loadLibraryProject(window.localStorage, loadProjectLibrary(window.localStorage, storedProject(), true).find(record => record.id === imported.id)).submission.text).toBe('Older synthetic memo');
  });

  it.each(['course', 'public'])('downloads the complete map and private recovery for a saved %s project', async audience => {
    const project = makeMapProject();
    project.sharingTier = audience;
    project.instructor.maxSharingTier = 'public';
    project.submission.sensitive = true;
    project.submission.text = 'PRIVATE synthetic memo';
    project.reflection = 'PRIVATE current notes';
    for (const [scale, progress] of Object.entries(project.levelProgress)) progress.reflection = `PRIVATE ${scale} notes`;
    const blobs = [];
    vi.stubGlobal('Blob', class { constructor(parts) { blobs.push(parts.join('')); } });
    const priorCreate = URL.createObjectURL;
    const priorRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:recovery');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      seedProject(project);
      render(<App startInWorkspace cloudError="Synthetic account save failure" />);
      fireEvent.click(await screen.findByRole('button', { name: 'Download private recovery' }));
      const recovered = parseProject(blobs[0]);
      expect(recovered.submission).toEqual(project.submission);
      expect(recovered.reflection).toBe(project.reflection);
      expect(recovered.levelProgress).toEqual(project.levelProgress);
      expect(recovered.graph).toEqual(project.graph);
      expect(recovered.candidates).toEqual(project.candidates);
      expect(recovered.sharingTier).toBe(audience);
      expect(Object.keys(recovered.levelProgress)).toHaveLength(4);
      openExports();
      expect(screen.queryByRole('combobox', { name: 'Export audience' })).not.toBeInTheDocument();
      fireEvent.change(screen.getByRole('combobox',{name:'File format'}),{target:{value:'json'}}); fireEvent.click(screen.getByRole('button',{name:'Download',exact:true}));
      const downloaded = parseProject(blobs[1]);
      expect(downloaded.submission).toEqual(project.submission);
      expect(downloaded.reflection).toBe(project.reflection);
      expect(downloaded.levelProgress).toEqual(project.levelProgress);
      expect(downloaded.graph).toEqual(project.graph);
      expect(downloaded.candidates).toEqual(project.candidates);
      expect(downloaded.sharingTier).toBe('private');
      expect(storedProject().sharingTier).toBe(audience);
    } finally {
      if (priorCreate === undefined) delete URL.createObjectURL; else URL.createObjectURL = priorCreate;
      if (priorRevoke === undefined) delete URL.revokeObjectURL; else URL.revokeObjectURL = priorRevoke;
    }
  });

  it('announces JSON import success only after the imported graph and scale become active', async () => {
    await resumeSavedProject(createBlankProject());
    openExports();
    const imported = makeMapProject();
    imported.id = 'synthetic-imported-map';
    imported.title = 'Imported synthetic map';
    fireEvent.change(document.querySelector('.export-dropdown__import input'), { target: { files: [{ name: 'synthetic.json', size: 1000, text: async () => serializeProject(imported) }] } });
    await waitFor(() => expect(storedProject().id).toBe(imported.id));
    expect(storedProject().graph).toEqual(imported.graph);
    expect(storedProject().activeScale).toBe(imported.activeScale);
    expect(document.querySelector('.toast')).toHaveTextContent('Project imported and validated.');
  });

  it('moves a node through the CTM path and sends the accepted, minimized prototype-event request', async () => {
    const project = makeMapProject('micro');
    project.graph = { nodes: [{ ...project.graph.nodes[0], x: 420, y: 270 }], edges: [] };
    await openMapProject(project);
    const node = project.graph.nodes[0];
    const svg = mapCanvas();
    const nodeElement = document.querySelector(`[data-graph-id="${node.id}"]`);
    const start = renderedNodePosition(node.id);
    const zoom = viewportTransform().zoom;
    svg.getScreenCTM = () => ({ inverse: () => ({}) });
    svg.createSVGPoint = () => ({
      x: 0,
      y: 0,
      matrixTransform() { return { x: (this.x - 11) / 2, y: (this.y - 13) / 3 }; },
    });

    fireEvent.pointerDown(nodeElement, { pointerId: 41, button: 0, clientX: 11 + start.x * 2, clientY: 13 + start.y * 3 });
    fireEvent.pointerMove(svg, { pointerId: 41, clientX: 11 + start.x * 2 + 32, clientY: 13 + start.y * 3 + 27 });
    fireEvent.pointerUp(svg, { pointerId: 41, clientX: 11 + start.x * 2 + 32, clientY: 13 + start.y * 3 + 27 });

    const expected = { x: start.x + Math.round(16 / zoom), y: start.y + Math.round(9 / zoom) };
    await waitFor(() => expect(document.querySelector(`[data-graph-id="${node.id}"]`)).toHaveAttribute('transform', `translate(${expected.x} ${expected.y})`));
    await waitFor(() => expect(eventRequests('node_moved')).toHaveLength(1));
    expect(eventRequests('node_moved')[0].body).toEqual({
      event: 'node_moved',
      stage: 'Build map',
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
    const project = makeMapProject('micro');
    project.graph = { nodes: [{ ...project.graph.nodes[0], x: 420, y: 270 }], edges: [] };
    await openMapProject(project);
    const node = project.graph.nodes[0];
    const svg = mapCanvas();
    const nodeElement = document.querySelector(`[data-graph-id="${node.id}"]`);
    const start = renderedNodePosition(node.id);
    const dragZoom = viewportTransform().zoom;
    const draggedPosition = { x: Math.round(start.x + 24 / dragZoom), y: Math.round(start.y + 16 / dragZoom) };
    const inspector = screen.getByLabelText('Notebook');
    svg.getScreenCTM = () => ({ inverse: () => ({}) });
    svg.createSVGPoint = () => ({
      x: 0,
      y: 0,
      matrixTransform() { return { x: this.x, y: this.y }; },
    });

    await waitFor(() => expect(storedProject().teacherGovernance?.preflight).toBeTruthy());
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, PERSIST_DEBOUNCE_MS + 30)); });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    expect(inspector).not.toHaveAttribute('aria-hidden');
    expect(inspector).toHaveClass('is-open');
    fireEvent.pointerDown(nodeElement, { pointerId: 29, button: 0, clientX: start.x, clientY: start.y });
    expect(inspector).not.toHaveAttribute('aria-hidden');
    fireEvent.pointerMove(svg, { pointerId: 29, clientX: start.x + 24, clientY: start.y + 16 });
    expect(inspector).not.toHaveAttribute('aria-hidden');
    fireEvent.pointerUp(svg, { pointerId: 29, clientX: start.x + 24, clientY: start.y + 16 });
    expect(inspector).not.toHaveAttribute('aria-hidden');
    expect(inspector).toHaveClass('is-open');

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
    expect(inspector).not.toHaveAttribute('aria-hidden');
    const selectedActions = screen.getByRole('group', { name: 'Selected map item' });
    expect(selectedActions).toHaveTextContent(node.label);
    fireEvent.click(within(selectedActions).getByRole('button', { name: 'Edit', exact: true }));
    await waitFor(() => expect(inspector).toHaveClass('is-open'));
    expect(inspector).not.toHaveAttribute('aria-hidden');

    const mapControls = document.querySelector('.canvas-chrome');
    expect(mapControls).toBeNull();
    expect(document.querySelector('.notebook-map-tools')).not.toHaveAttribute('open');
    expect(screen.queryByRole('toolbar', { name: 'Map view controls' })).not.toBeInTheDocument();
    if (screen.queryByRole('button', { name: 'Edit', exact: true })) fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
    fireEvent.click(within(inspector).getByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(inspector).not.toHaveAttribute('aria-hidden');
      expect(document.querySelector('.canvas-chrome')).toBeNull();
      expect(document.querySelector(`[data-graph-id="${node.id}"]`)).toHaveFocus();
    });

    const zoomIn = mapTool('Zoom in');
    const durableViewport = viewportTransform();
    expect(zoomIn).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Pan' })).not.toBeInTheDocument();
    fireEvent.click(zoomIn);
    await waitFor(() => expect(viewportTransform().zoom).toBeGreaterThan(durableViewport.zoom));
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

  it('opens one reflection task without the removed map-note step or a model request', async () => {
    const project = makeMapProject('micro');
    project.mapAnnotation.text = 'An existing cross-map observation.';
    await openMapProject(project);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Workspace', exact: true })).getByRole('button', { name: 'Notebook', exact: true }));
    expect(screen.getByRole('textbox', { name: 'Field notes (required)' })).toBeVisible();
    expect(screen.queryByText('Ask the map')).not.toBeInTheDocument();
    expect(screen.queryByText('Notebook entries')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Map notes' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('#map-inspector textarea:not(details textarea)')).toHaveLength(1);
    openDetails('.saved-map-note');
    expect(screen.getByRole('textbox', { name: 'Map note', exact: true })).toHaveValue(project.mapAnnotation.text);
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/map/check')).toHaveLength(0);
    expect(storedProject().mapAnnotation.text).toBe(project.mapAnnotation.text);
  });

  it('removes map and item checks while preserving relationship editing', async () => {
    const project = makeMapProject('exosphere');
    const edge = project.graph.edges[0];
    await openMapProject(project);
    fireEvent.keyDown(document.querySelector(`[data-graph-id="${edge.id}"]`), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
    expect(screen.queryByRole('button', { name: /Check (map|this item|this connection)/i })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Relationship', exact: true })).toBeVisible();
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/map/check')).toHaveLength(0);
  });

  it('keeps Macro Field Notes to one required question without another model prompt', async () => {
    await resumeSavedProject(makeRevisionProject('macrosphere'));
    openNotebookSection('review');
    expect(screen.getByRole('textbox', { name: 'Field notes (required)' })).toBeRequired();
    expect(screen.queryByRole('button', { name: 'Suggest questions' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/map/check')).toHaveLength(0);
  });

  it('keeps the phone Notebook available and returns focus without extra target tabs', async () => {
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
    const inspector = screen.getByLabelText('Notebook');
    svg.getScreenCTM = () => ({ inverse: () => ({}) });
    svg.createSVGPoint = () => ({
      x: 0,
      y: 0,
      matrixTransform() { return { x: this.x, y: this.y }; },
    });

    const keyButton = mapTool('Map key');
    fireEvent.click(keyButton);
    expect(screen.getByLabelText('Map key')).toBeVisible();
    expect(inspector).not.toHaveAttribute('aria-hidden');
    expect(inspector).not.toHaveAttribute('inert');
    fireEvent.pointerDown(nodeElement, { pointerId: 51, button: 0, clientX: position.x, clientY: position.y });
    fireEvent.pointerUp(svg, { pointerId: 51, clientX: position.x, clientY: position.y });
    expect(inspector).not.toHaveAttribute('aria-hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
    await waitFor(() => expect(inspector).toHaveClass('is-open'));
    expect(screen.queryByLabelText('Map key')).not.toBeInTheDocument();
    expect(inspector).not.toHaveAttribute('aria-hidden');
    expect(inspector).not.toHaveAttribute('inert');

    expect(within(inspector).queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(within(inspector).queryByRole('tablist')).not.toBeInTheDocument();
    fireEvent.keyDown(within(inspector).getByRole('button', { name: 'Done' }), { key: 'Escape' });
    await waitFor(() => expect(inspector).not.toHaveAttribute('aria-hidden'));
    expect(inspector).not.toHaveAttribute('inert');

    fireEvent.pointerDown(nodeElement, { pointerId: 52, button: 0, clientX: position.x, clientY: position.y });
    fireEvent.pointerUp(svg, { pointerId: 52, clientX: position.x, clientY: position.y });
    expect(inspector).not.toHaveAttribute('aria-hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
    await waitFor(() => expect(inspector).toHaveClass('is-open'));
    if (screen.queryByRole('button', { name: 'Edit', exact: true })) fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
    fireEvent.click(within(inspector).getByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(inspector).not.toHaveAttribute('aria-hidden');
      expect(nodeElement).toHaveFocus();
    });
  });

  it('uses meet-style letterboxing in the no-CTM fallback for a nonmatching aspect ratio', async () => {
    const project = makeMapProject('micro');
    project.graph = { nodes: [{ ...project.graph.nodes[0], x: 420, y: 270 }], edges: [] };
    await openMapProject(project);
    const node = project.graph.nodes[0];
    const svg = mapCanvas();
    const nodeElement = document.querySelector(`[data-graph-id="${node.id}"]`);
    const position = renderedNodePosition(node.id);
    const zoom = viewportTransform().zoom;
    svg.getScreenCTM = () => null;
    svg.getBoundingClientRect = () => ({ left: 100, top: 50, width: 420, height: 540, right: 520, bottom: 590, x: 100, y: 50, toJSON() {} });
    const startX = 100 + position.x * 0.5;
    const startY = 185 + position.y * 0.5;

    fireEvent.pointerDown(nodeElement, { pointerId: 7, button: 0, clientX: startX, clientY: startY });
    fireEvent.pointerMove(svg, { pointerId: 7, clientX: startX + 20, clientY: startY + 15 });
    fireEvent.pointerUp(svg, { pointerId: 7, clientX: startX + 20, clientY: startY + 15 });

    const [, , viewWidth, viewHeight] = svg.getAttribute('viewBox').split(/\s+/).map(Number);
    const scale = Math.min(420/viewWidth, 540/viewHeight);
    const expected = { x: position.x + Math.round(20 / scale / zoom), y: position.y + Math.round(15 / scale / zoom) };
    await waitFor(() => expect(document.querySelector(`[data-graph-id="${node.id}"]`)).toHaveAttribute('transform', `translate(${expected.x} ${expected.y})`));
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
    const project = makeMapProject('exosphere');
    project.graph.nodes.forEach((node, index) => {
      node.x = 80 + (index % 4) * 220;
      node.y = 70 + Math.floor(index / 4) * 130;
    });
    const restoredEdge = project.graph.edges.find((edge) => edge.scale === 'exosphere');
    const restoredNode = project.graph.nodes.find((node) => node.id === restoredEdge.source);
    restoredNode.annotations.analytical.text = 'Restored node annotation';
    restoredEdge.annotation.text = 'Restored relationship annotation';
    project.mapAnnotation.text = 'Restored whole-map annotation';
    project.viewport = { panX: 37, panY: -22, zoom: 1.25 };
    seedProject(project);

    const assertRestored = async () => {
      render(<App />);
      await showResumeScreen();
      expect(screen.getByRole('article', { name: project.title })).toBeVisible();
      openProjectFromList(project.title);
      expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
      const renderedNode = document.querySelector(`[data-graph-id="${restoredNode.id}"]`);
      expect(svgTextLines(renderedNode.querySelector('.node-label')).join('')).toBe(restoredNode.label);
      expect(storedProject().graph.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(project.graph.nodes.map(({ id, x, y }) => ({ id, x, y })));
      expect(storedProject().viewport).toEqual(project.viewport);
      const inspector = openNodeInspector(restoredNode.id);
      expect(within(inspector).getByRole('textbox', { name: /^Interpretation/ })).toHaveValue('Restored node annotation');
      openEdgeInspector(restoredEdge.id);
      const relationshipPanel = within(inspector).getByRole('region', { name: 'Connections' });
      expect(within(relationshipPanel).getByRole('textbox', { name: 'Interpretation' })).toHaveValue('Restored relationship annotation');
      fireEvent.click(within(screen.getByRole('navigation', { name: 'Workspace', exact: true })).getByRole('button', { name: 'Notebook', exact: true }));
      openDetails('.saved-map-note');
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
      type: index % 2 === 0 ? 'person' : 'object',
      scale: 'micro',
      status: 'pending',
      claimState: 'inference',
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
      scale: 'meso',
      status: 'pending',
      claimState: 'inference',
      notes: '',
      directed: true,
      rationale: 'The memo records this relationship.',
      evidence: 'Memo sentence 1',
      annotation: { id: stableId('annotation', `edge:${edgeId}:relationship`), text: '' },
    }] };
    project.releasedScales = ['micro', 'meso'];
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
      openDetails('.reflection-help:has(.map-check)');
      expect(screen.getByRole('textbox', { name: 'Field notes (required)' })).toBeVisible();
      expect(storedProject().events.some(event => event.action === 'source.imported')).toBe(true);
      expect(screen.queryByText('source imported')).not.toBeInTheDocument();
      expect(screen.queryByText('research leads')).not.toBeInTheDocument();
      openExports();
      fireEvent.change(screen.getByRole('combobox',{name:'File format'}),{target:{value:'csv'}}); fireEvent.click(screen.getByRole('button',{name:'Download',exact:true}));
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

      fireEvent.change(screen.getByRole('combobox',{name:'File format'}),{target:{value:'markdown'}}); fireEvent.click(screen.getByRole('button',{name:'Download',exact:true}));
      expect(blobs).toHaveLength(2);
      const markdown = blobs[1].parts.join('');
      expect(markdown).toContain('## Part 1 memo · Microsystem');
      expect(markdown).not.toMatch(/^## Source\b/m);
      expect(markdown).toContain('## Items needing evidence');
      expect(markdown).toContain(`${nodes[0].label} documents ${nodes[1].label} — arrow direction: source to target; level: Meso-level; evidence: Memo sentence 1`);
      expect(markdown).not.toMatch(/\b(?:student interpretation|inference|contested|research lead|retired|claim_state)\b/i);
    } finally {
      if (priorCreate === undefined) delete URL.createObjectURL; else URL.createObjectURL = priorCreate;
      if (priorRevoke === undefined) delete URL.revokeObjectURL; else URL.revokeObjectURL = priorRevoke;
    }
  });

  it('lets students draw a structure’s reach at the Macrosphere and commits the scope, never edges', async () => {
    const project = makeMapProject('macrosphere');
    project.instructor.evidenceRequired = true;
    const structureTemplate = project.graph.nodes.find((node) => node.scale === 'macrosphere');
    const microNodes = project.graph.nodes.filter((node) => node.scale === 'micro');
    expect(structureTemplate).toBeTruthy();
    expect(microNodes.length).toBeGreaterThanOrEqual(2);
    // The structure arrives as a pending candidate; nothing macro is live yet.
    project.graph.nodes = project.graph.nodes.filter((node) => node.scale !== 'macrosphere');
    project.graph.edges = project.graph.edges.filter((edge) => edge.scale !== 'macrosphere');
    project.candidates = {
      nodes: [{
        ...structuredClone(structureTemplate),
        label: 'Universal Pre-K Law',
        type: 'law',
        status: 'pending',
        claimState: 'inference',
        evidence: '',
        deontic: 'mandates',
        scopeNodeIds: [],
      }],
      edges: [],
    };
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);
    expect(await screen.findByRole('heading', { name: 'Suggestions' })).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: 'Suggestion type' }), { target: { value: 'nodes' } });
    const candidateRow = screen.getByRole('article');
    fireEvent.click(candidateRow.querySelector('.candidate-evidence summary'));
    fireEvent.change(within(candidateRow).getByLabelText('Evidence or question'), { target: { value: 'The memo identifies this policy condition.' } });
    // No connections step exists at this level.
    expect(screen.queryByRole('tab', { name: /Connections/ })).not.toBeInTheDocument();
    const reachEditor = screen.getByLabelText('Map items affected by Universal Pre-K Law');
    fireEvent.change(within(reachEditor).getByLabelText('How Universal Pre-K Law affects map items'), { target: { value: 'prohibits' } });
    const addSelect = within(reachEditor).getByLabelText('Add a map item affected by Universal Pre-K Law');
    fireEvent.change(addSelect, { target: { value: microNodes[0].id } });
    fireEvent.change(addSelect, { target: { value: microNodes[1].id } });
    expect(within(reachEditor).getByRole('button', { name: `Remove ${microNodes[0].label} from map items affected by Universal Pre-K Law` })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Add to map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    await waitFor(() => {
      const stored = storedProject();
      const structure = stored.graph.nodes.find((node) => node.label === 'Universal Pre-K Law');
      expect(structure).toMatchObject({ scale: 'macrosphere', deontic: 'prohibits', evidence: 'The memo identifies this policy condition.' });
      expect(structure.scopeNodeIds).toEqual([microNodes[0].id, microNodes[1].id]);
      expect(stored.graph.edges.filter((edge) => edge.scale === 'macrosphere')).toEqual([]);
    });
  });

  it('adds a missing larger-scale node at Macro while retaining required evidence and prior work', async () => {
    const p = makeMapProject('macrosphere'); p.instructor.evidenceRequired = true;
    await openMapProject(p); const original = structuredClone(storedProject().graph);
    fireEvent.click(mapTool('Add item')); const form = document.querySelector('.add-form');
    fireEvent.change(within(form).getByLabelText('Label'), { target: { value: 'Historic public housing underinvestment' } });
    fireEvent.change(within(form).getByLabelText('Type'), { target: { value: 'structure' } });
    expect(within(form).getByLabelText('Level')).toHaveValue('exosphere');
    fireEvent.click(within(form).getByRole('button', { name: 'Add node' }));
    expect(storedProject().graph).toEqual(original);
    expect(screen.getByText('Add evidence or a question before adding the node.')).toBeVisible();
    fireEvent.change(within(form).getByLabelText('Evidence or question'), { target: { value: 'Verify this larger-scale condition against the memo.' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add node' }));
    await waitFor(() => expect(storedProject().graph.nodes).toHaveLength(original.nodes.length + 1));
    expect(storedProject().graph.nodes.find(node => node.label === 'Historic public housing underinvestment')).toMatchObject({ scale: 'exosphere', type: 'structure' });
    expect(storedProject().graph.edges).toEqual(original.edges);
    expect(storedProject().activeScale).toBe('macrosphere');
  });

  it('rejects clause labels while preserving the larger-scale node draft', async () => {
    await openMapProject(makeMapProject('exosphere'));
    const original = structuredClone(storedProject().graph); fireEvent.click(mapTool('Add item'));
    const form = document.querySelector('.add-form');
    fireEvent.change(within(form).getByLabelText('Label'), { target: { value: 'Marcus facilitates it' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add node' }));
    expect(storedProject().graph).toEqual(original);
    expect(within(form).getByLabelText('Label')).toHaveValue('Marcus facilitates it');
    expect(screen.getByText(/Name one complete map item/)).toBeVisible();
  });

  it('commits a funding chain from one named Exo office to another without moving existing nodes', async () => {
    const project = makeMapProject('exosphere');
    const source = project.graph.nodes.find(node => node.scale === 'exosphere');
    const target = { ...structuredClone(source), id: 'city-funding-office', label: 'New York City Funding Office', x: source.x + 400,
      annotations: { analytical: { id: 'city-funding-analysis', text: '' }, evidence: { id: 'city-funding-evidence', text: '' } } };
    project.graph.nodes.push(target);
    const template = project.graph.edges.find(edge => edge.scale === 'exosphere');
    project.candidates = { nodes: [], edges: [{ ...structuredClone(template), id: 'office-funding-chain', source: source.id, target: target.id, sourceLabel: source.label, targetLabel: target.label, verb: 'funds', status: 'pending', claimState: 'inference', annotation: { id: 'funding-chain-annotation', text: '' } }] };
    project.stage = 2;
    await resumeSavedProject(project);
    const before = storedProject().graph.nodes.map(({ id, x, y }) => ({ id, x, y }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Suggestion type' }), { target: { value: 'edges' } });
    const row = screen.getByRole('combobox', { name: 'Outside decision setting' }).closest('article');
    expect(within(row).getByRole('combobox', { name: 'Affected setting or office' })).toHaveValue(target.id);
    fireEvent.click(within(row).getByRole('button', { name: 'Add to map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish review', exact: true }));
    await waitFor(() => expect(storedProject().graph.edges.find(edge => edge.id === 'office-funding-chain')).toMatchObject({ source: source.id, target: target.id, verb: 'funds', scale: 'exosphere' }));
    expect(storedProject().graph.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(before);
  });

  it.each([
    ['Meso-level item', 'meso'],
  ])('keeps an invalid Exo pathway to another %s visible until the student repairs it', async (_description, invalidScale) => {
    const project = makeMapProject('exosphere');
    const carriedMicroSetting = project.graph.nodes.find((node) => node.scale === 'micro' && MICRO_SETTING_NODE_TYPES.includes(node.type));
    const template = project.graph.edges.find((edge) => edge.scale === 'exosphere');
    const source = project.graph.nodes.find((node) => node.id === template.source);
    let invalidTarget = project.graph.nodes.find((node) => node.scale === invalidScale && node.id !== source.id);
    if (invalidScale === 'exosphere') {
      invalidTarget = {
        ...structuredClone(source),
        id: 'node_exo_city_access_office',
        label: 'New York City Access Office',
        annotations: {
          analytical: { id: 'annotation_exo_city_access_office_analytical', text: '' },
          evidence: { id: 'annotation_exo_city_access_office_evidence', text: '' },
        },
      };
      project.graph.nodes.push(invalidTarget);
    }
    project.candidates = {
      nodes: [],
      edges: [{
        ...structuredClone(template),
        id: `edge_exo_needs_${invalidScale}_repair`,
        target: invalidTarget.id,
        targetLabel: invalidTarget.label,
        status: 'pending',
        claimState: 'inference',
        annotation: { id: `annotation_edge_exo_needs_${invalidScale}_repair`, text: '' },
      }],
    };
    project.stage = 2;
    project.furthestStage = 2;

    await resumeSavedProject(project);
    fireEvent.change(screen.getByRole('combobox', { name: 'Suggestion type' }), { target: { value: 'edges' } });
    const row = screen.getByRole('combobox', { name: 'Outside decision setting' }).closest('article');
    expect(within(row).getByRole('option', { name: `Needs repair: ${invalidTarget.label}` })).toBeInTheDocument();
    expect(within(row).getByText(/Choose an affected Micro setting or outside office already on the map/)).toBeVisible();
    expect(within(row).getByRole('button', { name: 'Add to map' })).toBeDisabled();

    fireEvent.change(within(row).getByRole('combobox', { name: 'Affected setting or office' }), { target: { value: carriedMicroSetting.id } });
    await waitFor(() => expect(storedProject().candidates.edges[0]).toMatchObject({
      source: source.id,
      target: carriedMicroSetting.id,
      targetLabel: carriedMicroSetting.label,
      status: 'pending',
    }));
    expect(within(row).queryByText(/Choose an affected Micro setting or outside office already on the map/)).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Add to map' }));
    await waitFor(() => expect(storedProject().candidates.edges[0]).toMatchObject({ status: 'confirmed', claimState: 'student interpretation' }));
  });

  it.each(['meso', 'exosphere'])('preserves all earlier evidence and process metadata through compact %s editing and reload', async (scale) => {
    const project = makeMapProject(scale);
    const node = project.graph.nodes.find(item => item.scale === 'micro');
    const edge = project.graph.edges.find(item => item.scale === scale);
    node.claimEvidence = [{ id: 'saved_evidence', sourcePassage: 'Weekly meeting recorded.', studentInterpretation: 'Earlier interpretation', warrant: 'Earlier reasoning', uncertainty: 'Attendance unknown', counterevidence: 'One cancellation', missingVoice: 'Young people' }];
    node.annotations.evidence.text = 'Keep this separate evidence note.';
    edge.claimEvidence = structuredClone(node.claimEvidence);
    edge.relationshipProcess = { ...edge.relationshipProcess, frequency: 'Weekly', duration: 'Six months', conditions: 'Both offices are open', changeOverTime: 'New schedule' };
    const oldNode = structuredClone(node), oldEdge = structuredClone(edge);
    await openMapProject(project);
    let inspector = openNodeInspector(node.id);
    expect(within(inspector).getAllByRole('textbox')).toHaveLength(2);
    const interpretation = within(inspector).getByRole('textbox', { name: 'Interpretation' });
    expect(interpretation).not.toHaveAttribute('placeholder');
    fireEvent.change(interpretation, { target: { value: 'My concise interpretation.' } });
    fireEvent.blur(interpretation);
    fireEvent.click(within(inspector).getByText('Saved evidence and context'));
    expect(within(inspector).getByText('Earlier reasoning')).toBeVisible();
    inspector = openEdgeInspector(edge.id);
    expect(within(inspector).getAllByRole('textbox')).toHaveLength(2);
    fireEvent.change(within(inspector).getByLabelText('Arrow direction'), { target: { value: 'both directions' } });
    await waitFor(() => {
      const saved = storedProject();
      expect(saved.graph.nodes.find(n => n.id === node.id)).toMatchObject({ claimEvidence: oldNode.claimEvidence, annotations: { evidence: oldNode.annotations.evidence, analytical: { text: 'My concise interpretation.' } } });
      expect(saved.graph.edges.find(e => e.id === edge.id)).toMatchObject({ claimEvidence: oldEdge.claimEvidence, relationshipProcess: { ...oldEdge.relationshipProcess, direction: 'both directions' } });
    });
    const exported = createPortableProject(storedProject(), 'private');
    expect(exported.graph.nodes.find(n => n.id === node.id).claimEvidence).toEqual(oldNode.claimEvidence);
    cleanup(); render(<App />); await showResumeScreen(); openProjectFromList(project.title);
    await screen.findByRole('heading', { name: 'Systems map' });
    inspector = openNodeInspector(node.id);
    expect(within(inspector).getByRole('textbox', { name: 'Interpretation' })).toHaveValue('My concise interpretation.');
    expect(storedProject().graph.edges.find(e => e.id === edge.id).claimEvidence).toEqual(oldEdge.claimEvidence);
  });

  it('keeps preserved hidden Meso records out of the visible canvas fit', async () => {
    const original = makeMapProject('meso');
    const transforms = [];
    for (const x of [500, 9000]) {
      const project = structuredClone(original);
      const legacy = project.graph.nodes.find(node => node.scale === 'meso');
      legacy.x = x;
      legacy.y = 200;
      await openMapProject(project);
      expect(document.querySelector(`[data-graph-id="${legacy.id}"]`)).toBeNull();
      transforms.push(document.querySelector('.viewport-layer').getAttribute('transform'));
      expect(storedProject().graph.nodes.find(node => node.id === legacy.id).x).toBe(x);
      cleanup(); window.localStorage.clear();
    }
    expect(transforms[0]).toBe(transforms[1]);
  });

  it('never changes Notebook visibility when selecting a node or relationship', async () => {
    const project = makeMapProject('meso');
    await openMapProject(project);
    const nav = within(screen.getByRole('navigation', { name: 'Workspace', exact: true }));
    fireEvent.click(nav.getByRole('button', { name: 'Map', exact: true }));
    const node = document.querySelector('.graph-node');
    fireEvent.keyDown(node, { key: 'Enter' });
    expect(nav.getByRole('button', { name: 'Map', exact: true })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
    expect(nav.getByRole('button', { name: 'Notebook', exact: true })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(node, { key: 'Enter' });
    expect(nav.getByRole('button', { name: 'Notebook', exact: true })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(nav.getByRole('button', { name: 'Map', exact: true }));
    const edge = document.querySelector('.graph-edge');
    fireEvent.pointerDown(edge, { pointerId: 91, button: 0 }); fireEvent.pointerUp(edge, { pointerId: 91, button: 0 });
    expect(nav.getByRole('button', { name: 'Map', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reviews one node at a time and preserves every decision across the queue', async () => {
    const { project, candidate } = makeCandidateValidationProject();
    project.candidates.nodes = Array.from({ length: 9 }, (_, index) => ({
      ...structuredClone(candidate),
      id: `node_batched_candidate_${index + 1}`,
      label: `Peer navigator ${index + 1}`,
      annotations: {
        analytical: { id: `annotation_batched_candidate_${index + 1}_analytical`, text: '' },
        evidence: { id: `annotation_batched_candidate_${index + 1}_evidence`, text: '' },
      },
    }));
    await resumeSavedProject(project);
    expect(screen.queryByRole('button', { name: 'Continue', exact: true })).not.toBeInTheDocument();

    const list = document.querySelector('.candidate-list');
    expect(within(list).getAllByRole('article')).toHaveLength(1);
    expect(screen.queryByRole('navigation', { name: 'Suggestions' })).not.toBeInTheDocument();
    for (let i = 1; i <= 9; i++) {
      const row = within(list).getByRole('article');
      expect(within(row).getByRole('heading')).toHaveTextContent('Peer navigator ' + i);
      fireEvent.click(within(row).getByRole('button', { name: i === 2 ? 'Set aside' : 'Add to map' }));
      expect(within(list).getAllByRole('article')).toHaveLength(1);
      if (i < 9) fireEvent.click(screen.getByRole('button', { name: 'Next suggestion' }));
    }
    await waitFor(() => {
      expect(storedProject().candidates.nodes).toHaveLength(9);
      expect(storedProject().candidates.nodes[1].reviewDecision).toBe('set aside');
      expect(storedProject().candidates.nodes.filter(item => item.reviewDecision === 'added')).toHaveLength(8);
    });
  });

  it('lists every generated connection suggestion without paging', async () => {
    const project = createDefaultProject();
    project.instructor.requireStudentConfirmation = true;
    const nodes = extractCandidates(project.submission).nodes.slice(0, 3).map((node, index) => ({
      ...node,
      type: ['person', 'group', 'object'][index],
      scale: 'micro',
      status: 'confirmed',
      claimState: 'student interpretation',
      focalParticipation: 'direct',
      settingNodeIds: [],
    }));
    project.activeScale = 'meso';
    project.releasedScales = ['micro', 'meso'];
    project.candidates = { nodes: [], edges: [] };
    project.graph = { nodes, edges: [] };
    project.stage = 2;
    project.furthestStage = 2;
    project.levelProgress.meso = { stage: 2, reflection: '' };
    connectionSuggestionResponder = (body) => jsonResponse({
      connections: Array.from({ length: 9 }, (_, index) => ({
        source: body.nodes[index % body.nodes.length].id,
        target: body.nodes[(index + 1) % body.nodes.length].id,
        verb: `supports pathway ${index + 1}`,
        rationale: `The memo supports pathway ${index + 1}.`,
      })),
    }, 201);
    await resumeSavedProject(project);

    fireEvent.change(screen.getByRole('combobox', { name: 'Suggestion type' }), { target: { value: 'suggest' } });
    fireEvent.click(screen.getByRole('button', { name: 'Suggest connections' }));
    expect(await screen.findByDisplayValue('supports pathway 1')).toBeVisible();
    expect(within(document.querySelector('.connection-suggestions')).getAllByRole('article')).toHaveLength(9);
    for (let i = 1; i <= 9; i++) expect(screen.getByDisplayValue('supports pathway ' + i)).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Connection suggestion groups' })).not.toBeInTheDocument();
  });

  it('keeps a suggestion set aside for more evidence off the graph after the map opens', async () => {
    const { project, candidate } = makeCandidateValidationProject();
    const graphBefore = structuredClone(project.graph);
    await resumeSavedProject(project);

    const decision = screen.getByDisplayValue(candidate.label).closest('article');
    fireEvent.click(within(decision).getByRole('button', { name: 'Set aside' }));
    await waitFor(() => expect(storedProject().candidates.nodes.find((item) => item.id === candidate.id)).toMatchObject({
      status: 'research lead',
      claimState: 'research lead',
      reviewDecision: 'set aside',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    await waitFor(() => expect(storedProject().stage).toBe(3));
    expect(storedProject().graph).toEqual(graphBefore);
    expect(storedProject().graph.nodes.some((item) => item.id === candidate.id)).toBe(false);
    expect(document.querySelector(`[data-graph-id="${candidate.id}"]`)).toBeNull();
  });

  it('restores each released level to its own stage and reflection', async () => {
    const project = makeMapProject('exosphere');
    project.stage = 2;
    project.furthestStage = 4;
    project.reflection = 'Exo reflection';
    project.levelProgress = createLevelProgress({ activeScale: 'exosphere', stage: 2, reflection: 'Exo reflection' });
    project.levelProgress.micro = { stage: 4, reflection: 'Micro reflection' };
    project.levelProgress.meso = { stage: 3, reflection: 'Meso reflection' };
    await resumeSavedProject(project);
    expect(await screen.findByRole('heading', { name: 'Suggestions' })).toBeVisible();

    openWorkLevelMenu();
    fireEvent.change(screen.getByRole('combobox', { name: 'Work level' }), { target: { value: 'meso' } });
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    await waitFor(() => expect(storedProject()).toMatchObject({ activeScale: 'meso', stage: 3, reflection: 'Meso reflection' }));

    openWorkLevelMenu();
    fireEvent.change(screen.getByRole('combobox', { name: 'Work level' }), { target: { value: 'micro' } });
    expect(await screen.findByRole('textbox', { name: 'Field notes (required)' })).toBeVisible();
    await waitFor(() => expect(storedProject()).toMatchObject({ activeScale: 'micro', stage: 4, reflection: 'Micro reflection' }));

    openWorkLevelMenu();
    fireEvent.change(screen.getByRole('combobox', { name: 'Work level' }), { target: { value: 'exosphere' } });
    expect(await screen.findByRole('heading', { name: 'Suggestions' })).toBeVisible();
    await waitFor(() => expect(storedProject()).toMatchObject({ activeScale: 'exosphere', stage: 2, reflection: 'Exo reflection' }));
    expect(storedProject().levelProgress).toMatchObject({
      micro: { stage: 4, reflection: 'Micro reflection' },
      meso: { stage: 3, reflection: 'Meso reflection' },
      exosphere: { stage: 2, reflection: 'Exo reflection' },
    });
  });

  it('preserves prior inquiry evidence while editing the two project details', async () => {
    const project = createDefaultProject();
    project.inquiry = 'Evidence used: Memo and public meeting notes\nMissing perspectives: People who could not attend';
    await resumeSavedProject(project);
    fireEvent.click(screen.getByText('Project details', { selector: 'summary' }));
    expect(document.querySelectorAll('.project-context-fields input')).toHaveLength(2);
    fireEvent.change(screen.getByRole('textbox', { name: 'Project title' }), { target: { value: 'Community access map' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name or Group Name' }), { target: { value: 'Study group' } });
    await waitFor(() => expect(storedProject()).toMatchObject({ title: 'Community access map', participantName: 'Study group', inquiry: project.inquiry }));

    cleanup();
    render(<App />);
    await showResumeScreen();
    openProjectFromList('Community access map');
    expect(await screen.findByRole('heading', { name: 'Memo' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Project title' })).toHaveValue('Community access map');
    expect(screen.getByRole('textbox', { name: 'Name or Group Name' })).toHaveValue('Study group');
    expect(storedProject().inquiry).toBe(project.inquiry);
  });

  it('combines the current level and stage in the Progress control and dialog context', async () => {
    const project = makeMapProject('exosphere');
    await openMapProject(project);

    const progress = screen.getByRole('button', { name: 'Progress', exact: true });
    expect(progress).toHaveTextContent('Progress');
    fireEvent.click(progress);
    const dialog = screen.getByRole('dialog', { name: 'Progress' });
    expect(dialog.querySelector('.modal-context')).toHaveTextContent('Exo-level · Map');
    const levels = within(dialog).getByRole('region', { name: 'Level progression' });
    expect(within(levels).getByText(/Micro-level/).closest('li')).toHaveTextContent('Available');
    expect(within(levels).getByText('Meso-level').closest('li')).toHaveTextContent('Available');
    expect(within(levels).getByText('Exo-level').closest('li')).toHaveTextContent('Current');
    expect(within(levels).getByText('Macro-level').closest('li')).toHaveTextContent('Not started');
  });

  it('distinguishes completed and currently completed levels in Progress', async () => {
    const project = makeMapProject('exosphere');
    project.completedScales = ['micro', 'exosphere'];
    await openMapProject(project);

    openProjectMenu('Progress');
    const levels = within(screen.getByRole('dialog', { name: 'Progress' })).getByRole('region', { name: 'Level progression' });
    expect(within(levels).getByText(/Micro-level/).closest('li')).toHaveTextContent('Complete');
    expect(within(levels).getByText('Meso-level').closest('li')).toHaveTextContent('Available');
    expect(within(levels).getByText('Exo-level').closest('li')).toHaveTextContent('Current · Complete');
    expect(within(levels).getByText('Macro-level').closest('li')).toHaveTextContent('Not started');
  });

  it('keeps the carried Micro map and Meso relationships visible before Exo has suggestions', async () => {
    const project = makeMapProject('meso');
    project.releasedScales = ['micro', 'meso', 'exosphere'];
    project.levelProgress.exosphere = { stage: 1, reflection: '' };
    project.graph.nodes = project.graph.nodes.filter(n => n.scale === 'micro');
    project.graph.edges = project.graph.edges.filter(e => e.scale === 'meso');
    const before = structuredClone(project.graph);
    await openMapProject(project);
    for (const scale of ['micro', 'meso', 'exosphere', 'meso', 'micro', 'exosphere']) {
      fireEvent.change(screen.getByRole('combobox', { name: 'Work level' }), { target: { value: scale } });
      if (screen.queryByRole('button', { name: 'Map', exact: true })) fireEvent.click(within(screen.getByRole('navigation', { name: 'Workspace', exact: true })).getByRole('button', { name: 'Map', exact: true }));
      await waitFor(() => expect(document.querySelectorAll('.graph-node')).toHaveLength(before.nodes.length));
      expect(document.querySelectorAll('.graph-edge')).toHaveLength(scale === 'micro' ? 0 : before.edges.length);
      expect(storedProject().graph).toEqual(before);
    }
    const saved = parseProject(serializeProject(storedProject())); cleanup(); await openMapProject(saved);
    expect(document.querySelectorAll('.graph-node')).toHaveLength(before.nodes.length);
    expect(document.querySelectorAll('.graph-edge')).toHaveLength(before.edges.length);
    expect(storedProject().graph).toEqual(before);
  });

  it('offers All levels with every released canvas item present', async () => {
    const project = makeMapProject('exosphere');
    const cumulative = graphForScale(project, 'all');
    await openMapProject(project);
    fireEvent.change(mapLayer(), { target: { value: 'all' } });

    expect(mapLayer()).toHaveValue('all');
    expect(document.querySelectorAll('.graph-node')).toHaveLength(cumulative.nodes.length);
    expect(document.querySelectorAll('.graph-edge')).toHaveLength(cumulative.edges.length);
    expect(mapCanvas()).toHaveAttribute('aria-label', expect.stringContaining(`All-layers map. ${cumulative.nodes.length} nodes and ${cumulative.edges.length}`));
  });

  describe('October meeting Micro and Meso workflow', () => {
    function meetingProject() {
      const project = makeMapProject('meso');
      project.graph.nodes = withDefaultNodeLayout(project.graph.nodes.filter((node) => node.scale === 'micro').slice(0, 4).map((node, index) => ({ ...node, x: 180 + index * 280, y: 240 })));
      project.graph.edges = [];
      project.instructor.evidenceRequired = false;
      return project;
    }
    it('connects two existing nodes with a two-way arrow and keeps the same nodes across layers', async () => {
      const project = await openMapProject(meetingProject());
      const [source, target] = project.graph.nodes;
      const before = new Map(project.graph.nodes.map((node) => [node.id, renderedNodePosition(node.id)]));
      fireEvent.keyDown(document.querySelector(`[data-graph-id="${source.id}"]`), { key: 'Enter' });
      if (screen.queryByRole('button', { name: 'Edit', exact: true })) fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
      fireEvent.click(screen.getByRole('button', { name: `Connect from ${source.label}`, exact: true }));
      expect(document.querySelector('.map-connect-status')).toHaveTextContent(`${source.label} selected. Choose the ending item.`);
      fireEvent.keyDown(document.querySelector(`[data-graph-id="${target.id}"]`), { key: 'Enter' });
      if (screen.queryByRole('button', { name: 'Edit', exact: true })) fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Relationship', exact: true }), { target: { value: 'talks with' } });
      fireEvent.change(screen.getByRole('combobox', { name: 'Direction', exact: true }), { target: { value: 'both directions' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add relationship', exact: true }));
      await waitFor(() => expect(storedProject().graph.edges).toHaveLength(1));
      const edge = storedProject().graph.edges[0];
      expect(edge).toMatchObject({ source: source.id, target: target.id, scale: 'meso', relationshipProcess: { direction: 'both directions' } });
      const line = document.querySelector(`[data-graph-id="${edge.id}"] .edge-line`);
      expect(line).toHaveAttribute('marker-start', 'url(#arrowhead)');
      expect(line).toHaveAttribute('marker-end', 'url(#arrowhead)');
      const connectedPositions=new Map(project.graph.nodes.map(node=>[node.id,renderedNodePosition(node.id)]));
      expect(connectedPositions).not.toEqual(before);
      fireEvent.click(screen.getByRole('button', { name: 'Done', exact: true }));
      fireEvent.change(mapLayer(), { target: { value: 'micro' } });
      expect(document.querySelectorAll('.graph-edge')).toHaveLength(0);
      expect(document.querySelectorAll('.graph-node')).toHaveLength(project.graph.nodes.length);
      project.graph.nodes.forEach((node) => expect(renderedNodePosition(node.id)).toEqual(connectedPositions.get(node.id)));
      fireEvent.change(mapLayer(), { target: { value: 'meso' } });
      expect(document.querySelectorAll('.graph-edge')).toHaveLength(1);
      expect(document.querySelector('[data-ecology-layer="meso"]')).toBeNull();
      project.graph.nodes.forEach((node) => expect(renderedNodePosition(node.id)).toEqual(connectedPositions.get(node.id)));
      expect(() => validateProject(storedProject())).not.toThrow();
    });
    it('opens the relationship form from the clicked source after a target tap', async () => {
      const project = await openMapProject(meetingProject());
      const [target, , source] = project.graph.nodes;
      expect(screen.queryByRole('button', { name: /^Connect from / })).toBeNull();
      for (const [index, node] of [source, target].entries()) {
        const element = document.querySelector(`[data-graph-id="${node.id}"]`);
        fireEvent.pointerDown(element, { pointerId: index + 1, clientX: 200 + index * 100, clientY: 200, button: 0 });
        fireEvent.pointerUp(element, { pointerId: index + 1, clientX: 200 + index * 100, clientY: 200, button: 0 });
        fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
        if (index === 0) fireEvent.click(screen.getByRole('button', { name: `Connect from ${source.label}`, exact: true }));
      }
      expect(screen.getByRole('heading', { name: 'New relationship' })).toBeVisible();
      expect(screen.getByRole('heading', { name: `${source.label} and ${target.label}`, level: 2, exact: true })).toBeVisible();
      expect(screen.getByRole('combobox', { name: 'From', exact: true })).toHaveValue(source.id);
      expect(screen.getByRole('combobox', { name: 'To', exact: true })).toHaveValue(target.id);
      expect(storedProject().graph.edges).toHaveLength(0);
    });
    it.each(['source', 'target'])('keeps the relationship draft after a target touch and a compatibility double-click on the %s', async (compatibilityTarget) => {
      installPhoneLayout();
      const project = await openMapProject(meetingProject());
      const [source, target] = project.graph.nodes;
      openNodeInspector(source.id);
      fireEvent.click(screen.getByRole('button', { name: `Connect from ${source.label}`, exact: true }));
      const node = document.querySelector(`[data-graph-id="${target.id}"]`);
      fireEvent.pointerDown(node, { pointerId: 81, pointerType: 'touch', clientX: 250, clientY: 433, button: 0 });
      fireEvent.pointerUp(node, { pointerId: 81, pointerType: 'touch', clientX: 250, clientY: 433, button: 0 });
      fireEvent.click(node, { detail: 2, clientX: 250, clientY: 433 });
      const shiftedTarget = document.querySelector(`[data-graph-id="${compatibilityTarget === 'source' ? source.id : target.id}"]`);
      fireEvent.doubleClick(shiftedTarget, { detail: 2, clientX: 250, clientY: 433 });
      expect(screen.getByLabelText('Notebook')).not.toHaveAttribute('aria-hidden');
      expect(screen.getByRole('button', { name: 'Add', exact: true })).toHaveAttribute('aria-expanded', 'false');
      expect(storedProject().graph.edges).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
      expect(screen.getByRole('combobox', { name: 'From', exact: true })).toHaveValue(source.id);
      expect(screen.getByRole('combobox', { name: 'To', exact: true })).toHaveValue(target.id);
    });
    it('keeps the reading arrangement and saved graph when revisiting Micro and Meso after Exo is released', async () => {
      const project = meetingProject();
      project.layout = {manualNodeIds: project.graph.nodes.map(node => node.id)};
      project.releasedScales.push('exosphere');
      project.levelProgress.exosphere = { stage: 3, reflection: '' };
      await openMapProject(project);
      const saved = new Map(project.graph.nodes.map((node) => [node.id, renderedNodePosition(node.id)]));
      for (const scale of ['micro', 'meso', 'micro', 'meso']) {
        fireEvent.change(screen.getByRole('combobox', { name: 'Work level' }), { target: { value: scale } });
        await waitFor(() => expect(mapLayer()).toHaveValue(scale));
        project.graph.nodes.forEach((node) => expect(renderedNodePosition(node.id)).toEqual(saved.get(node.id)));
        expect(storedProject().graph).toEqual(project.graph);
      }
    });
    it('edits and reloads a reverse arrow with matching accessible text', async () => {
      const project = meetingProject();
      const [source, target] = project.graph.nodes;
      project.graph.edges = [{ id: 'meeting-edge', source: source.id, target: target.id, sourceLabel: source.label, targetLabel: target.label, verb: 'talks with', scale: 'meso', status: 'confirmed', claimState: 'student interpretation', notes: '', evidence: 'Meeting notes', annotation: { id: 'meeting-edge-annotation', text: '' }, relationshipProcess: { frequency: '', duration: '', direction: 'source to target', conditions: '', changeOverTime: '' } }];
      await openMapProject(project);
      fireEvent.keyDown(document.querySelector('[data-graph-id="meeting-edge"]'), { key: 'Enter' });
      if (screen.queryByRole('button', { name: 'Edit', exact: true })) fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
      fireEvent.change(screen.getByRole('combobox', { name: 'Arrow direction', exact: true }), { target: { value: 'not yet known' } });
      const unknownLine = document.querySelector('[data-graph-id="meeting-edge"] .edge-line');
      expect(unknownLine).not.toHaveAttribute('marker-start');
      expect(unknownLine).not.toHaveAttribute('marker-end');
      expect(document.querySelector('.item-editor-title p')).toHaveTextContent('direction not yet known');
      expect(screen.getByRole('combobox', { name: 'Arrow direction', exact: true })).toHaveValue('not yet known');
      fireEvent.change(screen.getByRole('combobox', { name: 'Arrow direction', exact: true }), { target: { value: 'target to source' } });
      expect(document.querySelector('.item-editor-title p')).toHaveTextContent(`${target.label} talks with ${source.label}`);
      await waitFor(() => expect(storedProject().graph.edges[0].relationshipProcess.direction).toBe('target to source'));
      const saved = parseProject(serializeProject(storedProject()));
      cleanup();
      await openMapProject(saved);
      const edge = document.querySelector('[data-graph-id="meeting-edge"]');
      expect(edge).toHaveAttribute('aria-label', `${target.label} talks with ${source.label}, direction: target to source, Meso-level connection`);
      expect(edge.querySelector('.edge-line')).toHaveAttribute('marker-start', 'url(#arrowhead)');
      expect(edge.querySelector('.edge-line')).not.toHaveAttribute('marker-end');
    });
    it('carries direction, missing status, and supported connector details into every guidance request', () => {
      const project = meetingProject();
      const [source, target] = project.graph.nodes;
      const process = { direction: 'target to source', connectionStatus: 'missing', strength: 'contested', channel: 'Paper form', connectingWork: 'Parent', familyCount: 34 };
      project.graph.edges = [{ id: 'carried-process-edge', source: source.id, target: target.id, sourceLabel: source.label, targetLabel: target.label, verb: 'requests support from', scale: 'meso', status: 'confirmed', relationshipProcess: process }];
      for (const relationship of [preflightEvaluationPayload(project).carriedConnections[0], connectionSuggestionPayload(project, 'Find another supported connection.').relationships[0], mapCheckPayload(project, 'whole-map').relationships[0]]) {
        expect(relationship).toMatchObject({ source: source.id, target: target.id, verb: 'requests support from', relationshipProcess: process });
        expect(relationship.relationshipProcess).toEqual(process);
      }
      expect(mapCheckPayload(project, 'whole-map').relationships[0].id).toBe('carried-process-edge');
      project.graph.edges[0].relationshipProcess = { direction: '', connectionStatus: 'unknown', strength: 'unknown', familyCount: 0, channel: '' };
      expect(mapCheckPayload(project, 'whole-map').relationships[0].relationshipProcess).toEqual({ familyCount: 0 });
      project.graph.edges[0].relationshipProcess.familyCount = null;
      expect(mapCheckPayload(project, 'whole-map').relationships[0]).not.toHaveProperty('relationshipProcess');
    });
    it('keeps sixty carried connections within the context budget by omitting empty process defaults', () => {
      const project = meetingProject();
      const [source, target] = project.graph.nodes;
      project.graph.edges = Array.from({ length: 60 }, (_, index) => ({ id: `context-edge-${index}`, source: source.id, target: target.id, verb: `shares item ${index + 1} with`, scale: 'meso', status: 'confirmed', relationshipProcess: { frequency: '', duration: '', direction: 'target to source', conditions: '', changeOverTime: '', channel: '', connectingWork: '', strength: 'unknown', familyCount: null, connectionStatus: 'missing' } }));
      for (const relationships of [preflightEvaluationPayload(project).carriedConnections, connectionSuggestionPayload(project, 'Find another supported connection.').relationships, mapCheckPayload(project, 'whole-map').relationships]) {
        expect(relationships).toHaveLength(60);
        expect(new TextEncoder().encode(JSON.stringify(relationships)).byteLength).toBeLessThan(16 * 1024);
        expect(relationships[0].relationshipProcess).toEqual({ direction: 'target to source', connectionStatus: 'missing' });
      }
    });
    it('adds an omitted person at Meso as Micro and connects it without moving existing items or requiring guidance', async () => {
      const project = await openMapProject(meetingProject());
      expect(project.preflight).toBeNull();
      const priorPositions = storedProject().graph.nodes.map(({ id, x, y }) => ({ id, x, y }));
      fireEvent.click(mapTool('Add item'));
      const form = document.querySelector('.add-form');
      expect(within(form).getByRole('heading', { name: 'Add a missing Micro item' })).toBeVisible();
      fireEvent.change(within(form).getByRole('textbox', { name: 'Label', exact: true }), { target: { value: 'Assistant principal' } });
      expect(within(form).getByRole('combobox', { name: 'Level', exact: true })).toHaveValue('micro');
      fireEvent.click(within(form).getByRole('button', { name: 'Add node', exact: true }));
      await waitFor(() => expect(storedProject().graph.nodes).toHaveLength(project.graph.nodes.length + 1));
      const added = storedProject().graph.nodes.find(node => node.label === 'Assistant principal');
      expect(added).toMatchObject({ scale: 'micro', type: 'person', origin: 'student entry' });
      expect(added.x).toBeGreaterThanOrEqual(Math.min(...priorPositions.map(node => node.x)) - 250);
      expect(added.x).toBeLessThanOrEqual(Math.max(...priorPositions.map(node => node.x)) + 250);
      expect(Math.abs(added.y - 240)).toBeLessThan(180);
      expect(storedProject().activeScale).toBe('meso');
      expect(storedProject().graph.nodes.filter(node => node.id !== added.id).map(({ id, x, y }) => ({ id, x, y }))).toEqual(priorPositions);
      fireEvent.click(screen.getByRole('button', { name: 'Connect from Assistant principal', exact: true }));
      expect(document.querySelector('.map-connect-status')).toHaveTextContent('Assistant principal selected');
      fireEvent.keyDown(document.querySelector(`[data-graph-id="${project.graph.nodes[0].id}"]`), { key: 'Enter' });
      if (screen.queryByRole('button', { name: 'Edit', exact: true })) fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Relationship', exact: true }), { target: { value: 'supports' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add relationship', exact: true }));
      await waitFor(() => expect(storedProject().graph.edges).toHaveLength(1));
      expect(storedProject().graph.edges[0]).toMatchObject({ scale: 'meso', source: added.id, target: project.graph.nodes[0].id });
      expect(storedProject().preflight).toBeNull();
    });
    it('shares one Micro boundary across Micro and Meso, including existing relationship routes', async () => {
      const project = meetingProject();
      const [source, target] = project.graph.nodes;
      project.graph.edges = [{ id: 'boundary-edge', source: source.id, target: target.id, sourceLabel: source.label, targetLabel: target.label, verb: 'supports', scale: 'meso', status: 'confirmed', claimState: 'student interpretation', evidence: 'Synthetic evidence', notes: '', annotation: { id: 'boundary-edge-annotation', text: '' } }];
      await openMapProject(project);
      const boundary = () => document.querySelector('[data-ecology-layer="micro"] ellipse').outerHTML;
      const mesoBoundary = boundary();
      expect(document.querySelectorAll('[data-ecology-layer]')).toHaveLength(1);
      fireEvent.change(mapLayer(), { target: { value: 'micro' } });
      expect(boundary()).toBe(mesoBoundary);
      expect(document.querySelectorAll('.graph-edge')).toHaveLength(0);
      fireEvent.change(mapLayer(), { target: { value: 'meso' } });
      expect(boundary()).toBe(mesoBoundary);
      expect(document.querySelectorAll('.graph-edge')).toHaveLength(1);
    });
    it('keeps model-supported Meso details through review and commit, including zero families and missing status', async () => {
      const project = meetingProject();
      const process = { direction: 'both directions', strength: 'contested', channel: 'Phone', connectingWork: 'Parent', familyCount: 0, connectionStatus: 'missing' };
      preflightEvaluationResponder = body => {
        const review = memoReviewFixture('meso', project.graph.nodes);
        review.connections[0].relationshipProcess = process;
        const evaluation = evaluationRecord(body, { review });
        evaluation.runtime.evidenceRepairAttempts = 1;
        return jsonResponse({ evaluation }, 201);
      };
      await openMapProject(project);
      openNotebookSection('suggestions');
      fireEvent.click(screen.getByRole('button', { name: 'Generate guidance', exact: true }));
      await waitFor(() => expect(storedProject().preflight?.memoReview.connections[0].relationshipProcess).toMatchObject(process));
      expect(screen.getByText('This review used passages from your memo. Check the feedback and suggestions against your own research.')).toBeVisible();
      expect(screen.queryByText('No items were suggested. You can add an item yourself or reread the memo.')).not.toBeInTheDocument();
      fireEvent.click(memoNextAction());
      await waitFor(() => expect(storedProject().candidates.edges[0]?.relationshipProcess).toMatchObject(process));
      fireEvent.click(screen.getByRole('button', { name: 'Add to map', exact: true }));
      fireEvent.click(screen.getByRole('button', { name: 'Finish review', exact: true }));
      await waitFor(() => expect(storedProject().graph.edges[0]?.relationshipProcess).toMatchObject(process));
      const edge = storedProject().graph.edges[0];
      const line = document.querySelector(`[data-graph-id="${edge.id}"] .edge-line`);
      expect(line).toHaveAttribute('stroke-dasharray', '7 5');
      expect(line).not.toHaveAttribute('marker-start');
      expect(line).not.toHaveAttribute('marker-end');
      expectAttachedRelationship(edge);
      expect(document.querySelector(`[data-edge-id="${edge.id}"] .edge-label`)).toHaveTextContent(edge.verb);
      expect(document.querySelector(`[data-edge-id="${edge.id}"]`)).not.toHaveTextContent('0 families');
      expect(graphCsv(storedProject())).toContain('"connection_status","connection_strength","communication_channel","connecting_work","family_count"');
      expect(graphCsv(storedProject())).toContain('"missing","contested","Phone","Parent","0"');
    });
    it('closing a relationship draft preserves it until an explicit discard', async () => {
      const project = await openMapProject(meetingProject());
      const [source, target] = project.graph.nodes;
      const before = structuredClone(storedProject().graph);
      openNodeInspector(source.id);
      fireEvent.click(screen.getByRole('button', { name: `Connect from ${source.label}`, exact: true }));
      fireEvent.keyDown(document.querySelector(`[data-graph-id="${target.id}"]`), { key: 'Enter' });
      fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Relationship', exact: true }), { target: { value: 'supports' } });
      fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
      expect(screen.queryByRole('heading', { name: 'New relationship' })).toBeNull();
      expect(document.querySelector('.relationship-draft-preview')).not.toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Resume relationship', exact: true }));
      expect(screen.getByRole('textbox', { name: 'Relationship', exact: true })).toHaveValue('supports');
      fireEvent.click(screen.getByRole('button', { name: 'Discard relationship', exact: true }));
      expect(document.querySelector('.relationship-draft-preview')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Resume relationship', exact: true })).toBeNull();
      expect(storedProject().graph).toEqual(before);
    });
    it.each([false, true])('cancels Connect from when its source is deleted and stays cancelled after reopen (phone=%s)', async phone => {
      if (phone) installPhoneLayout();
      const project = meetingProject();
      project.graph.nodes.forEach(node => { node.settingNodeIds = []; });
      await openMapProject(project);
      const source = project.graph.nodes[0];
      openNodeInspector(source.id);
      fireEvent.click(screen.getByRole('button', { name: `Connect from ${source.label}`, exact: true }));
      expect(document.querySelector('.map-connect-status')).toBeTruthy();
      fireEvent.keyDown(document.querySelector(`[data-graph-id="${source.id}"]`), { key: 'Delete' });
      await waitFor(() => expect(storedProject().graph.nodes.find(node => node.id === source.id).status).toBe('rejected'));
      expect(document.querySelector('.map-connect-status')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Resume relationship', exact: true })).toBeNull();
      const saved = structuredClone(storedProject());
      cleanup(); await openMapProject(saved);
      expect(document.querySelector('.map-connect-status')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Resume relationship', exact: true })).toBeNull();
    });
    it('keeps the chosen source while dragging or moving a target with the keyboard', async () => {
      const project = await openMapProject(meetingProject());
      const [target, , source] = project.graph.nodes;
      openNodeInspector(source.id);
      fireEvent.click(screen.getByRole('button', { name: `Connect from ${source.label}`, exact: true }));
      const svg = mapCanvas();
      svg.getScreenCTM = () => ({ inverse: () => ({}) });
      svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } });
      const start = renderedNodePosition(target.id);
      const targetNode = () => document.querySelector(`[data-graph-id="${target.id}"]`);
      fireEvent.pointerDown(targetNode(), { pointerId: 61, button: 0, clientX: start.x, clientY: start.y });
      fireEvent.pointerMove(svg, { pointerId: 61, clientX: start.x + 28, clientY: start.y + 18 });
      fireEvent.pointerUp(svg, { pointerId: 61, clientX: start.x + 28, clientY: start.y + 18 });
      await waitFor(() => expect(eventRequests('node_moved')).toHaveLength(1));
      expect(renderedNodePosition(target.id)).not.toEqual(start);
      expect(screen.queryByRole('heading', { name: 'New relationship' })).toBeNull();
      expect(document.querySelector('.map-connect-status')).toHaveTextContent(`${source.label} selected`);
      expect(document.querySelector(`[data-graph-id="${source.id}"]`)).toHaveAttribute('aria-pressed', 'true');
      fireEvent.keyDown(targetNode(), { key: 'ArrowRight' });
      await waitFor(() => expect(eventRequests('node_moved')).toHaveLength(2));
      expect(screen.queryByRole('heading', { name: 'New relationship' })).toBeNull();
      fireEvent.keyDown(targetNode(), { key: 'Enter' });
      if (screen.queryByRole('button', { name: 'Edit', exact: true })) fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
      expect(screen.getByRole('combobox', { name: 'From', exact: true })).toHaveValue(source.id);
      expect(screen.getByRole('combobox', { name: 'To', exact: true })).toHaveValue(target.id);
      expect(storedProject().graph.edges).toHaveLength(0);
    });
    it('keeps the phone overview and moves the selected node while its contextual inspector is open', async () => {
      installPhoneLayout();
      const project = await openMapProject(meetingProject());
      const source = project.graph.nodes[2];
      openNodeInspector(source.id);
      expect(mapCanvas()).not.toHaveClass('is-detail-view');
      expect(document.querySelectorAll('.graph-node')).toHaveLength(project.graph.nodes.length);
      expect(screen.getByRole('button', { name: `Connect from ${source.label}`, exact: true })).toBeVisible();
      const svg = mapCanvas();
      svg.getScreenCTM = () => ({ inverse: () => ({}) });
      svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } });
      const node = document.querySelector(`[data-graph-id="${source.id}"]`);
      const start = renderedNodePosition(source.id);
      fireEvent.pointerDown(node, { pointerId: 62, button: 0, pointerType: 'touch', clientX: start.x, clientY: start.y });
      fireEvent.pointerMove(svg, { pointerId: 62, pointerType: 'touch', clientX: start.x + 28, clientY: start.y + 18 });
      fireEvent.pointerUp(svg, { pointerId: 62, pointerType: 'touch', clientX: start.x + 28, clientY: start.y + 18 });
      await waitFor(() => expect(eventRequests('node_moved')).toHaveLength(1));
      expect(renderedNodePosition(source.id)).not.toEqual(start);
      expect(document.querySelector('.map-connect-status')).toBeNull();
      expect(screen.queryByRole('heading', { name: 'New relationship' })).toBeNull();
      expect(screen.getByRole('button', { name: `Connect from ${source.label}`, exact: true })).toBeVisible();
      expect(storedProject().graph.edges).toHaveLength(0);
    });
    it('retains a deliberately spread saved phone layout when reopening and adding a node', async () => {
      installPhoneLayout();
      const project = meetingProject();
      project.layout = { phoneOverview: 'preserve' };
      project.graph.nodes.forEach((node, index) => { node.x = 300 + index * 850; node.y = 240 + index * 350; });
      const positions = new Map(project.graph.nodes.map(node => [node.id, { x: node.x, y: node.y }]));
      await openMapProject(project);
      project.graph.nodes.forEach(node => expect(renderedNodePosition(node.id)).toEqual(positions.get(node.id)));
      fireEvent.click(mapTool('Add item'));
      const form = document.querySelector('.add-form');
      fireEvent.change(within(form).getByRole('textbox', { name: 'Label', exact: true }), { target: { value: 'School counselor' } });
      fireEvent.click(within(form).getByRole('button', { name: 'Add node', exact: true }));
      await waitFor(() => expect(storedProject().graph.nodes).toHaveLength(project.graph.nodes.length + 1));
      project.graph.nodes.forEach(node => expect(renderedNodePosition(node.id)).toEqual(positions.get(node.id)));
      expect(storedProject().layout).toEqual({ phoneOverview: 'preserve' });
      const savedPositions = new Map(storedProject().graph.nodes.map(node => [node.id, { x: node.x, y: node.y }]));
      cleanup();
      render(<App />);
      await showResumeScreen();
      openProjectFromList(project.title);
      await screen.findByRole('heading', { name: 'Systems map' });
      fireEvent.click(screen.getByRole('button', { name: 'Map', exact: true }));
      savedPositions.forEach((position, id) => expect(renderedNodePosition(id)).toEqual(position));
    });
    it('reopens a saved compact phone arrangement with the dragged item and its neighbors in the same displayed positions', async () => {
      installPhoneLayout();
      const project = await openMapProject(meetingProject());
      const source = project.graph.nodes[2];
      openNodeInspector(source.id);
      const svg = mapCanvas();
      svg.getScreenCTM = () => ({ inverse: () => ({}) });
      svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } });
      const start = renderedNodePosition(source.id);
      const node = document.querySelector(`[data-graph-id="${source.id}"]`);
      fireEvent.pointerDown(node, { pointerId: 71, button: 0, pointerType: 'touch', clientX: start.x, clientY: start.y });
      fireEvent.pointerMove(svg, { pointerId: 71, pointerType: 'touch', clientX: start.x + 30, clientY: start.y + 18 });
      fireEvent.pointerUp(svg, { pointerId: 71, pointerType: 'touch', clientX: start.x + 30, clientY: start.y + 18 });
      await waitFor(() => expect(eventRequests('node_moved')).toHaveLength(1));
      await waitFor(() => expect(storedProject().graph.nodes.find(node => node.id === source.id)).toMatchObject(renderedNodePosition(source.id)));
      const displayed = new Map(project.graph.nodes.map(node => [node.id, renderedNodePosition(node.id)]));
      const saved = structuredClone(storedProject().graph);
      expect(storedProject().layout).toEqual({ phoneOverview: 'preserve', readingAspect: expect.any(Number), manualNodeIds: expect.arrayContaining(project.graph.nodes.map(node => node.id)) });
      cleanup();
      render(<App />);
      await showResumeScreen();
      openProjectFromList(project.title);
      await screen.findByRole('heading', { name: 'Systems map' });
      fireEvent.click(screen.getByRole('button', { name: 'Map', exact: true }));
      project.graph.nodes.forEach(node => expect(renderedNodePosition(node.id)).toEqual(displayed.get(node.id)));
      expect(storedProject().graph).toEqual(saved);
      for (const scale of ['micro', 'meso']) {
        fireEvent.change(screen.getByRole('combobox', { name: 'Work level' }), { target: { value: scale } });
        project.graph.nodes.forEach(node => expect(renderedNodePosition(node.id)).toEqual(displayed.get(node.id)));
      }
    });
    it.each([[390, 424], [375, 330]])('fits the phone notebook map to its measured %ipx canvas when the item panel opens', async (width, selectedHeight) => {
      installPhoneLayout(width);
      let canvasHeight = 680;
      const measurements = new Set();
      vi.stubGlobal('ResizeObserver', class {
        constructor(callback) { this.callback = callback; }
        observe() { measurements.add(this.callback); }
        disconnect() { measurements.delete(this.callback); }
      });
      const originalRect = Element.prototype.getBoundingClientRect;
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
        return this.matches('.graph-canvas')
          ? { x: 0, y: 0, top: 0, left: 0, width, height: canvasHeight, right: width, bottom: canvasHeight }
          : originalRect.call(this);
      });
      const project = await openMapProject(meetingProject());
      const graphBefore = structuredClone(storedProject().graph);
      const fullViewport = viewportTransform();
      const inspector = openNodeInspector(project.graph.nodes[2].id);
      expect(viewportTransform()).toEqual(fullViewport);
      canvasHeight = selectedHeight;
      act(() => measurements.forEach(measure => measure()));
      await waitFor(() => expect(visibleMapBounds().bottom - visibleMapBounds().top).toBeCloseTo(840 * selectedHeight / width));
      // The visible split canvas remains large enough to read each node card;
      // the legacy 240-unit drawer fit would shrink these below 40px.
      const fontPixels = 26 * viewportTransform().zoom * width / 840;
      expect(fontPixels).toBeGreaterThan(10);
      expectVisibleNodesAndConnectionLabelsInsideCanvas();
      fireEvent.click(within(inspector).getByRole('button', { name: 'Done', exact: true }));
      canvasHeight = 680;
      act(() => measurements.forEach(measure => measure()));
      await waitFor(() => expect(viewportTransform()).toEqual(fullViewport));
      expect(storedProject().graph).toEqual(graphBefore);
    });
    it('clears contextual connection selection and its draft when the work level changes', async () => {
      const project = await openMapProject(meetingProject());
      const [source, target] = project.graph.nodes;
      const before = structuredClone(storedProject().graph);
      for (const openEditor of [false, true]) {
        openNodeInspector(source.id);
        fireEvent.click(screen.getByRole('button', { name: `Connect from ${source.label}`, exact: true }));
        if (openEditor) fireEvent.keyDown(document.querySelector(`[data-graph-id="${target.id}"]`), { key: 'Enter' });
      if (screen.queryByRole('button', { name: 'Edit', exact: true })) fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
        fireEvent.change(screen.getByRole('combobox', { name: 'Work level' }), { target: { value: 'micro' } });
        expect(document.querySelector('.map-connect-status')).toBeNull();
        expect(screen.queryByRole('heading', { name: 'New relationship' })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Connect from / })).toBeNull();
        fireEvent.change(screen.getByRole('combobox', { name: 'Work level' }), { target: { value: 'meso' } });
        expect(document.querySelector('.map-connect-status')).toBeNull();
        expect(storedProject().graph).toEqual(before);
      }
    });
  });


  // November 7: one connection gesture at every level, nothing veiled by a
  // selection, and nodes placed by double-clicking the level they belong in.
  describe('account workspace canvas', () => {
    async function openGroupProject(prepare = project => project) {
      const project = prepare(groupProject());
      seedProject(project);
      render(<App memoFirstWorkflow startInWorkspace />);
      // Meso relationships occupy Micro space; a legacy Meso-scale node is not drawn as a card.
      const live = project.graph.nodes.filter(node => node.scale !== 'meso' && node.status !== 'rejected' && node.claimState !== 'retired').length;
      await waitFor(() => expect(document.querySelectorAll('.graph-node')).toHaveLength(live));
      return { ...project, liveNodeCount: live };
    }

    it('keeps every relationship label on the canvas while an item is selected, emphasizing its own', async () => {
      const project = await openGroupProject();
      const before = document.querySelectorAll('.graph-edge-label').length;
      expect(before).toBeGreaterThan(1);
      const meso = project.graph.edges.find(edge => edge.scale === 'meso');
      fireEvent.keyDown(document.querySelector(`[data-graph-id="${meso.source}"]`), { key: 'Enter' });
      expect(await screen.findByRole('button', { name: 'Remove', exact: true })).toBeVisible();
      expect(document.querySelectorAll('.graph-edge-label')).toHaveLength(before);
      expect(document.querySelector(`.graph-edge[data-graph-id="${meso.id}"]`)).toHaveClass('is-reading-active');
      expect(document.querySelector(`.graph-edge-label[data-edge-id="${meso.id}"]`)).toHaveClass('is-reading-active');
      const other = project.graph.edges.find(edge => edge.scale === 'meso' && edge.source !== meso.source && edge.target !== meso.source);
      expect(document.querySelector(`.graph-edge-label[data-edge-id="${other.id}"]`)).not.toBeNull();
      expect(document.querySelector(`.graph-edge[data-graph-id="${other.id}"]`)).not.toHaveClass('is-reading-active');
    });

    it('connects a Macro condition to a local relationship by clicking its line, while a memo edit is still pending', async () => {
      const project = await openGroupProject();
      expect(memoUpdateState(project).submitted).toBe(false);
      expect(screen.getByRole('button', { name: 'Finish map', exact: true })).toBeDisabled();
      const condition = project.graph.nodes.find(node => node.scale === 'macrosphere');
      const meso = project.graph.edges.find(edge => edge.scale === 'meso');
      fireEvent.doubleClick(document.querySelector(`[data-graph-id="${condition.id}"]`));
      const status = document.querySelector('.canvas-wrap > .map-connect-status');
      expect(status).toHaveAttribute('data-scale', 'macrosphere');
      expect(status).toHaveTextContent(`${condition.label} selected. Click a local relationship line`);
      expect(document.querySelector('.map-stage > .map-connect-status')).toBeNull();
      expect(document.querySelectorAll('.graph-edge-label')).not.toHaveLength(0);
      fireEvent.keyDown(document.querySelector(`.graph-edge[data-graph-id="${meso.id}"]`), { key: 'Enter' });
      expect(await screen.findByRole('heading', { name: 'New relationship' })).toBeVisible();
      expect(document.querySelector('.map-connect-status')).toBeNull();
      expect(screen.getByRole('checkbox', { name: 'Connect to local relationships', exact: true })).toBeChecked();
      const picker = screen.getByRole('group', { name: 'Local relationships', exact: true });
      const chosen = within(picker).getAllByRole('checkbox').filter(box => box.checked);
      expect(chosen).toHaveLength(1);
      expect(screen.getByRole('combobox', { name: 'Direction', exact: true })).not.toHaveTextContent(/to\s*$/);
      fireEvent.change(screen.getByRole('textbox', { name: 'Relationship', exact: true }), { target: { value: 'limits' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add relationship', exact: true }));
      await waitFor(() => expect(storedProject().graph.edges.find(edge => edge.source === condition.id && edge.verb === 'limits')?.relationshipIds).toEqual([meso.id]));
    });

    it('reaches the local relationships through a branch already attached to their line', async () => {
      // On production (7 Nov) a second outside node could not target a line
      // once one branch was attached: the branch's hit path covered the line.
      const project = await openGroupProject();
      const group = project.graph.edges.find(edge => edge.relationshipIds?.length);
      expect(group).toBeTruthy();
      const source = project.graph.nodes.find(node => ['exosphere', 'macrosphere'].includes(node.scale) && node.id !== group.source);
      fireEvent.doubleClick(document.querySelector(`[data-graph-id="${source.id}"]`));
      fireEvent.keyDown(document.querySelector(`.graph-edge[data-graph-id="${group.id}"]`), { key: 'Enter' });
      expect(await screen.findByRole('heading', { name: 'New relationship' })).toBeVisible();
      const picker = screen.getByRole('group', { name: 'Local relationships', exact: true });
      const chosen = within(picker).getAllByRole('checkbox').filter(box => box.checked);
      expect(chosen).toHaveLength(group.relationshipIds.length);
      fireEvent.change(screen.getByRole('textbox', { name: 'Relationship', exact: true }), { target: { value: 'shapes' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add relationship', exact: true }));
      await waitFor(() => expect(storedProject().graph.edges.find(edge => edge.source === source.id && edge.verb === 'shapes')?.relationshipIds).toEqual(group.relationshipIds));
    });

    it('adds a node where the student double-clicks empty canvas, with the level chosen from a row of swatches', async () => {
      const project = await openGroupProject();
      fireEvent.doubleClick(document.querySelector('.graph-canvas'), { clientX: 12, clientY: 12 });
      expect(await screen.findByRole('heading', { name: 'New node' })).toBeVisible();
      expect(document.querySelector('.graph-node.is-pending')).not.toBeNull();
      const levels = screen.getByRole('radiogroup', { name: 'Level' });
      expect(within(levels).getAllByRole('radio').map(radio => radio.getAttribute('data-level'))).toEqual(['micro', 'exosphere', 'macrosphere']);
      fireEvent.click(within(levels).getByRole('radio', { name: /Macro/ }));
      expect(within(levels).getByRole('radio', { name: /Macro/ })).toHaveAttribute('aria-checked', 'true');
      fireEvent.change(screen.getByRole('textbox', { name: 'Label', exact: true }), { target: { value: 'Ableism in care funding' } });
      fireEvent.change(screen.getByRole('textbox', { name: 'Evidence or question', exact: true }), { target: { value: 'Does reimbursement policy assume care is a family duty?' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add to map', exact: true }));
      await waitFor(() => expect(storedProject().graph.nodes.find(node => node.label === 'Ableism in care funding')).toMatchObject({ scale: 'macrosphere', origin: 'student entry' }));
      const added = storedProject().graph.nodes.find(node => node.label === 'Ableism in care funding');
      expect(storedProject().layout.manualNodeIds).toContain(added.id);
      expect(document.querySelectorAll('.graph-node')).toHaveLength(project.liveNodeCount + 1);
    });
  });

});
