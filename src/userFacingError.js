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
  quota_exceeded: 'The model usage limit has been reached. Try again later.',
  guidance_in_progress: 'Guidance is already being generated. Wait for it to finish before trying again.',
  guidance_pending: 'Your request is saved. Reopen this map to check its progress.',
  guidance_workspace_busy: 'Other requests are still running. Wait for one to finish, then try again.',
  guidance_request_limit: 'Too many recent requests. Try again later; your map remains editable.',
  guidance_retry_limit: 'This request has reached its retry limit. Try again later; your map remains editable.',
  guidance_request_invalid: 'The generation request could not be read. Reopen the map and try again.',
  guidance_storage_unavailable: 'The generation request could not be saved. Try again; your map is unchanged.',
  guidance_timeout: 'Guidance took too long. Try again.',
  guidance_output_truncated: 'The model response was cut short, so the app could not use it. Your existing work was not changed. Try again.',
  guidance_output_invalid: 'The app could not read the model response. Your existing work was not changed. Try again.',
  guidance_contract_invalid: 'The app could not use the model response. Your existing work was not changed. Try again.',
  guidance_cancelled: 'Guidance was cancelled. Try again when you are ready.',
});

const rejectionByRule = Object.freeze({
  outside_participation: 'your memo says it is unknown whether the focal people take part in a proposed outside office, or the passage quoted for it did not name that office',
  participation_conflict: 'the memo describes the focal people taking part in an office that was proposed as Exo; a setting they take part in belongs at Micro',
  policy_operation: 'a proposed policy was not tied to a passage stating what the policy requires or does',
  condition_established: 'a proposed condition was written as a wish, recommendation or question, not as something the memo says exists',
  changed_passage: 'a proposed node was not supported by the passages you changed',
  narrative_quote: 'a proposed node was not supported by an exact quotation from your memo',
  source_contract: 'a proposed node was not supported by the text of your memo',
});

// Error bodies and transport messages may contain diagnostics. Only fixed copy
// and bounded retry timing belong in the interface; callers retain the original
// error, status, and payload for API handling and diagnostic correlation.
export function userFacingError(error, fallback = 'The request could not be completed. Try again.') {
  const details = error?.payload?.details;
  // The server names only a fixed schema path, never memo or response text.
  if (details?.code === 'guidance_contract_invalid' && /^guidance\[\d{1,2}\]\.evidenceExcerpt$/.test(String(details.validationField ?? ''))) {
    return 'A quotation in the feedback could not be checked, so the review was not shown. Your existing work was not changed. Try again.';
  }
  // A rejected memo response always says why, using fixed copy chosen by the
  // server's rule code or schema path. Nothing was added in these cases.
  if (details?.code === 'guidance_contract_invalid') {
    const rule = typeof details.validationRule === 'string' && Object.hasOwn(rejectionByRule, details.validationRule) ? rejectionByRule[details.validationRule] : null;
    const field = /\.(label|type|scale)$/.exec(String(details.validationField ?? ''))?.[1];
    const reason = rule || (field === 'label' ? 'a proposed node name was a phrase or a bundle of several subjects, not one person, place, office or condition'
      : field ? 'a proposed node was placed at a level or type that this step does not accept' : null);
    if (reason) return `Nothing was added because ${reason}. Your existing work was not changed. Try again, or add the node yourself in Tools.`;
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
