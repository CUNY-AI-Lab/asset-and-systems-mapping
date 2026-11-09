import { afterEach, expect, test, vi } from 'vitest';
import { durableGuidance, hasPendingGuidance } from './durableGuidance.js';
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });
const makeError = (message, status, payload) => Object.assign(new Error(message), { status, payload });
const options = { storage: localStorage, projectId: 'map', requestKey: 'input-one' };
test('reload recovers by saved job identity and never creates another request', async () => {
  localStorage.setItem('systems-mapping.pending-guidance.map', JSON.stringify({ requestKey: 'input-one', requestToken: crypto.randomUUID(), jobId: 'job-a', createdAt: Date.now() }));
  const request = vi.fn(async () => ({ job: { id: 'job-a', state: 'succeeded' }, result: { evaluation: 'saved-result' } }));
  await expect(durableGuidance(request,makeError,'memo',{}, { ...options, resume: true })).resolves.toEqual({ evaluation: 'saved-result' });
  expect(request).toHaveBeenCalledExactlyOnceWith('/api/cloud/guidance-jobs/job-a?wait=1', expect.objectContaining({ method: 'GET', workspace: localStorage }));
  expect(request.mock.calls[0][1]).not.toHaveProperty('wait');
  expect(hasPendingGuidance(localStorage,'map','input-one')).toBe(false);
});
test('expired recovery requires an explicit new action and makes no server request', async () => {
  localStorage.setItem('systems-mapping.pending-guidance.map', JSON.stringify({ requestKey: 'input-one', requestToken: crypto.randomUUID(), createdAt: Date.now()-86400001 }));
  const request = vi.fn();
  await expect(durableGuidance(request,makeError,'memo',{}, { ...options, resume: true })).rejects.toMatchObject({ status: 410 });
  expect(request).not.toHaveBeenCalled();
});
test('a lost create response retries with the same fixed request identity', async () => {
  vi.useFakeTimers();
  const request = vi.fn().mockRejectedValueOnce(new TypeError('Disconnected')).mockResolvedValueOnce({ job: { id:'job-a', state:'succeeded' }, result:{ evaluation:'existing' } });
  const result = durableGuidance(request,makeError,'memo',{}, options);
  await vi.advanceTimersByTimeAsync(1000);
  await expect(result).resolves.toEqual({ evaluation:'existing' });
  expect(request.mock.calls[0][1].body.requestToken).toBe(request.mock.calls[1][1].body.requestToken);
});
test('an unspecified generation failure does not claim that work was saved', async () => {
  const request = vi.fn().mockResolvedValue({ job: { id: 'job-a', state: 'failed' }, resultStatus: 502, result: {} });
  await expect(durableGuidance(request, makeError, 'memo', {}, options)).rejects.toThrow('Generation did not finish. Try again.');
  expect(hasPendingGuidance(localStorage, 'map', 'input-one')).toBe(false);
});
