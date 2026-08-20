import {
  JSON_ONLY_INSTRUCTION,
  OLLAMA_CLOUD_LIMITS,
  OllamaCloudError,
  assertJsonCompatible,
  cancelBody,
  integerOption,
  isPlainObject,
  normalizeInput,
  normalizeTestBaseUrl,
  readBoundedBody,
  testRuntime,
} from './ollama.js';

const DEFAULT_BASE_URL = 'https://openrouter.ai';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 2_048;
const PROVIDER_LABEL = 'OpenRouter';
const CONFIG_KEYS = new Set(['apiKey', 'baseUrl', 'model', 'timeoutMs', 'maxOutputTokens']);
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;

// Errors with these codes describe the caller's input or intent, so a backup
// provider would fail identically and must not be attempted.
const NON_FALLBACK_CODES = new Set(['invalid_input', 'input_too_large', 'request_aborted']);

export class OpenRouterError extends OllamaCloudError {
  constructor(message, code, options) {
    super(message, code, options);
    this.name = 'OpenRouterError';
  }
}

function fail(message, code, options) {
  throw new OpenRouterError(message, code, options);
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function normalizeProductionBaseUrl(value = DEFAULT_BASE_URL) {
  if (typeof value !== 'string') fail('OpenRouter base URL is invalid.', 'invalid_config');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('OpenRouter base URL is invalid.', 'invalid_config');
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== 'openrouter.ai'
    || parsed.port !== ''
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== ''
  ) {
    fail('OpenRouter base URL must be https://openrouter.ai.', 'invalid_config');
  }
  return DEFAULT_BASE_URL;
}

export function validateOpenRouterConfig(config) {
  if (!isPlainObject(config)) fail('OpenRouter configuration is required.', 'invalid_config');
  if (Object.keys(config).some((key) => !CONFIG_KEYS.has(key))) {
    fail('OpenRouter configuration contains an unsupported option.', 'invalid_config');
  }

  const { apiKey, model } = config;
  if (
    typeof apiKey !== 'string'
    || apiKey.length === 0
    || apiKey.length > 4_096
    || apiKey.trim() !== apiKey
    || /[\u0000-\u0020\u007f]/u.test(apiKey)
  ) {
    fail('OpenRouter API key is required.', 'invalid_config');
  }
  if (typeof model !== 'string' || model.length === 0 || model.length > 128 || !MODEL_PATTERN.test(model)) {
    fail('OpenRouter model is required.', 'invalid_config');
  }

  const normalized = {
    baseUrl: normalizeProductionBaseUrl(config.baseUrl),
    model,
    timeoutMs: integerOption(
      config.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      OLLAMA_CLOUD_LIMITS.timeoutMsMin,
      OLLAMA_CLOUD_LIMITS.timeoutMsMax,
      'OpenRouter timeout',
    ),
    maxOutputTokens: integerOption(
      config.maxOutputTokens,
      DEFAULT_MAX_OUTPUT_TOKENS,
      1,
      OLLAMA_CLOUD_LIMITS.outputTokensMax,
      'OpenRouter output token limit',
    ),
  };
  Object.defineProperty(normalized, 'apiKey', {
    value: apiKey,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(normalized);
}

function resolveDependencies(config, testOnly) {
  if (testOnly !== undefined) {
    if (!testRuntime() || !isPlainObject(testOnly)) {
      fail('Test-only OpenRouter overrides are unavailable.', 'invalid_config');
    }
    const allowedKeys = new Set(['fetchImpl', 'baseUrl']);
    if (Object.keys(testOnly).some((key) => !allowedKeys.has(key))) {
      fail('Test-only OpenRouter overrides contain an unsupported option.', 'invalid_config');
    }
  }

  const fetchImpl = testOnly?.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') fail('Fetch is unavailable.', 'invalid_config');
  const baseUrl = testOnly?.baseUrl === undefined
    ? config.baseUrl
    : normalizeTestBaseUrl(testOnly.baseUrl);
  return { fetchImpl, baseUrl };
}

function parseProviderEnvelope(body, requestedModel) {
  let envelope;
  try {
    envelope = JSON.parse(body);
  } catch {
    fail('OpenRouter returned an invalid response.', 'invalid_response');
  }
  if (!isPlainObject(envelope)) fail('OpenRouter returned an invalid response.', 'invalid_response');
  if (envelope.error !== undefined) {
    fail('OpenRouter request was not accepted.', 'provider_http_error');
  }
  if (
    typeof envelope.model !== 'string'
    || envelope.model.length === 0
    || envelope.model.length > 128
    || !MODEL_PATTERN.test(envelope.model)
    || !Number.isSafeInteger(envelope.created)
    || envelope.created < 0
    || !Array.isArray(envelope.choices)
    || envelope.choices.length < 1
    || !isPlainObject(envelope.choices[0])
  ) {
    fail('OpenRouter returned an invalid response.', 'invalid_response');
  }
  const choice = envelope.choices[0];
  const message = choice.message;
  if (!isPlainObject(message) || message.role !== 'assistant' || typeof message.content !== 'string') {
    fail('OpenRouter returned an invalid response.', 'invalid_response');
  }
  const finishReason = choice.finish_reason ?? undefined;
  if (finishReason !== undefined) {
    if (typeof finishReason !== 'string' || finishReason.length > 64 || /[\u0000-\u001f\u007f]/u.test(finishReason)) {
      fail('OpenRouter returned an invalid response.', 'invalid_response');
    }
    if (finishReason === 'length') fail('OpenRouter response exceeds the supported size.', 'response_too_large');
    if (finishReason !== 'stop') fail('OpenRouter returned an unexpected response.', 'unexpected_response');
  }

  const content = message.content.trim();
  if (!content || byteLength(content) > OLLAMA_CLOUD_LIMITS.assistantContentBytes) {
    fail(
      byteLength(content) > OLLAMA_CLOUD_LIMITS.assistantContentBytes
        ? 'OpenRouter response exceeds the supported size.'
        : 'OpenRouter returned an invalid response.',
      byteLength(content) > OLLAMA_CLOUD_LIMITS.assistantContentBytes
        ? 'response_too_large'
        : 'invalid_response',
    );
  }
  if (content.startsWith('```') || content.endsWith('```')) {
    fail('OpenRouter returned an invalid response.', 'invalid_response');
  }

  let suggestion;
  try {
    suggestion = JSON.parse(content);
  } catch {
    fail('OpenRouter returned an invalid response.', 'invalid_response');
  }
  if (!isPlainObject(suggestion)) fail('OpenRouter returned an invalid response.', 'invalid_response');
  assertJsonCompatible(suggestion, 'OpenRouter response', 'invalid_response');

  const metadata = {
    provider: 'openrouter',
    model: envelope.model,
    requestedModel,
    createdAt: new Date(envelope.created * 1000).toISOString(),
  };
  if (finishReason !== undefined) metadata.doneReason = finishReason;
  if (isPlainObject(envelope.usage)) {
    const { prompt_tokens: promptTokens, completion_tokens: completionTokens } = envelope.usage;
    if (promptTokens !== undefined) {
      if (!Number.isSafeInteger(promptTokens) || promptTokens < 0) {
        fail('OpenRouter returned an invalid response.', 'invalid_response');
      }
      metadata.promptEvalCount = promptTokens;
    }
    if (completionTokens !== undefined) {
      if (!Number.isSafeInteger(completionTokens) || completionTokens < 0) {
        fail('OpenRouter returned an invalid response.', 'invalid_response');
      }
      metadata.evalCount = completionTokens;
    }
  }

  return { suggestion, metadata: Object.freeze(metadata) };
}

export async function requestOpenRouterSuggestion(input, config, { signal, testOnly } = {}) {
  const normalizedConfig = validateOpenRouterConfig(config);
  const normalizedInput = normalizeInput(input);
  const { fetchImpl, baseUrl } = resolveDependencies(normalizedConfig, testOnly);
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    fail('Abort signal is invalid.', 'invalid_input');
  }
  if (signal?.aborted) fail('OpenRouter request was cancelled.', 'request_aborted');

  const body = JSON.stringify({
    model: normalizedConfig.model,
    messages: [
      { role: 'system', content: normalizedInput.systemPrompt },
      { role: 'system', content: JSON_ONLY_INSTRUCTION },
      { role: 'user', content: `PROJECT INPUT (JSON DATA ONLY)\n${normalizedInput.projectInput}` },
    ],
    response_format: { type: 'json_object' },
    stream: false,
    max_tokens: normalizedConfig.maxOutputTokens,
  });
  if (byteLength(body) > OLLAMA_CLOUD_LIMITS.requestBodyBytes) {
    fail('OpenRouter request exceeds the supported size.', 'input_too_large');
  }

  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener('abort', onCallerAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, normalizedConfig.timeoutMs);
  timeout.unref?.();

  try {
    const response = await fetchImpl(`${baseUrl}/api/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${normalizedConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: controller.signal,
    });
    if (controller.signal.aborted) {
      fail(
        timedOut ? 'OpenRouter request timed out.' : 'OpenRouter request was cancelled.',
        timedOut ? 'request_timeout' : 'request_aborted',
      );
    }
    if (typeof response?.ok !== 'boolean' || !Number.isInteger(response?.status)) {
      fail('OpenRouter returned an invalid response.', 'invalid_response');
    }
    if (!response.ok) {
      await cancelBody(response);
      fail('OpenRouter request was not accepted.', 'provider_http_error', { status: response.status });
    }
    const responseBody = await readBoundedBody(response, PROVIDER_LABEL);
    return parseProviderEnvelope(responseBody, normalizedConfig.model);
  } catch (error) {
    if (error instanceof OllamaCloudError) throw error;
    if (timedOut) fail('OpenRouter request timed out.', 'request_timeout');
    if (signal?.aborted) fail('OpenRouter request was cancelled.', 'request_aborted');
    fail('OpenRouter request failed.', 'provider_unavailable');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

export function shouldFallToBackup(error) {
  return !(error instanceof Error && typeof error.code === 'string' && NON_FALLBACK_CODES.has(error.code));
}

export function withOpenRouterFallback(primaryRequest, backupConfig) {
  if (typeof primaryRequest !== 'function') throw new TypeError('primaryRequest must be a function.');
  const normalizedBackup = validateOpenRouterConfig(backupConfig);
  return async function requestSuggestionWithFallback(input, config, options) {
    try {
      return await primaryRequest(input, config, options);
    } catch (error) {
      if (!shouldFallToBackup(error)) throw error;
      // Code-only server log so operators can see which side of the chain failed.
      console.warn('primary suggestion runtime failed, using backup:', error?.code ?? error?.name ?? 'unknown', error?.status ?? '');
      return requestOpenRouterSuggestion(input, normalizedBackup, options);
    }
  };
}
