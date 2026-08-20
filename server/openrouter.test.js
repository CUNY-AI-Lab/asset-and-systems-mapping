// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { OllamaCloudError } from './ollama.js';
import {
  OpenRouterError,
  requestOpenRouterSuggestion,
  shouldFallToBackup,
  validateOpenRouterConfig,
  withOpenRouterFallback,
} from './openrouter.js';

const fakeSecret = 'unit-test-openrouter-key-do-not-use';
const model = 'deepseek/deepseek-v4-flash-0731';

function config(overrides = {}) {
  return {
    apiKey: fakeSecret,
    model,
    timeoutMs: 1_000,
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    systemPrompt: 'CUSTOM SYSTEM PROMPT — preserve this exactly.',
    activeScale: 'meso',
    inquiry: 'How do referrals move between the named organizations?',
    sourceMetadata: { title: 'Field memo 2', sharingTier: 'class' },
    sourceText: 'The clinic refers families to the neighborhood legal service.',
    ...overrides,
  };
}

function envelope(content = '{"guidance":[],"nodes":[],"connections":[],"example":null,"readiness":{"ready":true,"note":"Ready."}}', overrides = {}) {
  return {
    id: 'gen-unit-test',
    provider: 'DeepSeek',
    object: 'chat.completion',
    model,
    created: 1_755_600_000,
    choices: [{
      index: 0,
      finish_reason: 'stop',
      native_finish_reason: 'stop',
      logprobs: null,
      message: { role: 'assistant', content, refusal: null },
    }],
    usage: { prompt_tokens: 900, completion_tokens: 150, total_tokens: 1_050 },
    ...overrides,
  };
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('OpenRouter suggestion adapter', () => {
  it('locks production configuration to the OpenRouter origin and redacts the key from serialization', () => {
    const normalized = validateOpenRouterConfig(config());
    expect(normalized.baseUrl).toBe('https://openrouter.ai');
    expect(normalized.model).toBe(model);
    expect(normalized.apiKey).toBe(fakeSecret);
    expect(JSON.stringify(normalized)).not.toContain(fakeSecret);

    expect(() => validateOpenRouterConfig(config({ baseUrl: 'https://openrouter.ai.evil.example' })))
      .toThrow('must be https://openrouter.ai');
    expect(() => validateOpenRouterConfig(config({ baseUrl: 'http://openrouter.ai' })))
      .toThrow('must be https://openrouter.ai');
    expect(() => validateOpenRouterConfig(config({ apiKey: `${fakeSecret}\n` })))
      .toThrow('API key is required');
    expect(() => validateOpenRouterConfig(config({ model: 'bad model name' })))
      .toThrow('model is required');
  });

  it('sends a bounded OpenAI-format request and returns the parsed suggestion with openrouter runtime metadata', async () => {
    let captured;
    const fetchImpl = vi.fn(async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return jsonResponse(envelope());
    });

    const result = await requestOpenRouterSuggestion(input(), config(), {
      testOnly: { fetchImpl },
    });

    expect(captured.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(captured.options.method).toBe('POST');
    expect(captured.options.headers.Authorization).toBe(`Bearer ${fakeSecret}`);
    expect(captured.body).toMatchObject({
      model,
      stream: false,
      max_tokens: 2_048,
      response_format: { type: 'json_object' },
    });
    expect(captured.body.messages[0]).toEqual({ role: 'system', content: input().systemPrompt });
    expect(captured.body.messages[1].content).toContain('exactly one valid JSON object');
    expect(captured.body.messages[2].content).toContain('"activeScale":"meso"');

    expect(result.suggestion.readiness).toEqual({ ready: true, note: 'Ready.' });
    expect(result.metadata).toMatchObject({
      provider: 'openrouter',
      model,
      requestedModel: model,
      doneReason: 'stop',
      promptEvalCount: 900,
      evalCount: 150,
    });
    expect(Number.isFinite(Date.parse(result.metadata.createdAt))).toBe(true);
  });

  it('passes reasoning control through to the request body only when configured', async () => {
    let captured;
    const fetchImpl = vi.fn(async (url, options) => {
      captured = JSON.parse(options.body);
      return jsonResponse(envelope());
    });

    await requestOpenRouterSuggestion(input(), config(), { testOnly: { fetchImpl } });
    expect(captured.reasoning).toBeUndefined();

    await requestOpenRouterSuggestion(input(), config({ reasoningEnabled: false }), { testOnly: { fetchImpl } });
    expect(captured.reasoning).toEqual({ enabled: false });
  });

  it('rejects fenced content, truncated completions, and provider HTTP failures with typed codes', async () => {
    const fenced = vi.fn(async () => jsonResponse(envelope('```json\n{"guidance":[]}\n```')));
    await expect(requestOpenRouterSuggestion(input(), config(), { testOnly: { fetchImpl: fenced } }))
      .rejects.toMatchObject({ code: 'invalid_response' });

    const truncated = vi.fn(async () => {
      const value = envelope();
      value.choices[0].finish_reason = 'length';
      return jsonResponse(value);
    });
    await expect(requestOpenRouterSuggestion(input(), config(), { testOnly: { fetchImpl: truncated } }))
      .rejects.toMatchObject({ code: 'response_too_large' });

    const denied = vi.fn(async () => jsonResponse({ error: { message: 'denied' } }, { status: 402 }));
    await expect(requestOpenRouterSuggestion(input(), config(), { testOnly: { fetchImpl: denied } }))
      .rejects.toMatchObject({ code: 'provider_http_error', status: 402 });

    const offline = vi.fn(async () => { throw new Error('socket hangup'); });
    await expect(requestOpenRouterSuggestion(input(), config(), { testOnly: { fetchImpl: offline } }))
      .rejects.toMatchObject({ code: 'provider_unavailable' });
  });

  it('keeps OpenRouter errors compatible with the shared provider error contract', () => {
    const error = new OpenRouterError('boom', 'provider_unavailable');
    expect(error).toBeInstanceOf(OllamaCloudError);
    expect(error.name).toBe('OpenRouterError');
  });
});

describe('OpenRouter fallback runtime', () => {
  it('serves from the primary when it succeeds and never touches the backup', async () => {
    const primary = vi.fn(async () => ({ suggestion: { ok: true }, metadata: { provider: 'ollama-cloud', model: 'deepseek-v4-flash:0731' } }));
    const fetchImpl = vi.fn();
    const request = withOpenRouterFallback(primary, config());

    const result = await request(input(), { apiKey: fakeSecret, model: 'deepseek-v4-flash:0731' }, { testOnly: { fetchImpl } });
    expect(result.metadata.provider).toBe('ollama-cloud');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to OpenRouter on provider-side failures and reports the serving provider', async () => {
    const primary = vi.fn(async () => { throw new OllamaCloudError('Ollama Cloud request was not accepted.', 'provider_http_error', { status: 500 }); });
    const fetchImpl = vi.fn(async () => jsonResponse(envelope()));
    const request = withOpenRouterFallback(primary, config());

    const result = await request(input(), { apiKey: fakeSecret, model: 'deepseek-v4-flash:0731' }, { testOnly: { fetchImpl } });
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.metadata.provider).toBe('openrouter');
    expect(result.metadata.model).toBe(model);
  });

  it('does not retry input-shaped failures against the backup', async () => {
    for (const code of ['invalid_input', 'input_too_large', 'request_aborted']) {
      const primary = vi.fn(async () => { throw new OllamaCloudError('rejected', code); });
      const fetchImpl = vi.fn();
      const request = withOpenRouterFallback(primary, config());
      await expect(request(input(), config(), { testOnly: { fetchImpl } })).rejects.toMatchObject({ code });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it('classifies fallback eligibility by error code', () => {
    expect(shouldFallToBackup(new OllamaCloudError('x', 'provider_unavailable'))).toBe(true);
    expect(shouldFallToBackup(new OllamaCloudError('x', 'request_timeout'))).toBe(true);
    expect(shouldFallToBackup(new OllamaCloudError('x', 'invalid_response'))).toBe(true);
    expect(shouldFallToBackup(new Error('untyped'))).toBe(true);
    expect(shouldFallToBackup(new OllamaCloudError('x', 'invalid_input'))).toBe(false);
    expect(shouldFallToBackup(new OllamaCloudError('x', 'request_aborted'))).toBe(false);
  });
});
