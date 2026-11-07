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
    expect(userFacingError(quoted)).toBe('A quotation in the feedback could not be checked, so the review was not shown. Your existing work was not changed. Try again.');
    const otherField = new ApiError('guidance_contract_invalid', 502, { error: 'guidance_contract_invalid', details: { code: 'guidance_contract_invalid', shouldRetry: false, validationField: 'nodes[2].label' } });
    expect(userFacingError(otherField)).toBe('Nothing was added because a proposed node name was a phrase or a bundle of several subjects, not one person, place, office or condition. Your existing work was not changed. Try again, or add the node yourself in Tools.');
    const ruled = new ApiError('guidance_contract_invalid', 502, { error: 'guidance_contract_invalid', details: { code: 'guidance_contract_invalid', shouldRetry: false, validationField: 'nodes[0]', validationRule: 'participation_conflict' } });
    expect(userFacingError(ruled)).toContain('a setting they take part in belongs at Micro');
    const tooMany = new ApiError('guidance_contract_invalid', 502, { error: 'guidance_contract_invalid', details: { code: 'guidance_contract_invalid', shouldRetry: false, validationReason: 'item_limit', validationField: 'nodes' } });
    expect(userFacingError(tooMany)).toBe('Nothing was added because the model proposed more nodes than one memo submission can add. Your existing work was not changed. Try again, or add the node yourself in Tools.');
    const duplicate = new ApiError('guidance_contract_invalid', 502, { error: 'guidance_contract_invalid', details: { code: 'guidance_contract_invalid', shouldRetry: false, validationReason: 'label_duplicate', validationField: 'nodes[2].label' } });
    expect(userFacingError(duplicate)).toContain('the model proposed the same node twice');
    const unsafeField = new ApiError('guidance_contract_invalid', 502, { error: 'guidance_contract_invalid', details: { code: 'guidance_contract_invalid', validationField: 'guidance[0].evidenceExcerpt private memo text' } });
    expect(userFacingError(unsafeField)).toBe('The app could not use the model response. Your existing work was not changed. Try again.');
  });

  it('preserves stable API identifiers and payloads while displaying useful quota copy', () => {
    const payload = { error: 'quota_exceeded', details: { code: 'quota_exceeded', shouldRetry: false, requestId: 'internal-reference' } };
    const error = new ApiError('quota_exceeded', 429, payload);
    expect(userFacingError(error)).toBe('The model usage limit has been reached. Try again later.');
    expect(error.message).toBe('quota_exceeded');
    expect(error.payload).toBe(payload);
    expect(error.payload.details).toEqual({ code: 'quota_exceeded', shouldRetry: false, requestId: 'internal-reference' });
  });

  it.each(['guidance_output_truncated', 'guidance_output_invalid', 'guidance_contract_invalid'])('does not promise a save or blame the memo for %s', code => {
    const error = new ApiError(code, 502, { details: { code } });
    const message = userFacingError(error);
    expect(message).toContain('Your existing work was not changed.');
    expect(message).toContain('Try again.');
    expect(message).not.toMatch(/your work is saved|revise (?:your|the) memo/i);
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
    ['guidance_workspace_busy', /Wait for one to finish/],
    ['guidance_request_limit', /Try again later; your map remains editable/],
    ['guidance_retry_limit', /retry limit/],
    ['guidance_request_invalid', /Reopen the map and try again/],
    ['guidance_storage_unavailable', /could not be saved/],
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
