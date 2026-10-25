const messagesByCode = Object.freeze({
  authentication_required: 'Your sign-in could not be confirmed. Sign in again to continue.',
  session_invalid: 'Your session has ended. Sign in again to continue.',
  invalid_credential: 'Your sign-in could not be confirmed. Sign in again to continue.',
  admission_required: 'Your account does not have access to Systems Mapping. Ask the course administrator to check your access.',
  identity_unavailable: 'Sign-in is temporarily unavailable. Try again later.',
  identity_verification_misconfigured: 'Sign-in is temporarily unavailable. Try again later.',
  admission_unavailable: 'Your access could not be checked. Try again later.',
  course_access_disabled: 'Course access is not available yet. Ask your instructor when the course will open.',
  course_not_allowed: 'This course is not available in Systems Mapping. Ask your instructor for the correct course link.',
  course_invalid: 'This course link is incomplete or invalid. Ask your instructor for a new link.',
  course_access_denied: 'This course is not available to your account. Ask your instructor to check your enrollment.',
  course_access_unavailable: 'Your course access could not be checked. Try again later.',
  course_owner_required: 'Only this course’s instructor can change its instructions. Ask your instructor for help.',
  course_prompt_conflict: 'The course instructions changed in another session. Keep a copy of your changes, then load the current version.',
  course_prompt_invalid: 'The course instructions could not be saved. Check the text and its length, then try again.',
  course_prompt_changed: 'The course instructions changed. Reload this page before requesting guidance again.',
  quota_exceeded: 'You have reached the model usage limit. Continue editing your map and try again later.',
  guidance_in_progress: 'Guidance is already being generated. Wait for it to finish before trying again.',
  guidance_timeout: 'Guidance took too long. Try again.',
  guidance_output_truncated: 'The model response was cut short. Your work is saved. Try again when ready.',
  guidance_output_invalid: 'The model returned an unreadable response. Your work is saved. Try again when ready.',
  guidance_contract_invalid: 'The model response did not fit the map rules. Your work is saved. Try again when ready.',
  guidance_cancelled: 'Guidance was cancelled. Try again when you are ready.',
});

// Error bodies and transport messages may contain diagnostics. Only fixed copy
// and bounded retry timing belong in the interface; callers retain the original
// error, status, and payload for API handling and diagnostic correlation.
export function userFacingError(error, fallback = 'The request could not be completed. Try again.') {
  const details = error?.payload?.details;
  // The server names only a fixed schema path, never memo or response text.
  if (details?.code === 'guidance_contract_invalid' && /^guidance\[\d{1,2}\]\.evidenceExcerpt$/.test(String(details.validationField ?? ''))) {
    return 'The suggestions did not match your memo and were not shown. Your work is saved. Try again when ready.';
  }
  if (typeof details?.code === 'string' && Object.hasOwn(messagesByCode, details.code)) return messagesByCode[details.code];
  if (error?.name === 'TimeoutError' || error?.status === 408 || error?.status === 504) return 'The request took too long. Try again.';
  if (error?.name === 'AbortError') return 'The request was cancelled. Try again when you are ready.';
  if (error?.status === 401) return messagesByCode.authentication_required;
  if (error?.status === 403) return 'This account cannot use this feature. Ask the course administrator to check your access.';
  if (error?.status === 404) return 'This item is no longer available. Refresh the list and choose another item.';
  if (error?.status === 409) return 'A newer version was saved. Keep a copy of your changes, then reload before saving.';
  if (error?.status === 410) return 'This link is no longer available. Ask for a new link.';
  if (error?.status === 413) return 'This request is too large. Shorten the text or use a smaller file, then try again.';
  if (error?.status === 429) {
    const seconds = details?.retryAfterSeconds;
    if (details?.shouldRetry !== false && Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 120) {
      return `Requests are paused. Try again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`;
    }
    return 'Requests are paused. Try again later.';
  }
  return fallback;
}
