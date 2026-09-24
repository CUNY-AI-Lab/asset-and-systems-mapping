import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { inTransaction } from './database.js';

const scrypt = promisify(scryptCallback);
export const TEACHER_SESSION_COOKIE = 'systems_mapping_teacher_session';
export const STUDENT_SESSION_COOKIE = 'systems_mapping_student_session';
// Retained as a compatibility alias for server callers that predate student access.
export const SESSION_COOKIE = TEACHER_SESSION_COOKIE;
export const MIN_PASSPHRASE_LENGTH = 10;
export const MAX_PASSPHRASE_LENGTH = 128;

const KEY_LENGTH = 64;
const MAX_ACTIVE_TEACHER_SESSIONS = 8;
const MAX_ACTIVE_STUDENT_SESSIONS = 256;
const COOKIE_PATH = '/api';

function nowValue(clock) {
  const value = Number(clock());
  if (!Number.isFinite(value)) throw new TypeError('The session clock must return a finite timestamp.');
  return Math.trunc(value);
}

function cookieOptions(secure, ttlMs) {
  return {
    httpOnly: true,
    sameSite: 'Strict',
    secure,
    path: COOKIE_PATH,
    maxAge: Math.max(1, Math.floor(ttlMs / 1000)),
    priority: 'High',
  };
}

export function validatePassphrase(passphrase) {
  if (typeof passphrase !== 'string') return 'Passphrase is required.';
  const length = Array.from(passphrase).length;
  if (length < MIN_PASSPHRASE_LENGTH) return `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`;
  if (length > MAX_PASSPHRASE_LENGTH) return `Passphrase must be no more than ${MAX_PASSPHRASE_LENGTH} characters.`;
  return null;
}

export async function hashPassphrase(passphrase, salt = randomBytes(16)) {
  const validationError = validatePassphrase(passphrase);
  if (validationError) throw new RangeError(validationError);
  const derived = await scrypt(passphrase, salt, KEY_LENGTH, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return { hash: Buffer.from(derived), salt: Buffer.from(salt) };
}

export async function verifyPassphrase(passphrase, storedHash, storedSalt) {
  if (validatePassphrase(passphrase) || !storedHash || !storedSalt) return false;
  const candidate = await scrypt(passphrase, Buffer.from(storedSalt), KEY_LENGTH, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  const expected = Buffer.from(storedHash);
  return expected.length === candidate.length && timingSafeEqual(expected, Buffer.from(candidate));
}

export function constantTimeSecretEqual(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
  const candidateHash = createHash('sha256').update(candidate, 'utf8').digest();
  const expectedHash = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function validPasswordResetToken(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export async function issuePasswordReset(db, accountId, ttlMs = 30 * 60 * 1000, { now = Date.now } = {}) {
  if (typeof accountId !== 'string' || !accountId) throw new TypeError('A teacher account ID is required.');
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 60_000 || ttlMs > 24 * 60 * 60 * 1000) {
    throw new TypeError('Password reset lifetime must be between one minute and one day.');
  }
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashSessionToken(token);
  const createdAt = nowValue(now);
  const expiresAt = createdAt + ttlMs;
  await inTransaction(db, async () => {
    await db.advisoryTransactionLock?.(`teacher-password-reset:${accountId}`);
    const account = await db.prepare('SELECT id FROM accounts WHERE id = ? AND passphrase_hash IS NOT NULL').get(accountId);
    if (!account) throw new Error('The claimed teacher account was not found.');
    await db.prepare('DELETE FROM teacher_password_resets WHERE expires_at <= ? OR account_id = ?').run(createdAt, accountId);
    await db.prepare(`
      INSERT INTO teacher_password_resets (token_hash, account_id, created_at, expires_at, used_at)
      VALUES (?, ?, ?, ?, NULL)
    `).run(tokenHash, accountId, createdAt, expiresAt);
  });
  return { token, expiresAt };
}

export async function consumePasswordReset(db, token, passphrase, { now = Date.now } = {}) {
  if (!validPasswordResetToken(token)) return null;
  const tokenHash = hashSessionToken(token);
  const checkedAt = nowValue(now);
  return inTransaction(db, async () => {
    await db.advisoryTransactionLock?.(`teacher-password-reset:${tokenHash}`);
    const reset = await db.prepare(`
      SELECT r.account_id AS accountId, a.display_name AS displayName
      FROM teacher_password_resets r
      JOIN accounts a ON a.id = r.account_id
      WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ?
    `).get(tokenHash, checkedAt);
    if (!reset) return null;
    const credentials = await hashPassphrase(passphrase);
    const changed = await db.prepare(`
      UPDATE teacher_password_resets SET used_at = ?
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
    `).run(checkedAt, tokenHash, checkedAt);
    if (changed.changes !== 1) return null;
    await db.prepare(`
      UPDATE accounts SET passphrase_hash = ?, passphrase_salt = ? WHERE id = ?
    `).run(credentials.hash, credentials.salt, reset.accountId);
    await db.prepare('UPDATE teacher_password_resets SET used_at = ? WHERE account_id = ? AND used_at IS NULL').run(checkedAt, reset.accountId);
    await db.prepare('DELETE FROM sessions WHERE account_id = ?').run(reset.accountId);
    return { id: reset.accountId, displayName: reset.displayName };
  });
}

export function sessionReference(token) {
  return hashSessionToken(token).slice(0, 16);
}

export async function issueSession(db, accountId, ttlMs, {
  now = Date.now,
  maxActiveSessions = MAX_ACTIVE_TEACHER_SESSIONS,
} = {}) {
  const token = randomBytes(32).toString('base64url');
  const issuedAt = nowValue(now);
  const expiresAt = issuedAt + ttlMs;
  await inTransaction(db, async () => {
    await db.advisoryTransactionLock?.(`teacher-sessions:${accountId}`);
    await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(issuedAt);
    await db.prepare(`
      INSERT INTO sessions (token_hash, account_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(hashSessionToken(token), accountId, issuedAt, expiresAt);
    await db.prepare(`
      DELETE FROM sessions
      WHERE account_id = ? AND token_hash IN (
        SELECT token_hash FROM sessions WHERE account_id = ?
        ORDER BY created_at DESC, token_hash DESC LIMIT -1 OFFSET ?
      )
    `).run(accountId, accountId, maxActiveSessions);
  });
  return { token, expiresAt };
}

export async function issueStudentSession(db, ttlMs, {
  now = Date.now,
  maxActiveSessions = MAX_ACTIVE_STUDENT_SESSIONS,
} = {}) {
  const token = randomBytes(32).toString('base64url');
  const issuedAt = nowValue(now);
  const expiresAt = issuedAt + ttlMs;
  await inTransaction(db, async () => {
    await db.advisoryTransactionLock?.('student-sessions');
    await db.prepare('DELETE FROM student_sessions WHERE expires_at <= ?').run(issuedAt);
    await db.prepare(`
      INSERT INTO student_sessions (token_hash, created_at, expires_at)
      VALUES (?, ?, ?)
    `).run(hashSessionToken(token), issuedAt, expiresAt);
    await db.prepare(`
      DELETE FROM student_sessions WHERE token_hash IN (
        SELECT token_hash FROM student_sessions
        ORDER BY created_at DESC, token_hash DESC LIMIT -1 OFFSET ?
      )
    `).run(maxActiveSessions);
  });
  return { token, expiresAt };
}

export function setSessionCookie(context, token, ttlMs, secure = false) {
  setCookie(context, TEACHER_SESSION_COOKIE, token, cookieOptions(secure, ttlMs));
}

export function setStudentSessionCookie(context, token, ttlMs, secure = false) {
  setCookie(context, STUDENT_SESSION_COOKIE, token, cookieOptions(secure, ttlMs));
}

export async function clearSession(context, db, secure = false) {
  const token = getCookie(context, TEACHER_SESSION_COOKIE);
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashSessionToken(token));
  deleteCookie(context, TEACHER_SESSION_COOKIE, cookieOptions(secure, 1));
}

export async function clearStudentSession(context, db, secure = false) {
  const token = getCookie(context, STUDENT_SESSION_COOKIE);
  if (token) await db.prepare('DELETE FROM student_sessions WHERE token_hash = ?').run(hashSessionToken(token));
  deleteCookie(context, STUDENT_SESSION_COOKIE, cookieOptions(secure, 1));
}

export async function currentTeacherSession(context, db, now = Date.now) {
  if (context.env?.verifiedAccount) return context.env.verifiedAccount.teacherSession;
  const token = getCookie(context, TEACHER_SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const checkedAt = nowValue(now);
  const row = await db.prepare(`
    SELECT a.id, a.display_name AS displayName, s.expires_at AS expiresAt
    FROM sessions s
    JOIN accounts a ON a.id = s.account_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash, checkedAt);
  if (!row) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return {
    user: { id: row.id, displayName: row.displayName },
    expiresAt: row.expiresAt,
    sessionRef: tokenHash.slice(0, 16),
  };
}

export async function currentStudentSession(context, db, now = Date.now) {
  if (context.env?.verifiedAccount) return context.env.verifiedAccount.studentSession;
  const token = getCookie(context, STUDENT_SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const checkedAt = nowValue(now);
  const row = await db.prepare(`
    SELECT expires_at AS expiresAt
    FROM student_sessions
    WHERE token_hash = ? AND expires_at > ?
  `).get(tokenHash, checkedAt);
  if (!row) {
    await db.prepare('DELETE FROM student_sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return { expiresAt: row.expiresAt, sessionRef: tokenHash.slice(0, 16) };
}

export async function currentUser(context, db, now = Date.now) {
  return (await currentTeacherSession(context, db, now))?.user ?? null;
}
