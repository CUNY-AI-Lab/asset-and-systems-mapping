// @vitest-environment node
// Explicit paid acceptance only. Requires the owning Gateway repository's
// unmodified loopback Registry acceptance helper on port 8796. No key is logged
// or saved, and the short-lived test key is revoked even when a model fails.
import { beforeAll, afterAll, describe, test, expect } from 'vitest';
import { correlationFromHeaders } from '@cuny-ai-lab/cail-log';
import { createSystemsMappingApp } from '../server/app.js';
import { createDefaultProject } from '../src/domain.js';
import { preflightEvaluationPayload } from '../src/App.jsx';
import { gatewaySuggestion, safeGatewayFailure } from './gateway.js';
import { boundedText } from './bounded.js';
import { ASSIGNMENT_COMPARISON_CASES } from '../tests/fixtures/assignment-guidance-cases.js';
import { BIBLIOGRAPHY_COMPARISON_CASES } from '../tests/fixtures/bibliography-guidance-cases.js';
import { CITATION_COMPARISON_CASES } from '../tests/fixtures/memo-citation-cases.js';
import { analyzeMemoSource, bibliographyOnlyLabel, bibliographyOnlyEvidence } from '../shared/memo-source.js';

const HELPER = 'http://127.0.0.1:8796';
const ORIGIN = 'http://127.0.0.1:4177';
const DURABLE_BUDGET = process.env.SYSTEMS_MAPPING_LIVE_DURABLE === '1';
const MODEL_BUDGET_MS = DURABLE_BUDGET ? 85000 : 25000;
const BOUNDARY = DURABLE_BUDGET ? 'real-gateway-app-key-local-verified-durable-budget' : 'real-gateway-app-key-local-product';
const MEMO = `This is a made-up case for my East Harlem disability class. Rosa uses a cane and lives in a walk-up apartment. Her daughter Marisol picks up her medication. Denise, a neighbor, brings her mail upstairs. I think the stairs make small errands into big plans. At Metropolitan Hospital, a nurse named Jo helps Rosa understand her appointments. Rosa also goes to a peer group at a neighborhood center, where facilitator Luis helps her find benefits advice. Rosa carries clinic paperwork to the center herself. I am not sure whether the clinic and center talk to each other. Access-A-Ride trips sometimes arrive late. The MTA scheduling office decides the trips but Rosa is not part of those decisions. Rent increases and inaccessible old buildings seem important too, but I do not know what evidence would connect them to her situation.`;

describe.skipIf(process.env.SYSTEMS_MAPPING_LIVE_GUIDANCE !== '1')('paid Gateway guidance acceptance', () => {
  let issued;
  beforeAll(async () => {
    const response = await fetch(HELPER + '/mint', { method: 'POST', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Acceptance credential unavailable (${response.status})`);
    issued = await response.json();
    if (!issued.ok || !issued.key || !issued.credential) throw new Error('Acceptance credential unavailable');
  });
  afterAll(async () => {
    if (!issued?.credential) return;
    const response = await fetch(HELPER + '/revoke', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: issued.credential.id, subject: issued.credential.subject }),
      signal: AbortSignal.timeout(15000),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });

  test.each([
    ['glm-5.3-flash', false, 'baseline', null],
    ...(process.env.SYSTEMS_MAPPING_LIVE_DEEPSEEK === '1' ? [['deepseek-v4-flash-0731', false, 'baseline', null]] : []),
    ['gpt-oss-20b', false, 'baseline', null],
    ['glm-5.3-flash', true, 'availability-fallback', null],
    ...(process.env.SYSTEMS_MAPPING_LIVE_CITATIONS === '1' ? CITATION_COMPARISON_CASES.flatMap(fixture => ['glm-5.3-flash', 'gpt-oss-20b'].map(model => [model, false, `citation-comparison:${fixture.id}`, fixture])) : []),
    ...(process.env.SYSTEMS_MAPPING_LIVE_BIBLIOGRAPHY === '1' ? BIBLIOGRAPHY_COMPARISON_CASES.flatMap(fixture => ['glm-5.3-flash', 'gpt-oss-20b'].map(model => [model, false, `bibliography-comparison:${fixture.id}`, fixture])) : []),
    ...(process.env.SYSTEMS_MAPPING_LIVE_ASSIGNMENT === '1' ? ASSIGNMENT_COMPARISON_CASES.flatMap(fixture => ['glm-5.3-flash', 'gpt-oss-20b'].map(model => [model, false, `assignment-comparison:${fixture.id}`, fixture])) : []),
  ])('%s, controlled refusal=%s, fixture=%s', async (model, refusePrimary, caseId, fixture) => {
    const correlation = correlationFromHeaders(new Headers());
    let paidCalls = 0;
    let bindingCalls = 0;
    let validationFailure;
    const binding = { fetch: async request => {
      bindingCalls++;
      if (refusePrimary && bindingCalls === 1) return Response.json({ error: {
        code: 'upstream_unavailable', type: 'upstream_error', message: 'Controlled pre-inference refusal', param: null,
      } }, { status: 503, headers: { 'x-should-retry': 'true', 'retry-after': '1' } });
      // The live provider is real; the test identity is a temporary application
      // principal. This is not signed-in browser/SSO acceptance.
      const headers = new Headers(request.headers);
      headers.delete('x-cail-identity-jwt');
      headers.set('authorization', `Bearer ${issued.key}`);
      paidCalls++;
      const response = await fetch(new Request(request, { headers }));
      const text = await boundedText(response, request.signal, 2 * 1024 * 1024);
      let shape;
      try { shape = JSON.parse(text); } catch { shape = {}; }
      const choice = shape.choices?.[0];
      let contentShape;
      try { contentShape = JSON.parse(choice?.message?.content); } catch { contentShape = null; }
      console.log(JSON.stringify({ envelope: { status: response.status, keys: Object.keys(shape),
        model: shape.model, createdType: typeof shape.created, role: choice?.message?.role,
        contentType: typeof choice?.message?.content, finish: choice?.finish_reason,
        contentLength: choice?.message?.content?.length, contentKeys: typeof choice?.message?.content === 'object' ? Object.keys(choice.message.content ?? {}) : undefined,
        usage: shape.usage,
        outputKeys: Object.keys(contentShape ?? {}), guidanceKind: Array.isArray(contentShape?.guidance) ? 'array' : typeof contentShape?.guidance,
        guidanceCount: contentShape?.guidance?.length, nodesCount: contentShape?.nodes?.length, connectionsCount: contentShape?.connections?.length,
      } }));
      if (process.env.SYSTEMS_MAPPING_LIVE_DETAILS === '1' && fixture?.activeScale) console.log(JSON.stringify({
        boundary: 'synthetic-assignment-completed-output', model, caseId, paidCalls,
        connections: Array.isArray(contentShape?.connections) ? contentShape.connections.map(edge => ({
          keys: edge && typeof edge === 'object' ? Object.keys(edge) : [],
          source: edge?.source, target: edge?.target, rationale: edge?.rationale, relationshipProcess: edge?.relationshipProcess,
        })) : undefined,
      }));
      return new Response(text, { status: response.status, headers: response.headers });
    } };
    const system = createSystemsMappingApp({ dbPath: ':memory:', classCode: '101',
      ollamaConfig: { apiKey: 'acceptance-helper', model }, suggestionProvider: 'cail-gateway',
      suggestionFailure: error => {
        validationFailure = { type: error?.name, code: error?.code,
          ...(error?.name === 'MemoReviewSemanticError' ? { validation: error.message } : {}) };
        console.log(JSON.stringify({ model, errorType: error?.name, errorCode: error?.code,
          ...(error?.name === 'MemoReviewSemanticError' ? { validation: error.message } : {}),
        }));
        return safeGatewayFailure(error, correlation.request_id);
      },
      guidanceValidationFailure: failure => console.log(JSON.stringify({ model, caseId, ...failure })),
      ollamaRequest: (input, config, options) => {
        if (fixture?.providerNarrative) {
          expect(input.sourceText.replace(/\s+/g, ' ').trim()).toBe(fixture.providerNarrative.replace(/\s+/g, ' ').trim());
          expect(input.sourceText).not.toContain('Example Press');
        }
        return gatewaySuggestion(binding, 'acceptance-test-boundary', model, correlation, undefined, refusePrimary ? ['gpt-oss-20b'] : [])(input, config, { ...options, timeoutMs: MODEL_BUDGET_MS });
      },
    });
    try {
      await system.ready;
      const access = await system.app.request(ORIGIN + '/api/student/access', { method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ code: '101' }),
      });
      expect(access.status).toBe(201);
      const project = createDefaultProject();
      project.submission.text = fixture?.text || MEMO;
      if (fixture?.activeScale) project.activeScale = fixture.activeScale;
      if (fixture?.carriedNodes) project.graph.nodes = fixture.carriedNodes.map(node => ({ ...node, status: 'confirmed', claimState: 'observed' }));
      project.inquiry = 'What affects Rosa’s access to everyday support?';
      const started = Date.now();
      const response = await system.app.request(ORIGIN + '/api/preflight/evaluations', { method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json', cookie: access.headers.get('set-cookie').split(';')[0] },
        body: JSON.stringify(preflightEvaluationPayload(project)), signal: AbortSignal.timeout(DURABLE_BUDGET ? 90000 : 28000),
      }, DURABLE_BUDGET ? { verifiedAccount: { studentSession: { sessionRef: '0123456789abcdef', expiresAt: Date.now() + 3600000 }, guidanceTimeoutMs: MODEL_BUDGET_MS } } : undefined);
      const result = await response.json();
      console.log(JSON.stringify({ boundary: BOUNDARY, modelBudgetMs: MODEL_BUDGET_MS, model,
        controlledPrimaryRefusal: refusePrimary, caseId, status: response.status, elapsedMs: Date.now() - started,
        paidCalls, bindingCalls, servedModel: result.evaluation?.runtime?.model,
        nodes: result.evaluation?.review?.nodes?.length, connections: result.evaluation?.review?.connections?.length,
        failureCode: result.details?.code, correctiveRetries: result.evaluation?.runtime?.correctiveRetries || result.details?.correctiveRetries || 0, evidenceRepairAttempts: result.evaluation?.runtime?.evidenceRepairAttempts || result.details?.evidenceRepairAttempts || 0, requestId: correlation.request_id,
      }));
      if (process.env.SYSTEMS_MAPPING_LIVE_DETAILS === '1' && fixture?.activeScale) console.log(JSON.stringify({
        boundary: 'synthetic-assignment-details', model, caseId,
        connections: result.evaluation?.review?.connections?.map(({ source, target, relationshipProcess }) => ({ source, target, relationshipProcess })),
      }));
      expect(response.status, JSON.stringify(validationFailure)).toBe(201);
      expect(Date.now() - started).toBeLessThan(DURABLE_BUDGET ? 90000 : 30000);
      if (fixture?.activeScale === 'meso') {
        expect(result.evaluation.review.nodes).toEqual([]);
        const connections = result.evaluation.review.connections;
        expect(connections.some(edge => edge.relationshipProcess?.familyCount === 24 && edge.relationshipProcess?.strength === 'strong')).toBe(true);
        expect(connections.some(edge => edge.relationshipProcess?.connectionStatus === 'missing' && [edge.source, edge.target].includes('micro_therapist'))).toBe(true);
        expect(connections.some(edge => edge.relationshipProcess?.direction === 'both directions')).toBe(true);
        for (const edge of connections) {
          expect(fixture.carriedNodes.map(node => node.id)).toContain(edge.source);
          expect(fixture.carriedNodes.map(node => node.id)).toContain(edge.target);
        }
      } else if (fixture?.activeScale === 'exosphere') {
        expect(result.evaluation.review.nodes.length).toBeGreaterThan(1);
        const outer = new Set(result.evaluation.review.nodes.map(node => node.label));
        expect(result.evaluation.review.connections.some(edge => outer.has(edge.sourceLabel) && outer.has(edge.targetLabel) && edge.verb === 'funds')).toBe(true);
      } else {
        expect(result.evaluation.review.nodes.length).toBeGreaterThan(1);
        expect(result.evaluation.review.connections).toEqual([]);
      }
      if (fixture) {
        const source = analyzeMemoSource(fixture.text);
        for (const node of result.evaluation.review.nodes) {
          expect(bibliographyOnlyLabel(node.label, source), `bibliography-only node in ${caseId}`).toBe(false);
          expect(bibliographyOnlyEvidence(node.evidence, source), `bibliography-only evidence in ${caseId}`).toBe(false);
        }
        const stored = system.db.prepare('SELECT source_material FROM preflight_evaluations WHERE id = ?').get(result.evaluation.id);
        expect(stored.source_material).toBe(fixture.text);
      }
      expect(result.evaluation.runtime.model).toBe(refusePrimary ? 'gpt-oss-20b' : model);
      expect(paidCalls).toBe(1 + (result.evaluation.runtime.correctiveRetries || 0));
      expect(paidCalls).toBeLessThanOrEqual(3);
    } finally { system.close(); }
  }, DURABLE_BUDGET ? 95000 : 35000);

  test.skipIf(process.env.SYSTEMS_MAPPING_LIVE_PROBE !== '1')('minimal DeepSeek latency probe', async () => {
    const binding = { fetch: request => {
      const headers = new Headers(request.headers);
      headers.delete('x-cail-identity-jwt');
      headers.set('authorization', `Bearer ${issued.key}`);
      return fetch(new Request(request, { headers }));
    } };
    const started = Date.now();
    try {
      const result = await gatewaySuggestion(binding, 'acceptance-test-boundary', 'deepseek-v4-flash-0731', correlationFromHeaders(new Headers()), undefined, [])({
        systemPrompt: 'Return only JSON with one field named ok set to true', activeScale: 'micro', inquiry: 'Test', sourceMetadata: {}, sourceText: 'Synthetic latency test',
      });
      console.log(JSON.stringify({ boundary: 'real-gateway-minimal-probe', model: 'deepseek-v4-flash-0731', elapsedMs: Date.now() - started, ok: result.suggestion.ok === true }));
      expect(result.suggestion.ok).toBe(true);
    } catch (error) {
      console.log(JSON.stringify({ boundary: 'real-gateway-minimal-probe', elapsedMs: Date.now() - started, errorType: error?.name, errorCode: error?.code }));
      throw error;
    }
  }, DURABLE_BUDGET ? 95000 : 35000);
});
