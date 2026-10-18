import { createHash } from 'node:crypto';

// Call only after authorization: a browser header, cookie value or claimed
// identity must never select the signed-in request allowance.
export function apiRateLimitKey(request, verifiedSubject) {
  if (typeof verifiedSubject === 'string' && verifiedSubject.length > 0) {
    return 'account:' + createHash('sha256').update(verifiedSubject).digest('hex');
  }
  return 'anonymous:' + (request.headers.get('cf-connecting-ip') || 'unknown');
}
