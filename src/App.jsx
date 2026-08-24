import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  containsRetiredSystemsLanguage,
  EXOSPHERE_NODE_TYPES,
  MACROSPHERE_NODE_TYPES,
  NODE_TYPES,
  MICRO_SETTING_NODE_TYPES,
  PROJECT_LIMITS,
  SCALE_ORDER,
  SCALE_PARTS,
  SCALE_VERB_LEXICONS,
  SCALES,
  configFingerprint,
  createPortableProject,
  createDefaultProject,
  createEvent,
  deterministicMemoReview,
  exportFileName,
  extractCandidates,
  isDiscreteMicroNodeLabel,
  isMesosystemLabel,
  isNamedInstitutionLabel,
  isNodeTypeAllowedAtScale,
  isObviousLowerLevelMacroLabel,
  labelRepeatsInstitution,
  normalizeMapElementLabel,
  parseProject,
  serializePortableProject,
  serializeProject,
  scaleLexiconVerb,
  stableId,
  validateProject,
  withDefaultNodeLayout,
} from './domain.js';
import { SYSTEMS_MAPPING_STAGES } from '../shared/systems-mapping-stages.js';
import cunyAiLabLogo from './assets/cuny-ai-lab-logo.png';
import {
  ApiError,
  createPreflightEvaluation,
  createProjectLink,
  endStudentAccess,
  fetchProjectLink,
  getPublicConfiguration,
  getStudentSession,
  recordPrototypeEvent,
  requestStudentAccess,
  suggestMapConnections,
  updateProjectLink,
} from './api.js';

const STORAGE_KEY = 'systems-mapping-studio.project.v6';
const LEGACY_STORAGE_KEYS = [
  'systems-mapping-studio.project.v5',
  'systems-mapping-studio.project.v4',
  'systems-mapping-studio.project.v3',
  'systems-mapping-studio.project.v2',
  'systems-mapping-studio.project.v1',
];
const LINK_STORAGE_KEY = 'systems-mapping-studio.link.v1';
const LINK_PATH_PATTERN = /^\/p\/([A-Za-z0-9_-]{20,64})\/?$/;
const LINK_SYNC_DEBOUNCE_MS = 4000;
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
const VIEWPORT_LIMITS = {
  minZoom: PROJECT_LIMITS.zoomMin,
  maxZoom: PROJECT_LIMITS.zoomMax,
  minPan: PROJECT_LIMITS.panMin,
  maxPan: PROJECT_LIMITS.panMax,
};
const ECOLOGY_SCALES = new Set(['exosphere', 'macrosphere']);
const ECOLOGY_MAP_SCALES = new Set(['meso', 'exosphere', 'macrosphere']);
const MICRO_SETTING_NODE_TYPE_SET = new Set(MICRO_SETTING_NODE_TYPES);
const LOWER_LEVEL_MACRO_MESSAGE = 'That label names an immediate person, role, activity, or schedule. Add it at Micro instead.';
const isCanonicalMapElementLabel = (value, scale) => normalizeMapElementLabel(value, { micro: scale === 'micro' }) === String(value || '').trim();

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
        loadError: 'The previous browser workspace could not be opened safely. Download its recovery copy before starting again.',
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

function loadStoredLink() {
  try {
    const raw = window.localStorage.getItem(LINK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.token !== 'string' || typeof parsed?.projectId !== 'string') return null;
    return { token: parsed.token, projectId: parsed.projectId };
  } catch {
    return null;
  }
}

function storeLink(link) {
  try {
    if (link) window.localStorage.setItem(LINK_STORAGE_KEY, JSON.stringify(link));
    else window.localStorage.removeItem(LINK_STORAGE_KEY);
  } catch {
    // The link still works for this visit even when browser storage is unavailable.
  }
}

function linkUrl(token) {
  return `${window.location.origin}/p/${token}`;
}

function describeLinkError(error) {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Class access ended. Enter the class code again to keep syncing this link.';
    if (error.status === 404) return 'This project link was not found. It may have been removed or belong to a different class workspace.';
    if (error.status === 409) return 'This link belongs to a different project. Create a new link for the current project.';
    if (error.status === 413) return 'This project is too large to sync to its link. Export a copy instead.';
    if (error.status === 429) return 'Link syncing is briefly paused. Recent changes will sync shortly.';
    return error.message;
  }
  return 'The project link could not be reached. Changes are still saved on this device.';
}

function urlLinkToken() {
  const match = LINK_PATH_PATTERN.exec(window.location.pathname);
  return match ? match[1] : null;
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
  const hasPriorMap = draft.activeScale !== 'micro'
    || draft.stage > 0
    || draft.releasedScales.length > 1
    || draft.completedScales.length > 0
    || draft.preflight !== null
    || draft.candidates.nodes.length > 0
    || draft.candidates.edges.length > 0
    || draft.graph.nodes.length > 0
    || draft.graph.edges.length > 0;
  draft.submission.revision = (draft.submission.revision || 1) + 1;
  draft.submission.fingerprint = stableId('src', value);
  if (!hasPriorMap) return;
  draft.activeScale = 'micro';
  draft.releasedScales = ['micro'];
  draft.completedScales = [];
  draft.stage = 0;
  draft.furthestStage = 0;
  draft.preflight = null;
  draft.candidates = { nodes: [], edges: [] };
  draft.graph = { nodes: [], edges: [] };
  draft.viewport = { panX: 0, panY: 0, zoom: 1 };
  draft.mapAnnotation = { id: stableId('annotation', `${draft.id}:map`), text: '' };
  draft.reflection = '';
  draft.submission.fileName = '';
  draft.submission.fileSize = 0;
  draft.events.push(createEvent('memo.replaced', 'Prior map cleared; progression restarted at Micro'));
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
    participantName: project.participantName,
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

function carriedMicroNodes(project) {
  return project.graph.nodes
    .filter((node) => node.scale === 'micro' && node.status !== 'rejected' && node.claimState !== 'retired')
    .map(({ id, label, type, scale }) => ({ id, label, type, scale }));
}

// Outer-level reviews carry the live inner map. Macrosphere items are never
// eligible endpoints or scope members for another outer-level proposal.
function carriedMapNodes(project) {
  return project.graph.nodes
    .filter((node) => node.scale !== 'macrosphere' && node.status !== 'rejected' && node.claimState !== 'retired')
    .slice(0, 50)
    .map(({ id, label, type, scale }) => ({ id, label, type, scale }));
}

function carriedReviewNodes(project) {
  if (project.activeScale === 'micro') return carriedMicroNodes(project);
  if (project.activeScale === 'meso') return carriedMicroNodes(project).filter((node) => MICRO_SETTING_NODE_TYPE_SET.has(node.type));
  if (ECOLOGY_SCALES.has(project.activeScale)) return carriedMapNodes(project);
  return [];
}

function carriedReviewConnections(project) {
  return project.graph.edges
    .filter((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired')
    .slice(0, 100)
    .map(({ source, target, verb }) => ({ source, target, verb }));
}

function preflightEvaluationPayload(project) {
  const carriedNodes = carriedReviewNodes(project);
  const carriedConnections = carriedReviewConnections(project);
  return {
    projectMetadata: projectMetadataForReview(project),
    activeScale: project.activeScale,
    stageId: STAGES[project.stage]?.id || 'review-suggestions',
    inquiry: project.inquiry,
    sourceRecord: sourceRecordForEvaluation(project.submission),
    sourceMaterial: project.submission.text,
    projectOverlay: projectOverlayForEvaluation(project.configs.preflight),
    ...(project.activeScale === 'meso' || carriedNodes.length ? { carriedNodes } : {}),
    ...(carriedConnections.length ? { carriedConnections } : {}),
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
  const activeIndex = Math.max(0, SCALE_ORDER.indexOf(project.activeScale));
  const carriedScales = project.activeScale === 'meso'
    ? new Set(['micro'])
    : ECOLOGY_SCALES.has(project.activeScale)
      ? new Set(SCALE_ORDER.slice(0, activeIndex + 1))
      : new Set([project.activeScale]);
  const active = project.graph.nodes
    .filter((node) => node.status !== 'rejected' && node.claimState !== 'retired' && carriedScales.has(node.scale));
  return [...new Map([...active, ...selected].map((node) => [node.id, node])).values()];
}

function connectionSuggestionPayload(project, prompt) {
  const nodes = nodesForConnectionPrompt(project);
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    activeScale: project.activeScale,
    inquiry: project.inquiry,
    prompt,
    nodes: nodes.map(({ id, label, type, scale }) => ({ id, label, type, scale })),
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
    if (project.activeScale === 'micro' && (source.scale !== 'micro' || target.scale !== 'micro')) throw new Error('The classroom server returned a connection outside Micro.');
    if (project.activeScale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(source.type) && MICRO_SETTING_NODE_TYPE_SET.has(target.type)) throw new Error('The classroom server returned a setting interrelation as a Micro relationship. Generate the suggestions again.');
    if (project.activeScale === 'exosphere' && source.scale !== 'exosphere' && target.scale !== 'exosphere') throw new Error('The classroom server returned a connection without an Exosphere institution.');
    if (project.activeScale === 'exosphere' && (source.scale === 'macrosphere' || target.scale === 'macrosphere')) throw new Error('The classroom server returned a connection to a Macrosphere item.');
    const verb = connection.verb;
    if (verb.trim() !== verb || (project.activeScale === 'exosphere' && !SCALE_VERB_LEXICONS.exosphere.includes(verb))) {
      throw new Error('The classroom server returned a relationship that does not belong at this level.');
    }
    const key = `${source.id}\u0000${verb.toLocaleLowerCase()}\u0000${target.id}`;
    if (seen.has(key)) throw new Error('The classroom server returned duplicate connection suggestions.');
    if (existingConnections.has(key)) throw new Error('The classroom server returned a connection that is already on the map.');
    seen.add(key);
    const id = stableId('edge', `${source.id}:${verb}:${target.id}:${index}`);
    return {
      id,
      source: source.id,
      target: target.id,
      sourceLabel: source.label,
      targetLabel: target.label,
      verb,
      scale: project.activeScale,
      status: project.instructor.requireStudentConfirmation ? 'pending' : 'confirmed',
      claimState: project.instructor.requireStudentConfirmation ? 'inference' : 'student interpretation',
      notes: '',
      directed: true,
      rationale: connection.rationale,
      annotation: { id: stableId('annotation', `edge:${id}:relationship`), text: '' },
    };
  });
}

function authoritativeEvaluationKey(project) {
  const payload = preflightEvaluationPayload(project);
  const { clientUpdatedAt: _clientUpdatedAt, stage: _stage, furthestStage: _furthestStage, ...stableMetadata } = payload.projectMetadata;
  return stableId('evaluation-request', JSON.stringify({ ...payload, projectMetadata: stableMetadata }));
}

function assertAtomicMemoReview(review, project) {
  const fail = () => { throw new Error('The classroom server returned guidance with unusable map items. Generate the guidance again.'); };
  if (!review || typeof review !== 'object' || Array.isArray(review)
    || Object.keys(review).sort().join(',') !== ['connections', 'example', 'guidance', 'nodes', 'readiness'].join(',')
    || !Array.isArray(review.nodes) || !Array.isArray(review.connections)) fail();
  const liveNodes = project.graph.nodes.filter((node) => node.status !== 'rejected' && node.claimState !== 'retired');
  const liveById = new Map(liveNodes.map((node) => [node.id, node]));
  const liveByLabel = new Map(liveNodes.map((node) => [node.label.toLocaleLowerCase(), node]));
  const proposedByLabel = new Map();
  const nodeKeys = {
    micro: ['evidence', 'label', 'scale', 'type'],
    meso: ['evidence', 'label', 'scale', 'scope', 'type'],
    exosphere: ['basis', 'evidence', 'label', 'scale', 'type'],
    macrosphere: ['basis', 'deontic', 'evidence', 'label', 'scale', 'scope', 'type'],
  }[project.activeScale];
  review.nodes.forEach((node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)
      || Object.keys(node).sort().join(',') !== nodeKeys.join(',')
      || typeof node.label !== 'string' || node.scale !== project.activeScale
      || (project.activeScale === 'macrosphere' && !SCALE_VERB_LEXICONS.macrosphere.includes(node.deontic))
      || proposedByLabel.has(node.label.toLocaleLowerCase()) || liveByLabel.has(node.label.toLocaleLowerCase())) fail();
    proposedByLabel.set(node.label.toLocaleLowerCase(), node);
    if (['meso', 'macrosphere'].includes(project.activeScale)) {
      if (!Array.isArray(node.scope) || node.scope.length < 2) fail();
      const scopeIds = new Set();
      node.scope.forEach((member) => {
        const carried = member && liveById.get(member.id);
        if (!carried || carried.label !== member.label || scopeIds.has(member.id)
          || (project.activeScale === 'meso' && (carried.scale !== 'micro' || !MICRO_SETTING_NODE_TYPE_SET.has(carried.type)))
          || (project.activeScale === 'macrosphere' && carried.scale === 'macrosphere')) fail();
        scopeIds.add(member.id);
      });
    }
  });
  if (['micro', 'meso'].includes(project.activeScale) && review.example !== null) fail();
  if (['meso', 'macrosphere'].includes(project.activeScale) && review.connections.length) fail();
  const existingConnections = new Set(project.graph.edges
    .filter((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired')
    .map((edge) => `${edge.source}\u0000${edge.verb.toLocaleLowerCase()}\u0000${edge.target}`));
  const seenConnections = new Set();
  const resolve = (reference) => liveById.get(reference)
    || liveByLabel.get(String(reference || '').toLocaleLowerCase())
    || proposedByLabel.get(String(reference || '').toLocaleLowerCase());
  review.connections.forEach((connection) => {
    if (!connection || typeof connection !== 'object' || Array.isArray(connection)
      || Object.keys(connection).sort().join(',') !== ['rationale', 'source', 'sourceLabel', 'target', 'targetLabel', 'verb'].join(',')) fail();
    const source = resolve(connection.source);
    const target = resolve(connection.target);
    if (!source || !target || source === target || source.label !== connection.sourceLabel || target.label !== connection.targetLabel) fail();
    if (project.activeScale === 'micro' && (source.scale !== 'micro' || target.scale !== 'micro'
      || (MICRO_SETTING_NODE_TYPE_SET.has(source.type) && MICRO_SETTING_NODE_TYPE_SET.has(target.type)))) fail();
    if (project.activeScale === 'exosphere' && (!SCALE_VERB_LEXICONS.exosphere.includes(connection.verb)
      || (source.scale !== 'exosphere' && target.scale !== 'exosphere')
      || source.scale === 'macrosphere' || target.scale === 'macrosphere')) fail();
    const sourceReference = liveById.has(connection.source) ? connection.source : source.label;
    const targetReference = liveById.has(connection.target) ? connection.target : target.label;
    const key = `${sourceReference}\u0000${connection.verb.toLocaleLowerCase()}\u0000${targetReference}`;
    if (seenConnections.has(key) || existingConnections.has(key)) fail();
    seenConnections.add(key);
  });
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
  assertAtomicMemoReview(evaluation.review, project);
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
  try {
    validateProject(candidate);
  } catch {
    throw new Error('The classroom server returned guidance with unusable map items. Generate the guidance again.');
  }
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
    link: <><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" /><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" /></>,
  };
  return <svg aria-hidden="true" className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function LabLink() {
  return <a className="brand__lab" href="https://ailab.gc.cuny.edu" aria-label="CUNY AI Lab"><img className="lab-logo" src={cunyAiLabLogo} alt="" /></a>;
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

function CommitInput({ value, onCommit, validate, onInvalid, ...props }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (!validate(next)) {
      setDraft(value);
      onInvalid();
      return;
    }
    if (next !== value) onCommit(next);
  };
  return <input {...props} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') { setDraft(value); event.currentTarget.blur(); }
  }} />;
}

function AccessFrame({ children, onTeacher }) {
  return <div className="access-shell">
    <header className="access-header">
      <LabLink />
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

function ResumeScreen({ project, hasSavedProject, saveState, onResume, onStart, onTeacher, onEndAccess, onRecovery, linkNotice = null }) {
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
      {linkNotice && <p className="access-message access-message--error" role="alert">{linkNotice}</p>}
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
  const nodeById = new Map(project.graph.nodes.map((node) => [node.id, node]));
  const nodeLines = project.graph.nodes.map((node) => {
    const annotations = [node.annotations?.analytical?.text && `analysis: ${node.annotations.analytical.text}`, node.annotations?.evidence?.text && `evidence note: ${node.annotations.evidence.text}`].filter(Boolean).join('; ');
    const members = node.scopeNodeIds?.map((memberId) => nodeById.get(memberId)?.label).filter(Boolean) || [];
    const membership = node.scale === 'meso' && members.length
      ? `; includes Micro settings: ${members.join(', ')}`
      : node.scale === 'macrosphere' && members.length
        ? `; ${node.deontic || 'shapes'}: ${members.join(', ')}`
        : '';
    return `- **${node.label}** — ${node.type}; level: ${SCALES[node.scale]?.label || node.scale}; evidence: ${node.evidence || 'needs evidence'}${membership}${annotations ? `; ${annotations}` : ''}`;
  });
  const edgeLines = project.graph.edges.map((edge) => `- ${edge.sourceLabel} **${edge.verb}** ${edge.targetLabel} — level: ${SCALES[edge.scale]?.label || edge.scale}; evidence: ${edge.evidence || 'needs evidence'}${edge.annotation?.text ? `; annotation: ${edge.annotation.text}` : ''}`);
  const redactionLines = project.portableExport?.redactions?.map((entry) => `- ${entry.path}: ${entry.reason}`).join('\n') || '- None';
  return `# ${project.title}\n\n${project.inquiry ? `${project.inquiry}\n\n` : ''}## Memo\n\n${project.submission.text || 'Not yet written'}\n\n## Map annotation\n\n${project.mapAnnotation?.text || 'Not yet written'}\n\n## Nodes\n\n${nodeLines.join('\n') || '- None added'}\n\n## Relationships\n\n${edgeLines.join('\n') || '- None added'}\n\n## Reflection\n\n${project.reflection || 'Not yet written'}\n\n## Items needing evidence\n\n${project.candidates.edges.filter((edge) => edge.status === 'research lead').map((edge) => `- ${edge.sourceLabel} ${edge.verb} ${edge.targetLabel}`).join('\n') || '- None recorded'}\n\n## Export redactions\n\n${redactionLines}\n`;
}

export function graphCsv(project) {
  const inert = (value) => {
    const text = String(value ?? '');
    return /^(?:[\t\r\n]|[ \t\r\n]*[=+\-@])/.test(text) ? `'${text}` : text;
  };
  const quote = (value) => `"${inert(value).replaceAll('"', '""')}"`;
  const nodeById = new Map(project.graph.nodes.map((node) => [node.id, node]));
  const rows = [['record_type', 'id', 'label_or_from', 'type_or_verb', 'target', 'scale', 'evidence', 'annotation', 'evidence_annotation', 'scope_member_ids', 'scope_member_labels', 'structural_action']];
  project.graph.nodes.forEach((node) => rows.push([
    'node', node.id, node.label, node.type, '', node.scale, node.evidence,
    node.annotations?.analytical?.text || '', node.annotations?.evidence?.text || '',
    (node.scopeNodeIds || []).join('; '),
    (node.scopeNodeIds || []).map((id) => nodeById.get(id)?.label).filter(Boolean).join('; '),
    node.scale === 'macrosphere' ? node.deontic || 'shapes' : '',
  ]));
  project.graph.edges.forEach((edge) => rows.push(['edge', edge.id, edge.sourceLabel, edge.verb, edge.targetLabel, edge.scale, edge.evidence, edge.annotation?.text || '', '', '', '', '']));
  rows.push(['map', project.mapAnnotation?.id || 'map', project.title, '', '', '', '', project.mapAnnotation?.text || '', '', '', '', '']);
  return rows.map((row) => row.map(quote).join(',')).join('\n');
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
      <p className="lede lede--compact">Add a memo to begin with Micro. The map then advances to Meso, Exosphere, and Macrosphere.</p>
      <div className="project-context-fields">
        <Field label="Map title (optional)"><input maxLength={CONFIG_TEXT_LIMIT} value={project.title} onChange={(event) => setProjectField('title', event.target.value)} /></Field>
        <Field label="Student or group name (optional)"><input autoComplete="name" maxLength={CONFIG_TEXT_LIMIT} value={project.participantName || ''} onChange={(event) => setProjectField('participantName', event.target.value)} /></Field>
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
    <Field label="Memo text" hint={hint || 'Changing the memo clears the current map and restarts at Micro.'}>
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
        toast('Enter a configuration name and base model.', 'error');
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
    toast('Configuration saved. Refresh the memo review to use this revision.');
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
        <Field label="Custom project instructions" hint="These instructions supplement the published course settings for this project."><textarea rows="5" maxLength={kind === 'preflight' ? MAX_EVALUATION_CUSTOM_INSTRUCTIONS : PROJECT_LIMITS.promptText} value={draft.customInstructions} onChange={(event) => change('customInstructions', event.target.value)} /></Field>
        <Field label="Relationship vocabulary" hint="Separate relationship terms with commas."><textarea rows="4" maxLength={RELATION_VOCABULARY_TEXT_LIMIT} value={draft.relationVocabulary} onChange={(event) => change('relationVocabulary', event.target.value)} /></Field>
        <Field label="Change note" hint="Required. This note appears in revision history."><input maxLength={PROJECT_LIMITS.rationaleText} value={draft.changeNote || ''} onChange={(event) => change('changeNote', event.target.value)} /></Field>
        {draft.staleRevision && <div className="teacher-message teacher-message--error" role="alert"><strong>Project revision {draft.staleRevision} is now current.</strong><p>Your unsaved draft remains in the editor and cannot overwrite it.</p><button type="button" className="button button--ghost" onClick={loadCurrentRevision}>Load project revision {draft.staleRevision}</button></div>}
        <div className="button-row"><button className="button button--secondary" type="button" onClick={() => setPreview(!preview)}>{preview ? 'Hide combined instructions' : 'Preview combined instructions'}</button><button className="button" type="button" onClick={save}>Save revision</button></div>
      </div>
      <aside className="guardrail-panel">
        <p className="eyebrow">Published course settings · read only</p>
        <pre>{shared ? 'Course settings are available.' : config.fixedPrompt}</pre>
        <dl className="config-meta"><div><dt>Project revision</dt><dd>{config.revision}</dd></div><div><dt>Project fingerprint</dt><dd>{config.fingerprint}</dd></div><div><dt>Shared revision</dt><dd>{shared?.revision || 'Local fallback'}</dd></div><div><dt>Shared fingerprint</dt><dd>{shared?.fingerprint || 'Server unavailable'}</dd></div><div><dt>Provider</dt><dd>{config.provider}</dd></div></dl>
        {preview && <div className="effective-prompt"><strong>Project guidance</strong><p>{draft.customInstructions}</p></div>}
        {config.history?.length > 0 && <details><summary>Revision history ({config.history.length})</summary><ol className="history-list">{[...config.history].reverse().map((entry) => <li key={`${entry.revision}-${entry.at}`}><strong>v{entry.revision}</strong> {entry.changeNote}<small>{entry.fingerprint}</small></li>)}</ol></details>}
      </aside>
    </div>
  </div>;
}

// Each level reads and asks for something different; the copy names it so a
// returning cycle never feels like the same screen with the same words.
const LEVEL_REVIEW_COPY = Object.freeze({
  micro: Object.freeze({
    items: 'specific people, roles, groups, activities, objects, immediate settings, and direct relationships',
    scaffoldTitle: 'Suggested Micro elements',
    next: 'Choose nodes',
  }),
  meso: Object.freeze({
    items: 'mesosystems formed by two or more Micro settings',
    scaffoldTitle: 'Suggested mesosystems',
    next: 'Choose mesosystems',
  }),
  exosphere: Object.freeze({
    items: 'institutions and decision-making bodies that affect mapped elements',
    scaffoldTitle: 'Suggested Exosphere institutions',
    next: 'Choose institutions',
  }),
  macrosphere: Object.freeze({
    items: 'broader laws, policies, economic conditions, and cultural beliefs',
    scaffoldTitle: 'Suggested Macrosphere conditions',
    next: 'Choose Macrosphere items',
  }),
});

function ReviewMemoStage({ project, update, reviewBusy, onGenerate, onContinue }) {
  const review = project.preflight?.memoReview;
  const stale = Boolean(project.preflight && project.preflight.sourceFingerprint !== memoFingerprint(project.submission));
  const coursePart = coursePartForScale(project);
  const busy = reviewBusy === 'evaluating';
  const hasMemo = Boolean(project.submission.text.trim());
  const nodesOnly = project.activeScale === 'meso' || project.activeScale === 'macrosphere';
  const mesoLinkages = project.activeScale === 'meso';
  const levelCopy = LEVEL_REVIEW_COPY[project.activeScale] || LEVEL_REVIEW_COPY.micro;
  const surfacedNodes = review?.nodes || [];
  const surfacedConnections = review?.connections || [];
  const microSettings = mesoLinkages ? carriedMicroNodes(project).filter((node) => MICRO_SETTING_NODE_TYPE_SET.has(node.type)) : [];
  const nextLabel = levelCopy.next;
  return <div className="wide stage-enter">
    <p className="eyebrow">{coursePart.label} · {SCALES[project.activeScale].label}</p>
    <h1>Review your memo</h1>
    <p className="lede">Check what your memo supports and what remains uncertain.</p>
    <MemoDrawer project={project} update={update} />
    {!hasMemo && <p className="empty-message">Add memo text above to begin. The model will identify {levelCopy.items} supported by the memo.</p>}
    {busy && !review && <p className="review-progress" role="status">The model is reading your memo…</p>}
    {review && <>
      <section className={`readiness-banner ${review.readiness.ready && !stale ? 'is-ready' : ''}`} aria-label="Where your memo stands">
        <div className="readiness-banner__text">
          {review.readiness.note && <p>{review.readiness.note}</p>}
          {stale && <p className="readiness-banner__stale" role="status">Your memo changed after this guidance was generated. Choose Refresh guidance when you want the model to review the revised memo. Your existing map remains unchanged.</p>}
        </div>
        <div className="button-row">
          <button type="button" className="button button--secondary" disabled={busy || !hasMemo} onClick={onGenerate}>{busy ? 'Rereading your memo…' : 'Refresh guidance'}</button>
          <button type="button" className="button" onClick={onContinue}>{nextLabel}<Icon name="arrow" /></button>
        </div>
      </section>
      <div className="preflight-grid">
        <section className="memo-guidance" aria-labelledby="memo-guidance-title">
          <h2 id="memo-guidance-title">Memo review</h2>
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
          <p className="eyebrow">Suggestions</p>
          <h2 id="memo-scaffold-title">{levelCopy.scaffoldTitle}</h2>
          {mesoLinkages && microSettings.length > 0 && <div className="connection-node-list" role="region" aria-label="Micro settings available for mesosystems">{microSettings.map((node) => <span key={node.id}>{node.label}</span>)}</div>}
          {surfacedNodes.length ? (project.activeScale === 'macrosphere'
            ? <ul className="memo-scaffold__structures" aria-label="Structures evident in the memo">{surfacedNodes.map((node) => <li key={node.label}>
              <span className="memo-scaffold__claim"><strong>{node.label}</strong> <em>{node.deontic || 'shapes'}</em>{node.scope?.length ? <> {node.scope.map((member) => member.label).join(', ')}</> : <span className="memo-scaffold__pending">. Select the affected mapped elements at the next step.</span>}</span>
              {node.basis === 'inference' && <small>Suggested from context. Review, revise, or remove it.</small>}
            </li>)}</ul>
            : mesoLinkages
              ? <ul className="memo-scaffold__structures" aria-label="Mesosystems supported by the memo">{surfacedNodes.map((node) => <li key={node.label}><span className="memo-scaffold__claim"><strong>{node.label}</strong>{node.scope?.length ? <> includes {node.scope.map((member) => member.label).join(' and ')}</> : <span className="memo-scaffold__pending">. Select at least two Micro settings at the next step.</span>}</span></li>)}</ul>
            : <div className="connection-node-list" aria-label="Nodes evident in the memo">{surfacedNodes.map((node) => <span key={node.label} className={node.basis === 'inference' ? 'is-inferred' : ''}>{node.label}{node.basis === 'inference' && <em> · inferred</em>}</span>)}</div>) : null}
          {!surfacedNodes.length ? <p className="empty-message">The review did not suggest any new elements. Revise the memo and refresh the guidance, or add an element at the next stage.</p> : null}
          {mesoLinkages && microSettings.length < 2 ? <p className="empty-message">Meso needs at least two Micro settings. Return to Micro and add the settings in which the person directly participates.</p> : null}
          {!nodesOnly && surfacedConnections.length > 0 && <ul className="memo-scaffold__connections">{surfacedConnections.map((connection, index) => (
            <li key={stableId('scaffold-edge', `${index}:${connection.source}:${connection.verb}:${connection.target}`)}>
              <span className="memo-scaffold__claim"><strong>{connection.sourceLabel || connection.source}</strong> <em>{connection.verb}</em> <strong>{connection.targetLabel || connection.target}</strong></span>
              {connection.rationale && <small>{connection.rationale}</small>}
            </li>
          ))}</ul>}
          {!nodesOnly && review.example && <div className="memo-scaffold__example"><p className="eyebrow">Worked example</p><p>{review.example}</p></div>}
          <p className="privacy-note">Suggestions begin on Keep unless your teacher requires confirmation. You can revise or remove any suggestion before opening the map.</p>
        </aside>
      </div>
    </>}
    {!review && !busy && hasMemo && <div className="button-row"><button className="button" type="button" onClick={onGenerate}>Generate guidance</button></div>}
  </div>;
}

function candidateStepsForScale(scale) {
  if (scale === 'micro') return ['nodes', 'edges', 'suggest'];
  if (scale === 'meso') return ['nodes'];
  // Macrosphere structures have no connection step: each structure carries a
  // scope of mapped elements instead of edges.
  if (scale === 'macrosphere') return ['nodes'];
  return ['nodes', 'edges', 'suggest'];
}

const MACRO_STRUCTURE_KINDS = MACROSPHERE_NODE_TYPES;

function CandidateStage({ project, update, toast, prompt, onPromptChange, busy, suggestions, onSuggest, onEdit, onDecision, onRefreshCandidates, refreshBusy }) {
  const candidateSteps = useMemo(() => candidateStepsForScale(project.activeScale), [project.activeScale]);
  const [step, setStep] = useState(() => candidateSteps[0]);
  useEffect(() => {
    if (!candidateSteps.includes(step)) setStep(candidateSteps[0]);
  }, [candidateSteps, step]);
  const liveMapNodes = useMemo(() => project.graph.nodes
    .filter((node) => node.status !== 'rejected' && node.claimState !== 'retired'), [project.graph.nodes]);
  const liveMapNodeById = useMemo(() => new Map(liveMapNodes.map((node) => [node.id, node])), [liveMapNodes]);
  const mesoSettingNodes = useMemo(() => liveMapNodes.filter((node) => node.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(node.type)), [liveMapNodes]);
  // Mesosystems contain Micro settings. Macrosphere items may affect any
  // mapped element from an inner level.
  const scopeCandidates = useMemo(() => project.activeScale === 'meso'
    ? mesoSettingNodes
    : liveMapNodes.filter((node) => node.scale !== 'macrosphere'), [liveMapNodes, mesoSettingNodes, project.activeScale]);
  const [institutionDraft, setInstitutionDraft] = useState({ label: '', type: 'institution', anchor: '', verb: SCALE_VERB_LEXICONS.exosphere[0] });
  const [mesoDraft, setMesoDraft] = useState({ label: '', first: '', second: '' });
  const [structureDraft, setStructureDraft] = useState({ label: '', type: 'policy', deontic: 'shapes' });
  const addMesoLinkage = () => {
    const label = mesoDraft.label.trim();
    if (!label) return toast('Name the mesosystem first.', 'error');
    if (!isMesosystemLabel(label)) return toast('Name the connection between at least two Micro settings without writing a full sentence.', 'error');
    if (!mesoDraft.first || !mesoDraft.second || mesoDraft.first === mesoDraft.second) return toast('Choose two different Micro settings.', 'error');
    const id = stableId('node', label);
    if (project.candidates.nodes.some((node) => node.id === id)
      || liveMapNodes.some((node) => node.label.trim().toLocaleLowerCase() === label.toLocaleLowerCase())) {
      return toast('That mesosystem is already on your list or map.', 'error');
    }
    update((draft) => {
      draft.candidates.nodes = withDefaultNodeLayout([...draft.candidates.nodes, {
        id, label, type: 'mesosystem', scale: 'meso', status: 'confirmed',
        claimState: 'student interpretation', evidence: '',
        sourceFingerprint: memoFingerprint(project.submission), notes: '',
        scopeNodeIds: [mesoDraft.first, mesoDraft.second],
      }]);
    }, 'candidate.added', label);
    setMesoDraft({ label: '', first: '', second: '' });
    toast(`${label} added with two Micro settings.`);
  };
  const addInstitution = () => {
    const label = institutionDraft.label.trim();
    if (!label) return toast('Name the institution first.', 'error');
    if (!isNamedInstitutionLabel(label)) return toast('Use the full name of an institution, agency, office, or service system.', 'error');
    const id = stableId('node', label);
    if (project.candidates.nodes.some((node) => node.id === id)
      || liveMapNodes.some((node) => node.label.trim().toLocaleLowerCase() === label.toLocaleLowerCase())) {
      return toast('That institution is already on your list or map.', 'error');
    }
    const anchor = liveMapNodeById.get(institutionDraft.anchor);
    const fingerprint = memoFingerprint(project.submission);
    update((draft) => {
      draft.candidates.nodes = withDefaultNodeLayout([...draft.candidates.nodes, {
        id, label, type: institutionDraft.type, scale: 'exosphere',
        status: 'confirmed', claimState: 'student interpretation',
        evidence: 'Added by the student.',
        sourceFingerprint: fingerprint, notes: '',
      }]);
      if (anchor) {
        const edgeId = stableId('edge', `${id}:${institutionDraft.verb}:${anchor.id}`);
        if (!draft.candidates.edges.some((edge) => edge.id === edgeId)) {
          draft.candidates.edges.push({
            id: edgeId, source: id, target: anchor.id, sourceLabel: label, targetLabel: anchor.label,
            verb: institutionDraft.verb, scale: 'exosphere', status: 'confirmed',
            claimState: 'student interpretation', directed: true, rationale: '', evidence: '',
            sourceFingerprint: fingerprint, notes: '',
            annotation: { id: stableId('annotation', `edge:${edgeId}:relationship`), text: '' },
          });
        }
      }
    }, 'candidate.added', label);
    setInstitutionDraft((current) => ({ ...current, label: '', anchor: '' }));
    toast(anchor ? `${label} added with a relationship to ${anchor.label}.` : `${label} added. Add its relationship at the next step.`);
  };
  const addStructure = () => {
    const label = structureDraft.label.trim();
    if (!label) return toast('Name the Macrosphere item first.', 'error');
    if (!isCanonicalMapElementLabel(label, 'macrosphere')) return toast('Name one complete map element instead of a reference, time, modifier, action, or fragment.', 'error');
    if (containsRetiredSystemsLanguage(label)) return toast('Use a direct, conventional name for the broader condition.', 'error');
    if (isObviousLowerLevelMacroLabel(label)) return toast(LOWER_LEVEL_MACRO_MESSAGE, 'error');
    if (labelRepeatsInstitution(label, liveMapNodes.filter((node) => node.scale === 'exosphere'))) return toast('That label names or repeats an institution. Add it at Exosphere instead.', 'error');
    const id = stableId('node', label);
    if (project.candidates.nodes.some((node) => node.id === id)
      || liveMapNodes.some((node) => node.label.trim().toLocaleLowerCase() === label.toLocaleLowerCase())) {
      return toast('That structure is already on your list or map.', 'error');
    }
    update((draft) => {
      draft.candidates.nodes = withDefaultNodeLayout([...draft.candidates.nodes, {
        id, label, type: structureDraft.type, scale: 'macrosphere',
        status: 'pending', claimState: 'inference',
        evidence: '', sourceFingerprint: memoFingerprint(project.submission), notes: '',
        deontic: structureDraft.deontic, scopeNodeIds: [],
      }]);
    }, 'candidate.added', label);
    setStructureDraft((current) => ({ ...current, label: '' }));
    toast(`${label} added. Choose at least two mapped elements before keeping it.`);
  };
  const editScope = (id, memberId, include) => update((draft) => {
    const item = draft.candidates.nodes.find((candidate) => candidate.id === id);
    if (!item) return;
    const current = Array.isArray(item.scopeNodeIds) ? item.scopeNodeIds : [];
    const next = include
      ? (current.includes(memberId) || current.length >= PROJECT_LIMITS.scopeMembers ? current : [...current, memberId])
      : current.filter((entry) => entry !== memberId);
    item.scopeNodeIds = next;
    if (next.length < 2) {
      item.status = 'pending';
      item.claimState = 'inference';
    } else if (!draft.instructor.requireStudentConfirmation && item.status === 'pending') {
      item.status = 'confirmed';
      item.claimState = 'student interpretation';
    }
  }, 'candidate.scope-edited', id);
  const setStatus = (kind, id, status) => {
    const current = project.candidates[kind].find((candidate) => candidate.id === id);
    if (!current) return;
    if (status === 'research lead' && !project.instructor.allowResearchLeads) return toast('Items needing more evidence are turned off for this project.', 'error');
    if (kind === 'nodes' && (status === 'confirmed' || status === 'research lead') && !isCanonicalMapElementLabel(current.label, project.activeScale)) return toast('Name one complete map element instead of a reference, time, modifier, action, or fragment.', 'error');
    if (kind === 'nodes' && (status === 'confirmed' || status === 'research lead') && containsRetiredSystemsLanguage(current.label)) return toast('Use a direct, conventional name for the map element.', 'error');
    if ((status === 'confirmed' || status === 'research lead') && project.instructor.evidenceRequired && !current.evidence) return toast('Add evidence before moving this item forward.', 'error');
    if (kind === 'nodes' && project.activeScale === 'micro' && (status === 'confirmed' || status === 'research lead') && !isDiscreteMicroNodeLabel(current.label)) return toast('Name one specific person, role, group, activity, object, or immediate setting.', 'error');
    if (kind === 'nodes' && project.activeScale === 'meso' && (status === 'confirmed' || status === 'research lead') && !isMesosystemLabel(current.label)) return toast('Give the mesosystem a clear name, such as “coordination between home and school.”', 'error');
    if (kind === 'nodes' && project.activeScale === 'exosphere' && (status === 'confirmed' || status === 'research lead') && !isNamedInstitutionLabel(current.label)) return toast('Use the full name of an institution, agency, office, or service system.', 'error');
    if (kind === 'nodes' && project.activeScale === 'macrosphere' && (status === 'confirmed' || status === 'research lead') && isObviousLowerLevelMacroLabel(current.label)) return toast(LOWER_LEVEL_MACRO_MESSAGE, 'error');
    if (kind === 'nodes' && project.activeScale === 'macrosphere' && (status === 'confirmed' || status === 'research lead') && labelRepeatsInstitution(current.label, liveMapNodes.filter((node) => node.scale === 'exosphere'))) return toast('That label names or repeats an institution. Add it at Exosphere instead.', 'error');
    if (kind === 'nodes' && project.activeScale === 'meso' && (status === 'confirmed' || status === 'research lead') && (current.scopeNodeIds || []).length < 2) return toast('Choose at least two Micro settings for this mesosystem.', 'error');
    if (kind === 'nodes' && project.activeScale === 'macrosphere' && (status === 'confirmed' || status === 'research lead') && (current.scopeNodeIds || []).length < 2) return toast('Choose at least two mapped elements for this Macrosphere item.', 'error');
    update((draft) => {
      const item = draft.candidates[kind].find((candidate) => candidate.id === id);
      item.status = status;
      item.claimState = status === 'research lead' ? 'research lead' : status === 'confirmed' ? 'student interpretation' : item.claimState;
    }, `candidate.${status}`, id);
  };
  const edit = (kind, id, field, value) => {
    const current = project.candidates[kind].find((candidate) => candidate.id === id);
    if (!current) return;
    if (kind === 'nodes' && field === 'type' && !isNodeTypeAllowedAtScale(value, project.activeScale)) return toast(`That type does not belong at ${SCALES[project.activeScale].label}.`, 'error');
    update((draft) => {
      const item = draft.candidates[kind].find((candidate) => candidate.id === id);
      const previousLabel = item.label;
      item[field] = value;
      if (kind === 'nodes' && field === 'label' && draft.activeScale === 'micro') {
        const validMicroLabel = isDiscreteMicroNodeLabel(value);
        item.status = validMicroLabel && !draft.instructor.requireStudentConfirmation ? 'confirmed' : 'pending';
        item.claimState = validMicroLabel && !draft.instructor.requireStudentConfirmation ? 'student interpretation' : 'inference';
      }
      if (kind === 'nodes' && field === 'label' && draft.activeScale === 'exosphere') {
        const validInstitution = isNamedInstitutionLabel(value);
        item.status = validInstitution && !draft.instructor.requireStudentConfirmation ? 'confirmed' : 'pending';
        item.claimState = validInstitution && !draft.instructor.requireStudentConfirmation ? 'student interpretation' : 'inference';
      }
      if (kind === 'nodes' && field === 'label') {
        draft.candidates.edges.forEach((edge) => {
          if (edge.source === id) edge.sourceLabel = value;
          if (edge.target === id) edge.targetLabel = value;
        });
        item.notes = item.notes || `Label revised from ${previousLabel}`;
      }
    });
  };
  const keepAllRemaining = (kind) => {
    const remaining = project.candidates[kind].filter((item) => item.status === 'pending');
    const invalid = remaining.find((item) => (
      (project.instructor.evidenceRequired && !item.evidence)
      || (kind === 'nodes' && (!isCanonicalMapElementLabel(item.label, project.activeScale)
        || containsRetiredSystemsLanguage(item.label)
        || (project.activeScale === 'micro' && !isDiscreteMicroNodeLabel(item.label))
        || (project.activeScale === 'meso' && !isMesosystemLabel(item.label))
        || (project.activeScale === 'exosphere' && !isNamedInstitutionLabel(item.label))
        || (project.activeScale === 'macrosphere' && (isObviousLowerLevelMacroLabel(item.label)
          || labelRepeatsInstitution(item.label, liveMapNodes.filter((node) => node.scale === 'exosphere'))))
        || (['meso', 'macrosphere'].includes(project.activeScale) && (item.scopeNodeIds || []).length < 2)))
    ));
    if (invalid) return toast('Review the remaining items individually before keeping all of them.', 'error');
    update((draft) => {
      draft.candidates[kind].forEach((item) => {
        if (item.status !== 'pending') return;
        item.status = 'confirmed';
        item.claimState = 'student interpretation';
      });
    }, 'candidates.batch-confirmed', kind === 'nodes' ? 'Remaining nodes kept' : 'Remaining connections kept');
  };
  const counts = Object.fromEntries(['nodes', 'edges'].map((kind) => {
    const items = project.candidates[kind];
    return [kind, {
      total: items.length,
      decided: items.filter((item) => item.status !== 'pending').length,
      remaining: items.filter((item) => item.status === 'pending').length,
    }];
  }));
  const levelStepCopy = {
    meso: {
      nodes: {
        title: 'Choose the mesosystems',
        lede: 'Each mesosystem shows how at least two immediate settings in which the person participates relate to one another. Give it a clear name and choose the settings involved.',
      },
    },
    exosphere: {
      nodes: {
        title: 'Choose the institutions',
        lede: 'Exosphere includes named institutions, agencies, offices, and service systems whose decisions or actions affect mapped elements even when the person does not interact with them directly. Keep broader laws, economic conditions, and cultural beliefs for Macrosphere. Review, rename, remove, or add institutions below.',
      },
      edges: {
        title: 'Review institutional relationships',
        lede: 'Each Exosphere institution must connect to at least one mapped element through a specific action. Examples include funds, regulates, employs, and sets rules for. Review the wording, then keep or remove each relationship.',
      },
    },
    macrosphere: {
      nodes: {
        title: 'Choose the Macrosphere items',
        lede: 'Macrosphere includes broader laws, public policies, economic conditions, histories, and cultural beliefs that affect at least two mapped elements. Keep named institutions in Exosphere.',
      },
    },
  };
  const stepCopy = {
    nodes: {
      tab: `Nodes · ${counts.nodes.total}`,
      title: 'Choose your nodes',
      lede: project.activeScale === 'micro'
        ? 'Each suggested Micro node should name one person, role, group, activity, object, or immediate setting. Review the label and type, then keep, rename, or remove it. The application adds the nodes you keep.'
        : 'Review the label and type of each suggested node, then keep, rename, or remove it. The application adds the nodes you keep.',
      ...(levelStepCopy[project.activeScale]?.nodes || {}),
    },
    edges: {
      tab: `Direct relationships · ${counts.edges.total}`,
      title: project.activeScale === 'micro' ? 'Review direct relationships' : 'Confirm how they connect',
      lede: project.activeScale === 'meso'
        ? 'Meso uses mesosystems that include at least two Micro settings. It does not add relationship edges.'
        : project.activeScale === 'micro'
          ? 'Each Micro relationship describes a direct interaction within an immediate setting. Edit the relationship wording, then keep or remove the suggestion.'
        : 'Each relationship connects an Exosphere institution to a mapped element. Edit the relationship wording, then keep or remove the suggestion.',
      ...(levelStepCopy[project.activeScale]?.edges || {}),
    },
    suggest: {
      tab: project.activeScale === 'micro' ? 'More direct relationships' : 'More connections',
      title: project.activeScale === 'micro' ? 'Describe a direct relationship' : 'Describe connections between nodes',
      lede: 'Optional. Describe a relationship you want the model to examine.',
    },
  };
  const carriedNodes = project.activeScale === 'meso'
    ? mesoSettingNodes
    : [];
  const mesoLinkageRow = project.activeScale === 'meso';
  const structureRow = project.activeScale === 'macrosphere';
  const scopeRow = mesoLinkageRow || structureRow;
  const exoVerbOptions = (current) => {
    const lowered = String(current || '').trim().toLocaleLowerCase();
    return SCALE_VERB_LEXICONS.exosphere.includes(lowered)
      ? SCALE_VERB_LEXICONS.exosphere
      : [...(lowered ? [current] : []), ...SCALE_VERB_LEXICONS.exosphere];
  };
  const candidateNodeTypes = project.activeScale === 'exosphere'
    ? EXOSPHERE_NODE_TYPES
    : project.activeScale === 'macrosphere'
      ? MACRO_STRUCTURE_KINDS
      : NODE_TYPES.filter((type) => isNodeTypeAllowedAtScale(type, project.activeScale));
  const candidateRows = (kind) => project.candidates[kind].map((item, index) => <article className={`candidate-row candidate-row--${item.status.replaceAll(' ', '-')}`} key={item.id}>
    <div className="candidate-row__count">{String(index + 1).padStart(2, '0')}</div>
    <div className="candidate-row__main">
      {kind === 'nodes'
        ? mesoLinkageRow
          ? <div className="candidate-expression"><CommitInput aria-label="Mesosystem label" maxLength={NODE_LABEL_LIMIT} value={item.label} validate={isMesosystemLabel} onCommit={(value) => edit(kind, item.id, 'label', value)} onInvalid={() => toast('Give the mesosystem a clear name, such as “coordination between home and school.”', 'error')} /><span>includes</span><strong>{(item.scopeNodeIds || []).length} Micro settings</strong></div>
          : <div className="candidate-expression"><input aria-label={structureRow ? 'Macrosphere item label' : 'Node label'} maxLength={NODE_LABEL_LIMIT} value={item.label} onChange={(event) => edit(kind, item.id, 'label', event.target.value)} /><span>is a</span><select aria-label={structureRow ? 'Macrosphere item type' : 'Node type'} value={item.type} onChange={(event) => edit(kind, item.id, 'type', event.target.value)}>{candidateNodeTypes.map((type) => <option key={type}>{type}</option>)}</select></div>
        : project.activeScale === 'exosphere'
          ? <div className="candidate-expression candidate-expression--edge"><strong>{item.sourceLabel}</strong><select aria-label="Institutional relationship" value={item.verb} onChange={(event) => edit(kind, item.id, 'verb', event.target.value)}>{exoVerbOptions(item.verb).map((verb) => <option key={verb}>{verb}</option>)}</select><strong>{item.targetLabel}</strong></div>
          : <div className="candidate-expression candidate-expression--edge"><strong>{item.sourceLabel}</strong><AutoGrowingTextarea className="relationship-verb-editor" aria-label="Direct connection" maxLength={RELATIONSHIP_VERB_LIMIT} value={item.verb} onChange={(event) => edit(kind, item.id, 'verb', event.target.value)} /><strong>{item.targetLabel}</strong></div>}
      {kind === 'nodes' && scopeRow && <div className="scope-editor" aria-label={mesoLinkageRow ? `Micro settings included in ${item.label}` : `Mapped elements affected by ${item.label}`}>
        {structureRow && <div className="scope-editor__mode"><label><span>How it affects mapped elements</span><select aria-label={`How ${item.label} affects mapped elements`} value={SCALE_VERB_LEXICONS.macrosphere.includes(item.deontic) ? item.deontic : 'shapes'} onChange={(event) => edit(kind, item.id, 'deontic', event.target.value)}>{SCALE_VERB_LEXICONS.macrosphere.map((verb) => <option key={verb}>{verb}</option>)}</select></label></div>}
        <div className="scope-editor__members">
          {(item.scopeNodeIds || []).map((memberId) => {
            const member = liveMapNodeById.get(memberId);
            if (!member) return null;
            return <button key={memberId} type="button" className="scope-chip" onClick={() => editScope(item.id, memberId, false)} aria-label={mesoLinkageRow ? `Remove ${member.label} from ${item.label}` : `Remove ${member.label} from the mapped elements affected by ${item.label}`}>{member.label}<span aria-hidden="true"> ×</span></button>;
          })}
          {scopeCandidates.some((node) => !(item.scopeNodeIds || []).includes(node.id))
            ? <select className="scope-editor__add" aria-label={mesoLinkageRow ? `Add a Micro setting to ${item.label}` : `Add a mapped element affected by ${item.label}`} value="" onChange={(event) => { if (event.target.value) editScope(item.id, event.target.value, true); }}>
              <option value="">{mesoLinkageRow ? 'Add Micro setting…' : 'Add element…'}</option>
              {scopeCandidates.filter((node) => !(item.scopeNodeIds || []).includes(node.id)).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
            </select>
            : null}
          {(item.scopeNodeIds || []).length < 2 && <span className="scope-editor__empty">{mesoLinkageRow ? 'Choose at least two Micro settings.' : `Choose at least two mapped elements this item ${SCALE_VERB_LEXICONS.macrosphere.includes(item.deontic) ? item.deontic : 'shapes'}.`}</span>}
        </div>
      </div>}
      <p>{item.basis === 'inference' && <span className="basis-chip">suggested from context · review</span>}<span className="evidence-chip">{item.evidence || 'Evidence needed'}</span> · {SCALES[item.scale]?.label || item.scale}</p>
      <details className="candidate-note">
        <summary>{item.notes ? 'Annotation added' : 'Annotation'}</summary>
        <Field label="Annotation"><input maxLength={PROJECT_LIMITS.noteText} value={item.notes || ''} onChange={(event) => edit(kind, item.id, 'notes', event.target.value)} /></Field>
      </details>
    </div>
    <div className="candidate-actions" aria-label={`Decision for ${kind === 'nodes' ? item.label : `${item.sourceLabel} ${item.verb} ${item.targetLabel}`}`}>
      <button className={item.status === 'confirmed' ? 'is-active' : ''} type="button" onClick={() => setStatus(kind, item.id, 'confirmed')}>Keep</button>
      {project.instructor.allowResearchLeads && <button className={item.status === 'research lead' ? 'is-active' : ''} type="button" onClick={() => setStatus(kind, item.id, 'research lead')}>Needs more evidence</button>}
      <button className={item.status === 'rejected' ? 'is-active' : ''} type="button" onClick={() => setStatus(kind, item.id, 'rejected')}>Remove</button>
    </div>
  </article>);
  const decisionStep = step === 'nodes' || step === 'edges';
  const stepIndex = candidateSteps.indexOf(step);
  const nextStep = candidateSteps[stepIndex + 1] || null;
  return <div className="wide stage-enter">
    <p className="eyebrow">{project.activeScale === 'meso' ? 'Choose mesosystems' : project.activeScale === 'macrosphere' ? 'Choose Macrosphere items' : 'Choose nodes and describe relationships'} · step {stepIndex + 1} of {candidateSteps.length}</p>
    <div className="stage-title-row"><div><h1>{stepCopy[step].title}</h1><p className="lede">{stepCopy[step].lede}</p></div></div>
    {candidateSteps.length > 1 && <div className="subnav candidate-steps" role="tablist" aria-label="Choose map elements">
      {candidateSteps.map((id) => <button key={id} id={`candidate-tab-${id}`} role="tab" aria-controls="candidate-panel" aria-selected={step === id} tabIndex={step === id ? 0 : -1} data-composite-value={id} className={step === id ? 'is-active' : ''} onKeyDown={(event) => handleCompositeKey(event, candidateSteps, step, setStep)} onClick={() => setStep(id)}>{stepCopy[id].tab}</button>)}
    </div>}
    {project.activeScale === 'meso' && <section className="carried-node-summary" aria-labelledby="carried-nodes-title">
      <div><p className="eyebrow">From Micro</p><h2 id="carried-nodes-title">Micro settings available for mesosystems</h2></div>
      {carriedNodes.length ? <div className="connection-node-list" aria-label="Micro settings available for mesosystems">{carriedNodes.map((node) => <span key={node.id}>{node.label}</span>)}</div> : <p className="empty-message">No Micro settings are available. Return to Micro and add the settings in which the person directly participates.</p>}
    </section>}
    {decisionStep && <>
      <MemoDrawer project={project} update={update} hint="Changing this memo clears the current map and restarts at Micro." />
      <div className="button-row candidate-refresh-row">
        <button className="button button--secondary" type="button" disabled={Boolean(refreshBusy)} onClick={onRefreshCandidates}>{refreshBusy ? 'Rereading memo…' : 'Reread memo for new suggestions'}</button>
      </div>
    </>}
    <div id="candidate-panel" role={candidateSteps.length > 1 ? 'tabpanel' : undefined} aria-labelledby={candidateSteps.length > 1 ? `candidate-tab-${step}` : undefined}>
      {decisionStep && <>
        <p className="candidate-progress">{project.instructor.requireStudentConfirmation ? 'Suggestions are off until you choose Keep.' : 'Keep means add this suggestion to the map. Suggestions begin on Keep so you can review them together. Choose Needs more evidence to set one aside, or Remove to leave it off the map.'}</p>
        {counts[step].total > 0 && <p className="candidate-progress" role="status">{counts[step].decided} of {counts[step].total} decided</p>}
        <div className="candidate-list">
          {candidateRows(step)}
          {!counts[step].total && <p className="empty-message">{step === 'nodes'
            ? project.activeScale === 'exosphere'
              ? 'The review did not suggest any Exosphere institutions. Add a named institution whose decisions or actions affect an element already on the map.'
              : project.activeScale === 'meso'
                ? 'The review did not suggest a mesosystem. Add a supported mesosystem that includes at least two Micro settings below.'
              : project.activeScale === 'macrosphere'
                ? 'The review did not suggest any Macrosphere items. Add a supported law, public policy, economic condition, history, or cultural belief below.'
                : 'The review did not suggest any nodes. Revise the memo and choose “Reread memo,” or add a node on the map.'
            : 'No connections came from your memo yet. Continue to ask the model for suggestions, or add relationships yourself on the map.'}</p>}
        </div>
        {step === 'nodes' && project.activeScale === 'meso' && <section className="elicitation-panel" aria-labelledby="add-meso-linkage-title">
          <p className="eyebrow">Mesosystems</p>
          <h2 id="add-meso-linkage-title">Add a mesosystem</h2>
          <p className="lede">Name how at least two Micro settings relate to one another, then select those settings.</p>
          <div className="elicitation-panel__form">
            <Field label="Mesosystem name"><input maxLength={NODE_LABEL_LIMIT} value={mesoDraft.label} placeholder="e.g. Work–college scheduling conflict" onChange={(event) => setMesoDraft((current) => ({ ...current, label: event.target.value }))} /></Field>
            <Field label="First Micro setting"><select value={mesoDraft.first} onChange={(event) => setMesoDraft((current) => ({ ...current, first: event.target.value }))}><option value="">Choose a Micro setting…</option>{mesoSettingNodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field>
            <Field label="Second Micro setting"><select value={mesoDraft.second} onChange={(event) => setMesoDraft((current) => ({ ...current, second: event.target.value }))}><option value="">Choose a different Micro setting…</option>{mesoSettingNodes.filter((node) => node.id !== mesoDraft.first).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field>
            <button className="button" type="button" onClick={addMesoLinkage}>Add mesosystem</button>
          </div>
        </section>}
        {step === 'nodes' && project.activeScale === 'exosphere' && <section className="elicitation-panel" aria-labelledby="add-institution-title">
          <p className="eyebrow">Exosphere institutions</p>
          <h2 id="add-institution-title">Add an institution</h2>
          <p className="lede">Name an institution whose decisions or actions affect an element already on the map. Then choose the institutional relationship and the affected element.</p>
          <div className="elicitation-panel__form">
            <Field label="Institution name"><input maxLength={NODE_LABEL_LIMIT} value={institutionDraft.label} placeholder="e.g. NYS OPWDD or MTA Access-A-Ride" onChange={(event) => setInstitutionDraft((current) => ({ ...current, label: event.target.value }))} /></Field>
            <Field label="Institution type"><select value={institutionDraft.type} onChange={(event) => setInstitutionDraft((current) => ({ ...current, type: event.target.value }))}>{EXOSPHERE_NODE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></Field>
            <Field label="Relationship"><select aria-label="Institutional relationship" value={institutionDraft.verb} onChange={(event) => setInstitutionDraft((current) => ({ ...current, verb: event.target.value }))}>{SCALE_VERB_LEXICONS.exosphere.map((verb) => <option key={verb}>{verb}</option>)}</select></Field>
            <Field label="Affected mapped element"><select aria-label="Mapped element affected by the institution" value={institutionDraft.anchor} onChange={(event) => setInstitutionDraft((current) => ({ ...current, anchor: event.target.value }))}><option value="">Choose a mapped element…</option>{liveMapNodes.filter((node) => node.scale !== 'macrosphere').map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field>
            <button className="button" type="button" onClick={addInstitution}>Add institution</button>
          </div>
        </section>}
        {step === 'nodes' && project.activeScale === 'macrosphere' && <section className="elicitation-panel" aria-labelledby="add-structure-title">
          <p className="eyebrow">Macrosphere items</p>
          <h2 id="add-structure-title">Add a Macrosphere item</h2>
          <p className="lede">Name a broader law, policy, economic condition, history, or cultural belief that affects more than one mapped element. Then select the affected elements.</p>
          <div className="elicitation-panel__form">
            <Field label="Name"><input maxLength={NODE_LABEL_LIMIT} value={structureDraft.label} placeholder="e.g. Americans with Disabilities Act, High housing and transportation costs" onChange={(event) => setStructureDraft((current) => ({ ...current, label: event.target.value }))} /></Field>
            <Field label="Type"><select value={structureDraft.type} onChange={(event) => setStructureDraft((current) => ({ ...current, type: event.target.value }))}>{MACRO_STRUCTURE_KINDS.map((type) => <option key={type}>{type}</option>)}</select></Field>
            <Field label="How it affects mapped elements"><select value={structureDraft.deontic} onChange={(event) => setStructureDraft((current) => ({ ...current, deontic: event.target.value }))}>{SCALE_VERB_LEXICONS.macrosphere.map((verb) => <option key={verb}>{verb}</option>)}</select></Field>
            <button className="button" type="button" onClick={addStructure}>Add Macrosphere item</button>
          </div>
        </section>}
        <div className="button-row candidate-step-actions">
          {counts[step].remaining > 0 && <button className="button button--secondary" type="button" onClick={() => keepAllRemaining(step)}>Keep all {counts[step].remaining} remaining</button>}
          {nextStep && <button className="button" type="button" onClick={() => setStep(nextStep)}>{nextStep === 'edges' ? 'Continue to direct relationships' : 'Continue to more relationships'}<Icon name="arrow" /></button>}
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
const WORLD_WIDTH = 3200;
const WORLD_HEIGHT = 2400;
const ECOLOGY_CENTER = Object.freeze({ x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 });
const ECOLOGY_BANDS = Object.freeze({
  micro: Object.freeze({ innerRx: 0, innerRy: 0, outerRx: 600, outerRy: 420 }),
  meso: Object.freeze({ innerRx: 600, innerRy: 420, outerRx: 910, outerRy: 650 }),
  exosphere: Object.freeze({ innerRx: 910, innerRy: 650, outerRx: 1220, outerRy: 880 }),
  macrosphere: Object.freeze({ innerRx: 1220, innerRy: 880, outerRx: 1540, outerRy: 1140 }),
});

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

// Andrew's monotone-chain convex hull, emitted as a closed path. The visual
// padding comes from a fat round-joined stroke in CSS (the Bubble-Sets move:
// a contour over the existing layout, never a rearrangement of it), so one-
// and two-member scopes render as dots and capsules for free.
function convexHullPath(points) {
  const unique = [...new Map(points.map((point) => [`${Math.round(point.x)}:${Math.round(point.y)}`, point])).values()];
  if (!unique.length) return '';
  if (unique.length === 1) return `M ${unique[0].x} ${unique[0].y} l 0.01 0`;
  const sorted = [...unique].sort((left, right) => left.x - right.x || left.y - right.y);
  const cross = (origin, a, b) => (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  const lower = [];
  sorted.forEach((point) => {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  });
  const upper = [];
  [...sorted].reverse().forEach((point) => {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  });
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return `M ${hull.map((point) => `${point.x} ${point.y}`).join(' L ')} Z`;
}

function mapNodeGeometry(label, phoneLayout = false) {
  const lines = splitMapLabel(label, phoneLayout ? 18 : 28);
  const lineHeight = phoneLayout ? 24 : 18;
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

function mapEdgeLabelGeometry(label, phoneLayout = false, scale = '') {
  // Phone labels already render at a readable effective size. The desktop
  // ecological fit is where ring-anchored callouts need larger type and
  // geometry — at every level whose relationships live in a band.
  const emphasizeMeso = ECOLOGY_MAP_SCALES.has(scale) && !phoneLayout;
  const fontSize = phoneLayout
    ? 26
    : (emphasizeMeso ? 24 : 18);
  const lines = splitMapLabel(label, emphasizeMeso ? (phoneLayout ? 22 : 18) : (phoneLayout ? 18 : 24));
  const lineHeight = emphasizeMeso ? (phoneLayout ? 34 : 29) : (phoneLayout ? 28 : 22);
  const longestLine = Math.max(...lines.map((line) => line.length));
  const width = clamp(
    longestLine * (emphasizeMeso ? (phoneLayout ? 15 : 13) : (phoneLayout ? 13 : 9.5)) + (phoneLayout ? 30 : 24),
    emphasizeMeso ? (phoneLayout ? 140 : 96) : (phoneLayout ? 110 : 88),
    emphasizeMeso ? (phoneLayout ? 310 : 280) : (phoneLayout ? 270 : 240),
  );
  const height = Math.max(
    emphasizeMeso ? (phoneLayout ? 60 : 38) : (phoneLayout ? 44 : 32),
    lines.length * lineHeight + (emphasizeMeso ? (phoneLayout ? 36 : 18) : (phoneLayout ? 32 : 10)),
  );
  return {
    fontSize,
    lines,
    lineHeight,
    width,
    height,
    startY: -((lines.length - 1) * lineHeight) / 2 + (emphasizeMeso ? (phoneLayout ? 10 : 7) : (phoneLayout ? 8 : 4)),
  };
}

function cardConnectionPoint(from, toward, geometry, padding = 0) {
  const deltaX = toward.x - from.x;
  const deltaY = toward.y - from.y;
  const absoluteX = Math.max(.001, Math.abs(deltaX));
  const absoluteY = Math.max(.001, Math.abs(deltaY));
  const factor = Math.min(
    .48,
    ((geometry.cardWidth / 2) + padding) / absoluteX,
    ((geometry.cardHeight / 2) + padding) / absoluteY,
  );
  return {
    x: from.x + deltaX * factor,
    y: from.y + deltaY * factor,
  };
}

function angularDistance(left, right) {
  const difference = Math.abs(left - right) % (Math.PI * 2);
  return Math.min(difference, Math.PI * 2 - difference);
}

// Every relationship callout stays on its band's middle ellipse — the one
// radius where the largest supported label still fits entirely inside the
// band — but its angle now follows its own endpoints, so leader lines stay
// short instead of crossing the whole map. A sweep pushes callouts clockwise
// past node cards and other callouts already occupying that stretch of band.
function ecologyCalloutAnchors(edges, nodes, positions, phoneLayout) {
  const anchors = new Map();
  const groups = new Map();
  edges.forEach((edge) => {
    const band = ECOLOGY_BANDS[edge.scale];
    if (!band || edge.scale === 'micro') return;
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) return;
    const group = groups.get(edge.scale) || [];
    group.push({ edge, source, target, index: group.length });
    groups.set(edge.scale, group);
  });
  groups.forEach((group, scale) => {
    const band = ECOLOGY_BANDS[scale];
    const radiusX = (band.innerRx + band.outerRx) / 2;
    const radiusY = (band.innerRy + band.outerRy) / 2;
    const sweepRadius = (radiusX + radiusY) / 2;
    const occupied = nodes
      .filter((node) => node.scale === scale && positions.has(node.id))
      .map((node) => {
        const position = positions.get(node.id);
        const geometry = mapNodeGeometry(node.label, phoneLayout);
        return {
          center: Math.atan2((position.y - ECOLOGY_CENTER.y) / radiusY, (position.x - ECOLOGY_CENTER.x) / radiusX),
          half: clamp((geometry.cardWidth / 2 + 26) / sweepRadius, 0.1, 0.8),
        };
      });
    const items = group.map(({ edge, source, target, index }) => {
      const midX = (source.x + target.x) / 2 - ECOLOGY_CENTER.x;
      const midY = (source.y + target.y) / 2 - ECOLOGY_CENTER.y;
      const fallback = group.length === 1
        ? Math.PI / 2
        : (-Math.PI / 3) + (index / Math.max(1, group.length - 1)) * (Math.PI * 5 / 3);
      const preferred = Math.hypot(midX, midY) >= 48 ? Math.atan2(midY / radiusY, midX / radiusX) : fallback;
      const geometry = mapEdgeLabelGeometry(edge.verb, phoneLayout, edge.scale);
      return { edge, preferred, half: clamp((geometry.width / 2 + 26) / sweepRadius, 0.14, 0.7) };
    });
    [...items].sort((left, right) => left.preferred - right.preferred || left.edge.id.localeCompare(right.edge.id)).forEach((item) => {
      let angle = item.preferred;
      let attempts = 0;
      while (occupied.some((zone) => angularDistance(angle, zone.center) < zone.half + item.half) && attempts < 70) {
        angle += 0.09;
        attempts += 1;
      }
      occupied.push({ center: angle, half: item.half });
      anchors.set(item.edge.id, {
        x: Math.round(ECOLOGY_CENTER.x + Math.cos(angle) * radiusX),
        y: Math.round(ECOLOGY_CENTER.y + Math.sin(angle) * radiusY),
      });
    });
  });
  return anchors;
}

function readableZoomFloor(phoneLayout) {
  return phoneLayout ? 1.5 : 0.85;
}

function overviewReadingZoomFloor(layer, phoneLayout) {
  if (phoneLayout) return readableZoomFloor(true);
  return {
    micro: 0.72,
    meso: 0.58,
    exosphere: 0.5,
    macrosphere: 0.42,
    all: 0.42,
  }[layer] || 0.58;
}

function arrangedEcologyPositions(nodes, phoneLayout = false) {
  const positions = new Map();
  SCALE_ORDER.forEach((scale) => {
    const band = ECOLOGY_BANDS[scale];
    if (!band) return;
    const items = nodes.filter((node) => node.scale === scale)
      .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
    if (scale === 'micro' && items.length === 1) {
      positions.set(items[0].id, { ...ECOLOGY_CENTER });
      return;
    }
    if (scale === 'micro') {
      const columns = Math.min(phoneLayout ? 2 : 3, items.length);
      const rows = Math.ceil(items.length / columns);
      const columnPitch = phoneLayout ? 284 : 248;
      const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(...items
        .slice(row * columns, (row + 1) * columns)
        .map((node) => mapNodeGeometry(node.label, phoneLayout).cardHeight)));
      const rowGap = phoneLayout ? 24 : 20;
      const contentHeight = rowHeights.reduce((total, height) => total + height, 0) + rowGap * Math.max(0, rows - 1);
      let cursorY = ECOLOGY_CENTER.y - contentHeight / 2;
      rowHeights.forEach((rowHeight, row) => {
        const rowItems = items.slice(row * columns, (row + 1) * columns);
        rowItems.forEach((node, column) => {
          const rawPosition = {
            x: Math.round(ECOLOGY_CENTER.x + (column - (rowItems.length - 1) / 2) * columnPitch),
            y: Math.round(cursorY + rowHeight / 2),
          };
          positions.set(node.id, constrainToEcologyBand(node, rawPosition.x, rawPosition.y, mapNodeGeometry(node.label, phoneLayout)));
        });
        cursorY += rowHeight + rowGap;
      });
      return;
    }
    if (items.length === 1) {
      // Keep a sparse outer layer in a visible side field. The generic
      // one-item sweep resolves to the bottom of the ring, where the card can
      // sit behind the persistent map controls and appear to be missing.
      const node = items[0];
      const baseRx = band.innerRx ? (band.innerRx + band.outerRx) / 2 : band.outerRx * .58;
      const rawPosition = {
        x: Math.round(ECOLOGY_CENTER.x + baseRx),
        y: ECOLOGY_CENTER.y,
      };
      positions.set(node.id, constrainToEcologyBand(node, rawPosition.x, rawPosition.y, mapNodeGeometry(node.label, phoneLayout)));
      return;
    }
    const readableSector = items.length <= 6;
    const sectorSweep = Math.min(1.35, Math.max(.55, (items.length - 1) * .34));
    items.forEach((node, index) => {
      // Keep each filtered outer layer in a readable right-hand sector. The
      // whole-ring view remains available through Center map, while the
      // default view can show the layer's nodes and their inward connections
      // together instead of scattering them to opposite sides of the ring.
      const angle = readableSector
        ? (-sectorSweep / 2) + (index / Math.max(1, items.length - 1)) * sectorSweep
        : (-Math.PI / 2) + ((index + .5) / items.length) * Math.PI * 2;
      const baseRx = band.innerRx ? (band.innerRx + band.outerRx) / 2 : band.outerRx * .58;
      const baseRy = band.innerRy ? (band.innerRy + band.outerRy) / 2 : band.outerRy * .58;
      const rawPosition = {
        x: Math.round(ECOLOGY_CENTER.x + Math.cos(angle) * baseRx),
        y: Math.round(ECOLOGY_CENTER.y + Math.sin(angle) * baseRy),
      };
      positions.set(node.id, constrainToEcologyBand(node, rawPosition.x, rawPosition.y, mapNodeGeometry(node.label, phoneLayout)));
    });
  });
  return positions;
}

function ecologyLayerLabelBounds(scale) {
  const band = ECOLOGY_BANDS[scale];
  if (!band) return null;
  const label = SCALES[scale]?.label || scale;
  const width = Math.max(116, label.length * 10 + 34);
  const centerY = ECOLOGY_CENTER.y - band.outerRy + 34;
  return {
    left: ECOLOGY_CENTER.x - width / 2,
    right: ECOLOGY_CENTER.x + width / 2,
    top: centerY - 18,
    bottom: centerY + 18,
  };
}

function ecologyCardBounds(position, geometry, padding = 0) {
  return {
    left: position.x - geometry.cardWidth / 2 - padding,
    right: position.x + geometry.cardWidth / 2 + padding,
    top: position.y - geometry.cardHeight / 2 - padding,
    bottom: position.y + geometry.cardHeight / 2 + padding,
  };
}

function ecologyBoundsIntersect(left, right) {
  return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
}

function segmentCrossesBoundsInterior(start, end, bounds) {
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

// Place a complete relationship label on a nearby, collision-free bend. The
// same geometry serves compact focus views and Micro overviews, where a raw
// endpoint midpoint can otherwise land underneath either card.
function focusedEcologyCalloutAnchors(edges, nodes, positions, phoneLayout = false, layoutBounds = null, reservedBounds = [], containsBounds = null) {
  if (phoneLayout && !layoutBounds) return new Map();
  const anchors = new Map();
  const occupiedLabels = [...reservedBounds];
  const nodeBounds = new Map(nodes.map((node) => {
    const position = positions.get(node.id);
    return [node.id, position ? ecologyCardBounds(position, mapNodeGeometry(node.label, phoneLayout), phoneLayout ? 14 : 10) : null];
  }));
  const allNodeBounds = [...nodeBounds.values()].filter(Boolean);
  const spatialCellSize = 160;
  const cellsForBounds = (bounds) => {
    const cells = [];
    const firstColumn = Math.floor(bounds.left / spatialCellSize);
    const lastColumn = Math.floor(bounds.right / spatialCellSize);
    const firstRow = Math.floor(bounds.top / spatialCellSize);
    const lastRow = Math.floor(bounds.bottom / spatialCellSize);
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      for (let row = firstRow; row <= lastRow; row += 1) cells.push(`${column}:${row}`);
    }
    return cells;
  };
  const insertBounds = (grid, bounds) => cellsForBounds(bounds).forEach((cell) => {
    const entries = grid.get(cell) || [];
    entries.push(bounds);
    grid.set(cell, entries);
  });
  const intersectsGrid = (grid, bounds) => {
    const candidates = new Set(cellsForBounds(bounds).flatMap((cell) => grid.get(cell) || []));
    return [...candidates].some((entry) => ecologyBoundsIntersect(bounds, entry));
  };
  const nodeGrid = new Map();
  const labelGrid = new Map();
  allNodeBounds.forEach((bounds) => insertBounds(nodeGrid, bounds));
  occupiedLabels.forEach((bounds) => insertBounds(labelGrid, bounds));
  const insideMargin = 16;
  const available = layoutBounds || { left: 0, right: GRAPH_WIDTH, top: 0, bottom: GRAPH_HEIGHT };
  const candidateMetrics = (bounds) => {
    const padded = { left: bounds.left - 6, right: bounds.right + 6, top: bounds.top - 6, bottom: bounds.bottom + 6 };
    const nodeCollision = intersectsGrid(nodeGrid, padded);
    const labelCollision = intersectsGrid(labelGrid, padded);
    const outside = Math.max(0, available.left + insideMargin - bounds.left)
      + Math.max(0, bounds.right - (available.right - insideMargin))
      + Math.max(0, available.top + insideMargin - bounds.top)
      + Math.max(0, bounds.bottom - (available.bottom - insideMargin));
    const contained = !containsBounds || containsBounds(bounds);
    return { collisionFree: !nodeCollision && !labelCollision, contained, outside };
  };

  [...edges].sort((left, right) => left.id.localeCompare(right.id)).forEach((edge) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    const sourceBounds = nodeBounds.get(edge.source);
    const targetBounds = nodeBounds.get(edge.target);
    if (!source || !target || !sourceBounds || !targetBounds) return;
    const geometry = mapEdgeLabelGeometry(edge.verb, phoneLayout, edge.scale);
    const midX = (source.x + target.x) / 2;
    const midY = (source.y + target.y) / 2;
    const clearance = 18;
    const halfWidth = geometry.width / 2;
    const halfHeight = geometry.height / 2;
    const deltaX = target.x - source.x;
    const deltaY = target.y - source.y;
    const distance = Math.max(1, Math.hypot(deltaX, deltaY));
    const perpendicular = { x: -deltaY / distance, y: deltaX / distance };
    const perpendicularOffset = Math.max(70, halfHeight + 44);
    const routeIsClear = (candidate) => (
      !segmentCrossesBoundsInterior(source, candidate, targetBounds)
      && !segmentCrossesBoundsInterior(candidate, target, sourceBounds)
    );
    const localCandidates = [
      { x: midX, y: midY },
      { x: midX, y: Math.min(sourceBounds.top, targetBounds.top) - halfHeight - clearance },
      { x: midX, y: Math.max(sourceBounds.bottom, targetBounds.bottom) + halfHeight + clearance },
      { x: Math.min(sourceBounds.left, targetBounds.left) - halfWidth - clearance, y: midY },
      { x: Math.max(sourceBounds.right, targetBounds.right) + halfWidth + clearance, y: midY },
      { x: midX + perpendicular.x * perpendicularOffset, y: midY + perpendicular.y * perpendicularOffset },
      { x: midX - perpendicular.x * perpendicularOffset, y: midY - perpendicular.y * perpendicularOffset },
      { x: clamp(midX, available.left + halfWidth + insideMargin, available.right - halfWidth - insideMargin), y: available.top + halfHeight + insideMargin },
      { x: clamp(midX, available.left + halfWidth + insideMargin, available.right - halfWidth - insideMargin), y: available.bottom - halfHeight - insideMargin },
      { x: available.left + halfWidth + insideMargin, y: clamp(midY, available.top + halfHeight + insideMargin, available.bottom - halfHeight - insideMargin) },
      { x: available.right - halfWidth - insideMargin, y: clamp(midY, available.top + halfHeight + insideMargin, available.bottom - halfHeight - insideMargin) },
    ];
    // Dense one-hop neighborhoods can exhaust the first screenful of slots.
    // Expand deterministically around the relationship midpoint until a clear
    // lane appears; these coordinates may leave the nominal 840x540 window,
    // and the detail viewport explicitly fits their bounds below.
    const searchRings = Math.min(24, Math.max(8, edges.length * 2));
    for (let ring = 1; ring <= searchRings; ring += 1) {
      const radiusX = halfWidth + clearance + ring * 48;
      const radiusY = halfHeight + clearance + ring * 42;
      for (let slot = 0; slot < 16; slot += 1) {
        const angle = (slot / 16) * Math.PI * 2;
        localCandidates.push({
          x: midX + Math.cos(angle) * radiusX,
          y: midY + Math.sin(angle) * radiusY,
        });
      }
    }
    const ranked = localCandidates.map((candidate, index) => {
      const bounds = {
        left: candidate.x - halfWidth,
        right: candidate.x + halfWidth,
        top: candidate.y - halfHeight,
        bottom: candidate.y + halfHeight,
      };
      const pathLength = Math.hypot(candidate.x - source.x, candidate.y - source.y)
        + Math.hypot(target.x - candidate.x, target.y - candidate.y);
      const metrics = candidateMetrics(bounds);
      return {
        candidate,
        bounds,
        collisionFree: metrics.collisionFree,
        contained: metrics.contained,
        clear: metrics.contained && metrics.collisionFree && routeIsClear(candidate),
        score: metrics.outside * 10_000 + pathLength + index / 100,
      };
    }).sort((left, right) => left.score - right.score);
    let chosen = ranked.find((entry) => entry.clear);
    if (!chosen && containsBounds) {
      // Prefer keeping the complete label in its own layer even if the leader
      // has to cross a card. Never trade label/card clearance for containment.
      chosen = ranked.find((entry) => entry.contained && entry.collisionFree);
    }
    if (!chosen) chosen = ranked.find((entry) => entry.collisionFree && routeIsClear(entry.candidate));
    if (!chosen) {
      // A final spill lane below every occupied rectangle is guaranteed clear,
      // even for unusually dense imported maps. Fitting includes this label,
      // so the student sees the complete relationship instead of a collision.
      const occupiedBottom = Math.max(...allNodeBounds.map((bounds) => bounds.bottom), ...occupiedLabels.map((bounds) => bounds.bottom));
      const spillY = occupiedBottom + clearance + halfHeight;
      const occupiedLeft = Math.min(...allNodeBounds.map((bounds) => bounds.left), ...occupiedLabels.map((bounds) => bounds.left));
      const occupiedRight = Math.max(...allNodeBounds.map((bounds) => bounds.right), ...occupiedLabels.map((bounds) => bounds.right));
      const spillCandidates = [
        { x: midX, y: spillY },
        { x: occupiedLeft - clearance - halfWidth, y: spillY },
        { x: occupiedRight + clearance + halfWidth, y: spillY },
      ];
      for (let lane = 1; lane <= 24; lane += 1) {
        spillCandidates.push({ x: midX - lane * (halfWidth + clearance), y: spillY });
        spillCandidates.push({ x: midX + lane * (halfWidth + clearance), y: spillY });
      }
      const candidate = spillCandidates.find(routeIsClear) || spillCandidates.at(-1);
      chosen = {
        candidate,
        bounds: {
          left: candidate.x - halfWidth,
          right: candidate.x + halfWidth,
          top: candidate.y - halfHeight,
          bottom: candidate.y + halfHeight,
        },
      };
    }
    occupiedLabels.push(chosen.bounds);
    insertBounds(labelGrid, chosen.bounds);
    anchors.set(edge.id, { x: Math.round(chosen.candidate.x), y: Math.round(chosen.candidate.y) });
  });
  return anchors;
}

function calloutBounds(anchor, geometry, padding = 0) {
  return {
    left: anchor.x - geometry.width / 2 - padding,
    right: anchor.x + geometry.width / 2 + padding,
    top: anchor.y - geometry.height / 2 - padding,
    bottom: anchor.y + geometry.height / 2 + padding,
  };
}

// Relationship wording belongs in the corridor between its endpoint cards.
// Search that corridor in deterministic parallel lanes, reserving every label
// and routed segment as it is placed. Callers can temporarily spread nodes and
// retry when a pair is too close to hold the complete, untruncated wording.
function betweenEndpointCalloutLayout(edges, nodes, positions, phoneLayout = false, { allowRouteUnderLabels = false } = {}) {
  const anchors = new Map();
  const bounds = new Map();
  const paths = new Map();
  const unplaced = new Set();
  const nodeBounds = new Map(nodes.map((node) => {
    const position = positions.get(node.id);
    return [node.id, position ? ecologyCardBounds(position, mapNodeGeometry(node.label, phoneLayout), phoneLayout ? 14 : 10) : null];
  }));
  const occupiedLabels = [];
  const occupiedSegments = [];
  const records = edges.flatMap((edge) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    const sourceNode = nodes.find((node) => node.id === edge.source);
    const targetNode = nodes.find((node) => node.id === edge.target);
    if (!source || !target || !sourceNode || !targetNode) return [];
    const sourceGeometry = mapNodeGeometry(sourceNode.label, phoneLayout);
    const targetGeometry = mapNodeGeometry(targetNode.label, phoneLayout);
    const geometry = mapEdgeLabelGeometry(edge.verb, phoneLayout, edge.scale);
    const deltaX = target.x - source.x;
    const deltaY = target.y - source.y;
    const distance = Math.max(1, Math.hypot(deltaX, deltaY));
    const unit = { x: deltaX / distance, y: deltaY / distance };
    const perpendicular = { x: -unit.y, y: unit.x };
    const projectedLabelHalf = geometry.width / 2 * Math.abs(unit.x) + geometry.height / 2 * Math.abs(unit.y);
    const projectedSourceHalf = sourceGeometry.cardWidth / 2 * Math.abs(unit.x) + sourceGeometry.cardHeight / 2 * Math.abs(unit.y);
    const projectedTargetHalf = targetGeometry.cardWidth / 2 * Math.abs(unit.x) + targetGeometry.cardHeight / 2 * Math.abs(unit.y);
    const clearance = phoneLayout ? 18 : 12;
    const firstAlong = projectedSourceHalf + projectedLabelHalf + clearance;
    const lastAlong = distance - projectedTargetHalf - projectedLabelHalf - clearance;
    return [{
      edge, source, target, sourceGeometry, targetGeometry, geometry, distance, unit, perpendicular,
      firstAlong, lastAlong, slack: lastAlong - firstAlong,
    }];
  }).sort((left, right) => left.slack - right.slack || left.edge.id.localeCompare(right.edge.id));

  const crossesAny = (start, end, candidates) => candidates.some((candidate) => segmentCrossesBoundsInterior(start, end, candidate));
  records.forEach((record) => {
    const {
      edge, source, target, sourceGeometry, targetGeometry, geometry, distance, unit, perpendicular,
      firstAlong, lastAlong,
    } = record;
    if (lastAlong < firstAlong) {
      unplaced.add(edge.id);
      return;
    }
    const alongSpan = Math.max(0, lastAlong - firstAlong);
    const midpoint = distance / 2;
    const alongFractions = allowRouteUnderLabels
      ? [.5, .35, .65, .2, .8, .1, .9, 0, 1]
      : [.5, .3, .7, 0, 1];
    const alongCandidates = alongFractions
      .map((fraction) => firstAlong + alongSpan * fraction)
      .map((value) => clamp(value, firstAlong, lastAlong))
      .filter((value, index, values) => values.findIndex((candidate) => Math.abs(candidate - value) < .5) === index);
    const perpendicularHalf = geometry.width / 2 * Math.abs(perpendicular.x) + geometry.height / 2 * Math.abs(perpendicular.y);
    const laneStep = perpendicularHalf * 2 + (phoneLayout ? 18 : 12);
    const maximumOffset = Math.max(laneStep, Math.min(
      allowRouteUnderLabels ? (phoneLayout ? 520 : 380) : (phoneLayout ? 300 : 220),
      distance * .46,
    ));
    const laneOffsets = [0];
    for (let lane = 1; lane * laneStep <= maximumOffset + .5; lane += 1) {
      laneOffsets.push(lane * laneStep, -lane * laneStep);
    }
    const candidates = [];
    laneOffsets.forEach((offset, laneIndex) => alongCandidates.forEach((along, alongIndex) => {
      const anchor = {
        x: source.x + unit.x * along + perpendicular.x * offset,
        y: source.y + unit.y * along + perpendicular.y * offset,
      };
      const labelBounds = calloutBounds(anchor, geometry);
      const paddedLabelBounds = calloutBounds(anchor, geometry, phoneLayout ? 10 : 7);
      const sourcePoint = cardConnectionPoint(source, anchor, sourceGeometry);
      const targetPoint = cardConnectionPoint(target, anchor, targetGeometry, phoneLayout ? 12 : 7);
      const otherNodeBounds = [...nodeBounds.entries()]
        .filter(([id, candidate]) => candidate && id !== edge.source && id !== edge.target)
        .map(([, candidate]) => candidate);
      const routeBlocked = crossesAny(sourcePoint, anchor, otherNodeBounds)
        || crossesAny(anchor, targetPoint, otherNodeBounds)
        || (!allowRouteUnderLabels && (
          crossesAny(sourcePoint, anchor, occupiedLabels)
          || crossesAny(anchor, targetPoint, occupiedLabels)
          || occupiedSegments.some(([start, end]) => segmentCrossesBoundsInterior(start, end, paddedLabelBounds))
        ));
      const nodeCollision = [...nodeBounds.values()].filter(Boolean).some((candidate) => ecologyBoundsIntersect(paddedLabelBounds, candidate));
      const labelCollision = occupiedLabels.some((candidate) => ecologyBoundsIntersect(paddedLabelBounds, candidate));
      candidates.push({
        anchor,
        labelBounds,
        sourcePoint,
        targetPoint,
        clear: !routeBlocked && !nodeCollision && !labelCollision,
        score: Math.abs(offset) * 4 + Math.abs(along - midpoint) + laneIndex / 100 + alongIndex / 1000,
      });
    }));
    const chosen = candidates.filter((candidate) => candidate.clear).sort((left, right) => left.score - right.score)[0];
    if (!chosen) {
      unplaced.add(edge.id);
      return;
    }
    const roundedAnchor = { x: Math.round(chosen.anchor.x), y: Math.round(chosen.anchor.y) };
    const roundedBounds = calloutBounds(roundedAnchor, geometry);
    const roundedSource = cardConnectionPoint(source, roundedAnchor, sourceGeometry);
    const roundedTarget = cardConnectionPoint(target, roundedAnchor, targetGeometry, phoneLayout ? 12 : 7);
    anchors.set(edge.id, roundedAnchor);
    bounds.set(edge.id, roundedBounds);
    paths.set(edge.id, { source: roundedSource, target: roundedTarget });
    occupiedLabels.push(calloutBounds(roundedAnchor, geometry, phoneLayout ? 10 : 7));
    occupiedSegments.push([roundedSource, roundedAnchor], [roundedAnchor, roundedTarget]);
  });
  return { anchors, bounds, paths, unplaced };
}

function expandedConnectionLayout(nodes, edges, phoneLayout = false, { arrangedOnly = false } = {}) {
  const currentPositions = new Map(nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
  const arrangedPositions = arrangedMapPositions(
    nodes,
    new Set(nodes.map((node) => node.scale)).size > 1,
    phoneLayout ? 3 : 5,
    phoneLayout,
  );
  // A connection preview is an overview of the decisions on this screen, not
  // a miniature of a potentially stale saved canvas. Always starting that
  // preview from the compact arrangement prevents an old pan/layout from
  // pushing one cluster into a corner and leaving most of the preview empty.
  const degree = new Map(nodes.map((node) => [node.id, 0]));
  edges.forEach((edge) => {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  });
  const degreeOrder = [...nodes].sort((left, right) => (
    (degree.get(right.id) || 0) - (degree.get(left.id) || 0)
    || left.label.localeCompare(right.label)
    || left.id.localeCompare(right.id)
  ));
  const radialSlots = degreeOrder.flatMap((_, index) => index < Math.ceil(degreeOrder.length / 2)
    ? [index, index + Math.ceil(degreeOrder.length / 2)].filter((slot) => slot < degreeOrder.length)
    : []);
  const radialRadiusX = Math.max(phoneLayout ? 500 : 420, degreeOrder.length * (phoneLayout ? 46 : 36));
  const radialRadiusY = Math.max(phoneLayout ? 360 : 300, degreeOrder.length * (phoneLayout ? 32 : 24));
  const radialPositions = new Map(degreeOrder.map((node, index) => {
    const angle = -Math.PI / 2 + radialSlots[index] / Math.max(1, degreeOrder.length) * Math.PI * 2;
    return [node.id, {
      x: Math.round(GRAPH_WIDTH / 2 + Math.cos(angle) * radialRadiusX),
      y: Math.round(GRAPH_HEIGHT / 2 + Math.sin(angle) * radialRadiusY),
    }];
  }));
  const neighborIds = new Map(nodes.map((node) => [node.id, []]));
  edges.forEach((edge) => {
    if (neighborIds.has(edge.source) && neighborIds.has(edge.target)) {
      neighborIds.get(edge.source).push(edge.target);
      neighborIds.get(edge.target).push(edge.source);
    }
  });
  const sides = [[], []];
  const sideById = new Map();
  degreeOrder.forEach((node, index) => {
    const neighborSides = (neighborIds.get(node.id) || []).map((id) => sideById.get(id)).filter((side) => side !== undefined);
    const connectionsToLeft = neighborSides.filter((side) => side === 0).length;
    const connectionsToRight = neighborSides.length - connectionsToLeft;
    const side = index === 0
      ? 0
      : connectionsToLeft !== connectionsToRight
        ? (connectionsToLeft > connectionsToRight ? 1 : 0)
        : (sides[0].length <= sides[1].length ? 0 : 1);
    sides[side].push(node);
    sideById.set(node.id, side);
  });
  const partitionedPositions = new Map();
  const columnGap = phoneLayout ? 1080 : 840;
  const rowPitch = phoneLayout ? 126 : 108;
  sides.forEach((items, side) => items.forEach((node, index) => partitionedPositions.set(node.id, {
    x: Math.round(GRAPH_WIDTH / 2 + (side ? 1 : -1) * columnGap / 2),
    y: Math.round(GRAPH_HEIGHT / 2 + (index - (items.length - 1) / 2) * rowPitch),
  })));
  const staggeredGrids = [3, 2].map((maximumColumns) => {
    const grid = arrangedMapPositions(nodes, false, maximumColumns, phoneLayout);
    const rows = [...new Set([...grid.values()].map(({ y }) => y))].sort((left, right) => left - right);
    return new Map([...grid].map(([id, position]) => {
      const row = rows.indexOf(position.y);
      return [id, {
        x: position.x + (row % 2 ? (phoneLayout ? 154 : 134) : 0),
        y: position.y,
      }];
    }));
  });
  const previewBases = [partitionedPositions, radialPositions, ...staggeredGrids, arrangedPositions];
  const bases = arrangedOnly ? previewBases : mapNodesOverlap(nodes, phoneLayout) ? [arrangedPositions] : [currentPositions, arrangedPositions];
  let fallback = { positions: bases[0], ...betweenEndpointCalloutLayout(edges, nodes, bases[0], phoneLayout, { allowRouteUnderLabels: arrangedOnly }) };
  for (const base of bases) {
    const center = {
      x: [...base.values()].reduce((total, position) => total + position.x, 0) / Math.max(1, base.size),
      y: [...base.values()].reduce((total, position) => total + position.y, 0) / Math.max(1, base.size),
    };
    const expansionFactors = arrangedOnly
      ? [1, 1.12, 1.25, 1.42, 1.62, 1.85, 2.1, 2.4, 2.75]
      : [1, 1.15, 1.35, 1.6, 1.9, 2.25, 2.7];
    for (const factor of expansionFactors) {
      const positions = new Map([...base].map(([id, position]) => [id, {
        x: Math.round(center.x + (position.x - center.x) * factor),
        y: Math.round(center.y + (position.y - center.y) * factor),
      }]));
      const positionedNodes = nodes.map((node) => ({ ...node, ...positions.get(node.id) }));
      if (mapNodesOverlap(positionedNodes, phoneLayout)) continue;
      const layout = betweenEndpointCalloutLayout(edges, positionedNodes, positions, phoneLayout, { allowRouteUnderLabels: arrangedOnly });
      fallback = layout.anchors.size > fallback.anchors.size ? { positions, ...layout } : fallback;
      if (!layout.unplaced.size) return { positions, ...layout };
    }
  }
  return fallback;
}

function focusedEcologyCalloutBounds(edges, nodes, positions, phoneLayout = false) {
  const shownEdges = edges.filter((edge) => edge.showLabel !== false);
  return [...betweenEndpointCalloutLayout(shownEdges, nodes, positions, phoneLayout).bounds.values()];
}

function constrainWithinEcologyBand(node, x, y, geometry) {
  const band = ECOLOGY_BANDS[node.scale];
  if (!band) return { x, y };
  const outerRx = Math.max(40, band.outerRx - geometry.cardWidth / 2 - 16);
  const outerRy = Math.max(40, band.outerRy - geometry.cardHeight / 2 - 16);
  const innerRx = band.innerRx ? band.innerRx + geometry.cardWidth / 2 + 16 : 0;
  const innerRy = band.innerRy ? band.innerRy + geometry.cardHeight / 2 + 16 : 0;
  let dx = x - ECOLOGY_CENTER.x;
  let dy = y - ECOLOGY_CENTER.y;
  if (dx === 0 && dy === 0 && innerRx) dx = innerRx;
  const outerDistance = Math.hypot(dx / outerRx, dy / outerRy);
  if (outerDistance > 1) {
    dx /= outerDistance;
    dy /= outerDistance;
  }
  if (innerRx && innerRy) {
    const innerDistance = Math.hypot(dx / innerRx, dy / innerRy);
    if (innerDistance < 1) {
      const multiplier = 1 / Math.max(.001, innerDistance);
      dx *= multiplier;
      dy *= multiplier;
    }
  }
  return { x: Math.round(ECOLOGY_CENTER.x + dx), y: Math.round(ECOLOGY_CENTER.y + dy) };
}

function constrainToEcologyBand(node, x, y, geometry) {
  const constrained = constrainWithinEcologyBand(node, x, y, geometry);
  const labelBounds = ecologyLayerLabelBounds(node.scale);
  if (!labelBounds || !ecologyBoundsIntersect(ecologyCardBounds(constrained, geometry, 10), labelBounds)) return constrained;

  const clearance = 16;
  const candidates = [
    { x: constrained.x, y: labelBounds.bottom + geometry.cardHeight / 2 + clearance },
    { x: labelBounds.left - geometry.cardWidth / 2 - clearance, y: constrained.y },
    { x: labelBounds.right + geometry.cardWidth / 2 + clearance, y: constrained.y },
    { x: constrained.x, y: labelBounds.top - geometry.cardHeight / 2 - clearance },
  ]
    .map((candidate) => constrainWithinEcologyBand(node, candidate.x, candidate.y, geometry))
    .filter((candidate) => !ecologyBoundsIntersect(ecologyCardBounds(candidate, geometry, 10), labelBounds))
    .sort((left, right) => Math.hypot(left.x - constrained.x, left.y - constrained.y) - Math.hypot(right.x - constrained.x, right.y - constrained.y));
  return candidates[0] || constrained;
}

function EcologicalLayerBackdrop({ layers, visibleLayer }) {
  const available = new Set(layers);
  return <g className="ecology-layers" aria-hidden="true">
    {[...SCALE_ORDER].reverse().filter((scale) => available.has(scale) && ECOLOGY_BANDS[scale]).map((scale) => {
      const band = ECOLOGY_BANDS[scale];
      const label = SCALES[scale]?.label || scale;
      const active = visibleLayer === 'all' || visibleLayer === scale;
      const labelWidth = Math.max(116, label.length * 10 + 34);
      const labelY = ECOLOGY_CENTER.y - band.outerRy + 34;
      return <g key={scale} data-ecology-layer={scale} className={`ecology-layer ecology-layer--${scale} ${active ? 'is-visible' : 'is-muted'}`}>
        <ellipse cx={ECOLOGY_CENTER.x} cy={ECOLOGY_CENTER.y} rx={band.outerRx} ry={band.outerRy} />
        <g className="ecology-layer__label" transform={`translate(${ECOLOGY_CENTER.x} ${labelY})`}>
          <rect x={-labelWidth / 2} y="-18" width={labelWidth} height="36" rx="18" />
          <text y="5">{label}</text>
        </g>
      </g>;
    })}
  </g>;
}

function arrangedMapPositions(nodes, groupByScale, maximumColumns = 5, phoneLayout = false) {
  if (!nodes.length) return new Map();
  const sortNodes = (items) => [...items].sort((a, b) => a.y - b.y || a.label.localeCompare(b.label));
  const orderedNodes = groupByScale
    ? SCALE_ORDER.flatMap((scale) => sortNodes(nodes.filter((node) => node.scale === scale)))
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

function arrangedPhoneOverviewPositions(nodes) {
  if (!nodes.length) return new Map();
  const orderedNodes = [...nodes].sort((left, right) => (
    left.y - right.y
    || left.x - right.x
    || left.label.localeCompare(right.label)
    || left.id.localeCompare(right.id)
  ));
  const columns = Math.min(2, orderedNodes.length);
  const columnPitch = 284;
  const rows = Math.ceil(orderedNodes.length / columns);
  const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(...orderedNodes
    .slice(row * columns, (row + 1) * columns)
    .map((node) => mapNodeGeometry(node.label, true).cardHeight)));
  const rowGap = 24;
  const contentHeight = rowHeights.reduce((total, height) => total + height, 0) + rowGap * Math.max(0, rows - 1);
  const positions = new Map();
  let cursorY = GRAPH_HEIGHT / 2 - contentHeight / 2;
  rowHeights.forEach((rowHeight, row) => {
    const rowItems = orderedNodes.slice(row * columns, (row + 1) * columns);
    rowItems.forEach((node, column) => positions.set(node.id, {
      x: Math.round(GRAPH_WIDTH / 2 + (column - (rowItems.length - 1) / 2) * columnPitch),
      y: Math.round(cursorY + rowHeight / 2),
    }));
    cursorY += rowHeight + rowGap;
  });
  return positions;
}

function arrangedFocusedEcologyPositions(nodes, phoneLayout = false) {
  if (phoneLayout) return arrangedPhoneOverviewPositions(nodes);
  const orderedNodes = [...nodes].sort((left, right) => left.y - right.y || left.label.localeCompare(right.label));
  const columns = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(orderedNodes.length)), orderedNodes.length));
  const positions = arrangedMapPositions(nodes, false, columns, false);
  orderedNodes.forEach((node, index) => {
    const position = positions.get(node.id);
    if (!position) return;
    const column = index % columns;
    position.y += Math.round((column - (columns - 1) / 2) * 18);
  });
  return positions;
}

function arrangedPhoneRelationshipPositions(nodes, edge) {
  if (!edge) return null;
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  if (!source || !target) return null;
  const sourceGeometry = mapNodeGeometry(source.label, true);
  const targetGeometry = mapNodeGeometry(target.label, true);
  const relationshipGeometry = mapEdgeLabelGeometry(edge.verb, true, edge.scale);
  const gap = Math.max(relationshipGeometry.height + 28, 96);
  const totalHeight = sourceGeometry.cardHeight + gap + targetGeometry.cardHeight;
  const top = GRAPH_HEIGHT / 2 - totalHeight / 2;
  const horizontalOffset = 18;
  return new Map([
    [source.id, { x: GRAPH_WIDTH / 2 - horizontalOffset, y: Math.round(top + sourceGeometry.cardHeight / 2) }],
    [target.id, { x: GRAPH_WIDTH / 2 + horizontalOffset, y: Math.round(top + sourceGeometry.cardHeight + gap + targetGeometry.cardHeight / 2) }],
  ]);
}

function arrangedFocusedRelationshipPositions(nodes, edge, phoneLayout = false) {
  if (!edge) return null;
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  if (!source || !target) return null;
  if (phoneLayout) return arrangedPhoneRelationshipPositions(nodes, edge);
  const sourceGeometry = mapNodeGeometry(source.label, false);
  const targetGeometry = mapNodeGeometry(target.label, false);
  const relationshipGeometry = mapEdgeLabelGeometry(edge.verb, false, edge.scale);
  // Detail mode temporarily hides the ecology backdrop, so the two endpoint
  // cards can use the full canvas. Size the corridor from the complete label
  // instead of letting a dense overview's compact band layout follow focus.
  const distance = sourceGeometry.cardWidth / 2
    + relationshipGeometry.width
    + targetGeometry.cardWidth / 2
    + 52;
  return new Map([
    [source.id, { x: Math.round(GRAPH_WIDTH / 2 - distance / 2), y: GRAPH_HEIGHT / 2 }],
    [target.id, { x: Math.round(GRAPH_WIDTH / 2 + distance / 2), y: GRAPH_HEIGHT / 2 }],
  ]);
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

function mapNeedsEcologyLayout(nodes, phoneLayout = false) {
  if (!nodes.length) return false;
  if (mapNodesOverlap(nodes, phoneLayout)) return true;
  return nodes.some((node) => {
    if (!ECOLOGY_BANDS[node.scale]) return true;
    const constrained = constrainToEcologyBand(node, node.x, node.y, mapNodeGeometry(node.label, phoneLayout));
    return constrained.x !== node.x || constrained.y !== node.y;
  });
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
  const layout = expandedConnectionLayout(nodes, shownEdges, false, { arrangedOnly: true });
  const previewNodes = nodes.map((node) => ({ ...node, ...(layout.positions.get(node.id) || {}) }));
  const previewNodeById = new Map(previewNodes.map((node) => [node.id, node]));
  const shownEdgeLayouts = shownEdges.flatMap((edge) => {
    const source = previewNodeById.get(edge.source);
    const target = previewNodeById.get(edge.target);
    const anchor = layout.anchors.get(edge.id);
    const route = layout.paths.get(edge.id);
    if (!source || !target || !anchor || !route) return [];
    return [{
      edge,
      source,
      target,
      anchor,
      route,
      proposed: suggestions.some((suggestion) => suggestion.id === edge.id),
    }];
  });
  const nodeBounds = previewNodes.map((node) => {
    const geometry = mapNodeGeometry(node.label);
    return {
      left: node.x + geometry.cardX,
      right: node.x + geometry.cardX + geometry.cardWidth,
      top: node.y + geometry.cardY,
      bottom: node.y + geometry.cardY + geometry.cardHeight,
    };
  });
  const contentBounds = [...nodeBounds, ...layout.bounds.values()];
  const previewViewBox = contentBounds.length
    ? (() => {
      const rawMinX = Math.min(...contentBounds.map(({ left }) => left)) - 28;
      const rawMaxX = Math.max(...contentBounds.map(({ right }) => right)) + 28;
      const rawMinY = Math.min(...contentBounds.map(({ top }) => top)) - 28;
      const rawMaxY = Math.max(...contentBounds.map(({ bottom }) => bottom)) + 28;
      // Match the preview's 8:5 frame instead of padding every graph out to
      // the main map's fixed 840x540 world. The tight, centered viewBox keeps
      // all cards and complete labels visible at a useful scale.
      const targetAspect = 8 / 5;
      const rawWidth = Math.max(1, rawMaxX - rawMinX);
      const rawHeight = Math.max(1, rawMaxY - rawMinY);
      const width = Math.max(rawWidth, rawHeight * targetAspect);
      const height = Math.max(rawHeight, rawWidth / targetAspect);
      const centerX = (rawMinX + rawMaxX) / 2;
      const centerY = (rawMinY + rawMaxY) / 2;
      return `${centerX - width / 2} ${centerY - height / 2} ${width} ${height}`;
    })()
    : `0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`;
  return <div className="connection-preview" role="img" aria-label={`Preview with ${nodes.length} nodes and ${shownEdges.length} connections`}>
    <svg viewBox={previewViewBox} aria-hidden="true" focusable="false">
      <defs><marker id="connection-preview-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" /></marker></defs>
      <g className="connection-preview__lines">{shownEdgeLayouts.map(({ edge, anchor, route, proposed }) => <g key={edge.id} data-edge-id={edge.id} className={`connection-preview__edge ${proposed ? 'is-proposed' : 'is-existing'} ${edge.status === 'confirmed' ? 'is-accepted' : ''}`}>
        <path d={`M ${route.source.x} ${route.source.y} L ${anchor.x} ${anchor.y} L ${route.target.x} ${route.target.y}`} markerEnd="url(#connection-preview-arrow)" />
      </g>)}</g>
      <g className="connection-preview__labels">{shownEdgeLayouts.map(({ edge, proposed, anchor }) => {
        const geometry = mapEdgeLabelGeometry(edge.verb);
        return <g key={edge.id} data-edge-id={edge.id} data-source-id={edge.source} data-target-id={edge.target} data-edge-route="between-endpoints" data-anchor-x={anchor.x} data-anchor-y={anchor.y} data-full-label={edge.verb} className={`connection-preview__label ${proposed ? 'is-proposed' : 'is-existing'} ${edge.status === 'confirmed' ? 'is-accepted' : ''}`}>
          <rect x={anchor.x - (geometry.width / 2)} y={anchor.y - (geometry.height / 2)} width={geometry.width} height={geometry.height} rx="4" />
          <text x={anchor.x}>{geometry.lines.map((line, lineIndex) => <tspan key={`${edge.id}-preview-line-${lineIndex}`} x={anchor.x} y={anchor.y + geometry.startY + lineIndex * geometry.lineHeight}>{line}</tspan>)}</text>
        </g>;
      })}</g>
      {previewNodes.map((node) => {
        const geometry = mapNodeGeometry(node.label);
        return <g key={node.id} data-node-id={node.id} data-full-label={node.label} className="connection-preview__node" transform={`translate(${node.x} ${node.y})`}>
          <rect x={geometry.cardX} y={geometry.cardY} width={geometry.cardWidth} height={geometry.cardHeight} rx="12" />
          <text textAnchor="middle">{geometry.lines.map((line, lineIndex) => <tspan key={`${node.id}-preview-line-${lineIndex}`} x="0" y={geometry.labelStartY + lineIndex * geometry.lineHeight}>{line}</tspan>)}</text>
        </g>;
      })}
    </svg>
  </div>;
}

function AutoGrowingTextarea({ value, onChange, ...props }) {
  const textareaRef = useRef(null);
  const fitContent = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(44, textarea.scrollHeight + 2)}px`;
  }, []);

  useEffect(() => {
    fitContent();
  }, [fitContent, value]);

  return <textarea {...props} ref={textareaRef} rows="2" value={value} onInput={fitContent} onChange={onChange} />;
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
    <div className={`connection-stage__layout ${nodes.length > 6 ? 'is-dense' : ''}`}>
      <section className="connection-prompt-panel">
        {nodes.length < 2 && <p className="teacher-message" role="status">Keep at least two nodes and the model can suggest connections between them.</p>}
        <button type="button" className="button" disabled={busy || nodes.length < 2} onClick={onSuggest}>{busy ? 'Generating suggestions…' : suggestions.length ? 'Generate again' : 'Suggest connections'}</button>
        <details className="connection-hint">
          <summary>Describe a relationship (optional)</summary>
          <Field label="Describe connections between nodes" hint="Describe the relationship you want the model to examine. You can review and edit every suggestion before adding it to the map.">
            <textarea rows="6" maxLength="4000" value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder="For example, families ask schools for evaluations while delays make services harder to access." />
          </Field>
        </details>
        <div className="connection-node-list" aria-label="Nodes included in this request">{nodes.map((node) => <span key={node.id}>{node.label}</span>)}</div>
      </section>
      <section className="connection-preview-panel" aria-labelledby="connection-preview-title">
        <div className="connection-preview-panel__title"><div><p className="eyebrow">Preview</p><h2 id="connection-preview-title">Connection preview</h2></div>{suggestions.length > 0 && <strong>{accepted} kept</strong>}</div>
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
            <AutoGrowingTextarea className="relationship-verb-editor" aria-label={`Connection for suggestion ${index + 1}`} maxLength={RELATIONSHIP_VERB_LIMIT} value={item.verb} onChange={(event) => onEdit(item.id, 'verb', event.target.value)} />
            <select aria-label={`Ending node for suggestion ${index + 1}`} value={item.target} onChange={(event) => onEdit(item.id, 'target', event.target.value)}>{nodes.filter((node) => node.id !== item.source).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select>
          </div>
          <p>{item.rationale}</p>
        </div>
        <div className="candidate-actions" aria-label={`Decision for ${item.sourceLabel} ${item.verb} ${item.targetLabel}`}>
          <button className={item.status === 'confirmed' ? 'is-active' : ''} type="button" onClick={() => onDecision(item.id, 'confirmed')}>Keep</button>
          <button className={item.status === 'rejected' ? 'is-active' : ''} type="button" onClick={() => onDecision(item.id, 'rejected')}>Remove</button>
        </div>
      </article>)}
      {!suggestions.length && <p className="empty-message">Choose “Suggest connections” to see suggestions here. Kept connections appear in the preview and join the map when you continue.</p>}
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

function GraphCanvas({ nodes, edges, selection, onSelect, onMoveNode, viewport, phoneLayout, mapLabel, mapMode = 'network', ecologyLayers = [], visibleLayer = 'all', detailMode = false, panMode, onViewportChange, onAnnounce }) {
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
    if (detailMode) {
      onSelect('node', node.id, true);
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onSelect('node', node.id, false);
    const start = clientPoint(event.clientX, event.clientY);
    const geometry = mapNodeGeometry(node.label, phoneLayout);
    interactionRef.current = {
      kind: 'node', pointerId: event.pointerId, captureTarget: event.currentTarget,
      nodeId: node.id, startClientX: event.clientX, startClientY: event.clientY,
      startSvgX: start.x, startSvgY: start.y,
      originX: node.x, originY: node.y, latestX: node.x, latestY: node.y, moved: false,
      node,
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
      const rawX = clamp(Math.round(interaction.originX + delta.x), interaction.halfWidth + 8, WORLD_WIDTH - interaction.halfWidth - 8);
      const rawY = clamp(Math.round(interaction.originY + delta.y), interaction.halfHeight + 8, WORLD_HEIGHT - interaction.halfHeight - 8);
      const constrained = mapMode === 'ecology'
        ? constrainToEcologyBand(interaction.node, rawX, rawY, mapNodeGeometry(interaction.node.label, phoneLayout))
        : { x: rawX, y: rawY };
      interaction.latestX = constrained.x;
      interaction.latestY = constrained.y;
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
    if (detailMode) return;
    const deltas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!deltas[event.key]) return;
    event.preventDefault();
    const step = event.shiftKey ? 24 : 8;
    const [dx, dy] = deltas[event.key];
    const geometry = mapNodeGeometry(node.label, phoneLayout);
    const rawX = clamp(node.x + dx * step, geometry.cardWidth / 2 + 8, WORLD_WIDTH - geometry.cardWidth / 2 - 8);
    const rawY = clamp(node.y + dy * step, geometry.cardHeight / 2 + 8, WORLD_HEIGHT - geometry.cardHeight / 2 - 8);
    const { x, y } = mapMode === 'ecology' ? constrainToEcologyBand(node, rawX, rawY, geometry) : { x: rawX, y: rawY };
    onSelect('node', node.id, false);
    onMoveNode(node.id, x, y, 'keyboard');
    onAnnounce(`${node.label} moved to x ${x}, y ${y}.`);
  };
  const graphViewBox = phoneLayout ? '0 -130 840 800' : `0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`;
  const nodeVisuals = new Map(nodes.map((node) => [node.id, {
    position: positions.get(node.id),
    geometry: mapNodeGeometry(node.label, phoneLayout),
  }]));
  const betweenEndpointLayout = betweenEndpointCalloutLayout(
    edges.filter((edge) => edge.showLabel !== false),
    nodes,
    positions,
    phoneLayout,
  );
  const edgeVisuals = edges.map((edge) => {
    const source = nodeVisuals.get(edge.source);
    const target = nodeVisuals.get(edge.target);
    if (!source?.position || !target?.position) return null;
    const labelGeometry = mapEdgeLabelGeometry(edge.verb, phoneLayout, edge.scale);
    const calloutAnchor = betweenEndpointLayout.anchors.get(edge.id) || null;
    const sourceToward = calloutAnchor || target.position;
    const targetToward = calloutAnchor || source.position;
    const sourcePoint = cardConnectionPoint(source.position, sourceToward, source.geometry);
    const targetPoint = cardConnectionPoint(target.position, targetToward, target.geometry, phoneLayout ? 12 : 7);
    const labelPoint = calloutAnchor || {
      x: (source.position.x + target.position.x) / 2,
      y: (source.position.y + target.position.y) / 2,
    };
    const path = calloutAnchor
      ? `M ${sourcePoint.x} ${sourcePoint.y} L ${calloutAnchor.x} ${calloutAnchor.y} L ${targetPoint.x} ${targetPoint.y}`
      : `M ${sourcePoint.x} ${sourcePoint.y} L ${targetPoint.x} ${targetPoint.y}`;
    return {
      edge,
      x1: sourcePoint.x,
      y1: sourcePoint.y,
      x2: targetPoint.x,
      y2: targetPoint.y,
      midX: labelPoint.x,
      midY: labelPoint.y,
      path,
      edgeRoute: calloutAnchor ? 'between-endpoints' : 'direct',
      labelGeometry,
      selected: selection?.kind === 'edge' && selection.id === edge.id,
    };
  }).filter(Boolean);
  const mesoBridgeVisuals = nodes
    .filter((node) => node.scale === 'meso' && node.scopeNodeIds?.length)
    .flatMap((node) => {
      const linkage = nodeVisuals.get(node.id);
      if (!linkage?.position) return [];
      return node.scopeNodeIds.map((memberId) => {
        const member = nodeVisuals.get(memberId);
        if (!member?.position) return null;
        const linkagePoint = cardConnectionPoint(linkage.position, member.position, linkage.geometry);
        const memberPoint = cardConnectionPoint(member.position, linkage.position, member.geometry);
        return { id: `${node.id}:${memberId}`, linkageId: node.id, x1: linkagePoint.x, y1: linkagePoint.y, x2: memberPoint.x, y2: memberPoint.y, muted: node.visualMuted };
      }).filter(Boolean);
    });
  const graphSummary = visibleLayer === 'meso'
    ? `${nodes.filter((node) => node.scale === 'meso').length} ${nodes.filter((node) => node.scale === 'meso').length === 1 ? 'mesosystem' : 'mesosystems'} and ${nodes.filter((node) => node.scale === 'micro').length} Micro ${nodes.filter((node) => node.scale === 'micro').length === 1 ? 'setting' : 'settings'}`
    : `${nodes.length} ${nodes.length === 1 ? 'node' : 'nodes'} and ${edges.length} ${edges.length === 1 ? 'connection' : 'connections'}`;
  return <svg ref={svgRef} tabIndex="0" className={`graph-canvas graph-canvas--${mapMode} ${detailMode ? 'is-detail-view' : ''} ${panMode ? 'is-panning' : ''}`} data-map-mode={mapMode} role="group" aria-label={`${mapLabel}. ${graphSummary}. Choose a node for details.${detailMode ? '' : ' Arrow keys move a focused node by 8 pixels; Shift plus an arrow moves it by 24.'}${panMode ? ' Arrow keys pan the map when the canvas itself is focused.' : ''}`} viewBox={graphViewBox} onPointerDown={beginPan} onPointerMove={movePointer} onPointerUp={finishPointer} onPointerCancel={(event) => finishPointer(event, true)} onKeyDown={(event) => {
    if (!panMode || event.target !== event.currentTarget) return;
    const deltas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!deltas[event.key]) return;
    event.preventDefault();
    const step = event.shiftKey ? 120 : 40;
    const [dx, dy] = deltas[event.key];
    onViewportChange({
      ...viewport,
      panX: viewport.panX + dx * step,
      panY: viewport.panY + dy * step,
    });
    onAnnounce(`Map panned ${event.key.replace('Arrow', '').toLowerCase()}.`);
  }}>
    <title>Interactive systems map</title>
    <defs><marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 z" /></marker></defs>
    <g className="viewport-layer" transform={`translate(${shownViewport.panX} ${shownViewport.panY}) scale(${shownViewport.zoom})`}>
      {mapMode === 'ecology' && !detailMode ? <EcologicalLayerBackdrop layers={ecologyLayers} visibleLayer={visibleLayer} /> : null}
      <g className="scope-fields" aria-hidden="true">{nodes.filter((node) => node.scale === 'macrosphere' && node.scopeNodeIds?.length).map((node) => {
        const memberPoints = node.scopeNodeIds.map((memberId) => positions.get(memberId)).filter(Boolean);
        if (!memberPoints.length) return null;
        const selected = selection?.kind === 'node' && selection.id === node.id;
        return <path key={`scope-${node.id}`} data-scope-of={node.id} className={`scope-field ${selected ? 'is-selected' : ''} ${node.visualMuted ? 'is-muted' : ''}`} d={convexHullPath(memberPoints)} />;
      })}</g>
      <g className="meso-linkages" aria-hidden="true">{mesoBridgeVisuals.map((bridge) => <line key={bridge.id} data-linkage-of={bridge.linkageId} className={`meso-link-line ${bridge.muted ? 'is-muted' : ''}`} x1={bridge.x1} y1={bridge.y1} x2={bridge.x2} y2={bridge.y2} />)}</g>
      <g className="edges">{edgeVisuals.map(({ edge, x1, y1, x2, y2, path, edgeRoute, selected }) => <g key={edge.id} data-graph-id={edge.id} data-edge-scale={edge.scale} data-edge-route={edgeRoute} role="button" tabIndex={edge.visualMuted ? -1 : 0} aria-label={`${edge.sourceLabel} ${edge.verb} ${edge.targetLabel}, ${SCALES[edge.scale]?.label || edge.scale} level relationship`} aria-keyshortcuts="Enter Space" className={`graph-edge graph-edge--${stateClass(edge.claimState)} ${edge.visualMuted ? 'is-muted' : ''} ${selected ? 'is-selected' : ''}`} onPointerDown={(event) => { event.stopPropagation(); onSelect('edge', edge.id, true); }} onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect('edge', edge.id, true);
      }}>
        <path className="edge-hit" d={path} x1={x1} y1={y1} x2={x2} y2={y2} />
        {selected && <path className="edge-selection-halo" d={path} x1={x1} y1={y1} x2={x2} y2={y2} />}
        <path className="edge-line" d={path} x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#arrowhead)" />
      </g>)}</g>
      <g className="edge-labels" aria-hidden="true">{edgeVisuals.filter(({ edge }) => edge.showLabel !== false).map(({ edge, midX, midY, labelGeometry: geometry, edgeRoute, selected }) => {
        return <g key={edge.id} data-edge-id={edge.id} data-edge-scale={edge.scale} data-edge-route={edgeRoute} data-anchor-x={midX} data-anchor-y={midY} data-full-label={edge.verb} className={`graph-edge-label ${selected ? 'is-selected' : ''}`}>
          <rect className="edge-label-bg" x={midX - (geometry.width / 2)} y={midY - (geometry.height / 2)} width={geometry.width} height={geometry.height} rx={phoneLayout ? 6 : 2} />
          <text className="edge-label" style={{ fontSize: geometry.fontSize }} x={midX}>{geometry.lines.map((line, lineIndex) => <tspan key={`${edge.id}-line-${lineIndex}`} x={midX} y={midY + geometry.startY + lineIndex * geometry.lineHeight}>{line}</tspan>)}</text>
        </g>;
      })}</g>
      <g className="nodes">{nodes.map((node) => {
        const { position, geometry } = nodeVisuals.get(node.id);
        const selected = selection?.kind === 'node' && selection.id === node.id;
        const evidenceState = node.evidence ? 'evidence recorded' : 'evidence unresolved';
        const scopeState = node.scale === 'meso' && node.scopeNodeIds?.length
          ? `, includes ${node.scopeNodeIds.length} Micro settings`
          : node.scale === 'macrosphere' && node.scopeNodeIds?.length
            ? `, ${node.deontic || 'shapes'} ${node.scopeNodeIds.length} mapped ${node.scopeNodeIds.length === 1 ? 'element' : 'elements'}`
            : '';
        return <g key={node.id} data-graph-id={node.id} data-full-label={node.label} role="button" tabIndex="0" aria-label={`${node.label}, ${node.type}, ${SCALES[node.scale]?.label || node.scale} level, ${evidenceState}${scopeState}`} aria-keyshortcuts={detailMode ? 'Enter Space' : 'ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight'} className={`graph-node graph-node--${node.scale} graph-node--${stateClass(node.claimState)} ${node.visualMuted ? 'is-muted' : ''} ${selected ? 'is-selected' : ''}`} transform={`translate(${position.x} ${position.y})`} onPointerDown={(event) => beginNode(event, node)} onKeyDown={(event) => keyboardNode(event, node)}>
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
  if (previous.mapMode !== next.mapMode || previous.visibleLayer !== next.visibleLayer) return false;
  if (previous.detailMode !== next.detailMode) return false;
  if ((previous.ecologyLayers || []).join(',') !== (next.ecologyLayers || []).join(',')) return false;
  if (previous.panMode !== next.panMode) return false;
  if (previous.interactionMode !== next.interactionMode) return false;
  if (previous.selection?.kind !== next.selection?.kind || previous.selection?.id !== next.selection?.id) return false;
  if (previous.viewport.panX !== next.viewport.panX || previous.viewport.panY !== next.viewport.panY || previous.viewport.zoom !== next.viewport.zoom) return false;
  if (previous.nodes.length !== next.nodes.length || previous.edges.length !== next.edges.length) return false;
  for (let index = 0; index < previous.nodes.length; index += 1) {
    const a = previous.nodes[index]; const b = next.nodes[index];
    if (a.id !== b.id || a.x !== b.x || a.y !== b.y || a.label !== b.label || a.type !== b.type || a.scale !== b.scale || a.claimState !== b.claimState || Boolean(a.evidence) !== Boolean(b.evidence) || a.visualMuted !== b.visualMuted) return false;
    if ((a.scopeNodeIds || []).join(',') !== (b.scopeNodeIds || []).join(',') || a.deontic !== b.deontic) return false;
  }
  for (let index = 0; index < previous.edges.length; index += 1) {
    const a = previous.edges[index]; const b = next.edges[index];
    if (a.id !== b.id || a.source !== b.source || a.target !== b.target || a.verb !== b.verb || a.scale !== b.scale || a.claimState !== b.claimState || a.sourceLabel !== b.sourceLabel || a.targetLabel !== b.targetLabel || a.showLabel !== b.showLabel || a.visualMuted !== b.visualMuted || a.layerEdgeSlot !== b.layerEdgeSlot || a.layerEdgeCount !== b.layerEdgeCount) return false;
  }
  if (previous.onMoveNode !== next.onMoveNode) return false;
  return true;
}

const MemoGraphCanvas = React.memo(GraphCanvas, sameGraphVisuals);

function MapLegend() {
  return <div className="legend-grid">
    <section><h3>Layer</h3><ul>{SCALE_ORDER.map((scale) => <li key={scale}><i className={`legend-symbol legend-symbol--${scale}`} /><span>{SCALES[scale]?.label || scale}</span></li>)}</ul></section>
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

function ecologyViewportBounds(layers) {
  const outermost = [...SCALE_ORDER].reverse().find((scale) => layers.includes(scale) && ECOLOGY_BANDS[scale]);
  if (!outermost) return [];
  const band = ECOLOGY_BANDS[outermost];
  return [{
    left: ECOLOGY_CENTER.x - band.outerRx - 32,
    right: ECOLOGY_CENTER.x + band.outerRx + 32,
    top: ECOLOGY_CENTER.y - band.outerRy - 32,
    bottom: ECOLOGY_CENTER.y + band.outerRy + 32,
  }];
}

function fitViewport(nodes, targetHeight = 440, phoneLayout = false, extraBounds = [], minimumZoom = VIEWPORT_LIMITS.minZoom) {
  const bounds = [...nodes.map((node) => {
    const geometry = mapNodeGeometry(node.label, phoneLayout);
    return {
      left: node.x - geometry.cardWidth / 2,
      right: node.x + geometry.cardWidth / 2,
      top: node.y - geometry.cardHeight / 2,
      bottom: node.y + geometry.cardHeight / 2,
    };
  }), ...extraBounds];
  if (!bounds.length) return { panX: 0, panY: 0, zoom: Math.max(1, minimumZoom) };
  const minX = Math.min(...bounds.map(({ left }) => left));
  const maxX = Math.max(...bounds.map(({ right }) => right));
  const minY = Math.min(...bounds.map(({ top }) => top));
  const maxY = Math.max(...bounds.map(({ bottom }) => bottom));
  const zoom = clamp(Math.min(1.4, 760 / Math.max(240, maxX - minX + 40), targetHeight / Math.max(170, maxY - minY + 40)), minimumZoom, VIEWPORT_LIMITS.maxZoom);
  return {
    zoom,
    panX: clamp(GRAPH_WIDTH / 2 - ((minX + maxX) / 2) * zoom, VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan),
    panY: clamp(targetHeight === 240 ? 130 - ((minY + maxY) / 2) * zoom : GRAPH_HEIGHT / 2 - ((minY + maxY) / 2) * zoom, VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan),
  };
}

function mapContentCenter(nodes, phoneLayout = false) {
  if (!nodes.length) return { ...ECOLOGY_CENTER };
  const bounds = nodes.map((node) => {
    const geometry = mapNodeGeometry(node.label, phoneLayout);
    return {
      left: node.x - geometry.cardWidth / 2,
      right: node.x + geometry.cardWidth / 2,
      top: node.y - geometry.cardHeight / 2,
      bottom: node.y + geometry.cardHeight / 2,
    };
  });
  return {
    x: (Math.min(...bounds.map(({ left }) => left)) + Math.max(...bounds.map(({ right }) => right))) / 2,
    y: (Math.min(...bounds.map(({ top }) => top)) + Math.max(...bounds.map(({ bottom }) => bottom))) / 2,
  };
}

const INSPECTOR_TABS = ['node', 'relationships', 'map'];
const FOCUSED_RELATIONSHIPS_PER_PAGE = 1;

function MapStage({ project, update, toast, logPrototype, saveState, stageAnnotationDraft, commitAnnotationDrafts, flushSave }) {
  const [selection, setSelection] = useState(null);
  const [focus, setFocus] = useState(null);
  const [focusPage, setFocusPage] = useState(0);
  const [visibleScale, setVisibleScale] = useState(() => (
    project.releasedScales.length > 1
      ? 'all'
      : project.releasedScales.includes(project.activeScale) ? project.activeScale : 'all'
  ));
  const [showRemoved, setShowRemoved] = useState(false);
  const [inspectorTab, setInspectorTab] = useState('map');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [phoneViewport, setPhoneViewport] = useState(null);
  const [mapViewport, setMapViewport] = useState(null);
  const [automaticPositions, setAutomaticPositions] = useState(null);
  const [annotationDisclosure, setAnnotationDisclosure] = useState('analytical');
  const [panMode, setPanMode] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [addMode, setAddMode] = useState(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [phoneOverviewCommittedScope, setPhoneOverviewCommittedScope] = useState('');
  const [phoneEcologyCommittedScope, setPhoneEcologyCommittedScope] = useState('');
  const [newNode, setNewNode] = useState({ label: '', type: project.activeScale === 'exosphere' ? 'institution' : 'person', scale: project.activeScale, evidence: '', claimState: 'research lead' });
  const [newEdge, setNewEdge] = useState({ source: project.graph.nodes[0]?.id || '', target: project.graph.nodes[1]?.id || '', verb: 'provides', evidence: '', claimState: 'research lead' });
  const canvasWrapRef = useRef(null);
  const fullscreenToggleRef = useRef(null);
  const inspectorRef = useRef(null);
  const initialLayoutCheckedRef = useRef(false);
  const phoneOverviewViewportKeyRef = useRef('');
  const phoneLayout = usePhoneLayout();
  const previousPhoneLayoutRef = useRef(phoneLayout);
  const ecologyLayers = useMemo(() => SCALE_ORDER.filter((scale) => project.releasedScales.includes(scale)), [project.releasedScales]);
  const mapMode = ecologyLayers.some((scale) => ECOLOGY_MAP_SCALES.has(scale)) ? 'ecology' : 'network';
  useEffect(() => {
    if (!fullscreen) return undefined;
    document.body.classList.add('map-fullscreen-open');
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setFullscreen(false);
      setAnnouncement('Full screen map closed.');
      window.requestAnimationFrame(() => fullscreenToggleRef.current?.focus());
    };
    document.addEventListener('keydown', onKeyDown);
    window.requestAnimationFrame(() => canvasWrapRef.current?.querySelector('.graph-canvas')?.focus());
    return () => {
      document.body.classList.remove('map-fullscreen-open');
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [fullscreen]);
  const fitMapOverview = useCallback((nodes, targetHeight = phoneLayout ? 650 : 440) => fitViewport(
    nodes,
    targetHeight,
    phoneLayout,
    mapMode === 'ecology' ? ecologyViewportBounds(ecologyLayers) : [],
  ), [ecologyLayers, mapMode, phoneLayout]);
  const readingViewport = useCallback((nodes, layer = visibleScale, extraBounds = []) => {
    if (mapMode !== 'ecology') return fitViewport(nodes, phoneLayout ? 650 : 500, phoneLayout, extraBounds);
    const layers = layer === 'all' ? ecologyLayers : [layer];
    return fitViewport(
      nodes,
      phoneLayout ? 650 : 540,
      phoneLayout,
      [...ecologyViewportBounds(layers), ...extraBounds],
    );
  }, [ecologyLayers, mapMode, phoneLayout, visibleScale]);
  const hasRemovedItems = project.graph.nodes.some((node) => node.claimState === 'retired') || project.graph.edges.some((edge) => edge.claimState === 'retired');
  const visibleScaleSet = useMemo(() => new Set(visibleScale === 'all' ? project.releasedScales : [visibleScale]), [project.releasedScales, visibleScale]);
  const scaleEdgeIds = useMemo(() => new Set(project.graph.edges
    .filter((edge) => visibleScaleSet.has(edge.scale) && (showRemoved || edge.claimState !== 'retired'))
    .flatMap((edge) => [edge.source, edge.target])), [project.graph.edges, visibleScaleSet, showRemoved]);
  // Visible Meso linkages and Macrosphere items carry their members with them
  // so the linked or affected Micro elements stay on screen.
  const scopeMemberIds = useMemo(() => new Set(project.graph.nodes
    .filter((node) => ['meso', 'macrosphere'].includes(node.scale) && visibleScaleSet.has(node.scale)
      && node.status !== 'rejected' && (showRemoved || node.claimState !== 'retired'))
    .flatMap((node) => node.scopeNodeIds || [])), [project.graph.nodes, visibleScaleSet, showRemoved]);
  const scaleNodes = useMemo(() => project.graph.nodes.filter((node) => {
    const scaleMatches = visibleScaleSet.has(node.scale) || scaleEdgeIds.has(node.id) || scopeMemberIds.has(node.id);
    return scaleMatches && (showRemoved || node.claimState !== 'retired');
  }), [project.graph.nodes, visibleScaleSet, scaleEdgeIds, scopeMemberIds, showRemoved]);
  const mesoLinkageCount = useMemo(() => scaleNodes.filter((node) => node.scale === 'meso').length, [scaleNodes]);
  const mesoSettingCount = useMemo(() => scaleNodes.filter((node) => node.scale === 'micro' && scopeMemberIds.has(node.id)).length, [scaleNodes, scopeMemberIds]);
  const scaleNodeIds = useMemo(() => new Set(scaleNodes.map((node) => node.id)), [scaleNodes]);
  const scaleEdges = useMemo(() => project.graph.edges.filter((edge) => visibleScaleSet.has(edge.scale)
    && scaleNodeIds.has(edge.source)
    && scaleNodeIds.has(edge.target)
    && (showRemoved || edge.claimState !== 'retired')), [project.graph.edges, visibleScaleSet, scaleNodeIds, showRemoved]);
  const focusIncidentEdges = useMemo(() => {
    if (!focus) return [];
    if (focus.kind === 'edge') return scaleEdges.filter((edge) => edge.id === focus.id);
    return scaleEdges.filter((edge) => edge.source === focus.id || edge.target === focus.id);
  }, [focus, scaleEdges]);
  const focusPageCount = focus?.kind === 'node'
    ? Math.max(1, Math.ceil(focusIncidentEdges.length / FOCUSED_RELATIONSHIPS_PER_PAGE))
    : 1;
  const activeFocusPage = Math.min(focusPage, focusPageCount - 1);
  const focusedEdgeIds = useMemo(() => {
    if (!focus) return new Set();
    if (focus.kind === 'edge') return new Set(focusIncidentEdges.map((edge) => edge.id));
    const start = activeFocusPage * FOCUSED_RELATIONSHIPS_PER_PAGE;
    return new Set(focusIncidentEdges.slice(start, start + FOCUSED_RELATIONSHIPS_PER_PAGE).map((edge) => edge.id));
  }, [activeFocusPage, focus, focusIncidentEdges]);
  useEffect(() => {
    if (focusPage < focusPageCount) return;
    setFocusPage(Math.max(0, focusPageCount - 1));
  }, [focusPage, focusPageCount]);
  const focusedNodeIds = useMemo(() => {
    if (!focus) return new Set();
    const ids = new Set(focus.kind === 'node' && scaleNodeIds.has(focus.id) ? [focus.id] : []);
    scaleEdges.forEach((edge) => {
      if (!focusedEdgeIds.has(edge.id)) return;
      ids.add(edge.source);
      ids.add(edge.target);
    });
    // Focusing a structure lights its whole field: the structure and every
    // mapped element inside its reach.
    if (focus.kind === 'node' && focusIncidentEdges.length === 0) {
      const focusedNode = scaleNodes.find((node) => node.id === focus.id);
      (focusedNode?.scopeNodeIds || []).forEach((memberId) => {
        if (scaleNodeIds.has(memberId)) ids.add(memberId);
      });
    }
    return ids;
  }, [focus, focusedEdgeIds, focusIncidentEdges.length, scaleEdges, scaleNodes, scaleNodeIds]);
  const focusActive = focusedNodeIds.size > 0;
  const visibleNodes = useMemo(() => focusActive ? scaleNodes.filter((node) => focusedNodeIds.has(node.id)) : scaleNodes, [focusActive, scaleNodes, focusedNodeIds]);
  const phoneFocusedEdge = phoneLayout && focus?.kind === 'edge' ? scaleEdges.find((edge) => edge.id === focus.id) : null;
  const phoneOverviewScope = phoneLayout && mapMode === 'network' && !phoneFocusedEdge && visibleNodes.length
    ? `${visibleScale}:${focus?.kind || 'overview'}:${focus?.id || 'all'}:${visibleNodes.map((node) => `${node.id}:${node.label}`).join('|')}`
    : '';
  const phoneOverviewPositions = useMemo(() => (
    phoneOverviewScope && phoneOverviewCommittedScope !== phoneOverviewScope
      ? arrangedPhoneOverviewPositions(visibleNodes)
      : null
  ), [phoneOverviewCommittedScope, phoneOverviewScope, visibleNodes]);
  const phoneEcologyScope = phoneLayout && mapMode === 'ecology' && !focusActive && visibleNodes.length
    ? `${visibleScale}:${visibleNodes.map((node) => `${node.id}:${node.label}:${node.scale}`).join('|')}`
    : '';
  const phoneEcologyPositions = useMemo(() => (
    phoneEcologyScope && phoneEcologyCommittedScope !== phoneEcologyScope
      ? arrangedEcologyPositions(visibleNodes, true)
      : null
  ), [phoneEcologyCommittedScope, phoneEcologyScope, visibleNodes]);
  const phoneRelationshipPositions = useMemo(() => arrangedPhoneRelationshipPositions(visibleNodes, phoneFocusedEdge), [phoneFocusedEdge, visibleNodes]);
  const phoneRelationshipDetail = Boolean(phoneRelationshipPositions);
  const focusedRelationshipEdge = focusedEdgeIds.size === 1
    ? scaleEdges.find((edge) => focusedEdgeIds.has(edge.id))
    : null;
  const focusedRelationshipPositions = useMemo(() => (
    mapMode === 'ecology' && focusActive && visibleNodes.length === 2
      ? arrangedFocusedRelationshipPositions(visibleNodes, focusedRelationshipEdge, phoneLayout)
      : null
  ), [focusActive, focusedRelationshipEdge, mapMode, phoneLayout, visibleNodes]);
  const focusedEcologyPositions = useMemo(() => (
    mapMode === 'ecology' && focusActive && !phoneRelationshipDetail
      ? focusedRelationshipPositions || arrangedFocusedEcologyPositions(visibleNodes, phoneLayout)
      : null
  ), [focusActive, focusedRelationshipPositions, mapMode, phoneLayout, phoneRelationshipDetail, visibleNodes]);
  const focusedEcologyDetail = Boolean(focusedEcologyPositions);
  const displayedNodes = useMemo(() => visibleNodes.map((node) => ({
    ...node,
    ...(automaticPositions?.get(node.id) || {}),
    ...(phoneOverviewPositions?.get(node.id) || {}),
    ...(phoneEcologyPositions?.get(node.id) || {}),
    ...(focusedEcologyPositions?.get(node.id) || {}),
    ...(phoneRelationshipPositions?.get(node.id) || {}),
  })), [automaticPositions, focusedEcologyPositions, phoneEcologyPositions, phoneOverviewPositions, phoneRelationshipPositions, visibleNodes]);
  const visibleEdges = useMemo(() => {
    const shown = focusActive ? scaleEdges.filter((edge) => focusedEdgeIds.has(edge.id)) : scaleEdges;
    const overview = !focusActive && visibleScale === 'all';
    const denseMicroOverview = !focusActive
      && visibleScale === 'micro'
      && shown.filter((edge) => edge.scale === 'micro').length > 3;
    const layerLayouts = new Map();
    scaleEdges.forEach((edge) => {
      const group = layerLayouts.get(edge.scale) || [];
      group.push(edge);
      layerLayouts.set(edge.scale, group);
    });
    layerLayouts.forEach((group) => group.sort((left, right) => left.id.localeCompare(right.id)));
    return shown.map((edge) => {
      const group = layerLayouts.get(edge.scale) || [edge];
      return {
        ...edge,
        showLabel: (visibleScale !== 'all' || focusActive) && !denseMicroOverview,
        visualMuted: overview,
        layerEdgeSlot: group.findIndex((candidate) => candidate.id === edge.id),
        layerEdgeCount: group.length,
      };
    });
  }, [focusActive, scaleEdges, focusedEdgeIds, visibleScale]);
  const visibleRelationshipBounds = useMemo(() => {
    const positions = new Map(displayedNodes.map((node) => [node.id, { x: node.x, y: node.y }]));
    return focusedEcologyCalloutBounds(visibleEdges, displayedNodes, positions, phoneLayout);
  }, [displayedNodes, phoneLayout, visibleEdges]);
  const focusedDetailBounds = useMemo(() => {
    if (!focusedEcologyDetail || phoneLayout) return [];
    return visibleRelationshipBounds;
  }, [focusedEcologyDetail, phoneLayout, visibleRelationshipBounds]);
  const focusedGeometryKey = useMemo(() => {
    if (!focusedEcologyDetail) return '';
    const relationshipGeometry = focusIncidentEdges.map((edge) => (
      `${edge.id}:${edge.source}:${edge.verb}:${edge.target}:${edge.sourceLabel}:${edge.targetLabel}:${edge.claimState}`
    )).join('|');
    const nodeGeometry = displayedNodes.map((node) => (
      `${node.id}:${node.label}:${node.scale}:${node.x}:${node.y}:${node.claimState}`
    )).join('|');
    return `${focus?.kind || ''}:${focus?.id || ''}:page-${activeFocusPage}:${relationshipGeometry}::${nodeGeometry}`;
  }, [activeFocusPage, displayedNodes, focus?.id, focus?.kind, focusIncidentEdges, focusedEcologyDetail]);
  const focusedDetailMinimumZoom = readableZoomFloor(phoneLayout);
  useEffect(() => {
    if (initialLayoutCheckedRef.current) return;
    initialLayoutCheckedRef.current = true;
    const currentNodes = project.graph.nodes.filter((node) => node.status !== 'rejected' && node.claimState !== 'retired');
    let positions = mapMode === 'ecology'
      ? mapNeedsEcologyLayout(currentNodes, phoneLayout) ? arrangedEcologyPositions(currentNodes, phoneLayout) : null
      : mapNodesOverlap(currentNodes, phoneLayout) || mapNeedsReadableOverview(currentNodes, project.events, phoneLayout)
        ? arrangedMapPositions(currentNodes, new Set(currentNodes.map((node) => node.scale)).size > 1, phoneLayout ? 3 : 5, phoneLayout)
        : null;
    let positionedNodes = currentNodes.map((node) => ({ ...node, ...(positions?.get(node.id) || {}) }));
    const nextScaleEdges = project.graph.edges.filter((edge) => edge.status !== 'rejected'
      && edge.claimState !== 'retired'
      && (visibleScale === 'all' ? project.releasedScales.includes(edge.scale) : edge.scale === visibleScale));
    const endpointIds = new Set(nextScaleEdges.flatMap((edge) => [edge.source, edge.target]));
    if (['meso', 'macrosphere'].includes(visibleScale) || visibleScale === 'all') {
      currentNodes.filter((node) => ['meso', 'macrosphere'].includes(node.scale)
        && (visibleScale === 'all' || node.scale === visibleScale))
        .forEach((node) => (node.scopeNodeIds || []).forEach((memberId) => endpointIds.add(memberId)));
    }
    let nextVisibleNodes = positionedNodes.filter((node) => visibleScale === 'all'
      ? project.releasedScales.includes(node.scale)
      : node.scale === visibleScale || endpointIds.has(node.id));
    let connectionLayout = betweenEndpointCalloutLayout(
      visibleScale === 'all' ? [] : nextScaleEdges,
      nextVisibleNodes,
      new Map(nextVisibleNodes.map((node) => [node.id, { x: node.x, y: node.y }])),
      phoneLayout,
    );
    if (mapMode === 'network' && visibleScale !== 'all' && connectionLayout.unplaced.size) {
      const repaired = expandedConnectionLayout(nextVisibleNodes, nextScaleEdges, phoneLayout);
      positions = new Map([...(positions || []), ...repaired.positions]);
      positionedNodes = currentNodes.map((node) => ({ ...node, ...(positions.get(node.id) || {}) }));
      nextVisibleNodes = positionedNodes.filter((node) => node.scale === visibleScale || endpointIds.has(node.id));
      connectionLayout = betweenEndpointCalloutLayout(
        nextScaleEdges,
        nextVisibleNodes,
        new Map(nextVisibleNodes.map((node) => [node.id, { x: node.x, y: node.y }])),
        phoneLayout,
      );
    }
    setAutomaticPositions(positions);
    // Every entry starts from a transient fit of the complete visible graph,
    // including relationship wording and, for ecological maps, the cumulative
    // released rings. The saved viewport remains untouched until the student
    // deliberately pans or zooms.
    const ecologyBounds = mapMode === 'ecology'
      ? ecologyViewportBounds(visibleScale === 'all' ? ecologyLayers : [visibleScale])
      : [];
    setMapViewport(fitViewport(
      nextVisibleNodes.length ? nextVisibleNodes : positionedNodes,
      phoneLayout ? 650 : 500,
      phoneLayout,
      [...ecologyBounds, ...connectionLayout.bounds.values()],
    ));
  }, [ecologyLayers, mapMode, phoneLayout, project.events, project.graph.edges, project.graph.nodes, project.releasedScales, project.viewport.panX, project.viewport.panY, project.viewport.zoom, visibleScale]);
  useEffect(() => {
    const wasPhoneLayout = previousPhoneLayoutRef.current;
    previousPhoneLayoutRef.current = phoneLayout;
    if (!phoneLayout) {
      if (wasPhoneLayout) {
        phoneOverviewViewportKeyRef.current = '';
        setPhoneOverviewCommittedScope('');
        setPhoneEcologyCommittedScope('');
        setMapViewport(null);
      }
      return;
    }
    const responsivePositions = phoneOverviewPositions || phoneEcologyPositions;
    const responsiveScope = phoneOverviewPositions ? phoneOverviewScope : phoneEcologyScope;
    if (!responsivePositions) {
      phoneOverviewViewportKeyRef.current = '';
      return;
    }
    const key = `${responsiveScope}:${displayedNodes.map((node) => `${node.id}:${node.x}:${node.y}`).join('|')}`;
    if (phoneOverviewViewportKeyRef.current === key) return;
    phoneOverviewViewportKeyRef.current = key;
    setMapViewport(fitViewport(displayedNodes, 650, true, [], readableZoomFloor(true)));
  }, [displayedNodes, phoneEcologyPositions, phoneEcologyScope, phoneLayout, phoneOverviewPositions, phoneOverviewScope]);
  useEffect(() => {
    if (phoneLayout && drawerOpen) setPhoneViewport(fitViewport(displayedNodes.length ? displayedNodes : project.graph.nodes, 240, true, [], readableZoomFloor(true)));
    else setPhoneViewport(null);
    // Refit only when the drawer opens or the layout crosses the phone breakpoint.
    // Annotation edits clone graph records but must not reset an in-progress pan/zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phoneLayout, drawerOpen]);
  useEffect(() => {
    if (!phoneRelationshipDetail) return;
    setMapViewport(fitViewport(displayedNodes, 650, true, [], readableZoomFloor(true)));
    // Refit when this relationship enters phone detail mode. Annotation edits
    // keep the same mode and must not recenter a student who has already panned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.id, phoneLayout, phoneRelationshipDetail]);
  useEffect(() => {
    if (!focusedEcologyDetail) return;
    setMapViewport(fitViewport(
      displayedNodes,
      phoneLayout ? 650 : 440,
      phoneLayout,
      focusedDetailBounds,
      focusedDetailMinimumZoom,
    ));
    // The focus identity and breakpoint define this temporary detail layout.
    // Annotation edits must not recenter a student who has already panned it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedGeometryKey, phoneLayout, visibleScale]);
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
  const relatedEdges = scaleEdges
    .filter((edge) => selectedNode
      ? edge.source === selectedNode.id || edge.target === selectedNode.id
      : selectedEdge
        ? edge.id === selectedEdge.id
        : false);
  const selectItem = useCallback((kind, id, openInspector = true) => {
    setSelection({ kind, id });
    setInspectorTab(kind === 'edge' ? 'relationships' : 'node');
    setAnnotationDisclosure('analytical');
    if (openInspector) {
      setFocus({ kind, id });
      setFocusPage(0);
      setLegendOpen(false);
      setCreateMenuOpen(false);
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
    setFocusPage(0);
    setSelection(null);
    setInspectorTab('map');
    setDrawerOpen(false);
    const nodes = scaleNodes.map((node) => ({ ...node, ...(automaticPositions?.get(node.id) || {}) }));
    setMapViewport(readingViewport(nodes.length ? nodes : project.graph.nodes, visibleScale, visibleRelationshipBounds));
    window.requestAnimationFrame(() => canvasWrapRef.current?.querySelector('.graph-canvas')?.focus());
  }, [automaticPositions, project.graph.nodes, readingViewport, scaleNodes, visibleRelationshipBounds, visibleScale]);
  const changeVisibleScale = (nextScale) => {
    const nextEdges = project.graph.edges.filter((edge) => edge.status !== 'rejected'
      && edge.claimState !== 'retired'
      && (nextScale === 'all' ? project.releasedScales.includes(edge.scale) : edge.scale === nextScale));
    const endpointIds = new Set(nextEdges.flatMap((edge) => [edge.source, edge.target]));
    if (['meso', 'macrosphere'].includes(nextScale) || nextScale === 'all') {
      project.graph.nodes.filter((node) => ['meso', 'macrosphere'].includes(node.scale)
        && (nextScale === 'all' || node.scale === nextScale)
        && node.status !== 'rejected' && node.claimState !== 'retired')
        .forEach((node) => (node.scopeNodeIds || []).forEach((memberId) => endpointIds.add(memberId)));
    }
    const nextNodes = project.graph.nodes.filter((node) => node.status !== 'rejected'
      && node.claimState !== 'retired'
      && (nextScale === 'all' ? project.releasedScales.includes(node.scale) : node.scale === nextScale || endpointIds.has(node.id)))
      .map((node) => ({ ...node, ...(automaticPositions?.get(node.id) || {}) }));
    setVisibleScale(nextScale);
    setFocus(null);
    setFocusPage(0);
    setSelection(null);
    setInspectorTab('map');
    setDrawerOpen(false);
    const nextLabelBounds = focusedEcologyCalloutBounds(
      nextEdges,
      nextNodes,
      new Map(nextNodes.map((node) => [node.id, { x: node.x, y: node.y }])),
      phoneLayout,
    );
    setMapViewport(readingViewport(nextNodes, nextScale, nextLabelBounds));
  };
  const moveNode = useCallback((id, x, y, method) => {
    const displayedNodeIds = new Set(displayedNodes.map((node) => node.id));
    update((draft) => {
      if (automaticPositions) draft.graph.nodes.forEach((node) => {
        const position = automaticPositions.get(node.id);
        if (position && displayedNodeIds.has(node.id)) Object.assign(node, position);
      });
      if (phoneOverviewPositions) draft.graph.nodes.forEach((node) => {
        const position = phoneOverviewPositions.get(node.id);
        if (position) Object.assign(node, position);
      });
      if (phoneEcologyPositions) draft.graph.nodes.forEach((node) => {
        const position = phoneEcologyPositions.get(node.id);
        if (position) Object.assign(node, position);
      });
      const node = draft.graph.nodes.find((item) => item.id === id);
      if (node) { node.x = x; node.y = y; }
      if (phoneOverviewPositions || phoneEcologyPositions) draft.viewport = mapViewport || fitViewport(displayedNodes, 650, true);
    });
    if (phoneOverviewPositions) setPhoneOverviewCommittedScope(phoneOverviewScope);
    if (phoneEcologyPositions) setPhoneEcologyCommittedScope(phoneEcologyScope);
    setAutomaticPositions(null);
    logPrototype('node_moved', { keyboard: method === 'keyboard', pointer: method === 'pointer' });
  }, [automaticPositions, displayedNodes, logPrototype, mapViewport, phoneEcologyPositions, phoneEcologyScope, phoneOverviewPositions, phoneOverviewScope, update]);
  const minimumInteractiveZoom = focusedEcologyPositions || phoneRelationshipPositions
    ? focusedDetailMinimumZoom
    : VIEWPORT_LIMITS.minZoom;
  const changeViewport = useCallback((next) => {
    const bounded = {
      panX: clamp(Math.round(next.panX), VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan),
      panY: clamp(Math.round(next.panY), VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan),
      zoom: clamp(Number(next.zoom.toFixed(2)), minimumInteractiveZoom, VIEWPORT_LIMITS.maxZoom),
    };
    if (phoneLayout && drawerOpen) setPhoneViewport(bounded);
    if (focusedEcologyPositions || phoneRelationshipPositions) {
      setMapViewport(bounded);
      logPrototype('viewport_changed');
      return;
    }
    setMapViewport(null);
    update((draft) => {
      if (phoneOverviewPositions) draft.graph.nodes.forEach((node) => {
        const position = phoneOverviewPositions.get(node.id);
        if (position) Object.assign(node, position);
      });
      if (phoneEcologyPositions) draft.graph.nodes.forEach((node) => {
        const position = phoneEcologyPositions.get(node.id);
        if (position) Object.assign(node, position);
      });
      draft.viewport = bounded;
    });
    if (phoneOverviewPositions) setPhoneOverviewCommittedScope(phoneOverviewScope);
    if (phoneEcologyPositions) setPhoneEcologyCommittedScope(phoneEcologyScope);
    if (phoneOverviewPositions || phoneEcologyPositions) setAutomaticPositions(null);
    logPrototype('viewport_changed');
  }, [update, logPrototype, phoneLayout, drawerOpen, focusedEcologyPositions, minimumInteractiveZoom, phoneEcologyPositions, phoneEcologyScope, phoneOverviewPositions, phoneOverviewScope, phoneRelationshipPositions]);
  const zoomBy = (amount) => {
    const requested = phoneLayout && drawerOpen && phoneViewport ? phoneViewport : mapViewport || project.viewport;
    const current = requested;
    const zoom = clamp(current.zoom + amount, minimumInteractiveZoom, VIEWPORT_LIMITS.maxZoom);
    const mapCenterX = (GRAPH_WIDTH / 2 - current.panX) / current.zoom;
    const mapCenterY = (GRAPH_HEIGHT / 2 - current.panY) / current.zoom;
    changeViewport({ zoom, panX: GRAPH_WIDTH / 2 - mapCenterX * zoom, panY: GRAPH_HEIGHT / 2 - mapCenterY * zoom });
  };
  const fitMap = () => {
    const nodes = displayedNodes.length ? displayedNodes : project.graph.nodes;
    const detailLayout = focusedEcologyPositions || phoneRelationshipPositions;
    const nextViewport = detailLayout
      ? fitViewport(
        nodes,
        phoneLayout ? 650 : 440,
        phoneLayout,
        focusedEcologyPositions && !phoneLayout ? focusedDetailBounds : [],
        focusedEcologyPositions ? focusedDetailMinimumZoom : readableZoomFloor(true),
      )
      : mapMode === 'ecology'
        ? fitViewport(
          nodes,
          phoneLayout ? 650 : 540,
          phoneLayout,
          [...ecologyViewportBounds(visibleScale === 'all' ? ecologyLayers : [visibleScale]), ...visibleRelationshipBounds],
        )
        : fitViewport(nodes, phoneLayout ? 650 : 500, phoneLayout, visibleRelationshipBounds);
    if (phoneOverviewPositions || phoneEcologyPositions || detailLayout) {
      setMapViewport(nextViewport);
      return;
    }
    changeViewport(nextViewport);
  };
  const arrangeMap = () => {
    const liveNodes = project.graph.nodes.filter((node) => showRemoved || node.claimState !== 'retired');
    const nodes = visibleScale === 'all' ? liveNodes : visibleNodes.length ? visibleNodes : liveNodes;
    const positions = mapMode === 'ecology'
      ? arrangedEcologyPositions(nodes, phoneLayout)
      : phoneLayout
        ? arrangedPhoneOverviewPositions(nodes)
        : arrangedMapPositions(nodes, visibleScale === 'all', 5, false);
    const arrangedNodes = nodes.map((node) => ({ ...node, ...positions.get(node.id) }));
    const nextLabelBounds = focusedEcologyCalloutBounds(
      visibleEdges,
      arrangedNodes,
      new Map(arrangedNodes.map((node) => [node.id, { x: node.x, y: node.y }])),
      phoneLayout,
    );
    const nextViewport = readingViewport(arrangedNodes, visibleScale, nextLabelBounds);
    update((draft) => {
      draft.graph.nodes.forEach((node) => {
        const position = positions.get(node.id);
        if (position) Object.assign(node, position);
      });
      draft.viewport = nextViewport;
    }, 'map.arranged', visibleScale === 'all' ? 'All layers arranged' : `${SCALES[visibleScale]?.label || visibleScale} arranged`);
    setAutomaticPositions(null);
    setMapViewport(null);
    if (phoneLayout && mapMode === 'network') setPhoneOverviewCommittedScope(phoneOverviewScope);
    if (phoneLayout && mapMode === 'ecology') setPhoneEcologyCommittedScope(phoneEcologyScope);
    if (phoneLayout && drawerOpen) setPhoneViewport(nextViewport);
    logPrototype('map_arranged');
    toast(visibleScale === 'all' ? 'Map arranged by layer.' : 'Map arranged.');
  };
  const retireDependentScopes = (draft, memberId) => {
    const unavailableIds = new Set([memberId]);
    let changed = true;
    while (changed) {
      changed = false;
      ['candidates', 'graph'].forEach((container) => {
        draft[container].nodes.forEach((node) => {
          if (!Array.isArray(node.scopeNodeIds) || !node.scopeNodeIds.some((id) => unavailableIds.has(id)) || node.status === 'rejected' || node.claimState === 'retired') return;
          node.status = 'rejected';
          node.claimState = 'retired';
          const note = 'Removed because one of its mapped scope members is no longer available. The earlier scope remains in the record for review.';
          node.notes = node.notes ? `${node.notes}\n\n${note}` : note;
          unavailableIds.add(node.id);
          changed = true;
        });
      });
    }
  };
  const editNode = (field, value) => {
    if (!selectedNode) return;
    if (field === 'scale') return toast('A node’s level is fixed after it is mapped. Remove it and add it at the correct level instead.', 'error');
    if (field === 'label' && !isCanonicalMapElementLabel(value, selectedNode.scale)) return toast('Name one complete map element instead of a reference, time, modifier, action, or fragment.', 'error');
    if (field === 'label' && containsRetiredSystemsLanguage(value)) return toast('Use a direct, conventional name for the map element.', 'error');
    if (field === 'type' && !isNodeTypeAllowedAtScale(value, selectedNode.scale)) return toast(`That type does not belong at ${SCALES[selectedNode.scale].label}.`, 'error');
    if (field === 'label' && selectedNode.scale === 'micro' && !isDiscreteMicroNodeLabel(value)) return toast('Name one specific person, role, group, activity, object, or immediate setting.', 'error');
    if (field === 'label' && selectedNode.scale === 'meso' && !isMesosystemLabel(value)) return toast('Name how at least two Micro settings relate to one another, without adding a directional connection.', 'error');
    if (field === 'label' && selectedNode.scale === 'exosphere' && !isNamedInstitutionLabel(value)) return toast('Use the full name of an institution, agency, office, or service system.', 'error');
    if (field === 'label' && selectedNode.scale === 'macrosphere' && isObviousLowerLevelMacroLabel(value)) return toast(LOWER_LEVEL_MACRO_MESSAGE, 'error');
    if (field === 'label' && selectedNode.scale === 'macrosphere' && labelRepeatsInstitution(value, project.graph.nodes.filter((node) => node.scale === 'exosphere'))) return toast('That label names or repeats an institution. Add it at Exosphere instead.', 'error');
    if (field === 'scopeNodeIds' && ['meso', 'macrosphere'].includes(selectedNode.scale) && value.length < 2) return toast(selectedNode.scale === 'meso' ? 'A mesosystem must include at least two Micro settings.' : 'A Macrosphere item must affect at least two mapped elements.', 'error');
    update((draft) => {
    const node = draft.graph.nodes.find((item) => item.id === selection?.id);
    if (!node) return;
    const settingRoleRemoved = field === 'type' && node.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(node.type) && !MICRO_SETTING_NODE_TYPE_SET.has(value);
    node[field] = value;
    if (settingRoleRemoved) retireDependentScopes(draft, node.id);
    if (field === 'label') draft.graph.edges.forEach((edge) => {
      if (edge.source === node.id) edge.sourceLabel = value;
      if (edge.target === node.id) edge.targetLabel = value;
    });
    });
  };
  const setSelectedRemoved = (removed) => {
    if (!selection) return;
    if (!removed && selection.kind === 'node' && containsRetiredSystemsLanguage(selectedNode?.label)) return toast('Rename this item with a direct, conventional name before returning it to the map.', 'error');
    if (!removed && selection.kind === 'node' && ['meso', 'macrosphere'].includes(selectedNode?.scale)) {
      const memberById = new Map(project.graph.nodes.map((node) => [node.id, node]));
      const membersAreAvailable = (selectedNode.scopeNodeIds || []).length >= 2 && selectedNode.scopeNodeIds.every((id) => {
        const member = memberById.get(id);
        return member && member.status !== 'rejected' && member.claimState !== 'retired'
          && (selectedNode.scale !== 'meso' || (member.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(member.type)));
      });
      if (!membersAreAvailable) return toast(selectedNode.scale === 'meso' ? 'Restore at least two included Micro settings before returning this mesosystem to the map.' : 'Restore at least two affected mapped elements before returning this Macrosphere item to the map.', 'error');
    }
    if (!removed && selection.kind === 'node' && selectedNode?.scale === 'exosphere' && !isNamedInstitutionLabel(selectedNode.label)) {
      return toast('Rename this item with the full name of an institution, agency, office, or service system before returning it to the map.', 'error');
    }
    if (!removed && selection.kind === 'node' && selectedNode?.scale === 'micro' && !isDiscreteMicroNodeLabel(selectedNode.label)) {
      return toast('Name one specific person, role, group, activity, object, or immediate setting before returning it to the map.', 'error');
    }
    if (!removed && selection.kind === 'node' && !isCanonicalMapElementLabel(selectedNode?.label, selectedNode?.scale)) {
      return toast('Name one complete map element instead of a reference, time, modifier, action, or fragment.', 'error');
    }
    if (!removed && selection.kind === 'node' && selectedNode?.scale === 'macrosphere' && isObviousLowerLevelMacroLabel(selectedNode.label)) {
      return toast(LOWER_LEVEL_MACRO_MESSAGE, 'error');
    }
    if (!removed && selection.kind === 'edge') {
      const edge = project.graph.edges.find((item) => item.id === selection.id);
      const liveIds = new Set(project.graph.nodes.filter((node) => node.status !== 'rejected' && node.claimState !== 'retired').map((node) => node.id));
      if (!edge || !liveIds.has(edge.source) || !liveIds.has(edge.target)) return toast('Restore both endpoint nodes before returning this relationship to the map.', 'error');
      const endpointById = new Map(project.graph.nodes.map((node) => [node.id, node]));
      const sourceNode = endpointById.get(edge.source);
      const targetNode = endpointById.get(edge.target);
      if (edge.scale === 'micro' && (sourceNode?.scale !== 'micro' || targetNode?.scale !== 'micro')) return toast('A Micro relationship must connect two Micro elements.', 'error');
      if (edge.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(sourceNode?.type) && MICRO_SETTING_NODE_TYPE_SET.has(targetNode?.type)) return toast('An interrelation between two immediate settings belongs at Meso, not in Micro relationships.', 'error');
      if (edge.scale === 'exosphere' && ((sourceNode?.scale !== 'exosphere' && targetNode?.scale !== 'exosphere') || [sourceNode?.scale, targetNode?.scale].includes('macrosphere') || !scaleLexiconVerb('exosphere', edge.verb))) return toast('This relationship must include an Exosphere institution and use an institutional action before it can return to the map.', 'error');
    }
    update((draft) => {
      const items = selection.kind === 'node' ? draft.graph.nodes : draft.graph.edges;
      const item = items.find((candidate) => candidate.id === selection.id);
      if (!item) return;
      if (removed && selection.kind === 'node') retireDependentScopes(draft, item.id);
      item.status = removed ? 'rejected' : 'confirmed';
      item.claimState = removed ? 'retired' : 'student interpretation';
    }, removed ? 'map.item.removed' : 'map.item.restored', selection.id);
    if (removed && !showRemoved) {
      setSelection(null);
      setFocus(null);
      setFocusPage(0);
      setInspectorTab('map');
      setDrawerOpen(false);
    }
    toast(removed ? 'Item removed from the map.' : 'Item returned to the map.');
  };
  const commitAnnotations = () => commitAnnotationDrafts().changed;
  const relationshipNodes = project.graph.nodes.filter((node) => node.status !== 'rejected'
    && node.claimState !== 'retired'
    && (project.activeScale !== 'micro' || node.scale === 'micro')
    && (project.activeScale !== 'exosphere' || node.scale !== 'macrosphere')
    && !['meso', 'macrosphere'].includes(project.activeScale));
  const relationshipSource = relationshipNodes.find((node) => node.id === newEdge.source) || relationshipNodes[0];
  const relationshipTarget = relationshipNodes.find((node) => node.id === newEdge.target && node.id !== relationshipSource?.id)
    || relationshipNodes.find((node) => node.id !== relationshipSource?.id);
  const addNode = () => {
    if (!project.instructor.allowResearchLeads) return toast('Items needing more evidence are turned off for this project.', 'error');
    if (project.activeScale === 'meso') return toast('Add mesosystems from the Choose stage so each one includes at least two Micro settings.', 'error');
    if (project.activeScale === 'macrosphere') return toast('Add Macrosphere items from the Choose stage so each one identifies the mapped elements it affects.', 'error');
    if (project.graph.nodes.length >= PROJECT_LIMITS.nodes) return toast(`This map already contains the maximum ${PROJECT_LIMITS.nodes} nodes.`, 'error');
    if (!newNode.label.trim()) return toast('Name the node before adding it.', 'error');
    if (!isCanonicalMapElementLabel(newNode.label, newNode.scale)) return toast('Name one complete map element instead of a reference, time, modifier, action, or fragment.', 'error');
    if (containsRetiredSystemsLanguage(newNode.label)) return toast('Use a direct, conventional name for the map element.', 'error');
    if (!isNodeTypeAllowedAtScale(newNode.type, newNode.scale) || ['meso', 'macrosphere'].includes(newNode.scale)) return toast('Choose a type and level that belong together.', 'error');
    if (newNode.scale === 'micro' && !isDiscreteMicroNodeLabel(newNode.label)) return toast('Name one specific person, role, group, activity, object, or immediate setting.', 'error');
    if (newNode.scale === 'exosphere' && !isNamedInstitutionLabel(newNode.label)) return toast('Use the full name of an institution, agency, office, or service system.', 'error');
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
    setNewNode({ label: '', type: project.activeScale === 'exosphere' ? 'institution' : 'person', scale: project.activeScale, evidence: '', claimState: 'research lead' });
    setAddMode(null);
    toast('Node added.');
  };
  const addEdge = () => {
    if (!project.instructor.allowResearchLeads) return toast('Items needing more evidence are turned off for this project.', 'error');
    if (project.activeScale === 'meso') return toast('Meso shows how Micro settings relate to one another. Add direct connections at Micro.', 'error');
    if (project.activeScale === 'macrosphere') return toast('Macrosphere items identify the mapped elements each broader condition affects. Add direct connections at Micro.', 'error');
    if (project.graph.edges.length >= PROJECT_LIMITS.edges) return toast(`This map already contains the maximum ${PROJECT_LIMITS.edges} relationships.`, 'error');
    const source = relationshipSource;
    const target = relationshipTarget;
    if (!source || !target || source.id === target.id) return toast('Choose two different nodes.', 'error');
    if (!newEdge.verb.trim()) return toast('Describe the connection before adding the relationship.', 'error');
    if (project.activeScale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(source.type) && MICRO_SETTING_NODE_TYPE_SET.has(target.type)) return toast('An interrelation between two immediate settings belongs at Meso, not in Micro relationships.', 'error');
    if (project.activeScale === 'exosphere' && source.scale !== 'exosphere' && target.scale !== 'exosphere') return toast('An Exosphere relationship must include an Exosphere institution.', 'error');
    if (project.activeScale === 'exosphere' && (source.scale === 'macrosphere' || target.scale === 'macrosphere')) return toast('Connect the institution to an inner mapped element, not a Macrosphere item.', 'error');
    const canonicalVerb = project.activeScale === 'exosphere' ? scaleLexiconVerb('exosphere', newEdge.verb) : newEdge.verb.trim();
    if (!canonicalVerb) return toast('Choose an institutional relationship such as funds, regulates, employs, or provides.', 'error');
    if (project.instructor.evidenceRequired && !newEdge.evidence.trim()) return toast('Add evidence or a question before adding the relationship.', 'error');
    const id = stableId('edge', `${source.id}:${newEdge.verb}:${target.id}:${Date.now()}`);
    update((draft) => { draft.graph.edges.push({ ...newEdge, verb: canonicalVerb, id, source: source.id, target: target.id, sourceLabel: source.label, targetLabel: target.label, scale: project.activeScale, status: 'confirmed', notes: '', annotation: { id: stableId('annotation', `edge:${id}:relationship`), text: '' } }); }, 'edge.added', `${source.label} ${canonicalVerb} ${target.label}`);
    setSelection({ kind: 'edge', id });
    setInspectorTab('relationships');
    setAddMode(null);
    toast('Relationship added.');
  };
  const requestedViewport = phoneLayout && drawerOpen && phoneViewport ? phoneViewport : mapViewport || project.viewport;
  const canvasViewport = {
    ...requestedViewport,
    zoom: clamp(requestedViewport.zoom, minimumInteractiveZoom, VIEWPORT_LIMITS.maxZoom),
  };
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
  const mapLabel = visibleScale === 'all' ? 'All-layers map' : `${SCALES[visibleScale]?.label || visibleScale} map`;
  const focusLabel = focusedNode?.label || (focusedEdge ? `${focusedEdge.sourceLabel} to ${focusedEdge.targetLabel}` : '');
  const focusSummary = focusedNode?.scale === 'meso'
    ? <>Showing the Micro settings included in <strong>{focusLabel}</strong>.</>
    : focusedNode?.scale === 'macrosphere'
      ? <>Showing mapped elements affected by <strong>{focusLabel}</strong>.</>
      : <>Showing connections for <strong>{focusLabel}</strong>.</>;
  const inspectorTabs = ['meso', 'macrosphere'].includes(visibleScale)
    ? INSPECTOR_TABS.filter((tab) => tab !== 'relationships')
    : INSPECTOR_TABS;
  const focusHasRelationshipPages = focus?.kind === 'node' && focusIncidentEdges.length > 0;
  const mapOverviewHint = visibleScale === 'meso'
    ? 'Choose a mesosystem to see the Micro settings it includes.'
    : visibleScale === 'macrosphere'
      ? 'Choose a Macrosphere item to see the mapped elements it affects.'
      : 'Choose a node to see its relationships.';
  const changeFocusPage = (nextPage) => {
    const boundedPage = clamp(nextPage, 0, focusPageCount - 1);
    setFocusPage(boundedPage);
    setAnnouncement(`Showing relationship ${boundedPage + 1} of ${focusIncidentEdges.length} for ${focusLabel}.`);
  };
  const toggleFullscreen = () => {
    const next = !fullscreen;
    setFullscreen(next);
    setAnnouncement(next ? 'Full screen map opened.' : 'Full screen map closed.');
    if (next) {
      const nodes = displayedNodes.length ? displayedNodes : project.graph.nodes;
      const nextViewport = focusedEcologyPositions
        ? fitViewport(nodes, phoneLayout ? 650 : 540, phoneLayout, focusedDetailBounds, focusedDetailMinimumZoom)
        : phoneRelationshipPositions
          ? fitViewport(nodes, 650, true, [], readableZoomFloor(true))
          : readingViewport(nodes, visibleScale, visibleRelationshipBounds);
      setMapViewport(nextViewport);
    } else {
      window.requestAnimationFrame(() => fullscreenToggleRef.current?.focus());
    }
  };
  return <div className={`map-stage map-stage--${mapMode} stage-enter ${focusActive || visibleScale === 'all' ? 'has-map-context' : ''} ${fullscreen ? 'is-fullscreen' : ''}`}>
    <MemoDrawer project={project} update={update} hint="Changing this memo clears the current map and restarts at Micro." />
    <div className="map-toolbar"><h1>Build the map</h1><div className="map-toolbar__controls"><label><span>Show layer</span><select aria-label="Show map layer" value={visibleScale} onChange={(event) => changeVisibleScale(event.target.value)}>{project.releasedScales.map((scale) => <option key={scale} value={scale}>{SCALES[scale].label}</option>)}<option value="all">All layers</option></select></label>{mapMode === 'ecology' && phoneLayout && visibleScale !== 'all' ? <button className="map-show-all" type="button" onClick={() => changeVisibleScale('all')}>Show all layers</button> : null}{hasRemovedItems && <label className="map-removed-toggle"><input type="checkbox" checked={showRemoved} onChange={(event) => setShowRemoved(event.target.checked)} /><span>Show removed items</span></label>}</div></div>
    {focusActive ? <div className="map-focus-bar" role="status"><div className="map-focus-bar__summary"><span>{focusSummary}</span>{focusHasRelationshipPages && <small aria-live="polite">Relationship {activeFocusPage + 1} of {focusIncidentEdges.length}</small>}</div><div className="map-focus-bar__actions">{focusHasRelationshipPages && focusPageCount > 1 ? <><button type="button" aria-label="Previous relationship" disabled={activeFocusPage === 0} onClick={() => changeFocusPage(activeFocusPage - 1)}>Previous</button><button type="button" aria-label="Next relationship" disabled={activeFocusPage === focusPageCount - 1} onClick={() => changeFocusPage(activeFocusPage + 1)}>Next</button></> : null}<button type="button" onClick={showFullMap}>Show full map</button></div></div> : <p className="map-overview-hint">{mapOverviewHint}</p>}
    <div className={`map-layout ${drawerOpen ? 'has-inspector' : ''}`}>
      <section ref={canvasWrapRef} className={`canvas-wrap ${phoneLayout && drawerOpen ? 'is-inspector-open' : ''} ${fullscreen ? 'is-fullscreen' : ''}`} aria-label="Map canvas and controls">
        <MemoGraphCanvas nodes={displayedNodes} edges={visibleEdges} selection={selection} onSelect={selectItem} onMoveNode={moveNode} viewport={canvasViewport} phoneLayout={phoneLayout} mapLabel={mapLabel} mapMode={mapMode} ecologyLayers={ecologyLayers} visibleLayer={visibleScale} detailMode={Boolean(phoneRelationshipPositions || focusedEcologyPositions)} interactionMode={phoneLayout && drawerOpen ? 'phone-drawer' : 'durable'} panMode={panMode} onViewportChange={changeViewport} onAnnounce={setAnnouncement} />
        <div className="canvas-controls" role="toolbar" aria-label="Map view controls" aria-hidden={phoneLayout && drawerOpen ? 'true' : undefined} inert={phoneLayout && drawerOpen}><button type="button" aria-pressed={panMode} className={panMode ? 'is-active' : ''} onClick={() => setPanMode((current) => !current)}>Pan</button><button type="button" aria-label="Zoom out" disabled={canvasViewport.zoom <= minimumInteractiveZoom} onClick={() => zoomBy(-0.15)}>−</button><button type="button" aria-label="Zoom in" disabled={canvasViewport.zoom >= VIEWPORT_LIMITS.maxZoom} onClick={() => zoomBy(0.15)}>+</button>{!(focusedEcologyPositions || phoneRelationshipPositions) && <button type="button" onClick={arrangeMap}>Arrange map</button>}<button type="button" onClick={fitMap}>{mapMode === 'ecology' ? 'Center map' : 'Fit map'}</button><button type="button" aria-expanded={legendOpen} onClick={() => setLegendOpen((current) => { const opening = !current; if (opening) { setDrawerOpen(false); setCreateMenuOpen(false); } return opening; })}>Map key</button><button ref={fullscreenToggleRef} type="button" aria-pressed={fullscreen} onClick={toggleFullscreen}>{fullscreen ? 'Exit full screen' : 'Full screen map'}</button><button className="phone-inspector-trigger" type="button" aria-expanded={drawerOpen} onClick={() => { if (!project.graph.nodes.length) setInspectorTab('map'); setLegendOpen(false); setDrawerOpen(true); }}>Details</button></div>
        {legendOpen && <aside className="map-legend" aria-label="Map key"><div className="map-legend__head"><strong>Map key</strong><button type="button" onClick={() => setLegendOpen(false)} aria-label="Close map key"><Icon name="close" /></button></div><MapLegend /></aside>}
        <div className="sr-only" aria-live="polite">{announcement}</div>
      </section>
      <aside ref={inspectorRef} className={`inspector ${drawerOpen ? 'is-open' : ''}`} aria-label="Map inspector" aria-hidden={!drawerOpen ? 'true' : undefined} inert={!drawerOpen} onKeyDown={(event) => { if (event.key === 'Escape' && drawerOpen) { event.preventDefault(); closeInspector(); } }}>
        <div className="inspector__head">
          <h2>{selectedNode?.label || (selectedEdge ? `${selectedEdge.sourceLabel} → ${selectedEdge.targetLabel}` : 'Map details')}</h2>
          <div className="inspector__actions">
            {project.instructor.allowResearchLeads && <div className="inspector-add-menu"><button type="button" aria-expanded={createMenuOpen} aria-controls="inspector-add-actions" onClick={() => setCreateMenuOpen((current) => !current)}>Add</button>{createMenuOpen && <div id="inspector-add-actions">{!['meso', 'macrosphere'].includes(project.activeScale) && <button type="button" onClick={() => { setAddMode('node'); setCreateMenuOpen(false); }}>Node</button>}{['micro', 'exosphere'].includes(project.activeScale) && <button type="button" onClick={() => { setAddMode('edge'); setCreateMenuOpen(false); }}>Relationship</button>}</div>}</div>}
            <button className="inspector-done" type="button" onClick={closeInspector}>Done</button>
          </div>
        </div>
        <div className="inspector-tabs" role="tablist" aria-label="Annotation target">{inspectorTabs.map((tab) => <button key={tab} id={`map-inspector-tab-${tab}`} type="button" role="tab" aria-selected={inspectorTab === tab} aria-controls={`map-inspector-panel-${tab}`} tabIndex={inspectorTab === tab ? 0 : -1} data-composite-value={tab} onClick={() => setTab(tab)} onKeyDown={(event) => handleCompositeKey(event, inspectorTabs, inspectorTab, setTab)}>{tab === 'relationships' ? 'Relationships' : tab[0].toUpperCase() + tab.slice(1)}</button>)}</div>
        {addMode === 'node' && <div className="add-form"><h3>Add a node</h3><Field label="Label"><input maxLength={NODE_LABEL_LIMIT} value={newNode.label} onChange={(event) => setNewNode((current) => ({ ...current, label: event.target.value }))} /></Field><div className="field-pair"><Field label="Type"><select value={newNode.type} onChange={(event) => setNewNode((current) => ({ ...current, type: event.target.value }))}>{NODE_TYPES.filter((type) => isNodeTypeAllowedAtScale(type, newNode.scale)).map((type) => <option key={type}>{type}</option>)}</select></Field><Field label="Level"><select value={newNode.scale} onChange={(event) => setNewNode((current) => ({ ...current, scale: event.target.value, type: isNodeTypeAllowedAtScale(current.type, event.target.value) ? current.type : (event.target.value === 'exosphere' ? 'institution' : 'person') }))}>{project.releasedScales.filter((scale) => !['meso', 'macrosphere'].includes(scale)).map((scale) => <option key={scale}>{SCALES[scale]?.label || scale}</option>)}</select></Field></div><Field label="Evidence or question"><textarea maxLength={PROJECT_LIMITS.noteText} rows="3" value={newNode.evidence} onChange={(event) => setNewNode((current) => ({ ...current, evidence: event.target.value }))} /></Field><button className="button" type="button" onClick={addNode}>Add node</button></div>}
        {addMode === 'edge' && ['micro', 'exosphere'].includes(project.activeScale) && <div className="add-form"><h3>Add a relationship</h3><Field label="From"><select value={relationshipSource?.id || ''} onChange={(event) => setNewEdge((current) => ({ ...current, source: event.target.value }))}>{relationshipNodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field><Field label="Relationship">{project.activeScale === 'exosphere' ? <select value={scaleLexiconVerb('exosphere', newEdge.verb) || SCALE_VERB_LEXICONS.exosphere[0]} onChange={(event) => setNewEdge((current) => ({ ...current, verb: event.target.value }))}>{SCALE_VERB_LEXICONS.exosphere.map((verb) => <option key={verb}>{verb}</option>)}</select> : <input maxLength={RELATIONSHIP_VERB_LIMIT} value={newEdge.verb} onChange={(event) => setNewEdge((current) => ({ ...current, verb: event.target.value }))} />}</Field><Field label="To"><select value={relationshipTarget?.id || ''} onChange={(event) => setNewEdge((current) => ({ ...current, target: event.target.value }))}>{relationshipNodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field><Field label="Evidence or question"><textarea maxLength={PROJECT_LIMITS.noteText} rows="3" value={newEdge.evidence} onChange={(event) => setNewEdge((current) => ({ ...current, evidence: event.target.value }))} /></Field><button className="button" type="button" onClick={addEdge}>Add relationship</button></div>}
        {!addMode && inspectorTab === 'node' && <div id="map-inspector-panel-node" className="inspector__body" role="tabpanel" aria-labelledby="map-inspector-tab-node">{selectedNode ? <>
          <details className="node-summary">
            <summary><span>Summary</span><strong>{selectedNode.type}</strong></summary>
            <div className="node-summary__body">
              <Field label="Label">{selectedNode.scale === 'meso'
                ? <CommitInput maxLength={NODE_LABEL_LIMIT} value={selectedNode.label} validate={isMesosystemLabel} onCommit={(value) => editNode('label', value)} onInvalid={() => toast('Give the mesosystem a clear name, such as “coordination between home and school.”', 'error')} />
                : selectedNode.scale === 'micro'
                  ? <CommitInput maxLength={NODE_LABEL_LIMIT} value={selectedNode.label} validate={isDiscreteMicroNodeLabel} onCommit={(value) => editNode('label', value)} onInvalid={() => toast('Name one specific person, role, group, activity, object, or immediate setting.', 'error')} />
                  : selectedNode.scale === 'exosphere'
                  ? <CommitInput maxLength={NODE_LABEL_LIMIT} value={selectedNode.label} validate={isNamedInstitutionLabel} onCommit={(value) => editNode('label', value)} onInvalid={() => toast('Use the full name of an institution, agency, office, or service system.', 'error')} />
                  : <input maxLength={NODE_LABEL_LIMIT} value={selectedNode.label} onChange={(event) => editNode('label', event.target.value)} />}</Field>
              <div className="field-pair">
                {selectedNode.scale === 'meso'
                  ? <Field label="Type"><input value="mesosystem" readOnly /></Field>
                  : <Field label="Type"><select value={selectedNode.type} onChange={(event) => editNode('type', event.target.value)}>{NODE_TYPES.filter((type) => isNodeTypeAllowedAtScale(type, selectedNode.scale)).map((type) => <option key={type}>{type}</option>)}</select></Field>}
                <Field label="Level"><input value={SCALES[selectedNode.scale].label} readOnly /></Field>
              </div>
              {['meso', 'macrosphere'].includes(selectedNode.scale) && <div className="scope-editor" aria-label={selectedNode.scale === 'meso' ? `Micro settings included in ${selectedNode.label}` : `Mapped elements affected by ${selectedNode.label}`}>
                {selectedNode.scale === 'macrosphere' && <div className="scope-editor__mode"><label><span>How it affects mapped elements</span><select aria-label={`How ${selectedNode.label} affects mapped elements`} value={SCALE_VERB_LEXICONS.macrosphere.includes(selectedNode.deontic) ? selectedNode.deontic : 'shapes'} onChange={(event) => editNode('deontic', event.target.value)}>{SCALE_VERB_LEXICONS.macrosphere.map((verb) => <option key={verb}>{verb}</option>)}</select></label></div>}
                <div className="scope-editor__members">
                  {(selectedNode.scopeNodeIds || []).map((memberId) => {
                    const member = project.graph.nodes.find((node) => node.id === memberId);
                    if (!member) return null;
                    const removeLabel = selectedNode.scale === 'meso' ? `Remove ${member.label} from ${selectedNode.label}` : `Remove ${member.label} from the mapped elements affected by ${selectedNode.label}`;
                    return <button key={memberId} type="button" className="scope-chip" onClick={() => editNode('scopeNodeIds', (selectedNode.scopeNodeIds || []).filter((entry) => entry !== memberId))} aria-label={removeLabel}>{member.label}<span aria-hidden="true"> ×</span></button>;
                  })}
                  <select className="scope-editor__add" aria-label={selectedNode.scale === 'meso' ? `Add a Micro setting to ${selectedNode.label}` : `Add a mapped element affected by ${selectedNode.label}`} value="" onChange={(event) => { const memberId = event.target.value; if (!memberId) return; const current = selectedNode.scopeNodeIds || []; if (current.includes(memberId) || current.length >= PROJECT_LIMITS.scopeMembers) return; editNode('scopeNodeIds', [...current, memberId]); }}>
                    <option value="">{selectedNode.scale === 'meso' ? 'Add Micro setting…' : 'Add element…'}</option>
                    {project.graph.nodes.filter((node) => node.status !== 'rejected' && node.claimState !== 'retired' && node.id !== selectedNode.id && !(selectedNode.scopeNodeIds || []).includes(node.id) && (selectedNode.scale === 'meso' ? node.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(node.type) : node.scale !== 'macrosphere')).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
                  </select>
                  {(selectedNode.scopeNodeIds || []).length < 2 && <span className="scope-editor__empty">{selectedNode.scale === 'meso' ? 'Choose at least two Micro settings.' : 'Choose at least two mapped elements.'}</span>}
                </div>
              </div>}
              <div className="provenance-block"><span>Evidence</span><p>{selectedNode.evidence || 'No evidence added yet.'}</p>{selectedNode.notes && <><span>Annotation</span><p>{selectedNode.notes}</p></>}</div>
            </div>
          </details>
          <button className="map-item-action" type="button" onClick={() => setSelectedRemoved(!selectedItemRemoved)}>{selectedItemRemoved ? 'Return to map' : 'Remove from map'}</button>
          <section className="annotation-disclosure"><button type="button" aria-expanded={annotationDisclosure === 'analytical'} aria-controls="node-analytical-annotation" onClick={() => setAnnotationDisclosure((current) => current === 'analytical' ? null : 'analytical')}><span>Annotation</span><Icon name={annotationDisclosure === 'analytical' ? 'close' : 'plus'} /></button>{annotationDisclosure === 'analytical' && <div id="node-analytical-annotation"><AnnotationField key={selectedNode.annotations.analytical.id} annotationId={selectedNode.annotations.analytical.id} label="Annotation" value={selectedNode.annotations.analytical.text} onDraftValue={(text) => stageAnnotationDraft(selectedNode.annotations.analytical.id, text)} {...annotationProps} /></div>}</section>
          <section className="annotation-disclosure"><button type="button" aria-expanded={annotationDisclosure === 'evidence'} aria-controls="node-evidence-annotation" onClick={() => setAnnotationDisclosure((current) => current === 'evidence' ? null : 'evidence')}><span>Evidence</span><Icon name={annotationDisclosure === 'evidence' ? 'close' : 'plus'} /></button>{annotationDisclosure === 'evidence' && <div id="node-evidence-annotation"><AnnotationField key={selectedNode.annotations.evidence.id} annotationId={selectedNode.annotations.evidence.id} label="Evidence" value={selectedNode.annotations.evidence.text} placeholder="How does the evidence support, limit, or complicate this node?" onDraftValue={(text) => stageAnnotationDraft(selectedNode.annotations.evidence.id, text)} {...annotationProps} /></div>}</section>
        </> : <p className="empty-message">Choose a node on the map to inspect and annotate it.</p>}</div>}
        {!addMode && inspectorTab === 'relationships' && <div id="map-inspector-panel-relationships" className="inspector__body" role="tabpanel" aria-labelledby="map-inspector-tab-relationships"><div className="relationship-picker" aria-label="Relationship list">{relatedEdges.map((edge) => <button type="button" key={edge.id} className={selectedEdge?.id === edge.id ? 'is-selected' : ''} onClick={() => selectItem('edge', edge.id)}><span>{edge.sourceLabel} <strong>{edge.verb}</strong> {edge.targetLabel}</span></button>)}</div>{selectedEdge ? <><details className="node-summary"><summary><span>Summary</span><strong>{selectedEdge.verb}</strong></summary><div className="node-summary__body"><div className="provenance-block"><span>Evidence</span><p>{selectedEdge.evidence || 'No evidence added yet.'}</p></div></div></details><button className="map-item-action" type="button" onClick={() => setSelectedRemoved(!selectedItemRemoved)}>{selectedItemRemoved ? 'Return to map' : 'Remove from map'}</button><AnnotationField key={selectedEdge.annotation.id} annotationId={selectedEdge.annotation.id} label="Annotation" value={selectedEdge.annotation.text} placeholder="What does this relationship explain, and what remains uncertain?" onDraftValue={(text) => stageAnnotationDraft(selectedEdge.annotation.id, text)} {...annotationProps} /></> : <p className="empty-message">Choose a relationship on the map or from this list to annotate it.</p>}</div>}
        {!addMode && inspectorTab === 'map' && <div id="map-inspector-panel-map" className="inspector__body" role="tabpanel" aria-labelledby="map-inspector-tab-map"><div className="map-summary">{visibleScale === 'meso' ? <><strong>{mesoLinkageCount}</strong><span>{mesoLinkageCount === 1 ? 'mesosystem' : 'mesosystems'}</span><strong>{mesoSettingCount}</strong><span>Micro {mesoSettingCount === 1 ? 'setting' : 'settings'}</span></> : <><strong>{scaleNodes.length}</strong><span>nodes</span><strong>{scaleEdges.length}</strong><span>relationships</span></>}</div><AnnotationField key={project.mapAnnotation.id} annotationId={project.mapAnnotation.id} label="Map note" value={project.mapAnnotation.text} hint="Write about a pattern, boundary, contradiction, or question across the map." placeholder="Across the map, I notice…" onDraftValue={(text) => stageAnnotationDraft(project.mapAnnotation.id, text)} {...annotationProps} /></div>}
      </aside>
    </div>
  </div>;
}

const REVISION_EVENT_COPY = Object.freeze({
  'project.created': ['Project started', true],
  'project.imported': ['Project imported', true],
  'memo.imported': ['Memo imported', true],
  'source.imported': ['Memo imported', true],
  'preflight.completed': ['Guidance refreshed', false],
  'candidate.confirmed': ['Map item kept', false],
  'candidate.research lead': ['Item marked as needing evidence', false],
  'candidate.rejected': ['Map item removed', false],
  'candidates.batch-confirmed': ['Map items kept', false],
  'candidates.generated': ['Suggestions prepared', true],
  'candidates.refreshed': ['Suggestions refreshed', true],
  'graph.committed': ['Map updated', false],
  'node.added': ['Node added', true],
  'edge.added': ['Relationship added', true],
  'map.arranged': ['Map arranged', true],
  'map.item.removed': ['Item removed from map', false],
  'map.item.restored': ['Item returned to map', false],
  'scale.selected': ['Level changed', true],
  'scale.cycle-completed': ['Level cycle saved', true],
  'stage.opened': ['Section opened', true],
  'release.opened': ['Level opened', true],
  'reflection.revised': ['Revision note saved', false],
  'sharing.changed': ['Export audience changed', true],
  'config.revised': ['Model setup changed', false],
  'instructor.setting': ['Course setting changed', false],
});

function revisionEventCopy(event) {
  const [label, showDetail] = REVISION_EVENT_COPY[event.action] || ['Project updated', false];
  return { label, detail: showDetail ? event.detail : '' };
}

function activeLevelGraph(project) {
  const edges = project.graph.edges.filter((edge) => edge.scale === project.activeScale && edge.claimState !== 'retired');
  const nodes = project.graph.nodes.filter((node) => node.claimState !== 'retired' && node.scale === project.activeScale);
  return { nodes, edges };
}

function RevisionStage({ project, update, replaceProject, toast, logPrototype }) {
  const [importError, setImportError] = useState('');
  const levelGraph = activeLevelGraph(project);
  const currentNodes = levelGraph.nodes.length;
  const currentRelationships = levelGraph.edges.length;
  const needsEvidence = [...levelGraph.nodes, ...levelGraph.edges].filter((item) => item.claimState === 'research lead').length;
  const levelLabel = SCALES[project.activeScale]?.label || project.activeScale;
  const currentSummary = project.activeScale === 'meso'
    ? `${currentNodes} ${currentNodes === 1 ? 'mesosystem is' : 'mesosystems are'} recorded.`
    : project.activeScale === 'macrosphere'
      ? `${currentNodes} ${currentNodes === 1 ? 'Macrosphere item is' : 'Macrosphere items are'} recorded.`
      : `${currentNodes} ${currentNodes === 1 ? 'node is' : 'nodes are'} recorded with ${currentRelationships} ${project.activeScale === 'micro' ? 'direct ' : ''}${currentRelationships === 1 ? 'relationship' : 'relationships'}.`;
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
    } catch { const message = 'This project file could not be opened safely. The current map was preserved.'; setImportError(message); toast(message, 'error'); }
    event.target.value = '';
  };
  const tiers = ['private', 'course', 'CUNY', 'public'];
  const maxIndex = tiers.indexOf(project.instructor.maxSharingTier);
  const exportProject = (format) => {
    try {
      const portable = createPortableProject(project, project.sharingTier);
      if (format === 'json') download(exportFileName(project, 'json'), serializePortableProject(project, project.sharingTier));
      if (format === 'csv') download(exportFileName(project, 'csv'), graphCsv(portable), 'text/csv');
      if (format === 'markdown') download(exportFileName(project, 'md'), projectMarkdown(portable), 'text/markdown');
      logPrototype('project_exported', { nodeCount: portable.graph.nodes.length, relationshipCount: portable.graph.edges.length });
      const redactionCount = portable.portableExport.redactions.length;
      toast(portable.portableExport.redacted ? `Export created. ${redactionCount} private ${redactionCount === 1 ? 'field was' : 'fields were'} removed.` : 'Export created.');
    } catch (error) {
      toast(`The export could not be created. ${error.message}`, 'error');
    }
  };
  return <div className="wide stage-enter">
    <p className="eyebrow">Revise and export</p>
    <h1>Review and export your map</h1>
    <p className="lede">Record what changed while you worked at this level, then export the complete project.</p>
    <MemoDrawer project={project} update={update} />
    <div className="revision-grid">
      <section>
        <div className="before-after"><div><span>Memo</span><p>You used evidence from the memo to build this level.</p></div><Icon name="arrow" size={24} /><div aria-label={`Current ${levelLabel} map summary`}><span>Current {levelLabel} map</span><p>{currentSummary}</p></div></div>
        <Field label="What changed in your map or interpretation?" hint="Optional note for this level cycle"><textarea className="reflection" rows="8" maxLength={PROJECT_LIMITS.promptText} value={project.reflection} onChange={(event) => update((draft) => { draft.reflection = event.target.value; })} onBlur={() => update(() => {}, 'reflection.revised', 'Level-cycle reflection')} placeholder="Record a correction, a change in interpretation, or a question you still need to investigate." /></Field>
        <div className="release-summary"><div><strong>{currentNodes}</strong><span>{project.activeScale === 'meso' ? 'mesosystems' : 'nodes on map'}</span></div>{project.activeScale !== 'meso' && project.activeScale !== 'macrosphere' && <div><strong>{currentRelationships}</strong><span>{project.activeScale === 'micro' ? 'direct relationships' : 'relationships'}</span></div>}<div><strong>{needsEvidence}</strong><span>items needing evidence</span></div><div><strong>{project.events.length}</strong><span>changes</span></div></div>
        <div className="sharing-row"><Field label="Who can receive this copy?"><select value={project.sharingTier} onChange={(event) => update((draft) => { draft.sharingTier = event.target.value; }, 'sharing.changed', event.target.value)}>{tiers.map((tier, index) => <option key={tier} value={tier} disabled={index > maxIndex}>{tier === 'private' ? 'Only me' : tier === 'course' ? 'Class' : tier === 'public' ? 'Public' : 'CUNY'}{index > maxIndex ? ' · unavailable' : ''}</option>)}</select></Field></div>
      </section>
      <details className="history-panel"><summary><span>Revision history</span><strong>{project.events.length} changes</strong></summary><ol className="timeline">{[...project.events].reverse().slice(0, 14).map((event) => { const presented = revisionEventCopy(event); return <li key={event.id}><span className="timeline__dot" /><div><strong>{presented.label}</strong>{presented.detail && <p>{presented.detail}</p>}<small>{new Date(event.at).toLocaleString()} · {event.actor}</small></div></li>; })}</ol></details>
    </div>
    <section className="export-strip"><div><p className="eyebrow">Export a copy</p><h2>Export the full map</h2><p>Choose JSON, CSV, or Markdown.</p></div><div className="export-actions"><button className="button button--secondary" onClick={() => exportProject('json')}><Icon name="download" />JSON</button><button className="button button--secondary" onClick={() => exportProject('csv')}><Icon name="download" />CSV</button><button className="button button--secondary" onClick={() => exportProject('markdown')}><Icon name="download" />Markdown</button><label className="button button--ghost"><Icon name="upload" />Import JSON<input type="file" accept=".json,application/json" onChange={onImport} /></label></div>{importError && <p className="error-text">{importError}</p>}</section>
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
    <div className="settings-section"><p className="eyebrow">Readiness and evidence</p><Field label="Readiness threshold"><input type="number" min="1" max="8" step="1" value={project.instructor.readinessThreshold} onChange={(event) => setReadinessThreshold(event.target.value)} /></Field><label className="check-row"><input type="checkbox" checked={project.instructor.evidenceRequired} onChange={(event) => set('evidenceRequired', event.target.checked)} /><span><strong>Require evidence</strong><small>Students must add evidence before moving a claim forward.</small></span></label><label className="check-row"><input type="checkbox" checked={project.instructor.requireStudentConfirmation} onChange={(event) => set('requireStudentConfirmation', event.target.checked)} /><span><strong>Students confirm every suggestion</strong><small>When off, suggestions start on Keep and students can remove or revise them before adding them to the map.</small></span></label></div>
    <div className="settings-section"><p className="eyebrow">Privacy and publication</p><Field label="Maximum sharing tier"><select value={project.instructor.maxSharingTier} onChange={(event) => set('maxSharingTier', event.target.value)}><option>private</option><option>course</option><option>CUNY</option><option>public</option></select></Field><label className="check-row"><input type="checkbox" checked={project.instructor.allowResearchLeads} onChange={(event) => set('allowResearchLeads', event.target.checked)} /><span><strong>Allow items needing more evidence</strong><small>Keep these items visually distinct.</small></span></label></div>
    <div className="settings-section"><p className="eyebrow">Map levels</p><div className="release-controls">{SCALE_ORDER.map((scale) => { const open = project.releasedScales.includes(scale); return <button key={scale} className={open ? 'is-open' : ''} disabled={open} onClick={() => release(scale)}>{open ? <Icon name="check" size={15} /> : <Icon name="plus" size={15} />}{SCALES[scale].label}</button>; })}</div></div>
    <div className="settings-section"><p className="eyebrow">Model settings</p><dl className="config-summary"><div><dt>Suggestion model</dt><dd>{project.configs.preflight.label} · v{project.configs.preflight.revision}</dd></div><div><dt>Graph builder</dt><dd>{project.configs.builder.label} · v{project.configs.builder.revision}</dd></div><div><dt>Runtime</dt><dd>{suggestionRuntimeLabel(project.preflight?.evaluation?.runtime)}</dd></div></dl><button type="button" className="button button--secondary" onClick={() => toast('Open “Review your memo,” then “Model setup,” to edit either model setup.')}>Where to edit</button></div>
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
  const [passwordResetToken, setPasswordResetToken] = useState(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = hash.get('teacher-reset');
    return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  });
  const [teacherOpen, setTeacherOpen] = useState(() => passwordResetToken !== null);
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
  const [link, setLink] = useState(loadStoredLink);
  const [linkStatus, setLinkStatus] = useState('idle');
  const [linkMessage, setLinkMessage] = useState(null);
  const toastTimer = useRef(null);
  const persistTimer = useRef(null);
  const linkSyncTimer = useRef(null);
  const linkLoadAttemptedRef = useRef(false);
  const linkRef = useRef(link);
  const pendingAnnotationsRef = useRef(new Map());
  const prototypeLogNoticeRef = useRef({ sequence: 0, lastFailure: 0 });
  const accessGenerationRef = useRef(0);
  const autoReviewKeyRef = useRef('');
  const projectRef = useRef(project);
  const connectionPromptRef = useRef(connectionPrompt);
  const workspaceRef = useRef(null);
  projectRef.current = project;
  connectionPromptRef.current = connectionPrompt;
  linkRef.current = link;
  const toast = useCallback((message, type = 'success') => {
    window.clearTimeout(toastTimer.current);
    setToastState({ message, type });
    toastTimer.current = window.setTimeout(() => setToastState(null), 3200);
  }, []);
  const finishPasswordReset = useCallback(() => {
    setPasswordResetToken(null);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    toast('Passphrase updated. Sign in to Teacher Console.', 'success');
  }, [toast]);

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
    } catch {
      setSaveState((current) => ({ ...current, status: 'validation', message: 'Complete or remove the current invalid map item before saving.' }));
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
    toast(error instanceof Error ? error.message : 'The guidance request could not be completed. Try again.', 'error');
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
    const hostedModelRuntime = runtime?.provider === 'ollama-cloud' || runtime?.provider === 'openrouter';
    if (hostedModelRuntime && encoder.encode(payload.inquiry).byteLength > MAX_EVALUATION_INQUIRY_BYTES) {
      toast('The guiding inquiry is too large to send. Shorten it and try again.', 'error');
      return;
    }
    if (hostedModelRuntime && Number.isInteger(runtime.maxSourceBytes) && sourceBytes > runtime.maxSourceBytes) {
      toast('This memo is too large to send. Shorten it and try again. Your local project remains unchanged.', 'error');
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
      if (!response || !Object.hasOwn(response, 'evaluation')) throw new Error('The server returned guidance in an unexpected format. Generate the guidance again.');
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
      const next = { ...suggestion, [field]: value, status: 'confirmed', claimState: 'student interpretation' };
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
    const storedReview = currentProject.preflight?.memoReview;
    // A structured review is the model's scale-aware reading of the memo and
    // is the candidate source of truth. The local extractor cannot reliably
    // distinguish prose under an explicitly named outer-scale heading, so
    // merging it here can leak Exosphere or Macrosphere language into Micro.
    // Keep extraction as an offline/no-review fallback only.
    const fingerprint = memoFingerprint(currentProject.submission);
    const liveGraphNodes = new Map(currentProject.graph.nodes
      .filter((node) => node.status !== 'rejected' && node.claimState !== 'retired')
      .map((node) => [node.id, node]));
    // Meso cannot use the generic node extractor as a fallback: rescaling its
    // actor/object results would create invalid, unscoped Meso nodes. When the
    // server review is unavailable, derive only supported mesosystems from
    // explicit Micro settings already on the map.
    const review = storedReview || (currentProject.activeScale === 'meso'
      ? deterministicMemoReview(currentProject.submission, 'meso', { carriedNodes: [...liveGraphNodes.values()], carriedConnections: currentProject.graph.edges })
      : null);
    const extracted = review ? { nodes: [], edges: [] } : extractCandidates(currentProject.submission);
    const liveGraphNodeIdsByLabel = new Map([...liveGraphNodes.values()]
      .map((node) => [node.label.trim().toLocaleLowerCase(), node.id]));
    const nodeIdForLabel = (label) => currentProject.activeScale !== 'micro'
      ? liveGraphNodeIdsByLabel.get(label.trim().toLocaleLowerCase()) || stableId('node', label)
      : stableId('node', label);
    const nodeIdForReference = (reference, label = reference) => liveGraphNodes.has(reference)
      ? reference
      : nodeIdForLabel(label);
    const invalidReview = () => { throw new Error('The classroom server returned guidance with unusable map items. Generate the guidance again.'); };
    const nodeById = new Map();
    (review?.nodes || []).forEach((node) => {
        if (node.scale !== currentProject.activeScale
          || !isCanonicalMapElementLabel(node.label, currentProject.activeScale)
          || !isNodeTypeAllowedAtScale(node.type, currentProject.activeScale)
          || (currentProject.activeScale === 'micro' && !isDiscreteMicroNodeLabel(node.label))
          || (currentProject.activeScale === 'macrosphere' && (isObviousLowerLevelMacroLabel(node.label)
            || labelRepeatsInstitution(node.label, [...liveGraphNodes.values()].filter((entry) => entry.scale === 'exosphere'))))) invalidReview();
        const id = nodeIdForLabel(node.label);
        if (nodeById.has(id) || liveGraphNodes.has(id)) invalidReview();
        const scopeMembers = Array.isArray(node.scope) ? node.scope : [];
        const scopeNodeIds = scopeMembers.map((member) => member?.id);
        if (['meso', 'macrosphere'].includes(currentProject.activeScale)
          && (scopeNodeIds.length < 2 || scopeNodeIds.some((memberId) => !liveGraphNodes.has(memberId) || memberId === id)
            || new Set(scopeNodeIds).size !== scopeNodeIds.length
            || scopeMembers.some((member) => liveGraphNodes.get(member?.id)?.label !== member?.label))) invalidReview();
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
          ...(node.basis ? { basis: node.basis } : {}),
          // Meso linkages and Macrosphere items carry their mapped members as
          // durable graph ids the student can edit directly.
          ...(['meso', 'macrosphere'].includes(currentProject.activeScale) ? {
            ...(currentProject.activeScale === 'macrosphere' ? { deontic: node.deontic } : {}),
            scopeNodeIds,
          } : {}),
        });
      });
    extracted.nodes.forEach((node) => {
      // The discrete-label rule holds for locally extracted candidates too:
      // clause-shaped fragments never reach the student's decision list.
      if (!isDiscreteMicroNodeLabel(node.label)) return;
      if (!isNodeTypeAllowedAtScale(node.type, currentProject.activeScale)) return;
      if (currentProject.activeScale === 'macrosphere' && isObviousLowerLevelMacroLabel(node.label)) return;
      if (currentProject.activeScale === 'macrosphere' && labelRepeatsInstitution(node.label, [...liveGraphNodes.values()].filter((entry) => entry.scale === 'exosphere'))) return;
      if (!nodeById.has(node.id)) nodeById.set(node.id, { ...node, sourceFingerprint: node.sourceFingerprint || fingerprint });
    });
    const edgeKeyOf = (edge) => `${edge.source}::${edge.verb.trim().toLocaleLowerCase()}::${edge.target}`;
    // A connection that already lives on the map is settled work: it never
    // returns as a candidate, so a later level cannot re-log or re-scale it.
    const liveEdgeKeys = new Set(currentProject.graph.edges
      .filter((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired')
      .map(edgeKeyOf));
    const edgeByKey = new Map();
    (review?.connections || []).forEach((connection) => {
      const source = nodeIdForReference(connection.source, connection.sourceLabel || connection.source);
      const target = nodeIdForReference(connection.target, connection.targetLabel || connection.target);
      const availableNodes = new Map([...liveGraphNodes, ...nodeById]);
      if (!availableNodes.has(source) || !availableNodes.has(target) || source === target) invalidReview();
      if (connection.sourceLabel !== availableNodes.get(source).label || connection.targetLabel !== availableNodes.get(target).label) invalidReview();
      const id = stableId('edge', `${connection.source}:${connection.verb}:${connection.target}`);
      const edge = {
        id,
        source,
        target,
        sourceLabel: connection.sourceLabel,
        targetLabel: connection.targetLabel,
        verb: connection.verb,
        scale: currentProject.activeScale,
        status: 'pending',
        claimState: 'inference',
        directed: true,
        rationale: connection.rationale || '',
        evidence: connection.rationale || '',
        sourceFingerprint: fingerprint,
        notes: '',
        annotation: { id: stableId('annotation', `edge:${id}:relationship`), text: '' },
      };
      const key = edgeKeyOf(edge);
      if (liveEdgeKeys.has(key) || edgeByKey.has(key)) invalidReview();
      edgeByKey.set(key, edge);
    });
    extracted.edges.forEach((edge) => {
      if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) return;
      const key = edgeKeyOf(edge);
      if (!liveEdgeKeys.has(key) && !edgeByKey.has(key)) edgeByKey.set(key, { ...edge, sourceFingerprint: edge.sourceFingerprint || fingerprint });
    });
    // Decisions already made on matching items survive a reread.
    const priorNodes = new Map(currentProject.candidates.nodes.map((node) => [node.id, node]));
    const priorEdges = new Map(currentProject.candidates.edges.map((edge) => [edge.id, edge]));
    const nodes = withDefaultNodeLayout([...nodeById.values()].map((node) => {
      const prior = priorNodes.get(node.id);
      const scaled = { ...node, scale: currentProject.activeScale };
      // A student's decisions and scope edits on a matching item survive a
      // memo reread; only the model-refreshed evidence and copy update.
      return prior ? {
        ...scaled,
        status: prior.status,
        claimState: prior.claimState,
        notes: prior.notes || node.notes,
        ...(prior.scopeNodeIds !== undefined ? { scopeNodeIds: prior.scopeNodeIds } : {}),
        ...(prior.deontic !== undefined ? { deontic: prior.deontic } : {}),
      } : scaled;
      }));
    const edges = [...edgeByKey.values()].map((edge) => {
      const prior = priorEdges.get(edge.id);
      // A later-level memo may name a node that already exists in the graph.
      // Keep that carried node's durable identity and current label on the
      // candidate edge so validation and commit cannot move or duplicate it.
      const sourceNode = liveGraphNodes.get(edge.source) || nodeById.get(edge.source);
      const targetNode = liveGraphNodes.get(edge.target) || nodeById.get(edge.target);
      const scaled = {
        ...edge,
        sourceLabel: sourceNode?.label || edge.sourceLabel,
        targetLabel: targetNode?.label || edge.targetLabel,
        scale: currentProject.activeScale,
      };
      return prior ? { ...scaled, status: prior.status, claimState: prior.claimState, notes: prior.notes || edge.notes } : scaled;
    });
    // Meso linkages and Macrosphere items use scoped nodes, never verb edges.
    if (currentProject.activeScale === 'meso' || currentProject.activeScale === 'macrosphere') {
      if (edges.length) invalidReview();
      return { nodes, edges: [] };
    }
    return { nodes, edges };
  };

  const applyConfirmationDefaults = (candidates, currentProject) => {
    if (currentProject.instructor.requireStudentConfirmation) return candidates;
    candidates.nodes.forEach((node) => {
      const needsTwoScopeMembers = ['meso', 'macrosphere'].includes(node.scale);
      const lowerLevelMacroLabel = node.scale === 'macrosphere' && isObviousLowerLevelMacroLabel(node.label);
      if (!lowerLevelMacroLabel && node.status === 'pending' && (!needsTwoScopeMembers || (node.scopeNodeIds || []).length >= 2)) {
        node.status = 'confirmed';
        node.claimState = 'student interpretation';
      }
    });
    candidates.edges.forEach((edge) => {
      if (edge.status === 'pending') { edge.status = 'confirmed'; edge.claimState = 'student interpretation'; }
    });
    return candidates;
  };

  const prepareCandidates = () => {
    let candidates;
    try {
      candidates = applyConfirmationDefaults(buildCandidatesFromProject(project), project);
    } catch {
      toast('The guidance could not be used as returned. Generate it again; the current map was preserved.', 'error');
      return false;
    }
    const snapshot = configurationSnapshot(project, 'builder');
    update((draft) => { draft.candidates = candidates; draft.stage = 2; draft.furthestStage = Math.max(draft.furthestStage || 0, 2); }, 'candidates.generated', `${candidates.nodes.length} nodes and ${candidates.edges.length} relationships`, 'student', { configurationSnapshot: snapshot, sourceFingerprint: memoFingerprint(project.submission) });
    recordStageTransition(project.stage, 2, { completed: true });
    const itemCount = candidates.nodes.length + candidates.edges.length;
    toast(itemCount
      ? project.activeScale === 'micro'
        ? 'Micro elements and direct relationships from your memo are ready for review.'
        : project.activeScale === 'meso'
          ? 'Mesosystems from your memo are ready for review.'
          : project.activeScale === 'exosphere'
            ? 'Institutions and relationships from your memo are ready for review.'
            : 'Macrosphere items from your memo are ready for review.'
      : 'The review did not suggest any items. Add an item yourself, or revise the memo and choose “Reread memo.”');
    return true;
  };

  const refreshCandidatesFromMemo = async () => {
    if (!await generateSuggestions()) return;
    const current = projectRef.current;
    let candidates;
    try {
      candidates = applyConfirmationDefaults(buildCandidatesFromProject(current), current);
    } catch {
      toast('The refreshed guidance could not be used as returned. The current suggestions were preserved.', 'error');
      return;
    }
    update((draft) => { draft.candidates = candidates; }, 'candidates.refreshed', `${candidates.nodes.length} nodes and ${candidates.edges.length} relationships`, 'student', { sourceFingerprint: memoFingerprint(current.submission) });
    toast(candidates.nodes.length + candidates.edges.length ? 'Suggestions refreshed from your memo.' : 'The revised review did not suggest any items. You can add an item yourself.');
  };

  const commitMapSelections = () => {
    const lowerLevelMacroCandidate = project.candidates.nodes.find((item) => (
      item.scale === 'macrosphere'
      && (item.status === 'confirmed' || item.status === 'research lead')
      && isObviousLowerLevelMacroLabel(item.label)
    ));
    if (lowerLevelMacroCandidate) return toast(LOWER_LEVEL_MACRO_MESSAGE, 'error');
    const acceptedNodes = project.candidates.nodes.filter((item) => item.status === 'confirmed' || item.status === 'research lead');
    const acceptedNodeIds = new Set(acceptedNodes.map((node) => node.id));
    const liveGraphNodeIds = new Set(project.graph.nodes
      .filter((node) => node.status !== 'rejected' && node.claimState !== 'retired')
      .map((node) => node.id));
    const endpointIds = new Set([...liveGraphNodeIds, ...acceptedNodeIds]);
    const relationshipsAllowed = project.activeScale === 'micro' || project.activeScale === 'exosphere';
    const acceptedEdges = relationshipsAllowed ? project.candidates.edges.filter((item) => (item.status === 'confirmed' || item.status === 'research lead') && endpointIds.has(item.source) && endpointIds.has(item.target)) : [];
    const acceptedSuggestions = relationshipsAllowed ? connectionSuggestions.filter((edge) => edge.status === 'confirmed' && edge.verb.trim() && edge.source !== edge.target) : [];
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
      const cascadedRetiredNodeIds = new Set(retiredNodeIds);
      let priorNodes = draft.graph.nodes.map((node) => retiredNodeIds.has(node.id) ? { ...node, status: 'rejected', claimState: 'retired', notes: [node.notes, 'Retired during candidate review.'].filter(Boolean).join(' ') } : node);
      let retiredAnotherScope = true;
      while (retiredAnotherScope) {
        retiredAnotherScope = false;
        priorNodes = priorNodes.map((node) => {
          if (node.status === 'rejected' || node.claimState === 'retired' || !Array.isArray(node.scopeNodeIds) || !node.scopeNodeIds.some((id) => cascadedRetiredNodeIds.has(id))) return node;
          cascadedRetiredNodeIds.add(node.id);
          retiredAnotherScope = true;
          return { ...node, status: 'rejected', claimState: 'retired', notes: [node.notes, 'Retired because one of its mapped scope members was removed during candidate review.'].filter(Boolean).join(' ') };
        });
      }
      const priorEdges = draft.graph.edges.map((edge) => ((reviewedEdgeIds.has(edge.id) && !edgeIds.has(edge.id)) || cascadedRetiredNodeIds.has(edge.source) || cascadedRetiredNodeIds.has(edge.target)) ? { ...edge, status: 'rejected', claimState: 'retired', notes: [edge.notes, 'Retired during candidate review.'].filter(Boolean).join(' ') } : edge);
      draft.graph.nodes = [...priorNodes.filter((node) => !nodeIds.has(node.id)), ...nextNodes];
      const currentNodes = draft.graph.nodes.filter((node) => node.status !== 'rejected' && node.claimState !== 'retired');
      if (mapNodesOverlap(currentNodes)) {
        const repairedPositions = ECOLOGY_MAP_SCALES.has(project.activeScale)
          ? arrangedEcologyPositions(currentNodes)
          : arrangedMapPositions(currentNodes, new Set(currentNodes.map((node) => node.scale)).size > 1);
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
        retiredNodes: [...reviewedNodeIds].filter((id) => !acceptedNodeIds.has(id)),
      },
    });
    setConnectionPrompt('');
    setConnectionSuggestions([]);
    recordStageTransition(project.stage, 3, { completed: true });
    const pendingCount = [...project.candidates.nodes, ...project.candidates.edges].filter((item) => item.status === 'pending').length;
    const pendingNote = pendingCount ? ` ${pendingCount} undecided ${pendingCount === 1 ? 'item' : 'items'} stayed off the map.` : '';
    toast(acceptedNodes.length || acceptedEdges.length || acceptedSuggestions.length ? `Selections added to the map.${pendingNote}` : `Map opened without adding selections.${pendingNote}`);
  };

  const primary = async () => {
    switch (project.stage) {
      case 0: setStage(1, { completed: true }); break;
      case 1: prepareCandidates(); break;
      case 2: commitMapSelections(); break;
      case 3: setStage(4, { completed: true }); break;
      case 4:
        {
          const currentScale = project.activeScale;
          const currentIndex = SCALE_ORDER.indexOf(currentScale);
          const nextScale = currentIndex >= 0 ? SCALE_ORDER[currentIndex + 1] || null : null;
        // The memo travels with the project, so the next level opens directly
        // on Review — the model rereads for the new level instead of walking
        // the student back through the intake form they already completed.
        update((draft) => {
          if (!draft.completedScales.includes(currentScale)) draft.completedScales.push(currentScale);
          draft.completedScales = SCALE_ORDER.filter((scale) => draft.completedScales.includes(scale));
          if (nextScale) {
            draft.activeScale = nextScale;
            if (!draft.releasedScales.includes(nextScale)) draft.releasedScales.push(nextScale);
            draft.releasedScales = SCALE_ORDER.filter((scale) => draft.releasedScales.includes(scale));
          }
          draft.stage = 1;
          draft.furthestStage = Math.max(draft.furthestStage || 0, 4);
          draft.preflight = null;
          draft.candidates = { nodes: [], edges: [] };
          draft.reflection = '';
        }, 'scale.cycle-completed', nextScale
          ? `${SCALES[currentScale].label} completed; ${SCALES[nextScale].label} opened`
          : `${SCALES[currentScale].label} completed`);
        setConnectionPrompt('');
        setConnectionSuggestions([]);
        recordStageTransition(4, 1, { completed: true });
        toast(nextScale
          ? `${SCALES[currentScale].label} complete. Continue with ${SCALES[nextScale].label}.`
          : `${SCALES[currentScale].label} complete. Start another ${SCALES[currentScale].label} cycle when you are ready.`);
        break;
        }
      default: break;
    }
  };

  const primaryLabel = (() => {
    if (project.stage === 0) return 'Review memo';
    if (project.stage === 1) return (LEVEL_REVIEW_COPY[project.activeScale] || LEVEL_REVIEW_COPY.micro).next;
    if (project.stage === 2) return 'Open map';
    if (project.stage === 3) return 'Revise and export';
    const nextScale = SCALE_ORDER[SCALE_ORDER.indexOf(project.activeScale) + 1];
    return nextScale ? `Continue to ${SCALES[nextScale].label}` : `Start another ${SCALES[project.activeScale].label} cycle`;
  })();

  const backDisabled = project.stage === 0;
  // Model requests are optional background work. They may guard their own
  // duplicate-request controls, but never block the student's next stage.
  const canPrimary = true;
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
    if (urlLinkToken() && linkRef.current?.projectId !== next.id) window.history.replaceState(null, '', '/');
  }, [logPrototype]);

  const syncLinkNow = useCallback(async () => {
    const activeLink = linkRef.current;
    const snapshot = projectRef.current;
    if (!activeLink || activeLink.projectId !== snapshot.id) return false;
    let serialized;
    try {
      serialized = serializeProject(snapshot);
    } catch {
      return false; // The local save flow already surfaces validation problems.
    }
    setLinkStatus('syncing');
    try {
      await updateProjectLink(activeLink.token, serialized);
      setLinkStatus('synced');
      setLinkMessage(null);
      return true;
    } catch (error) {
      setLinkStatus('error');
      setLinkMessage(describeLinkError(error));
      return false;
    }
  }, []);

  useEffect(() => {
    if (!workspaceStarted || !link || link.projectId !== project.id) return undefined;
    window.clearTimeout(linkSyncTimer.current);
    linkSyncTimer.current = window.setTimeout(syncLinkNow, LINK_SYNC_DEBOUNCE_MS);
    return () => window.clearTimeout(linkSyncTimer.current);
  }, [project, workspaceStarted, link, syncLinkNow]);

  useEffect(() => {
    if (accessState.status !== 'granted' || linkLoadAttemptedRef.current) return;
    linkLoadAttemptedRef.current = true;
    const token = urlLinkToken();
    if (!token) return;
    fetchProjectLink(token).then((result) => {
      const incoming = parseProject(result.project);
      const nextLink = { token, projectId: incoming.id };
      setLink(nextLink);
      linkRef.current = nextLink;
      storeLink(nextLink);
      const local = projectRef.current;
      if (local.id !== incoming.id || Date.parse(incoming.updatedAt || 0) > Date.parse(local.updatedAt || 0)) {
        replaceProject(incoming, 'Project link');
        setHasSavedProject(true);
      }
      setLinkStatus('synced');
      setLinkMessage(null);
    }).catch((error) => {
      setLinkStatus('error');
      setLinkMessage(error instanceof ApiError
        ? describeLinkError(error)
        : `The linked project could not be loaded: ${error.message}`);
    });
  }, [accessState.status, replaceProject]);

  const createLink = useCallback(async () => {
    const committed = commitPendingAnnotations();
    const snapshot = committed.project;
    let serialized;
    try {
      serialized = serializeProject(snapshot);
    } catch (error) {
      toast(`Complete the current required field before creating a link: ${error.message}`, 'error');
      return;
    }
    setLinkStatus('creating');
    setLinkMessage(null);
    try {
      const result = await createProjectLink(serialized);
      const nextLink = { token: result.token, projectId: snapshot.id };
      setLink(nextLink);
      linkRef.current = nextLink;
      storeLink(nextLink);
      setLinkStatus('synced');
      window.history.replaceState(null, '', `/p/${result.token}`);
      toast('Project link created.');
    } catch (error) {
      setLinkStatus('error');
      const message = describeLinkError(error);
      setLinkMessage(message);
      toast(message, 'error');
    }
  }, [commitPendingAnnotations, toast]);

  const copyLink = useCallback(async () => {
    const activeLink = linkRef.current;
    if (!activeLink) return;
    try {
      await navigator.clipboard.writeText(linkUrl(activeLink.token));
      toast('Project link copied.');
    } catch {
      toast('Copy is unavailable. Select the link text and copy it by hand.', 'error');
    }
  }, [toast]);
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
    if (urlLinkToken()) window.history.replaceState(null, '', '/');
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
        <button type="button" className="button button--secondary" onClick={() => download(exportFileName(project, 'json', 'recovery'), serializeProject(project))}>Download current project</button>
        <button type="button" className="button button--ghost" onClick={continueInMemory}>Keep working without saving</button>
        <button type="button" className="button" onClick={preserveRecoveryAndEnableStorage}>{saveState.recovery ? 'Save earlier copy and try again' : 'Try saving again'}</button>
      </div>
    </div>
  </Modal>;

  if (teacherOpen) return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><LabLink /><a href="#workspace" className="brand__home" aria-label="Systems Mapping Teacher Console home"><strong>Systems Mapping</strong><small>Teacher Console</small></a></div>
      <button className="text-button" type="button" onClick={() => setTeacherOpen(false)}><Icon name="back" />Back to class access</button>
    </header>
    <main ref={workspaceRef} tabIndex="-1" id="workspace" className="workspace workspace--teacher">
      <Suspense fallback={<p role="status">Loading Teacher Console…</p>}><TeacherDashboard resetToken={passwordResetToken} onResetComplete={finishPasswordReset} onConfigurationChanged={refreshAfterTeacherChange} /></Suspense>
    </main>
  </div>;

  if (accessState.status !== 'granted') return <ClassAccessScreen state={accessState} onSubmit={submitClassCode} onTeacher={() => setTeacherOpen(true)} />;

  if (!workspaceStarted) return <>
    <ResumeScreen project={project} hasSavedProject={hasSavedProject} saveState={saveState} onResume={resumeProject} onStart={requestNewProject} onTeacher={() => setTeacherOpen(true)} onEndAccess={endAccess} onRecovery={() => setModal('storage')} linkNotice={linkStatus === 'error' ? linkMessage : null} />
    {recoveryModal}
    <Modal open={modal === 'new-project'} title="Start another project" onClose={() => { setPendingNewProject(false); setModal(null); }}>
      <div className="confirm-panel"><p>This replaces the current workspace with a blank project. Export the current project first if you need a separate copy.</p><div className="button-row"><button type="button" className="button button--ghost" onClick={() => { setPendingNewProject(false); setModal(null); }}>Cancel</button><button type="button" className="button" onClick={startBlankProject}>Start another project</button></div></div>
    </Modal>
  </>;

  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><LabLink /><a href="/" className="brand__home" aria-label="Systems Mapping home" onClick={(event) => { event.preventDefault(); setMapPreviewOpen(false); setWorkspaceStarted(false); }}><strong>Systems Mapping</strong><small>{project.title}</small></a></div>
      <div className="header-actions">
        {saveState.status === 'error' ? <button className="save-state save-state--error" type="button" onClick={() => setModal('storage')}><i />Save needs attention</button> : saveState.status === 'validation' ? <span className="save-state save-state--error"><i />Complete the current field to save</span> : saveState.status === 'saving' ? <span className="save-state"><i />Saving…</span> : null}
        <button className="text-button" type="button" aria-current={!mapPreviewOpen && project.stage === 3 ? 'page' : undefined} aria-label={mapPreviewOpen ? `Back to ${STAGES[project.stage].short}` : 'Map'} onClick={mapPreviewOpen ? returnFromMapPreview : openMapPreview}><Icon name={mapPreviewOpen ? 'back' : 'map'} />{mapPreviewOpen ? `Back to ${STAGES[project.stage].short}` : 'Map'}</button><button className="text-button" type="button" onClick={() => setModal('project-link')}><Icon name="link" />Project link</button><button className="text-button" type="button" onClick={() => { setMapPreviewOpen(false); setTeacherOpen(true); }}><Icon name="settings" />Teacher Console</button><button className="text-button" type="button" onClick={() => setModal('stages')}><Icon name="menu" />Stages</button>
      </div>
    </header>
    <div className="sr-only" aria-live="polite">{mapPreviewOpen ? `Viewing map. Current stage remains ${STAGES[project.stage].label}.` : `Current section ${STAGES[project.stage].label}`}</div>
    <main ref={workspaceRef} tabIndex="-1" id="workspace" className={`workspace workspace--stage-${displayedStage}`}>{screen}</main>
    <footer className="app-footer">{mapPreviewOpen ? <><div className="footer-context"><strong>Map preview</strong><span>Current stage · {STAGES[project.stage].short}</span></div><div className="footer-actions"><button className="button" type="button" onClick={returnFromMapPreview}><Icon name="back" />Back to {STAGES[project.stage].short}</button></div></> : <><div className="footer-context"><strong>{STAGES[project.stage].label}</strong></div><div className="footer-actions"><button className="button button--ghost" type="button" disabled={backDisabled} onClick={() => setStage(project.stage - 1)}><Icon name="back" />Back</button><button className="button" type="button" disabled={!canPrimary} onClick={primary}>{primaryLabel}<Icon name="arrow" /></button></div></>}</footer>
    <Modal open={modal === 'stages'} title="Five stages" onClose={() => setModal(null)}>
      <ol className="stage-menu">{STAGES.map((stage, index) => {
        return <li key={stage.id}><button className={index === project.stage ? 'is-current' : ''} onClick={() => { if (setStage(index)) setModal(null); }}><strong>{stage.label}</strong>{index === project.stage ? <em>Current</em> : null}</button></li>;
      })}</ol>
      <button className="button button--ghost" type="button" onClick={requestNewProject}>Start another project</button>
    </Modal>
    <Modal open={modal === 'new-project'} title="Start a new project" onClose={() => setModal(null)}>
      <div className="confirm-panel"><p>This replaces the current workspace with a blank project. It does not delete any JSON, CSV, or Markdown files you already exported.</p><div className="button-row"><button type="button" className="button button--ghost" onClick={() => setModal(null)}>Cancel</button><button type="button" className="button" onClick={startBlankProject}>Start blank project</button></div></div>
    </Modal>
    <Modal open={modal === 'project-link'} title="Project link" onClose={() => setModal(null)}>
      <div className="confirm-panel">
        <dl className="project-link-summary">
          <div>
            <dt>Student or group name (optional)</dt>
            <dd>{project.participantName?.trim() || 'Not added'}</dd>
          </div>
        </dl>
        {link && link.projectId === project.id ? <>
          <p>Open this link on any device, enter the class code, and this project picks up where you left off. Changes sync to the link automatically while you work.</p>
          <p className="project-link-url"><code>{linkUrl(link.token)}</code></p>
          <p className={`project-link-status${linkStatus === 'error' ? ' project-link-status--error' : ''}`} role="status">
            {linkStatus === 'syncing' || linkStatus === 'creating' ? 'Syncing latest changes…' : linkStatus === 'synced' ? 'Latest changes are synced to this link.' : linkMessage || 'Changes sync while you work.'}
          </p>
          <div className="button-row">
            <button type="button" className="button button--ghost" onClick={() => setModal(null)}>Close</button>
            <button type="button" className="button" onClick={copyLink}>Copy link</button>
          </div>
        </> : <>
          <p>Create a unique link for this project so you can return to it from any device. Opening the link after entering the class code restores the project exactly where you left it.</p>
          {link && <p className="project-link-status">Your earlier link stays usable for the project it was created on.</p>}
          {linkStatus === 'error' && linkMessage && <p className="error-text">{linkMessage}</p>}
          <div className="button-row">
            <button type="button" className="button button--ghost" onClick={() => setModal(null)}>Cancel</button>
            <button type="button" className="button" disabled={linkStatus === 'creating'} onClick={createLink}>{linkStatus === 'creating' ? 'Creating link…' : 'Create project link'}</button>
          </div>
        </>}
      </div>
    </Modal>
    {recoveryModal}
    <div className={`toast toast--${toastState?.type || 'success'} ${toastState ? 'is-visible' : ''}`} role="status" aria-live="polite">{toastState?.type === 'success' && <Icon name="check" />}{toastState?.message}</div>
  </div>;
}

export default App;
