// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, test, vi } from 'vitest';
import { GuidanceJobs, guidanceJobKey, guidanceJobScope } from './guidance-jobs.js';
import { GUIDANCE_CONTRACT_VERSION } from '../shared/student-judgments.js';
import { submittedReviewIssue } from '../shared/node-submission.js';
const databases = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
function setup() {
  const db = new DatabaseSync(':memory:'); databases.push(db);
  const pending = []; let clock = 100000;
  const jobs = new GuidanceJobs(db, p => pending.push(p), () => clock);
  return { jobs, db, pending, advance: ms => { clock += ms; } };
}
const input = { projectMetadata: { projectId: 'map-a', clientUpdatedAt: 'old', stage: 1 }, sourceMaterial: 'Synthetic classroom memo', activeScale: 'meso' };
const success = () => Response.json({ evaluation: { id: 'result-a' } }, { status: 201 });
test('duplicate starts and later recovery reuse the saved outcome with account and prompt boundaries', async () => {
  const { jobs, pending, db } = setup();
  let finish; const run = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const a = jobs.create('alice', 'memo', input, 'scope1', undefined, run);
  expect(jobs.create('alice', 'memo', { ...input, projectMetadata: { ...input.projectMetadata, clientUpdatedAt: 'later', stage: 2 } }, 'scope1', undefined, run).job.id).toBe(a.job.id);
  expect(run).toHaveBeenCalledTimes(1);
  expect(jobs.read('bob', a.job.id)).toBeNull();
  finish(success()); await Promise.all(pending);
  const restored = new GuidanceJobs(db, () => {}, () => 100001);
  expect(restored.read('alice', a.job.id)).toMatchObject({ job: { state: 'succeeded' }, result: { evaluation: { id: 'result-a' } } });
  expect(restored.create('alice', 'memo', input, 'scope1', undefined, run).job.state).toBe('succeeded');
  expect(run).toHaveBeenCalledTimes(1);
  expect(guidanceJobKey('alice','memo',input,'scope2')).not.toBe(a.job.id);
  expect(restored.resume('alice', a.job.id, 'scope2', run)).toEqual({ conflict: true });
});
test('a new classification contract starts fresh instead of reusing an older successful result', async () => {
  const { jobs, pending } = setup();
  const sourceMaterial = 'City Housing Authority allocates repair staff.';
  const memo = { ...input, activeScale: 'exosphere', workflowMode: 'student-nodes-v1', sourceMaterial };
  const config = { fingerprint: 'unchanged-course-guidance' }, model = 'same-model';
  const oldScope = JSON.stringify({ config, model });
  const currentScope = guidanceJobScope(config, model);
  expect(JSON.parse(currentScope).contract).toBe(GUIDANCE_CONTRACT_VERSION);
  const oldReview = { guidance: [], nodes: [{ label: 'City Housing Authority', type: 'agency', scale: 'exosphere', basis: 'memo', evidence: sourceMaterial }], connections: [], example: null, readiness: { ready: true, note: 'Nodes identified.' } };
  const currentReview = { ...oldReview, nodes: [] };
  const run = vi.fn()
    .mockResolvedValueOnce(Response.json({ evaluation: { id: 'older-review', review: oldReview } }))
    .mockResolvedValueOnce(Response.json({ evaluation: { id: 'current-review', review: currentReview } }));
  const previous = jobs.create('alice', 'memo', memo, oldScope, undefined, run, crypto.randomUUID());
  await Promise.all(pending);
  // The old result remains readable history, but is not valid new placement.
  expect(submittedReviewIssue(oldReview, 'exosphere')).toBeNull();
  expect(submittedReviewIssue(oldReview, 'exosphere', sourceMaterial)).not.toBeNull();
  const next = jobs.create('alice', 'memo', memo, currentScope, undefined, run, crypto.randomUUID());
  expect(next.job.id).not.toBe(previous.job.id);
  await Promise.all(pending);
  expect(run).toHaveBeenCalledTimes(2);
  expect(jobs.read('alice', next.job.id).result.evaluation).toEqual({ id: 'current-review', review: currentReview });
  expect(jobs.read('alice', previous.job.id).result.evaluation).toEqual({ id: 'older-review', review: oldReview });
  expect(jobs.resume('alice', previous.job.id, currentScope, run)).toEqual({ conflict: true });
  expect(jobs.create('alice', 'memo', memo, currentScope, undefined, run, crypto.randomUUID()).job.id).toBe(next.job.id);
  expect(run).toHaveBeenCalledTimes(2);
});
test('only explicit retryable refusals resume after backoff and stop at three attempts', async () => {
  const { jobs, pending, advance } = setup();
  const run = vi.fn(async () => Response.json({ error: 'Temporary refusal', details: { code: 'upstream_unavailable', shouldRetry: true, retryAfterSeconds: 4 } }, { status: 503 }));
  const { job } = jobs.create('alice','memo',input,'scope',undefined,run);
  await Promise.all(pending);
  expect(jobs.read('alice',job.id).job.state).toBe('retry_wait');
  jobs.resume('alice',job.id,'scope',run); expect(run).toHaveBeenCalledTimes(1);
  advance(4000); jobs.resume('alice',job.id,'scope',run); await Promise.all(pending);
  advance(4000); jobs.resume('alice',job.id,'scope',run); await Promise.all(pending);
  expect(jobs.read('alice',job.id).job).toMatchObject({ state: 'failed', attempts: 3 });
  jobs.resume('alice',job.id,'scope',run); expect(run).toHaveBeenCalledTimes(3);
});

test('failed semantic retries retain their safe attempt count across job reloads without replay', async () => {
  const { jobs, db, pending } = setup();
  const run = vi.fn(async () => Response.json({ error: 'Suggestions unavailable', details: {
    code: 'guidance_contract_invalid', shouldRetry: false, correctiveRetries: 2, evidenceRepairAttempts: 1,
  } }, { status: 502 }));
  const { job } = jobs.create('alice', 'memo', input, 'scope', undefined, run);
  await Promise.all(pending);
  const restored = new GuidanceJobs(db, () => {}, () => 100000);
  expect(restored.read('alice', job.id)).toMatchObject({ job: { state: 'failed' }, result: { details: { correctiveRetries: 2, evidenceRepairAttempts: 1 } } });
  restored.resume('alice', job.id, 'scope', run);
  expect(run).toHaveBeenCalledTimes(1);
});
test('ambiguous interruption requires explicit retry and a repeated retry token cannot start again', async () => {
  const { jobs, pending } = setup();
  const run = vi.fn(async () => { throw new DOMException('Uncertain provider completion', 'TimeoutError'); });
  const { job } = jobs.create('alice','memo',input,'scope',undefined,run); await Promise.all(pending);
  expect(jobs.read('alice', job.id)).toMatchObject({ job: { state: 'failed' }, resultStatus: 503, result: {
    error: 'Generation ended before its result could be confirmed. Your existing work was not changed. Choose Try again to start another attempt.',
    details: { code: 'guidance_interrupted', shouldRetry: false },
  } });
  jobs.resume('alice',job.id,'scope',run); expect(run).toHaveBeenCalledTimes(1);
  const retryToken = crypto.randomUUID();
  jobs.create('alice','memo',input,'scope',retryToken,run); await Promise.all(pending);
  jobs.create('alice','memo',input,'scope',crypto.randomUUID(),run); await Promise.all(pending);
  jobs.create('alice','memo',input,'scope',retryToken,run); expect(run).toHaveBeenCalledTimes(3);
  expect(jobs.read('alice',job.id).result.details.shouldRetry).toBe(false);
});
test('fixed creation identity rejects changed scope and expiration; cleanup removes saved input', async () => {
  const { jobs, pending, advance, db } = setup();
  const run = vi.fn(async () => success());
  const token = crypto.randomUUID();
  jobs.create('alice','memo',input,'scope1',undefined,run,token); await Promise.all(pending);
  expect(jobs.create('alice','memo',input,'scope2',undefined,run,token)).toEqual({ conflict: true });
  advance(86400000); jobs.purge();
  expect(db.prepare('SELECT count(*) AS n FROM cloud_guidance_jobs').get().n).toBe(0);
  expect(jobs.create('alice','memo',input,'scope1',undefined,run,token)).toEqual({ expired: true });
  expect(run).toHaveBeenCalledTimes(1);
  expect(jobs.nextCleanup()).toBeGreaterThan(86400000);
  advance(7 * 86400000); jobs.purge(); expect(jobs.nextCleanup()).toBeNull();
});
test('a process restart records interrupted work without replaying inference', () => {
  const { jobs, db } = setup();
  const run = vi.fn(() => new Promise(() => {}));
  const { job } = jobs.create('alice','memo',input,'scope',undefined,run);
  const restarted = new GuidanceJobs(db, () => {}, () => 100001);
  expect(restarted.read('alice',job.id)).toMatchObject({ job: { state: 'failed' }, resultStatus: 503, result: {
    error: 'Generation was interrupted. Your existing work was not changed. Choose Try again to start another attempt.',
    details: { code: 'guidance_interrupted', shouldRetry: false },
  } });
  restarted.create('alice','memo',input,'scope',undefined,run); expect(run).toHaveBeenCalledTimes(1);
});

test('expiry preserves an active retry and late completion cannot overwrite a replacement attempt', async () => {
  const { jobs, pending, advance } = setup();
  const finishes = [];
  const run = vi.fn(() => new Promise(resolve => finishes.push(resolve)));
  const { job } = jobs.create('alice', 'memo', input, 'scope', undefined, run);
  finishes[0](Response.json({ error: 'Interrupted' }, { status: 504 })); await pending[0];
  advance(86400000 - 1);
  jobs.create('alice', 'memo', input, 'scope', crypto.randomUUID(), run);
  advance(1); jobs.purge();
  expect(jobs.read('alice', job.id).job.state).toBe('running');
  expect(run).toHaveBeenCalledTimes(2);
  advance(90000); jobs.purge();
  jobs.create('alice', 'memo', input, 'scope', undefined, run);
  expect(run).toHaveBeenCalledTimes(3);
  finishes[1](Response.json({ evaluation: { id: 'stale' } }, { status: 201 })); await pending[1];
  expect(jobs.read('alice', job.id).job.state).toBe('running');
  finishes[2](Response.json({ evaluation: { id: 'replacement' } }, { status: 201 })); await pending[2];
  expect(jobs.read('alice', job.id).result.evaluation.id).toBe('replacement');
});
