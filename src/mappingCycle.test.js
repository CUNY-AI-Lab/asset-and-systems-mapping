import { describe, expect, it } from 'vitest';
import { createDefaultProject, stableId } from './domain.js';
import { requiresInitialModel, requiresLevelModel } from './mappingCycle.js';

describe('initial mapping cycle', () => {
  it('generates Meso guidance from carried Micro settings while preserving an existing Meso map', () => {
    const project = createDefaultProject();
    project.activeScale = 'meso'; project.graph.nodes.push({ id:'school', scale:'micro', type:'setting' });
    expect(requiresInitialModel(project)).toBe(false);
    expect(requiresLevelModel(project)).toBe(true);
    project.graph.nodes.push({ id:'home-school', scale:'meso', type:'linkage' });
    expect(requiresLevelModel(project)).toBe(false);
  });
  it('requires a model even if an empty project previously skipped stages', () => {
    const project = createDefaultProject();
    project.stage = 4;
    project.furthestStage = 4;
    project.completedScales = ['micro'];
    expect(requiresInitialModel(project)).toBe(true);
  });
  it('accepts a validated model review with no suggested items', () => {
    const project = createDefaultProject();
    project.preflight = { memoReview: { nodes: [], connections: [] }, evaluation: { id: 'validated' }, sourceFingerprint: project.submission.fingerprint || stableId('src', project.submission.text) };
    expect(requiresInitialModel(project)).toBe(false);
  });
  it('retains the seed after moving to another level', () => {
    const project = createDefaultProject();
    project.events.push({ action: 'preflight.completed', configurationSnapshot: {}, runtime: {}, evaluation: {} });
    expect(requiresInitialModel(project)).toBe(false);
  });
  it('preserves an existing legacy map as a continuation', () => {
    const project = createDefaultProject();
    project.graph.nodes.push({ id: 'existing-work' });
    expect(requiresInitialModel(project)).toBe(false);
  });
  it('does not treat undecided local candidates as a model seed', () => {
    const project = createDefaultProject();
    project.candidates.nodes.push({ status: 'pending', origin: 'student' });
    expect(requiresInitialModel(project)).toBe(true);
  });
  it('requires a new seed if the memo changed before any map was built', () => {
    const project = createDefaultProject();
    project.events.push({ action: 'preflight.completed', configurationSnapshot: {}, runtime: {}, evaluation: {}, sourceFingerprint: 'older-memo' });
    project.preflight = { memoReview: { nodes: [], connections: [] }, evaluation: {}, sourceFingerprint: 'older-memo' };
    expect(requiresInitialModel(project)).toBe(true);
  });
});
