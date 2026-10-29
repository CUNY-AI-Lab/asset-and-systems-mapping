// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import { correlationFromHeaders } from '@cuny-ai-lab/cail-log';
import { CailError } from '@cuny-ai-lab/cail-client';
import { OpenRouterError } from '../server/openrouter.js';
import { gatewayClient, gatewaySuggestion, safeGatewayFailure, parseGatewayEnvelope } from './gateway.js';
const input = { systemPrompt: 'Test instruction', activeScale: 'micro', inquiry: 'A test inquiry', sourceMetadata: {}, sourceText: 'A synthetic memo.' };
const correlation = correlationFromHeaders(new Headers({ 'x-cail-request-id': '01900000-0000-7000-8000-000000000001' }));
afterEach(() => vi.useRealTimers());
test.each([
  ['glm-5.3-flash', '@cf/zai-org/glm-5.3-flash'],
  ['deepseek-v4-flash-0731', '@cf/deepseek-ai/deepseek-v4-flash-0731'],
  ['gpt-oss-20b', '@cf/openai/gpt-oss-20b'],
])('accepts the native Workers AI response ID for exactly %s', (requested, native) => {
  const body = JSON.stringify({ model: native, created: 1, choices: [{ message: { role: 'assistant', content: '{"guidance":[]}' }, finish_reason: 'stop' }] });
  expect(parseGatewayEnvelope(body, requested)).toMatchObject({ suggestion: { guidance: [] }, metadata: { model: requested } });
  expect(() => parseGatewayEnvelope(body, 'a-different-model')).toThrow('Unexpected model');
});
test('one CAIL credential, canonical model, caller correlation and no provider controls reach the binding', async () => {
  let request, body;
  const fetch = vi.fn(async incoming => {
    request = incoming;
    body = await incoming.json();
    return Response.json({ model: 'glm-5.3-flash', created: 1, choices: [{ message: { role: 'assistant', content: '{"guidance":[]}' }, finish_reason: 'stop' }] });
  });
  const result = await gatewaySuggestion({ fetch }, 'fixture-identity', 'glm-5.3-flash', correlation)(input);
  expect(result.suggestion).toEqual({ guidance: [] }); expect(fetch).toHaveBeenCalledTimes(1);
  expect(request.url).toBe('https://tools.ailab.gc.cuny.edu/v1/chat/completions');
  expect(request.headers.get('x-cail-identity-jwt')).toBe('fixture-identity');
  expect(request.headers.has('authorization')).toBe(false);
  expect(request.headers.get('x-cail-request-id')).toBe(correlation.request_id);
  expect(body).toMatchObject({ model: 'glm-5.3-flash', stream: false, reasoning_effort: 'low', max_completion_tokens: 4096 });
  expect(request.headers.get('x-cail-session-id')).toBe('systems-mapping-guidance');
  expect(body).not.toHaveProperty('max_tokens'); expect(body).not.toHaveProperty('provider');
  expect(body.messages[1].content).toContain('For a memo review, return at most 3 guidance points, 10 nodes, with an empty connections array');
  expect(body.messages[1].content).not.toContain('connections-only');
});

const unavailable = (code = 'upstream_unavailable', status = 503, retryAfter = '1') => Response.json({
  error: { code, message: 'private provider details', type: 'upstream_error', param: null },
}, { status, headers: { 'x-should-retry': 'true', 'retry-after': retryAfter } });

test.each(['upstream_unavailable', 'upstream_rate_limited', 'model_unavailable'])('known %s refusal uses one admitted GPT-OSS backup within the original deadline', async code => {
  vi.useFakeTimers();
  const models = [];
  const fetch = vi.fn(async request => {
    const body = await request.json();
    models.push(body.model);
    if (models.length === 1) return unavailable(code, code === 'upstream_rate_limited' ? 429 : 503);
    expect(body.reasoning_effort).toBe('low');
    expect(request.headers.get('x-cail-identity-jwt')).toBe('fixture-identity');
    return Response.json({ model: body.model, created: 1, choices: [{ message: { role: 'assistant', content: '{"guidance":[]}' }, finish_reason: 'stop' }] });
  });
  const result = gatewaySuggestion({ fetch }, 'fixture-identity', 'glm-5.3-flash', correlation)(input);
  const assertion = expect(result).resolves.toMatchObject({ metadata: { model: 'gpt-oss-20b', requestedModel: 'glm-5.3-flash' } });
  await vi.advanceTimersByTimeAsync(1000);
  await assertion;
  expect(models).toEqual(['glm-5.3-flash', 'gpt-oss-20b']);
  expect(vi.getTimerCount()).toBe(0);
});

test('a hanging provider stops at 25 seconds without starting a second ambiguous attempt', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(() => new Promise(() => {}));
  const result = gatewaySuggestion({ fetch }, 'fixture-identity', 'glm-5.3-flash', correlation)(input);
  const failure = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.advanceTimersByTimeAsync(25000);
  await failure;
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0].signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

test('durable generation can finish after the browser deadline and stops at its 85-second limit', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(() => new Promise(() => {}));
  const result = gatewaySuggestion({ fetch }, 'fixture-identity', 'glm-5.3-flash', correlation)(input, null, { timeoutMs: 85000 });
  const failure = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.advanceTimersByTimeAsync(30000);
  expect(fetch.mock.calls[0][0].signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(55000);
  await failure;
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0].signal.aborted).toBe(true);
});

test('a slow backup has only the time left in the original budget', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async () => fetch.mock.calls.length === 1 ? unavailable('upstream_unavailable', 503, '10') : new Promise(() => {}));
  const result = gatewaySuggestion({ fetch }, 'fixture-identity', 'glm-5.3-flash', correlation)(input);
  const failure = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(15000);
  await failure;
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

test.each(['upstream_timeout', 'upstream_auth_error', 'network_error', 'capability_unsupported'])('does not substitute models for %s even with misleading retry advice', async code => {
  const fetch = vi.fn(async () => unavailable(code, 502));
  await expect(gatewaySuggestion({ fetch }, 'fixture-identity', 'glm-5.3-flash', correlation)(input)).rejects.toMatchObject({ code });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('cancellation during backoff prevents the backup and clears its timer', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const fetch = vi.fn(async () => unavailable());
  const result = gatewaySuggestion({ fetch }, 'fixture-identity', 'glm-5.3-flash', correlation)(input, null, { signal: controller.signal });
  const failure = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(100);
  controller.abort();
  await failure;
  await vi.advanceTimersByTimeAsync(30000);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
test('quota refusal preserves stable metadata without leaking bodies or inviting another attempt', async () => {
  const fetch = vi.fn(async () => Response.json({ error: { message: 'private provider details', code: 'quota_exceeded', type: 'insufficient_quota', param: null } }, { status: 429, headers: { 'x-should-retry': 'false', 'x-request-id': correlation.request_id } }));
  let failure;
  try { await gatewaySuggestion({ fetch }, 'fixture-identity', 'glm-5.3-flash', correlation)(input); } catch (error) { failure = safeGatewayFailure(error); }
  expect(failure).toMatchObject({ status: 429, details: { code: 'quota_exceeded', shouldRetry: false, requestId: correlation.request_id } });
  expect(JSON.stringify(failure)).not.toMatch(/private provider|try again/); expect(fetch).toHaveBeenCalledTimes(1);
});
test('cancellation ends waiting on a non-cooperative service or body, without retry', async () => {
  for (const never of [() => new Promise(() => {}), () => Promise.resolve(new Response(new ReadableStream({ pull: () => new Promise(() => {}) })))]) {
    const controller = new AbortController();
    const fetch = vi.fn(never);
    const pending = gatewaySuggestion({ fetch }, 'fixture-identity', 'glm-5.3-flash', correlation)(input, null, { signal: controller.signal });
    setTimeout(() => controller.abort(new Error('test cancellation')), 10);
    await expect(pending).rejects.toThrow('test cancellation'); expect(fetch).toHaveBeenCalledTimes(1);
  }
});
test('oversized bodies and unavailable quota fail closed; obsolete IDs make no call', async () => {
  const fetch = vi.fn(async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)));
  await expect(gatewaySuggestion({ fetch }, 'fixture-identity', 'glm-5.3-flash', correlation)(input)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(gatewaySuggestion({ fetch }, 'fixture-identity', 'z-ai/glm-5.3-flash', correlation)(input)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(gatewayClient({ fetch: async () => Response.json({ error: 'unavailable' }, { status: 503 }) }).getQuota({ kind: 'jwt', token: 'fixture' }, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
});

test('an already cancelled action never reaches the Gateway', async () => {
  const fetch = vi.fn();
  const controller = new AbortController();
  controller.abort(new Error('student changed projects'));
  await expect(gatewaySuggestion({ fetch }, 'fixture-identity', 'glm-5.3-flash', correlation)(input, null, { signal: controller.signal })).rejects.toThrow('student changed projects');
  expect(fetch).not.toHaveBeenCalled();
});

test('only explicitly retryable Gateway failures expose bounded cooldowns and no raw bodies', async () => {
  const now = Date.parse('2026-10-02T23:00:00Z');
  for (const [extras, expected] of [
    [{ should_retry: true, retry_after_seconds: 7 }, 7],
    [{ should_retry: true, retry_after: '11' }, 11],
    [{ should_retry: true, retry_after: 'Fri, 02 Oct 2026 23:00:13 GMT' }, 13],
    [{ should_retry: false, retry_after_seconds: 7 }, null],
    [{ retry_after: '11' }, null],
    [{ should_retry: true, retry_after: 'provider private details' }, null],
    [{ should_retry: true, retry_after: '1\r\nX-Private: body' }, null],
    [{ should_retry: true, retry_after_seconds: 86401 }, null],
    [{ should_retry: true, retry_after: 'Fri, 02 Oct 2026 22:59:59 GMT' }, null],
  ]) {
    const failure = safeGatewayFailure(new CailError('upstream_failure', 'private response', 503, extras), correlation.request_id, now);
    if (expected) {
      expect(failure.details.retryAfterSeconds).toBe(expected);
      expect(failure.headers).toEqual({ 'Retry-After': String(expected) });
    } else {
      expect(failure.details).not.toHaveProperty('retryAfterSeconds');
      expect(failure).not.toHaveProperty('headers');
    }
    expect(JSON.stringify(failure)).not.toMatch(/private response|private details|X-Private/);
  }
});

test('Gateway Retry-After survives the service-binding response without another request', async () => {
  const fetch = vi.fn(async () => Response.json({ error: { message: 'unusable private response', code: 'upstream_failure', type: 'upstream_error', param: null } }, { status: 503, headers: { 'x-should-retry': 'true', 'retry-after': '9' } }));
  let failure;
  try { await gatewaySuggestion({ fetch }, 'fixture-identity', 'glm-5.3-flash', correlation)(input); }
  catch (error) { failure = safeGatewayFailure(error, correlation.request_id); }
  expect(failure).toMatchObject({ status: 503, details: { shouldRetry: true, retryAfterSeconds: 9 }, headers: { 'Retry-After': '9' } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('classifies completed output failures without exposing response text or retrying them', () => {
  for (const [error, code, field] of [
    [new OpenRouterError('private provider response', 'response_too_large'), 'guidance_output_truncated'],
    [new OpenRouterError('private provider response', 'invalid_response'), 'guidance_output_invalid'],
    [Object.assign(new Error('nodes[2].label contains private text'), { name: 'MemoReviewSemanticError', code: 'MEMO_REVIEW_SEMANTIC_INVALID' }), 'guidance_contract_invalid', 'nodes[2].label'],
    [Object.assign(new Error('guidance[0].evidenceExcerpt must quote the supplied memo; private passage'), { name: 'MemoReviewSemanticError', code: 'MEMO_REVIEW_SEMANTIC_INVALID' }), 'guidance_contract_invalid', 'guidance[0].evidenceExcerpt'],
  ]) {
    const safe = safeGatewayFailure(error, correlation.request_id);
    expect(safe).toMatchObject({ status: 502, details: { code, shouldRetry: false, requestId: correlation.request_id } });
    expect(JSON.stringify(safe)).not.toContain('private');
    if (code === 'guidance_contract_invalid') expect(safe.details.validationField).toBe(field);
  }
});
