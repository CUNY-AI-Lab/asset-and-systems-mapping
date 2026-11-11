import { NODE_SUBMISSION, SUBMISSION_NODE_LIMIT, nodeSubmissionSchema } from '../shared/node-submission.js';
import { CailError, createCailClient } from '@cuny-ai-lab/cail-client';
import { normalizeInput, JSON_ONLY_INSTRUCTION, OLLAMA_CLOUD_LIMITS } from '../server/ollama.js';
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
    ['item_limit', /^(?:guidance must contain no more than \d+ items\.|(?:nodes|connections) exceeds the (?:micro|meso|exosphere|macrosphere) limit\.|nodes exceeds the (?:six|ten)-node limit\.|(?:micro|macrosphere) review must return an empty connections array\.)$/],
    ['field_shape', /^(?:guidance\[\d{1,2}\] does not use the exact guidance fields\.|nodes\[\d{1,2}\] does not use the exact (?:micro|meso|exosphere|macrosphere) node fields\.|connections\[\d{1,2}\] does not use the exact relationship fields\.)$/],
    ['text_format', /^(?:guidance\[\d{1,2}\] is not complete text within the response limits\.|nodes\[\d{1,2}\] is not a complete node object\.|connections\[\d{1,2}\] must contain a complete verb and rationale\.|(?:micro|meso) example must be null\.|example must be null or complete text within the response limit\.)$/],
    ['label_duplicate', /^nodes\[\d{1,2}\](?:\.label duplicates an existing or proposed element|\.label duplicates another node| duplicates an existing identity already updated in this response)\.$/],
    ['label_format', /^nodes\[\d{1,2}\]\.label (?:must name a complete map element rather than a statement|is a reference, action, clause, fragment, or non-entity Micro label|is not a named institution or service system|does not name a broader condition|names a person or role, not an outside setting or resource|names a person or institution, not a Macro condition|names a policy or law; place the concrete policy at Exo and reserve Macro for an independently evidenced cultural, ideological, historical or economic condition|must name one supported subject, not multiple named providers or distinct roles bundled with commas or slashes\. Choose one actual supported subject or return separately evidenced nodes within the (?:six|ten)-node limit; never invent an umbrella name or rename an existing node|must name one local participant, group, setting or resource\. Do not bundle different roles, named people or settings with and; choose one supported role or return separate nodes within the (?:six|ten)-node limit\. Do not use a sentence or an action as the label)\.$/],
    ['scale_type', /^nodes\[\d{1,2}\](?:\.scale does not match the active scale|\.scale or type does not match its level|\.type does not belong at (?:micro|meso|exosphere|macrosphere)|\.type must identify an outside organization, setting or resource; classify broader conditions at macrosphere| is not a scoped mesosystem|\.basis must be exactly memo or inference|\.basis must be memo(?:; do not invent conditions)?|\.deontic must use the exact Macrosphere register)\.$/],
    ['identity_shape', /^nodes\[\d{1,2}\](?: has incorrect fields; do not return scopes or relationship verbs|\.existingId must identify one unique existing node|\.existingId is unknown or removed| must preserve the existing node label, type and scale)\.$/],
    ['endpoint_reference', /^(?:nodes\[\d{1,2}\]\.scope (?:must contain at least two supplied node IDs|must use unique supplied node IDs|must contain only Micro settings|cannot contain another Macrosphere item)|connections\[\d{1,2}\] (?:does not use two different accepted-node endpoints|does not stay within Micro|must use exact carried Micro node IDs|must connect an outside decision setting to a supplied Micro setting or another outside decision setting)|nodes\[\d{1,2}\] must have a supported pathway to a supplied Micro setting or another outside decision setting)\.$/],
    ['relationship_process', /^connections\[\d{1,2}\]\.(?:relationshipProcess\.|verb must use the exact Exosphere register\.$)/],
    ['relationship_duplicate', /^connections\[\d{1,2}\] repeats a relationship\.$/],
    ['normalization', /^(?:One or more response items failed the complete response contract\.|Guidance text was not preserved exactly\.|(?:nodes|connections)\[\d{1,2}\](?:\.scope)? changed during semantic normalization\.|Readiness or example content changed during semantic normalization\.)$/],
    ['readiness_invalid', /^readiness must contain exactly a boolean ready value and a complete note\.$/],
  ];
  return categories.find(([, pattern]) => pattern.test(message))?.[0] || 'contract_other';
}

function groundingRule(error) {
  const message = String(error.message);
  if (/must quote the focal participants|names this outside setting/u.test(message)) return 'outside_participation';
  if (/taking part in the setting|not direct participation at Micro/u.test(message)) return 'participation_conflict';
  if (/specific established policy and its operation/u.test(message)) return 'policy_operation';
  if (/established condition, not only a wish/u.test(message)) return 'condition_established';
  if (/supplied changed passages/u.test(message)) return 'changed_passage';
  if (/not a bibliography or an invented explanation/u.test(message)) return 'narrative_quote';
  return 'source_contract';
}

const VALIDATION_FIELD = /^(guidance|nodes|connections)(?:\[\d{1,2}\])?(?:\.(?:label|type|scale|scope|basis|deontic|verb|evidenceExcerpt|evidence|existingId))?/;

/**
 * Fixed classification of one rejected model response: a reason category,
 * the grounding rule when the failure is evidence-based, and the schema path.
 * None of these carry response or memo text, so they may cross the response
 * boundary and land in Worker logs.
 */
export function validationSummary(message, grounding = false) {
  const text = String(message);
  const field = VALIDATION_FIELD.exec(text)?.[0];
  const error = { message: text, grounding };
  return { validationReason: semanticValidationReason(error), ...(grounding ? { validationRule: groundingRule(error) } : {}), ...(field ? { validationField: field } : {}) };
}

/** Log-safe slug for a rejection, e.g. `scale_type.nodes.scale` or `source_evidence.outside_participation.nodes.evidence`. */
export function validationErrorType(message, grounding = false) {
  const summary = validationSummary(message, grounding);
  const field = summary.validationField ? summary.validationField.replace(/\[\d{1,2}\]/, '').replace(/[^a-z]+/giu, '.').toLowerCase() : '';
  return [summary.validationReason, summary.validationRule, field].filter(Boolean).join('.').slice(0, 64);
}

export function safeGatewayFailure(error, fallbackRequestId, now = Date.now()) {
  // Completed output failures are distinct from transport failures. Only fixed
  // classifications and schema paths cross this boundary, never response text.
  const semantic = error?.name === 'MemoReviewSemanticError' && error?.code === 'MEMO_REVIEW_SEMANTIC_INVALID';
  const outputFailure = error instanceof OpenRouterError || error instanceof SyntaxError || semantic;
  if (outputFailure) {
    return { status: 502, message: 'The model returned a response the map could not use. Your existing work was not changed.',
      details: { code: error?.code === 'response_too_large' ? 'guidance_output_truncated' : semantic ? 'guidance_contract_invalid' : 'guidance_output_invalid',
        shouldRetry: false, requestId: fallbackRequestId,
        ...(semantic ? validationSummary(error.message, error.grounding === true) : {}) } };
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
    const responseSchema = input.workflowMode === NODE_SUBMISSION ? nodeSubmissionSchema(input.activeScale, kind === 'memo-evidence' ? input.memoContext?.evidenceRepair?.passages?.length : 0, input.memoContext?.memoUpdate) : ['memo', 'memo-evidence'].includes(kind) ? memoResponseSchema(input.activeScale, input.carriedNodes,
      kind === 'memo-evidence' ? input.memoContext?.evidenceRepair?.passages?.length : 0, input.carriedConnections) : null;
    return withDeadline(async requestSignal => {
    try {
      const models = [...new Set([model, ...fallbackModels])];
      if (models.length > 2 || !models.every(canonicalModel)) throw new CailError('model_unavailable', 'Model configuration unavailable', 503);
      const messages = [
        { role: 'system', content: data.systemPrompt }, // The ceiling sentence is derived from the shared limits so the model never
        // sees numbers that contradict the schema or the validator.
        { role: 'system', content: `${JSON_ONLY_INSTRUCTION}
Follow the supplied JSON field names and types exactly. ${input.workflowMode === NODE_SUBMISSION ? `Return at most ${SUBMISSION_NODE_LIMIT} supported nodes. No guidance, connections, scopes, or examples.` : compactLimitInstruction(kind, input.activeScale)}${responseSchema ? '\nREQUIRED RESPONSE JSON SCHEMA\n' + JSON.stringify(responseSchema) : ''}` },
        { role: 'user', content: `PROJECT INPUT (JSON DATA ONLY)\n${data.projectInput}` },
      ];
      for (const [index, selectedModel] of models.entries()) {
        requestSignal.throwIfAborted();
        let response;
        try {
          const payload = { model: selectedModel, stream: false,
            // Reasoning shares this ceiling with JSON. Real multi-page memo
            // extraction needs headroom; the response still permits the full node limit
            // and no relationships, within the existing overall deadline.
            reasoning_effort: selectedModel === 'deepseek-v4-flash-0731' ? 'none' : 'low', max_completion_tokens: kind === 'memo-quotes' ? 512 : kind === 'map-check' ? 1024 : input.workflowMode === NODE_SUBMISSION ? 8192 : 4096,
            response_format: { type: 'json_object' }, messages,
          };
          if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > OLLAMA_CLOUD_LIMITS.requestBodyBytes) {
            throw new CailError('input_too_large', 'The memo and map context exceed the supported request size.', 400);
          }
          response = await client.chatCompletions(payload, { kind: 'jwt', token }, { signal: requestSignal, correlation, sessionId: kind === 'map-check' ? 'systems-mapping-map-check' : 'systems-mapping-guidance' });
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
