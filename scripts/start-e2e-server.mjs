import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const temporaryRoot = mkdtempSync(join(tmpdir(), 'systems-mapping-e2e-'));
const port = process.env.SYSTEMS_MAPPING_E2E_PORT || '4187';

// server/index.js loads .env on startup. Define every credential-bearing or
// hosted-mode variable here so a developer's local .env cannot redirect this
// harness to PostgreSQL, production, or an external model provider.
const serverEnvironment = {
  PATH: process.env.PATH || '',
  HOME: process.env.HOME || '',
  TMPDIR: process.env.TMPDIR || tmpdir(),
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: port,
  DATABASE_PATH: join(temporaryRoot, 'systems-mapping.sqlite'),
  DATABASE_URL: '',
  DATABASE_SSL: 'false',
  PUBLIC_ORIGIN: '',
  TRUST_PROXY_HOPS: '0',
  COOKIE_SECURE: 'false',
  SYSTEMS_MAPPING_CLASS_CODE: '101',
  SYSTEMS_MAPPING_PUBLIC_DEMO: 'false',
  SYSTEMS_MAPPING_TEACHER_BOOTSTRAP_TOKEN: '',
  OLLAMA_ENABLED: 'false',
  OLLAMA_API_KEY: '',
  OPENROUTER_ENABLED: 'false',
  // Two browser projects share one loopback client; the production limit of 60 events per minute
  // would reject telemetry mid-suite and surface as console errors.
  PROTOTYPE_EVENT_LIMIT: '1000',
  OPENROUTER_API_KEY: '',
};

const child = spawn(process.execPath, [join(repositoryRoot, 'server/index.js')], {
  cwd: repositoryRoot,
  env: serverEnvironment,
  stdio: 'inherit',
});

let requestedShutdown = false;
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function shutdown(signal) {
  if (requestedShutdown) return;
  requestedShutdown = true;
  if (!child.killed) child.kill(signal);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit', cleanup);

child.on('error', (error) => {
  console.error(`Systems Mapping E2E server could not start: ${error.message}`);
  cleanup();
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  cleanup();
  if (requestedShutdown) {
    process.exitCode = 0;
    return;
  }
  if (signal) console.error(`Systems Mapping E2E server stopped with ${signal}.`);
  process.exitCode = code ?? 1;
});
