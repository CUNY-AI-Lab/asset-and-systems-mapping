// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSystemsMappingApp } from './app.js';
import { safeGatewayFailure } from '../cloudflare/gateway.js';
import { createDefaultProject, createPortableProject, parseProject } from '../src/domain.js';
import { preflightEvaluationPayload } from '../src/App.jsx';

const ORIGIN = 'http://127.0.0.1:4177';
const REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const systems = [];
afterEach(async () => { for (const system of systems.splice(0)) await system.close(); });
const microReview = passage => ({ guidance: [{ point: 'The memo describes two immediate participants.', evidenceExcerpt: passage }],
  nodes: [{ label: 'Rosa', type: 'person', scale: 'micro', evidence: passage }, { label: 'Teacher', type: 'role', scale: 'micro', evidence: passage }],
  connections: [], example: null, readiness: { ready: true, note: 'Two participants can begin the map.' } });
const carriedNodes = [{ id: 'rosa', label: 'Rosa', type: 'person', scale: 'micro' }, { id: 'teacher', label: 'Teacher', type: 'role', scale: 'micro' }];
const mesoReview = passage => ({ guidance: [{ point: 'The memo describes an exchange.', evidenceExcerpt: passage }], nodes: [],
  connections: [{ source: 'rosa', target: 'teacher', verb: 'exchanges updates with', rationale: passage }],
  example: null, readiness: { ready: true, note: 'One exchange connects two mapped participants.' } });

async function setup(text, reviews, scale = 'micro') {
  const queue = Array.isArray(reviews) ? reviews : [reviews];
  let call = 0;
  const run = vi.fn(async () => ({ suggestion: structuredClone(queue[Math.min(call++, queue.length - 1)]), metadata: { provider: 'cail-gateway', model: 'synthetic-whitespace' } }));
  const failures = vi.fn();
  const system = createSystemsMappingApp({ dbPath: ':memory:', classCode: '101',
    ollamaConfig: { apiKey: 'test-only', model: 'synthetic-whitespace' }, suggestionProvider: 'cail-gateway', ollamaRequest: run,
    suggestionFailure: error => safeGatewayFailure(error, REQUEST_ID), guidanceValidationFailure: failures });
  systems.push(system); await system.ready;
  const headers = { origin: ORIGIN, 'content-type': 'application/json' };
  const access = await system.app.request(`${ORIGIN}/api/student/access`, { method: 'POST', headers, body: JSON.stringify({ code: '101' }) });
  headers.cookie = access.headers.get('set-cookie').split(';')[0];
  const project = createDefaultProject(); project.activeScale = scale; project.submission.text = text;
  if (scale === 'meso') project.graph.nodes = carriedNodes.map(node => ({ ...node, status: 'confirmed', claimState: 'observed' }));
  const payload = preflightEvaluationPayload(project);
  const evaluate = () => system.app.request(`${ORIGIN}/api/preflight/evaluations`, { method: 'POST', headers, body: JSON.stringify(payload) });
  return { system, run, failures, project, payload, headers, evaluate };
}

describe('quoted evidence whitespace', () => {
  it.each(['\n', '\r\n', '\n\n', '\t', '\u00a0', '  '])('preserves a source quotation containing %j through review, storage and project export', async whitespace => {
    const passage = `Rosa meets${whitespace}the teacher at school.`;
    const review = microReview(passage);
    const { evaluate, run, failures, system, project } = await setup(passage, review);
    const response = await evaluate(); expect(response.status).toBe(201);
    const { evaluation } = await response.json();
    expect(evaluation.review).toEqual(review);
    expect(run).toHaveBeenCalledTimes(1); expect(failures).not.toHaveBeenCalled();
    const stored = system.db.prepare('SELECT source_material, suggestion_json FROM preflight_evaluations WHERE id = ?').get(evaluation.id);
    expect(stored.source_material).toBe(passage);
    expect(JSON.parse(stored.suggestion_json).guidance[0].evidenceExcerpt).toBe(passage);
    // The create response is itself read from the stored atomic review.
    project.preflight = { memoReview: evaluation.review, configurationSnapshot: evaluation.configSnapshot, sourceFingerprint: 'synthetic-source',
      evaluation: { evaluationId: evaluation.id, createdAt: evaluation.createdAt, expiresAt: evaluation.expiresAt, runtime: evaluation.runtime } };
    expect(parseProject(JSON.stringify(createPortableProject(project, 'private'))).preflight.memoReview.guidance[0].evidenceExcerpt).toBe(passage);
  });

  it.each(['micro', 'meso'])('preserves multiline %s evidence during final quotation selection', async scale => {
    const passage = 'Rosa exchanges updates\nwith the teacher at school.';
    const valid = scale === 'micro' ? microReview(passage) : mesoReview(passage);
    const invalid = structuredClone(valid); invalid.guidance[0].evidenceExcerpt = 'Rosa sends an invented report.';
    const { evaluate, run } = await setup(passage, [invalid, invalid, { quotes: [0] }], scale);
    const response = await evaluate(); expect(response.status).toBe(201);
    const { evaluation } = await response.json();
    expect(run).toHaveBeenCalledTimes(3);
    expect(evaluation.runtime).toMatchObject({ correctiveRetries: 2, evidenceRepairAttempts: 1 });
    expect(evaluation.review.guidance[0].evidenceExcerpt).toBe(passage);
    if (scale === 'micro') expect(evaluation.review.nodes.every(node => node.evidence === passage)).toBe(true);
    else expect(evaluation.review.connections[0].rationale).toBe(passage);
  });

  it.each(['guidance', 'node', 'rationale'])('keeps source matching for fabricated or paraphrased %s evidence in strict repair', async field => {
    const passage = 'Rosa exchanges updates\nwith the teacher at school.';
    const scale = field === 'rationale' ? 'meso' : 'micro';
    const valid = scale === 'meso' ? mesoReview(passage) : microReview(passage);
    const reference = 'Smith, A. (2025). Community schooling. Example Press.';
    const first = structuredClone(valid);
    if (scale === 'micro') first.nodes[0].evidence = reference;
    else first.connections[0].rationale = reference;
    const final = structuredClone(valid);
    const unsupported = 'Rosa and the teacher\ncommunicate about school.';
    if (field === 'guidance') final.guidance[0].evidenceExcerpt = unsupported;
    else if (field === 'node') final.nodes[0].evidence = unsupported;
    else final.connections[0].rationale = unsupported;
    const { evaluate, run, system } = await setup(passage + '\n\nReferences\n' + reference, [first, first, final], scale);
    const response = await evaluate(); expect(response.status).toBe(502);
    expect((await response.json()).details).toMatchObject({ code: 'guidance_contract_invalid', validationReason: 'source_evidence', evidenceRepairAttempts: 1 });
    expect(run).toHaveBeenCalledTimes(3);
    expect(system.db.prepare('SELECT count(*) AS n FROM preflight_evaluations').get().n).toBe(0);
  });

  it.each(['guidance', 'node', 'rationale'])('preserves actual length, nonempty and control-character limits for %s evidence', async field => {
    for (const invalidText of [' \n\t ', 'a'.repeat(field === 'rationale' ? 1001 : 501), 'Rosa\u0000meets the teacher.']) {
      const passage = 'Rosa exchanges updates with the teacher at school.';
      const scale = field === 'rationale' ? 'meso' : 'micro';
      const invalid = scale === 'meso' ? mesoReview(passage) : microReview(passage);
      if (field === 'guidance') invalid.guidance[0].evidenceExcerpt = invalidText;
      else if (field === 'node') invalid.nodes[0].evidence = invalidText;
      else invalid.connections[0].rationale = invalidText;
      const { evaluate, run, system } = await setup(passage, invalid, scale);
      const response = await evaluate();
      expect(response.status).toBe(502); expect(run).toHaveBeenCalledTimes(2);
      expect((await response.json()).details.validationReason).toBe('text_format');
      expect(system.db.prepare('SELECT count(*) AS n FROM preflight_evaluations').get().n).toBe(0);
    }
  });

  it.each(['label', 'verb'])('keeps canonical whitespace requirements for %s', async field => {
    const passage = 'Rosa exchanges updates with the teacher at school.';
    const scale = field === 'verb' ? 'meso' : 'micro';
    const invalid = scale === 'meso' ? mesoReview(passage) : microReview(passage);
    if (field === 'label') invalid.nodes[0].label = 'Rosa\nSmith';
    else invalid.connections[0].verb = 'exchanges\nupdates with';
    const { evaluate, run } = await setup(passage, invalid, scale);
    expect((await evaluate()).status).toBe(502); expect(run).toHaveBeenCalledTimes(2);
  });

  it('preserves multiline quoted rationale in the separate connection-suggestion path', async () => {
    const passage = 'Rosa exchanges updates\nwith the teacher at school.';
    const review = { connections: mesoReview(passage).connections };
    const { system, headers, payload, run } = await setup(passage, review, 'meso');
    const response = await system.app.request(`${ORIGIN}/api/map/connections`, { method: 'POST', headers, body: JSON.stringify({
      activeScale: 'meso', inquiry: '', prompt: passage, nodes: carriedNodes, relationships: [], projectOverlay: payload.projectOverlay, studentJudgments: payload.studentJudgments,
    }) });
    expect(response.status).toBe(201);
    expect((await response.json()).connections[0].rationale).toBe(passage);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
