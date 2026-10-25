import { describe, expect, it } from 'vitest';
import { ApiError } from './api.js';
import { userFacingError } from './userFacingError.js';

describe('safe error display', () => {
  const fallback = 'Course settings could not be loaded. Reopen Course settings to try again.';

  it.each([
    new Error('fetch failed at private.internal:5432 password=secret'),
    new SyntaxError('Unexpected token in provider diagnostic body'),
    new ApiError('UPSTREAM_FAILURE: private diagnostics', 503, { error: 'secret', details: { code: 'upstream_failure', supportReference: 'sensitive diagnostic' } }),
    new ApiError({ stack: 'private stack trace' }, 400),
    undefined,
  ])('uses the action-specific fallback without exposing diagnostic text', error => {
    expect(userFacingError(error, fallback)).toBe(fallback);
  });

  it('names an unsupported memo quotation from the fixed schema path only', () => {
    const quoted = new ApiError('guidance_contract_invalid', 502, { error: 'guidance_contract_invalid', details: { code: 'guidance_contract_invalid', shouldRetry: false, validationField: 'guidance[1].evidenceExcerpt' } });
    expect(userFacingError(quoted)).toBe('The model quoted a passage that is not in your memo, so its suggestions were not used. Your work is saved. Try again when ready.');
    const otherField = new ApiError('guidance_contract_invalid', 502, { error: 'guidance_contract_invalid', details: { code: 'guidance_contract_invalid', shouldRetry: false, validationField: 'nodes[2].label' } });
    expect(userFacingError(otherField)).toBe('The model response did not fit the map rules. Your work is saved. Try again when ready.');
    const unsafeField = new ApiError('guidance_contract_invalid', 502, { error: 'guidance_contract_invalid', details: { code: 'guidance_contract_invalid', validationField: 'guidance[0].evidenceExcerpt private memo text' } });
    expect(userFacingError(unsafeField)).toBe('The model response did not fit the map rules. Your work is saved. Try again when ready.');
  });

  it('preserves stable API identifiers and payloads while displaying useful quota copy', () => {
    const payload = { error: 'quota_exceeded', details: { code: 'quota_exceeded', shouldRetry: false, requestId: 'internal-reference' } };
    const error = new ApiError('quota_exceeded', 429, payload);
    expect(userFacingError(error)).toBe('You have reached the model usage limit. Continue editing your map and try again later.');
    expect(error.message).toBe('quota_exceeded');
    expect(error.payload).toBe(payload);
    expect(error.payload.details).toEqual({ code: 'quota_exceeded', shouldRetry: false, requestId: 'internal-reference' });
  });

  it.each([
    [401, /Sign in again/],
    [403, /administrator to check your access/],
    [409, /Keep a copy of your changes/],
    [413, /Shorten the text/],
    [504, /took too long\. Try again\./],
  ])('offers a recovery action for status %s', (status, message) => {
    expect(userFacingError(new ApiError('RAW_MACHINE_CODE', status))).toMatch(message);
  });

  it('uses only bounded numeric retry advice and never overrides a no-retry response', () => {
    const limited = (details) => new ApiError('rate_limited', 429, { details });
    expect(userFacingError(limited({ retryAfterSeconds: 1 }))).toBe('Requests are paused. Try again in 1 second.');
    expect(userFacingError(limited({ retryAfterSeconds: 30 }))).toBe('Requests are paused. Try again in 30 seconds.');
    for (const retryAfterSeconds of ['private diagnostic', -1, Infinity, 1.5, 90000]) {
      expect(userFacingError(limited({ retryAfterSeconds }))).toBe('Requests are paused. Try again later.');
    }
    expect(userFacingError(limited({ retryAfterSeconds: 1, shouldRetry: false }))).toBe('Requests are paused. Try again later.');
  });

  it('does not treat prototype properties as known error codes', () => {
    expect(userFacingError(new ApiError('secret', 503, { details: { code: 'toString' } }), fallback)).toBe(fallback);
  });

  it.each([
    ['course_access_disabled', /Ask your instructor when the course will open/],
    ['course_not_allowed', /correct course link/],
    ['course_invalid', /new link/],
    ['course_access_denied', /check your enrollment/],
    ['course_access_unavailable', /Try again later/],
    ['course_owner_required', /Only this course’s instructor/],
    ['course_prompt_conflict', /Keep a copy of your changes/],
    ['course_prompt_invalid', /Check the text and its length/],
    ['course_prompt_changed', /Reload this page before requesting guidance/],
  ])('explains %s without displaying its machine identifier', (code, nextAction) => {
    const error = new ApiError(`${code}: private diagnostics`, 403, { details: { code } });
    expect(userFacingError(error)).toMatch(nextAction);
    expect(userFacingError(error)).not.toContain(code);
    expect(error.payload.details.code).toBe(code);
  });
});
