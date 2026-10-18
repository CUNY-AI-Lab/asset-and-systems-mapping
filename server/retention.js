const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_RETENTION_HOLD_MS = 7 * DAY_MS;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

// This operator-only migration hold never extends a capability or session.
// An elapsed timestamp stays valid so an unchanged environment can restart.
export function parseRetentionHoldUntil(value, { now = Date.now } = {}) {
  if (value === undefined || value === null) return null;
  const message = 'SYSTEMS_MAPPING_RETENTION_HOLD_UNTIL must be a valid UTC ISO timestamp no more than 7 days ahead.';
  if (typeof value !== 'string' || !UTC_TIMESTAMP.test(value)) throw new TypeError(message);
  const until = Date.parse(value);
  const canonical = value.includes('.') ? value : value.replace('Z', '.000Z');
  const checkedAt = Number(now());
  if (!Number.isSafeInteger(until) || !Number.isSafeInteger(checkedAt)
    || new Date(until).toISOString() !== canonical || until > checkedAt + MAX_RETENTION_HOLD_MS) {
    throw new TypeError(message);
  }
  return until;
}

export function retentionCleanupAllowed(until, checkedAt) {
  return until === null || checkedAt >= until;
}
