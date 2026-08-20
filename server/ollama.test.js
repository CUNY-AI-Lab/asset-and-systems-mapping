// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
  OLLAMA_CLOUD_LIMITS,
  OllamaCloudError,
  requestOllamaSuggestion,
  validateOllamaCloudConfig,
} from './ollama.js';

const fakeSecret = 'unit-test-key-do-not-use';
const model = 'gpt-oss:20b';

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

function envelope(content = '{"established":["A documented referral"],"suggested":[],"uncertain":[]}') {
  return {
    model,
    created_at: '2026-08-09T14:00:00.000Z',
    message: { role: 'assistant', content },
    done: true,
    done_reason: 'stop',
    total_duration: 900,
    load_duration: 100,
    prompt_eval_count: 42,
    prompt_eval_duration: 200,
    eval_count: 12,
    eval_duration: 600,
  };
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('Ollama Cloud suggestion adapter', () => {
  it('locks production configuration to the direct Ollama Cloud origin and redacts the key from serialization', () => {
    const normalized = validateOllamaCloudConfig(config());
    expect(normalized.baseUrl).toBe('https://ollama.com');
    expect(normalized.model).toBe(model);
    expect(normalized.apiKey).toBe(fakeSecret);
    expect(JSON.stringify(normalized)).not.toContain(fakeSecret);

    expect(() => validateOllamaCloudConfig(config({ baseUrl: 'https://ollama.com.evil.example' })))
      .toThrow('must be https://ollama.com');
    expect(() => validateOllamaCloudConfig(config({ baseUrl: 'http://ollama.com' })))
      .toThrow('must be https://ollama.com');
    expect(() => validateOllamaCloudConfig(config({ apiKey: `${fakeSecret}\n` })))
      .toThrow('API key is required');
  });

  it('sends the exact custom system prompt, Bearer authorization, JSON instruction, and bounded non-streaming request', async () => {
    let captured;
    const fetchImpl = vi.fn(async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return jsonResponse(envelope());
    });

    const result = await requestOllamaSuggestion(input(), config(), {
      testOnly: { fetchImpl },
    });

    expect(captured.url).toBe('https://ollama.com/api/chat');
    expect(captured.options.method).toBe('POST');
    expect(captured.options.headers.Authorization).toBe(`Bearer ${fakeSecret}`);
    expect(captured.body).toMatchObject({
      model,
      format: 'json',
      stream: false,
      options: { num_predict: 2_048 },
    });
    expect(captured.body.messages[0]).toEqual({
      role: 'system',
      content: input().systemPrompt,
    });
    expect(captured.body.messages[1].content).toContain('exactly one valid JSON object');
    expect(captured.body.messages[2].content).toContain('"activeScale":"meso"');
    expect(captured.body.messages[2].content).toContain('"memoDetails"');
    expect(captured.body.messages[2].content).toContain('"memoText"');
    expect(captured.body.messages[2].content).not.toContain('"sourceMetadata"');
    expect(captured.body.messages[2].content).not.toContain('"sourceText"');
    expect(captured.body.messages[2].content).toContain(input().sourceText);

    expect(result).toEqual({
      suggestion: {
        established: ['A documented referral'],
        suggested: [],
        uncertain: [],
      },
      metadata: {
        provider: 'ollama-cloud',
        model,
        requestedModel: model,
        createdAt: '2026-08-09T14:00:00.000Z',
        doneReason: 'stop',
        totalDurationNs: 900,
        loadDurationNs: 100,
        promptEvalCount: 42,
        promptEvalDurationNs: 200,
        evalCount: 12,
        evalDurationNs: 600,
      },
    });
    expect(JSON.stringify(result)).not.toContain(fakeSecret);
    expect(Object.keys(result)).toEqual(['suggestion', 'metadata']);
  });

  it('accepts memo guidance requests without a separate guiding inquiry', async () => {
    let captured;
    const fetchImpl = vi.fn(async (_url, options) => {
      captured = JSON.parse(options.body);
      return jsonResponse(envelope());
    });

    await requestOllamaSuggestion(input({ inquiry: '' }), config(), {
      testOnly: { fetchImpl },
    });

    expect(captured.messages[2].content).toContain('"inquiry":""');
  });

  it('times out through AbortController with a generic error', async () => {
    const fetchImpl = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('provider detail', 'AbortError')), { once: true });
    }));

    await expect(requestOllamaSuggestion(input(), config({ timeoutMs: 10 }), {
      testOnly: { fetchImpl },
    })).rejects.toMatchObject({
      name: 'OllamaCloudError',
      code: 'request_timeout',
      message: 'Ollama Cloud request timed out.',
    });
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('propagates caller cancellation without provider details', async () => {
    const caller = new AbortController();
    const fetchImpl = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('internal abort detail', 'AbortError')), { once: true });
    }));
    const pending = requestOllamaSuggestion(input(), config(), {
      signal: caller.signal,
      testOnly: { fetchImpl },
    });
    caller.abort();

    await expect(pending).rejects.toMatchObject({
      name: 'OllamaCloudError',
      code: 'request_aborted',
      message: 'Ollama Cloud request was cancelled.',
    });
  });

  it('never includes the key or provider body in HTTP and transport failures', async () => {
    const providerDetail = `provider said ${fakeSecret}`;
    const httpFetch = vi.fn(async () => new Response(providerDetail, { status: 429 }));
    const httpError = await requestOllamaSuggestion(input(), config(), {
      testOnly: { fetchImpl: httpFetch },
    }).catch((error) => error);

    expect(httpError).toBeInstanceOf(OllamaCloudError);
    expect(httpError).toMatchObject({ code: 'provider_http_error', status: 429 });
    expect(httpError.message).not.toContain(fakeSecret);
    expect(httpError.message).not.toContain(providerDetail);

    const transportFetch = vi.fn(async () => {
      throw new Error(`socket failed with ${fakeSecret}`);
    });
    const transportError = await requestOllamaSuggestion(input(), config(), {
      testOnly: { fetchImpl: transportFetch },
    }).catch((error) => error);
    expect(transportError).toMatchObject({
      code: 'provider_unavailable',
      message: 'Ollama Cloud request failed.',
    });
    expect(transportError.message).not.toContain(fakeSecret);
  });

  it('rejects oversized input and provider responses before returning data', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope()));
    await expect(requestOllamaSuggestion(input({
      sourceText: 'x'.repeat(OLLAMA_CLOUD_LIMITS.sourceTextBytes + 1),
    }), config(), { testOnly: { fetchImpl } })).rejects.toMatchObject({ code: 'input_too_large' });
    expect(fetchImpl).not.toHaveBeenCalled();

    const oversizedFetch = vi.fn(async () => new Response('x', {
      status: 200,
      headers: { 'Content-Length': String(OLLAMA_CLOUD_LIMITS.providerBodyBytes + 1) },
    }));
    await expect(requestOllamaSuggestion(input(), config(), {
      testOnly: { fetchImpl: oversizedFetch },
    })).rejects.toMatchObject({ code: 'response_too_large' });
  });

  it.each([
    ['malformed assistant JSON', '{"suggested":'],
    ['Markdown-fenced JSON', '```json\n{"suggested":[]}\n```'],
    ['a JSON array', '[]'],
    ['a JSON scalar', 'true'],
  ])('rejects %s', async (_label, content) => {
    const fetchImpl = vi.fn(async () => jsonResponse(envelope(content)));
    await expect(requestOllamaSuggestion(input(), config(), {
      testOnly: { fetchImpl },
    })).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('rejects unknown and non-chat response envelopes', async () => {
    const unknownEnvelope = { ...envelope(), provider_debug: 'not allowed' };
    const unknownFetch = vi.fn(async () => jsonResponse(unknownEnvelope));
    await expect(requestOllamaSuggestion(input(), config(), {
      testOnly: { fetchImpl: unknownFetch },
    })).rejects.toMatchObject({ code: 'invalid_response' });

    const generateFetch = vi.fn(async () => jsonResponse({
      model,
      created_at: '2026-08-09T14:00:00.000Z',
      response: '{"suggested":[]}',
      done: true,
    }));
    await expect(requestOllamaSuggestion(input(), config(), {
      testOnly: { fetchImpl: generateFetch },
    })).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('Ollama Cloud think control', () => {
  it('passes think through to the request body only when configured', async () => {
    let captured;
    const fetchImpl = vi.fn(async (url, options) => {
      captured = JSON.parse(options.body);
      return jsonResponse(envelope());
    });

    await requestOllamaSuggestion(input(), config(), { testOnly: { fetchImpl } });
    expect(captured.think).toBeUndefined();

    await requestOllamaSuggestion(input(), config({ think: false }), { testOnly: { fetchImpl } });
    expect(captured.think).toBe(false);
  });
});
