import { createHash } from 'node:crypto';
import type { Principal } from './identity';
import { boundedText, withDeadline } from './bounded.js';

const TOKEN = /^[0-9a-f]{64}$/;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
const reject = (status = 409) => Response.json({ error: 'Browser recovery could not be verified. Keep both copies and start recovery again.' }, { status });
export function browserRecoveryPeer(appOrigin: string, mounted = false) {
  if (appOrigin !== 'https://systems-mapping.ailab-452.workers.dev') return null;
  return mounted ? { peerOrigin: appOrigin, peerPath: '/' }
    : { peerOrigin: 'https://tools.ailab.gc.cuny.edu', peerPath: '/systems-mapping/' };
}

// Only opaque, one-use receipts are stored. Browser data never enters this API.
export class BrowserRecoveryProofs {
  private context: string;
  private supported: boolean;
  constructor(private db: any, private storage: DurableObjectStorage, appOrigin: string) {
    this.context = JSON.stringify(['systems-mapping-browser-recovery-v1', appOrigin, 'https://tools.ailab.gc.cuny.edu']);
    this.supported = browserRecoveryPeer(appOrigin) !== null;
    db.exec(`CREATE TABLE IF NOT EXISTS browser_recovery_proofs (
      token TEXT PRIMARY KEY, owner TEXT NOT NULL, subject TEXT NOT NULL,
      nonce TEXT NOT NULL, destination INTEGER NOT NULL, phase INTEGER NOT NULL,
      fingerprint TEXT NOT NULL, expires INTEGER NOT NULL, context TEXT NOT NULL
    );`);
  }

  async request(request: Request, principal: Principal, owner: string): Promise<Response> {
    if (!this.supported) return reject(404);
    const action = new URL(request.url).pathname.slice('/api/cloud/browser-recovery/'.length);
    if (!['issue', 'verify', 'consume'].includes(action) || request.method !== 'POST') return reject(404);
    const account = this.db.prepare('SELECT cache_key FROM cloud_accounts WHERE owner=?').get(owner);
    if (!account || request.headers.get('x-systems-account-cache') !== account.cache_key) return reject();
    let body: any;
    try {
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return reject(400);
      body = await withDeadline(async signal => JSON.parse(await boundedText(request, signal, 1024)), request.signal, 10000);
    } catch { return reject(400); }
    const fields = action === 'issue' ? ['nonce'] : ['nonce', 'token', 'fingerprint'];
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== fields.length
      || fields.some(key => typeof body[key] !== 'string' || !TOKEN.test(body[key]))) return reject(400);
    const now = Date.now(), destination = principal.toolsMounted ? 1 : 0, subject = hash(principal.subject);
    if (principal.expiresAt <= now) return reject(401);
    return this.storage.transactionSync(() => {
      this.db.prepare('DELETE FROM browser_recovery_proofs WHERE expires<=?').run(now);
      if (action === 'issue') {
        // Bound retained grants per account, even when a browser abandons its popup.
        this.db.prepare('DELETE FROM browser_recovery_proofs WHERE owner=? AND destination=?').run(owner, destination);
        const proof = token(), expiresAt = Math.min(now + 120_000, principal.expiresAt);
        this.db.prepare('INSERT INTO browser_recovery_proofs VALUES (?,?,?,?,?,?,?,?,?)')
          .run(hash(proof), owner, subject, body.nonce, destination, 0, '', expiresAt, this.context);
        return Response.json({ token: proof, expiresAt });
      }
      const row = this.db.prepare('SELECT * FROM browser_recovery_proofs WHERE token=?').get(hash(body.token));
      if (!row || row.owner !== owner || row.subject !== subject || row.nonce !== body.nonce || row.context !== this.context
        || row.destination !== (action === 'verify' ? 1 - destination : destination)
        || row.phase !== (action === 'verify' ? 0 : 1)
        || action === 'consume' && row.fingerprint !== body.fingerprint) return reject();
      this.db.prepare('DELETE FROM browser_recovery_proofs WHERE token=?').run(hash(body.token));
      if (action === 'consume') return Response.json({ verified: true });
      const receipt = token();
      this.db.prepare('INSERT INTO browser_recovery_proofs VALUES (?,?,?,?,?,?,?,?,?)')
        .run(hash(receipt), owner, subject, row.nonce, row.destination, 1, body.fingerprint, Math.min(row.expires, principal.expiresAt), this.context);
      return Response.json({ token: receipt, expiresAt: Math.min(row.expires, principal.expiresAt) });
    });
  }
}
