// @vitest-environment node
// Opt-in real-provider acceptance using only fictional memo fixtures.
import { describe, test, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { correlationFromHeaders } from '@cuny-ai-lab/cail-log';
import { createSystemsMappingApp } from '../server/app.js';
import { createDefaultProject, parseProject, serializeProject, validateProject } from '../src/domain.js';
import { preflightEvaluationPayload } from '../src/App.jsx';
import { beginPart2 } from '../src/projectMemo.js';
import { appendSubmittedNodes, openMemoWorkflowScale } from '../src/memoWorkflow.js';
import { NODE_SUBMISSION, submittedReviewIssue } from '../shared/node-submission.js';
import { gatewaySuggestion, safeGatewayFailure } from './gateway.js';
import { FIRST_MEMO, PART_TWO_CASES } from '../tests/fixtures/part-two-variety.js';

const HELPER = 'http://127.0.0.1:8796', ORIGIN = 'http://127.0.0.1:4177';
const MODEL = 'gpt-oss-120b';
const enabled = process.env.SYSTEMS_MAPPING_LIVE_VARIETY === '1';
async function withLiveReview(caseId, work) {
  const minted = await fetch(HELPER + '/mint', { method: 'POST', signal: AbortSignal.timeout(15000) });
  expect(minted.status).toBe(200);
  const issued = await minted.json();
  expect(Boolean(issued.ok && issued.key && issued.credential)).toBe(true);
  const correlation = correlationFromHeaders(new Headers());
  const reports = []; let calls = 0;
  const binding = { fetch: async request => {
    const headers = new Headers(request.headers); headers.delete('x-cail-identity-jwt');
    headers.set('authorization', `Bearer ${issued.key}`); calls++;
    return fetch(new Request(request, { headers }));
  } };
  const system = createSystemsMappingApp({ dbPath: ':memory:', classCode: '101',
    ollamaConfig: { apiKey: 'temporary-acceptance-principal', model: MODEL }, suggestionProvider: 'cail-gateway',
    suggestionFailure: error => safeGatewayFailure(error, correlation.request_id),
    ollamaRequest: (input, config, options) => gatewaySuggestion(binding, 'acceptance-test-boundary', MODEL, correlation, undefined, [])(input, config, { ...options, timeoutMs: 85000 }),
  });
  try {
    await system.ready;
    const access = await system.app.request(ORIGIN + '/api/student/access', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ code: '101' }) });
    expect(access.status).toBe(201);
    const cookie = access.headers.get('set-cookie').split(';')[0];
    const sessionRef = createHash('sha256').update(cookie.slice(cookie.indexOf('=') + 1)).digest('hex').slice(0, 16);
    const evaluate = async project => {
      const started = Date.now();
      const payload = preflightEvaluationPayload(project, true);
      expect(payload.workflowMode).toBe(NODE_SUBMISSION);
      expect(['micro', 'exosphere']).toContain(payload.activeScale);
      expect(payload.sourceMaterial).toBe(project.activeScale === 'micro' ? project.submission.text : project.part2Submission.text);
      const response = await system.app.request(ORIGIN + '/api/preflight/evaluations', { method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json', cookie }, body: JSON.stringify(payload),
        signal: AbortSignal.timeout(90000),
      }, { verifiedAccount: { studentSession: { sessionRef, expiresAt: Date.now() + 600000 }, guidanceTimeoutMs: 85000 } });
      const result = await response.json();
      reports.push({ scale: project.activeScale, status: response.status, elapsedMs: Date.now() - started, review: result.evaluation?.review, runtime: result.evaluation?.runtime, failureCode: result.details?.code });
      console.log(JSON.stringify({ caseId, scale: project.activeScale, status: response.status, elapsedMs: Date.now() - started, calls,
        nodes: result.evaluation?.review?.nodes?.length, connections: result.evaluation?.review?.connections?.length,
        groups: result.evaluation?.review?.connections?.filter(edge => edge.relationshipIds?.length).length }));
      expect(response.status).toBe(201);
      expect(result.evaluation.runtime.model).toBe(MODEL);
      expect(result.evaluation.review.guidance).toEqual([]);
      expect(result.evaluation.review.connections).toEqual([]);
      expect(result.evaluation.review.example).toBeNull();
      expect(submittedReviewIssue(result.evaluation.review, project.activeScale, payload.sourceMaterial, payload.memoUpdate, payload.carriedNodes)).toBeNull();
      return result.evaluation.review;
    };
    await work(evaluate);
  } finally {
    await system.close();
    try {
      const revoked = await fetch(HELPER + '/revoke', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: issued.credential.id, subject: issued.credential.subject }), signal: AbortSignal.timeout(15000) });
      expect(revoked.status).toBe(200); expect((await revoked.json()).ok).toBe(true);
    } finally {
      if (process.env.SYSTEMS_MAPPING_LIVE_OUTPUT_DIR) writeFileSync(join(process.env.SYSTEMS_MAPPING_LIVE_OUTPUT_DIR, `${caseId}.json`), JSON.stringify({ caseId, model: MODEL, calls, reports }, null, 2));
    }
  }
}

function localProject() {
    const project = createDefaultProject();
    project.submission.text = FIRST_MEMO;
    project.graph = { nodes: [], edges: [] };
    project.candidates = { nodes: [], edges: [] };
    appendSubmittedNodes(project, { guidance: [], nodes: [
      { label: 'Maya', type: 'person', scale: 'micro', evidence: 'Maya visits Harbor Library every Tuesday.' },
      { label: 'Harbor Library', type: 'place', scale: 'micro', evidence: 'Maya visits Harbor Library every Tuesday.' },
    ], connections: [], example: null, readiness: { ready: true, note: 'Nodes identified.' } });
    project.graph.edges = [{ id: 'visit', source: project.graph.nodes[0].id, target: project.graph.nodes[1].id,
      sourceLabel: project.graph.nodes[0].label, targetLabel: project.graph.nodes[1].label,
      verb: 'visits', scale: 'meso', status: 'confirmed', claimState: 'confirmed', notes: '',
      annotation: { id: 'visit-annotation', text: '' }, evidence: 'Maya visits Harbor Library every Tuesday.' }];
    validateProject(project);
    return project;
}

test('synthetic Part Two starting map passes the persisted project contract', () => {
  const project = localProject();
  expect(parseProject(serializeProject(project)).graph).toEqual(project.graph);
});

describe.skipIf(!enabled)('synthetic Part Two variety through the real Gateway provider', () => {
  for (const fixture of PART_TWO_CASES) test(fixture.id, () => {
    const project = localProject();
    return withLiveReview('variety-' + fixture.id, async evaluate => {
    const localNodes = structuredClone(project.graph.nodes);
    const localEdges = structuredClone(project.graph.edges);
    const firstMemo = structuredClone(project.submission);
    beginPart2(project); project.activeScale = 'exosphere';
    for (const [index, text] of [fixture.memo, fixture.revision].entries()) {
      project.part2Submission.text = text;
      const review = await evaluate(project);
      if (index === 0) expect(review.nodes.length).toBeGreaterThan(0);
      if (index === 0) expect([...new Set(review.nodes.map(node => node.scale))].sort()).toEqual([...fixture.expected].sort());
      else expect(review.nodes.every(node => fixture.expected.includes(node.scale))).toBe(true);
      const before = structuredClone(project.graph.nodes);
      appendSubmittedNodes(project, review);
      expect(project.graph.nodes.slice(0, localNodes.length)).toEqual(localNodes);
      expect(project.graph.edges).toEqual(localEdges);
      expect(project.submission).toEqual(firstMemo);
      for (const node of before) expect(project.graph.nodes.find(item => item.id === node.id)).toBeDefined();
      openMemoWorkflowScale(project, 'macrosphere');
      expect(parseProject(serializeProject(project)).graph).toEqual(project.graph);
      expect(project.part2Submission.text).toBe(text);
      openMemoWorkflowScale(project, 'exosphere');
    }
    });
  }, 240000);
});
