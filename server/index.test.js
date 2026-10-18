// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const INDEX_PATH = resolve('server/index.js');
const HOSTED_ENV = Object.freeze({
  DATABASE_URL: 'postgresql://127.0.0.1:1/systems_mapping_test',
  PUBLIC_ORIGIN: 'https://mapping.example.edu',
  HOST: '0.0.0.0',
  TRUST_PROXY_HOPS: '1',
});

describe('server-only runtime configuration', () => {
  let temporaryDirectories = [];

  afterEach(() => {
    for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
    temporaryDirectories = [];
  });

  function runIndex(environment) {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'systems-mapping-index-test-'));
    temporaryDirectories.push(temporaryDirectory);
    return spawnSync(process.execPath, [INDEX_PATH], {
      cwd: temporaryDirectory,
      encoding: 'utf8',
      timeout: 5000,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        ...environment,
      },
    });
  }

  it('fails hosted startup before database access when the class code is missing or the local default', () => {
    const missing = runIndex(HOSTED_ENV);
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('SYSTEMS_MAPPING_CLASS_CODE is required in hosted mode.');

    const defaultCode = runIndex({ ...HOSTED_ENV, SYSTEMS_MAPPING_CLASS_CODE: '101' });
    expect(defaultCode.status).not.toBe(0);
    expect(defaultCode.stderr).toContain('Hosted SYSTEMS_MAPPING_CLASS_CODE must contain 10 to 32 characters');
    expect(defaultCode.stderr).not.toContain(HOSTED_ENV.DATABASE_URL);
  });

  it('requires an explicit, exact hosted public-demo configuration', () => {
    const invalidFlag = runIndex({
      ...HOSTED_ENV,
      SYSTEMS_MAPPING_CLASS_CODE: '101',
      SYSTEMS_MAPPING_PUBLIC_DEMO: 'yes',
    });
    expect(invalidFlag.status).not.toBe(0);
    expect(invalidFlag.stderr).toContain('SYSTEMS_MAPPING_PUBLIC_DEMO must be true or false.');

    const mismatchedCode = runIndex({
      ...HOSTED_ENV,
      SYSTEMS_MAPPING_CLASS_CODE: 'CALI2026Map7Qv9Wx3Z',
      SYSTEMS_MAPPING_PUBLIC_DEMO: 'true',
    });
    expect(mismatchedCode.status).not.toBe(0);
    expect(mismatchedCode.stderr).toContain('Hosted public-demo mode requires SYSTEMS_MAPPING_CLASS_CODE=101.');
    expect(mismatchedCode.stderr).not.toContain(HOSTED_ENV.DATABASE_URL);
  });

  it('fails closed when Ollama Cloud is enabled without a fresh server-only credential', () => {
    const missingKey = runIndex({
      OLLAMA_ENABLED: 'true',
      SYSTEMS_MAPPING_CLASS_CODE: '101',
    });
    expect(missingKey.status).not.toBe(0);
    expect(missingKey.stderr).toContain('OLLAMA_API_KEY must be a fresh server-only credential');

    const invalidEndpoint = runIndex({
      OLLAMA_ENABLED: 'true',
      OLLAMA_API_KEY: 'fresh-test-only-key-material',
      OLLAMA_CLOUD_URL: 'https://provider.invalid',
      SYSTEMS_MAPPING_CLASS_CODE: '101',
    });
    expect(invalidEndpoint.status).not.toBe(0);
    expect(invalidEndpoint.stderr).toContain('OLLAMA_CLOUD_URL must be https://ollama.com.');
    expect(invalidEndpoint.stderr).not.toContain('fresh-test-only-key-material');
  });

  it('rejects an invalid migration retention hold before database access', () => {
    const invalidHold = runIndex({ ...HOSTED_ENV, SYSTEMS_MAPPING_CLASS_CODE: 'CALI2026Map7Qv9Wx3Z',
      SYSTEMS_MAPPING_RETENTION_HOLD_UNTIL: 'indefinitely' });
    expect(invalidHold.status).not.toBe(0);
    expect(invalidHold.stderr).toContain('SYSTEMS_MAPPING_RETENTION_HOLD_UNTIL must be a valid UTC ISO timestamp');
    expect(invalidHold.stderr).not.toContain(HOSTED_ENV.DATABASE_URL);
    expect(invalidHold.stderr).not.toContain('could not initialize its persistence layer');
  });
});
