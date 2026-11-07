import { createCailLogger, defineEventCatalog } from '@cuny-ai-lab/cail-log';

// `gateway.completed` records the transport outcome of one model call. The
// `guidance.*` events record what the application then did with the answer:
// a rejected answer that was corrected, an accepted answer and how many
// corrections it needed, or a request that failed after every attempt. Only
// fixed codes and schema paths are logged; never memo or response text.
const catalog = defineEventCatalog({
  'systems-mapping.gateway.completed': { source: 'tenant', severity: 'outcome', required: ['request_id', 'terminal'], optional: [] },
  'systems-mapping.guidance.rejected': { source: 'tenant', severity: 'warn', outcomes: ['error'], required: ['request_id', 'terminal', 'error_type', 'retry_count'], optional: [] },
  'systems-mapping.guidance.accepted': { source: 'tenant', severity: 'outcome', outcomes: ['ok'], required: ['request_id', 'terminal', 'retry_count'], optional: [] },
  'systems-mapping.guidance.failed': { source: 'tenant', severity: 'error', outcomes: ['error'], required: ['request_id', 'terminal', 'error_type'], optional: ['retry_count'] },
  'systems-mapping.request.failed': { source: 'tenant', severity: 'error', required: ['request_id', 'terminal'], optional: [] },
});

export function requestLog(release, requestId) {
  const log = createCailLogger({ service: 'systems-mapping', release, env: 'production', sourceClass: 'tenant', catalog,
    sink: event => console.log(JSON.stringify(event)) });
  return {
    gateway(outcome) { log.emit('systems-mapping.gateway.completed', { request_id: requestId,
      terminal: { outcome, reason: outcome === 'ok' ? 'completed' : outcome === 'cancelled' ? 'cancelled' : 'upstream_failure' } }); },
    /** One model answer failed validation; `attempt` counts answers so far (1 = first answer). */
    guidanceRejected(attempt, errorType) { log.emit('systems-mapping.guidance.rejected', { request_id: requestId,
      terminal: { outcome: 'error', reason: 'application_failure' }, error_type: errorType, retry_count: attempt }); },
    /** The request produced an accepted answer after `correctiveRetries` corrections. */
    guidanceAccepted(correctiveRetries) { log.emit('systems-mapping.guidance.accepted', { request_id: requestId,
      terminal: { outcome: 'ok', reason: 'completed' }, retry_count: correctiveRetries }); },
    /** No answer was accepted; `errorType` is the failure code shown to the browser. */
    guidanceFailed(errorType, correctiveRetries) { log.emit('systems-mapping.guidance.failed', { request_id: requestId,
      terminal: { outcome: 'error', reason: 'upstream_failure' }, error_type: errorType,
      ...(Number.isSafeInteger(correctiveRetries) ? { retry_count: correctiveRetries } : {}) }); },
    failure() { log.emit('systems-mapping.request.failed', { request_id: requestId,
      terminal: { outcome: 'error', reason: 'application_failure' } }); },
  };
}
