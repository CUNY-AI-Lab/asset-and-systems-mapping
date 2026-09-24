// @vitest-environment node
import { expect, test, vi } from 'vitest';
import { correlationFromHeaders } from '@cuny-ai-lab/cail-log';
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
    expect(body).toMatchObject({ model: 'glm-5.2', stream: false });
    expect(body).not.toHaveProperty('max_tokens'); expect(body).not.toHaveProperty('provider');
    return Response.json({ model: 'glm-5.2', created: 1, choices: [{ message: { role: 'assistant', content: '{"guidance":[]}' }, finish_reason: 'stop' }] });
  });
  const result = await gatewaySuggestion({ fetch }, 'fixture-identity', 'glm-5.2', correlation)(input);
  expect(result.suggestion).toEqual({ guidance: [] }); expect(fetch).toHaveBeenCalledTimes(1);
});
test('quota refusal preserves stable metadata without leaking bodies or inviting another attempt', async () => {
  const fetch = vi.fn(async () => Response.json({ error: { message: 'private provider details', code: 'quota_exceeded', type: 'insufficient_quota', param: null } }, { status: 429, headers: { 'x-should-retry': 'false', 'x-request-id': correlation.request_id } }));
  let failure;
  try { await gatewaySuggestion({ fetch }, 'fixture-identity', 'glm-5.2', correlation)(input); } catch (error) { failure = safeGatewayFailure(error); }
  expect(failure).toMatchObject({ status: 429, details: { code: 'quota_exceeded', shouldRetry: false, requestId: correlation.request_id } });
  expect(JSON.stringify(failure)).not.toMatch(/private provider|try again/); expect(fetch).toHaveBeenCalledTimes(1);
});
test('cancellation ends waiting on a non-cooperative service or body, without retry', async () => {
  for (const never of [() => new Promise(() => {}), () => Promise.resolve(new Response(new ReadableStream({ pull: () => new Promise(() => {}) })))]) {
    const controller = new AbortController();
    const fetch = vi.fn(never);
    const pending = gatewaySuggestion({ fetch }, 'fixture-identity', 'glm-5.2', correlation)(input, null, { signal: controller.signal });
    setTimeout(() => controller.abort(new Error('test cancellation')), 10);
    await expect(pending).rejects.toThrow('test cancellation'); expect(fetch).toHaveBeenCalledTimes(1);
  }
});
test('oversized bodies and unavailable quota fail closed; obsolete IDs make no call', async () => {
  const fetch = vi.fn(async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)));
  await expect(gatewaySuggestion({ fetch }, 'fixture-identity', 'glm-5.2', correlation)(input)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(gatewaySuggestion({ fetch }, 'fixture-identity', 'z-ai/glm-5.2', correlation)(input)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(gatewayClient({ fetch: async () => Response.json({ error: 'unavailable' }, { status: 503 }) }).getQuota({ kind: 'jwt', token: 'fixture' }, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
});
