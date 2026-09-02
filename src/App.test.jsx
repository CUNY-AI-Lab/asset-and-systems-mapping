import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import { SYSTEMS_MAPPING_STAGES } from '../shared/systems-mapping-stages.js';
import {
  configFingerprint,
  createDefaultProject,
  createLevelProgress,
  createPortableProject,
  extractCandidates,
  MICRO_SETTING_NODE_TYPES,
  parseProject,
  PROJECT_LIMITS,
  serializeProject,
  stableId,
  validateProject,
  withDefaultNodeLayout,
} from './domain.js';
import { loadStoredLink, rememberStoredLink } from './projectLibrary.js';

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
    const scope = carriedNodes.slice(0, 2).map(({ id, label }) => ({ id, label }));
    if (scope.length < 2) return {
      guidance: [{ point: 'Add two immediate settings at Micro-level before naming their linkage.' }],
      nodes: [], connections: [], example: null,
      readiness: { ready: false, note: 'Two Micro-level settings are needed for a Meso-level linkage.' },
    };
    return {
      guidance: [{ point: 'The memo supports a linkage between two Micro settings.' }],
      nodes: [{
        label: 'School–family coordination',
        type: 'mesosystem',
        scale: 'meso',
        evidence: 'The memo describes coordination between the school and family support setting.',
        scope,
      }],
      connections: [],
      example: null,
      readiness: { ready: true, note: 'The memo supports one Meso linkage.' },
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
    connections: [{ source: 'School', target: 'Committee', sourceLabel: 'School', targetLabel: 'Committee', verb: 'refers students to', rationale: 'The memo names the referral directly.' }],
    example: null,
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
  expect(await screen.findByRole('heading', { name: 'Projects' })).toBeVisible();
}

function openProjectFromList(title = null) {
  const card = title
    ? screen.getByRole('article', { name: title })
    : screen.getAllByRole('article')[0];
  fireEvent.click(within(card).getByRole('button', { name: 'Open project' }));
}

async function resumeSavedProject(project = createDefaultProject()) {
  seedProject(project);
  render(<App />);
  await showResumeScreen();
  openProjectFromList(project.title);
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Projects' })).not.toBeInTheDocument());
  return project;
}

function makeMapProject(activeScale = 'exosphere') {
  const project = createDefaultProject();
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
    scale: edge.scale === 'exosphere' ? 'exosphere' : 'micro',
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
  project.activeScale = 'micro';
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
      scale: 'micro',
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
  return screen.getByRole('group', { name: /\bmap\. (?:\d+ nodes? and \d+ connections?|\d+ mesosystems? and \d+ Micro settings?)/i });
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
  const scopeIds = new Set(project.graph.nodes
    .filter((node) => scales.has(node.scale) && node.claimState !== 'retired')
    .flatMap((node) => node.scopeNodeIds || []));
  const nodes = project.graph.nodes.filter((node) => (scales.has(node.scale) || endpointIds.has(node.id) || scopeIds.has(node.id)) && node.claimState !== 'retired');
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
  fireEvent.pointerUp(edge, { pointerId: 91, button: 0 });
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
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeVisible();
    expect(within(screen.getByRole('article', { name: project.title })).getByText('Review')).toBeVisible();
    openProjectFromList(project.title);
    expect(await screen.findByRole('heading', { name: 'Review memo' })).toBeVisible();

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
    expect(within(screen.getByRole('article', { name: 'NYC systems and assets map' })).getByText('Micro-level')).toBeVisible();
    expect(screen.queryByText(/instructor reviews submitted work/i)).not.toBeInTheDocument();
    const request = fetchMock.mock.calls.find(([path]) => String(path) === '/api/student/access');
    expect(JSON.parse(request[1].body)).toEqual({ code: hostedCode });
    openProjectFromList('NYC systems and assets map');
    fireEvent.click(screen.getByRole('button', { name: 'Review memo' }));
    expect(screen.getByRole('heading', { name: 'Review memo' })).toBeVisible();
    expect(screen.getByText('gpt-oss:120b via Ollama Cloud')).toBeVisible();
    expect(screen.getByText(/sends your memo and map framing to gpt-oss:120b via Ollama Cloud.*keeps each request for 1 day.*project stays on this device/i)).toBeVisible();
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 750)); });
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Generate guidance' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Continue without model' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('tab', { name: 'Model setup' })).not.toBeInTheDocument();
  });

  it('starts a blank project only after a granted session and explicit start action', async () => {
    render(<App />);
    await showResumeScreen();
    expect(screen.getByRole('heading', { name: 'No saved projects yet' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Add your memo' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start new project' }));
    expect(await screen.findByRole('heading', { name: 'Add your memo' })).toBeVisible();
    expect(screen.getByText('Untitled systems map', { selector: '.brand small' })).toBeVisible();
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
    const confirmation = await screen.findByRole('dialog', { name: 'Start new project?' });
    expect(within(confirmation).getByText('Your current project will stay saved on this device. You can return to it from Projects.')).toBeVisible();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Start new project' }));

    expect(await screen.findByRole('heading', { name: 'Add your memo' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Map title (optional)' })).toHaveValue('Untitled systems map');
    expect(screen.getByRole('textbox', { name: /^Memo/ })).toHaveValue('');

    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
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

    expect(await screen.findByRole('heading', { name: 'Add your memo' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Map title (optional)' })).toHaveValue(earlierProject.title);
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
    expect(await screen.findByRole('heading', { name: 'Add your memo' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Map title (optional)' })).toHaveValue(legacy.title);
    expect(screen.getByRole('textbox', { name: /^Memo/ })).toHaveValue(legacy.submission.text);
    await waitFor(() => expect(storedProject()).toMatchObject({ schemaVersion: 7, title: legacy.title, participantName: '' }));
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
    expect(await screen.findByRole('heading', { name: 'Add your memo' })).toBeVisible();
    await waitFor(() => expect(storedProject()).toMatchObject({ schemaVersion: 7, participantName: '' }));
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
    expect(screen.getByRole('textbox', { name: /^Focal person/ })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /^Question/ })).toHaveValue('How do systems shape access to special-education services in NYC?');
    expect(screen.getByRole('textbox', { name: /^Time period/ })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /^Boundary/ })).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Map title (optional)' }), { target: { value: 'Family service access map' } });
    expect(screen.getByText('Family service access map', { selector: '.brand small' })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Guiding inquiry' })).not.toBeInTheDocument();
    const memo = screen.getByRole('textbox', { name: /^Memo/ });
    expect(memo).toBeVisible();
    const memoWordCount = memo.value.trim().split(/\s+/).filter(Boolean).length;
    expect(memo.closest('label')).toHaveTextContent(`${memoWordCount} words`);
    fireEvent.click(screen.getByRole('button', { name: 'Review memo' }));
    expect(screen.getByRole('heading', { name: 'Review memo' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Progress: Micro-level, Review' }));
    const stageMenu = screen.getByRole('dialog', { name: 'Progress' });
    ['Add memo', 'Review memo', 'Choose elements', 'Build map', 'Revise and export'].forEach((label) => expect(within(stageMenu).getByText(label)).toBeVisible());
    within(stageMenu).getAllByRole('button').filter((button) => button.textContent !== 'Close').forEach((button) => expect(button).toBeEnabled());
    fireEvent.click(within(stageMenu).getByRole('button', { name: 'Close Progress' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    const guidance = await screen.findByRole('region', { name: 'Memo review' });
    expect(within(guidance).getAllByRole('article')).toHaveLength(2);
    expect(within(guidance).getByText('The memo grounds the referral in a specific handoff.')).toBeVisible();
    expect(within(guidance).getByText('Where does the delay enter the referral process?')).toBeVisible();
    expect(within(guidance).getByText('The school refers the student to the committee.')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Coverage and uncertainty' })).toHaveTextContent('The memo already supports mapping');
    const scaffold = screen.getByRole('complementary', { name: 'Suggestions' });
    expect(within(scaffold).getByLabelText('Nodes evident in the memo')).toHaveTextContent('School');
    expect(within(scaffold).getByText('refers students to')).toBeVisible();
    expect(within(scaffold).getByLabelText('Nodes evident in the memo')).toHaveTextContent('Committee');
    expect(within(scaffold).getByText('The memo names the referral directly.')).toBeVisible();
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

  it('sends explicit focal person, inquiry, time, and boundary framing only after Generate guidance', async () => {
    const project = createDefaultProject();
    project.inquiry = '';
    await resumeSavedProject(project);
    fireEvent.change(screen.getByRole('textbox', { name: /^Focal person/ }), { target: { value: 'Students seeking special-education services' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^Question/ }), { target: { value: 'Where do referral delays emerge?' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^Time period/ }), { target: { value: 'The first semester after referral' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^Boundary/ }), { target: { value: 'NYC school and family interactions; clinical treatment is outside scope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review memo' }));
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/preflight/evaluations')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));

    expect(await screen.findByRole('region', { name: 'Memo review' })).toBeVisible();
    const request = fetchMock.mock.calls.find(([path, options]) => String(path) === '/api/preflight/evaluations' && options.method === 'POST');
    expect(JSON.parse(request[1].body).inquiry).toBe([
      'Focal person or group: Students seeking special-education services',
      'Map question: Where do referral delays emerge?',
      'Time period or episode: The first semester after referral',
      'Map boundary: NYC school and family interactions; clinical treatment is outside scope',
    ].join('\n'));
  });

  it('opens a non-advancing map preview and returns to the current memo stage', async () => {
    const project = createDefaultProject();
    await resumeSavedProject(project);

    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    expect(screen.getByRole('group', { name: /Micro-level map\. 0 nodes and 0 connections/ })).toBeVisible();
    expect(storedProject().stage).toBe(0);
    expect(storedProject().furthestStage).toBe(project.furthestStage);
    fireEvent.click(within(document.querySelector('.app-footer')).getByRole('button', { name: 'Back to Memo' }));
    expect(await screen.findByRole('heading', { name: 'Add your memo' })).toBeVisible();
    expect(storedProject().stage).toBe(0);
    expect(storedProject().furthestStage).toBe(project.furthestStage);
  });

  it('starts every new map at Micro instead of offering a scale picker', async () => {
    await resumeSavedProject(createDefaultProject());

    expect(screen.queryByRole('combobox', { name: 'Level' })).not.toBeInTheDocument();
    expect(screen.getByText(/Say who this map is about/)).toBeVisible();
    expect(storedProject()).toMatchObject({ activeScale: 'micro', releasedScales: ['micro'], completedScales: [] });
  });

  it('keeps the memo intake limited to fields students need', async () => {
    await resumeSavedProject(createDefaultProject());

    expect(screen.queryByRole('combobox', { name: 'Level' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Map title (optional)' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Student or group name (optional)' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /^Focal person/ })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /^Question/ })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /^Time period/ })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /^Boundary/ })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /^Memo/ })).toBeVisible();
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
    expect(await screen.findByRole('heading', { name: 'Add your memo' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeVisible();
    expect(screen.getByRole('article', { name: project.title })).toBeVisible();
    expect(screen.getByRole('article', { name: `${project.title} — new map` })).toBeVisible();
    openProjectFromList(project.title);
    await waitFor(() => expect(storedProject().id).toBe(project.id));
    expect(storedProject().graph).toEqual(previousGraph);
    expect(storedProject().events).toEqual(previousEvents);
    expect(storedProject().submission.text).toBe(revisedMemo);
  });

  it('shows Micro nodes and direct relationships in Revise and Export without exposing Meso linkages as relationships', async () => {
    const project = makeRevisionProject('micro');
    const graphBefore = structuredClone(project.graph);
    const micro = graphForScale(project, 'micro');
    expect(graphBefore.edges.some((edge) => edge.scale === 'micro')).toBe(true);
    expect(graphBefore.edges.some((edge) => edge.scale === 'meso')).toBe(false);

    await resumeSavedProject(project);
    expect(screen.getByRole('heading', { name: 'Review and export your map' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /^What changed in your account of the focal person’s direct settings and relationships\?/ })).toBeVisible();

    const currentMap = screen.getByLabelText('Current Micro-level map summary');
    expect(currentMap).toHaveTextContent(`${micro.nodes.length} nodes`);
    expect(currentMap).toHaveTextContent(`${micro.edges.length} direct relationships`);
    const summary = document.querySelector('.release-summary');
    const relationshipMetric = [...summary.children]
      .find((item) => item.querySelector('span')?.textContent === 'direct relationships');
    expect(relationshipMetric).toHaveTextContent(String(micro.edges.length));
    expect(storedProject().graph).toEqual(graphBefore);
  });

  it('supports a final Macrosphere synthesis across levels, evidence, limits, and next steps', async () => {
    const project = createDefaultProject();
    project.activeScale = 'macrosphere';
    project.releasedScales = ['micro', 'meso', 'exosphere', 'macrosphere'];
    project.completedScales = ['micro', 'meso', 'exosphere'];
    project.stage = 4;
    project.furthestStage = 4;
    project.preflight = null;
    project.candidates = { nodes: [], edges: [] };
    project.graph = { nodes: [], edges: [] };
    project.reflection = '';
    await resumeSavedProject(project);
    expect(screen.getByRole('heading', { name: 'Cross-level synthesis' })).toBeVisible();
    const responses = {
      'How would you answer the focus question now?': 'Access depends on linked family, school, agency, and policy decisions.',
      'Which claim is strongest, and why?': 'The referral handoff is strongest because the memo names it directly.',
      'Which claim is weakest, and why?': 'The funding influence needs another source.',
      'Whose perspective is missing, or what limits this map?': 'The student voice and service-provider records are missing.',
      'What should you investigate or do next?': 'Interview the student and verify agency timelines.',
      'What changed over time or across your revisions?': 'The map moved from individual delay to cross-level coordination.',
    };
    Object.entries(responses).forEach(([label, value]) => fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } }));
    await waitFor(() => expect(storedProject().reflection).toContain('Answer to focus question: Access depends on linked family, school, agency, and policy decisions.'));
    expect(storedProject().reflection).toContain('Strongest claim: The referral handoff is strongest because the memo names it directly.');
    expect(storedProject().reflection).toContain('Weakest claim: The funding influence needs another source.');
    expect(storedProject().reflection).toContain('Missing perspectives or limits: The student voice and service-provider records are missing.');
    expect(storedProject().reflection).toContain('Next investigation or action: Interview the student and verify agency timelines.');
    expect(storedProject().reflection).toContain('What changed over time: The map moved from individual delay to cross-level coordination.');
  });

  it.each([
    ['micro', 'meso', 'Continue to Meso-level', 'Meso-level will use Micro-level settings already on the map to form mesosystems.', 'Micro-level settings', 'Mesosystems and explanations of how settings interact', 'Do not add people, institutions, services, or relationship edges at Meso-level.'],
    ['meso', 'exosphere', 'Continue to Exo-level', 'Exo-level will add outside decision settings and connect each one to a mapped Micro-level setting.', 'Micro-level settings', 'Outside decision settings and connections into Micro-level', 'If the focal person participates in a setting directly, place it at Micro-level. Place broader conditions at Macro-level.'],
    ['exosphere', 'macrosphere', 'Continue to Macro-level', 'Macro-level will use earlier map items to identify broader conditions that affect more than one item.', 'Map items from earlier levels', 'Broader conditions and affected map items', 'Place a named organization at Micro-level when the focal person participates there and at Exo-level when its decisions reach an immediate setting from outside.'],
  ])('completing %s preserves accumulated work and continues at %s', async (activeScale, expectedScale, cta, nextCopy, uses, adds, boundary) => {
    const project = makeRevisionProject(activeScale);
    const graphBefore = structuredClone(project.graph);
    const candidatesBefore = structuredClone(project.candidates);
    const releasedBefore = [...project.releasedScales];
    await resumeSavedProject(project);

    const nextLevel = screen.getByText('Next level').closest('section');
    expect(within(nextLevel).getByRole('heading', { name: { meso: 'Meso-level', exosphere: 'Exo-level', macrosphere: 'Macro-level' }[expectedScale] })).toBeVisible();
    expect(nextLevel).toHaveTextContent(nextCopy);
    const continueButton = within(document.querySelector('.app-footer')).getByRole('button', { name: cta });
    expect(continueButton).toBeEnabled();
    document.documentElement.scrollTop = 240;
    document.body.scrollTop = 240;
    fireEvent.click(continueButton);

    // The next level continues directly at Review — the memo travels with the
    // project, so the student is never routed back through the intake form.
    await waitFor(() => expect(storedProject()).toMatchObject({
      activeScale: expectedScale,
      stage: 1,
      furthestStage: 4,
      preflight: null,
      reflection: '',
    }));
    const stored = storedProject();
    expect(stored.candidates).toEqual(candidatesBefore);
    expect(stored.completedScales).toEqual(expect.arrayContaining([activeScale]));
    expect(stored.graph).toEqual(graphBefore);
    expect(stored.releasedScales).toEqual([...releasedBefore, expectedScale]);
    expect(screen.getByRole('heading', { name: 'Review memo' })).toBeVisible();
    const levelLabels = { micro: 'Micro-level', meso: 'Meso-level', exosphere: 'Exo-level', macrosphere: 'Macro-level' };
    expect(screen.getByText(`Part ${['micro', 'meso'].includes(expectedScale) ? 1 : 2} · ${levelLabels[expectedScale]}`)).toBeVisible();
    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.body.scrollTop).toBe(0);
    const progression = screen.getByRole('region', { name: `${levelLabels[expectedScale]} progression` });
    expect(within(progression).getByText('Uses')).toBeVisible();
    expect(progression).toHaveTextContent(uses);
    expect(within(progression).getByText('Adds')).toBeVisible();
    expect(progression).toHaveTextContent(adds);
    expect(within(progression).getByText('Boundary')).toBeVisible();
    expect(progression).toHaveTextContent(boundary);
    expect(within(progression).getByText('Carried')).toBeVisible();
  });

  it('shows the Micro-level progression contract before any work is carried forward', async () => {
    const project = makeMapProject('micro');
    project.stage = 1;
    project.levelProgress.micro = { stage: 1, reflection: '' };
    project.preflight = null;
    await resumeSavedProject(project);

    const progression = screen.getByRole('region', { name: 'Micro-level progression' });
    expect(progression).toHaveTextContent('UsesMemo evidence');
    expect(progression).toHaveTextContent('AddsImmediate settings, their elements, and direct relationships');
    expect(progression).toHaveTextContent('BoundaryPlace interrelations between two settings at Meso-level.');
    expect(within(progression).queryByText('Carried')).not.toBeInTheDocument();
  });

  it('completes Macrosphere once and leaves the cumulative project at its terminal review', async () => {
    const project = makeRevisionProject('macrosphere');
    const graphBefore = structuredClone(project.graph);
    const candidatesBefore = structuredClone(project.candidates);
    const preflightBefore = structuredClone(project.preflight);
    const reflectionBefore = project.reflection;
    const releasedBefore = [...project.releasedScales];
    await resumeSavedProject(project);

    const completeButton = within(document.querySelector('.app-footer')).getByRole('button', { name: 'Complete Macro-level' });
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
    expect(screen.getByRole('heading', { name: 'Cross-level synthesis' })).toBeVisible();
    expect(within(document.querySelector('.app-footer')).getByRole('button', { name: 'Project complete' })).toBeDisabled();
  });

  it('revisits a released work level without changing the visible map layer or cumulative data', async () => {
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
    const visibleLayer = screen.getByRole('combobox', { name: 'Show map layer' });
    fireEvent.change(visibleLayer, { target: { value: 'exosphere' } });

    expect(screen.queryByRole('button', { name: 'Teacher Console' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Work at level: Exo-level' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose work level' });
    expect(within(dialog).getByText(/does not filter the visible map or remove cumulative data/i)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Micro-level' }));

    await waitFor(() => expect(storedProject()).toMatchObject({ activeScale: 'micro', stage: 3 }));
    expect(storedProject().graph).toEqual(graphBefore);
    expect(storedProject().candidates).toEqual(candidatesBefore);
    expect(screen.getByRole('combobox', { name: 'Show map layer' })).toHaveValue('exosphere');
    expect(screen.getByRole('button', { name: 'Work at level: Micro-level' })).toBeVisible();
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
    openProjectFromList('NYC systems and assets map');
    expect(await screen.findByRole('textbox', { name: 'Student or group name (optional)' })).toHaveValue('East Harlem mapping group');
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
    fireEvent.click(screen.getByRole('button', { name: 'Project link' }));
    let dialog = screen.getByRole('dialog', { name: 'Project link' });
    expect(within(dialog).getByText(/complete project—including its memo and evidence notes—will be stored on the class server for 90 days/i)).toBeVisible();
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
    fireEvent.change(screen.getByRole('textbox', { name: 'Student or group name (optional)' }), { target: { value: 'Device-side revision' } });
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

    fireEvent.click(screen.getByRole('button', { name: 'Project link' }));
    let dialog = screen.getByRole('dialog', { name: 'Project link' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('This project link changed in another session. Nothing on this device was overwritten.');
    expect(within(dialog).getByRole('button', { name: 'Open linked version and preserve this device copy' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Keep this device copy and create a new link' })).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open linked version and preserve this device copy' }));

    dialog = await screen.findByRole('dialog', { name: 'Project link' });
    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('The linked version is open. The earlier device copy remains in Projects.'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Project link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Project link' }));
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
    expect(screen.getByRole('region', { name: 'Coverage and uncertainty' })).toBeVisible();
    expect(document.querySelector('.workspace').textContent).not.toMatch(/instructor review|send to instructor|note for instructor/i);
    screen.getAllByRole('button', { name: 'Continue' }).forEach((button) => expect(button).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Map' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Progress: Micro-level, Review' }));
    const stageMenu = screen.getByRole('dialog', { name: 'Progress' });
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
    expect(await screen.findByText('Guidance is being generated…')).toBeVisible();
    const reviewForward = within(document.querySelector('.app-footer')).getByRole('button', { name: 'Continue without model' });
    expect(reviewForward).toBeEnabled();
    fireEvent.click(reviewForward);
    expect(await screen.findByRole('heading', { name: 'Choose items' })).toBeVisible();
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
    fireEvent.click(screen.getByRole('tab', { name: 'More connections' }));
    fireEvent.click(screen.getByRole('button', { name: 'Suggest connections' }));
    expect(screen.getByRole('button', { name: 'Generating suggestions…' })).toBeDisabled();
    const connectionForward = within(document.querySelector('.app-footer')).getByRole('button', { name: 'Open map' });
    expect(connectionForward).toBeEnabled();
    fireEvent.click(connectionForward);
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    await act(async () => { releaseConnections(); await Promise.resolve(); });
  });

  it('opens an empty map from candidate choice instead of gating on generated items', async () => {
    const project = createDefaultProject();
    project.stage = 2;
    project.furthestStage = 2;
    project.candidates = { nodes: [], edges: [] };
    await resumeSavedProject(project);

    expect(screen.getByText(/add items on the map/i)).toBeVisible();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Items · 0', 'Relationships · 0', 'More relationships']);
    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    await waitFor(() => expect(storedProject().stage).toBe(3));
  });

  it('uses the student description to request editable connections and adds only accepted suggestions to the map', async () => {
    const project = createDefaultProject();
    project.activeScale = 'micro';
    project.releasedScales = ['micro'];
    const nodes = extractCandidates(project.submission).nodes.slice(0, 3).map((node, index) => ({
      ...node,
      type: ['person', 'group', 'object'][index],
      scale: 'micro',
      status: 'confirmed',
      claimState: 'student interpretation',
    }));
    project.candidates = { nodes, edges: [] };
    project.graph = { nodes: [], edges: [] };
    project.stage = 2;
    project.furthestStage = 2;
    connectionSuggestionResponder = (body) => jsonResponse({ connections: [{
      source: body.nodes[0].id,
      target: body.nodes[1].id,
      verb: 'provides',
      rationale: 'The student described a direct pathway between these nodes.',
    }] }, 201);
    await resumeSavedProject(project);

    fireEvent.click(screen.getByRole('tab', { name: 'More relationships' }));
    expect(screen.getByRole('heading', { name: 'More relationships' })).toBeVisible();
    expect(screen.getByText(/Describe a relationship for the model to examine/i)).toBeVisible();
    const prompt = 'Families rely on schools, but delayed referrals make services harder to reach in this session.';
    fireEvent.click(screen.getByText('Describe a relationship (optional)'));
    expect(screen.getByText(/review and edit every suggestion before adding it to the map/i)).toBeVisible();
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
    expect(screen.getByText('0 added')).toBeVisible();
    fireEvent.change(verb, { target: { value: 'informs' } });
    expect(addSuggestion).not.toHaveClass('is-active');
    expect(screen.getByText('0 added')).toBeVisible();
    fireEvent.click(addSuggestion);
    expect(screen.getByRole('img', { name: /3 nodes and 1 connections/ })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    await waitFor(() => expect(storedProject().graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ verb: 'informs', status: 'confirmed', claimState: 'student interpretation' }),
    ])));
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toContain(prompt);
  });

  it('shows complete node and relationship text in the connection preview without ellipses', async () => {
    const project = createDefaultProject();
    project.activeScale = 'micro';
    project.releasedScales = ['micro'];
    const longNodeLabel = 'East Harlem community resource room with transportation and family program materials END NODE';
    const longEdgeLabel = 'coordinates referrals and follow-up support across neighborhood programs END EDGE';
    const nodes = extractCandidates(project.submission).nodes.slice(0, 3).map((node, index) => ({
      ...node,
      scale: 'micro',
      type: index === 0 ? 'setting' : index === 1 ? 'person' : 'object',
      ...(index === 0 ? { label: longNodeLabel } : {}),
      status: 'confirmed',
      claimState: 'student interpretation',
    }));
    project.candidates = { nodes, edges: [] };
    project.graph = { nodes: [], edges: [] };
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);

    fireEvent.click(screen.getByRole('tab', { name: 'More relationships' }));
    fireEvent.click(screen.getByText('Describe a relationship (optional)'));
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

  it('routes a bounded group of kept preview connections in separate lanes between their endpoint cards', async () => {
    const project = createDefaultProject();
    project.activeScale = 'micro';
    project.releasedScales = ['micro'];
    const extracted = extractCandidates(project.submission);
    const specifications = [
      ['Rosa', 'person'],
      ['Peer support group', 'group'],
      ['College advising office', 'setting'],
      ['Family caregiver', 'person'],
      ['BMCC evening registration session', 'activity'],
    ];
    const staleSavedPositions = [
      { x: -2400, y: -1300 },
      { x: 3800, y: -900 },
      { x: 4100, y: 1700 },
      { x: -1800, y: 2100 },
      { x: 900, y: 3600 },
    ];
    const nodes = specifications.map(([label, type], index) => ({
      ...structuredClone(extracted.nodes[index]),
      id: `preview-node-${index + 1}`,
      label,
      type,
      scale: 'micro',
      ...staleSavedPositions[index],
      status: 'confirmed',
      claimState: 'student interpretation',
      annotations: {
        analytical: { id: `preview-node-${index + 1}-analytical`, text: '' },
        evidence: { id: `preview-node-${index + 1}-evidence`, text: '' },
      },
    }));
    const connections = [
      [0, 1, 'asks for advice from'],
      [0, 2, 'coordinates enrollment with'],
      [1, 3, 'shares support resources with'],
      [2, 4, 'determines course options for'],
      [3, 4, 'adjusts caregiving around'],
    ];
    const edges = connections.map(([sourceIndex, targetIndex, verb], index) => ({
      ...structuredClone(extracted.edges[index % extracted.edges.length]),
      id: `preview-edge-${index + 1}`,
      source: nodes[sourceIndex].id,
      target: nodes[targetIndex].id,
      sourceLabel: nodes[sourceIndex].label,
      targetLabel: nodes[targetIndex].label,
      verb,
      scale: 'micro',
      status: 'confirmed',
      claimState: 'student interpretation',
      annotation: { id: `preview-edge-${index + 1}-annotation`, text: '' },
    }));
    project.candidates = { nodes, edges };
    project.graph = { nodes: [], edges: [] };
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);

    fireEvent.click(screen.getByRole('tab', { name: 'More relationships' }));
    const previewSvg = document.querySelector('.connection-preview svg');
    const labels = [...document.querySelectorAll('.connection-preview__label')];
    const cards = [...document.querySelectorAll('.connection-preview__node')].map((node) => translatedRectBounds(node, node.querySelector('rect')));
    const viewBox = previewSvg.getAttribute('viewBox').split(/\s+/).map(Number);
    const [viewX, viewY, viewWidth, viewHeight] = viewBox;
    expect(labels).toHaveLength(4);
    expect(screen.getByText(/Showing 4 of 5 connections/, { selector: '.connection-preview__scope' })).toBeVisible();
    labels.forEach((label, index) => {
      const labelBounds = svgRectBounds(label.querySelector('rect'));
      expect(label).toHaveAttribute('data-edge-route', 'between-endpoints');
      expect(svgTextLines(label.querySelector('text')).join(' ')).toBe(edges[index].verb);
      cards.forEach((cardBounds) => expect(rectsIntersect(labelBounds, cardBounds)).toBe(false));
      labels.slice(index + 1).forEach((other) => expect(rectsIntersect(labelBounds, svgRectBounds(other.querySelector('rect')))).toBe(false));
      const positionFor = (nodeId) => {
        const transform = document.querySelector(`.connection-preview__node[data-node-id="${nodeId}"]`).getAttribute('transform');
        const match = transform.match(/^translate\((-?[\d.]+) (-?[\d.]+)\)$/);
        return { x: Number(match[1]), y: Number(match[2]) };
      };
      const source = positionFor(label.getAttribute('data-source-id'));
      const target = positionFor(label.getAttribute('data-target-id'));
      const anchor = { x: Number(label.getAttribute('data-anchor-x')), y: Number(label.getAttribute('data-anchor-y')) };
      const delta = { x: target.x - source.x, y: target.y - source.y };
      const projection = ((anchor.x - source.x) * delta.x + (anchor.y - source.y) * delta.y) / (delta.x ** 2 + delta.y ** 2);
      expect(projection).toBeGreaterThan(0);
      expect(projection).toBeLessThan(1);
    });
    expect(new Set([...document.querySelectorAll('.connection-preview__edge path')].map((path) => path.getAttribute('d')))).toHaveLength(4);
    const renderedBounds = [...cards, ...labels.map((label) => svgRectBounds(label.querySelector('rect')))];
    expect(Math.min(...renderedBounds.map(({ left }) => left))).toBeGreaterThanOrEqual(viewX);
    expect(Math.max(...renderedBounds.map(({ right }) => right))).toBeLessThanOrEqual(viewX + viewWidth);
    expect(Math.min(...renderedBounds.map(({ top }) => top))).toBeGreaterThanOrEqual(viewY);
    expect(Math.max(...renderedBounds.map(({ bottom }) => bottom))).toBeLessThanOrEqual(viewY + viewHeight);
    expect(viewWidth / viewHeight).toBeCloseTo(8 / 5, 4);
    expect(Math.max(...cards.map(({ right }) => right)) - Math.min(...cards.map(({ left }) => left))).toBeLessThan(2600);
    expect(viewWidth).toBeLessThan(3200);
  });

  it('fits a dense connection preview around its content instead of stale canvas coordinates', async () => {
    const project = createDefaultProject();
    project.activeScale = 'micro';
    project.releasedScales = ['micro'];
    const extracted = extractCandidates(project.submission);
    const labels = [
      'Rosa',
      'Family caregiver',
      'East 111th Street apartment',
      'Apartment elevator',
      'East Harlem community resource room',
      'Resource coordinator',
      'Rehabilitation room',
      'Physical therapist',
      'Neighborhood grocery internship counter',
      'Internship supervisor',
    ];
    const nodes = labels.map((label, index) => ({
      ...structuredClone(extracted.nodes[index % extracted.nodes.length]),
      id: `dense-preview-node-${index + 1}`,
      label,
      type: index < 2 || index === 5 || index === 7 || index === 9 ? 'person' : 'setting',
      scale: 'micro',
      x: index % 2 ? 5200 + index * 240 : -3400 - index * 180,
      y: index * 720 - 2400,
      status: 'confirmed',
      claimState: 'student interpretation',
      annotations: {
        analytical: { id: `dense-preview-node-${index + 1}-analytical`, text: '' },
        evidence: { id: `dense-preview-node-${index + 1}-evidence`, text: '' },
      },
    }));
    const connectionSpecs = [
      [1, 3, 'checks before each trip'],
      [1, 5, 'alerts about elevator outages'],
      [5, 0, 'supports at the resource room'],
      [0, 4, 'attends on Tuesdays and Thursdays'],
      [0, 6, 'attends on Tuesday afternoons'],
      [7, 0, 'provides physical therapy to'],
      [0, 8, 'works at the internship counter'],
      [9, 0, 'supervises assigned tasks for'],
      [5, 6, 'coordinates the Tuesday schedule with'],
      [5, 9, 'shares the internship task plan with'],
      [9, 5, 'returns weekly feedback to'],
      [1, 9, 'confirms the pickup window with'],
    ];
    const edges = connectionSpecs.map(([sourceIndex, targetIndex, verb], index) => ({
      ...structuredClone(extracted.edges[index % extracted.edges.length]),
      id: `dense-preview-edge-${index + 1}`,
      source: nodes[sourceIndex].id,
      target: nodes[targetIndex].id,
      sourceLabel: nodes[sourceIndex].label,
      targetLabel: nodes[targetIndex].label,
      verb,
      scale: 'micro',
      status: 'confirmed',
      claimState: 'student interpretation',
      annotation: { id: `dense-preview-edge-${index + 1}-annotation`, text: '' },
    }));
    project.candidates = { nodes, edges };
    project.graph = { nodes: [], edges: [] };
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);

    fireEvent.click(screen.getByRole('tab', { name: 'More relationships' }));
    const preview = screen.getByRole('img', { name: `Preview with ${nodes.length} nodes and 4 connections` });
    const previewSvg = preview.querySelector('svg');
    const viewBox = previewSvg.getAttribute('viewBox').split(/\s+/).map(Number);
    const [viewX, viewY, viewWidth, viewHeight] = viewBox;
    const renderedNodes = [...preview.querySelectorAll('.connection-preview__node')];
    const renderedLabels = [...preview.querySelectorAll('.connection-preview__label')];
    const bounds = [
      ...renderedNodes.map((node) => translatedRectBounds(node, node.querySelector('rect'))),
      ...renderedLabels.map((label) => svgRectBounds(label.querySelector('rect'))),
    ];

    expect(viewWidth / viewHeight).toBeCloseTo(8 / 5, 4);
    expect(viewWidth).toBeLessThan(2300);
    expect(screen.getByText(new RegExp(`Showing 4 of ${edges.length} connections`), { selector: '.connection-preview__scope' })).toBeVisible();
    expect(renderedLabels.map((label) => label.getAttribute('data-edge-id'))).toEqual(edges.slice(0, 4).map(({ id }) => id));
    expect(Math.min(...bounds.map(({ left }) => left))).toBeGreaterThanOrEqual(viewX);
    expect(Math.max(...bounds.map(({ right }) => right))).toBeLessThanOrEqual(viewX + viewWidth);
    expect(Math.min(...bounds.map(({ top }) => top))).toBeGreaterThanOrEqual(viewY);
    expect(Math.max(...bounds.map(({ bottom }) => bottom))).toBeLessThanOrEqual(viewY + viewHeight);
    renderedLabels.forEach((label, index) => {
      const labelBounds = svgRectBounds(label.querySelector('rect'));
      expect(svgTextLines(label.querySelector('text')).join(' ')).toBe(edges[index].verb);
      renderedNodes.forEach((node) => expect(rectsIntersect(labelBounds, translatedRectBounds(node, node.querySelector('rect')))).toBe(false));
      renderedLabels.slice(index + 1).forEach((other) => expect(rectsIntersect(labelBounds, svgRectBounds(other.querySelector('rect')))).toBe(false));
    });
  });

  it('keeps every connection in the bounded preview group visible between its endpoints when strict lanes are exhausted', async () => {
    const project = createDefaultProject();
    project.activeScale = 'micro';
    project.releasedScales = ['micro'];
    const extracted = extractCandidates(project.submission);
    const nodes = extracted.nodes.slice(0, 2).map((node, index) => ({
      ...node,
      id: `forced-preview-node-${index + 1}`,
      label: index === 0 ? 'Resident' : 'Peer navigator',
      type: index === 0 ? 'person' : 'group',
      scale: 'micro',
      status: 'confirmed',
      claimState: 'student interpretation',
      annotations: {
        analytical: { id: `forced-preview-node-${index + 1}-analytical`, text: '' },
        evidence: { id: `forced-preview-node-${index + 1}-evidence`, text: '' },
      },
    }));
    const verb = 'R'.repeat(100);
    const edgeTemplate = extracted.edges[0];
    const edges = Array.from({ length: 50 }, (_, index) => ({
      ...structuredClone(edgeTemplate),
      id: `forced-preview-edge-${index + 1}`,
      source: nodes[0].id,
      target: nodes[1].id,
      sourceLabel: nodes[0].label,
      targetLabel: nodes[1].label,
      verb,
      scale: 'micro',
      status: 'confirmed',
      claimState: 'student interpretation',
      annotation: { id: `forced-preview-edge-${index + 1}-annotation`, text: '' },
    }));
    project.candidates = { nodes, edges };
    project.graph = { nodes: [], edges: [] };
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);

    fireEvent.click(screen.getByRole('tab', { name: 'More relationships' }));
    const preview = screen.getByRole('img', { name: `Preview with ${nodes.length} nodes and 4 connections` });
    const renderedEdges = [...preview.querySelectorAll('.connection-preview__edge')];
    const renderedLabels = [...preview.querySelectorAll('.connection-preview__label')];
    const cardBounds = [...preview.querySelectorAll('.connection-preview__node')]
      .map((node) => translatedRectBounds(node, node.querySelector('rect')));

    expect(screen.getByText(new RegExp(`Showing 4 of ${edges.length} connections`), { selector: '.connection-preview__scope' })).toBeVisible();
    expect(renderedEdges).toHaveLength(4);
    expect(renderedLabels).toHaveLength(4);
    renderedLabels.forEach((label, index) => {
      const labelBounds = svgRectBounds(label.querySelector('rect'));
      expect(label.getAttribute('data-edge-id')).toBe(edges[index].id);
      expect(['between-endpoints', 'between-endpoints-tight']).toContain(label.getAttribute('data-edge-route'));
      expect(svgTextLines(label.querySelector('text')).join('')).toBe(verb);
      cardBounds.forEach((bounds) => expect(rectsIntersect(labelBounds, bounds)).toBe(false));
      renderedLabels.slice(index + 1).forEach((other) => {
        expect(rectsIntersect(labelBounds, svgRectBounds(other.querySelector('rect')))).toBe(false);
      });
    });
  });

  it('wraps and grows complete model-suggested connection wording while it is edited', async () => {
    const project = createDefaultProject();
    const nodes = extractCandidates(project.submission).nodes.slice(0, 2).map((node) => ({
      ...node,
      scale: 'micro',
      status: 'confirmed',
      claimState: 'student interpretation',
    }));
    project.activeScale = 'micro';
    project.releasedScales = ['micro'];
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
    fireEvent.click(screen.getByRole('tab', { name: 'More relationships' }));
    fireEvent.click(screen.getByRole('button', { name: 'Suggest connections' }));

    const firstVerb = await screen.findByRole('textbox', { name: 'Connection for suggestion 1' });
    const secondVerb = screen.getByRole('textbox', { name: 'Connection for suggestion 2' });
    expect(firstVerb).toHaveValue('engaged with for administrative guidance');
    expect(secondVerb).toHaveValue('turned to when systems were unclear');
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
    project.stage = 1;
    project.furthestStage = 1;
    preflightEvaluationResponder = (body) => jsonResponse({
      evaluation: evaluationRecord(body, {
        review: { guidance: [], nodes: [], connections: [], example: null, readiness: { ready: false, note: '' } },
      }),
    }, 201);
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    const guidance = await screen.findByRole('region', { name: 'Memo review' });
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
    expect(await screen.findByText('The classroom server returned guidance with unusable map items. Generate the guidance again.')).toBeVisible();
    expect(storedProject().preflight).toBeNull();
  });

  it('uses the exact evaluation envelope and keeps the stored memo review portable after reload', async () => {
    const project = createDefaultProject();
    project.participantName = 'East Harlem mapping group';
    await resumeSavedProject(project);
    fireEvent.click(screen.getByRole('button', { name: 'Review memo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    expect(await screen.findByRole('region', { name: 'Memo review' })).toBeVisible();

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
    expect(within(screen.getByRole('article', { name: project.title })).getByText('Review')).toBeVisible();
    openProjectFromList(project.title);
    expect(await screen.findByRole('region', { name: 'Coverage and uncertainty' })).toBeVisible();
    expect(screen.getByText('The memo already supports mapping. Continue to choose nodes and connections.')).toBeVisible();
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
    fireEvent.click(screen.getByRole('button', { name: 'Review memo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate guidance' }));
    await screen.findByRole('region', { name: 'Memo review' });

    const request = fetchMock.mock.calls.find(([path, options]) => String(path) === '/api/preflight/evaluations' && options.method === 'POST');
    const body = JSON.parse(request[1].body);
    expect(body.carriedNodes).toEqual(microNodes.map(({ id, label, type, scale }) => ({ id, label, type, scale })));
    expect(body.carriedNodes[0].id).not.toBe(stableId('node', body.carriedNodes[0].label));
  });

  it('sends every carried node and connection beyond the former outer-level preview slices', async () => {
    const project = makeMapProject('exosphere');
    const nodeTemplate = structuredClone(project.graph.nodes.find((node) => node.scale === 'micro'));
    const edgeTemplate = structuredClone(project.graph.edges.find((edge) => edge.scale === 'micro'));
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
    await screen.findByRole('region', { name: 'Memo review' });

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
    expect(await screen.findByText('Suggestion generation is temporarily unavailable.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Generate guidance' })).toBeEnabled();
    expect(storedProject().preflight).toBeNull();
  });

  it('marks guidance refreshable after a memo edit without erasing the guidance or any work', async () => {
    const project = projectWithMemoReview();
    await resumeSavedProject(project);
    expect(screen.getByRole('region', { name: 'Coverage and uncertainty' })).toBeVisible();
    expect(screen.queryByText(/Your memo changed after this guidance was generated/)).not.toBeInTheDocument();

    const drawer = document.querySelector('.memo-drawer');
    drawer.open = true;
    fireEvent.change(within(drawer).getByRole('textbox', { name: /^Memo/ }), {
      target: { value: `${project.submission.text} A later correction adds one more connection.` },
    });

    expect(await screen.findByText(/Your memo changed after this guidance was generated/)).toBeVisible();
    expect(screen.getByRole('region', { name: 'Memo review' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    screen.getAllByRole('button', { name: 'Continue without model' }).forEach((button) => expect(button).toBeEnabled());
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
    expect(await screen.findByRole('region', { name: 'Memo review' })).toBeVisible();
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
    fireEvent.click(within(document.querySelector('.app-footer')).getByRole('button', { name: 'Continue without model' }));
    expect(await screen.findByRole('heading', { name: 'Choose items' })).toBeVisible();
    await waitFor(() => {
      expect(storedProject().candidates).toEqual({ nodes: [], edges: [] });
      expect(storedProject().graph).toEqual(graphBefore);
    });
  });

  it('reviews, commits, and summarizes direct Micro relationships with their verbs at Micro', async () => {
    const project = projectWithMemoReview();
    await resumeSavedProject(project);
    expect(screen.getByText('refers students to')).toBeVisible();
    fireEvent.click(within(screen.getByRole('region', { name: 'Coverage and uncertainty' })).getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Choose items' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Relationships · 1' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'More relationships' })).toBeVisible();
    await waitFor(() => {
      const stored = storedProject();
      expect(stored.stage).toBe(2);
      expect(stored.candidates.nodes.map(({ label }) => label)).toEqual(expect.arrayContaining(['School', 'Committee']));
      expect(stored.candidates.nodes.every((node) => node.scale === 'micro')).toBe(true);
      expect(stored.candidates.nodes.every((node) => node.status === 'pending' && node.claimState === 'inference')).toBe(true);
      expect(stored.candidates.edges).toEqual([expect.objectContaining({
        verb: 'refers students to', scale: 'micro', status: 'pending', claimState: 'inference',
      })]);
    });
    screen.getAllByRole('button', { name: 'Add to map' }).forEach((button) => fireEvent.click(button));
    fireEvent.click(screen.getByRole('tab', { name: 'Relationships · 1' }));
    const relationshipEditor = screen.getByRole('textbox', { name: 'Direct connection' });
    fireEvent.change(relationshipEditor, { target: { value: 'refers directly to' } });
    fireEvent.click(within(relationshipEditor.closest('article')).getByRole('button', { name: 'Add to map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
    await waitFor(() => expect(storedProject().stage).toBe(3));
    expect(storedProject().graph.edges).toEqual([expect.objectContaining({ verb: 'refers directly to', scale: 'micro', status: 'confirmed' })]);
    expect(fetchMock.mock.calls.filter(([path]) => String(path) === '/api/map/connections')).toHaveLength(0);

    fireEvent.click(within(document.querySelector('.app-footer')).getByRole('button', { name: 'Revise and export' }));
    expect(await screen.findByRole('heading', { name: 'Review and export your map' })).toBeVisible();
    expect(screen.getByLabelText('Current Micro-level map summary')).toHaveTextContent('2 nodes are recorded with 1 direct relationship');
  });

  it('records focal participation and immediate setting membership while reviewing Micro suggestions', async () => {
    const project = projectWithMemoReview();
    await resumeSavedProject(project);
    fireEvent.click(within(screen.getByRole('region', { name: 'Coverage and uncertainty' })).getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Choose items' })).toBeVisible();

    await waitFor(() => expect(storedProject().candidates.nodes.map((node) => node.label)).toEqual(expect.arrayContaining(['School', 'Committee'])));
    const schoolCandidate = storedProject().candidates.nodes.find((node) => node.label === 'School');
    const committeeCandidate = storedProject().candidates.nodes.find((node) => node.label === 'Committee');
    expect(schoolCandidate).toMatchObject({ focalParticipation: 'direct', settingNodeIds: [] });
    expect(committeeCandidate).toMatchObject({ focalParticipation: 'direct', settingNodeIds: [] });

    const schoolRow = screen.getByDisplayValue('School').closest('article');
    const committeeRow = screen.getByDisplayValue('Committee').closest('article');
    expect(within(schoolRow).queryByRole('combobox', { name: 'Add an immediate setting for School' })).not.toBeInTheDocument();
    fireEvent.change(within(committeeRow).getByRole('combobox', { name: 'Relation to focal person for Committee' }), { target: { value: 'indirect' } });
    fireEvent.change(within(committeeRow).getByRole('combobox', { name: 'Add an immediate setting for Committee' }), { target: { value: schoolCandidate.id } });
    await waitFor(() => expect(storedProject().candidates.nodes.find((node) => node.id === committeeCandidate.id)).toMatchObject({
      focalParticipation: 'indirect',
      settingNodeIds: [schoolCandidate.id],
    }));

    fireEvent.click(within(schoolRow).getByRole('button', { name: 'Add to map' }));
    fireEvent.click(within(committeeRow).getByRole('button', { name: 'Add to map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    await waitFor(() => expect(storedProject().graph.nodes.find((node) => node.label === 'Committee')).toMatchObject({
      focalParticipation: 'indirect',
      settingNodeIds: [schoolCandidate.id],
    }));
    const settingRegion = document.querySelector(`[data-setting-region="${schoolCandidate.id}"]`);
    expect(settingRegion).toHaveAttribute('data-member-count', '1');
    expect(settingRegion.getAttribute('d')).toMatch(/^M /);
  });

  it('leaves every model suggestion off until the student explicitly adds it regardless of teacher preference', async () => {
    const project = projectWithMemoReview();
    project.instructor.requireStudentConfirmation = false;
    await resumeSavedProject(project);

    fireEvent.click(within(screen.getByRole('region', { name: 'Coverage and uncertainty' })).getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Choose items' })).toBeVisible();
    expect(screen.getByText(/Suggestions join the map only when you choose Add/)).toBeVisible();
    await waitFor(() => {
      const stored = storedProject();
      expect(stored.candidates.nodes.every((node) => node.status === 'pending')).toBe(true);
      expect(stored.candidates.edges.every((edge) => edge.status === 'pending')).toBe(true);
    });
    screen.getAllByRole('button', { name: 'Add to map' }).forEach((button) => expect(button).not.toHaveClass('is-active'));
  });

  it('carries only discrete Micro actors and objects from a structured review into the map', async () => {
    const project = createDefaultProject();
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
    fireEvent.click(within(screen.getByRole('region', { name: 'Coverage and uncertainty' })).getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Choose items' })).toBeVisible();

    const expectedLabels = ['Adult Participants', 'Accessible van'];
    expect(screen.getAllByRole('textbox', { name: 'Node label' }).map((input) => input.value)).toEqual(expectedLabels);
    await waitFor(() => {
      expect(storedProject().candidates.nodes.map(({ label }) => label)).toEqual(expectedLabels);
      expect(storedProject().candidates.nodes.every((node) => node.scale === 'micro')).toBe(true);
      expect(storedProject().candidates.nodes.every((node) => node.status === 'pending' && node.claimState === 'inference')).toBe(true);
      expect(storedProject().candidates.edges).toEqual([]);
    });

    screen.getAllByRole('button', { name: 'Add to map' }).forEach((button) => fireEvent.click(button));
    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    await waitFor(() => {
      expect(storedProject().graph.nodes.map(({ label }) => label)).toEqual(expectedLabels);
      expect(storedProject().graph.edges).toEqual([]);
    });
    expect([...document.querySelectorAll('.graph-node')].map((node) => node.getAttribute('data-full-label'))).toEqual(expectedLabels);
  });

  it('uses the scale-aware model review as the complete Micro candidate set', async () => {
    const project = createDefaultProject();
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
    fireEvent.click(within(screen.getByRole('region', { name: 'Coverage and uncertainty' })).getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Choose items' })).toBeVisible();

    const expectedLabels = review.nodes.map(({ label }) => label);
    expect(screen.getAllByRole('textbox', { name: 'Node label' }).map((input) => input.value)).toEqual(expectedLabels);
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
    expect(await screen.findByText('The classroom server returned guidance with unusable map items. Generate the guidance again.')).toBeVisible();
    expect(storedProject().preflight).toBeNull();
    expect(screen.queryByText(clauseLabel)).not.toBeInTheDocument();
    expect(screen.queryByText(discreteLabel)).not.toBeInTheDocument();
  });

  it('commits a noun-labeled Meso linkage with exact carried Micro setting IDs and no edges or verb controls', async () => {
    const project = createDefaultProject();
    const microNodes = extractCandidates(project.submission).nodes
      .slice(0, 2)
      .map((node) => ({ ...node, type: 'setting', scale: 'micro', status: 'confirmed', claimState: 'student interpretation' }));
    microNodes[0].label = 'Renamed family support setting';
    const linkageLabel = 'Family–school coordination';
    expect(microNodes[0].id).not.toBe(stableId('node', microNodes[0].label));
    project.activeScale = 'meso';
    project.releasedScales = ['micro', 'meso'];
    project.graph = { nodes: microNodes, edges: [] };
    project.candidates = { nodes: [], edges: [] };
    project.stage = 1;
    project.furthestStage = 1;
    const review = {
      guidance: [{ point: 'The memo describes coordination between two immediate settings.' }],
      nodes: [{
        label: linkageLabel,
        type: 'mesosystem',
        scale: 'meso',
        evidence: 'The memo names coordination between the family and school settings.',
        scope: microNodes.map(({ id, label }) => ({ id, label })),
      }],
      connections: [],
      example: null,
      readiness: { ready: true, note: 'The memo supports one Meso linkage.' },
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
    const carried = screen.getByRole('region', { name: 'Micro settings available for mesosystems' });
    microNodes.forEach((node) => expect(within(carried).getByText(node.label)).toBeVisible());
    fireEvent.click(within(screen.getByRole('region', { name: 'Coverage and uncertainty' })).getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Choose items' })).toBeVisible();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Direct connection' })).not.toBeInTheDocument();
    expect(screen.queryByText(/More connections|More direct relationships/)).not.toBeInTheDocument();
    const linkageEditor = screen.getByRole('textbox', { name: 'Mesosystem label' });
    expect(linkageEditor).toHaveValue(linkageLabel);
    const scopeEditor = linkageEditor.closest('article');
    microNodes.forEach((node) => expect(within(scopeEditor).getByRole('button', { name: `Remove ${node.label} from ${linkageLabel}` })).toBeVisible());
    expect(within(scopeEditor).getByRole('textbox', { name: /^Interaction/ })).toBeVisible();
    await waitFor(() => {
      expect(storedProject().candidates.nodes).toEqual([expect.objectContaining({
        label: linkageLabel,
        type: 'mesosystem',
        scale: 'meso',
        scopeNodeIds: microNodes.map(({ id }) => id),
      })]);
      expect(storedProject().candidates.edges).toEqual([]);
    });

    fireEvent.click(within(screen.getAllByRole('article')[0]).getByRole('button', { name: 'Add to map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
    await waitFor(() => expect(storedProject().stage).toBe(3));
    const stored = storedProject();
    expect(stored.graph.nodes.filter((node) => node.scale === 'micro').map(({ id }) => id)).toEqual(microNodes.map(({ id }) => id));
    expect(stored.graph.nodes.find((node) => node.label === linkageLabel)).toMatchObject({
      type: 'mesosystem',
      scale: 'meso',
      scopeNodeIds: microNodes.map(({ id }) => id),
    });
    expect(stored.graph.edges).toEqual([]);
    expect(document.querySelectorAll(`[data-linkage-of="${stableId('node', linkageLabel)}"]`)).toHaveLength(2);
    expect(document.querySelectorAll('.graph-edge[data-edge-scale="meso"]')).toHaveLength(0);
    expect(document.querySelectorAll('.graph-edge-label[data-edge-scale="meso"]')).toHaveLength(0);
  });

  it('keeps an existing Micro node in Micro when an Exosphere memo names it again', async () => {
    const project = createDefaultProject();
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
    project.instructor.requireStudentConfirmation = false;
    project.stage = 1;
    project.furthestStage = 1;
    const review = {
      guidance: [{ point: 'The memo names an indirect institutional influence.' }],
      nodes: [
        { label: outerLabel, type: 'agency', scale: 'exosphere', evidence: 'The memo names the department.' },
      ],
      connections: [{
        source: outerLabel,
        target: existing.label,
        sourceLabel: outerLabel,
        targetLabel: existing.label,
        verb: 'sets rules for',
        rationale: 'The memo describes the institutional pathway.',
      }],
      example: `${outerLabel} sets rules for ${existing.label}.`,
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
    fireEvent.click(within(screen.getByRole('region', { name: 'Coverage and uncertainty' })).getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'New decision setting' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /^Name/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add setting' })).toBeVisible();
    await waitFor(() => {
      const stored = storedProject();
      expect(stored.candidates.nodes.some((node) => node.id === existing.id)).toBe(false);
      expect(stored.candidates.nodes.find((node) => node.label === outerLabel)).toMatchObject({ scale: 'exosphere', status: 'pending', claimState: 'inference' });
      expect(stored.candidates.edges).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: stableId('node', outerLabel), target: existing.id, scale: 'exosphere', status: 'pending', claimState: 'inference' }),
      ]));
    });

    const institutionRow = screen.getByRole('textbox', { name: 'Node label' }).closest('article');
    fireEvent.click(within(institutionRow).getByRole('button', { name: 'Add to map' }));
    await waitFor(() => expect(storedProject().candidates.nodes.find((node) => node.label === outerLabel)).toMatchObject({ status: 'confirmed' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Connections · 1' }));
    const relationshipRow = screen.getByLabelText('How decision reaches Micro setting').closest('article');
    fireEvent.click(within(relationshipRow).getByRole('button', { name: 'Add to map' }));
    await waitFor(() => {
      expect(within(relationshipRow).getByRole('button', { name: 'Add to map' })).toHaveClass('is-active');
      expect(storedProject().candidates.edges[0]).toMatchObject({ status: 'confirmed' });
    });
    fireEvent.click(within(document.querySelector('.app-footer')).getByRole('button', { name: 'Open map' }));
    await waitFor(() => expect(storedProject().stage).toBe(3));
    expect(storedProject().graph.nodes.find((node) => node.id === existing.id)).toMatchObject(originalIdentity);
    expect(storedProject().graph.nodes.filter((node) => node.id === existing.id)).toHaveLength(1);
    const committed = storedProject();
    expect(committed.graph.edges, committed.events.slice(-3).map((event) => `${event.action}: ${event.detail}`).join('\n')).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: stableId('node', outerLabel), target: existing.id, scale: 'exosphere' }),
    ]));
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
    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
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
    const relationship = project.graph.edges.find((edge) => edge.scale === 'micro');
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

    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
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
    openProjectFromList('NYC systems and assets map');
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
    openProjectFromList(project.title);
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
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Add to map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
    await waitFor(() => {
      expect(storedProject().graph.nodes.find((node) => node.id === project.candidates.nodes[0].id)).toMatchObject({ status: 'rejected', claimState: 'retired' });
    });
  });

  it('keeps a direct Micro relationship whose verb is outside the course vocabulary when the student chooses Keep', async () => {
    const project = createDefaultProject();
    project.activeScale = 'micro';
    project.releasedScales = ['micro'];
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
      scale: 'micro',
    };
    project.candidates = { nodes, edges: [edge] };
    project.graph = { nodes: [], edges: [] };
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);

    fireEvent.click(screen.getByRole('tab', { name: /Relationships · 1/ }));
    const row = screen.getAllByRole('article')[0];
    fireEvent.click(within(row).getByRole('button', { name: 'Add to map' }));
    expect(within(row).getByRole('button', { name: 'Add to map' })).toHaveClass('is-active');
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

  it('records a manually added direct relationship in Micro', async () => {
    const project = await openMapProject(makeMapProject('micro'));
    const microNodes = project.graph.nodes.filter((node) => node.scale === 'micro');
    const inspector = openMapInspector();
    fireEvent.click(within(inspector).getByRole('button', { name: 'Add' }));
    const addActions = document.getElementById('inspector-add-actions');
    fireEvent.click(within(addActions).getByRole('button', { name: 'Relationship' }));
    const addForm = screen.getByRole('heading', { name: 'New relationship' }).parentElement;
    fireEvent.change(within(addForm).getByLabelText('From'), { target: { value: microNodes[0].id } });
    fireEvent.change(within(addForm).getByLabelText('Relationship'), { target: { value: 'coordinates with' } });
    fireEvent.change(within(addForm).getByLabelText('To'), { target: { value: microNodes[1].id } });
    fireEvent.change(within(addForm).getByLabelText('Evidence or question'), { target: { value: 'The Micro memo names this direct relationship.' } });
    fireEvent.click(within(addForm).getByRole('button', { name: 'Add relationship' }));
    await waitFor(() => expect(storedProject().graph.edges.at(-1)).toMatchObject({
      source: microNodes[0].id,
      target: microNodes[1].id,
      scale: 'micro',
      verb: 'coordinates with',
    }));
  });

  it('offsets two visible Micro relationships between the same node pair in the network map', async () => {
    const project = makeMapProject('micro');
    const baseEdge = structuredClone(project.graph.edges.find((edge) => edge.scale === 'micro'));
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
    const labels = relationships.map((edge) => document.querySelector(`.graph-edge-label[data-edge-id="${edge.id}"]`));
    const paths = relationships.map((edge) => document.querySelector(`.graph-edge[data-graph-id="${edge.id}"] .edge-line`).getAttribute('d'));
    const anchors = labels.map((label) => `${label.getAttribute('data-anchor-x')},${label.getAttribute('data-anchor-y')}`);
    const labelBounds = labels.map((label) => svgRectBounds(label.querySelector('.edge-label-bg')));

    labels.forEach((label, index) => {
      expect(label).toHaveAttribute('data-edge-route', 'between-endpoints');
      expect(label).toHaveAttribute('data-full-label', relationships[index].verb);
      expect(svgTextLines(label.querySelector('.edge-label')).join(' ')).toBe(relationships[index].verb);
      expect(label).not.toHaveTextContent('…');
    });
    expect(new Set(anchors)).toHaveLength(relationships.length);
    expect(new Set(paths)).toHaveLength(relationships.length);
    expect(rectsIntersect(labelBounds[0], labelBounds[1])).toBe(false);
  });

  it('keeps a dense Micro overview in its band and opens one clear between-endpoint relationship at a time', async () => {
    const project = makeDenseFocusedMesoProject(5);
    const graphBefore = structuredClone(project.graph);
    await openMapProject(project);
    fireEvent.change(screen.getByRole('combobox', { name: 'Show map layer' }), { target: { value: 'micro' } });
    fireEvent.click(screen.getByRole('button', { name: 'Arrange map' }));
    await waitFor(() => expect(eventRequests('map_arranged')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Fit map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Full screen map' }));

    expect(document.querySelectorAll('.graph-edge')).toHaveLength(project.graph.edges.length);
    expect(document.querySelectorAll('.graph-edge-label')).toHaveLength(0);
    const microRing = document.querySelector('.ecology-layer--micro ellipse');
    const center = { x: Number(microRing.getAttribute('cx')), y: Number(microRing.getAttribute('cy')) };
    const radius = { x: Number(microRing.getAttribute('rx')), y: Number(microRing.getAttribute('ry')) };
    [...document.querySelectorAll('.graph-node')].forEach((node) => {
      const bounds = translatedRectBounds(node, node.querySelector('.node-card'));
      [bounds.left, bounds.right].forEach((x) => [bounds.top, bounds.bottom].forEach((y) => {
        expect(((x - center.x) / radius.x) ** 2 + ((y - center.y) / radius.y) ** 2).toBeLessThanOrEqual(1);
      }));
    });

    const inspector = openNodeInspector('node-dense-focus');
    fireEvent.click(within(inspector).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(mapCanvas()).toHaveClass('is-detail-view'));
    const labels = [...document.querySelectorAll('.graph-edge-label')];
    expect(labels).toHaveLength(1);
    const label = labels[0];
    const edge = project.graph.edges.find((candidate) => candidate.id === label.getAttribute('data-edge-id'));
    const bounds = svgRectBounds(label.querySelector('.edge-label-bg'));
    const visibleBounds = transformedRectBounds(bounds);
    const source = renderedNodePosition(edge.source);
    const target = renderedNodePosition(edge.target);
    const anchor = { x: Number(label.getAttribute('data-anchor-x')), y: Number(label.getAttribute('data-anchor-y')) };
    const delta = { x: target.x - source.x, y: target.y - source.y };
    const projection = ((anchor.x - source.x) * delta.x + (anchor.y - source.y) * delta.y) / (delta.x ** 2 + delta.y ** 2);
    expect(label).toHaveAttribute('data-edge-route', 'between-endpoints');
    expect(svgTextLines(label.querySelector('.edge-label')).join(' ')).toBe(edge.verb);
    [...document.querySelectorAll('.graph-node')].forEach((node) => {
      expect(rectsIntersect(bounds, translatedRectBounds(node, node.querySelector('.node-card')))).toBe(false);
    });
    expect(projection).toBeGreaterThan(0);
    expect(projection).toBeLessThan(1);
    expect(visibleBounds.left).toBeGreaterThanOrEqual(0);
    expect(visibleBounds.right).toBeLessThanOrEqual(840);
    expect(visibleBounds.top).toBeGreaterThanOrEqual(0);
    expect(visibleBounds.bottom).toBeLessThanOrEqual(540);
    expect(storedProject().graph.nodes.map(({ id, label, type, scale }) => ({ id, label, type, scale })))
      .toEqual(graphBefore.nodes.map(({ id, label, type, scale }) => ({ id, label, type, scale })));
  });

  it('requires a named outside decision setting for a manually added Exo-level map node', async () => {
    const project = await openMapProject(makeMapProject('exosphere'));
    const initialNodeCount = project.graph.nodes.length;
    const inspector = openMapInspector();
    fireEvent.click(within(inspector).getByRole('button', { name: 'Add' }));
    const addActions = document.getElementById('inspector-add-actions');
    fireEvent.click(within(addActions).getByRole('button', { name: 'Node' }));
    const addForm = screen.getByRole('heading', { name: 'New node' }).parentElement;
    fireEvent.change(within(addForm).getByLabelText('Label'), { target: { value: 'Transportation access' } });
    fireEvent.change(within(addForm).getByLabelText('Evidence or question'), { target: { value: 'The memo identifies an institutional pathway.' } });
    fireEvent.click(within(addForm).getByRole('button', { name: 'Add node' }));

    expect(screen.getByText('Use the full name of an outside office, agency, employer, funder, or service system.')).toBeVisible();
    expect(storedProject().graph.nodes).toHaveLength(initialNodeCount);

    fireEvent.change(within(addForm).getByLabelText('Label'), { target: { value: 'East Harlem Disability Services Office' } });
    fireEvent.click(within(addForm).getByRole('button', { name: 'Add node' }));
    await waitFor(() => expect(storedProject().graph.nodes).toHaveLength(initialNodeCount + 1));
    expect(storedProject().graph.nodes.at(-1)).toMatchObject({
      label: 'East Harlem Disability Services Office',
      type: 'institution',
      scale: 'exosphere',
      status: 'confirmed',
      claimState: 'research lead',
    });
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
    expect(within(addForm).getByRole('combobox', { name: 'Relation to focal person for this item' })).toHaveValue('direct');
    fireEvent.change(within(addForm).getByLabelText('Label'), { target: { value: 'Peer navigator' } });
    fireEvent.change(within(addForm).getByRole('combobox', { name: 'Relation to focal person for Peer navigator' }), { target: { value: 'indirect' } });
    fireEvent.change(within(addForm).getByRole('combobox', { name: 'Add an immediate setting for Peer navigator' }), { target: { value: setting.id } });
    fireEvent.change(within(addForm).getByLabelText('Evidence or question'), { target: { value: 'The memo identifies the peer navigator in this setting.' } });
    fireEvent.click(within(addForm).getByRole('button', { name: 'Add node' }));

    await waitFor(() => expect(storedProject().graph.nodes.find((node) => node.label === 'Peer navigator')).toMatchObject({
      focalParticipation: 'indirect',
      settingNodeIds: [setting.id],
      origin: 'student entry',
    }));
    const added = storedProject().graph.nodes.find((node) => node.label === 'Peer navigator');
    fireEvent.click(within(inspector).getByText('Summary'));
    expect(within(inspector).getByRole('combobox', { name: 'Relation to focal person for Peer navigator' })).toHaveValue('indirect');
    expect(within(inspector).getByRole('button', { name: `Remove ${setting.label} from the immediate settings for Peer navigator` })).toBeVisible();
    fireEvent.change(within(inspector).getByRole('combobox', { name: 'Relation to focal person for Peer navigator' }), { target: { value: 'unclear' } });
    await waitFor(() => expect(storedProject().graph.nodes.find((node) => node.id === added.id)?.focalParticipation).toBe('unclear'));
    const settingRegion = document.querySelector(`[data-setting-region="${setting.id}"]`);
    expect(settingRegion).toHaveAttribute('data-member-count', '1');
    expect(settingRegion.getAttribute('d')).toMatch(/^M /);
  });

  it('allows manual nodes and direct relationships in Micro but keeps Meso linkage creation in the Choose stage', async () => {
    await openMapProject(makeMapProject('micro'));
    let inspector = openMapInspector();
    fireEvent.click(within(inspector).getByRole('button', { name: 'Add' }));
    let actions = document.getElementById('inspector-add-actions');
    expect(within(actions).getByRole('button', { name: 'Node' })).toBeVisible();
    expect(within(actions).getByRole('button', { name: 'Relationship' })).toBeVisible();

    cleanup();
    const project = await openMapProject(makeMapProject('meso'));
    inspector = openMapInspector();
    fireEvent.click(within(inspector).getByRole('button', { name: 'Add' }));
    actions = document.getElementById('inspector-add-actions');
    expect(within(actions).queryByRole('button', { name: 'Node' })).not.toBeInTheDocument();
    expect(within(actions).queryByRole('button', { name: 'Relationship' })).not.toBeInTheDocument();
  });

  it('renders Meso linkage nodes in the Meso annulus with derived bridge lines and no relationship labels', async () => {
    const project = makeMapProject('meso');
    const meso = graphForScale(project, 'meso');
    const linkage = project.graph.nodes.find((node) => node.scale === 'meso');
    const graphBefore = structuredClone(project.graph);
    await openMapProject(project);

    expect(mapCanvas()).toHaveAttribute('data-map-mode', 'ecology');
    const scale = screen.getByRole('combobox', { name: 'Show map layer' });
    expect(scale).toHaveValue('all');
    fireEvent.change(scale, { target: { value: 'meso' } });
    expect(document.querySelector('[data-ecology-layer="meso"]')).toHaveClass('is-visible');
    const renderedNodes = [...document.querySelectorAll('.graph-node')];
    expect(renderedNodes).toHaveLength(meso.nodes.length);
    const renderedLinkage = document.querySelector(`.graph-node[data-graph-id="${linkage.id}"]`);
    expect(renderedLinkage).toHaveClass('graph-node--meso');
    expect(renderedLinkage).toHaveAttribute('aria-label', expect.stringContaining(', Meso-level,'));
    expect(svgTextLines(renderedLinkage.querySelector('.node-label')).join(' ')).toBe(linkage.label);
    const position = renderedNodePosition(linkage.id);
    const offsetX = position.x - 1600;
    const offsetY = position.y - 1200;
    expect((offsetX ** 2) / (600 ** 2) + (offsetY ** 2) / (420 ** 2)).toBeGreaterThan(1);
    expect((offsetX ** 2) / (910 ** 2) + (offsetY ** 2) / (650 ** 2)).toBeLessThan(1);
    expect(document.querySelectorAll(`[data-linkage-of="${linkage.id}"]`)).toHaveLength(linkage.scopeNodeIds.length);
    expect(document.querySelectorAll('.graph-edge[data-edge-scale="meso"]')).toHaveLength(0);
    expect(document.querySelectorAll('.graph-edge-label[data-edge-scale="meso"]')).toHaveLength(0);

    fireEvent.change(scale, { target: { value: 'micro' } });
    expect(document.querySelector(`[data-graph-id="${linkage.id}"]`)).toBeNull();
    expect(document.querySelectorAll(`[data-linkage-of="${linkage.id}"]`)).toHaveLength(0);
    fireEvent.change(scale, { target: { value: 'meso' } });
    expect(document.querySelector(`[data-graph-id="${linkage.id}"]`)).toBeVisible();
    expect(document.querySelectorAll(`[data-linkage-of="${linkage.id}"]`)).toHaveLength(linkage.scopeNodeIds.length);
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

    expect(scale).toHaveValue('all');
    expect(within(scale).getAllByRole('option').map((option) => option.value)).toEqual([...project.releasedScales, 'all']);
    expect(mapCanvas()).toHaveAttribute('data-map-mode', 'ecology');
    expect(mapCanvas()).toHaveAttribute('aria-label', expect.stringContaining(`All-layers map. ${all.nodes.length} nodes and ${all.edges.length} ${all.edges.length === 1 ? 'connection' : 'connections'}.`));
    fireEvent.change(scale, { target: { value: activeScale } });
    expect(mapCanvas()).toHaveAttribute('aria-label', expect.stringContaining(`${activeScale === 'exosphere' ? 'Exo-level' : 'Macro-level'} map. ${active.nodes.length} nodes and ${active.edges.length} ${active.edges.length === 1 ? 'connection' : 'connections'}.`));
    expect(document.querySelectorAll('[data-ecology-layer]')).toHaveLength(project.releasedScales.length);
    expect(document.querySelector(`[data-ecology-layer="${activeScale}"]`)).toHaveClass('is-visible');
    expect(document.querySelectorAll('[data-ecology-layer].is-muted')).toHaveLength(project.releasedScales.length - 1);
    const activeLabels = [...document.querySelectorAll(`.graph-edge-label[data-edge-scale="${activeScale}"][data-edge-route="between-endpoints"]`)];
    if (active.edges.length) expect(activeLabels.length).toBeGreaterThan(0);
    else expect(activeLabels).toHaveLength(0);
    expect(activeLabels.length).toBeLessThanOrEqual(active.edges.length);
    activeLabels.forEach((label) => {
      const edge = project.graph.edges.find((candidate) => candidate.id === label.getAttribute('data-edge-id'));
      const source = renderedNodePosition(edge.source);
      const target = renderedNodePosition(edge.target);
      const anchor = { x: Number(label.getAttribute('data-anchor-x')), y: Number(label.getAttribute('data-anchor-y')) };
      const delta = { x: target.x - source.x, y: target.y - source.y };
      const projection = ((anchor.x - source.x) * delta.x + (anchor.y - source.y) * delta.y) / (delta.x ** 2 + delta.y ** 2);
      expect(projection, `${label.getAttribute('data-full-label')} is not between its endpoints`).toBeGreaterThan(0);
      expect(projection, `${label.getAttribute('data-full-label')} is not between its endpoints`).toBeLessThan(1);
      const labelBounds = svgRectBounds(label.querySelector('.edge-label-bg'));
      [...document.querySelectorAll('.graph-node')].forEach((node) => {
        expect(rectsIntersect(labelBounds, translatedRectBounds(node, node.querySelector('.node-card')))).toBe(false);
      });
    });
    expect(screen.getByText(activeScale === 'exosphere'
      ? 'Choose a node to see its relationships.'
      : 'Choose a Macro-level condition to see the map items it affects.')).toBeVisible();
    expect(inspector).toHaveAttribute('aria-hidden', 'true');
    expect(inspector).toHaveAttribute('inert');
    expect(document.querySelector('.map-layout')).not.toHaveClass('has-inspector');

    fireEvent.change(scale, { target: { value: 'meso' } });
    expect(scale).toHaveValue('meso');
    const mesosystemCount = meso.nodes.filter((node) => node.scale === 'meso').length;
    const settingCount = meso.nodes.filter((node) => node.scale === 'micro').length;
    expect(mapCanvas()).toHaveAttribute('aria-label', expect.stringContaining(`Meso-level map. ${mesosystemCount} ${mesosystemCount === 1 ? 'mesosystem' : 'mesosystems'} and ${settingCount} Micro ${settingCount === 1 ? 'setting' : 'settings'}.`));
    expect(document.querySelectorAll('.graph-edge-label[data-edge-scale="meso"]')).toHaveLength(meso.edges.length);

    fireEvent.change(scale, { target: { value: 'all' } });
    expect(mapCanvas()).toHaveAttribute('aria-label', expect.stringContaining(`All-layers map. ${all.nodes.length} nodes and ${all.edges.length} ${all.edges.length === 1 ? 'connection' : 'connections'}.`));
    expect(screen.getByText('Choose a node to see its relationships.')).toBeVisible();
    expect(document.querySelectorAll('[data-ecology-layer].is-visible')).toHaveLength(project.releasedScales.length);
    expect(document.querySelectorAll('.graph-edge-label')).toHaveLength(0);
    expect(document.querySelectorAll('.graph-edge.is-muted')).toHaveLength(all.edges.length);
    expect(storedProject().graph).toEqual(graphBefore);
  });

  it('opens a progressed map on a transient cumulative all-layers fit without changing the saved viewport', async () => {
    const project = makeMapProject('meso');
    project.releasedScales.push('exosphere');
    project.viewport = { zoom: 0.15, panX: -2400, panY: 1900 };
    const durableViewport = { ...project.viewport };
    await openMapProject(project);

    expect(mapCanvas()).toHaveAttribute('data-map-mode', 'ecology');
    expect(screen.getByRole('combobox', { name: 'Show map layer' })).toHaveValue('all');
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

  it('zooms out to 0.15 and keeps keyboard and pointer panning available at the overview limit', async () => {
    const project = makeSixNodeMicroProject();
    project.viewport = { zoom: 1, panX: 0, panY: 0 };
    const graphBefore = structuredClone(project.graph);
    await openMapProject(project);
    const canvas = mapCanvas();
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });

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
    fireEvent.change(screen.getByRole('combobox', { name: 'Show map layer' }), { target: { value: 'exosphere' } });
    fireEvent.click(screen.getByRole('button', { name: 'Arrange map' }));
    await waitFor(() => expect(eventRequests('map_arranged')).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Fit map' }));
    await waitFor(() => expectVisibleNodesAndConnectionLabelsInsideCanvas());
    expect(document.querySelectorAll('.graph-edge-label').length).toBeGreaterThan(0);
    const fittedFilteredViewport = { ...storedProject().viewport };

    fireEvent.click(screen.getByRole('button', { name: 'Full screen map' }));
    expect(document.querySelector('.map-stage')).toHaveClass('is-fullscreen');
    await waitFor(() => expectVisibleNodesAndConnectionLabelsInsideCanvas());
    expect(storedProject().viewport).toEqual(fittedFilteredViewport);
    fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }));

    fireEvent.change(screen.getByRole('combobox', { name: 'Show map layer' }), { target: { value: 'all' } });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Show map layer' })).toHaveValue('all'));
    fireEvent.click(screen.getByRole('button', { name: 'Arrange map' }));
    await waitFor(() => expect(eventRequests('map_arranged')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Fit map' }));
    await waitFor(() => expectVisibleNodesAndConnectionLabelsInsideCanvas());
    const fittedAllViewport = { ...storedProject().viewport };

    fireEvent.click(screen.getByRole('button', { name: 'Full screen map' }));
    await waitFor(() => expectVisibleNodesAndConnectionLabelsInsideCanvas());
    expect(storedProject().viewport).toEqual(fittedAllViewport);
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

  it('keeps level badges in their own ordered rings and expands the shared ring geometry with explicit zoom out', async () => {
    installPhoneLayout(390);
    await openMapProject(makePhoneEcologyOverviewProject());
    fireEvent.change(screen.getByRole('combobox', { name: 'Show map layer' }), { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fit map' }));

    const levels = ['micro', 'meso', 'exosphere', 'macrosphere'];
    const readGeometry = () => {
      const rings = new Map();
      const labels = new Map();
      levels.forEach((level) => {
        const layer = document.querySelector(`[data-ecology-layer="${level}"]`);
        const ellipse = layer.querySelector('ellipse');
        const labelGroup = layer.querySelector('.ecology-layer__label');
        const labelRect = labelGroup.querySelector('rect');
        const [, x, y] = labelGroup.getAttribute('transform').match(/^translate\((-?[\d.]+) (-?[\d.]+)\)$/);
        const center = { x: Number(ellipse.getAttribute('cx')), y: Number(ellipse.getAttribute('cy')) };
        const rect = {
          left: Number(x) + Number(labelRect.getAttribute('x')),
          right: Number(x) + Number(labelRect.getAttribute('x')) + Number(labelRect.getAttribute('width')),
          top: Number(y) + Number(labelRect.getAttribute('y')),
          bottom: Number(y) + Number(labelRect.getAttribute('y')) + Number(labelRect.getAttribute('height')),
        };
        rings.set(level, {
          ...center,
          rx: Number(ellipse.getAttribute('rx')),
          ry: Number(ellipse.getAttribute('ry')),
        });
        labels.set(level, { x: Number(x), y: Number(y), rect });
      });
      return { rings, labels };
    };
    const expectOrderedMembership = ({ rings, labels }) => {
      levels.forEach((level, index) => {
        const ring = rings.get(level);
        const { rect } = labels.get(level);
        const corners = [
          [rect.left, rect.top], [rect.right, rect.top],
          [rect.left, rect.bottom], [rect.right, rect.bottom],
        ];
        const outerMetric = Math.max(...corners.map(([x, y]) => (
          ((x - ring.x) / ring.rx) ** 2 + ((y - ring.y) / ring.ry) ** 2
        )));
        expect(outerMetric, `${level} badge must stay inside its own outer ellipse`).toBeLessThanOrEqual(1.001);
        if (!index) return;
        const inner = rings.get(levels[index - 1]);
        const nearestX = inner.x < rect.left ? rect.left - inner.x : inner.x > rect.right ? inner.x - rect.right : 0;
        const nearestY = inner.y < rect.top ? rect.top - inner.y : inner.y > rect.bottom ? inner.y - rect.bottom : 0;
        const innerMetric = (nearestX / inner.rx) ** 2 + (nearestY / inner.ry) ** 2;
        expect(innerMetric, `${level} badge must stay outside the preceding ring`).toBeGreaterThanOrEqual(.999);
        expect(ring.rx).toBeGreaterThan(inner.rx);
        expect(ring.ry).toBeGreaterThan(inner.ry);
      });
    };

    const before = readGeometry();
    expectOrderedMembership(before);
    expect(levels.map((level) => before.labels.get(level).y)).toEqual(
      [...levels.map((level) => before.labels.get(level).y)].sort((left, right) => left - right),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    const after = readGeometry();
    expect(Number(mapCanvas().getAttribute('data-ring-expansion'))).toBeGreaterThan(1);
    levels.forEach((level) => {
      expect(after.rings.get(level).rx).toBeGreaterThan(before.rings.get(level).rx);
      expect(after.rings.get(level).ry).toBeGreaterThan(before.rings.get(level).ry);
    });
    expectOrderedMembership(after);
  });

  it('expands compact ecological rings when the map crosses from phone to desktop space without rewriting the graph', async () => {
    const resizeTo = installResponsiveLayout();
    const project = makePhoneEcologyOverviewProject();
    await openMapProject(project);
    fireEvent.change(screen.getByRole('combobox', { name: 'Show map layer' }), { target: { value: 'all' } });
    const durableGraph = structuredClone(storedProject().graph);

    resizeTo(390);
    await waitFor(() => expect(Number(document.querySelector('.ecology-layer--macrosphere ellipse').getAttribute('rx'))).toBe(630));
    resizeTo(1024);
    await waitFor(() => expect(Number(document.querySelector('.ecology-layer--macrosphere ellipse').getAttribute('rx'))).toBe(1540));

    expect(storedProject().graph).toEqual(durableGraph);
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
      expectVisibleNodesAndConnectionLabelsInsideCanvas();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fit map' }));
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
        expect(renderedNodePosition(project.graph.nodes[0].id)).not.toEqual(desktopPositions.get(project.graph.nodes[0].id));
        expectVisibleNodesAndConnectionLabelsInsideCanvas();
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

    await waitFor(() => expectVisibleNodesAndConnectionLabelsInsideCanvas());
    fireEvent.click(screen.getByRole('button', { name: 'Fit map' }));
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
      expect(svgTextLines(group.querySelector('.node-label')).join(' ')).toBe(group.getAttribute('data-full-label'));
      expect(group).not.toHaveTextContent('…');
    });
    expect(storedProject().graph.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(durablePositions);
    expect(storedProject().viewport).toEqual(durableViewport);
  });

  it('uses transient phone-only geometry across breakpoint changes and restores the exact saved desktop map', async () => {
    const resizeTo = installResponsiveLayout();
    const project = makeSixNodeMicroProject();
    const durablePositions = project.graph.nodes.map(({ id, x, y }) => ({ id, x, y }));
    const durableViewport = { ...project.viewport };
    await openMapProject(project);

    durablePositions.forEach(({ id, x, y }) => expect(renderedNodePosition(id)).toEqual({ x, y }));
    await waitFor(() => expectVisibleNodesAndConnectionLabelsInsideCanvas());
    expect(storedProject().viewport).toEqual(durableViewport);

    resizeTo(390);
    await waitFor(() => expectVisibleNodesAndConnectionLabelsInsideCanvas());
    expect(project.graph.nodes.some((node) => renderedNodePosition(node.id).x !== node.x)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Fit map' }));
    resizeTo(1024);
    await waitFor(() => expect(viewportTransform()).toEqual(durableViewport));
    durablePositions.forEach(({ id, x, y }) => expect(renderedNodePosition(id)).toEqual({ x, y }));
    expect(storedProject().graph.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(durablePositions);
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

  it('refits a desktop-focused relationship when crossing into phone detail and restores the durable desktop map', async () => {
    const resizeTo = installResponsiveLayout();
    const project = makeMapProject('exosphere');
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
      expectVisibleNodesAndConnectionLabelsInsideCanvas();
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
      expectVisibleNodesAndConnectionLabelsInsideCanvas();
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

    fireEvent.click(screen.getByRole('button', { name: 'Fit map' }));
    assertDetailInsideCanvas();
    expect(storedProject().graph).toEqual(durableGraph);
    expect(storedProject().viewport).toEqual(durableViewport);

    fireEvent.click(screen.getByRole('button', { name: 'Show full map' }));
    await waitFor(() => {
      expect(mapCanvas()).not.toHaveClass('is-detail-view');
      expectVisibleNodesAndConnectionLabelsInsideCanvas();
    });
    durableGraph.nodes.forEach(({ id, x, y }) => expect(renderedNodePosition(id)).toEqual({ x, y }));
    expect(document.querySelector('.ecology-layers')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Arrange map' })).toBeVisible();
    expect(storedProject().graph).toEqual(durableGraph);
    expect(storedProject().viewport).toEqual(durableViewport);
  });

  it.each([
    ['micro', 'determines daytime course availability for'],
  ])('keeps the complete %s relationship label clear of both endpoint cards in desktop detail', async (activeScale, verb) => {
    const project = makeMapProject('exosphere');
    project.activeScale = activeScale;
    const edge = project.graph.edges.find((candidate) => candidate.scale === activeScale);
    const activeGraph = graphForScale(project);
    edge.verb = verb;
    const graphBefore = structuredClone(project.graph);
    await openMapProject(project);
    fireEvent.change(screen.getByRole('combobox', { name: 'Show map layer' }), { target: { value: activeScale } });

    const overviewLabel = document.querySelector(`.graph-edge-label[data-edge-id="${edge.id}"]`);
    const expectClearOverviewLabel = (label) => {
      const labelBounds = svgRectBounds(label.querySelector('.edge-label-bg'));
      const visibleBounds = transformedRectBounds(labelBounds);
      expect(['direct', 'between-endpoints']).toContain(label.getAttribute('data-edge-route'));
      expect(svgTextLines(label.querySelector('.edge-label')).join(' ')).toBe(verb);
      expect(label).not.toHaveTextContent('…');
      const source = renderedNodePosition(edge.source);
      const target = renderedNodePosition(edge.target);
      const anchor = { x: Number(label.getAttribute('data-anchor-x')), y: Number(label.getAttribute('data-anchor-y')) };
      const delta = { x: target.x - source.x, y: target.y - source.y };
      const projection = ((anchor.x - source.x) * delta.x + (anchor.y - source.y) * delta.y) / (delta.x ** 2 + delta.y ** 2);
      expect(projection).toBeGreaterThan(0);
      expect(projection).toBeLessThan(1);
      [...document.querySelectorAll('.graph-node')].forEach((node) => {
        expect(rectsIntersect(labelBounds, translatedRectBounds(node, node.querySelector('.node-card')))).toBe(false);
      });
      expect(visibleBounds.left).toBeGreaterThanOrEqual(0);
      expect(visibleBounds.right).toBeLessThanOrEqual(840);
      expect(visibleBounds.top).toBeGreaterThanOrEqual(0);
      expect(visibleBounds.bottom).toBeLessThanOrEqual(540);
      const path = document.querySelector(`.graph-edge[data-graph-id="${edge.id}"] .edge-line`).getAttribute('d');
      if (label.getAttribute('data-edge-route') === 'between-endpoints') {
        expect(path).toContain(`L ${label.getAttribute('data-anchor-x')} ${label.getAttribute('data-anchor-y')} L`);
      } else {
        expect(path).toMatch(/^M -?[\d.]+ -?[\d.]+ L -?[\d.]+ -?[\d.]+$/);
      }
    };
    expectClearOverviewLabel(overviewLabel);
    expect(svgTextLines(overviewLabel.querySelector('.edge-label')).join(' ')).toBe(verb);

    const renderedEdge = document.querySelector(`.graph-edge[data-graph-id="${edge.id}"]`);
    renderedEdge.focus();
    fireEvent.keyDown(renderedEdge, { key: 'Enter' });
    const inspector = screen.getByLabelText('Map inspector');
    fireEvent.click(within(inspector).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(mapCanvas()).toHaveClass('is-detail-view'));

    const detailLabel = document.querySelector(`.graph-edge-label[data-edge-id="${edge.id}"]`);
    const labelBounds = {
      left: Number(detailLabel.querySelector('.edge-label-bg').getAttribute('x')),
      top: Number(detailLabel.querySelector('.edge-label-bg').getAttribute('y')),
      right: Number(detailLabel.querySelector('.edge-label-bg').getAttribute('x')) + Number(detailLabel.querySelector('.edge-label-bg').getAttribute('width')),
      bottom: Number(detailLabel.querySelector('.edge-label-bg').getAttribute('y')) + Number(detailLabel.querySelector('.edge-label-bg').getAttribute('height')),
    };
    const endpointBounds = [edge.source, edge.target].map((nodeId) => {
      const group = document.querySelector(`.graph-node[data-graph-id="${nodeId}"]`);
      return translatedRectBounds(group, group.querySelector('.node-card'));
    });

    expect(detailLabel).toHaveAttribute('data-edge-route', 'between-endpoints');
    expect(svgTextLines(detailLabel.querySelector('.edge-label')).join(' ')).toBe(verb);
    expect(detailLabel).not.toHaveTextContent('…');
    expect([...document.querySelectorAll('.graph-node')].map((node) => node.getAttribute('data-graph-id')).sort())
      .toEqual([edge.source, edge.target].sort());
    endpointBounds.forEach((nodeBounds) => expect(rectsIntersect(labelBounds, nodeBounds)).toBe(false));
    const view = viewportTransform();
    expect(labelBounds.left * view.zoom + view.panX).toBeGreaterThanOrEqual(0);
    expect(labelBounds.right * view.zoom + view.panX).toBeLessThanOrEqual(840);
    expect(labelBounds.top * view.zoom + view.panY).toBeGreaterThanOrEqual(0);
    expect(labelBounds.bottom * view.zoom + view.panY).toBeLessThanOrEqual(540);
    const detailPath = document.querySelector(`.graph-edge[data-graph-id="${edge.id}"] .edge-line`).getAttribute('d');
    expect(detailPath).toContain(`L ${detailLabel.getAttribute('data-anchor-x')} ${detailLabel.getAttribute('data-anchor-y')} L`);
    const [pathStart, pathAnchor, pathEnd] = focusedRoutePoints(detailPath);
    expect(segmentCrossesRectInterior(pathStart, pathAnchor, endpointBounds[1])).toBe(false);
    expect(segmentCrossesRectInterior(pathAnchor, pathEnd, endpointBounds[0])).toBe(false);
    expect(storedProject().graph).toEqual(graphBefore);

    fireEvent.click(screen.getByRole('button', { name: 'Show full map' }));
    await waitFor(() => expect(mapCanvas()).not.toHaveClass('is-detail-view'));
    const restoredLabel = document.querySelector(`.graph-edge-label[data-edge-id="${edge.id}"]`);
    expectClearOverviewLabel(restoredLabel);
    expect(document.querySelectorAll('.graph-node')).toHaveLength(activeGraph.nodes.length);
    expect(document.querySelectorAll('.graph-edge')).toHaveLength(activeGraph.edges.length);
    expect(storedProject().graph).toEqual(graphBefore);
  });

  it('clamps a drag before the endpoint corridor becomes too narrow and keeps the complete relationship label between cards', async () => {
    const project = makeMapProject('micro');
    const source = structuredClone(project.graph.nodes.find((node) => node.label === 'Family'));
    const target = structuredClone(project.graph.nodes.find((node) => node.label === 'School'));
    const edge = structuredClone(project.graph.edges.find((candidate) => candidate.source === source.id && candidate.target === target.id));
    source.x = 200;
    source.y = 270;
    target.x = 720;
    target.y = 270;
    edge.verb = 'determines daytime course availability for';
    project.graph = { nodes: [source, target], edges: [edge] };
    project.candidates = { nodes: [], edges: [] };
    const sourceBefore = { x: source.x, y: source.y };
    await openMapProject(project);

    const labelForEdge = () => document.querySelector(`.graph-edge-label[data-edge-id="${edge.id}"]`);
    expect(labelForEdge()).toHaveAttribute('data-edge-route', 'between-endpoints');
    const canvas = mapCanvas();
    const targetElement = document.querySelector(`.graph-node[data-graph-id="${target.id}"]`);
    canvas.getScreenCTM = () => ({ inverse: () => ({}) });
    canvas.createSVGPoint = () => ({
      x: 0,
      y: 0,
      matrixTransform() { return { x: this.x, y: this.y }; },
    });

    fireEvent.pointerDown(targetElement, { pointerId: 81, button: 0, clientX: target.x, clientY: target.y });
    fireEvent.pointerMove(canvas, { pointerId: 81, clientX: 470, clientY: target.y });
    fireEvent.pointerUp(canvas, { pointerId: 81, clientX: 470, clientY: target.y });

    await waitFor(() => expect(renderedNodePosition(target.id).x).not.toBe(target.x));
    const clampedTarget = renderedNodePosition(target.id);
    expect(clampedTarget.x).toBeGreaterThan(470);
    expect(clampedTarget.x).toBeLessThan(target.x);
    expect(clampedTarget.y).toBe(target.y);
    const reroutedLabel = labelForEdge();
    const labelBounds = svgRectBounds(reroutedLabel.querySelector('.edge-label-bg'));
    expect(['between-endpoints', 'between-endpoints-tight']).toContain(reroutedLabel.getAttribute('data-edge-route'));
    expect(svgTextLines(reroutedLabel.querySelector('.edge-label')).join(' ')).toBe(edge.verb);
    expect(reroutedLabel).not.toHaveTextContent('…');
    [...document.querySelectorAll('.graph-node')].forEach((node) => {
      expect(rectsIntersect(labelBounds, translatedRectBounds(node, node.querySelector('.node-card')))).toBe(false);
    });
    const anchor = { x: reroutedLabel.getAttribute('data-anchor-x'), y: reroutedLabel.getAttribute('data-anchor-y') };
    expect(document.querySelector(`.graph-edge[data-graph-id="${edge.id}"] .edge-line`).getAttribute('d'))
      .toContain(`L ${anchor.x} ${anchor.y} L`);
    await waitFor(() => {
      expect(storedProject().graph.nodes.find((node) => node.id === source.id)).toMatchObject(sourceBefore);
      expect(storedProject().graph.nodes.find((node) => node.id === target.id)).toMatchObject(clampedTarget);
    });
  });

  it('fits a maximum-length relationship label inside desktop detail without covering either endpoint', async () => {
    const project = makeMapProject('exosphere');
    project.activeScale = 'micro';
    const edge = project.graph.edges.find((candidate) => candidate.scale === 'micro');
    const maximumLengthVerb = 'R'.repeat(100);
    edge.verb = maximumLengthVerb;
    const graphBefore = structuredClone(project.graph);
    await openMapProject(project);

    const renderedEdge = document.querySelector(`.graph-edge[data-graph-id="${edge.id}"]`);
    renderedEdge.focus();
    fireEvent.keyDown(renderedEdge, { key: 'Enter' });
    const inspector = screen.getByLabelText('Map inspector');
    fireEvent.click(within(inspector).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(mapCanvas()).toHaveClass('is-detail-view'));

    const assertMaximumLabelVisible = () => {
      const detailLabel = document.querySelector(`.graph-edge-label[data-edge-id="${edge.id}"]`);
      const labelBounds = svgRectBounds(detailLabel.querySelector('.edge-label-bg'));
      const visibleBounds = transformedRectBounds(labelBounds);
      expect(detailLabel).toHaveAttribute('data-edge-route', 'between-endpoints');
      expect(svgTextLines(detailLabel.querySelector('.edge-label')).join('')).toBe(maximumLengthVerb);
      expect(detailLabel.getAttribute('data-full-label')).toBe(maximumLengthVerb);
      expect(detailLabel).not.toHaveTextContent('…');
      expect(visibleBounds.left).toBeGreaterThanOrEqual(0);
      expect(visibleBounds.right).toBeLessThanOrEqual(840);
      expect(visibleBounds.top).toBeGreaterThanOrEqual(0);
      expect(visibleBounds.bottom).toBeLessThanOrEqual(540);
      [edge.source, edge.target].forEach((nodeId) => {
        const group = document.querySelector(`.graph-node[data-graph-id="${nodeId}"]`);
        expect(rectsIntersect(labelBounds, translatedRectBounds(group, group.querySelector('.node-card')))).toBe(false);
      });
    };
    await waitFor(assertMaximumLabelVisible);
    fireEvent.click(screen.getByRole('button', { name: 'Fit map' }));
    await waitFor(assertMaximumLabelVisible);
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
    for (let step = 0; step < 30 && !zoomOut.disabled; step += 1) fireEvent.click(zoomOut);
    expect(viewportTransform().zoom).toBe(PROJECT_LIMITS.zoomMin);
    expect(zoomOut).toBeDisabled();
    assertMaximumLabelVisible();
    expect(storedProject().graph).toEqual(graphBefore);
  });

  it('pages through every relationship in a dense desktop node focus without shrinking or obscuring the map', async () => {
    const project = makeDenseFocusedMesoProject();
    const graphBefore = structuredClone(project.graph);
    await openMapProject(project);

    const inspector = openNodeInspector('node-dense-focus');
    fireEvent.click(within(inspector).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(mapCanvas()).toHaveClass('is-detail-view'));

    const visitedEdgeIds = new Set();
    for (let page = 0; page < project.graph.edges.length; page += 1) {
      await waitFor(() => expect(document.querySelector('.map-focus-bar')).toHaveTextContent(`Relationship ${page + 1} of ${project.graph.edges.length}`));
      const labels = [...document.querySelectorAll('.graph-edge-label')];
      expect(labels).toHaveLength(1);
      const label = labels[0];
      const edgeId = label.getAttribute('data-edge-id');
      const edge = project.graph.edges.find((candidate) => candidate.id === edgeId);
      visitedEdgeIds.add(edgeId);
      expect(edge).toBeDefined();
      expect([...document.querySelectorAll('.graph-node')].map((node) => node.getAttribute('data-graph-id')).sort())
        .toEqual([edge.source, edge.target].sort());
      const bounds = svgRectBounds(label.querySelector('.edge-label-bg'));
      const visibleBounds = transformedRectBounds(bounds);
      expect(label).toHaveAttribute('data-edge-route', 'between-endpoints');
      expect(svgTextLines(label.querySelector('.edge-label')).join(' ')).toBe(edge.verb);
      expect(label).not.toHaveTextContent('…');
      [...document.querySelectorAll('.graph-node')].forEach((node) => {
        expect(rectsIntersect(bounds, translatedRectBounds(node, node.querySelector('.node-card')))).toBe(false);
      });
      expect(visibleBounds.left).toBeGreaterThanOrEqual(0);
      expect(visibleBounds.right).toBeLessThanOrEqual(840);
      expect(visibleBounds.top).toBeGreaterThanOrEqual(0);
      expect(visibleBounds.bottom).toBeLessThanOrEqual(540);
      const path = document.querySelector(`.graph-edge[data-graph-id="${edgeId}"] .edge-line`).getAttribute('d');
      expect(path).toContain(`L ${label.getAttribute('data-anchor-x')} ${label.getAttribute('data-anchor-y')} L`);
      const nodeBounds = new Map([...document.querySelectorAll('.graph-node')].map((node) => [
        node.getAttribute('data-graph-id'),
        translatedRectBounds(node, node.querySelector('.node-card')),
      ]));
      const [pathStart, pathAnchor, pathEnd] = focusedRoutePoints(path);
      expect(segmentCrossesRectInterior(pathStart, pathAnchor, nodeBounds.get(edge.target))).toBe(false);
      expect(segmentCrossesRectInterior(pathAnchor, pathEnd, nodeBounds.get(edge.source))).toBe(false);
      const next = screen.getByRole('button', { name: 'Next relationship' });
      if (page < project.graph.edges.length - 1) {
        expect(next).toBeEnabled();
        fireEvent.click(next);
      } else {
        expect(next).toBeDisabled();
      }
    }
    expect([...visitedEdgeIds].sort()).toEqual(project.graph.edges.map((edge) => edge.id).sort());
    fireEvent.click(screen.getByRole('button', { name: 'Previous relationship' }));
    await waitFor(() => expect(document.querySelector('.map-focus-bar')).toHaveTextContent(`Relationship ${project.graph.edges.length - 1} of ${project.graph.edges.length}`));

    fireEvent.click(screen.getByRole('button', { name: 'Show full map' }));
    await waitFor(() => expect(mapCanvas()).not.toHaveClass('is-detail-view'));
    expect(document.querySelector('.map-focus-bar')).toBeNull();
    expect(document.querySelectorAll('.graph-node')).toHaveLength(project.graph.nodes.length);
    expect(document.querySelectorAll('.graph-edge')).toHaveLength(project.graph.edges.length);
    expect(storedProject().graph).toEqual(graphBefore);
  });

  it('refits a focused node after an incident relationship is added but preserves its viewport for annotation-only updates', async () => {
    const project = makeDenseFocusedMesoProject(2);
    const secondNeighbor = project.graph.nodes.find((node) => node.id === 'node-dense-neighbor-2');
    project.graph.edges = project.graph.edges.slice(0, 1);
    await openMapProject(project);

    let inspector = openNodeInspector('node-dense-focus');
    fireEvent.click(within(inspector).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(mapCanvas()).toHaveClass('is-detail-view'));
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
    for (let step = 0; step < 30 && !zoomOut.disabled; step += 1) fireEvent.click(zoomOut);
    expect(viewportTransform().zoom).toBe(PROJECT_LIMITS.zoomMin);
    const manuallyAdjustedViewport = viewportTransform();

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    inspector = screen.getByLabelText('Map inspector');
    fireEvent.click(within(inspector).getByRole('button', { name: 'Add' }));
    const addActions = document.getElementById('inspector-add-actions');
    fireEvent.click(within(addActions).getByRole('button', { name: 'Relationship' }));
    const addForm = screen.getByRole('heading', { name: 'New relationship' }).parentElement;
    fireEvent.change(within(addForm).getByLabelText('From'), { target: { value: 'node-dense-focus' } });
    fireEvent.change(within(addForm).getByLabelText('Relationship'), { target: { value: 'coordinates new support with' } });
    fireEvent.change(within(addForm).getByLabelText('To'), { target: { value: secondNeighbor.id } });
    fireEvent.change(within(addForm).getByLabelText('Evidence or question'), { target: { value: 'The memo documents this additional coordination.' } });
    fireEvent.click(within(addForm).getByRole('button', { name: 'Add relationship' }));

    await waitFor(() => expect(storedProject().graph.edges).toHaveLength(2));
    await waitFor(() => expect(document.querySelector('.map-focus-bar')).toHaveTextContent('Relationship 1 of 2'));
    await waitFor(() => expect(viewportTransform()).not.toEqual(manuallyAdjustedViewport));
    expectVisibleNodesAndConnectionLabelsInsideCanvas();
    const refittedViewport = viewportTransform();

    const relationshipPanel = within(inspector).getByRole('tabpanel', { name: 'Relationships' });
    const annotation = within(relationshipPanel).getByRole('textbox', { name: 'Annotation' });
    fireEvent.change(annotation, { target: { value: 'Annotation-only edits must not recenter the focused relationship.' } });
    expect(annotationStatus(annotation)).toHaveTextContent('Saving…');
    await waitFor(() => expect(annotationStatus(annotation)).toBeNull());
    expect(viewportTransform()).toEqual(refittedViewport);

    const addedEdge = storedProject().graph.edges.at(-1);
    fireEvent.click(screen.getByRole('button', { name: 'Next relationship' }));
    await waitFor(() => expect(document.querySelector('.map-focus-bar')).toHaveTextContent('Relationship 2 of 2'));
    expect(document.querySelector('.graph-edge')).toHaveAttribute('data-graph-id', addedEdge.id);
    expect([...document.querySelectorAll('.graph-node')].map((node) => node.getAttribute('data-graph-id')).sort())
      .toEqual([addedEdge.source, addedEdge.target].sort());
    expectVisibleNodesAndConnectionLabelsInsideCanvas();
  });

  it('opens a relationship with Enter and keeps its complete phone detail in view after Done', async () => {
    installPhoneLayout();
    await openMapProject(makeMapProject('exosphere'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Show map layer' }), { target: { value: 'exosphere' } });
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
    const visible = { left: 0, right: 840, top: -430, bottom: 970 };
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
    expectVisibleNodesAndConnectionLabelsInsideCanvas();
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
    openProjectFromList('NYC systems and assets map');
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: 'Show map layer' }), { target: { value: 'all' } });

    savedPositions.forEach(({ id, x, y }) => {
      expect(document.querySelector(`[data-graph-id="${id}"]`)).toHaveAttribute('transform', `translate(${x} ${y})`);
    });
    expect(storedProject().graph.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(savedPositions);
  });

  it('focuses a node on its one-hop neighborhood and restores the active-scale view without changing graph data', async () => {
    const project = await openMapProject();
    const active = graphForScale(project, 'all');
    const focusNode = active.nodes.find((node) => active.edges.some((edge) => edge.source === node.id || edge.target === node.id));
    const incident = active.edges.filter((edge) => edge.source === focusNode.id || edge.target === focusNode.id);
    const graphBefore = structuredClone(storedProject().graph);

    const inspector = openNodeInspector(focusNode.id);
    const focusBar = document.querySelector('.map-focus-bar');
    expect(focusBar).toHaveTextContent(`Showing connections for ${focusNode.label}.`);
    expect(focusBar).toHaveTextContent(`Relationship 1 of ${incident.length}`);
    expect(inspector).not.toHaveAttribute('aria-hidden');
    expect(document.querySelector('.map-layout')).toHaveClass('has-inspector');
    expect([...document.querySelectorAll('.graph-node')].map((node) => node.getAttribute('data-graph-id')).sort()).toEqual([incident[0].source, incident[0].target].sort());
    expect([...document.querySelectorAll('.graph-edge')].map((edge) => edge.getAttribute('data-graph-id'))).toEqual([incident[0].id]);
    expect(document.querySelectorAll('.graph-edge-label')).toHaveLength(1);
    const focusedNodeBounds = [...document.querySelectorAll('.graph-node')].map((group) => translatedRectBounds(group, group.querySelector('.node-card')));
    const focusedLabelBounds = [...document.querySelectorAll('.graph-edge-label')].map((label) => {
      const background = label.querySelector('.edge-label-bg');
      const bounds = {
        left: Number(background.getAttribute('x')),
        top: Number(background.getAttribute('y')),
        right: Number(background.getAttribute('x')) + Number(background.getAttribute('width')),
        bottom: Number(background.getAttribute('y')) + Number(background.getAttribute('height')),
      };
      expect(label).toHaveAttribute('data-edge-route', 'between-endpoints');
      expect(svgTextLines(label.querySelector('.edge-label')).join(' ')).toBe(label.getAttribute('data-full-label'));
      expect(label).not.toHaveTextContent('…');
      focusedNodeBounds.forEach((nodeBounds) => expect(rectsIntersect(bounds, nodeBounds)).toBe(false));
      return bounds;
    });
    expect(focusedLabelBounds).toHaveLength(1);
    expectVisibleNodesAndConnectionLabelsInsideCanvas();
    if (incident.length > 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next relationship' }));
      await waitFor(() => expect(focusBar).toHaveTextContent(`Relationship 2 of ${incident.length}`));
      expect([...document.querySelectorAll('.graph-edge')].map((edge) => edge.getAttribute('data-graph-id'))).toEqual([incident[1].id]);
      expect([...document.querySelectorAll('.graph-node')].map((node) => node.getAttribute('data-graph-id')).sort()).toEqual([incident[1].source, incident[1].target].sort());
    }
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
    const project = makeMapProject('exosphere');
    project.activeScale = 'micro';
    const active = graphForScale(project);
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
    expect(edgeText).toHaveStyle({ fontSize: phone ? '26px' : '18px' });
    expect(svgTextLines(edgeText).join(' ')).toBe(longEdgeLabel);
    expect(renderedEdge).not.toHaveTextContent('…');
    expect(Number(edgeBackground.getAttribute('height'))).toBeGreaterThan(phone ? 44 : 24);
    const summary = [...inspector.querySelectorAll('.node-summary')]
      .find((details) => details.querySelector('summary')?.textContent.includes(longEdgeLabel));
    expect(summary.querySelector('summary strong')).toHaveTextContent(longEdgeLabel);
  });

  it('preserves every character in maximum-length unbroken map labels', async () => {
    const project = makeMapProject('exosphere');
    project.activeScale = 'micro';
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

    await waitFor(() => expect(storedProject().events.at(-1)).toMatchObject({ action: 'map.arranged', detail: 'All layers arranged' }));
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
    fireEvent.pointerUp(removedElement, { pointerId: 1, button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Return to map' }));
    await waitFor(() => expect(storedProject().graph.edges.find((edge) => edge.id === removedEdge.id)).toMatchObject({ status: 'confirmed', claimState: 'student interpretation' }));
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
    const edgeTemplate = project.graph.edges.find((edge) => edge.scale === 'micro');
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
    expect(screen.getByRole('heading', { name: 'Review memo' })).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'Model setup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Custom project instructions/ })).not.toBeInTheDocument();
    expect(within(document.querySelector('.app-footer')).getByRole('button', { name: 'Continue without model' })).toBeEnabled();
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
    openProjectFromList(project.title);
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    const field = selectAnnotationTarget(target);
    fireEvent.change(field, { target: { value: `${target} unsaved annotation` } });
    expect(annotationStatus(field)).toHaveTextContent(/Saving…|The project opened, but browser storage could not update its saved record\./);
    await waitFor(() => expect(annotationStatus(field)).toHaveTextContent('The project opened, but browser storage could not update its saved record.'));
    expect(annotationStatus(field)).not.toHaveTextContent('Quota exceeded');
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)).id).toBe(project.id);
  });

  it('retries persistence after a temporarily erased required field is corrected', async () => {
    const { project, candidate } = makeCandidateValidationProject();
    await resumeSavedProject(project);
    const priorLabel = candidate.label;
    const label = screen.getByRole('textbox', { name: 'Node label' });
    expect(label).toHaveValue(priorLabel);
    fireEvent.change(label, { target: { value: '' } });
    const saveAttention = await screen.findByRole('button', { name: 'Save needs attention' });
    expect(storedProject().candidates.nodes.find((node) => node.id === candidate.id).label).toBe(priorLabel);
    fireEvent.click(saveAttention);
    const dialog = screen.getByRole('dialog', { name: 'Save needs attention' });
    expect(within(dialog).getByText(/Review the item you were editing\. Complete its required name or connection/)).toBeVisible();
    expect(within(dialog).getByText('Technical details')).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Return to project' }));

    fireEvent.change(label, { target: { value: 'Corrected peer navigator' } });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save needs attention' })).not.toBeInTheDocument());
    await waitFor(() => expect(storedProject().candidates.nodes.find((node) => node.id === candidate.id).label).toBe('Corrected peer navigator'));
  });

  it('keeps raw project validation text behind technical details when link creation is blocked', async () => {
    const { project } = makeCandidateValidationProject();
    await resumeSavedProject(project);
    fireEvent.change(screen.getByRole('textbox', { name: 'Node label' }), { target: { value: '' } });
    await screen.findByRole('button', { name: 'Save needs attention' });

    fireEvent.click(screen.getByRole('button', { name: 'Project link' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Project link' })).getByRole('button', { name: 'Create project link' }));

    const dialog = screen.getByRole('dialog', { name: 'Save needs attention' });
    expect(within(dialog).getByText('The project link was not created because one map item needs attention.')).toBeVisible();
    const details = within(dialog).getByText('Technical details').closest('details');
    const diagnostic = within(details).getByText(/^Invalid Systems Mapping project:/);
    expect(details).not.toHaveAttribute('open');
    expect(diagnostic).not.toBeVisible();
    expect(document.querySelector('.toast')).not.toHaveTextContent('Invalid Systems Mapping project:');
    expect(fetchMock.mock.calls.some(([path, options]) => String(path) === '/api/projects' && options.method === 'POST')).toBe(false);
  });

  it('keeps raw project validation text behind technical details when export is blocked', async () => {
    const { project } = makeCandidateValidationProject();
    await resumeSavedProject(project);
    fireEvent.change(screen.getByRole('textbox', { name: 'Node label' }), { target: { value: '' } });
    await screen.findByRole('button', { name: 'Save needs attention' });

    fireEvent.click(screen.getByRole('button', { name: 'Progress: Micro-level, Choose' }));
    const stages = screen.getByRole('dialog', { name: 'Progress' });
    fireEvent.click(within(stages).getByRole('button', { name: /revise and export/i }));
    expect(await screen.findByRole('heading', { name: 'Review and export your map' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));

    const dialog = screen.getByRole('dialog', { name: 'Save needs attention' });
    expect(within(dialog).getByText('The export was not created because one map item needs attention.')).toBeVisible();
    const details = within(dialog).getByText('Technical details').closest('details');
    const diagnostic = within(details).getByText(/^Invalid Systems Mapping project:/);
    expect(details).not.toHaveAttribute('open');
    expect(diagnostic).not.toBeVisible();
    expect(document.querySelector('.toast')).not.toHaveTextContent('Invalid Systems Mapping project:');
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

    const mapControls = document.querySelector('.canvas-chrome');
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

    const expected = { x: position.x + Math.round(40 / zoom), y: position.y + Math.round(30 / zoom) };
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
      expect(within(screen.getByRole('article', { name: project.title })).getByText('Map')).toBeVisible();
      openProjectFromList(project.title);
      expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
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
      scale: 'micro',
      status: 'pending',
      claimState: 'inference',
      notes: '',
      directed: true,
      rationale: 'The memo records this relationship.',
      evidence: 'Memo sentence 1',
      annotation: { id: stableId('annotation', `edge:${edgeId}:relationship`), text: '' },
    }] };
    project.releasedScales = ['micro'];
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
      expect(markdown).toContain(`${nodes[0].label} **documents** ${nodes[1].label} — level: Micro-level; evidence: Memo sentence 1`);
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
    expect(await screen.findByRole('heading', { name: 'Choose items' })).toBeVisible();
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
    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    await waitFor(() => {
      const stored = storedProject();
      const structure = stored.graph.nodes.find((node) => node.label === 'Universal Pre-K Law');
      expect(structure).toMatchObject({ scale: 'macrosphere', deontic: 'prohibits', evidence: 'The memo identifies this policy condition.' });
      expect(structure.scopeNodeIds).toEqual([microNodes[0].id, microNodes[1].id]);
      expect(stored.graph.edges.filter((edge) => edge.scale === 'macrosphere')).toEqual([]);
    });
  });

  it('collects required evidence when a student adds a Macro-level condition', async () => {
    const project = makeMapProject('macrosphere');
    project.instructor.evidenceRequired = true;
    project.graph.nodes = project.graph.nodes.filter((node) => node.scale !== 'macrosphere');
    project.graph.edges = project.graph.edges.filter((edge) => edge.scale !== 'macrosphere');
    project.candidates = { nodes: [], edges: [] };
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);

    const section = screen.getByRole('heading', { name: 'New condition' }).closest('section');
    fireEvent.change(within(section).getByRole('textbox', { name: 'Name' }), { target: { value: 'High cost of accessible housing' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Add condition' }));
    expect(screen.getByText('Add evidence or a question for this Macro-level condition.')).toBeVisible();

    fireEvent.change(within(section).getByLabelText('Evidence'), { target: { value: 'The memo describes the household cost pressure.' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Add condition' }));
    await waitFor(() => expect(storedProject().candidates.nodes).toEqual([
      expect.objectContaining({
        label: 'High cost of accessible housing',
        scale: 'macrosphere',
        evidence: 'The memo describes the household cost pressure.',
      }),
    ]));
  });

  it('rejects immediate actors and schedules from the Macrosphere form while allowing a broader schedule condition', async () => {
    const project = makeMapProject('macrosphere');
    project.graph.nodes = project.graph.nodes.filter((node) => node.scale !== 'macrosphere');
    project.graph.edges = project.graph.edges.filter((edge) => edge.scale !== 'macrosphere');
    project.candidates = { nodes: [], edges: [] };
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);

    const section = screen.getByRole('heading', { name: 'New condition' }).closest('section');
    const labelInput = within(section).getByRole('textbox', { name: 'Name' });
    const addButton = within(section).getByRole('button', { name: 'Add condition' });
    for (const label of ['Home attendant', 'Center Aide', 'Tuesday peer support group']) {
      fireEvent.change(labelInput, { target: { value: label } });
      fireEvent.click(addButton);
      expect(screen.getByText('That label names an immediate person, role, activity, or schedule. Add it at Micro instead.')).toBeVisible();
      expect(storedProject().candidates.nodes).toEqual([]);
    }

    fireEvent.change(labelInput, { target: { value: 'Unpredictable work schedules' } });
    fireEvent.change(within(section).getByLabelText('Evidence'), { target: { value: 'The memo describes work schedules that change without notice.' } });
    fireEvent.click(addButton);
    await waitFor(() => expect(storedProject().candidates.nodes).toEqual([
      expect.objectContaining({
        label: 'Unpredictable work schedules',
        type: 'policy',
        scale: 'macrosphere',
        status: 'pending',
        claimState: 'inference',
      }),
    ]));
  });

  it('renders a structure’s scope as a field over the mapped elements it conditions', async () => {
    const project = makeMapProject('macrosphere');
    const structure = project.graph.nodes.find((node) => node.scale === 'macrosphere');
    const microNodes = project.graph.nodes.filter((node) => node.scale === 'micro');
    project.graph.edges = project.graph.edges.filter((edge) => edge.scale !== 'macrosphere');
    structure.deontic = 'frames';
    structure.scopeNodeIds = [microNodes[0].id, microNodes[1].id];
    await resumeSavedProject(project);
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    const field = document.querySelector('.scope-field');
    expect(field).toBeTruthy();
    expect(field.getAttribute('d')).toMatch(/^M /);
    expect(screen.getByRole('button', { name: new RegExp(`${structure.label}.*frames 2 map items`) })).toBeInTheDocument();
  });

  it('offers decision-setting categories at Exo-level and records a student-named setting with its connection', async () => {
    const project = makeMapProject('exosphere');
    const microNode = project.graph.nodes.find((node) => node.scale === 'micro');
    project.graph.nodes = project.graph.nodes.filter((node) => node.scale !== 'exosphere');
    project.graph.edges = project.graph.edges.filter((edge) => edge.scale !== 'exosphere');
    project.candidates = { nodes: [], edges: [] };
    project.stage = 2;
    project.furthestStage = 2;
    await resumeSavedProject(project);
    expect(await screen.findByRole('heading', { name: 'Choose items' })).toBeVisible();
    const panel = screen.getByRole('region', { name: 'New decision setting' });
    fireEvent.change(within(panel).getByLabelText('Type'), { target: { value: 'agency' } });
    fireEvent.change(within(panel).getByLabelText('Name'), { target: { value: 'Transportation access' } });
    fireEvent.change(within(panel).getByLabelText('Micro setting affected by decision setting'), { target: { value: microNode.id } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Add setting' }));
    expect(screen.getByText('Use the full name of an outside office, agency, employer, funder, or service system.')).toBeVisible();
    expect(storedProject().candidates.nodes).toEqual([]);

    fireEvent.change(within(panel).getByLabelText('Name'), { target: { value: 'East Harlem Disability Services Office' } });
    fireEvent.change(within(panel).getByLabelText('How decision reaches Micro setting'), { target: { value: 'sets rules for' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Add setting' }));
    await waitFor(() => {
      const stored = storedProject();
      const institution = stored.candidates.nodes.find((node) => node.label === 'East Harlem Disability Services Office');
      expect(institution).toMatchObject({ scale: 'exosphere', type: 'agency', status: 'confirmed' });
      expect(stored.candidates.edges).toEqual([expect.objectContaining({
        sourceLabel: 'East Harlem Disability Services Office',
        target: microNode.id,
        verb: 'sets rules for',
        scale: 'exosphere',
      })]);
    });
  });

  it.each([
    ['Exo-level decision setting', 'exosphere'],
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
    fireEvent.click(screen.getByRole('tab', { name: 'Connections · 1' }));
    const row = screen.getByRole('combobox', { name: 'Outside decision setting' }).closest('article');
    expect(within(row).getByRole('option', { name: `Needs repair: ${invalidTarget.label}` })).toBeInTheDocument();
    expect(within(row).getByText(/This suggestion stays here until you repair or remove it/)).toBeVisible();
    expect(within(row).getByRole('button', { name: 'Add to map' })).toBeDisabled();

    fireEvent.change(within(row).getByRole('combobox', { name: 'Affected Micro setting' }), { target: { value: carriedMicroSetting.id } });
    await waitFor(() => expect(storedProject().candidates.edges[0]).toMatchObject({
      source: source.id,
      target: carriedMicroSetting.id,
      targetLabel: carriedMicroSetting.label,
      status: 'pending',
    }));
    expect(within(row).queryByText(/This suggestion stays here until you repair or remove it/)).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Add to map' }));
    await waitFor(() => expect(storedProject().candidates.edges[0]).toMatchObject({ status: 'confirmed', claimState: 'student interpretation' }));
  });

  it('keeps evidence records additive when one record is edited, another is removed, and the project is reopened', async () => {
    const project = makeMapProject('micro');
    const node = project.graph.nodes.find((item) => item.scale === 'micro');
    node.claimEvidence = [];
    await openMapProject(project);

    let inspector = openNodeInspector(node.id);
    let evidence = within(inspector).getByRole('region', { name: 'Evidence records' });
    fireEvent.click(within(evidence).getByRole('button', { name: 'Add record' }));
    fireEvent.click(within(evidence).getByRole('button', { name: 'Add record' }));
    let records = [...evidence.querySelectorAll('.claim-evidence-record')];
    expect(records).toHaveLength(2);

    fireEvent.change(within(records[0]).getByRole('textbox', { name: /^Memo passage or evidence/ }), { target: { value: 'The memo records a weekly meeting.' } });
    fireEvent.change(within(records[0]).getByRole('textbox', { name: /^Student interpretation/ }), { target: { value: 'The meeting is a recurring support.' } });
    fireEvent.change(within(records[1]).getByRole('textbox', { name: /^Memo passage or evidence/ }), { target: { value: 'A program calendar confirms the schedule.' } });
    fireEvent.change(within(records[1]).getByRole('textbox', { name: /^Uncertainty/ }), { target: { value: 'Attendance is not yet documented.' } });

    await waitFor(() => expect(storedProject().graph.nodes.find((item) => item.id === node.id).claimEvidence).toEqual([
      expect.objectContaining({
        sourcePassage: 'The memo records a weekly meeting.',
        studentInterpretation: 'The meeting is a recurring support.',
      }),
      expect.objectContaining({
        sourcePassage: 'A program calendar confirms the schedule.',
        uncertainty: 'Attendance is not yet documented.',
      }),
    ]));
    const retainedId = storedProject().graph.nodes.find((item) => item.id === node.id).claimEvidence[1].id;

    records = [...within(screen.getByLabelText('Map inspector')).getByRole('region', { name: 'Evidence records' }).querySelectorAll('.claim-evidence-record')];
    fireEvent.click(within(records[0]).getByRole('button', { name: 'Remove record' }));
    await waitFor(() => {
      const saved = storedProject().graph.nodes.find((item) => item.id === node.id).claimEvidence;
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        id: retainedId,
        sourcePassage: 'A program calendar confirms the schedule.',
        uncertainty: 'Attendance is not yet documented.',
      });
    });

    cleanup();
    render(<App />);
    await showResumeScreen();
    openProjectFromList(project.title);
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    inspector = openNodeInspector(node.id);
    evidence = within(inspector).getByRole('region', { name: 'Evidence records' });
    expect(evidence.querySelectorAll('.claim-evidence-record')).toHaveLength(1);
    expect(within(evidence).getByRole('textbox', { name: /^Memo passage or evidence/ })).toHaveValue('A program calendar confirms the schedule.');
    expect(within(evidence).getByRole('textbox', { name: /^Uncertainty/ })).toHaveValue('Attendance is not yet documented.');
  });

  it('rehashes edited linked evidence while preserving its source identity through save, reload, and export', async () => {
    const project = makeMapProject('micro');
    const node = project.graph.nodes.find((item) => item.scale === 'micro');
    const originalPassage = 'The memo records a weekly meeting.';
    const editedPassage = 'The memo records a meeting every Tuesday.';
    node.claimEvidence = [{
      id: 'claim_evidence_linked_passage',
      sourcePassage: originalPassage,
      studentInterpretation: 'This meeting is recurring support.',
      warrant: '',
      uncertainty: '',
      counterevidence: '',
      missingVoice: '',
      evidenceId: 'evidence_memo_weekly_meeting',
      sourceId: project.submission.id,
      evidenceLocator: 'Memo paragraph 2',
      evidenceHash: stableId('evh', originalPassage),
    }];
    await openMapProject(project);

    let inspector = openNodeInspector(node.id);
    fireEvent.change(within(inspector).getByRole('textbox', { name: /^Memo passage or evidence/ }), { target: { value: editedPassage } });

    await waitFor(() => {
      const saved = storedProject().graph.nodes.find((item) => item.id === node.id).claimEvidence[0];
      expect(saved).toMatchObject({
        sourcePassage: editedPassage,
        evidenceHash: stableId('evh', editedPassage),
        evidenceId: 'evidence_memo_weekly_meeting',
        sourceId: project.submission.id,
        evidenceLocator: 'Memo paragraph 2',
      });
      expect(() => validateProject(storedProject())).not.toThrow();
    });

    cleanup();
    render(<App />);
    await showResumeScreen();
    openProjectFromList(project.title);
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    inspector = openNodeInspector(node.id);
    expect(within(inspector).getByRole('textbox', { name: /^Memo passage or evidence/ })).toHaveValue(editedPassage);

    const reloaded = storedProject();
    const exported = createPortableProject(reloaded, 'private');
    const exportedEvidence = exported.graph.nodes.find((item) => item.id === node.id).claimEvidence[0];
    expect(exportedEvidence).toMatchObject({
      sourcePassage: editedPassage,
      evidenceHash: stableId('evh', editedPassage),
      evidenceId: 'evidence_memo_weekly_meeting',
      sourceId: project.submission.id,
      evidenceLocator: 'Memo paragraph 2',
    });
    expect(() => validateProject(exported)).not.toThrow();
  });

  it.each(['micro', 'exosphere'])('persists %s process-and-time details after reopening the project', async (scale) => {
    const project = makeMapProject(scale);
    const edge = project.graph.edges.find((item) => item.scale === scale);
    expect(edge).toBeTruthy();
    edge.relationshipProcess = { frequency: '', duration: '', direction: '', conditions: '', changeOverTime: '' };
    await openMapProject(project);
    fireEvent.change(screen.getByRole('combobox', { name: 'Show map layer' }), { target: { value: scale } });

    let inspector = openEdgeInspector(edge.id);
    let process = within(inspector).getByText('Process and time').closest('details');
    fireEvent.click(within(process).getByText('Process and time'));
    fireEvent.change(within(process).getByLabelText('Frequency'), { target: { value: 'Weekly' } });
    fireEvent.change(within(process).getByLabelText('Duration'), { target: { value: 'Six months' } });
    fireEvent.change(within(process).getByLabelText('Direction'), { target: { value: 'both directions' } });
    fireEvent.change(within(process).getByRole('textbox', { name: /^Conditions/ }), { target: { value: 'Both offices have current contact information.' } });
    fireEvent.change(within(process).getByRole('textbox', { name: /^Change over time/ }), { target: { value: 'Response time improved after the schedule changed.' } });

    const expected = {
      frequency: 'Weekly',
      duration: 'Six months',
      direction: 'both directions',
      conditions: 'Both offices have current contact information.',
      changeOverTime: 'Response time improved after the schedule changed.',
    };
    await waitFor(() => expect(storedProject().graph.edges.find((item) => item.id === edge.id).relationshipProcess).toEqual(expected));

    cleanup();
    render(<App />);
    await showResumeScreen();
    openProjectFromList(project.title);
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: 'Show map layer' }), { target: { value: scale } });
    inspector = openEdgeInspector(edge.id);
    process = within(inspector).getByText('Process and time').closest('details');
    fireEvent.click(within(process).getByText('Process and time'));
    expect(within(process).getByLabelText('Frequency')).toHaveValue(expected.frequency);
    expect(within(process).getByLabelText('Duration')).toHaveValue(expected.duration);
    expect(within(process).getByLabelText('Direction')).toHaveValue(expected.direction);
    expect(within(process).getByRole('textbox', { name: /^Conditions/ })).toHaveValue(expected.conditions);
    expect(within(process).getByRole('textbox', { name: /^Change over time/ })).toHaveValue(expected.changeOverTime);
  });

  it('keeps Micro evidence, process details, and participation edits after returning to review and reopening the map', async () => {
    const project = makeMapProject('micro');
    const node = project.graph.nodes.find((item) => item.scale === 'micro' && !MICRO_SETTING_NODE_TYPES.includes(item.type));
    const setting = project.graph.nodes.find((item) => item.scale === 'micro' && MICRO_SETTING_NODE_TYPES.includes(item.type));
    const edge = project.graph.edges.find((item) => item.scale === 'micro');
    expect(node).toBeTruthy();
    expect(setting).toBeTruthy();
    expect(edge).toBeTruthy();
    node.claimEvidence = [];
    node.focalParticipation = 'direct';
    node.settingNodeIds = [];
    edge.claimEvidence = [];
    edge.relationshipProcess = { frequency: '', duration: '', direction: '', conditions: '', changeOverTime: '' };
    project.candidates = {
      nodes: project.graph.nodes.filter((item) => item.scale === 'micro').map((item) => structuredClone(item)),
      edges: project.graph.edges.filter((item) => item.scale === 'micro').map((item) => structuredClone(item)),
    };
    await openMapProject(project);

    let inspector = openNodeInspector(node.id);
    fireEvent.change(within(inspector).getByRole('combobox', { name: `Relation to focal person for ${node.label}` }), { target: { value: 'indirect' } });
    fireEvent.change(within(inspector).getByRole('combobox', { name: `Add an immediate setting for ${node.label}` }), { target: { value: setting.id } });
    let evidence = within(inspector).getByRole('region', { name: 'Evidence records' });
    fireEvent.click(within(evidence).getByRole('button', { name: 'Add record' }));
    fireEvent.change(within(evidence).getByRole('textbox', { name: /^Memo passage or evidence/ }), { target: { value: 'The memo places this item in the school setting.' } });

    inspector = openEdgeInspector(edge.id);
    evidence = within(inspector).getByRole('region', { name: 'Evidence records' });
    fireEvent.click(within(evidence).getByRole('button', { name: 'Add record' }));
    fireEvent.change(within(evidence).getByRole('textbox', { name: /^Memo passage or evidence/ }), { target: { value: 'The memo describes this direct connection.' } });
    const process = within(inspector).getByText('Process and time').closest('details');
    fireEvent.click(within(process).getByText('Process and time'));
    fireEvent.change(within(process).getByLabelText('Frequency'), { target: { value: 'Every Tuesday' } });

    await waitFor(() => {
      const saved = storedProject();
      expect(saved.candidates.nodes.find((item) => item.id === node.id)).toMatchObject({
        focalParticipation: 'indirect',
        settingNodeIds: [setting.id],
        claimEvidence: [expect.objectContaining({ sourcePassage: 'The memo places this item in the school setting.' })],
      });
      expect(saved.candidates.edges.find((item) => item.id === edge.id)).toMatchObject({
        claimEvidence: [expect.objectContaining({ sourcePassage: 'The memo describes this direct connection.' })],
        relationshipProcess: expect.objectContaining({ frequency: 'Every Tuesday' }),
      });
    });

    fireEvent.click(within(document.querySelector('.app-footer')).getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'Choose items' })).toBeVisible();
    fireEvent.click(within(document.querySelector('.app-footer')).getByRole('button', { name: 'Open map' }));
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();

    await waitFor(() => {
      const saved = storedProject();
      expect(saved.graph.nodes.find((item) => item.id === node.id)).toMatchObject({
        focalParticipation: 'indirect',
        settingNodeIds: [setting.id],
        claimEvidence: [expect.objectContaining({ sourcePassage: 'The memo places this item in the school setting.' })],
      });
      expect(saved.graph.edges.find((item) => item.id === edge.id)).toMatchObject({
        claimEvidence: [expect.objectContaining({ sourcePassage: 'The memo describes this direct connection.' })],
        relationshipProcess: expect.objectContaining({ frequency: 'Every Tuesday' }),
      });
    });
  });

  it('keeps a Meso explanation after returning to review and reopening the map', async () => {
    const project = makeMapProject('meso');
    const node = project.graph.nodes.find((item) => item.scale === 'meso');
    expect(node).toBeTruthy();
    node.mesoExplanation = '';
    project.candidates = { nodes: [structuredClone(node)], edges: [] };
    await openMapProject(project);

    const inspector = openNodeInspector(node.id);
    const explanation = 'Appointment information moves between the family and school settings.';
    fireEvent.change(within(inspector).getByRole('textbox', { name: /^Interaction/ }), { target: { value: explanation } });
    await waitFor(() => expect(storedProject().candidates.nodes[0].mesoExplanation).toBe(explanation));

    fireEvent.click(within(document.querySelector('.app-footer')).getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'Choose items' })).toBeVisible();
    const reviewedNode = screen.getByDisplayValue(node.label).closest('article');
    expect(within(reviewedNode).getByRole('textbox', { name: /^Interaction/ })).toHaveValue(explanation);
    fireEvent.click(within(document.querySelector('.app-footer')).getByRole('button', { name: 'Open map' }));
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    await waitFor(() => expect(storedProject().graph.nodes.find((item) => item.id === node.id).mesoExplanation).toBe(explanation));
  });

  it('presents node suggestions in bounded groups of four without losing later suggestions', async () => {
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

    const candidateList = () => document.querySelector('.candidate-list');
    expect(within(candidateList()).getAllByRole('article')).toHaveLength(4);
    expect(screen.getByDisplayValue('Peer navigator 1')).toBeVisible();
    expect(screen.getByDisplayValue('Peer navigator 4')).toBeVisible();
    let pagination = screen.getByRole('navigation', { name: 'Suggestion groups' });
    expect(pagination).toHaveTextContent('Suggestions 1–4 of 9');

    fireEvent.click(within(pagination).getByRole('button', { name: 'Next' }));
    expect(within(candidateList()).getAllByRole('article')).toHaveLength(4);
    expect(screen.getByDisplayValue('Peer navigator 5')).toBeVisible();
    expect(screen.getByDisplayValue('Peer navigator 8')).toBeVisible();
    pagination = screen.getByRole('navigation', { name: 'Suggestion groups' });
    expect(pagination).toHaveTextContent('Suggestions 5–8 of 9');

    fireEvent.click(within(pagination).getByRole('button', { name: 'Next' }));
    expect(within(candidateList()).getAllByRole('article')).toHaveLength(1);
    expect(screen.getByDisplayValue('Peer navigator 9')).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Suggestion groups' })).toHaveTextContent('Suggestions 9–9 of 9');
    expect(storedProject().candidates.nodes).toHaveLength(9);
  });

  it('presents generated connection suggestions in bounded groups of four', async () => {
    const project = createDefaultProject();
    const nodes = extractCandidates(project.submission).nodes.slice(0, 3).map((node, index) => ({
      ...node,
      type: ['person', 'group', 'object'][index],
      scale: 'micro',
      status: 'confirmed',
      claimState: 'student interpretation',
      focalParticipation: 'direct',
      settingNodeIds: [],
    }));
    project.candidates = { nodes, edges: [] };
    project.graph = { nodes: [], edges: [] };
    project.stage = 2;
    project.furthestStage = 2;
    project.levelProgress.micro = { stage: 2, reflection: '' };
    connectionSuggestionResponder = (body) => jsonResponse({
      connections: Array.from({ length: 9 }, (_, index) => ({
        source: body.nodes[index % body.nodes.length].id,
        target: body.nodes[(index + 1) % body.nodes.length].id,
        verb: `supports pathway ${index + 1}`,
        rationale: `The memo supports pathway ${index + 1}.`,
      })),
    }, 201);
    await resumeSavedProject(project);

    fireEvent.click(screen.getByRole('tab', { name: 'More relationships' }));
    fireEvent.click(screen.getByRole('button', { name: 'Suggest connections' }));
    expect(await screen.findByDisplayValue('supports pathway 1')).toBeVisible();
    const suggestionList = () => document.querySelector('.connection-suggestions');
    expect(within(suggestionList()).getAllByRole('article')).toHaveLength(4);
    let pagination = screen.getByRole('navigation', { name: 'Connection suggestion groups' });
    expect(pagination).toHaveTextContent('Suggestions 1–4 of 9');

    fireEvent.click(within(pagination).getByRole('button', { name: 'Next' }));
    expect(within(suggestionList()).getAllByRole('article')).toHaveLength(4);
    expect(screen.getByDisplayValue('supports pathway 5')).toBeVisible();
    expect(screen.getByDisplayValue('supports pathway 8')).toBeVisible();
    pagination = screen.getByRole('navigation', { name: 'Connection suggestion groups' });
    expect(pagination).toHaveTextContent('Suggestions 5–8 of 9');

    fireEvent.click(within(pagination).getByRole('button', { name: 'Next' }));
    expect(within(suggestionList()).getAllByRole('article')).toHaveLength(1);
    expect(screen.getByDisplayValue('supports pathway 9')).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Connection suggestion groups' })).toHaveTextContent('Suggestions 9–9 of 9');
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
    fireEvent.click(screen.getByRole('button', { name: 'Open map' }));
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
    expect(await screen.findByRole('heading', { name: 'Choose items' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Work at level: Exo-level' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Choose work level' })).getByRole('button', { name: 'Meso-level' }));
    expect(await screen.findByRole('heading', { name: 'Systems map' })).toBeVisible();
    await waitFor(() => expect(storedProject()).toMatchObject({ activeScale: 'meso', stage: 3, reflection: 'Meso reflection' }));

    fireEvent.click(screen.getByRole('button', { name: 'Work at level: Meso-level' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Choose work level' })).getByRole('button', { name: 'Micro-level' }));
    expect(await screen.findByRole('heading', { name: 'Review and export your map' })).toBeVisible();
    await waitFor(() => expect(storedProject()).toMatchObject({ activeScale: 'micro', stage: 4, reflection: 'Micro reflection' }));

    fireEvent.click(screen.getByRole('button', { name: 'Work at level: Micro-level' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Choose work level' })).getByRole('button', { name: 'Exo-level' }));
    expect(await screen.findByRole('heading', { name: 'Choose items' })).toBeVisible();
    await waitFor(() => expect(storedProject()).toMatchObject({ activeScale: 'exosphere', stage: 2, reflection: 'Exo reflection' }));
    expect(storedProject().levelProgress).toMatchObject({
      micro: { stage: 4, reflection: 'Micro reflection' },
      meso: { stage: 3, reflection: 'Meso reflection' },
      exosphere: { stage: 2, reflection: 'Exo reflection' },
    });
  });

  it('saves and restores the intake evidence used and missing-perspectives framing', async () => {
    const project = createDefaultProject();
    await resumeSavedProject(project);
    const evidence = 'Memo, public meeting notes, and program schedule';
    const missing = 'Accounts from people who could not attend the meeting';
    fireEvent.change(screen.getByRole('textbox', { name: /^Evidence/ }), { target: { value: evidence } });
    fireEvent.change(screen.getByRole('textbox', { name: /^Missing voices/ }), { target: { value: missing } });
    await waitFor(() => {
      expect(storedProject().inquiry).toContain(`Evidence used: ${evidence}`);
      expect(storedProject().inquiry).toContain(`Missing perspectives: ${missing}`);
    });

    cleanup();
    render(<App />);
    await showResumeScreen();
    openProjectFromList(project.title);
    expect(await screen.findByRole('heading', { name: 'Add your memo' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /^Evidence/ })).toHaveValue(evidence);
    expect(screen.getByRole('textbox', { name: /^Missing voices/ })).toHaveValue(missing);
  });

  it('combines the current level and stage in the Progress control and dialog context', async () => {
    const project = makeMapProject('exosphere');
    await openMapProject(project);

    const progress = screen.getByRole('button', { name: 'Progress: Exo-level, Map' });
    expect(progress).toHaveTextContent('Progress');
    fireEvent.click(progress);
    const dialog = screen.getByRole('dialog', { name: 'Progress' });
    expect(dialog.querySelector('.modal-context')).toHaveTextContent('Exo-level · Map');
    const levels = within(dialog).getByRole('region', { name: 'Level progression' });
    expect(within(levels).getByText('Micro-level').closest('li')).toHaveTextContent('Available');
    expect(within(levels).getByText('Meso-level').closest('li')).toHaveTextContent('Available');
    expect(within(levels).getByText('Exo-level').closest('li')).toHaveTextContent('Current');
    expect(within(levels).getByText('Macro-level').closest('li')).toHaveTextContent('Not started');
  });

  it('distinguishes completed and currently completed levels in Progress', async () => {
    const project = makeMapProject('exosphere');
    project.completedScales = ['micro', 'exosphere'];
    await openMapProject(project);

    fireEvent.click(screen.getByRole('button', { name: 'Progress: Exo-level, Map' }));
    const levels = within(screen.getByRole('dialog', { name: 'Progress' })).getByRole('region', { name: 'Level progression' });
    expect(within(levels).getByText('Micro-level').closest('li')).toHaveTextContent('Complete');
    expect(within(levels).getByText('Meso-level').closest('li')).toHaveTextContent('Available');
    expect(within(levels).getByText('Exo-level').closest('li')).toHaveTextContent('Current · Complete');
    expect(within(levels).getByText('Macro-level').closest('li')).toHaveTextContent('Not started');
  });

  it('defaults a progressed cumulative map to All levels with every released item present', async () => {
    const project = makeMapProject('exosphere');
    const cumulative = graphForScale(project, 'all');
    await openMapProject(project);

    expect(screen.getByRole('combobox', { name: 'Show map layer' })).toHaveValue('all');
    expect(document.querySelectorAll('.graph-node')).toHaveLength(cumulative.nodes.length);
    expect(document.querySelectorAll('.graph-edge')).toHaveLength(cumulative.edges.length);
    expect(mapCanvas()).toHaveAttribute('aria-label', expect.stringContaining(`All-layers map. ${cumulative.nodes.length} nodes and ${cumulative.edges.length}`));
  });

});
