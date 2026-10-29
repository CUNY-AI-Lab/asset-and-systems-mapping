import { relationshipDescription, relationshipArrowheads, relationshipDirection, relationshipMapLabel, relationshipLineWidth, relationshipProcessSummary } from './relationshipDirection.js';
import { SidebarResizeHandle, useSidebarSize } from './MapSidebar.jsx';
import { createPortal } from 'react-dom';
import { useBugReportDock } from './support/BugReportDock.jsx';
import React, { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Action, Disclosure, EmptyState, LevelTrail, PageHeading, ProjectRow } from './ui/StudioPrimitives.jsx';
import { INSTITUTIONAL_RESUME_COOLDOWN_MS, readInstitutionalSession } from './studentSession.js';
import { userFacingError } from './userFacingError.js';
import { courseWorkspacePath } from './courseContext.js';
import { cacheMemoDraft, restoreMemoDraft } from './memoDraft.js';
import { useCanvasWindow } from './ui/useCanvasWindow.js';
import { useMapFontMetrics } from './ui/useMapFontMetrics.js';
import { GUIDANCE_CONTRACT_VERSION, studentJudgments } from '../shared/student-judgments.js';
import { prepareProviderMemo } from '../shared/provider-memo.js';
import { readGuidanceCache, removeGuidanceCacheEntry, writeGuidanceCache } from './guidanceCache.js';
import { requiresInitialModel, requiresLevelModel } from './mappingCycle.js';
import { levelRailState, nextStep, stageForPanelMode } from './nextStep.js';
import { LevelSelect, NotebookSection, ProjectMenu, PANEL_TABS, WorkPanelTabs } from './MapStudio.jsx';
import { hasPendingGuidance } from './durableGuidance.js';
import { exportMapImage, downloadBlob } from './mapExport.js';
import MapListView from './MapListView.jsx';
import MapTextEditor from './MapTextEditor.jsx';
import { correspondingNode, nodeLabelIssue, relationshipIssue, reviseMapText } from './mapTextEditing.js';
import MapConnections from './MapConnections.jsx';
import MapSearch from './MapSearch.jsx';
import MapTools from './MapTools.jsx';
import NollSketch from './NollSketch.jsx';
import ProjectOverview from './ProjectOverview.jsx';
import ReflectionEntry from './ReflectionEntry.jsx';
import { hasFieldNotes } from '../shared/field-notes.js';
import { previousFieldNotes } from '../shared/field-notes-context.js';
import { relationshipProcessIssue } from '../shared/relationship-process.js';
import { indexMapConnections, isLiveMapItem } from './mapInsights.js';
import { projectRectangleToRing, rectangleFitsRing, resolveRingConstrainedCollisions } from './ringCollisionLayout.js';
import { measureMapText, wrapMapText } from './mapTextGeometry.js';
import { mapRegionGeometry } from './mapRegionGeometry.js';
import {
  CLAIM_EVIDENCE_FIELDS,
  containsRetiredSystemsLanguage,
  EXOSPHERE_NODE_TYPES,
  FOCAL_PARTICIPATION_STATES,
  MACROSPHERE_NODE_TYPES,
  NODE_TYPES,
  MICRO_SETTING_NODE_TYPES,
  PROJECT_LIMITS,
  SCALE_ORDER,
  SCALE_PARTS,
  SCALE_VERB_LEXICONS,
  SCALES,
  configFingerprint,
  createClaimEvidenceRecord,
  createPortableProject,
  createDefaultProject,
  createEvent,
  createRelationshipProcess,
  exportFileName,
  isDiscreteMicroNodeLabel,
  isExosphereDecisionPathway,
  isMesosystemLabel,
  isNamedInstitutionLabel,
  isStatementMapElementLabel,
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
  TimeoutError,
  createPreflightEvaluation,
  createProjectLink,
  deleteProjectLink,
  endStudentAccess,
  fetchProjectLink,
  getPublicConfiguration,
  getStudentSession,
  recordPrototypeEvent,
  requestStudentAccess,
  revokeProjectLink,
  suggestMapConnections,
  updateProjectLink,
  checkMap,
} from './api.js';
import {
  LEGACY_STORAGE_KEYS,
  PROJECT_BODY_PREFIX,
  PROJECT_LIBRARY_KEY,
  STORAGE_KEY,
  loadLibraryProject,
  loadDurableProject,
  loadProjectLibrary,
  loadStoredLink,
  forgetStoredLink,
  mirrorActiveLink,
  reconcileActiveProject,
  rememberStoredLink,
  saveProjectToLibrary,
  summarizeProject,
} from './projectLibrary.js';

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
const THEME_STORAGE_KEY = 'systems-mapping.theme';
const RELATION_VOCABULARY_TEXT_LIMIT = PROJECT_LIMITS.relationVocabulary * (RELATIONSHIP_VERB_LIMIT + 2);
const VIEWPORT_LIMITS = {
  minZoom: PROJECT_LIMITS.zoomMin,
  maxZoom: PROJECT_LIMITS.zoomMax,
  minPan: PROJECT_LIMITS.panMin,
  maxPan: PROJECT_LIMITS.panMax,
};
const ECOLOGY_SCALES = new Set(['exosphere', 'macrosphere']);
const ECOLOGY_MAP_SCALES = new Set(['exosphere', 'macrosphere']);
const MICRO_SETTING_NODE_TYPE_SET = new Set(MICRO_SETTING_NODE_TYPES);

function isOrientedExospherePathway(sourceNode, targetNode, carriedMicroNodeIds) {
  return Boolean(isExosphereDecisionPathway(sourceNode, targetNode)
    && sourceNode?.scale === 'exosphere'
    && (targetNode?.scale === 'exosphere' || carriedMicroNodeIds.has(targetNode.id)));
}

function orientExospherePathway(sourceNode, targetNode, carriedMicroNodeIds) {
  if (isOrientedExospherePathway(sourceNode, targetNode, carriedMicroNodeIds)) return [sourceNode, targetNode];
  if (isOrientedExospherePathway(targetNode, sourceNode, carriedMicroNodeIds)) return [targetNode, sourceNode];
  return [sourceNode, targetNode];
}
const LOWER_LEVEL_MACRO_MESSAGE = 'That label names an immediate person, role, activity, or schedule. Add it at Micro instead.';
const isCanonicalMapElementLabel = (value, scale) => !isStatementMapElementLabel(value) && normalizeMapElementLabel(value, { micro: scale === 'micro' }) === String(value || '').trim();

const STAGES = SYSTEMS_MAPPING_STAGES;
const TeacherDashboard = lazy(() => import('./TeacherDashboard.jsx'));

function invalidatePreflight(draft) {
  draft.preflight = null;
}

function memoFingerprint(submission) {
  return submission.fingerprint || stableId('src', submission.text);
}

const INQUIRY_CONTEXT_LABELS = Object.freeze({
  focal: 'Focal person or group', question: 'Map question', time: 'Time period or episode', boundary: 'Map boundary',
  evidence: 'Evidence used', voices: 'Missing perspectives',
});
const LEGACY_INQUIRY_CONTEXT_LABELS = Object.freeze({ 'Evidence sources': 'evidence' });
const MACRO_SYNTHESIS_LABELS = Object.freeze({
  answer: 'Answer to focus question', strongest: 'Strongest claim', weakest: 'Weakest claim',
  limits: 'Missing perspectives or limits', next: 'Next investigation or action', changed: 'What changed over time',
});

function parseInquiryContext(inquiry) {
  const value = String(inquiry || '').trim();
  const context = { focal: '', question: '', time: '', boundary: '', evidence: '', voices: '' };
  let matched = false;
  value.split('\n').forEach((line) => {
    const entry = Object.entries(INQUIRY_CONTEXT_LABELS).find(([, label]) => line.startsWith(`${label}:`));
    const legacyEntry = Object.entries(LEGACY_INQUIRY_CONTEXT_LABELS).find(([label]) => line.startsWith(`${label}:`));
    if (!entry && !legacyEntry) return;
    matched = true;
    const key = entry?.[0] || legacyEntry[1];
    const label = entry?.[1] || legacyEntry[0];
    context[key] = line.slice(label.length + 1).trim();
  });
  if (!matched) context.question = value;
  return context;
}

function composeInquiryContext(context) {
  return Object.entries(INQUIRY_CONTEXT_LABELS)
    .map(([key, label]) => [label, String(context[key] || '').replace(/\s+/g, ' ').trim()])
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}

function parseMacroSynthesis(reflection) {
  const value = String(reflection || '').trim();
  const synthesis = { answer: '', strongest: '', weakest: '', limits: '', next: '', changed: '' };
  let matched = false;
  value.split('\n').forEach((line) => {
    const entry = Object.entries(MACRO_SYNTHESIS_LABELS).find(([, label]) => line.startsWith(`${label}:`));
    if (!entry) return;
    matched = true;
    synthesis[entry[0]] = line.slice(entry[1].length + 1).trim();
  });
  if (!matched) synthesis.changed = value;
  return synthesis;
}

function composeMacroSynthesis(synthesis) {
  return Object.entries(MACRO_SYNTHESIS_LABELS)
    .map(([key, label]) => [label, String(synthesis[key] || '').replace(/\s+/g, ' ').trim()])
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}

function hasProjectWork(project) {
  return project.stage > 0 || project.releasedScales.length > 1 || project.completedScales.length > 0
    || project.preflight !== null || project.candidates.nodes.length > 0 || project.candidates.edges.length > 0
    || project.graph.nodes.length > 0 || project.graph.edges.length > 0;
}

function technicalDiagnostic(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

function loadProject() {
  try {
    const current = projectStorage().getItem(STORAGE_KEY);
    const legacyEntry = current === null
      ? LEGACY_STORAGE_KEYS.map((key) => [key, projectStorage().getItem(key)]).find(([, value]) => value !== null)
      : null;
    const saved = current ?? legacyEntry?.[1] ?? null;
    const sourceKey = current !== null ? STORAGE_KEY : legacyEntry?.[0] ?? null;
    if (saved === null) {
      return { project: createDefaultProject(), loadError: null, recovery: null, hasSavedProject: false, persistenceBlocked: false, sourceKey: null };
    }
    try {
      const parsedProject = parseProject(saved);
      const savedBase = loadDurableProject(projectStorage(), parsedProject.id, { restoreDraft: false }) || parsedProject;
      return {
        project: restoreMemoDraft(projectStorage(), savedBase),
        memoDraftBase: savedBase,
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
        diagnostic: technicalDiagnostic(error),
        recovery: saved,
        hasSavedProject: false,
        persistenceBlocked: true,
        sourceKey,
      };
    }
  } catch (error) {
    return {
      project: createDefaultProject(),
      loadError: 'Browser storage is unavailable. Your work cannot be saved on this device until storage access is restored.',
      diagnostic: technicalDiagnostic(error),
      recovery: null,
      hasSavedProject: false,
      persistenceBlocked: true,
      sourceKey: null,
    };
  }
}

function linkUrl(token) {
  return `${window.location.origin}${courseWorkspacePath(`/p/${token}`, projectStorage().courseSelection)}`;
}

function describeLinkError(error, institutionalMode = false) {
  if (error instanceof ApiError) {
    if (institutionalMode && error.status === 401) return 'Use CUNY Login to continue syncing';
    if (institutionalMode && error.status === 403) return 'CUNY AI Lab access required to continue syncing';
    if (error.status === 401) return 'Class access ended. Enter the class code again to keep syncing this link.';
    if (error.status === 404) return 'This project link was not found. It may have been removed or belong to a different class workspace.';
    if (error.status === 409) return 'This project link changed in another session. Nothing on this device was overwritten.';
    if (error.status === 410) return error.message.includes('revoked')
      ? 'This project link has been turned off. The project on this device is still available.'
      : 'This project link has expired. The project on this device is still available.';
    if (error.status === 413) return 'This project is too large to sync to its link. Export a copy instead.';
    if (error.status === 429) return 'Link syncing is briefly paused. Recent changes will sync shortly.';
    if (error.status === 507) return 'The class workspace cannot store another project link right now. Export a copy and try again later.';
    return 'The project link could not be updated. Changes are still saved on this device; try again later.';
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
    .map(({ id, label, type, scale }) => ({ id, label, type, scale }));
}

function carriedReviewNodes(project) {
  if (project.activeScale === 'micro') return carriedMicroNodes(project);
  if (project.activeScale === 'meso') return carriedMicroNodes(project);
  if (ECOLOGY_SCALES.has(project.activeScale)) return carriedMapNodes(project);
  return [];
}

function relationshipProcessContext(process) {
  if (!process) return {};
  const defaults = createRelationshipProcess();
  const details = Object.fromEntries(Object.entries(createRelationshipProcess(process))
    .filter(([field, value]) => value !== defaults[field]));
  return Object.keys(details).length ? { relationshipProcess: details } : {};
}

function carriedReviewConnections(project) {
  return project.graph.edges
    .filter((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired')
    .map(({ source, target, verb, relationshipProcess }) => ({ source, target, verb, ...relationshipProcessContext(relationshipProcess) }));
}

export function preflightEvaluationPayload(project) {
  const carriedNodes = carriedReviewNodes(project);
  const carriedConnections = carriedReviewConnections(project);
  const fieldNotes = previousFieldNotes(project);
  return {
    projectMetadata: projectMetadataForReview(project),
    activeScale: project.activeScale,
    stageId: STAGES[project.stage]?.id || 'review-suggestions',
    inquiry: project.inquiry,
    sourceRecord: sourceRecordForEvaluation(project.submission),
    sourceMaterial: project.submission.text,
    projectOverlay: projectOverlayForEvaluation(project.configs.preflight),
    studentJudgments: studentJudgments(project),
    ...(fieldNotes ? { fieldNotes } : {}),
    ...(project.activeScale === 'meso' || carriedNodes.length ? { carriedNodes } : {}),
    ...(carriedConnections.length ? { carriedConnections } : {}),
  };
}

function memoPromptExcerpt(text) {
  const collapsed = prepareProviderMemo(text).sourceText.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 4000) return collapsed;
  const prefix = collapsed.slice(0, 4001);
  const boundary = prefix.lastIndexOf(' ');
  return (boundary > 2000 ? prefix.slice(0, boundary) : collapsed.slice(0, 4000)).trim();
}

function nodesForConnectionPrompt(project) {
  const activeIndex = Math.max(0, SCALE_ORDER.indexOf(project.activeScale));
  const carriedScales = project.activeScale === 'meso'
    ? new Set(['micro'])
    : ECOLOGY_SCALES.has(project.activeScale)
      ? new Set(SCALE_ORDER.slice(0, activeIndex + 1))
      : new Set([project.activeScale]);
  const selected = project.candidates.nodes
    .filter((node) => carriedScales.has(node.scale) && (node.status === 'confirmed' || node.status === 'research lead'));
  const active = project.graph.nodes
    .filter((node) => node.status !== 'rejected' && node.claimState !== 'retired' && carriedScales.has(node.scale));
  return [...new Map([...active, ...selected].map((node) => [node.id, node])).values()];
}

export function connectionSuggestionPayload(project, prompt) {
  const nodes = nodesForConnectionPrompt(project);
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    activeScale: project.activeScale,
    inquiry: project.inquiry,
    prompt,
    studentJudgments: studentJudgments(project),
    nodes: nodes.map(({ id, label, type, scale }) => ({ id, label, type, scale })),
    relationships: [...project.graph.edges, ...project.candidates.edges]
      .filter((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired' && nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .filter((edge, index, edges) => edges.findIndex((candidate) => candidate.source === edge.source && candidate.target === edge.target && candidate.verb.trim().toLocaleLowerCase() === edge.verb.trim().toLocaleLowerCase()) === index)
      .map(({ source, target, verb, relationshipProcess }) => ({ source, target, verb, ...relationshipProcessContext(relationshipProcess) })),
    projectOverlay: projectOverlayForEvaluation(project.configs.builder),
  };
}

// Map Check sends the carried map, never the whole memo. Scopes travel as
// memberships so the model can see mesosystems and conditions as structure.
export function mapCheckPayload(project, intent, focus = null) {
  const nodes = project.graph.nodes.filter(isLiveMapItem).slice(0, 50).map(({ id, label, type, scale }) => ({ id, label, type, scale }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const relationships = project.graph.edges
    .filter((edge) => isLiveMapItem(edge) && nodeIds.has(edge.source) && nodeIds.has(edge.target) && edge.source !== edge.target)
    .slice(0, 100).map(({ id, source, target, verb, relationshipProcess }) => ({ id, source, target, verb, ...relationshipProcessContext(relationshipProcess) }));
  const scopes = project.graph.nodes
    .filter((node) => nodeIds.has(node.id) && (node.scopeNodeIds || []).length)
    .map((node) => ({ id: node.id, memberIds: [...new Set(node.scopeNodeIds)].filter((memberId) => nodeIds.has(memberId) && memberId !== node.id) }))
    .filter((scope) => scope.memberIds.length).slice(0, 50);
  return {
    activeScale: project.activeScale,
    intent,
    inquiry: project.inquiry,
    memoExcerpt: memoPromptExcerpt(project.submission.text) || '',
    nodes,
    relationships,
    scopes,
    focus,
    projectOverlay: projectOverlayForEvaluation(project.configs.builder),
    studentJudgments: studentJudgments(project),
  };
}

const MAP_CHECK_KIND_LABELS = Object.freeze({ gap: 'Gap', question: 'Question', evidence: 'Evidence to find', claim: 'Claim the map supports' });

function MapCheckPanel({ heading, lede, actionLabel, check, onRun, onShow, labelFor, disabled = false, compact = false }) {
  const headingId = useId();
  return <section className="map-check" aria-labelledby={headingId}>
    <div className={compact ? 'sr-only' : 'work-panel__title'}><h2 id={headingId}>{heading}</h2><p className="lede">{lede}</p></div>
    <Action variant="secondary" disabled={disabled || Boolean(check?.busy)} onClick={onRun}>{check?.busy ? 'Checking the map…' : actionLabel}</Action>
    {check?.busy && <p role="status">Checking your map…</p>}
    {check?.error && <p role="alert" className="teacher-message teacher-message--error">{check.error}</p>}
    {check?.notes && (check.notes.length
      ? <ol className="map-check__notes">{check.notes.map((note, index) => <li key={index} className={`map-check__note map-check__note--${note.kind}`}>
        <span className="map-check__kind">{MAP_CHECK_KIND_LABELS[note.kind] || note.kind}</span>
        <p>{note.point}</p>
        <div className="map-check__refs" aria-label="Map items this note is about">{note.refs.map((ref) => <button type="button" key={ref} className="scope-chip" onClick={() => onShow?.(note.refs, ref)}>{labelFor(ref)}</button>)}</div>
      </li>)}</ol>
      : <p className="empty-message">No notes returned. Your map is unchanged.</p>)}
  </section>;
}

function normalizeConnectionSuggestions(response, project) {
  if (!response || typeof response !== 'object' || Array.isArray(response) || Object.keys(response).length !== 1 || !Array.isArray(response.connections)) {
    throw new Error('The classroom server returned invalid connection suggestions.');
  }
  if (response.connections.length > 12) throw new Error('The classroom server returned too many connection suggestions.');
  const nodeById = new Map(nodesForConnectionPrompt(project).map((node) => [node.id, node]));
  const carriedMicroNodeIds = new Set(project.graph.nodes
    .filter((node) => node.status !== 'rejected' && node.claimState !== 'retired' && node.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(node.type))
    .map((node) => node.id));
  const existingConnections = new Set(project.graph.edges
    .filter((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired')
    .map(({ source, target, verb }) => `${source}\u0000${verb.trim().toLocaleLowerCase()}\u0000${target}`));
  const seen = new Set();
  return response.connections.map((connection, index) => {
    if (!connection || typeof connection !== 'object' || Array.isArray(connection)) throw new Error('The classroom server returned an invalid connection.');
    const keys = Object.keys(connection).filter(key => key !== 'relationshipProcess').sort();
    if (keys.join(',') !== ['rationale', 'source', 'target', 'verb'].join(',')) throw new Error('The classroom server returned an invalid connection.');
    if (connection.relationshipProcess !== undefined && relationshipProcessIssue(connection.relationshipProcess)) throw new Error('The classroom server returned invalid relationship details.');
    const rawSource = nodeById.get(connection.source);
    const rawTarget = nodeById.get(connection.target);
    const [source, target] = project.activeScale === 'exosphere'
      ? orientExospherePathway(rawSource, rawTarget, carriedMicroNodeIds)
      : [rawSource, rawTarget];
    if (!source || !target || source.id === target.id || typeof connection.verb !== 'string' || !connection.verb.trim() || connection.verb.length > RELATIONSHIP_VERB_LIMIT || typeof connection.rationale !== 'string' || !connection.rationale.trim() || connection.rationale.length > 1000) {
      throw new Error('The classroom server returned an invalid connection.');
    }
    if (project.activeScale === 'meso' && (source.scale !== 'micro' || target.scale !== 'micro')) throw new Error('Choose connections between mapped Micro items.');
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
      status: 'pending',
      claimState: 'inference',
      origin: 'model suggestion',
      reviewDecision: 'pending',
      notes: '',
      directed: true,
      rationale: connection.rationale,
      ...(connection.relationshipProcess ? { relationshipProcess: createRelationshipProcess(connection.relationshipProcess) } : {}),
      annotation: { id: stableId('annotation', `edge:${id}:relationship`), text: '' },
    };
  });
}

function authoritativeEvaluationKey(project) {
  const payload = preflightEvaluationPayload(project);
  const { clientUpdatedAt: _clientUpdatedAt, stage: _stage, furthestStage: _furthestStage, ...stableMetadata } = payload.projectMetadata;
  return stableId('evaluation-request', JSON.stringify({
    ...payload, projectMetadata: stableMetadata, contract: GUIDANCE_CONTRACT_VERSION,
    governance: {
      preflight: project.teacherGovernance?.preflight,
      builder: project.teacherGovernance?.builder,
    },
  }));
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
    const existing = typeof node?.label === 'string' ? liveByLabel.get(node.label.toLocaleLowerCase()) : null;
    const previouslySuggested = existing && existing.scale === project.activeScale
      && project.candidates.nodes.some((item) => item.id === existing.id && item.scale === project.activeScale);
    if (!node || typeof node !== 'object' || Array.isArray(node)
      || Object.keys(node).sort().join(',') !== nodeKeys.join(',')
      || typeof node.label !== 'string' || node.scale !== project.activeScale
      || (project.activeScale === 'macrosphere' && !SCALE_VERB_LEXICONS.macrosphere.includes(node.deontic))
      || proposedByLabel.has(node.label.toLocaleLowerCase()) || (existing && !previouslySuggested)) fail();
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
  if (['micro', 'macrosphere'].includes(project.activeScale) && review.connections.length) fail();
  if (project.activeScale === 'meso' && review.nodes.length) fail();
  const existingConnections = new Set(project.graph.edges
    .filter((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired')
    .map((edge) => `${edge.source}\u0000${edge.verb.toLocaleLowerCase()}\u0000${edge.target}`));
  const seenConnections = new Set();
  const resolve = (reference) => liveById.get(reference)
    || liveByLabel.get(String(reference || '').toLocaleLowerCase())
    || proposedByLabel.get(String(reference || '').toLocaleLowerCase());
  review.connections.forEach((connection) => {
    if (!connection || typeof connection !== 'object' || Array.isArray(connection)
      || Object.keys(connection).filter(key => key !== 'relationshipProcess').sort().join(',') !== ['rationale', 'source', 'sourceLabel', 'target', 'targetLabel', 'verb'].join(',')) fail();
    if (connection.relationshipProcess !== undefined && relationshipProcessIssue(connection.relationshipProcess)) fail();
    const source = resolve(connection.source);
    const target = resolve(connection.target);
    if (!source || !target || source === target || source.label !== connection.sourceLabel || target.label !== connection.targetLabel) fail();
    if (project.activeScale === 'meso' && (source.scale !== 'micro' || target.scale !== 'micro'
      || !liveById.has(connection.source) || !liveById.has(connection.target))) fail();
    // Endpoint mistakes remain visible as pending suggestions so the student
    // can repair or remove them. Only the closed Exo relationship register is
    // required at ingestion; commitment enforces an outside source and a valid setting or office recipient.
    if (project.activeScale === 'exosphere' && !SCALE_VERB_LEXICONS.exosphere.includes(connection.verb)) fail();
    const sourceReference = liveById.has(connection.source) ? connection.source : source.label;
    const targetReference = liveById.has(connection.target) ? connection.target : target.label;
    const key = `${sourceReference}\u0000${connection.verb.toLocaleLowerCase()}\u0000${targetReference}`;
    const previouslySuggested = project.candidates.edges.some((item) => item.scale === project.activeScale
      && item.source === source.id && item.target === target.id && item.verb === connection.verb);
    if (seenConnections.has(key) || (existingConnections.has(key) && !previouslySuggested)) fail();
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

export function createBlankProject() {
  const project = createDefaultProject();
  const nonce = globalThis.crypto?.randomUUID?.().replaceAll('-', '')
    || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  project.id = `project_${nonce}`;
  project.mapAnnotation = { id: stableId('annotation', `${project.id}:map`), text: '' };
  project.title = 'Untitled systems map';
  project.inquiry = '';
  project.stage = 0;
  project.furthestStage = 0;
  project.submission = {
    id: `submission_${nonce}`,
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
    fork: <><circle cx="6" cy="4" r="2" /><circle cx="18" cy="4" r="2" /><circle cx="12" cy="20" r="2" /><path d="M6 6v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V6M12 12v6" /></>,
  };
  return <svg aria-hidden="true" className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function MemoForkButton({ onRequestRestart }) {
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const showTooltip = !dismissed && (hovered || focused);
  useEffect(() => {
    if (!showTooltip) return undefined;
    const onEscape = (event) => { if (event.key === 'Escape') setDismissed(true); };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [showTooltip]);
  return <span className="memo-fork" onPointerEnter={(event) => {
    if (event.pointerType !== 'touch') { setHovered(true); setDismissed(false); }
  }} onPointerLeave={() => setHovered(false)}>
    <button className="memo-fork__button" type="button" aria-label="New map from this memo" aria-describedby={showTooltip ? tooltipId : undefined}
      onFocus={() => { setFocused(true); setDismissed(false); }} onBlur={() => setFocused(false)}
      onClick={() => { setDismissed(true); onRequestRestart(); }}><Icon name="fork" size={20} /></button>
    <span id={tooltipId} className="memo-fork__tooltip" role="tooltip" hidden={!showTooltip}>New map from this memo</span>
  </span>;
}

function LabLink() {
  return <a className="brand__lab" href="https://ailab.gc.cuny.edu" aria-label="CUNY AI Lab"><img className="lab-logo" src={cunyAiLabLogo} alt="" /></a>;
}

function storedTheme() {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY) ?? projectStorage()?.getItem(THEME_STORAGE_KEY);
    return saved === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function ThemeToggle({ dark, onToggle, showLabel = false }) {
  return <button className={`theme-toggle${showLabel ? ' theme-toggle--labeled' : ''}`} type="button" aria-pressed={dark} aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`} title={`Switch to ${dark ? 'light' : 'dark'} mode`} onClick={onToggle}><span className="theme-toggle__icon" aria-hidden="true" />{showLabel && <span aria-hidden="true">{dark ? 'Light' : 'Dark'}</span>}</button>;
}

function Modal({ open, title, onClose, children, wide = false }) {
  const closeRef = useRef(null);
  const modalRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(modalRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, a[href], [tabindex]:not([tabindex="-1"])') || [])].filter((element) => {
        if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
        for (let parent = element.parentElement; parent && parent !== modalRef.current; parent = parent.parentElement) {
          if (parent.tagName === 'DETAILS' && !parent.open && element !== parent.querySelector(':scope > summary')) return false;
        }
        return true;
      });
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
      (previous?.closest('details:not([open])')?.querySelector(':scope > summary') || previous)?.focus?.();
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

function SuggestionPreference({ project, update }) {
  return <label className="check-row suggestion-preference"><input type="checkbox" checked={!project.instructor.requireStudentConfirmation} onChange={(event) => update((draft) => {
    draft.instructor.requireStudentConfirmation = !event.target.checked;
  }, 'suggestions.preference-changed', event.target.checked ? 'Add automatically' : 'Review before adding')} /><span>Add suggestions automatically</span></label>;
}

const FOCAL_PARTICIPATION_LABELS = Object.freeze({
  direct: 'Directly involved',
  indirect: 'Affected indirectly',
  unclear: 'Unclear',
  'not applicable': 'Not applicable',
});

function MicroParticipationEditor({ item, settingOptions, onParticipationChange, onSettingNodeIdsChange }) {
  const itemLabel = item.label?.trim() || 'this item';
  const itemIsSetting = item.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(item.type);
  const selectedIds = Array.isArray(item.settingNodeIds) ? item.settingNodeIds : [];
  const settingById = new Map(settingOptions.map((setting) => [setting.id, setting]));
  const availableSettings = settingOptions.filter((setting) => setting.id !== item.id && !selectedIds.includes(setting.id));
  const participation = FOCAL_PARTICIPATION_STATES.includes(item.focalParticipation)
    ? item.focalParticipation
    : 'unclear';
  return <div className="micro-context-editor" aria-label={`Micro context for ${itemLabel}`}>
    <Field label="Person’s involvement">
      <select aria-label={`Person’s involvement with ${itemLabel}`} value={participation} onChange={(event) => onParticipationChange(event.target.value)}>
        {FOCAL_PARTICIPATION_STATES.map((value) => <option key={value} value={value}>{FOCAL_PARTICIPATION_LABELS[value]}</option>)}
      </select>
    </Field>
    {!itemIsSetting && <div className="micro-membership-editor">
      <span className="field__label">Item settings</span>
      <div className="scope-editor__members">
        {selectedIds.map((settingId) => {
          const setting = settingById.get(settingId);
          const label = setting?.label || settingId;
          return <button key={settingId} type="button" className="scope-chip" onClick={() => onSettingNodeIdsChange(selectedIds.filter((id) => id !== settingId))} aria-label={`Remove ${label} from settings for ${itemLabel}`}>{label}<span aria-hidden="true"> ×</span></button>;
        })}
        {availableSettings.length ? <select className="scope-editor__add" aria-label={`Add a setting for ${itemLabel}`} value="" onChange={(event) => {
          const settingId = event.target.value;
          if (!settingId || selectedIds.includes(settingId) || selectedIds.length >= PROJECT_LIMITS.scopeMembers) return;
          onSettingNodeIdsChange([...selectedIds, settingId]);
        }}>
          <option value="">Add setting…</option>
          {availableSettings.map((setting) => <option key={setting.id} value={setting.id}>{setting.label}{setting.status === 'rejected' || setting.claimState === 'retired' ? ' — removed' : ''}</option>)}
        </select> : null}
        {!selectedIds.length && !availableSettings.length ? <span className="scope-editor__empty">No settings available yet</span> : null}
      </div>
    </div>}
  </div>;
}

const CLAIM_EVIDENCE_COPY = Object.freeze({
  sourcePassage: Object.freeze({ label: 'Memo passage or evidence', hint: 'Copy the memo passage or other project evidence that supports this claim.' }),
  studentInterpretation: Object.freeze({ label: 'Student interpretation', hint: 'State what you think this evidence shows.' }),
  warrant: Object.freeze({ label: 'Reasoning', hint: 'Explain why the passage supports your interpretation.' }),
  uncertainty: Object.freeze({ label: 'Uncertainty', hint: 'Record what remains unclear or unsupported.' }),
  counterevidence: Object.freeze({ label: 'Counterevidence', hint: 'Record evidence that challenges or complicates this claim.' }),
  missingVoice: Object.freeze({ label: 'Missing perspective', hint: 'Name whose account or knowledge is absent.' }),
});

const PROCESS_DIRECTION_OPTIONS = Object.freeze([
  Object.freeze({ value: 'source to target', label: 'Starting item to ending item' }),
  Object.freeze({ value: 'target to source', label: 'Ending item to starting item' }),
  Object.freeze({ value: 'both directions', label: 'Both directions' }),
  Object.freeze({ value: 'varies', label: 'Direction varies' }),
  Object.freeze({ value: 'not yet known', label: 'Not yet known' }),
]);

function nextClaimEvidenceRecord(ownerId, records) {
  const ids = new Set(records.map((record) => record.id));
  let index = records.length;
  let record = createClaimEvidenceRecord({}, { ownerId, index });
  while (ids.has(record.id)) {
    index += 1;
    record = createClaimEvidenceRecord({}, { ownerId, index });
  }
  return record;
}

function ClaimEvidenceRecordEditor({ record, index, onEdit, onRemove }) {
  const [open, setOpen] = useState(index === 0);
  const completed = CLAIM_EVIDENCE_FIELDS.filter((field) => record[field]?.trim()).length;
  return <details className="claim-evidence-record" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><span>Evidence record {index + 1}</span><strong>{completed} of {CLAIM_EVIDENCE_FIELDS.length} fields</strong></summary>
    <div className="claim-evidence-record__body">
      {CLAIM_EVIDENCE_FIELDS.map((field) => {
        const copy = CLAIM_EVIDENCE_COPY[field];
        return <Field key={field} label={copy.label} hint={copy.hint}><textarea rows={field === 'sourcePassage' ? 4 : 3} maxLength={field === 'sourcePassage' ? PROJECT_LIMITS.evidenceExcerpt : PROJECT_LIMITS.claimEvidenceText} value={record[field] || ''} onChange={(event) => onEdit(field, event.target.value)} /></Field>;
      })}
      <button className="claim-evidence-record__remove" type="button" onClick={onRemove}>Remove record</button>
    </div>
  </details>;
}

function ClaimEvidenceEditor({ ownerId, records = [], onChange, onActivity }) {
  const addRecord = () => {
    onChange([...records, nextClaimEvidenceRecord(ownerId, records)]);
    onActivity?.('added');
  };
  const editRecord = (recordId, field, value) => {
    onChange(records.map((record) => {
      if (record.id !== recordId) return record;
      const edited = { ...record, [field]: value };
      if (field === 'sourcePassage' && Object.hasOwn(record, 'evidenceHash')) {
        if (value) edited.evidenceHash = stableId('evh', value);
        else delete edited.evidenceHash;
      }
      return edited;
    }));
  };
  const removeRecord = (recordId) => {
    onChange(records.filter((record) => record.id !== recordId));
    onActivity?.('removed');
  };
  return <section className="claim-evidence" aria-label="Evidence records">
    <div className="claim-evidence__head"><h3>Evidence records</h3><button type="button" onClick={addRecord}>Add record</button></div>
    <p className="claim-evidence__intro">Separate memo language, your interpretation, and remaining questions.</p>
    {records.length ? <div className="claim-evidence__list">{records.map((record, index) => <ClaimEvidenceRecordEditor key={record.id} record={record} index={index} onEdit={(field, value) => editRecord(record.id, field, value)} onRemove={() => removeRecord(record.id)} />)}</div> : <p className="empty-message">No evidence records yet.</p>}
  </section>;
}

function ConnectionDetailsFields({ process, onChange }) {
  const update = (field, value) => onChange({ ...createRelationshipProcess(process), [field]: value });
  return <div className="connection-details-fields">
    <div className="field-pair">
      <Field label="Connection status"><select value={process?.connectionStatus || 'unknown'} onChange={event => update('connectionStatus', event.target.value)}><option value="unknown">Not yet known</option><option value="observed">Observed</option><option value="missing">Missing connection</option></select></Field>
      <Field label="Connection strength"><select value={process?.strength || 'unknown'} onChange={event => update('strength', event.target.value)}><option value="unknown">Not yet known</option><option value="strong">Strong</option><option value="weak">Weak</option><option value="contested">Contested</option></select></Field>
    </div>
    <Field label="Communication channel" hint="For example: email, phone, a shared system, or a paper form."><input maxLength={PROJECT_LIMITS.relationshipProcessText} value={process?.channel || ''} onChange={event => update('channel', event.target.value)} /></Field>
    <Field label="Who does the connecting work?" hint="Name the role, including the parent or young person when they carry the connection."><input maxLength={PROJECT_LIMITS.relationshipProcessText} value={process?.connectingWork || ''} onChange={event => update('connectingWork', event.target.value)} /></Field>
    <Field label="Families depending on this connector" hint="Enter a source-supported count. Keep percentages in the evidence; leave an unknown count blank."><input type="number" min="0" step="1" value={process?.familyCount ?? ''} placeholder="Unknown" onChange={event => { const value = event.target.value === '' ? null : Number(event.target.value); if (value === null || Number.isSafeInteger(value) && value >= 0) update('familyCount', value); }} /></Field>
    <p className="field__hint">Wider lines show larger family counts. A dashed line marked “Missing connection” records an absent link.</p>
  </div>;
}

function RelationshipProcessEditor({ edge, onChange, onActivity }) {
  const process = createRelationshipProcess(edge.relationshipProcess);
  const updateField = (field, value) => onChange({ ...process, [field]: value });
  const directionLabels = {
    'source to target': `${edge.sourceLabel} to ${edge.targetLabel}`,
    'target to source': `${edge.targetLabel} to ${edge.sourceLabel}`,
  };
  return <details className="relationship-process">
    <summary><span>Process and time</span><strong>{edge.scale === 'meso' ? 'Meso relationship' : 'Exo-level connection'}</strong></summary>
    <div className="relationship-process__body">
      <p>Record how this connection operates. Leave any unknown field blank.</p>
      {edge.scale === 'meso' && <ConnectionDetailsFields process={process} onChange={onChange} />}
      <div className="field-pair"><Field label="Frequency"><input maxLength={PROJECT_LIMITS.relationshipProcessText} value={process.frequency} onChange={(event) => updateField('frequency', event.target.value)} onBlur={() => onActivity?.()} /></Field><Field label="Duration"><input maxLength={PROJECT_LIMITS.relationshipProcessText} value={process.duration} onChange={(event) => updateField('duration', event.target.value)} onBlur={() => onActivity?.()} /></Field></div>
      <Field label="Direction"><select value={relationshipDirection(edge)} onChange={(event) => { updateField('direction', event.target.value); onActivity?.(); }}>{!PROCESS_DIRECTION_OPTIONS.some(option => option.value === relationshipDirection(edge)) && <option value={relationshipDirection(edge)}>{relationshipDirection(edge)}</option>}{PROCESS_DIRECTION_OPTIONS.map((option) => <option key={option.value || 'blank'} value={option.value}>{directionLabels[option.value] || option.label}</option>)}</select></Field>
      <Field label="Conditions" hint="What must be true for this connection to work?"><textarea rows="3" maxLength={PROJECT_LIMITS.relationshipProcessText} value={process.conditions} onChange={(event) => updateField('conditions', event.target.value)} onBlur={() => onActivity?.()} /></Field>
      <Field label="Change over time" hint="Describe what has changed, when known."><textarea rows="3" maxLength={PROJECT_LIMITS.relationshipProcessText} value={process.changeOverTime} onChange={(event) => updateField('changeOverTime', event.target.value)} onBlur={() => onActivity?.()} /></Field>
    </div>
  </details>;
}

function AccessFrame({ children, onTeacher, dark, onToggleTheme }) {
  return <div className="access-shell">
    <header className="access-header">
      <LabLink />
      <strong>Systems Mapping</strong>
      <div className="access-header__actions"><ThemeToggle dark={dark} onToggle={onToggleTheme} showLabel />{onTeacher && <button type="button" className="access-header__teacher" onClick={onTeacher}>Instructor Console</button>}</div>
    </header>
    {children}
  </div>;
}

function InstitutionalAccessScreen({ state, onRetry, onLeave, dark, onToggleTheme }) {
  return <AccessFrame dark={dark} onToggleTheme={onToggleTheme}>
    <main className="access-main" id="workspace">
      <PageHeading title="Systems Mapping" />
      {state.message && <p className={`access-message access-message--${state.kind || 'info'}`} role={state.kind === 'error' ? 'alert' : 'status'}>{state.message}</p>}
      <div className="button-row institutional-access__actions">
        {state.status !== 'checking' && <Action as="a" href={institutionalLoginUrl()} onClick={onLeave}>CUNY Login</Action>}
        {state.status === 'unavailable' && <Action variant="secondary" onClick={onRetry}>Try again</Action>}
      </div>
      <NollSketch className="noll-sketch--page" />
    </main>
  </AccessFrame>;
}

function sessionFailureState(error, institutionalMode) {
  const authenticationFailed = error instanceof ApiError && [401, 403].includes(error.status);
  return {
    status: institutionalMode && authenticationFailed ? 'expired' : 'unavailable',
    access: null,
    message: !institutionalMode ? 'The class workspace is unavailable. Try again later.'
      : error instanceof ApiError && error.status === 403 ? 'CUNY AI Lab access required'
        : authenticationFailed ? 'Use CUNY Login to continue' : 'Sign-in check unavailable',
    kind: 'error',
  };
}

function ClassAccessScreen({ state, onSubmit, onTeacher, dark, onToggleTheme }) {
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
  return <AccessFrame onTeacher={onTeacher} dark={dark} onToggleTheme={onToggleTheme}>
    <main className="access-main" id="workspace">
      <PageHeading title="Systems Mapping" description="Map how people, settings, and decisions connect" />
      <LevelTrail />
      <form className="class-code-form" onSubmit={submit}>
        <Field label="Class code">
          <input ref={inputRef} maxLength="32" autoComplete="one-time-code" autoCapitalize="none" spellCheck="false" value={code} onChange={(event) => setCode(event.target.value)} disabled={state.status === 'checking' || state.status === 'submitting'} />
        </Field>
        {state.message && <p className={`access-message access-message--${state.kind || 'info'}`} role={state.kind === 'error' ? 'alert' : 'status'}>{state.message}</p>}
        <button className="button access-primary" type="submit" disabled={!code.trim() || state.status === 'checking' || state.status === 'submitting'}>{state.status === 'checking' ? 'Checking class access…' : state.status === 'submitting' ? 'Checking code…' : 'Continue'}</button>
      </form>
      <details className="access-help"><summary>Having trouble?</summary><p>Ask your teacher for the current class code.</p></details>
      <NollSketch className="noll-sketch--page" />
    </main>
  </AccessFrame>;
}

function projectSavedLabel(updatedAt) {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return 'Saved on this device';
  return `Saved ${date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

function projectLinkDate(value, fallback = 'Not available') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function mergeProjectLinkMetadata(link, metadata = {}) {
  const next = { ...link };
  for (const key of ['revision', 'updatedAt', 'expiresAt', 'revokedAt', 'lastSyncedAt']) {
    if (metadata[key] !== undefined) next[key] = metadata[key];
  }
  return next;
}

function projectLinkStatus(link) {
  if (!link) return 'idle';
  if (link.revokedAt) return 'revoked';
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now()) return 'expired';
  return 'synced';
}

function ProjectsScreen({ projects, activeProjectId, saveState, onOpen, onStart, onTeacher, onEndAccess, onRecovery, linkNotice = null, dark, onToggleTheme }) {
  return <AccessFrame onTeacher={onTeacher} dark={dark} onToggleTheme={onToggleTheme}>
    <main className="resume-main studio-dashboard" id="workspace">
      <PageHeading title="Projects" description="Continue a map or start a new one" actions={projects.length ? <Action onClick={onStart}><Icon name="plus" />New project</Action> : null} />
      {linkNotice && <p className="access-message access-message--error" role="alert">{linkNotice}</p>}
      {saveState.status === 'error' && <button type="button" className="recovery-notice" onClick={onRecovery}><strong>Local recovery needs attention</strong><span>{saveState.message}</span></button>}
      {projects.length ? <div className="studio-projects" aria-label="Saved projects">{projects.map((savedProject) => <ProjectRow key={savedProject.id} title={savedProject.title} current={savedProject.id === activeProjectId} subtitle={[SCALES[savedProject.activeScale]?.label, STAGES[savedProject.stage]?.short].filter(Boolean).join(' · ')} detail={projectSavedLabel(savedProject.updatedAt)} onOpen={() => onOpen(savedProject)} />)}</div>
        : <EmptyState title="Start your first map" description="Begin with a memo" action={<Action onClick={onStart}>Start new project</Action>} />}
      <Disclosure title="Workspace details" className="workspace-details"><p>Projects are saved in this browser</p><Action variant="ghost" onClick={onEndAccess}>End class access</Action></Disclosure>
      <NollSketch className="noll-sketch--page" />
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
  const evidenceLines = (records) => (records || []).flatMap((record, index) => {
    const fields = [
      ['Memo passage or evidence', record.sourcePassage], ['Student interpretation', record.studentInterpretation],
      ['Reasoning', record.warrant], ['Uncertainty', record.uncertainty],
      ['Counterevidence', record.counterevidence], ['Missing perspective', record.missingVoice],
    ].filter(([, value]) => String(value || '').trim());
    return fields.length ? [`  - Evidence record ${index + 1}`, ...fields.map(([label, value]) => `    - ${label}: ${value}`)] : [];
  });
  const nodeLines = project.graph.nodes.flatMap((node) => {
    const annotations = [node.annotations?.analytical?.text && `analysis: ${node.annotations.analytical.text}`, node.annotations?.evidence?.text && `evidence note: ${node.annotations.evidence.text}`].filter(Boolean).join('; ');
    const members = node.scopeNodeIds?.map((memberId) => nodeById.get(memberId)?.label).filter(Boolean) || [];
    const membership = node.scale === 'meso' && members.length
      ? `; includes Micro settings: ${members.join(', ')}`
      : node.scale === 'macrosphere' && members.length
        ? `; ${node.deontic || 'shapes'}: ${members.join(', ')}`
        : '';
    const explanation = node.scale === 'meso' && node.mesoExplanation ? `; explanation: ${node.mesoExplanation}` : '';
    const immediateSettings = (node.settingNodeIds || []).map((settingId) => nodeById.get(settingId)?.label).filter(Boolean);
    const microContext = node.scale === 'micro'
      ? `; focal participation: ${FOCAL_PARTICIPATION_LABELS[node.focalParticipation] || node.focalParticipation || 'not recorded'}${immediateSettings.length ? `; immediate settings: ${immediateSettings.join(', ')}` : ''}`
      : '';
    return [`- **${node.label}** — ${node.type}; level: ${SCALES[node.scale]?.label || node.scale}; evidence: ${node.evidence || 'needs evidence'}${membership}${explanation}${microContext}${annotations ? `; ${annotations}` : ''}`, ...evidenceLines(node.claimEvidence)];
  });
  const edgeLines = project.graph.edges.flatMap((edge) => {
    const process = relationshipProcessSummary(edge.relationshipProcess);
    return [`- ${relationshipDescription(edge)} — arrow direction: ${relationshipDirection(edge)}; level: ${SCALES[edge.scale]?.label || edge.scale}; evidence: ${edge.evidence || 'needs evidence'}${process ? `; process: ${process}` : ''}${edge.annotation?.text ? `; annotation: ${edge.annotation.text}` : ''}`, ...evidenceLines(edge.claimEvidence)];
  });
  const redactionLines = project.portableExport?.redactions?.map((entry) => `- ${entry.path}: ${entry.reason}`).join('\n') || '- None';
  return `# ${project.title}\n\n${project.inquiry ? `${project.inquiry}\n\n` : ''}## Memo\n\n${project.submission.text || 'Not yet written'}\n\n## Map annotation\n\n${project.mapAnnotation?.text || 'Not yet written'}\n\n## Nodes\n\n${nodeLines.join('\n') || '- None added'}\n\n## Relationships\n\n${edgeLines.join('\n') || '- None added'}\n\n## Field Notes\n\n${project.reflection || 'Not yet written'}\n\n## Items needing evidence\n\n${project.candidates.edges.filter((edge) => edge.status === 'research lead').map((edge) => `- ${relationshipDescription(edge)}`).join('\n') || '- None recorded'}\n\n## Export redactions\n\n${redactionLines}\n`;
}

export function graphCsv(project) {
  const inert = (value) => {
    const text = String(value ?? '');
    return /^(?:[\t\r\n]|[ \t\r\n]*[=+\-@])/.test(text) ? `'${text}` : text;
  };
  const quote = (value) => `"${inert(value).replaceAll('"', '""')}"`;
  const nodeById = new Map(project.graph.nodes.map((node) => [node.id, node]));
  const rows = [['record_type', 'id', 'label_or_from', 'type_or_verb', 'target', 'scale', 'evidence', 'annotation', 'evidence_annotation', 'scope_member_ids', 'scope_member_labels', 'structural_action', 'claim_evidence_json', 'relationship_process_json', 'meso_explanation', 'origin', 'review_decision', 'micro_setting_ids', 'focal_participation', 'arrow_direction', 'connection_status', 'connection_strength', 'communication_channel', 'connecting_work', 'family_count']];
  project.graph.nodes.forEach((node) => rows.push([
    'node', node.id, node.label, node.type, '', node.scale, node.evidence,
    node.annotations?.analytical?.text || '', node.annotations?.evidence?.text || '',
    (node.scopeNodeIds || []).join('; '),
    (node.scopeNodeIds || []).map((id) => nodeById.get(id)?.label).filter(Boolean).join('; '),
    node.scale === 'macrosphere' ? node.deontic || 'shapes' : '',
    JSON.stringify(node.claimEvidence || []), '', node.mesoExplanation || '', node.origin || '', node.reviewDecision || '',
    (node.settingNodeIds || []).join('; '), node.focalParticipation || '', '', '', '', '', '', '',
  ]));
  project.graph.edges.forEach((edge) => rows.push(['edge', edge.id, edge.sourceLabel, edge.verb, edge.targetLabel, edge.scale, edge.evidence, edge.annotation?.text || '', '', '', '', '', JSON.stringify(edge.claimEvidence || []), JSON.stringify(edge.relationshipProcess || {}), '', edge.origin || '', edge.reviewDecision || '', '', '', relationshipDirection(edge), edge.relationshipProcess?.connectionStatus || '', edge.relationshipProcess?.strength || '', edge.relationshipProcess?.channel || '', edge.relationshipProcess?.connectingWork || '', edge.relationshipProcess?.familyCount ?? '']));
  rows.push(['map', project.mapAnnotation?.id || 'map', project.title, '', '', '', '', project.mapAnnotation?.text || '', '', '', '', '', '', '', '', '', '', '']);
  return rows.map((row) => Array.from({ length: rows[0].length }, (_, index) => quote(row[index] ?? '')).join(',')).join('\n');
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
  if (extension === 'pdf') {
    const { extractPdfMemo } = await import('./pdfMemo.js');
    const { text, pageCount, emptyPageCount } = await extractPdfMemo(await file.arrayBuffer(), { maxCharacters: MAX_MEMO_CHARACTERS });
    if (!text.trim()) return { text: '', notice: 'No text could be read from this PDF. Paste the memo text or upload a DOCX.' };
    const notice = pageCount > 1 ? `PDF text imported from ${pageCount} pages.` : 'PDF text imported.';
    const missing = emptyPageCount ? ` ${emptyPageCount} ${emptyPageCount === 1 ? 'page contains' : 'pages contain'} no selectable text; compare with the original and paste any missing passages.` : '';
    return { text, notice: notice + missing };
  }
  throw new Error('You can import DOCX, PDF, TXT, MD, HTML, or JSON files.');
}

function IntakeStage({ project, update, toast, onRequestRestart, captureImportScope }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [fileNotice, setFileNotice] = useState('');
  const importRequest = useRef(0);
  const importFeedback = useRef(null);
  // Leaving intake, changing projects, or editing the memo invalidates any
  // pending reader. An old result must never land in the current project.
  useLayoutEffect(() => () => { importRequest.current += 1; }, [project.id, project.submission.id]);
  useEffect(() => {
    const pending = importFeedback.current;
    if (!pending || pending.request !== importRequest.current || !pending.inScope()
      || !project.events.some(event => event.id === pending.eventId)) return;
    importFeedback.current = null;
    setFileNotice(pending.notice);
    toast(pending.notice);
  }, [project.events, toast]);
  const setSubmission = (field, value) => {
    importRequest.current += 1;
    update((draft) => { invalidateSubmissionDerived(draft, field, value); });
  };
  const setProjectField = (field, value) => update((draft) => {
    draft[field] = value;
    invalidatePreflight(draft);
  });
  const inquiryContext = parseInquiryContext(project.inquiry);
  const setInquiryField = (field, value) => update((draft) => {
    const next = parseInquiryContext(draft.inquiry);
    next[field] = value;
    draft.inquiry = composeInquiryContext(next);
    invalidatePreflight(draft);
  });
  const onFile = async (event) => {
    const input = event.currentTarget;
    const [file] = input.files;
    if (!file) return;
    const request = ++importRequest.current;
    const inScope = captureImportScope();
    const projectId = project.id;
    const submission = JSON.stringify(project.submission);
    // Reset synchronously so selecting the same file starts a new request;
    // an older reader's finally block must not clear a newer selection.
    input.value = '';
    try {
      if (file.name.length > FILE_NAME_LIMIT) throw new Error(`Choose a memo whose file name is ${FILE_NAME_LIMIT} characters or fewer.`);
      if (file.size > MAX_MEMO_BYTES) throw new Error('Choose a file smaller than 5 MB, or paste a shorter memo.');
      const result = await readMemoFile(file);
      if (request !== importRequest.current || !inScope()) return;
      if (!result.text.trim()) {
        // A file with no readable text must not replace the visible file name
        // while the earlier memo text silently stays in the review.
        setFileNotice(result.notice);
        toast(result.notice, 'error');
        return;
      }
      const event = createEvent('memo.imported', file.name);
      importFeedback.current = { request, inScope, eventId: event.id, notice: result.notice };
      update((draft) => {
        invalidateSubmissionDerived(draft, 'text', result.text);
        draft.submission.title = draft.submission.title || file.name;
        draft.submission.location = `Local file: ${file.name}`;
        draft.submission.fileName = file.name;
        draft.submission.fileSize = file.size;
      }, 'memo.imported', file.name, 'student', null, {
        guard: current => request === importRequest.current && inScope() && current.id === projectId
          && JSON.stringify(current.submission) === submission,
        event,
      });
    } catch {
      if (request !== importRequest.current || !inScope()) return;
      const message = 'The memo file could not be imported. Check its type and size, or paste the memo text instead.';
      setFileNotice(message);
      toast(message, 'error');
    }
  };
  return (
    <div className="wide stage-enter intake-stage">
      <PageHeading title="Memo" description="Set the focus for your map" />
      <LevelTrail active={project.activeScale} completed={project.completedScales} />
      <details className="project-details"><summary>Project details</summary><div className="project-context-fields">
        <Field label="Map title (optional)"><input maxLength={CONFIG_TEXT_LIMIT} value={project.title} onChange={(event) => setProjectField('title', event.target.value)} /></Field>
        <Field label="Student or group name (optional)"><input autoComplete="name" maxLength={CONFIG_TEXT_LIMIT} value={project.participantName || ''} onChange={(event) => setProjectField('participantName', event.target.value)} /></Field>
        <Field label="Focal person"><input maxLength={CONFIG_TEXT_LIMIT} value={inquiryContext.focal} onChange={(event) => setInquiryField('focal', event.target.value)} /></Field>
        <Field label="Question"><input maxLength={CONFIG_TEXT_LIMIT} value={inquiryContext.question} onChange={(event) => setInquiryField('question', event.target.value)} /></Field>
        <Field label="Time period"><input maxLength={CONFIG_TEXT_LIMIT} value={inquiryContext.time} onChange={(event) => setInquiryField('time', event.target.value)} /></Field>
        <Field label="Boundary" hint="What belongs in this map"><input maxLength={CONFIG_TEXT_LIMIT} value={inquiryContext.boundary} onChange={(event) => setInquiryField('boundary', event.target.value)} /></Field>
        <Field label="Evidence"><input maxLength={CONFIG_TEXT_LIMIT} value={inquiryContext.evidence} onChange={(event) => setInquiryField('evidence', event.target.value)} /></Field>
        <Field label="Missing voices"><input maxLength={CONFIG_TEXT_LIMIT} value={inquiryContext.voices} onChange={(event) => setInquiryField('voices', event.target.value)} /></Field>
      </div>
      </details><div className="intake-grid">
        <div>
          <label className="upload-zone">
            <input type="file" accept=".docx,.txt,.md,.html,.htm,.json,.pdf" onChange={onFile} />
            <Icon name="upload" size={26} />
            <strong>{project.submission.fileName || 'Upload a memo'}</strong>
            <span>DOCX, TXT, MD, HTML, JSON, or PDF</span>
          </label>
          {fileNotice && <p className="privacy-note" role="status">{fileNotice}</p>}
          <Field label="Memo" hint={`${project.submission.text.trim().split(/\s+/).filter(Boolean).length.toLocaleString()} words`}>
            <textarea className="memo-text" maxLength="500000" value={project.submission.text} onChange={(event) => setSubmission('text', event.target.value)} rows="15" />
          </Field>
          {hasProjectWork(project) && <MemoForkButton onRequestRestart={onRequestRestart} />}
        </div>
        <aside className="memo-panel">
          <button type="button" className="disclosure-button" aria-label="Privacy" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>
            <span><strong>Privacy</strong><small>Check before sharing</small></span><span aria-hidden="true">{detailsOpen ? '−' : '+'}</span>
          </button>
          {detailsOpen && <div className="memo-fields">
            <label className="check-row"><input type="checkbox" checked={project.submission.sensitive} onChange={(event) => setSubmission('sensitive', event.target.checked)} /><span><strong>Includes private information</strong></span></label>
            {project.submission.sensitive && <label className="check-row"><input type="checkbox" checked={project.submission.consent} onChange={(event) => setSubmission('consent', event.target.checked)} /><span><strong>Ready to share</strong><small>Permission recorded or identifying details removed</small></span></label>}
          </div>}
        </aside>
      </div>
    </div>
  );
}

function MemoDrawer({ project, update, hint, onRequestRestart, drawerRef, defaultOpen = false }) {
  const localRef = useRef(null);
  const ref = drawerRef || localRef;
  useEffect(() => { if (ref.current) ref.current.open = defaultOpen; }, [defaultOpen, ref]);
  return <details ref={ref} className="memo-drawer">
    <summary>
      <span className="memo-drawer__title"><strong>Your memo</strong></span>
      <span className="memo-drawer__mark" aria-hidden="true" />
    </summary>
    <Field label="Memo" hint={hint}>
      <textarea className="memo-text" maxLength="500000" rows="12" value={project.submission.text} onChange={(event) => update((draft) => { invalidateSubmissionDerived(draft, 'text', event.target.value); })} />
    </Field>
    {hasProjectWork(project) && <MemoForkButton onRequestRestart={onRequestRestart} />}
  </details>;
}

function levelProgressStatus(project, scale) {
  const current = project.activeScale === scale;
  const complete = project.completedScales.includes(scale);
  if (current && complete) return 'Current · Complete';
  if (current) return 'Current';
  if (complete) return 'Complete';
  if (project.releasedScales.includes(scale)) return 'Available';
  return 'Not started';
}

// Short on-screen ledes; the fuller shared reviewInstruction still frames the model request.
const REVIEW_LEDES = Object.freeze({
  micro: 'Find the people, settings, and resources in your memo',
  meso: 'Connect the people and settings already on your map',
  exosphere: 'Find outside decisions that change a mapped setting',
  macrosphere: 'Find broader conditions that affect several map items',
});

function SuggestionsReview({ project, update, reviewBusy, reviewProgress, reviewFailure, retryPending, onGenerate }) {
  const review = project.preflight?.memoReview;
  const busy = reviewBusy === 'evaluating';
  const hasMemo = Boolean(project.submission.text.trim());
  const stale = Boolean(project.preflight && project.preflight.sourceFingerprint !== memoFingerprint(project.submission));
  const fieldNotes = previousFieldNotes(project);
  return <section className="suggestions-review" aria-label="Memo review">
    {!review && <div className="work-panel__title"><h2>{project.stage >= 2 ? 'Suggestions' : 'Memo review'}</h2><p className="lede">{REVIEW_LEDES[project.activeScale]}</p></div>}
    {fieldNotes && <details className="field-notes-continuity">
      <summary>From your {SCALES[fieldNotes.scale].label} Field Notes</summary>
      <blockquote>{fieldNotes.text}</blockquote>
      {fieldNotes.truncated && <p>Only this opening excerpt accompanies guidance. Your full note is saved under Field Notes → Notes from other scales.</p>}
    </details>}
    <div className="review-intro">
      {!review && <Action data-next-action="read-memo" variant={requiresLevelModel(project) ? "primary" : "ghost"} disabled={busy || retryPending || !hasMemo || reviewFailure?.retryable === false} onClick={onGenerate}>{busy ? 'Reading memo…' : reviewFailure ? 'Try again' : 'Generate guidance'}</Action>}
    </div>
    <GuidanceProgress active={busy} message={reviewProgress} />
    {reviewFailure && <p role="alert" className="teacher-message teacher-message--error">{reviewFailure.message}</p>}
    {review && <>
      <h2>Suggestions</h2>
      {project.preflight.evaluation?.runtime?.evidenceRepairAttempts > 0 && <p role="status">Guidance was checked and repaired against the narrative passages in your memo. Your full memo and references are preserved.</p>}
      {stale && <p role="status">Update suggestions for your revised memo</p>}
      <Disclosure title="Guidance and evidence" className="review-details">
        {!review.guidance.length && <p className="empty-message">No guidance returned</p>}
        {review.guidance.map((item, index) => <div className="studio-feedback" key={index}>
          <p>{item.point}</p>
          {item.evidenceExcerpt && <blockquote>{item.evidenceExcerpt}</blockquote>}
        </div>)}
        {project.activeScale === 'meso'
          ? !review.connections.length && <p className="empty-message">No connections suggested. You can connect mapped items yourself.</p>
          : !review.nodes.length && <p className="empty-message">No items suggested. Refresh after revising the memo.</p>}
      </Disclosure>
    </>}
  </section>;
}

function candidateStepsForScale(scale) {
  if (scale === 'micro') return ['nodes'];
  if (scale === 'meso') return ['edges', 'suggest'];
  // Macrosphere structures have no connection step: each structure carries a
  // scope of mapped elements instead of edges.
  if (scale === 'macrosphere') return ['nodes'];
  return ['nodes', 'edges', 'suggest'];
}

const MACRO_STRUCTURE_KINDS = MACROSPHERE_NODE_TYPES;

// The full-screen Choose elements stage is a thin wrapper around the same
// suggestion list the Studio panel shows beside the map.
function SuggestionsPanel({ project, update, toast, prompt, onPromptChange, busy, suggestions, onSuggest, onEdit, onDecision, onRefreshCandidates, refreshBusy, onHighlight, reviewBusy, reviewProgress, reviewFailure, retryPending, onGenerate }) {
  const candidateSteps = useMemo(() => candidateStepsForScale(project.activeScale), [project.activeScale]);
  const [step, setStep] = useState(() => candidateSteps[0]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  useEffect(() => setCandidateIndex(0), [step, project.activeScale]);
  useEffect(() => {
    if (!candidateSteps.includes(step)) setStep(candidateSteps[0]);
  }, [candidateSteps, step]);
  const activeCandidates = useMemo(() => ({
    nodes: project.candidates.nodes.filter((item) => item.scale === project.activeScale),
    edges: project.candidates.edges.filter((item) => item.scale === project.activeScale),
  }), [project.activeScale, project.candidates]);
  const liveMapNodes = useMemo(() => project.graph.nodes
    .filter((node) => node.status !== 'rejected' && node.claimState !== 'retired'), [project.graph.nodes]);
  const liveMapNodeById = useMemo(() => new Map(liveMapNodes.map((node) => [node.id, node])), [liveMapNodes]);
  const mesoSettingNodes = useMemo(() => liveMapNodes.filter((node) => node.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(node.type)), [liveMapNodes]);
  const microSettingMembershipOptions = useMemo(() => [...new Map([
    ...project.graph.nodes,
    ...project.candidates.nodes,
  ].filter((node) => node.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(node.type))
    .map((node) => [node.id, node])).values()], [project.candidates.nodes, project.graph.nodes]);
  const candidateEndpointNodeById = useMemo(() => new Map([...project.candidates.nodes, ...liveMapNodes]
    .map((node) => [node.id, node])), [liveMapNodes, project.candidates.nodes]);
  const availableMicroEndpoints = useMemo(() => [...candidateEndpointNodeById.values()]
    .filter(node => node.scale === 'micro' && node.status !== 'rejected' && node.claimState !== 'retired'),
  [candidateEndpointNodeById]);
  const acceptedExosphereNodes = useMemo(() => [...candidateEndpointNodeById.values()].filter((node) => (
    node.scale === 'exosphere'
    && node.claimState !== 'retired'
    && (liveMapNodeById.has(node.id) || node.status === 'confirmed' || node.status === 'research lead')
  )), [candidateEndpointNodeById, liveMapNodeById]);
  const carriedMicroNodeIds = useMemo(() => new Set(mesoSettingNodes.map((node) => node.id)), [mesoSettingNodes]);
  const exospherePathwayIssue = (edge) => {
    if (edge.scale === 'meso') {
      const source = candidateEndpointNodeById.get(edge.source);
      const target = candidateEndpointNodeById.get(edge.target);
      if (!availableMicroEndpoints.some(node => node.id === edge.source)
        || !availableMicroEndpoints.some(node => node.id === edge.target)) return 'Choose two available Micro items';
      if (source.id === target.id) return 'Choose two different items';
      return '';
    }
    if (project.activeScale !== 'exosphere' || edge.scale !== 'exosphere') return '';
    const source = candidateEndpointNodeById.get(edge.source);
    const target = candidateEndpointNodeById.get(edge.target);
    if (source?.scale !== 'exosphere') return 'Choose an Exo-level outside decision setting first.';
    if (!isOrientedExospherePathway(source, target, carriedMicroNodeIds)) return 'Choose an affected Micro setting or outside office already on the map.';
    if (!acceptedExosphereNodes.some((node) => node.id === source.id)) return 'Add the outside decision setting before adding its Exo-level connection.';
    return '';
  };
  // Mesosystems contain Micro settings. Macrosphere items may affect any
  // mapped element from an inner level.
  const scopeCandidates = useMemo(() => project.activeScale === 'meso'
    ? mesoSettingNodes
    : liveMapNodes.filter((node) => node.scale !== 'macrosphere'), [liveMapNodes, mesoSettingNodes, project.activeScale]);
  const [institutionDraft, setInstitutionDraft] = useState({ label: '', type: 'institution', anchor: '', verb: SCALE_VERB_LEXICONS.exosphere[0] });
  const [mesoDraft, setMesoDraft] = useState({ label: '', first: '', second: '', explanation: '' });
  const [structureDraft, setStructureDraft] = useState({ label: '', type: 'policy', deontic: 'shapes', evidence: '' });
  const addMesoLinkage = () => {
    const label = mesoDraft.label.trim();
    if (!label) return toast('Name the mesosystem first.', 'error');
    if (!isMesosystemLabel(label)) return toast('Give the mesosystem a short, conventional name.', 'error');
    if (!mesoDraft.first || !mesoDraft.second || mesoDraft.first === mesoDraft.second) return toast('Choose two different Micro-level settings.', 'error');
    const id = stableId('node', label);
    if (project.candidates.nodes.some((node) => node.id === id)
      || liveMapNodes.some((node) => node.label.trim().toLocaleLowerCase() === label.toLocaleLowerCase())) {
      return toast('That mesosystem is already on your list or map.', 'error');
    }
    update((draft) => {
      draft.candidates.nodes = withDefaultNodeLayout([...draft.candidates.nodes, {
        id, label, type: 'mesosystem', scale: 'meso', status: 'confirmed',
        claimState: 'student interpretation', evidence: '',
        origin: 'student entry', reviewDecision: 'added',
        sourceFingerprint: memoFingerprint(project.submission), notes: '',
        scopeNodeIds: [mesoDraft.first, mesoDraft.second],
        mesoExplanation: mesoDraft.explanation.trim(),
      }]);
    }, 'candidate.added', label);
    setMesoDraft({ label: '', first: '', second: '', explanation: '' });
    toast(`${label} added with two Micro settings.`);
  };
  const addInstitution = () => {
    const label = institutionDraft.label.trim();
    if (!label) return toast('Name the outside decision setting first.', 'error');
    if (!isNamedInstitutionLabel(label)) return toast('Use the full name of an outside office, agency, employer, funder, or service system.', 'error');
    const id = stableId('node', label);
    if (project.candidates.nodes.some((node) => node.id === id)
      || liveMapNodes.some((node) => node.label.trim().toLocaleLowerCase() === label.toLocaleLowerCase())) {
      return toast('That decision setting is already on your list or map.', 'error');
    }
    const anchor = liveMapNodeById.get(institutionDraft.anchor);
    if (institutionDraft.anchor && (!anchor || !isOrientedExospherePathway({ scale: 'exosphere' }, anchor, carriedMicroNodeIds))) {
      return toast('Choose a Micro setting or outside office already on the map.', 'error');
    }
    const fingerprint = memoFingerprint(project.submission);
    update((draft) => {
      draft.candidates.nodes = withDefaultNodeLayout([...draft.candidates.nodes, {
        id, label, type: institutionDraft.type, scale: 'exosphere',
        status: 'confirmed', claimState: 'student interpretation',
        origin: 'student entry', reviewDecision: 'added',
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
            origin: 'student entry', reviewDecision: 'added',
            sourceFingerprint: fingerprint, notes: '',
            annotation: { id: stableId('annotation', `edge:${edgeId}:relationship`), text: '' },
          });
        }
      }
    }, 'candidate.added', label);
    setInstitutionDraft((current) => ({ ...current, label: '', anchor: '' }));
    toast(anchor ? `${label} added with an Exo-level connection to ${anchor.label}.` : `${label} added. Add its Exo-level connection at the next step.`);
  };
  const addStructure = () => {
    const label = structureDraft.label.trim();
    const evidence = structureDraft.evidence.trim();
    if (!label) return toast('Name the Macro-level condition first.', 'error');
    if (!isCanonicalMapElementLabel(label, 'macrosphere')) return toast('Name one complete map item instead of a reference, time, modifier, action, or fragment.', 'error');
    if (containsRetiredSystemsLanguage(label)) return toast('Use a direct, conventional name for the broader condition.', 'error');
    if (isObviousLowerLevelMacroLabel(label)) return toast(LOWER_LEVEL_MACRO_MESSAGE, 'error');
    if (labelRepeatsInstitution(label, liveMapNodes.filter((node) => node.scale === 'exosphere'))) return toast('That label names or repeats an institution. Add it at Exo-level instead.', 'error');
    if (project.instructor.evidenceRequired && !evidence) return toast('Add evidence or a question for this Macro-level condition.', 'error');
    const id = stableId('node', label);
    if (project.candidates.nodes.some((node) => node.id === id)
      || liveMapNodes.some((node) => node.label.trim().toLocaleLowerCase() === label.toLocaleLowerCase())) {
      return toast('That Macro-level condition is already on your list or map.', 'error');
    }
    update((draft) => {
      draft.candidates.nodes = withDefaultNodeLayout([...draft.candidates.nodes, {
        id, label, type: structureDraft.type, scale: 'macrosphere',
        status: 'pending', claimState: 'inference',
        origin: 'student entry', reviewDecision: 'pending',
        evidence, sourceFingerprint: memoFingerprint(project.submission), notes: '',
        deontic: structureDraft.deontic, scopeNodeIds: [],
      }]);
    }, 'candidate.added', label);
    setStructureDraft((current) => ({ ...current, label: '', evidence: '' }));
    toast(`${label} added. Choose at least two map items, then decide whether to add it to the map.`);
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
      item.reviewDecision = 'pending';
    }
  }, 'candidate.scope-edited', id);
  const setStatus = (kind, id, status) => {
    const current = project.candidates[kind].find((candidate) => candidate.id === id);
    if (!current) return;
    if (status === 'research lead' && !project.instructor.allowResearchLeads) return toast('Items needing more evidence are turned off for this project.', 'error');
    if (kind === 'nodes' && status === 'confirmed' && !isCanonicalMapElementLabel(current.label, project.activeScale)) return toast('Name one complete map item instead of a reference, time, modifier, action, or fragment.', 'error');
    if (kind === 'nodes' && status === 'confirmed' && containsRetiredSystemsLanguage(current.label)) return toast('Use a direct, conventional name for the map item.', 'error');
    if (status === 'confirmed' && project.instructor.evidenceRequired && !current.evidence) return toast('Add evidence before moving this item forward.', 'error');
    if (kind === 'nodes' && project.activeScale === 'micro' && status === 'confirmed' && !isDiscreteMicroNodeLabel(current.label)) return toast('Name one specific person, role, group, activity, object, or immediate setting.', 'error');
    if (kind === 'nodes' && project.activeScale === 'meso' && status === 'confirmed' && !isMesosystemLabel(current.label)) return toast('Give the mesosystem a clear name, such as “coordination between home and school.”', 'error');
    if (kind === 'nodes' && project.activeScale === 'exosphere' && status === 'confirmed' && !isNamedInstitutionLabel(current.label)) return toast('Use the full name of an outside office, agency, employer, funder, or service system.', 'error');
    if (kind === 'nodes' && project.activeScale === 'macrosphere' && status === 'confirmed' && isObviousLowerLevelMacroLabel(current.label)) return toast(LOWER_LEVEL_MACRO_MESSAGE, 'error');
    if (kind === 'nodes' && project.activeScale === 'macrosphere' && status === 'confirmed' && labelRepeatsInstitution(current.label, liveMapNodes.filter((node) => node.scale === 'exosphere'))) return toast('That label names or repeats an institution. Add it at Exo-level instead.', 'error');
    if (kind === 'nodes' && project.activeScale === 'meso' && status === 'confirmed' && (current.scopeNodeIds || []).length < 2) return toast('Choose at least two Micro settings for this mesosystem.', 'error');
    if (kind === 'nodes' && project.activeScale === 'macrosphere' && status === 'confirmed' && (current.scopeNodeIds || []).length < 2) return toast('Choose at least two map items for this Macro-level condition.', 'error');
    if (kind === 'edges' && (status === 'confirmed' || status === 'research lead')) {
      const issue = exospherePathwayIssue(current);
      if (issue) return toast(issue, 'error');
    }
    update((draft) => {
      const item = draft.candidates[kind].find((candidate) => candidate.id === id);
      item.status = status;
      item.claimState = status === 'research lead' ? 'research lead' : status === 'confirmed' ? 'student interpretation' : item.claimState;
      item.reviewDecision = status === 'research lead' ? 'set aside' : status === 'confirmed' ? 'added' : 'removed';
    }, `candidate.${status}`, id);
  };
  const edit = (kind, id, field, value) => {
    const current = project.candidates[kind].find((candidate) => candidate.id === id);
    if (!current) return;
    if ((kind === 'nodes' && field === 'label') || (kind === 'edges' && field === 'verb')) {
      const issue = kind === 'nodes' ? nodeLabelIssue(value, current, project.graph.nodes) : relationshipIssue(value, current);
      if (issue) return toast(issue, 'error');
      update((draft) => reviseMapText(draft, 'candidates', kind, id, value));
      return;
    }
    if (kind === 'nodes' && field === 'type' && !isNodeTypeAllowedAtScale(value, project.activeScale)) return toast(`That type does not belong at ${SCALES[project.activeScale].label}.`, 'error');
    const mappedNode = kind === 'nodes'
      ? project.graph.nodes.find((node) => node.id === id && node.scale === current.scale && node.status !== 'rejected' && node.claimState !== 'retired')
      : null;
    const immediateSettingMemberships = mappedNode?.settingNodeIds || current.settingNodeIds || [];
    if (kind === 'nodes' && field === 'type' && MICRO_SETTING_NODE_TYPE_SET.has(value) && immediateSettingMemberships.length) return toast('Remove the immediate setting memberships before changing this item to a setting.', 'error');
    const settingRoleRemoved = kind === 'nodes'
      && field === 'type'
      && mappedNode?.scale === 'micro'
      && MICRO_SETTING_NODE_TYPE_SET.has(mappedNode.type)
      && !MICRO_SETTING_NODE_TYPE_SET.has(value);
    if (settingRoleRemoved) {
      const dependencies = [
        ...project.graph.nodes
          .filter((node) => node.status !== 'rejected' && node.claimState !== 'retired' && (node.scopeNodeIds || []).includes(id))
          .map((node) => node.label),
        ...project.graph.nodes
          .filter((node) => node.status !== 'rejected' && node.claimState !== 'retired' && (node.settingNodeIds || []).includes(id))
          .map((node) => `${node.label} (setting membership)`),
        ...project.graph.edges
          .filter((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired' && (edge.source === id || edge.target === id))
          .map((edge) => relationshipDescription(edge)),
      ];
      if (dependencies.length) return toast(`Review or remove connected map work before changing this setting type: ${dependencies.join('; ')}.`, 'error');
    }
    const settingRoleAdded = kind === 'nodes'
      && field === 'type'
      && mappedNode?.scale === 'micro'
      && !MICRO_SETTING_NODE_TYPE_SET.has(mappedNode.type)
      && MICRO_SETTING_NODE_TYPE_SET.has(value);
    if (settingRoleAdded) {
      const nodeById = new Map(project.graph.nodes.map((node) => [node.id, node]));
      const invalidRelationship = project.graph.edges.find((edge) => {
        if (edge.scale !== 'micro' || edge.status === 'rejected' || edge.claimState === 'retired') return false;
        if (edge.source !== id && edge.target !== id) return false;
        const otherNode = nodeById.get(edge.source === id ? edge.target : edge.source);
        return MICRO_SETTING_NODE_TYPE_SET.has(otherNode?.type);
      });
      if (invalidRelationship) return toast(`Review or remove ${relationshipDescription(invalidRelationship)} before changing this item to an immediate-setting type.`, 'error');
    }
    update((draft) => {
      const item = draft.candidates[kind].find((candidate) => candidate.id === id);
      item[field] = value;
      if (kind === 'nodes') {
        const mappedNode = correspondingNode(item, draft.graph.nodes);
        if (mappedNode && ['type', 'focalParticipation', 'mesoExplanation'].includes(field)) mappedNode[field] = value;
        // A setting membership can be mirrored before commit only when every
        // referenced setting is already on the graph. Newly accepted settings
        // are applied together by commitMapSelections below.
        if (mappedNode && field === 'settingNodeIds' && value.every((settingId) => draft.graph.nodes.some((node) => node.id === settingId))) {
          mappedNode.settingNodeIds = value;
        }
      }
      if (kind === 'edges' && (field === 'source' || field === 'target')) {
        const endpoint = candidateEndpointNodeById.get(value);
        if (field === 'source') item.sourceLabel = endpoint?.label || item.sourceLabel;
        if (field === 'target') item.targetLabel = endpoint?.label || item.targetLabel;
        item.status = 'pending';
        item.claimState = 'inference';
        item.reviewDecision = 'pending';
      }
    });
  };
  const counts = Object.fromEntries(['nodes', 'edges'].map((kind) => {
    const items = activeCandidates[kind];
    return [kind, {
      total: items.length,
      decided: items.filter((item) => item.reviewDecision ? item.reviewDecision !== 'pending' : item.status !== 'pending').length,
      remaining: items.filter((item) => item.status === 'pending').length,
    }];
  }));
  const levelStepCopy = {
    meso: {
      nodes: { lede: 'Connect two or more Micro settings' },
    },
    exosphere: {
      nodes: { lede: 'Choose outside decision settings' },
      edges: { lede: 'Connect outside decisions to Micro settings' },
    },
    macrosphere: {
      nodes: { lede: 'Choose conditions that affect several map items' },
    },
  };
  const stepCopy = {
    nodes: {
      tab: 'Items',
      title: 'Choose items',
      lede: 'Choose what belongs on the map',
      ...(levelStepCopy[project.activeScale]?.nodes || {}),
    },
    edges: {
      tab: 'Connections',
      title: project.activeScale === 'micro' ? 'Relationships' : 'Connections',
      lede: project.activeScale === 'meso'
        ? 'Connect the people and settings already on your map'
        : project.activeScale === 'micro'
          ? 'Review direct relationships'
        : 'Connect outside decisions to Micro settings',
      ...(levelStepCopy[project.activeScale]?.edges || {}),
    },
    suggest: {
      tab: 'Ask',
      title: project.activeScale === 'micro' ? 'More relationships' : 'More connections',
      lede: project.activeScale === 'micro'
        ? 'Describe a missing relationship'
        : 'Describe a missing connection',
    },
  };
  const carriedNodes = project.activeScale === 'meso'
    ? liveMapNodes.filter((node) => node.scale === 'micro')
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
  const endpointOptions = (validNodes, currentId) => {
    const current = candidateEndpointNodeById.get(currentId);
    return current && !validNodes.some((node) => node.id === current.id)
      ? [{ ...current, needsRepair: true }, ...validNodes]
      : validNodes;
  };
  const candidateRows = (kind, items, offset = 0) => items.map((item, index) => {
    const pathwayIssue = kind === 'edges' ? exospherePathwayIssue(item) : '';
    return <article className={`candidate-row candidate-row--${item.status.replaceAll(' ', '-')}`} key={item.id}>

    <div className="candidate-row__main">
      <h3 className="candidate-title">{kind === 'nodes' ? item.label : relationshipDescription(item)}</h3>
      <Disclosure title="Details" className="candidate-details" defaultOpen={Boolean(pathwayIssue || (scopeRow && (item.scopeNodeIds || []).length < 2))}>
      {kind === 'nodes' ? <>
        <MapTextEditor key={`label:${item.id}`} label={mesoLinkageRow ? 'Mesosystem label' : structureRow ? 'Macro-level condition label' : 'Node label'} maxLength={NODE_LABEL_LIMIT} value={item.label} validate={(value) => nodeLabelIssue(value, item, project.graph.nodes)} onSave={(value) => edit(kind, item.id, 'label', value)} />
        {!mesoLinkageRow && <Field label={structureRow ? 'Macro-level condition type' : 'Node type'}><select value={item.type} onChange={(event) => edit(kind, item.id, 'type', event.target.value)}>{candidateNodeTypes.map((type) => <option key={type}>{type}</option>)}</select></Field>}
      </> : <>
        {project.activeScale === 'meso' && <><Field label="From"><select value={item.source} onChange={(event) => edit(kind, item.id, 'source', event.target.value)}>{endpointOptions(availableMicroEndpoints, item.source).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field><Field label="To"><select value={item.target} onChange={(event) => edit(kind, item.id, 'target', event.target.value)}>{endpointOptions(availableMicroEndpoints, item.target).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field></>}
        {project.activeScale === 'exosphere' && <Field label="Outside decision setting"><select value={item.source} onChange={(event) => edit(kind, item.id, 'source', event.target.value)}>{endpointOptions(acceptedExosphereNodes, item.source).map((node) => <option key={node.id} value={node.id}>{node.needsRepair ? 'Needs repair: ' : ''}{node.label}</option>)}</select></Field>}
        <MapTextEditor key={`verb:${item.id}`} label={project.activeScale === 'exosphere' ? 'How the decision reaches its recipient' : 'Direct connection'} maxLength={RELATIONSHIP_VERB_LIMIT} value={item.verb} options={project.activeScale === 'exosphere' ? exoVerbOptions(item.verb) : undefined} validate={(value) => relationshipIssue(value, item)} onSave={(value) => edit(kind, item.id, 'verb', value)} />
        {project.activeScale === 'exosphere' && <Field label="Affected setting or office"><select value={item.target} onChange={(event) => edit(kind, item.id, 'target', event.target.value)}>{endpointOptions([...mesoSettingNodes, ...acceptedExosphereNodes].filter(node => node.id !== item.source), item.target).map((node) => <option key={node.id} value={node.id}>{node.needsRepair ? 'Needs repair: ' : ''}{node.label}</option>)}</select></Field>}
      </>}
      {kind === 'nodes' && item.scale === 'micro' && <MicroParticipationEditor
        item={item}
        settingOptions={microSettingMembershipOptions}
        onParticipationChange={(value) => edit(kind, item.id, 'focalParticipation', value)}
        onSettingNodeIdsChange={(value) => edit(kind, item.id, 'settingNodeIds', value)}
      />}
      {pathwayIssue && <p className="candidate-validation" role="status">{pathwayIssue}</p>}
      {kind === 'edges' && item.scale === 'micro' && <div className="candidate-endpoints">
        <Field label="From"><select aria-label="Connection source" value={item.source} onChange={event => edit(kind, item.id, 'source', event.target.value)}>{endpointOptions(availableMicroEndpoints, item.source).map(node => <option key={node.id} value={node.id}>{node.needsRepair ? 'Removed: ' : ''}{node.label}</option>)}</select></Field>
        <Field label="To"><select aria-label="Connection target" value={item.target} onChange={event => edit(kind, item.id, 'target', event.target.value)}>{endpointOptions(availableMicroEndpoints, item.target).map(node => <option key={node.id} value={node.id}>{node.needsRepair ? 'Removed: ' : ''}{node.label}</option>)}</select></Field>
      </div>}
      {kind === 'nodes' && scopeRow && <div className="scope-editor" aria-label={mesoLinkageRow ? `Micro settings included in ${item.label}` : `Map items affected by ${item.label}`}>
        {structureRow && <div className="scope-editor__mode"><label><span>Effect</span><select aria-label={`How ${item.label} affects map items`} value={SCALE_VERB_LEXICONS.macrosphere.includes(item.deontic) ? item.deontic : 'shapes'} onChange={(event) => edit(kind, item.id, 'deontic', event.target.value)}>{SCALE_VERB_LEXICONS.macrosphere.map((verb) => <option key={verb}>{verb}</option>)}</select></label></div>}
        <div className="scope-editor__members">
          {(item.scopeNodeIds || []).map((memberId) => {
            const member = liveMapNodeById.get(memberId);
            if (!member) return null;
            return <button key={memberId} type="button" className="scope-chip" onClick={() => editScope(item.id, memberId, false)} aria-label={mesoLinkageRow ? `Remove ${member.label} from ${item.label}` : `Remove ${member.label} from map items affected by ${item.label}`}>{member.label}<span aria-hidden="true"> ×</span></button>;
          })}
          {scopeCandidates.some((node) => !(item.scopeNodeIds || []).includes(node.id))
            ? <select className="scope-editor__add" aria-label={mesoLinkageRow ? `Add a Micro setting to ${item.label}` : `Add a map item affected by ${item.label}`} value="" onChange={(event) => { if (event.target.value) editScope(item.id, event.target.value, true); }}>
              <option value="">{mesoLinkageRow ? 'Add Micro setting…' : 'Add map item…'}</option>
              {scopeCandidates.filter((node) => !(item.scopeNodeIds || []).includes(node.id)).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
            </select>
            : null}
          {(item.scopeNodeIds || []).length < 2 && <span className="scope-editor__empty">{mesoLinkageRow ? 'Choose at least two Micro settings.' : `Choose at least two map items this condition ${SCALE_VERB_LEXICONS.macrosphere.includes(item.deontic) ? item.deontic : 'shapes'}.`}</span>}
        </div>
      </div>}
      {kind === 'nodes' && mesoLinkageRow && <Field label="Interaction" hint="Coordination or conflict the memo supports."><textarea rows="3" maxLength={PROJECT_LIMITS.noteText} value={item.mesoExplanation || ''} onChange={(event) => edit(kind, item.id, 'mesoExplanation', event.target.value)} /></Field>}
      <details className="candidate-note candidate-evidence">
        <summary>{item.evidence ? 'Evidence added' : 'Evidence or question'}</summary>
        <Field label="Evidence or question"><textarea maxLength={PROJECT_LIMITS.noteText} rows="3" value={item.evidence || ''} onChange={(event) => edit(kind, item.id, 'evidence', event.target.value)} /></Field>
      </details>
      <details className="candidate-note">
        <summary>{item.notes ? 'Annotation added' : 'Annotation'}</summary>
        <Field label="Annotation"><input maxLength={PROJECT_LIMITS.noteText} value={item.notes || ''} onChange={(event) => edit(kind, item.id, 'notes', event.target.value)} /></Field>
      </details>
      </Disclosure>
      {item.evidence && <blockquote className="decision-evidence">{item.evidence}</blockquote>}
    </div>
    <div className="candidate-actions" aria-label={`Decision for ${kind === 'nodes' ? item.label : relationshipDescription(item)}`}>
      <button className={item.status === 'confirmed' ? 'is-active' : ''} type="button" disabled={Boolean(pathwayIssue)} onClick={() => setStatus(kind, item.id, 'confirmed')}>Add to map</button>
      {project.instructor.allowResearchLeads && <button className={item.status === 'research lead' ? 'is-active' : ''} type="button" disabled={Boolean(pathwayIssue)} onClick={() => setStatus(kind, item.id, 'research lead')}>Set aside</button>}
      <button className={item.status === 'rejected' ? 'is-active' : ''} type="button" onClick={() => setStatus(kind, item.id, 'rejected')}>Remove</button>
    </div>
  </article>;
  });
  const decisionStep = step === 'nodes' || step === 'edges';
  const visibleCandidateIndex = Math.min(candidateIndex, Math.max(0, (activeCandidates[step]?.length || 1) - 1));
  const showList = project.stage >= 2 || activeCandidates.nodes.length > 0 || activeCandidates.edges.length > 0;
  return <div className="suggestions-panel">
    <SuggestionsReview project={project} update={update} reviewBusy={reviewBusy} reviewProgress={reviewProgress} reviewFailure={reviewFailure} retryPending={retryPending} onGenerate={onGenerate} />
    {project.preflight?.memoReview && <details className="notebook-refresh"><summary>Update suggestions</summary><Action variant="ghost" disabled={Boolean(refreshBusy) || Boolean(reviewBusy) || retryPending} onClick={project.stage >= 2 ? onRefreshCandidates : onGenerate}>{refreshBusy || reviewBusy ? 'Updating…' : 'Reread memo'}</Action></details>}
    {showList && <>
    {candidateSteps.length > 1 && <label className="field notebook-suggestion-type"><span className="sr-only">Suggestion type</span><select value={step} onChange={(event) => setStep(event.target.value)}>{candidateSteps.map((id) => <option key={id} value={id}>{stepCopy[id].tab}</option>)}</select></label>}
    {project.activeScale === 'meso' && <details className="carried-node-summary" aria-labelledby="carried-nodes-title">
      <summary id="carried-nodes-title">Micro items</summary>
      {carriedNodes.length ? <div className="connection-node-list" aria-label="Micro-level items available for connections">{carriedNodes.map((node) => <span key={node.id}>{node.label}</span>)}</div> : <p className="empty-message">Add people and settings at Micro to begin connecting them here.</p>}
    </details>}
    <div id="candidate-panel">
      {decisionStep && <>
        {counts[step].total > 1 && <nav className="notebook-candidate-nav" aria-label="Suggestion navigation"><button type="button" disabled={visibleCandidateIndex === 0} onClick={() => setCandidateIndex(visibleCandidateIndex - 1)}>Previous suggestion</button><span>{visibleCandidateIndex + 1} / {counts[step].total}</span><button type="button" disabled={visibleCandidateIndex + 1 >= counts[step].total} onClick={() => setCandidateIndex(visibleCandidateIndex + 1)}>Next suggestion</button></nav>}
        <div className="candidate-list">
          {candidateRows(step, activeCandidates[step].slice(visibleCandidateIndex, visibleCandidateIndex + 1), visibleCandidateIndex)}
          {!counts[step].total && <p className="empty-message">{step === 'nodes'
            ? project.activeScale === 'exosphere'
              ? 'No suggestions. Add a decision setting below.'
              : project.activeScale === 'meso'
                ? 'No suggestions. Add one below.'
              : project.activeScale === 'macrosphere'
                ? 'No suggestions. Add a condition below.'
                : 'No suggestions. Revise the memo and reread it, or add items on the map.'
            : project.activeScale === 'exosphere'
              ? 'None yet. Ask for suggestions or add one on the map.'
              : 'None yet. Ask for suggestions or add one on the map.'}</p>}
        </div>
      {step === 'nodes' && project.activeScale === 'meso' && <Disclosure title="Add mesosystem" className="manual-addition"><section className="elicitation-panel" aria-labelledby="add-meso-linkage-title">
          <h2 id="add-meso-linkage-title">New mesosystem</h2>
          <p className="lede">Connect at least two Micro settings</p>
          <div className="elicitation-panel__form">
            <Field label="Name"><input maxLength={NODE_LABEL_LIMIT} value={mesoDraft.label} placeholder="e.g. Work–college scheduling conflict" onChange={(event) => setMesoDraft((current) => ({ ...current, label: event.target.value }))} /></Field>
            <Field label="Setting 1"><select value={mesoDraft.first} onChange={(event) => setMesoDraft((current) => ({ ...current, first: event.target.value }))}><option value="">Choose a Micro setting…</option>{mesoSettingNodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field>
            <Field label="Setting 2"><select value={mesoDraft.second} onChange={(event) => setMesoDraft((current) => ({ ...current, second: event.target.value }))}><option value="">Choose a different Micro setting…</option>{mesoSettingNodes.filter((node) => node.id !== mesoDraft.first).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field>
            <Field label="Interaction" hint="Coordination or conflict the memo supports."><textarea rows="3" maxLength={PROJECT_LIMITS.noteText} value={mesoDraft.explanation} onChange={(event) => setMesoDraft((current) => ({ ...current, explanation: event.target.value }))} /></Field>
            <button className="button" type="button" onClick={addMesoLinkage}>Add mesosystem</button>
          </div>
        </section></Disclosure>}
      {step === 'nodes' && project.activeScale === 'exosphere' && <Disclosure title="Add decision setting" className="manual-addition"><section className="elicitation-panel" aria-labelledby="add-institution-title">
          <h2 id="add-institution-title">New decision setting</h2>
          <p className="lede">Identify an outside decision affecting a Micro setting or another outside office</p>
          <div className="elicitation-panel__form">
            <Field label="Name"><input maxLength={NODE_LABEL_LIMIT} value={institutionDraft.label} placeholder="e.g. NYS OPWDD or MTA Access-A-Ride" onChange={(event) => setInstitutionDraft((current) => ({ ...current, label: event.target.value }))} /></Field>
            <Field label="Type"><select value={institutionDraft.type} onChange={(event) => setInstitutionDraft((current) => ({ ...current, type: event.target.value }))}>{EXOSPHERE_NODE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></Field>
            <Field label="Pathway"><select aria-label="How the decision reaches its recipient" value={institutionDraft.verb} onChange={(event) => setInstitutionDraft((current) => ({ ...current, verb: event.target.value }))}>{SCALE_VERB_LEXICONS.exosphere.map((verb) => <option key={verb}>{verb}</option>)}</select></Field>
            <Field label="Affects"><select aria-label="Setting or office affected by decision" value={institutionDraft.anchor} onChange={(event) => setInstitutionDraft((current) => ({ ...current, anchor: event.target.value }))}><option value="">Choose a Micro setting or outside office…</option>{[...mesoSettingNodes, ...acceptedExosphereNodes].map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field>
            <button className="button" type="button" onClick={addInstitution}>Add setting</button>
          </div>
        </section></Disclosure>}
        {step === 'nodes' && project.activeScale === 'macrosphere' && <Disclosure title="Add condition" className="manual-addition"><section className="elicitation-panel" aria-labelledby="add-structure-title">
          <h2 id="add-structure-title">New condition</h2>
          <p className="lede">Identify a condition affecting at least two map items</p>
          <div className="elicitation-panel__form">
            <Field label="Name"><input maxLength={NODE_LABEL_LIMIT} value={structureDraft.label} placeholder="e.g. ADA, housing costs" onChange={(event) => setStructureDraft((current) => ({ ...current, label: event.target.value }))} /></Field>
            <Field label="Type"><select value={structureDraft.type} onChange={(event) => setStructureDraft((current) => ({ ...current, type: event.target.value }))}>{MACRO_STRUCTURE_KINDS.map((type) => <option key={type}>{type}</option>)}</select></Field>
            <Field label="Effect"><select value={structureDraft.deontic} onChange={(event) => setStructureDraft((current) => ({ ...current, deontic: event.target.value }))}>{SCALE_VERB_LEXICONS.macrosphere.map((verb) => <option key={verb}>{verb}</option>)}</select></Field>
            <Field label="Evidence"><textarea maxLength={PROJECT_LIMITS.noteText} rows="3" value={structureDraft.evidence} onChange={(event) => setStructureDraft((current) => ({ ...current, evidence: event.target.value }))} /></Field>
            <button className="button" type="button" onClick={addStructure}>Add condition</button>
          </div>
        </section></Disclosure>}
      </>}
      {step === 'suggest' && <><h3>{stepCopy.suggest.title}</h3><ConnectionStage project={project} prompt={prompt} onPromptChange={onPromptChange} busy={busy} suggestions={suggestions} onSuggest={onSuggest} onEdit={onEdit} onDecision={onDecision} onHighlight={onHighlight} /></>}
    </div>
    </>}
  </div>;
}

const GRAPH_WIDTH = 840;
const GRAPH_HEIGHT = 540;
const PHONE_GRAPH_VIEWBOX = Object.freeze({ x: 0, y: -430, width: 840, height: 1400 });
// The visible window stays 840x540; nodes may live and move in a larger world
// so maps with many cards are not forced to overlap inside one screen.
const WORLD_WIDTH = 3200;
const WORLD_HEIGHT = 2400;
const ECOLOGY_CENTER = Object.freeze({ x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 });
const SPATIAL_SCALES = SCALE_ORDER.filter((scale) => scale !== 'meso');
const ECOLOGY_BANDS = Object.freeze({
  micro: Object.freeze({ innerRx: 0, innerRy: 0, outerRx: 600, outerRy: 420 }),
  exosphere: Object.freeze({ innerRx: 600, innerRy: 420, outerRx: 910, outerRy: 650 }),
  macrosphere: Object.freeze({ innerRx: 910, innerRy: 650, outerRx: 1230, outerRy: 910 }),
});
// Phone maps keep the same nested-level grammar but use a portrait-scaled
// geometry. Reusing the desktop radii made an All layers overview technically
// complete yet unreadable because fitting four desktop rings reduced labels
// to only a few physical pixels.
const PHONE_ECOLOGY_BANDS = Object.freeze({
  micro: Object.freeze({ innerRx: 0, innerRy: 0, outerRx: 300, outerRy: 380 }),
  exosphere: Object.freeze({ innerRx: 300, innerRy: 380, outerRx: 410, outerRy: 500 }),
  macrosphere: Object.freeze({ innerRx: 410, innerRy: 500, outerRx: 520, outerRy: 620 }),
});

const COMPACT_PHONE_ECOLOGY_NODE_LIMIT = 12;
const ECOLOGY_ZOOM_EXPANSION_MAX = 12;

const measuredBandCache = new Map();
function ecologyBands(phoneLayout = false, nodeCount = 0, nodes = []) {
  const baseline = phoneLayout && nodeCount <= COMPACT_PHONE_ECOLOGY_NODE_LIMIT ? PHONE_ECOLOGY_BANDS : ECOLOGY_BANDS;
  if (!nodes.length) return baseline;
  const measured = nodes.map(node => ({ scale: node.scale, ...mapNodeGeometry(node.label, phoneLayout) }));
  const key = JSON.stringify([phoneLayout, nodeCount, measured.map(({ scale, cardWidth, cardHeight }) => [scale, cardWidth, cardHeight])]);
  if (measuredBandCache.has(key)) return measuredBandCache.get(key);
  const bands = {};
  for (const scale of SPATIAL_SCALES) {
    const original = baseline[scale];
    const previous = bands[SPATIAL_SCALES[SPATIAL_SCALES.indexOf(scale) - 1]];
    const band = {
      innerRx: previous?.outerRx || 0, innerRy: previous?.outerRy || 0,
      outerRx: (previous?.outerRx || 0) + original.outerRx - original.innerRx,
      outerRy: (previous?.outerRy || 0) + original.outerRy - original.innerRy,
    };
    const cards = measured.filter(node => node.scale === scale);
    // A thin portrait annulus may not have room for even one complete card.
    // Allocate enough world space before projecting; never let an impossible
    // constraint spill a label/card over either neighboring level.
    const capacityCards = cards.map((card, index) => ({
      id: `capacity-${scale}-${index}`, scale, ...ECOLOGY_CENTER,
      width: card.cardWidth, height: card.cardHeight,
    }));
    const hasCapacity = () => {
      if (cards.some(card => !projectRectangleToRing(ECOLOGY_CENTER, {
        width: card.cardWidth, height: card.cardHeight, center: ECOLOGY_CENTER, band, boundaryPadding: 20,
      }))) return false;
      return capacityCards.length < 2 || resolveRingConstrainedCollisions(capacityCards, {
        center: ECOLOGY_CENTER, bands: { [scale]: band },
        padding: phoneLayout ? 18 : 14, boundaryPadding: 20,
      }).converged;
    };
    while (!hasCapacity()) {
      band.outerRx += 16;
      band.outerRy += 16;
    }
    bands[scale] = band;
  }
  if (measuredBandCache.size >= 32) measuredBandCache.delete(measuredBandCache.keys().next().value);
  measuredBandCache.set(key, bands);
  return bands;
}

// The explicit zoom buttons can also allocate more or less world space to the
// ecological rings. Pointer-centered wheel and pinch gestures remain a pure,
// conventional camera operation; the deliberate minus/plus controls adjust
// the layout only after a click. Cards keep the normal camera-scaled text size
// while their centers and ring contours stay in the same semantic annulus.
function resizedEcologyRingExpansion(currentExpansion, currentZoom, nextZoom) {
  if (!Number.isFinite(currentZoom) || !Number.isFinite(nextZoom) || currentZoom <= 0 || nextZoom <= 0 || currentZoom === nextZoom) return currentExpansion;
  const visibleChange = nextZoom < currentZoom ? 1.035 : .965;
  return clamp(currentExpansion * (currentZoom / nextZoom) * visibleChange, 1, ECOLOGY_ZOOM_EXPANSION_MAX);
}

function expandEcologyPosition(position, expansion = 1) {
  if (!position || expansion === 1) return position;
  return {
    x: ECOLOGY_CENTER.x + (position.x - ECOLOGY_CENTER.x) * expansion,
    y: ECOLOGY_CENTER.y + (position.y - ECOLOGY_CENTER.y) * expansion,
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function stateClass(value) {
  return value === 'retired' ? 'retired' : 'current';
}

function mapNodeGeometry(label, phoneLayout = false) {
  const cardWidth = phoneLayout ? 272 : 224;
  const fontSize = phoneLayout ? 26 : 18;
  const lines = wrapMapText(String(label || '').trim() || 'Untitled', cardWidth - (phoneLayout ? 32 : 28), { fontSize, fontWeight: 750 });
  const lineHeight = phoneLayout ? 30 : 22;
  const minimumHeight = phoneLayout ? 90 : 72;
  const cardHeight = Math.max(minimumHeight, lines.length * lineHeight + (phoneLayout ? 28 : 24));
  return {
    lines,
    fontSize,
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
  const maximumWidth = phoneLayout ? 310 : (emphasizeMeso ? 280 : 240);
  const horizontalPadding = phoneLayout ? 30 : 24;
  const fontWeight = scale === 'meso' ? 700 : 400;
  const lines = wrapMapText(label, maximumWidth - horizontalPadding, { fontSize, fontWeight });
  const lineHeight = emphasizeMeso ? (phoneLayout ? 34 : 29) : (phoneLayout ? 28 : 22);
  const longestLine = Math.max(...lines.map(line => measureMapText(line, fontSize, fontWeight)));
  const width = clamp(
    longestLine + horizontalPadding,
    emphasizeMeso ? (phoneLayout ? 140 : 96) : (phoneLayout ? 110 : 88),
    maximumWidth,
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

// A visible relationship label needs a real corridor between its endpoint
// cards. Keep a dragged endpoint far enough from every connected card to hold
// the complete, untruncated label while preserving the requested direction of
// movement whenever the map bounds allow it.
function relationshipSafeNodePosition(movingNode, requestedX, requestedY, nodes, edges, phoneLayout = false, mapMode = 'network', sharedBands = null) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const movingGeometry = mapNodeGeometry(movingNode.label, phoneLayout);
  const incidentEdges = edges.filter((edge) => edge.showLabel !== false
    && (edge.source === movingNode.id || edge.target === movingNode.id));
  const constrain = (candidate) => {
    if (mapMode === 'ecology') return constrainToEcologyBand(
      movingNode, candidate.x, candidate.y, movingGeometry, phoneLayout, nodes.length, sharedBands,
    );
    const bounded = {
      x: clamp(Math.round(candidate.x), movingGeometry.cardWidth / 2 + 8, WORLD_WIDTH - movingGeometry.cardWidth / 2 - 8),
      y: clamp(Math.round(candidate.y), movingGeometry.cardHeight / 2 + 8, WORLD_HEIGHT - movingGeometry.cardHeight / 2 - 8),
    };
    return bounded;
  };
  let position = constrain({ x: requestedX, y: requestedY });
  if (phoneLayout && mapMode === 'network') {
    // Phone overviews retain a shared Micro/Meso arrangement. Keep movement
    // on the user's requested path; connection labels route around the cards.
    const obstacles = nodes.filter(node => node.id !== movingNode.id)
      .map(node => ecologyCardBounds(node, mapNodeGeometry(node.label, phoneLayout), 8));
    const clearsCards = (candidate) => !obstacles.some(bounds => ecologyBoundsIntersect(
      ecologyCardBounds(candidate, movingGeometry, 0), bounds,
    ));
    if (clearsCards(position) || !clearsCards(movingNode)) return position;
    let low = 0;
    let high = 1;
    for (let step = 0; step < 16; step += 1) {
      const progress = (low + high) / 2;
      const candidate = { x: movingNode.x + (position.x - movingNode.x) * progress, y: movingNode.y + (position.y - movingNode.y) * progress };
      if (clearsCards(candidate)) low = progress;
      else high = progress;
    }
    return { x: Math.round(movingNode.x + (position.x - movingNode.x) * low), y: Math.round(movingNode.y + (position.y - movingNode.y) * low) };
  }
  for (let pass = 0; pass < Math.max(1, incidentEdges.length * 2); pass += 1) {
    let changed = false;
    incidentEdges.forEach((edge) => {
      const otherId = edge.source === movingNode.id ? edge.target : edge.source;
      const otherNode = nodeById.get(otherId);
      if (!otherNode) return;
      const otherGeometry = mapNodeGeometry(otherNode.label, phoneLayout);
      let deltaX = position.x - otherNode.x;
      let deltaY = position.y - otherNode.y;
      let distance = Math.hypot(deltaX, deltaY);
      if (distance < 1) {
        deltaX = movingNode.x - otherNode.x || 1;
        deltaY = movingNode.y - otherNode.y;
        distance = Math.max(1, Math.hypot(deltaX, deltaY));
      }
      const unit = { x: deltaX / distance, y: deltaY / distance };
      const labelGeometry = mapEdgeLabelGeometry(relationshipMapLabel(edge), phoneLayout, edge.scale);
      const projectedMovingHalf = movingGeometry.cardWidth / 2 * Math.abs(unit.x)
        + movingGeometry.cardHeight / 2 * Math.abs(unit.y);
      const projectedOtherHalf = otherGeometry.cardWidth / 2 * Math.abs(unit.x)
        + otherGeometry.cardHeight / 2 * Math.abs(unit.y);
      const projectedLabelHalf = labelGeometry.width / 2 * Math.abs(unit.x)
        + labelGeometry.height / 2 * Math.abs(unit.y);
      const requiredDistance = projectedMovingHalf + projectedOtherHalf + projectedLabelHalf * 2 + (phoneLayout ? 36 : 24);
      if (distance >= requiredDistance - 1) return;
      const requested = { x: requestedX, y: requestedY };
      const alternatives = [1, -1].map((direction) => constrain({
        x: otherNode.x + unit.x * requiredDistance * direction,
        y: otherNode.y + unit.y * requiredDistance * direction,
      }));
      const valid = alternatives.filter((candidate) => Math.hypot(candidate.x - otherNode.x, candidate.y - otherNode.y) >= requiredDistance - 1);
      position = (valid.length ? valid : alternatives)
        .sort((left, right) => Math.hypot(left.x - requested.x, left.y - requested.y) - Math.hypot(right.x - requested.x, right.y - requested.y))[0];
      changed = true;
    });
    if (!changed) break;
  }
  return position;
}

function cardConnectionPoint(from, toward, geometry, padding = 0) {
  const deltaX = toward.x - from.x;
  const deltaY = toward.y - from.y;
  const absoluteX = Math.max(.001, Math.abs(deltaX));
  const absoluteY = Math.max(.001, Math.abs(deltaY));
  const factor = Math.min(
    1,
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
function ecologyCalloutAnchors(edges, nodes, positions, phoneLayout, sharedBands = null) {
  const anchors = new Map();
  const groups = new Map();
  const bands = sharedBands || ecologyBands(phoneLayout, nodes.length, nodes);
  edges.forEach((edge) => {
    const band = bands[edge.scale];
    if (!band || edge.scale === 'micro') return;
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) return;
    const group = groups.get(edge.scale) || [];
    group.push({ edge, source, target, index: group.length });
    groups.set(edge.scale, group);
  });
  groups.forEach((group, scale) => {
    const band = bands[scale];
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
      const geometry = mapEdgeLabelGeometry(relationshipMapLabel(edge), phoneLayout, edge.scale);
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

function arrangedEcologyPositions(nodes, phoneLayout = false, sharedBands = null) {
  nodes = nodes.filter((node) => node.scale !== 'meso');
  const positions = new Map();
  const bands = sharedBands || ecologyBands(phoneLayout, nodes.length, nodes);
  const compactPhoneOverview = phoneLayout
    && nodes.length <= COMPACT_PHONE_ECOLOGY_NODE_LIMIT
    && new Set(nodes.map((node) => node.scale)).size > 1;
  SCALE_ORDER.forEach((scale) => {
    const band = bands[scale];
    if (!band) return;
    const items = nodes.filter((node) => node.scale === scale)
      .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
    if (scale === 'micro' && items.length === 1) {
      positions.set(items[0].id, { ...ECOLOGY_CENTER });
      return;
    }
    if (scale === 'micro') {
      // A tall one-column Micro stack pushes sparse outer levels to opposite
      // poles and forces the phone fit to shrink every label. Four or more
      // cards use two measured columns within the same constrained ellipse.
      const columns = Math.min(compactPhoneOverview && items.length < 4 ? 1 : (phoneLayout ? 2 : 3), items.length);
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
          positions.set(node.id, constrainToEcologyBand(node, rawPosition.x, rawPosition.y, mapNodeGeometry(node.label, phoneLayout), phoneLayout, nodes.length, bands));
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
      const baseRy = band.innerRy ? (band.innerRy + band.outerRy) / 2 : band.outerRy * .58;
      const angle = compactPhoneOverview
        // Pack sparse outer levels into one portrait sector. At the north
        // pole their shorter card heights fit the thin measured annuli; a
        // left/right sector would need a full card-width radial expansion.
        ? -Math.PI / 2
        : 0;
      const rawPosition = {
        x: Math.round(ECOLOGY_CENTER.x + Math.cos(angle) * baseRx),
        y: Math.round(ECOLOGY_CENTER.y + Math.sin(angle) * baseRy),
      };
      positions.set(node.id, constrainToEcologyBand(node, rawPosition.x, rawPosition.y, mapNodeGeometry(node.label, phoneLayout), phoneLayout, nodes.length, bands));
      return;
    }
    const readableSector = items.length <= 6;
    const sectorSweep = Math.min(1.35, Math.max(.55, (items.length - 1) * .34));
    items.forEach((node, index) => {
      // Keep each filtered outer layer in a readable right-hand sector. The
      // Keep the layer's nodes and their inward connections together instead
      // of scattering them to opposite sides of the ring. Fit map follows
      // these semantic items and may crop unused ring contours.
      const angle = readableSector
        ? (-sectorSweep / 2) + (index / Math.max(1, items.length - 1)) * sectorSweep
        : (-Math.PI / 2) + ((index + .5) / items.length) * Math.PI * 2;
      const baseRx = band.innerRx ? (band.innerRx + band.outerRx) / 2 : band.outerRx * .58;
      const baseRy = band.innerRy ? (band.innerRy + band.outerRy) / 2 : band.outerRy * .58;
      const rawPosition = {
        x: Math.round(ECOLOGY_CENTER.x + Math.cos(angle) * baseRx),
        y: Math.round(ECOLOGY_CENTER.y + Math.sin(angle) * baseRy),
      };
      positions.set(node.id, constrainToEcologyBand(node, rawPosition.x, rawPosition.y, mapNodeGeometry(node.label, phoneLayout), phoneLayout, nodes.length, bands));
    });
  });
  // The first pass gives each scale a legible pedagogical pattern. Preserve it
  // exactly when the complete cards already clear one another; this retains
  // the intentionally compact phone overview. Otherwise, a second measured
  // pass resolves collisions while keeping every rectangle inside its assigned
  // ecological ring. Labels remain untouched and results are deterministic.
  const positionedNodes = nodes.map((node) => {
    const geometry = mapNodeGeometry(node.label, phoneLayout);
    return {
      ...node,
      ...(positions.get(node.id) || { x: node.x, y: node.y }),
      width: geometry.cardWidth,
      height: geometry.cardHeight,
    };
  });
  const fitsBand = (node, position = node) => rectangleFitsRing(position, {
    width: node.width, height: node.height, center: ECOLOGY_CENTER, band: bands[node.scale], boundaryPadding: 16,
  });
  if (!mapNodesOverlap(positionedNodes, phoneLayout) && positionedNodes.every(node => fitsBand(node))) return positions;
  const resolved = resolveRingConstrainedCollisions(positionedNodes, {
    center: ECOLOGY_CENTER,
    bands,
    padding: phoneLayout ? 18 : 14,
    boundaryPadding: 16,
  }).positions;
  return new Map(positionedNodes.map(node => {
    const requested = resolved.get(node.id);
    const position = fitsBand(node, requested) ? requested : projectRectangleToRing(requested, {
      width: node.width, height: node.height, center: ECOLOGY_CENTER, band: bands[node.scale], boundaryPadding: 16,
    });
    if (!position) throw new Error(`The measured ${node.scale} band cannot fit its card.`);
    return [node.id, position];
  }));
}

function ecologyLayerLabelPlacement(scale, phoneLayout = false, nodeCount = 0, ringExpansion = 1, occupiedBounds = [], visibleBounds = null, sharedBands = null) {
  const band = (sharedBands || ecologyBands(phoneLayout, nodeCount))[scale];
  if (!band) return null;
  const label = SCALES[scale]?.label || scale;
  const width = Math.max(116, label.length * 10 + 34);
  const height = 36;
  const scaledBand = {
    innerRx: band.innerRx * ringExpansion,
    innerRy: band.innerRy * ringExpansion,
    outerRx: band.outerRx * ringExpansion,
    outerRy: band.outerRy * ringExpansion,
  };
  // Keep every badge inside the annulus it names. Candidate positions begin
  // on the lower/left reading path (Micro -> Meso -> Exo -> Macro), then move
  // around that same ring when a saved or arranged node occupies the preferred
  // location. The map moves the badge, never a student's saved node.
  const angleDepths = scale === 'micro'
    ? (phoneLayout
        ? [
            [Math.PI, .72], [Math.PI / 2, .82], [2.3, .72], [Math.PI * 1.5, .82],
            [0, .72], [.7, .72], [3.8, .72], [Math.PI / 2, .62],
          ]
        : [
            [Math.PI / 2, .72], [Math.PI, .72], [.5, .72], [-.5, .72],
            [0, .72], [2.3, .72], [-2.3, .72],
          ])
    : (phoneLayout
        ? [
            2, Math.PI / 2, 2.3, 1.7, Math.PI, -2, -Math.PI / 2, 0,
            // Compact portrait packing can occupy the preferred north slots.
            // Sample the same annulus deterministically before falling back
            // to a badge outside the visible semantic-content window.
            ...Array.from({ length: 96 }, (_, index) => -Math.PI + index * Math.PI / 48),
          ]
        : [.35, .5, .2, .7, -.35, -.5, 1, -1, 0, 2, Math.PI / 2, Math.PI])
      .flatMap((angle) => [.5, .44, .56, .38, .62].map((depth) => [angle, depth]));
  const boundsFor = (x, y, padding = 0) => ({
    left: x - width / 2 - padding,
    right: x + width / 2 + padding,
    top: y - height / 2 - padding,
    bottom: y + height / 2 + padding,
  });
  const belongsToBand = (bounds) => {
    const furthestX = Math.max(Math.abs(bounds.left - ECOLOGY_CENTER.x), Math.abs(bounds.right - ECOLOGY_CENTER.x));
    const furthestY = Math.max(Math.abs(bounds.top - ECOLOGY_CENTER.y), Math.abs(bounds.bottom - ECOLOGY_CENTER.y));
    const outerMetric = (furthestX / scaledBand.outerRx) ** 2 + (furthestY / scaledBand.outerRy) ** 2;
    if (outerMetric > 1) return false;
    if (!scaledBand.innerRx || !scaledBand.innerRy) return true;
    const nearestX = ECOLOGY_CENTER.x < bounds.left
      ? bounds.left - ECOLOGY_CENTER.x
      : ECOLOGY_CENTER.x > bounds.right
        ? ECOLOGY_CENTER.x - bounds.right
        : 0;
    const nearestY = ECOLOGY_CENTER.y < bounds.top
      ? bounds.top - ECOLOGY_CENTER.y
      : ECOLOGY_CENTER.y > bounds.bottom
        ? ECOLOGY_CENTER.y - bounds.bottom
        : 0;
    return (nearestX / scaledBand.innerRx) ** 2 + (nearestY / scaledBand.innerRy) ** 2 >= 1;
  };
  for (const [angle, depth] of angleDepths) {
    const radiusX = scaledBand.innerRx
      ? scaledBand.innerRx + (scaledBand.outerRx - scaledBand.innerRx) * depth
      : scaledBand.outerRx * depth;
    const radiusY = scaledBand.innerRy
      ? scaledBand.innerRy + (scaledBand.outerRy - scaledBand.innerRy) * depth
      : scaledBand.outerRy * depth;
    const x = ECOLOGY_CENTER.x + Math.cos(angle) * radiusX;
    const y = ECOLOGY_CENTER.y + Math.sin(angle) * radiusY;
    const bounds = boundsFor(x, y, 7);
    const visible = !visibleBounds || (
      bounds.left >= visibleBounds.left
      && bounds.right <= visibleBounds.right
      && bounds.top >= visibleBounds.top
      && bounds.bottom <= visibleBounds.bottom
    );
    if (!visible || !belongsToBand(bounds) || occupiedBounds.some((occupied) => ecologyBoundsIntersect(bounds, occupied))) continue;
    return { label, width, height, x, y };
  }
  // The first candidate is guaranteed to remain associated with this scale;
  // dense maps may crop a decorative badge, but never silently move a node.
  const [angle, depth] = angleDepths[0];
  const radiusX = scaledBand.innerRx
    ? scaledBand.innerRx + (scaledBand.outerRx - scaledBand.innerRx) * depth
    : scaledBand.outerRx * depth;
  const radiusY = scaledBand.innerRy
    ? scaledBand.innerRy + (scaledBand.outerRy - scaledBand.innerRy) * depth
    : scaledBand.outerRy * depth;
  const position = projectRectangleToRing({
    x: ECOLOGY_CENTER.x + Math.cos(angle) * radiusX,
    y: ECOLOGY_CENTER.y + Math.sin(angle) * radiusY,
  }, { width: width + 14, height: height + 14, center: ECOLOGY_CENTER, band: scaledBand, boundaryPadding: 0 });
  return position ? { label, width, height, ...position } : null;
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
    const geometry = mapEdgeLabelGeometry(relationshipMapLabel(edge), phoneLayout, edge.scale);
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
    const interveningNodeBounds = [...nodeBounds.entries()]
      .filter(([id, bounds]) => bounds && id !== edge.source && id !== edge.target)
      .map(([, bounds]) => bounds);
    const routeIsClear = (candidate) => (
      !segmentCrossesBoundsInterior(source, candidate, targetBounds)
      && !segmentCrossesBoundsInterior(candidate, target, sourceBounds)
      && !interveningNodeBounds.some((bounds) => (
        segmentCrossesBoundsInterior(source, candidate, bounds)
        || segmentCrossesBoundsInterior(candidate, target, bounds)
      ))
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
  const routeKinds = new Map();
  const fallbackIds = new Set();
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
    const geometry = mapEdgeLabelGeometry(relationshipMapLabel(edge), phoneLayout, edge.scale);
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
  const routeAroundCards = (start, end, obstacles) => {
    if (!crossesAny(start, end, obstacles)) return [start, end];
    const corners = obstacles.flatMap(bounds => [
      { x: bounds.left - 1, y: bounds.top - 1 }, { x: bounds.right + 1, y: bounds.top - 1 },
      { x: bounds.left - 1, y: bounds.bottom + 1 }, { x: bounds.right + 1, y: bounds.bottom + 1 },
    ]).filter(point => !obstacles.some(bounds => point.x > bounds.left && point.x < bounds.right
      && point.y > bounds.top && point.y < bounds.bottom));
    const points = [start, end, ...corners];
    const distances = points.map(() => Infinity);
    const previous = points.map(() => -1);
    const visited = new Set();
    distances[0] = 0;
    for (let step = 0; step < points.length; step += 1) {
      let current = -1;
      for (let index = 0; index < points.length; index += 1) {
        if (!visited.has(index) && Number.isFinite(distances[index])
          && (current === -1 || distances[index] < distances[current])) current = index;
      }
      if (current === -1) break;
      if (current === 1) {
        const route = [];
        for (let index = 1; index !== -1; index = previous[index]) route.unshift(points[index]);
        return route;
      }
      visited.add(current);
      for (let next = 0; next < points.length; next += 1) {
        if (visited.has(next) || crossesAny(points[current], points[next], obstacles)) continue;
        const distance = distances[current] + Math.hypot(points[next].x - points[current].x, points[next].y - points[current].y);
        if (distance < distances[next]) { distances[next] = distance; previous[next] = current; }
      }
    }
    return [start, end];
  };
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
    routeKinds.set(edge.id, 'between-endpoints');
    occupiedLabels.push(calloutBounds(roundedAnchor, geometry, phoneLayout ? 10 : 7));
    occupiedSegments.push([roundedSource, roundedAnchor], [roundedAnchor, roundedTarget]);
  });
  if (unplaced.size) {
    // Keep saved node positions fixed. When direct lanes are occupied, route
    // the connection through the nearest clear label position.
    const fallbackEdges = edges.filter((edge) => unplaced.has(edge.id));
    fallbackEdges.forEach((edge) => {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      const sourceNode = nodes.find((node) => node.id === edge.source);
      const targetNode = nodes.find((node) => node.id === edge.target);
      if (!source || !target || !sourceNode || !targetNode) return;
      const midpoint = { x: Math.round((source.x + target.x) / 2), y: Math.round((source.y + target.y) / 2) };
      const geometry = mapEdgeLabelGeometry(relationshipMapLabel(edge), phoneLayout, edge.scale);
      const clear = (candidate) => {
        const candidateBounds = calloutBounds(candidate, geometry, phoneLayout ? 12 : 8);
        return ![...nodeBounds.values()].filter(Boolean).some(bound => ecologyBoundsIntersect(candidateBounds, bound))
          && !occupiedLabels.some(bound => ecologyBoundsIntersect(candidateBounds, bound));
      };
      let anchor = midpoint;
      if (!clear(anchor)) {
        const candidates = [];
        for (let radius = 1; radius <= nodes.length + edges.length + 8; radius += 1) {
          for (let step = 0; step < 16; step += 1) {
            const angle = step * Math.PI / 8;
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const distance = Math.max(1, Math.hypot(dx, dy));
            const along = clamp(Math.cos(angle) * radius * 48, -distance * .4, distance * .4);
            const offset = Math.sin(angle) * radius * 48;
            const candidate = { x: Math.round(midpoint.x + dx / distance * along - dy / distance * offset), y: Math.round(midpoint.y + dy / distance * along + dx / distance * offset) };
            if (clear(candidate)) candidates.push(candidate);
          }
          if (candidates.length) break;
        }
        const cards = [...nodeBounds.values()].filter(Boolean);
        const left = Math.min(...cards.map(card => card.left));
        const right = Math.max(...cards.map(card => card.right));
        const preferVerticalCallout = phoneLayout && edge.scale === 'meso' && nodes.length > 2;
        if (preferVerticalCallout) {
          // A side callout widens the phone fit and shrinks every card. Offer
          // clear space above/below the grid while keeping the node positions.
          const x = clamp(midpoint.x, left + geometry.width / 2, right - geometry.width / 2);
          for (const y of [Math.min(...cards.map(card => card.top)) - geometry.height / 2 - 24,
            Math.max(...cards.map(card => card.bottom)) + geometry.height / 2 + 24]) {
            const candidate = { x, y };
            if (clear(candidate)) candidates.push(candidate);
          }
        }
        const score = candidate => Math.hypot(candidate.x - midpoint.x, candidate.y - midpoint.y)
          + (preferVerticalCallout ? 4 * (Math.max(0, left - candidate.x + geometry.width / 2) + Math.max(0, candidate.x + geometry.width / 2 - right)) : 0);
        if (candidates.length) anchor = candidates.sort((left, right) => score(left) - score(right))[0];
      }
      occupiedLabels.push(calloutBounds(anchor, geometry, phoneLayout ? 12 : 8));
      anchors.set(edge.id, anchor);
      bounds.set(edge.id, calloutBounds(anchor, geometry));
      const sourceRoute = routeAroundCards(source, anchor, [...nodeBounds.entries()]
        .filter(([id, bound]) => bound && id !== edge.source).map(([, bound]) => bound));
      const targetRoute = routeAroundCards(target, anchor, [...nodeBounds.entries()]
        .filter(([id, bound]) => bound && id !== edge.target).map(([, bound]) => bound));
      const sourcePoint = cardConnectionPoint(source, sourceRoute[1], mapNodeGeometry(sourceNode.label, phoneLayout));
      const targetPoint = cardConnectionPoint(target, targetRoute[1], mapNodeGeometry(targetNode.label, phoneLayout), phoneLayout ? 12 : 7);
      const points = [sourcePoint, ...sourceRoute.slice(1), ...targetRoute.slice(1, -1).reverse(), targetPoint];
      paths.set(edge.id, { source: sourcePoint, target: targetPoint, points });
      routeKinds.set(edge.id, 'between-endpoints-tight');
      fallbackIds.add(edge.id);
      unplaced.delete(edge.id);
    });
  }
  return { anchors, bounds, paths, routeKinds, fallbackIds, unplaced };
}

// Once a project has outer levels, its Micro work still needs to remain inside
// the Micro ring. A plain alphabetical grid can put an unrelated card directly
// between connected endpoints, leaving no honest place for the relationship
// wording. This deterministic two-column arrangement keeps connected cards on
// opposite sides when possible and reserves the middle corridor for labels.
function microRelationshipLayout(nodes, edges, phoneLayout = false, sharedBands = null) {
  if (phoneLayout || nodes.length < 2 || !edges.length) return null;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const usableEdges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  if (!usableEdges.length) return null;
  const degree = new Map(nodes.map((node) => [node.id, 0]));
  const neighbors = new Map(nodes.map((node) => [node.id, []]));
  usableEdges.forEach((edge) => {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
    neighbors.get(edge.source).push(edge.target);
    neighbors.get(edge.target).push(edge.source);
  });
  const ordered = [...nodes].sort((left, right) => (
    (degree.get(right.id) || 0) - (degree.get(left.id) || 0)
    || left.label.localeCompare(right.label)
    || left.id.localeCompare(right.id)
  ));
  const sides = [[], []];
  const sideById = new Map();
  ordered.forEach((node, index) => {
    const neighborSides = neighbors.get(node.id).map((id) => sideById.get(id)).filter((side) => side !== undefined);
    const leftConnections = neighborSides.filter((side) => side === 0).length;
    const rightConnections = neighborSides.length - leftConnections;
    const side = index === 0
      ? 0
      : leftConnections !== rightConnections
        ? (leftConnections > rightConnections ? 1 : 0)
        : (sides[0].length <= sides[1].length ? 0 : 1);
    sides[side].push(node);
    sideById.set(node.id, side);
  });
  for (const columnGap of [720, 760]) {
    for (const rowPitch of [100, 90, 112]) {
      const positions = new Map();
      sides.forEach((items, side) => items.forEach((node, index) => {
        positions.set(node.id, {
          x: Math.round(ECOLOGY_CENTER.x + (side ? 1 : -1) * columnGap / 2),
          y: Math.round(ECOLOGY_CENTER.y + (index - (items.length - 1) / 2) * rowPitch),
        });
      }));
      const insideMicro = nodes.every((node) => {
        const position = positions.get(node.id);
        const constrained = constrainWithinEcologyBand(node, position.x, position.y, mapNodeGeometry(node.label, false), false, nodes.length, sharedBands);
        return constrained.x === position.x && constrained.y === position.y;
      });
      if (!insideMicro || mapNodesOverlap(nodes.map((node) => ({ ...node, ...positions.get(node.id) })), false)) continue;
      const layout = betweenEndpointCalloutLayout(usableEdges, nodes, positions, false);
      if (!layout.unplaced.size && !layout.fallbackIds.size) return { positions, ...layout };
    }
  }
  return null;
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
  const fallbackScore = (layout) => layout.unplaced.size * 1_000 + layout.fallbackIds.size;
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
      fallback = fallbackScore(layout) < fallbackScore(fallback) ? { positions, ...layout } : fallback;
      if (!layout.unplaced.size && !layout.fallbackIds.size) return { positions, ...layout };
    }
  }
  return fallback;
}

function focusedEcologyCalloutBounds(edges, nodes, positions, phoneLayout = false) {
  const shownEdges = edges.filter((edge) => edge.showLabel !== false);
  const layout = betweenEndpointCalloutLayout(shownEdges, nodes, positions, phoneLayout);
  const bounds = [...layout.bounds.values()];
  const visuals = new Map(nodes.map(node => [node.id, {
    position: positions.get(node.id), geometry: mapNodeGeometry(node.label, phoneLayout),
  }]));
  const boundsAround = (points, padding) => {
    const present = points.filter(Boolean);
    if (!present.length) return null;
    return {
      left: Math.min(...present.map((point) => point.x)) - padding,
      right: Math.max(...present.map((point) => point.x)) + padding,
      top: Math.min(...present.map((point) => point.y)) - padding,
      bottom: Math.max(...present.map((point) => point.y)) + padding,
    };
  };
  layout.paths.forEach((path, edgeId) => {
    const route = boundsAround(path.points || [path.source, layout.anchors.get(edgeId), path.target], phoneLayout ? 16 : 12);
    if (route) bounds.push(route);
  });
  nodes.filter((node) => node.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(node.type)).forEach((setting) => {
    const members = nodes.filter((node) => node.id !== setting.id && node.scale === 'micro' && (node.settingNodeIds || []).includes(setting.id));
    if (!members.length) return;
    const region = mapRegionGeometry([setting.id, ...members.map(node => node.id)], visuals, phoneLayout ? 14 : 10);
    if (region) bounds.push(region.bounds);
  });
  nodes.filter((node) => node.scale === 'macrosphere' && node.scopeNodeIds?.length).forEach((condition) => {
    const field = mapRegionGeometry(condition.scopeNodeIds, visuals, phoneLayout ? 14 : 10);
    if (field) bounds.push(field.bounds);
  });
  return bounds;
}

function constrainWithinEcologyBand(node, x, y, geometry, phoneLayout = false, nodeCount = 0, sharedBands = null) {
  const band = (sharedBands || ecologyBands(phoneLayout, nodeCount, [node]))[node.scale];
  const position = projectRectangleToRing({ x, y }, {
    width: geometry.cardWidth, height: geometry.cardHeight, center: ECOLOGY_CENTER, band, boundaryPadding: 16,
  });
  if (!position) throw new Error(`The measured ${node.scale} band cannot fit its card.`);
  return position;
}

function constrainToEcologyBand(node, x, y, geometry, phoneLayout = false, nodeCount = 0, sharedBands = null) {
  // The badge chooses an unoccupied position inside this annulus at render
  // time. Node constraints therefore preserve the student's requested/saved
  // position and enforce only semantic ring membership.
  return constrainWithinEcologyBand(node, x, y, geometry, phoneLayout, nodeCount, sharedBands);
}

function EcologicalLayerBackdrop({ layers, visibleLayer, phoneLayout = false, nodeCount = 0, ringExpansion = 1, nodes = [], positions = new Map(), visibleBounds = null, sharedBands = null }) {
  const available = new Set(layers.filter((scale) => scale !== 'meso'));
  const bands = sharedBands || ecologyBands(phoneLayout, nodeCount, nodes);
  const occupiedBounds = nodes.map((node) => {
    const position = positions.get(node.id);
    return position ? ecologyCardBounds(position, mapNodeGeometry(node.label, phoneLayout), 8) : null;
  }).filter(Boolean);
  const placements = new Map();
  SCALE_ORDER.filter((scale) => available.has(scale) && bands[scale]).forEach((scale) => {
    const placement = ecologyLayerLabelPlacement(scale, phoneLayout, nodeCount, ringExpansion, occupiedBounds, visibleBounds, bands);
    if (!placement) return;
    placements.set(scale, placement);
    occupiedBounds.push({
      left: placement.x - placement.width / 2 - 7,
      right: placement.x + placement.width / 2 + 7,
      top: placement.y - placement.height / 2 - 7,
      bottom: placement.y + placement.height / 2 + 7,
    });
  });
  return <g className="ecology-layers" aria-hidden="true">
    {[...SCALE_ORDER].reverse().filter((scale) => available.has(scale) && bands[scale]).map((scale) => {
      const band = bands[scale];
      const placement = placements.get(scale) || ecologyLayerLabelPlacement(scale, phoneLayout, nodeCount, ringExpansion, [], null, bands);
      const label = placement?.label || SCALES[scale]?.label || scale;
      const active = visibleLayer === 'all' || visibleLayer === scale;
      const labelWidth = placement?.width || Math.max(116, label.length * 10 + 34);
      return <g key={scale} data-ecology-layer={scale} className={`ecology-layer ecology-layer--${scale} ${active ? 'is-visible' : 'is-muted'}`}>
        <ellipse cx={ECOLOGY_CENTER.x} cy={ECOLOGY_CENTER.y} rx={band.outerRx * ringExpansion} ry={band.outerRy * ringExpansion} />
        {placement && <g className="ecology-layer__label" transform={`translate(${placement.x} ${placement.y})`}>
          <rect x={-labelWidth / 2} y="-18" width={labelWidth} height="36" rx="18" />
          <text y="5">{label}</text>
        </g>}
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
  const columnPitch = 420;
  const rows = Math.ceil(orderedNodes.length / columns);
  const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(...orderedNodes
    .slice(row * columns, (row + 1) * columns)
    .map((node) => mapNodeGeometry(node.label, true).cardHeight)));
  const rowGap = 100;
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

function phoneOverviewProjection(nodes, layout) {
  // Once a student saves the phone arrangement, its graph coordinates are
  // authoritative on every device and after reload, even if spread widely.
  return layout?.phoneOverview === 'preserve' ? null : arrangedPhoneOverviewPositions(nodes);
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

// Use the same expanded boundary for phone Micro rendering and interaction.
function phoneMicroBands(bands, allNodes) {
  const nodes = allNodes.filter(node => node.scale === 'micro');
  const positions = arrangedPhoneMicroPositions(nodes);
  const halfWidth = Math.max(0, ...nodes.map(node => Math.abs(positions.get(node.id).x - ECOLOGY_CENTER.x) + mapNodeGeometry(node.label, true).cardWidth / 2));
  const halfHeight = Math.max(0, ...nodes.map(node => Math.abs(positions.get(node.id).y - ECOLOGY_CENTER.y) + mapNodeGeometry(node.label, true).cardHeight / 2));
  const dx = Math.max(0, (halfWidth + 20) * Math.SQRT2 - bands.micro.outerRx);
  const dy = Math.max(0, (halfHeight + 20) * Math.SQRT2 - bands.micro.outerRy);
  return Object.fromEntries(Object.entries(bands).map(([scale, band]) => [scale, {
    ...band, outerRx: band.outerRx + dx, outerRy: band.outerRy + dy,
    innerRx: scale === 'micro' ? 0 : band.innerRx + dx,
    innerRy: scale === 'micro' ? 0 : band.innerRy + dy,
  }]));
}

// Presentation and explicit Arrange share measured connector clearance.
function arrangedPhoneMicroPositions(nodes) {
  const ordered = [...nodes].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const rows = Array.from({ length: Math.ceil(ordered.length / 2) }, (_, row) => ordered.slice(row * 2, row * 2 + 2));
  const heights = rows.map(row => Math.max(...row.map(node => mapNodeGeometry(node.label, true).cardHeight)));
  const gap = 120;
  let y = ECOLOGY_CENTER.y - (heights.reduce((sum, height) => sum + height, 0) + gap * Math.max(0, rows.length - 1)) / 2;
  const positions = new Map();
  rows.forEach((row, index) => {
    row.forEach((node, column) => positions.set(node.id, {
      x: ECOLOGY_CENTER.x + (column - (row.length - 1) / 2) * 352,
      y: y + heights[index] / 2,
    }));
    y += heights[index] + gap;
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
  const relationshipGeometry = mapEdgeLabelGeometry(relationshipMapLabel(edge), true, edge.scale);
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
  const relationshipGeometry = mapEdgeLabelGeometry(relationshipMapLabel(edge), false, edge.scale);
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

function placeNewMapNodes(nodes, addedIds) {
  const live = nodes.filter(node => node.scale !== 'meso' && node.status !== 'rejected' && node.claimState !== 'retired');
  const existing = live.filter(node => !addedIds.has(node.id));
  const occupied = existing.map(node => ecologyCardBounds(node, mapNodeGeometry(node.label), 12));
  live.filter(node => addedIds.has(node.id)).forEach(node => {
    const geometry = mapNodeGeometry(node.label);
    const clear = position => !occupied.some(bounds => ecologyBoundsIntersect(ecologyCardBounds(position, geometry), bounds));
    const sameLevel = existing.filter(item => item.scale === node.scale);
    const preferred = sameLevel.length ? mapContentCenter(sameLevel) : node;
    // A manually added item starts near the existing items at its level.
    // A single-item default layout would otherwise send it far from the map.
    let position = preferred;
    if (!clear(position)) {
      const candidates = [];
      const pitchX = geometry.cardWidth + 24;
      const pitchY = geometry.cardHeight + 24;
      for (let row = -Math.ceil(WORLD_HEIGHT / pitchY); row <= Math.ceil(WORLD_HEIGHT / pitchY); row += 1) {
        for (let column = -Math.ceil(WORLD_WIDTH / pitchX); column <= Math.ceil(WORLD_WIDTH / pitchX); column += 1) {
          const candidate = { x: preferred.x + column * pitchX, y: preferred.y + row * pitchY };
          if (candidate.x < geometry.cardWidth / 2 + 12 || candidate.x > WORLD_WIDTH - geometry.cardWidth / 2 - 12
            || candidate.y < geometry.cardHeight / 2 + 12 || candidate.y > WORLD_HEIGHT - geometry.cardHeight / 2 - 12) continue;
          if (clear(candidate)) candidates.push(candidate);
        }
      }
      position = candidates.sort((left, right) => Math.hypot(left.x - preferred.x, left.y - preferred.y)
        - Math.hypot(right.x - preferred.x, right.y - preferred.y))[0] || position;
    }
    node.x = position.x;
    node.y = position.y;
    occupied.push(ecologyCardBounds(node, geometry, 12));
  });
}

function sharedMicroBoundary(nodes, edges, phoneLayout = false) {
  if (!nodes.length) return null;
  const positions = new Map(nodes.map(node => [node.id, { x: node.x, y: node.y }]));
  const relationships = edges.filter(edge => edge.scale === 'meso' && edge.status !== 'rejected' && edge.claimState !== 'retired'
    && positions.has(edge.source) && positions.has(edge.target)).map(edge => ({ ...edge, showLabel: true }));
  const bounds = [
    ...nodes.map(node => ecologyCardBounds(node, mapNodeGeometry(node.label, phoneLayout), 18)),
    ...focusedEcologyCalloutBounds(relationships, nodes, positions, phoneLayout),
  ];
  const left = Math.min(...bounds.map(box => box.left));
  const right = Math.max(...bounds.map(box => box.right));
  const top = Math.min(...bounds.map(box => box.top));
  const bottom = Math.max(...bounds.map(box => box.bottom));
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  // Every corner of the content rectangle fits inside this one Micro ellipse.
  // Meso routes participate in the measurement even while Micro hides arrows,
  // so moving between the two levels keeps exactly the same initial boundary.
  const rx = Math.max(180, (right - left) / 2 * Math.SQRT2 + 28);
  const ry = Math.max(120, (bottom - top) / 2 * Math.SQRT2 + 36);
  return { cx, cy, rx, ry, left: cx - rx, right: cx + rx, top: cy - ry, bottom: cy + ry };
}

function mapNeedsEcologyLayout(nodes, phoneLayout = false, sharedBands = null) {
  if (!nodes.length) return false;
  if (mapNodesOverlap(nodes, phoneLayout)) return true;
  const bands = sharedBands || ecologyBands(phoneLayout, nodes.length, nodes);
  return nodes.some((node) => {
    if (!bands[node.scale]) return true;
    const geometry = mapNodeGeometry(node.label, phoneLayout);
    return !rectangleFitsRing(node, {
      width: geometry.cardWidth, height: geometry.cardHeight,
      center: ECOLOGY_CENTER, band: bands[node.scale], boundaryPadding: 16,
    });
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

function ConnectionStage({ project, prompt, onPromptChange, busy, suggestions, onSuggest, onEdit, onDecision, onHighlight }) {
  const nodes = nodesForConnectionPrompt(project);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const carriedMicroNodeIds = new Set(project.graph.nodes
    .filter((node) => node.status !== 'rejected' && node.claimState !== 'retired' && node.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(node.type))
    .map((node) => node.id));
  const exosphereSources = nodes.filter((node) => node.scale === 'exosphere');
  const carriedMicroSettings = nodes.filter((node) => carriedMicroNodeIds.has(node.id));
  const exospherePathwayIssue = (edge) => project.activeScale === 'exosphere'
    && !isOrientedExospherePathway(nodeById.get(edge.source), nodeById.get(edge.target), carriedMicroNodeIds)
    ? 'Choose an outside decision setting and an affected Micro setting or outside office.'
    : '';
  const endpointOptions = (validNodes, currentId) => {
    const current = nodeById.get(currentId);
    return current && !validNodes.some((node) => node.id === current.id)
      ? [{ ...current, needsRepair: true }, ...validNodes]
      : validNodes;
  };
  // Connections selected at the previous step count as existing here, so the
  // preview stays continuous with the student's decisions before "Open map."
  const keptCandidateEdges = project.candidates.edges
    .filter((edge) => edge.scale === project.activeScale && (edge.status === 'confirmed' || edge.status === 'research lead') && nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const edges = [...new Map([...project.graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)), ...keptCandidateEdges]
    .map((edge) => [edge.id, edge])).values()];
  return <section className="connection-stage" aria-label="More connection suggestions">
    <p className="eyebrow">{nodes.length} selected nodes · {edges.filter((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired').length} existing connections</p>
    <div className="connection-stage__layout">
      <section className="connection-prompt-panel">
        {nodes.length < 2 && <p className="teacher-message" role="status">Add at least two nodes to the map and the model can suggest connections between them.</p>}
        <button type="button" className="button" disabled={busy || nodes.length < 2} onClick={onSuggest}>{busy ? 'Generating suggestions…' : suggestions.length ? 'Generate again' : 'Suggest connections'}</button>
        <details className="connection-hint">
          <summary>Describe a relationship (optional)</summary>
          <Field label="Describe connections between nodes">
            <textarea rows="6" maxLength="4000" value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder="For example, families ask schools for evaluations while delays make services harder to access." />
          </Field>
        </details>
        <div className="connection-node-list" aria-label="Nodes included in this request">{nodes.map((node) => <span key={node.id}>{node.label}</span>)}</div>
      </section>

    </div>
    <section className="connection-suggestions" aria-labelledby="connection-suggestions-title">
      <div className="stage-title-row"><div><p className="eyebrow">Review</p><h2 id="connection-suggestions-title">Suggested connections</h2></div></div>
      {suggestions.map((item, index) => {
        const pathwayIssue = exospherePathwayIssue(item);
        const highlight = () => onHighlight?.({ nodeIds: [item.source, item.target], edgeIds: [item.id] });
        return <article className={`candidate-row candidate-row--${item.status.replaceAll(' ', '-')}`} key={item.id} onMouseEnter={highlight} onFocus={highlight} onMouseLeave={() => onHighlight?.(null)} onBlur={() => onHighlight?.(null)}>
        <div className="candidate-row__count">{String(index + 1).padStart(2, '0')}</div>
        <div className="candidate-row__main">
          <div className="candidate-expression candidate-expression--edge connection-expression">
            <select aria-label={`Starting node for suggestion ${index + 1}`} value={item.source} onChange={(event) => onEdit(item.id, 'source', event.target.value)}>{endpointOptions(project.activeScale === 'exosphere' ? exosphereSources : nodes.filter((node) => node.id !== item.target), item.source).map((node) => <option key={node.id} value={node.id}>{node.needsRepair ? 'Needs repair: ' : ''}{node.label}</option>)}</select>
            <AutoGrowingTextarea className="relationship-verb-editor" aria-label={`Connection for suggestion ${index + 1}`} maxLength={RELATIONSHIP_VERB_LIMIT} value={item.verb} onChange={(event) => onEdit(item.id, 'verb', event.target.value)} />
            <select aria-label={`Ending node for suggestion ${index + 1}`} value={item.target} onChange={(event) => onEdit(item.id, 'target', event.target.value)}>{endpointOptions(project.activeScale === 'exosphere' ? [...carriedMicroSettings, ...exosphereSources].filter(node => node.id !== item.source) : nodes.filter((node) => node.id !== item.source), item.target).map((node) => <option key={node.id} value={node.id}>{node.needsRepair ? 'Needs repair: ' : ''}{node.label}</option>)}</select>
          </div>
          {pathwayIssue && <p className="candidate-validation" role="status">{pathwayIssue} This suggestion stays here until you repair or remove it.</p>}
          <p>{item.rationale}</p>
        </div>
        <div className="candidate-actions" aria-label={`Decision for ${relationshipDescription(item)}`} >
          <button className={item.status === 'confirmed' ? 'is-active' : ''} type="button" disabled={Boolean(pathwayIssue)} onClick={() => onDecision(item.id, 'confirmed')}>Add to map</button>
          <button className={item.status === 'rejected' ? 'is-active' : ''} type="button" onClick={() => onDecision(item.id, 'rejected')}>Remove</button>
        </div>
      </article>;
      })}
      {!suggestions.length && <p className="empty-message">No connections suggested</p>}
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

function GraphCanvas({ nodes, edges, selection, onSelect, onMoveNode, viewport, phoneLayout, phoneViewBox = PHONE_GRAPH_VIEWBOX, mapLabel, mapMode = 'network', ecologyLayers = [], ecologyBandGeometry = null, ecologyInteractionBandGeometry = null, microBoundary = null, fontRevision = 0, visibleLayer = 'all', detailMode = false, connectionMode = false, ringExpansion = 1, minimumZoom = VIEWPORT_LIMITS.minZoom, onViewportChange, onAnnounce }) {
  const sharedBands = ecologyBandGeometry || ecologyBands(phoneLayout, nodes.length, nodes);
  const interactionBands = ecologyInteractionBandGeometry || sharedBands;
  const svgRef = useRef(null);
  const regionMaskPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, '-');
  const interactionRef = useRef(null);
  const pointersRef = useRef(new Map());
  const frameRef = useRef(null);
  const wheelCommitRef = useRef(null);
  const wheelViewportRef = useRef(null);
  const liveViewportRef = useRef(viewport);
  const wheelHandlerRef = useRef(null);
  const panModifierRef = useRef(false);
  const [spacePanning, setSpacePanning] = useState(false);
  useEffect(() => {
    const release = (event) => {
      if (event.type !== 'blur' && event.key !== ' ') return;
      panModifierRef.current = false;
      setSpacePanning(false);
    };
    window.addEventListener('keyup', release);
    window.addEventListener('blur', release);
    return () => { window.removeEventListener('keyup', release); window.removeEventListener('blur', release); };
  }, []);
  const [transientNode, setTransientNode] = useState(null);
  const [transientViewport, setTransientViewport] = useState(null);
  const [pointerGesture, setPointerGesture] = useState(null);
  const shownViewport = transientViewport || viewport;
  liveViewportRef.current = shownViewport;
  const positions = useMemo(() => new Map(nodes.map((node) => [node.id, transientNode?.id === node.id ? { x: transientNode.x, y: transientNode.y } : { x: node.x, y: node.y }])), [nodes, transientNode]);
  const activeRingExpansion = mapMode === 'ecology' && !detailMode ? ringExpansion : 1;
  const renderedPositions = useMemo(() => new Map([...positions].map(([id, position]) => [
    id,
    expandEcologyPosition(position, activeRingExpansion),
  ])), [activeRingExpansion, positions]);
  useEffect(() => () => {
    window.cancelAnimationFrame(frameRef.current);
    window.clearTimeout(wheelCommitRef.current);
  }, []);
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
      ? phoneViewBox
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
    return divideByZoom ? { x: x / (interactionRef.current.originZoom || liveViewportRef.current.zoom), y: y / (interactionRef.current.originZoom || liveViewportRef.current.zoom) } : { x, y };
  };
  const boundedViewport = (next) => ({
    panX: clamp(next.panX, VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan),
    panY: clamp(next.panY, VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan),
    zoom: clamp(next.zoom, minimumZoom, VIEWPORT_LIMITS.maxZoom),
  });
  const zoomAtPoint = (current, requestedZoom, point) => {
    const zoom = clamp(requestedZoom, minimumZoom, VIEWPORT_LIMITS.maxZoom);
    const contentX = (point.x - current.panX) / current.zoom;
    const contentY = (point.y - current.panY) / current.zoom;
    return boundedViewport({
      zoom,
      panX: point.x - contentX * zoom,
      panY: point.y - contentY * zoom,
    });
  };
  const activeViewport = () => wheelViewportRef.current || liveViewportRef.current || viewport;
  const endWheelSession = (commit = false) => {
    const current = activeViewport();
    const pending = wheelViewportRef.current;
    window.clearTimeout(wheelCommitRef.current);
    wheelViewportRef.current = null;
    wheelCommitRef.current = null;
    liveViewportRef.current = current;
    setTransientViewport(null);
    if (commit && pending) onViewportChange(current);
    return current;
  };
  const beginPointerTracking = (event) => {
    if (wheelViewportRef.current) endWheelSession(true);
    if (event.pointerType !== 'touch') return;
    pointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    if (pointersRef.current.size !== 2) return;
    const [first, second] = [...pointersRef.current.values()];
    const midpoint = clientPoint((first.clientX + second.clientX) / 2, (first.clientY + second.clientY) / 2);
    const origin = transientViewport || viewport;
    interactionRef.current = {
      kind: 'pinch',
      pointerIds: new Set(pointersRef.current.keys()),
      origin,
      startDistance: Math.max(1, Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)),
      anchorContentX: (midpoint.x - origin.panX) / origin.zoom,
      anchorContentY: (midpoint.y - origin.panY) / origin.zoom,
      latestViewport: origin,
      moved: false,
    };
    [...interactionRef.current.pointerIds].forEach((pointerId) => {
      try { svgRef.current?.setPointerCapture?.(pointerId); } catch { /* The pointer may already have ended. */ }
    });
    setTransientNode(null);
    setPointerGesture('pinch');
  };
  const beginViewportGesture = (event, kind, selectionId = null) => {
    if (interactionRef.current?.kind === 'pinch' || (event.button !== undefined && ![0, 1].includes(event.button))) return;
    if (event.button === 1) event.preventDefault();
    event.stopPropagation();
    svgRef.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const start = clientPoint(event.clientX, event.clientY);
    const originViewport = activeViewport();
    interactionRef.current = {
      kind,
      selectionId,
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startSvgX: start.x,
      startSvgY: start.y,
      originViewport,
      originX: originViewport.panX,
      originY: originViewport.panY,
      latestX: originViewport.panX,
      latestY: originViewport.panY,
      moved: false,
    };
    setPointerGesture(kind);
  };
  const beginNode = (event, node) => {
    if (event.button === 1 || panModifierRef.current) { beginViewportGesture(event, 'pan'); return; }
    if (event.button !== undefined && event.button !== 0) return;
    event.stopPropagation();
    if (interactionRef.current?.kind === 'pinch') return;
    if (detailMode) {
      beginViewportGesture(event, 'node-detail', node.id);
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
      originZoom: activeViewport().zoom * activeRingExpansion,
      node,
      halfWidth: geometry.cardWidth / 2,
      halfHeight: geometry.cardHeight / 2,
    };
  };
  const beginPan = (event) => {
    beginViewportGesture(event, 'pan');
  };
  const beginEdge = (event, edge) => beginViewportGesture(event, event.button === 1 || panModifierRef.current ? 'pan' : 'edge', edge.id);
  const movePointer = (event) => {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    }
    const interaction = interactionRef.current;
    if (!interaction) return;
    if (interaction.kind === 'pinch') {
      if (!interaction.pointerIds.has(event.pointerId) || interaction.pointerIds.size !== 2) return;
      const points = [...interaction.pointerIds].map((pointerId) => pointersRef.current.get(pointerId)).filter(Boolean);
      if (points.length !== 2) return;
      event.preventDefault();
      const [first, second] = points;
      const distance = Math.max(1, Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY));
      const midpoint = clientPoint((first.clientX + second.clientX) / 2, (first.clientY + second.clientY) / 2);
      const zoom = clamp(interaction.origin.zoom * (distance / interaction.startDistance), minimumZoom, VIEWPORT_LIMITS.maxZoom);
      interaction.latestViewport = boundedViewport({
        zoom,
        panX: midpoint.x - interaction.anchorContentX * zoom,
        panY: midpoint.y - interaction.anchorContentY * zoom,
      });
      liveViewportRef.current = interaction.latestViewport;
      interaction.moved = true;
      schedule(() => setTransientViewport(interaction.latestViewport));
      return;
    }
    if (interaction.pointerId !== event.pointerId) return;
    const rawDistance = Math.hypot(event.clientX - interaction.startClientX, event.clientY - interaction.startClientY);
    if (rawDistance < 4 && !interaction.moved) return;
    interaction.moved = true;
    if (interaction.kind === 'node') {
      const delta = viewDelta(event, true);
      const rawX = mapMode === 'ecology' ? interaction.originX + delta.x : clamp(Math.round(interaction.originX + delta.x), interaction.halfWidth + 8, WORLD_WIDTH - interaction.halfWidth - 8);
      const rawY = mapMode === 'ecology' ? interaction.originY + delta.y : clamp(Math.round(interaction.originY + delta.y), interaction.halfHeight + 8, WORLD_HEIGHT - interaction.halfHeight - 8);
      const constrained = mapMode === 'ecology'
        ? constrainToEcologyBand(interaction.node, rawX, rawY, mapNodeGeometry(interaction.node.label, phoneLayout), phoneLayout, nodes.length, interactionBands)
        : { x: rawX, y: rawY };
      interaction.latestX = constrained.x;
      interaction.latestY = constrained.y;
      schedule(() => setTransientNode({ id: interaction.nodeId, x: interaction.latestX, y: interaction.latestY }));
    } else {
      const delta = viewDelta(event);
      interaction.latestX = clamp(interaction.originX + delta.x, VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan);
      interaction.latestY = clamp(interaction.originY + delta.y, VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan);
      const latestViewport = { ...interaction.originViewport, panX: interaction.latestX, panY: interaction.latestY };
      liveViewportRef.current = latestViewport;
      schedule(() => setTransientViewport(latestViewport));
    }
  };
  const finishPointer = (event, cancelled = false) => {
    const interaction = interactionRef.current;
    pointersRef.current.delete(event.pointerId);
    if (!interaction) return;
    if (interaction.kind === 'pinch') {
      if (!interaction.pointerIds.has(event.pointerId)) return;
      interactionRef.current = null;
      interaction.pointerIds.forEach((pointerId) => {
        if (svgRef.current?.hasPointerCapture?.(pointerId)) svgRef.current.releasePointerCapture(pointerId);
      });
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      if (!cancelled && interaction.moved) {
        liveViewportRef.current = interaction.latestViewport;
        onViewportChange(interaction.latestViewport);
        onAnnounce(`Map zoom ${Math.round(interaction.latestViewport.zoom * 100)} percent.`);
      }
      setTransientNode(null);
      setTransientViewport(null);
      setPointerGesture(null);
      return;
    }
    if (interaction.pointerId !== event.pointerId) return;
    interactionRef.current = null;
    interaction.captureTarget?.releasePointerCapture?.(event.pointerId);
    window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    const tap = event.pointerType === 'touch' ? { pointerType: 'touch', timeStamp: event.timeStamp } : null;
    if (!cancelled && interaction.moved && interaction.kind === 'node') onMoveNode(interaction.nodeId, interaction.latestX, interaction.latestY, 'pointer');
    if (!cancelled && !interaction.moved && interaction.kind === 'node') onSelect('node', interaction.nodeId, true, tap);
    if (!cancelled && !interaction.moved && interaction.kind === 'node-detail') onSelect('node', interaction.selectionId, true, tap);
    if (!cancelled && !interaction.moved && interaction.kind === 'edge') onSelect('edge', interaction.selectionId, true, tap);
    if (!cancelled && interaction.moved && ['pan', 'edge', 'node-detail'].includes(interaction.kind)) {
      const nextViewport = { ...interaction.originViewport, panX: interaction.latestX, panY: interaction.latestY };
      liveViewportRef.current = nextViewport;
      onViewportChange(nextViewport);
      onAnnounce('Map moved.');
    }
    setTransientNode(null);
    setTransientViewport(null);
    setPointerGesture(null);
  };
  const zoomWithWheel = (event) => {
    event.preventDefault();
    const current = activeViewport();
    const sensitivity = event.ctrlKey ? 0.01 : 0.0025;
    const next = zoomAtPoint(current, current.zoom * Math.exp(-event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? GRAPH_HEIGHT : 1) * sensitivity), clientPoint(event.clientX, event.clientY));
    if (Math.abs(next.zoom - current.zoom) < 0.001) return;
    wheelViewportRef.current = next;
    liveViewportRef.current = next;
    setTransientViewport(next);
    window.clearTimeout(wheelCommitRef.current);
    wheelCommitRef.current = window.setTimeout(() => {
      const committed = wheelViewportRef.current;
      wheelViewportRef.current = null;
      setTransientViewport(null);
      if (!committed) return;
      liveViewportRef.current = committed;
      onViewportChange(committed);
      onAnnounce(`Map zoom ${Math.round(committed.zoom * 100)} percent.`);
    }, 140);
  };
  wheelHandlerRef.current = zoomWithWheel;
  useEffect(() => {
    const canvas = svgRef.current;
    if (!canvas) return undefined;
    const handleWheel = (event) => wheelHandlerRef.current?.(event);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, []);
  useEffect(() => {
    if (!wheelViewportRef.current) {
      liveViewportRef.current = transientViewport || viewport;
      return;
    }
    endWheelSession(false);
    // A parent-level fit, fullscreen, or responsive change supersedes a
    // pending wheel frame so an old debounce cannot overwrite the new view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.panX, viewport.panY, viewport.zoom]);
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
    if (wheelViewportRef.current) endWheelSession(true);
    const step = event.shiftKey ? 24 : 8;
    const [dx, dy] = deltas[event.key];
    const geometry = mapNodeGeometry(node.label, phoneLayout);
    const rawX = mapMode === 'ecology' ? node.x + dx * step : clamp(node.x + dx * step, geometry.cardWidth / 2 + 8, WORLD_WIDTH - geometry.cardWidth / 2 - 8);
    const rawY = mapMode === 'ecology' ? node.y + dy * step : clamp(node.y + dy * step, geometry.cardHeight / 2 + 8, WORLD_HEIGHT - geometry.cardHeight / 2 - 8);
    const { x, y } = mapMode === 'ecology' ? constrainToEcologyBand(node, rawX, rawY, geometry, phoneLayout, nodes.length, interactionBands) : { x: rawX, y: rawY };
    onSelect('node', node.id, false);
    onMoveNode(node.id, x, y, 'keyboard');
    onAnnounce(`${node.label} moved to x ${x}, y ${y}.`);
  };
  const graphViewBox = phoneLayout
    ? `${phoneViewBox.x} ${phoneViewBox.y} ${phoneViewBox.width} ${phoneViewBox.height}`
    : `0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`;
  const graphViewBoxBounds = phoneLayout
    ? phoneViewBox
    : { x: 0, y: 0, width: GRAPH_WIDTH, height: GRAPH_HEIGHT };
  const labelViewportInset = (phoneLayout ? 110 : 8) / viewport.zoom;
  const visibleLabelBounds = {
    left: (graphViewBoxBounds.x - viewport.panX) / viewport.zoom + labelViewportInset,
    right: (graphViewBoxBounds.x + graphViewBoxBounds.width - viewport.panX) / viewport.zoom - labelViewportInset,
    top: (graphViewBoxBounds.y - viewport.panY) / viewport.zoom + labelViewportInset,
    bottom: (graphViewBoxBounds.y + graphViewBoxBounds.height - viewport.panY) / viewport.zoom - labelViewportInset,
  };
  const nodeVisuals = useMemo(() => new Map(nodes.map((node) => [node.id, {
    position: renderedPositions.get(node.id),
    geometry: mapNodeGeometry(node.label, phoneLayout),
  }])), [nodes, renderedPositions, phoneLayout, fontRevision]);
  const betweenEndpointLayout = useMemo(() => betweenEndpointCalloutLayout(
    edges.filter((edge) => edge.showLabel !== false),
    nodes,
    renderedPositions,
    phoneLayout,
  ), [edges, nodes, renderedPositions, phoneLayout, fontRevision]);
  const edgeVisuals = edges.map((edge) => {
    const source = nodeVisuals.get(edge.source);
    const target = nodeVisuals.get(edge.target);
    if (!source?.position || !target?.position) return null;
    const labelGeometry = mapEdgeLabelGeometry(relationshipMapLabel(edge), phoneLayout, edge.scale);
    const calloutAnchor = betweenEndpointLayout.anchors.get(edge.id) || null;
    const routedPoints = betweenEndpointLayout.paths.get(edge.id) || null;
    const sourceToward = calloutAnchor || target.position;
    const targetToward = calloutAnchor || source.position;
    const sourcePoint = routedPoints?.source || cardConnectionPoint(source.position, sourceToward, source.geometry);
    const targetPoint = routedPoints?.target || cardConnectionPoint(target.position, targetToward, target.geometry, phoneLayout ? 12 : 7);
    const labelPoint = calloutAnchor || {
      x: (source.position.x + target.position.x) / 2,
      y: (source.position.y + target.position.y) / 2,
    };
    const path = routedPoints?.points
      ? routedPoints.points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
      : calloutAnchor
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
      edgeRoute: betweenEndpointLayout.routeKinds.get(edge.id) || (calloutAnchor ? 'callout' : 'direct'),
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
  const microSettingRegionVisuals = nodes
    .filter((node) => node.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(node.type))
    .map((setting) => {
      const members = nodes.filter((node) => node.id !== setting.id && node.scale === 'micro' && (node.settingNodeIds || []).includes(setting.id));
      if (!members.length) return null;
      const region = mapRegionGeometry([setting.id, ...members.map(node => node.id)], nodeVisuals, phoneLayout ? 14 : 10);
      if (!region) return null;
      return {
        ...region,
        setting,
        memberCount: members.length,
        maskId: `${regionMaskPrefix}-setting-${setting.id}`,
        selected: selection?.kind === 'node' && (selection.id === setting.id || members.some((member) => member.id === selection.id)),
      };
    })
    .filter(Boolean);
  const macroScopeRegionVisuals = nodes
    .filter(node => node.scale === 'macrosphere' && node.scopeNodeIds?.length)
    .flatMap(node => {
      const region = mapRegionGeometry(node.scopeNodeIds, nodeVisuals, phoneLayout ? 14 : 10);
      return region ? [{ ...region, node, maskId: `${regionMaskPrefix}-scope-${node.id}`, selected: selection?.kind === 'node' && selection.id === node.id }] : [];
    });
  const graphSummary = `${nodes.length} ${nodes.length === 1 ? 'node' : 'nodes'} and ${edges.length} ${edges.length === 1 ? 'connection' : 'connections'}`;
  return <svg id="systems-map-canvas" ref={svgRef} tabIndex="0" className={`graph-canvas graph-canvas--${mapMode} ${detailMode ? 'is-detail-view' : ''} ${pointerGesture ? 'is-panning' : ''} ${spacePanning ? 'is-space-panning' : ''}`} data-map-mode={mapMode} data-ring-expansion={activeRingExpansion.toFixed(4)} role="group" aria-label={`${mapLabel}. ${graphSummary}. Choose a node or connection for details. Drag the map or use arrow keys to pan. Use the mouse wheel or pinch to zoom.${detailMode ? '' : ' Arrow keys move a focused node by 8 pixels; Shift plus an arrow moves it by 24.'}`} aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight" viewBox={graphViewBox} onPointerDownCapture={beginPointerTracking} onPointerDown={beginPan} onPointerMove={movePointer} onPointerUp={finishPointer} onPointerCancel={(event) => finishPointer(event, true)} onLostPointerCapture={(event) => { if (event.target === event.currentTarget) finishPointer(event, true); }} onKeyDown={(event) => {
    if (event.key === 'Escape' && interactionRef.current) {
      event.preventDefault();
      const interaction = interactionRef.current;
      finishPointer({ pointerId: interaction.pointerId ?? [...interaction.pointerIds][0] }, true);
      liveViewportRef.current = viewport;
      onAnnounce('Map gesture cancelled.');
      return;
    }
    if (event.target !== event.currentTarget) return;
    if (event.key === ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); panModifierRef.current = true; setSpacePanning(true); return;
    }
    if (['+', '=', '-'].includes(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const current = endWheelSession(false);
      const center = { x: GRAPH_WIDTH / 2, y: phoneLayout ? phoneViewBox.y + phoneViewBox.height / 2 : GRAPH_HEIGHT / 2 };
      const next = zoomAtPoint(current, current.zoom * (event.key === '-' ? 1 / 1.2 : 1.2), center);
      liveViewportRef.current = next;
      onViewportChange(next);
      onAnnounce(`Map zoom ${Math.round(next.zoom * 100)} percent.`);
      return;
    }
    const deltas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!deltas[event.key]) return;
    event.preventDefault();
    const current = wheelViewportRef.current ? endWheelSession(false) : activeViewport();
    const step = event.shiftKey ? 120 : 40;
    const [dx, dy] = deltas[event.key];
    onViewportChange({
      ...current,
      panX: clamp(current.panX + dx * step, VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan),
      panY: clamp(current.panY + dy * step, VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan),
    });
    onAnnounce(`Map panned ${event.key.replace('Arrow', '').toLowerCase()}.`);
  }}>
    <title>Interactive systems map</title>
    <defs>
      <marker id="arrowhead" markerWidth={phoneLayout ? 6 : 8} markerHeight={phoneLayout ? 5 : 6} viewBox="0 0 8 6" refX={phoneLayout ? 8 : 7} refY="3" orient="auto-start-reverse"><path d="M0,0 L8,3 L0,6 z" /></marker>
      {[...microSettingRegionVisuals, ...macroScopeRegionVisuals].map(({ maskId, bounds, exclusions }) => (
        <mask key={maskId} id={maskId} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x={bounds.left - 2} y={bounds.top - 2} width={bounds.right - bounds.left + 4} height={bounds.bottom - bounds.top + 4} style={{ maskType: 'luminance' }}>
          <rect x={bounds.left - 2} y={bounds.top - 2} width={bounds.right - bounds.left + 4} height={bounds.bottom - bounds.top + 4} fill="white" />
          {exclusions.map(box => <rect key={box.id} data-excludes-node={box.id} x={box.left} y={box.top} width={box.right - box.left} height={box.bottom - box.top} fill="black" />)}
        </mask>
      ))}
    </defs>
    <g className="viewport-layer" transform={`translate(${shownViewport.panX} ${shownViewport.panY}) scale(${shownViewport.zoom})`}>
      {mapMode === 'ecology' && !detailMode ? <EcologicalLayerBackdrop layers={ecologyLayers} visibleLayer={visibleLayer} phoneLayout={phoneLayout} nodeCount={nodes.length} ringExpansion={activeRingExpansion} nodes={nodes} positions={renderedPositions} visibleBounds={visibleLabelBounds} sharedBands={sharedBands} /> : null}
      {microBoundary && <g className="ecology-layers shared-micro-boundary" aria-hidden="true"><g data-ecology-layer="micro" className="ecology-layer ecology-layer--micro is-visible">
        <ellipse cx={microBoundary.cx} cy={microBoundary.cy} rx={microBoundary.rx} ry={microBoundary.ry} />
        <g className="ecology-layer__label" transform={`translate(${microBoundary.cx} ${microBoundary.top + 12})`}><rect x="-64" y="-18" width="128" height="36" rx="18" /><text y="5">Micro-level</text></g>
      </g></g>}
      <g className="micro-setting-regions" aria-hidden="true">{microSettingRegionVisuals.map(({ setting, memberCount, path, selected, maskId }) => <path key={`micro-setting-${setting.id}`} data-setting-region={setting.id} data-member-count={memberCount} className={`micro-setting-region ${selected ? 'is-selected' : ''} ${setting.visualMuted ? 'is-muted' : ''}`} d={path} mask={`url(#${maskId})`} />)}</g>
      <g className="scope-fields" aria-hidden="true">{macroScopeRegionVisuals.map(({ node, path, selected, maskId }) => (
        <path key={`scope-${node.id}`} data-scope-of={node.id} className={`scope-field ${selected ? 'is-selected' : ''} ${node.visualMuted ? 'is-muted' : ''}`} d={path} mask={`url(#${maskId})`} />
      ))}</g>
      <g className="meso-linkages" aria-hidden="true">{mesoBridgeVisuals.map((bridge) => <line key={bridge.id} data-linkage-of={bridge.linkageId} className={`meso-link-line ${bridge.muted ? 'is-muted' : ''}`} x1={bridge.x1} y1={bridge.y1} x2={bridge.x2} y2={bridge.y2} />)}</g>
      <g className="edges">{edgeVisuals.map(({ edge, x1, y1, x2, y2, path, edgeRoute, selected }) => <g key={edge.id} data-graph-id={edge.id} data-edge-scale={edge.scale} data-edge-route={edgeRoute} role="button" tabIndex={edge.visualMuted ? -1 : 0} aria-label={`${relationshipDescription(edge)}, ${SCALES[edge.scale]?.label || edge.scale} connection`} aria-keyshortcuts="Enter Space" aria-pressed={selected} className={`graph-edge graph-edge--${stateClass(edge.claimState)} ${edge.visualMuted ? 'is-muted' : ''} ${edge.visualDimmed ? 'is-dimmed' : ''} ${selected ? 'is-selected' : ''}`} onPointerDown={(event) => beginEdge(event, edge)} onLostPointerCapture={(event) => { if (interactionRef.current?.kind !== 'pinch') finishPointer(event, true); }} onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect('edge', edge.id, true);
      }}>
        <path className="edge-hit" d={path} x1={x1} y1={y1} x2={x2} y2={y2} />
        {selected && <path className="edge-selection-halo" d={path} x1={x1} y1={y1} x2={x2} y2={y2} />}
        <path className="edge-line" style={{ '--edge-count-width': relationshipLineWidth(edge) }} strokeDasharray={edge.relationshipProcess?.connectionStatus === 'missing' ? '7 5' : undefined} data-connection-status={edge.relationshipProcess?.connectionStatus || 'unknown'} vectorEffect={phoneLayout ? "non-scaling-stroke" : undefined} d={path} x1={x1} y1={y1} x2={x2} y2={y2} markerStart={relationshipArrowheads(edge).start ? 'url(#arrowhead)' : undefined} markerEnd={relationshipArrowheads(edge).end ? 'url(#arrowhead)' : undefined} />
      </g>)}</g>
      <g className="edge-labels" aria-hidden="true">{edgeVisuals.filter(({ edge }) => edge.showLabel !== false).map(({ edge, midX, midY, labelGeometry: geometry, edgeRoute, selected }) => {
        return <g key={edge.id} data-edge-id={edge.id} data-edge-scale={edge.scale} data-edge-route={edgeRoute} data-anchor-x={midX} data-anchor-y={midY} data-full-label={relationshipMapLabel(edge)} className={`graph-edge-label ${edge.visualDimmed ? 'is-dimmed' : ''} ${selected ? 'is-selected' : ''}`}>
          <rect className="edge-label-bg" x={midX - (geometry.width / 2)} y={midY - (geometry.height / 2)} width={geometry.width} height={geometry.height} rx={phoneLayout ? 6 : 2} />
          <text className="edge-label" style={{ fontSize: geometry.fontSize, fontFamily: '"Source Sans 3 Variable", "Source Sans 3", sans-serif' }} x={midX}>{geometry.lines.map((line, lineIndex) => <tspan key={`${edge.id}-line-${lineIndex}`} x={midX} y={midY + geometry.startY + lineIndex * geometry.lineHeight}>{line}</tspan>)}</text>
        </g>;
      })}</g>
      <g className="nodes">{nodes.map((node) => {
        const { position, geometry } = nodeVisuals.get(node.id);
        const selected = selection?.kind === 'node' && selection.id === node.id;
        const evidenceState = node.evidence ? 'evidence recorded' : 'evidence unresolved';
        const scopeState = node.scale === 'meso' && node.scopeNodeIds?.length
          ? `, includes ${node.scopeNodeIds.length} Micro settings`
          : node.scale === 'macrosphere' && node.scopeNodeIds?.length
            ? `, ${node.deontic || 'shapes'} ${node.scopeNodeIds.length} map ${node.scopeNodeIds.length === 1 ? 'item' : 'items'}`
            : '';
        const microContextState = node.scale === 'micro'
          ? `, ${FOCAL_PARTICIPATION_LABELS[node.focalParticipation || 'unclear'] || 'Focal participation unclear'}, ${(node.settingNodeIds || []).length} immediate ${(node.settingNodeIds || []).length === 1 ? 'setting' : 'settings'}`
          : '';
        return <g key={node.id} data-graph-id={node.id} data-full-label={node.label} role="button" tabIndex="0" aria-label={`${node.label}, ${node.type}, ${SCALES[node.scale]?.label || node.scale}, ${evidenceState}${scopeState}${microContextState}`} aria-keyshortcuts={detailMode ? 'Enter Space' : 'ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight'} aria-pressed={selected} className={`graph-node graph-node--${node.scale} graph-node--${stateClass(node.claimState)} ${node.visualMuted ? 'is-muted' : ''} ${node.visualDimmed ? 'is-dimmed' : ''} ${selected ? 'is-selected' : ''}`} transform={`translate(${position.x} ${position.y})`} onPointerDown={(event) => beginNode(event, node)} onLostPointerCapture={(event) => { if (interactionRef.current?.kind !== 'pinch') finishPointer(event, true); }} onKeyDown={(event) => keyboardNode(event, node)}>
          {selected && <rect className="node-selection-ring" x={geometry.ringX} y={geometry.ringY} width={geometry.ringWidth} height={geometry.ringHeight} rx={geometry.ringRadius} />}
          <rect className="node-card" x={geometry.cardX} y={geometry.cardY} width={geometry.cardWidth} height={geometry.cardHeight} rx={geometry.cardRadius} />
          <text className="node-label" style={{ fontSize: geometry.fontSize, fontFamily: '"Source Sans 3 Variable", "Source Sans 3", sans-serif' }}>{geometry.lines.map((line, lineIndex) => <tspan key={`${node.id}-line-${lineIndex}`} x="0" y={geometry.labelStartY + lineIndex * geometry.lineHeight}>{line}</tspan>)}</text>
        </g>;
      })}</g>
    </g>
  </svg>;
}

function sameGraphVisuals(previous, next) {
  if (previous.phoneLayout !== next.phoneLayout) return false;
  if (previous.phoneViewBox?.height !== next.phoneViewBox?.height) return false;
  if (previous.mapLabel !== next.mapLabel) return false;
  if (previous.mapMode !== next.mapMode || previous.visibleLayer !== next.visibleLayer) return false;
  if (previous.detailMode !== next.detailMode || previous.connectionMode !== next.connectionMode) return false;
  if (previous.ringExpansion !== next.ringExpansion) return false;
  if (previous.ecologyBandGeometry !== next.ecologyBandGeometry) return false;
  if (JSON.stringify(previous.microBoundary) !== JSON.stringify(next.microBoundary)) return false;
  if (previous.fontRevision !== next.fontRevision) return false;
  if ((previous.ecologyLayers || []).join(',') !== (next.ecologyLayers || []).join(',')) return false;
  if (previous.minimumZoom !== next.minimumZoom) return false;
  if (previous.interactionMode !== next.interactionMode) return false;
  if (previous.selection?.kind !== next.selection?.kind || previous.selection?.id !== next.selection?.id) return false;
  if (previous.viewport.panX !== next.viewport.panX || previous.viewport.panY !== next.viewport.panY || previous.viewport.zoom !== next.viewport.zoom) return false;
  if (previous.nodes.length !== next.nodes.length || previous.edges.length !== next.edges.length) return false;
  for (let index = 0; index < previous.nodes.length; index += 1) {
    const a = previous.nodes[index]; const b = next.nodes[index];
    if (a.id !== b.id || a.x !== b.x || a.y !== b.y || a.label !== b.label || a.type !== b.type || a.scale !== b.scale || a.claimState !== b.claimState || Boolean(a.evidence) !== Boolean(b.evidence) || a.visualMuted !== b.visualMuted || a.visualDimmed !== b.visualDimmed) return false;
    if ((a.scopeNodeIds || []).join(',') !== (b.scopeNodeIds || []).join(',') || a.deontic !== b.deontic) return false;
    if ((a.settingNodeIds || []).join(',') !== (b.settingNodeIds || []).join(',') || a.focalParticipation !== b.focalParticipation) return false;
  }
  for (let index = 0; index < previous.edges.length; index += 1) {
    const a = previous.edges[index]; const b = next.edges[index];
    if (JSON.stringify(a.relationshipProcess) !== JSON.stringify(b.relationshipProcess) || a.id !== b.id || a.source !== b.source || a.target !== b.target || a.verb !== b.verb || a.scale !== b.scale || a.claimState !== b.claimState || a.sourceLabel !== b.sourceLabel || a.targetLabel !== b.targetLabel || a.showLabel !== b.showLabel || a.visualMuted !== b.visualMuted || a.visualDimmed !== b.visualDimmed || a.layerEdgeSlot !== b.layerEdgeSlot || a.layerEdgeCount !== b.layerEdgeCount) return false;
  }
  if (previous.onMoveNode !== next.onMoveNode || previous.onSelect !== next.onSelect) return false;
  return true;
}

const MemoGraphCanvas = React.memo(GraphCanvas, sameGraphVisuals);

function MapLegend() {
  return <div className="legend-grid">
    <section><h3>Levels</h3><dl className="level-guide">
      <div><dt><i className="legend-symbol legend-symbol--micro" />Micro-level</dt><dd>Person participates directly in this setting or interaction.</dd></div>
      <div><dt><i className="legend-symbol legend-symbol--meso" />Meso-level</dt><dd>Arrows connect the people, resources, and settings already on the Micro map.</dd></div>
      <div><dt><i className="legend-symbol legend-symbol--exosphere" />Exo-level</dt><dd>Person does not participate in this decision setting, but its action reaches a Micro setting.</dd></div>
      <div><dt><i className="legend-symbol legend-symbol--macrosphere" />Macro-level</dt><dd>Broader law, policy, economic condition, history, or cultural belief affects several map items.</dd></div>
    </dl></section>
    <section><h3>How to read this map</h3><ul className="map-conventions">
      <li><strong>Micro</strong><span>People, resources, and immediate settings</span></li>
      <li><strong>Meso</strong><span>One-way or two-way relationships between the same Micro items. Missing connections use a dashed line and an explicit label. Wider lines represent larger recorded family counts; the exact count and connection strength are written on the label.</span></li>
      <li><strong>Exo-level connection</strong><span>Outside decision setting connected to an affected Micro setting or another outside office</span></li>
      <li><strong>Macro-level condition</strong><span>Map items affected by a broader condition</span></li>
    </ul><p className="map-legend__note">Level shows how each item relates to the focal person. It does not show causal strength.</p></section>
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

function blankManualNode(scale) {
  // Meso adds relationships in the existing Micro space. A missing person or
  // setting therefore joins Micro even when the student is working at Meso.
  if (scale === 'meso') scale = 'micro';
  return {
    label: '',
    type: scale === 'exosphere' ? 'institution' : 'person',
    scale,
    evidence: '',
    claimState: 'research lead',
    ...(scale === 'micro' ? { focalParticipation: 'direct', settingNodeIds: [] } : {}),
  };
}

function MapStage({ project, update, toast, logPrototype, saveState, stageAnnotationDraft, commitAnnotationDrafts, flushSave, onRequestRestart, onReview, panel = null, onPanelMode, toolbarStart = null, toolbarHost = null, notebook = null, highlight = null, onHighlight, mapCheck = null, onMapCheck, mapItemLabel = (id) => id }) {
  // Every work panel can collapse without changing the current stage or map selection.
  const panelMode = panel?.mode ?? 'inspector';
  const panelContent = Boolean(panel) && panelMode !== 'inspector';
  const [selection, setSelection] = useState(null);
  const [traceHistory, setTraceHistory] = useState([]);
  const [layoutHistory, setLayoutHistory] = useState({ past: [], future: [] });
  const connectionIndex = useMemo(() => indexMapConnections(project.graph), [project.graph]);
  const [focus, setFocus] = useState(null);
  const [focusPage, setFocusPage] = useState(0);
  const [visibleScale, setVisibleScale] = useState(project.activeScale);
  const [presentation, setPresentation] = useState('canvas');
  const [showRemoved, setShowRemoved] = useState(false);
  const [inspectorTab, setInspectorTab] = useState('map');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsedPanel, setCollapsedPanel] = useState(null);
  const sheetOpen = notebook ? notebook.open : panelContent ? collapsedPanel !== panelMode : drawerOpen;
  const [toolsOpen, setToolsOpen] = useState(false);
  useEffect(() => { if (notebook?.open) setToolsOpen(false); }, [notebook?.open]);
  const layoutRef = useRef(null);
  const sidebarSize = useSidebarSize(layoutRef);
  useEffect(() => { setCollapsedPanel(null); }, [panelMode, project.activeScale]);
  const highlightNodeIds = useMemo(() => new Set(highlight?.nodeIds || []), [highlight]);
  const highlightEdgeIds = useMemo(() => new Set(highlight?.edgeIds || []), [highlight]);
  const highlightActive = highlightNodeIds.size > 0 || highlightEdgeIds.size > 0;
  const showMapRefs = (refs, primary) => {
    const edges = project.graph.edges.filter((edge) => refs.includes(edge.id));
    const nodeIds = [...new Set([...refs.filter((ref) => project.graph.nodes.some((node) => node.id === ref)), ...edges.flatMap((edge) => [edge.source, edge.target])])];
    const edgeIds = edges.map((edge) => edge.id);
    onHighlight?.({ nodeIds, edgeIds });
    notebook?.onChange(false);
    const label = mapItemLabel(primary);
    setAnnouncement(refs.length === 1 ? `Highlighting ${label} on the map.` : `Highlighting ${label} and ${refs.length - 1} related ${refs.length === 2 ? 'item' : 'items'} on the map.`);
  };
  const [phoneViewport, setPhoneViewport] = useState(null);
  const [mapViewport, setMapViewport] = useState(null);
  const [ringExpansion, setRingExpansion] = useState(1);
  const [automaticPositions, setAutomaticPositions] = useState(null);
  const [layoutMeasurementRevision, setLayoutMeasurementRevision] = useState(0);
  const [legendOpen, setLegendOpen] = useState(false);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => { if (notebook?.open) setFullscreen(false); }, [notebook?.open]);
  const [announcement, setAnnouncementState] = useState({ message: '', revision: 0 });
  const [addMode, setAddMode] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionSource, setConnectionSource] = useState(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [phoneOverviewCommittedScope, setPhoneOverviewCommittedScope] = useState('');
  const [phoneEcologyCommittedScope, setPhoneEcologyCommittedScope] = useState('');
  const [newNode, setNewNode] = useState(() => blankManualNode(project.activeScale));
  const [newEdge, setNewEdge] = useState({ source: project.graph.nodes[0]?.id || '', target: project.graph.nodes[1]?.id || '', verb: 'provides', evidence: '', claimState: 'research lead' });
  const canvasWrapRef = useRef(null);
  const legendTriggerRef = useRef(null);
  const moveMenuTriggerRef = useRef(null);
  const fullscreenToggleRef = useRef(null);
  const restoreFullscreenFocusRef = useRef(false);
  const inspectorRef = useRef(null);
  const selectionTriggerRef = useRef(null);
  const consumedCanvasTapRef = useRef(null);
  const initialLayoutCheckedRef = useRef('');
  const phoneOverviewViewportKeyRef = useRef('');
  const phoneLayout = usePhoneLayout();
  const fontRevision = useMapFontMetrics();
  const phoneViewBox = useCanvasWindow(canvasWrapRef, phoneLayout && presentation === 'canvas');
  const phoneFitHeight = Math.max(241, phoneViewBox.height - (fullscreen ? 280 : 200));
  const legacyPhoneDrawer = phoneLayout && drawerOpen && !notebook;
  const previousPhoneLayoutRef = useRef(phoneLayout);
  const desktopEcologyViewRef = useRef(null);
  const setAnnouncement = useCallback((message) => {
    setAnnouncementState((current) => ({ message, revision: current.revision + 1 }));
  }, []);
  useEffect(() => {
    setSelection(null);
    setVisibleScale(project.activeScale);
    setTraceHistory([]);
    setLayoutHistory({ past: [], future: [] });
    setFocus(null);
    setFocusPage(0);
    setDrawerOpen(false);
    setRingExpansion(1);
  }, [project.activeScale]);
  useEffect(() => {
    setAddMode(null);
    setConnecting(false);
    setConnectionSource(null);
    setCreateMenuOpen(false);
    setNewNode(blankManualNode(project.activeScale));
    setNewEdge({ source: project.graph.nodes[0]?.id || '', target: project.graph.nodes[1]?.id || '', verb: 'provides', evidence: '', claimState: 'research lead' });
  }, [project.activeScale]);
  const ecologyLayers = useMemo(() => SCALE_ORDER.filter((scale) => project.releasedScales.includes(scale)), [project.releasedScales]);
  // Text can resize its own card, but does not request a new arrangement or
  // camera fit. Keep layout measurements until topology, positions, fonts, or
  // the responsive breakpoint change. Arrange/Fit still use current wording.
  const layoutGeometryKey = JSON.stringify([phoneLayout, fontRevision, layoutMeasurementRevision,
    project.graph.nodes.map(node => [node.id, node.scale, node.x, node.y, node.status === 'rejected' || node.claimState === 'retired']),
    project.graph.edges.map(edge => [edge.id, edge.scale, edge.source, edge.target, edge.status === 'rejected' || edge.claimState === 'retired']),
  ]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layoutGraph = useMemo(() => project.graph, [layoutGeometryKey]);
  const layoutNodeById = useMemo(() => new Map(layoutGraph.nodes.map(node => [node.id, node])), [layoutGraph]);
  const layoutEdgeById = useMemo(() => new Map(layoutGraph.edges.map(edge => [edge.id, edge])), [layoutGraph]);
  const ecologyBandNodes = useMemo(() => layoutGraph.nodes.filter(node => node.scale !== 'meso' && node.status !== 'rejected' && node.claimState !== 'retired'), [layoutGraph]);
  const canonicalEcologyPositionKey = useMemo(() => JSON.stringify(ecologyBandNodes.map(node => [node.id, node.x, node.y])), [ecologyBandNodes]);
  const sharedEcologyBands = useMemo(() => {
    const bands = ecologyBands(phoneLayout, ecologyBandNodes.length, ecologyBandNodes);
    if (!phoneLayout || visibleScale !== 'micro') return bands;
    return phoneMicroBands(bands, ecologyBandNodes);
  }, [phoneLayout, fontRevision, ecologyBandNodes, visibleScale]);
  const interactionEcologyBands = useMemo(() => {
    const liveNodes = project.graph.nodes.filter(node => node.scale !== 'meso' && node.status !== 'rejected' && node.claimState !== 'retired');
    const bands = ecologyBands(phoneLayout, liveNodes.length, liveNodes);
    return phoneLayout && visibleScale === 'micro' ? phoneMicroBands(bands, liveNodes) : bands;
  }, [phoneLayout, fontRevision, project.graph.nodes, visibleScale]);
  const ecologyGeometryKey = JSON.stringify([phoneLayout, fontRevision,
    layoutGraph.nodes.map(node => [node.id, node.scale, node.status === 'rejected' || node.claimState === 'retired']),
    layoutGraph.edges.map(edge => [edge.id, edge.scale, edge.source, edge.target, edge.status === 'rejected' || edge.claimState === 'retired']),
  ]);
  const innerMap = ['micro', 'meso'].includes(visibleScale) || !ecologyLayers.some((scale) => ECOLOGY_MAP_SCALES.has(scale));
  const mapMode = innerMap ? 'network' : 'ecology';
  useEffect(() => {
    if (fullscreen || !restoreFullscreenFocusRef.current) return;
    restoreFullscreenFocusRef.current = false;
    (notebook ? toolbarHost?.querySelector('.notebook-map-tools > summary') || document.querySelector('.notebook-map-tools > summary') : fullscreenToggleRef.current)?.focus();
  }, [fullscreen, toolbarHost]);
  useEffect(() => {
    if (!fullscreen) return undefined;
    document.body.classList.add('map-fullscreen-open');
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      restoreFullscreenFocusRef.current = true;
      setFullscreen(false);
      setRingExpansion(1);
      setAnnouncement('Full screen map closed.');
    };
    document.addEventListener('keydown', onKeyDown);
    const focusFrame = window.requestAnimationFrame(() => canvasWrapRef.current?.querySelector('.graph-canvas')?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.classList.remove('map-fullscreen-open');
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [fullscreen]);
  const readingViewport = useCallback((nodes, layer = visibleScale, extraBounds = []) => {
    const boundary = ['micro', 'meso'].includes(layer) ? sharedMicroBoundary(nodes, project.graph.edges, phoneLayout) : null;
    return fitViewport(nodes, phoneLayout ? phoneFitHeight : 420, phoneLayout,
      boundary ? [...extraBounds, boundary] : extraBounds, VIEWPORT_LIMITS.minZoom);
  }, [phoneFitHeight, phoneLayout, project.graph.edges, visibleScale]);
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
    const scaleMatches = visibleScaleSet.has(node.scale) || (visibleScale === 'meso' && node.scale === 'micro') || scaleEdgeIds.has(node.id) || scopeMemberIds.has(node.id);
    return node.scale !== 'meso' && scaleMatches && node.status !== 'rejected' && (showRemoved || node.claimState !== 'retired');
  }), [project.graph.nodes, visibleScaleSet, scaleEdgeIds, scopeMemberIds, showRemoved]);
  const scaleNodeIds = useMemo(() => new Set(scaleNodes.map((node) => node.id)), [scaleNodes]);
  const scaleEdges = useMemo(() => project.graph.edges.filter((edge) => visibleScale !== 'micro' && edge.scale !== 'micro' && visibleScaleSet.has(edge.scale)
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
    if (focus.kind === 'edge' || !phoneLayout) return new Set(focusIncidentEdges.map((edge) => edge.id));
    const start = activeFocusPage * FOCUSED_RELATIONSHIPS_PER_PAGE;
    return new Set(focusIncidentEdges.slice(start, start + FOCUSED_RELATIONSHIPS_PER_PAGE).map((edge) => edge.id));
  }, [activeFocusPage, focus, focusIncidentEdges, phoneLayout]);
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
    if (focus.kind === 'node') {
      const focusedNode = scaleNodes.find((node) => node.id === focus.id);
      (focusedNode?.scopeNodeIds || []).forEach((memberId) => {
        if (scaleNodeIds.has(memberId)) ids.add(memberId);
      });
    }
    return ids;
  }, [focus, focusedEdgeIds, focusIncidentEdges.length, scaleEdges, scaleNodes, scaleNodeIds]);
  const focusActive = focusedNodeIds.size > 0;
  const visibleNodes = useMemo(() => phoneLayout && focusActive ? scaleNodes.filter((node) => focusedNodeIds.has(node.id)) : scaleNodes, [phoneLayout, focusActive, scaleNodes, focusedNodeIds]);
  const phoneFocusedEdge = phoneLayout && focus?.kind === 'edge' ? scaleEdges.find((edge) => edge.id === focus.id) : null;
  const visibleLayoutNodeKey = JSON.stringify(visibleNodes.map(node => node.id));
  const visibleLayoutNodes = useMemo(() => JSON.parse(visibleLayoutNodeKey).map(id => layoutNodeById.get(id)).filter(Boolean), [layoutNodeById, visibleLayoutNodeKey]);
  const phoneLayoutEdge = phoneFocusedEdge ? layoutEdgeById.get(phoneFocusedEdge.id) : null;

  const phoneOverviewScope = phoneLayout && mapMode === 'network' && !focusActive && !phoneFocusedEdge && visibleNodes.length
    ? `${innerMap ? 'micro-meso' : visibleScale}:${focus?.kind || 'overview'}:${focus?.id || 'all'}:${visibleNodes.map((node) => `${node.id}`).join('|')}`
    : '';
  const phoneOverviewPositions = useMemo(() => (
    phoneOverviewScope && phoneOverviewCommittedScope !== phoneOverviewScope
      ? phoneOverviewProjection(visibleLayoutNodes, project.layout)
      : null
  ), [phoneOverviewCommittedScope, phoneOverviewScope, fontRevision, visibleLayoutNodes, project.layout?.phoneOverview]);
  const phoneEcologyScope = phoneLayout && mapMode === 'ecology' && !focusActive && visibleNodes.length
    ? `${visibleScale}:${visibleNodes.map((node) => `${node.id}:${node.scale}`).join('|')}`
    : '';
  const phoneEcologyPositions = useMemo(() => (
    phoneEcologyScope && phoneEcologyCommittedScope !== phoneEcologyScope
      ? (visibleScale === 'micro'
        ? arrangedPhoneMicroPositions(visibleLayoutNodes)
        : arrangedEcologyPositions(visibleLayoutNodes, true, sharedEcologyBands))
      : null
  ), [phoneEcologyCommittedScope, phoneEcologyScope, fontRevision, sharedEcologyBands, visibleLayoutNodes, visibleScale]);
  const phoneRelationshipPositions = useMemo(() => arrangedPhoneRelationshipPositions(visibleLayoutNodes, phoneLayoutEdge), [phoneLayoutEdge, fontRevision, visibleLayoutNodes]);
  const phoneRelationshipDetail = Boolean(phoneRelationshipPositions);
  const focusedRelationshipEdge = focusedEdgeIds.size === 1
    ? layoutGraph.edges.find((edge) => focusedEdgeIds.has(edge.id))
    : null;
  const focusedRelationshipPositions = useMemo(() => (
    phoneLayout && focusActive && visibleNodes.length === 2
      ? arrangedFocusedRelationshipPositions(visibleLayoutNodes, focusedRelationshipEdge, phoneLayout)
      : null
  ), [focusActive, focusedRelationshipEdge, fontRevision, phoneLayout, visibleLayoutNodes]);
  const focusedEcologyPositions = useMemo(() => (
    phoneLayout && focusActive && visibleNodes.length > 1 && !phoneRelationshipDetail
      ? focusedRelationshipPositions || arrangedFocusedEcologyPositions(visibleLayoutNodes, phoneLayout)
      : null
  ), [focusActive, focusedRelationshipPositions, fontRevision, mapMode, phoneLayout, phoneRelationshipDetail, visibleLayoutNodes]);
  const focusedEcologyDetail = Boolean(focusedEcologyPositions);
  const displayedNodes = useMemo(() => visibleNodes.map((node) => ({
    ...node,
    ...(automaticPositions?.get(node.id) || {}),
    ...(phoneOverviewPositions?.get(node.id) || {}),
    ...(phoneEcologyPositions?.get(node.id) || {}),
    ...(focusedEcologyPositions?.get(node.id) || {}),
    ...(phoneRelationshipPositions?.get(node.id) || {}),
    ...(innerMap && !phoneLayout && !focusActive ? { x: node.x, y: node.y } : {}),
    visualDimmed: highlightActive ? !highlightNodeIds.has(node.id) : !phoneLayout && focusActive && !focusedNodeIds.has(node.id),
  })), [innerMap, automaticPositions, focusedEcologyPositions, highlightActive, highlightNodeIds, phoneLayout, focusActive, focusedNodeIds, phoneEcologyPositions, phoneOverviewPositions, phoneRelationshipPositions, visibleNodes]);
  const visibleEdges = useMemo(() => {
    const shown = phoneLayout && focusActive ? scaleEdges.filter((edge) => focusedEdgeIds.has(edge.id)) : scaleEdges;
    const overview = !focusActive && visibleScale === 'all';
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
        showLabel: focusActive ? focusedEdgeIds.has(edge.id) : visibleScale !== 'all',
        visualMuted: overview,
        visualDimmed: highlightActive ? !highlightEdgeIds.has(edge.id) && !(highlightNodeIds.has(edge.source) && highlightNodeIds.has(edge.target)) : !phoneLayout && focusActive && !focusedEdgeIds.has(edge.id),
        layerEdgeSlot: group.findIndex((candidate) => candidate.id === edge.id),
        layerEdgeCount: group.length,
      };
    });
  }, [phoneLayout, focusActive, scaleEdges, focusedEdgeIds, visibleScale, highlightActive, highlightEdgeIds, highlightNodeIds]);
  const microBoundary = useMemo(() => innerMap ? sharedMicroBoundary(displayedNodes, project.graph.edges, phoneLayout) : null, [innerMap, displayedNodes, project.graph.edges, phoneLayout]);
  const visibleRelationshipBounds = useMemo(() => {
    const positions = new Map(displayedNodes.map((node) => [node.id, { x: node.x, y: node.y }]));
    const bounds = focusedEcologyCalloutBounds(visibleEdges, displayedNodes, positions, phoneLayout);
    if (microBoundary) bounds.push(microBoundary);
    if (mapMode !== 'ecology' || phoneRelationshipDetail || focusedEcologyDetail) return bounds;
    const occupied = displayedNodes.map((node) => ecologyCardBounds(
      positions.get(node.id),
      mapNodeGeometry(node.label, phoneLayout),
      8,
    ));
    for (const layer of visibleScale === 'all' ? ecologyLayers : [visibleScale]) {
      const placement = ecologyLayerLabelPlacement(layer, phoneLayout, displayedNodes.length, 1, occupied, null, sharedEcologyBands);
      if (placement) {
        const label = {
          left: placement.x - placement.width / 2 - 8,
          right: placement.x + placement.width / 2 + 8,
          top: placement.y - placement.height / 2 - 8,
          bottom: placement.y + placement.height / 2 + 8,
        };
        bounds.push(label);
        occupied.push(label);
      }
    }
    return bounds;
  }, [displayedNodes, ecologyLayers, focusedEcologyDetail, fontRevision, fullscreen, mapMode, microBoundary, phoneLayout, phoneRelationshipDetail, sharedEcologyBands, visibleEdges, visibleScale]);
  const focusedDetailBounds = visibleRelationshipBounds;
  const focusedGeometryKey = useMemo(() => {
    if (!focusedEcologyDetail) return '';
    const relationshipGeometry = focusIncidentEdges.map((edge) => (
      `${edge.id}:${edge.source}:${edge.target}:${edge.claimState === 'retired'}`
    )).join('|');
    const nodeGeometry = displayedNodes.map((node) => (
      `${node.id}:${node.scale}:${node.x}:${node.y}:${node.claimState === 'retired'}`
    )).join('|');
    return `${focus?.kind || ''}:${focus?.id || ''}:page-${activeFocusPage}:${relationshipGeometry}::${nodeGeometry}`;
  }, [activeFocusPage, displayedNodes, focus?.id, focus?.kind, focusIncidentEdges, focusedEcologyDetail]);
  const focusedDetailMinimumZoom = VIEWPORT_LIMITS.minZoom;
  useEffect(() => {
    if (!phoneLayout || presentation !== 'canvas') return;
    setMapViewport(fitViewport(displayedNodes, phoneFitHeight, true, visibleRelationshipBounds, VIEWPORT_LIMITS.minZoom));
    // Only a canvas resize should reset the transient fit, not text edits or
    // pointer updates. The saved viewport is unchanged until user interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phoneFitHeight, phoneLayout, presentation]);
  useEffect(() => {
    const viewGeometryKey = `${ecologyGeometryKey}:${visibleScale}`;
    if (initialLayoutCheckedRef.current === viewGeometryKey) return;
    initialLayoutCheckedRef.current = viewGeometryKey;
    const currentNodes = project.graph.nodes.filter((node) => node.scale !== 'meso' && node.status !== 'rejected' && node.claimState !== 'retired');
    let positions = innerMap ? null : mapMode === 'ecology'
      ? mapNeedsEcologyLayout(currentNodes, phoneLayout, sharedEcologyBands) ? arrangedEcologyPositions(currentNodes, phoneLayout, sharedEcologyBands) : null
      : mapNodesOverlap(currentNodes, phoneLayout) || mapNeedsReadableOverview(currentNodes, project.events, phoneLayout)
        ? arrangedMapPositions(currentNodes, new Set(currentNodes.map((node) => node.scale)).size > 1, phoneLayout ? 3 : 5, phoneLayout)
        : null;
    if (mapMode === 'ecology' && positions && !phoneLayout) {
      const microNodes = currentNodes.filter((node) => node.scale === 'micro');
      const microEdges = project.graph.edges.filter((edge) => edge.scale === 'micro'
        && edge.status !== 'rejected' && edge.claimState !== 'retired');
      const microLayout = microRelationshipLayout(microNodes, microEdges, false, sharedEcologyBands);
      if (microLayout) positions = new Map([...positions, ...microLayout.positions]);
    }
    let positionedNodes = currentNodes.map((node) => ({ ...node, ...(positions?.get(node.id) || {}) }));
    const nextScaleEdges = project.graph.edges.filter((edge) => visibleScale !== 'micro' && edge.scale !== 'micro' && edge.status !== 'rejected'
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
      : node.scale === visibleScale || (visibleScale === 'meso' && node.scale === 'micro') || endpointIds.has(node.id));
    let connectionLayout = betweenEndpointCalloutLayout(
      visibleScale === 'all' ? [] : nextScaleEdges,
      nextVisibleNodes,
      new Map(nextVisibleNodes.map((node) => [node.id, { x: node.x, y: node.y }])),
      phoneLayout,
    );
    if (!innerMap && mapMode === 'network' && visibleScale !== 'all'
      && (connectionLayout.unplaced.size || connectionLayout.fallbackIds.size)) {
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
    // Every entry starts from a transient fit of meaningful visible content.
    // Whole ring ellipses are deliberately excluded so sparse outer levels do
    // not reduce every node to a miniature. Saved viewport state remains
    // untouched until the student deliberately pans or zooms.
    const fitEdges = nextScaleEdges.map((edge) => ({
      ...edge,
      showLabel: visibleScale !== 'all',
    }));
    const semanticBounds = focusedEcologyCalloutBounds(
      fitEdges,
      nextVisibleNodes,
      new Map(nextVisibleNodes.map((node) => [node.id, { x: node.x, y: node.y }])),
      phoneLayout,
    );
    const boundary = innerMap ? sharedMicroBoundary(nextVisibleNodes, project.graph.edges, phoneLayout) : null;
    if (boundary) semanticBounds.push(boundary);
    setMapViewport(fitViewport(
      nextVisibleNodes.length ? nextVisibleNodes : positionedNodes,
      phoneLayout ? phoneFitHeight : 420,
      phoneLayout,
      semanticBounds,
      VIEWPORT_LIMITS.minZoom,
    ));
  }, [ecologyGeometryKey, ecologyLayers, fontRevision, mapMode, phoneLayout, project.events, project.graph.edges, project.graph.nodes, project.releasedScales, project.viewport.panX, project.viewport.panY, project.viewport.zoom, sharedEcologyBands, visibleScale]);
  useEffect(() => {
    // Do not record the first desktop render after a phone return: its
    // transient viewport still belongs to the phone until the next effect
    // restores the matching desktop snapshot or installs a fresh fit.
    if (phoneLayout || previousPhoneLayoutRef.current || mapMode !== 'ecology') return;
    desktopEcologyViewRef.current = {
      geometryKey: ecologyGeometryKey,
      positionKey: canonicalEcologyPositionKey,
      visibleScale, focusKey: `${focus?.kind || ''}:${focus?.id || ''}`,
      viewport: { ...(mapViewport || project.viewport) }, ringExpansion,
    };
  }, [canonicalEcologyPositionKey, ecologyGeometryKey, focus, mapMode, mapViewport, phoneLayout, project.viewport, ringExpansion, visibleScale]);
  useEffect(() => {
    const wasPhoneLayout = previousPhoneLayoutRef.current;
    previousPhoneLayoutRef.current = phoneLayout;
    if (!phoneLayout) {
      if (wasPhoneLayout) {
        phoneOverviewViewportKeyRef.current = '';
        setPhoneOverviewCommittedScope('');
        setPhoneEcologyCommittedScope('');
        if (mapMode === 'network') {
          setMapViewport(null);
          setRingExpansion(1);
        } else {
          const desktopView = desktopEcologyViewRef.current;
          const sameGeometry = desktopView?.geometryKey === ecologyGeometryKey
            && desktopView.positionKey === canonicalEcologyPositionKey
            && desktopView.visibleScale === visibleScale
            && desktopView.focusKey === `${focus?.kind || ''}:${focus?.id || ''}`;
          if (sameGeometry) {
            setMapViewport(desktopView.viewport);
            setRingExpansion(desktopView.ringExpansion);
          } else setRingExpansion(1);
        }
      }
      return;
    }
    if (!wasPhoneLayout) setRingExpansion(1);
    const responsivePositions = phoneOverviewPositions || phoneEcologyPositions;
    const responsiveScope = phoneOverviewPositions ? phoneOverviewScope : phoneEcologyScope;
    if (!responsivePositions) {
      phoneOverviewViewportKeyRef.current = '';
      return;
    }
    const key = `${ecologyGeometryKey}:${visibleScale}:${responsiveScope}:${displayedNodes.map((node) => `${node.id}:${node.x}:${node.y}`).join('|')}`;
    if (phoneOverviewViewportKeyRef.current === key) return;
    phoneOverviewViewportKeyRef.current = key;
    setMapViewport(fitViewport(displayedNodes, phoneFitHeight, true, visibleRelationshipBounds, VIEWPORT_LIMITS.minZoom));
  }, [canonicalEcologyPositionKey, displayedNodes, ecologyGeometryKey, focus, mapMode, phoneEcologyPositions, phoneEcologyScope, phoneLayout, phoneOverviewPositions, phoneOverviewScope, visibleRelationshipBounds, visibleScale]);
  useEffect(() => {
    if (legacyPhoneDrawer) setPhoneViewport(fitViewport(displayedNodes.length ? displayedNodes : project.graph.nodes, 240, true, visibleRelationshipBounds, VIEWPORT_LIMITS.minZoom));
    else setPhoneViewport(null);
    // Refit only when the drawer opens or the layout crosses the phone breakpoint.
    // Annotation edits clone graph records but must not reset an in-progress pan/zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legacyPhoneDrawer]);
  useEffect(() => {
    if (!phoneRelationshipDetail) return;
    setMapViewport(fitViewport(displayedNodes, phoneFitHeight, true, visibleRelationshipBounds, VIEWPORT_LIMITS.minZoom));
    // Refit when this relationship enters phone detail mode. Annotation edits
    // keep the same mode and must not recenter a student who has already panned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.id, phoneLayout, phoneRelationshipDetail]);
  useEffect(() => {
    if (!focusedEcologyDetail) return;
    setMapViewport(fitViewport(
      displayedNodes,
      phoneLayout ? phoneFitHeight : 420,
      phoneLayout,
      focusedDetailBounds,
      focusedDetailMinimumZoom,
    ));
    // The focus identity and breakpoint define this temporary detail layout.
    // Annotation edits must not recenter a student who has already panned it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedGeometryKey, phoneLayout, visibleScale]);
  useEffect(() => {
    if (notebook || !phoneLayout || !drawerOpen) return undefined;
    const frame = window.requestAnimationFrame(() => inspectorRef.current?.querySelector('[role="tab"][aria-selected="true"]')?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [phoneLayout, drawerOpen]);
  useEffect(() => {
    if (!legendOpen) return undefined;
    const frame = window.requestAnimationFrame(() => document.querySelector('#map-key-panel button')?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [legendOpen]);
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
  const focusInspector = useCallback(() => {
    window.requestAnimationFrame(() => {
      const inspector = inspectorRef.current;
      ((notebook ? inspector?.querySelector('.inspector-done') : inspector?.querySelector('[role="tab"][aria-selected="true"]'))
        || inspector?.querySelector('button, input, select, textarea'))?.focus({ preventScroll: true });
      const scroll = inspector?.querySelector('.inspector__scroll');
      if (scroll) scroll.scrollTop = 0;
    });
  }, []);
  // Notebook navigation preserves the stage record and opens the matching task.
  const changePanel = (mode) => {
    setCollapsedPanel(null);
    notebook?.onChange(true);
    if (mode === 'inspector') {
      setInspectorTab('map');
      setLegendOpen(false);
      setMoveMenuOpen(false);
      onPanelMode?.('inspector');
      setDrawerOpen(true);
      notebook?.onChange(true);
      focusInspector();
      return;
    }
    onPanelMode?.(mode);
  };
  const cancelConnection = useCallback(() => {
    const source = project.graph.nodes.find(node => node.id === connectionSource && isLiveMapItem(node));
    setConnecting(false); setConnectionSource(null); setAddMode(null); setFocus(null);
    setSelection(source ? { kind: 'node', id: source.id } : null); setInspectorTab('node');
    setDrawerOpen(false); notebook?.onChange(false);
    setAnnouncement('Connection cancelled.');
    window.requestAnimationFrame(() => {
      const nodes = canvasWrapRef.current?.querySelectorAll('[data-graph-id]') || [];
      ([...nodes].find(node => node.getAttribute('data-graph-id') === source?.id) || canvasWrapRef.current?.querySelector('.graph-canvas'))?.focus();
    });
  }, [connectionSource, project.graph.nodes, notebook?.onChange, setAnnouncement]);
  const startConnection = (sourceId) => {
    if (project.activeScale !== 'meso' || !project.instructor.allowResearchLeads) return;
    const available = project.graph.nodes.filter(node => node.scale === 'micro' && isLiveMapItem(node));
    const source = available.find(node => node.id === sourceId);
    if (!source || available.length < 2) return;
    setVisibleScale(project.activeScale); setPresentation('canvas'); setConnecting(true);
    setConnectionSource(source.id); setSelection({ kind: 'node', id: source.id }); setFocus(null); setAddMode(null);
    setDrawerOpen(false); notebook?.onChange(false); setToolsOpen(false);
    setAnnouncement(`${source.label} selected. Choose the ending item.`);
    window.requestAnimationFrame(() => {
      const nodes = canvasWrapRef.current?.querySelectorAll('[data-graph-id]') || [];
      [...nodes].find(node => node.getAttribute('data-graph-id') === source.id)?.focus();
    });
  };
  const selectItem = useCallback((kind, id, openInspector = true, tap = null) => {
    if (openInspector && tap?.pointerType === 'touch') consumedCanvasTapRef.current = tap;
    if (connecting) {
      // Pointer-down and arrow-key movement keep the chosen source. Only a
      // completed tap or explicit keyboard activation chooses its target.
      if (!openInspector || kind !== 'node' || project.activeScale !== 'meso') return;
      const source = project.graph.nodes.find(item => item.id === connectionSource && item.scale === 'micro' && isLiveMapItem(item));
      const node = project.graph.nodes.find((item) => item.id === id);
      if (!source || !node || node.scale !== 'micro' || !isLiveMapItem(node)) return;
      if (id === connectionSource) { setAnnouncement('Choose a different ending item.'); return; }
      setNewEdge({ source: connectionSource, target: id, verb: '', evidence: '', claimState: 'research lead', relationshipProcess: createRelationshipProcess({ direction: 'source to target' }) });
      setConnecting(false); setFocus(null); setSelection(null);
      setAddMode('edge'); setInspectorTab('relationships'); setDrawerOpen(true);
      onPanelMode?.('inspector'); notebook?.onChange(true); focusInspector();
      return;
    }
    if (openInspector && !inspectorRef.current?.contains(document.activeElement)) selectionTriggerRef.current = document.activeElement;
    setTraceHistory([]);
    setAddMode(null);
    onHighlight?.(null);
    setSelection({ kind, id });
    setInspectorTab(kind === 'edge' ? 'relationships' : 'node');
    if (openInspector) {
      setFocus(phoneLayout && notebook && kind === 'node' && ['micro', 'meso'].includes(visibleScale) ? null : { kind, id });
      setFocusPage(0);
      setLegendOpen(false);
      setCreateMenuOpen(false);
      if (panelContent) onPanelMode?.('inspector');
      setDrawerOpen(true);
      notebook?.onChange(true);
      focusInspector();
    }
  }, [connecting, connectionSource, project.activeScale, project.graph.nodes, visibleScale, phoneLayout, focusInspector, panelContent, onPanelMode, onHighlight, notebook?.onChange]);
  const closeInspector = useCallback(() => {
    if (connecting || (addMode === 'edge' && connectionSource)) { cancelConnection(); return; }
    inspectorRef.current?.querySelectorAll('.export-dropdown[open]').forEach((details) => { details.open = false; });
    setCollapsedPanel(panelMode);
    notebook?.onChange(false);
    setDrawerOpen(false);
    window.requestAnimationFrame(() => {
      const targets = canvasWrapRef.current?.querySelectorAll('[data-graph-id]') || [];
      const target = selection?.id ? [...targets].find((element) => element.getAttribute('data-graph-id') === selection.id) : null;
      const trigger = selectionTriggerRef.current;
      (target || (trigger?.isConnected ? trigger : null) || canvasWrapRef.current?.querySelector('.graph-canvas'))?.focus();
    });
  }, [selection, panelMode, notebook?.onChange, connecting, addMode, connectionSource, cancelConnection]);
  const showFullMap = useCallback(() => {
    phoneOverviewViewportKeyRef.current = '';
    onHighlight?.(null);
    setTraceHistory([]);
    setFocus(null);
    setFocusPage(0);
    setSelection(null);
    setInspectorTab('map');
    setDrawerOpen(false);
    notebook?.onChange(false);
    let nodes = scaleNodes.map((node) => ({ ...node, ...(automaticPositions?.get(node.id) || {}) }));
    if (phoneLayout) {
      const projection = innerMap ? phoneOverviewProjection(scaleNodes, project.layout) : arrangedEcologyPositions(scaleNodes, true, interactionEcologyBands);
      nodes = scaleNodes.map(node => ({ ...node, ...(projection?.get(node.id) || {}) }));
    }
    setRingExpansion(1);
    setMapViewport(readingViewport(nodes.length ? nodes : project.graph.nodes, visibleScale, visibleRelationshipBounds));
    setAnnouncement('Full map shown.');
    window.requestAnimationFrame(() => canvasWrapRef.current?.querySelector('.graph-canvas')?.focus());
  }, [automaticPositions, innerMap, interactionEcologyBands, phoneLayout, project.graph.nodes, project.layout?.phoneOverview, readingViewport, scaleNodes, setAnnouncement, visibleRelationshipBounds, visibleScale]);
  const changeVisibleScale = (nextScale) => {
    phoneOverviewViewportKeyRef.current = '';
    setConnecting(false); setConnectionSource(null); setAddMode(null);
    setTraceHistory([]);
    const nextEdges = project.graph.edges.filter((edge) => nextScale !== 'micro' && edge.scale !== 'micro' && edge.status !== 'rejected'
      && edge.claimState !== 'retired'
      && (nextScale === 'all' ? project.releasedScales.includes(edge.scale) : edge.scale === nextScale));
    const endpointIds = new Set(nextEdges.flatMap((edge) => [edge.source, edge.target]));
    if (['meso', 'macrosphere'].includes(nextScale) || nextScale === 'all') {
      project.graph.nodes.filter((node) => ['meso', 'macrosphere'].includes(node.scale)
        && (nextScale === 'all' || node.scale === nextScale)
        && node.status !== 'rejected' && node.claimState !== 'retired')
        .forEach((node) => (node.scopeNodeIds || []).forEach((memberId) => endpointIds.add(memberId)));
    }
    let nextNodes = project.graph.nodes.filter((node) => node.scale !== 'meso' && node.status !== 'rejected'
      && node.claimState !== 'retired'
      && (nextScale === 'all' ? project.releasedScales.includes(node.scale) : node.scale === nextScale || (nextScale === 'meso' && node.scale === 'micro') || endpointIds.has(node.id)))
      .map((node) => ({ ...node, ...(!['micro', 'meso'].includes(nextScale) ? automaticPositions?.get(node.id) || {} : {}) }));
    if (phoneLayout && nextNodes.length) {
      const projection = ['micro', 'meso'].includes(nextScale)
        ? phoneOverviewProjection(nextNodes, project.layout)
        : arrangedEcologyPositions(nextNodes, true, interactionEcologyBands);
      nextNodes = nextNodes.map(node => ({ ...node, ...(projection?.get(node.id) || {}) }));
    }
    setVisibleScale(nextScale);
    setFocus(null);
    setFocusPage(0);
    setSelection(null);
    setInspectorTab('map');
    setDrawerOpen(false);
    setRingExpansion(1);
    const nextLabelBounds = focusedEcologyCalloutBounds(
      nextEdges.map((edge) => ({ ...edge, showLabel: nextScale !== 'all' })),
      nextNodes,
      new Map(nextNodes.map((node) => [node.id, { x: node.x, y: node.y }])),
      phoneLayout,
    );
    setMapViewport(readingViewport(nextNodes, nextScale, nextLabelBounds));
    setAnnouncement(`${nextScale === 'all' ? 'All layers' : SCALES[nextScale]?.label || nextScale} shown.`);
  };
  const followMapItem = (kind, id) => {
    const item = kind === 'node' ? connectionIndex.nodeById.get(id) : project.graph.edges.find((edge) => edge.id === id);
    if (!item) return;
    const previous = selection ? [...traceHistory, { selection, visibleScale, focusPage, presentation }].slice(-12) : [];
    const legacyMesoRecord = kind === 'node' && item.scale === 'meso';
    const alreadyVisible = kind === 'node' ? scaleNodeIds.has(id) || (legacyMesoRecord && visibleScale === 'meso') : scaleEdges.some(edge => edge.id === id);
    if (visibleScale !== 'all' && !alreadyVisible) changeVisibleScale('all');
    if (legacyMesoRecord) {
      setPresentation('list');
      setFullscreen(false);
    }
    selectItem(kind, id);
    setTraceHistory(previous);
    setAnnouncement(`Opened ${kind === 'node' ? item.label : relationshipDescription(item)}${legacyMesoRecord ? ' in List' : ''}.`);
  };
  const returnToPreviousItem = () => {
    const previous = traceHistory.at(-1);
    if (!previous) return;
    const remaining = traceHistory.slice(0, -1);
    if (previous.visibleScale !== visibleScale) changeVisibleScale(previous.visibleScale);
    setPresentation(previous.presentation || 'canvas');
    selectItem(previous.selection.kind, previous.selection.id);
    setFocusPage(previous.focusPage);
    setTraceHistory(remaining);
  };
  const previousTraceItem = traceHistory.at(-1)?.selection;
  const previousTraceLabel = previousTraceItem?.kind === 'node'
    ? connectionIndex.nodeById.get(previousTraceItem.id)?.label
    : project.graph.edges.find((edge) => edge.id === previousTraceItem?.id)?.verb;
  const snapshotLayout = useCallback(() => ({
    positions: new Map(project.graph.nodes.map((node) => [node.id, {
      x: node.x, y: node.y, ...(automaticPositions?.get(node.id) || {}),
      ...(phoneOverviewPositions?.get(node.id) || {}), ...(phoneEcologyPositions?.get(node.id) || {}),
    }])),
    viewport: mapViewport || project.viewport,
  }), [project.graph.nodes, project.viewport, automaticPositions, phoneOverviewPositions, phoneEcologyPositions, mapViewport]);
  const rememberLayout = useCallback(() => {
    const snapshot = snapshotLayout();
    setLayoutHistory((history) => ({ past: [...history.past, snapshot].slice(-30), future: [] }));
  }, [snapshotLayout]);
  const restoreLayout = (direction) => {
    const from = direction === 'undo' ? layoutHistory.past : layoutHistory.future;
    const snapshot = from.at(-1);
    if (!snapshot) return;
    const current = snapshotLayout();
    setLayoutHistory(direction === 'undo'
      ? { past: from.slice(0, -1), future: [...layoutHistory.future, current] }
      : { past: [...layoutHistory.past, current], future: from.slice(0, -1) });
    update((draft) => {
      if (phoneLayout && mapMode === 'network') draft.layout = { phoneOverview: 'preserve' };
      draft.graph.nodes.forEach((node) => {
        const position = snapshot.positions.get(node.id);
        if (position) Object.assign(node, position);
      });
      draft.viewport = snapshot.viewport;
    }, 'map.layout-restored', direction === 'undo' ? 'Layout change undone' : 'Layout change redone');
    setAutomaticPositions(null);
    setMapViewport(snapshot.viewport);
    setRingExpansion(1);
    if (phoneLayout && mapMode === 'network') setPhoneOverviewCommittedScope(phoneOverviewScope);
    if (phoneLayout && mapMode === 'ecology') setPhoneEcologyCommittedScope(phoneEcologyScope);
    setAnnouncement(direction === 'undo' ? 'Layout change undone.' : 'Layout change redone.');
  };
  const moveNode = useCallback((id, x, y, method) => {
    const displayedNodeIds = new Set(displayedNodes.map((node) => node.id));
    const displayedNode = displayedNodes.find((node) => node.id === id);
    const safePosition = displayedNode
      ? relationshipSafeNodePosition(displayedNode, x, y, displayedNodes, visibleEdges, phoneLayout, mapMode, interactionEcologyBands)
      : { x, y };
    rememberLayout();
    update((draft) => {
      if (phoneLayout && mapMode === 'network') draft.layout = { phoneOverview: 'preserve' };
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
      if (node) { node.x = safePosition.x; node.y = safePosition.y; }
      if (phoneOverviewPositions || phoneEcologyPositions) draft.viewport = mapViewport || fitViewport(displayedNodes, phoneFitHeight, true);
    });
    if (phoneOverviewPositions) setPhoneOverviewCommittedScope(phoneOverviewScope);
    if (phoneEcologyPositions) setPhoneEcologyCommittedScope(phoneEcologyScope);
    setAutomaticPositions(null);
    setLayoutMeasurementRevision(revision => revision + 1);
    logPrototype('node_moved', { keyboard: method === 'keyboard', pointer: method === 'pointer' });
  }, [automaticPositions, displayedNodes, logPrototype, mapMode, mapViewport, phoneEcologyPositions, phoneEcologyScope, phoneLayout, phoneOverviewPositions, phoneOverviewScope, rememberLayout, interactionEcologyBands, update, visibleEdges]);
  const minimumInteractiveZoom = VIEWPORT_LIMITS.minZoom;
  const changeViewport = useCallback((next) => {
    const bounded = {
      panX: clamp(Math.round(next.panX), VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan),
      panY: clamp(Math.round(next.panY), VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan),
      zoom: clamp(Number(next.zoom.toFixed(2)), minimumInteractiveZoom, VIEWPORT_LIMITS.maxZoom),
    };
    if (legacyPhoneDrawer) setPhoneViewport(bounded);
    if (focusedEcologyPositions || phoneRelationshipPositions) {
      setMapViewport(bounded);
      logPrototype('viewport_changed');
      return;
    }
    setMapViewport(null);
    update((draft) => {
      if (phoneLayout && mapMode === 'network') draft.layout = { phoneOverview: 'preserve' };
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
  }, [update, logPrototype, legacyPhoneDrawer, phoneLayout, mapMode, focusedEcologyPositions, minimumInteractiveZoom, phoneEcologyPositions, phoneEcologyScope, phoneOverviewPositions, phoneOverviewScope, phoneRelationshipPositions]);
  const zoomBy = (amount) => {
    const requested = legacyPhoneDrawer && phoneViewport ? phoneViewport : mapViewport || project.viewport;
    const current = requested;
    const zoom = clamp(current.zoom + amount, minimumInteractiveZoom, VIEWPORT_LIMITS.maxZoom);
    const mapCenterX = (GRAPH_WIDTH / 2 - current.panX) / current.zoom;
    const mapCenterY = (GRAPH_HEIGHT / 2 - current.panY) / current.zoom;
    if (mapMode === 'ecology' && !(focusedEcologyPositions || phoneRelationshipPositions) && zoom !== current.zoom) {
      const nextExpansion = resizedEcologyRingExpansion(ringExpansion, current.zoom, zoom);
      setRingExpansion(nextExpansion);
      if (!phoneLayout && amount < 0) {
        // Ring expansion moves centers about ECOLOGY_CENTER, not about the
        // old camera center. Refit the expanded semantic geometry so a
        // right-weighted map does not push its outermost card off screen.
        const expandedNodes = (displayedNodes.length ? displayedNodes : project.graph.nodes)
          .map(node => ({ ...node, ...expandEcologyPosition(node, nextExpansion) }));
        const expandedPositions = new Map(expandedNodes.map(node => [node.id, { x: node.x, y: node.y }]));
        const expandedBounds = focusedEcologyCalloutBounds(visibleEdges, expandedNodes, expandedPositions, false);
        const fitted = fitViewport(expandedNodes, 420, false, expandedBounds, minimumInteractiveZoom);
        const nextZoom = Math.max(minimumInteractiveZoom, Math.floor(Math.min(zoom, fitted.zoom) * 100) / 100);
        const fittedCenterX = (GRAPH_WIDTH / 2 - fitted.panX) / fitted.zoom;
        const fittedCenterY = (GRAPH_HEIGHT / 2 - fitted.panY) / fitted.zoom;
        changeViewport({
          zoom: nextZoom,
          panX: GRAPH_WIDTH / 2 - fittedCenterX * nextZoom,
          panY: GRAPH_HEIGHT / 2 - fittedCenterY * nextZoom,
        });
        setAnnouncement(`Map zoom ${Math.round(nextZoom * 100)} percent.`);
        return;
      }
    }
    changeViewport({ zoom, panX: GRAPH_WIDTH / 2 - mapCenterX * zoom, panY: GRAPH_HEIGHT / 2 - mapCenterY * zoom });
    setAnnouncement(`Map zoom ${Math.round(zoom * 100)} percent.`);
  };
  const fitMap = () => {
    const nodes = displayedNodes.length ? displayedNodes : project.graph.nodes;
    const detailLayout = focusedEcologyPositions || phoneRelationshipPositions;
    const nextViewport = fitViewport(
      nodes,
      phoneLayout ? phoneFitHeight : 420,
      phoneLayout,
      visibleRelationshipBounds,
      VIEWPORT_LIMITS.minZoom,
    );
    setRingExpansion(1);
    if (phoneOverviewPositions || phoneEcologyPositions || detailLayout) {
      setMapViewport(nextViewport);
      setAnnouncement('Map fitted to view.');
      return;
    }
    changeViewport(nextViewport);
    setAnnouncement('Map fitted to view.');
  };
  const arrangeMap = () => {
    rememberLayout();
    const liveNodes = project.graph.nodes.filter((node) => node.scale !== 'meso' && (showRemoved || node.claimState !== 'retired'));
    const nodes = visibleScale === 'all' ? liveNodes : visibleNodes.length ? visibleNodes : liveNodes;
    const positions = mapMode === 'ecology'
      ? phoneLayout && visibleScale === 'micro' ? arrangedPhoneMicroPositions(nodes) : arrangedEcologyPositions(nodes, phoneLayout, interactionEcologyBands)
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
    setRingExpansion(1);
    update((draft) => {
      if (phoneLayout && mapMode === 'network') draft.layout = { phoneOverview: 'preserve' };
      draft.graph.nodes.forEach((node) => {
        const position = positions.get(node.id);
        if (position) Object.assign(node, position);
      });
      draft.viewport = nextViewport;
    }, 'map.arranged', visibleScale === 'all' ? 'All layers arranged' : `${SCALES[visibleScale]?.label || visibleScale} arranged`);
    setAutomaticPositions(null);
    setLayoutMeasurementRevision(revision => revision + 1);
    setMapViewport(null);
    if (phoneLayout && mapMode === 'network') setPhoneOverviewCommittedScope(phoneOverviewScope);
    if (phoneLayout && mapMode === 'ecology') setPhoneEcologyCommittedScope(phoneEcologyScope);
    if (legacyPhoneDrawer) setPhoneViewport(nextViewport);
    logPrototype('map_arranged');
    setAnnouncement(visibleScale === 'all' ? 'All layers arranged.' : `${SCALES[visibleScale]?.label || visibleScale} arranged.`);
    toast(visibleScale === 'all' ? 'Map arranged by layer.' : 'Map arranged.');
  };
  const dependentMapItems = (nodeId) => ({
    scopes: project.graph.nodes.filter((node) => node.status !== 'rejected' && node.claimState !== 'retired' && (node.scopeNodeIds || []).includes(nodeId)),
    memberships: project.graph.nodes.filter((node) => node.status !== 'rejected' && node.claimState !== 'retired' && (node.settingNodeIds || []).includes(nodeId)),
    relationships: project.graph.edges.filter((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired' && (edge.source === nodeId || edge.target === nodeId)),
  });
  const dependencyMessage = (nodeId, action) => {
    const dependencies = dependentMapItems(nodeId);
    const labels = [
      ...dependencies.scopes.map((node) => node.label),
      ...dependencies.memberships.map((node) => `${node.label} (setting membership)`),
      ...dependencies.relationships.map((edge) => relationshipDescription(edge)),
    ];
    if (!labels.length) return '';
    return `Review or remove connected map work before ${action}: ${labels.join('; ')}.`;
  };
  const editNode = (field, value) => {
    if (!selectedNode) return;
    if (field === 'label') {
      const issue = nodeLabelIssue(value, selectedNode, project.graph.nodes);
      if (issue) return toast(issue, 'error');
      update((draft) => reviseMapText(draft, 'graph', 'nodes', selectedNode.id, value));
      return;
    }
    if (field === 'scale') return toast('A node’s level is fixed after it is mapped. Remove it and add it at the correct level instead.', 'error');
    if (field === 'type' && !isNodeTypeAllowedAtScale(value, selectedNode.scale)) return toast(`That type does not belong at ${SCALES[selectedNode.scale].label}.`, 'error');
    if (field === 'type' && selectedNode.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(value) && (selectedNode.settingNodeIds || []).length) return toast('Remove the immediate setting memberships before changing this item to a setting.', 'error');
    if (field === 'scopeNodeIds' && ['meso', 'macrosphere'].includes(selectedNode.scale) && value.length < 2) return toast(selectedNode.scale === 'meso' ? 'A mesosystem must include at least two Micro settings.' : 'A Macro-level condition must affect at least two map items.', 'error');
    const settingRoleRemoved = field === 'type' && selectedNode.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(selectedNode.type) && !MICRO_SETTING_NODE_TYPE_SET.has(value);
    if (settingRoleRemoved) {
      const message = dependencyMessage(selectedNode.id, 'changing this setting type');
      if (message) return toast(message, 'error');
    }
    update((draft) => {
      const node = draft.graph.nodes.find((item) => item.id === selection?.id);
      if (!node) return;
      node[field] = value;
      node.reviewDecision = 'added';
      node.claimState = 'student interpretation';
      const candidate = correspondingNode(node, draft.candidates.nodes);
      if (candidate) { candidate[field] = value; candidate.reviewDecision = 'added'; candidate.claimState = 'student interpretation'; }
    });
  };
  const editEdge = (field, value) => {
    if (!selectedEdge) return;
    if (field === 'verb') {
      const issue = relationshipIssue(value, selectedEdge);
      if (issue) return toast(issue, 'error');
      update((draft) => reviseMapText(draft, 'graph', 'edges', selectedEdge.id, value));
      return;
    }
    if (field === 'relationshipProcess' && !['meso', 'exosphere'].includes(selectedEdge.scale)) return;
    update((draft) => {
      const edge = draft.graph.edges.find((item) => item.id === selection?.id);
      if (!edge) return;
      const previousSourceLabel = edge.sourceLabel;
      const previousTargetLabel = edge.targetLabel;
      const previousVerb = edge.verb;
      edge[field] = value;
      edge.reviewDecision = 'added';
      edge.claimState = 'student interpretation';
      const candidate = draft.candidates.edges.find((item) => item.id === edge.id)
        || draft.candidates.edges.find((item) => item.scale === edge.scale
          && item.sourceLabel === previousSourceLabel && item.targetLabel === previousTargetLabel && item.verb === previousVerb);
      if (candidate) { candidate[field] = value; candidate.reviewDecision = 'added'; candidate.claimState = 'student interpretation'; }
    });
  };
  const setSelectedRemoved = (removed) => {
    if (!selection) return;
    if (removed && selection.kind === 'node') {
      const message = dependencyMessage(selection.id, `removing ${selectedNode?.label || 'this node'}`);
      if (message) return toast(message, 'error');
    }
    if (!removed && selection.kind === 'node' && containsRetiredSystemsLanguage(selectedNode?.label)) return toast('Rename this item with a direct, conventional name before returning it to the map.', 'error');
    if (!removed && selection.kind === 'node' && ['meso', 'macrosphere'].includes(selectedNode?.scale)) {
      const memberById = new Map(project.graph.nodes.map((node) => [node.id, node]));
      const membersAreAvailable = (selectedNode.scopeNodeIds || []).length >= 2 && selectedNode.scopeNodeIds.every((id) => {
        const member = memberById.get(id);
        return member && member.status !== 'rejected' && member.claimState !== 'retired'
          && (selectedNode.scale !== 'meso' || (member.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(member.type)));
      });
      if (!membersAreAvailable) return toast(selectedNode.scale === 'meso' ? 'Restore at least two included Micro settings before returning this mesosystem to the map.' : 'Restore at least two affected map items before returning this Macro-level condition to the map.', 'error');
    }
    if (!removed && selection.kind === 'node' && selectedNode?.scale === 'exosphere' && !isNamedInstitutionLabel(selectedNode.label)) {
      return toast('Rename this item with the full name of an outside office, agency, employer, funder, or service system before returning it to the map.', 'error');
    }
    if (!removed && selection.kind === 'node' && selectedNode?.scale === 'micro' && !isDiscreteMicroNodeLabel(selectedNode.label)) {
      return toast('Name one specific person, role, group, activity, object, or immediate setting before returning it to the map.', 'error');
    }
    if (!removed && selection.kind === 'node' && !isCanonicalMapElementLabel(selectedNode?.label, selectedNode?.scale)) {
      return toast('Name one complete map item instead of a reference, time, modifier, action, or fragment.', 'error');
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
      if (edge.scale === 'meso' && (sourceNode?.scale !== 'micro' || targetNode?.scale !== 'micro')) return toast('A Meso relationship must connect two Micro-level items.', 'error');
      if (edge.scale === 'exosphere' && (!isExosphereDecisionPathway(sourceNode, targetNode) || !scaleLexiconVerb('exosphere', edge.verb))) return toast('This Exo-level connection must run from one outside decision setting to one Micro setting already on the map.', 'error');
    }
    update((draft) => {
      const items = selection.kind === 'node' ? draft.graph.nodes : draft.graph.edges;
      const item = items.find((candidate) => candidate.id === selection.id);
      if (!item) return;
      item.status = removed ? 'rejected' : 'confirmed';
      item.claimState = removed ? 'retired' : 'student interpretation';
      item.reviewDecision = removed ? 'removed' : 'added';
      const candidates = selection.kind === 'node' ? draft.candidates.nodes : draft.candidates.edges;
      const candidate = candidates.find((entry) => entry.id === selection.id)
        || (selection.kind === 'node'
          ? candidates.find((entry) => entry.scale === item.scale && entry.label === item.label)
          : candidates.find((entry) => entry.scale === item.scale
            && entry.sourceLabel === item.sourceLabel && entry.targetLabel === item.targetLabel && entry.verb === item.verb));
      if (candidate) {
        candidate.status = item.status;
        candidate.claimState = item.claimState;
        candidate.reviewDecision = item.reviewDecision;
      }
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
    && (project.activeScale !== 'meso' || node.scale === 'micro')
    && ['meso', 'exosphere'].includes(project.activeScale));
  const mapMicroSettingOptions = project.graph.nodes
    .filter((node) => node.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(node.type));
  const relationshipSourceNodes = project.activeScale === 'exosphere'
    ? relationshipNodes.filter((node) => node.scale === 'exosphere')
    : relationshipNodes;
  const relationshipTargetNodes = project.activeScale === 'exosphere'
    ? relationshipNodes.filter((node) => node.scale === 'exosphere' || node.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(node.type))
    : relationshipNodes;
  const relationshipSource = relationshipSourceNodes.find((node) => node.id === newEdge.source) || relationshipSourceNodes[0];
  const relationshipTarget = relationshipTargetNodes.find((node) => node.id === newEdge.target && node.id !== relationshipSource?.id)
    || relationshipTargetNodes.find((node) => node.id !== relationshipSource?.id);
  const addNode = () => {
    if (!project.instructor.allowResearchLeads) return toast('Items needing more evidence are turned off for this project.', 'error');
    if (project.activeScale === 'meso' && newNode.scale !== 'micro') return toast('Add the missing person or setting to Micro, then connect it here.', 'error');
    if (project.activeScale === 'macrosphere') return toast('Add Macro-level conditions from the Choose stage so each one identifies the map items it affects.', 'error');
    if (project.graph.nodes.length >= PROJECT_LIMITS.nodes) return toast(`This map already contains the maximum ${PROJECT_LIMITS.nodes} nodes.`, 'error');
    if (!newNode.label.trim()) return toast('Name the node before adding it.', 'error');
    if (!isCanonicalMapElementLabel(newNode.label, newNode.scale)) return toast('Name one complete map item instead of a reference, time, modifier, action, or fragment.', 'error');
    if (containsRetiredSystemsLanguage(newNode.label)) return toast('Use a direct, conventional name for the map item.', 'error');
    if (!isNodeTypeAllowedAtScale(newNode.type, newNode.scale) || ['meso', 'macrosphere'].includes(newNode.scale)) return toast('Choose a type and level that belong together.', 'error');
    if (newNode.scale === 'micro' && !isDiscreteMicroNodeLabel(newNode.label)) return toast('Name one specific person, role, group, activity, object, or immediate setting.', 'error');
    if (newNode.scale === 'exosphere' && !isNamedInstitutionLabel(newNode.label)) return toast('Use the full name of an outside office, agency, employer, funder, or service system.', 'error');
    if (project.instructor.evidenceRequired && !newNode.evidence.trim()) return toast('Add evidence or a question before adding the node.', 'error');
    const id = stableId('node', `${newNode.label}:${Date.now()}`);
    const claimEvidence = newNode.evidence.trim()
      ? [createClaimEvidenceRecord({ sourcePassage: newNode.evidence.trim() }, { ownerId: id, index: 0 })]
      : [];
    const microContext = newNode.scale === 'micro'
      ? {
        focalParticipation: FOCAL_PARTICIPATION_STATES.includes(newNode.focalParticipation) ? newNode.focalParticipation : 'direct',
        settingNodeIds: Array.isArray(newNode.settingNodeIds) ? newNode.settingNodeIds : [],
      }
      : {};
    const { focalParticipation: _focalParticipation, settingNodeIds: _settingNodeIds, ...baseNewNode } = newNode;
    update((draft) => {
      const [added] = withDefaultNodeLayout([{ ...baseNewNode, ...microContext, label: newNode.label.trim(), id, status: 'confirmed', notes: '', claimEvidence, origin: 'student entry', reviewDecision: 'added' }]);
      placeNewMapNodes([...draft.graph.nodes, added], new Set([id]));
      draft.graph.nodes.push(added);
    }, 'node.added', newNode.label.trim());
    setFocus(null);
    setVisibleScale(project.activeScale);
    setSelection({ kind: 'node', id });
    setInspectorTab('node');
    setNewEdge((current) => ({
      ...current,
      source: current.source || id,
      target: !current.target || current.target === current.source ? id : current.target,
    }));
    setNewNode(blankManualNode(project.activeScale));
    setAddMode(null);
    toast(project.activeScale === 'meso' ? 'Item added to Micro. Connect it here in Meso.' : 'Node added.');
  };
  const addEdge = () => {
    if (!project.instructor.allowResearchLeads) return toast('Items needing more evidence are turned off for this project.', 'error');
    if (project.activeScale === 'micro') return toast('Choose Meso to connect the items on your map.', 'error');
    if (project.activeScale === 'macrosphere') return toast('Macro-level conditions identify the map items they affect. Add direct connections at Meso-level.', 'error');
    if (project.graph.edges.length >= PROJECT_LIMITS.edges) return toast(`This map already contains the maximum ${PROJECT_LIMITS.edges} relationships.`, 'error');
    const source = relationshipSource;
    const target = relationshipTarget;
    if (!source || !target || source.id === target.id) return toast('Choose two different nodes.', 'error');
    if (!newEdge.verb.trim()) return toast('Describe the connection before adding the relationship.', 'error');
    if (project.activeScale === 'meso' && (source.scale !== 'micro' || target.scale !== 'micro')) return toast('Choose two Micro items for this relationship.', 'error');
    if (project.activeScale === 'exosphere') {
      const carriedMicroNodeIds = new Set(relationshipTargetNodes.map((node) => node.id));
      if (!isOrientedExospherePathway(source, target, carriedMicroNodeIds)) return toast('Connect an outside decision setting to an affected Micro setting or outside office.', 'error');
    }
    const canonicalVerb = project.activeScale === 'exosphere' ? scaleLexiconVerb('exosphere', newEdge.verb) : newEdge.verb.trim();
    if (!canonicalVerb) return toast('Choose how the institution affects the Micro setting: funds, regulates, employs, or provides.', 'error');
    if (project.instructor.evidenceRequired && !newEdge.evidence.trim()) return toast('Add evidence or a question before adding the relationship.', 'error');
    if (project.graph.edges.some((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired' && edge.source === source.id && edge.target === target.id && edge.verb.trim().toLocaleLowerCase() === canonicalVerb.toLocaleLowerCase())) return toast('This relationship is already on the map. Select it to edit its direction or evidence.', 'error');
    const id = stableId('edge', `${source.id}:${newEdge.verb}:${target.id}:${Date.now()}`);
    const claimEvidence = newEdge.evidence.trim()
      ? [createClaimEvidenceRecord({ sourcePassage: newEdge.evidence.trim() }, { ownerId: id, index: 0 })]
      : [];
    update((draft) => { draft.graph.edges.push({ ...newEdge, relationshipProcess: createRelationshipProcess({ ...newEdge.relationshipProcess, direction: newEdge.relationshipProcess?.direction || 'source to target' }), verb: canonicalVerb, id, source: source.id, target: target.id, sourceLabel: source.label, targetLabel: target.label, scale: project.activeScale, status: 'confirmed', notes: '', claimEvidence, origin: 'student entry', reviewDecision: 'added', annotation: { id: stableId('annotation', `edge:${id}:relationship`), text: '' } }); }, 'edge.added', relationshipDescription({ ...newEdge, verb: canonicalVerb }, source.label, target.label));
    setSelection({ kind: 'edge', id });
    setInspectorTab('relationships');
    setConnectionSource(null);
    setAddMode(null);
    toast('Relationship added.');
  };
  const requestedViewport = legacyPhoneDrawer && phoneViewport ? phoneViewport : mapViewport || project.viewport;
  const canvasViewport = {
    ...requestedViewport,
    zoom: clamp(requestedViewport.zoom, minimumInteractiveZoom, VIEWPORT_LIMITS.maxZoom),
  };
  const moveMapBy = (dx, dy, label) => {
    changeViewport({
      ...canvasViewport,
      panX: clamp(canvasViewport.panX + dx, VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan),
      panY: clamp(canvasViewport.panY + dy, VIEWPORT_LIMITS.minPan, VIEWPORT_LIMITS.maxPan),
    });
    setAnnouncement(`Map moved ${label}.`);
  };
  const moveSelectedNodeBy = (dx, dy, label) => {
    if (!selectedNode) return;
    const displayed = displayedNodes.find((node) => node.id === selectedNode.id) || selectedNode;
    moveNode(selectedNode.id, displayed.x + dx, displayed.y + dy, 'button');
    setAnnouncement(`${selectedNode.label} moved ${label}.`);
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
      ? <>Showing map items affected by <strong>{focusLabel}</strong>.</>
      : <>Showing connections for <strong>{focusLabel}</strong>.</>;
  const inspectorTabs = visibleScale === 'macrosphere' && !selectedEdge
    ? INSPECTOR_TABS.filter((tab) => tab !== 'relationships')
    : INSPECTOR_TABS;
  const focusHasRelationshipPages = phoneLayout && focus?.kind === 'node' && focusIncidentEdges.length > 0;
  const mapOverviewHint = visibleScale === 'meso'
    ? 'Select an item to connect it or inspect its evidence'
    : visibleScale === 'macrosphere'
      ? 'Select a condition to view affected items'
      : 'Select an item to inspect its connections';
  const changeFocusPage = (nextPage) => {
    const boundedPage = clamp(nextPage, 0, focusPageCount - 1);
    setFocusPage(boundedPage);
    setAnnouncement(`Showing relationship ${boundedPage + 1} of ${focusIncidentEdges.length} for ${focusLabel}.`);
  };
  const closeLegend = useCallback(() => {
    setLegendOpen(false);
    setAnnouncement('Map key closed.');
    window.requestAnimationFrame(() => (notebook ? document.querySelector('.notebook-map-tools > summary') : legendTriggerRef.current)?.focus());
  }, [setAnnouncement]);
  const toggleLegend = () => {
    if (legendOpen) {
      closeLegend();
      return;
    }
    setDrawerOpen(false);
    setMoveMenuOpen(false);
    setCreateMenuOpen(false);
    setLegendOpen(true);
    setAnnouncement('Map key opened.');
    window.requestAnimationFrame(() => document.querySelector('#map-key-panel button')?.focus());
  };
  const toggleFullscreen = () => {
    const next = !fullscreen;
    if (!next) restoreFullscreenFocusRef.current = true;
    setFullscreen(next);
    setRingExpansion(1);
    setAnnouncement(next ? 'Full screen map opened. Press Escape to exit.' : 'Full screen map closed.');
    if (next) {
      setToolsOpen(false);
      setPresentation('canvas');
      setLegendOpen(false);
      setDrawerOpen(false);
      notebook?.onChange(false);
      const nodes = displayedNodes.length ? displayedNodes : project.graph.nodes;
      setMapViewport(fitViewport(
        nodes,
        phoneLayout ? phoneFitHeight : 420,
        phoneLayout,
        visibleRelationshipBounds,
        VIEWPORT_LIMITS.minZoom,
      ));
    }
  };
  const changePresentation = (next) => {
    if (!['canvas', 'list'].includes(next) || next === presentation) return;
    if (next === 'list' && fullscreen) {
      setFullscreen(false);
      setRingExpansion(1);
    }
    setPresentation(next);
    setLegendOpen(false);
    setMoveMenuOpen(false);
    setAnnouncement(next === 'list' ? 'Map list opened.' : 'Map canvas opened.');
  };
  const notebookControls = <div className="notebook-toolbar-actions">
    {fullscreen && <button className="map-fullscreen-exit" type="button" onClick={toggleFullscreen}>Exit full screen</button>}
    <MapTools open={toolsOpen} onOpenChange={setToolsOpen} scales={project.releasedScales}
          scale={visibleScale} onScale={changeVisibleScale} presentation={presentation} onPresentation={changePresentation}
          nodes={connectionIndex.nodes} onSelect={followMapItem} onZoom={zoomBy}
          canZoomOut={canvasViewport.zoom > minimumInteractiveZoom} canZoomIn={canvasViewport.zoom < VIEWPORT_LIMITS.maxZoom}
          onAdd={project.instructor.allowResearchLeads && ['micro', 'meso', 'exosphere'].includes(project.activeScale) ? () => { setConnecting(false); setConnectionSource(null); changePanel('inspector'); setNewNode(blankManualNode(project.activeScale)); setAddMode('node'); } : null}
          onFit={fitMap} onArrange={arrangeMap} canArrange={!focusedEcologyPositions && !phoneRelationshipPositions}
          onLegend={toggleLegend} onFullscreen={toggleFullscreen} fullscreen={fullscreen}
          hasRemoved={hasRemovedItems} showRemoved={showRemoved} onShowRemoved={setShowRemoved} />
    {toolbarStart}
  </div>;
  return <div className={`map-stage ${notebook ? 'map-stage--notebook' : ''} map-stage--${mapMode} stage-enter ${focusActive || visibleScale === 'all' ? 'has-map-context' : ''} ${fullscreen ? 'is-fullscreen' : ''}`}
    onPointerDownCapture={() => { consumedCanvasTapRef.current = null; }}
    onKeyDownCapture={() => { consumedCanvasTapRef.current = null; }}
    onClickCapture={(event) => {
      const tap = consumedCanvasTapRef.current;
      consumedCanvasTapRef.current = null;
      // Opening the inspector at pointer-up can put a new control under the
      // finger. Consume that tap's compatibility click, not a new activation.
      if (tap && event.detail > 0 && event.timeStamp >= tap.timeStamp && event.timeStamp - tap.timeStamp < 1000) {
        event.preventDefault(); event.stopPropagation();
      }
    }} onKeyDown={(event) => {
    if (event.key === 'Escape' && connecting) { event.preventDefault(); event.stopPropagation(); cancelConnection(); return; }
    if (!event.target.closest?.('.graph-canvas')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      restoreLayout(event.shiftKey ? 'redo' : 'undo');
    } else if (event.key === '0' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); fitMap();
    }
  }}>
    {notebook ? <><h1 className="sr-only">Systems map</h1>{toolbarHost && !fullscreen
      ? createPortal(notebookControls, toolbarHost)
      : <div className="notebook-toolbar">{notebookControls}</div>}</> : <div className="map-toolbar"><div><h1>Systems map</h1>{toolbarStart}{onReview && <Action className="map-review-action" variant="ghost" onClick={onReview}>Review choices</Action>}</div><div className="map-toolbar__controls"><button type="button" className="sidebar-toggle" aria-controls="map-inspector" aria-expanded={sheetOpen} onClick={() => sheetOpen ? closeInspector() : changePanel(panelMode)}>{sheetOpen ? 'Hide sidebar' : 'Show sidebar'}</button>{panel && <WorkPanelTabs mode={panelMode} onChange={changePanel} disabled={panel.disabled || []} onKeyDown={(event) => handleCompositeKey(event, PANEL_TABS.map((tab) => tab.id), panelMode, changePanel)} />}<MapSearch nodes={connectionIndex.nodes} onSelect={followMapItem} /><div className="map-presentation-toggle" role="group" aria-label="Map presentation"><button type="button" aria-pressed={presentation === 'canvas'} onClick={() => changePresentation('canvas')}>Canvas</button><button type="button" aria-pressed={presentation === 'list'} onClick={() => changePresentation('list')}>List</button></div><label className="map-layer-control"><span>Show layer</span><select aria-label="Show map layer" value={visibleScale} onChange={(event) => changeVisibleScale(event.target.value)}>{project.releasedScales.map((scale) => <option key={scale} value={scale}>{SCALES[scale].label}</option>)}<option value="all">All layers</option></select></label>{hasRemovedItems && <label className="map-removed-toggle"><input type="checkbox" checked={showRemoved} onChange={(event) => setShowRemoved(event.target.checked)} /><span>Show removed items</span></label>}</div></div>}
    {connecting && <div className="map-connect-status" role="status"><span>{connectionSource ? `${project.graph.nodes.find((node) => node.id === connectionSource)?.label} selected. Choose the ending item.` : 'Choose the starting item, then choose the ending item.'}</span><button type="button" onClick={cancelConnection}>Cancel</button></div>}
    {focusActive && !notebook?.open ? <div className="map-focus-bar" role="status"><div className="map-focus-bar__summary"><span>{focusSummary}</span>{focusHasRelationshipPages && <small aria-live="polite">Relationship {activeFocusPage + 1} of {focusIncidentEdges.length}</small>}</div><div className="map-focus-bar__actions">{focusHasRelationshipPages && focusPageCount > 1 ? <><button type="button" aria-label="Previous relationship" disabled={activeFocusPage === 0} onClick={() => changeFocusPage(activeFocusPage - 1)}>Previous</button><button type="button" aria-label="Next relationship" disabled={activeFocusPage === focusPageCount - 1} onClick={() => changeFocusPage(activeFocusPage + 1)}>Next</button></> : null}<button type="button" onClick={showFullMap}>Show full map</button></div></div> : <p className="map-overview-hint">{mapOverviewHint}</p>}
        <div className="sr-only" aria-live="polite" aria-atomic="true"><span key={announcement.revision}>{announcement.message}</span></div>
    <div ref={layoutRef} style={{ '--sidebar-width': `${sidebarSize.width}px` }} className={`map-layout ${sheetOpen ? 'has-inspector' : ''} is-panel-${panelMode}`}>
      {presentation === 'canvas' ? <section ref={canvasWrapRef} className={`canvas-wrap ${phoneLayout && sheetOpen ? 'is-inspector-open' : ''} is-panel-${panelMode} ${fullscreen ? 'is-fullscreen' : ''}`} aria-label="Map canvas and controls">
        <MemoGraphCanvas microBoundary={microBoundary} connectionMode={connecting} nodes={displayedNodes} edges={visibleEdges} selection={selection} onSelect={selectItem} onMoveNode={moveNode} viewport={canvasViewport} phoneLayout={phoneLayout} phoneViewBox={phoneViewBox} mapLabel={mapLabel} mapMode={mapMode} ecologyLayers={ecologyLayers} ecologyBandGeometry={sharedEcologyBands} ecologyInteractionBandGeometry={interactionEcologyBands} fontRevision={fontRevision} visibleLayer={visibleScale} detailMode={Boolean(phoneRelationshipPositions || focusedEcologyPositions)} ringExpansion={ringExpansion} interactionMode={phoneLayout && sheetOpen ? 'phone-drawer' : 'durable'} minimumZoom={minimumInteractiveZoom} onViewportChange={changeViewport} onAnnounce={setAnnouncement} />
        {!notebook && <div className="canvas-chrome" aria-hidden={phoneLayout && drawerOpen ? 'true' : undefined} inert={phoneLayout && drawerOpen}>
          <div className="canvas-chrome__top"><div className="canvas-control-group canvas-control-group--display" role="group" aria-label="Map display"><button ref={legendTriggerRef} type="button" aria-controls="map-key-panel" aria-expanded={legendOpen} onClick={toggleLegend}>Map key</button><button ref={fullscreenToggleRef} type="button" aria-controls="systems-map-canvas" aria-pressed={fullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Full screen map'} onClick={toggleFullscreen}>{fullscreen ? 'Exit full screen' : 'Full screen'}</button></div></div>
          <div className="canvas-chrome__bottom"><div className="canvas-control-group canvas-control-group--navigation" role="group" aria-label="Map navigation"><button type="button" aria-label="Zoom out" disabled={canvasViewport.zoom <= minimumInteractiveZoom} onClick={() => zoomBy(-0.15)}>−</button><button type="button" aria-label="Zoom in" disabled={canvasViewport.zoom >= VIEWPORT_LIMITS.maxZoom} onClick={() => zoomBy(0.15)}>+</button><button type="button" aria-label="Fit map" onClick={fitMap}><span className="desktop-label">Fit map</span><span className="phone-label">Fit</span></button><div className="map-move-control"><button ref={moveMenuTriggerRef} type="button" aria-controls="map-move-controls" aria-expanded={moveMenuOpen} onClick={() => { setLegendOpen(false); setMoveMenuOpen((current) => !current); }}>Move</button>{moveMenuOpen && <div id="map-move-controls" className="map-move-controls" role="group" aria-label="Move map without dragging" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMoveMenuOpen(false); window.requestAnimationFrame(() => moveMenuTriggerRef.current?.focus()); } }}><button type="button" aria-label="Move map up" onClick={() => moveMapBy(0, -40, 'up')}>↑</button><button type="button" aria-label="Move map left" onClick={() => moveMapBy(-40, 0, 'left')}>←</button><button type="button" aria-label="Move map right" onClick={() => moveMapBy(40, 0, 'right')}>→</button><button type="button" aria-label="Move map down" onClick={() => moveMapBy(0, 40, 'down')}>↓</button></div>}</div></div><div className="canvas-control-group canvas-control-group--actions" role="group" aria-label="Map actions">{!(focusedEcologyPositions || phoneRelationshipPositions) && <button type="button" aria-label="Arrange map" onClick={arrangeMap}><span className="desktop-label">Arrange map</span><span className="phone-label">Arrange</span></button>}<button className="phone-inspector-trigger map-details-trigger" type="button" aria-controls="map-inspector" aria-expanded={drawerOpen} onClick={() => { if (!selection) setInspectorTab('map'); setLegendOpen(false); setMoveMenuOpen(false); onPanelMode?.('inspector'); setDrawerOpen(true); focusInspector(); }}>Details</button></div></div>
        </div>}
        {legendOpen && <aside id="map-key-panel" className="map-legend" role="dialog" aria-labelledby="map-key-title" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeLegend(); } }}><div className="map-legend__head"><strong id="map-key-title">Map key</strong><button type="button" onClick={closeLegend} aria-label="Close map key"><Icon name="close" /></button></div><MapLegend /></aside>}
      </section> : <MapListView nodes={project.graph.nodes} edges={project.graph.edges} visibleScale={visibleScale} showRemoved={showRemoved} onSelect={selectItem} />}
      <aside id="map-inspector" ref={inspectorRef} className={`inspector ${sheetOpen ? 'is-open' : ''} work-panel--${panelMode}`} aria-label={notebook ? 'Notebook' : panelMode === 'suggestions' ? 'Suggestions panel' : panelMode === 'review' ? 'Review panel' : 'Map inspector'} aria-hidden={!sheetOpen ? 'true' : undefined} inert={!sheetOpen} onKeyDown={(event) => { if (event.key === 'Escape' && sheetOpen) { event.preventDefault(); event.stopPropagation(); closeInspector(); } }}>
        {sheetOpen && <SidebarResizeHandle {...sidebarSize} />}
        <div className="inspector__scroll">
        {!notebook && panelContent && <div className="work-panel__close"><button type="button" onClick={closeInspector}>Close sidebar</button></div>}
        {notebook && panelContent && <NotebookSection mode={panelMode} onChange={changePanel} disabled={panel?.disabled || []} />}
        {(!notebook || panelMode === 'suggestions') && <MemoDrawer project={project} update={update} onRequestRestart={onRequestRestart} />}
        {panelContent ? <div className="work-panel__body">{notebook && panelMode === 'review' ? React.cloneElement(panel.content, { savedMapNote: <SavedMapNote key={project.id} project={project}><AnnotationField annotationId={project.mapAnnotation.id} label="Map note" value={project.mapAnnotation.text} onDraftValue={(text) => stageAnnotationDraft(project.mapAnnotation.id, text)} {...annotationProps} /></SavedMapNote> }) : panel.content}</div> : <>
        <div className="inspector__head">
          <h2>{addMode === 'edge' && relationshipSource && relationshipTarget
            ? `${relationshipSource.label} and ${relationshipTarget.label}`
            : selectedNode?.label || (selectedEdge ? relationshipDescription(selectedEdge) : 'Map details')}</h2>
          <div className="inspector__actions">
            {project.instructor.allowResearchLeads && (!notebook || addMode) && ['micro', 'meso', 'exosphere'].includes(project.activeScale) && <div className="inspector-add-menu"><button type="button" aria-expanded={createMenuOpen} aria-controls="inspector-add-actions" onClick={() => setCreateMenuOpen((current) => !current)}>Add</button>{createMenuOpen && <div id="inspector-add-actions">{project.activeScale !== 'macrosphere' && <button type="button" onClick={() => { setNewNode(blankManualNode(project.activeScale)); setAddMode('node'); setCreateMenuOpen(false); }}>{project.activeScale === 'meso' ? 'Micro item' : 'Node'}</button>}{['meso', 'exosphere'].includes(project.activeScale) && <button type="button" onClick={() => { setAddMode('edge'); setCreateMenuOpen(false); }}>Relationship</button>}</div>}</div>}
            <button className="inspector-done" type="button" onClick={closeInspector}>Done</button>
          </div>
        </div>
        {previousTraceLabel && <button type="button" className="map-trace-back" onClick={returnToPreviousItem}>Back to {previousTraceLabel}</button>}
        {!notebook && <div className="inspector-tabs" role="tablist" aria-label="Annotation target">{inspectorTabs.map((tab) => <button key={tab} id={`map-inspector-tab-${tab}`} type="button" role="tab" aria-selected={inspectorTab === tab} aria-controls={`map-inspector-panel-${tab}`} tabIndex={inspectorTab === tab ? 0 : -1} data-composite-value={tab} onClick={() => setTab(tab)} onKeyDown={(event) => handleCompositeKey(event, inspectorTabs, inspectorTab, setTab)}>{tab === 'relationships' ? 'Connections' : tab === 'node' ? 'Item' : 'Map'}</button>)}</div>}
        {addMode === 'node' && <div className="add-form">
          <h3>{project.activeScale === 'meso' ? 'Add a missing Micro item' : 'New node'}</h3>
          {project.activeScale === 'meso' && <p>Add a person, group, resource, or setting. It joins your Micro map and can be connected here in Meso.</p>}
          <Field label="Label"><input maxLength={NODE_LABEL_LIMIT} value={newNode.label} onChange={(event) => setNewNode((current) => ({ ...current, label: event.target.value }))} /></Field>
          <div className="field-pair">
            <Field label="Type"><select value={newNode.type} onChange={(event) => setNewNode((current) => ({ ...current, type: event.target.value, ...(MICRO_SETTING_NODE_TYPE_SET.has(event.target.value) ? { settingNodeIds: [] } : {}) }))}>{NODE_TYPES.filter((type) => isNodeTypeAllowedAtScale(type, newNode.scale)).map((type) => <option key={type}>{type}</option>)}</select></Field>
            <Field label="Level"><select value={newNode.scale} onChange={(event) => setNewNode((current) => {
              const scale = event.target.value;
              const type = isNodeTypeAllowedAtScale(current.type, scale) ? current.type : (scale === 'exosphere' ? 'institution' : 'person');
              return { ...blankManualNode(scale), label: current.label, evidence: current.evidence, type };
            })}>{project.releasedScales.filter((scale) => project.activeScale === 'meso' ? scale === 'micro' : !['meso', 'macrosphere'].includes(scale)).map((scale) => <option key={scale} value={scale}>{SCALES[scale]?.label || scale}</option>)}</select></Field>
          </div>
          {newNode.scale === 'micro' && <MicroParticipationEditor
            item={newNode}
            settingOptions={mapMicroSettingOptions}
            onParticipationChange={(value) => setNewNode((current) => ({ ...current, focalParticipation: value }))}
            onSettingNodeIdsChange={(value) => setNewNode((current) => ({ ...current, settingNodeIds: value }))}
          />}
          <Field label="Evidence or question"><textarea maxLength={PROJECT_LIMITS.noteText} rows="3" value={newNode.evidence} onChange={(event) => setNewNode((current) => ({ ...current, evidence: event.target.value }))} /></Field>
          <button className="button" type="button" onClick={addNode}>Add node</button>
          <button type="button" onClick={() => { setAddMode(null); closeInspector(); }}>Cancel</button>
        </div>}
        {addMode === 'edge' && ['meso', 'exosphere'].includes(project.activeScale) && <div className="add-form"><h3>New relationship</h3><Field label={project.activeScale === 'exosphere' ? 'Outside decision setting' : 'From'}><select value={relationshipSource?.id || ''} onChange={(event) => setNewEdge((current) => ({ ...current, source: event.target.value }))}>{relationshipSourceNodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field><Field label="Relationship">{project.activeScale === 'exosphere' ? <select value={scaleLexiconVerb('exosphere', newEdge.verb) || SCALE_VERB_LEXICONS.exosphere[0]} onChange={(event) => setNewEdge((current) => ({ ...current, verb: event.target.value }))}>{SCALE_VERB_LEXICONS.exosphere.map((verb) => <option key={verb}>{verb}</option>)}</select> : <input maxLength={RELATIONSHIP_VERB_LIMIT} value={newEdge.verb} onChange={(event) => setNewEdge((current) => ({ ...current, verb: event.target.value }))} />}</Field><Field label={project.activeScale === 'exosphere' ? 'Affected setting or office' : 'To'}><select value={relationshipTarget?.id || ''} onChange={(event) => setNewEdge((current) => ({ ...current, target: event.target.value }))}>{relationshipTargetNodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field><Field label="Direction"><select value={newEdge.relationshipProcess?.direction || 'source to target'} onChange={(event) => setNewEdge((current) => ({ ...current, relationshipProcess: createRelationshipProcess({ ...current.relationshipProcess, direction: event.target.value }) }))}><option value="source to target">One way: {relationshipSource?.label} to {relationshipTarget?.label}</option><option value="target to source">One way: {relationshipTarget?.label} to {relationshipSource?.label}</option><option value="both directions">Both directions</option><option value="varies">Direction varies</option><option value="not yet known">Not yet known</option></select></Field>{project.activeScale === 'meso' && <details className="relationship-attributes"><summary>Connection details (optional)</summary><ConnectionDetailsFields process={newEdge.relationshipProcess} onChange={process => setNewEdge(current => ({ ...current, relationshipProcess: process }))} /></details>}<Field label="Evidence or question"><textarea maxLength={PROJECT_LIMITS.noteText} rows="3" value={newEdge.evidence} onChange={(event) => setNewEdge((current) => ({ ...current, evidence: event.target.value }))} /></Field><button className="button" type="button" onClick={addEdge}>Add relationship</button><button type="button" onClick={() => { setAddMode(null); closeInspector(); }}>Cancel</button></div>}
        {!addMode && inspectorTab === 'node' && <div id="map-inspector-panel-node" className="inspector__body" role={notebook ? "region" : "tabpanel"} aria-label={notebook ? "Item details" : undefined} aria-labelledby={notebook ? undefined : "map-inspector-tab-node"}>{selectedNode ? <>
          <MapConnections compact={Boolean(notebook)} nodeId={selectedNode.id} index={connectionIndex} onFollow={followMapItem}
            onConnect={project.activeScale === 'meso' && selectedNode.scale === 'micro' && isLiveMapItem(selectedNode) && project.instructor.allowResearchLeads && connectionIndex.nodes.filter(node => node.scale === 'micro').length > 1 ? startConnection : undefined} />
          <MapTextEditor key={`node:${selectedNode.id}`} label="Label" maxLength={NODE_LABEL_LIMIT} value={selectedNode.label} validate={(value) => nodeLabelIssue(value, selectedNode, project.graph.nodes)} onSave={(value) => editNode('label', value)} />
          <div className="inspector-evidence"><p>{selectedNode.evidence || 'No evidence yet. Add a source or a question below.'}</p></div>
          <AnnotationField key={selectedNode.annotations.analytical.id} annotationId={selectedNode.annotations.analytical.id} label="Your interpretation" value={selectedNode.annotations.analytical.text} placeholder="What does this item help explain? What is still uncertain?" onDraftValue={(text) => stageAnnotationDraft(selectedNode.annotations.analytical.id, text)} {...annotationProps} />
          <details className="node-summary">
            <summary><span>Edit item details</span></summary>
            <div className="node-summary__body">
          <details className="inspector-disclosure"><summary>Evidence and questions</summary><div>
            <ClaimEvidenceEditor ownerId={`node:${selectedNode.id}`} records={selectedNode.claimEvidence || []} onChange={(records) => editNode('claimEvidence', records)} />
            <AnnotationField key={selectedNode.annotations.evidence.id} annotationId={selectedNode.annotations.evidence.id} label="Evidence note" value={selectedNode.annotations.evidence.text} placeholder="How does this source support or limit your interpretation?" onDraftValue={(text) => stageAnnotationDraft(selectedNode.annotations.evidence.id, text)} {...annotationProps} />
          {onMapCheck && <MapCheckPanel compact heading="Check this item" lede="What would strengthen or challenge it?" actionLabel="Check this item" check={mapCheck?.intent === 'connection' && mapCheck.focus?.id === selectedNode.id ? mapCheck : null} onRun={() => onMapCheck('connection', { kind: (selectedNode.scopeNodeIds || []).length ? 'scope' : 'node', id: selectedNode.id })} onShow={showMapRefs} labelFor={mapItemLabel} />}
          </div></details>

              <div className="field-pair">
                {selectedNode.scale === 'meso'
                  ? <Field label="Type"><input value="mesosystem" readOnly /></Field>
                  : <Field label="Type"><select value={selectedNode.type} onChange={(event) => editNode('type', event.target.value)}>{NODE_TYPES.filter((type) => isNodeTypeAllowedAtScale(type, selectedNode.scale)).map((type) => <option key={type}>{type}</option>)}</select></Field>}
                <Field label="Level"><input value={SCALES[selectedNode.scale].label} readOnly /></Field>
              </div>
              {selectedNode.scale === 'micro' && <MicroParticipationEditor
                item={selectedNode}
                settingOptions={mapMicroSettingOptions}
                onParticipationChange={(value) => editNode('focalParticipation', value)}
                onSettingNodeIdsChange={(value) => editNode('settingNodeIds', value)}
              />}
              {['meso', 'macrosphere'].includes(selectedNode.scale) && <div className="scope-editor" aria-label={selectedNode.scale === 'meso' ? `Micro settings included in ${selectedNode.label}` : `Map items affected by ${selectedNode.label}`}>
                {selectedNode.scale === 'macrosphere' && <div className="scope-editor__mode"><label><span>Effect</span><select aria-label={`How ${selectedNode.label} affects map items`} value={SCALE_VERB_LEXICONS.macrosphere.includes(selectedNode.deontic) ? selectedNode.deontic : 'shapes'} onChange={(event) => editNode('deontic', event.target.value)}>{SCALE_VERB_LEXICONS.macrosphere.map((verb) => <option key={verb}>{verb}</option>)}</select></label></div>}
                <div className="scope-editor__members">
                  {(selectedNode.scopeNodeIds || []).map((memberId) => {
                    const member = project.graph.nodes.find((node) => node.id === memberId);
                    if (!member) return null;
                    const removeLabel = selectedNode.scale === 'meso' ? `Remove ${member.label} from ${selectedNode.label}` : `Remove ${member.label} from map items affected by ${selectedNode.label}`;
                    return <button key={memberId} type="button" className="scope-chip" onClick={() => editNode('scopeNodeIds', (selectedNode.scopeNodeIds || []).filter((entry) => entry !== memberId))} aria-label={removeLabel}>{member.label}<span aria-hidden="true"> ×</span></button>;
                  })}
                  <select className="scope-editor__add" aria-label={selectedNode.scale === 'meso' ? `Add a Micro setting to ${selectedNode.label}` : `Add a map item affected by ${selectedNode.label}`} value="" onChange={(event) => { const memberId = event.target.value; if (!memberId) return; const current = selectedNode.scopeNodeIds || []; if (current.includes(memberId) || current.length >= PROJECT_LIMITS.scopeMembers) return; editNode('scopeNodeIds', [...current, memberId]); }}>
                    <option value="">{selectedNode.scale === 'meso' ? 'Add Micro setting…' : 'Add map item…'}</option>
                    {project.graph.nodes.filter((node) => node.status !== 'rejected' && node.claimState !== 'retired' && node.id !== selectedNode.id && !(selectedNode.scopeNodeIds || []).includes(node.id) && (selectedNode.scale === 'meso' ? node.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(node.type) : node.scale !== 'macrosphere')).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
                  </select>
                  {(selectedNode.scopeNodeIds || []).length < 2 && <span className="scope-editor__empty">{selectedNode.scale === 'meso' ? 'Choose at least two Micro settings.' : 'Choose at least two map items.'}</span>}
                </div>
              </div>}
              {selectedNode.scale === 'meso' && <Field label="Interaction" hint="Coordination or conflict the memo supports."><textarea rows="4" maxLength={PROJECT_LIMITS.noteText} value={selectedNode.mesoExplanation || ''} onChange={(event) => editNode('mesoExplanation', event.target.value)} /></Field>}
              <div className="provenance-block"><span>Evidence</span><p>{selectedNode.evidence || 'No evidence added yet.'}</p>{selectedNode.notes && <><span>Annotation</span><p>{selectedNode.notes}</p></>}</div>
            </div>
          <div className="node-position-controls"><span>Position on map</span><div role="group" aria-label={`Move ${selectedNode.label} without dragging`}><button type="button" aria-label={`Move ${selectedNode.label} left`} onClick={() => moveSelectedNodeBy(-24, 0, 'left')}>←</button><button type="button" aria-label={`Move ${selectedNode.label} up`} onClick={() => moveSelectedNodeBy(0, -24, 'up')}>↑</button><button type="button" aria-label={`Move ${selectedNode.label} down`} onClick={() => moveSelectedNodeBy(0, 24, 'down')}>↓</button><button type="button" aria-label={`Move ${selectedNode.label} right`} onClick={() => moveSelectedNodeBy(24, 0, 'right')}>→</button></div></div>
          <button className="map-item-action" type="button" onClick={() => setSelectedRemoved(!selectedItemRemoved)}>{selectedItemRemoved ? 'Return to map' : 'Remove from map'}</button>
          </details>

        </> : <p className="empty-message">Select an item on the map to see its evidence and explain what it means for your inquiry.</p>}</div>}
        {!addMode && inspectorTab === 'relationships' && <div id="map-inspector-panel-relationships" className="inspector__body" role={notebook ? "region" : "tabpanel"} aria-label={notebook ? "Connections" : undefined} aria-labelledby={notebook ? undefined : "map-inspector-tab-relationships"}>
          {!selectedEdge && <><p className="inspector-guide">Choose a connection to explain how these items affect one another.</p><div className="relationship-picker" aria-label="Relationship list">{relatedEdges.map((edge) => <button type="button" key={edge.id} onClick={() => selectItem('edge', edge.id)}><span>{relationshipDescription(edge)}</span></button>)}</div></>}
          {selectedEdge ? <>
            <Field label="Arrow direction"><select value={relationshipDirection(selectedEdge)} onChange={(event) => editEdge('relationshipProcess', createRelationshipProcess({ ...selectedEdge.relationshipProcess, direction: event.target.value }))}>{!PROCESS_DIRECTION_OPTIONS.some(option => option.value === relationshipDirection(selectedEdge)) && <option value={relationshipDirection(selectedEdge)}>{relationshipDirection(selectedEdge)}</option>}<option value="source to target">{selectedEdge.sourceLabel} to {selectedEdge.targetLabel}</option><option value="target to source">{selectedEdge.targetLabel} to {selectedEdge.sourceLabel}</option><option value="both directions">Both directions</option><option value="varies">Direction varies</option><option value="not yet known">Not yet known</option></select></Field>
            <MapTextEditor key={`edge:${selectedEdge.id}`} label="Relationship" maxLength={RELATIONSHIP_VERB_LIMIT} value={selectedEdge.verb} options={selectedEdge.scale === 'exosphere' ? SCALE_VERB_LEXICONS.exosphere : undefined} validate={(value) => relationshipIssue(value, selectedEdge)} onSave={(value) => editEdge('verb', value)} />
            <div className="inspector-evidence"><p>{selectedEdge.evidence || 'No evidence yet. Add a source or a question below.'}</p></div>
            <AnnotationField key={selectedEdge.annotation.id} annotationId={selectedEdge.annotation.id} label="Your interpretation" value={selectedEdge.annotation.text} placeholder="What does this connection explain? What is still uncertain?" onDraftValue={(text) => stageAnnotationDraft(selectedEdge.annotation.id, text)} {...annotationProps} />

            <details className="inspector-disclosure"><summary>Connection details</summary><div>
            <details className="inspector-disclosure"><summary>Evidence and questions</summary><div><ClaimEvidenceEditor ownerId={`edge:${selectedEdge.id}`} records={selectedEdge.claimEvidence || []} onChange={(records) => editEdge('claimEvidence', records)} /></div></details>
            {onMapCheck && <MapCheckPanel compact heading="Check this connection" lede="What evidence would strengthen or challenge it?" actionLabel="Check this connection" check={mapCheck?.intent === 'connection' && mapCheck.focus?.id === selectedEdge.id ? mapCheck : null} onRun={() => onMapCheck('connection', { kind: 'relationship', id: selectedEdge.id })} onShow={showMapRefs} labelFor={mapItemLabel} />}
              {['meso', 'exosphere'].includes(selectedEdge.scale) && <RelationshipProcessEditor edge={selectedEdge} onChange={(process) => editEdge('relationshipProcess', process)} />}
              <button className="map-item-action" type="button" onClick={() => setSelectedRemoved(!selectedItemRemoved)}>{selectedItemRemoved ? 'Return to map' : 'Remove from map'}</button>
            </div></details>

          </> : <p className="empty-message">You can also select a line directly on the map.</p>}
        </div>}
        {!addMode && inspectorTab === 'map' && <div id="map-inspector-panel-map" className="inspector__body" role={notebook ? "region" : "tabpanel"} aria-label={notebook ? "Map notes" : undefined} aria-labelledby={notebook ? undefined : "map-inspector-tab-map"}>
          <p className="inspector-guide">Select an item or a connecting line to work on its meaning and evidence. Use this view for patterns across the whole map.</p>
          <details className="map-help"><summary>Map controls</summary><dl>
            <div><dt>Pan</dt><dd>Drag empty space, hold Space and drag, or use the middle mouse button.</dd></div>
            <div><dt>Zoom</dt><dd>Scroll or pinch; use + and − while the canvas is focused.</dd></div>
            <div><dt>Move an item</dt><dd>Drag it, or focus it and use arrow keys. Shift moves it farther.</dd></div>
            <div><dt>Fit map</dt><dd>Show the current map in the available space. Press 0 on the canvas.</dd></div>
            <div><dt>Undo layout</dt><dd>Use Ctrl/⌘ Z on the canvas; Shift redoes the change. Text fields keep their own undo.</dd></div>
          </dl><div className="layout-history" role="group" aria-label="Layout history"><button type="button" disabled={!layoutHistory.past.length} onClick={() => restoreLayout('undo')}>Undo layout</button><button type="button" disabled={!layoutHistory.future.length} onClick={() => restoreLayout('redo')}>Redo layout</button></div></details>
          <ProjectOverview project={project} />
          <div className="map-summary"><strong>{scaleNodes.length}</strong><span>nodes</span><strong>{scaleEdges.length}</strong><span>relationships</span></div><AnnotationField key={project.mapAnnotation.id} annotationId={project.mapAnnotation.id} label="Map note" value={project.mapAnnotation.text} hint="Write about a pattern, boundary, contradiction, or question across the map." placeholder="Across the map, I notice…" onDraftValue={(text) => stageAnnotationDraft(project.mapAnnotation.id, text)} {...annotationProps} /></div>}
        </>}
        {notebook && panelContent && notebook.action && <div className="notebook-task-end">{notebook.action}</div>}
        </div>
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
  'candidate.confirmed': ['Map item added', false],
  'candidate.research lead': ['Item marked as needing evidence', false],
  'candidate.rejected': ['Map item removed', false],
  'candidates.batch-confirmed': ['Map items added', false],
  'candidates.generated': ['Suggestions prepared', true],
  'candidates.refreshed': ['Suggestions refreshed', true],
  'graph.committed': ['Map updated', false],
  'node.added': ['Node added', true],
  'edge.added': ['Relationship added', true],
  'map.arranged': ['Map arranged', true],
  'map.layout-restored': ['Layout restored', true],
  'map.item.removed': ['Item removed from map', false],
  'map.item.restored': ['Item returned to map', false],
  'scale.selected': ['Level changed', true],
  'scale.cycle-completed': ['Level cycle saved', true],
  'stage.opened': ['Section opened', true],
  'release.opened': ['Level opened', true],
  'reflection.revised': ['Field Notes saved', false],
  'sharing.changed': ['Export audience changed', true],
  'config.revised': ['Model setup changed', false],
  'instructor.setting': ['Course setting changed', false],
});

function revisionEventCopy(event) {
  const [label, showDetail] = REVISION_EVENT_COPY[event.action] || ['Project updated', false];
  return { label, detail: showDetail ? event.detail : '' };
}

function activeLevelGraph(project) {
  const edges = project.graph.edges.filter((edge) => project.activeScale !== 'micro' && edge.scale === project.activeScale && edge.status !== 'rejected' && edge.claimState !== 'retired');
  const endpointIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const nodes = project.graph.nodes.filter((node) => node.status !== 'rejected' && node.claimState !== 'retired' && (node.scale === project.activeScale || endpointIds.has(node.id) || (project.activeScale === 'meso' && node.scale === 'micro')));
  return { nodes, edges };
}

function SavedMapNote({ project, children }) {
  const [hasNote] = useState(() => Boolean(project.mapAnnotation.text.trim()));
  return hasNote ? <details className="saved-map-note"><summary>Saved map note</summary>{children}</details> : null;
}

function ReviewPanel({ savedMapNote = null, exportOnly = false, onProjectLink, project, update, replaceProject, toast, logPrototype, onValidationError, onReviewLevel, onSubmitRevision, revisionSubmitting = false, submitDisabled = false }) {
  const [importError, setImportError] = useState('');
  const onImport = async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      if (file.name.length > FILE_NAME_LIMIT) throw new Error(`Choose a project whose file name is ${FILE_NAME_LIMIT} characters or fewer.`);
      if (file.size > MAX_PROJECT_BYTES) throw new Error('Choose a Systems Mapping JSON file smaller than 8 MB.');
      const imported = parseProject(await file.text());
      if (replaceProject(imported, file.name)) {
        setImportError('');
        toast('Project imported and validated.');
      } else {
        setImportError('The project was not imported. Your current map remains open. Resolve the save warning and try again.');
      }
    } catch { const message = 'This project file could not be opened safely. The current map was preserved.'; setImportError(message); toast(message, 'error'); }
    event.target.value = '';
  };
  const tiers = ['private', 'course', 'CUNY', 'public'];
  const maxIndex = tiers.indexOf(project.instructor.maxSharingTier);
  const exportProject = async (format) => {
    try {
      const portable = createPortableProject(project, project.sharingTier);
      if (['png', 'pdf'].includes(format)) downloadBlob(await exportMapImage(portable, format), exportFileName(project, format));
      if (format === 'json') download(exportFileName(project, 'json'), serializePortableProject(project, project.sharingTier));
      if (format === 'csv') download(exportFileName(project, 'csv'), graphCsv(portable), 'text/csv');
      if (format === 'markdown') download(exportFileName(project, 'md'), projectMarkdown(portable), 'text/markdown');
      logPrototype('project_exported', { nodeCount: portable.graph.nodes.length, relationshipCount: portable.graph.edges.length });
      const redactionCount = portable.portableExport.redactions.length;
      toast(portable.portableExport.redacted ? `Export created. ${redactionCount} private ${redactionCount === 1 ? 'field was' : 'fields were'} removed.` : 'Export created.');
    } catch (error) {
      onValidationError(error, 'The export was not created because one map item needs attention.');
    }
  };
  return <div className="review-panel">
    {!exportOnly && <>
      <ReflectionEntry project={project} update={update} />
      {savedMapNote}
      {onSubmitRevision && <button type="button" className="text-button" disabled={revisionSubmitting || submitDisabled} onClick={onSubmitRevision}>{revisionSubmitting ? 'Submitting…' : 'Submit revision'}</button>}
    </>}
    {exportOnly && <>
    <section className="export-strip export-strip--compact" aria-label="Export and share">
      <details className="export-dropdown" onKeyDown={(event) => { if (event.key === 'Escape' && event.currentTarget.open) { event.preventDefault(); event.stopPropagation(); const details = event.currentTarget; details.open = false; details.querySelector('summary')?.focus(); } }}>
        <summary><Icon name="download" /><span>Export &amp; share</span><span aria-hidden="true">▾</span></summary>
        <div className="export-dropdown__options">
          <Field label="Export audience"><select value={project.sharingTier} onChange={(event) => update((draft) => { draft.sharingTier = event.target.value; }, 'sharing.changed', event.target.value)}>{tiers.map((tier, index) => <option key={tier} value={tier} disabled={index > maxIndex}>{tier === 'private' ? 'Only me' : tier === 'course' ? 'Class' : tier === 'public' ? 'Public' : 'CUNY'}</option>)}</select></Field>
          <fieldset><legend>Show the map</legend><button type="button" onClick={() => exportProject('png')}>PNG image</button><button type="button" onClick={() => exportProject('pdf')}>PDF</button><button type="button" onClick={onProjectLink}>Project link</button></fieldset>
          <fieldset><legend>Save or reuse</legend><button type="button" onClick={() => exportProject('json')}>JSON <small>Reopen later</small></button><button type="button" onClick={() => exportProject('csv')}>CSV <small>Map data</small></button><button type="button" onClick={() => exportProject('markdown')}>Markdown <small>Readable text</small></button></fieldset>
          <label className="export-dropdown__import"><Icon name="upload" />Import JSON<input type="file" accept=".json,application/json" onChange={onImport} /></label>
        </div>
      </details>
      {importError && <p className="error-text" role="alert">{importError}</p>}
    </section></>}
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

function App({ startInWorkspace = false, startInTeacher = false, onOpenProjects, onAccountDashboard, cloudSaveStatus, cloudError, onSubmitRevision } = {}) {
  const institutionalMode = Boolean(onAccountDashboard);
  const bugReportDock = useBugReportDock();
  const [mapToolbarHost, setMapToolbarHost] = useState(null);
  const [theme, setTheme] = useState(storedTheme);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [initialLoad] = useState(loadProject);
  const persistenceStorageRef = useRef(projectStorage());
  const memoDraftBaseRef = useRef(initialLoad.memoDraftBase || initialLoad.project);
  const memoDraftErrorRef = useRef(false);
  const [project, setProject] = useState(initialLoad.project);
  const [projectRecords, setProjectRecords] = useState(() => loadProjectLibrary(projectStorage(), initialLoad.project, initialLoad.hasSavedProject));
  const [modal, setModal] = useState(null);
  const [toastState, setToastState] = useState(null);
  const [passwordResetToken, setPasswordResetToken] = useState(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = hash.get('teacher-reset');
    return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  });
  const [teacherOpen, setTeacherOpen] = useState(() => startInTeacher || passwordResetToken !== null);
  const [accessState, setAccessState] = useState({ status: 'checking', access: null, message: 'Loading…', kind: 'info' });
  const [sessionCheck, setSessionCheck] = useState(0);
  const lastInstitutionalResumeRef = useRef(-Infinity);
  const [workspaceStarted, setWorkspaceStarted] = useState(startInWorkspace);
  const [mapPreviewOpen, setMapPreviewOpen] = useState(false);
  const [hasSavedProject, setHasSavedProject] = useState(initialLoad.hasSavedProject);
  const [persistenceBlocked, setPersistenceBlocked] = useState(initialLoad.persistenceBlocked);
  const [pendingNewProject, setPendingNewProject] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(null);
  const [reviewProgress, setReviewProgress] = useState('');
  const resumedGuidance = useRef(null);
  const [reviewFailure, setReviewFailure] = useState(null);
  const reviewInFlightRef = useRef(false);
  const reviewRequestRef = useRef(null);
  const reviewRetryAtRef = useRef(0);
  const [reviewRetryAt, setReviewRetryAt] = useState(0);
  const [connectionPrompt, setConnectionPrompt] = useState('');
  const [connectionSuggestions, setConnectionSuggestions] = useState([]);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [saveState, setSaveState] = useState({
    status: initialLoad.loadError ? 'error' : initialLoad.hasSavedProject ? 'saved' : 'idle',
    message: initialLoad.loadError || (initialLoad.hasSavedProject ? 'Project saved on this device' : 'Project not started'),
    recovery: initialLoad.recovery,
    diagnostic: initialLoad.diagnostic || null,
    savedRevision: 0,
  });
  const [link, setLink] = useState(() => loadStoredLink(projectStorage(), initialLoad.project.id));
  const [linkStatus, setLinkStatus] = useState(() => projectLinkStatus(link));
  const [linkMessage, setLinkMessage] = useState(null);
  const toastTimer = useRef(null);
  const persistTimer = useRef(null);
  const linkSyncTimer = useRef(null);
  const linkLoadAttemptedRef = useRef(false);
  const projectActivationGenerationRef = useRef(0);
  const linkRef = useRef(link);
  const projectRecordsRef = useRef(projectRecords);
  const pendingAnnotationsRef = useRef(new Map());
  const prototypeLogNoticeRef = useRef({ sequence: 0, lastFailure: 0 });
  const accessGenerationRef = useRef(0);
  const projectRef = useRef(project);
  const connectionPromptRef = useRef(connectionPrompt);
  const workspaceRef = useRef(null);
  const dark = theme === 'dark';
  const toggleTheme = useCallback(() => setTheme((current) => current === 'dark' ? 'light' : 'dark'), []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#171717' : '#f8fafc');
    try {
      projectStorage()?.setItem(THEME_STORAGE_KEY, theme);
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // The visual preference remains available for the current session.
    }
  }, [theme]);
  projectRef.current = project;
  const initialModelRequired = requiresInitialModel(project);
  useEffect(() => {
    if (!initialModelRequired || project.stage < 2) return;
    setMapPreviewOpen(false);
    setProject(current => ({ ...current, stage: 1 }));
  }, [initialModelRequired, project.stage]);
  // Completing a level starts the next level's memo reading in the same click.
  // The read waits for the stage change to settle because generateSuggestions
  // reads the rendered project, not the draft being committed.
  const [pendingLevelRead, setPendingLevelRead] = useState(null);
  const [studioHighlight, setStudioHighlight] = useState(null);
  const [mapCheck, setMapCheck] = useState(null);
  const mapItemLabel = useCallback((id) => {
    const node = project.graph.nodes.find((item) => item.id === id);
    if (node) return node.label;
    const edge = project.graph.edges.find((item) => item.id === id);
    return edge ? relationshipDescription(edge) : id;
  }, [project.graph.edges, project.graph.nodes]);
  useEffect(() => {
    setReviewBusy(null);
    setReviewFailure(null);
    setReviewRetryAt(0);
    return () => {
      reviewRequestRef.current?.controller.abort();
      reviewRequestRef.current = null;
      reviewInFlightRef.current = false;
      reviewRetryAtRef.current = 0;
    };
  }, [project.id, accessState.status]);
  useEffect(() => setReviewFailure(null), [project.activeScale, project.submission.text]);
  useEffect(() => {
    if (!reviewRetryAt) return;
    const timer = window.setTimeout(() => {
      reviewRetryAtRef.current = 0;
      setReviewRetryAt(0);
    }, Math.max(0, reviewRetryAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [reviewRetryAt]);
  projectRecordsRef.current = projectRecords;
  connectionPromptRef.current = connectionPrompt;
  linkRef.current = link;
  const commitProjectRecords = useCallback((records) => {
    projectRecordsRef.current = records;
    setProjectRecords(records);
  }, []);
  const toast = useCallback((message, type = 'success', durationMs = 3200) => {
    window.clearTimeout(toastTimer.current);
    setToastState({ message, type });
    toastTimer.current = window.setTimeout(() => setToastState(null), durationMs);
  }, []);
  const reportProjectValidationFailure = useCallback((error, message) => {
    setSaveState((current) => ({
      ...current,
      status: 'validation',
      message,
      diagnostic: technicalDiagnostic(error),
    }));
    setModal('validation');
    toast(`${message} Review the item, then try again.`, 'error');
  }, [toast]);
  const finishPasswordReset = useCallback(() => {
    setPasswordResetToken(null);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    toast('Passphrase updated. Sign in to Instructor Console.', 'success');
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
    const controller = new AbortController();
    const generation = ++accessGenerationRef.current;
    if (institutionalMode) setAccessState({ status: 'checking', access: null, message: 'Checking sign-in…', kind: 'info' });
    const request = institutionalMode ? readInstitutionalSession({ signal: controller.signal, workspace: persistenceStorageRef.current }) : getStudentSession();
    request.then((result) => {
      if (!active || generation !== accessGenerationRef.current) return;
      setAccessState(result.access
        ? { status: 'granted', access: result.access, message: null, kind: 'info' }
        : { status: 'required', access: null, message: institutionalMode ? 'Use CUNY Login to continue' : null, kind: institutionalMode ? 'error' : 'info' });
    }).catch((error) => {
      if (active && generation === accessGenerationRef.current) setAccessState(sessionFailureState(error, institutionalMode));
    });
    return () => { active = false; controller.abort(); };
  }, [institutionalMode, sessionCheck]);

  const persistNow = useCallback((snapshot = projectRef.current) => {
    if (!workspaceStarted || persistenceBlocked) return false;
    let serialized;
    try {
      serialized = serializeProject(snapshot);
    } catch (error) {
      setSaveState((current) => ({
        ...current,
        status: 'validation',
        message: 'One map item needs attention before this project can be saved.',
        diagnostic: technicalDiagnostic(error),
      }));
      return false;
    }
    try {
      const records = saveProjectToLibrary(persistenceStorageRef.current, snapshot, projectRecordsRef.current, { makeActive: true });
      memoDraftBaseRef.current = snapshot;
      commitProjectRecords(records);
      setHasSavedProject(true);
      setSaveState((current) => ({ ...current, status: 'saved', message: 'Project saved on this device', diagnostic: null, savedRevision: (current.savedRevision || 0) + 1 }));
      return true;
    } catch (error) {
      setPersistenceBlocked(true);
      setSaveState((current) => ({
        ...current,
        status: 'error',
        message: 'Browser storage could not save this project. Your current work remains open.',
        diagnostic: technicalDiagnostic(error),
        recovery: current.recovery || serialized,
      }));
      return false;
    }
  }, [commitProjectRecords, workspaceStarted, persistenceBlocked]);

  useLayoutEffect(() => {
    if (!workspaceStarted) return;
    try {
      if (memoDraftBaseRef.current.id !== project.id || memoDraftBaseRef.current.submission.id !== project.submission.id) {
        memoDraftBaseRef.current = loadDurableProject(persistenceStorageRef.current, project.id, { restoreDraft: false }) || project;
      }
      if (!cacheMemoDraft(persistenceStorageRef.current, project, memoDraftBaseRef.current)) throw new Error('Draft cache conflict');
      memoDraftErrorRef.current = false;
    } catch {
      memoDraftErrorRef.current = true;
      setSaveState(current => current.status === 'error' ? current : { ...current, status: 'error', message: 'Draft cache unavailable; keep this page open' });
    }
  }, [project, workspaceStarted]);

  const flushPersistence = useCallback(() => {
    window.clearTimeout(persistTimer.current);
    const committed = commitPendingAnnotations();
    return persistNow(committed.project);
  }, [commitPendingAnnotations, persistNow]);

  const pauseAccess = useCallback((state = null) => {
    // Keep the recovery copy and editing location before hiding an SSO workspace.
    if (institutionalMode) flushPersistence();
    accessGenerationRef.current += 1;
    setReviewBusy(null);
    setConnectionBusy(false);
    if (!institutionalMode) setWorkspaceStarted(false);
    if (state?.status !== 'checking') setMapPreviewOpen(false);
    setAccessState(state || {
      status: 'expired', access: null,
      message: institutionalMode ? 'Use CUNY Login to continue' : 'Enter your class code to continue.',
      kind: 'error',
    });
  }, [institutionalMode, flushPersistence]);

  const recheckInstitutionalAccess = useCallback(() => {
    pauseAccess({ status: 'checking', access: null, message: 'Checking sign-in…', kind: 'info' });
    setSessionCheck(current => current + 1);
  }, [pauseAccess]);

  useEffect(() => {
    if (accessState.status !== 'granted' || typeof accessState.access?.expiresAt !== 'string') return undefined;
    // This is the last verified grant's deadline, not proof that the SSO session ended.
    const expires = institutionalMode ? recheckInstitutionalAccess : pauseAccess;
    const remaining = Date.parse(accessState.access.expiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      expires();
      return undefined;
    }
    const timer = window.setTimeout(expires, Math.min(remaining, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [accessState.status, accessState.access?.expiresAt, institutionalMode, pauseAccess, recheckInstitutionalAccess]);

  useEffect(() => {
    if (!institutionalMode || !['required', 'expired', 'unavailable'].includes(accessState.status)) return undefined;
    const resume = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastInstitutionalResumeRef.current < INSTITUTIONAL_RESUME_COOLDOWN_MS) return;
      lastInstitutionalResumeRef.current = now;
      recheckInstitutionalAccess();
    };
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [institutionalMode, accessState.status, recheckInstitutionalAccess]);

  useEffect(() => {
    if (!workspaceStarted || persistenceBlocked) return undefined;
    if (!memoDraftErrorRef.current) setSaveState((current) => ({ ...current, status: 'saving', message: 'Saving project on this device…', diagnostic: null }));
    window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(persistNow, PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(persistTimer.current);
  }, [project, workspaceStarted, persistenceBlocked, persistNow]);

  useEffect(() => {
    const flushWhenHidden = () => { if (document.visibilityState === 'hidden') flushPersistence(); };
    window.addEventListener('pagehide', flushPersistence);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('pagehide', flushPersistence);
      document.removeEventListener('visibilitychange', flushWhenHidden);
    };
  }, [flushPersistence]);

  useEffect(() => () => {
    flushPersistence();
  }, [flushPersistence]);

  useEffect(() => () => {
    window.clearTimeout(toastTimer.current);
    window.clearTimeout(persistTimer.current);
  }, []);

  useEffect(() => {
    const onStorage = (rawEvent) => {
      const prefix = projectStorage().prefix;
      if (prefix && !rawEvent.key?.startsWith(prefix)) return;
      const event = prefix ? { key: rawEvent.key.slice(prefix.length), newValue: rawEvent.newValue } : rawEvent;
      if (event.key === STORAGE_KEY && event.newValue) {
        try {
          const incoming = parseProject(event.newValue);
          setHasSavedProject(true);
          if (incoming.id === projectRef.current.id && Date.parse(incoming.updatedAt || 0) > Date.parse(projectRef.current.updatedAt || 0)) {
            projectRef.current = incoming;
            setProject(incoming);
          }
          commitProjectRecords(loadProjectLibrary(projectStorage(), projectRef.current, true));
        } catch {
          setPersistenceBlocked(true);
          setSaveState((current) => ({ ...current, status: 'error', message: 'Another browser session wrote an invalid project. The current workspace was preserved.', recovery: event.newValue }));
        }
        return;
      }
      if (event.key === PROJECT_LIBRARY_KEY || event.key?.startsWith(PROJECT_BODY_PREFIX)) {
        const reconciled = reconcileActiveProject(projectStorage(), projectRef.current);
        if (reconciled !== projectRef.current) {
          projectRef.current = reconciled;
          setProject(reconciled);
        }
        commitProjectRecords(loadProjectLibrary(projectStorage(), reconciled, true));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [commitProjectRecords]);
  useEffect(() => {
    if (!(workspaceStarted || teacherOpen)) return;
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    workspaceRef.current?.focus({ preventScroll: true });
  }, [project.stage, project.activeScale, teacherOpen, workspaceStarted, mapPreviewOpen]);

  // Records which project, level and stage the last course-appendix refresh settled for,
  // whether or not the snapshot changed. The automatic level read waits on it so a read
  // is never keyed to the previous level's governance while the new one is in flight.
  const [governanceSettled, setGovernanceSettled] = useState(null);
  const refreshPublicConfigurations = useCallback(async () => {
    const projectId = project.id;
    const scale = project.activeScale;
    const stageId = STAGES[project.stage]?.id || 'add-source';
    try {
      const [preflight, builder] = await Promise.all([
        getPublicConfiguration('preflight', scale, stageId),
        getPublicConfiguration('builder', scale, stageId),
      ]);
      setProject((current) => {
        if (current.id !== projectId || current.activeScale !== scale || STAGES[current.stage]?.id !== stageId) return current;
        if (current.teacherGovernance?.preflight?.fingerprint === preflight.fingerprint && current.teacherGovernance?.builder?.fingerprint === builder.fingerprint
          && JSON.stringify(current.teacherGovernance?.preflight?.fieldNotesQuestions) === JSON.stringify(preflight.fieldNotesQuestions)) return current;
        const next = structuredClone(current);
        next.teacherGovernance = { preflight, builder, refreshedAt: new Date().toISOString() };
        next.updatedAt = new Date().toISOString();
        return next;
      });
      return true;
    } catch {
      return false;
    } finally {
      setGovernanceSettled({ projectId, scale, stageId });
    }
  }, [project.id, project.activeScale, project.stage]);
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
      if (error instanceof ApiError && (error.status === 401 || institutionalMode && error.status === 403)) {
        if (accessGeneration !== accessGenerationRef.current) return false;
        try {
          const currentSession = await (institutionalMode ? readInstitutionalSession({ workspace: persistenceStorageRef.current }) : getStudentSession());
          if (accessGeneration !== accessGenerationRef.current) return false;
          if (currentSession.access) {
            setAccessState({ status: 'granted', access: currentSession.access, message: null, kind: 'info' });
            return false;
          }
          pauseAccess();
          return false;
        } catch (sessionError) {
          if (institutionalMode && accessGeneration === accessGenerationRef.current) pauseAccess(sessionFailureState(sessionError, true));
          markPrototypeFailure(sequence);
          return false;
        }
      }
      markPrototypeFailure(sequence);
      return false;
    });
  }, [accessState.status, markPrototypeFailure, institutionalMode, pauseAccess]);

  const update = useCallback((mutator, action, detail, actor = 'student', metadata = null, transaction = null) => setProject((current) => {
    // Import guards run against the actual state, including queued edits. A
    // pre-created event lets intake announce success only after that commit.
    if (transaction?.guard && !transaction.guard(current)) return current;
    const next = structuredClone(current);
    mutator(next);
    if (next.levelProgress?.[next.activeScale]) {
      next.levelProgress[next.activeScale].stage = next.stage;
      next.levelProgress[next.activeScale].reflection = next.reflection;
    }
    next.updatedAt = new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString();
    if (action) next.events.push(transaction?.event || createEvent(action, detail, actor, metadata));
    if (next.events.length > 500) next.events = next.events.slice(-500);
    return next;
  }), []);

  const recordStageTransition = useCallback((fromStage, toStage, { completed = false, success = true } = {}) => {
    if (completed) logPrototype('stage_completed', { fromStage, toStage, success }, STAGES[fromStage].label);
    logPrototype('stage_viewed', { fromStage, toStage }, STAGES[toStage].label);
  }, [logPrototype]);

  const setStage = (stage, options = {}) => {
    setNotebookOpen(stage !== 3 || requiresInitialModel(projectRef.current));
    if (!Number.isInteger(stage) || stage < 0 || stage >= STAGES.length) return false;
    if (stage >= 2 && requiresInitialModel(projectRef.current)) {
      toast('Continue from Memo review to start your map', 'error');
      return false;
    }
    const fromStage = project.stage;
    setMapPreviewOpen(false);
    update((draft) => {
      draft.stage = stage;
      draft.furthestStage = Math.max(draft.furthestStage || 0, stage);
    }, 'stage.opened', STAGES[stage].label);
    recordStageTransition(fromStage, stage, options);
    return true;
  };

  const handleReviewApiError = async (error, accessGeneration, retryLabel = 'memo-guidance request') => {
    if (error instanceof ApiError && ['course_access_disabled', 'course_not_allowed', 'course_invalid', 'course_access_denied', 'course_access_unavailable', 'course_prompt_changed'].includes(error.payload?.details?.code)) {
      return toast(userFacingError(error), 'error', 8000);
    }
    if (error instanceof TimeoutError || error instanceof ApiError && error.status === 504 && error.payload?.details?.code === 'guidance_timeout') {
      return toast(retryLabel.includes('connection')
        ? 'Connection suggestions took too long. Try again.'
        : 'Guidance took too long. Try again.', 'error', 8000);
    }
    if (error instanceof ApiError && (error.status === 401 || institutionalMode && error.status === 403) && accessGeneration === accessGenerationRef.current) {
      try {
        const session = await (institutionalMode ? readInstitutionalSession({ workspace: persistenceStorageRef.current }) : getStudentSession());
        if (accessGeneration !== accessGenerationRef.current) return;
        if (session.access) {
          setAccessState({ status: 'granted', access: session.access, message: null, kind: 'info' });
          toast(institutionalMode ? 'Sign-in confirmed. Try again.' : `Class access is still valid. Retry the ${retryLabel}.`, 'error');
          return;
        }
        pauseAccess();
        return;
      } catch (sessionError) {
        if (institutionalMode) {
          if (accessGeneration === accessGenerationRef.current) pauseAccess(sessionFailureState(sessionError, true));
          return;
        }
        toast('The classroom server could not confirm access. Your local project remains active; retry when the server is available.', 'error');
        return;
      }
    }
    if (error instanceof ApiError) {
      if (error.status === 413) return toast('The guidance request is too large. Shorten the memo and try again.', 'error');
      if (error.status === 429 || error.status === 409 && error.payload?.details?.code === 'guidance_in_progress') {
        if (error.payload?.details?.shouldRetry === false) return toast(userFacingError(error), 'error', 8000);
        const seconds = error.payload?.details?.retryAfterSeconds;
        const waitSeconds = Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 86_400 ? seconds : 2;
        reviewRetryAtRef.current = Date.now() + waitSeconds * 1000;
        setReviewRetryAt(reviewRetryAtRef.current);
        return toast(waitSeconds <= 120 ? `Guidance is busy. Try again in ${waitSeconds} ${waitSeconds === 1 ? 'second' : 'seconds'}.` : 'Guidance is paused. Try again later.', 'error', 8000);
      }
      if ([502, 503, 504].includes(error.status)) {
        const details = error.payload?.details;
        if (details?.code === 'guidance_unavailable') {
          const feature = retryLabel.includes('connection') ? 'Connection suggestions are' : 'Guidance is';
          const waitSeconds = Number.isSafeInteger(details.retryAfterSeconds) && details.retryAfterSeconds > 0 && details.retryAfterSeconds <= 86_400 ? details.retryAfterSeconds : 1;
          const nextStep = details.retryable === true
            ? ` Try again in ${waitSeconds} ${waitSeconds === 1 ? 'second' : 'seconds'}.`
            : requiresInitialModel(projectRef.current)
              ? ' Retry to start your map.'
              : ' Retry when ready or continue with your existing map.';
          return toast(`${feature} unavailable. Your project is unchanged.${nextStep}`, 'error', 8000);
        }
        return toast('Guidance is temporarily unavailable. Try again later.', 'error');
      }
      return toast(`The ${retryLabel} could not be completed. Your project remains editable; try again.`, 'error');
    }
    toast(userFacingError(error, retryLabel.includes('connection')
      ? 'Connection suggestions could not be completed. Try again.'
      : 'Guidance could not be completed. Try again.'), 'error');
  };

  const generateSuggestions = async ({ resume = false } = {}) => {
    if (reviewInFlightRef.current || reviewRetryAtRef.current > Date.now()) return false;
    const payload = preflightEvaluationPayload(project);
    const encoder = new TextEncoder();
    const sourceBytes = encoder.encode(prepareProviderMemo(payload.sourceMaterial).sourceText).byteLength;
    if (payload.inquiry.length > MAX_EVALUATION_INQUIRY_CHARACTERS) {
      toast(`The guiding inquiry must be ${MAX_EVALUATION_INQUIRY_CHARACTERS.toLocaleString()} characters or fewer before generating suggestions.`, 'error');
      return;
    }
    if (payload.projectOverlay.customInstructions.length > MAX_EVALUATION_CUSTOM_INSTRUCTIONS) {
      toast(`Suggestion-model custom instructions must be ${MAX_EVALUATION_CUSTOM_INSTRUCTIONS.toLocaleString()} characters or fewer before generating suggestions.`, 'error');
      return;
    }
    const runtime = accessState.access?.suggestionRuntime;
    const hostedModelRuntime = ['ollama-cloud', 'openrouter', 'cail-gateway'].includes(runtime?.provider);
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
    const cacheRequestKey = stableId('guidance-cache', `${requestKey}:${JSON.stringify(accessState.access)}`);
    const request = { controller: new AbortController(), projectId: project.id };
    reviewRequestRef.current = request;
    reviewInFlightRef.current = true;
    setReviewFailure(null);
    setReviewBusy('evaluating');
    setReviewProgress(resume ? 'Recovering your saved request…' : 'Saving your generation request…');
    try {
      const cached = readGuidanceCache(projectStorage(), project.id, cacheRequestKey);
      let result;
      if (cached) {
        try { result = normalizePreflightEvaluation(cached.evaluation, project); }
        catch { removeGuidanceCacheEntry(projectStorage(), project.id, cacheRequestKey); }
      }
      const response = result ? cached : await createPreflightEvaluation(payload, { signal: request.controller.signal, durable: institutionalMode,
        projectId: project.id, requestKey, resume, retryFailed: !resume && Boolean(reviewFailure),
        onProgress: message => { if (reviewRequestRef.current === request) setReviewProgress(message); } });
      if (request.controller.signal.aborted) return false;
      if (!response || !Object.hasOwn(response, 'evaluation')) throw new Error('The server returned guidance in an unexpected format. Generate the guidance again.');
      if (accessGeneration !== accessGenerationRef.current || projectRef.current.id !== project.id) return;
      if (authoritativeEvaluationKey(projectRef.current) !== requestKey) {
        toast('The memo or model setup changed while guidance was generated. Generate again from the current project.', 'error');
        return;
      }
      if (!result) {
        result = normalizePreflightEvaluation(response.evaluation, projectRef.current);
        writeGuidanceCache(projectStorage(), project.id, cacheRequestKey, response);
      }
      update((draft) => { draft.preflight = result; }, 'preflight.completed', 'Memo guidance generated', 'student', {
        sourceFingerprint: result.sourceFingerprint,
        configurationSnapshot: result.configurationSnapshot,
        runtime: result.evaluation.runtime,
        evaluation: { createdAt: result.evaluation.createdAt, expiresAt: result.evaluation.expiresAt },
      });
      toast('Guidance is ready.');
      return result;
    } catch (error) {
      if (request.controller.signal.aborted) return false;
      if (accessGeneration !== accessGenerationRef.current || projectRef.current.id !== project.id) return false;
      const quotaDenied = error instanceof ApiError && error.payload?.details?.code === 'quota_exceeded';
      setReviewFailure({
        message: error instanceof TimeoutError ? 'Guidance took too long. Try again.'
          : userFacingError(error, 'Guidance could not be completed. Try again.'),
        retryable: !quotaDenied,
      });
      setReviewBusy(null);
      await handleReviewApiError(error, accessGeneration, 'guidance request');
      return false;
    } finally {
      if (reviewRequestRef.current === request) {
        reviewRequestRef.current = null;
        reviewInFlightRef.current = false;
        if (accessGeneration === accessGenerationRef.current) setReviewBusy(null);
      }
    }
  };

  useEffect(() => {
    if (!institutionalMode || accessState.status !== 'granted' || project.stage !== 1) return;
    const key = authoritativeEvaluationKey(project);
    if (resumedGuidance.current === key || !hasPendingGuidance(projectStorage(), project.id, key)) return;
    resumedGuidance.current = key;
    void generateSuggestions({ resume: true });
  }, [institutionalMode, accessState.status, project.id, project.activeScale, project.stage, project.teacherGovernance]);

  const generateConnectionSuggestions = async () => {
    const effectivePrompt = connectionPrompt.trim() || memoPromptExcerpt(project.submission.text);
    if (!effectivePrompt) return toast('Write a sentence about how the nodes connect, or add memo text first.', 'error');
    const payload = connectionSuggestionPayload(project, effectivePrompt);
    if (payload.nodes.length < 2) return toast('Add at least two nodes to the map before requesting connections.', 'error');
    if (payload.nodes.length > 50) return toast('Choose 50 or fewer nodes for one connection request.', 'error');
    if (payload.projectOverlay.customInstructions.length > MAX_EVALUATION_CUSTOM_INSTRUCTIONS) {
      return toast('Project instructions are too long for connection suggestions. Ask your instructor to shorten them.', 'error');
    }
    const accessGeneration = accessGenerationRef.current;
    const requestKey = stableId('connection-request', JSON.stringify(payload));
    setConnectionBusy(true);
    try {
      const response = await suggestMapConnections(payload, { durable: institutionalMode, projectId: project.id + '-connections', requestKey, retryFailed: true });
      if (accessGeneration !== accessGenerationRef.current || projectRef.current.id !== project.id) return;
      if (stableId('connection-request', JSON.stringify(connectionSuggestionPayload(projectRef.current, connectionPromptRef.current.trim() || memoPromptExcerpt(projectRef.current.submission.text)))) !== requestKey) {
        toast('The nodes or description changed while suggestions were being prepared. Request them again.', 'error');
        return;
      }
      const normalized = normalizeConnectionSuggestions(response, projectRef.current);
      if (!projectRef.current.instructor.requireStudentConfirmation && normalized.length) {
        commitMapSelections(projectRef.current, {
          automatic: true,
          suggestedConnections: normalized.map((edge) => ({ ...edge, status: 'confirmed', claimState: 'inference', reviewDecision: 'pending' })),
        });
        return;
      }
      setConnectionSuggestions(normalized);
      toast(normalized.length ? 'Connections are ready for your review.' : 'No connections were suggested. Add more detail and try again.');
    } catch (error) {
      await handleReviewApiError(error, accessGeneration, 'connection request');
    } finally {
      if (accessGeneration === accessGenerationRef.current) setConnectionBusy(false);
    }
  };

  // One explicit action, one bounded model request over the carried map.
  // Results stay in session state; nothing is written to the project.
  const runMapCheck = async (intent, focus = null) => {
    const current = projectRef.current;
    const payload = mapCheckPayload(current, intent, focus);
    if (!payload.nodes.length) return toast('Add at least one item to the map before checking it.', 'error');
    const accessGeneration = accessGenerationRef.current;
    const requestKey = stableId('map-check', JSON.stringify(payload));
    setMapCheck({ intent, focus, scale: current.activeScale, requestKey, busy: true, notes: null, error: null });
    try {
      const response = await checkMap(payload, { durable: institutionalMode, projectId: current.id + '-map-check', requestKey, retryFailed: true });
      if (accessGeneration !== accessGenerationRef.current || projectRef.current.id !== current.id) return;
      const refIds = new Set([...payload.nodes.map((node) => node.id), ...payload.relationships.map((edge) => edge.id)]);
      const notes = (Array.isArray(response?.notes) ? response.notes : [])
        .filter((note) => note && typeof note.point === 'string' && Array.isArray(note.refs) && note.refs.every((ref) => refIds.has(ref)))
        .slice(0, 4).map((note) => ({ kind: String(note.kind), point: note.point.slice(0, 300), refs: note.refs.slice(0, 4) }));
      setMapCheck((state) => state?.requestKey === requestKey ? { ...state, busy: false, notes } : state);
    } catch (error) {
      setMapCheck((state) => state?.requestKey === requestKey ? { ...state, busy: false, error: userFacingError(error, 'The map check could not be completed. Your map is unchanged.') } : state);
      await handleReviewApiError(error, accessGeneration, 'map check request');
    }
  };

  const editConnectionSuggestion = (id, field, value) => {
    const nodeById = new Map(nodesForConnectionPrompt(projectRef.current).map((node) => [node.id, node]));
    setConnectionSuggestions((current) => current.map((suggestion) => {
      if (suggestion.id !== id) return suggestion;
      const next = { ...suggestion, [field]: value };
      if (field === 'source') next.sourceLabel = nodeById.get(value)?.label || next.sourceLabel;
      if (field === 'target') next.targetLabel = nodeById.get(value)?.label || next.targetLabel;
      if (field === 'source' || field === 'target' || field === 'verb') {
        next.rationale = 'You edited this suggestion.';
        next.status = 'pending';
        next.claimState = 'inference';
        next.reviewDecision = 'pending';
      }
      return next;
    }));
  };

  const decideConnectionSuggestion = (id, status) => {
    const suggestion = connectionSuggestions.find((item) => item.id === id);
    if (suggestion && status === 'confirmed' && project.activeScale === 'exosphere') {
      const nodeById = new Map(nodesForConnectionPrompt(project).map((node) => [node.id, node]));
      const carriedMicroNodeIds = new Set(project.graph.nodes
        .filter((node) => node.status !== 'rejected' && node.claimState !== 'retired' && node.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(node.type))
        .map((node) => node.id));
      if (!isOrientedExospherePathway(nodeById.get(suggestion.source), nodeById.get(suggestion.target), carriedMicroNodeIds)) {
        toast('Choose an outside decision setting and an affected Micro setting or outside office.', 'error');
        return;
      }
    }
    setConnectionSuggestions((current) => current.map((suggestion) => suggestion.id === id
      ? { ...suggestion, status, claimState: status === 'confirmed' ? 'student interpretation' : 'inference', reviewDecision: status === 'confirmed' ? 'added' : 'removed' }
      : suggestion));
  };

  const buildCandidatesFromProject = (currentProject) => {
    const fingerprint = memoFingerprint(currentProject.submission);
    const storedReview = currentProject.preflight?.sourceFingerprint === fingerprint ? currentProject.preflight.memoReview : null;
    // A validated model review is the sole source of automatic suggestions.
    const liveGraphNodes = new Map(currentProject.graph.nodes
      .filter((node) => node.status !== 'rejected' && node.claimState !== 'retired')
      .map((node) => [node.id, node]));
    const review = storedReview;
    const liveGraphNodeIdsByLabel = new Map([...liveGraphNodes.values()]
      .map((node) => [node.label.trim().toLocaleLowerCase(), node.id]));
    const priorNodeIdsByLabel = new Map([
      ...currentProject.graph.nodes, ...currentProject.candidates.nodes,
    ].filter((node) => node.scale === currentProject.activeScale)
      .map((node) => [node.label.trim().toLocaleLowerCase(), node.id]));
    const nodeIdForLabel = (label) => priorNodeIdsByLabel.get(label.trim().toLocaleLowerCase())
      || (currentProject.activeScale !== 'micro' ? liveGraphNodeIdsByLabel.get(label.trim().toLocaleLowerCase()) : null)
      || stableId('node', label);
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
        const existing = liveGraphNodes.get(id);
        const previouslySuggested = currentProject.candidates.nodes.some((item) => item.id === id && item.scale === currentProject.activeScale);
        if (nodeById.has(id) || (existing && (existing.scale !== currentProject.activeScale || !previouslySuggested))) invalidReview();
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
          origin: 'model suggestion',
          reviewDecision: 'pending',
          evidence: node.evidence || '',
          sourceFingerprint: fingerprint,
          notes: '',
          ...(node.basis ? { basis: node.basis } : {}),
          ...(currentProject.activeScale === 'micro' ? {
            focalParticipation: 'direct',
            settingNodeIds: [],
          } : {}),
          // Meso linkages and Macrosphere items carry their mapped members as
          // durable graph ids the student can edit directly.
          ...(['meso', 'macrosphere'].includes(currentProject.activeScale) ? {
            ...(currentProject.activeScale === 'macrosphere' ? { deontic: node.deontic } : {}),
            scopeNodeIds,
          } : {}),
        });
      });
    const edgeKeyOf = (edge) => `${edge.source}::${edge.verb.trim().toLocaleLowerCase()}::${edge.target}`;
    // A connection that already lives on the map is settled work: it never
    // returns as a candidate, so a later level cannot re-log or re-scale it.
    const liveEdgeKeys = new Set(currentProject.graph.edges
      .filter((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired')
      .map(edgeKeyOf));
    const edgeByKey = new Map();
    (review?.connections || []).forEach((connection) => {
      let source = nodeIdForReference(connection.source, connection.sourceLabel || connection.source);
      let target = nodeIdForReference(connection.target, connection.targetLabel || connection.target);
      const availableNodes = new Map([...liveGraphNodes, ...nodeById]);
      if (!availableNodes.has(source) || !availableNodes.has(target) || source === target) invalidReview();
      if (connection.sourceLabel !== availableNodes.get(source).label || connection.targetLabel !== availableNodes.get(target).label) invalidReview();
      if (currentProject.activeScale === 'exosphere') {
        const carriedMicroNodeIds = new Set([...liveGraphNodes.values()]
          .filter((node) => node.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(node.type))
          .map((node) => node.id));
        const [orientedSource, orientedTarget] = orientExospherePathway(availableNodes.get(source), availableNodes.get(target), carriedMicroNodeIds);
        source = orientedSource?.id || source;
        target = orientedTarget?.id || target;
      }
      const id = stableId('edge', `${source}:${connection.verb}:${target}`);
      const edge = {
        id,
        source,
        target,
        sourceLabel: availableNodes.get(source).label,
        targetLabel: availableNodes.get(target).label,
        verb: connection.verb,
        scale: currentProject.activeScale,
        status: 'pending',
        claimState: 'inference',
        origin: 'model suggestion',
        reviewDecision: 'pending',
        directed: true,
        rationale: connection.rationale || '',
        evidence: connection.rationale || '',
        ...(connection.relationshipProcess ? { relationshipProcess: createRelationshipProcess(connection.relationshipProcess) } : {}),
        sourceFingerprint: fingerprint,
        notes: '',
        annotation: { id: stableId('annotation', `edge:${id}:relationship`), text: '' },
      };
      const key = edgeKeyOf(edge);
      const previouslySuggested = currentProject.candidates.edges.some((item) => item.id === id && item.scale === currentProject.activeScale);
      if (edgeByKey.has(key) || (liveEdgeKeys.has(key) && !previouslySuggested)) invalidReview();
      edgeByKey.set(key, edge);
    });
    // Decisions already made on matching items survive a reread.
    const priorNodes = new Map(currentProject.candidates.nodes.filter((node) => node.scale === currentProject.activeScale).map((node) => [node.id, node]));
    const priorEdges = new Map(currentProject.candidates.edges.filter((edge) => edge.scale === currentProject.activeScale).map((edge) => [edge.id, edge]));
    // A selective next response must not erase the student's earlier choices.
    for (const prior of priorNodes.values()) if (!nodeById.has(prior.id)) nodeById.set(prior.id, prior);
    for (const prior of priorEdges.values()) if (!edgeByKey.has(edgeKeyOf(prior))) edgeByKey.set(edgeKeyOf(prior), prior);
    const nodes = withDefaultNodeLayout([...nodeById.values()].map((node) => {
      const prior = priorNodes.get(node.id);
      const scaled = { ...node, scale: currentProject.activeScale };
      // A student's decisions and scope edits on a matching item survive a
      // memo reread; only the model-refreshed evidence and copy update.
      return prior ? {
        ...scaled,
        label: prior.label,
        type: prior.type,
        status: prior.status,
        claimState: prior.claimState,
        origin: prior.origin || scaled.origin,
        reviewDecision: prior.reviewDecision || scaled.reviewDecision,
        notes: prior.notes || node.notes,
        ...(prior.scopeNodeIds !== undefined ? { scopeNodeIds: prior.scopeNodeIds } : {}),
        ...(prior.deontic !== undefined ? { deontic: prior.deontic } : {}),
        ...(prior.settingNodeIds !== undefined ? { settingNodeIds: prior.settingNodeIds } : {}),
        ...(prior.focalParticipation !== undefined ? { focalParticipation: prior.focalParticipation } : {}),
      } : scaled;
      }));
    // New undecided suggestions lead the next review without discarding settled choices.
    const settled = item => ['added', 'removed', 'set aside'].includes(item.reviewDecision);
    nodes.sort((a, b) => Number(settled(a)) - Number(settled(b)));
    const resolvedNodes = new Map(nodes.map(node => [node.id, node]));
    const edges = [...edgeByKey.values()].map((edge) => {
      const prior = priorEdges.get(edge.id);
      // A later-level memo may name a node that already exists in the graph.
      // Keep that carried node's durable identity and current label on the
      // candidate edge so validation and commit cannot move or duplicate it.
      const source = prior?.source || edge.source;
      const target = prior?.target || edge.target;
      const sourceNode = resolvedNodes.get(source) || liveGraphNodes.get(source);
      const targetNode = resolvedNodes.get(target) || liveGraphNodes.get(target);
      const scaled = {
        ...edge,
        source,
        target,
        verb: prior?.verb || edge.verb,
        sourceLabel: sourceNode?.label || edge.sourceLabel,
        targetLabel: targetNode?.label || edge.targetLabel,
        scale: currentProject.activeScale,
      };
      return prior ? { ...scaled, status: prior.status, claimState: prior.claimState, origin: prior.origin || scaled.origin, reviewDecision: prior.reviewDecision || scaled.reviewDecision, notes: prior.notes || edge.notes, ...(prior.relationshipProcess ? { relationshipProcess: prior.relationshipProcess } : {}) } : scaled;
    });
    // Micro identifies items; Macro stores scope on each condition.
    if (currentProject.activeScale === 'micro' || currentProject.activeScale === 'macrosphere') {
      if (edges.length) invalidReview();
      return { nodes, edges: [] };
    }
    return { nodes, edges };
  };

  const prepareCandidates = (sourceProject = project) => {
    const project = sourceProject;
    if (requiresInitialModel(project)) return false;
    let candidates;
    try {
      candidates = buildCandidatesFromProject(project);
    } catch {
      toast('The guidance could not be used as returned. Generate it again; the current map was preserved.', 'error');
      return false;
    }
    if (!project.instructor.requireStudentConfirmation) {
      const includeNew = (item, kind) => {
        const prior = project.candidates[kind].find((candidate) => candidate.id === item.id && candidate.scale === project.activeScale);
        // A previous removal, deferral, or explicit decision survives regeneration.
        if (prior && (prior.status !== 'pending' || (prior.reviewDecision && prior.reviewDecision !== 'pending'))) return item;
        return { ...item, status: 'confirmed', claimState: 'inference', reviewDecision: 'pending' };
      };
      const prepared = {
        ...project,
        candidates: {
          nodes: [...project.candidates.nodes.filter((item) => item.scale !== project.activeScale), ...candidates.nodes.map((item) => includeNew(item, 'nodes'))],
          edges: [...project.candidates.edges.filter((item) => item.scale !== project.activeScale), ...candidates.edges.map((item) => includeNew(item, 'edges'))],
        },
      };
      return commitMapSelections(prepared, { installCandidates: true, automatic: true });
    }
    const snapshot = configurationSnapshot(project, 'builder');
    update((draft) => {
      draft.candidates = {
        nodes: [...draft.candidates.nodes.filter((item) => item.scale !== draft.activeScale), ...candidates.nodes],
        edges: [...draft.candidates.edges.filter((item) => item.scale !== draft.activeScale), ...candidates.edges],
      };
      draft.stage = 2;
      draft.furthestStage = Math.max(draft.furthestStage || 0, 2);
    }, 'candidates.generated', `${candidates.nodes.length} nodes and ${candidates.edges.length} relationships`, 'student', { configurationSnapshot: snapshot, sourceFingerprint: memoFingerprint(project.submission) });
    recordStageTransition(project.stage, 2, { completed: true });
    const itemCount = candidates.nodes.length + candidates.edges.length;
    toast(itemCount
      ? project.activeScale === 'micro'
        ? 'Micro-level items from your memo are ready for review.'
        : project.activeScale === 'meso'
          ? 'Relationships between your Micro items are ready for review.'
          : project.activeScale === 'exosphere'
            ? 'Institutions and relationships from your memo are ready for review.'
            : 'Macro-level conditions from your memo are ready for review.'
      : 'The review did not suggest any items. Add an item yourself, or revise the memo and choose “Reread memo.”');
    return true;
  };

  const refreshCandidatesFromMemo = async () => {
    const result = await generateSuggestions();
    if (!result) return;
    // React may not have committed the preflight state update yet. Build the
    // next choices from the response we just validated, never the old review.
    const current = { ...projectRef.current, preflight: result };
    if (!current.instructor.requireStudentConfirmation) return prepareCandidates(current);
    let candidates;
    try {
      candidates = buildCandidatesFromProject(current);
    } catch {
      toast('The refreshed guidance could not be used as returned. The current suggestions were preserved.', 'error');
      return;
    }
    update((draft) => {
      draft.candidates = {
        nodes: [...draft.candidates.nodes.filter((item) => item.scale !== draft.activeScale), ...candidates.nodes],
        edges: [...draft.candidates.edges.filter((item) => item.scale !== draft.activeScale), ...candidates.edges],
      };
    }, 'candidates.refreshed', `${candidates.nodes.length} nodes and ${candidates.edges.length} relationships`, 'student', { sourceFingerprint: memoFingerprint(current.submission) });
    toast(candidates.nodes.length + candidates.edges.length ? 'Suggestions refreshed from your memo.' : 'The revised review did not suggest any items. You can add an item yourself.');
  };

  const commitMapSelections = (sourceProject = project, { installCandidates = false, automatic = false, suggestedConnections = connectionSuggestions } = {}) => {
    const project = sourceProject;
    const lowerLevelMacroCandidate = project.candidates.nodes.find((item) => (
      item.scale === project.activeScale
      &&
      item.scale === 'macrosphere'
      && item.status === 'confirmed'
      && isObviousLowerLevelMacroLabel(item.label)
    ));
    if (lowerLevelMacroCandidate) return toast(LOWER_LEVEL_MACRO_MESSAGE, 'error');
    const reviewedScaleNodes = project.candidates.nodes.filter((item) => item.scale === project.activeScale);
    const graphNodeById = new Map(project.graph.nodes.map((node) => [node.id, node]));
    const reservedNodeIds = new Set(project.graph.nodes.map((node) => node.id));
    const committedNodeIdByCandidateId = new Map();
    reviewedScaleNodes.forEach((candidate) => {
      const sameIdGraphNode = graphNodeById.get(candidate.id);
      if (!sameIdGraphNode || sameIdGraphNode.scale === project.activeScale) {
        committedNodeIdByCandidateId.set(candidate.id, candidate.id);
        reservedNodeIds.add(candidate.id);
        return;
      }
      const priorMatchingNode = project.graph.nodes.find((node) => (
        node.scale === project.activeScale
        && node.label.trim().toLocaleLowerCase() === candidate.label.trim().toLocaleLowerCase()
      ));
      if (priorMatchingNode) {
        committedNodeIdByCandidateId.set(candidate.id, priorMatchingNode.id);
        reservedNodeIds.add(priorMatchingNode.id);
        return;
      }
      let attempt = 0;
      let replacementId;
      do {
        replacementId = stableId('node', `${project.activeScale}:${candidate.label}:${attempt}`);
        attempt += 1;
      } while (reservedNodeIds.has(replacementId));
      committedNodeIdByCandidateId.set(candidate.id, replacementId);
      reservedNodeIds.add(replacementId);
    });
    const rekeyNode = (node) => {
      const id = committedNodeIdByCandidateId.get(node.id) || node.id;
      const settingNodeIds = Array.isArray(node.settingNodeIds)
        ? node.settingNodeIds.map((settingId) => committedNodeIdByCandidateId.get(settingId) || settingId)
        : node.settingNodeIds;
      const membershipChanged = Array.isArray(settingNodeIds)
        && settingNodeIds.some((settingId, index) => settingId !== node.settingNodeIds[index]);
      if (id === node.id && !membershipChanged) return node;
      return {
        ...node,
        id,
        ...(Array.isArray(settingNodeIds) ? { settingNodeIds } : {}),
        annotations: id === node.id ? node.annotations : {
          analytical: { id: stableId('annotation', `node:${id}:analytical`), text: node.annotations?.analytical?.text || '' },
          evidence: { id: stableId('annotation', `node:${id}:evidence`), text: node.annotations?.evidence?.text || '' },
        },
      };
    };
    const rekeyEdge = (edge) => {
      const source = committedNodeIdByCandidateId.get(edge.source) || edge.source;
      const target = committedNodeIdByCandidateId.get(edge.target) || edge.target;
      if (source === edge.source && target === edge.target) return edge;
      const id = stableId('edge', `${source}:${edge.verb}:${target}`);
      return {
        ...edge,
        id,
        source,
        target,
        annotation: { id: stableId('annotation', `edge:${id}:relationship`), text: edge.annotation?.text || '' },
      };
    };
    const acceptedNodes = reviewedScaleNodes
      .filter((item) => item.status === 'confirmed')
      .map(rekeyNode);
    const availableMicroSettingIds = new Set([
      ...project.graph.nodes.filter((node) => node.scale === 'micro'
        && MICRO_SETTING_NODE_TYPE_SET.has(node.type)
        && node.status !== 'rejected' && node.claimState !== 'retired').map((node) => node.id),
      ...acceptedNodes.filter((node) => node.scale === 'micro'
        && MICRO_SETTING_NODE_TYPE_SET.has(node.type)).map((node) => node.id),
    ]);
    const unresolvedMembership = acceptedNodes.find((node) => (node.settingNodeIds || [])
      .some((settingId) => !availableMicroSettingIds.has(settingId)));
    if (unresolvedMembership) {
      return toast(`Add each selected Micro setting for ${unresolvedMembership.label}, or remove the unavailable setting membership before opening the map.`, 'error');
    }
    const acceptedNodeIds = new Set(acceptedNodes.map((node) => node.id));
    const liveGraphNodeIds = new Set(project.graph.nodes
      .filter((node) => node.status !== 'rejected' && node.claimState !== 'retired')
      .map((node) => node.id));
    const endpointIds = new Set([...liveGraphNodeIds, ...acceptedNodeIds]);
    const relationshipsAllowed = project.activeScale === 'meso' || project.activeScale === 'exosphere';
    const reviewedScaleEdges = project.candidates.edges
      .filter((item) => item.scale === project.activeScale)
      .map(rekeyEdge);
    const rekeyedConnectionSuggestions = suggestedConnections.map(rekeyEdge);
    if (project.activeScale === 'exosphere') {
      const nodeById = new Map([...project.graph.nodes, ...acceptedNodes].map((node) => [node.id, node]));
      const carriedMicroNodeIds = new Set(project.graph.nodes
        .filter((node) => node.status !== 'rejected' && node.claimState !== 'retired' && node.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(node.type))
        .map((node) => node.id));
      const invalidAcceptedPathway = [...reviewedScaleEdges, ...rekeyedConnectionSuggestions].find((edge) => (
        edge.scale === 'exosphere'
        && edge.status === 'confirmed'
        && !isOrientedExospherePathway(nodeById.get(edge.source), nodeById.get(edge.target), carriedMicroNodeIds)
      ));
      if (invalidAcceptedPathway) return toast('Repair or remove each Exo-level connection before opening the map. Every connection needs an outside decision setting and an affected Micro setting or outside office.', 'error');
    }
    const acceptedEdges = relationshipsAllowed ? reviewedScaleEdges
      .filter((item) => item.status === 'confirmed' && endpointIds.has(item.source) && endpointIds.has(item.target)) : [];
    const acceptedSuggestions = relationshipsAllowed ? rekeyedConnectionSuggestions
      .filter((edge) => edge.status === 'confirmed' && edge.verb.trim() && edge.source !== edge.target) : [];
    const reviewedNodeIds = new Set(reviewedScaleNodes.map((node) => committedNodeIdByCandidateId.get(node.id) || node.id));
    const reviewedEdgeIds = new Set(reviewedScaleEdges.map((edge) => edge.id));
    const removedGraphNodeIds = new Set([...reviewedNodeIds].filter((id) => (
      !acceptedNodeIds.has(id) && project.graph.nodes.some((node) => node.id === id && node.scale === project.activeScale && node.status !== 'rejected' && node.claimState !== 'retired')
    )));
    const dependentScope = project.graph.nodes.find((node) => node.status !== 'rejected' && node.claimState !== 'retired'
      && (node.scopeNodeIds || []).some((id) => removedGraphNodeIds.has(id)));
    if (dependentScope) return toast(`Review or remove ${dependentScope.label} before removing one of its map items.`, 'error');
    const dependentRelationship = project.graph.edges.find((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired'
      && (removedGraphNodeIds.has(edge.source) || removedGraphNodeIds.has(edge.target))
      && !reviewedEdgeIds.has(edge.id));
    if (dependentRelationship) return toast(`Review or remove ${relationshipDescription(dependentRelationship)} before removing its node.`, 'error');
    const snapshot = configurationSnapshot(project, 'builder');
    const applySelections = (draft) => {
      if (installCandidates) draft.candidates = structuredClone(project.candidates);
      const priorNodeById = new Map(draft.graph.nodes.map((node) => [node.id, node]));
      const priorEdgeById = new Map(draft.graph.edges.map((edge) => [edge.id, edge]));
      const positionedAcceptedNodes = priorNodeById.size === 0
        ? withDefaultNodeLayout(acceptedNodes.map(({ x: _x, y: _y, ...node }) => node))
        : acceptedNodes;
      const nextNodes = positionedAcceptedNodes.map((node) => {
        const prior = priorNodeById.get(node.id);
        const addsNewSetting = Array.isArray(node.settingNodeIds)
          && node.settingNodeIds.some((settingId) => acceptedNodeIds.has(settingId) && !priorNodeById.has(settingId));
        return {
          ...node,
          x: prior?.x ?? node.x,
          y: prior?.y ?? node.y,
          annotations: prior?.annotations ?? node.annotations,
          notes: node.notes || prior?.notes || '',
          claimEvidence: prior?.claimEvidence ?? node.claimEvidence,
          ...(node.scale === 'meso' ? { mesoExplanation: prior?.mesoExplanation ?? node.mesoExplanation ?? '' } : {}),
          ...(node.scale === 'micro' ? {
            focalParticipation: prior?.focalParticipation ?? node.focalParticipation,
            settingNodeIds: addsNewSetting ? node.settingNodeIds : prior?.settingNodeIds ?? node.settingNodeIds,
          } : {}),
          claimState: node.status === 'research lead' ? 'research lead' : node.claimState,
        };
      });
      const nextEdges = acceptedEdges.map((edge) => {
        const prior = priorEdgeById.get(edge.id);
        return {
          ...edge,
          annotation: prior?.annotation ?? edge.annotation,
          notes: edge.notes || prior?.notes || '',
          claimEvidence: prior?.claimEvidence ?? edge.claimEvidence,
          relationshipProcess: prior?.relationshipProcess ?? edge.relationshipProcess,
          claimState: edge.status === 'research lead' ? 'research lead' : edge.claimState,
        };
      });
      const nodeIds = new Set(nextNodes.map((node) => node.id));
      const edgeIds = new Set(nextEdges.map((edge) => edge.id));
      // Candidate ids are stable from memo text and can collide with a renamed
      // carried node from another level. A review at the current level may
      // retire only graph nodes at that same level.
      const retiredNodeIds = new Set([...reviewedNodeIds].filter((id) => (
        !nodeIds.has(id) && priorNodeById.get(id)?.scale === project.activeScale
      )));
      const priorNodes = draft.graph.nodes.map((node) => retiredNodeIds.has(node.id) ? { ...node, status: 'rejected', claimState: 'retired', notes: [node.notes, 'Retired during candidate review.'].filter(Boolean).join(' ') } : node);
      const priorEdges = draft.graph.edges.map((edge) => ((reviewedEdgeIds.has(edge.id) && !edgeIds.has(edge.id)) || retiredNodeIds.has(edge.source) || retiredNodeIds.has(edge.target)) ? { ...edge, status: 'rejected', claimState: 'retired', notes: [edge.notes, 'Retired during candidate review.'].filter(Boolean).join(' ') } : edge);
      draft.graph.nodes = [...priorNodes.filter((node) => !nodeIds.has(node.id)), ...nextNodes];
      const currentNodes = draft.graph.nodes.filter((node) => node.status !== 'rejected' && node.claimState !== 'retired');
      const addedNodes = currentNodes.filter(node => !priorNodeById.has(node.id));
      // Existing coordinates belong to the student. Candidate commits place
      // only new items; Arrange remains the explicit way to move the full map.
      if (addedNodes.length && mapNodesOverlap(currentNodes)) {
        const repairedPositions = ECOLOGY_MAP_SCALES.has(project.activeScale)
          ? arrangedEcologyPositions(currentNodes)
          : arrangedMapPositions(currentNodes, new Set(currentNodes.map((node) => node.scale)).size > 1);
        const occupied = currentNodes.filter(node => priorNodeById.has(node.id) && node.scale !== 'meso')
          .map(node => ecologyCardBounds(node, mapNodeGeometry(node.label), 12));
        addedNodes.forEach((node) => {
          const preferred = repairedPositions.get(node.id) || node;
          const geometry = mapNodeGeometry(node.label);
          const clear = position => !occupied.some(bounds => ecologyBoundsIntersect(ecologyCardBounds(position, geometry), bounds));
          let position = preferred;
          if (!clear(position)) {
            // Search only for this new card against the retained coordinates.
            // The bounded world grid also handles custom imported placements.
            const candidates = [];
            const pitchX = geometry.cardWidth + 24;
            const pitchY = geometry.cardHeight + 24;
            for (let row = -Math.ceil(WORLD_HEIGHT / pitchY); row <= Math.ceil(WORLD_HEIGHT / pitchY); row += 1) {
              for (let column = -Math.ceil(WORLD_WIDTH / pitchX); column <= Math.ceil(WORLD_WIDTH / pitchX); column += 1) {
                const candidate = { x: preferred.x + column * pitchX, y: preferred.y + row * pitchY };
                if (candidate.x < geometry.cardWidth / 2 + 12 || candidate.x > WORLD_WIDTH - geometry.cardWidth / 2 - 12
                  || candidate.y < geometry.cardHeight / 2 + 12 || candidate.y > WORLD_HEIGHT - geometry.cardHeight / 2 - 12) continue;
                if (clear(candidate)) candidates.push(candidate);
              }
            }
            position = candidates.sort((left, right) => Math.hypot(left.x - preferred.x, left.y - preferred.y)
              - Math.hypot(right.x - preferred.x, right.y - preferred.y))[0] || preferred;
          }
          Object.assign(node, position);
          occupied.push(ecologyCardBounds(position, geometry, 12));
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
        draft.graph.edges.push({ ...edge, sourceLabel: draft.graph.nodes.find(node => node.id === edge.source).label, targetLabel: draft.graph.nodes.find(node => node.id === edge.target).label, verb: edge.verb.trim(), status: 'confirmed', claimState: edge.claimState || 'inference' });
        existingIds.add(edge.id);
        existingConnections.add(key);
      });
      draft.stage = 3;
      draft.furthestStage = Math.max(draft.furthestStage || 0, 3);
    };
    if (automatic) {
      try {
        const proposed = structuredClone(project);
        applySelections(proposed);
        validateProject(proposed);
      } catch {
        toast('Suggestions could not be added — generate guidance again', 'error');
        return false;
      }
    }
    update(applySelections, 'graph.committed', `${acceptedNodes.length} nodes, ${acceptedEdges.length} relationships, and ${acceptedSuggestions.length} suggested connections ${automatic ? 'added automatically' : 'added'}`, 'student', {
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
    setNotebookOpen(false);
    recordStageTransition(project.stage, 3, { completed: true });
    const pendingCount = [...project.candidates.nodes, ...project.candidates.edges].filter((item) => item.scale === project.activeScale && item.status === 'pending').length;
    const pendingNote = pendingCount ? ` ${pendingCount} undecided ${pendingCount === 1 ? 'item' : 'items'} stayed off the map.` : '';
    toast(acceptedNodes.length || acceptedEdges.length || acceptedSuggestions.length ? `${automatic ? 'Suggestions added to the map' : 'Map updated'}${pendingNote}` : 'No new items to add');
    return true;
  };

  const primary = async ({ mesoReviewed = false } = {}) => {
    if (project.stage >= 2 && requiresInitialModel(projectRef.current)) return setStage(1);
    switch (project.stage) {
      case 0: setStage(1, { completed: true }); break;
      case 1: {
        if (reviewInFlightRef.current) return;
        const current = projectRef.current;
        if (requiresLevelModel(current)) {
          const result = await generateSuggestions();
          if (!result) return;
          return prepareCandidates({ ...projectRef.current, preflight: result });
        }
        prepareCandidates(current);
        break;
      }
      case 2: {
        if (project.instructor.requireStudentConfirmation) {
          commitMapSelections();
          break;
        }
        const includePending = (item) => item.scale === project.activeScale
          && item.status === 'pending' && (!item.reviewDecision || item.reviewDecision === 'pending')
          ? { ...item, status: 'confirmed', claimState: 'inference', reviewDecision: 'pending' }
          : item;
        commitMapSelections({
          ...project,
          candidates: {
            nodes: project.candidates.nodes.map(includePending),
            edges: project.candidates.edges.map(includePending),
          },
        }, { installCandidates: true, automatic: true });
        break;
      }
      case 3: setStage(4, { completed: true }); break;
      case 4:
        {
          if (!hasFieldNotes(project)) {
            toast('Add Field Notes before continuing.', 'error');
            document.querySelector('.reflection')?.focus();
            return;
          }
          if (project.activeScale === 'meso' && !mesoReviewed) { setModal('meso-review'); return; }
          const currentScale = project.activeScale;
          const currentIndex = SCALE_ORDER.indexOf(currentScale);
          const nextScale = currentIndex >= 0 ? SCALE_ORDER[currentIndex + 1] || null : null;
        // The memo travels with the project, so the next level opens directly
        // on Review — the model rereads for the new level instead of walking
        // the student back through the intake form they already completed.
        update((draft) => {
          if (!draft.completedScales.includes(currentScale)) draft.completedScales.push(currentScale);
          draft.completedScales = SCALE_ORDER.filter((scale) => draft.completedScales.includes(scale));
          draft.levelProgress[currentScale] = { stage: 4, reflection: draft.reflection };
          if (nextScale) {
            draft.activeScale = nextScale;
            if (!draft.releasedScales.includes(nextScale)) draft.releasedScales.push(nextScale);
            draft.releasedScales = SCALE_ORDER.filter((scale) => draft.releasedScales.includes(scale));
            const nextProgress = draft.levelProgress[nextScale] || { stage: 1, reflection: '' };
            draft.stage = nextProgress.stage;
            draft.reflection = nextProgress.reflection;
            draft.preflight = null;
          } else {
            draft.stage = 4;
          }
          draft.furthestStage = Math.max(draft.furthestStage || 0, 4);
        }, 'scale.cycle-completed', nextScale
          ? `${SCALES[currentScale].label} completed; ${SCALES[nextScale].label} opened`
          : `${SCALES[currentScale].label} completed`);
        setConnectionPrompt('');
        setConnectionSuggestions([]);
        recordStageTransition(4, nextScale ? (project.levelProgress?.[nextScale]?.stage ?? 1) : 4, { completed: true });
        toast(nextScale
          ? `${SCALES[currentScale].label} complete. Continue with ${SCALES[nextScale].label}.`
          : `${SCALES[currentScale].label} complete. Your cumulative project is ready to review or export.`);
        if (nextScale) setPendingLevelRead(nextScale);
        break;
        }
      default: break;
    }
  };

  const restartFromCurrentMemo = () => {
    const previous = archiveCurrentProject({ allowSavedFallback: true });
    if (!previous) return;
    const restarted = createBlankProject();
    const newSubmissionId = restarted.submission.id;
    restarted.title = `${project.title || 'Untitled systems map'} — new map`;
    restarted.participantName = project.participantName;
    restarted.inquiry = project.inquiry;
    restarted.sharingTier = project.sharingTier;
    restarted.submission = { ...structuredClone(project.submission), id: newSubmissionId };
    restarted.configs = structuredClone(project.configs);
    restarted.instructor = structuredClone(project.instructor);
    restarted.teacherGovernance = structuredClone(project.teacherGovernance);
    restarted.events = [
      createEvent('project.created', 'Started a new map from an existing memo'),
      createEvent('map.restarted', `Copied memo and framing from ${project.title || 'an earlier project'}`),
    ];
    let records;
    try {
      records = saveProjectToLibrary(projectStorage(), restarted, previous.records, { makeActive: true });
    } catch (error) {
      setPersistenceBlocked(true);
      setSaveState((current) => ({
        ...current,
        status: 'error',
        message: 'The new map could not be saved on this device. Your existing project remains open.',
        diagnostic: technicalDiagnostic(error),
      }));
      toast('The new map was not started. Your existing project remains open.', 'error');
      return;
    }
    activateProject(restarted, records);
    setConnectionPrompt('');
    setConnectionSuggestions([]);
    setMapPreviewOpen(false);
    setModal(null);
    toast('New Micro map started from this memo. The earlier project remains in Projects.');
  };

  const selectWorkScale = (scale, targetStage = null) => {
    if (!project.releasedScales.includes(scale)) return;
    if (scale === project.activeScale) {
      if (targetStage !== null) setStage(targetStage);
      setModal(null); return;
    }
    update((draft) => {
      draft.levelProgress[draft.activeScale] = { stage: draft.stage, reflection: draft.reflection };
      draft.activeScale = scale;
      const target = draft.levelProgress[scale] || { stage: 1, reflection: '' };
      draft.stage = targetStage ?? target.stage;
      draft.reflection = target.reflection;
      draft.preflight = null;
    }, 'scale.selected', `${SCALES[scale].label} selected for work`);
    setConnectionPrompt('');
    setConnectionSuggestions([]);
    setMapPreviewOpen(false);
    setModal(null);
    toast(`Working at ${SCALES[scale].label}. The cumulative map and prior decisions remain.`);
  };

  // One computed next action replaces the five-step footer. Rules live in
  // nextStep.js and read saved project state only; stage records are unchanged.
  const step = nextStep(project, { reviewBusy: Boolean(reviewBusy), retryPending: reviewRetryAt > Date.now(), initialModelRequired });
  const runNextStep = () => {
    switch (step.id) {
      case 'start-review': setStage(1, { completed: true }); break;
      case 'review-level': setStage(4, { completed: true }); break;
      case 'project-complete': break;
      default: void primary();
    }
  };
  useEffect(() => {
    if (!pendingLevelRead || project.activeScale !== pendingLevelRead || project.stage !== 1) return;
    // The course appendix is refetched for each level and stage. A read issued before
    // that refresh settles is keyed to the previous level's governance, and its result is
    // discarded if the snapshot changes mid-flight. Wait for the refresh of this level and
    // stage to settle; this effect re-runs when it does.
    const refreshing = workspaceStarted && accessState.status === 'granted';
    const settled = governanceSettled?.projectId === project.id
      && governanceSettled.scale === project.activeScale
      && governanceSettled.stageId === STAGES[project.stage]?.id;
    if (refreshing && !settled) return;
    setPendingLevelRead(null);
    if (!project.submission.text.trim() || reviewInFlightRef.current || !requiresLevelModel(project)) return;
    void primary();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLevelRead, project.activeScale, project.stage, project.teacherGovernance, governanceSettled]);
  const backDisabled = project.stage === 0;
  const activateProject = useCallback((next, records, { openWorkspace = true } = {}) => {
    projectActivationGenerationRef.current += 1;
    window.clearTimeout(persistTimer.current);
    window.clearTimeout(linkSyncTimer.current);
    pendingAnnotationsRef.current.clear();
    projectRef.current = next;
    commitProjectRecords(records);
    setProject(next);
    setReviewBusy(null);
    setConnectionBusy(false);
    setConnectionPrompt('');
    setConnectionSuggestions([]);
    setMapPreviewOpen(false);
    setMapCheck(null);
    setStudioHighlight(null);
    setHasSavedProject(true);
    setWorkspaceStarted(openWorkspace);
    setPendingNewProject(false);
    setModal(null);
    setSaveState((current) => ({ ...current, status: 'saved', message: 'Project saved on this device', savedRevision: (current.savedRevision || 0) + 1 }));
    const nextLink = loadStoredLink(projectStorage(), next.id);
    linkRef.current = nextLink;
    setLink(nextLink);
    mirrorActiveLink(projectStorage(), nextLink);
    setLinkStatus(projectLinkStatus(nextLink));
    setLinkMessage(null);
    const pathToken = urlLinkToken();
    if (pathToken && pathToken !== nextLink?.token) window.history.replaceState(null, '', courseWorkspacePath('/', projectStorage().courseSelection));
  }, [commitProjectRecords]);

  const archiveCurrentProject = useCallback(({ allowSavedFallback = false } = {}) => {
    window.clearTimeout(persistTimer.current);
    window.clearTimeout(linkSyncTimer.current);
    const committed = commitPendingAnnotations();
    const snapshot = committed.project;
    if (!hasSavedProject && !workspaceStarted) return { snapshot, records: projectRecordsRef.current };
    try {
      const records = saveProjectToLibrary(projectStorage(), snapshot, projectRecordsRef.current);
      if (linkRef.current?.projectId === snapshot.id) rememberStoredLink(projectStorage(), linkRef.current);
      commitProjectRecords(records);
      setHasSavedProject(true);
      return { snapshot, records };
    } catch (error) {
      try {
        serializeProject(snapshot);
      } catch (validationError) {
        if (allowSavedFallback && hasSavedProject) {
          const durableProject = loadDurableProject(projectStorage(), snapshot.id);
          if (durableProject) {
            try {
              const records = saveProjectToLibrary(projectStorage(), durableProject, projectRecordsRef.current);
              let recovery = null;
              try {
                recovery = JSON.stringify(snapshot);
                projectStorage().setItem(`systems-mapping-studio.recovery.${Date.now()}`, recovery);
              } catch {
                // The last valid project is still preserved even if the invalid draft cannot be copied.
              }
              commitProjectRecords(records);
              return { snapshot, records, usedSavedFallback: true, recovery };
            } catch {
              // Fall through to the blocking validation message below.
            }
          }
        }
        setSaveState((current) => ({
          ...current,
          status: 'validation',
          message: 'One map item needs attention before you switch projects.',
          diagnostic: technicalDiagnostic(validationError),
        }));
        toast('One map item needs attention before you switch projects.', 'error');
        return null;
      }
      setPersistenceBlocked(true);
      setSaveState((current) => ({
        ...current,
        status: 'error',
        message: 'Browser storage could not save this project. The current project remains open.',
        diagnostic: technicalDiagnostic(error),
        recovery: current.recovery || serializeProject(snapshot),
      }));
      toast('The current project could not be saved, so it remains open.', 'error');
      return null;
    }
  }, [commitPendingAnnotations, commitProjectRecords, hasSavedProject, toast, workspaceStarted]);

  const replaceProject = useCallback((imported, fileName = 'Imported project') => {
    const next = structuredClone(imported);
    next.updatedAt = new Date().toISOString();
    next.events = [...(next.events || []), createEvent('project.imported', fileName)].slice(-500);
    const previous = archiveCurrentProject();
    if (!previous) return false;
    let records;
    try {
      records = saveProjectToLibrary(projectStorage(), next, previous.records, { makeActive: true, preserveReplaced: true });
    } catch (error) {
      setPersistenceBlocked(true);
      setSaveState((current) => ({
        ...current,
        status: 'error',
        message: 'The imported project could not be saved on this device. The current project remains open.',
        diagnostic: technicalDiagnostic(error),
      }));
      toast('The imported project could not be saved. The current project remains open.', 'error');
      return false;
    }
    activateProject(next, records);
    logPrototype('project_imported', { stageIndex: next.stage, nodeCount: next.graph.nodes.length, edgeCount: next.graph.edges.length }, STAGES[next.stage].label);
    logPrototype('stage_viewed', { fromStage: previous.snapshot.stage, toStage: next.stage }, STAGES[next.stage].label);
    return true;
  }, [activateProject, archiveCurrentProject, logPrototype, toast]);

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
      if (!Number.isSafeInteger(activeLink.revision)) {
        const remote = await fetchProjectLink(activeLink.token);
        if (remote.project !== serialized) {
          const conflictedLink = mergeProjectLinkMetadata(activeLink, remote);
          rememberStoredLink(projectStorage(), conflictedLink);
          linkRef.current = conflictedLink;
          setLink(conflictedLink);
          setLinkStatus('conflict');
          setLinkMessage('This older link differs from the copy on this device. Choose which copy to keep.');
          return false;
        }
        const reconciledLink = mergeProjectLinkMetadata(activeLink, { ...remote, lastSyncedAt: remote.updatedAt || Date.now() });
        rememberStoredLink(projectStorage(), reconciledLink);
        linkRef.current = reconciledLink;
        setLink(reconciledLink);
        setLinkStatus('synced');
        setLinkMessage(null);
        return true;
      }
      const result = await updateProjectLink(activeLink.token, serialized, activeLink.revision);
      if (linkRef.current?.token !== activeLink.token || projectRef.current.id !== snapshot.id) return false;
      const syncedLink = mergeProjectLinkMetadata(activeLink, { ...result, lastSyncedAt: result.updatedAt || Date.now() });
      rememberStoredLink(projectStorage(), syncedLink);
      linkRef.current = syncedLink;
      setLink(syncedLink);
      setLinkStatus('synced');
      setLinkMessage(null);
      return true;
    } catch (error) {
      if (linkRef.current?.token !== activeLink.token || projectRef.current.id !== snapshot.id) return false;
      setLinkStatus(error instanceof ApiError && error.status === 409
        ? 'conflict'
        : error instanceof ApiError && error.status === 410
          ? (error.message.includes('revoked') ? 'revoked' : 'expired')
          : 'error');
      setLinkMessage(describeLinkError(error, institutionalMode));
      return false;
    }
  }, [institutionalMode]);

  useEffect(() => {
    if (!workspaceStarted || !link || link.projectId !== project.id
      || ['conflict', 'expired', 'revoked'].includes(linkStatus)) return undefined;
    const lastSyncedAt = new Date(link.lastSyncedAt || 0).getTime();
    const projectUpdatedAt = new Date(project.updatedAt || 0).getTime();
    if (Number.isFinite(lastSyncedAt) && Number.isFinite(projectUpdatedAt) && lastSyncedAt >= projectUpdatedAt) return undefined;
    window.clearTimeout(linkSyncTimer.current);
    linkSyncTimer.current = window.setTimeout(syncLinkNow, LINK_SYNC_DEBOUNCE_MS);
    return () => window.clearTimeout(linkSyncTimer.current);
  }, [project, workspaceStarted, link, linkStatus, syncLinkNow]);

  useEffect(() => {
    if (accessState.status !== 'granted' || linkLoadAttemptedRef.current) return;
    linkLoadAttemptedRef.current = true;
    const token = urlLinkToken();
    if (!token) return;
    let active = true;
    const activationGeneration = projectActivationGenerationRef.current;
    fetchProjectLink(token).then((result) => {
      if (!active || activationGeneration !== projectActivationGenerationRef.current || urlLinkToken() !== token) return;
      const incoming = parseProject(result.project);
      if (result.projectId && result.projectId !== incoming.id) throw new Error('The project link metadata does not match its project.');
      const nextLink = mergeProjectLinkMetadata({ token, projectId: incoming.id }, {
        ...result,
        lastSyncedAt: result.updatedAt || Date.now(),
      });
      rememberStoredLink(projectStorage(), nextLink);
      const local = projectRef.current;
      if (local.id !== incoming.id || Date.parse(incoming.updatedAt || 0) > Date.parse(local.updatedAt || 0)) {
        if (!replaceProject(incoming, 'Project link')) {
          const currentLink = loadStoredLink(projectStorage(), projectRef.current.id);
          linkRef.current = currentLink;
          setLink(currentLink);
          setLinkStatus('error');
          setLinkMessage('The linked project could not replace the current workspace because the current project was not saved.');
          return;
        }
      } else {
        setLink(nextLink);
        linkRef.current = nextLink;
        mirrorActiveLink(projectStorage(), nextLink);
      }
      setHasSavedProject(true);
      setLinkStatus('synced');
      setLinkMessage(null);
    }).catch((error) => {
      if (!active || activationGeneration !== projectActivationGenerationRef.current || urlLinkToken() !== token) return;
      setLinkStatus(error instanceof ApiError && error.status === 410
        ? (error.message.includes('revoked') ? 'revoked' : 'expired')
        : 'error');
      setLinkMessage(error instanceof ApiError
        ? describeLinkError(error, institutionalMode)
        : 'The linked project could not be opened safely. The project on this device was not replaced.');
    });
    return () => { active = false; };
  }, [accessState.status, replaceProject, institutionalMode]);

  const createLink = useCallback(async () => {
    const committed = commitPendingAnnotations();
    const snapshot = committed.project;
    let serialized;
    try {
      serialized = serializeProject(snapshot);
    } catch (error) {
      const message = 'The project link was not created because one map item needs attention.';
      setLinkStatus('error');
      setLinkMessage(`${message} Review or remove the unfinished item, then try again.`);
      reportProjectValidationFailure(error, message);
      return;
    }
    setLinkStatus('creating');
    setLinkMessage(null);
    try {
      const result = await createProjectLink(serialized);
      const nextLink = mergeProjectLinkMetadata({ token: result.token, projectId: snapshot.id }, {
        ...result,
        lastSyncedAt: result.updatedAt || Date.now(),
      });
      rememberStoredLink(projectStorage(), nextLink);
      if (projectRef.current.id !== snapshot.id) return;
      setLink(nextLink);
      linkRef.current = nextLink;
      setLinkStatus('synced');
      window.history.replaceState(null, '', courseWorkspacePath(`/p/${result.token}`, projectStorage().courseSelection));
      toast('Project link created.');
    } catch (error) {
      if (projectRef.current.id !== snapshot.id) return;
      setLinkStatus('error');
      const message = describeLinkError(error, institutionalMode);
      setLinkMessage(message);
      toast(message, 'error');
    }
  }, [commitPendingAnnotations, toast, institutionalMode]);

  const archiveDeviceCopyBeforeLinkReload = useCallback(() => {
    const current = structuredClone(projectRef.current);
    const nonce = globalThis.crypto?.randomUUID?.().replaceAll('-', '')
      || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    current.id = `project_${nonce}`;
    current.title = `${current.title || 'Untitled systems map'} — device copy`;
    current.updatedAt = new Date().toISOString();
    current.events = [...(current.events || []), createEvent('project.copied', 'Preserved before loading a different linked revision')].slice(-500);
    try {
      const records = saveProjectToLibrary(projectStorage(), current, projectRecordsRef.current);
      commitProjectRecords(records);
      return true;
    } catch (error) {
      setLinkStatus('error');
      setLinkMessage('The device copy could not be preserved, so the linked version was not opened. Use Save recovery before trying again.');
      setSaveState((current) => ({
        ...current,
        status: 'error',
        message: 'Browser storage could not preserve the device copy. The linked version was not opened.',
        diagnostic: technicalDiagnostic(error),
      }));
      return false;
    }
  }, [commitProjectRecords]);

  const loadLinkedVersion = useCallback(async () => {
    const activeLink = linkRef.current;
    if (!activeLink) return;
    setLinkStatus('syncing');
    setLinkMessage(null);
    try {
      const result = await fetchProjectLink(activeLink.token);
      const incoming = parseProject(result.project);
      if (incoming.id !== activeLink.projectId || (result.projectId && result.projectId !== incoming.id)) {
        throw new Error('The linked project does not match this project.');
      }
      if (!archiveDeviceCopyBeforeLinkReload()) return;
      if (!replaceProject(incoming, 'Linked version chosen after a sync conflict')) return;
      const nextLink = mergeProjectLinkMetadata(activeLink, { ...result, lastSyncedAt: result.updatedAt || Date.now() });
      rememberStoredLink(projectStorage(), nextLink);
      linkRef.current = nextLink;
      setLink(nextLink);
      setLinkStatus('synced');
      setLinkMessage('The linked version is open. The earlier device copy remains in Projects.');
      setModal('project-link');
    } catch (error) {
      setLinkStatus(error instanceof ApiError && error.status === 410
        ? (error.message.includes('revoked') ? 'revoked' : 'expired')
        : 'error');
      setLinkMessage(describeLinkError(error, institutionalMode));
    }
  }, [archiveDeviceCopyBeforeLinkReload, replaceProject, institutionalMode]);

  const createNewLinkForDeviceCopy = useCallback(async () => {
    const activeLink = linkRef.current;
    if (activeLink) forgetStoredLink(projectStorage(), activeLink.projectId);
    mirrorActiveLink(projectStorage(), null);
    linkRef.current = null;
    setLink(null);
    setLinkStatus('idle');
    setLinkMessage(null);
    window.history.replaceState(null, '', courseWorkspacePath('/', projectStorage().courseSelection));
    await createLink();
  }, [createLink]);

  const revokeCurrentLink = useCallback(async () => {
    const activeLink = linkRef.current;
    if (!activeLink?.revision) return;
    setLinkStatus('syncing');
    try {
      const result = await revokeProjectLink(activeLink.token, activeLink.revision);
      const revokedLink = mergeProjectLinkMetadata(activeLink, result);
      rememberStoredLink(projectStorage(), revokedLink);
      linkRef.current = revokedLink;
      setLink(revokedLink);
      setLinkStatus('revoked');
      setLinkMessage('This link is turned off. Your device copy remains in Projects.');
      window.history.replaceState(null, '', courseWorkspacePath('/', projectStorage().courseSelection));
      setModal('project-link');
    } catch (error) {
      setLinkStatus(error instanceof ApiError && error.status === 409 ? 'conflict' : 'error');
      setLinkMessage(describeLinkError(error, institutionalMode));
      setModal('project-link');
    }
  }, [institutionalMode]);

  const deleteCurrentLink = useCallback(async () => {
    const activeLink = linkRef.current;
    if (!activeLink?.revision) return;
    setLinkStatus('syncing');
    try {
      await deleteProjectLink(activeLink.token, activeLink.revision);
      forgetStoredLink(projectStorage(), activeLink.projectId);
      mirrorActiveLink(projectStorage(), null);
      linkRef.current = null;
      setLink(null);
      setLinkStatus('idle');
      setLinkMessage(null);
      window.history.replaceState(null, '', courseWorkspacePath('/', projectStorage().courseSelection));
      setModal(null);
      toast('The server copy was deleted. Your device copy remains in Projects.');
    } catch (error) {
      setLinkStatus(error instanceof ApiError && error.status === 409 ? 'conflict' : 'error');
      setLinkMessage(describeLinkError(error, institutionalMode));
      setModal('project-link');
    }
  }, [toast, institutionalMode]);

  const [revisionSubmitting, setRevisionSubmitting] = useState(false);
  const submitRevision = async () => {
    if (revisionSubmitting) return;
    setRevisionSubmitting(true);
    try {
      const snapshot = commitPendingAnnotations().project;
      const result = await onSubmitRevision(snapshot);
      toast(result.recorded ? 'Revision submitted to your instructor.' : 'This stage already has that revision.');
    } catch (error) { toast(userFacingError(error, 'The revision could not be submitted. Your work remains saved.'), 'error'); }
    finally { setRevisionSubmitting(false); }
  };
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
  useEffect(() => { setNotebookOpen(project.stage !== 3); }, [project.id]);
  useEffect(() => { if (project.stage !== 3) setNotebookOpen(true); }, [project.stage, project.activeScale]);
  const panelDisabled = initialModelRequired ? ['inspector', 'review'] : [];
  const changePanelMode = (mode) => {
    if (mode === 'inspector' && project.stage === 3) return;
    setStage(stageForPanelMode(mode, projectRef.current), { completed: mode === 'review' && project.stage === 3 });
  };
  const suggestionsPanel = <SuggestionsPanel project={project} update={update} toast={toast} prompt={connectionPrompt} onPromptChange={setConnectionPrompt} busy={connectionBusy} suggestions={connectionSuggestions} onSuggest={generateConnectionSuggestions} onEdit={editConnectionSuggestion} onDecision={decideConnectionSuggestion} onRefreshCandidates={refreshCandidatesFromMemo} refreshBusy={Boolean(reviewBusy)} reviewBusy={reviewBusy} reviewProgress={reviewProgress} reviewFailure={reviewFailure} retryPending={reviewRetryAt > Date.now()} onGenerate={generateSuggestions} onHighlight={setStudioHighlight} />;
  const reviewPanel = <ReviewPanel onProjectLink={() => setModal('project-link')} project={project} update={update} replaceProject={replaceProject} toast={toast} logPrototype={logPrototype} onValidationError={reportProjectValidationFailure} onReviewLevel={(scale) => selectWorkScale(scale, 4)} onSubmitRevision={onSubmitRevision ? submitRevision : undefined} revisionSubmitting={revisionSubmitting} submitDisabled={Boolean(reviewBusy) || Boolean(connectionBusy)} />;
  const panel = project.stage >= 4 ? { mode: 'review', content: reviewPanel, disabled: panelDisabled }
    : project.stage === 3 && !mapPreviewOpen ? { mode: 'inspector', disabled: panelDisabled }
    : { mode: 'suggestions', content: suggestionsPanel, disabled: panelDisabled };
  const studio = <MapStage key={`${project.id}:${projectActivationGenerationRef.current}`} project={project} update={update} toast={toast} logPrototype={logPrototype} saveState={saveState} stageAnnotationDraft={stageAnnotationDraft} commitAnnotationDrafts={commitPendingAnnotations} flushSave={flushPersistence} onRequestRestart={() => setModal('restart-map')} panel={panel} onPanelMode={changePanelMode} notebook={{ open: notebookOpen, onChange: setNotebookOpen, action: project.stage === 1 && !project.preflight?.memoReview && requiresLevelModel(project) ? null : <button className="button notebook-next" type="button" data-next-action={step.id} disabled={step.blocking} onClick={runNextStep}>{project.stage === 2 ? 'Finish review' : project.stage === 3 ? 'Field Notes' : step.label}</button> }} toolbarHost={mapToolbarHost} toolbarStart={<LevelSelect levels={levelRailState(project)} onSelect={(scale) => selectWorkScale(scale)} />} highlight={studioHighlight} onHighlight={(value) => { setStudioHighlight(value); if (value) setNotebookOpen(false); }} mapCheck={mapCheck} onMapCheck={runMapCheck} mapItemLabel={mapItemLabel} />;
  const intakeOpen = project.stage === 0 && !mapPreviewOpen;
  const displayedStage = intakeOpen ? 0 : 3;
  const stageScreens = [<IntakeStage project={project} update={update} toast={toast} onRequestRestart={() => setModal('restart-map')} captureImportScope={() => {
    const access = accessGenerationRef.current;
    const activation = projectActivationGenerationRef.current;
    return () => access === accessGenerationRef.current && activation === projectActivationGenerationRef.current;
  }} />, studio, studio, studio, studio];
  const screen = stageScreens[displayedStage];
  const returnFromMapPreview = () => {
    setMapPreviewOpen(false);
    logPrototype('map_preview_closed', { stageIndex: project.stage }, STAGES[project.stage].label);
  };
  const openMapPreview = () => {
    if (mapPreviewOpen || project.stage >= 1) {
      workspaceRef.current?.focus();
      return;
    }
    if (requiresInitialModel(projectRef.current)) {
      setStage(1);
      toast('Continue from Memo review to start your map', 'error');
      return;
    }
    setMapPreviewOpen(true);
    logPrototype('map_previewed', { stageIndex: project.stage, nodeCount: project.graph.nodes.length, edgeCount: project.graph.edges.length }, STAGES[project.stage].label);
  };
  const openProjects = () => {
    if (!flushPersistence()) return;
    const dashboard = onOpenProjects || onAccountDashboard;
    if (dashboard) { void dashboard(); return; }
    setMapPreviewOpen(false);
    setWorkspaceStarted(false);
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

  const startBlankProject = () => {
    const previous = archiveCurrentProject({ allowSavedFallback: true });
    if (!previous) return;
    const blank = createBlankProject();
    let records;
    try {
      records = saveProjectToLibrary(projectStorage(), blank, previous.records, { makeActive: true });
    } catch (error) {
      setPersistenceBlocked(true);
      setSaveState((current) => ({
        ...current,
        status: 'error',
        message: 'The new project could not be saved on this device. Your current project remains available.',
        diagnostic: technicalDiagnostic(error),
      }));
      toast('The new project was not started because it could not be saved on this device.', 'error');
      return;
    }
    activateProject(blank, records);
    logPrototype('project_started', { stageIndex: 0, nodeCount: 0, edgeCount: 0 }, STAGES[0].label);
    logPrototype('stage_viewed', { fromStage: previous.snapshot.stage, toStage: 0 }, STAGES[0].label);
    toast(previous.usedSavedFallback
      ? 'New project started. The previous project remains at its last valid save; incomplete edits were not added.'
      : 'New project started. Your previous project is still saved.');
  };

  const openSavedProject = (record) => {
    let target;
    try {
      target = record.id === projectRef.current.id
        ? reconcileActiveProject(projectStorage(), projectRef.current)
        : loadLibraryProject(projectStorage(), record);
    } catch {
      toast('The selected project could not be opened safely. Its saved copy was left unchanged.', 'error');
      return false;
    }
    if (record.id === projectRef.current.id) {
      try {
        const records = saveProjectToLibrary(projectStorage(), target, projectRecordsRef.current, { makeActive: true });
        activateProject(target, records);
      } catch (error) {
        // The existing singleton is already the durable copy. Let the student
        // open it even when catalog migration is temporarily unavailable.
        activateProject(target, projectRecordsRef.current);
        setPersistenceBlocked(true);
        setSaveState((current) => ({
          ...current,
          status: 'error',
          message: 'The project opened, but browser storage could not update its saved record.',
          diagnostic: technicalDiagnostic(error),
          recovery: current.recovery || null,
        }));
      }
      logPrototype('project_resumed', { stageIndex: target.stage, nodeCount: target.graph.nodes.length, edgeCount: target.graph.edges.length }, STAGES[target.stage].label);
      return true;
    }
    const previous = archiveCurrentProject();
    if (!previous) return false;
    let records;
    try {
      records = saveProjectToLibrary(projectStorage(), target, previous.records, { makeActive: true });
    } catch (error) {
      setPersistenceBlocked(true);
      setSaveState((current) => ({
        ...current,
        status: 'error',
        message: 'The selected project could not be opened. The current project remains available.',
        diagnostic: technicalDiagnostic(error),
      }));
      toast('The selected project could not be opened. The current project remains available.', 'error');
      return false;
    }
    activateProject(target, records);
    logPrototype('project_resumed', { stageIndex: target.stage, nodeCount: target.graph.nodes.length, edgeCount: target.graph.edges.length }, STAGES[target.stage].label);
    return true;
  };

  const requestNewProject = () => {
    setPendingNewProject(true);
    if (persistenceBlocked) setModal('storage');
    else startBlankProject();
  };

  const continueInMemory = () => {
    if (pendingNewProject) {
      setPendingNewProject(false);
      setModal(null);
      toast('Starting another project requires browser storage so the current one can stay saved.', 'error');
      return;
    }
    setWorkspaceStarted(true);
    setModal(null);
    setSaveState((current) => ({ ...current, status: 'error', message: 'Changes are not being saved. Download a copy before closing this page.' }));
  };

  const preserveRecoveryAndEnableStorage = () => {
    try {
      if (saveState.recovery) {
        const recoveryKey = `systems-mapping-studio.recovery.${Date.now()}`;
        projectStorage().setItem(recoveryKey, saveState.recovery);
      }
      setPersistenceBlocked(false);
      setSaveState((current) => ({ ...current, status: 'saving', message: 'Trying to save…', recovery: saveState.recovery }));
      if (pendingNewProject) startBlankProject();
      else setModal(null);
    } catch (error) {
      setSaveState((current) => ({
        ...current,
        status: 'error',
        message: 'Browser storage is still unavailable. Download a copy or keep working without saving.',
        diagnostic: technicalDiagnostic(error),
      }));
    }
  };

  const downloadPrivateRecovery = () => {
    try {
      const snapshot = commitPendingAnnotations().project;
      download(exportFileName(snapshot, 'json', 'private-recovery'), serializeProject(snapshot));
      toast('Private recovery downloaded. This file includes your memo and Field Notes; keep it private.');
    } catch (error) {
      toast('The private recovery download could not be created. Keep this page open and resolve the save warning.', 'error');
    }
  };

  const recoveryModal = <Modal open={modal === 'storage'} title="Save recovery" onClose={() => setModal(null)}>
    <div className="confirm-panel">
      <p>{saveState.message}</p>
      <p>Choose how to continue. You can download a copy, keep working without saving, or try saving again.</p><p>Private recovery includes your full memo, Field Notes, and evidence. Keep this file private; use Export &amp; share for audience-redacted copies.</p>
      <div className="button-stack">
        {saveState.recovery && <button type="button" className="button button--secondary" onClick={() => download('systems-mapping-prior-recovery.json', saveState.recovery)}>Download earlier copy</button>}
        <button type="button" className="button button--secondary" onClick={downloadPrivateRecovery}>Download private recovery</button>
        <button type="button" className="button button--ghost" onClick={continueInMemory}>Keep working without saving</button>
        <button type="button" className="button" onClick={preserveRecoveryAndEnableStorage}>{saveState.recovery ? 'Save earlier copy and try again' : 'Try saving again'}</button>
      </div>
    </div>
  </Modal>;

  const validationModal = <Modal open={modal === 'validation'} title="Save needs attention" onClose={() => setModal(null)}>
    <div className="confirm-panel">
      <p>{saveState.message}</p>
      <p>Review the item you were editing. Complete its required name or connection, or remove the unfinished item. Saving will retry automatically. If you were exporting or creating a link, try that action again after this warning clears.</p>
      <div className="button-row"><button type="button" className="button" onClick={() => setModal(null)}>Return to project</button></div>
    </div>
  </Modal>;

  if (institutionalMode && accessState.status !== 'granted') return <InstitutionalAccessScreen state={accessState} onRetry={() => setSessionCheck((current) => current + 1)} onLeave={flushPersistence} dark={dark} onToggleTheme={toggleTheme} />;

  if (teacherOpen) return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><LabLink /><a href="#workspace" className="brand__home" aria-label="Systems Mapping Instructor Console home"><strong>Systems Mapping</strong><small>Instructor Console</small></a></div>
      <div className="header-actions"><ThemeToggle dark={dark} onToggle={toggleTheme} /><button className="text-button" type="button" onClick={() => workspaceStarted ? setTeacherOpen(false) : onAccountDashboard ? void onAccountDashboard() : setTeacherOpen(false)}><Icon name="back" />{workspaceStarted ? 'Back to project' : onAccountDashboard ? 'Projects' : 'Back to class access'}</button></div>
    </header>
    <main ref={workspaceRef} tabIndex="-1" id="workspace" className="workspace workspace--teacher">
      <Suspense fallback={<p role="status">Loading Instructor Console…</p>}><TeacherDashboard resetToken={passwordResetToken} onResetComplete={finishPasswordReset} onConfigurationChanged={refreshAfterTeacherChange} institutionalMode={Boolean(onAccountDashboard)} /></Suspense>
    </main>
  </div>;

  if (accessState.status !== 'granted') return <ClassAccessScreen state={accessState} onSubmit={submitClassCode} onTeacher={() => setTeacherOpen(true)} dark={dark} onToggleTheme={toggleTheme} />;

  if (!workspaceStarted) return <>
    <ProjectsScreen projects={projectRecords} activeProjectId={hasSavedProject ? project.id : null} saveState={saveState} onOpen={openSavedProject} onManageLink={(record) => { if (openSavedProject(record)) setModal('project-link'); }} onStart={requestNewProject} onTeacher={() => setTeacherOpen(true)} onEndAccess={endAccess} onRecovery={() => setModal('storage')} linkNotice={linkStatus === 'error' ? linkMessage : null} dark={dark} onToggleTheme={toggleTheme} />
    {recoveryModal}
    <Modal open={modal === 'new-project'} title="Start new project?" onClose={() => { setPendingNewProject(false); setModal(null); }}>
      <div className="confirm-panel"><p>Your current project will stay saved on this device. You can return to it from Projects.</p><div className="button-row"><button type="button" className="button button--ghost" onClick={() => { setPendingNewProject(false); setModal(null); }}>Cancel</button><button type="button" className="button" onClick={startBlankProject}>Start new project</button></div></div>
    </Modal>
  </>;

  return <div className="app-shell">
    <header className="app-header app-header--student">
      <div className="brand"><LabLink /><a href="/" className="brand__home" aria-label="Systems Mapping home" onClick={(event) => { event.preventDefault(); openProjects(); }}><strong>Systems Mapping</strong></a></div>
      <div className="header-actions"><ProjectMenu>
        <div className="project-menu-brand"><LabLink /></div>
        <button className="text-button" type="button" onClick={openProjects}>Projects</button>
        <button className="text-button" type="button" onClick={() => setModal('stages')}>Progress</button>
        <button className="text-button" type="button" onClick={() => setModal('exports')}>Export &amp; share</button>
        <details><summary>Preferences</summary><SuggestionPreference project={project} update={update} /><ThemeToggle dark={dark} onToggle={toggleTheme} showLabel /></details>
      </ProjectMenu><div ref={setMapToolbarHost} className="workspace-map-controls" /></div>
    </header>
    <div className="sr-only" aria-live="polite">{mapPreviewOpen ? `Viewing map. Current stage remains ${STAGES[project.stage].label}.` : `Current section ${STAGES[project.stage].label}`}</div>
    <main ref={workspaceRef} tabIndex="-1" id="workspace" className={`workspace workspace--stage-${displayedStage}${intakeOpen ? '' : ' workspace--studio'}`}>
      {cloudSaveStatus && <span className="sr-only" role="status">{cloudSaveStatus}</span>}
      {cloudError && <div className="account-error" role="alert"><p>{cloudError}</p><p>Private recovery includes your full memo, Field Notes, and evidence. Keep this file private.</p><button type="button" className="button button--secondary" onClick={downloadPrivateRecovery}>Download private recovery</button></div>}
      {['error', 'validation'].includes(saveState.status) && <div className="workspace-save-notice" role="alert"><span>{saveState.status === 'validation' ? 'Finish the map item to save' : 'Changes are not saved'}</span><button type="button" onClick={() => setModal(saveState.status === 'validation' ? 'validation' : 'storage')}>{saveState.status === 'validation' ? 'Review issue' : 'Recover project'}</button></div>}
      {screen}
    </main>
    {intakeOpen ? <footer className="app-footer">{mapPreviewOpen ? <><div className="footer-context"><strong>Map preview</strong><span>Current stage · {STAGES[project.stage].short}</span></div><div className="footer-actions"><button className="button" type="button" onClick={returnFromMapPreview}><Icon name="back" />Back to {STAGES[project.stage].short}</button></div></> : <><div className="footer-context"><strong>{STAGES[project.stage].label}</strong><span className="next-step-detail">{step.detail}</span></div><div className="footer-actions"><button className="button button--ghost" type="button" disabled={backDisabled} onClick={() => setStage(project.stage - 1)}><Icon name="back" />Back</button><button className="button" type="button" data-next-action={step.id} disabled={step.blocking} onClick={runNextStep}>{step.label}{project.stage !== 1 && <Icon name="arrow" />}</button></div></>}</footer> : <footer className="app-footer notebook-footer"><nav aria-label="Workspace"><button type="button" aria-pressed={!notebookOpen} onClick={() => setNotebookOpen(false)}>Map</button><button type="button" aria-pressed={notebookOpen} aria-controls="map-inspector" onClick={() => { if (project.stage === 3) changePanelMode('review'); setNotebookOpen(true); }}>Notebook</button></nav><span ref={bugReportDock} className="workspace-bug-report" /></footer>}
    <Modal open={modal === 'exports'} title="Export & share" onClose={() => setModal(null)}><ReviewPanel exportOnly onProjectLink={() => setModal('project-link')} project={project} update={update} replaceProject={replaceProject} toast={toast} logPrototype={logPrototype} onValidationError={reportProjectValidationFailure} /></Modal>
    <Modal open={modal === 'stages'} title="Progress" onClose={() => setModal(null)}>
      <p className="modal-context">{SCALES[project.activeScale].label} · {STAGES[project.stage].short}</p>
      <section className="level-progress-summary" aria-labelledby="level-progress-title">
        <h2 id="level-progress-title">Level progression</h2>
        <ol>{SCALE_ORDER.map((scale) => <li key={scale}><strong>{SCALES[scale].label}</strong><span>{levelProgressStatus(project, scale)}</span></li>)}</ol>
      </section>
      <div className="progress-actions"><button className="button button--ghost" type="button" onClick={() => setModal('project-link')}>Project link</button></div>
       <ol className="stage-menu">{STAGES.map((stage, index) => {
         return <li key={stage.id}><button aria-label={stage.label} className={index === project.stage ? 'is-current' : ''} onClick={() => { if (setStage(index)) setModal(null); }}><strong><span aria-hidden="true">{index + 1}. </span>{stage.label}</strong>{index === project.stage ? <em>Current</em> : null}</button></li>;
       })}</ol>
    </Modal>
    <Modal open={modal === 'restart-map'} title="Start new map from this memo?" onClose={() => setModal(null)}>
      <div className="confirm-panel"><p>This creates a new project at Micro with the same memo and framing. Your current project stays saved in Projects.</p><div className="button-row"><button type="button" className="button button--ghost" onClick={() => setModal(null)}>Cancel</button><button type="button" className="button" onClick={restartFromCurrentMemo}>Start new map</button></div></div>
    </Modal>
    <Modal open={modal === 'meso-review'} title="Review Micro and Meso" onClose={() => setModal(null)}>
      <div className="confirm-panel"><p>Pause here to check the Micro settings and the interactions connecting them at Meso. Your cumulative map is saved and ready to review or export.</p><div className="button-row"><button type="button" className="button" onClick={() => { setModal(null); setStage(3); }}>Review the map</button><button type="button" className="button button--ghost" onClick={() => { setModal(null); void primary({ mesoReviewed: true }); }}>Continue to Exo-level</button></div></div>
    </Modal>
    <Modal open={modal === 'new-project'} title="Start new project?" onClose={() => { setPendingNewProject(false); setModal(null); }}>
      <div className="confirm-panel"><p>Your current project will stay saved on this device. You can return to it from Projects.</p><div className="button-row"><button type="button" className="button button--ghost" onClick={() => { setPendingNewProject(false); setModal(null); }}>Cancel</button><button type="button" className="button" onClick={startBlankProject}>Start new project</button></div></div>
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
          {institutionalMode ? <>
            <p>This link stores your complete memo, framing, map, notes, and revision history for 90 days</p>
            <p>{projectStorage().courseSelection?.kind === 'course' ? 'Anyone with this link and access to this course can open it after CUNY Login' : 'Anyone with this link and CUNY AI Lab membership can open it after CUNY Login'}</p>
          </> : <p>This link stores the complete project on the class server: the memo, framing answers, map items, evidence notes, and revision history. Anyone with both the link and current class code can open it.</p>}
          <p className="project-link-url"><code>{linkUrl(link.token)}</code></p>
          <dl className="project-link-summary project-link-summary--metadata">
            <div><dt>Last server sync</dt><dd>{projectLinkDate(link.lastSyncedAt, 'Not synced yet')}</dd></div>
            <div><dt>Link expires</dt><dd>{projectLinkDate(link.expiresAt, 'No expiry recorded')}</dd></div>
          </dl>
          <p className={`project-link-status${['error', 'conflict', 'expired', 'revoked'].includes(linkStatus) ? ' project-link-status--error' : ''}`} role={['error', 'conflict', 'expired', 'revoked'].includes(linkStatus) ? 'alert' : 'status'}>
            {linkStatus === 'syncing' || linkStatus === 'creating'
              ? 'Syncing latest changes…'
              : linkStatus === 'synced'
                ? (linkMessage || 'Latest changes are synced to this link.')
                : linkStatus === 'expired'
                  ? (linkMessage || 'This project link has expired. The device copy is still available.')
                  : linkStatus === 'revoked'
                    ? (linkMessage || 'This project link has been revoked. The device copy is still available.')
                    : linkMessage || 'Changes sync while you work.'}
          </p>
          {linkStatus === 'conflict' ? <div className="button-stack">
            <button type="button" className="button" onClick={loadLinkedVersion}>Open linked version and preserve this device copy</button>
            <button type="button" className="button button--secondary" onClick={createNewLinkForDeviceCopy}>Keep this device copy and create a new link</button>
            <button type="button" className="button button--ghost" onClick={() => setModal(null)}>Decide later</button>
          </div> : ['expired', 'revoked'].includes(linkStatus) ? <div className="button-stack">
            <button type="button" className="button" onClick={createNewLinkForDeviceCopy}>Create a new link for this device copy</button>
            <button type="button" className="button button--ghost" onClick={() => setModal('delete-link')}>Delete the old server copy</button>
            <button type="button" className="button button--ghost" onClick={() => setModal(null)}>Close</button>
          </div> : <>
            <div className="button-row">
              <button type="button" className="button button--ghost" onClick={() => setModal(null)}>Close</button>
              <button type="button" className="button" disabled={linkStatus === 'syncing'} onClick={copyLink}>Copy link</button>
            </div>
            <div className="project-link-management">
              <button type="button" onClick={() => setModal('revoke-link')}>Turn off this link</button>
              <button type="button" onClick={() => setModal('delete-link')}>Delete server copy</button>
            </div>
          </>}
        </> : <>
          {institutionalMode ? <>
            <p>Your complete memo, framing, map, notes, and revision history are stored for 90 days</p>
            <p>{projectStorage().courseSelection?.kind === 'course' ? 'Opening this link requires CUNY Login and access to this course' : 'Opening this link requires CUNY Login and CUNY AI Lab membership'}</p>
          </> : <p>Create a unique link to use this project on another device. The complete project—including its memo and evidence notes—will be stored on the class server for 90 days. Opening it also requires the current class code.</p>}
          {link && <p className="project-link-status">Your earlier link stays usable for the project it was created on.</p>}
          {linkStatus === 'error' && linkMessage && <p className="error-text">{linkMessage}</p>}
          <div className="button-row">
            <button type="button" className="button button--ghost" onClick={() => setModal(null)}>Cancel</button>
            <button type="button" className="button" disabled={linkStatus === 'creating'} onClick={createLink}>{linkStatus === 'creating' ? 'Creating link…' : 'Create project link'}</button>
          </div>
        </>}
      </div>
    </Modal>
    <Modal open={modal === 'revoke-link'} title="Turn off this link?" onClose={() => setModal('project-link')}>
      <div className="confirm-panel"><p>The link will stop opening or syncing. Your project remains saved on this device, and you can delete the server copy separately.</p><div className="button-row"><button type="button" className="button button--ghost" onClick={() => setModal('project-link')}>Cancel</button><button type="button" className="button" onClick={revokeCurrentLink}>Turn off link</button></div></div>
    </Modal>
    <Modal open={modal === 'delete-link'} title="Delete server copy?" onClose={() => setModal('project-link')}>
      <div className="confirm-panel"><p>This permanently deletes the project stored at this link. The copy saved in this browser remains in Projects.</p><div className="button-row"><button type="button" className="button button--ghost" onClick={() => setModal('project-link')}>Cancel</button><button type="button" className="button" onClick={deleteCurrentLink}>Delete server copy</button></div></div>
    </Modal>
    {recoveryModal}
    {validationModal}
    <div className={`toast toast--${toastState?.type || 'success'} ${toastState ? 'is-visible' : ''}`} role="status" aria-live="polite">{toastState?.type === 'success' && <Icon name="check" />}{toastState?.message}</div>
  </div>;
}

export { AccessFrame, ThemeToggle, GraphCanvas, MapStage };
export default App;
import { projectStorage, institutionalLoginUrl } from './accountStorage.js';
import GuidanceProgress from './GuidanceProgress.jsx';
