import { loadEnvFile } from 'node:process';
import { openPostgresDatabase } from './postgres.js';

try {
  loadEnvFile('.env');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required to migrate PostgreSQL.');
  process.exit(1);
}

const database = openPostgresDatabase(databaseUrl, {
  maxConnections: 1,
  connectionTimeoutMs: 10_000,
  idleTimeoutMs: 10_000,
  statementTimeoutMs: 30_000,
  transactionIdleTimeoutMs: 10_000,
  ssl: process.env.DATABASE_SSL === 'true',
});

try {
  await database.ready;
  if (!await database.healthCheck()) throw new Error('PostgreSQL health check failed.');
  console.log('Systems Mapping PostgreSQL schema is ready.');
} catch {
  console.error('Systems Mapping could not migrate PostgreSQL.');
  process.exitCode = 1;
} finally {
  await database.close();
}
