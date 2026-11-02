// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSystemsMappingApp } from './app.js';
import { createDefaultProject, createPortableProject, parseProject } from '../src/domain.js';
import { normalizeInput } from './ollama.js';
import { preflightEvaluationPayload } from '../src/App.jsx';
import { ASSIGNMENT_COMPARISON_CASES, MESO_OBSERVED_PASSAGE, MESO_MISSING_PASSAGE, EXO_CHAIN_PASSAGE } from '../tests/fixtures/assignment-guidance-cases.js';
const ORIGIN = 'http://127.0.0.1:4177';
const systems = [];
afterEach(async () => { for (const system of systems.splice(0)) await system.close(); });
const process = { direction: 'both directions', strength: 'strong', channel: 'email', connectingWork: 'parent', familyCount: 24, connectionStatus: 'observed' };
const meso = () => ({ guidance: [], nodes: [], connections: [
  { source: 'micro_parent', target: 'micro_teacher', verb: 'exchanges updates with', rationale: MESO_OBSERVED_PASSAGE, relationshipProcess: { ...process } },
  { source: 'micro_therapist', target: 'micro_teacher', verb: 'has no contact with', rationale: MESO_MISSING_PASSAGE, relationshipProcess: { direction: 'source to target', strength: 'unknown', channel: 'phone', connectingWork: '', familyCount: null, connectionStatus: 'missing' } },
], example: null, readiness: { ready: true, note: 'The memo describes an exchange and an absent pair.' } });
const exo = () => ({ guidance: [], nodes: ['U.S. Department of Education', 'NYSED', 'NYC Public Schools'].map(label => ({ label, type: 'agency', scale: 'exosphere', evidence: EXO_CHAIN_PASSAGE, basis: 'memo' })), connections: [
  { source: 'U.S. Department of Education', target: 'NYSED', verb: 'funds', rationale: 'The U.S. Department of Education funds NYSED.' },
  { source: 'NYSED', target: 'NYC Public Schools', verb: 'funds', rationale: 'NYSED funds NYC Public Schools.' },
  { source: 'NYC Public Schools', target: 'micro_school', verb: 'funds', rationale: 'NYC Public Schools funds P.S. 101 School.' },
], example: null, readiness: { ready: true, note: 'The memo describes each step in the funding path.' } });
async function setup(review, fixture = ASSIGNMENT_COMPARISON_CASES[0]) {
  const run = vi.fn(async () => ({ suggestion: typeof review === 'function' ? review() : review, metadata: { provider: 'cail-gateway', model: 'test-model' } }));
  const system = createSystemsMappingApp({ dbPath: ':memory:', classCode: '101', ollamaConfig: { apiKey: 'test-only', model: 'test-model' }, suggestionProvider: 'cail-gateway', ollamaRequest: run });
  systems.push(system); await system.ready;
  const headers = { origin: ORIGIN, 'content-type': 'application/json' };
  const access = await system.app.request(ORIGIN + '/api/student/access', { method: 'POST', headers, body: JSON.stringify({ code: '101' }) });
  headers.cookie = access.headers.get('set-cookie').split(';')[0];
  const project = createDefaultProject(); project.activeScale = fixture.activeScale; project.submission.text = fixture.text;
  project.graph.nodes = fixture.carriedNodes.map(node => ({ ...node, status: 'confirmed', claimState: 'observed' }));
  const payload = preflightEvaluationPayload(project);
  const evaluate = () => system.app.request(ORIGIN + '/api/preflight/evaluations', { method: 'POST', headers, body: JSON.stringify(payload) });
  return { run, system, evaluate, payload, headers };
}

describe('current assignment guidance', () => {
  it('supplies missing table endpoints and accepts actionable guidance without substituting an office for a person', async () => {
    const text = '| People connected | Strength + direction | Method + connector | Evidence / source |\n| --- | --- | --- | --- |\n| Classroom teachers and Guidance counselors | Weak; one way | email | A school report. |';
    const fixture = { activeScale: 'meso', text, carriedNodes: [{ id: 'teacher', label: 'Teacher', type: 'role', scale: 'micro' }, { id: 'office', label: 'Guidance counselor office', type: 'setting', scale: 'micro' }] };
    const review = { guidance: [{ point: 'Add the Guidance counselor role from the memo before drawing this relationship.' }], nodes: [], connections: [], example: null, readiness: { ready: false, note: 'The counselor role needs a map node.' } };
    const { run, evaluate } = await setup(review, fixture);
    const response = await evaluate(); expect(response.status).toBe(201);
    const { evaluation } = await response.json();
    expect(evaluation.review).toMatchObject({ nodes: [], connections: [], readiness: { ready: false } });
    expect(evaluation.review.guidance[0].point).toContain('Classroom teachers and Guidance counselors');
    expect(evaluation.runtime).toMatchObject({ provider: 'source-check', model: 'Meso role coverage' });
    expect(run).not.toHaveBeenCalled();
    const project = createDefaultProject();
    project.preflight = { memoReview: evaluation.review, configurationSnapshot: evaluation.configSnapshot, sourceFingerprint: 'test-source', evaluation: { evaluationId: evaluation.id, createdAt: evaluation.createdAt, expiresAt: evaluation.expiresAt, runtime: evaluation.runtime } };
    expect(parseProject(JSON.stringify(createPortableProject(project, 'private'))).preflight.evaluation.runtime.provider).toBe('source-check');
  });
  const quoteSource = 'Students in District 12 may participate in a learning program (District report, 2025). The school counselor supports these students.';
  const quoteFixture = { activeScale: 'micro', text: quoteSource, carriedNodes: [] };
  const quoteReview = () => ({ guidance: [
    { point: 'Confirm participation in the learning program.', evidenceExcerpt: 'Students may participate in a learning program (District report, 2025).' },
    { point: 'Ask the counselor about meeting frequency.', evidenceExcerpt: 'The counselor meets every day.' },
  ], nodes: [{ label: 'School counselor', type: 'role', scale: 'micro', evidence: 'The memo identifies the school counselor supporting students.' }], connections: [], example: null, readiness: { ready: false, note: 'A counselor is identified.' } });

  it.each([false, true])('rereads existing Micro items without changing their saved identity, with new items: %s', async withNewItem => {
    const review = quoteReview(); review.guidance = [];
    if (withNewItem) {
      review.nodes.push({ label: 'Students', type: 'role', scale: 'micro', evidence: quoteSource });
      review.readiness.ready = true;
    }
    const original = structuredClone(review);
    const fixture = { ...quoteFixture, carriedNodes: [{ id: 'existing-counselor', label: 'School counselor', type: 'role', scale: 'micro' }] };
    const { evaluate, run } = await setup(review, fixture);
    const response = await evaluate(); expect(response.status).toBe(201);
    const { evaluation } = await response.json();
    expect(evaluation.review.nodes).toEqual(withNewItem ? [review.nodes[1]] : []);
    expect(evaluation.review.readiness).toEqual(review.readiness);
    expect(review).toEqual(original);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each(['conflicting type', 'duplicate proposal', 'invalid evidence', 'ambiguous carried identity'])('retains atomic rejection during Micro reread: %s', async failure => {
    const review = quoteReview(); review.guidance = [];
    const fixture = { ...quoteFixture, carriedNodes: [{ id: 'existing-counselor', label: 'School counselor', type: 'role', scale: 'micro' }] };
    if (failure === 'conflicting type') review.nodes[0].type = 'setting';
    if (failure === 'duplicate proposal') review.nodes.push({ ...review.nodes[0] });
    if (failure === 'invalid evidence') review.nodes[0].evidence = '';
    if (failure === 'ambiguous carried identity') fixture.carriedNodes.push({ ...fixture.carriedNodes[0], id: 'second-counselor' });
    const { evaluate, system } = await setup(review, fixture);
    expect((await evaluate()).status).toBe(502);
    expect(system.db.prepare('SELECT count(*) AS n FROM preflight_evaluations').get().n).toBe(0);
  });

  it('accepts typographic spacing in unquoted guidance while retaining the original evidence', async () => {
    const review = quoteReview();
    review.guidance = [{ point: 'Clarify parent\u202f↔\u202fcounselor contact.', evidenceExcerpt: quoteSource }];
    review.readiness.note = 'A\u00a0counselor is identified.';
    const { evaluate, run } = await setup(review, quoteFixture);
    const response = await evaluate(); expect(response.status).toBe(201);
    const { evaluation } = await response.json();
    expect(evaluation.review.guidance[0]).toEqual({point:'Clarify parent ↔ counselor contact.',evidenceExcerpt:quoteSource});
    expect(evaluation.review.readiness.note).toBe('A counselor is identified.');
    expect(review.guidance[0].point).toContain('\u202f');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each(['x'.repeat(499)+'\u202f\u202f', 'A point\nwith a line break.', 'A point\u0000with a control.'])('retains raw size and single-line limits for generated guidance %j', async point => {
    const review = quoteReview(); review.guidance = [{point}];
    const { evaluate, system } = await setup(review, quoteFixture);
    expect((await evaluate()).status).toBe(502);
    expect(system.db.prepare('SELECT count(*) AS n FROM preflight_evaluations').get().n).toBe(0);
  });

  it('repairs optional quotes with selected literal passages while retaining the independently validated review', async () => {
    const rejected = quoteReview();
    const { evaluate, run, system } = await setup(rejected, quoteFixture);
    run.mockResolvedValueOnce({ suggestion: rejected }).mockResolvedValueOnce({ suggestion: rejected })
      .mockResolvedValueOnce({ suggestion: { quotes: [0, null] }, metadata: { model: 'test-model' } });
    const response = await evaluate(); expect(response.status).toBe(201);
    const { evaluation } = await response.json();
    expect(evaluation.review.nodes).toEqual(rejected.nodes);
    expect(evaluation.review.guidance).toEqual([
      { point: rejected.guidance[0].point, evidenceExcerpt: quoteSource }, { point: rejected.guidance[1].point },
    ]);
    expect(evaluation.runtime).toMatchObject({ correctiveRetries: 2, evidenceRepairAttempts: 1 });
    expect(run).toHaveBeenCalledTimes(3);
    const [input, , options] = run.mock.calls[2];
    expect(options.kind).toBe('memo-quotes');
    expect(run.mock.calls.every(call => call[2].signal === options.signal)).toBe(true);
    expect(input.systemPrompt).toContain('Select optional quotations');
    expect(input.memoContext.quoteSelection.points).toEqual(rejected.guidance.map(item => item.point));
    expect(() => normalizeInput(input)).not.toThrow();
    expect(system.db.prepare('SELECT count(*) AS n FROM preflight_evaluations').get().n).toBe(1);
    expect(rejected).toEqual(quoteReview());
  });

  it.each([null, { quotes: [0] }, { quotes: [-1, null] }, { quotes: [6, null] }, { quotes: [0.5, null] }, { quotes: ['0', null] }, { quotes: [0, null], nodes: [] }, { review: { quotes: [0, null] } }])('rejects malformed quotation selections atomically: %j', async selection => {
    const rejected = quoteReview();
    const { evaluate, run, system } = await setup(rejected, quoteFixture);
    run.mockResolvedValueOnce({ suggestion: rejected }).mockResolvedValueOnce({ suggestion: rejected })
      .mockResolvedValueOnce({ suggestion: selection });
    expect((await evaluate()).status).toBe(502);
    expect(run).toHaveBeenCalledTimes(3);
    expect(system.db.prepare('SELECT count(*) AS n FROM preflight_evaluations').get().n).toBe(0);
  });

  it('uses full review repair when invalid quotations conceal a separate node failure', async () => {
    const rejected = quoteReview(); rejected.nodes[0].label = 'They';
    const { evaluate, run, system } = await setup(rejected, quoteFixture);
    expect((await evaluate()).status).toBe(502);
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls[2][2].kind).toBe('memo-evidence');
    expect(system.db.prepare('SELECT count(*) AS n FROM preflight_evaluations').get().n).toBe(0);
  });

  it('discards a completed quotation selection after cancellation', async () => {
    const rejected = quoteReview();
    const { run, system, payload, headers } = await setup(rejected, quoteFixture);
    const controller = new AbortController();
    run.mockResolvedValueOnce({ suggestion: rejected }).mockResolvedValueOnce({ suggestion: rejected })
      .mockImplementationOnce(async (_input, _config, options) => {
        expect(options.kind).toBe('memo-quotes'); controller.abort();
        return { suggestion: { quotes: [0, null] } };
      });
    const response = await system.app.request(ORIGIN + '/api/preflight/evaluations', { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
    expect(response.status).not.toBe(201);
    expect(run).toHaveBeenCalledTimes(3);
    expect(system.db.prepare('SELECT count(*) AS n FROM preflight_evaluations').get().n).toBe(0);
  });

  it.each(['micro', 'meso'])('copies indexed %s evidence before validating and storing the complete final repair', async scale => {
    const rejected = scale === 'micro' ? quoteReview() : meso();
    if (scale === 'micro') rejected.nodes[0].label = 'They';
    else rejected.connections[0].relationshipProcess.familyCount = 25;
    const { evaluate, run } = await setup(rejected, scale === 'micro' ? quoteFixture : ASSIGNMENT_COMPARISON_CASES[0]);
    run.mockResolvedValueOnce({ suggestion: rejected }).mockResolvedValueOnce({ suggestion: rejected })
      .mockImplementationOnce(async (input, _config, options) => {
        expect(options.kind).toBe('memo-evidence');
        expect(input.systemPrompt).toContain('zero-based integer index');
        const fixed = scale === 'micro' ? quoteReview() : meso();
        fixed.guidance = [];
        fixed.nodes.forEach(node => { node.evidence = 0; });
        fixed.connections.forEach(edge => { edge.rationale = 0; });
        return { suggestion: fixed, metadata: { model: 'test-model' } };
      });
    const response = await evaluate(); expect(response.status).toBe(201);
    const { evaluation } = await response.json();
    const passage = run.mock.calls[2][0].memoContext.evidenceRepair.passages[0].text;
    if (scale === 'micro') expect(evaluation.review.nodes[0].evidence).toBe(passage);
    else {
      expect(evaluation.review.connections[0].rationale).toBe(passage);
      expect(evaluation.review.connections[0].relationshipProcess.familyCount).toBe(24);
    }
    expect(run).toHaveBeenCalledTimes(3);
  });

  it.each([-1, 6, 0.5, null, '0'])('rejects an invalid required evidence index %j without storing a partial review', async index => {
    const rejected = quoteReview(); rejected.nodes[0].label = 'They';
    const fixed = quoteReview(); fixed.guidance = []; fixed.nodes[0].evidence = index;
    const { evaluate, run, system } = await setup(rejected, quoteFixture);
    run.mockResolvedValueOnce({ suggestion: rejected }).mockResolvedValueOnce({ suggestion: rejected }).mockResolvedValueOnce({ suggestion: fixed });
    expect((await evaluate()).status).toBe(502);
    expect(run).toHaveBeenCalledTimes(3);
    expect(system.db.prepare('SELECT count(*) AS n FROM preflight_evaluations').get().n).toBe(0);
  });
  it('preserves typed Meso details and an explicitly missing pair through atomic stored review', async () => {
    const { evaluate, run, system } = await setup(meso);
    const response = await evaluate(); expect(response.status).toBe(201);
    const { evaluation } = await response.json();
    expect(evaluation.review.connections.map(edge => edge.relationshipProcess)).toEqual(meso().connections.map(edge => edge.relationshipProcess));
    expect(run).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(system.db.prepare('SELECT suggestion_json FROM preflight_evaluations WHERE id = ?').get(evaluation.id).suggestion_json);
    expect(stored.connections[0].relationshipProcess.familyCount).toBe(24);
    expect(stored.connections[1].relationshipProcess.connectionStatus).toBe('missing');
  });
  it('normalizes explicit unknown values and arrow synonyms without rewriting source evidence', async () => {
    const review = meso();
    Object.assign(review.connections[0].relationshipProcess, { frequency: null, duration: null, direction: 'bidirectional' });
    Object.assign(review.connections[1].relationshipProcess, { strength: null, connectingWork: null, direction: 'source-to-target' });
    const { evaluate } = await setup(review);
    const response = await evaluate(); expect(response.status).toBe(201);
    const { evaluation } = await response.json();
    expect(evaluation.review.connections[0]).toMatchObject({ rationale: MESO_OBSERVED_PASSAGE, relationshipProcess: { frequency: '', duration: '', direction: 'both directions', familyCount: 24 } });
    expect(evaluation.review.connections[1].relationshipProcess).toMatchObject({ strength: 'unknown', connectingWork: '', direction: 'source to target' });
    expect(review.connections[0].relationshipProcess.frequency).toBeNull();
  });

  it.each([
    ['ambiguous direction', { direction: 'unidirectional' }], ['negative count', { familyCount: -1 }], ['fractional count', { familyCount: 2.5 }], ['string count', { familyCount: '24' }],
    ['unsupported count', { familyCount: 25 }], ['unsupported channel', { channel: 'shared database' }],
    ['unsupported strength', { strength: 'weak' }], ['unsupported connector', { connectingWork: 'the youth worker' }],
    ['invalid status', { connectionStatus: 'possible' }], ['unknown field', { inferredCount: 24 }],
  ])('rejects %s without saving a partial review', async (_name, patch) => {
    const review = meso(); Object.assign(review.connections[0].relationshipProcess, patch);
    const { evaluate, system, run } = await setup(review);
    expect((await evaluate()).status).toBe(502);
    expect(system.db.prepare('SELECT count(*) AS n FROM preflight_evaluations').get().n).toBe(0);
    expect(run.mock.calls.length).toBeLessThanOrEqual(3);
  });
  it.each(['24% of families', '24 children'])('preserves %s as prose without converting it into a family count', async measure => {
    const fixture = { ...ASSIGNMENT_COMPARISON_CASES[0], text: ASSIGNMENT_COMPARISON_CASES[0].text.replace('24 families', measure) };
    const review = meso(); review.connections[0].rationale = MESO_OBSERVED_PASSAGE.replace('24 families', measure);
    const { evaluate, system } = await setup(review, fixture);
    expect((await evaluate()).status).toBe(502);
    expect(system.db.prepare('SELECT count(*) AS n FROM preflight_evaluations').get().n).toBe(0);
  });
  it('keeps an explicit family count in the same sentence as a shorter evidence quotation', async () => {
    const review = meso(); review.connections[0].rationale = 'The parent maintains a strong email connection with the teacher';
    const { evaluate } = await setup(review);
    const response = await evaluate(); expect(response.status).toBe(201);
    expect((await response.json()).evaluation.review.connections[0].relationshipProcess.familyCount).toBe(24);
  });

  it('rejects a family count found only in a different sentence about another connector', async () => {
    const review = meso(); review.connections[0].rationale = 'The parent maintains a strong email connection with the teacher.';
    const fixture = { ...ASSIGNMENT_COMPARISON_CASES[0], text: 'The parent maintains a strong email connection with the teacher. The clinic navigator supports 24 families. ' + MESO_MISSING_PASSAGE };
    const { evaluate } = await setup(review, fixture);
    expect((await evaluate()).status).toBe(502);
  });

  it('supplies a compact source reading aid on the first call and preserves it during evidence repair', async () => {
    const omitted = meso(); delete omitted.connections[0].relationshipProcess.familyCount;
    const { evaluate, run } = await setup(meso);
    run.mockResolvedValueOnce({ suggestion: omitted, metadata: { model: 'test-model' } });
    run.mockResolvedValueOnce({ suggestion: omitted, metadata: { model: 'test-model' } });
    const response = await evaluate(); expect(response.status).toBe(201);
    expect(run).toHaveBeenCalledTimes(3);
    const first = run.mock.calls[0][0];
    expect(first.memoContext.mesoEvidence[0]).toMatchObject({ source: 'micro_parent', target: 'micro_teacher', relationshipProcess: { familyCount: 24, strength: 'strong', direction: 'both directions', channel: 'email' } });
    expect(first.memoContext.mesoEvidence[1].relationshipProcess).toMatchObject({ connectionStatus: 'missing', channel: 'phone' });
    expect(first.systemPrompt).toContain('MESO SOURCE READING AID');
    expect(first.systemPrompt).toContain('at Meso return nodes: [] and at most 8 connections between existing Micro nodes');
    expect(first.systemPrompt).toContain('different exact Micro IDs from carriedNodes');
    const activeContract = first.systemPrompt.slice(first.systemPrompt.lastIndexOf('MEMO REVIEW JSON CONTRACT'));
    expect(activeContract).not.toMatch(/deontic|scope entries|At Exosphere|At Macrosphere/);
    const final = run.mock.calls[2][0];
    expect(final.memoContext.mesoEvidence).toEqual(first.memoContext.mesoEvidence);
    expect(final.memoContext.evidenceRepair.passages.length).toBeGreaterThan(0);
    expect(new TextEncoder().encode(JSON.stringify(final.memoContext)).byteLength).toBeLessThanOrEqual(8192);
    expect(() => normalizeInput(final)).not.toThrow();
    expect((await response.json()).evaluation.review.connections[0].relationshipProcess.familyCount).toBe(24);
  });

  it('accepts faithful status paraphrases when the same pair has explicit source evidence', async () => {
    const review = meso();
    review.connections[0].rationale = 'The memo describes a strong email connection with updates moving both ways between the parent and the teacher.';
    review.connections[1].rationale = 'The memo states the therapist has no phone contact with the teacher, documenting an absent connection between these two nodes.';
    const { evaluate, run } = await setup(review);
    const response = await evaluate(); expect(response.status).toBe(201);
    expect(run).toHaveBeenCalledTimes(1);
    expect((await response.json()).evaluation.review.connections[1].rationale).toBe(review.connections[1].rationale);
  });

  it('rejects a status paraphrase that contradicts the source-supported missing pair', async () => {
    const review = meso(); review.connections[1].rationale = 'The therapist has phone contact with the teacher.';
    const { evaluate } = await setup(review); expect((await evaluate()).status).toBe(502);
  });

  it('grounds a count in an adjacent same-pair sentence when the rationale quotes its direction', async () => {
    const review = meso(); review.connections[0].rationale = 'The parent and teacher exchange updates in both directions.';
    const { evaluate } = await setup(review);
    const response = await evaluate(); expect(response.status).toBe(201);
    expect((await response.json()).evaluation.review.connections[0].relationshipProcess.familyCount).toBe(24);
  });

  it.each([
    ['strength', { strength: 'strong' }], ['channel', { channel: 'email' }], ['count', { familyCount: 24 }],
  ])('rejects %s borrowed from a different endpoint pair', async (_name, patch) => {
    const text = 'The parent has a weak phone connection with the teacher. The therapist has a strong email connection with the teacher for 24 families.';
    const review = meso(); review.connections = [review.connections[0]];
    review.connections[0].rationale = 'The parent has a weak phone connection with the teacher.';
    review.connections[0].relationshipProcess = { strength: 'weak', channel: 'phone', connectionStatus: 'observed', ...patch };
    const { evaluate, system } = await setup(review, { ...ASSIGNMENT_COMPARISON_CASES[0], text });
    expect((await evaluate()).status).toBe(502);
    expect(system.db.prepare('SELECT count(*) AS n FROM preflight_evaluations').get().n).toBe(0);
  });

  it.each(['strength', 'familyCount', 'direction', 'channel'])('corrects omission of explicitly documented %s without filling model output', async field => {
    const omitted = meso(); delete omitted.connections[0].relationshipProcess[field];
    const { evaluate, run } = await setup(meso);
    run.mockResolvedValueOnce({ suggestion: omitted, metadata: { model: 'test-model' } });
    const response = await evaluate(); expect(response.status).toBe(201);
    expect(run).toHaveBeenCalledTimes(2);
    expect((await response.json()).evaluation.runtime.correctiveRetries).toBe(1);
    expect(run.mock.calls[1][0].systemPrompt).toContain(field);
  });

  it('keeps conflicting counts unknown instead of selecting one claim', async () => {
    const text = 'The parent has a strong email connection with the teacher for 24 families. The parent has a strong email connection with the teacher for 30 families.';
    const review = meso(); review.connections = [review.connections[0]];
    review.connections[0].rationale = text.split('. ')[0] + '.';
    review.connections[0].relationshipProcess = { strength: 'strong', channel: 'email', familyCount: null, connectionStatus: 'observed' };
    const fixture = { ...ASSIGNMENT_COMPARISON_CASES[0], text };
    const { evaluate } = await setup(review, fixture); expect((await evaluate()).status).toBe(201);
    review.connections[0].relationshipProcess.familyCount = 24;
    const bad = await setup(review, fixture); expect((await bad.evaluate()).status).toBe(502);
  });

  it('keeps an observed exchange distinct from an absent channel for the same pair', async () => {
    const observed = 'The parent has a strong email connection with the teacher for 24 families.';
    const missing = 'The parent has no phone contact with the teacher.';
    const review = meso();
    review.connections[0].rationale = observed;
    review.connections[0].relationshipProcess = { strength: 'strong', channel: 'email', familyCount: 24, connectionStatus: 'observed' };
    review.connections[1] = { source: 'micro_parent', target: 'micro_teacher', verb: 'has no contact with', rationale: missing, relationshipProcess: { channel: 'phone', connectionStatus: 'missing' } };
    const { evaluate } = await setup(review, { ...ASSIGNMENT_COMPARISON_CASES[0], text: observed + ' ' + missing });
    const response = await evaluate(); expect(response.status).toBe(201);
    expect((await response.json()).evaluation.review.connections).toHaveLength(2);
  });

  it.each([
    ['strength', 'The parent feels strong while the teacher watches.', { strength: 'strong' }],
    ['channel', 'The parent holds a phone while the teacher watches.', { channel: 'phone' }],
    ['familyCount', 'The parent and teacher watch 24 families arrive.', { familyCount: 24 }],
    ['direction', 'The parent and teacher look in both directions before crossing the street.', { direction: 'both directions' }],
    ['connectionStatus', 'The parent and teacher discuss a missing connection on a phone.', { connectionStatus: 'missing' }],
  ])('rejects %s taken from unrelated case details rather than a relationship claim', async (_field, text, relationshipProcess) => {
    const review = meso(); review.connections = [{ source: 'micro_parent', target: 'micro_teacher', verb: 'discusses with', rationale: text, relationshipProcess }];
    const { evaluate, system } = await setup(review, { ...ASSIGNMENT_COMPARISON_CASES[0], text });
    expect((await evaluate()).status).toBe(502);
    expect(system.db.prepare('SELECT count(*) AS n FROM preflight_evaluations').get().n).toBe(0);
  });

  it('corrects a wholly omitted missing pair instead of accepting an incomplete Meso review', async () => {
    const omitted = meso(); omitted.connections.pop();
    const { evaluate, run } = await setup(meso);
    run.mockResolvedValueOnce({ suggestion: omitted, metadata: { model: 'test-model' } });
    const response = await evaluate(); expect(response.status).toBe(201);
    expect(run).toHaveBeenCalledTimes(2);
    expect((await response.json()).evaluation.review.connections[1].relationshipProcess.connectionStatus).toBe('missing');
  });

  it('recognizes an already mapped missing pair without repeating it', async () => {
    const review = meso(); review.connections.pop();
    const { evaluate, payload } = await setup(review);
    payload.carriedConnections = [{ source: 'micro_teacher', target: 'micro_therapist', verb: 'has no contact with', relationshipProcess: { connectionStatus: 'missing' } }];
    const response = await evaluate(); expect(response.status).toBe(201);
    expect((await response.json()).evaluation.review.connections).toHaveLength(1);
  });

  it('rejects reversed duplicate two-way relationships', async () => {
    const review = meso(); review.connections.push({ ...review.connections[0], source: 'micro_teacher', target: 'micro_parent' });
    const { evaluate } = await setup(review); expect((await evaluate()).status).toBe(502);
  });

  it('requires explicit absence evidence when a model marks a connection missing', async () => {
    const review = meso(); review.connections[0].relationshipProcess.connectionStatus = 'missing';
    const { evaluate } = await setup(review); expect((await evaluate()).status).toBe(502);
  });
  it('keeps legacy connection responses valid when optional details are absent', async () => {
    const text = 'The parent meets the teacher. The therapist meets the teacher.';
    const review = meso(); review.connections.forEach((edge, index) => { delete edge.relationshipProcess; edge.verb = 'meets'; edge.rationale = index ? 'The therapist meets the teacher.' : 'The parent meets the teacher.'; });
    const { evaluate } = await setup(review, { ...ASSIGNMENT_COMPARISON_CASES[0], text }); expect((await evaluate()).status).toBe(201);
  });
  it('accepts a cited institution-to-institution funding path into the carried school', async () => {
    const nodeOnly = () => ({ ...exo(), connections: [] });
    const { evaluate, run } = await setup(nodeOnly, ASSIGNMENT_COMPARISON_CASES[1]);
    const response = await evaluate(); expect(response.status).toBe(201);
    const { evaluation } = await response.json();
    expect(evaluation.review.connections).toHaveLength(0);
    expect(evaluation.review.nodes.map(node => node.label)).toEqual(['U.S. Department of Education', 'NYSED', 'NYC Public Schools']);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('supports the same typed Meso details in direct connection suggestions', async () => {
    const { system, headers, payload } = await setup({ connections: meso().connections });
    const response = await system.app.request(ORIGIN + '/api/map/connections', { method: 'POST', headers, body: JSON.stringify({
      activeScale: 'meso', inquiry: '', prompt: ASSIGNMENT_COMPARISON_CASES[0].text, nodes: ASSIGNMENT_COMPARISON_CASES[0].carriedNodes,
      relationships: [], projectOverlay: payload.projectOverlay, studentJudgments: payload.studentJudgments,
    }) });
    expect(response.status).toBe(201);
    expect((await response.json()).connections[0].relationshipProcess).toEqual(process);
  });

  it('uses exact carried office IDs for direct Exo chain suggestions', async () => {
    const connections = [{ source: 'exo_usdoe', target: 'exo_nysed', verb: 'funds', rationale: 'The U.S. Department of Education funds NYSED.' }];
    const { system, headers, payload } = await setup({ connections }, ASSIGNMENT_COMPARISON_CASES[1]);
    const response = await system.app.request(ORIGIN + '/api/map/connections', { method: 'POST', headers, body: JSON.stringify({
      activeScale: 'exosphere', inquiry: '', prompt: EXO_CHAIN_PASSAGE, nodes: [
        { id: 'exo_usdoe', label: 'U.S. Department of Education', type: 'agency', scale: 'exosphere' },
        { id: 'exo_nysed', label: 'NYSED', type: 'agency', scale: 'exosphere' },
      ], relationships: [], projectOverlay: payload.projectOverlay, studentJudgments: payload.studentJudgments,
    }) });
    expect(response.status).toBe(201);
    expect((await response.json()).connections).toEqual(connections);
  });

  it.each(['memo', 'connections', 'map-check'])('preserves saved reverse direction and missing status in %s provider context', async kind => {
    const savedProcess = { direction: 'target to source', connectionStatus: 'missing', familyCount: 0, channel: 'phone', connectingWork: 'Parent', strength: 'contested' };
    const relationship = { source: 'micro_parent', target: 'micro_teacher', verb: 'shares updates with', relationshipProcess: savedProcess };
    const review = kind === 'memo' ? { ...meso(), connections: [] }
      : kind === 'map-check' ? { notes: [{ kind: 'gap', point: 'Check the evidence for the absent connection.', refs: ['edge_saved'] }] } : { connections: [] };
    const { system, run, headers, payload, evaluate } = await setup(review, { ...ASSIGNMENT_COMPARISON_CASES[0], text: 'The parent and teacher exchange updates.' });
    let response;
    if (kind === 'memo') { payload.carriedConnections = [relationship]; response = await evaluate(); }
    else response = await system.app.request(ORIGIN + (kind === 'map-check' ? '/api/map/check' : '/api/map/connections'), { method: 'POST', headers, body: JSON.stringify({
      activeScale: 'meso', inquiry: '', nodes: ASSIGNMENT_COMPARISON_CASES[0].carriedNodes,
      relationships: [kind === 'map-check' ? { id: 'edge_saved', ...relationship } : relationship],
      projectOverlay: payload.projectOverlay, studentJudgments: payload.studentJudgments,
      ...(kind === 'map-check' ? { intent: 'gaps', memoExcerpt: '', scopes: [] } : { prompt: 'Check another supported connection.' }),
    }) });
    expect(response.status).toBe(201);
    const input = run.mock.calls[0][0];
    expect(input.systemPrompt).toContain('connectionStatus missing documents an absent connection');
    const wire = JSON.parse(normalizeInput(input).projectInput);
    const carried = kind === 'connections' ? wire.memoDetails.existingConnections : wire.carriedConnections;
    expect(carried[0].relationshipProcess).toEqual(savedProcess);
  });

  it.each(['memo', 'connections', 'map-check'])('rejects invalid saved relationship process before %s provider work', async kind => {
    const relationship = { source: 'micro_parent', target: 'micro_teacher', verb: 'shares updates with', relationshipProcess: { familyCount: -1 } };
    const { system, run, headers, payload, evaluate } = await setup({ ...meso(), connections: [] });
    let response;
    if (kind === 'memo') { payload.carriedConnections = [relationship]; response = await evaluate(); }
    else response = await system.app.request(ORIGIN + (kind === 'map-check' ? '/api/map/check' : '/api/map/connections'), { method: 'POST', headers, body: JSON.stringify({
      activeScale: 'meso', inquiry: '', nodes: ASSIGNMENT_COMPARISON_CASES[0].carriedNodes,
      relationships: [kind === 'map-check' ? { id: 'edge_saved', ...relationship } : relationship],
      projectOverlay: payload.projectOverlay, studentJudgments: payload.studentJudgments,
      ...(kind === 'map-check' ? { intent: 'gaps', memoExcerpt: '', scopes: [] } : { prompt: 'Check another supported connection.' }),
    }) });
    expect(response.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it('requires every proposed outside office to participate in a supported path', async () => {
    const review = exo(); review.connections.shift();
    const { evaluate } = await setup(review, ASSIGNMENT_COMPARISON_CASES[1]); expect((await evaluate()).status).toBe(502);
  });
});

it('reviews an intact Meso table without confusing an unknown student count with an unknown relationship', async () => {
  const text = '| People connected | Information exchanged / missing | Strength + direction | Method + connector | Children / families affected | Evidence / source OR plan to find out |\n| --- | --- | --- | --- | --- | --- |\n| Parent and Teacher | School progress | Strong; two way | Communication through email. | Unknown; one school has 480 students. | School communication log. |';
  const fixture = { activeScale: 'meso', text, carriedNodes: [{ id:'parent',label:'Parent',type:'role',scale:'micro' },{ id:'teacher',label:'Teacher',type:'role',scale:'micro' }] };
  const review = {guidance:[],nodes:[],connections:[{source:'parent',target:'teacher',verb:'exchanges updates with',rationale:'Communication through email.',relationshipProcess:{strength:'strong',direction:'both directions',channel:'email',connectionStatus:'observed',familyCount:null}}],example:null,readiness:{ready:true,note:'The table documents a two-way exchange.'}};
  const {evaluate,run,system}=await setup(review,fixture);
  const response=await evaluate();expect(response.status).toBe(201);
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0][0].memoContext.mesoEvidence[0].relationshipProcess).toMatchObject({strength:'strong',direction:'both directions',channel:'email'});
  const saved=(await response.json()).evaluation;
  expect(saved.review.connections[0].relationshipProcess.familyCount).toBeNull();
  expect(system.db.prepare('SELECT count(*) AS n FROM preflight_evaluations').get().n).toBe(1);
  review.connections[0].relationshipProcess.familyCount=480;
  const bad=await setup(review,fixture);expect((await bad.evaluate()).status).toBe(502);
});
