import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEWPORT,
  PROJECT_LIMITS,
  PROJECT_SCHEMA_VERSION,
  RELATION_VOCABULARY,
  configFingerprint,
  createDefaultProject,
  createEvent,
  createPortableProject,
  evaluateSubmission,
  exportFileName,
  extractCandidates,
  parseProject,
  projectFileSlug,
  serializePortableProject,
  serializeProject,
  stableId,
  validateProject,
  withDefaultNodeLayout,
} from './domain.js';

function projectWithGraph() {
  const project = createDefaultProject();
  project.instructor.maxSharingTier = 'public';
  project.candidates = extractCandidates(project.submission);
  project.graph = structuredClone(project.candidates);
  return project;
}

function addAuthoritativePreflight(project, overrides = {}) {
  const config = project.configs.preflight;
  const capturedAt = '2026-08-09T12:00:00.000Z';
  const configurationSnapshot = {
    kind: 'preflight',
    activeScale: project.activeScale,
    capturedAt,
    shared: {
      fingerprint: 'shared-preflight-fingerprint',
      revision: 4,
      moduleVersions: [{ id: 'teacher-module-a', revision: 2, fingerprint: 'teacher-module-a-fingerprint' }],
    },
    projectOverlay: {
      id: config.id,
      profileVersion: config.profileVersion,
      outputSchemaVersion: config.outputSchemaVersion,
      label: config.label,
      provider: config.provider,
      baseModel: config.baseModel,
      contextLimit: config.contextLimit,
      confidenceThreshold: config.confidenceThreshold,
      relationVocabulary: [...config.relationVocabulary],
      revision: config.revision,
      fingerprint: config.fingerprint,
    },
    effectiveFingerprint: 'effective-server-fingerprint',
  };
  project.preflight = {
    memoReview: {
      guidance: [{
        point: 'The memo connects School and Committee through a referral.',
        evidenceExcerpt: 'The school refers the student to the committee.',
      }],
      nodes: [
        { label: 'School', type: 'organization', scale: 'meso', evidence: 'The school refers the student to the committee.' },
        { label: 'Committee', type: 'agency', scale: 'meso', evidence: 'The school refers the student to the committee.' },
      ],
      connections: [{ source: 'School', target: 'Committee', verb: 'refers', rationale: 'The memo names the referral directly.' }],
      example: 'One evident connection: School refers Committee, because the memo names the referral directly.',
      readiness: { ready: true, note: 'The memo already supports mapping. Continue to choose nodes and connections.' },
    },
    configurationSnapshot,
    evaluation: {
      evaluationId: '0123456789abcdefghijklmnopqrstuv',
      runtime: { provider: 'deterministic', model: 'STEM Splitter', createdAt: capturedAt },
      createdAt: capturedAt,
      expiresAt: '2026-08-10T12:00:00.000Z',
      ...overrides,
    },
    sourceFingerprint: project.submission.fingerprint || stableId('src', project.submission.text),
  };
  return project.preflight;
}

function legacyV1Project() {
  const project = projectWithGraph();
  project.schemaVersion = 1;
  delete project.viewport;
  delete project.mapAnnotation;
  [...project.candidates.nodes, ...project.graph.nodes].forEach((node) => {
    delete node.x;
    delete node.y;
    delete node.annotations;
  });
  [...project.candidates.edges, ...project.graph.edges].forEach((edge) => delete edge.annotation);
  return project;
}

describe('mapping domain', () => {
  it('creates stable identifiers', () => {
    expect(stableId('node', 'Family')).toBe(stableId('node', 'Family'));
    expect(stableId('node', 'Family')).not.toBe(stableId('node', 'School'));
  });

  it('keeps incrementally added nodes from occupying the same map space', () => {
    const bareNode = (index) => ({
      id: `node_${index}`,
      label: `Node ${index}`,
      type: 'organization',
      scale: 'micro',
      status: 'confirmed',
      claimState: 'research lead',
      notes: '',
    });
    let nodes = withDefaultNodeLayout(Array.from({ length: 3 }, (_, index) => bareNode(index)));
    const originalPositions = nodes.map(({ id, x, y }) => ({ id, x, y }));
    for (let index = 3; index < 14; index += 1) {
      nodes = withDefaultNodeLayout([...nodes, bareNode(index)]);
    }
    expect(nodes.slice(0, 3).map(({ id, x, y }) => ({ id, x, y }))).toEqual(originalPositions);
    for (let index = 0; index < nodes.length; index += 1) {
      for (let other = index + 1; other < nodes.length; other += 1) {
        expect(Math.abs(nodes[index].x - nodes[other].x) < 218
          && Math.abs(nodes[index].y - nodes[other].y) < 82).toBe(false);
      }
    }
  });

  it('passes the grounded demonstration memo', () => {
    const project = createDefaultProject();
    const result = evaluateSubmission(project.submission, project.activeScale, 6);
    expect(result.hardPass).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(6);
    expect(result.outcome).toBe('pass');
  });

  it('holds a sensitive memo without consent', () => {
    const project = createDefaultProject();
    const result = evaluateSubmission({ ...project.submission, sensitive: true, consent: false }, 'micro', 6);
    expect(result.outcome).toBe('hold');
    expect(result.hard.find((item) => item.id === 'H2').status).toBe('unmet');
  });

  it('holds a memo with fewer than two explicit relationships', () => {
    const project = createDefaultProject();
    const result = evaluateSubmission({ ...project.submission, text: 'How does this system work? The school provides one service to a family, but the memo does not yet identify the remaining people, groups, and mechanisms.' }, 'micro', 6);
    expect(result.outcome).toBe('hold');
    expect(result.hard.find((item) => item.id === 'H4').status).toBe('unmet');
  });

  it('does not treat repeated relationship words as connections', () => {
    const project = createDefaultProject();
    const text = 'This record repeats the word funds twice without making an actual relational claim: funds. It contains enough filler text to pass the minimum memo length requirement.';
    const result = evaluateSubmission({ ...project.submission, text }, 'integration', 6);
    const h4 = result.hard.find((item) => item.id === 'H4');
    expect(h4.status).toBe('unmet');
    expect(h4.relationshipCount).toBe(0);
    expect(result.outcome).toBe('hold');
  });

  it('classifies every hard-pass result below threshold as conditional', () => {
    const project = createDefaultProject();
    const text = 'Council funds Clinic. Clinic serves Residents. Plain descriptive filler records the arrangement in neutral language without additional analytical signals or uncertainty markers.';
    const result = evaluateSubmission({ ...project.submission, text }, 'integration', 6);
    expect(result.hardPass).toBe(true);
    expect(result.score).toBeLessThan(5);
    expect(result.outcome).toBe('conditional');
  });

  it('extracts proposed nodes and edges without mutating the graph', () => {
    const project = createDefaultProject();
    const candidates = extractCandidates(project.submission);
    expect(candidates.nodes.length).toBeGreaterThan(5);
    expect(candidates.edges.length).toBeGreaterThan(3);
    expect(project.graph.nodes).toHaveLength(0);
    expect(candidates.edges.every((edge) => RELATION_VOCABULARY.includes(edge.verb))).toBe(true);
    expect(candidates.edges.every((edge) => edge.evidenceExcerpt && edge.evidenceHash === stableId('evh', edge.evidenceExcerpt))).toBe(true);
    expect(candidates.nodes.find((node) => node.label === 'Parent Advocacy Organizations')).toMatchObject({ type: 'organization', scale: 'meso' });
    expect(candidates.nodes.find((node) => /Ability to Secure Services/.test(node.label))).toMatchObject({ type: 'resource' });
    expect(candidates.nodes.some((node) => node.label === 'Interviews')).toBe(false);
    expect(candidates.nodes.find((node) => node.label === 'Published Case Reports')).toBeDefined();
  });

  it('extracts generic relationships outside the demonstration vocabulary', () => {
    const project = createDefaultProject();
    const text = 'How does the organization shape policy in Queens? The organization provides support and enables capacity. According to a source, however, results may be uncertain and should be checked.';
    const submission = { ...project.submission, text };
    expect(evaluateSubmission(submission, 'macro', 6).outcome).toBe('pass');
    const candidates = extractCandidates(submission);
    expect(candidates.nodes.length).toBeGreaterThan(0);
    expect(candidates.edges.map((edge) => edge.verb)).toEqual(expect.arrayContaining(['shapes', 'provides', 'enables']));
  });

  it('deduplicates repeated semantic edges while retaining distinct evidence records', () => {
    const project = createDefaultProject();
    const candidates = extractCandidates({ ...project.submission, text: 'Council funds Clinic. Council funds Clinic.' });
    expect(candidates.edges).toHaveLength(1);
    expect(candidates.edges[0].evidenceRefs).toHaveLength(2);
    expect(new Set(candidates.edges[0].evidenceRefs.map((reference) => reference.evidenceId)).size).toBe(2);
  });

  it('fingerprints the complete effective configuration', () => {
    const project = createDefaultProject();
    const config = project.configs.preflight;
    expect(config.profileVersion).toBe('1.0.0');
    expect(config.outputSchemaVersion).toBe('systems-mapping.preflight-result.v1');
    expect(config.baseModel).toBe('STEM Splitter');
    expect(project.configs.builder.baseModel).toBe('STEM Splitter');
    expect(configFingerprint({ ...config, fixedPrompt: 'Guardrail A' })).not.toBe(configFingerprint({ ...config, fixedPrompt: 'Guardrail B' }));
    expect(configFingerprint({ ...config, outputSchemaVersion: 'v2' })).not.toBe(configFingerprint(config));
  });

  it('round-trips supported project exports', () => {
    const project = createDefaultProject();
    expect(parseProject(serializeProject(project)).id).toBe(project.id);
  });

  it('strictly validates and migrates authoritative evaluation provenance without accepting server-internal fields', () => {
    const project = createDefaultProject();
    addAuthoritativePreflight(project);
    const restored = parseProject(serializeProject(project));
    expect(restored.preflight.evaluation).toEqual(project.preflight.evaluation);
    expect(restored.preflight.configurationSnapshot.shared.moduleVersions).toEqual([
      { id: 'teacher-module-a', revision: 2, fingerprint: 'teacher-module-a-fingerprint' },
    ]);
    expect(restored.preflight.configurationSnapshot.projectOverlay).not.toHaveProperty('fixedPrompt');
    expect(restored.preflight.configurationSnapshot.projectOverlay).not.toHaveProperty('customInstructions');

    const cloudRuntime = structuredClone(project);
    cloudRuntime.preflight.evaluation.runtime = {
      provider: 'ollama-cloud',
      model: 'gpt-oss:120b',
      maxSourceBytes: 131072,
      createdAt: cloudRuntime.preflight.evaluation.createdAt,
      promptEvalCount: 2048,
    };
    expect(() => validateProject(cloudRuntime)).not.toThrow();

    const internalField = structuredClone(project);
    internalField.preflight.evaluation.studentSessionRef = 'must-not-persist';
    expect(() => validateProject(internalField)).toThrow(/studentSessionRef is not an allowed schema field/);

    const unknownRuntime = structuredClone(project);
    unknownRuntime.preflight.evaluation.runtime.privateProviderPayload = 'must-not-persist';
    expect(() => validateProject(unknownRuntime)).toThrow(/privateProviderPayload is not an allowed schema field/);

    const invalidExpiry = structuredClone(project);
    invalidExpiry.preflight.evaluation.expiresAt = invalidExpiry.preflight.evaluation.createdAt;
    expect(() => validateProject(invalidExpiry)).toThrow(/expiresAt must be later than createdAt/);

    const invalidCapability = structuredClone(project);
    invalidCapability.preflight.evaluation.evaluationId = 'not-a-server-capability';
    expect(() => validateProject(invalidCapability)).toThrow(/server-issued capability/);

    const tooMuchGuidance = structuredClone(project);
    tooMuchGuidance.preflight.memoReview.guidance = Array.from({ length: PROJECT_LIMITS.memoGuidanceItems + 1 }, (_, index) => ({ point: `Point ${index + 1}` }));
    expect(() => validateProject(tooMuchGuidance)).toThrow(new RegExp(`no more than ${PROJECT_LIMITS.memoGuidanceItems} items`));

    const oversizedPoint = structuredClone(project);
    oversizedPoint.preflight.memoReview.guidance[0].point = 'x'.repeat(PROJECT_LIMITS.memoGuidanceText + 1);
    expect(() => validateProject(oversizedPoint)).toThrow(/point must contain no more/);

    const oversizedEvidence = structuredClone(project);
    oversizedEvidence.preflight.memoReview.guidance[0].evidenceExcerpt = 'x'.repeat(PROJECT_LIMITS.memoGuidanceEvidence + 1);
    expect(() => validateProject(oversizedEvidence)).toThrow(/evidenceExcerpt must contain no more/);

    const privateGuidanceField = structuredClone(project);
    privateGuidanceField.preflight.memoReview.guidance[0].criterionId = 'H2';
    expect(() => validateProject(privateGuidanceField)).toThrow(/criterionId is not an allowed schema field/);

    const selfLoop = structuredClone(project);
    selfLoop.preflight.memoReview.connections[0].target = selfLoop.preflight.memoReview.connections[0].source;
    expect(() => validateProject(selfLoop)).toThrow(/must differ from source/);

    const priorV2 = createDefaultProject();
    priorV2.preflight = evaluateSubmission(priorV2.submission, priorV2.activeScale, 6);
    priorV2.preflight.hardPass = false;
    priorV2.preflight.outcome = 'hold';
    const migratedPreflight = parseProject(JSON.stringify(priorV2)).preflight;
    expect(migratedPreflight).toBeNull();
  });

  it('migrates every legacy preflight shape to a clean slate and round-trips the memo review', () => {
    const legacyRubric = createDefaultProject();
    legacyRubric.preflight = evaluateSubmission(legacyRubric.submission, legacyRubric.activeScale, 6);
    legacyRubric.preflight.review = {
      submissionId: 'review_0123456789abcdefghijklmnop',
      status: 'approved',
      revision: 2,
      submittedAt: '2026-08-09T12:00:00.000Z',
      decision: 'revise_and_approve',
      instructorAnnotation: 'Keep the evidence boundary explicit.',
      revisedSuggestion: 'What changes if the referral handoff is treated as contested?',
    };
    expect(parseProject(JSON.stringify(legacyRubric)).preflight).toBeNull();

    const legacyRedirects = createDefaultProject();
    legacyRedirects.preflight = { redirects: [{ action: 'Old redirect action.' }], configurationSnapshot: null, evaluation: null, review: null };
    expect(parseProject(JSON.stringify(legacyRedirects)).preflight).toBeNull();

    const project = createDefaultProject();
    addAuthoritativePreflight(project);
    expect(parseProject(serializeProject(project)).preflight).toEqual(project.preflight);

    const internalField = structuredClone(project);
    internalField.preflight.memoReview.studentSessionRef = 'must-not-persist';
    expect(() => validateProject(internalField)).toThrow(/studentSessionRef is not an allowed schema field/);

    const invalidReadiness = structuredClone(project);
    invalidReadiness.preflight.memoReview.readiness.ready = 'yes';
    expect(() => validateProject(invalidReadiness)).toThrow(/ready must be a boolean/);

    const unknownNodeType = structuredClone(project);
    unknownNodeType.preflight.memoReview.nodes[0].type = 'planet';
    expect(() => validateProject(unknownNodeType)).toThrow(/type must be one of/);
  });

  it('removes the evaluation capability from every portable tier and redacts sensitive memo-review prose while preserving provenance', () => {
    const project = createDefaultProject();
    project.instructor.maxSharingTier = 'public';
    project.submission.sensitive = true;
    project.submission.consent = true;
    addAuthoritativePreflight(project);
    project.events.push(createEvent('preflight.completed', 'Legacy event fixture', 'student', {
      result: { hard: [{ id: 'H1', status: 'unmet' }], scored: [], score: 7, threshold: 6, outcome: 'hold', retainedReference: 'safe' },
    }));

    const privatePortable = createPortableProject(project, 'private');
    expect(Object.keys(privatePortable.preflight).sort()).toEqual(['configurationSnapshot', 'evaluation', 'memoReview', 'sourceFingerprint']);
    expect(privatePortable.preflight).not.toHaveProperty('hard');
    expect(privatePortable.preflight).not.toHaveProperty('scored');
    const portableLegacyResult = privatePortable.events.find((event) => event.detail === 'Legacy event fixture').result;
    expect(portableLegacyResult).toEqual({ retainedReference: 'safe' });
    expect(privatePortable.portableExport.redactions).toContainEqual(expect.objectContaining({ path: expect.stringMatching(/\.result\.hard$/) }));
    expect(privatePortable.preflight.memoReview).toEqual(project.preflight.memoReview);
    expect(privatePortable.preflight.evaluation).toMatchObject({
      evaluationId: '[redacted]',
      runtime: { provider: 'deterministic', model: 'STEM Splitter' },
    });
    expect(privatePortable.portableExport.redactions).toContainEqual(expect.objectContaining({ path: 'preflight.evaluation.evaluationId' }));

    const coursePortable = createPortableProject(project, 'course');
    expect(coursePortable.preflight.memoReview).toBeNull();
    expect(coursePortable.portableExport.redactions.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      'preflight.evaluation.evaluationId',
      'preflight.memoReview',
    ]));
    expect(parseProject(JSON.stringify(coursePortable)).preflight.memoReview).toBeNull();
  });

  it('migrates schema v1 with deterministic layout, complete annotations, and no note loss', () => {
    const legacy = legacyV1Project();
    legacy.graph.nodes[0].notes = 'Keep this existing analytical note exactly.';
    legacy.candidates.nodes.find((node) => node.id === legacy.graph.nodes[0].id).notes = 'Keep the candidate note too.';
    const legacyGovernance = (configKind) => ({
      configKind,
      scale: 'micro',
      fingerprint: `${configKind}_shared`,
      revision: 1,
      moduleVersions: [],
      effectivePrompt: 'Legacy prompt bytes must not persist in the student project.',
      fixedGuardrails: 'Legacy fixed guardrail bytes',
    });
    legacy.teacherGovernance = { preflight: legacyGovernance('preflight'), builder: legacyGovernance('builder'), refreshedAt: legacy.updatedAt };
    const source = JSON.stringify(legacy);
    const migrated = parseProject(source);
    const migratedAgain = parseProject(source);
    const node = migrated.graph.nodes[0];
    const candidate = migrated.candidates.nodes.find((item) => item.id === node.id);

    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.viewport).toEqual(DEFAULT_VIEWPORT);
    expect(migrated.mapAnnotation).toEqual({ id: stableId('annotation', `${migrated.id}:map`), text: '' });
    expect(node.notes).toBe('Keep this existing analytical note exactly.');
    expect(candidate.notes).toBe('Keep the candidate note too.');
    expect({ x: node.x, y: node.y }).toEqual({ x: candidate.x, y: candidate.y });
    expect(node.annotations.analytical.id).toBe(candidate.annotations.analytical.id);
    expect(node.annotations.evidence.id).not.toBe(node.annotations.analytical.id);
    expect(migrated.teacherGovernance.preflight).not.toHaveProperty('effectivePrompt');
    expect(migrated.teacherGovernance.preflight).not.toHaveProperty('fixedGuardrails');
    expect(migrated.teacherGovernance.preflight.guardrailsFingerprint).toMatch(/^guardrails_/);
    expect(migratedAgain.graph.nodes.map(({ id, x, y }) => ({ id, x, y })))
      .toEqual(migrated.graph.nodes.map(({ id, x, y }) => ({ id, x, y })));
  });

  it('migrates earlier stage layouts into the five-stage progression without imposing scale order', () => {
    const stageMap = [0, 0, 1, 1, 2, 3, 4];
    stageMap.forEach((expected, formerStage) => {
      const legacy = createDefaultProject();
      legacy.schemaVersion = 2;
      legacy.stage = formerStage;
      legacy.furthestStage = formerStage;
      const migrated = parseProject(JSON.stringify(legacy));
      expect(migrated.stage).toBe(expected);
      expect(migrated.furthestStage).toBe(expected);
    });

    const priorMapStage = createDefaultProject();
    priorMapStage.schemaVersion = 3;
    priorMapStage.stage = 4;
    priorMapStage.furthestStage = 5;
    expect(parseProject(JSON.stringify(priorMapStage))).toMatchObject({ stage: 3, furthestStage: 4 });

    [0, 0, 1, 2, 2, 3, 4].forEach((expected, formerStage) => {
      const priorSevenStageProject = createDefaultProject();
      priorSevenStageProject.schemaVersion = 4;
      priorSevenStageProject.stage = formerStage;
      priorSevenStageProject.furthestStage = formerStage;
      expect(parseProject(JSON.stringify(priorSevenStageProject))).toMatchObject({ stage: expected, furthestStage: expected });
    });

    const variedScaleOrder = createDefaultProject();
    variedScaleOrder.releasedScales = ['micro', 'macro'];
    variedScaleOrder.activeScale = 'macro';
    expect(parseProject(serializeProject(variedScaleOrder))).toMatchObject({
      activeScale: 'macro',
      releasedScales: ['micro', 'macro'],
    });
  });

  it('round-trips exact layout, viewport, and every annotation surface', () => {
    const project = projectWithGraph();
    project.graph.nodes[0].x = -321.25;
    project.graph.nodes[0].y = 876.5;
    project.graph.nodes[0].annotations.analytical.text = 'Analytical interpretation';
    project.graph.nodes[0].annotations.evidence.text = 'Evidence qualification';
    project.graph.edges[0].annotation.text = 'Relationship interpretation';
    project.viewport = { panX: 231.5, panY: -144.25, zoom: 1.75 };
    project.mapAnnotation.text = 'The evolving map remains contested.';

    const restored = parseProject(serializeProject(project));
    expect(restored.graph.nodes[0]).toMatchObject({
      x: -321.25,
      y: 876.5,
      annotations: {
        analytical: { id: project.graph.nodes[0].annotations.analytical.id, text: 'Analytical interpretation' },
        evidence: { id: project.graph.nodes[0].annotations.evidence.id, text: 'Evidence qualification' },
      },
    });
    expect(restored.graph.edges[0].annotation).toEqual(project.graph.edges[0].annotation);
    expect(restored.viewport).toEqual(project.viewport);
    expect(restored.mapAnnotation).toEqual(project.mapAnnotation);
  });

  it('rejects non-finite and out-of-range map geometry', () => {
    const nonFinite = projectWithGraph();
    nonFinite.graph.nodes[0].x = Number.NaN;
    expect(() => validateProject(nonFinite)).toThrow(/graph\.nodes\[0\]\.x must be a finite number/);

    const outOfRangeNode = projectWithGraph();
    outOfRangeNode.graph.nodes[0].y = PROJECT_LIMITS.coordinateMax + 1;
    expect(() => validateProject(outOfRangeNode)).toThrow(/graph\.nodes\[0\]\.y must be a finite number/);

    const outOfRangeViewport = projectWithGraph();
    outOfRangeViewport.viewport.zoom = PROJECT_LIMITS.zoomMax + 0.01;
    expect(() => parseProject(JSON.stringify(outOfRangeViewport))).toThrow(/viewport\.zoom must be a finite number/);
  });

  it('enforces source, collection, evidence, annotation, metadata, and nesting limits', () => {
    const oversizedSource = createDefaultProject();
    oversizedSource.submission.text = 'x'.repeat(PROJECT_LIMITS.sourceText + 1);
    expect(() => parseProject(JSON.stringify(oversizedSource))).toThrow(/submission\.text must contain no more/);

    const oversizedNodes = createDefaultProject();
    oversizedNodes.graph.nodes = withDefaultNodeLayout(Array.from({ length: PROJECT_LIMITS.nodes + 1 }, (_, index) => ({
      id: `node_${index}`,
      label: `Node ${index}`,
      type: 'event',
      scale: 'micro',
      status: 'confirmed',
      claimState: 'inference',
      notes: '',
    })));
    expect(() => validateProject(oversizedNodes)).toThrow(/no more than 500 nodes/);

    const oversizedEvents = createDefaultProject();
    oversizedEvents.events = Array.from({ length: PROJECT_LIMITS.events + 1 }, (_, index) => ({
      id: `evt_${index}`,
      action: 'test.recorded',
      detail: 'bounded',
      actor: 'student',
      at: '2026-08-08T00:00:00.000Z',
    }));
    expect(() => validateProject(oversizedEvents)).toThrow(/no more than 2000 events/);

    const oversizedEvidence = projectWithGraph();
    const reference = structuredClone(oversizedEvidence.graph.nodes[0].evidenceRefs[0]);
    delete reference.evidenceRefs;
    oversizedEvidence.graph.nodes[0].evidenceRefs = Array.from({ length: PROJECT_LIMITS.evidenceRefs + 1 }, () => structuredClone(reference));
    expect(() => validateProject(oversizedEvidence)).toThrow(/evidenceRefs must contain no more/);

    const oversizedAnnotation = projectWithGraph();
    oversizedAnnotation.graph.edges[0].annotation.text = 'a'.repeat(PROJECT_LIMITS.annotationText + 1);
    expect(() => validateProject(oversizedAnnotation)).toThrow(/annotation\.text must contain no more/);

    const oversizedMetadata = createDefaultProject();
    oversizedMetadata.events[0].operations = Array.from({ length: PROJECT_LIMITS.metadataCollection + 1 }, (_, index) => index);
    expect(() => validateProject(oversizedMetadata)).toThrow(/no more than 1000 metadata entries/);

    const deeplyNested = createDefaultProject();
    let nested = { value: 'bounded' };
    for (let depth = 0; depth <= PROJECT_LIMITS.nestingDepth; depth += 1) nested = { nested };
    deeplyNested.events[0].metadata = nested;
    expect(() => parseProject(JSON.stringify(deeplyNested))).toThrow(/must not exceed 20 levels of nesting/);

    expect(() => parseProject(' '.repeat(PROJECT_LIMITS.importBytes + 1))).toThrow(/file exceeds/);
  });

  it('enforces stable annotation ownership and graph references', () => {
    const project = projectWithGraph();
    expect(() => validateProject(project)).not.toThrow();
    const duplicateAnnotation = projectWithGraph();
    duplicateAnnotation.graph.nodes[1].annotations.analytical.id = duplicateAnnotation.graph.nodes[0].annotations.analytical.id;
    expect(() => validateProject(duplicateAnnotation)).toThrow(/duplicates an annotation owned/);
    const unstableAnnotation = projectWithGraph();
    unstableAnnotation.graph.nodes[0].annotations.analytical.id = 'annotation_changed';
    expect(() => validateProject(unstableAnnotation)).toThrow(/must remain .* for node:/);
    const invalidReference = projectWithGraph();
    invalidReference.graph.edges[0].target = 'node_missing';
    expect(() => validateProject(invalidReference)).toThrow(/references unknown node/);
  });

  it('rejects unsupported imports', () => {
    expect(() => parseProject('{"schemaVersion":6}')).toThrow(/not a supported/);
  });

  it('rejects structurally incomplete and policy-escalating imports', () => {
    expect(() => parseProject('{"schemaVersion":1,"id":"x","submission":{"text":"ok"},"graph":{}}')).toThrow(/project\.title must be a string/);
    const project = createDefaultProject();
    project.sharingTier = 'public';
    expect(() => parseProject(JSON.stringify(project))).toThrow(/cannot exceed project\.instructor\.maxSharingTier/);
  });

  it('rejects credential and unrelated account fields at any project depth', () => {
    const project = createDefaultProject();
    project.events[0].metadata = { accessToken: 'must-never-travel' };
    expect(() => parseProject(JSON.stringify(project))).toThrow(/credential or unrelated account field/);
  });

  it('rejects top-level canaries before a sensitive portable export can clone them', () => {
    const project = projectWithGraph();
    project.submission.sensitive = true;
    project.submission.consent = true;
    project.privateInterviewTranscript = 'must not travel';
    expect(() => createPortableProject(project, 'public')).toThrow(/project\.privateInterviewTranscript is not an allowed schema field/);
  });

  it('rejects nested canaries on every schema-owned surface for restricted-rights export', () => {
    const mutations = [
      ['submission', (project) => { project.submission.privateInterviewTranscript = 'must not travel'; }],
      ['config', (project) => { project.configs.preflight.privateInterviewTranscript = 'must not travel'; }],
      ['config history', (project) => { project.configs.preflight.history.push({ revision: 1, fingerprint: project.configs.preflight.fingerprint, changeNote: '', at: project.createdAt, privateInterviewTranscript: 'must not travel' }); }],
      ['instructor', (project) => { project.instructor.privateInterviewTranscript = 'must not travel'; }],
      ['candidate container', (project) => { project.candidates.privateInterviewTranscript = 'must not travel'; }],
      ['node', (project) => { project.graph.nodes[0].privateInterviewTranscript = 'must not travel'; }],
      ['node annotations', (project) => { project.graph.nodes[0].annotations.privateInterviewTranscript = 'must not travel'; }],
      ['node annotation', (project) => { project.graph.nodes[0].annotations.analytical.privateInterviewTranscript = 'must not travel'; }],
      ['evidence reference', (project) => { project.graph.nodes[0].evidenceRefs[0].privateInterviewTranscript = 'must not travel'; }],
      ['graph container', (project) => { project.graph.privateInterviewTranscript = 'must not travel'; }],
      ['edge', (project) => { project.graph.edges[0].privateInterviewTranscript = 'must not travel'; }],
      ['edge annotation', (project) => { project.graph.edges[0].annotation.privateInterviewTranscript = 'must not travel'; }],
      ['viewport', (project) => { project.viewport.privateInterviewTranscript = 'must not travel'; }],
      ['map annotation', (project) => { project.mapAnnotation.privateInterviewTranscript = 'must not travel'; }],
      ['preflight', (project) => { addAuthoritativePreflight(project); project.preflight.privateInterviewTranscript = 'must not travel'; }],
      ['memo review guidance', (project) => { addAuthoritativePreflight(project); project.preflight.memoReview.guidance[0].privateInterviewTranscript = 'must not travel'; }],
      ['teacher governance', (project) => {
        const snapshot = (configKind) => ({ configKind, scale: 'micro', fingerprint: `${configKind}_fingerprint`, revision: 1, moduleVersions: [] });
        project.teacherGovernance = { preflight: snapshot('preflight'), builder: snapshot('builder'), refreshedAt: project.updatedAt, privateInterviewTranscript: 'must not travel' };
      }],
    ];

    mutations.forEach(([surface, mutate]) => {
      const project = projectWithGraph();
      project.submission.sensitive = false;
      project.submission.rights = 'Course use only';
      mutate(project);
      expect(() => createPortableProject(project, 'public'), surface).toThrow(/privateInterviewTranscript is not an allowed schema field/);
    });

    const portable = createPortableProject(projectWithGraph(), 'public');
    portable.portableExport.privateInterviewTranscript = 'must not travel';
    expect(() => validateProject(portable)).toThrow(/portableExport\.privateInterviewTranscript is not an allowed schema field/);

    const portableRedaction = createPortableProject(projectWithGraph(), 'public');
    portableRedaction.portableExport.redactions[0].privateInterviewTranscript = 'must not travel';
    expect(() => validateProject(portableRedaction)).toThrow(/privateInterviewTranscript is not an allowed schema field/);
  });

  it('creates tier-aware portable exports without mutating stable references', () => {
    const project = createDefaultProject();
    project.instructor.maxSharingTier = 'public';
    project.submission.sensitive = true;
    project.submission.consent = true;
    project.candidates = extractCandidates(project.submission);
    project.graph = structuredClone(project.candidates);
    const originalText = project.submission.text;
    const personOrFamily = project.graph.nodes.find((node) => node.type === 'person' || node.type === 'family');
    project.inquiry = `How does access affect ${personOrFamily.label}?`;
    project.reflection = `${personOrFamily.label} described a private experience.`;
    personOrFamily.notes = 'Identifying analytical note';
    project.events.push(createEvent('node.revised', personOrFamily.label, 'student', { operations: [{ label: personOrFamily.label, notes: 'Private operation note' }] }));
    const portable = createPortableProject(project, 'public');
    const portableNode = portable.graph.nodes.find((node) => node.id === personOrFamily.id);
    expect(project.submission.text).toBe(originalText);
    expect(portable.submission.text).toBe('');
    expect(portableNode.id).toBe(personOrFamily.id);
    expect(portableNode.label).not.toBe(personOrFamily.label);
    expect(portableNode.evidenceHash).toBe(personOrFamily.evidenceHash);
    expect(portableNode.evidenceExcerpt).toBeUndefined();
    expect(portable.submission.title).toBe('[redacted]');
    expect(portable.inquiry).toBe('[redacted]');
    expect(portable.reflection).toBe('[redacted]');
    expect(portableNode.notes).toBe('');
    expect(portable.events.at(-1).detail).toBe('[redacted]');
    expect(portable.events.at(-1).operations[0].label).toBe(portableNode.label);
    expect(portable.events.at(-1).operations[0].notes).toBe('[redacted]');
    expect(portable.portableExport.redacted).toBe(true);
    expect(parseProject(serializePortableProject(project, 'public')).id).toBe(project.id);
  });

  it('redacts restricted non-sensitive derived text while preserving stable references', () => {
    const project = projectWithGraph();
    project.submission.sensitive = false;
    project.submission.rights = 'Course use only';
    project.reflection = 'A private derived reflection';
    project.mapAnnotation.text = 'A private map interpretation';
    [...project.candidates.nodes, ...project.graph.nodes].forEach((node) => {
      node.notes = 'A private legacy note';
      node.annotations.analytical.text = 'A private analytical annotation';
      node.annotations.evidence.text = 'A private evidence annotation';
    });
    [...project.candidates.edges, ...project.graph.edges].forEach((edge) => {
      edge.notes = 'A private relationship note';
      edge.rationale = 'A private relationship rationale';
      edge.annotation.text = 'A private relationship annotation';
    });
    const node = project.graph.nodes[0];
    project.events.push(createEvent('node.revised', 'A private event detail', 'student', {
      sourceFingerprint: 'src_safe',
      configRevision: 3,
      operations: { nodes: [node.id], label: node.label, notes: 'A nested private note' },
      configurationSnapshot: { fingerprint: 'cfg_safe', fixedPrompt: 'A private nested prompt' },
      privateInterviewTranscript: 'A nested extension canary',
    }));

    const portable = createPortableProject(project, 'public');
    const portableNode = portable.graph.nodes.find((item) => item.id === node.id);
    const portableEdge = portable.graph.edges[0];
    const portableEvent = portable.events.at(-1);
    expect(project.mapAnnotation.text).toBe('A private map interpretation');
    expect(portable.submission.text).toBe('');
    expect(portable.reflection).toBe('[redacted]');
    expect(portable.mapAnnotation).toEqual({ id: project.mapAnnotation.id, text: '' });
    expect(portableNode.x).toBe(node.x);
    expect(portableNode.annotations.analytical).toEqual({ id: node.annotations.analytical.id, text: '' });
    expect(portableNode.annotations.evidence).toEqual({ id: node.annotations.evidence.id, text: '' });
    expect(portableNode.notes).toBe('');
    expect(portableEdge.annotation.text).toBe('');
    expect(portableEdge.rationale).toBe('[redacted]');
    expect(portableEvent.detail).toBe('[redacted]');
    expect(portableEvent.operations.nodes).toEqual([node.id]);
    expect(portableEvent.operations.label).toBe('[redacted]');
    expect(portableEvent.operations.notes).toBe('[redacted]');
    expect(portableEvent.configurationSnapshot.fingerprint).toBe('cfg_safe');
    expect(portableEvent.configurationSnapshot.fixedPrompt).toBe('[redacted]');
    expect(portableEvent.privateInterviewTranscript).toBe('[redacted]');
    expect(parseProject(JSON.stringify(portable)).mapAnnotation.text).toBe('');
  });

  it('preserves immutable event metadata without allowing core-field replacement', () => {
    const event = createEvent('preflight.completed', 'pass: 8/8', 'student', { configRevision: 3, result: { outcome: 'pass' }, action: 'spoofed' });
    expect(event.configRevision).toBe(3);
    expect(event.result).toEqual({ outcome: 'pass' });
    expect(event.action).toBe('preflight.completed');
  });

  it('builds descriptive export file names from the project title', () => {
    const project = createDefaultProject();
    project.title = 'Access to Special-Education Services (NYC)!';
    expect(projectFileSlug(project)).toBe('access-to-special-education-services-nyc');
    const today = new Date().toISOString().slice(0, 10);
    expect(exportFileName(project, 'json')).toBe(`access-to-special-education-services-nyc-${today}.json`);
    expect(exportFileName(project, 'json', 'recovery')).toBe(`access-to-special-education-services-nyc-recovery-${today}.json`);
  });

  it('falls back to the memo title and then a stable default for export file names', () => {
    const project = createDefaultProject();
    project.title = '   ';
    project.submission.title = 'Café Crème: A Memo';
    expect(projectFileSlug(project)).toBe('cafe-creme-a-memo');
    project.submission.title = '';
    expect(projectFileSlug(project)).toBe('systems-map');
    project.title = '!!!';
    expect(projectFileSlug(project)).toBe('systems-map');
    project.title = 'x'.repeat(200);
    expect(projectFileSlug(project)).toBe('x'.repeat(60));
  });
});
