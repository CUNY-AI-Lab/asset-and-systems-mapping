import { createCailLogger, defineEventCatalog } from '@cuny-ai-lab/cail-log';

const catalog = defineEventCatalog({
  'systems-mapping.gateway.completed': { source: 'tenant', severity: 'outcome', required: ['request_id', 'terminal'], optional: [] },
  'systems-mapping.request.failed': { source: 'tenant', severity: 'error', required: ['request_id', 'terminal'], optional: [] },
});

export function requestLog(release, requestId) {
  const log = createCailLogger({ service: 'systems-mapping', release, env: 'production', sourceClass: 'tenant', catalog,
    sink: event => console.log(JSON.stringify(event)) });
  return {
    gateway(outcome) { log.emit('systems-mapping.gateway.completed', { request_id: requestId,
      terminal: { outcome, reason: outcome === 'ok' ? 'completed' : outcome === 'cancelled' ? 'cancelled' : 'upstream_failure' } }); },
    failure() { log.emit('systems-mapping.request.failed', { request_id: requestId,
      terminal: { outcome: 'error', reason: 'application_failure' } }); },
  };
}
