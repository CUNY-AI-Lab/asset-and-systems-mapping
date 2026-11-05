// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import { correlationFromHeaders } from '@cuny-ai-lab/cail-log';
import { CailError } from '@cuny-ai-lab/cail-client';
import { unstable_readConfig } from 'wrangler';
import { OpenRouterError } from '../server/openrouter.js';
import { memoSourceFingerprint } from '../shared/memo-update.js';
import { gatewayClient, gatewaySuggestion, safeGatewayFailure, parseGatewayEnvelope } from './gateway.js';
const input = { systemPrompt: 'Test instruction', activeScale: 'micro', inquiry: 'A test inquiry', sourceMetadata: {}, sourceText: 'A synthetic memo.' };
const correlation = correlationFromHeaders(new Headers({ 'x-cail-request-id': '01900000-0000-7000-8000-000000000001' }));
afterEach(() => vi.useRealTimers());
test('node submission reserves reasoning headroom while keeping six nodes and no relationships', async () => {
  let body;
  const fetch = vi.fn(async request => { body = await request.json(); return Response.json({ model:'gpt-oss-120b', created:1, choices:[{message:{role:'assistant',content:'{"nodes":[]}'},finish_reason:'stop'}] }); });
  await gatewaySuggestion({fetch}, 'fixture-identity', 'gpt-oss-120b', correlation)({...input, workflowMode:'student-nodes-v1'});
  const schema=JSON.parse(body.messages[1].content.split('REQUIRED RESPONSE JSON SCHEMA\n')[1]);
  expect(body.max_completion_tokens).toBe(8192);
  expect(schema.properties.nodes.maxItems).toBe(6);
  expect(schema.properties.connections.maxItems).toBe(0);
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('incremental Gateway requests keep only permitted existing identities and no relationship output', async () => {
  let body;
  const sourceText = 'Teachers meet families daily.';
  const carriedNodes = [{ id: 'teacher', label: 'School staff', type: 'role', scale: 'micro' }];
  const memoUpdate = { version: 1, part: 1, baselineFingerprint: 'src_previous', sourceFingerprint: memoSourceFingerprint(sourceText),
    passages: [{ start: 0, end: sourceText.length, text: sourceText }], existingNodes: [
      { ...carriedNodes[0], evidence: 'Teachers meet families weekly.', originalLabel: 'Teachers', originalType: 'person', originalScale: 'micro', removed: false },
      { id: 'removed', label: 'Community room', type: 'setting', scale: 'micro', evidence: 'The community room is open.', originalLabel: 'Community room', originalType: 'setting', originalScale: 'micro', removed: true },
    ] };
  const fetch = vi.fn(async request => { body = await request.json(); return Response.json({ model: 'gpt-oss-120b', created: 1, choices: [{ message: { role: 'assistant', content: '{"nodes":[]}' }, finish_reason: 'stop' }] }); });
  await gatewaySuggestion({ fetch }, 'fixture-identity', 'gpt-oss-120b', correlation)({ ...input, sourceText, workflowMode: 'student-nodes-v1', carriedNodes, memoContext: { memoUpdate } });
  const schema = JSON.parse(body.messages[1].content.split('REQUIRED RESPONSE JSON SCHEMA\n')[1]);
  expect(schema.properties.nodes.maxItems).toBe(6);
  expect(schema.properties.connections.maxItems).toBe(0);
  expect(JSON.stringify(schema.properties.nodes)).toContain('existingId');
  expect(JSON.stringify(schema.properties.nodes)).toContain('teacher');
  expect(JSON.stringify(schema.properties.nodes)).not.toContain('removed');
  const sent = JSON.parse(body.messages[2].content.split('PROJECT INPUT (JSON DATA ONLY)\n')[1]);
  expect(sent.memoContext.memoUpdate).toEqual(memoUpdate);
  expect(sent.memoText).toBe(sourceText);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('oversize combined request fails before a Gateway call despite individually bounded fields', async () => {
  const fetch = vi.fn();
  const oversized = { ...input, systemPrompt: 's'.repeat(64 * 1024), sourceText: 'm'.repeat(128 * 1024),
    sourceMetadata: { details: 'd'.repeat(15 * 1024) }, carriedNodes: Array.from({ length: 40 }, (_, index) => ({ id: String(index), label: 'n'.repeat(350) })),
    carriedConnections: Array.from({ length: 40 }, (_, index) => ({ source: String(index), target: String(index + 1), verb: 'r'.repeat(340) })) };
  // Escaping is part of the actual wire size. Each source field is below its
  // byte ceiling; the JSON-encoded request still must stay within 256 KiB.
  oversized.sourceText = '\\'.repeat(128 * 1024);
  await expect(gatewaySuggestion({ fetch }, 'fixture-identity', 'gpt-oss-120b', correlation)(oversized)).rejects.toMatchObject({ code: 'input_too_large' });
  expect(fetch).not.toHaveBeenCalled();
});

test.each(['wrangler.jsonc', 'wrangler.dev.jsonc'])('%s sends the configured GPT-OSS model to the Gateway', async configPath => {
  const model = unstable_readConfig({ config: configPath, env: '' }, { hideWarnings: true }).vars.GATEWAY_MODEL;
  const fetch = vi.fn(async request => {
    const body = await request.json();
    expect(body.model).toBe('gpt-oss-120b');
    return Response.json({ model: body.model, created: 1, choices: [{ message: { role: 'assistant', content: '{"guidance":[]}' }, finish_reason: 'stop' }] });
  });
  const result = await gatewaySuggestion({ fetch }, 'fixture-identity', model, correlation, undefined, [])(input);
  expect(result.metadata.model).toBe('gpt-oss-120b');
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('full evidence repair declares indices bounded to the supplied passages', async () => {
  let body;
  const fetch = vi.fn(async request => {
    body = await request.json();
    return Response.json({ model: 'gpt-oss-120b', created: 1, choices: [{ message: { role: 'assistant', content: '{"nodes":[]}' }, finish_reason: 'stop' }] });
  });
  await gatewaySuggestion({ fetch }, 'fixture-identity', 'gpt-oss-120b', correlation)({ ...input, memoContext: { evidenceRepair: { passages: [{ start: 0, end: 17, text: input.sourceText }] } } }, null, { kind: 'memo-evidence' });
  const schema = JSON.parse(body.messages[1].content.split('REQUIRED RESPONSE JSON SCHEMA\n')[1]);
  expect(schema.properties.nodes.items.properties.evidence).toEqual({ type: 'integer', minimum: 0, maximum: 0 });
  expect(schema.properties.guidance.items.properties.evidenceExcerpt).toEqual({ type: 'integer', minimum: 0, maximum: 0 });
  expect(body.max_completion_tokens).toBe(4096);
});
test('quotation selection uses a bounded authenticated request with its own response contract', async () => {
  let body;
  const fetch = vi.fn(async request => {
    expect(request.headers.get('x-cail-identity-jwt')).toBe('fixture-identity');
    body = await request.json();
    return Response.json({ model: 'openai.gpt-oss-120b', created: 1, choices: [{ message: { role: 'assistant', content: '{"quotes":[0,null]}' }, finish_reason: 'stop' }] });
  });
  const result = await gatewaySuggestion({ fetch }, 'fixture-identity', 'gpt-oss-120b', correlation)(input, null, { kind: 'memo-quotes' });
  expect(result.suggestion).toEqual({ quotes: [0, null] });
  expect(body.max_completion_tokens).toBe(512);
  expect(body.messages[1].content).toContain('return exactly one quotes array');
  expect(body.messages[1].content).not.toContain('For a memo review');
  expect(body.messages[1].content).not.toContain('REQUIRED RESPONSE JSON SCHEMA');
  expect(fetch).toHaveBeenCalledTimes(1);
});
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
    expect(safe.message).toBe('The model returned a response the map could not use. Your existing work was not changed.');
    expect(JSON.stringify(safe)).not.toContain('private');
    if (code === 'guidance_contract_invalid') expect(safe.details.validationField).toBe(field);
  }
});

test.each([
  ['The response does not contain exactly guidance, nodes, connections, example, and readiness.', 'response_shape'],
  ['nodes exceeds the micro limit.', 'item_limit'],
  ['nodes[0] does not use the exact micro node fields.', 'field_shape'],
  ['guidance[0] is not complete text within the response limits.', 'text_format'],
  ['nodes[0] is not a complete node object.', 'text_format'],
  ['nodes[2].label duplicates an existing or proposed element.', 'label_duplicate'],
  ['nodes[2].label is a reference, action, clause, fragment, or non-entity Micro label.', 'label_format'],
  ['nodes[2].type does not belong at micro.', 'scale_type'],
  ['connections[0] must use exact carried Micro node IDs.', 'endpoint_reference'],
  ['connections[0].relationshipProcess.private-field is not an allowed schema field', 'relationship_process'],
  ['connections[0] repeats a relationship.', 'relationship_duplicate'],
  ['nodes[0] changed during semantic normalization.', 'normalization'],
  ['readiness must contain exactly a boolean ready value and a complete note.', 'readiness_invalid'],
  ['private student or provider text', 'contract_other'],
])('returns only a fixed validation reason for %s', (message, reason) => {
  const error = Object.assign(new Error(message), { name: 'MemoReviewSemanticError', code: 'MEMO_REVIEW_SEMANTIC_INVALID' });
  const safe = safeGatewayFailure(error, correlation.request_id);
  expect(safe.details.validationReason).toBe(reason);
  expect(JSON.stringify(safe)).not.toContain(message);
  expect(JSON.stringify(safe)).not.toContain('private-field');
  expect(safe.details.shouldRetry).toBe(false);
});

test('source-grounding diagnostics expose a fixed reason and preserve no source quotation', () => {
  const error = Object.assign(new Error('guidance[0].evidenceExcerpt PRIVATE_QUOTATION'), {
    name: 'MemoReviewSemanticError', code: 'MEMO_REVIEW_SEMANTIC_INVALID', grounding: true,
  });
  const safe = safeGatewayFailure(error, correlation.request_id);
  expect(safe.details).toMatchObject({ validationReason: 'source_evidence', validationField: 'guidance[0].evidenceExcerpt' });
  expect(JSON.stringify(safe)).not.toContain('PRIVATE_QUOTATION');
});

test('transport and unreadable-output errors do not invent a semantic validation reason', () => {
  for (const error of [new OpenRouterError('private response', 'invalid_response'), new CailError('upstream_failure', 'private response', 503)]) {
    expect(safeGatewayFailure(error, correlation.request_id).details).not.toHaveProperty('validationReason');
  }
});

test('accepts only the exact GPT-OSS model identity returned by the Mantle route', () => {
  const body = model => JSON.stringify({ model, created: 1, choices: [{ message: { role: 'assistant', content: '{"guidance":[]}' }, finish_reason: 'stop' }] });
  expect(parseGatewayEnvelope(body('openai.gpt-oss-20b'), 'gpt-oss-20b').metadata.model).toBe('gpt-oss-20b');
  expect(() => parseGatewayEnvelope(body('openai.gpt-oss-120b'), 'gpt-oss-20b')).toThrow('Unexpected model');
  expect(() => parseGatewayEnvelope(body('openai.gpt-oss-20b'), 'glm-5.3-flash')).toThrow('Unexpected model');
});

test.each(['micro','meso'])('supplies %s output constraints through the authenticated Gateway request', async activeScale => {
  let body;
  const fetch = async request => { body = await request.json(); return Response.json({model: body.model, created: 1, choices:[{message:{role:'assistant',content:'{"guidance":[]}'},finish_reason:'stop'}]}); };
  const carriedNodes=[{id:'teacher',label:'Teacher',scale:'micro',type:'role'},{id:'family',label:'Family',scale:'micro',type:'family'}];
  await gatewaySuggestion({fetch},'fixture-identity','gpt-oss-20b',correlation)({...input,activeScale,carriedNodes});
  const schema=JSON.parse(body.messages[1].content.split('REQUIRED RESPONSE JSON SCHEMA\n')[1]);
  expect(body.response_format.type).toBe('json_object');
  expect(schema.required).toEqual(['guidance','nodes','connections','example','readiness']);
  expect(schema.additionalProperties).toBe(false);
  expect(schema.properties.guidance.maxItems).toBe(3);
  expect(schema.properties.nodes.maxItems).toBe(activeScale==='micro'?10:0);
  expect(schema.properties.connections.maxItems).toBe(activeScale==='micro'?0:8);
  expect(schema.properties.connections.items.properties.source.enum).toEqual(['teacher','family']);
  expect(schema.properties.nodes.items.properties.type.enum).not.toContain('business');
  expect(schema.properties.nodes.items.properties.type.enum).toContain('role');
});
