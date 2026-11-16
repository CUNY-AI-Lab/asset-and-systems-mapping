// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { BrowserRecoveryProofs, browserRecoveryPeer } from './browser-recovery';

afterEach(() => vi.useRealTimers());
test('recovery proofs expire, cannot cross accounts and are invalidated by a replacement flow', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE cloud_accounts(owner TEXT PRIMARY KEY, cache_key TEXT); INSERT INTO cloud_accounts VALUES ('owner','cache');");
  const proofs = new BrowserRecoveryProofs(db, { transactionSync: (work: () => Response) => work() } as any, 'https://systems-mapping.ailab-452.workers.dev');
  const principal = { subject: 'cail-alice', expiresAt: Date.now() + 500000, admin: false, gatewayJwt: 'fixture', toolsMounted: true as const };
  const call = (action: string, body: object, toolsMounted = true, subject = principal.subject) => proofs.request(new Request(`https://fixture.test/api/cloud/browser-recovery/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-systems-account-cache': 'cache' }, body: JSON.stringify(body),
  }), { ...principal, subject, toolsMounted: toolsMounted ? true : undefined }, 'owner');
  const nonce = 'a'.repeat(64), fingerprint = 'b'.repeat(64);
  const proof = await (await call('issue', { nonce })).json() as any;
  expect((await call('verify', { nonce, token: proof.token, fingerprint }, false, 'cail-other')).status).toBe(409);
  vi.advanceTimersByTime(120001);
  expect((await call('verify', { nonce, token: proof.token, fingerprint }, false)).status).toBe(409);
  const older = await (await call('issue', { nonce })).json() as any;
  const newer = await (await call('issue', { nonce })).json() as any;
  expect((await call('verify', { nonce, token: older.token, fingerprint }, false)).status).toBe(409);
  const receipt = await (await call('verify', { nonce, token: newer.token, fingerprint }, false)).json() as any;
  vi.advanceTimersByTime(120001);
  expect((await call('consume', { nonce, token: receipt.token, fingerprint })).status).toBe(409);
  expect(db.prepare('SELECT count(*) AS n FROM browser_recovery_proofs').get()?.n).toBe(0);
  db.close();
});
test('separate Dev storage advertises no production peer and cannot issue recovery proofs', async () => {
  expect(browserRecoveryPeer('https://systems-mapping.ailab-452.workers.dev', true)?.peerOrigin).toBe('https://systems-mapping.ailab-452.workers.dev');
  expect(browserRecoveryPeer('https://systems-mapping.ailab-452.workers.dev')?.peerOrigin).toBe('https://tools.ailab.gc.cuny.edu');
  expect(browserRecoveryPeer('https://systems-mapping-dev.ailab-452.workers.dev')).toBeNull();
  expect(browserRecoveryPeer('https://systems-mapping-dev.ailab-452.workers.dev', true)).toBeNull();
  const db = new DatabaseSync(':memory:');
  const proofs = new BrowserRecoveryProofs(db, { transactionSync: (work: () => Response) => work() } as any, 'https://systems-mapping-dev.ailab-452.workers.dev');
  const response = await proofs.request(new Request('https://systems-mapping-dev.ailab-452.workers.dev/api/cloud/browser-recovery/issue', { method: 'POST' }),
    { subject: 'fixture', admin: false, gatewayJwt: 'fixture', expiresAt: Date.now() + 100000 }, 'owner');
  expect(response.status).toBe(404);
  expect(db.prepare('SELECT count(*) AS n FROM browser_recovery_proofs').get()?.n).toBe(0);
  db.close();
});
