// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, test, vi } from 'vitest';
import { GuidanceJobs, guidanceJobFailure, guidanceJobKey, guidanceJobScope } from './guidance-jobs.js';
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

test.each(['succeeded', 'failed'])('the 41st new request evicts only the oldest terminal %s payload and never replays its token', async state => {
  const { jobs, db, pending, advance } = setup();
  const run = vi.fn(async () => state === 'succeeded' ? success() : Response.json({ error: 'Synthetic nonretryable failure' }, { status: 502 }));
  const tokens = [], ids = [];
  const foreign = jobs.create('bob', 'memo', input, 'scope', undefined, run, crypto.randomUUID());
  await pending.at(-1);
  for (let i = 0; i < 40; i++) {
    advance(1); tokens.push(crypto.randomUUID());
    ids.push(jobs.create('alice', 'memo', { ...input, sourceMaterial: `Synthetic memo ${i}` }, 'scope', undefined, run, tokens[i]).job.id);
    await pending.at(-1);
  }
  const foreignBefore = jobs.read('bob', foreign.job.id), nextBefore = jobs.read('alice', ids[1]);
  const countBefore = run.mock.calls.length;
  // Reopening a retained outcome does not evict anything, even at capacity.
  expect(jobs.create('alice', 'memo', { ...input, sourceMaterial: 'Synthetic memo 1' }, 'scope', undefined, run).job.id).toBe(ids[1]);
  expect(run).toHaveBeenCalledTimes(countBefore);
  advance(1);
  const next = jobs.create('alice', 'memo', { ...input, sourceMaterial: 'Short but valid new memo' }, 'scope', undefined, run);
  await pending.at(-1);
  expect(db.prepare('SELECT count(*) AS n FROM cloud_guidance_jobs WHERE owner=?').get('alice').n).toBe(40);
  expect(jobs.read('alice', ids[0])).toBeNull();
  expect(jobs.read('alice', ids[1])).toEqual(nextBefore);
  expect(jobs.read('bob', foreign.job.id)).toEqual(foreignBefore);
  expect(jobs.read('alice', next.job.id).job.state).toBe(state);
  expect(jobs.create('alice', 'memo', { ...input, sourceMaterial: 'Synthetic memo 0' }, 'scope', crypto.randomUUID(), run, tokens[0])).toEqual({ expired: true });
  expect(run).toHaveBeenCalledTimes(countBefore + 1);
});

test('active capacity rejects a new request without orphaning its token and admits it after a terminal result', async () => {
  const { jobs, db, pending } = setup();
  const finish = [], tokens = [];
  const run = vi.fn(() => new Promise(resolve => finish.push(resolve)));
  for (let i = 0; i < 40; i++) {
    tokens.push(crypto.randomUUID());
    jobs.create('alice', 'memo', { ...input, sourceMaterial: `Active request ${i}` }, 'scope', undefined, run, tokens[i]);
  }
  const token = crypto.randomUUID(), newInput = { ...input, sourceMaterial: 'Next request' };
  expect(() => jobs.create('alice', 'memo', newInput, 'scope', undefined, run, token)).toThrow('job_limit');
  expect(db.prepare('SELECT count(*) AS n FROM cloud_guidance_requests WHERE owner=?').get('alice').n).toBe(40);
  expect(db.prepare("SELECT count(*) AS n FROM cloud_guidance_jobs WHERE owner=? AND state='running'").get('alice').n).toBe(40);
  expect(run).toHaveBeenCalledTimes(40);
  finish[0](success()); await pending[0];
  expect(jobs.create('alice', 'memo', newInput, 'scope', undefined, run, token).job.state).toBe('running');
  expect(run).toHaveBeenCalledTimes(41);
  expect(db.prepare('SELECT count(*) AS n FROM cloud_guidance_jobs WHERE owner=?').get('alice').n).toBe(40);
  expect(jobs.create('alice', 'memo', { ...input, sourceMaterial: 'Active request 0' }, 'scope', undefined, run, tokens[0])).toEqual({ expired: true });
  expect(run).toHaveBeenCalledTimes(41);
});

test('request-token and explicit retry limits remain bounded without mutating existing outcomes', async () => {
  const { jobs, db, pending } = setup();
  const run = vi.fn(async () => success()), token = crypto.randomUUID();
  const first = jobs.create('alice', 'memo', input, 'scope', undefined, run, token); await pending[0];
  const before = jobs.read('alice', first.job.id);
  const insert = db.prepare('INSERT INTO cloud_guidance_requests VALUES (?,?,?,?)');
  for (let i = 1; i < 1000; i++) insert.run('alice', crypto.randomUUID(), first.job.id, 100000);
  expect(jobs.create('alice', 'memo', input, 'scope', undefined, run, token)).toEqual(before);
  expect(() => jobs.create('alice', 'memo', { ...input, sourceMaterial: 'New' }, 'scope', undefined, run)).toThrow('request_limit');
  expect(jobs.read('alice', first.job.id)).toEqual(before);
  const retries = Array.from({ length: 20 }, () => crypto.randomUUID());
  db.prepare('UPDATE cloud_guidance_jobs SET retry_tokens=? WHERE owner=? AND id=?').run(JSON.stringify(retries), 'alice', first.job.id);
  db.prepare('DELETE FROM cloud_guidance_requests WHERE owner=? AND token!=?').run('alice', token);
  expect(() => jobs.create('alice', 'memo', input, 'scope', crypto.randomUUID(), run)).toThrow('retry_limit');
  expect(db.prepare('SELECT count(*) AS n FROM cloud_guidance_requests WHERE owner=?').get('alice').n).toBe(1);
  expect(run).toHaveBeenCalledTimes(1);
});

test('job failures return distinct safe codes without exposing arbitrary storage diagnostics', () => {
  expect(guidanceJobFailure(new Error('job_limit'))).toMatchObject({ status: 429, details: { code: 'guidance_workspace_busy', shouldRetry: false } });
  expect(guidanceJobFailure(new Error('job_input_size'))).toMatchObject({ status: 413, details: { code: 'guidance_input_too_large' } });
  expect(guidanceJobFailure(new Error('input_depth'))).toMatchObject({ status: 400, details: { code: 'guidance_request_invalid' } });
  const unsafe = guidanceJobFailure(new Error('private database diagnostics'));
  expect(unsafe).toMatchObject({ status: 503, details: { code: 'guidance_storage_unavailable' } });
  expect(JSON.stringify(unsafe)).not.toContain('private database diagnostics');
});
