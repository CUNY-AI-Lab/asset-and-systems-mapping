import { loadEnvFile } from 'node:process';
import { issuePasswordReset } from './auth.js';
import { openPostgresDatabase } from './postgres.js';

try {
  loadEnvFile('.env');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const accountId = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;
const publicOrigin = process.env.PUBLIC_ORIGIN;
if (!accountId || !databaseUrl || !publicOrigin) {
  console.error('Usage: node server/create-password-reset.js <teacher-account-id> with DATABASE_URL and PUBLIC_ORIGIN set.');
  process.exit(1);
}

const database = openPostgresDatabase(databaseUrl, {
  maxConnections: 1,
  connectionTimeoutMs: 10_000,
  idleTimeoutMs: 10_000,
  statementTimeoutMs: 10_000,
  transactionIdleTimeoutMs: 10_000,
  ssl: process.env.DATABASE_SSL === 'true',
});

try {
  await database.ready;
  const { token } = await issuePasswordReset(database, accountId);
  const link = new URL(publicOrigin);
  link.hash = new URLSearchParams({ 'teacher-reset': token }).toString();
  console.log(link.toString());
} catch (error) {
  console.error(error?.message || 'Could not create the password reset link.');
  process.exitCode = 1;
} finally {
  await database.close();
}
