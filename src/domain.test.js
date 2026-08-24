import { describe, expect, it } from 'vitest';
import {
  containsRetiredSystemsLanguage,
  DEFAULT_VIEWPORT,
  EXOSPHERE_NODE_TYPES,
  MACROSPHERE_NODE_TYPES,
  MICRO_NODE_TYPES,
  PROJECT_LIMITS,
  PROJECT_SCHEMA_VERSION,
  RELATION_VOCABULARY,
  SCALE_ORDER,
  configFingerprint,
  createDefaultProject,
  createEvent,
  createPortableProject,
  deterministicMemoReview,
  evaluateSubmission,
  exportFileName,
  extractCandidates,
  isDiscreteMicroNodeLabel,
  isMesosystemLabel,
  isNamedInstitutionLabel,
  isObviousLowerLevelMacroLabel,
  labelRepeatsInstitution,
  normalizeMapElementLabel,
  normalizeMicroNodeLabel,
  parseProject,
  projectFileSlug,
  scaleLexiconVerb,
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
  project.candidates.nodes.forEach((node) => {
    if (node.scale === 'meso') node.scale = 'micro';
    if (node.scale === 'micro' && !MICRO_NODE_TYPES.includes(node.type)) node.type = 'object';
  });
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
        { label: 'School', type: 'setting', scale: 'micro', evidence: 'The school refers the student to the committee.' },
        { label: 'Committee', type: 'group', scale: 'micro', evidence: 'The school refers the student to the committee.' },
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

function mappedNode({ id, label, type, scale, scopeNodeIds, deontic }) {
  return withDefaultNodeLayout([{
    id,
    label,
    type,
    scale,
    status: 'confirmed',
    claimState: 'student interpretation',
    notes: '',
    ...(scopeNodeIds ? { scopeNodeIds } : {}),
    ...(deontic ? { deontic } : {}),
  }])[0];
}

function mappedEdge({ id, source, target, verb, scale = 'exosphere' }) {
  return {
    id,
    source: source.id,
    target: target.id,
    sourceLabel: source.label,
    targetLabel: target.label,
    verb,
    scale,
    status: 'confirmed',
    claimState: 'student interpretation',
    notes: '',
    directed: true,
    annotation: { id: stableId('annotation', `edge:${id}:relationship`), text: '' },
  };
}

describe('mapping domain', () => {
  it('keeps the scale type allowlists explicit and non-overlapping where the model differs', () => {
    expect(MICRO_NODE_TYPES).toEqual(['person', 'role', 'group', 'family', 'activity', 'object', 'setting']);
    expect(EXOSPHERE_NODE_TYPES).toEqual(['organization', 'institution', 'agency', 'service', 'policy']);
    expect(MACROSPHERE_NODE_TYPES).toEqual(['policy', 'law', 'belief', 'economic condition', 'history', 'culture', 'structure']);
    expect(MICRO_NODE_TYPES).not.toContain('organization');
    expect(MICRO_NODE_TYPES).not.toContain('agency');
    expect(MICRO_NODE_TYPES).not.toContain('service');
    expect(MICRO_NODE_TYPES).not.toContain('resource');
  });

  it('defaults suggestions to Keep unless the teacher requires individual confirmation', () => {
    const project = createDefaultProject();
    expect(project.instructor.requireStudentConfirmation).toBe(false);
    project.instructor.requireStudentConfirmation = true;
    expect(() => validateProject(project)).not.toThrow();
  });

  it('builds deterministic Meso suggestions as scoped mesosystems without relationship verbs', () => {
    const carriedNodes = [
      { id: 'node_home_91f4', label: 'Rivera home', type: 'setting', scale: 'micro' },
      { id: 'node_classroom_7aa2', label: 'East Harlem transition classroom', type: 'setting', scale: 'micro' },
    ];
    const review = deterministicMemoReview({
      ...createDefaultProject().submission,
      text: 'Rivera home and East Harlem transition classroom coordinate transition planning.',
    }, 'meso', { carriedNodes });

    expect(review.connections).toEqual([]);
    expect(review.nodes).toEqual([expect.objectContaining({
      type: 'mesosystem',
      scale: 'meso',
      scope: expect.arrayContaining(carriedNodes.map(({ id, label }) => ({ id, label }))),
    })]);
    const studentText = JSON.stringify({ guidance: review.guidance, example: review.example, readiness: review.readiness });
    expect(studentText).toContain(carriedNodes[0].label);
    expect(studentText).toContain(carriedNodes[1].label);
    expect(studentText).not.toContain(carriedNodes[0].id);
    expect(studentText).not.toContain(carriedNodes[1].id);
    expect(review.guidance[0].point).toContain('as one mesosystem');
    expect(JSON.stringify(review)).not.toContain('"verb"');
    expect(studentText).not.toMatch(/offline reader|connects .* through/i);
  });

  it('creates stable identifiers', () => {
    expect(stableId('node', 'Family')).toBe(stableId('node', 'Family'));
    expect(stableId('node', 'Family')).not.toBe(stableId('node', 'School'));
  });

  it('resolves verbs against the closed outer-level registers', () => {
    expect(scaleLexiconVerb('exosphere', 'Funds')).toBe('funds');
    expect(scaleLexiconVerb('exosphere', 'oversees')).toBe('regulates');
    expect(scaleLexiconVerb('exosphere', 'synergizes')).toBeNull();
    expect(scaleLexiconVerb('macrosphere', 'requires')).toBe('mandates');
    expect(scaleLexiconVerb('macrosphere', 'synergizes')).toBeNull();
    expect(scaleLexiconVerb('micro', 'asks for help from')).toBe('asks for help from');
    expect(scaleLexiconVerb('meso', 'asks for help from')).toBeNull();
  });

  it('keeps references, temporal facts, actions, and incomplete phrases out of Micro labels', () => {
    [
      'he', 'she', 'they', 'him', 'her', 'them', 'his', 'hers', 'their', 'theirs',
      'it', 'its', 'we', 'us', 'our', 'ours', 'I', 'me', 'my', 'mine', 'you',
      'your', 'yours', 'this', 'that', 'these', 'those',
      'Monday', 'Tuesdays', 'September', 'March', '3:30 PM', '9 to 5',
      'Every Tuesday', 'Twice a week', 'Weekday mornings', 'Home Attendant’s Hours',
      'Marisol Either', 'Peer Support Group At a', 'Center near',
    ].forEach((label) => expect(normalizeMapElementLabel(label, { micro: true }), label).toBeNull());

    ['Rosa Works', 'Group Meets', 'Marcus Facilitates', 'Center Supports']
      .forEach((label) => expect(isDiscreteMicroNodeLabel(label), label).toBe(false));

    ['Tuesday Night Clinic', 'Tuesday peer support group', 'Department of Public Works', 'Published Case Reports']
      .forEach((label) => expect(isDiscreteMicroNodeLabel(label), label).toBe(true));
    expect(normalizeMapElementLabel('Unpredictable work schedules')).toBe('Unpredictable work schedules');
    expect(normalizeMapElementLabel('Marisol Both', { micro: true })).toBe('Marisol');
    expect(isDiscreteMicroNodeLabel('Marisol Both')).toBe(false);
  });

  it('accepts Meso noun phrases and rejects relationship propositions', () => {
    [
      'school–clinic information exchange',
      'home–school communication gap',
      'work–college coordination breakdown',
      'Work–online peer support coordination',
      'home–school support plan',
      'classroom–workplace transition planning',
    ].forEach((label) => expect(isMesosystemLabel(label), label).toBe(true));
    [
      'School partners with Clinic',
      'School shares records with Clinic',
      'School employs Clinic',
      'School and Clinic coordinate care',
      'School → Clinic',
      'CUNY administrative systems',
      'CUNY administrative coordination',
      'Employer institution',
      'Registrar and bursar coordination',
      'Disability services coordination',
      'Community organization coordination',
      'teacher–parent meeting pattern',
    ].forEach((label) => expect(isMesosystemLabel(label), label).toBe(false));
  });

  it('rejects retired interface metaphors without excluding conventional map labels', () => {
    [
      'Stuck',
      'Has energy',
      'Energy for change',
      'Ripples outward',
      'In the room with family',
      'Never in the room',
      'This ring holds services',
      'Pattern with no door',
      'Patterns without a door',
      'Doorless pattern',
      'No-door pattern',
      'The test for this ring',
      'If you could visit it',
      'It could email you',
      'It belongs further in',
    ].forEach((label) => {
      expect(containsRetiredSystemsLanguage(label), label).toBe(true);
      expect(isDiscreteMicroNodeLabel(label), label).toBe(false);
      expect(isMesosystemLabel(label), label).toBe(false);
    });

    expect(containsRetiredSystemsLanguage('classroom–workplace transition planning')).toBe(false);
    expect(isMesosystemLabel('classroom–workplace transition planning')).toBe(true);
    expect(containsRetiredSystemsLanguage('Energy costs')).toBe(false);
    expect(containsRetiredSystemsLanguage('Family support meeting room')).toBe(false);

    const project = createDefaultProject();
    const classroom = mappedNode({ id: 'node_classroom', label: 'Classroom', type: 'setting', scale: 'micro' });
    const workplace = mappedNode({ id: 'node_workplace', label: 'Workplace', type: 'setting', scale: 'micro' });
    const structure = mappedNode({
      id: 'node_retired_phrase',
      label: 'Patterns with no door',
      type: 'structure',
      scale: 'macrosphere',
      scopeNodeIds: [classroom.id, workplace.id],
      deontic: 'shapes',
    });
    project.releasedScales = [...SCALE_ORDER];
    project.graph.nodes = [classroom, workplace, structure];
    expect(() => validateProject(project)).toThrow(/must use a literal, conventional name/);
  });

  it('keeps named institutions at Exosphere and out of Macrosphere', () => {
    expect(isNamedInstitutionLabel('CUNY')).toBe(true);
    expect(isNamedInstitutionLabel('r/CUNY')).toBe(false);
    expect(isNamedInstitutionLabel('C.U.N.Y.')).toBe(true);
    expect(isNamedInstitutionLabel('Hunter College')).toBe(true);
    expect(isNamedInstitutionLabel('BMCC')).toBe(true);
    expect(isNamedInstitutionLabel('Access-A-Ride')).toBe(true);
    expect(isNamedInstitutionLabel('Medicaid')).toBe(true);
    expect(isNamedInstitutionLabel('ConEd')).toBe(true);
    expect(isNamedInstitutionLabel('Medicaid recertification rules')).toBe(true);
    expect(isNamedInstitutionLabel('home care agency')).toBe(false);
    expect(isNamedInstitutionLabel('legal services office')).toBe(false);
    expect(isNamedInstitutionLabel('TUESDAYS')).toBe(false);
    expect(isNamedInstitutionLabel('SCHOOL')).toBe(false);
    expect(isNamedInstitutionLabel('High New York City housing costs')).toBe(false);
    expect(labelRepeatsInstitution('CUNY affordability policy', [{ label: 'CUNY', type: 'institution' }])).toBe(true);
    expect(labelRepeatsInstitution('High New York City housing costs', [{ label: 'CUNY', type: 'institution' }])).toBe(false);

    const project = projectWithGraph();
    project.graph.edges = [];
    const scope = project.graph.nodes.slice(0, 2);
    scope.forEach((node) => { node.scale = 'micro'; node.type = 'setting'; });
    project.graph.nodes.push(withDefaultNodeLayout([{
      id: 'node_macro_cuny', label: 'CUNY', type: 'structure', scale: 'macrosphere',
      status: 'confirmed', claimState: 'student interpretation', notes: '', deontic: 'shapes',
      scopeNodeIds: scope.map(({ id }) => id),
    }])[0]);
    expect(() => validateProject(project)).toThrow(/names an institution and belongs at Exosphere/);
  });

  it('keeps immediate actors and schedules out of Macrosphere without excluding broader conditions', () => {
    [
      'Marcus Facilitates It',
      'Center Aide',
      'Home Attendant’s Hours',
      'Working student',
      'Social worker',
      'Maria Rivera helps family',
      'Home attendant schedule',
      'Therapy appointments',
    ].forEach((label) => expect(isObviousLowerLevelMacroLabel(label), label).toBe(true));

    [
      'Americans with Disabilities Act',
      'Medicaid eligibility and recertification policy',
      'HCBS waiver rules',
      'High housing and transportation costs',
      'Digital-first benefits administration',
      'Ableist expectations about work and independence',
      'Infrastructure inequality',
      'History of segregated disability services',
      'Unpredictable work schedules',
      'Student debt',
    ].forEach((label) => expect(isObviousLowerLevelMacroLabel(label), label).toBe(false));

    const project = createDefaultProject();
    const student = mappedNode({ id: 'node_student', label: 'Working student', type: 'role', scale: 'micro' });
    const workplace = mappedNode({ id: 'node_workplace', label: 'Workplace', type: 'setting', scale: 'micro' });
    project.releasedScales = [...SCALE_ORDER];
    project.graph.nodes = [student, workplace, mappedNode({
      id: 'node_bad_macro',
      label: 'Center Aide',
      type: 'structure',
      scale: 'macrosphere',
      scopeNodeIds: [student.id, workplace.id],
      deontic: 'shapes',
    })];
    project.graph.edges = [];

    expect(() => validateProject(project)).toThrow(/belongs at Micro/);
  });

  it('anchors deterministic Exosphere pathways to the carried map in the institutional register', () => {
    const carriedNodes = [{ id: 'node_school_11', label: 'School', type: 'setting', scale: 'micro' }];
    const review = deterministicMemoReview({
      ...createDefaultProject().submission,
      text: 'New York City Education Department funds School. New York City Education Department requests Printing Vendor. Filler prose keeps the memo long enough for review.',
    }, 'exosphere', { carriedNodes });
    expect(review.connections).toEqual([expect.objectContaining({
      source: 'New York City Education Department',
      target: 'node_school_11',
      targetLabel: 'School',
      verb: 'funds',
    })]);
    review.nodes.forEach((node) => expect(node.basis).toBe('memo'));
    const guidanceText = review.guidance.map(({ point }) => point).join(' ');
    expect(guidanceText).toContain('own or operate the setting');
    expect(guidanceText).toContain('School');
  });

  it('returns deterministic Macrosphere structures with empty connections and student-drawn scopes', () => {
    const carriedNodes = [
      { id: 'node_school_11', label: 'School', type: 'setting', scale: 'micro' },
      { id: 'node_family_12', label: 'Family', type: 'family', scale: 'micro' },
    ];
    const review = deterministicMemoReview({
      ...createDefaultProject().submission,
      text: 'High housing costs shape School and Family. The paragraph continues with enough filler prose to satisfy the reader.',
    }, 'macrosphere', { carriedNodes });
    expect(review.connections).toEqual([]);
    expect(review.nodes.length).toBeGreaterThanOrEqual(1);
    review.nodes.forEach((node) => {
      expect(node.basis).toBe('memo');
      expect(node.deontic).toBe('shapes');
      expect(node.scope).toEqual(carriedNodes.map(({ id, label }) => ({ id, label })));
    });
    expect(review.readiness.ready).toBe(true);
    expect(review.guidance.map(({ point }) => point).join(' ')).toContain('broader law, policy, economic condition, or cultural belief');
  });

  it('validates structure scopes on graph nodes', () => {
    const project = projectWithGraph();
    const [first, second] = project.graph.nodes;
    const structure = {
      id: 'node_structure_1',
      label: 'Universal Pre-K Law',
      type: 'law',
      scale: 'macrosphere',
      status: 'confirmed',
      claimState: 'student interpretation',
      notes: '',
      x: 1600,
      y: 260,
      annotations: {
        analytical: { id: stableId('annotation', 'node:node_structure_1:analytical'), text: '' },
        evidence: { id: stableId('annotation', 'node:node_structure_1:evidence'), text: '' },
      },
      deontic: 'defines eligibility for',
      scopeNodeIds: [first.id, second.id],
    };
    project.graph.nodes.push(structure);
    expect(() => validateProject(project)).not.toThrow();
    structure.scopeNodeIds = [structure.id];
    expect(() => validateProject(project)).toThrow(/cannot include the structure itself/);
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

  it('holds a Micro memo with fewer than two named actors or settings', () => {
    const project = createDefaultProject();
    const result = evaluateSubmission({ ...project.submission, text: 'A family is present in this draft. The family appears again, but no second person, role, group, or setting has been named yet.' }, 'micro', 6);
    expect(result.outcome).toBe('hold');
    expect(result.hard.find((item) => item.id === 'H4').status).toBe('unmet');
  });

  it('does not treat repeated relationship words as connections', () => {
    const project = createDefaultProject();
    const text = 'This record repeats the word funds twice without making an actual relational claim: funds. It contains enough filler text to pass the minimum memo length requirement.';
    const result = evaluateSubmission({ ...project.submission, text }, 'macrosphere', 6);
    const h4 = result.hard.find((item) => item.id === 'H4');
    expect(h4.status).toBe('unmet');
    expect(h4.relationshipCount).toBe(0);
    expect(result.outcome).toBe('hold');
  });

  it('classifies every hard-pass result below threshold as conditional', () => {
    const project = createDefaultProject();
    const text = 'Council funds Clinic. Clinic serves Residents. Plain descriptive filler records the arrangement in neutral language without additional analytical signals or uncertainty markers.';
    const result = evaluateSubmission({ ...project.submission, text }, 'macrosphere', 6);
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
    expect(candidates.nodes.find((node) => node.label === 'Parent Advocacy Organizations')).toMatchObject({ type: 'organization', scale: 'exosphere' });
    // The memo's framing question never mints theme nodes; only declarative
    // sentences about actual actors and objects produce candidates.
    expect(candidates.nodes.some((node) => /Ability to Secure Services/.test(node.label))).toBe(false);
    expect(candidates.nodes.some((node) => node.label === 'Interviews')).toBe(false);
    expect(candidates.nodes.find((node) => node.label === 'Published Case Reports')).toBeDefined();
  });

  it('resolves a distributive subject without creating pronoun or quantifier-artifact nodes', () => {
    const project = createDefaultProject();
    const candidates = extractCandidates({
      ...project.submission,
      text: 'Danny and Marisol both attend BMCC.',
    });

    expect(candidates.nodes.map(({ label }) => label)).toEqual(expect.arrayContaining(['Danny', 'Marisol', 'BMCC']));
    expect(candidates.nodes.map(({ label }) => label)).not.toEqual(expect.arrayContaining(['He', 'Marisol Both', 'Danny and Marisol', 'Both']));
    expect(candidates.edges.map(({ sourceLabel, targetLabel, verb }) => ({ sourceLabel, targetLabel, verb }))).toEqual([
      { sourceLabel: 'Danny', targetLabel: 'BMCC', verb: 'attends' },
      { sourceLabel: 'Marisol', targetLabel: 'BMCC', verb: 'attends' },
    ]);
  });

  it('does not turn a generic organization reference into an institutional endpoint', () => {
    const project = createDefaultProject();
    const text = 'How does the organization shape policy in Queens? The organization provides support and enables capacity. According to a source, however, results may be uncertain and should be checked.';
    const submission = { ...project.submission, text };
    expect(evaluateSubmission(submission, 'exosphere', 6).outcome).toBe('pass');
    const candidates = extractCandidates(submission);
    expect(candidates.nodes.length).toBeGreaterThan(0);
    expect(candidates.edges).toEqual([]);
    expect(candidates.nodes.map(({ label }) => label)).toEqual(['Support', 'Capacity']);
    // The question sentence frames the inquiry without asserting a claim.
    expect(candidates.edges.map((edge) => edge.verb)).not.toContain('shapes');
  });

  it('extracts named Micro actors and settings from a node-only memo', () => {
    const project = createDefaultProject();
    const text = 'East Harlem Disability Services. Families. Students. Teachers. P.S. 146. The community center. According to the course memo, these are the people and settings to examine.';
    const submission = { ...project.submission, text };
    const candidates = extractCandidates(submission);
    const labels = candidates.nodes.map(({ label }) => label);

    expect(candidates.edges).toEqual([]);
    expect(labels).toEqual(expect.arrayContaining(['East Harlem Disability Services', 'Family', 'Students', 'Teachers', 'Community Center']));
    expect(candidates.nodes.every((node) => node.evidenceExcerpt && node.evidenceHash === stableId('evh', node.evidenceExcerpt))).toBe(true);
    const result = evaluateSubmission(submission, 'micro', 6);
    expect(result.hard.find((item) => item.id === 'H4')).toMatchObject({ status: 'met', nodeCount: expect.any(Number) });
  });

  it('keeps nominal delays out of relationships and keeps a named service out of the Micro review', () => {
    const project = createDefaultProject();
    const text = 'Adult Participants face delays when the Accessible Van Program is unavailable.';
    const submission = { ...project.submission, text };
    const candidates = extractCandidates(submission);

    expect(candidates.edges).toEqual([]);
    expect(candidates.nodes.map(({ label }) => label)).toEqual(['Adult Participants', 'Accessible Van Program']);
    expect(candidates.nodes.map(({ type }) => type)).toEqual(['person', 'service']);
    expect(deterministicMemoReview(submission, 'micro').nodes.map(({ label }) => label))
      .toEqual(['Adult Participants']);
  });

  it('keeps a Micro relationship endpoint to the exact actor instead of absorbing its setting phrase', () => {
    const project = createDefaultProject();
    const candidates = extractCandidates({
      ...project.submission,
      text: 'Maya Rivera meets Jamal Brooks at the library.',
    });

    expect(candidates.nodes.map(({ label }) => label)).toEqual(expect.arrayContaining(['Maya Rivera', 'Jamal Brooks']));
    expect(candidates.nodes.map(({ label }) => label)).not.toContain('Jamal Brooks At the Library');
    expect(candidates.edges).toEqual([expect.objectContaining({
      sourceLabel: 'Maya Rivera',
      targetLabel: 'Jamal Brooks',
      verb: 'meets',
      scale: 'micro',
    })]);
  });

  it('rejects ambiguous Micro clauses while preserving exact long names and participial labels', () => {
    const officialName = 'New York State Office for People with Developmental Disabilities and Community-Based Access Coordination';
    const participialPopulation = 'Adults experiencing housing insecurity';

    expect(normalizeMicroNodeLabel(officialName)).toBe(officialName);
    expect(isDiscreteMicroNodeLabel(officialName)).toBe(true);
    expect(normalizeMicroNodeLabel(participialPopulation)).toBe(participialPopulation);
    expect(isDiscreteMicroNodeLabel(participialPopulation)).toBe(true);
    expect(normalizeMicroNodeLabel('when the Accessible Van Program is unavailable')).toBe('Accessible Van Program');
    expect(isDiscreteMicroNodeLabel('Adult Participants face delays')).toBe(false);
    expect(normalizeMicroNodeLabel('Adult Participants face delays when the Accessible Van Program is unavailable.')).toBeNull();
    expect(isDiscreteMicroNodeLabel('Adult Participants face delays when the Accessible Van Program is unavailable.')).toBe(false);
    expect(normalizeMicroNodeLabel('Adult Participants Face Delays When the Accessible Van Program Is Unavailable.')).toBeNull();
    expect(isDiscreteMicroNodeLabel('Adult Participants Face Delays When the Accessible Van Program Is Unavailable.')).toBe(false);
  });

  it('deduplicates repeated semantic edges while retaining distinct evidence records', () => {
    const project = createDefaultProject();
    const candidates = extractCandidates({
      ...project.submission,
      text: 'New York City Disability Services Office funds Accommodation Form. New York City Disability Services Office funds Accommodation Form.',
    });
    expect(candidates.edges).toHaveLength(1);
    expect(candidates.edges[0]).toMatchObject({
      sourceLabel: 'New York City Disability Services Office',
      targetLabel: 'Accommodation Form',
      verb: 'funds',
      scale: 'exosphere',
    });
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
    project.participantName = 'East Harlem mapping group';
    expect(parseProject(serializeProject(project))).toMatchObject({
      id: project.id,
      participantName: 'East Harlem mapping group',
    });
  });

  it('discards the retired leverage node field when importing saved schema-v6 projects', () => {
    const savedProject = projectWithGraph();
    savedProject.candidates.nodes[0].leverage = 'energy';
    savedProject.graph.nodes[0].leverage = 'ripples';

    expect(() => validateProject(savedProject)).toThrow(/leverage is not an allowed schema field/);

    const restored = parseProject(JSON.stringify(savedProject));
    expect(restored.candidates.nodes[0]).not.toHaveProperty('leverage');
    expect(restored.graph.nodes[0]).not.toHaveProperty('leverage');
    expect(() => validateProject(restored)).not.toThrow();
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

    const openRouterRuntime = structuredClone(project);
    openRouterRuntime.preflight.evaluation.runtime = {
      provider: 'openrouter',
      model: 'openai/gpt-oss-120b',
      requestedModel: 'openai/gpt-oss-120b',
      maxSourceBytes: 131072,
      createdAt: openRouterRuntime.preflight.evaluation.createdAt,
      promptEvalCount: 2048,
      evalCount: 512,
    };
    expect(() => validateProject(openRouterRuntime)).not.toThrow();

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
    variedScaleOrder.releasedScales = ['micro', 'exosphere'];
    variedScaleOrder.activeScale = 'exosphere';
    expect(parseProject(serializeProject(variedScaleOrder))).toMatchObject({
      activeScale: 'exosphere',
      releasedScales: ['micro', 'exosphere'],
    });
  });

  it('migrates schema v5 levels, Micro relationships, and canonical module IDs without changing student work', () => {
    const legacy = projectWithGraph();
    legacy.schemaVersion = 5;
    delete legacy.participantName;
    legacy.activeScale = 'macro';
    legacy.releasedScales = ['micro', 'macro', 'integration'];
    legacy.completedScales = ['macro'];
    const candidateMicroEdge = legacy.candidates.edges[0];
    const graphMicroEdge = legacy.graph.edges[0];
    candidateMicroEdge.scale = 'micro';
    graphMicroEdge.scale = 'micro';
    candidateMicroEdge.annotation.text = 'Preserve candidate relationship annotation';
    graphMicroEdge.annotation.text = 'Preserve graph relationship annotation';
    [candidateMicroEdge.source, candidateMicroEdge.target].forEach((id) => {
      legacy.candidates.nodes.find((node) => node.id === id).scale = 'micro';
      legacy.graph.nodes.find((node) => node.id === id).scale = 'micro';
    });
    const outerNodeIds = legacy.graph.nodes.map(({ id }) => id).filter((id) => id !== graphMicroEdge.source && id !== graphMicroEdge.target).slice(0, 2);
    legacy.candidates.nodes.find((node) => node.id === outerNodeIds[0]).scale = 'macro';
    legacy.graph.nodes.find((node) => node.id === outerNodeIds[0]).scale = 'macro';
    legacy.candidates.nodes.find((node) => node.id === outerNodeIds[1]).scale = 'integration';
    legacy.graph.nodes.find((node) => node.id === outerNodeIds[1]).scale = 'integration';
    const legacyMesoNodeId = legacy.graph.nodes
      .find((node) => ![graphMicroEdge.source, graphMicroEdge.target, ...outerNodeIds].includes(node.id)
        && !isNamedInstitutionLabel(node.label))?.id;
    legacy.candidates.nodes.find((node) => node.id === legacyMesoNodeId).scale = 'meso';
    legacy.graph.nodes.find((node) => node.id === legacyMesoNodeId).scale = 'meso';
    legacy.candidates.edges[1].scale = 'integration';
    legacy.graph.edges[1].scale = 'integration';
    const legacyNodeIds = legacy.graph.nodes.map(({ id }) => id);
    const legacyCandidateMicroEdge = structuredClone(candidateMicroEdge);
    const legacyGraphMicroEdge = structuredClone(graphMicroEdge);
    const legacyGraphGeometry = legacy.graph.nodes.map(({ id, x, y, annotations }) => ({ id, x, y, annotations: structuredClone(annotations) }));
    legacy.configs.preflight.history.push({
      revision: 1,
      fingerprint: legacy.configs.preflight.fingerprint,
      changeNote: 'Preserve this configuration history entry.',
      at: legacy.updatedAt,
    });
    const legacyConfigHistory = structuredClone(legacy.configs.preflight.history);
    const courseParts = [
      { id: 'part-1', label: 'Part 1', scaleIds: ['micro', 'meso'] },
      { id: 'part-2', label: 'Part 2', scaleIds: ['macro', 'integration'] },
    ];
    const governanceSnapshot = (configKind, scale) => ({
      configKind,
      scale,
      fingerprint: `${configKind}-legacy-fingerprint`,
      revision: 1,
      moduleVersions: [
        { id: `${configKind}.macro.purpose`, revision: 2, fingerprint: `${configKind}-macro-purpose` },
        { id: `${configKind}.integration.output`, revision: 3, fingerprint: `${configKind}-integration-output` },
      ],
      courseParts: structuredClone(courseParts),
    });
    legacy.teacherGovernance = {
      preflight: governanceSnapshot('preflight', 'macro'),
      builder: governanceSnapshot('builder', 'integration'),
      refreshedAt: legacy.updatedAt,
    };
    addAuthoritativePreflight(legacy);
    legacy.preflight.configurationSnapshot.shared.courseParts = structuredClone(courseParts);
    legacy.preflight.configurationSnapshot.shared.moduleVersions = [
      { id: 'preflight.macro.scale_rubric', revision: 4, fingerprint: 'preflight-macro-rubric' },
      { id: 'preflight.integration.interaction', revision: 5, fingerprint: 'preflight-integration-interaction' },
      { id: 'not-a-canonical.macro.purpose', revision: 6, fingerprint: 'arbitrary-module-id' },
    ];
    legacy.events.push(createEvent('legacy.scale-recorded', 'Do not rewrite arbitrary prose such as preflight.macro.purpose.', 'student', {
      scale: 'macro',
      activeScale: 'integration',
      scaleIds: ['macro', 'integration'],
      releasedScales: ['micro', 'macro'],
      completedScales: ['integration'],
      nested: { scale: 'macro' },
    }));

    const migrated = parseProject(JSON.stringify(legacy));
    expect(migrated).toMatchObject({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      participantName: '',
      activeScale: 'exosphere',
      releasedScales: ['micro', 'meso', 'exosphere', 'macrosphere'],
      completedScales: ['exosphere'],
    });
    expect(migrated.graph.nodes.map(({ id }) => id)).toEqual(legacyNodeIds);
    expect(migrated.candidates.edges[0]).toEqual({ ...legacyCandidateMicroEdge, scale: 'micro' });
    expect(migrated.graph.edges[0]).toEqual({ ...legacyGraphMicroEdge, scale: 'micro' });
    expect(migrated.graph.nodes.find((node) => node.id === graphMicroEdge.source).scale).toBe('micro');
    expect(migrated.graph.nodes.find((node) => node.id === graphMicroEdge.target).scale).toBe('micro');
    expect(migrated.graph.nodes.find((node) => node.id === outerNodeIds[0]).scale).toBe('exosphere');
    expect(migrated.graph.nodes.find((node) => node.id === outerNodeIds[1])).toMatchObject({ scale: 'exosphere' });
    expect(migrated.graph.nodes.find((node) => node.id === outerNodeIds[1]).notes).toContain('Moved from Macrosphere to Exosphere');
    expect(migrated.graph.nodes.find((node) => node.id === legacyMesoNodeId).scale).toBe('micro');
    expect(migrated.graph.edges[1]).toMatchObject({ scale: 'exosphere', status: 'rejected', claimState: 'retired' });
    expect(migrated.graph.nodes.map(({ id, x, y, annotations }) => ({ id, x, y, annotations }))).toEqual(legacyGraphGeometry);
    expect(migrated.configs.preflight.history).toEqual(legacyConfigHistory);
    expect(migrated.teacherGovernance.preflight).toMatchObject({ scale: 'exosphere' });
    expect(migrated.teacherGovernance.builder).toMatchObject({ scale: 'macrosphere' });
    expect(migrated.teacherGovernance.preflight.moduleVersions.map(({ id }) => id)).toEqual(['preflight.exosphere.purpose', 'preflight.macrosphere.output']);
    expect(migrated.teacherGovernance.builder.moduleVersions.map(({ id }) => id)).toEqual(['builder.exosphere.purpose', 'builder.macrosphere.output']);
    expect(migrated.teacherGovernance.preflight.courseParts[1].scaleIds).toEqual(['exosphere', 'macrosphere']);
    expect(migrated.preflight.configurationSnapshot.activeScale).toBe('exosphere');
    expect(migrated.preflight.configurationSnapshot.shared.courseParts[1].scaleIds).toEqual(['exosphere', 'macrosphere']);
    expect(migrated.preflight.configurationSnapshot.shared.moduleVersions.map(({ id }) => id)).toEqual([
      'preflight.exosphere.scale_rubric',
      'preflight.macrosphere.interaction',
      'not-a-canonical.macro.purpose',
    ]);
    expect(migrated.events.at(-1)).toMatchObject({
      detail: 'Do not rewrite arbitrary prose such as preflight.macro.purpose.',
      scale: 'exosphere',
      activeScale: 'macrosphere',
      scaleIds: ['exosphere', 'macrosphere'],
      releasedScales: ['micro', 'exosphere'],
      completedScales: ['macrosphere'],
      nested: { scale: 'exosphere' },
    });
    expect(JSON.stringify(migrated)).not.toMatch(/"(?:macro|integration)"/);
  });

  it('migrates legacy Meso edges to review-needed Micro relationships without inventing scopes', () => {
    const earlyV6 = projectWithGraph();
    const relationship = earlyV6.graph.edges.find((edge) => edge.scale === 'micro');
    const candidateRelationship = earlyV6.candidates.edges.find((edge) => edge.id === relationship.id);
    relationship.scale = 'meso';
    candidateRelationship.scale = 'meso';
    relationship.annotation.text = 'Keep the graph relationship annotation';
    candidateRelationship.annotation.text = 'Keep the candidate relationship annotation';
    earlyV6.graph.nodes.find((node) => node.id === relationship.source).annotations.analytical.text = 'Keep the node annotation';
    const migrated = parseProject(JSON.stringify(earlyV6));

    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    const migratedGraphEdge = migrated.graph.edges.find((edge) => edge.id === relationship.id);
    const migratedCandidateEdge = migrated.candidates.edges.find((edge) => edge.id === relationship.id);
    [migratedGraphEdge, migratedCandidateEdge].forEach((edge) => {
      expect(edge).toMatchObject({ scale: 'micro', status: 'research lead', claimState: 'research lead' });
      expect(edge.notes).toContain('Review this direct relationship in Micro');
    });
    expect(migratedGraphEdge.annotation.text).toBe('Keep the graph relationship annotation');
    expect(migratedCandidateEdge.annotation.text).toBe('Keep the candidate relationship annotation');
    expect(migrated.graph.nodes.some((node) => node.type === 'mesosystem')).toBe(false);
    expect(parseProject(JSON.stringify(migrated))).toEqual(migrated);
  });

  it('rejects a live generic Exosphere label but retires the same legacy item so the project can open', () => {
    const legacy = createDefaultProject();
    legacy.activeScale = 'exosphere';
    legacy.releasedScales = ['micro', 'exosphere'];
    legacy.graph.nodes = [mappedNode({
      id: 'node_generic_exosphere',
      label: 'Transportation access',
      type: 'service',
      scale: 'exosphere',
    })];

    expect(() => validateProject(legacy)).toThrow(/must name an institution, agency, office, or service system/);

    const migrated = parseProject(JSON.stringify(legacy));
    expect(migrated.graph.nodes[0]).toMatchObject({
      id: 'node_generic_exosphere',
      scale: 'exosphere',
      status: 'rejected',
      claimState: 'retired',
    });
    expect(migrated.graph.nodes[0].notes).toContain('Exosphere item must name an institution');
    expect(parseProject(JSON.stringify(migrated))).toEqual(migrated);
  });

  it('retires a legacy scope-less Macrosphere item instead of blocking the project from opening', () => {
    const legacy = createDefaultProject();
    legacy.activeScale = 'macrosphere';
    legacy.releasedScales = ['micro', 'macrosphere'];
    legacy.graph.nodes = [mappedNode({
      id: 'node_scope_less_macro',
      label: 'High transportation costs',
      type: 'economic condition',
      scale: 'macrosphere',
      deontic: 'constrains',
    })];

    expect(() => validateProject(legacy)).toThrow(/at least two mapped elements/);

    const migrated = parseProject(JSON.stringify(legacy));
    expect(migrated.graph.nodes[0]).toMatchObject({
      id: 'node_scope_less_macro',
      status: 'rejected',
      claimState: 'retired',
    });
    expect(migrated.graph.nodes[0].notes).toContain('at least two valid mapped scope members');
    expect(() => validateProject(migrated)).not.toThrow();
  });

  it('reclassifies lower-level roles but retires schedules and clause labels during migration', () => {
    const legacy = createDefaultProject();
    legacy.activeScale = 'macrosphere';
    legacy.releasedScales = [...SCALE_ORDER];
    const student = mappedNode({ id: 'node_working_student', label: 'Working student', type: 'role', scale: 'micro' });
    const workplace = mappedNode({ id: 'node_workplace', label: 'Workplace', type: 'setting', scale: 'micro' });
    const scopeNodeIds = [student.id, workplace.id];
    legacy.graph.nodes = [
      student,
      workplace,
      mappedNode({ id: 'node_cuny', label: 'CUNY', type: 'institution', scale: 'exosphere' }),
      mappedNode({
        id: 'node_center_aide', label: 'Center Aide', type: 'structure', scale: 'macrosphere',
        scopeNodeIds, deontic: 'shapes',
      }),
      mappedNode({
        id: 'node_attendant_hours', label: 'Home Attendant’s Hours', type: 'policy', scale: 'macrosphere',
        scopeNodeIds, deontic: 'constrains',
      }),
      mappedNode({
        id: 'node_marcus_clause', label: 'Marcus Facilitates It', type: 'structure', scale: 'macrosphere',
        scopeNodeIds, deontic: 'shapes',
      }),
      mappedNode({
        id: 'node_transport_costs', label: 'High housing and transportation costs', type: 'economic condition', scale: 'macrosphere',
        scopeNodeIds, deontic: 'prices',
      }),
    ];
    legacy.graph.edges = [];

    expect(() => validateProject(legacy)).toThrow(/belongs at Micro/);

    const migrated = parseProject(JSON.stringify(legacy));
    expect(migrated.graph.nodes.find(({ id }) => id === 'node_center_aide')).toMatchObject({
      label: 'Center Aide', type: 'role', scale: 'micro', status: 'confirmed', claimState: 'student interpretation',
    });
    expect(migrated.graph.nodes.find(({ id }) => id === 'node_attendant_hours')).toMatchObject({
      label: 'Home Attendant’s Hours', type: 'policy', scale: 'macrosphere', status: 'rejected', claimState: 'retired',
    });
    const centerAide = migrated.graph.nodes.find(({ id }) => id === 'node_center_aide');
    expect(centerAide).not.toHaveProperty('scopeNodeIds');
    expect(centerAide).not.toHaveProperty('deontic');
    expect(centerAide.notes).toContain('Moved from Macrosphere to Micro');
    expect(migrated.graph.nodes.find(({ id }) => id === 'node_attendant_hours').notes).toContain('Retired during migration');
    expect(migrated.graph.nodes.find(({ id }) => id === 'node_marcus_clause')).toMatchObject({
      scale: 'macrosphere', status: 'rejected', claimState: 'retired',
    });
    expect(migrated.graph.nodes.find(({ id }) => id === 'node_marcus_clause').notes).toContain('clause about an immediate actor');
    expect(migrated.graph.nodes.find(({ id }) => id === 'node_cuny')).toMatchObject({ type: 'institution', scale: 'exosphere' });
    expect(migrated.graph.nodes.find(({ id }) => id === 'node_transport_costs')).toMatchObject({
      type: 'economic condition', scale: 'macrosphere', status: 'confirmed', claimState: 'student interpretation',
    });
    expect(() => validateProject(migrated)).not.toThrow();
    expect(parseProject(JSON.stringify(migrated))).toEqual(migrated);
  });

  it('keeps an r/CUNY setting and its valid direct relationship at Micro when parsing a project', () => {
    const project = createDefaultProject();
    const student = mappedNode({
      id: 'node_maria_rivera',
      label: 'Maria Rivera',
      type: 'person',
      scale: 'micro',
    });
    const subreddit = mappedNode({
      id: 'node_r_cuny',
      label: 'r/CUNY',
      type: 'setting',
      scale: 'micro',
    });
    const postsIn = mappedEdge({
      id: 'edge_maria_posts_in_r_cuny',
      source: student,
      target: subreddit,
      verb: 'posts in',
      scale: 'micro',
    });
    project.activeScale = 'micro';
    project.releasedScales = ['micro'];
    project.candidates = { nodes: [], edges: [] };
    project.graph = { nodes: [student, subreddit], edges: [postsIn] };

    const restored = parseProject(JSON.stringify(project));

    expect(restored.graph.nodes.find((node) => node.id === subreddit.id)).toEqual(subreddit);
    expect(restored.graph.edges.find((edge) => edge.id === postsIn.id)).toEqual(postsIn);
    expect(restored.releasedScales).toEqual(['micro']);
  });

  it('preserves and retires malformed legacy Micro labels and every relationship that depends on them', () => {
    const project = createDefaultProject();
    const marisolBoth = mappedNode({ id: 'node_marisol_both', label: 'Marisol Both', type: 'person', scale: 'micro' });
    const pronoun = mappedNode({ id: 'node_pronoun', label: 'He', type: 'person', scale: 'micro' });
    const weekday = mappedNode({ id: 'node_weekday', label: 'Tuesdays', type: 'activity', scale: 'micro' });
    const home = mappedNode({ id: 'node_home', label: 'Family home', type: 'setting', scale: 'micro' });
    const classroom = mappedNode({ id: 'node_classroom_legacy', label: 'Transition classroom', type: 'setting', scale: 'micro' });
    project.graph.nodes = [marisolBoth, pronoun, weekday, home, classroom];
    project.graph.edges = [
      mappedEdge({ id: 'edge_quantifier', source: marisolBoth, target: classroom, verb: 'attends', scale: 'micro' }),
      mappedEdge({ id: 'edge_pronoun', source: pronoun, target: home, verb: 'lives near', scale: 'micro' }),
      mappedEdge({ id: 'edge_weekday', source: weekday, target: classroom, verb: 'occurs in', scale: 'micro' }),
      mappedEdge({ id: 'edge_settings', source: home, target: classroom, verb: 'coordinates with', scale: 'micro' }),
    ];

    const migrated = parseProject(JSON.stringify(project));
    ['node_marisol_both', 'node_pronoun', 'node_weekday'].forEach((id) => {
      const node = migrated.graph.nodes.find((item) => item.id === id);
      expect(node).toMatchObject({ status: 'rejected', claimState: 'retired' });
    });
    expect(migrated.graph.nodes.find(({ id }) => id === 'node_marisol_both').label).toBe('Marisol Both');
    expect(migrated.graph.edges).toHaveLength(4);
    migrated.graph.edges.forEach((edge) => expect(edge).toMatchObject({ status: 'rejected', claimState: 'retired' }));
    expect(migrated.graph.edges.find(({ id }) => id === 'edge_settings').notes).toContain('belongs in a scoped Meso item');
    expect(() => validateProject(migrated)).not.toThrow();
    expect(parseProject(JSON.stringify(migrated))).toEqual(migrated);
  });

  it('moves a named institution out of legacy Micro and releases Exosphere without changing its identity', () => {
    const legacy = createDefaultProject();
    legacy.graph.nodes = [mappedNode({
      id: 'node_cuny_legacy_micro',
      label: 'CUNY',
      type: 'setting',
      scale: 'micro',
    })];

    const migrated = parseProject(JSON.stringify(legacy));
    expect(migrated.graph.nodes[0]).toMatchObject({
      id: 'node_cuny_legacy_micro',
      label: 'CUNY',
      type: 'institution',
      scale: 'exosphere',
      status: 'confirmed',
      claimState: 'student interpretation',
    });
    expect(migrated.graph.nodes[0].notes).toContain('Moved from Micro to Exosphere');
    expect(migrated.releasedScales).toEqual(['micro', 'exosphere']);
    expect(parseProject(JSON.stringify(migrated))).toEqual(migrated);
  });

  it('canonicalizes valid legacy institutional edges and retires invalid Exosphere endpoints', () => {
    const legacy = createDefaultProject();
    legacy.activeScale = 'exosphere';
    legacy.releasedScales = ['micro', 'exosphere', 'macrosphere'];
    const person = mappedNode({ id: 'node_maya', label: 'Maya Rivera', type: 'person', scale: 'micro' });
    const form = mappedNode({ id: 'node_form', label: 'Accommodation Form', type: 'object', scale: 'micro' });
    const institution = mappedNode({
      id: 'node_access_office',
      label: 'New York City Disability Services Office',
      type: 'agency',
      scale: 'exosphere',
    });
    const condition = mappedNode({
      id: 'node_transportation_costs',
      label: 'High transportation costs',
      type: 'economic condition',
      scale: 'macrosphere',
      deontic: 'constrains',
      scopeNodeIds: [person.id, form.id],
    });
    legacy.graph.nodes = [person, form, institution, condition];
    legacy.graph.edges = [
      mappedEdge({ id: 'edge_canonical', source: institution, target: form, verb: 'oversees' }),
      mappedEdge({ id: 'edge_without_institution', source: person, target: form, verb: 'funds' }),
      mappedEdge({ id: 'edge_macro_endpoint', source: institution, target: condition, verb: 'funds' }),
    ];

    const migrated = parseProject(JSON.stringify(legacy));
    expect(migrated.graph.edges.find(({ id }) => id === 'edge_canonical')).toMatchObject({
      verb: 'regulates',
      status: 'confirmed',
      claimState: 'student interpretation',
    });
    ['edge_without_institution', 'edge_macro_endpoint'].forEach((id) => {
      const edge = migrated.graph.edges.find((item) => item.id === id);
      expect(edge).toMatchObject({ status: 'rejected', claimState: 'retired' });
      expect(edge.notes).toContain('not a valid institutional Exosphere relationship');
    });
    expect(parseProject(JSON.stringify(migrated))).toEqual(migrated);
  });

  it('accepts scoped Meso nodes and rejects verb-bearing Meso edges', () => {
    const mesoNode = projectWithGraph();
    mesoNode.graph.nodes.find((node) => node.scale === 'micro').scale = 'meso';
    expect(() => validateProject(mesoNode)).toThrow(/must be mesosystem for a Meso node/);

    const mesoRelationship = projectWithGraph();
    mesoRelationship.graph.edges[0].scale = 'meso';
    expect(() => validateProject(mesoRelationship)).toThrow(/Meso uses scoped mesosystem nodes/);

    const valid = projectWithGraph();
    valid.graph.edges = [];
    const settings = valid.graph.nodes.slice(0, 2);
    settings.forEach((node) => { node.scale = 'micro'; node.type = 'setting'; });
    valid.graph.nodes.push(withDefaultNodeLayout([{
      id: 'node_meso_1', label: 'School and family mesosystem', type: 'mesosystem', scale: 'meso',
      status: 'confirmed', claimState: 'student interpretation', notes: '', scopeNodeIds: settings.map(({ id }) => id),
    }])[0]);
    expect(() => validateProject(valid)).not.toThrow();

    const incomplete = structuredClone(valid);
    incomplete.graph.nodes.find((node) => node.id === 'node_meso_1').scopeNodeIds = [settings[0].id];
    expect(() => validateProject(incomplete)).toThrow(/at least two Micro settings/);

    const nonSetting = structuredClone(valid);
    nonSetting.graph.nodes.find((node) => node.id === settings[1].id).type = 'person';
    expect(() => validateProject(nonSetting)).toThrow(/immediate setting mapped in Micro/);

    const settingEdge = structuredClone(valid);
    const edgeTemplate = projectWithGraph().graph.edges[0];
    settingEdge.graph.edges = [{
      ...edgeTemplate,
      id: 'edge_setting_to_setting',
      source: settings[0].id,
      target: settings[1].id,
      sourceLabel: settings[0].label,
      targetLabel: settings[1].label,
      scale: 'micro',
      status: 'confirmed',
      claimState: 'student interpretation',
      annotation: { id: stableId('annotation', 'edge:edge_setting_to_setting:relationship'), text: '' },
    }];
    expect(() => validateProject(settingEdge)).toThrow(/must not encode an interrelation between two Micro settings/);
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

    const underRangeViewport = projectWithGraph();
    underRangeViewport.viewport.zoom = PROJECT_LIMITS.zoomMin - 0.01;
    expect(() => parseProject(JSON.stringify(underRangeViewport))).toThrow(/viewport\.zoom must be a finite number/);
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

  it('validates a Meso candidate mesosystem against carried Micro settings', () => {
    const project = createDefaultProject();
    const microNodes = extractCandidates(project.submission).nodes
      .slice(0, 2)
      .map((node) => ({ ...node, scale: 'micro', status: 'confirmed', claimState: 'student interpretation' }));
    const [source, target] = microNodes;
    source.type = 'setting';
    target.type = 'setting';
    project.activeScale = 'meso';
    project.releasedScales = ['micro', 'meso'];
    project.graph = { nodes: microNodes, edges: [] };
    project.candidates = {
      nodes: withDefaultNodeLayout([{
        id: 'node_meso_candidate',
        label: `${source.label} and ${target.label} mesosystem`,
        type: 'mesosystem',
        scale: 'meso',
        status: 'pending',
        claimState: 'inference',
        notes: '',
        evidence: 'Memo sentence 1',
        scopeNodeIds: [source.id, target.id],
      }]),
      edges: [],
    };

    expect(() => validateProject(project)).not.toThrow();
    expect(parseProject(serializeProject(project)).candidates.nodes[0]).toMatchObject({
      type: 'mesosystem',
      scale: 'meso',
      scopeNodeIds: [source.id, target.id],
    });
  });

  it('rejects unsupported imports', () => {
    expect(() => parseProject('{"schemaVersion":7}')).toThrow(/not a supported/);
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
    const project = projectWithGraph();
    project.submission.sensitive = true;
    project.submission.consent = true;
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
