import { describe, expect, it } from 'vitest';
import { createDefaultProject, stableId } from './domain.js';
import { evidenceGaps, levelRailState, levelStructureStatus, nextStep, panelModeForStage, stageForPanelMode, undecidedCandidates } from './nextStep.js';

function seeded(overrides = {}) {
  const project = createDefaultProject();
  project.submission.text = 'Maya attends the clinic and the library.';
  project.submission.fingerprint = stableId('src', project.submission.text);
  project.preflight = { memoReview: { nodes: [], connections: [] }, evaluation: { id: 'seed' }, sourceFingerprint: project.submission.fingerprint, configurationSnapshot: { activeScale: 'micro' } };
  return Object.assign(project, overrides);
}

describe('levelStructureStatus', () => {
  it('needs one live element at Micro', () => {
    const project = seeded();
    expect(levelStructureStatus(project, 'micro')).toEqual({ ready: false, missing: 'an element from your memo' });
    project.graph.nodes.push({ id: 'clinic', label: 'Clinic', type: 'setting', scale: 'micro', status: 'confirmed' });
    expect(levelStructureStatus(project, 'micro').ready).toBe(true);
  });
  it('needs a live Meso relationship between existing Micro items', () => {
    const project = seeded();
    project.graph.nodes.push({ id: 'clinic', scale: 'micro' }, { id: 'resident', scale: 'micro' });
    project.graph.edges.push({ id: 'relationship', source: 'clinic', target: 'resident', scale: 'meso', claimState: 'retired' });
    expect(levelStructureStatus(project, 'meso').ready).toBe(false);
    project.graph.edges[0].claimState = 'student interpretation';
    expect(levelStructureStatus(project, 'meso').ready).toBe(true);
    project.graph.nodes[1].claimState = 'retired';
    expect(levelStructureStatus(project, 'meso').ready).toBe(false);
  });
  it('needs an Exo node with a pathway into a Micro setting', () => {
    const project = seeded();
    project.graph.nodes.push({ id: 'clinic', label: 'Clinic', type: 'setting', scale: 'micro' }, { id: 'hra', label: 'HRA', type: 'agency', scale: 'exosphere' });
    expect(levelStructureStatus(project, 'exosphere').ready).toBe(true);
    project.graph.edges.push({ id: 'e1', source: 'hra', target: 'clinic', verb: 'funds', scale: 'exosphere' });
    expect(levelStructureStatus(project, 'exosphere').ready).toBe(true);
  });
  it('uses a Macro relationship involving a larger node instead of a legacy scope as readiness', () => {
    const project = seeded();
    project.graph.nodes.push({ id: 'office', label: 'City Housing Authority', type: 'agency', scale: 'exosphere' }, { id: 'person', label: 'Resident', type: 'person', scale: 'micro' });
    expect(levelStructureStatus(project, 'macrosphere').ready).toBe(false);
    project.graph.edges.push({ id: 'macro-edge', source: 'office', target: 'person', scale: 'macrosphere', verb: 'supports' });
    expect(levelStructureStatus(project, 'macrosphere').ready).toBe(true);
  });
});

describe('undecidedCandidates and evidenceGaps', () => {
  it('counts pending candidates and unevidenced live items at the active level only', () => {
    const project = seeded();
    project.candidates.nodes.push({ id: 'a', scale: 'micro', status: 'pending' }, { id: 'b', scale: 'meso', status: 'pending' }, { id: 'c', scale: 'micro', status: 'confirmed' });
    expect(undecidedCandidates(project, 'micro')).toHaveLength(1);
    project.graph.nodes.push({ id: 'c', label: 'Clinic', scale: 'micro', status: 'confirmed', claimState: 'supported', evidence: 'She goes weekly.' }, { id: 'd', label: 'Library', scale: 'micro', status: 'confirmed', claimState: 'inference' });
    expect(evidenceGaps(project, 'micro').map((item) => item.id)).toEqual(['d']);
  });
});

describe('nextStep', () => {
  it('starts with the memo review from intake', () => {
    const project = createDefaultProject();
    expect(nextStep(project)).toMatchObject({ id: 'start-review', label: 'Memo review', blocking: false });
  });
  it('blocks the first reading until a memo exists and while a read is running', () => {
    const project = createDefaultProject();
    project.stage = 1;
    project.submission.text = '';
    expect(nextStep(project)).toMatchObject({ id: 'read-memo', label: 'Continue →', blocking: true });
    project.submission.text = 'Memo text';
    expect(nextStep(project).blocking).toBe(false);
    expect(nextStep(project, { reviewBusy: true }).detail).toBe('Reading your memo…');
    expect(nextStep(project, { reviewBusy: true }).blocking).toBe(true);
    expect(nextStep(project, { retryPending: true }).blocking).toBe(true);
  });
  it('prepares saved suggestions without another model read', () => {
    const project = seeded({ stage: 1 });
    expect(nextStep(project)).toMatchObject({ id: 'prepare-candidates', detail: 'Review the suggestions' });
  });
  it('reports undecided suggestions before opening the map', () => {
    const project = seeded({ stage: 2 });
    project.candidates.nodes.push({ id: 'a', scale: 'micro', status: 'pending' }, { id: 'b', scale: 'micro', status: 'pending' });
    expect(nextStep(project)).toMatchObject({ id: 'open-map', label: 'Open map', detail: '2 suggestions to decide' });
  });
  it('names the missing structure, then evidence gaps, then readiness on the map', () => {
    const project = seeded({ stage: 3 });
    expect(nextStep(project)).toMatchObject({ id: 'review-level', label: 'Field Notes', detail: 'Add an element from your memo', structureReady: false });
    project.graph.nodes.push({ id: 'clinic', label: 'Clinic', type: 'setting', scale: 'micro', status: 'confirmed', claimState: 'inference' });
    expect(nextStep(project).detail).toBe('1 item needs evidence');
    project.graph.nodes[0].claimState = 'supported';
    project.graph.nodes[0].evidence = 'Weekly visits.';
    expect(nextStep(project).detail).toBe('Micro-level is ready to review');
  });
  it('continues to the next level, completes Macro once, then stops', () => {
    const project = seeded({ stage: 4, reflection: 'I will ask who coordinates between these settings.' });
    expect(nextStep(project)).toMatchObject({ id: 'continue-level', label: 'Continue to Meso' });
    project.activeScale = 'macrosphere';
    expect(nextStep(project)).toMatchObject({ id: 'complete-level', label: 'Complete Macro-level', blocking: false });
    project.completedScales = ['micro', 'meso', 'exosphere', 'macrosphere'];
    expect(nextStep(project)).toMatchObject({ id: 'project-complete', label: 'View summary', blocking: false });
  });

  it.each(['micro', 'meso', 'exosphere', 'macrosphere'])('requires a nonblank Field Note to complete %s while keeping the map available', activeScale => {
    const project = seeded({ activeScale, stage: 3, reflection: '  \n ' });
    expect(nextStep(project).blocking).toBe(false);
    project.stage = 4;
    expect(nextStep(project).blocking).toBe(true);
    project.reflection = 'Ask residents about missing pathways before adding new map items.';
    expect(nextStep(project).blocking).toBe(false);
  });
});

describe('level rail and panel modes', () => {
  it('derives rail state from released, completed and active levels', () => {
    const project = seeded();
    project.completedScales = ['micro'];
    project.releasedScales = ['micro', 'meso'];
    project.activeScale = 'meso';
    expect(levelRailState(project).map(({ scale, state }) => `${scale}:${state}`)).toEqual(['micro:complete', 'meso:current', 'exosphere:locked', 'macrosphere:locked']);
  });
  it('maps stages to panel modes and back', () => {
    expect([0, 1, 2, 3, 4].map(panelModeForStage)).toEqual(['suggestions', 'suggestions', 'suggestions', 'inspector', 'review']);
    const project = seeded();
    expect(stageForPanelMode('suggestions', project)).toBe(2);
    project.preflight = null;
    expect(stageForPanelMode('suggestions', project)).toBe(1);
    expect(stageForPanelMode('inspector', project)).toBe(3);
    expect(stageForPanelMode('review', project)).toBe(4);
  });
});
