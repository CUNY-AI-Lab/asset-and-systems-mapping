import { classifyExcerptMatch } from '../shared/memo-quote-match.js';
import MemoWorkflowNotebook from './MemoWorkflowNotebook.jsx';
import MemoWorkspace from './MemoWorkspace.jsx';
import NodeColorControl from './NodeColorControl.jsx';
import MemoEvidence from './MemoEvidence.jsx';
import AboutSystemsMapping from './AboutSystemsMapping.jsx';
import { NODE_SUBMISSION, submittedReviewIssue } from '../shared/node-submission.js';
import { relationshipGroupIssue, groupedRelationships } from '../shared/relationship-groups.js';
import { activeSubmission, beginPart2, isPart2, reviewMemoText, memoLabel } from './projectMemo.js';
import ProjectCompletion from './ProjectCompletion.jsx';
import MapDownloadControls from './MapDownloadControls.jsx';
import { captureMapDrawing } from './mapDrawingExport.js';
import { MEMO_REVIEW_SCALE_LIMITS } from '../shared/memo-review-limits.js';
import { isNodeReviewScale, isRelationshipReviewScale, nodeScaleFor, canConnectAtScale, cumulativeScales } from '../shared/mapping-grammar.js';
import { useRelationshipDraft } from './relationshipDraft.js';
import { useWorkspaceViewHistory } from './workspaceViewHistory.js';
import { editHistoryState, recordEdit, restoreEdit } from './editHistory.js';
import { readableNodePositions, straightConnectionLayout } from './readableGraphLayout.js';
import { studentMapPositions, studentMapBoundaries, constrainStudentNodeMove, readingConnectionLayout, relationshipAttachment, captionObstacles, REGION_CAPTION } from './studentMapLayout.js';
import { readMemoFile } from './documentImport.js';
import { relationshipDescription, relationshipArrowheads, relationshipDirection, relationshipMapLabel, relationshipLineWidth, relationshipProcessSummary } from './relationshipDirection.js';
import { SidebarResizeHandle, useSidebarSize } from './MapSidebar.jsx';
import { createPortal } from 'react-dom';
import { useBugReportDock } from './support/BugReportDock.jsx';
import { CUNY_ABOUT_MEMO, CUNY_ABOUT_URL } from './devAboutMemo.js';
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
import { MEMO_WORKFLOW, carriedSubmissionNodes, appendSubmittedNodes, openMemoWorkflowScale, memoUpdateState, memoUpdatePayload, memoUpdateSummary } from './memoWorkflow.js';
import { levelRailState, nextStep, stageForPanelMode } from './nextStep.js';
import { LevelSelect, NotebookSection, ProjectMenu, PANEL_TABS, WorkPanelTabs } from './MapStudio.jsx';
import { hasPendingGuidance } from './durableGuidance.js';
import { exportMapImage, downloadBlob } from './mapExport.js';
import MapListView from './MapListView.jsx';
import MapTextEditor from './MapTextEditor.jsx';
import NodeClassificationEditor from './NodeClassificationEditor.jsx';
import { reclassifyNode, nodeClassificationTypes } from './nodeClassification.js';
import { correspondingNode, nodeLabelIssue, relationshipIssue, reviseMapText } from './mapTextEditing.js';
import MapConnections from './MapConnections.jsx';
import { removeMapSelection } from './mapRemoval.js';
import { mapShortcut } from './mapShortcuts.js';
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
  if (field === 'text' && isPart2(draft.activeScale)) beginPart2(draft);
  const textChanged = field === 'text' && activeSubmission(draft).text !== value;
  activeSubmission(draft)[field] = value;
  if (!textChanged) return;
  activeSubmission(draft).revision = (activeSubmission(draft).revision || 1) + 1;
  activeSubmission(draft).fingerprint = stableId('src', value);
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
    submissionId: activeSubmission(project).id,
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
    .filter((node) => canConnectAtScale(project.activeScale, node) && node.status !== 'rejected' && node.claimState !== 'retired')
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
    .map(({ id, scale, source, target, verb, relationshipProcess, evidence, relationshipIds }) => ({ source, target, verb, ...relationshipProcessContext(relationshipProcess), ...(isPart2(project.activeScale) ? { id, scale, evidence: String(evidence || '').slice(0, 1000), ...(relationshipIds ? { relationshipIds } : {}) } : {}) }));
}

export function preflightEvaluationPayload(project, memoFirstWorkflow = false) {
  const carriedNodes = memoFirstWorkflow ? carriedSubmissionNodes(project) : carriedReviewNodes(project);
  const carriedConnections = carriedReviewConnections(project);
  const fieldNotes = previousFieldNotes(project);
  return {
    ...(memoFirstWorkflow ? { workflowMode: NODE_SUBMISSION, ...(memoUpdatePayload(project) ? { memoUpdate: memoUpdatePayload(project) } : {}) } : {}),
    projectMetadata: projectMetadataForReview(project),
    activeScale: project.activeScale,
    stageId: STAGES[project.stage]?.id || 'review-suggestions',
    inquiry: project.inquiry,
    sourceRecord: { ...sourceRecordForEvaluation(activeSubmission(project)), sensitive: project.submission.sensitive || activeSubmission(project).sensitive, consent: (!project.submission.sensitive || project.submission.consent) && (!activeSubmission(project).sensitive || activeSubmission(project).consent) },
    sourceMaterial: memoFirstWorkflow ? activeSubmission(project).text : reviewMemoText(project),
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
    .slice(0, 100).map(({ id, source, target, verb, scale, relationshipIds, relationshipProcess }) => ({ id, source, target, verb,
      ...(project.graph.edges.some(edge => edge.relationshipIds?.length) ? { scale, ...(relationshipIds ? { relationshipIds: [...relationshipIds] } : {}) } : {}),
      ...relationshipProcessContext(relationshipProcess) }));
  const scopes = project.graph.nodes
    .filter((node) => nodeIds.has(node.id) && (node.scopeNodeIds || []).length)
    .map((node) => ({ id: node.id, memberIds: [...new Set(node.scopeNodeIds)].filter((memberId) => nodeIds.has(memberId) && memberId !== node.id) }))
    .filter((scope) => scope.memberIds.length).slice(0, 50);
  return {
    activeScale: project.activeScale,
    intent,
    inquiry: project.inquiry,
    memoExcerpt: memoPromptExcerpt(reviewMemoText(project)) || '',
    nodes,
    relationships,
    scopes,
    focus,
    projectOverlay: projectOverlayForEvaluation(project.configs.builder),
    studentJudgments: studentJudgments(project),
  };
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
    const [source, target] = [rawSource, rawTarget];
    if (!source || !target || source.id === target.id || typeof connection.verb !== 'string' || !connection.verb.trim() || connection.verb.length > RELATIONSHIP_VERB_LIMIT || typeof connection.rationale !== 'string' || !connection.rationale.trim() || connection.rationale.length > 1000) {
      throw new Error('The classroom server returned an invalid connection.');
    }
    if (!canConnectAtScale(project.activeScale, source) || !canConnectAtScale(project.activeScale, target)) throw new Error('Choose available mapped nodes.');
    const verb = connection.verb;
    if (verb.trim() !== verb) {
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

function authoritativeEvaluationKey(project, memoFirstWorkflow = false) {
  const payload = preflightEvaluationPayload(project, memoFirstWorkflow);
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
  const limits = MEMO_REVIEW_SCALE_LIMITS[project.activeScale];
  if (review.nodes.length > limits.nodes || review.connections.length > limits.connections) fail();
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
  if (isNodeReviewScale(project.activeScale) && review.connections.length) fail();
  if (isRelationshipReviewScale(project.activeScale) && review.nodes.length) fail();
  const existingConnections = new Set(project.graph.edges
    .filter((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired')
    .map((edge) => `${edge.source}\u0000${edge.verb.toLocaleLowerCase()}\u0000${edge.target}\u0000${[...(edge.relationshipIds || [])].sort().join(',')}`));
  const seenConnections = new Set();
  const resolve = (reference) => liveById.get(reference)
    || liveByLabel.get(String(reference || '').toLocaleLowerCase())
    || proposedByLabel.get(String(reference || '').toLocaleLowerCase());
  review.connections.forEach((connection) => {
    if (!connection || typeof connection !== 'object' || Array.isArray(connection)
      || Object.keys(connection).filter(key => !['relationshipProcess', 'relationshipIds'].includes(key)).sort().join(',') !== ['rationale', 'source', 'sourceLabel', 'target', 'targetLabel', 'verb'].join(',')) fail();
    if (connection.relationshipProcess !== undefined && relationshipProcessIssue(connection.relationshipProcess)) fail();
    if (relationshipGroupIssue(connection, project.graph.nodes, project.graph.edges, project.activeScale)) fail();
    const source = resolve(connection.source);
    const target = resolve(connection.target);
    if (!source || !target || source === target || source.label !== connection.sourceLabel || target.label !== connection.targetLabel) fail();
    if (project.activeScale === 'meso' && (source.scale !== 'micro' || target.scale !== 'micro'
      || !liveById.has(connection.source) || !liveById.has(connection.target))) fail();
    // Endpoint mistakes remain visible as pending suggestions so the student
    // can repair or remove them. Only the closed Exo relationship register is
    // required at ingestion; commitment enforces an outside source and a valid setting or office recipient.
    if (project.activeScale === 'macrosphere' && (!liveById.has(connection.source) || !liveById.has(connection.target) || !canConnectAtScale(project.activeScale, source) || !canConnectAtScale(project.activeScale, target))) fail();
    const sourceReference = liveById.has(connection.source) ? connection.source : source.label;
    const targetReference = liveById.has(connection.target) ? connection.target : target.label;
    const key = `${sourceReference}\u0000${connection.verb.toLocaleLowerCase()}\u0000${targetReference}\u0000${[...(connection.relationshipIds || [])].sort().join(',')}`;
    const previouslySuggested = project.candidates.edges.some((item) => item.scale === project.activeScale
      && item.source === source.id && item.target === target.id && item.verb === connection.verb);
    if (seenConnections.has(key) || (existingConnections.has(key) && !previouslySuggested)) fail();
    seenConnections.add(key);
  });
}

function normalizePreflightEvaluation(evaluation, project, memoFirstWorkflow = false) {
  if (!evaluation || typeof evaluation !== 'object' || Array.isArray(evaluation)) throw new Error('The classroom server returned an invalid memo review.');
  const expectedKeys = ['id', 'review', 'configSnapshot', 'runtime', 'createdAt', 'expiresAt'];
  if (Object.keys(evaluation).length !== expectedKeys.length || expectedKeys.some((key) => !Object.hasOwn(evaluation, key))) {
    throw new Error('The classroom server returned an invalid memo-review shape.');
  }
  if (typeof evaluation.id !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(evaluation.id)) throw new Error('The classroom server returned an invalid evaluation identifier.');
  if (!evaluation.review || typeof evaluation.review !== 'object' || Array.isArray(evaluation.review) || !evaluation.configSnapshot || !evaluation.runtime) {
    throw new Error('The classroom server returned an incomplete memo review.');
  }
  if (memoFirstWorkflow) {
    const issue = submittedReviewIssue(evaluation.review, project.activeScale, activeSubmission(project).text, memoUpdatePayload(project), carriedSubmissionNodes(project));
    if (issue) throw new Error('The memo could not be processed: ' + issue);
  } else assertAtomicMemoReview(evaluation.review, project);
  const preflight = {
    memoReview: structuredClone(evaluation.review),
    configurationSnapshot: structuredClone(evaluation.configSnapshot),
    evaluation: {
      evaluationId: evaluation.id,
      runtime: structuredClone(evaluation.runtime),
      createdAt: evaluation.createdAt,
      expiresAt: evaluation.expiresAt,
    },
    sourceFingerprint: stableId('src', memoFirstWorkflow ? activeSubmission(project).text : reviewMemoText(project)),
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
  beginPart2(project);
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
    undo: <path d="M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12" />,
    redo: <path d="m15 5 5 5-5 5m5-5h-9a6 6 0 0 0 0 12" />,
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

function ThemeToggle({ dark, onToggle }) {
  return <button className="theme-toggle" type="button" aria-pressed={dark} aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`} title={`Switch to ${dark ? 'light' : 'dark'} mode`} onClick={onToggle}><svg className="theme-toggle__glyph" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">{dark ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></> : <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />}</svg></button>;
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

// The source passage behind a selected item. Shown under the item heading in
// the legacy editor and directly after the Label field in the account workspace.
function InspectorEvidence({ project, item, label }) {
  if (!item.evidence) return <p className="inspector-evidence inspector-evidence--empty">No source evidence recorded.</p>;
  const quoted = classifyExcerptMatch(project.submission.text, item.evidence) || classifyExcerptMatch(project.part2Submission?.text || '', item.evidence);
  return <blockquote className="inspector-evidence"><span className="evidence-label">{quoted ? 'Quote from memo' : 'Evidence or question'}</span><p><MemoEvidence passage={item.evidence} label={label} /></p></blockquote>;
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
      <span className="field__label">Where this belongs</span>
      <div className="scope-editor__members">
        {selectedIds.map((settingId) => {
          const setting = settingById.get(settingId);
          const label = setting?.label || settingId;
          return <button key={settingId} type="button" className="scope-chip" onClick={() => onSettingNodeIdsChange(selectedIds.filter((id) => id !== settingId))} aria-label={`Remove ${itemLabel} from ${label}`}>{label}<span aria-hidden="true"> ×</span></button>;
        })}
        {availableSettings.length ? <select className="scope-editor__add" aria-label={`Choose where ${itemLabel} belongs`} value="" onChange={(event) => {
          const settingId = event.target.value;
          if (!settingId || selectedIds.includes(settingId) || selectedIds.length >= PROJECT_LIMITS.scopeMembers) return;
          onSettingNodeIdsChange([...selectedIds, settingId]);
        }}>
          <option value="">Choose where this belongs…</option>
          {availableSettings.map((setting) => <option key={setting.id} value={setting.id}>{setting.label}{setting.status === 'rejected' || setting.claimState === 'retired' ? ' — removed' : ''}</option>)}
        </select> : null}
        {!selectedIds.length && !availableSettings.length ? <span className="scope-editor__empty">Nothing available yet</span> : null}
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
  return <details className="claim-evidence-record" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><span>Evidence {index + 1}</span></summary>
    <div className="claim-evidence-record__body">
      {CLAIM_EVIDENCE_FIELDS.map((field) => {
        const copy = CLAIM_EVIDENCE_COPY[field];
        return <Field key={field} label={copy.label} hint={copy.hint}><textarea rows={field === 'sourcePassage' ? 4 : 3} maxLength={field === 'sourcePassage' ? PROJECT_LIMITS.evidenceExcerpt : PROJECT_LIMITS.claimEvidenceText} value={record[field] || ''} onChange={(event) => onEdit(field, event.target.value)} /></Field>;
      })}
      <button className="claim-evidence-record__remove map-remove" type="button" onClick={onRemove}>Remove record</button>
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

function AccessFrame({ children, onTeacher, dark, onToggleTheme, headerActions }) {
  return <div className="access-shell">
    <header className="access-header">
      <LabLink />
      <strong>Systems Mapping</strong>
      <div className="access-header__actions"><ThemeToggle dark={dark} onToggle={onToggleTheme} />{headerActions}{onTeacher && <button type="button" className="access-header__teacher" onClick={onTeacher}>Instructor Console</button>}</div>
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

export function projectMarkdown(project) {
  const liveNodes = project.graph.nodes.filter((node) => node.status !== 'rejected' && node.claimState !== 'retired');
  const nodeById = new Map(liveNodes.map((node) => [node.id, node]));
  const evidenceLines = (records) => (records || []).flatMap((record, index) => {
    const fields = [
      ['Memo passage or evidence', record.sourcePassage], ['Student interpretation', record.studentInterpretation],
      ['Reasoning', record.warrant], ['Uncertainty', record.uncertainty],
      ['Counterevidence', record.counterevidence], ['Missing perspective', record.missingVoice],
    ].filter(([, value]) => String(value || '').trim());
    return fields.length ? [`  - Evidence record ${index + 1}`, ...fields.map(([label, value]) => `    - ${label}: ${value}`)] : [];
  });
  const nodeLines = liveNodes.flatMap((node) => {
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
  const edgeLines = project.graph.edges.filter((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired'
    && nodeById.has(edge.source) && nodeById.has(edge.target)).flatMap((edge) => {
    const process = relationshipProcessSummary(edge.relationshipProcess);
    const group = groupedRelationships(edge, project.graph.edges).map(local => relationshipDescription(local)).join('; ');
    return [`- ${relationshipDescription(edge)} — arrow direction: ${relationshipDirection(edge)}; level: ${SCALES[edge.scale]?.label || edge.scale}; evidence: ${edge.evidence || 'needs evidence'}${process ? `; process: ${process}` : ''}${edge.annotation?.text ? `; annotation: ${edge.annotation.text}` : ''}${group ? `; grouped local relationships: ${group}` : ''}`, ...evidenceLines(edge.claimEvidence)];
  });
  const redactionLines = project.portableExport?.redactions?.map((entry) => `- ${entry.path}: ${entry.reason}`).join('\n') || '- None';
  const fieldNotes = SCALE_ORDER.flatMap((scale) => {
    // The active editor can be newer than its saved per-level snapshot.
    const note = scale === project.activeScale ? project.reflection : project.levelProgress?.[scale]?.reflection;
    return String(note || '').trim() ? [`### ${SCALES[scale].label}\n\n${note}`] : [];
  }).join('\n\n');
  return `# ${project.title}\n\n${project.inquiry ? `${project.inquiry}\n\n` : ''}## Part 1 memo · Microsystem\n\n${project.submission.text || 'Not yet written'}${project.part2Submission ? `\n\n## Part 2 memo · Macrosystem\n\n${project.part2Submission.text || 'Not yet written'}` : ''}\n\n## Map annotation\n\n${project.mapAnnotation?.text || 'Not yet written'}\n\n## Nodes\n\n${nodeLines.join('\n') || '- None added'}\n\n## Relationships\n\n${edgeLines.join('\n') || '- None added'}\n\n## Field Notes\n\n${fieldNotes || 'Not yet written'}\n\n## Items needing evidence\n\n${project.candidates.edges.filter((edge) => edge.status === 'research lead').map((edge) => `- ${relationshipDescription(edge)}`).join('\n') || '- None recorded'}\n\n## Export redactions\n\n${redactionLines}\n`;
}

export function graphCsv(project) {
  const inert = (value) => {
    const text = String(value ?? '');
    return /^(?:[\t\r\n]|[ \t\r\n]*[=+\-@])/.test(text) ? `'${text}` : text;
  };
  const quote = (value) => `"${inert(value).replaceAll('"', '""')}"`;
  const nodeById = new Map(project.graph.nodes.map((node) => [node.id, node]));
  const rows = [['record_type', 'id', 'label_or_from', 'type_or_verb', 'target', 'scale', 'evidence', 'annotation', 'evidence_annotation', 'scope_member_ids', 'scope_member_labels', 'structural_action', 'claim_evidence_json', 'relationship_process_json', 'meso_explanation', 'origin', 'review_decision', 'micro_setting_ids', 'focal_participation', 'arrow_direction', 'connection_status', 'connection_strength', 'communication_channel', 'connecting_work', 'family_count', 'grouped_relationship_ids']];
  project.graph.nodes.forEach((node) => rows.push([
    'node', node.id, node.label, node.type, '', node.scale, node.evidence,
    node.annotations?.analytical?.text || '', node.annotations?.evidence?.text || '',
    (node.scopeNodeIds || []).join('; '),
    (node.scopeNodeIds || []).map((id) => nodeById.get(id)?.label).filter(Boolean).join('; '),
    node.scale === 'macrosphere' ? node.deontic || 'shapes' : '',
    JSON.stringify(node.claimEvidence || []), '', node.mesoExplanation || '', node.origin || '', node.reviewDecision || '',
    (node.settingNodeIds || []).join('; '), node.focalParticipation || '', '', '', '', '', '', '',
  ]));
  project.graph.edges.forEach((edge) => rows.push(['edge', edge.id, edge.sourceLabel, edge.verb, edge.targetLabel, edge.scale, edge.evidence, edge.annotation?.text || '', '', '', '', '', JSON.stringify(edge.claimEvidence || []), JSON.stringify(edge.relationshipProcess || {}), '', edge.origin || '', edge.reviewDecision || '', '', '', relationshipDirection(edge), edge.relationshipProcess?.connectionStatus || '', edge.relationshipProcess?.strength || '', edge.relationshipProcess?.channel || '', edge.relationshipProcess?.connectingWork || '', edge.relationshipProcess?.familyCount ?? '', (edge.relationshipIds || []).join('; ')]));
  rows.push(['map', project.mapAnnotation?.id || 'map', project.title, '', '', '', '', project.mapAnnotation?.text || '', '', '', '', '', '', '', '', '', '', '']);
  return rows.map((row) => Array.from({ length: rows[0].length }, (_, index) => quote(row[index] ?? '')).join(',')).join('\n');
}


function IntakeStage({ project, update, toast, onRequestRestart, captureImportScope, action }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [fileNotice, setFileNotice] = useState('');
  const importRequest = useRef(0);
  const importFeedback = useRef(null);
  // Leaving intake, changing projects, or editing the memo invalidates any
  // pending reader. An old result must never land in the current project.
  useLayoutEffect(() => () => { importRequest.current += 1; }, [project.id, project.activeScale, activeSubmission(project).id]);
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
  const onFile = async (event) => {
    const input = event.currentTarget;
    const [file] = input.files;
    if (!file) return;
    const request = ++importRequest.current;
    const inScope = captureImportScope();
    const projectId = project.id;
    const submission = JSON.stringify(activeSubmission(project));
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
        activeSubmission(draft).title = activeSubmission(draft).title || file.name;
        activeSubmission(draft).location = `Local file: ${file.name}`;
        activeSubmission(draft).fileName = file.name;
        activeSubmission(draft).fileSize = file.size;
      }, 'memo.imported', file.name, 'student', null, {
        guard: current => request === importRequest.current && inScope() && current.id === projectId
          && JSON.stringify(activeSubmission(current)) === submission,
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
      <PageHeading title="Memo" description={`${memoLabel(project)} — ${isPart2(project.activeScale) ? 'build on your first memo and the existing map' : 'set the focus for your map'}`} />
      {action && <div className="memo-submit-top">{action}</div>}
      <LevelTrail active={project.activeScale} completed={project.completedScales} />
      <details className="project-details"><summary>Project details</summary><div className="project-context-fields">
        <Field label="Project title"><input maxLength={CONFIG_TEXT_LIMIT} value={project.title} onChange={(event) => setProjectField('title', event.target.value)} /></Field>
        <Field label="Name or Group Name"><input autoComplete="name" maxLength={CONFIG_TEXT_LIMIT} value={project.participantName || ''} onChange={(event) => setProjectField('participantName', event.target.value)} /></Field>
      </div>
      </details><div className="intake-grid">
        <div>
          <label className="upload-zone">
            <input type="file" aria-label={`Upload ${isPart2(project.activeScale) ? 'Part 2' : 'Part 1'} memo`} accept=".docx,.txt,.md,.html,.htm,.json,.pdf" onChange={onFile} />
            <Icon name="upload" size={26} />
            <strong>{activeSubmission(project).fileName || 'Upload a memo'}</strong>
            <span>DOCX, TXT, MD, HTML, JSON, or PDF</span>
          </label>
          {fileNotice && <p className="privacy-note" role="status">{fileNotice}</p>}
          <Field label="Memo" hint={`${activeSubmission(project).text.trim().split(/\s+/).filter(Boolean).length.toLocaleString()} words`}>
            <textarea className="memo-text" maxLength="500000" value={activeSubmission(project).text} onChange={(event) => setSubmission('text', event.target.value)} rows="15" />
          </Field>
          {!action && hasProjectWork(project) && <MemoForkButton onRequestRestart={onRequestRestart} />}
        </div>
        <aside className="memo-panel">
          <button type="button" className="disclosure-button" aria-label="Privacy" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>
            <span><strong>Privacy</strong><small>Check before sharing</small></span><span aria-hidden="true">{detailsOpen ? '−' : '+'}</span>
          </button>
          {detailsOpen && <div className="memo-fields">
            <label className="check-row"><input type="checkbox" checked={activeSubmission(project).sensitive} onChange={(event) => setSubmission('sensitive', event.target.checked)} /><span><strong>Includes private information</strong></span></label>
            {activeSubmission(project).sensitive && <label className="check-row"><input type="checkbox" checked={activeSubmission(project).consent} onChange={(event) => setSubmission('consent', event.target.checked)} /><span><strong>I have permission to share this information, or I have removed identifying details.</strong></span></label>}
          </div>}
        </aside>
      </div>
    </div>
  );
}

function RelationshipGroupPicker({ project, value = [], onChange }) {
  const nodeIds = new Set(project.graph.nodes.filter(isLiveMapItem).map(node => node.id));
  const relationships = project.graph.edges.filter(edge => edge.scale === 'meso' && isLiveMapItem(edge) && nodeIds.has(edge.source) && nodeIds.has(edge.target));
  return <fieldset className="relationship-group-picker"><legend>Local relationships</legend>
    <p>Select the relationships this heading affects. The map highlights them together.</p>
    {!relationships.length && <p>Add local relationships in Meso first.</p>}
    {relationships.map(edge => <label className="check-row" key={edge.id}><input type="checkbox" checked={value.includes(edge.id)} onChange={event => onChange(event.target.checked ? [...value, edge.id] : value.filter(id => id !== edge.id))} /><span>{relationshipDescription(edge)}</span></label>)}
  </fieldset>;
}

export function MemoFileUpload({ project, update, toast, captureImportScope }) {
  const [notice, setNotice] = useState('');
  const requestRef = useRef(0);
  const pendingRef = useRef(null);
  const submission = activeSubmission(project);
  const showAboutPreload = typeof location !== 'undefined'
    && ['systems-mapping-dev.ailab-452.workers.dev', 'localhost', '127.0.0.1'].includes(location.hostname);
  const loadAbout = () => {
    if (submission.text.trim() && !window.confirm('Replace this memo draft with CUNY AI Lab About?')) return;
    requestRef.current += 1;
    pendingRef.current = null;
    setNotice('');
    update(draft => {
      invalidateSubmissionDerived(draft, 'text', CUNY_ABOUT_MEMO);
      const source = activeSubmission(draft);
      Object.assign(source, { title: 'CUNY AI Lab About', location: CUNY_ABOUT_URL, sourceType: 'web page' });
      delete source.fileName;
      delete source.fileSize;
    }, 'memo.imported', 'CUNY AI Lab About');
  };
  useLayoutEffect(() => () => { requestRef.current += 1; }, [project.id, project.activeScale, submission.id, submission.text]);
  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending || !pending.inScope() || !project.events.some(event => event.id === pending.eventId)) return;
    pendingRef.current = null;
    setNotice(pending.notice);
    toast?.(pending.notice);
  }, [project.events, toast]);
  const upload = async event => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const request = ++requestRef.current;
    const inScope = captureImportScope?.() || (() => true);
    const original = JSON.stringify(submission);
    const scale = project.activeScale;
    setNotice('Reading memo…');
    try {
      if (file.size > MAX_MEMO_BYTES || file.name.length > FILE_NAME_LIMIT) throw new Error('file limit');
      const result = await readMemoFile(file);
      if (request !== requestRef.current || !inScope()) return;
      if (!result.text.trim()) { setNotice(result.notice); return; }
      const imported = createEvent('memo.imported', file.name);
      pendingRef.current = { inScope, eventId: imported.id, notice: result.notice };
      update(draft => {
        if (isPart2(scale)) beginPart2(draft);
        invalidateSubmissionDerived(draft, 'text', result.text);
        Object.assign(activeSubmission(draft), { title: file.name, location: `Local file: ${file.name}`, fileName: file.name, fileSize: file.size });
      }, 'memo.imported', file.name, 'student', null, {
        guard: current => request === requestRef.current && inScope() && current.id === project.id
          && current.activeScale === scale && JSON.stringify(activeSubmission(current)) === original,
        event: imported,
      });
    } catch {
      if (request !== requestRef.current || !inScope()) return;
      setNotice('The memo could not be imported. Use a PDF, DOCX or text file under 5 MB, or paste its text. Your saved work is unchanged.');
    }
  };
  return <div className="memo-file-upload">
    {showAboutPreload && <button type="button" className="button button--secondary" onClick={loadAbout}>Load CUNY AI Lab About</button>}
    <label className="upload-zone">
      <input type="file" aria-label={`Upload ${isPart2(project.activeScale) ? 'Part 2' : 'Part 1'} memo`} accept=".docx,.txt,.md,.html,.htm,.json,.pdf" onChange={upload} />
      <Icon name="upload" size={20} /><strong>{submission.fileName || `Upload ${isPart2(project.activeScale) ? 'Part 2' : 'Part 1'} memo`}</strong>
      <span>PDF, DOCX or text · up to 5 MB</span>
    </label>
    {notice && <p role="status" className="privacy-note">{notice}</p>}
  </div>;
}

function MemoDrawer({ project, update, hint, onRequestRestart, drawerRef, defaultOpen = false, toast, captureImportScope }) {
  const localRef = useRef(null);
  const ref = drawerRef || localRef;
  useEffect(() => { if (ref.current && defaultOpen) ref.current.open = true; }, [defaultOpen, ref]);
  return <details ref={ref} className="memo-drawer">
    <summary>
      <span className="memo-drawer__title"><strong>Your memo</strong></span>
      <span className="memo-drawer__mark" aria-hidden="true" />
    </summary>
    <p className="privacy-note">{memoLabel(project)}{isPart2(project.activeScale) ? ' — both memos and your existing graph inform guidance' : ''}</p>
    {isPart2(project.activeScale) && !project.part2Submission && <button type="button" className="button" onClick={() => update(draft => { beginPart2(draft); draft.preflight = null; })}>Add Part 2 memo</button>}
    <MemoFileUpload project={project} update={update} toast={toast} captureImportScope={captureImportScope} />
    {project.part2Submission && isPart2(project.activeScale) && <details className="previous-memo"><summary>Part 1 memo · Microsystem</summary><p className="memo-source-text">{project.submission.text || 'Not yet written'}</p></details>}
    <Field label="Memo" hint={hint}>
      <textarea className="memo-text" maxLength="500000" rows="12" value={activeSubmission(project).text} onChange={(event) => update((draft) => { invalidateSubmissionDerived(draft, 'text', event.target.value); })} />
    </Field>
    <label className="check-row"><input type="checkbox" checked={activeSubmission(project).sensitive} onChange={event => update(draft => { activeSubmission(draft).sensitive = event.target.checked; })} /><span>Includes private information</span></label>
    {activeSubmission(project).sensitive && <label className="check-row"><input type="checkbox" checked={activeSubmission(project).consent} onChange={event => update(draft => { activeSubmission(draft).consent = event.target.checked; })} /><span>I have permission to share this information, or I have removed identifying details.</span></label>}
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
  exosphere: 'Add organizations, resources, policies, and conditions to your map',
  macrosphere: 'Connect those items to each other and to the people and places on your map',
});

const REVIEW_SUPPORT_CODES = new Set([
  'guidance_contract_invalid', 'guidance_output_invalid', 'guidance_output_truncated',
  'guidance_timeout', 'guidance_cancelled', 'guidance_unavailable', 'guidance_pending',
  'guidance_in_progress', 'upstream_failure',
]);
const REVIEW_SUPPORT_FIELD = /^(?:guidance(?:\[[0-2]\](?:\.(?:point|evidenceExcerpt))?)?|nodes(?:\[(?:[0-9]|1[0-9])\](?:\.(?:label|type|scale|evidence|scope|basis|deontic))?)?|connections(?:\[(?:[0-9]|1[01])\](?:\.(?:source|target|verb|rationale|relationshipProcess))?)?|example|readiness(?:\.(?:ready|note))?)$/;
const REVIEW_SUPPORT_REASONS = new Set([
  'response_shape', 'field_shape', 'text_format', 'item_limit', 'label_format',
  'label_duplicate', 'scale_type', 'source_evidence', 'endpoint_reference',
  'relationship_process', 'relationship_duplicate', 'normalization', 'readiness_invalid', 'contract_other',
]);
const REVIEW_SUPPORT_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function reviewSupportDetails(error) {
  if (!(error instanceof ApiError)) return [];
  const details = error.payload?.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return [];
  const rows = [];
  // Retain only these independently validated values, never the error payload.
  if (REVIEW_SUPPORT_CODES.has(details.code)) rows.push(['Code', details.code]);
  if (REVIEW_SUPPORT_REASONS.has(details.validationReason)) rows.push(['Validation reason', details.validationReason]);
  if (typeof details.validationField === 'string' && details.validationField.length <= 64 && REVIEW_SUPPORT_FIELD.exec(details.validationField)?.[0] === details.validationField) rows.push(['Validation field', details.validationField]);
  if (typeof details.requestId === 'string' && details.requestId.length === 36 && REVIEW_SUPPORT_REQUEST_ID.test(details.requestId)) rows.push(['Request ID', details.requestId]);
  if (Number.isSafeInteger(details.correctiveRetries) && details.correctiveRetries >= 0 && details.correctiveRetries <= 2) rows.push(['Corrective retries', details.correctiveRetries]);
  if (Number.isSafeInteger(details.evidenceRepairAttempts) && details.evidenceRepairAttempts >= 0 && details.evidenceRepairAttempts <= 1) rows.push(['Evidence repair attempts', details.evidenceRepairAttempts]);
  return rows;
}

function SuggestionsReview({ project, update, reviewBusy, reviewProgress, reviewFailure, retryPending, onGenerate }) {
  const review = project.preflight?.memoReview;
  const feedbackOnly = project.preflight?.evaluation?.runtime?.feedbackOnly === true;
  const busy = reviewBusy === 'evaluating';
  const hasMemo = Boolean(activeSubmission(project).text.trim());
  const stale = Boolean(project.preflight && project.preflight.sourceFingerprint !== stableId('src', reviewMemoText(project)));
  const fieldNotes = previousFieldNotes(project);
  return <section className="suggestions-review" aria-label="Memo review">
    {!review && <div className="work-panel__title"><h2>{project.stage >= 2 ? 'Suggestions' : 'Memo review'}</h2><p className="lede">{REVIEW_LEDES[project.activeScale]}</p></div>}
    {fieldNotes && <details className="field-notes-continuity">
      <summary>From your {SCALES[fieldNotes.scale].label} Field Notes</summary>
      <blockquote>{fieldNotes.text}</blockquote>
      {fieldNotes.truncated && <p>Only this opening excerpt accompanies guidance. Your full note is saved under Field Notes → Previous notes.</p>}
    </details>}
    <div className="review-intro">
      {!review && <Action data-next-action="read-memo" variant={requiresLevelModel(project) ? "primary" : "ghost"} disabled={busy || retryPending || !hasMemo || reviewFailure?.retryable === false} onClick={onGenerate}>{busy ? 'Reading memo…' : reviewFailure ? 'Try again' : 'Generate guidance'}</Action>}
    </div>
    <GuidanceProgress scale={project.activeScale} active={busy} message={reviewProgress} />
    {reviewFailure && <p role="alert" className="teacher-message teacher-message--error">{reviewFailure.message}</p>}
    {reviewFailure?.supportDetails?.length > 0 && <Disclosure title="Support details" className="review-support-details">
      <p>You can include these details when you choose Report a bug.</p>
      <dl>{reviewFailure.supportDetails.map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl>
    </Disclosure>}
    {review && <>
      <h2>Suggestions</h2>
      {feedbackOnly && <p role="status">The app could not use its map suggestions. Check the feedback below against your memo and sources. You can add to the map yourself, or open Update suggestions and select Reread memo to try again.</p>}
      {!feedbackOnly && project.preflight.evaluation?.runtime?.evidenceRepairAttempts > 0 && <p role="status">This review used passages from your memo. Check the feedback and suggestions against your own research.</p>}
      {stale && <p role="status">The feedback shown is for your earlier memo. Reread to update it.</p>}
      <Disclosure title="Guidance and evidence" className="review-details" defaultOpen>
        {!review.guidance.length && <p className="empty-message">No guidance returned</p>}
        {review.guidance.map((item, index) => <div className="studio-feedback" key={index}>
          <p>{item.point}</p>
          {item.evidenceExcerpt && <blockquote>{item.evidenceExcerpt}</blockquote>}
        </div>)}
        {!feedbackOnly && (isRelationshipReviewScale(project.activeScale)
          ? !review.connections.length && <p className="empty-message">No connections suggested. You can connect mapped items yourself.</p>
          : !review.nodes.length && <p className="empty-message">No items were suggested. You can add an item yourself or reread the memo.</p>)}
      </Disclosure>
    </>}
  </section>;
}

function candidateStepsForScale(scale, candidates) {
  if (isRelationshipReviewScale(scale)) return ['edges', ...(candidates.nodes.some(node => node.scale === scale) ? ['nodes'] : []), 'suggest'];
  return scale === 'micro' ? ['nodes'] : ['nodes', ...(candidates.edges.some(edge => edge.scale === scale) ? ['edges'] : []), 'suggest'];
}

const MACRO_STRUCTURE_KINDS = MACROSPHERE_NODE_TYPES;

// The full-screen Choose elements stage is a thin wrapper around the same
// suggestion list the Studio panel shows beside the map.
function SuggestionsPanel({ project, update, toast, prompt, onPromptChange, busy, suggestions, onSuggest, onEdit, onDecision, onRefreshCandidates, refreshBusy, onHighlight, reviewBusy, reviewProgress, reviewFailure, retryPending, onGenerate }) {
  const candidateSteps = useMemo(() => candidateStepsForScale(project.activeScale, project.candidates), [project.activeScale, project.candidates]);
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
        sourceFingerprint: stableId('src', reviewMemoText(project)), notes: '',
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
    const fingerprint = stableId('src', reviewMemoText(project));
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
        evidence, sourceFingerprint: stableId('src', reviewMemoText(project)), notes: '',
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
    if (kind === 'edges' && current.relationshipIds && ['source', 'relationshipIds'].includes(field)) {
      const proposed = { ...current, [field]: value };
      if (field === 'relationshipIds') proposed.target = project.graph.edges.find(edge => edge.id === value[0])?.source;
      const issue = relationshipGroupIssue(proposed, project.graph.nodes, project.graph.edges);
      if (issue) return toast(issue, 'error');
      update(draft => {
        for (const collection of [draft.candidates.edges, draft.graph.edges]) {
          const edge = collection.find(item => item.id === id);
          if (!edge) continue;
          Object.assign(edge, { source: proposed.source, sourceLabel: candidateEndpointNodeById.get(proposed.source)?.label,
            target: proposed.target, targetLabel: candidateEndpointNodeById.get(proposed.target)?.label,
            relationshipIds: [...proposed.relationshipIds], claimState: 'student interpretation' });
          if (edge.status !== 'pending') edge.reviewDecision = 'added';
        }
      }, 'relationship.group-edited', 'Edited a proposed macrosystem group');
      return;
    }
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
      nodes: { lede: 'Choose larger-scale headings' },
      edges: { lede: 'Connect outside decisions to Micro settings' },
    },
    macrosphere: {
      nodes: { lede: 'Choose conditions that affect several map items' },
      edges: { lede: 'Connect larger-scale headings to each other and to selected local relationships' },
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
        {item.relationshipIds && <><Field label="Heading"><select value={item.source} onChange={event => edit(kind, item.id, 'source', event.target.value)}>{liveMapNodes.filter(node => ['exosphere', 'macrosphere'].includes(node.scale)).map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field><RelationshipGroupPicker project={project} value={item.relationshipIds} onChange={ids => edit(kind, item.id, 'relationshipIds', ids)} /></>}{!item.relationshipIds && isRelationshipReviewScale(project.activeScale) && <><Field label="From"><select value={item.source} onChange={(event) => edit(kind, item.id, 'source', event.target.value)}>{endpointOptions(project.activeScale === 'macrosphere' ? nodesForConnectionPrompt(project) : availableMicroEndpoints, item.source).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field><Field label="To"><select value={item.target} onChange={(event) => edit(kind, item.id, 'target', event.target.value)}>{endpointOptions(project.activeScale === 'macrosphere' ? nodesForConnectionPrompt(project) : availableMicroEndpoints, item.target).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field></>}
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
        <Field label="From"><select aria-label="Connection source" value={item.source} onChange={event => edit(kind, item.id, 'source', event.target.value)}>{endpointOptions(project.activeScale === 'macrosphere' ? nodesForConnectionPrompt(project) : availableMicroEndpoints, item.source).map(node => <option key={node.id} value={node.id}>{node.needsRepair ? 'Removed: ' : ''}{node.label}</option>)}</select></Field>
        <Field label="To"><select aria-label="Connection target" value={item.target} onChange={event => edit(kind, item.id, 'target', event.target.value)}>{endpointOptions(project.activeScale === 'macrosphere' ? nodesForConnectionPrompt(project) : availableMicroEndpoints, item.target).map(node => <option key={node.id} value={node.id}>{node.needsRepair ? 'Removed: ' : ''}{node.label}</option>)}</select></Field>
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
      <button className={item.status === 'rejected' ? 'map-remove is-active' : 'map-remove'} type="button" onClick={() => setStatus(kind, item.id, 'rejected')}>Remove</button>
    </div>
  </article>;
  });
  const decisionStep = step === 'nodes' || step === 'edges';
  const visibleCandidateIndex = Math.min(candidateIndex, Math.max(0, (activeCandidates[step]?.length || 1) - 1));
  const showList = project.stage >= 2 || activeCandidates.nodes.length > 0 || activeCandidates.edges.length > 0;
  const candidateTerms = step === 'edges' ? ['connections', 'a connection']
    : project.activeScale === 'exosphere' ? ['decision settings', 'a decision setting']
      : project.activeScale === 'macrosphere' ? ['conditions', 'a condition'] : ['items', 'an item'];
  const requestLabel = project.preflight?.memoReview ? 'reread the memo' : 'request suggestions';
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
          {!counts[step].total && <p className="empty-message">{project.preflight?.evaluation?.runtime?.feedbackOnly === true
            ? step === 'nodes' ? 'Add an item on the map or reread the memo.' : 'Add a connection on the map or reread the memo.'
            : `No suggested ${candidateTerms[0]} to review. You can add ${candidateTerms[1]} on the map or ${requestLabel}.`}</p>}
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
    if (scale !== 'micro' && cards.length) {
      band.outerRx = Math.max(band.outerRx, band.innerRx + Math.max(...cards.map(card => card.cardWidth)) * .85 + 24);
      band.outerRy = Math.max(band.outerRy, band.innerRy + Math.max(...cards.map(card => card.cardHeight)) * 1.4 + 72);
    }
    if (scale === 'micro' && cards.length > 1) {
      const columns = Math.min(phoneLayout ? 2 : 3, cards.length);
      const rows = Math.ceil(cards.length / columns);
      const width = (columns - 1) * (phoneLayout ? 560 : 460) + Math.max(...cards.map(card => card.cardWidth));
      const height = rows * Math.max(...cards.map(card => card.cardHeight)) + (rows - 1) * (phoneLayout ? 130 : 100);
      band.outerRx = Math.max(band.outerRx, width / 2 * Math.SQRT2 + 32);
      band.outerRy = Math.max(band.outerRy, height / 2 * Math.SQRT2 + 32);
    }
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

export function mapNodeGeometry(label, phoneLayout = false) {
  const fontSize = phoneLayout ? 26 : 22;
  const text = String(label || '').trim() || 'Untitled';
  const padding = phoneLayout ? 22 : 20;
  const cardWidth = clamp(measureMapText(text, fontSize, 750) + padding, phoneLayout ? 132 : 104, phoneLayout ? 260 : 224);
  const lines = wrapMapText(text, cardWidth - padding, { fontSize, fontWeight: 750 });
  const lineHeight = phoneLayout ? 30 : 26;
  const minimumHeight = phoneLayout ? 54 : 42;
  const cardHeight = Math.max(minimumHeight, lines.length * lineHeight + (phoneLayout ? 16 : 12));
  return {
    lines,
    fontSize,
    lineHeight,
    cardWidth,
    cardHeight,
    cardX: -(cardWidth / 2),
    cardY: -(cardHeight / 2),
    cardRadius: phoneLayout ? 13 : 8,
    // Center Source Sans's ascender/descender box, leaving equal room for
    // glyph bounds above and below the baseline at fractional zoom levels.
    labelStartY: -((lines.length - 1) * lineHeight) / 2 + fontSize * .33,
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

function studentReadingPositions(nodes, edges, layout) {
  return studentMapPositions(nodes, edges, new Map(nodes.map(node => [node.id, mapNodeGeometry(node.label, layout.phone)])), {
    ...layout,
    labelGeometries: new Map(edges.map(edge => [edge.id, mapEdgeLabelGeometry(relationshipMapLabel(edge), layout.phone, '')])),
  });
}

// A visible relationship label needs a real corridor between its endpoint
// cards. Keep a dragged endpoint far enough from every connected card to hold
// the complete, untruncated label while preserving the requested direction of
// movement whenever the map bounds allow it.
function relationshipSafeNodePosition(movingNode, requestedX, requestedY, nodes, edges, phoneLayout = false, mapMode = 'network', sharedBands = null, straightEdges = false) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const movingGeometry = mapNodeGeometry(movingNode.label, phoneLayout);
  const incidentEdges = edges.filter((edge) => edge.showLabel !== false
    && (edge.source === movingNode.id || edge.target === movingNode.id));
  const constrain = (candidate) => {
    if (mapMode === 'ecology') return constrainToEcologyBand(
      movingNode, candidate.x, candidate.y, movingGeometry, phoneLayout, nodes.length, sharedBands,
    );
    const bounded = {
      x: clamp(Math.round(candidate.x), PROJECT_LIMITS.coordinateMin, PROJECT_LIMITS.coordinateMax),
      y: clamp(Math.round(candidate.y), PROJECT_LIMITS.coordinateMin, PROJECT_LIMITS.coordinateMax),
    };
    return bounded;
  };
  let position = constrain({ x: requestedX, y: requestedY });
  if (straightEdges || (phoneLayout && mapMode === 'network')) {
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
      const columns = Math.min(phoneLayout ? 2 : 3, items.length);
      const rows = Math.ceil(items.length / columns);
      const columnPitch = phoneLayout ? 560 : 460;
      const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(...items
        .slice(row * columns, (row + 1) * columns)
        .map((node) => mapNodeGeometry(node.label, phoneLayout).cardHeight)));
      const rowGap = phoneLayout ? 130 : 100;
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
      const angle = -Math.PI / 2;
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
        ? -Math.PI / 2 + (-sectorSweep / 2) + (index / Math.max(1, items.length - 1)) * sectorSweep
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
  const label = scale === 'micro' ? 'Microsystem' : 'Macrosystem';
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
        : [.35, .5, .2, .7, -.35, -.5, 1, -1, 0, 2, Math.PI / 2, Math.PI,
            ...Array.from({ length: 96 }, (_, index) => -Math.PI + index * Math.PI / 48)])
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
const connectionLayoutCache = new Map();
function betweenEndpointCalloutLayout(edges, nodes, positions, phoneLayout = false) {
  const nodeGeometry = new Map(nodes.map(node => [node.id, mapNodeGeometry(node.label, phoneLayout)]));
  const labelGeometry = new Map(edges.map(edge => [edge.id, edge.verb?.trim() ? mapEdgeLabelGeometry(relationshipMapLabel(edge), phoneLayout, edge.scale) : { width: 22, height: 22 }]));
  const key = JSON.stringify([phoneLayout, nodes.map(node => [node.id, positions.get(node.id), nodeGeometry.get(node.id).cardWidth, nodeGeometry.get(node.id).cardHeight]), edges.map(edge => [edge.id,edge.source,edge.target,edge.verb,edge.scale,labelGeometry.get(edge.id)])]);
  const cached = connectionLayoutCache.get(key);
  if (cached) return cached;
  const result = straightConnectionLayout(edges,nodes,positions,nodeGeometry,labelGeometry);
  connectionLayoutCache.set(key,result);
  if (connectionLayoutCache.size > 8) connectionLayoutCache.delete(connectionLayoutCache.keys().next().value);
  return result;
}

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

// These are render-only traces of explicit legacy scope IDs, never graph edges.
function storedScopeTraces(nodes) {
  const ids = new Set(nodes.map(node => node.id));
  return nodes.filter(node => node.scale === 'macrosphere').flatMap(node => (node.scopeNodeIds || []).filter(id => ids.has(id)).map(target => ({ id: `scope:${node.id}:${target}`, source: node.id, target, verb: 'Scope', scale: 'macrosphere', scope: true, owner: node })));
}

function focusedEcologyCalloutBounds(edges, nodes, positions, phoneLayout = false) {
  const shownEdges = [...edges.filter((edge) => edge.showLabel !== false), ...storedScopeTraces(nodes)];
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

function EcologicalLayerBackdrop({ layers, visibleLayer, phoneLayout = false, nodeCount = 0, ringExpansion = 1, nodes = [], edges = [], positions = new Map(), visibleBounds = null, sharedBands = null, connectionLabelBounds = [] }) {
  const available = new Set(layers.filter(scale => scale !== 'meso' && scale !== 'macrosphere'));
  if (layers.some(scale => ['exosphere', 'macrosphere'].includes(scale))) available.add('exosphere');
  const originalBands = sharedBands || ecologyBands(phoneLayout, nodeCount, nodes);
  const bands = { ...originalBands, exosphere: { ...originalBands.exosphere,
    ...(nodes.some(node => node.scale === 'macrosphere') ? { outerRx: originalBands.macrosphere.outerRx, outerRy: originalBands.macrosphere.outerRy } : {}),
  } };
  const retained = retainedEcologyBoundaries(nodes.map(node => ({ ...node, ...positions.get(node.id) })), edges, phoneLayout, originalBands, ringExpansion);
  if (retained) return <g className="ecology-layers" aria-hidden="true">
    {['exosphere', 'micro'].filter(scale => available.has(scale) && retained[scale]).map(scale => {
      const boundary = retained[scale];
      const label = scale === 'micro' ? 'Microsystem' : 'Macrosystem';
      return <g key={scale} data-ecology-layer={scale} className={`ecology-layer ecology-layer--${scale} is-visible`}>
        <ellipse cx={boundary.cx} cy={boundary.cy} rx={boundary.rx} ry={boundary.ry} />
        <g className="ecology-layer__label" transform={`translate(${boundary.cx} ${boundary.top + 12})`}>
          <rect x="-84" y="-18" width="168" height="36" rx="18" /><text y="5">{label}</text>
        </g>
      </g>;
    })}
  </g>;
  const occupiedBounds = nodes.map((node) => {
    const position = positions.get(node.id);
    return position ? ecologyCardBounds(position, mapNodeGeometry(node.label, phoneLayout), 8) : null;
  }).filter(Boolean);
  occupiedBounds.push(...connectionLabelBounds);
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
      const active = visibleLayer === 'all' || visibleLayer === scale || (scale === 'exosphere' && visibleLayer === 'macrosphere');
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
  // Meso routes participate even while Micro hides arrows, so moving between
  // the two levels keeps exactly the same initial boundary.
  return enclosingMapBoundary(bounds);
}

function enclosingMapBoundary(bounds) {
  const left = Math.min(...bounds.map(box => box.left));
  const right = Math.max(...bounds.map(box => box.right));
  const top = Math.min(...bounds.map(box => box.top));
  const bottom = Math.max(...bounds.map(box => box.bottom));
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  // Every corner of the content rectangle fits inside the ellipse.
  const rx = Math.max(180, (right - left) / 2 * Math.SQRT2 + 28);
  const ry = Math.max(120, (bottom - top) / 2 * Math.SQRT2 + 36);
  return { cx, cy, rx, ry, left: cx - rx, right: cx + rx, top: cy - ry, bottom: cy + ry };
}

function retainedEcologyBoundaries(nodes, edges, phoneLayout, bands, expansion = 1) {
  // Imported and deliberately placed maps keep their coordinates. If those
  // cards are outside the planned annuli, measure the displayed content rather
  // than leaving two empty outlines at the original world center.
  if (!nodes.some(node => !rectangleFitsRing(node, {
    width: mapNodeGeometry(node.label, phoneLayout).cardWidth,
    height: mapNodeGeometry(node.label, phoneLayout).cardHeight,
    center: ECOLOGY_CENTER,
    band: Object.fromEntries(Object.entries(bands[node.scale]).map(([key, value]) => [key, value * expansion])),
    boundaryPadding: 0,
  }))) return null;
  const micro = sharedMicroBoundary(nodes.filter(node => node.scale === 'micro'), edges, phoneLayout);
  const positions = new Map(nodes.map(node => [node.id, node]));
  const bounds = [
    ...nodes.map(node => ecologyCardBounds(node, mapNodeGeometry(node.label, phoneLayout), 18)),
    ...focusedEcologyCalloutBounds(edges, nodes, positions, phoneLayout),
    ...(micro ? [micro] : []),
  ];
  return { micro, exosphere: bounds.length ? enclosingMapBoundary(bounds) : null };
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
  const exospherePathwayIssue = edge => !nodeIds.has(edge.source) || !nodeIds.has(edge.target) ? 'Choose available endpoints.' : '';
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
            <select aria-label={`Starting node for suggestion ${index + 1}`} value={item.source} onChange={(event) => onEdit(item.id, 'source', event.target.value)}>{endpointOptions(nodes.filter((node) => node.id !== item.target), item.source).map((node) => <option key={node.id} value={node.id}>{node.needsRepair ? 'Needs repair: ' : ''}{node.label}</option>)}</select>
            <AutoGrowingTextarea className="relationship-verb-editor" aria-label={`Connection for suggestion ${index + 1}`} maxLength={RELATIONSHIP_VERB_LIMIT} value={item.verb} onChange={(event) => onEdit(item.id, 'verb', event.target.value)} />
            <select aria-label={`Ending node for suggestion ${index + 1}`} value={item.target} onChange={(event) => onEdit(item.id, 'target', event.target.value)}>{endpointOptions(nodes.filter((node) => node.id !== item.source), item.target).map((node) => <option key={node.id} value={node.id}>{node.needsRepair ? 'Needs repair: ' : ''}{node.label}</option>)}</select>
          </div>
          {pathwayIssue && <p className="candidate-validation" role="status">{pathwayIssue} This suggestion stays here until you repair or remove it.</p>}
          <p>{item.rationale}</p>
        </div>
        <div className="candidate-actions" aria-label={`Decision for ${relationshipDescription(item)}`} >
          <button className={item.status === 'confirmed' ? 'is-active' : ''} type="button" disabled={Boolean(pathwayIssue)} onClick={() => onDecision(item.id, 'confirmed')}>Add to map</button>
          <button className={item.status === 'rejected' ? 'map-remove is-active' : 'map-remove'} type="button" onClick={() => onDecision(item.id, 'rejected')}>Remove</button>
        </div>
      </article>;
      })}
      {!suggestions.length && <p className="empty-message">No connections suggested</p>}
    </section>
  </section>;
}

function SavedItemContext({ item }) {
  const entries = [];
  const add = (label, value) => { if (value !== undefined && value !== null && String(value).trim()) entries.push([label, String(value)]); };
  add('Evidence note', item.annotations?.evidence?.text);
  add('Earlier note', item.notes);
  add('Interaction', item.mesoExplanation);
  for (const [index, record] of (item.claimEvidence || []).entries()) {
    for (const [key, value] of Object.entries(record)) {
      if (['sourcePassage', 'studentInterpretation', 'warrant', 'uncertainty', 'counterevidence', 'missingVoice', 'evidenceLocator'].includes(key)) add(`Evidence ${index + 1} · ${key.replace(/([A-Z])/g, ' $1').toLowerCase()}`, value);
    }
  }
  if (!entries.length) return null;
  return <details className="saved-item-context"><summary>Saved evidence and context</summary><dl>{entries.map(([label, value], index) => <div key={index}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>;
}

function AnnotationField({ annotationId, label, value, hint, placeholder, onDraftValue, onCommit, onFlush, onPersisted, persistenceStatus, persistenceMessage, savedRevision = 0, restoreRevision = null }) {
  const [draft, setDraft] = useState(value || '');
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirtyRef = useRef(false);
  const committedRef = useRef(false);
  const commitTimerRef = useRef(null);
  const savedRevisionRef = useRef(savedRevision);
  const callbacksRef = useRef({ onDraftValue, onCommit, onFlush, onPersisted, savedRevision });
  callbacksRef.current = { onDraftValue, onCommit, onFlush, onPersisted, savedRevision };

  const markPersisted = (updateState = true) => {
    dirtyRef.current = false;
    committedRef.current = false;
    if (updateState) { setPending(false); setSaved(true); }
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
    window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = null;
    setDraft(value || '');
    setPending(false);
    setSaved(false);
    dirtyRef.current = false;
    committedRef.current = false;
    savedRevisionRef.current = savedRevision;
  }, [annotationId, restoreRevision]);
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
    setSaved(false);
    callbacksRef.current.onDraftValue?.(next);
    window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(commit, ANNOTATION_COMMIT_DEBOUNCE_MS);
  };
  const fieldId = stableId('annotation-field', annotationId);
  const hintId = hint ? stableId('annotation-hint', annotationId) : null;
  const failed = persistenceStatus === 'error' || persistenceStatus === 'validation';
  const queued = pending;
  const statusText = failed ? persistenceMessage : queued ? 'Saving…' : saved ? 'Saved' : '';
  const statusId = statusText ? stableId('annotation-status', annotationId) : null;
  return <div className="field annotation-field">
    <label className="field__label" htmlFor={fieldId}>{label}</label>
    {hint && <span id={hintId} className="field__hint">{hint}</span>}
    <textarea id={fieldId} rows="4" maxLength={PROJECT_LIMITS.annotationText} value={draft} onChange={change} onBlur={() => flush()} aria-describedby={[statusId, hintId].filter(Boolean).join(' ')} placeholder={placeholder} />
    <div className="annotation-actions"><button type="button" className="button button--secondary" disabled={!pending && !failed} onClick={() => flush()}>Save note</button>
    {statusText && <span id={statusId} className={`annotation-save annotation-save--${failed ? 'error' : queued ? 'queued' : 'saved'}`} role="status">{statusText}</span>}</div>
  </div>;
}

function readingLabelSizes(edges,visibleIds,phone) {
  return new Map(edges.map(edge=>[edge.id,visibleIds.has(edge.id) ? {
    ...mapEdgeLabelGeometry(relationshipMapLabel(edge),phone,''),
    trailing:['not yet known','varies'].includes(relationshipDirection(edge)) ? 24 : 0,
  } : {width:0,height:0}]));
}

function GraphCanvas({ exportDrawing = false, nodes, edges, previewConnection = null, selection, onSelect, onMoveNode, selectedScope, onScopeSelect, viewport, phoneLayout, phoneViewBox = PHONE_GRAPH_VIEWBOX, mapLabel, mapMode = 'network', ecologyLayers = [], ecologyBandGeometry = null, ecologyInteractionBandGeometry = null, microBoundary = null, fontRevision = 0, visibleLayer = 'all', detailMode = false, connectionMode = false, ringExpansion = 1, minimumZoom = VIEWPORT_LIMITS.minZoom, readingMode = false, overviewLabels = false, nodeStage = false, onCancelConnection, onStartConnection, onConnectBlank, onAddBlank, onViewportChange, onAnnounce }) {
  const sharedBands = ecologyBandGeometry || ecologyBands(phoneLayout, nodes.length, nodes);
  const interactionBands = ecologyInteractionBandGeometry || sharedBands;
  const retainedPlacement = useMemo(() => mapMode === 'ecology' && Boolean(retainedEcologyBoundaries(nodes, edges, phoneLayout, sharedBands)), [nodes, edges, phoneLayout, sharedBands, mapMode]);
  const svgRef = useRef(null);
  const regionMaskPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, '-');
  const markerId = exportDrawing ? `export-arrow-${regionMaskPrefix}` : 'arrowhead';
  const markerUrl = `url(#${markerId})`;
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
  const activeRingExpansion = !readingMode && mapMode === 'ecology' && !detailMode ? ringExpansion : 1;
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
    const fallbackViewBox = phoneLayout || readingMode
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
    if (event.button === 1 || event.pointerType === 'touch') event.preventDefault();
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
      connectBlank: kind === 'pan' && connectionMode && event.button !== 1 && !panModifierRef.current,
    };
    setPointerGesture(kind);
  };
  const beginNode = (event, node) => {
    if (event.button === 1 || panModifierRef.current) { beginViewportGesture(event, 'pan'); return; }
    if (event.button !== undefined && event.button !== 0) return;
    // The completed touch selects the item itself. Suppress compatibility
    // mouse focus: opening the drawer can move a different edge under the tap.
    if (event.pointerType === 'touch') event.preventDefault();
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
      const rawX = mapMode === 'ecology' ? interaction.originX + delta.x : clamp(Math.round(interaction.originX + delta.x), PROJECT_LIMITS.coordinateMin, PROJECT_LIMITS.coordinateMax);
      const rawY = mapMode === 'ecology' ? interaction.originY + delta.y : clamp(Math.round(interaction.originY + delta.y), PROJECT_LIMITS.coordinateMin, PROJECT_LIMITS.coordinateMax);
      const constrained = !readingMode && mapMode === 'ecology' && !retainedPlacement
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
    const select = (kind, id) => tap ? onSelect(kind, id, true, tap) : onSelect(kind, id, true);
    if (!cancelled && interaction.moved && interaction.kind === 'node') onMoveNode(interaction.nodeId, interaction.latestX, interaction.latestY, 'pointer');
    if (!cancelled && !interaction.moved && interaction.kind === 'node') select('node', interaction.nodeId);
    if (!cancelled && !interaction.moved && interaction.kind === 'node-detail') select('node', interaction.selectionId);
    if (!cancelled && !interaction.moved && interaction.kind === 'edge') select('edge', interaction.selectionId);
    if (!cancelled && !interaction.moved && interaction.connectBlank) {
      const current = activeViewport();
      onConnectBlank?.({ x: (interaction.startSvgX - current.panX) / current.zoom,
        y: (interaction.startSvgY - current.panY) / current.zoom });
    }
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
    if (event.key === 'Enter' && event.shiftKey && onStartConnection) {
      event.preventDefault(); event.stopPropagation(); onStartConnection(node.id); return;
    }
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
    const rawX = mapMode === 'ecology' ? node.x + dx * step : clamp(node.x + dx * step, PROJECT_LIMITS.coordinateMin, PROJECT_LIMITS.coordinateMax);
    const rawY = mapMode === 'ecology' ? node.y + dy * step : clamp(node.y + dy * step, PROJECT_LIMITS.coordinateMin, PROJECT_LIMITS.coordinateMax);
    const { x, y } = !readingMode && mapMode === 'ecology' && !retainedPlacement ? constrainToEcologyBand(node, rawX, rawY, geometry, phoneLayout, nodes.length, interactionBands) : { x: rawX, y: rawY };
    onSelect('node', node.id, false);
    onMoveNode(node.id, x, y, 'keyboard');
    onAnnounce(`${node.label} moved to x ${x}, y ${y}.`);
  };
  const graphViewBox = phoneLayout || readingMode
    ? `${phoneViewBox.x} ${phoneViewBox.y} ${phoneViewBox.width} ${phoneViewBox.height}`
    : `0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`;
  const graphViewBoxBounds = phoneLayout || readingMode
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
  const scopeTraces = storedScopeTraces(nodes);
  const selectedGroup = edges.find(edge => edge.relationshipIds?.length && (selection?.kind === 'edge' ? edge.id === selection.id : edge.source === selection?.id));
  // Selection emphasizes the relationships attached to the selected item. In
  // the account workspace every relationship label stays on the canvas while
  // one is emphasized; earlier work is never hidden by choosing something.
  const emphasisEdgeIds = new Set(!selection ? [] : selection.kind === 'edge' ? [selection.id, ...(selectedGroup?.relationshipIds || [])]
    : edges.filter(edge => edge.source === selection.id || edge.target === selection.id).filter(edge => !edge.relationshipIds?.length).map(edge => edge.id));
  if (selectedGroup) { emphasisEdgeIds.add(selectedGroup.id); selectedGroup.relationshipIds.forEach(id => emphasisEdgeIds.add(id)); }
  const readingEdgeIds = overviewLabels ? new Set(edges.map(edge => edge.id)) : emphasisEdgeIds;
  const readingGeometry = new Map([...nodeVisuals].map(([id, visual]) => [id, visual.geometry]));
  const contentBoundaries = readingMode ? studentMapBoundaries(nodes.map(node=>({...node,...renderedPositions.get(node.id)})),readingGeometry) : null;
  // Which level a point on the canvas falls in, reading the same nested
  // regions the canvas draws. Outside the outermost drawn region is the next
  // level out, so a student can start the Macro region by double-clicking
  // beyond Exo. A plain network view has no regions and no answer.
  const levelAtPoint = (point) => {
    const inside = (cx, cy, rx, ry) => rx > 0 && ry > 0 && ((point.x - cx) / rx) ** 2 + ((point.y - cy) / ry) ** 2 <= 1;
    let drawn = [];
    if (contentBoundaries) {
      drawn = SPATIAL_SCALES.filter(scale => contentBoundaries[scale]);
      for (const scale of drawn) { const b = contentBoundaries[scale]; if (inside(b.cx, b.cy, b.rx, b.ry)) return scale; }
    } else if (mapMode === 'ecology') {
      drawn = SPATIAL_SCALES.filter(scale => ecologyLayers.includes(scale) && sharedBands[scale]);
      for (const scale of drawn) { const band = sharedBands[scale]; if (inside(ECOLOGY_CENTER.x, ECOLOGY_CENTER.y, band.outerRx * activeRingExpansion, band.outerRy * activeRingExpansion)) return scale; }
    } else return null;
    return SPATIAL_SCALES[Math.min(SPATIAL_SCALES.indexOf(drawn.at(-1) || 'micro') + 1, SPATIAL_SCALES.length - 1)];
  };
  const betweenEndpointLayout = useMemo(() => readingMode ? readingConnectionLayout(
    edges,nodes,renderedPositions,readingGeometry,readingLabelSizes(edges,readingEdgeIds,phoneLayout),
    new Set(edges.filter(e=>e.relationshipIds?.length && (selectedGroup?.id===e.id || overviewLabels)).map(e=>e.id)),
    captionObstacles(contentBoundaries)
  ) : betweenEndpointCalloutLayout(
    [...edges.filter((edge) => edge.showLabel !== false), ...scopeTraces],
    nodes,
    renderedPositions,
    phoneLayout,
  ), [edges, nodes, renderedPositions, phoneLayout, fontRevision, readingMode, overviewLabels, selection?.id]);
  const edgeVisuals = edges.map((edge) => {
    const source = nodeVisuals.get(edge.source);
    const target = nodeVisuals.get(edge.target);
    if (!source?.position || !target?.position) return null;
    const labelGeometry = mapEdgeLabelGeometry(relationshipMapLabel(edge), phoneLayout, readingMode ? '' : edge.scale);
    const calloutAnchor = betweenEndpointLayout.anchors.get(edge.id) || null;
    const routedPoints = betweenEndpointLayout.paths.get(edge.id) || null;
    const sourceToward = calloutAnchor || target.position;
    const targetToward = calloutAnchor || source.position;
    const sourcePoint = routedPoints?.source || cardConnectionPoint(source.position, sourceToward, source.geometry);
    const groupPoints = groupedRelationships(edge, edges).flatMap(local => {
      const a = renderedPositions.get(local.source), b = renderedPositions.get(local.target);
      return a && b ? [relationshipAttachment(betweenEndpointLayout,local.id) || { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }] : [];
    });
    const groupTarget = groupPoints.length ? { x: groupPoints.reduce((sum, point) => sum + point.x, 0) / groupPoints.length, y: groupPoints.reduce((sum, point) => sum + point.y, 0) / groupPoints.length } : null;
    const targetPoint = routedPoints?.target || groupTarget || cardConnectionPoint(target.position, targetToward, target.geometry, phoneLayout ? 12 : 7);
    const labelPoint = calloutAnchor || {
      x: (source.position.x + targetPoint.x) / 2,
      y: (source.position.y + targetPoint.y) / 2,
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
  const scopeLayout = betweenEndpointLayout;
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
  const relationshipGroupVisuals = edges.filter(edge => edge.relationshipIds?.length).flatMap(edge => {
    const members = groupedRelationships(edge, edges);
    const region = mapRegionGeometry([edge.source, ...members.flatMap(local => [local.source, local.target])], nodeVisuals, phoneLayout ? 14 : 10);
    const heading = nodeVisuals.get(edge.source)?.position;
    const drawn = betweenEndpointLayout.groups?.get(edge.id);
    const vectors = members.flatMap(local => {
      const branch=drawn?.find(member=>member.id===local.id);
      if(branch?.route) return [{id:local.id,...branch.point,primary:branch===drawn[0],path:branch.route.points.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ')}];
      const a=nodeVisuals.get(local.source)?.position, b=nodeVisuals.get(local.target)?.position;
      if(!heading || !a || !b)return [];
      const point=relationshipAttachment(betweenEndpointLayout,local.id) || {x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      return [{id:local.id,...point}];
    });
    return region && heading ? [{ ...region, edge, heading, vectors, maskId: `${regionMaskPrefix}-group-${edge.id}` }] : [];
  });
  const graphSummary = `${nodes.length} ${nodes.length === 1 ? 'node' : 'nodes'}${nodeStage ? '' : ` and ${edges.length} ${edges.length === 1 ? 'connection' : 'connections'}`}`;
  return <svg id={exportDrawing ? undefined : "systems-map-canvas"} ref={svgRef} tabIndex="0" className={`graph-canvas graph-canvas--${mapMode} ${readingMode ? 'is-reading-view' : ''} ${selection ? 'has-reading-selection' : ''} ${detailMode ? 'is-detail-view' : ''} ${pointerGesture ? 'is-panning' : ''} ${spacePanning ? 'is-space-panning' : ''}`} data-map-mode={mapMode} data-ring-expansion={activeRingExpansion.toFixed(4)} role="group" aria-label={`${mapLabel}. ${graphSummary}. ${nodeStage ? 'Select a node to edit it.' : 'Select a node or relationship to edit it.'}`} aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight" viewBox={graphViewBox} onPointerDownCapture={beginPointerTracking} onPointerDown={beginPan} onPointerMove={movePointer} onPointerUp={finishPointer} onPointerCancel={(event) => finishPointer(event, true)} onLostPointerCapture={(event) => { if (event.target === event.currentTarget) finishPointer(event, true); }} onDoubleClick={(event) => {
    // Double-clicking empty canvas adds a node at that spot, in the level
    // whose ring is under the pointer. Nodes and lines handle their own.
    if (!onAddBlank || connectionMode || detailMode || event.target.closest?.('[data-graph-id]')) return;
    event.preventDefault();
    const current = activeViewport();
    const svgPoint = clientPoint(event.clientX, event.clientY);
    const point = { x: (svgPoint.x - current.panX) / current.zoom, y: (svgPoint.y - current.panY) / current.zoom };
    onAddBlank({ ...point, scale: levelAtPoint(point) });
  }} onKeyDown={(event) => {
    if (event.key === 'Escape' && interactionRef.current) {
      event.preventDefault();
      const interaction = interactionRef.current;
      finishPointer({ pointerId: interaction.pointerId ?? [...interaction.pointerIds][0] }, true);
      liveViewportRef.current = viewport;
      onAnnounce('Map gesture cancelled.');
      return;
    }
    if (event.target !== event.currentTarget) return;
    if (connectionMode && onConnectBlank && event.key.toLowerCase() === 'n' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const current = activeViewport();
      onConnectBlank({ x: (graphViewBoxBounds.x + graphViewBoxBounds.width / 2 - current.panX) / current.zoom,
        y: (graphViewBoxBounds.y + graphViewBoxBounds.height / 2 - current.panY) / current.zoom });
      return;
    }
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
      <marker className="map-arrowhead" id={markerId} markerUnits={readingMode ? 'userSpaceOnUse' : 'strokeWidth'} markerWidth={readingMode ? 9 : phoneLayout ? 6 : 8} markerHeight={readingMode ? 7 : phoneLayout ? 5 : 6} viewBox="0 0 8 6" refX={phoneLayout ? 8 : 7} refY="3" orient="auto-start-reverse"><path d={readingMode ? 'M0.5,0.5 L6.5,3 L0.5,5.5' : 'M0,0 L8,3 L0,6 z'} /></marker>
      {[...microSettingRegionVisuals, ...macroScopeRegionVisuals, ...relationshipGroupVisuals].map(({ maskId, bounds, exclusions }) => (
        <mask key={maskId} id={maskId} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x={bounds.left - 2} y={bounds.top - 2} width={bounds.right - bounds.left + 4} height={bounds.bottom - bounds.top + 4} style={{ maskType: 'luminance' }}>
          <rect x={bounds.left - 2} y={bounds.top - 2} width={bounds.right - bounds.left + 4} height={bounds.bottom - bounds.top + 4} fill="white" />
          {exclusions.map(box => <rect key={box.id} data-excludes-node={box.id} x={box.left} y={box.top} width={box.right - box.left} height={box.bottom - box.top} fill="black" />)}
        </mask>
      ))}
    </defs>
    <g className="viewport-layer" transform={`translate(${shownViewport.panX} ${shownViewport.panY}) scale(${shownViewport.zoom})`}>
      {contentBoundaries && <g className="ecology-layers" aria-hidden="true">{['macrosphere','exosphere','micro'].filter(scale=>contentBoundaries[scale]).map(scale=>{
        const boundary=contentBoundaries[scale];
        return <g key={scale} data-ecology-layer={scale} className={`ecology-layer ecology-layer--${scale} is-visible`}>
          <ellipse cx={boundary.cx} cy={boundary.cy} rx={boundary.rx} ry={boundary.ry}/>
          <g className="ecology-layer__label ecology-layer__label--reading" transform={`translate(${boundary.cx} ${boundary.top+REGION_CAPTION.offsetY})`}>
            <rect x={-REGION_CAPTION.width/2} y={-REGION_CAPTION.height/2} width={REGION_CAPTION.width} height={REGION_CAPTION.height} rx="6"/>
            <text y="6">{scale==='micro'?'Microsystem':scale==='exosphere'?'Exosystem':'Macrosystem'}</text>
          </g>
        </g>;
      })}</g>}
      {!readingMode && mapMode === 'ecology' && !detailMode ? <EcologicalLayerBackdrop layers={ecologyLayers} visibleLayer={visibleLayer} phoneLayout={phoneLayout} nodeCount={nodes.length} ringExpansion={activeRingExpansion} nodes={nodes} edges={edges} positions={renderedPositions} visibleBounds={visibleLabelBounds} sharedBands={sharedBands} connectionLabelBounds={[...betweenEndpointLayout.bounds.values()]} /> : null}
      {!readingMode && microBoundary && <g className="ecology-layers shared-micro-boundary" aria-hidden="true"><g data-ecology-layer="micro" className="ecology-layer ecology-layer--micro is-visible">
        <ellipse cx={microBoundary.cx} cy={microBoundary.cy} rx={microBoundary.rx} ry={microBoundary.ry} />
        <g className="ecology-layer__label" transform={`translate(${microBoundary.cx} ${microBoundary.top + 12})`}><rect x="-84" y="-18" width="168" height="36" rx="18" /><text y="5">Microsystem</text></g>
      </g></g>}
      <g className="micro-setting-regions" aria-hidden="true">{microSettingRegionVisuals.map(({ setting, memberCount, path, selected, maskId }) => <path key={`micro-setting-${setting.id}`} data-setting-region={setting.id} data-member-count={memberCount} className={`micro-setting-region ${selected ? 'is-selected' : ''} ${setting.visualMuted ? 'is-muted' : ''}`} d={path} mask={`url(#${maskId})`} />)}</g>
      <g className="macrosystem-relationship-groups">{relationshipGroupVisuals.map(({ edge, path, maskId, heading, vectors }) => <g key={edge.id} data-relationship-group={edge.id} data-heading={edge.source} data-group-scale={edge.scale} className={readingMode && selectedGroup?.id !== edge.id && !(overviewLabels && !selection) ? 'is-inactive-group' : 'is-active-group'}>
        <path className={`relationship-group-band ${selection?.id === edge.id ? 'is-selected' : ''}`} d={path} mask={`url(#${maskId})`} aria-hidden="true" />
        {vectors.filter(point=>!point.primary).map(point => <path key={point.id} data-group-member={point.id} d={point.path || `M ${heading.x} ${heading.y} L ${point.x} ${point.y}`} className="relationship-group-vector" vectorEffect="non-scaling-stroke" aria-hidden="true" />)}
        {readingMode && vectors.map(point=><circle key={`join-${point.id}`} className="relationship-group-join" cx={point.x} cy={point.y} r="4" aria-hidden="true" />)}
      </g>)}</g>
      <g className="scope-fields" aria-hidden="true">{macroScopeRegionVisuals.map(({ node, path, selected, maskId }) => (
        <path style={selected ? { fill: 'none' } : undefined} key={`scope-${node.id}`} data-scope-of={node.id} className={`scope-field ${selected ? 'is-selected' : ''} ${node.visualMuted ? 'is-muted' : ''}`} d={path} mask={`url(#${maskId})`} />
      ))}</g>
      <g className="scope-influence-links">{scopeTraces.map(trace => {
        const from = nodeVisuals.get(trace.source), to = nodeVisuals.get(trace.target);
        if (!from || !to) return null;
        const anchor = scopeLayout.anchors.get(trace.id) || { x: (from.position.x + to.position.x) / 2, y: (from.position.y + to.position.y) / 2 };
        const routed = scopeLayout.paths.get(trace.id);
        const start = routed?.source || cardConnectionPoint(from.position, anchor, from.geometry, 5);
        const end = routed?.target || cardConnectionPoint(to.position, anchor, to.geometry, 5);
        const points = routed?.points || [start, anchor, end];
        const path = points.map((point,index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
        const pressed = selectedScope?.source === trace.source && selectedScope?.target === trace.target;
        const label = `Stored scope: ${trace.owner.label} ${trace.owner.deontic || 'affects'} ${nodes.find(node => node.id === trace.target)?.label}. Scope membership, not a direct relationship.`;
        return <g key={trace.id} className={`scope-influence ${pressed ? 'is-selected' : ''}`} data-scope-source={trace.source} data-scope-target={trace.target} role="button" tabIndex="0" aria-label={label} aria-pressed={pressed} onPointerDown={event => event.stopPropagation()} onClick={() => onScopeSelect?.(trace.source,trace.target)} onKeyDown={event => { if (['Enter',' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onScopeSelect?.(trace.source,trace.target); } }}>
          <title>{label}</title><path className="scope-influence-hit" d={path} /><path className="scope-influence-line" d={path} vectorEffect="non-scaling-stroke" strokeDasharray="8 4 2 4" />
          <circle cx={end.x} cy={end.y} r="4" className="scope-influence-end" />
          <rect x={anchor.x - 24} y={anchor.y - 10} width="48" height="20" rx="3" className="scope-influence-label-bg" /><text x={anchor.x} y={anchor.y} textAnchor="middle" dominantBaseline="central" className="scope-influence-label">Scope</text>
        </g>;
      })}</g>
      <g className="meso-linkages" aria-hidden="true">{mesoBridgeVisuals.map((bridge) => <line key={bridge.id} data-linkage-of={bridge.linkageId} className={`meso-link-line ${bridge.muted ? 'is-muted' : ''}`} x1={bridge.x1} y1={bridge.y1} x2={bridge.x2} y2={bridge.y2} />)}</g>
      {previewConnection && (() => {
        const source = nodes.find(node => node.id === previewConnection.source);
        const target = nodes.find(node => node.id === previewConnection.target);
        if (!source || !target || source.id === target.id) return null;
        const from = renderedPositions.get(source.id), to = renderedPositions.get(target.id);
        const start = cardConnectionPoint(from, to, mapNodeGeometry(source.label, phoneLayout), 5);
        const end = cardConnectionPoint(to, from, mapNodeGeometry(target.label, phoneLayout), 5);
        const arrows = relationshipArrowheads({ relationshipProcess: { direction: previewConnection.direction } });
        return <g className="relationship-draft-preview" pointerEvents="none" aria-label="Relationship draft, not added to map"><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="var(--ink)" strokeWidth="2" strokeDasharray="3 6" vectorEffect="non-scaling-stroke" markerStart={arrows.start ? markerUrl : undefined} markerEnd={arrows.end ? markerUrl : undefined} /></g>;
      })()}
      <g className="edges">{edgeVisuals.map(({ edge, x1, y1, x2, y2, path, edgeRoute, selected }) => <g key={edge.id} data-graph-id={edge.id} data-edge-scale={edge.scale} data-edge-route={edgeRoute} role="button" tabIndex={edge.visualMuted ? -1 : 0} aria-label={`${relationshipDescription(edge)}, direction: ${relationshipDirection(edge)}, ${SCALES[edge.scale]?.label || edge.scale} connection`} aria-keyshortcuts="Enter Space Delete Backspace" aria-pressed={selected} className={`graph-edge ${readingMode && (selection ? emphasisEdgeIds : readingEdgeIds).has(edge.id) ? 'is-reading-active' : ''} ${readingMode && edge.relationshipIds?.length && selectedGroup?.id !== edge.id && !overviewLabels ? 'is-inactive-group' : ''} graph-edge--${stateClass(edge.claimState)} ${edge.visualMuted ? 'is-muted' : ''} ${edge.visualDimmed ? 'is-dimmed' : ''} ${selected ? 'is-selected' : ''}`} onFocus={() => { if(readingMode && selection?.id !== edge.id) onSelect('edge',edge.id,false); }} onPointerDown={(event) => beginEdge(event, edge)} onLostPointerCapture={(event) => { if (interactionRef.current?.kind !== 'pinch') finishPointer(event, true); }} onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect('edge', edge.id, true);
      }}>
        <path className="edge-hit" d={path} x1={x1} y1={y1} x2={x2} y2={y2} />
        {selected && <path className="edge-selection-halo" d={path} x1={x1} y1={y1} x2={x2} y2={y2} />}
        <title>{`Direction: ${relationshipDirection(edge)}`}</title>
        {readingMode && <path className="edge-crossing-gap" d={path} aria-hidden="true" />}
        <path className={betweenEndpointLayout.groups?.has(edge.id) ? "edge-line relationship-group-vector" : "edge-line"} data-group-member={betweenEndpointLayout.groups?.get(edge.id)?.[0]?.id} style={{ '--edge-count-width': relationshipLineWidth(edge) }} strokeDasharray={edge.relationshipProcess?.connectionStatus === 'missing' ? '7 5' : undefined} data-connection-status={edge.relationshipProcess?.connectionStatus || 'unknown'} vectorEffect={phoneLayout ? "non-scaling-stroke" : undefined} d={path} x1={x1} y1={y1} x2={x2} y2={y2} markerStart={relationshipArrowheads(edge).start ? markerUrl : undefined} markerEnd={relationshipArrowheads(edge).end ? markerUrl : undefined} />
      </g>)}</g>
      <g className="edge-labels" aria-hidden="true">{edgeVisuals.filter(({ edge }) => edge.showLabel !== false && (!readingMode || readingEdgeIds.has(edge.id))).map(({ edge, midX, midY, labelGeometry: geometry, edgeRoute, selected }) => {
        return <g key={edge.id} data-edge-id={edge.id} data-edge-scale={edge.scale} data-edge-route={edgeRoute} data-anchor-x={midX} data-anchor-y={midY} data-full-label={relationshipMapLabel(edge)} className={`graph-edge-label ${edge.visualDimmed ? 'is-dimmed' : ''} ${readingMode && selection && emphasisEdgeIds.has(edge.id) ? 'is-reading-active' : ''} ${selected ? 'is-selected' : ''}`}>
          {!['source to target', 'target to source', 'both directions'].includes(relationshipDirection(edge)) && <g className="edge-direction-symbol" transform={`translate(${edge.verb.trim() ? midX + geometry.width / 2 + 13 : midX} ${midY})`}>
            <title>{`Direction: ${relationshipDirection(edge)}`}</title>
            {relationshipDirection(edge) === 'varies' ? <path d="M0,-7 L7,0 L0,7 L-7,0 Z" fill="var(--surface)" stroke="var(--ink)" strokeWidth="1.5" /> : <><circle r="8" fill="var(--surface)" stroke="var(--ink)" /><text textAnchor="middle" dominantBaseline="central" fontSize="12" fill="var(--ink)">?</text></>}
          </g>}
          {betweenEndpointLayout.leaders?.has(edge.id) && (() => { const leader = betweenEndpointLayout.leaders.get(edge.id); return <line className="edge-label-leader" x1={leader.source.x} y1={leader.source.y} x2={leader.target.x} y2={leader.target.y} vectorEffect="non-scaling-stroke" />; })()}
          {edge.verb.trim() && <><rect className="edge-label-bg" x={midX - (geometry.width / 2)} y={midY - (geometry.height / 2)} width={geometry.width} height={geometry.height} rx={readingMode ? 0 : phoneLayout ? 6 : 2} />
          <text className="edge-label" style={{ fontSize: geometry.fontSize, fontFamily: '"Source Sans 3 Variable", "Source Sans 3", sans-serif' }} x={midX}>{geometry.lines.map((line, lineIndex) => <tspan key={`${edge.id}-line-${lineIndex}`} x={midX} y={midY + geometry.startY + lineIndex * geometry.lineHeight}>{line}</tspan>)}</text></>}
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
        return <g key={node.id} data-graph-id={node.id} data-full-label={node.label} data-node-type={node.type} data-node-color={node.color} role="button" tabIndex="0" aria-label={`${node.label}, ${node.type}, ${SCALES[node.scale]?.label || node.scale}, ${evidenceState}${scopeState}${microContextState}`} aria-keyshortcuts={`Enter Space Delete Backspace ${onStartConnection ? 'Shift+Enter ' : ''}${detailMode ? '' : 'ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight'}`.trim()} aria-pressed={selected} className={`graph-node graph-node--${node.scale} graph-node--${stateClass(node.claimState)} ${node.visualMuted ? 'is-muted' : ''} ${node.visualDimmed ? 'is-dimmed' : ''} ${selected ? 'is-selected' : ''}`} transform={`translate(${position.x} ${position.y})`} onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); if (onStartConnection) onStartConnection(node.id); else onCancelConnection?.(); }} onPointerDown={(event) => beginNode(event, node)} onLostPointerCapture={(event) => { if (interactionRef.current?.kind !== 'pinch') finishPointer(event, true); }} onKeyDown={(event) => keyboardNode(event, node)}>
          {selected && <rect className="node-selection-ring" x={geometry.ringX} y={geometry.ringY} width={geometry.ringWidth} height={geometry.ringHeight} rx={geometry.ringRadius} />}
          <rect className="node-card" x={geometry.cardX} y={geometry.cardY} width={geometry.cardWidth} height={geometry.cardHeight} rx={geometry.cardRadius} />
          <text className="node-label" style={{ fontSize: geometry.fontSize, fontFamily: '"Source Sans 3 Variable", "Source Sans 3", sans-serif' }}>{geometry.lines.map((line, lineIndex) => <tspan key={`${node.id}-line-${lineIndex}`} x="0" y={geometry.labelStartY + lineIndex * geometry.lineHeight}>{line}</tspan>)}</text>
        </g>;
      })}</g>
    </g>
  </svg>;
}

function sameGraphVisuals(previous, next) {
  if (previous.onCancelConnection !== next.onCancelConnection || previous.onStartConnection !== next.onStartConnection || previous.onConnectBlank !== next.onConnectBlank || previous.onAddBlank !== next.onAddBlank || previous.readingMode !== next.readingMode || previous.overviewLabels !== next.overviewLabels || previous.nodeStage !== next.nodeStage) return false;
  if (previous.phoneLayout !== next.phoneLayout) return false;
  if (previous.phoneViewBox?.height !== next.phoneViewBox?.height) return false;
  if (previous.mapLabel !== next.mapLabel) return false;
  if (previous.mapMode !== next.mapMode || previous.visibleLayer !== next.visibleLayer) return false;
  if (previous.detailMode !== next.detailMode || previous.connectionMode !== next.connectionMode) return false;
  if (previous.ringExpansion !== next.ringExpansion) return false;
  if (previous.ecologyBandGeometry !== next.ecologyBandGeometry) return false;
  if (JSON.stringify(previous.previewConnection) !== JSON.stringify(next.previewConnection)) return false;
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
    if (a.id !== b.id || a.x !== b.x || a.y !== b.y || a.label !== b.label || a.type !== b.type || a.scale !== b.scale || a.color !== b.color || a.claimState !== b.claimState || Boolean(a.evidence) !== Boolean(b.evidence) || a.visualMuted !== b.visualMuted || a.visualDimmed !== b.visualDimmed) return false;
    if ((a.scopeNodeIds || []).join(',') !== (b.scopeNodeIds || []).join(',') || a.deontic !== b.deontic) return false;
    if ((a.settingNodeIds || []).join(',') !== (b.settingNodeIds || []).join(',') || a.focalParticipation !== b.focalParticipation) return false;
  }
  for (let index = 0; index < previous.edges.length; index += 1) {
    const a = previous.edges[index]; const b = next.edges[index];
    if (JSON.stringify(a.relationshipIds) !== JSON.stringify(b.relationshipIds) || JSON.stringify(a.relationshipProcess) !== JSON.stringify(b.relationshipProcess) || a.id !== b.id || a.source !== b.source || a.target !== b.target || a.verb !== b.verb || a.scale !== b.scale || a.claimState !== b.claimState || a.sourceLabel !== b.sourceLabel || a.targetLabel !== b.targetLabel || a.showLabel !== b.showLabel || a.visualMuted !== b.visualMuted || a.visualDimmed !== b.visualDimmed || a.layerEdgeSlot !== b.layerEdgeSlot || a.layerEdgeCount !== b.layerEdgeCount) return false;
  }
  if (JSON.stringify(previous.selectedScope) !== JSON.stringify(next.selectedScope) || previous.onScopeSelect !== next.onScopeSelect) return false;
  if (previous.onMoveNode !== next.onMoveNode || previous.onSelect !== next.onSelect) return false;
  return true;
}

const MemoGraphCanvas = React.memo(GraphCanvas, sameGraphVisuals);

// Export is a noninteractive rendering of the same GraphCanvas. Only the
// fitting window changes. Account-library downloads can reconstruct the saved
// layout even when the editor has never been mounted in the current tab.
function mapPresentationKey(project) {
  return JSON.stringify([project.id,project.layout,project.graph.nodes.map(n=>[n.id,n.x,n.y,n.scale,n.type,n.color,n.label,n.status,n.claimState]),project.graph.edges.map(e=>[e.id,e.source,e.target,e.verb,e.relationshipIds,e.status,e.claimState])]);
}
export function projectDrawing(project,presentation=null) {
  const current=presentation?.key===mapPresentationKey(project) ? presentation : null;
  const phone=current?.phone ?? (typeof window!=='undefined' && Boolean(window.matchMedia?.('(max-width:600px)').matches));
  const nodes=project.graph.nodes.filter(n=>isLiveMapItem(n) && n.scale!=='meso');
  const ids=new Set(nodes.map(n=>n.id));
  const edges=project.graph.edges.filter(e=>isLiveMapItem(e) && ids.has(e.source) && ids.has(e.target));
  const positions=studentReadingPositions(nodes,edges,{...project.layout,phone,aspectRatio:current?.aspectRatio || project.layout?.readingAspect || (phone ? .78 : 1.8)});
  const placed=nodes.map(n=>({...n,...(current?.positions.get(n.id) || positions.get(n.id))}));
  return <GraphCanvas exportDrawing nodes={placed} edges={edges} viewport={{panX:0,panY:0,zoom:1}}
    readingMode overviewLabels phoneLayout={phone} mapMode={nodes.some(n=>n.scale!=='micro')?'ecology':'network'} mapLabel={project.title} />;
}

function mapDrawingDescription(project) {
  const nodes=project.graph.nodes.filter(isLiveMapItem), byId=new Map(nodes.map(n=>[n.id,n.label]));
  const edges=project.graph.edges.filter(e=>isLiveMapItem(e) && byId.has(e.source) && byId.has(e.target));
  const describe=e=>relationshipDescription(e,byId.get(e.source),byId.get(e.target));
  return [project.title,...edges.map(e=>[describe(e),relationshipProcessSummary(e.relationshipProcess),
    ...(e.relationshipIds?.length ? groupedRelationships(e,edges).map(describe) : [])].filter(Boolean).join('; ')),
    ...nodes.filter(n=>n.scale==='meso').map(n=>'Preserved Meso record: '+n.label),
    ...nodes.flatMap(n=>(n.scopeNodeIds || []).filter(id=>byId.has(id)).map(id=>[n.label,n.deontic || 'includes',byId.get(id)].join(' '))),
    ...nodes.flatMap(n=>(n.settingNodeIds || []).filter(id=>byId.has(id)).map(id=>[n.label,'setting membership',byId.get(id)].join(' — ')))].join('\n');
}
export function projectMapImage(project,presentation) {
  return captureMapDrawing(()=>projectDrawing(project,presentation),project.title,mapDrawingDescription(project));
}
export async function downloadProjectFile(project,format,presentation) {
  const portable=createPortableProject(project,'private');
  if(format==='json')return downloadBlob(new Blob([serializePortableProject(project,'private')],{type:'application/json'}),exportFileName(project,'json'));
  if(format==='csv')return downloadBlob(new Blob([graphCsv(portable)],{type:'text/csv'}),exportFileName(project,'csv'));
  if(format==='markdown')return downloadBlob(new Blob([projectMarkdown(portable)],{type:'text/markdown'}),exportFileName(project,'md'));
  const image=await projectMapImage(portable,presentation);
  return downloadBlob(await exportMapImage(image,format),exportFileName(project,format));
}
function MapDrawingPreview({project,presentation}) {
  const [image,setImage]=useState(null);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    let cancelled=false,url;
    projectMapImage(project,presentation).then(({svg})=>{
      if(cancelled)return;
      url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));setImage(url);setFailed(false);
    }).catch(()=>{if(!cancelled)setFailed(true);});
    return ()=>{cancelled=true;if(url)URL.revokeObjectURL(url);};
  },[project.graph,project.layout,project.title,presentation]);
  return <figure className="completion-preview">{image ? <img src={image} alt={`Map preview: ${project.title || 'Systems map'}`} />
    : <figcaption>{failed?'Preview unavailable. You can still choose a download format.':'Preparing map preview…'}</figcaption>}</figure>;
}

function MapLegend({savedHistory=false,canConnect=false}) {
  return <div className="legend-grid">
    <section><h3>Levels</h3><dl className="level-guide">
      <div><dt><i className="legend-symbol legend-symbol--micro" />Micro-level</dt><dd>Person participates directly in this setting or interaction.</dd></div>
      <div><dt><i className="legend-symbol legend-symbol--meso" />Meso-level</dt><dd>Arrows connect the people, resources, and settings already on the Micro map.</dd></div>
      <div><dt><i className="legend-symbol legend-symbol--exosphere" />Exo-level</dt><dd>Outside offices, policies and decision settings; dotted connections attach them to local relationships.</dd></div>
      <div><dt><i className="legend-symbol legend-symbol--macrosphere" />Macro-level</dt><dd>Cultural beliefs, economic structures and broader conditions; purple dashed lines mark their connections.</dd></div>
    <div><dt><span aria-hidden="true">◇</span> Direction varies</dt><dd>No fixed arrow direction is asserted.</dd></div><div><dt><span aria-hidden="true">?</span> Direction unknown</dt><dd>Direction has not been established.</dd></div></dl></section>
    <section><h3>Default node colors</h3><ul className="node-color-key"><li data-node-color="people">People and groups</li><li data-node-color="settings">Places and organizations</li><li data-node-color="resources">Activities and resources</li><li data-node-color="macro">Broader conditions</li></ul><h3>How to read this map</h3><ul className="map-conventions">
      <li><strong>Micro</strong><span>People, resources, and immediate settings</span></li>
      <li><strong>Exo</strong><span>Policies and outside offices; teal dotted connections link to local relationships.</span></li>
      <li><strong>Macro</strong><span>Cultural, historical and economic conditions; purple dashed connections.</span></li>
      <li><strong>Relationships</strong><span>Arrowheads show established direction. The label contains the relationship wording. Selecting an item highlights its relationships; the others stay in view.</span></li>
      <li><strong>Auto-fit</strong><span>Busy nodes sit near the center. Unconnected items are grouped by color away from the connection routes. Use Arrange map to reorganize a saved layout.</span></li>
      <li><strong>Draft</strong><span>A dotted line previews an unfinished relationship.</span></li>
      <li><strong>Stored scope</strong><span>A dash-dot line with hollow endpoints marks a recorded scope membership, not a directional relationship.</span></li>
    </ul><p className="map-legend__note">Choose a node’s color in Notebook. Color does not change its system or type. Regions appear as the map grows: Micro, then Exo, then Macro. You create every relationship.</p></section>
    <section><h3 id="map-key-shortcuts" tabIndex="-1">Keyboard shortcuts</h3><dl className="map-key-shortcuts">
      <div><dt>Remove selected item</dt><dd>Delete or Backspace</dd></div>
      <div><dt>{savedHistory?'Undo':'Undo layout'}</dt><dd>⌘/Ctrl + Z</dd></div>
      <div><dt>{savedHistory?'Redo':'Redo layout'}</dt><dd>⌘/Ctrl + Shift + Z · Ctrl + Y</dd></div>
      <div><dt>Find a node</dt><dd>⌘/Ctrl + F or /</dd></div>
      <div><dt>Fit map · Zoom</dt><dd>0 · + / −</dd></div>
      <div><dt>Pan canvas · Move focused node</dt><dd>Arrow keys (Shift moves farther)</dd></div>
      {canConnect && <><div><dt>Connect from focused node</dt><dd>Shift + Enter, or double-click it</dd></div><div><dt>Choose a target · Start a new target</dt><dd>Enter on a node or line · N on the canvas while connecting</dd></div><div><dt>Place a node in a level</dt><dd>Double-click empty space inside that region</dd></div></>}
      <div><dt>Cancel · Show shortcuts</dt><dd>Esc · ?</dd></div>
    </dl></section>
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

export function readableMapPositions(nodes, edges, phoneLayout, bands = ecologyBands(phoneLayout, nodes.length, nodes), layout = {}) {
  const initial = arrangedEcologyPositions(nodes, phoneLayout, bands);
  const geometries = new Map(nodes.map(node => [node.id, mapNodeGeometry(node.label, phoneLayout)]));
  const manualIds = Array.isArray(layout?.manualNodeIds) ? layout.manualNodeIds : layout?.phoneOverview === 'preserve' ? nodes.map(node => node.id) : [];
  const localNodes = nodes.filter(node => node.scale === 'micro').map(node => ({ ...node, ...(manualIds.includes(node.id) ? {} : initial.get(node.id)) }));
  const retainedMicro = retainedEcologyBoundaries(localNodes, edges, phoneLayout, bands)?.micro;
  const center = retainedMicro ? { x: retainedMicro.cx, y: retainedMicro.cy } : ECOLOGY_CENTER;
  const outerCards = nodes.filter(node => node.scale !== 'micro').map(node => geometries.get(node.id));
  const retainedBand = retainedMicro && outerCards.length ? {
    innerRx: retainedMicro.rx + 20, innerRy: retainedMicro.ry + 20,
    outerRx: retainedMicro.rx + Math.max(400, ...outerCards.map(card => card.cardWidth * 1.5 + 80)),
    outerRy: retainedMicro.ry + Math.max(300, ...outerCards.map(card => card.cardHeight * 2 + 80)),
  } : null;
  const candidates = new Map();
  for (const node of nodes) {
    if (node.scale === 'micro' || manualIds.includes(node.id)) continue;
    const band = retainedBand || bands[node.scale];
    if (!band) continue;
    const rx = (band.innerRx + band.outerRx) / 2, ry = (band.innerRy + band.outerRy) / 2;
    const unique = new Map();
    for (let index = 0; index < 64; index++) {
      const angle = -Math.PI / 2 + index * Math.PI / 32;
      const proposed = { x: center.x + Math.cos(angle) * rx, y: center.y + Math.sin(angle) * ry };
      const geometry = geometries.get(node.id);
      const point = retainedBand ? projectRectangleToRing(proposed, { width: geometry.cardWidth, height: geometry.cardHeight, center, band, boundaryPadding: 20 })
        : constrainToEcologyBand(node, proposed.x, proposed.y, geometry, phoneLayout, nodes.length, bands);
      if (!point) continue;
      unique.set(`${point.x}:${point.y}`, point);
    }
    candidates.set(node.id, [...unique.values()]);
    // Seed the same admissible area searched below, so an old world-centered
    // position cannot win on short edge length while sitting inside Micro.
    if (retainedBand && unique.size) initial.set(node.id, [...unique.values()][Math.floor((candidates.size - 1) * unique.size / outerCards.length) % unique.size]);
  }
  const ids = new Set(nodes.map(node => node.id));
  const connections = [...edges.filter(edge => isLiveMapItem(edge) && ids.has(edge.source) && ids.has(edge.target)), ...storedScopeTraces(nodes)];
  return readableNodePositions(nodes, connections, initial, geometries, { manualIds, candidates });
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

// What a student can reach after Connect from, in the words the status strip
// and the screen reader share.
function connectTargetHint(source) {
  return ['exosphere', 'macrosphere'].includes(source.scale)
    ? 'Click a local relationship line or a node it affects, or empty space for a new node.'
    : 'Click another node, or empty space for a new node.';
}

function blankManualNode(scale, threeSpheres = false) {
  // Meso adds relationships in the existing Micro space. A missing person or
  // setting therefore joins Micro even when the student is working at Meso.
  scale = threeSpheres && scale === 'macrosphere' ? scale : nodeScaleFor(scale);
  return {
    label: '',
    type: scale === 'macrosphere' ? (threeSpheres ? 'belief' : 'policy') : scale === 'exosphere' ? 'institution' : 'person',
    scale,
    evidence: '',
    claimState: 'research lead',
    ...(scale === 'micro' ? { focalParticipation: 'direct', settingNodeIds: [] } : {}),
  };
}

function MapStage({ project, presentationRef, update, toast, captureImportScope, logPrototype, saveState, stageAnnotationDraft, commitAnnotationDrafts, flushSave, onRequestRestart, onReview, panel = null, onPanelMode, toolbarStart = null, toolbarHost = null, notebook = null, highlight = null, onHighlight }) {
  // Every work panel can collapse without changing the current stage or map selection.
  const panelMode = panel?.mode ?? 'inspector';
  const panelContent = Boolean(panel) && panelMode !== 'inspector';
  const [selection, setSelection] = useState(null);
  const [traceHistory, setTraceHistory] = useState([]);
  const [layoutHistory, setLayoutHistory] = useState({ past: [], future: [] });
  const connectionIndex = useMemo(() => indexMapConnections(project.graph), [project.graph]);
  const [focus, setFocus] = useState(null);
  const [focusPage, setFocusPage] = useState(0);
  const [visibleScale, setVisibleScale] = useState(notebook?.simple ? 'all' : project.activeScale);
  const [presentation, setPresentation] = useState('canvas');
  const [showRemoved, setShowRemoved] = useState(false);
  const [inspectorTab, setInspectorTab] = useState('map');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsedPanel, setCollapsedPanel] = useState(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [notebookNavigationHost, setNotebookNavigationHost] = useState(null);
  const [workspaceNavigationRoot] = useState(() => document.createElement('div'));
  const floatingControlsRef = useRef(null);
  useEffect(() => { if (panelMode === 'memo') setToolsOpen(false); }, [panelMode]);
  const layoutRef = useRef(null);
  const sidebarSize = useSidebarSize(layoutRef);
  useEffect(() => { setCollapsedPanel(null); }, [panelMode, project.activeScale]);
  const highlightNodeIds = useMemo(() => new Set(highlight?.nodeIds || []), [highlight]);
  const highlightEdgeIds = useMemo(() => new Set(highlight?.edgeIds || []), [highlight]);
  const highlightActive = highlightNodeIds.size > 0 || highlightEdgeIds.size > 0;
  const [phoneViewport, setPhoneViewport] = useState(null);
  const [mapViewport, setMapViewport] = useState(null);
  const [ringExpansion, setRingExpansion] = useState(1);
  const [automaticPositions, setAutomaticPositions] = useState(null);
  const [layoutMeasurementRevision, setLayoutMeasurementRevision] = useState(0);
  const [legendOpen, setLegendOpen] = useState(false);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const sheetOpen = notebook ? (!notebook.simple || notebook.open) && !fullscreen : panelContent ? collapsedPanel !== panelMode : drawerOpen;
  useEffect(() => { if (notebook?.open) setFullscreen(false); }, [notebook?.open]);
  const [announcement, setAnnouncementState] = useState({ message: '', revision: 0 });
  const [addMode, setAddMode] = useState(null);
  const [selectedScope, setSelectedScope] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionSource, setConnectionSource] = useState(null);
  const [pendingNodePosition, setPendingNodePosition] = useState(null);
  const connectionScale = notebook?.simple && project.activeScale === 'micro' ? 'meso' : project.activeScale;
  // Drawing never waits on a memo. Once the map has a node, students can
  // connect, add and remove at every step, including while a memo edit is
  // still unsubmitted; only Continue waits for the submission.
  const drawingReady = notebook?.simple ? Boolean(notebook.memoReady || project.graph.nodes.some(isLiveMapItem)) : project.activeScale !== 'micro';
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [phoneOverviewCommittedScope, setPhoneOverviewCommittedScope] = useState('');
  const [phoneEcologyCommittedScope, setPhoneEcologyCommittedScope] = useState('');
  const [newNode, setNewNode] = useState(() => blankManualNode(project.activeScale, notebook?.simple));
  const relationshipDraft = useRelationshipDraft(project, toast);
  const newEdge = relationshipDraft.draft || { source: '', target: '', verb: '', evidence: '', relationshipProcess: { direction: 'not yet known' } };
  const setNewEdge = relationshipDraft.setDraft;
  const viewHistory = useWorkspaceViewHistory({
    scopeKey: project.id,
    enabled: Boolean(notebook?.simple),
    view: {
      scale: project.activeScale, stage: project.stage,
      kind: !notebook?.open ? 'map' : toolsOpen ? 'tools' : panelMode === 'memo' ? 'memo' : panelContent ? 'notebook'
        : addMode === 'connected-node' ? 'connected-node' : addMode === 'node' ? 'node-form' : addMode === 'edge' ? 'relationship-form' : selection ? 'item' : 'notebook',
      selection,
    },
  });
  const canvasWrapRef = useRef(null);
  const legendTriggerRef = useRef(null);
  const legendFocusTarget = useRef('button');
  const legendOpener = useRef(null);
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
  const phoneViewBox = useCanvasWindow(canvasWrapRef, (phoneLayout || Boolean(notebook)) && presentation === 'canvas');
  const phoneFitHeight = Math.max(241, phoneViewBox.height - (notebook ? 96 : fullscreen ? 280 : 200));
  const legacyPhoneDrawer = phoneLayout && drawerOpen && !notebook;
  const previousPhoneLayoutRef = useRef(phoneLayout);
  const desktopEcologyViewRef = useRef(null);
  const setAnnouncement = useCallback((message) => {
    setAnnouncementState((current) => ({ message, revision: current.revision + 1 }));
  }, []);
  useEffect(() => {
    setSelection(null);
    setVisibleScale(notebook?.simple ? 'all' : project.activeScale);
    setTraceHistory([]);
    setLayoutHistory({ past: [], future: [] });
    setFocus(null);
    setFocusPage(0);
    setDrawerOpen(false);
    if (notebook?.simple) setToolsOpen(false);
    setRingExpansion(1);
  }, [project.activeScale]);
  useEffect(() => {
    setAddMode(null);
    setConnecting(false);
    setConnectionSource(null);
    setPendingNodePosition(null);
    setCreateMenuOpen(false);
    setNewNode(blankManualNode(project.activeScale, notebook?.simple));
  }, [project.activeScale]);
  useEffect(() => {
    const destination = viewHistory.pendingView;
    if (!destination || !notebook?.simple) return;
    if (project.activeScale !== destination.scale || project.stage !== destination.stage) {
      notebook.onRestoreView?.(destination);
      return;
    }
    // Run after the scale-reset effects so returning across systems restores
    // the actual visited panel rather than an intermediate empty selection.
    const item = destination.selection;
    setSelection(item);
    setInspectorTab(item?.kind === 'edge' ? 'relationships' : item ? 'node' : 'map');
    setToolsOpen(destination.kind === 'tools');
    setAddMode(destination.kind === 'connected-node' ? 'connected-node' : destination.kind === 'node-form' ? 'node' : destination.kind === 'relationship-form' ? 'edge' : null);
    setConnecting(false);
    setConnectionSource(['connected-node', 'relationship-form'].includes(destination.kind) ? relationshipDraft.draft?.source || null : null);
    setFocus(null); setSelectedScope(null);
    setCollapsedPanel(null); setDrawerOpen(destination.kind !== 'map');
    notebook.onChange(destination.kind !== 'map');
    onPanelMode?.(destination.kind === 'memo' ? 'memo' : ['item', 'node-form', 'relationship-form', 'connected-node'].includes(destination.kind) ? 'inspector' : 'review');
  }, [viewHistory.pendingView, project.activeScale, project.stage]);
  const goBackView = () => {
    if (flushSave && !flushSave()) return;
    viewHistory.goBack(destination => {
      const selected = destination.selection;
      const exists = !selected || project.graph[selected.kind === 'node' ? 'nodes' : 'edges'].some(item => item.id === selected.id);
      const sameScaleDraft = destination.scale === project.activeScale && relationshipDraft.draft;
      const connectedNodeExists = sameScaleDraft && pendingNodePosition
        && project.graph.nodes.some(node => node.id === sameScaleDraft.source && isLiveMapItem(node));
      return exists && (destination.kind !== 'relationship-form' || sameScaleDraft)
        && (destination.kind !== 'connected-node' || connectedNodeExists)
        ? destination : { ...destination, kind: 'notebook', selection: null };
    });
  };
  const hasLegacyMacroNodes = project.graph.nodes.some(node => node.scale === 'macrosphere' && isLiveMapItem(node));
  const ecologyLayers = useMemo(() => SCALE_ORDER.filter(scale => project.releasedScales.includes(scale) && (scale !== 'macrosphere' || hasLegacyMacroNodes)), [project.releasedScales, hasLegacyMacroNodes]);
  // Text can resize its own card, but does not request a new arrangement or
  // camera fit. Keep layout measurements until topology, positions, fonts, or
  // the responsive breakpoint change. Arrange/Fit still use current wording.
  const layoutGeometryKey = JSON.stringify([phoneLayout, fontRevision, layoutMeasurementRevision,
    project.graph.nodes.map(node => [node.id, node.scale, node.type, node.color, node.x, node.y, node.status === 'rejected' || node.claimState === 'retired']),
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
    const boundary = !notebook && ['micro', 'meso'].includes(layer) ? sharedMicroBoundary(nodes, project.graph.edges, phoneLayout) : null;
    const readingBounds = notebook ? Object.values(studentMapBoundaries(nodes, new Map(nodes.map(node => [node.id, mapNodeGeometry(node.label, phoneLayout)])))).filter(Boolean) : [];
    return fitViewport(nodes, notebook || phoneLayout ? phoneFitHeight : 420, phoneLayout,
      [...extraBounds, ...readingBounds, ...(boundary ? [boundary] : [])], VIEWPORT_LIMITS.minZoom);
  }, [Boolean(notebook), phoneFitHeight, phoneLayout, project.graph.edges, visibleScale]);
  const hasRemovedItems = project.graph.nodes.some((node) => node.claimState === 'retired') || project.graph.edges.some((edge) => edge.claimState === 'retired');
  const visibleScaleSet = useMemo(() => new Set([...cumulativeScales(visibleScale, project.releasedScales),
    ...(notebook?.simple && visibleScale === 'all' ? project.graph.edges.map(edge => edge.scale) : [])]), [project.releasedScales, project.graph.edges, notebook?.simple, visibleScale]);
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
    return node.scale !== 'meso' && scaleMatches && (showRemoved || (node.status !== 'rejected' && node.claimState !== 'retired'));
  }), [project.graph.nodes, visibleScaleSet, scaleEdgeIds, scopeMemberIds, showRemoved]);
  const scaleNodeIds = useMemo(() => new Set(scaleNodes.map((node) => node.id)), [scaleNodes]);
  // Older maps can contain Micro relationships. Retain their identity and
  // show them with the cumulative relationships from Meso onward.
  const scaleEdges = useMemo(() => project.graph.edges.filter((edge) => visibleScale !== 'micro' && visibleScaleSet.has(edge.scale)
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
  const manualPlacementKey = JSON.stringify(project.layout || {});
  const pinnedNodeIds = new Set(project.layout?.manualNodeIds || (project.layout?.phoneOverview === 'preserve' ? visibleLayoutNodes.map(node => node.id) : []));
  const canvasAspect = GRAPH_WIDTH / Math.max(240,phoneViewBox.height);
  const readableLayoutKey = `${Boolean(notebook)}:${phoneLayout}:${canvasAspect.toFixed(1)}:${manualPlacementKey}:${visibleLayoutNodes.map(node => `${node.id}:${node.scale}${pinnedNodeIds.has(node.id) ? `:${node.x}:${node.y}` : ''}`).join('|')}`;
  const readableTopologyKey = JSON.stringify([layoutGraph.edges.map(edge=>[edge.id,edge.source,edge.target,edge.relationshipIds]),visibleLayoutNodes.map(node=>[node.id,node.type,node.color])]);
  const readablePositions = useMemo(() => notebook ? studentReadingPositions(visibleLayoutNodes, layoutGraph.edges, {...project.layout,phone:phoneLayout,aspectRatio:canvasAspect}) : null,
    // Text and annotation edits retain the current placement. New topology,
    // an explicit arrangement or a deliberate drag can establish a new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readableLayoutKey,readableTopologyKey]);
  const displayedNodes = useMemo(() => visibleNodes.map((node) => ({
    ...node,
    ...(automaticPositions?.get(node.id) || {}),
    ...(phoneOverviewPositions?.get(node.id) || {}),
    ...(phoneEcologyPositions?.get(node.id) || {}),
    ...(focusedEcologyPositions?.get(node.id) || {}),
    ...(phoneRelationshipPositions?.get(node.id) || {}),
    ...(innerMap && !phoneLayout && !focusActive ? { x: node.x, y: node.y } : {}),
    ...(readablePositions?.get(node.id) || {}),
    visualDimmed: !notebook && (highlightActive ? !highlightNodeIds.has(node.id) : !phoneLayout && focusActive && !focusedNodeIds.has(node.id)),
  })), [readablePositions, innerMap, automaticPositions, focusedEcologyPositions, highlightActive, highlightNodeIds, phoneLayout, focusActive, focusedNodeIds, phoneEcologyPositions, phoneOverviewPositions, phoneRelationshipPositions, visibleNodes]);
  useLayoutEffect(()=>{
    if(!presentationRef || presentation!=='canvas')return;
    presentationRef.current={key:mapPresentationKey(project),phone:phoneLayout,aspectRatio:canvasAspect,positions:new Map(displayedNodes.map(n=>[n.id,{x:n.x,y:n.y}]))};
  },[presentationRef,project.graph,project.layout,project.id,presentation,phoneLayout,canvasAspect,displayedNodes]);
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
        showLabel: notebook ? true : focusActive ? focusedEdgeIds.has(edge.id) : visibleScale !== 'all',
        visualMuted: !notebook && overview,
        visualDimmed: !notebook && (highlightActive ? !highlightEdgeIds.has(edge.id) && !(highlightNodeIds.has(edge.source) && highlightNodeIds.has(edge.target)) : !phoneLayout && focusActive && !focusedEdgeIds.has(edge.id)),
        layerEdgeSlot: group.findIndex((candidate) => candidate.id === edge.id),
        layerEdgeCount: group.length,
      };
    });
  }, [phoneLayout, focusActive, scaleEdges, focusedEdgeIds, visibleScale, highlightActive, highlightEdgeIds, highlightNodeIds]);
  const microBoundary = useMemo(() => innerMap ? sharedMicroBoundary(displayedNodes, project.graph.edges, phoneLayout) : null, [innerMap, displayedNodes, project.graph.edges, phoneLayout]);
  const visibleRelationshipBounds = useMemo(() => {
    const positions = new Map(displayedNodes.map((node) => [node.id, { x: node.x, y: node.y }]));
    if (notebook) {
      const geometry = new Map(displayedNodes.map(node=>[node.id,mapNodeGeometry(node.label,phoneLayout)]));
      const bounds = Object.values(studentMapBoundaries(displayedNodes,geometry)).filter(Boolean).map(b=>({...b,top:b.top-12}));
      const group = visibleEdges.find(edge=>edge.relationshipIds?.length && (selection?.kind==='edge' ? edge.id===selection.id : edge.source===selection?.id));
      const overview=notebook.simple && !selection;
      const ids = new Set(overview ? visibleEdges.map(e=>e.id) : selection?.kind==='edge' ? [selection.id] : visibleEdges.filter(e=>e.source===selection?.id || e.target===selection?.id).map(e=>e.id));
      if(group){ids.add(group.id);group.relationshipIds.forEach(id=>ids.add(id));}
      const routes=readingConnectionLayout(visibleEdges,displayedNodes,positions,geometry,readingLabelSizes(visibleEdges,ids,phoneLayout),
        new Set(visibleEdges.filter(e=>e.relationshipIds?.length && (overview || group?.id===e.id)).map(e=>e.id)),
        captionObstacles(studentMapBoundaries(displayedNodes,geometry)));
      for(const [id,rect] of routes.bounds)if(ids.has(id))bounds.push(rect);
      for(const route of [...routes.paths.values(),...Array.from(routes.groups.values()).flat().map(branch=>branch.route).filter(Boolean)]) {
        for(const {x,y} of route.points)bounds.push({left:x-5,top:y-5,right:x+5,bottom:y+5});
      }
      return bounds;
    }
    const bounds = focusedEcologyCalloutBounds(visibleEdges, displayedNodes, positions, phoneLayout);
    if (microBoundary && !notebook) bounds.push(microBoundary);
    if (mapMode !== 'ecology' || phoneRelationshipDetail || focusedEcologyDetail) return bounds;
    const retained = retainedEcologyBoundaries(displayedNodes, visibleEdges, phoneLayout, sharedEcologyBands);
    if (retained) return [...bounds, ...Object.values(retained).filter(Boolean).map(boundary => ({ ...boundary, top: boundary.top - 8 }))];
    const occupied = displayedNodes.map((node) => ecologyCardBounds(
      positions.get(node.id),
      mapNodeGeometry(node.label, phoneLayout),
      8,
    ));
    const labelLayout = betweenEndpointCalloutLayout([...visibleEdges.filter(edge => edge.showLabel !== false), ...storedScopeTraces(displayedNodes)], displayedNodes, positions, phoneLayout);
    occupied.push(...labelLayout.bounds.values());
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
  }, [displayedNodes, ecologyLayers, focusedEcologyDetail, fontRevision, fullscreen, mapMode, microBoundary, phoneLayout, phoneRelationshipDetail, sharedEcologyBands, visibleEdges, visibleScale, notebook, selection?.id]);
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
  const automaticCameraContext = `${ecologyGeometryKey}:${visibleScale}:${phoneLayout}:${presentation}:${fullscreen}:${Math.round(phoneViewBox.height)}:${typeof window === 'undefined' ? '' : window.innerWidth}`;
  const automaticCameraKey = `${automaticCameraContext}:${phoneFitHeight}`;
  const userCameraRef = useRef({ context: '', manual: false });
  const preserveCamera = useCallback(() => {
    userCameraRef.current = {context: automaticCameraContext, manual: true};
  }, [automaticCameraContext]);
  useEffect(() => {
    if (!notebook || presentation !== 'canvas') return;
    if (userCameraRef.current.context !== automaticCameraContext) userCameraRef.current = {context: automaticCameraContext, manual: false};
    if (userCameraRef.current.manual) return;
    setMapViewport(fitViewport(displayedNodes, phoneFitHeight, phoneLayout, visibleRelationshipBounds, VIEWPORT_LIMITS.minZoom));
    // Fit changed topology or canvas dimensions. Text edits retain the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automaticCameraKey]);

  useEffect(() => {
    if (notebook || !phoneLayout || presentation !== 'canvas') return;
    setMapViewport(fitViewport(displayedNodes, phoneFitHeight, true, visibleRelationshipBounds, VIEWPORT_LIMITS.minZoom));
    // Only a canvas resize should reset the transient fit, not text edits or
    // pointer updates. The saved viewport is unchanged until user interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phoneFitHeight, phoneLayout, presentation]);
  useEffect(() => {
    if (notebook) return;
    const viewGeometryKey = `${ecologyGeometryKey}:${visibleScale}`;
    if (initialLayoutCheckedRef.current === viewGeometryKey) return;
    initialLayoutCheckedRef.current = viewGeometryKey;
    // Historical Meso records stay in the list, but are not canvas nodes. A
    // distant hidden record must not shrink the fit of the visible map.
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
    const nextScaleEdges = project.graph.edges.filter((edge) => visibleScale !== 'micro' && edge.status !== 'rejected'
      && edge.claimState !== 'retired'
      && cumulativeScales(visibleScale, project.releasedScales).includes(edge.scale));
    const endpointIds = new Set(nextScaleEdges.flatMap((edge) => [edge.source, edge.target]));
    if (['meso', 'macrosphere'].includes(visibleScale) || visibleScale === 'all') {
      currentNodes.filter((node) => ['meso', 'macrosphere'].includes(node.scale)
        && (visibleScale === 'all' || node.scale === visibleScale))
        .forEach((node) => (node.scopeNodeIds || []).forEach((memberId) => endpointIds.add(memberId)));
    }
    let nextVisibleNodes = positionedNodes.filter(node => cumulativeScales(visibleScale, project.releasedScales).includes(node.scale) || endpointIds.has(node.id));
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
      nextVisibleNodes = positionedNodes.filter(node => cumulativeScales(visibleScale, project.releasedScales).includes(node.scale) || endpointIds.has(node.id));
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
    if (notebook) return;
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
    const frame = window.requestAnimationFrame(() => document.querySelector('#map-key-panel '+legendFocusTarget.current)?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [legendOpen]);
  const selectedNode = selection?.kind === 'node' ? project.graph.nodes.find((node) => node.id === selection.id) : null;
  const selectedEdge = selection?.kind === 'edge' ? project.graph.edges.find((edge) => edge.id === selection.id) : null;
  const inspectedItem = !addMode && (inspectorTab === 'node' ? selectedNode : inspectorTab === 'relationships' ? selectedEdge : null);
  // An empty item inspector is not a workspace: return to the current notebook.
  useEffect(() => {
    if (!viewHistory.pendingView && notebook?.simple && notebook.open && panelMode === 'inspector' && !selection && !addMode && !connecting && !relationshipDraft.draft) onPanelMode?.('review');
  }, [viewHistory.pendingView, notebook?.simple, notebook?.open, panelMode, selection, addMode, connecting, relationshipDraft.draft, onPanelMode]);
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
      // Opening the editor must not steal focus after the student has already
      // started typing in it, including on a short phone panel.
      if (inspector?.contains(document.activeElement) && document.activeElement.matches('input, textarea, select, [contenteditable="true"]')) return;
      ((notebook ? inspector?.querySelector('.inspector-done') : inspector?.querySelector('[role="tab"][aria-selected="true"]'))
        || inspector?.querySelector('button, input, select, textarea'))?.focus({ preventScroll: true });
      const scroll = inspector?.querySelector('.inspector__scroll');
      if (scroll) scroll.scrollTop = 0;
    });
  }, []);
  // Notebook navigation preserves the stage record and opens the matching task.
  const changePanel = (mode) => {
    setToolsOpen(false);
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
    setConnecting(false); setConnectionSource(null); setPendingNodePosition(null); setAddMode(null); setFocus(null);
    setSelection(source ? { kind: 'node', id: source.id } : null); setInspectorTab('node');
    setDrawerOpen(Boolean(notebook?.simple)); notebook?.onChange(Boolean(notebook?.simple));
    if (notebook?.simple) relationshipDraft.discard();
    setAnnouncement(notebook?.simple ? 'Connection cancelled.' : 'Relationship draft saved.');
    const focusBeforeCancel = document.activeElement;
    window.requestAnimationFrame(() => {
      if (document.activeElement !== focusBeforeCancel && document.activeElement !== document.body) return;
      const nodes = canvasWrapRef.current?.querySelectorAll('[data-graph-id]') || [];
      ([...nodes].find(node => node.getAttribute('data-graph-id') === source?.id) || canvasWrapRef.current?.querySelector('.graph-canvas'))?.focus({ preventScroll: true });
    });
  }, [connectionSource, project.graph.nodes, notebook?.onChange, notebook?.simple, relationshipDraft.discard, setAnnouncement]);
  useEffect(() => {
    const sourceId = connectionSource || relationshipDraft.draft?.source;
    if ((!connecting && !pendingNodePosition && addMode !== 'edge') || !sourceId || project.graph.nodes.some(node => node.id === sourceId && isLiveMapItem(node))) return;
    relationshipDraft.discard();
    setConnecting(false); setConnectionSource(null); setPendingNodePosition(null); setAddMode(null); setFocus(null);
    const removedSource = project.graph.nodes.find(node => node.id === sourceId);
    setSelection(notebook?.simple && removedSource ? { kind: 'node', id: sourceId } : null);
    setInspectorTab(notebook?.simple && removedSource ? 'node' : 'map');
    setDrawerOpen(Boolean(notebook?.simple && removedSource));
    setAnnouncement('Connection cancelled because its starting item was removed.');
  }, [connecting, connectionSource, pendingNodePosition, addMode, project.graph.nodes, relationshipDraft.draft?.source, relationshipDraft.discard, setAnnouncement]);
  const startConnection = (sourceId, direct = false) => {
    if (!drawingReady || !project.instructor.allowResearchLeads) return;
    const available = project.graph.nodes.filter(node => canConnectAtScale(connectionScale, node) && isLiveMapItem(node));
    const source = available.find(node => node.id === sourceId);
    if (!source || !notebook?.simple && available.length < 2) return;
    if (relationshipDraft.draft && !direct) { setAddMode('edge'); changePanel('inspector'); return; }
    const started = relationshipDraft.start(source.id);
    if (direct) { const { relationshipIds, ...plain } = started; setNewEdge({ ...plain, source: source.id, target: '', verb: '', evidence: '' }); }
    setPendingNodePosition(null);
    // One gesture at every step: after Connect from, click the item the
    // relationship reaches. An Exo or Macro node can reach a node or a local
    // relationship line; empty canvas starts a new connected node.
    setVisibleScale(notebook?.simple ? 'all' : project.activeScale); setPresentation('canvas'); setConnecting(true);
    setConnectionSource(source.id); setSelection({ kind: 'node', id: source.id }); setFocus(null); setAddMode(null);
    setDrawerOpen(Boolean(notebook?.simple)); notebook?.onChange(Boolean(notebook?.simple)); setToolsOpen(false);
    if (notebook?.simple) { setInspectorTab('node'); onPanelMode?.('inspector', { preserveNotebook: true }); }
    setAnnouncement(`${source.label} selected. ${notebook?.simple ? connectTargetHint(source) : 'Choose the ending item.'}`);
    const focusBeforeConnection = document.activeElement;
    window.requestAnimationFrame(() => {
      // Keep a target or field the student focused before this frame ran.
      if (document.activeElement !== focusBeforeConnection && document.activeElement !== document.body) return;
      const nodes = canvasWrapRef.current?.querySelectorAll('[data-graph-id]') || [];
      [...nodes].find(node => node.getAttribute('data-graph-id') === source.id)?.focus({ preventScroll: true });
    });
  };
  const addBlank = (position) => {
    if (!notebook?.simple || !drawingReady || connecting || !project.instructor.allowResearchLeads || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return;
    const level = position.scale && project.releasedScales.includes(position.scale) && (isNodeReviewScale(position.scale) || position.scale === 'macrosphere') ? position.scale : project.activeScale;
    setNewNode(blankManualNode(level, true));
    setPendingNodePosition({ x: clamp(Math.round(position.x), PROJECT_LIMITS.coordinateMin, PROJECT_LIMITS.coordinateMax),
      y: clamp(Math.round(position.y), PROJECT_LIMITS.coordinateMin, PROJECT_LIMITS.coordinateMax) });
    setConnectionSource(null); setSelection(null); setFocus(null); setToolsOpen(false);
    setAddMode('node'); setInspectorTab('node');
    changePanel('inspector');
    setAnnouncement(`New ${SCALES[nodeScaleFor(level)]?.label || level} node. Name it, then choose Add to map.`);
  };
  const connectBlank = (position) => {
    const source = project.graph.nodes.find(node => node.id === connectionSource && isLiveMapItem(node));
    if (!notebook?.simple || !drawingReady || !connecting || !source || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return;
    const { relationshipIds, ...plain } = newEdge;
    setNewEdge({ ...plain, source: source.id, target: '' });
    setNewNode(blankManualNode(source.scale, true));
    setPendingNodePosition({ x: clamp(Math.round(position.x), PROJECT_LIMITS.coordinateMin, PROJECT_LIMITS.coordinateMax),
      y: clamp(Math.round(position.y), PROJECT_LIMITS.coordinateMin, PROJECT_LIMITS.coordinateMax) });
    setConnecting(false); setSelection(null); setFocus(null); setToolsOpen(false);
    setAddMode('connected-node'); setInspectorTab('relationships');
    changePanel('inspector');
    setAnnouncement('Name the new node and its relationship. Nothing is added until you save.');
  };
  const selectItem = useCallback((kind, id, openInspector = true, tap = null) => {
    if (openInspector && tap?.pointerType === 'touch') consumedCanvasTapRef.current = { ...tap, id, completedConnection: connecting };
    if (connecting) {
      // Pointer-down and arrow-key movement keep the chosen source. Only a
      // completed tap or explicit keyboard activation chooses its target.
      if (!openInspector || !notebook?.simple && project.activeScale === 'micro') return;
      const source = project.graph.nodes.find(item => item.id === connectionSource && canConnectAtScale(connectionScale, item) && isLiveMapItem(item));
      if (kind === 'edge') {
        // An Exo or Macro node attaches to the local relationship line itself.
        const edge = project.graph.edges.find(item => item.id === id);
        if (!source || !notebook?.simple || !['exosphere', 'macrosphere'].includes(source.scale) || !isPart2(project.activeScale)
          || !edge || edge.scale !== 'meso' || edge.relationshipIds?.length || !isLiveMapItem(edge)) { setAnnouncement('Choose a node, or a local relationship line, to connect to.'); return; }
        setNewEdge({ ...newEdge, source: connectionSource, target: edge.source, relationshipIds: [edge.id] });
        setConnecting(false); setFocus(null); setSelection(null);
        setAddMode('edge'); setInspectorTab('relationships'); setDrawerOpen(true);
        onPanelMode?.('inspector', { preserveNotebook: true }); notebook.onChange(true); focusInspector();
        return;
      }
      if (kind !== 'node') return;
      const node = project.graph.nodes.find((item) => item.id === id);
      if (!source || !node || !canConnectAtScale(connectionScale, node) || !isLiveMapItem(node)) return;
      if (id === connectionSource) { setAnnouncement('Choose a different ending item.'); return; }
      setNewEdge({ ...newEdge, source: connectionSource, target: id });
      setConnecting(false); setFocus(null); setSelection(null);
      setAddMode('edge'); setInspectorTab('relationships'); setDrawerOpen(true);
      onPanelMode?.('inspector', { preserveNotebook: true }); if (notebook?.simple) notebook.onChange(true); if (!notebook || notebook.open || notebook.simple) focusInspector();
      return;
    }
    if (openInspector && !inspectorRef.current?.contains(document.activeElement)) selectionTriggerRef.current = document.activeElement;
    setTraceHistory([]);
    setAddMode(null);
    onHighlight?.(null);
    setSelectedScope(null);
    setSelection({ kind, id });
    setInspectorTab(kind === 'edge' ? 'relationships' : 'node');
    if (openInspector) {
      setToolsOpen(false);
      setFocus(notebook ? null : { kind, id });
      setFocusPage(0);
      setLegendOpen(false);
      setCreateMenuOpen(false);
      if (panelContent) onPanelMode?.('inspector', { preserveNotebook: true });
      setDrawerOpen(true);
      if (notebook?.simple) notebook.onChange(true);
      if (!notebook || notebook.open || notebook.simple) focusInspector();
    }
  }, [connecting, connectionSource, connectionScale, project.activeScale, project.graph.nodes, visibleScale, phoneLayout, focusInspector, panelContent, onPanelMode, onHighlight, notebook?.open, notebook?.simple, notebook?.onChange, newEdge]);
  const followScope = (source, target) => {
    const previous = selection ? [...traceHistory, {selection, visibleScale, focusPage, presentation}].slice(-12) : [];
    if (!scaleNodeIds.has(source) || !scaleNodeIds.has(target)) changeVisibleScale('all');
    setSelectedScope({ source, target }); setSelection({ kind: 'node', id: source }); setFocus(notebook ? null : { kind: 'node', id: source });
    setTraceHistory(previous);
    setInspectorTab('node'); onHighlight?.({ nodeIds: [source,target], edgeIds: [] });
    const pair = displayedNodes.filter(node => node.id === source || node.id === target);
    preserveCamera();
    setMapViewport(fitViewport(pair, phoneLayout ? phoneFitHeight : 420, phoneLayout));
    setAnnouncement('Stored scope highlighted. No direct relationship was added.');
  };
  const closeInspector = useCallback(() => {
    if (connecting || notebook?.simple && ['edge', 'connected-node'].includes(addMode)) { cancelConnection(); return; }
    if (notebook?.simple) {
      setSelection(null); setFocus(null); setAddMode(null); setToolsOpen(false);
      setCollapsedPanel(null); setDrawerOpen(true); notebook.onChange(true);
      onPanelMode?.('review');
      return;
    }
    setCollapsedPanel(panelMode);
    notebook?.onChange(false);
    setDrawerOpen(false);
    window.requestAnimationFrame(() => {
      const targets = canvasWrapRef.current?.querySelectorAll('[data-graph-id]') || [];
      const target = selection?.id ? [...targets].find((element) => element.getAttribute('data-graph-id') === selection.id) : null;
      const trigger = selectionTriggerRef.current;
      (target || (trigger?.isConnected ? trigger : null) || canvasWrapRef.current?.querySelector('.graph-canvas'))?.focus();
    });
  }, [selection, panelMode, notebook?.onChange, notebook?.simple, onPanelMode, connecting, addMode, connectionSource, cancelConnection]);
  const showFullMap = useCallback(() => {
    phoneOverviewViewportKeyRef.current = '';
    onHighlight?.(null);
    setSelectedScope(null);
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
    if (notebook) {
      const positions = scaleNodes.every(node=>readablePositions?.has(node.id)) ? readablePositions : studentReadingPositions(scaleNodes, scaleEdges, {...project.layout,phone:phoneLayout,aspectRatio:canvasAspect});
      nodes = scaleNodes.map(node => ({ ...node, ...positions.get(node.id) }));
    }
    setRingExpansion(1);
    const fullBounds = notebook ? [] : focusedEcologyCalloutBounds(scaleEdges, nodes, new Map(nodes.map(node => [node.id, { x: node.x, y: node.y }])), phoneLayout);
    setMapViewport(readingViewport(nodes.length ? nodes : project.graph.nodes, visibleScale, fullBounds));
    setAnnouncement('Full map shown.');
    window.requestAnimationFrame(() => canvasWrapRef.current?.querySelector('.graph-canvas')?.focus());
  }, [automaticPositions, innerMap, interactionEcologyBands, Boolean(notebook), phoneLayout, project.graph.nodes, project.layout, readingViewport, scaleEdges, scaleNodes, setAnnouncement, visibleRelationshipBounds, visibleScale, canvasAspect, readablePositions]);
  const changeVisibleScale = (nextScale) => {
    phoneOverviewViewportKeyRef.current = '';
    setConnecting(false); setConnectionSource(null); setAddMode(null);
    setTraceHistory([]);
    const nextEdges = project.graph.edges.filter((edge) => nextScale !== 'micro' && edge.status !== 'rejected'
      && edge.claimState !== 'retired'
      && cumulativeScales(nextScale, project.releasedScales).includes(edge.scale));
    const endpointIds = new Set(nextEdges.flatMap((edge) => [edge.source, edge.target]));
    if (['meso', 'macrosphere'].includes(nextScale) || nextScale === 'all') {
      project.graph.nodes.filter((node) => ['meso', 'macrosphere'].includes(node.scale)
        && (nextScale === 'all' || node.scale === nextScale)
        && node.status !== 'rejected' && node.claimState !== 'retired')
        .forEach((node) => (node.scopeNodeIds || []).forEach((memberId) => endpointIds.add(memberId)));
    }
    let nextNodes = project.graph.nodes.filter((node) => node.scale !== 'meso' && node.status !== 'rejected'
      && node.claimState !== 'retired'
      && (cumulativeScales(nextScale, project.releasedScales).includes(node.scale) || endpointIds.has(node.id)))
      .map((node) => ({ ...node, ...(!['micro', 'meso'].includes(nextScale) ? automaticPositions?.get(node.id) || {} : {}) }));
    if (phoneLayout && nextNodes.length) {
      const projection = ['micro', 'meso'].includes(nextScale)
        ? phoneOverviewProjection(nextNodes, project.layout)
        : arrangedEcologyPositions(nextNodes, true, interactionEcologyBands);
      nextNodes = nextNodes.map(node => ({ ...node, ...(projection?.get(node.id) || {}) }));
    }
    if (notebook) {
      const positions = nextNodes.every(node=>readablePositions?.has(node.id)) ? readablePositions : studentReadingPositions(nextNodes, nextEdges, {...project.layout,phone:phoneLayout,aspectRatio:canvasAspect});
      nextNodes = nextNodes.map(node => ({ ...node, ...positions.get(node.id) }));
    }
    setVisibleScale(nextScale);
    setFocus(null);
    setFocusPage(0);
    setSelection(null);
    setInspectorTab('map');
    setDrawerOpen(false);
    setRingExpansion(1);
    const nextLabelBounds = notebook ? [] : focusedEcologyCalloutBounds(
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
    if (notebook && presentation === 'canvas' && !legacyMesoRecord) {
      const targets = kind === 'node' ? displayedNodes.filter(node => node.id === id)
        : displayedNodes.filter(node => node.id === item.source || node.id === item.target);
      if (targets.length) {
        preserveCamera();
        setMapViewport(fitViewport(targets, phoneLayout ? phoneFitHeight : 420, phoneLayout,
          kind === 'edge' ? focusedEcologyCalloutBounds([item], displayedNodes, new Map(displayedNodes.map(node => [node.id, node])), phoneLayout) : []));
      }
    }
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
      ...(readablePositions?.get(node.id) || {}),
    }])),
    layout: project.layout ? structuredClone(project.layout) : null,
    viewport: mapViewport || project.viewport,
  }), [project.graph.nodes, project.layout, project.viewport, automaticPositions, phoneOverviewPositions, phoneEcologyPositions, readablePositions, mapViewport]);
  const rememberLayout = useCallback(() => {
    const snapshot = snapshotLayout();
    setLayoutHistory((history) => ({ past: [...history.past, snapshot].slice(-30), future: [] }));
  }, [snapshotLayout]);
  const restoreLayout = (direction) => {
    const from = direction === 'undo' ? layoutHistory.past : layoutHistory.future;
    const snapshot = from.at(-1);
    if (!snapshot) return;
    preserveCamera();
    const current = snapshotLayout();
    setLayoutHistory(direction === 'undo'
      ? { past: from.slice(0, -1), future: [...layoutHistory.future, current] }
      : { past: [...layoutHistory.past, current], future: from.slice(0, -1) });
    update((draft) => {
      if (snapshot.layout) draft.layout = structuredClone(snapshot.layout);
      else delete draft.layout;
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
    preserveCamera();
    const displayedNodeIds = new Set(displayedNodes.map((node) => node.id));
    const displayedNode = displayedNodes.find((node) => node.id === id);
    const movementMode = notebook ? 'network' : mapMode === 'ecology' && retainedEcologyBoundaries(displayedNodes, visibleEdges, phoneLayout, interactionEcologyBands) ? 'network' : mapMode;
    const cardSafePosition = displayedNode
      ? relationshipSafeNodePosition(displayedNode, x, y, displayedNodes, visibleEdges, phoneLayout, movementMode, interactionEcologyBands, Boolean(notebook))
      : { x, y };
    const safePosition = notebook && displayedNode
      ? constrainStudentNodeMove(displayedNode, cardSafePosition, displayedNodes,
        new Map(displayedNodes.map(node => [node.id, mapNodeGeometry(node.label, phoneLayout)])), { autoFit: project.layout?.autoFit !== false })
      : cardSafePosition;
    rememberLayout();
    update((draft) => {
      if (phoneLayout && mapMode === 'network') draft.layout = { ...(draft.layout || {}), phoneOverview: 'preserve' };
      if (automaticPositions) draft.graph.nodes.forEach((node) => {
        const position = automaticPositions.get(node.id);
        if (position && displayedNodeIds.has(node.id)) Object.assign(node, position);
      });
      if (!notebook && phoneOverviewPositions) draft.graph.nodes.forEach((node) => {
        const position = phoneOverviewPositions.get(node.id);
        if (position) Object.assign(node, position);
      });
      if (!notebook && phoneEcologyPositions) draft.graph.nodes.forEach((node) => {
        const position = phoneEcologyPositions.get(node.id);
        if (position) Object.assign(node, position);
      });
      if (notebook && readablePositions) {
        draft.graph.nodes.forEach(node => { if (displayedNodeIds.has(node.id) && readablePositions.has(node.id)) Object.assign(node, readablePositions.get(node.id)); });
        draft.layout = { ...(draft.layout || {}), readingAspect: canvasAspect, manualNodeIds: [...new Set([...(draft.layout?.manualNodeIds || []), ...displayedNodeIds])] };
      }
      const node = draft.graph.nodes.find((item) => item.id === id);
      if (node) { node.x = safePosition.x; node.y = safePosition.y; }
      if (phoneOverviewPositions || phoneEcologyPositions) draft.viewport = mapViewport || fitViewport(displayedNodes, phoneFitHeight, true);
    });
    if (phoneOverviewPositions) setPhoneOverviewCommittedScope(phoneOverviewScope);
    if (phoneEcologyPositions) setPhoneEcologyCommittedScope(phoneEcologyScope);
    setAutomaticPositions(null);
    setLayoutMeasurementRevision(revision => revision + 1);
    logPrototype('node_moved', { keyboard: method === 'keyboard', pointer: method === 'pointer' });
  }, [preserveCamera, readablePositions, notebook, automaticPositions, displayedNodes, logPrototype, mapMode, mapViewport, phoneEcologyPositions, phoneEcologyScope, phoneLayout, phoneOverviewPositions, phoneOverviewScope, rememberLayout, interactionEcologyBands, update, visibleEdges, canvasAspect, project.layout?.autoFit]);
  const minimumInteractiveZoom = VIEWPORT_LIMITS.minZoom;
  const changeViewport = useCallback((next) => {
    preserveCamera();
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
      if (!notebook && phoneLayout && mapMode === 'network') draft.layout = { ...(draft.layout || {}), phoneOverview: 'preserve' };
      if (!notebook && phoneOverviewPositions) draft.graph.nodes.forEach((node) => {
        const position = phoneOverviewPositions.get(node.id);
        if (position) Object.assign(node, position);
      });
      if (!notebook && phoneEcologyPositions) draft.graph.nodes.forEach((node) => {
        const position = phoneEcologyPositions.get(node.id);
        if (position) Object.assign(node, position);
      });
      draft.viewport = bounded;
    });
    if (phoneOverviewPositions) setPhoneOverviewCommittedScope(phoneOverviewScope);
    if (phoneEcologyPositions) setPhoneEcologyCommittedScope(phoneEcologyScope);
    if (phoneOverviewPositions || phoneEcologyPositions) setAutomaticPositions(null);
    logPrototype('viewport_changed');
  }, [preserveCamera, Boolean(notebook), update, logPrototype, legacyPhoneDrawer, phoneLayout, mapMode, focusedEcologyPositions, minimumInteractiveZoom, phoneEcologyPositions, phoneEcologyScope, phoneOverviewPositions, phoneOverviewScope, phoneRelationshipPositions]);
  const zoomBy = (amount) => {
    const requested = legacyPhoneDrawer && phoneViewport ? phoneViewport : mapViewport || project.viewport;
    const current = requested;
    const zoom = clamp(current.zoom + amount, minimumInteractiveZoom, VIEWPORT_LIMITS.maxZoom);
    const mapCenterX = (GRAPH_WIDTH / 2 - current.panX) / current.zoom;
    const mapCenterY = (GRAPH_HEIGHT / 2 - current.panY) / current.zoom;
    if (!notebook && mapMode === 'ecology' && !(focusedEcologyPositions || phoneRelationshipPositions) && zoom !== current.zoom) {
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
    preserveCamera();
    const nodes = displayedNodes.length ? displayedNodes : project.graph.nodes;
    const detailLayout = focusedEcologyPositions || phoneRelationshipPositions;
    const nextViewport = fitViewport(
      nodes,
      notebook || phoneLayout ? phoneFitHeight : 420,
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
    preserveCamera();
    rememberLayout();
    const liveNodes = project.graph.nodes.filter((node) => node.scale !== 'meso' && (showRemoved || node.claimState !== 'retired'));
    const nodes = visibleScale === 'all' ? liveNodes : visibleNodes.length ? visibleNodes : liveNodes;
    const positions = notebook ? studentReadingPositions(nodes, project.graph.edges, {phone:phoneLayout,aspectRatio:canvasAspect}) : mapMode === 'ecology'
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
      if (phoneLayout && mapMode === 'network') draft.layout = { ...(draft.layout || {}), phoneOverview: 'preserve' };
      draft.graph.nodes.forEach((node) => {
        const position = positions.get(node.id);
        if (position) Object.assign(node, position);
      });
      draft.viewport = nextViewport;
      if (notebook) draft.layout = { ...(draft.layout || {}), readingAspect: canvasAspect, manualNodeIds: [...new Set([...(draft.layout?.manualNodeIds || []), ...positions.keys()])] };
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
    if (selectedEdge.relationshipIds && ['relationshipIds', 'source'].includes(field)) {
      const ids = field === 'relationshipIds' ? value : selectedEdge.relationshipIds;
      const first = project.graph.edges.find(edge => edge.id === ids[0]);
      const proposed = { ...selectedEdge, [field]: value, target: first?.source };
      const issue = relationshipGroupIssue(proposed, project.graph.nodes, project.graph.edges);
      if (issue) return toast(issue, 'error');
      update(draft => {
        const target = draft.graph.nodes.find(node => node.id === first.source);
        for (const collection of [draft.graph.edges, draft.candidates.edges]) {
          const edge = collection.find(item => item.id === selectedEdge.id);
          if (edge) Object.assign(edge, { source: proposed.source, sourceLabel: draft.graph.nodes.find(node => node.id === proposed.source)?.label, relationshipIds: [...ids], target: target.id, targetLabel: target.label, reviewDecision: 'added', claimState: 'student interpretation' });
        }
      }, 'relationship.group-edited', 'Updated local relationships under a macrosystem heading');
      return;
    }
    if (field === 'verb') {
      const issue = relationshipIssue(value, selectedEdge);
      if (issue) return toast(issue, 'error');
      update((draft) => reviseMapText(draft, 'graph', 'edges', selectedEdge.id, value));
      return;
    }
    if (field === 'relationshipProcess' && !SCALE_ORDER.includes(selectedEdge.scale)) return;
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
    if(removed && notebook?.simple) {
      if(selectedItemRemoved)return;
      const label=selectedNode?.label || selectedEdge?.verb || 'item';
      update(draft=>removeMapSelection(draft,selection.kind,selection.id),'map.item.removed','Remove '+label);
      toast('Removed from map. Undo restores the change.');
      return;
    }
    if (removed && selection.kind === 'edge') {
      const groups = project.graph.edges.filter(edge => isLiveMapItem(edge) && edge.relationshipIds?.includes(selection.id));
      if (groups.length) return toast(`Remove this relationship from its macrosystem groups first: ${groups.map(edge => edge.sourceLabel).join(', ')}.`, 'error');
    }
    if (removed && selection.kind === 'node') {
      const message = dependencyMessage(selection.id, `removing ${selectedNode?.label || 'this node'}`);
      if (message) return toast(message, 'error');
    }
    if (!removed && selection.kind === 'node' && containsRetiredSystemsLanguage(selectedNode?.label)) return toast('Rename this item with a direct, conventional name before returning it to the map.', 'error');
    if (!removed && selection.kind === 'node' && (selectedNode?.scale === 'meso' || selectedNode?.scale === 'macrosphere' && selectedNode.scopeNodeIds?.length)) {
      const memberById = new Map(project.graph.nodes.map((node) => [node.id, node]));
      const membersAreAvailable = (selectedNode.scopeNodeIds || []).length >= 2 && selectedNode.scopeNodeIds.every((id) => {
        const member = memberById.get(id);
        return member && member.status !== 'rejected' && member.claimState !== 'retired'
          && (selectedNode.scale !== 'meso' || (member.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(member.type)));
      });
      if (!membersAreAvailable) return toast(selectedNode.scale === 'meso' ? 'Restore at least two included Micro settings before returning this mesosystem to the map.' : 'Restore at least two affected map items before returning this Macro-level condition to the map.', 'error');
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
      const groupIssue = relationshipGroupIssue(edge, project.graph.nodes, project.graph.edges);
      if (groupIssue) return toast(groupIssue, 'error');
      const endpointById = new Map(project.graph.nodes.map((node) => [node.id, node]));
      const sourceNode = endpointById.get(edge.source);
      const targetNode = endpointById.get(edge.target);
      if (edge.scale === 'meso' && (sourceNode?.scale !== 'micro' || targetNode?.scale !== 'micro')) return toast('A Meso relationship must connect two Micro-level items.', 'error');
      if (!canConnectAtScale(edge.scale, sourceNode) || !canConnectAtScale(edge.scale, targetNode)) return toast('Restore available endpoint nodes first.', 'error');
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
    if (removed && !showRemoved && !notebook?.simple) {
      setSelection(null);
      setFocus(null);
      setFocusPage(0);
      setInspectorTab('map');
      setDrawerOpen(false);
      window.requestAnimationFrame(() => canvasWrapRef.current?.querySelector('.graph-canvas')?.focus());
    }
    toast(removed ? 'Item removed from the map.' : 'Item returned to the map.');
  };
  const commitAnnotations = () => commitAnnotationDrafts().changed;
  const relationshipNodes = project.graph.nodes.filter((node) => node.status !== 'rejected'
    && node.claimState !== 'retired'
    && canConnectAtScale(connectionScale, node)
    && (notebook?.simple || project.activeScale !== 'micro'));
  const mapMicroSettingOptions = project.graph.nodes
    .filter((node) => node.scale === 'micro' && MICRO_SETTING_NODE_TYPE_SET.has(node.type));
  const relationshipSourceNodes = newEdge.relationshipIds ? relationshipNodes.filter(node => ['exosphere', 'macrosphere'].includes(node.scale)) : relationshipNodes;
  const relationshipTargetNodes = relationshipNodes;
  const relationshipSource = relationshipSourceNodes.find((node) => node.id === newEdge.source);
  const relationshipTarget = relationshipTargetNodes.find((node) => node.id === newEdge.target && node.id !== relationshipSource?.id);
  const manualEdge = (source, target) => {
    const id = newEdge.id;
    return { ...newEdge, relationshipProcess: createRelationshipProcess({ ...newEdge.relationshipProcess, direction: newEdge.relationshipProcess?.direction || 'source to target' }),
      verb: newEdge.verb.trim(), id, source: source.id, target: target.id, sourceLabel: source.label, targetLabel: target.label,
      scale: connectionScale, status: 'confirmed', notes: '',
      claimEvidence: newEdge.evidence.trim() ? [createClaimEvidenceRecord({ sourcePassage: newEdge.evidence.trim() }, { ownerId: id, index: 0 })] : [],
      origin: 'student entry', reviewDecision: 'added', annotation: { id: stableId('annotation', `edge:${id}:relationship`), text: '' } };
  };
  const addNode = () => {
    if (!project.instructor.allowResearchLeads) return toast('Items needing more evidence are turned off for this project.', 'error');
    if (project.activeScale === 'meso' && newNode.scale !== 'micro') return toast('Add the missing person or setting to Micro, then connect it here.', 'error');
    if (project.graph.nodes.length >= PROJECT_LIMITS.nodes) return toast(`This map already contains the maximum ${PROJECT_LIMITS.nodes} nodes.`, 'error');
    if (!newNode.label.trim()) return toast('Name the node before adding it.', 'error');
    if (!isCanonicalMapElementLabel(newNode.label, newNode.scale)) return toast('Name one complete map item instead of a reference, time, modifier, action, or fragment.', 'error');
    if (containsRetiredSystemsLanguage(newNode.label)) return toast('Use a direct, conventional name for the map item.', 'error');
    if (!(notebook?.simple ? nodeClassificationTypes(newNode.scale).includes(newNode.type) : isNodeTypeAllowedAtScale(newNode.type, newNode.scale)) || !(isNodeReviewScale(newNode.scale) || notebook?.simple && newNode.scale === 'macrosphere')) return toast('Choose a type and level that belong together.', 'error');
    if (newNode.scale === 'micro' && !isDiscreteMicroNodeLabel(newNode.label)) return toast('Name one specific person, role, group, activity, object, or immediate setting.', 'error');
    if (project.instructor.evidenceRequired && !newNode.evidence.trim()) return toast('Add evidence or a question before adding the node.', 'error');
    const connected = addMode === 'connected-node';
    // A node placed by double-clicking the canvas keeps the chosen spot.
    const placed = Boolean(!connected && notebook?.simple && pendingNodePosition);
    if (connected && (!pendingNodePosition || !relationshipSource || !isLiveMapItem(relationshipSource))) return toast('Choose the starting node again.', 'error');
    if (connected && !newEdge.verb.trim()) return toast('Name the relationship before adding it.', 'error');
    if (connected && !canConnectAtScale(connectionScale, newNode)) return toast('Choose a node system available at this step.', 'error');
    if (connected && project.graph.edges.length >= PROJECT_LIMITS.edges) return toast(`This map already contains the maximum ${PROJECT_LIMITS.edges} relationships.`, 'error');
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
      if (connected) {
        const visibleIds = new Set(displayedNodes.map(node => node.id));
        draft.graph.nodes.forEach(node => { const position = readablePositions?.get(node.id); if (visibleIds.has(node.id) && position) Object.assign(node, position); });
        Object.assign(added, draft.layout?.autoFit === false ? pendingNodePosition
          : relationshipSafeNodePosition(added, pendingNodePosition.x, pendingNodePosition.y, displayedNodes, visibleEdges, phoneLayout, 'network', interactionEcologyBands, true));
        draft.layout = { ...draft.layout, readingAspect: canvasAspect, manualNodeIds: [...new Set([...(draft.layout?.manualNodeIds || []), ...visibleIds, id])] };
        draft.graph.edges.push(manualEdge(relationshipSource, added));
      } else if (placed) {
        const visibleIds = new Set(displayedNodes.map(node => node.id));
        draft.graph.nodes.forEach(node => { const position = readablePositions?.get(node.id); if (visibleIds.has(node.id) && position) Object.assign(node, position); });
        Object.assign(added, pendingNodePosition);
        draft.layout = { ...draft.layout, readingAspect: canvasAspect, manualNodeIds: [...new Set([...(draft.layout?.manualNodeIds || []), ...visibleIds, id])] };
      } else placeNewMapNodes([...draft.graph.nodes, added], new Set([id]));
      draft.graph.nodes.push(added);
    }, connected ? 'node.connected' : 'node.added', newNode.label.trim());
    if (connected || placed) { preserveCamera(); setAutomaticPositions(null); setPendingNodePosition(null); setConnectionSource(null); setConnecting(false); }
    setFocus(null);
    setVisibleScale(notebook?.simple ? 'all' : project.activeScale);
    setSelection({ kind: 'node', id });
    setInspectorTab('node');
    setNewNode(blankManualNode(project.activeScale, notebook?.simple));
    setAddMode(null);
    toast(connected ? 'Node and relationship added.' : project.activeScale === 'meso' ? 'Item added to Micro. Connect it here in Meso.' : 'Node added.');
  };
  const addConnectedNode = addNode;
  const addEdge = () => {
    if (!project.instructor.allowResearchLeads) return toast('Items needing more evidence are turned off for this project.', 'error');
    if (!notebook?.simple && project.activeScale === 'micro') return toast('Choose Meso to connect the items on your map.', 'error');
    if (project.graph.edges.length >= PROJECT_LIMITS.edges) return toast(`This map already contains the maximum ${PROJECT_LIMITS.edges} relationships.`, 'error');
    const source = relationshipSource;
    const target = relationshipTarget;
    if (!source || !target || source.id === target.id) return toast('Choose two different nodes.', 'error');
    if (!canConnectAtScale(connectionScale, source) || !canConnectAtScale(connectionScale, target)) return toast('Choose available nodes.', 'error');
    const groupIssue = relationshipGroupIssue(newEdge, project.graph.nodes, project.graph.edges, connectionScale);
    if (groupIssue) return toast(groupIssue, 'error');
    const canonicalVerb = newEdge.verb.trim();
    if (notebook?.simple && !canonicalVerb) return toast('Name the relationship before adding it.', 'error');
    if (project.graph.edges.some((edge) => edge.status !== 'rejected' && edge.claimState !== 'retired' && edge.source === source.id && edge.target === target.id && edge.verb.trim().toLocaleLowerCase() === canonicalVerb.toLocaleLowerCase() && JSON.stringify([...(edge.relationshipIds || [])].sort()) === JSON.stringify([...(newEdge.relationshipIds || [])].sort()))) return toast('This relationship is already on the map. Select it to edit its direction or evidence.', 'error');
    const id = newEdge.id;
    update((draft) => { draft.graph.edges.push(manualEdge(source, target)); }, 'edge.added', relationshipDescription({ ...newEdge, verb: canonicalVerb }, source.label, target.label));
    setSelection({ kind: 'edge', id });
    setInspectorTab('relationships');
    setConnectionSource(null);
    if (notebook?.simple) { setConnecting(false); setAnnouncement('Relationship added.'); }
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
  const annotationRestoreRevision = useRef(null);
  const restoredEdit = notebook?.simple && project.events.findLast(event => event.action === 'edit.undo' || event.action === 'edit.redo');
  if (restoredEdit) annotationRestoreRevision.current = restoredEdit.id;
  const annotationProps = {
    onCommit: commitAnnotations,
    onFlush: flushSave,
    onPersisted: () => logPrototype('annotation_saved'),
    persistenceStatus: saveState.status,
    persistenceMessage: saveState.message,
    savedRevision: saveState.savedRevision || 0,
    restoreRevision: annotationRestoreRevision.current,
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
    window.requestAnimationFrame(() => {
      const opener=legendOpener.current;
      (opener?.isConnected && opener!==document.body ? opener : legendTriggerRef.current || canvasWrapRef.current?.querySelector('.graph-canvas'))?.focus();
    });
  }, [setAnnouncement]);
  const toggleLegend = (focusTarget='button') => {
    if (legendOpen) {
      closeLegend();
      return;
    }
    setDrawerOpen(false);
    setMoveMenuOpen(false);
    setCreateMenuOpen(false);
    legendOpener.current=focusTarget?.currentTarget || document.activeElement;
    legendFocusTarget.current=focusTarget==='shortcuts'?'#map-key-shortcuts':'button';
    setLegendOpen(true);
    setAnnouncement('Map key opened.');
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
  const mapTools = <MapTools embedded={Boolean(notebook?.simple)} open={toolsOpen} onOpenChange={setToolsOpen} scales={project.releasedScales}
          scale={visibleScale} onScale={changeVisibleScale} presentation={presentation} onPresentation={changePresentation}
          nodes={connectionIndex.nodes} onSelect={followMapItem} onZoom={zoomBy}
          canZoomOut={canvasViewport.zoom > minimumInteractiveZoom} canZoomIn={canvasViewport.zoom < VIEWPORT_LIMITS.maxZoom}
          onAdd={project.instructor.allowResearchLeads && SCALE_ORDER.includes(project.activeScale) ? () => { setConnecting(false); setConnectionSource(null); changePanel('inspector'); setNewNode(blankManualNode(project.activeScale, notebook?.simple)); setAddMode('node'); } : null}
          autoFit={project.layout?.autoFit !== false} onAutoFit={notebook ? enabled => { update(draft => { draft.layout = { ...draft.layout, autoFit: enabled }; if (!enabled) for (const node of draft.graph.nodes) { const p = readablePositions?.get(node.id); if (p) Object.assign(node, p); } }, 'layout.auto-fit', enabled ? 'Auto-fit on' : 'Auto-fit off'); if (enabled) fitMap(); } : undefined} onFit={fitMap} onArrange={arrangeMap} canArrange={!focusedEcologyPositions && !phoneRelationshipPositions}
          editHistory={Boolean(notebook?.edits)} onUndo={notebook?.edits?.onUndo || (notebook ? ()=>restoreLayout('undo') : undefined)} onRedo={notebook?.edits?.onRedo || (()=>restoreLayout('redo'))} canUndo={notebook?.edits ? notebook.edits.canUndo : Boolean(layoutHistory.past.length)} canRedo={notebook?.edits ? notebook.edits.canRedo : Boolean(layoutHistory.future.length)}
          onLegend={toggleLegend} onFullscreen={toggleFullscreen} fullscreen={fullscreen}
          hasRemoved={hasRemovedItems} showRemoved={showRemoved} onShowRemoved={setShowRemoved} />;
  useLayoutEffect(() => {
    if (!notebook) return;
    const target = (sheetOpen && !fullscreen && notebookNavigationHost) || floatingControlsRef.current;
    if (!target || workspaceNavigationRoot.parentNode === target) return;
    // Move the same controls between the panel and canvas so menu drafts and
    // focused controls survive a Map / Notebook switch.
    const focused = workspaceNavigationRoot.contains(document.activeElement) ? document.activeElement : null;
    if (workspaceNavigationRoot.isConnected && target.isConnected && typeof target.moveBefore === 'function') target.moveBefore(workspaceNavigationRoot, null);
    else target.append(workspaceNavigationRoot);
    focused?.focus({ preventScroll: true });
  }, [sheetOpen, fullscreen, notebookNavigationHost, workspaceNavigationRoot, notebook]);
  useLayoutEffect(() => () => workspaceNavigationRoot.remove(), [workspaceNavigationRoot]);
  const notebookNavigation = notebook && (notebook.simple ? <div className="notebook-nav-row notebook-nav-row--simple">
    {fullscreen && <button className="button button--secondary" type="button" aria-label="Exit full screen" onClick={toggleFullscreen}><Icon name="close" /></button>}
    <nav className="notebook-switch" aria-label="Workspace">
      <button type="button" className={notebook.memoPending ? 'memo-tab-needs-input' : undefined} aria-pressed={notebook.open && !toolsOpen && panelMode === 'memo'} onClick={() => { setToolsOpen(false); notebook.onMemo(); }}>Memo</button>
      <span className="workspace-tab-dot" aria-hidden="true">·</span>
      <button type="button" aria-pressed={notebook.open && !toolsOpen && panelMode !== 'memo'} onClick={() => { setToolsOpen(false); notebook.onOpen(); }}>Notebook</button>
      <span className="workspace-tab-dot" aria-hidden="true">·</span>
      <button type="button" aria-pressed={notebook.open && toolsOpen} onClick={() => { notebook.onChange(true); setToolsOpen(true); }}>Tools</button>
      {notebook.open && <button type="button" className="workspace-hide" aria-label="Hide sidebar" onClick={() => { setToolsOpen(false); notebook.onChange(false); }}>Hide</button>}
    </nav>
  </div> : <div className="notebook-nav-row">
    {fullscreen && <button className="map-fullscreen-exit" type="button" aria-label="Exit full screen" onClick={toggleFullscreen}><Icon name="close" /></button>}
    <nav className="notebook-switch" aria-label="Workspace">
      <button type="button" aria-pressed={!notebook.open} onClick={() => notebook.onChange(false)}>Map</button>
      <button type="button" aria-pressed={notebook.open} aria-controls="map-inspector" onClick={() => notebook.onOpen ? notebook.onOpen() : notebook.onChange(true)}>Notebook</button>
      {mapTools}{!fullscreen && toolbarStart}
    </nav>
  </div>);
  const runShortcut=event=>{
    const cmd=mapShortcut(event);
    if(!cmd)return;
    if(cmd==='remove') {
      const focusedId=event.target.closest?.('[data-graph-id]')?.dataset.graphId;
      if(!selection || selectedItemRemoved || focusedId && focusedId!==selection.id ||
         !event.target.closest?.('.graph-canvas,.inspector-item-header,.map-list-record,#map-inspector'))return;
      if(!event.repeat)setSelectedRemoved(true);
    } else if(cmd==='undo' || cmd==='redo') {
      if(notebook?.edits) {
        const redo=cmd==='redo';
        if(!event.repeat && (redo?notebook.edits.canRedo:notebook.edits.canUndo))(redo?notebook.edits.onRedo:notebook.edits.onUndo)();
      } else if(event.target.closest?.('.graph-canvas'))restoreLayout(cmd);else return;
    } else if(cmd==='fit')fitMap();
    else if(cmd==='keys') {
      if(!legendOpen)toggleLegend('shortcuts');
      else document.getElementById('map-key-shortcuts')?.focus();
    } else if(cmd==='find') {
      if(notebook?.simple) {setToolsOpen(true);notebook.onChange(true);setDrawerOpen(true);}
      else if(notebook)setToolsOpen(true);
      window.requestAnimationFrame(()=>{
        const find=document.querySelector('.map-stage .map-search,.notebook-map-tools .map-search');
        if(find){find.open=true;find.querySelector('input')?.focus();}
      });
    }
    event.preventDefault();event.stopPropagation();
  };
  // A pointer click on blank canvas or a disappearing item may leave body
  // focused. Keep saved Undo/Redo available without handling keys on other pages.
  const idleShortcut=useRef(null);idleShortcut.current=runShortcut;
  useEffect(()=>{
    const key=e=>{if(e.target===document.body && !document.querySelector('[role="dialog"],dialog[open]') &&
      ['undo','redo'].includes(mapShortcut(e)))idleShortcut.current?.(e);};
    document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);
  },[]);
  return <div className={`map-stage ${notebook ? 'map-stage--notebook' : ''} map-stage--${mapMode} stage-enter ${focusActive || visibleScale === 'all' ? 'has-map-context' : ''} ${fullscreen ? 'is-fullscreen' : ''}`}
    onPointerDownCapture={() => { consumedCanvasTapRef.current = null; }}
    onKeyDownCapture={() => { consumedCanvasTapRef.current = null; }}
    onClickCapture={(event) => {
      const tap = consumedCanvasTapRef.current;
      // Opening the inspector at pointer-up can put a new control under the
      // finger. Consume that tap's compatibility click, not a new activation.
      if (tap && event.detail > 0 && event.timeStamp >= tap.timeStamp && event.timeStamp - tap.timeStamp < 1000) {
        event.preventDefault(); event.stopPropagation();
      }
    }} onDoubleClickCapture={(event) => {
      const tap = consumedCanvasTapRef.current;
      // Chromium may emit dblclick even after its compatibility click was
      // consumed. A completed connection, or a card moved under the finger,
      // must not start another connection or discard the new draft.
      if (tap && event.timeStamp >= tap.timeStamp && event.timeStamp - tap.timeStamp < 1000
        && (tap.completedConnection || event.target.closest?.('[data-graph-id]')?.dataset.graphId !== tap.id)) {
        event.preventDefault(); event.stopPropagation();
      }
    }} onKeyDown={(event) => {
    if (event.key === 'Escape' && (connecting || pendingNodePosition || notebook?.simple && addMode === 'edge')) { event.preventDefault(); event.stopPropagation(); cancelConnection(); return; }
    runShortcut(event);
  }}>
    {notebook ? <h1 className="sr-only">Systems map</h1> : <div className="map-toolbar"><div><h1>Systems map</h1>{toolbarStart}{onReview && <Action className="map-review-action" variant="ghost" onClick={onReview}>Review choices</Action>}</div><div className="map-toolbar__controls"><button type="button" className="sidebar-toggle" aria-controls="map-inspector" aria-expanded={sheetOpen} onClick={() => sheetOpen ? closeInspector() : changePanel(panelMode)}>{sheetOpen ? 'Hide sidebar' : 'Show sidebar'}</button>{panel && <WorkPanelTabs mode={panelMode} onChange={changePanel} disabled={panel.disabled || []} onKeyDown={(event) => handleCompositeKey(event, PANEL_TABS.map((tab) => tab.id), panelMode, changePanel)} />}<MapSearch nodes={connectionIndex.nodes} onSelect={followMapItem} /><div className="map-presentation-toggle" role="group" aria-label="Map presentation"><button type="button" aria-pressed={presentation === 'canvas'} onClick={() => changePresentation('canvas')}>Canvas</button><button type="button" aria-pressed={presentation === 'list'} onClick={() => changePresentation('list')}>List</button></div><label className="map-layer-control"><span>Show layer</span><select aria-label="Show map layer" value={visibleScale} onChange={(event) => changeVisibleScale(event.target.value)}>{project.releasedScales.map((scale) => <option key={scale} value={scale}>{SCALES[scale].label}</option>)}<option value="all">All layers</option></select></label>{hasRemovedItems && <label className="map-removed-toggle"><input type="checkbox" checked={showRemoved} onChange={(event) => setShowRemoved(event.target.checked)} /><span>Show removed items</span></label>}</div></div>}
    {connecting && !notebook?.simple && <div className="map-connect-status" role="status"><span>{connectionSource ? `${project.graph.nodes.find((node) => node.id === connectionSource)?.label} selected. Choose the ending item.` : 'Choose the starting item, then choose the ending item.'}</span><button type="button" onClick={cancelConnection}>Cancel</button></div>}
    {focusActive && !notebook?.open ? <div className="map-focus-bar" role="status"><div className="map-focus-bar__summary"><span>{focusSummary}</span>{focusHasRelationshipPages && <small aria-live="polite">Relationship {activeFocusPage + 1} of {focusIncidentEdges.length}</small>}</div><div className="map-focus-bar__actions">{focusHasRelationshipPages && focusPageCount > 1 ? <><button type="button" aria-label="Previous relationship" disabled={activeFocusPage === 0} onClick={() => changeFocusPage(activeFocusPage - 1)}>Previous</button><button type="button" aria-label="Next relationship" disabled={activeFocusPage === focusPageCount - 1} onClick={() => changeFocusPage(activeFocusPage + 1)}>Next</button></> : null}<button type="button" onClick={showFullMap}>Show full map</button></div></div> : <p className="map-overview-hint">{mapOverviewHint}</p>}



        <div className="sr-only" aria-live="polite" aria-atomic="true"><span key={announcement.revision}>{announcement.message}</span></div>
    <div ref={layoutRef} style={{ '--sidebar-width': `${sidebarSize.width}px` }} className={`map-layout ${sheetOpen ? 'has-inspector' : ''} is-panel-${panelMode}`}>
      {notebook && <>{createPortal(notebookNavigation, workspaceNavigationRoot)}<div ref={floatingControlsRef} className="notebook-floating-controls" /></>}
      {presentation === 'canvas' ? <section ref={canvasWrapRef} className={`canvas-wrap ${phoneLayout && sheetOpen ? 'is-inspector-open' : ''} is-panel-${panelMode} ${fullscreen ? 'is-fullscreen' : ''}`} aria-label="Map canvas and controls">
        {/* While a connection is being drawn the floating chip owns this corner; the
            saved draft can be resumed once the student cancels or finishes. */}
        <div className="map-context-actions">{relationshipDraft.draft && addMode !== 'edge' && !connecting && <button type="button" className="button relationship-resume" onClick={() => { setConnecting(false); setAddMode('edge'); changePanel('inspector'); }}>Resume relationship</button>}</div>
        {connecting && notebook?.simple && (() => { const source = project.graph.nodes.find((node) => node.id === connectionSource); return <div className="map-connect-status" role="status" data-scale={source?.scale || project.activeScale}><span><strong>{source?.label || 'Starting item'}</strong> selected. {source ? connectTargetHint(source) : 'Choose the starting item.'}</span><button type="button" onClick={cancelConnection}>Cancel</button></div>; })()}
        {notebook && !connecting && <div className="map-reading-guide" role={selection ? 'group' : undefined} aria-label={selection ? 'Selected map item' : undefined}><span>{selection ? (selectedNode?.label || (selectedEdge ? relationshipDescription(selectedEdge) : 'Selected item')) : addMode === 'edge' ? 'New relationship' : project.activeScale === 'micro' ? 'Select a node to edit it.' : 'Select a node or relationship to edit it.'}</span>{notebook && !notebook.open && (selection || addMode === 'edge') && <button type="button" className="button button--secondary selected-item-edit" onClick={() => { onPanelMode?.('inspector'); notebook.onChange(true); focusInspector(); }}>Edit</button>}{selection && <button type="button" onClick={()=>{setSelection(null);setFocus(null);}}>{notebook.simple ? 'Cancel' : 'Clear highlight'}</button>}</div>}
        <MemoGraphCanvas onCancelConnection={() => { if (!connecting && !relationshipDraft.draft) return; if (relationshipDraft.draft) { relationshipDraft.discard(); setAddMode(null); } cancelConnection(); setSelection(null); setFocus(null); }} readingMode={Boolean(notebook)} overviewLabels={Boolean(notebook?.simple)} nodeStage={project.activeScale === 'micro' && !visibleEdges.length} onStartConnection={notebook?.simple && drawingReady ? id => startConnection(id, true) : undefined} onConnectBlank={notebook?.simple ? connectBlank : undefined} onAddBlank={notebook?.simple && drawingReady ? addBlank : undefined} previewConnection={relationshipDraft.draft && relationshipSource && relationshipTarget && relationshipSource.id !== relationshipTarget.id ? { source: relationshipSource.id, target: relationshipTarget.id, direction: newEdge.relationshipProcess?.direction || 'source to target' } : null} microBoundary={microBoundary} connectionMode={connecting} nodes={displayedNodes} edges={visibleEdges} selection={selection} onSelect={selectItem} onMoveNode={moveNode} selectedScope={selectedScope} onScopeSelect={followScope} viewport={canvasViewport} phoneLayout={phoneLayout} phoneViewBox={phoneViewBox} mapLabel={mapLabel} mapMode={mapMode} ecologyLayers={ecologyLayers} ecologyBandGeometry={sharedEcologyBands} ecologyInteractionBandGeometry={interactionEcologyBands} fontRevision={fontRevision} visibleLayer={visibleScale === 'macrosphere' && !hasLegacyMacroNodes ? 'exosphere' : visibleScale} detailMode={Boolean(phoneRelationshipPositions || focusedEcologyPositions)} ringExpansion={ringExpansion} interactionMode={phoneLayout && sheetOpen ? 'phone-drawer' : 'durable'} minimumZoom={minimumInteractiveZoom} onViewportChange={changeViewport} onAnnounce={setAnnouncement} />
        {!notebook && <div className="canvas-chrome" aria-hidden={phoneLayout && drawerOpen ? 'true' : undefined} inert={phoneLayout && drawerOpen}>
          <div className="canvas-chrome__top"><div className="canvas-control-group canvas-control-group--display" role="group" aria-label="Map display"><button ref={legendTriggerRef} type="button" aria-controls="map-key-panel" aria-expanded={legendOpen} onClick={toggleLegend}>Map key</button><button ref={fullscreenToggleRef} type="button" aria-controls="systems-map-canvas" aria-pressed={fullscreen} aria-label={fullscreen ? 'Exit full screen' : 'Full screen map'} onClick={toggleFullscreen}>{fullscreen ? 'Exit full screen' : 'Full screen'}</button></div></div>
          <div className="canvas-chrome__bottom"><div className="canvas-control-group canvas-control-group--navigation" role="group" aria-label="Map navigation"><button type="button" aria-label="Zoom out" disabled={canvasViewport.zoom <= minimumInteractiveZoom} onClick={() => zoomBy(-0.15)}>−</button><button type="button" aria-label="Zoom in" disabled={canvasViewport.zoom >= VIEWPORT_LIMITS.maxZoom} onClick={() => zoomBy(0.15)}>+</button><button type="button" aria-label="Fit map" onClick={fitMap}><span className="desktop-label">Fit map</span><span className="phone-label">Fit</span></button><div className="map-move-control"><button ref={moveMenuTriggerRef} type="button" aria-controls="map-move-controls" aria-expanded={moveMenuOpen} onClick={() => { setLegendOpen(false); setMoveMenuOpen((current) => !current); }}>Move</button>{moveMenuOpen && <div id="map-move-controls" className="map-move-controls" role="group" aria-label="Move map without dragging" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMoveMenuOpen(false); window.requestAnimationFrame(() => moveMenuTriggerRef.current?.focus()); } }}><button type="button" aria-label="Move map up" onClick={() => moveMapBy(0, -40, 'up')}>↑</button><button type="button" aria-label="Move map left" onClick={() => moveMapBy(-40, 0, 'left')}>←</button><button type="button" aria-label="Move map right" onClick={() => moveMapBy(40, 0, 'right')}>→</button><button type="button" aria-label="Move map down" onClick={() => moveMapBy(0, 40, 'down')}>↓</button></div>}</div></div><div className="canvas-control-group canvas-control-group--actions" role="group" aria-label="Map actions">{!(focusedEcologyPositions || phoneRelationshipPositions) && <button type="button" aria-label="Arrange map" onClick={arrangeMap}><span className="desktop-label">Arrange map</span><span className="phone-label">Arrange</span></button>}<button className="phone-inspector-trigger map-details-trigger" type="button" aria-controls="map-inspector" aria-expanded={drawerOpen} onClick={() => { if (!selection) setInspectorTab('map'); setLegendOpen(false); setMoveMenuOpen(false); onPanelMode?.('inspector'); setDrawerOpen(true); focusInspector(); }}>Details</button></div></div>
        </div>}
        {legendOpen && <aside id="map-key-panel" className="map-legend" role="dialog" aria-labelledby="map-key-title" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeLegend(); } }}><div className="map-legend__head"><strong id="map-key-title">Map key</strong><button type="button" onClick={closeLegend} aria-label="Close map key"><Icon name="close" /></button></div><MapLegend savedHistory={Boolean(notebook?.edits)} canConnect={Boolean(notebook?.simple && drawingReady)} /></aside>}
      </section> : <MapListView compact={Boolean(notebook?.simple)} nodes={project.graph.nodes} edges={project.graph.edges} visibleScale={visibleScale} showRemoved={showRemoved} onSelect={(kind,id) => {
        selectItem(kind,id);
        // The list action explicitly says Open details. Ordinary canvas
        // selection continues to preserve the user's Notebook choice.
        if (notebook) { onPanelMode?.('inspector'); notebook.onChange(true); setDrawerOpen(true); focusInspector(); }
      }} />}
      <aside id="map-inspector" ref={inspectorRef} data-item-scale={selectedNode?.scale || selectedEdge?.scale || project.activeScale} className={`inspector ${sheetOpen ? 'is-open' : ''} work-panel--${panelMode}`} aria-label={notebook ? 'Notebook' : panelMode === 'suggestions' ? 'Suggestions panel' : panelMode === 'review' ? 'Review panel' : 'Map inspector'} aria-hidden={!sheetOpen ? 'true' : undefined} inert={!sheetOpen} onKeyDown={(event) => { if (event.key === 'Escape' && sheetOpen) { event.preventDefault(); event.stopPropagation(); closeInspector(); } }}>
        {sheetOpen && <SidebarResizeHandle {...sidebarSize} />}
        {notebook && <div ref={setNotebookNavigationHost} className="notebook-controls-host" />}
        {notebook?.simple && notebook.action && <div className="notebook-task-end notebook-task-top" aria-label="Next step">{typeof notebook.action === 'function' ? notebook.action({ canGoBack: viewHistory.canGoBack, onBack: goBackView, view: toolsOpen ? 'tools' : panelMode }) : notebook.action}</div>}
        {notebook?.simple && !panelContent && !toolsOpen && !addMode && (selectedNode || selectedEdge) && <div className="inspector-item-header" aria-label="Selected item actions"><div className="inspector-item-heading"><h2>{selectedNode?.label || relationshipDescription(selectedEdge)}</h2><span className="inspector-item-state">{selectedItemRemoved ? 'Not on map' : 'On map'}</span></div><div className="inspector-item-header-actions"><button className={selectedItemRemoved?"button button--secondary":"button button--secondary map-remove"} type="button" title={selectedItemRemoved?undefined:"Remove from map (Delete or Backspace)"} aria-keyshortcuts={selectedItemRemoved?undefined:"Delete Backspace"} onClick={() => setSelectedRemoved(!selectedItemRemoved)}>{selectedItemRemoved ? 'Add to map' : 'Remove'}</button><button className="button button--secondary inspector-done" type="button" onClick={closeInspector}>Done</button></div></div>}
        {notebook?.simple && !toolsOpen && !panelContent && addMode && <div className="inspector-item-actions" aria-label="New item actions"><button type="button" className="button" onClick={addMode === 'connected-node' ? addConnectedNode : addMode === 'node' ? addNode : addEdge}>{addMode === 'connected-node' ? 'Add node and relationship' : addMode === 'node' ? 'Add to map' : 'Add relationship'}</button><button type="button" className="button button--secondary" onClick={() => { if (['edge', 'connected-node'].includes(addMode)) cancelConnection(); else { setAddMode(null); setConnecting(false); setConnectionSource(null); } closeInspector(); }}>Cancel</button></div>}
        <div className="inspector__scroll">
        {!notebook && panelContent && <div className="work-panel__close"><button type="button" onClick={closeInspector}>Close sidebar</button></div>}
        {notebook && !notebook.simple && panelContent && <NotebookSection mode={panelMode} onChange={changePanel} disabled={panel?.disabled || []} />}
        {(!notebook || !notebook.simple && panelMode === 'suggestions') && <MemoDrawer project={project} update={update} toast={toast} captureImportScope={captureImportScope} defaultOpen={isPart2(project.activeScale) && !activeSubmission(project).text.trim()} onRequestRestart={onRequestRestart} />}
        {notebook?.simple && toolsOpen ? mapTools : panelContent ? <div className="work-panel__body">{notebook && panelMode === 'review' ? React.cloneElement(panel.content, { savedMapNote: <SavedMapNote key={project.id} project={project}><AnnotationField annotationId={project.mapAnnotation.id} label="Map note" value={project.mapAnnotation.text} onDraftValue={(text) => stageAnnotationDraft(project.mapAnnotation.id, text)} {...annotationProps} /></SavedMapNote> }) : panel.content}</div> : <>
        {!(notebook?.simple && !addMode && (selectedNode || selectedEdge)) && <div className={`inspector__head${!addMode && (selectedNode || selectedEdge) ? ' inspector__head--edit' : ''}`}>
          {!addMode && (selectedNode || selectedEdge) ? <div className="item-editor-title"><h2 className={notebook?.simple ? 'sr-only' : undefined}>{notebook?.simple ? 'Item details' : 'Edit'}</h2><p>{selectedNode?.label || relationshipDescription(selectedEdge)}</p></div> : <h2>{addMode === 'edge' && relationshipSource && relationshipTarget
            ? `${relationshipSource.label} and ${relationshipTarget.label}`
            : selectedNode?.label || (selectedEdge ? relationshipDescription(selectedEdge) : 'Map details')}</h2>}
          <div className="inspector__actions">
            {project.instructor.allowResearchLeads && !notebook?.simple && (!notebook || addMode) && SCALE_ORDER.includes(project.activeScale) && <div className="inspector-add-menu"><button type="button" aria-expanded={createMenuOpen} aria-controls="inspector-add-actions" onClick={() => setCreateMenuOpen((current) => !current)}>Add</button>{createMenuOpen && <div id="inspector-add-actions">{<button type="button" onClick={() => { setNewNode(blankManualNode(project.activeScale, notebook?.simple)); setAddMode('node'); setCreateMenuOpen(false); }}>{isRelationshipReviewScale(project.activeScale) ? 'Missing node' : 'Node'}</button>}{project.activeScale !== 'micro' && <button type="button" onClick={() => { relationshipDraft.start(); setAddMode('edge'); setCreateMenuOpen(false); }}>Relationship</button>}</div>}</div>}
            <button className="inspector-done" type="button" onClick={closeInspector}>Done</button>
          </div>
        </div>}
        {inspectedItem && !(notebook?.simple && selectedNode && !addMode) && <InspectorEvidence project={project} item={inspectedItem} label={selectedNode?.label} />}
        {previousTraceLabel && <button type="button" className="map-trace-back" onClick={returnToPreviousItem}>Back to {previousTraceLabel}</button>}
        {!notebook && <div className="inspector-tabs" role="tablist" aria-label="Annotation target">{inspectorTabs.map((tab) => <button key={tab} id={`map-inspector-tab-${tab}`} type="button" role="tab" aria-selected={inspectorTab === tab} aria-controls={`map-inspector-panel-${tab}`} tabIndex={inspectorTab === tab ? 0 : -1} data-composite-value={tab} onClick={() => setTab(tab)} onKeyDown={(event) => handleCompositeKey(event, inspectorTabs, inspectorTab, setTab)}>{tab === 'relationships' ? 'Connections' : tab === 'node' ? 'Item' : 'Map'}</button>)}</div>}
        {['node', 'connected-node'].includes(addMode) && <div className="add-form">
          <h3>{addMode === 'connected-node' ? 'New connected node' : project.activeScale === 'meso' ? 'Add a missing Micro item' : 'New node'}</h3>
          {addMode === 'connected-node' && <p className="field__hint">From {relationshipSource?.label}</p>}
          {project.activeScale === 'meso' && <p>Add a person, group, resource, or setting. It joins your Micro map and can be connected here in Meso.</p>}
          {isPart2(project.activeScale) && <p>{newNode.scale === 'macrosphere' ? 'Name a cultural belief, historical pattern or economic condition. Policies and offices belong in Exo.' : 'Name a policy, outside office, resource or decision setting that affects the local situation.'}</p>}
          <Field label="Label"><textarea className="map-label-input" rows="1" maxLength={NODE_LABEL_LIMIT} value={newNode.label} onChange={(event) => setNewNode((current) => ({ ...current, label: event.target.value }))} /></Field>
          <div className="field-pair">
            <Field label="Type"><select value={newNode.type} onChange={(event) => setNewNode((current) => ({ ...current, type: event.target.value, ...(MICRO_SETTING_NODE_TYPE_SET.has(event.target.value) ? { settingNodeIds: [] } : {}) }))}>{(notebook?.simple ? nodeClassificationTypes(newNode.scale) : NODE_TYPES.filter((type) => isNodeTypeAllowedAtScale(type, newNode.scale))).map((type) => <option key={type}>{type}</option>)}</select></Field>
            {(() => {
              const levels = project.releasedScales.filter((scale) => isNodeReviewScale(scale) || notebook?.simple && scale === 'macrosphere');
              const chooseLevel = (scale) => setNewNode((current) => {
                const allowed = notebook?.simple ? nodeClassificationTypes(scale).includes(current.type) : isNodeTypeAllowedAtScale(current.type, scale);
                const type = allowed ? current.type : (scale === 'macrosphere' ? (notebook?.simple ? 'belief' : 'policy') : scale === 'exosphere' ? 'institution' : 'person');
                return { ...blankManualNode(scale, notebook?.simple), label: current.label, evidence: current.evidence, type };
              });
              // The account workspace shows the levels as the map draws them:
              // one row of swatches, so placing a node in Exo or Macro is one
              // click rather than a hidden menu.
              return notebook?.simple && addMode !== 'connected-node'
                ? <div className="field level-choice"><span className="field__label" id="level-choice-label">Level</span><div className="level-choice__options" role="radiogroup" aria-labelledby="level-choice-label">{levels.map((scale) => <button key={scale} type="button" role="radio" aria-checked={newNode.scale === scale} data-level={scale} onClick={() => chooseLevel(scale)}><i aria-hidden="true" /><span>{SCALES[scale]?.label || scale}</span></button>)}</div></div>
                : <Field label="Level"><select value={newNode.scale} onChange={(event) => chooseLevel(event.target.value)}>{levels.map((scale) => <option key={scale} value={scale}>{SCALES[scale]?.label || scale}</option>)}</select></Field>;
            })()}
          </div>
          {notebook?.simple && addMode === 'node' && pendingNodePosition && <p className="field__hint">It will sit where you double-clicked.</p>}
          {newNode.scale === 'micro' && <MicroParticipationEditor
            item={newNode}
            settingOptions={mapMicroSettingOptions}
            onParticipationChange={(value) => setNewNode((current) => ({ ...current, focalParticipation: value }))}
            onSettingNodeIdsChange={(value) => setNewNode((current) => ({ ...current, settingNodeIds: value }))}
          />}
          <Field label="Evidence or question"><textarea maxLength={PROJECT_LIMITS.noteText} rows="3" value={newNode.evidence} onChange={(event) => setNewNode((current) => ({ ...current, evidence: event.target.value }))} /></Field>
          {addMode === 'connected-node' && <>
            <Field label="Relationship"><input maxLength={RELATIONSHIP_VERB_LIMIT} value={newEdge.verb} onChange={event => setNewEdge(current => ({ ...current, verb: event.target.value }))} /></Field>
            <Field label="Direction"><select value={newEdge.relationshipProcess?.direction || 'not yet known'} onChange={event => setNewEdge(current => ({ ...current, relationshipProcess: createRelationshipProcess({ ...current.relationshipProcess, direction: event.target.value }) }))}><option value="source to target">One way: {relationshipSource?.label} to new node</option><option value="target to source">One way: new node to {relationshipSource?.label}</option><option value="both directions">Both directions</option><option value="varies">Direction varies</option><option value="not yet known">Not yet known</option></select></Field>
          </>}
          <>{!notebook?.simple && <><button className="button" type="button" onClick={addNode}>Add node</button><button type="button" onClick={() => { setAddMode(null); closeInspector(); }}>Cancel</button></>}</>
        </div>}
        {addMode === 'edge' && (notebook?.simple || project.activeScale !== 'micro') && <div className="add-form"><h3>New relationship</h3>{isPart2(project.activeScale) && <div className="relationship-target-mode"><label className="check-row"><input type="checkbox" aria-describedby="relationship-target-mode-hint" checked={Boolean(newEdge.relationshipIds)} onChange={event => setNewEdge(current => {
          const { relationshipIds, ...rest } = current;
          return event.target.checked ? { ...rest, source: project.graph.nodes.find(node => node.id === rest.source && ['exosphere', 'macrosphere'].includes(node.scale))?.id || '', target: '', relationshipIds: [] } : rest;
        })} /><span>Connect to local relationships</span></label><small id="relationship-target-mode-hint">Attach this outside item to one or more Meso relationships instead of a single node.</small></div>}<Field label="From"><select value={relationshipSource?.id || ''} onChange={(event) => setNewEdge((current) => ({ ...current, source: event.target.value }))}><option value="">Choose a node</option>{relationshipSourceNodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field><Field label="Relationship"><input maxLength={RELATIONSHIP_VERB_LIMIT} value={newEdge.verb} onChange={(event) => setNewEdge(current => ({ ...current, verb: event.target.value }))} /></Field>{newEdge.relationshipIds ? <RelationshipGroupPicker project={project} value={newEdge.relationshipIds} onChange={ids => setNewEdge(current => ({ ...current, relationshipIds: ids, target: project.graph.edges.find(edge => edge.id === ids[0])?.source || '' }))} /> : <Field label="To"><select value={relationshipTarget?.id || ''} onChange={(event) => setNewEdge((current) => ({ ...current, target: event.target.value }))}><option value="">Choose a node</option>{relationshipTargetNodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field>}<Field label="Direction"><select value={newEdge.relationshipProcess?.direction || 'source to target'} onChange={(event) => setNewEdge((current) => ({ ...current, relationshipProcess: createRelationshipProcess({ ...current.relationshipProcess, direction: event.target.value }) }))}><option value="source to target">One way: {relationshipSource?.label || 'the starting item'} to {newEdge.relationshipIds ? 'selected local relationships' : relationshipTarget?.label || 'the other item'}</option><option value="target to source">One way: {newEdge.relationshipIds ? 'selected local relationships' : relationshipTarget?.label || 'the other item'} to {relationshipSource?.label || 'the starting item'}</option><option value="both directions">Both directions</option><option value="varies">Direction varies</option><option value="not yet known">Not yet known</option></select></Field>{isPart2(project.activeScale) && <Field label="Evidence or question"><textarea rows="3" maxLength={PROJECT_LIMITS.noteText} value={newEdge.evidence} onChange={event => setNewEdge(current => ({ ...current, evidence: event.target.value }))} /></Field>}{!notebook?.simple && <><button className="button" type="button" onClick={addEdge}>Add relationship</button><button type="button" onClick={() => { setAddMode(null); closeInspector(); }}>Close</button><button type="button" onClick={() => { if (relationshipDraft.discard()) { setAddMode(null); setConnecting(false); setConnectionSource(null); closeInspector(); } }}>Discard relationship</button></>}</div>}
        {!addMode && inspectorTab === 'node' && <div id="map-inspector-panel-node" className="inspector__body" role={notebook ? "region" : "tabpanel"} aria-label={notebook ? "Item details" : undefined} aria-labelledby={notebook ? undefined : "map-inspector-tab-node"}>{selectedNode ? <>
          <MapConnections compact={Boolean(notebook)} nodeId={selectedNode.id} index={connectionIndex} onFollow={followMapItem} onScopeFollow={followScope} selectedScope={selectedScope}
            onConnect={drawingReady && canConnectAtScale(connectionScale, selectedNode) && isLiveMapItem(selectedNode) && project.instructor.allowResearchLeads && (notebook?.simple || connectionIndex.nodes.filter(node => canConnectAtScale(connectionScale, node)).length > 1) ? startConnection : undefined} />
          <MapTextEditor key={`node:${selectedNode.id}`} label="Label" maxLength={NODE_LABEL_LIMIT} value={selectedNode.label} validate={(value) => nodeLabelIssue(value, selectedNode, project.graph.nodes)} onSave={(value) => editNode('label', value)} />
          {/* In the account workspace the quote follows the label it supports, so the label sits directly under the item heading. */}
          {notebook?.simple && inspectedItem && <InspectorEvidence project={project} item={inspectedItem} label={selectedNode.label} />}
          {notebook?.simple && <NodeColorControl color={selectedNode.color} onChange={color => update(draft => {
            const records = [...draft.graph.nodes, ...draft.candidates.nodes].filter(node => node.id === selectedNode.id);
            records.forEach(node => { if (color === undefined) delete node.color; else node.color = color; });
          }, 'node.color.changed', 'Changed node color')} />}
          {notebook?.simple && selectedNode.scale !== 'meso' && <NodeClassificationEditor key={`classification:${selectedNode.id}:${selectedNode.scale}:${selectedNode.type}`} node={selectedNode} scales={project.releasedScales} onSave={(scale, type) => {
            const check = structuredClone(project);
            const issue = reclassifyNode(check, selectedNode.id, scale, type);
            if (issue) return issue;
            if (connecting) cancelConnection();
            if (relationshipDraft.draft) { relationshipDraft.discard(); setAddMode(null); }
            update(draft => { reclassifyNode(draft, selectedNode.id, scale, type); }, 'node.reclassified', 'Changed node classification');
            return '';
          }} />}
          <AnnotationField key={selectedNode.annotations.analytical.id} annotationId={selectedNode.annotations.analytical.id} label="Interpretation" value={selectedNode.annotations.analytical.text} hint="Where does this connect? What is still uncertain?" onDraftValue={(text) => stageAnnotationDraft(selectedNode.annotations.analytical.id, text)} {...annotationProps} />
          <section className="node-summary" aria-label="Edit node">
            <div className="node-summary__body">
              {!notebook?.simple && <p className="field__hint">{selectedNode.type} · {SCALES[selectedNode.scale].label}</p>}
              <SavedItemContext item={selectedNode} />
              {!notebook?.simple && ['meso', 'macrosphere'].includes(selectedNode.scale) && <div className="scope-editor" aria-label={selectedNode.scale === 'meso' ? `Micro settings included in ${selectedNode.label}` : `Map items affected by ${selectedNode.label}`}>
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
            </div>
          </section>
          <div className="node-position-controls"><span>Position on map</span><div role="group" aria-label={`Move ${selectedNode.label} without dragging`}><button type="button" aria-label={`Move ${selectedNode.label} left`} onClick={() => moveSelectedNodeBy(-24, 0, 'left')}>←</button><button type="button" aria-label={`Move ${selectedNode.label} up`} onClick={() => moveSelectedNodeBy(0, -24, 'up')}>↑</button><button type="button" aria-label={`Move ${selectedNode.label} down`} onClick={() => moveSelectedNodeBy(0, 24, 'down')}>↓</button><button type="button" aria-label={`Move ${selectedNode.label} right`} onClick={() => moveSelectedNodeBy(24, 0, 'right')}>→</button></div></div>
          {!notebook?.simple && <button className={selectedItemRemoved?"map-item-action":"map-item-action map-remove"} type="button" onClick={() => setSelectedRemoved(!selectedItemRemoved)}>{selectedItemRemoved ? 'Return to map' : 'Delete'}</button>}
        </> : <p className="empty-message">Select an item on the map to see its evidence and explain what it means for your inquiry.</p>}</div>}
        {!addMode && inspectorTab === 'relationships' && <div id="map-inspector-panel-relationships" className="inspector__body" role={notebook ? "region" : "tabpanel"} aria-label={notebook ? "Connections" : undefined} aria-labelledby={notebook ? undefined : "map-inspector-tab-relationships"}>
          {!selectedEdge && <><p className="inspector-guide">Choose a connection to explain how these items affect one another.</p><div className="relationship-picker" aria-label="Relationship list">{relatedEdges.map((edge) => <button type="button" key={edge.id} onClick={() => selectItem('edge', edge.id)}><span>{relationshipDescription(edge)}</span></button>)}</div></>}
          {selectedEdge ? <>
            {selectedEdge.relationshipIds && <Field label="Heading"><select value={selectedEdge.source} onChange={event => editEdge('source', event.target.value)}>{project.graph.nodes.filter(node => isLiveMapItem(node) && ['exosphere', 'macrosphere'].includes(node.scale)).map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select></Field>}
            {selectedEdge.relationshipIds && <RelationshipGroupPicker project={project} value={selectedEdge.relationshipIds} onChange={ids => editEdge('relationshipIds', ids)} />}
            <Field label="Direction"><select aria-label="Arrow direction" value={relationshipDirection(selectedEdge)} onChange={(event) => editEdge('relationshipProcess', createRelationshipProcess({ ...selectedEdge.relationshipProcess, direction: event.target.value }))}>{!PROCESS_DIRECTION_OPTIONS.some(option => option.value === relationshipDirection(selectedEdge)) && <option value={relationshipDirection(selectedEdge)}>{relationshipDirection(selectedEdge)}</option>}<option value="source to target">{selectedEdge.sourceLabel} to {selectedEdge.relationshipIds ? 'selected local relationships' : selectedEdge.targetLabel}</option><option value="target to source">{selectedEdge.relationshipIds ? 'Selected local relationships' : selectedEdge.targetLabel} to {selectedEdge.sourceLabel}</option><option value="both directions">Both directions</option><option value="varies">Direction varies</option><option value="not yet known">Not yet known</option></select></Field>
            <MapTextEditor key={`edge:${selectedEdge.id}`} label="Relationship" maxLength={RELATIONSHIP_VERB_LIMIT} value={selectedEdge.verb}  validate={(value) => relationshipIssue(value, selectedEdge)} onSave={(value) => editEdge('verb', value)} />
            <AnnotationField key={selectedEdge.annotation.id} annotationId={selectedEdge.annotation.id} label="Interpretation" value={selectedEdge.annotation.text} hint="What does this relationship explain? What is still uncertain?" onDraftValue={(text) => stageAnnotationDraft(selectedEdge.annotation.id, text)} {...annotationProps} />

            <SavedItemContext item={selectedEdge} />
            {!notebook?.simple && <button className={selectedItemRemoved?"map-item-action":"map-item-action map-remove"} type="button" onClick={() => setSelectedRemoved(!selectedItemRemoved)}>{selectedItemRemoved ? 'Return to map' : 'Delete'}</button>}

          </> : <p className="empty-message">You can also select a line directly on the map.</p>}
        </div>}
        {!addMode && inspectorTab === 'map' && <div id="map-inspector-panel-map" className="inspector__body" role={notebook ? "region" : "tabpanel"} aria-label={notebook ? "Map notes" : undefined} aria-labelledby={notebook ? undefined : "map-inspector-tab-map"}>
          {!notebook?.simple && <p className="inspector-guide">Select an item or a connecting line to work on its meaning and evidence. Use this view for patterns across the whole map.</p>}
          {!notebook && <details className="map-help"><summary>Map controls</summary><dl>
            <div><dt>Pan</dt><dd>Drag empty space, hold Space and drag, or use the middle mouse button.</dd></div>
            <div><dt>Zoom</dt><dd>Scroll or pinch; use + and − while the canvas is focused.</dd></div>
            <div><dt>Move an item</dt><dd>Drag it, or focus it and use arrow keys. Shift moves it farther.</dd></div>
            <div><dt>Fit map</dt><dd>Show the current map in the available space. Press 0 on the canvas.</dd></div>
            <div><dt>Undo layout</dt><dd>Use Ctrl/⌘ Z on the canvas; Shift redoes the change. Text fields keep their own undo.</dd></div>
          </dl><div className="layout-history" role="group" aria-label="Layout history"><button type="button" disabled={!layoutHistory.past.length} onClick={() => restoreLayout('undo')}>Undo layout</button><button type="button" disabled={!layoutHistory.future.length} onClick={() => restoreLayout('redo')}>Redo layout</button></div></details>}
          {!notebook && <ProjectOverview project={project} />}
          <div className="map-summary"><strong>{scaleNodes.length}</strong><span>nodes</span><strong>{scaleEdges.length}</strong><span>relationships</span></div><AnnotationField key={project.mapAnnotation.id} annotationId={project.mapAnnotation.id} label="Map note" value={project.mapAnnotation.text} hint="Write about a pattern, boundary, contradiction, or question across the map." placeholder="Across the map, I notice…" onDraftValue={(text) => stageAnnotationDraft(project.mapAnnotation.id, text)} {...annotationProps} /></div>}
        </>}
        </div>
        {notebook && !notebook.simple && notebook.action && !addMode && !connecting && <div className="notebook-task-end" aria-label="Next step">
          <span className="notebook-current-step">{SCALES[project.activeScale].label} · {isNodeReviewScale(project.activeScale) ? 'Nodes' : 'Relationships'}</span>
          {notebook.detail && <span className="notebook-step-detail">{notebook.detail}</span>}
          {notebook.action}
        </div>}
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
  'sharing.changed': ['Export settings changed', true],
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
  const hasNote = Boolean(project.mapAnnotation.text.trim());
  return <details className="saved-map-note"><summary>{hasNote ? 'Saved map note' : 'Map note'}</summary>{children}</details>;
}

function ReviewPanel({ presentationRef, onSaveNote, saveState, savedMapNote = null, exportOnly = false, onProjectLink, project, update, replaceProject, toast, logPrototype, onValidationError, onReviewLevel, onSubmitRevision, revisionSubmitting = false, submitDisabled = false }) {
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
  const exportProject = async (format) => {
    try {
      await downloadProjectFile(project,format,presentationRef?.current);
      logPrototype('project_exported', { nodeCount: project.graph.nodes.length, relationshipCount: project.graph.edges.length });
    } catch (error) {
      const message='The export was not created because one map item needs attention.';
      onValidationError(error,message);
      throw new Error(userFacingError(error,message));
    }
  };
  return <div className="review-panel">
    {!exportOnly && <>
      <ReflectionEntry project={project} update={update} onSave={onSaveNote} saveState={saveState} />
      {savedMapNote}
      {onSubmitRevision && <button type="button" className="text-button" disabled={revisionSubmitting || submitDisabled} onClick={onSubmitRevision}>{revisionSubmitting ? 'Submitting…' : 'Submit revision'}</button>}
    </>}
    {exportOnly && <>
    <section className="export-strip export-strip--compact" aria-label="Export and share">
      <MapDownloadControls onDownload={exportProject} />
      <div className="map-download-actions"><button type="button" className="button button--secondary" onClick={onProjectLink}>Project link</button>
        <label className="export-dropdown__import"><Icon name="upload" />Import JSON<input type="file" accept=".json,application/json" onChange={onImport} /></label>
      </div>
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

function App({ memoFirstWorkflow = false, startInWorkspace = false, startInTeacher = false, onOpenProjects, onAccountDashboard, onOpenAccount, configurationRevision = 0, cloudSaveStatus, cloudError, onSubmitRevision } = {}) {
  const institutionalMode = Boolean(onAccountDashboard);
  const bugReportDock = useBugReportDock();
  const [mapToolbarHost, setMapToolbarHost] = useState(null);
  const [theme, setTheme] = useState(storedTheme);
  const [notebookOpen, setNotebookOpen] = useState(memoFirstWorkflow);
  const lastCanvasPresentation=useRef(null);
  const [completionDismissed, setCompletionDismissed] = useState(false);
  const [initialLoad] = useState(() => { const loaded = loadProject(); if (memoFirstWorkflow && isPart2(loaded.project.activeScale)) beginPart2(loaded.project); return loaded; });
  const [workflowPanelMode, setWorkflowPanelMode] = useState(() => memoFirstWorkflow && (initialLoad.project.stage < 2 || !activeSubmission(initialLoad.project).text.trim()) ? 'memo' : 'review');
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
  const memoCommitFeedbackRef = useRef(null);
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
  const initialModelRequired = !memoFirstWorkflow && requiresInitialModel(project);
  useEffect(() => {
    if (!initialModelRequired || project.stage < 2) return;
    setMapPreviewOpen(false);
    setProject(current => ({ ...current, stage: 1 }));
  }, [initialModelRequired, project.stage]);
  // Completing a level starts the next level's memo reading in the same click.
  // The read waits for the stage change to settle because generateSuggestions
  // reads the rendered project, not the draft being committed.
  const [pendingLevelRead, setPendingLevelRead] = useState(null);
  const queueLevelRead = scale => setPendingLevelRead({
    scale, projectId: projectRef.current.id,
    activationGeneration: projectActivationGenerationRef.current,
    accessGeneration: accessGenerationRef.current,
  });
  const [studioHighlight, setStudioHighlight] = useState(null);
  useEffect(() => {
    setReviewBusy(null);
    setReviewFailure(null);
    setReviewRetryAt(0);
    setPendingLevelRead(null);
    return () => {
      reviewRequestRef.current?.controller.abort();
      reviewRequestRef.current = null;
      reviewInFlightRef.current = false;
      reviewRetryAtRef.current = 0;
    };
  }, [project.id, accessState.status]);
  useEffect(() => setReviewFailure(null), [project.activeScale, activeSubmission(project).text]);
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
    setToastState({ message, type, durationMs });
  }, []);
  useEffect(() => {
    if (!toastState) return;
    const timer = window.setTimeout(() => setToastState(null), toastState.durationMs);
    return () => window.clearTimeout(timer);
  }, [toastState]);
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
    if (memoFirstWorkflow) recordEdit(base, preview, 'Update notes');
    let committedProject = preview;
    projectRef.current = preview;
    setProject((current) => {
      if (current === base) return preview;
      const rebased = applyAnnotationDrafts(current, drafts, updatedAt) || current;
      if (memoFirstWorkflow && rebased !== current) recordEdit(current, rebased, 'Update notes');
      projectRef.current = rebased;
      committedProject = rebased;
      return rebased;
    });
    return { project: committedProject, changed: true };
  }, [memoFirstWorkflow]);

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
      if (memoDraftBaseRef.current.id !== project.id || activeSubmission(memoDraftBaseRef.current).id !== activeSubmission(project).id) {
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
    if (memoFirstWorkflow) recordEdit(current, next, detail || 'Edit map');
    return next;
  }), [memoFirstWorkflow]);

  const restoreSavedEdit = (direction) => {
    if (!memoFirstWorkflow || reviewInFlightRef.current || pendingLevelRead) return;
    const scope = projectActivationGenerationRef.current;
    const projectId = projectRef.current.id;
    commitPendingAnnotations();
    // Apply against queued state as well as the rendered state. Never restore a
    // snapshot over a newer edit or a newly opened project.
    setProject(current => {
      if (scope !== projectActivationGenerationRef.current || current.id !== projectId) return current;
      const result = restoreEdit(current, direction);
      if (!result.project) {
        if (editHistoryState(current)[direction === 'undo' ? 'canUndo' : 'canRedo']) queueMicrotask(() => toast(result.error, 'error'));
        return current;
      }
      return result.project;
    });
  };

  const recordStageTransition = useCallback((fromStage, toStage, { completed = false, success = true } = {}) => {
    if (completed) logPrototype('stage_completed', { fromStage, toStage, success }, STAGES[fromStage].label);
    logPrototype('stage_viewed', { fromStage, toStage }, STAGES[toStage].label);
  }, [logPrototype]);

  const setStage = (stage, options = {}) => {
    if (!options.preserveNotebook) setNotebookOpen(stage !== 3 || requiresInitialModel(projectRef.current));
    if (!Number.isInteger(stage) || stage < 0 || stage >= STAGES.length) return false;
    if (!memoFirstWorkflow && stage >= 2 && requiresInitialModel(projectRef.current)) {
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
      if (error.status === 413) return toast('The request is too large. Check the text and project details, then try again.', 'error');
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
    if (memoFirstWorkflow && !isNodeReviewScale(project.activeScale)) return false;
    if (reviewInFlightRef.current || reviewRetryAtRef.current > Date.now()) return false;
    if (!activeSubmission(project).text.trim()) { toast('Add the memo for this part before requesting guidance.', 'error'); return false; }
    const payload = preflightEvaluationPayload(project, memoFirstWorkflow);
    const encoder = new TextEncoder();
    const providerSource = payload.memoUpdate?.passages.length
      ? payload.memoUpdate.passages.map(passage => passage.text).join('\n\n')
      : prepareProviderMemo(payload.sourceMaterial).sourceText;
    const sourceBytes = encoder.encode(providerSource).byteLength;
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
    const activationGeneration = projectActivationGenerationRef.current;
    const requestKey = authoritativeEvaluationKey(project, memoFirstWorkflow);
    const cacheRequestKey = stableId('guidance-cache', `${requestKey}:${JSON.stringify(accessState.access)}`);
    const request = { controller: new AbortController(), projectId: project.id };
    reviewRequestRef.current = request;
    reviewInFlightRef.current = true;
    setReviewFailure(null);
    setReviewBusy('evaluating');
    setReviewProgress(resume ? 'Recovering your saved request…' : 'Saving your generation request…');
    try {
      let cached = readGuidanceCache(projectStorage(), project.id, cacheRequestKey);
      // A feedback-only result must not turn an explicit reread into reuse of
      // the same incomplete suggestions. The saved review remains available.
      if (cached?.evaluation?.runtime?.feedbackOnly === true) {
        removeGuidanceCacheEntry(projectStorage(), project.id, cacheRequestKey);
        cached = null;
      }
      let result;
      if (cached) {
        try { result = normalizePreflightEvaluation(cached.evaluation, project, memoFirstWorkflow); }
        catch { removeGuidanceCacheEntry(projectStorage(), project.id, cacheRequestKey); }
      }
      const response = result ? cached : await createPreflightEvaluation(payload, { signal: request.controller.signal, durable: institutionalMode,
        projectId: project.id, requestKey, resume, retryFailed: !resume && Boolean(reviewFailure),
        onProgress: message => { if (reviewRequestRef.current === request) setReviewProgress(message); } });
      if (request.controller.signal.aborted) return false;
      if (!response || !Object.hasOwn(response, 'evaluation')) throw new Error('The server returned guidance in an unexpected format. Generate the guidance again.');
      if (accessGeneration !== accessGenerationRef.current || projectRef.current.id !== project.id) return;
      if (authoritativeEvaluationKey(projectRef.current, memoFirstWorkflow) !== requestKey) {
        toast('The memo or model setup changed while guidance was generated. Generate again from the current project.', 'error');
        return;
      }
      if (!result) {
        result = normalizePreflightEvaluation(response.evaluation, projectRef.current, memoFirstWorkflow);
        if (result.evaluation.runtime.feedbackOnly !== true) writeGuidanceCache(projectStorage(), project.id, cacheRequestKey, response);
      }
      const completionMetadata = {
        sourceFingerprint: result.sourceFingerprint,
        configurationSnapshot: result.configurationSnapshot,
        runtime: result.evaluation.runtime,
        evaluation: { createdAt: result.evaluation.createdAt, expiresAt: result.evaluation.expiresAt },
      };
      if (memoFirstWorkflow) {
        const event = createEvent('preflight.completed', 'Submitted memo nodes added to map', 'student', completionMetadata);
        const feedback = { eventId: event.id, projectId: project.id, accessGeneration, activationGeneration, error: null, summary: null, withheld: result.evaluation.runtime.correctiveRetries > 0 };
        memoCommitFeedbackRef.current = feedback;
        let prepared;
        update(draft => Object.assign(draft, prepared), 'preflight.completed', event.detail, 'student', completionMetadata, {
          event,
          guard: current => {
            if (request.controller.signal.aborted || current.id !== project.id || accessGenerationRef.current !== accessGeneration || projectActivationGenerationRef.current !== activationGeneration) return false;
            try {
              // React may already have queued a memo or map edit that is not
              // reflected in projectRef. Validate the actual commit state.
              if (authoritativeEvaluationKey(current, true) !== requestKey) {
                feedback.error = 'The memo or map changed while nodes were generated. Choose Update map again from the current memo.';
                return false;
              }
              prepared = structuredClone(current);
              prepared.preflight = result;
              feedback.summary = memoUpdateSummary(prepared, result.memoReview);
              appendSubmittedNodes(prepared, result.memoReview);
              validateProject(prepared);
              return true;
            } catch (error) {
              feedback.error = userFacingError(error, 'The memo update could not be applied. Your saved map is unchanged.');
              return false;
            }
          },
        });
      } else {
        update(draft => { draft.preflight = result; }, 'preflight.completed', 'Memo guidance generated', 'student', completionMetadata);
        toast(result.evaluation.runtime.feedbackOnly === true ? 'Feedback is ready; the app could not use its map suggestions.' : 'Guidance is ready.');
      }
      return result;
    } catch (error) {
      if (request.controller.signal.aborted) return false;
      if (accessGeneration !== accessGenerationRef.current || projectRef.current.id !== project.id) return false;
      const quotaDenied = error instanceof ApiError && error.payload?.details?.code === 'quota_exceeded';
      setReviewFailure({
        message: error instanceof TimeoutError ? 'Guidance took too long. Try again.'
          : userFacingError(error, 'Guidance could not be completed. Try again.'),
        retryable: !quotaDenied,
        supportDetails: reviewSupportDetails(error),
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
    const feedback = memoCommitFeedbackRef.current;
    if (!feedback) return;
    if (feedback.projectId !== project.id || feedback.accessGeneration !== accessGenerationRef.current || feedback.activationGeneration !== projectActivationGenerationRef.current) {
      memoCommitFeedbackRef.current = null;
      return;
    }
    if (project.events.some(event => event.id === feedback.eventId)) {
      memoCommitFeedbackRef.current = null;
      const { added, updated } = feedback.summary;
      const { withheld } = feedback;
      setNotebookOpen(true); setWorkflowPanelMode('review');
      toast(updated ? `${added} nodes added; ${updated} evidence passages updated. Your connections and manual edits are preserved.` : added ? `${added} nodes added to your map.` : withheld ? 'No new nodes were added. Proposed nodes that did not pass the evidence checks were left out. Use Tools to add nodes yourself.' : 'No new nodes were added: nothing new in this memo was identified for this step. Use Tools to add nodes yourself.');
    } else if (feedback.error) {
      memoCommitFeedbackRef.current = null;
      setReviewFailure({ message: feedback.error, retryable: true });
      toast(feedback.error, 'error');
    }
  }, [project, reviewBusy, toast]);

  useEffect(() => {
    if (!institutionalMode || accessState.status !== 'granted' || project.stage !== 1) return;
    const key = authoritativeEvaluationKey(project, memoFirstWorkflow);
    if (resumedGuidance.current === key || !hasPendingGuidance(projectStorage(), project.id, key)) return;
    resumedGuidance.current = key;
    void generateSuggestions({ resume: true });
  }, [institutionalMode, accessState.status, project.id, project.activeScale, project.stage, project.teacherGovernance]);

  const generateConnectionSuggestions = async () => {
    if (memoFirstWorkflow) return;
    const effectivePrompt = connectionPrompt.trim() || memoPromptExcerpt(reviewMemoText(project));
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
      if (stableId('connection-request', JSON.stringify(connectionSuggestionPayload(projectRef.current, connectionPromptRef.current.trim() || memoPromptExcerpt(reviewMemoText(projectRef.current))))) !== requestKey) {
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
      toast(normalized.length ? 'Connections are ready for your review.' : 'No connections were suggested. You can add one yourself or try again.');
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
    const fingerprint = stableId('src', reviewMemoText(currentProject));
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
            focalParticipation: 'unclear',
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
    const edgeKeyOf = (edge) => `${edge.source}::${edge.verb.trim().toLocaleLowerCase()}::${edge.target}::${[...(edge.relationshipIds || [])].sort().join(',')}`;
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
      const id = stableId('edge', `${source}:${connection.verb}:${target}${connection.relationshipIds?.length ? ':' + [...connection.relationshipIds].sort().join(',') : ''}`);
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
        ...(connection.relationshipIds ? { relationshipIds: [...connection.relationshipIds] } : {}),
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
    // A student's membership/wording edit changes the semantic key, but the
    // suggestion keeps its durable ID. Re-reading must not duplicate that ID.
    for (const prior of priorEdges.values()) if (![...edgeByKey.values()].some(edge => edge.id === prior.id)) edgeByKey.set(edgeKeyOf(prior), prior);
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
        verb: prior?.verb ?? edge.verb,
        sourceLabel: sourceNode?.label || edge.sourceLabel,
        targetLabel: targetNode?.label || edge.targetLabel,
        scale: currentProject.activeScale,
      };
      return prior ? { ...scaled, status: prior.status, claimState: prior.claimState, origin: prior.origin || scaled.origin, reviewDecision: prior.reviewDecision || scaled.reviewDecision, notes: prior.notes || edge.notes, ...(prior.relationshipProcess ? { relationshipProcess: prior.relationshipProcess } : {}), ...(prior.relationshipIds ? { relationshipIds: prior.relationshipIds } : {}) } : scaled;
    });
    // Micro identifies items; Macro stores scope on each condition.
    if (isNodeReviewScale(currentProject.activeScale)) {
      if (edges.length) invalidReview();
      return { nodes, edges: [] };
    }
    return { nodes, edges };
  };

  const prepareCandidates = (sourceProject = project) => {
    const project = sourceProject;
    if (requiresInitialModel(project)) return false;
    if (project.preflight?.evaluation?.runtime?.feedbackOnly === true) {
      // No map suggestions survived validation. Advance without rebuilding or
      // automatically confirming any prior student choices.
      update((draft) => {
        draft.stage = 2;
        draft.furthestStage = Math.max(draft.furthestStage || 0, 2);
      }, 'candidates.generated', 'Feedback received without map suggestions', 'student');
      recordStageTransition(project.stage, 2, { completed: true });
      toast('Your previous map work is unchanged. You can add items yourself or reread the memo.');
      return true;
    }
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
    }, 'candidates.generated', `${candidates.nodes.length} nodes and ${candidates.edges.length} relationships`, 'student', { configurationSnapshot: snapshot, sourceFingerprint: stableId('src', reviewMemoText(project)) });
    recordStageTransition(project.stage, 2, { completed: true });
    const itemCount = candidates.nodes.length + candidates.edges.length;
    toast(itemCount
      ? project.activeScale === 'micro'
        ? 'Micro-level items from your memo are ready for review.'
        : project.activeScale === 'meso'
          ? 'Relationships between your Micro items are ready for review.'
          : project.activeScale === 'exosphere'
            ? 'Larger-scale nodes from your memo are ready for review.'
            : 'Larger-scale and cross-scale relationships are ready for review.'
      : 'No items were suggested. You can add one yourself or reread the memo.');
    return true;
  };

  const refreshCandidatesFromMemo = async () => {
    const result = await generateSuggestions();
    if (!result) return;
    if (result.evaluation.runtime.feedbackOnly === true) {
      toast('Your previous suggestions and map are unchanged. You can add items yourself or reread the memo.');
      return;
    }
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
    }, 'candidates.refreshed', `${candidates.nodes.length} nodes and ${candidates.edges.length} relationships`, 'student', { sourceFingerprint: stableId('src', reviewMemoText(current)) });
    toast('Memo review updated. You can continue reviewing your map.');
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
    const relationshipsAllowed = !memoFirstWorkflow && project.activeScale !== 'micro';
    const reviewedScaleEdges = (memoFirstWorkflow ? [] : project.candidates.edges)
      .filter((item) => item.scale === project.activeScale)
      .map(rekeyEdge);
    const rekeyedConnectionSuggestions = suggestedConnections.map(rekeyEdge);
    const acceptedEdges = relationshipsAllowed ? reviewedScaleEdges
      .filter((item) => item.status === 'confirmed' && endpointIds.has(item.source) && endpointIds.has(item.target)) : [];
    const acceptedSuggestions = relationshipsAllowed ? rekeyedConnectionSuggestions
      .filter((edge) => edge.status === 'confirmed' && edge.source !== edge.target) : [];
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
        .map((edge) => `${edge.source}\u0000${edge.verb.trim().toLocaleLowerCase()}\u0000${edge.target}\u0000${[...(edge.relationshipIds || [])].sort().join(',')}`));
      acceptedSuggestions.forEach((edge) => {
        if (!graphNodeIds.has(edge.source) || !graphNodeIds.has(edge.target)) return;
        const key = `${edge.source}\u0000${edge.verb.trim().toLocaleLowerCase()}\u0000${edge.target}\u0000${[...(edge.relationshipIds || [])].sort().join(',')}`;
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
    if (!memoFirstWorkflow && project.stage >= 2 && requiresInitialModel(projectRef.current)) return setStage(1);
    switch (project.stage) {
      case 0: setStage(1, { completed: true }); break;
      case 1: {
        if (reviewInFlightRef.current) return;
        const current = projectRef.current;
        if (requiresLevelModel(current)) {
          const result = await generateSuggestions();
          if (!result) return;
          if (memoFirstWorkflow) return;
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
          if (!nextScale) {
            const completed = structuredClone(commitPendingAnnotations().project);
            if (!completed.completedScales.includes(currentScale)) completed.completedScales.push(currentScale);
            completed.completedScales = SCALE_ORDER.filter(scale => completed.completedScales.includes(scale));
            completed.levelProgress[currentScale] = { stage: 4, reflection: completed.reflection };
            completed.stage = 4; completed.furthestStage = 4;
            completed.updatedAt = new Date(Math.max(Date.now(), Date.parse(completed.updatedAt) + 1)).toISOString();
            completed.events.push(createEvent('scale.cycle-completed', `${SCALES[currentScale].label} completed`));
            completed.events = completed.events.slice(-500);
            if (!persistNow(completed)) { toast('Completion could not be saved. Your map and Field Notes remain available.', 'error'); return; }
            projectRef.current = completed; setProject(completed); setCompletionDismissed(false);
            return;
          }

        // The memo travels with the project, so the next level opens directly
        // on Review — the model rereads for the new level instead of walking
        // the student back through the intake form they already completed.
        update((draft) => {
          if (!draft.completedScales.includes(currentScale)) draft.completedScales.push(currentScale);
          draft.completedScales = SCALE_ORDER.filter((scale) => draft.completedScales.includes(scale));
          draft.levelProgress[currentScale] = { stage: 4, reflection: draft.reflection };
          if (nextScale) {
            if (currentScale === 'meso') {
              beginPart2(draft);
              if (currentScale === 'meso') draft.layout = { ...(draft.layout || {}), manualNodeIds: [...new Set([...(draft.layout?.manualNodeIds || []), ...draft.graph.nodes.map(node => node.id)])] };
            }
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
        if (nextScale) queueLevelRead(nextScale);
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
    restarted.submission = { ...structuredClone(activeSubmission(project)), id: newSubmissionId };
    delete restarted.submission.analysis;
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
    if (memoFirstWorkflow) {
      if (reviewInFlightRef.current || pendingLevelRead || !SCALE_ORDER.includes(scale)) return;
      const next = structuredClone(projectRef.current);
      const firstMemo = memoUpdateState({ ...next, activeScale: 'micro' });
      const secondMemo = memoUpdateState({ ...next, activeScale: 'exosphere' });
      const firstMemoReady = firstMemo.submitted || firstMemo.hasBaseline || secondMemo.submitted || secondMemo.hasBaseline;
      const destination = scale !== 'micro' && !firstMemoReady ? 'micro' : scale;
      openMemoWorkflowScale(next, destination);
      if (destination === 'macrosphere' && !memoUpdateState(next).submitted) openMemoWorkflowScale(next, 'exosphere');
      update(draft => openMemoWorkflowScale(draft, next.activeScale), 'scale.selected', `${SCALES[next.activeScale].label} opened`);
      setWorkflowPanelMode(memoUpdateState(next).submitted ? 'review' : 'memo'); setNotebookOpen(true); setMapPreviewOpen(false); setCompletionDismissed(true); setModal(null);
      return;
    }
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

  const submitWorkflowMemo = () => {
    if (reviewInFlightRef.current || pendingLevelRead || !activeSubmission(project).text.trim()) return;
    if (memoUpdateState(project).submitted) { setWorkflowPanelMode('review'); return; }
    const scale = isPart2(project.activeScale) ? 'exosphere' : 'micro';
    setWorkflowPanelMode('memo'); setNotebookOpen(true);
    update(draft => { if (draft.activeScale !== scale) openMemoWorkflowScale(draft, scale); draft.stage = 1; });
    queueLevelRead(scale);
  };
  const editWorkflowMemo = (scale) => {
    if (reviewInFlightRef.current || pendingLevelRead) return;
    if (scale && isPart2(scale) !== isPart2(project.activeScale)) update(draft => {
      openMemoWorkflowScale(draft, scale);
    }, 'memo.opened', 'Memo opened for editing');
    setWorkflowPanelMode('memo'); setNotebookOpen(true); setCompletionDismissed(true);
  };

  // One computed next action replaces the five-step footer. Rules live in
  // nextStep.js and read saved project state only; stage records are unchanged.
  const step = nextStep(project, { reviewBusy: Boolean(reviewBusy), retryPending: reviewRetryAt > Date.now(), initialModelRequired });
  const runNextStep = () => {
    if (memoFirstWorkflow) {
      if (reviewInFlightRef.current || pendingLevelRead) return;
      if (!memoUpdateState(project).submitted) { setWorkflowPanelMode('memo'); setNotebookOpen(true); return; }
      const next = SCALE_ORDER[SCALE_ORDER.indexOf(project.activeScale) + 1];
      if (next) {
        update(draft => {
          if (!draft.completedScales.includes(draft.activeScale)) draft.completedScales.push(draft.activeScale);
          openMemoWorkflowScale(draft, next);
        }, 'scale.selected', `${SCALES[next].label} opened`);
        const nextView = structuredClone(project); openMemoWorkflowScale(nextView, next);
        setWorkflowPanelMode(memoUpdateState(nextView).submitted ? 'review' : 'memo'); setNotebookOpen(true); setMapPreviewOpen(false);
      } else {
        const completed = structuredClone(commitPendingAnnotations().project);
        if (!completed.completedScales.includes('macrosphere')) completed.completedScales.push('macrosphere');
        completed.stage = completed.furthestStage = 4;
        completed.levelProgress.macrosphere = { stage: 4, reflection: completed.reflection };
        completed.updatedAt = new Date(Math.max(Date.now(), Date.parse(completed.updatedAt) + 1)).toISOString();
        if (!persistNow(completed)) return;
        projectRef.current = completed; setProject(completed); setCompletionDismissed(false);
      }
      return;
    }
    switch (step.id) {
      case 'start-review': setStage(1, { completed: true }); break;
      case 'review-level': setStage(4, { completed: true }); break;
      case 'project-complete': setCompletionDismissed(false); break;
      default: void primary();
    }
  };
  useEffect(() => {
    if (!pendingLevelRead) return;
    if (pendingLevelRead.projectId !== project.id
      || pendingLevelRead.activationGeneration !== projectActivationGenerationRef.current
      || pendingLevelRead.accessGeneration !== accessGenerationRef.current
      || !workspaceStarted || accessState.status !== 'granted') {
      setPendingLevelRead(null);
      return;
    }
    if (project.activeScale !== pendingLevelRead.scale || project.stage !== 1) return;
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
    if (!activeSubmission(project).text.trim() || reviewInFlightRef.current || !memoFirstWorkflow && !requiresLevelModel(project)) return;
    if (memoFirstWorkflow) { void generateSuggestions(); return; }
    void primary();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLevelRead, project.id, project.activeScale, project.stage, project.teacherGovernance, governanceSettled, workspaceStarted, accessState.status]);
  const backDisabled = project.stage === 0;
  const activateProject = useCallback((next, records, { openWorkspace = true } = {}) => {
    if (memoFirstWorkflow && isPart2(next.activeScale)) beginPart2(next);
    projectActivationGenerationRef.current += 1;
    setPendingLevelRead(null);
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
  useEffect(() => {
    setNotebookOpen(memoFirstWorkflow || project.stage !== 3); setCompletionDismissed(memoFirstWorkflow);
    if (memoFirstWorkflow) setWorkflowPanelMode(project.stage < 2 || !activeSubmission(project).text.trim() || memoUpdateState(project).hasBaseline && memoUpdateState(project).changed ? 'memo' : 'review');
  }, [project.id, memoFirstWorkflow]);
  useEffect(() => { if (!memoFirstWorkflow && project.stage !== 3) setNotebookOpen(true); }, [project.stage, project.activeScale, memoFirstWorkflow]);
  const panelDisabled = initialModelRequired ? ['inspector', 'review'] : [];
  const changePanelMode = (mode, options = {}) => {
    if (memoFirstWorkflow) { setWorkflowPanelMode(['inspector', 'memo'].includes(mode) ? mode : 'review'); return; }
    if (mode === 'inspector' && project.stage === 3) return;
    setStage(stageForPanelMode(mode, projectRef.current), { completed: mode === 'review' && project.stage === 3, ...options });
  };
  const suggestionsPanel = <SuggestionsPanel project={project} update={update} toast={toast} prompt={connectionPrompt} onPromptChange={setConnectionPrompt} busy={connectionBusy} suggestions={connectionSuggestions} onSuggest={generateConnectionSuggestions} onEdit={editConnectionSuggestion} onDecision={decideConnectionSuggestion} onRefreshCandidates={refreshCandidatesFromMemo} refreshBusy={Boolean(reviewBusy)} reviewBusy={reviewBusy} reviewProgress={reviewProgress} reviewFailure={reviewFailure} retryPending={reviewRetryAt > Date.now()} onGenerate={generateSuggestions} onHighlight={setStudioHighlight} />;
  const reviewPanel = <ReviewPanel onSaveNote={flushPersistence} saveState={saveState} onProjectLink={() => setModal('project-link')} project={project} update={update} replaceProject={replaceProject} toast={toast} logPrototype={logPrototype} onValidationError={reportProjectValidationFailure} onReviewLevel={(scale) => selectWorkScale(scale, 4)} onSubmitRevision={onSubmitRevision ? submitRevision : undefined} revisionSubmitting={revisionSubmitting} submitDisabled={Boolean(reviewBusy) || Boolean(connectionBusy)} />;
  const captureMemoImportScope = () => { const access = accessGenerationRef.current; const activation = projectActivationGenerationRef.current; return () => access === accessGenerationRef.current && activation === projectActivationGenerationRef.current; };
  const workflowBusy = Boolean(reviewBusy) || Boolean(pendingLevelRead);
  const workflowMemoState = memoUpdateState(project);
  const firstMemoState = memoUpdateState({ ...project, activeScale: 'micro' });
  const memoPrerequisiteReady = !isPart2(project.activeScale) || firstMemoState.submitted || firstMemoState.hasBaseline || workflowMemoState.submitted || workflowMemoState.hasBaseline;
  const workflowNotebook = <MemoWorkflowNotebook key={`${project.id}:${project.activeScale}`} project={project} update={update} onSelectStep={selectWorkScale} onEditMemo={editWorkflowMemo} busy={workflowBusy} saveState={saveState} onSaveNote={flushPersistence} />;
  const workflowMemo = <MemoWorkspace project={project} update={update} uploadControl={<MemoFileUpload project={project} update={update} toast={toast} captureImportScope={captureMemoImportScope} />} onTextChange={text => update(draft => invalidateSubmissionDerived(draft, 'text', text))} onSelectPart={editWorkflowMemo} busy={workflowBusy} failure={reviewFailure} />;
  const panel = memoFirstWorkflow ? { mode: workflowPanelMode, ...(workflowPanelMode !== 'inspector' ? { content: workflowPanelMode === 'memo' ? workflowMemo : workflowNotebook } : {}), disabled: [] }
    : project.stage >= 4 ? { mode: 'review', content: reviewPanel, disabled: panelDisabled }
    : project.stage === 3 && !mapPreviewOpen ? { mode: 'inspector', disabled: panelDisabled }
    : { mode: 'suggestions', content: suggestionsPanel, disabled: panelDisabled };
  const workflowLevels = levelRailState(project).map(level => memoFirstWorkflow && level.state === 'locked' ? { ...level, state: 'available' } : level);
  const restoreWorkflowView = (view) => {
    if (reviewInFlightRef.current || pendingLevelRead || !SCALE_ORDER.includes(view.scale)) return;
    if (projectRef.current.activeScale !== view.scale || projectRef.current.stage !== view.stage) {
      update(draft => {
        draft.levelProgress[draft.activeScale] = { stage: draft.stage, reflection: draft.reflection };
        draft.activeScale = view.scale;
        draft.stage = view.stage;
        draft.reflection = draft.levelProgress[view.scale]?.reflection || '';
      }, 'view.returned', 'Previous workspace view opened');
    }
    setWorkflowPanelMode(view.kind === 'memo' ? 'memo' : ['item', 'node-form', 'relationship-form', 'connected-node'].includes(view.kind) ? 'inspector' : 'review');
    setNotebookOpen(view.kind !== 'map'); setMapPreviewOpen(view.stage === 0); setCompletionDismissed(true); setModal(null);
  };
  const savedEdits = editHistoryState(project);
  const editControls = memoFirstWorkflow ? { ...savedEdits, canUndo: !workflowBusy && savedEdits.canUndo, canRedo: !workflowBusy && savedEdits.canRedo, onUndo: () => restoreSavedEdit('undo'), onRedo: () => restoreSavedEdit('redo') } : null;
  const workflowAction = ({ canGoBack, onBack, view }) => <>
    <div className="workflow-actions"><button type="button" className="button button--secondary" disabled={workflowBusy || !canGoBack} onClick={onBack}>Back</button><div className="map-edit-history" role="group" aria-label="Edit history"><button type="button" aria-label="Undo" aria-keyshortcuts="Meta+Z Control+Z" title={savedEdits.undoLabel ? `Undo: ${savedEdits.undoLabel}` : 'Undo'} disabled={!editControls.canUndo} onClick={editControls.onUndo}><Icon name="undo" /></button><button type="button" aria-label="Redo" aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z Control+Y" title={savedEdits.redoLabel ? `Redo: ${savedEdits.redoLabel}` : 'Redo'} disabled={!editControls.canRedo} onClick={editControls.onRedo}><Icon name="redo" /></button></div><button className="button notebook-next" type="button" disabled={workflowBusy || !workflowMemoState.submitted || !memoPrerequisiteReady} onClick={runNextStep}>{project.activeScale === 'macrosphere' ? 'Finish map' : 'Continue'}</button></div>
    {view === 'memo' && <div className="memo-action-row"><button className="button" type="button" disabled={workflowBusy || reviewRetryAt > Date.now() || !memoPrerequisiteReady || !activeSubmission(project).text.trim() || workflowMemoState.submitted || activeSubmission(project).sensitive && !activeSubmission(project).consent} onClick={submitWorkflowMemo}>{workflowBusy ? 'Updating map…' : workflowMemoState.hasBaseline ? 'Update map' : 'Submit memo and add nodes'}</button><span role={workflowBusy ? 'status' : undefined}>{workflowBusy ? reviewProgress || 'Reading your memo…' : workflowMemoState.submitted ? 'Map is up to date' : !memoPrerequisiteReady ? 'Add Part 1 to the map first.' : 'Add this memo to the map to continue.'}</span></div>}
    {view !== 'memo' && !workflowMemoState.submitted ? <button type="button" className="text-button memo-needed-action" onClick={() => editWorkflowMemo()}>Open Memo to continue</button> : project.activeScale !== 'macrosphere' && <span className="workflow-next-label">{MEMO_WORKFLOW[project.activeScale].next}</span>}
  </>;
  const studio = <MapStage presentationRef={lastCanvasPresentation} captureImportScope={captureMemoImportScope} key={`${project.id}:${projectActivationGenerationRef.current}`} project={project} update={update} toast={toast} logPrototype={logPrototype} saveState={saveState} stageAnnotationDraft={stageAnnotationDraft} commitAnnotationDrafts={commitPendingAnnotations} flushSave={flushPersistence} onRequestRestart={() => setModal('restart-map')} panel={panel} onPanelMode={changePanelMode} notebook={{ simple: memoFirstWorkflow, memoReady: workflowMemoState.submitted && memoPrerequisiteReady, memoPending: !workflowMemoState.submitted, onMemo: () => editWorkflowMemo(), edits: editControls, open: notebookOpen, onRestoreView: restoreWorkflowView, detail: !memoFirstWorkflow && step.blocking ? step.detail : null, onChange: setNotebookOpen, onOpen: () => { if (memoFirstWorkflow || project.stage === 3) changePanelMode('review'); setNotebookOpen(true); }, action: memoFirstWorkflow ? workflowAction : project.stage === 1 && !project.preflight?.memoReview && requiresLevelModel(project) ? null : <button className="button notebook-next" type="button" data-next-action={step.id} disabled={step.blocking} onClick={runNextStep}>{project.stage === 2 ? 'Finish review' : project.stage === 3 ? 'Field Notes' : step.label}</button> }} toolbarHost={mapToolbarHost} toolbarStart={<LevelSelect levels={workflowLevels} onSelect={(scale) => selectWorkScale(scale)} />} highlight={studioHighlight} onHighlight={setStudioHighlight} />;
  const intakeOpen = !memoFirstWorkflow && project.stage === 0 && !mapPreviewOpen;
  const displayedStage = intakeOpen ? 0 : 3;
  const stageScreens = [<IntakeStage project={project} update={update} toast={toast} action={memoFirstWorkflow ? <button className="button" type="button" disabled={Boolean(reviewBusy) || !activeSubmission(project).text.trim() || activeSubmission(project).sensitive && !activeSubmission(project).consent} onClick={submitWorkflowMemo}>Submit memo and add nodes</button> : null} onRequestRestart={() => setModal('restart-map')} captureImportScope={() => {
    const access = accessGenerationRef.current;
    const activation = projectActivationGenerationRef.current;
    return () => access === accessGenerationRef.current && activation === projectActivationGenerationRef.current;
  }} />, studio, studio, studio, studio];
  const completionOpen = project.activeScale === 'macrosphere' && project.completedScales.includes('macrosphere') && !completionDismissed;
  const exportCompletion = async (format) => {
    const snapshot = commitPendingAnnotations().project;
    if (!flushPersistence()) throw new Error('The project could not be saved. Resolve the save warning, then try exporting again.');
    await downloadProjectFile(snapshot,format,lastCanvasPresentation.current);
    logPrototype('project_exported', { nodeCount: snapshot.graph.nodes.length, relationshipCount: snapshot.graph.edges.length });
  };
  const screen = completionOpen ? <ProjectCompletion key={project.id} project={project} onReturn={() => { setCompletionDismissed(true); setNotebookOpen(false); }} onExport={exportCompletion} preview={<MapDrawingPreview project={project} presentation={lastCanvasPresentation.current} />} /> : stageScreens[displayedStage];
  useEffect(() => {
    if (!completionOpen) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('completion-title')?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [completionOpen]);
  const returnFromMapPreview = () => {
    setMapPreviewOpen(false);
    logPrototype('map_preview_closed', { stageIndex: project.stage }, STAGES[project.stage].label);
  };
  const openMapPreview = () => {
    if (mapPreviewOpen || project.stage >= 1) {
      workspaceRef.current?.focus();
      return;
    }
    if (!memoFirstWorkflow && requiresInitialModel(projectRef.current)) {
      setStage(1);
      toast('Continue from Memo review to start your map', 'error');
      return;
    }
    setMapPreviewOpen(true);
    logPrototype('map_previewed', { stageIndex: project.stage, nodeCount: project.graph.nodes.length, edgeCount: project.graph.edges.length }, STAGES[project.stage].label);
  };
  const openProjects = () => {
    if (!flushPersistence()) return;
    setPendingLevelRead(null);
    const dashboard = onOpenProjects || onAccountDashboard;
    if (dashboard) { void dashboard(); return; }
    setMapPreviewOpen(false);
    setWorkspaceStarted(false);
  };

  const refreshAfterTeacherChange = async () => {
    const refreshed = await refreshPublicConfigurations();
    toast(refreshed ? 'Shared teacher configuration refreshed for this project.' : 'Revision saved, but the project snapshot could not be refreshed yet.', refreshed ? 'success' : 'error');
  };
  const observedConfigurationRevision = useRef(configurationRevision);
  useEffect(() => {
    if (observedConfigurationRevision.current === configurationRevision) return;
    observedConfigurationRevision.current = configurationRevision;
    if (institutionalMode) void refreshAfterTeacherChange();
    // An embedded instructor tab can publish while this map stays mounted.
    // Refresh its public configuration without replacing student work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configurationRevision]);

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
      <p>Choose how to continue. You can download a copy, keep working without saving, or try saving again.</p><p>The recovery file includes your full memo, Field Notes, and evidence. Keep it private.</p>
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
        {memoFirstWorkflow && <button className="text-button" type="button" onClick={() => setModal('project-details')}>Project details</button>}
        <button className="text-button" type="button" onClick={() => setModal('stages')}>Progress</button>
        <button className="text-button" type="button" onClick={() => setModal('exports')}>Export &amp; share</button>
        {onOpenAccount && <button className="text-button project-menu-account" type="button" onClick={() => { if (flushPersistence()) void onOpenAccount(); }}>Account</button>}
        <div className="project-menu-level"><LevelSelect label="Work level in Project menu" levels={workflowLevels} onSelect={selectWorkScale} /></div>
        <details><summary>Preferences</summary>{!memoFirstWorkflow && <SuggestionPreference project={project} update={update} />}<ThemeToggle dark={dark} onToggle={toggleTheme} showLabel /></details>
      </ProjectMenu>{onOpenAccount && <button className="text-button account-nav-button" type="button" onClick={() => { if (flushPersistence()) void onOpenAccount(); }}>Account</button>}<div ref={setMapToolbarHost} className="workspace-map-controls"><div className="notebook-toolbar-actions">{memoFirstWorkflow && <AboutSystemsMapping />}<span ref={bugReportDock} className="workspace-bug-report" /></div></div></div>
    </header>
    <div className="sr-only" aria-live="polite">{mapPreviewOpen ? `Viewing map. Current stage remains ${STAGES[project.stage].label}.` : `Current section ${STAGES[project.stage].label}`}</div>
    <main ref={workspaceRef} tabIndex="-1" id="workspace" className={`workspace workspace--stage-${displayedStage}${intakeOpen ? '' : ' workspace--studio'}`}>
      {cloudSaveStatus && <span className="sr-only" role="status">{cloudSaveStatus}</span>}
      {cloudError && <div className="account-error" role="alert"><p>{cloudError}</p><p>Private recovery includes your full memo, Field Notes, and evidence. Keep this file private.</p><button type="button" className="button button--secondary" onClick={downloadPrivateRecovery}>Download private recovery</button></div>}
      {['error', 'validation'].includes(saveState.status) && <div className="workspace-save-notice" role="alert"><span>{saveState.status === 'validation' ? 'Finish the map item to save' : 'Changes are not saved'}</span><button type="button" onClick={() => setModal(saveState.status === 'validation' ? 'validation' : 'storage')}>{saveState.status === 'validation' ? 'Review issue' : 'Recover project'}</button></div>}
      {screen}
    </main>
    {memoFirstWorkflow && intakeOpen ? null : completionOpen ? null : intakeOpen ? <footer className="app-footer">{mapPreviewOpen ? <><div className="footer-context"><strong>Map preview</strong><span>Current stage · {STAGES[project.stage].short}</span></div><div className="footer-actions"><button className="button" type="button" onClick={returnFromMapPreview}><Icon name="back" />Back to {STAGES[project.stage].short}</button></div></> : <><div className="footer-context"><strong>{STAGES[project.stage].label}</strong><span className="next-step-detail">{step.detail}</span></div><div className="footer-actions"><button className="button button--ghost" type="button" disabled={backDisabled} onClick={() => setStage(project.stage - 1)}><Icon name="back" />Back</button><button className="button" type="button" data-next-action={step.id} disabled={step.blocking} onClick={runNextStep}>{step.label}{project.stage !== 1 && <Icon name="arrow" />}</button></div></>}</footer> : null}
    <Modal open={modal === 'exports'} title="Export & share" onClose={() => setModal(null)}><ReviewPanel exportOnly presentationRef={lastCanvasPresentation} onProjectLink={() => setModal('project-link')} project={project} update={update} replaceProject={replaceProject} toast={toast} logPrototype={logPrototype} onValidationError={reportProjectValidationFailure} /></Modal>
    <Modal open={modal === 'stages'} title="Progress" onClose={() => setModal(null)}>
      <p className="modal-context">{SCALES[project.activeScale].label} · {STAGES[project.stage].short}</p>
      <section className="level-progress-summary" aria-labelledby="level-progress-title">
        <h2 id="level-progress-title">Level progression</h2>
        <ol>{SCALE_ORDER.map((scale) => <li key={scale}>{memoFirstWorkflow ? <button className="button button--secondary" type="button" onClick={() => selectWorkScale(scale)}>{MEMO_WORKFLOW[scale].title}</button> : <strong>{SCALES[scale].label}</strong>}<span>{levelProgressStatus(project, scale)}</span></li>)}</ol>
      </section>
      <div className="progress-actions"><button className="button button--ghost" type="button" onClick={() => setModal('project-link')}>Project link</button></div>
       {!memoFirstWorkflow && <ol className="stage-menu">{STAGES.map((stage, index) => {
         return <li key={stage.id}><button aria-label={stage.label} className={index === project.stage ? 'is-current' : ''} onClick={() => { if (setStage(index)) setModal(null); }}><strong><span aria-hidden="true">{index + 1}. </span>{stage.label}</strong>{index === project.stage ? <em>Current</em> : null}</button></li>;
       })}</ol>}
    </Modal>
    <Modal open={modal === 'project-details'} title="Project details" onClose={() => setModal(null)}>
      <div className="project-identity-fields">
        <Field label="Project title"><input maxLength={160} value={project.title} onChange={event=>update(draft=>{draft.title=event.target.value;},'project.title.changed','Changed project title')} /></Field>
        <Field label="Creator name"><input autoComplete="name" maxLength={160} value={project.participantName || ''} onChange={event=>update(draft=>{draft.participantName=event.target.value;},'project.creator.changed','Changed creator name')} /></Field>
        <button type="button" className="button" onClick={()=>setModal(null)}>Done</button>
      </div>
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
            <dt>Name or Group Name</dt>
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

export { AccessFrame, ThemeToggle, GraphCanvas, MapStage, Modal };
export default App;
import { projectStorage, institutionalLoginUrl } from './accountStorage.js';
import GuidanceProgress from './GuidanceProgress.jsx';
