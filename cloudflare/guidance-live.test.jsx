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

const HELPER = 'http://127.0.0.1:8796';
const ORIGIN = 'http://127.0.0.1:4177';
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
    ['glm-5.3-flash', false],
    ...(process.env.SYSTEMS_MAPPING_LIVE_DEEPSEEK === '1' ? [['deepseek-v4-flash-0731', false]] : []),
    ['gpt-oss-20b', false],
    ['glm-5.3-flash', true],
  ])('%s, controlled refusal=%s', async (model, refusePrimary) => {
    const correlation = correlationFromHeaders(new Headers());
    let paidCalls = 0;
    let bindingCalls = 0;
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
      return new Response(text, { status: response.status, headers: response.headers });
    } };
    const system = createSystemsMappingApp({ dbPath: ':memory:', classCode: '101',
      ollamaConfig: { apiKey: 'acceptance-helper', model }, suggestionProvider: 'cail-gateway',
      suggestionFailure: error => {
        console.log(JSON.stringify({ model, errorType: error?.name, errorCode: error?.code,
          ...(error?.name === 'MemoReviewSemanticError' ? { validation: error.message } : {}),
        }));
        return safeGatewayFailure(error, correlation.request_id);
      },
      ollamaRequest: gatewaySuggestion(binding, 'acceptance-test-boundary', model, correlation, undefined, refusePrimary ? ['gpt-oss-20b'] : []),
    });
    try {
      await system.ready;
      const access = await system.app.request(ORIGIN + '/api/student/access', { method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ code: '101' }),
      });
      expect(access.status).toBe(201);
      const project = createDefaultProject();
      project.submission.text = MEMO;
      project.inquiry = 'What affects Rosa’s access to everyday support?';
      const started = Date.now();
      const response = await system.app.request(ORIGIN + '/api/preflight/evaluations', { method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json', cookie: access.headers.get('set-cookie').split(';')[0] },
        body: JSON.stringify(preflightEvaluationPayload(project)), signal: AbortSignal.timeout(28000),
      });
      const result = await response.json();
      console.log(JSON.stringify({ boundary: 'real-gateway-app-key-local-product', model,
        controlledPrimaryRefusal: refusePrimary, status: response.status, elapsedMs: Date.now() - started,
        paidCalls, bindingCalls, servedModel: result.evaluation?.runtime?.model,
        nodes: result.evaluation?.review?.nodes?.length, connections: result.evaluation?.review?.connections?.length,
        failureCode: result.details?.code, requestId: correlation.request_id,
      }));
      expect(response.status).toBe(201);
      expect(Date.now() - started).toBeLessThan(30000);
      expect(result.evaluation.review.nodes.length).toBeGreaterThan(1);
      expect(result.evaluation.review.connections.length).toBeGreaterThan(0);
      expect(result.evaluation.runtime.model).toBe(refusePrimary ? 'gpt-oss-20b' : model);
      expect(paidCalls).toBe(1);
    } finally { system.close(); }
  }, 35000);

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
  }, 35000);
});
