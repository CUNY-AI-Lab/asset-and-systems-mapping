// @vitest-environment node
import { expect, test, vi } from 'vitest';
import { correlationFromHeaders } from '@cuny-ai-lab/cail-log';
import { CailError } from '@cuny-ai-lab/cail-client';
import { gatewayClient, gatewaySuggestion, safeGatewayFailure } from './gateway.js';
const input = { systemPrompt: 'Test instruction', activeScale: 'micro', inquiry: 'A test inquiry', sourceMetadata: {}, sourceText: 'A synthetic memo.' };
const correlation = correlationFromHeaders(new Headers({ 'x-cail-request-id': '01900000-0000-7000-8000-000000000001' }));
test('one CAIL credential, canonical model, caller correlation and no provider controls reach the binding', async () => {
  const fetch = vi.fn(async request => {
    expect(request.url).toBe('https://tools.ailab.gc.cuny.edu/v1/chat/completions');
    expect(request.headers.get('x-cail-identity-jwt')).toBe('fixture-identity');
    expect(request.headers.has('authorization')).toBe(false);
    expect(request.headers.get('x-cail-request-id')).toBe(correlation.request_id);
    const body = await request.json();
    expect(body).toMatchObject({ model: 'glm-5.3-flash', stream: false });
    expect(body).not.toHaveProperty('max_tokens'); expect(body).not.toHaveProperty('provider');
    return Response.json({ model: 'glm-5.3-flash', created: 1, choices: [{ message: { role: 'assistant', content: '{"guidance":[]}' }, finish_reason: 'stop' }] });
  });
  const result = await gatewaySuggestion({ fetch }, 'fixture-identity', 'glm-5.3-flash', correlation)(input);
  expect(result.suggestion).toEqual({ guidance: [] }); expect(fetch).toHaveBeenCalledTimes(1);
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
