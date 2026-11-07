import { afterEach, expect, test, vi } from 'vitest';
import { requestLog } from './log.js';

const requestId = '2d5a3c0e-7f1b-4a9c-8d2e-5b6f7a8c9d0e';

function captured(run) {
  const lines = [];
  const spy = vi.spyOn(console, 'log').mockImplementation(line => lines.push(JSON.parse(line)));
  try { run(requestLog('deadbeef', requestId)); } finally { spy.mockRestore(); }
  return lines;
}
afterEach(() => vi.restoreAllMocks());

test('a rejected model answer is logged with its attempt number and a fixed rule slug', () => {
  const [event] = captured(log => log.guidanceRejected(1, 'scale_type.nodes.scale'));
  expect(event.event_name).toBe('systems-mapping.guidance.rejected');
  expect(event.attributes).toMatchObject({ 'cail.request.id': requestId, 'cail.outcome': 'error', 'error.type': 'scale_type.nodes.scale', 'cail.retry.count': 1 });
});

test('an accepted answer records how many corrections it needed, including none', () => {
  const [first, second] = captured(log => { log.guidanceAccepted(0); log.guidanceAccepted(1); });
  expect(first.event_name).toBe('systems-mapping.guidance.accepted');
  expect(first.attributes).toMatchObject({ 'cail.outcome': 'ok', 'cail.retry.count': 0 });
  expect(second.attributes).toMatchObject({ 'cail.outcome': 'ok', 'cail.retry.count': 1 });
});

test('a request that ends without an accepted answer is logged as a failure with the browser-facing code', () => {
  const [event] = captured(log => log.guidanceFailed('guidance_contract_invalid.scale_type', 1));
  expect(event.event_name).toBe('systems-mapping.guidance.failed');
  expect(event.attributes).toMatchObject({ 'cail.outcome': 'error', 'error.type': 'guidance_contract_invalid.scale_type', 'cail.retry.count': 1 });
});

test('free text never reaches the error type attribute', () => {
  // The logger drops a required field that fails its slug rule, so the event
  // is withheld rather than written with the text.
  const lines = captured(log => log.guidanceRejected(2, 'Private memo text: the Housing Office'));
  expect(JSON.stringify(lines)).not.toContain('Housing Office');
});
