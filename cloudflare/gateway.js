import { CailError, createCailClient } from '@cuny-ai-lab/cail-client';
import { normalizeInput, JSON_ONLY_INSTRUCTION } from '../server/ollama.js';
import { OpenRouterError, parseProviderEnvelope } from '../server/openrouter.js';
import { boundedText, cancelBody, withSignal, withDeadline } from './bounded.js';
import { GUIDANCE_MODEL_TIMEOUT_MS } from '../src/guidanceLimits.js';
import { compactLimitInstruction } from '../shared/memo-review-limits.js';
import { memoResponseSchema } from '../shared/memo-response-schema.js';

export const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const canonicalModel = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value);

export function parseGatewayEnvelope(body, selectedModel) {
  const envelope = JSON.parse(body);
  // Gateway accepts canonical request IDs but deliberately preserves successful
  // provider bodies. Workers AI returns @cf/vendor/model in that envelope.
  // The Mantle route uses its documented openai.model alias for the same
  // variant. Only those exact identities are normalized; never accept a silent
  // substitution or weaken the separate Railway/OpenRouter parser.
  const nativeModel = typeof envelope?.model === 'string'
    ? /^@cf\/[a-z0-9_-]+\/([a-z0-9][a-z0-9._-]{0,127})$/.exec(envelope.model)?.[1]
    : undefined;
  const mantleModel = ['gpt-oss-20b', 'gpt-oss-120b'].includes(selectedModel) && envelope?.model === `openai.${selectedModel}`;
  if (envelope?.model !== selectedModel && nativeModel !== selectedModel && !mantleModel) {
    throw new CailError('invalid_response', 'Unexpected model response', 502);
  }
  return parseProviderEnvelope(JSON.stringify({ ...envelope, model: selectedModel }), selectedModel);
}

export function gatewayClient(binding) {
  return createCailClient({
    app: 'systems-mapping',
    fetchImpl: async (input, init) => {
      const request = new Request(input, init);
      const signal = request.signal;
      signal.throwIfAborted();
      const pending = binding.fetch(request);
      let response;
      try { response = await withSignal(pending, signal); }
      catch (error) { void pending.then(value => cancelBody(value.body), () => {}); throw error; }
      // Buffer a bounded non-streaming result before handing it to the client;
      // this also bounds catalog, quota, and error bodies.
      const body = await boundedText(response, signal, 2 * 1024 * 1024);
      return new Response(body, { status: response.status, headers: response.headers });
    },
  });
}

function gatewayRetryDelay(error, now) {
  if (!(error instanceof CailError) || error.extras.should_retry !== true) return null;
  const seconds = error.extras.retry_after_seconds;
  if (Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 86400) return seconds;
  const header = error.extras.retry_after;
  if (typeof header !== 'string' || header.length > 128) return null;
  if (/^\d{1,5}$/.test(header.trim())) {
    const value = Number(header.trim());
    return value >= 1 && value <= 86400 ? value : null;
  }
  // Accept only HTTP-date syntax, not arbitrary text that Date.parse accepts.
  if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(header)) return null;
  const delay = Math.ceil((Date.parse(header) - now) / 1000);
  return Number.isSafeInteger(delay) && delay >= 1 && delay <= 86400 ? delay : null;
}

function semanticValidationReason(error) {
  if (error.grounding === true) return 'source_evidence';
  const message = String(error.message);
  // Only fixed categories cross the response boundary. Unknown messages,
  // including arbitrary provider fields, never become diagnostic text.
  const categories = [
    ['response_shape', /^(?:The response is not a JSON object\.|The response does not contain exactly guidance, nodes, connections, example, and readiness\.)$/],
    ['item_limit', /^(?:guidance must contain no more than \d+ items\.|(?:nodes|connections) exceeds the (?:micro|meso|exosphere|macrosphere) limit\.|(?:micro|macrosphere) review must return an empty connections array\.)$/],
    ['field_shape', /^(?:guidance\[\d{1,2}\] does not use the exact guidance fields\.|nodes\[\d{1,2}\] does not use the exact (?:micro|meso|exosphere|macrosphere) node fields\.|connections\[\d{1,2}\] does not use the exact relationship fields\.)$/],
    ['text_format', /^(?:guidance\[\d{1,2}\] is not complete text within the response limits\.|nodes\[\d{1,2}\] is not a complete node object\.|connections\[\d{1,2}\] must contain a complete verb and rationale\.|(?:micro|meso) example must be null\.|example must be null or complete text within the response limit\.)$/],
    ['label_duplicate', /^nodes\[\d{1,2}\]\.label duplicates an existing or proposed element\.$/],
    ['label_format', /^nodes\[\d{1,2}\]\.label (?:must name a complete map element rather than a statement|is a reference, action, clause, fragment, or non-entity Micro label|is not a named institution or service system|does not name a broader condition)\.$/],
    ['scale_type', /^nodes\[\d{1,2}\](?:\.scale does not match the active scale|\.type does not belong at (?:micro|meso|exosphere|macrosphere)| is not a scoped mesosystem|\.basis must be exactly memo or inference|\.deontic must use the exact Macrosphere register)\.$/],
    ['endpoint_reference', /^(?:nodes\[\d{1,2}\]\.scope (?:must contain at least two supplied node IDs|must use unique supplied node IDs|must contain only Micro settings|cannot contain another Macrosphere item)|connections\[\d{1,2}\] (?:does not use two different accepted-node endpoints|does not stay within Micro|must use exact carried Micro node IDs|must connect an outside decision setting to a supplied Micro setting or another outside decision setting)|nodes\[\d{1,2}\] must have a supported pathway to a supplied Micro setting or another outside decision setting)\.$/],
    ['relationship_process', /^connections\[\d{1,2}\]\.(?:relationshipProcess\.|verb must use the exact Exosphere register\.$)/],
    ['relationship_duplicate', /^connections\[\d{1,2}\] repeats a relationship\.$/],
    ['normalization', /^(?:One or more response items failed the complete response contract\.|Guidance text was not preserved exactly\.|(?:nodes|connections)\[\d{1,2}\](?:\.scope)? changed during semantic normalization\.|Readiness or example content changed during semantic normalization\.)$/],
    ['readiness_invalid', /^readiness must contain exactly a boolean ready value and a complete note\.$/],
  ];
  return categories.find(([, pattern]) => pattern.test(message))?.[0] || 'contract_other';
}

export function safeGatewayFailure(error, fallbackRequestId, now = Date.now()) {
  // Completed output failures are distinct from transport failures. Only fixed
  // classifications and schema paths cross this boundary, never response text.
  const semantic = error?.name === 'MemoReviewSemanticError' && error?.code === 'MEMO_REVIEW_SEMANTIC_INVALID';
  const outputFailure = error instanceof OpenRouterError || error instanceof SyntaxError || semantic;
  if (outputFailure) {
    const field = semantic ? /^(guidance|nodes|connections)(?:\[\d{1,2}\])?(?:\.(?:label|type|scale|scope|basis|deontic|verb|evidenceExcerpt))?/.exec(String(error.message))?.[0] : undefined;
    return { status: 502, message: 'The model returned a response the map could not use. Your work is saved.',
      details: { code: error?.code === 'response_too_large' ? 'guidance_output_truncated' : semantic ? 'guidance_contract_invalid' : 'guidance_output_invalid',
        shouldRetry: false, requestId: fallbackRequestId,
        ...(semantic ? { validationReason: semanticValidationReason(error) } : {}),
        ...(field ? { validationField: field } : {}) } };
  }

  if (error?.name === 'TimeoutError') return {
    status: 504,
    message: 'Couldn’t generate guidance — Try again',
    details: { code: 'guidance_timeout', shouldRetry: false, requestId: fallbackRequestId },
  };
  const code = error instanceof CailError && /^[a-z][a-z_]{1,63}$/.test(error.code) ? error.code : 'upstream_failure';
  const shouldRetry = error instanceof CailError && typeof error.extras.should_retry === 'boolean' ? error.extras.should_retry : false;
  const candidate = error instanceof CailError ? error.extras.request_id : undefined;
  const requestId = REQUEST_ID.test(candidate || '') ? candidate : fallbackRequestId;
  const retryAfterSeconds = gatewayRetryDelay(error, now);
  const message = code === 'quota_exceeded'
    ? 'The CAIL model usage limit has been reached. Your map is still available.'
    : shouldRetry ? 'The model request could not be completed. Please try again later.'
      : 'The model request could not be completed. Your map is still available.';
  return {
    status: error instanceof CailError && [400, 401, 403, 404, 409, 429, 503].includes(error.status) ? error.status : 502,
    message,
    details: { code, shouldRetry, ...(retryAfterSeconds ? { retryAfterSeconds } : {}), ...(REQUEST_ID.test(requestId || '') ? { requestId } : {}) },
    ...(retryAfterSeconds ? { headers: { 'Retry-After': String(retryAfterSeconds) } } : {}),
  };
}

// DeepSeek remains available for explicit acceptance probes but did not pass
// the 25-second full-memo budget. Do not advertise an unqualified backup.
export const GUIDANCE_FALLBACK_MODELS = Object.freeze(['gpt-oss-20b']);
const AVAILABILITY_FAILURES = new Set(['upstream_rate_limited', 'upstream_unavailable', 'model_unavailable']);

function backoff(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// The student-requested backup is a new, fully admitted Gateway call, not a
// claim that different models are equivalent. Only a known pre-inference
// availability refusal permits it. Never replay ambiguous timeouts, quota
// denials, partial responses or invalid completed output.
export function gatewaySuggestion(binding, token, model, correlation, logOutcome = () => {}, fallbackModels = GUIDANCE_FALLBACK_MODELS) {
  const client = gatewayClient(binding);
  return async (input, _config, { signal, timeoutMs = GUIDANCE_MODEL_TIMEOUT_MS, kind = 'memo' } = /** @type {{ signal?: AbortSignal, timeoutMs?: number, kind?: string }} */ ({})) => {
    if (!['memo', 'connections', 'map-check', 'memo-quotes', 'memo-evidence'].includes(kind)) throw new Error('guidance_deadline');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 85000) throw new Error('guidance_deadline');
    const data = normalizeInput(input);
    const responseSchema = ['memo', 'memo-evidence'].includes(kind) ? memoResponseSchema(input.activeScale, input.carriedNodes,
      kind === 'memo-evidence' ? input.memoContext?.evidenceRepair?.passages?.length : 0) : null;
    return withDeadline(async requestSignal => {
    try {
      const models = [...new Set([model, ...fallbackModels])];
      if (models.length > 2 || !models.every(canonicalModel)) throw new CailError('model_unavailable', 'Model configuration unavailable', 503);
      const messages = [
        { role: 'system', content: data.systemPrompt }, // The ceiling sentence is derived from the shared limits so the model never
        // sees numbers that contradict the schema or the validator.
        { role: 'system', content: `${JSON_ONLY_INSTRUCTION}
Follow the supplied JSON field names and types exactly. ${compactLimitInstruction(kind, input.activeScale)}${responseSchema ? '\nREQUIRED RESPONSE JSON SCHEMA\n' + JSON.stringify(responseSchema) : ''}` },
        { role: 'user', content: `PROJECT INPUT (JSON DATA ONLY)\n${data.projectInput}` },
      ];
      for (const [index, selectedModel] of models.entries()) {
        requestSignal.throwIfAborted();
        let response;
        try {
          response = await client.chatCompletions({ model: selectedModel, stream: false,
            reasoning_effort: selectedModel === 'deepseek-v4-flash-0731' ? 'none' : 'low', max_completion_tokens: kind === 'memo-quotes' ? 512 : kind === 'map-check' ? 1024 : 4096,
            response_format: { type: 'json_object' }, messages,
          }, { kind: 'jwt', token }, { signal: requestSignal, correlation, sessionId: kind === 'map-check' ? 'systems-mapping-map-check' : 'systems-mapping-guidance' });
        } catch (error) {
          if (requestSignal.aborted || index === models.length - 1 || !(error instanceof CailError)
            || !AVAILABILITY_FAILURES.has(error.code) || error.extras.should_retry !== true) throw error;
          await backoff((gatewayRetryDelay(error, Date.now()) ?? 1) * 1000, requestSignal);
          continue;
        }
        const parsed = parseGatewayEnvelope(await boundedText(response, requestSignal), selectedModel);
        logOutcome('ok');
        return { ...parsed, metadata: { ...parsed.metadata, requestedModel: model, provider: 'cail-gateway' } };
      }
    } catch (error) {
      logOutcome(requestSignal.aborted ? 'cancelled' : 'error');
      throw error;
    }
    }, signal, timeoutMs);
  };
}
