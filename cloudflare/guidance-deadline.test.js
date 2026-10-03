// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import { boundedGuidanceRequest, GUIDANCE_DEADLINE_MS, isGuidanceRequest } from './guidance-deadline.js';

const ORIGIN = 'https://systems-mapping.ailab-452.workers.dev';
const request = path => new Request(ORIGIN + path, { method: 'POST' });
afterEach(() => vi.useRealTimers());

test('only model guidance POSTs use the whole-request deadline', () => {
  expect(GUIDANCE_DEADLINE_MS).toBe(95000);
  expect(isGuidanceRequest(request('/api/preflight/evaluations'))).toBe(true);
  expect(isGuidanceRequest(request('/api/map/connections'))).toBe(true);
  expect(isGuidanceRequest(new Request(ORIGIN + '/api/preflight/evaluations'))).toBe(false);
  expect(isGuidanceRequest(request('/api/cloud/projects'))).toBe(false);
  expect(isGuidanceRequest(request('/api/preflight/submissions'))).toBe(false);
});

test('a non-cooperative RPC stops blocking the response without settling remote work', async () => {
  vi.useFakeTimers();
  let finish;
  let remoteSettled = false;
  let receivedRequest;
  const remote = new Promise(resolve => { finish = resolve; }).then(value => { remoteSettled = true; return value; });
  const incoming = request('/api/preflight/evaluations');
  const handle = vi.fn(original => { receivedRequest = original; return remote; });
  const operation = boundedGuidanceRequest(incoming, handle, 25);
  const failure = expect(operation).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.advanceTimersByTimeAsync(25);
  await failure;
  expect(handle).toHaveBeenCalledTimes(1);
  expect(receivedRequest).toBe(incoming);
  expect(receivedRequest.signal.aborted).toBe(false);
  expect(remoteSettled).toBe(false);
  const cancelledBody = vi.fn();
  finish(new Response(new ReadableStream({ cancel: cancelledBody })));
  await Promise.resolve();
  await Promise.resolve();
  expect(remoteSettled).toBe(true);
  expect(cancelledBody).toHaveBeenCalledTimes(1);
});

test('a completed response is preserved and its timer is cleared', async () => {
  vi.useFakeTimers();
  const response = Response.json({ result: 'ready' });
  expect(await boundedGuidanceRequest(request('/api/map/connections'), () => response, 25)).toBe(response);
  expect(vi.getTimerCount()).toBe(0);
});

test('already-cancelled requests do not dispatch another operation', async () => {
  const controller = new AbortController();
  controller.abort();
  const handle = vi.fn();
  await expect(boundedGuidanceRequest(new Request(request('/api/preflight/evaluations'), { signal: controller.signal }), handle, 25)).rejects.toMatchObject({ name: 'AbortError' });
  expect(handle).not.toHaveBeenCalled();
});
