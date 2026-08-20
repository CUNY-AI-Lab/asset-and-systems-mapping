import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { loadEnvFile } from 'node:process';
import { createSystemsMappingApp } from './app.js';
import { requestOllamaSuggestion, validateOllamaCloudConfig } from './ollama.js';
import { requestOpenRouterSuggestion, validateOpenRouterConfig, withOpenRouterFallback } from './openrouter.js';

try {
  loadEnvFile('.env');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const databaseUrl = process.env.DATABASE_URL || null;
const publicOrigin = process.env.PUBLIC_ORIGIN || null;
const configuredHost = process.env.HOST || null;
const hostedMode = databaseUrl !== null || publicOrigin !== null;
if ((databaseUrl === null) !== (publicOrigin === null)) {
  throw new Error('DATABASE_URL and PUBLIC_ORIGIN must be configured together for hosted mode.');
}
if (hostedMode && configuredHost === null) {
  throw new Error('HOST must be configured explicitly for hosted mode.');
}
const hostname = configuredHost || '127.0.0.1';
if (hostedMode && !['0.0.0.0', '::'].includes(hostname)) {
  throw new Error('Hosted HOST must be 0.0.0.0 or ::.');
}
if (!hostedMode && hostname !== '127.0.0.1') {
  throw new Error('Local mode must bind only to 127.0.0.1.');
}
const port = Number.parseInt(process.env.PORT || '4177', 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT must be an integer from 1 through 65535.');

function optionalDuration(name, { min, max }) {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a whole number of milliseconds.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max} milliseconds.`);
  }
  return value;
}

function takeBootstrapToken() {
  const token = process.env.SYSTEMS_MAPPING_TEACHER_BOOTSTRAP_TOKEN || null;
  delete process.env.SYSTEMS_MAPPING_TEACHER_BOOTSTRAP_TOKEN;
  return token;
}

function takePublicDemo(isHosted) {
  const value = process.env.SYSTEMS_MAPPING_PUBLIC_DEMO;
  if (value !== undefined && !['true', 'false'].includes(value)) {
    throw new Error('SYSTEMS_MAPPING_PUBLIC_DEMO must be true or false.');
  }
  const enabled = value === 'true';
  if (enabled && !isHosted) {
    throw new Error('SYSTEMS_MAPPING_PUBLIC_DEMO may be enabled only in hosted mode.');
  }
  return enabled;
}

function takeClassCode(isHosted, publicDemo) {
  const code = process.env.SYSTEMS_MAPPING_CLASS_CODE;
  delete process.env.SYSTEMS_MAPPING_CLASS_CODE;
  if (code === undefined) {
    if (isHosted) throw new Error('SYSTEMS_MAPPING_CLASS_CODE is required in hosted mode.');
    return undefined;
  }
  if (isHosted) {
    if (publicDemo && code !== '101') {
      throw new Error('Hosted public-demo mode requires SYSTEMS_MAPPING_CLASS_CODE=101.');
    }
    if (!publicDemo && (code.length < 10 || code.length > 32 || code === '101' || new Set(code).size < 6)) {
      throw new Error('Hosted SYSTEMS_MAPPING_CLASS_CODE must contain 10 to 32 characters with at least 6 distinct characters.');
    }
  } else if (code.length < 1 || code.length > 32) {
    throw new Error('SYSTEMS_MAPPING_CLASS_CODE must contain 1 to 32 characters.');
  }
  return code;
}

function optionalBoolean(name) {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  if (!['true', 'false'].includes(raw)) throw new Error(`${name} must be true or false.`);
  return raw === 'true';
}

function takeOllamaConfig() {
  const enabled = process.env.OLLAMA_ENABLED;
  if (enabled !== undefined && !['true', 'false'].includes(enabled)) {
    throw new Error('OLLAMA_ENABLED must be true or false.');
  }
  const apiKey = process.env.OLLAMA_API_KEY;
  delete process.env.OLLAMA_API_KEY;
  if (enabled !== 'true') return null;
  if (typeof apiKey !== 'string' || apiKey.length < 20) {
    throw new Error('OLLAMA_API_KEY must be a fresh server-only credential when Ollama Cloud is enabled.');
  }
  const baseUrl = process.env.OLLAMA_CLOUD_URL || 'https://ollama.com';
  if (baseUrl !== 'https://ollama.com') {
    throw new Error('OLLAMA_CLOUD_URL must be https://ollama.com.');
  }
  return validateOllamaCloudConfig({
    apiKey,
    baseUrl,
    model: process.env.OLLAMA_MODEL || 'gpt-oss:20b',
    timeoutMs: optionalInteger('OLLAMA_TIMEOUT_MS', { fallback: undefined, min: 10, max: 120_000 }),
    maxOutputTokens: optionalInteger('OLLAMA_MAX_OUTPUT_TOKENS', { fallback: undefined, min: 1, max: 8192 }),
    think: optionalBoolean('OLLAMA_THINK'),
  });
}

function takeOpenRouterConfig() {
  const enabled = process.env.OPENROUTER_ENABLED;
  if (enabled !== undefined && !['true', 'false'].includes(enabled)) {
    throw new Error('OPENROUTER_ENABLED must be true or false.');
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  if (enabled !== 'true') return null;
  if (typeof apiKey !== 'string' || apiKey.length < 20) {
    throw new Error('OPENROUTER_API_KEY must be a fresh server-only credential when OpenRouter is enabled.');
  }
  const baseUrl = process.env.OPENROUTER_URL || 'https://openrouter.ai';
  if (baseUrl !== 'https://openrouter.ai') {
    throw new Error('OPENROUTER_URL must be https://openrouter.ai.');
  }
  const model = process.env.OPENROUTER_MODEL;
  if (typeof model !== 'string' || model.length === 0) {
    throw new Error('OPENROUTER_MODEL is required when OpenRouter is enabled.');
  }
  return validateOpenRouterConfig({
    apiKey,
    baseUrl,
    model,
    timeoutMs: optionalInteger('OPENROUTER_TIMEOUT_MS', { fallback: undefined, min: 10, max: 120_000 }),
    maxOutputTokens: optionalInteger('OPENROUTER_MAX_OUTPUT_TOKENS', { fallback: undefined, min: 1, max: 8192 }),
    reasoningEnabled: optionalBoolean('OPENROUTER_REASONING'),
  });
}

function optionalInteger(name, { fallback, min, max, required = false }) {
  const raw = process.env[name];
  if (raw === undefined) {
    if (required) throw new Error(`${name} is required in hosted mode.`);
    return fallback;
  }
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a whole number.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return value;
}

const trustedProxyHops = optionalInteger('TRUST_PROXY_HOPS', {
  fallback: 0,
  min: hostedMode ? 1 : 0,
  max: 5,
  required: hostedMode,
});
const databaseSsl = process.env.DATABASE_SSL === 'true';
if (process.env.DATABASE_SSL !== undefined && !['true', 'false'].includes(process.env.DATABASE_SSL)) {
  throw new Error('DATABASE_SSL must be true or false.');
}
const publicDemo = takePublicDemo(hostedMode);
const runtimeClassCode = takeClassCode(hostedMode, publicDemo);
const ollamaConfig = takeOllamaConfig();
const openRouterConfig = takeOpenRouterConfig();

// Ollama Cloud is the primary model runtime; OpenRouter either backs it up on
// provider-side failures or serves alone when it is the only runtime enabled.
let suggestionOptions = {};
if (ollamaConfig && openRouterConfig) {
  suggestionOptions = {
    ollamaConfig,
    ollamaRequest: withOpenRouterFallback(requestOllamaSuggestion, openRouterConfig),
  };
} else if (openRouterConfig) {
  suggestionOptions = {
    ollamaConfig: openRouterConfig,
    suggestionProvider: 'openrouter',
    ollamaRequest: requestOpenRouterSuggestion,
  };
} else if (ollamaConfig) {
  suggestionOptions = { ollamaConfig };
}

const { app, close, ready } = createSystemsMappingApp({
  dbPath: process.env.DATABASE_PATH || 'data/systems-mapping.sqlite',
  databaseUrl,
  publicOrigin,
  hostedMode,
  trustedProxyHops,
  postgres: {
    maxConnections: optionalInteger('PGPOOL_MAX', { fallback: 10, min: 1, max: 50 }),
    connectionTimeoutMs: optionalInteger('PG_CONNECTION_TIMEOUT_MS', { fallback: 5000, min: 100, max: 60_000 }),
    idleTimeoutMs: optionalInteger('PG_IDLE_TIMEOUT_MS', { fallback: 30_000, min: 1000, max: 600_000 }),
    statementTimeoutMs: optionalInteger('PG_STATEMENT_TIMEOUT_MS', { fallback: 10_000, min: 100, max: 60_000 }),
    transactionIdleTimeoutMs: optionalInteger('PG_TRANSACTION_IDLE_TIMEOUT_MS', { fallback: 5000, min: 100, max: 60_000 }),
    ssl: databaseSsl,
  },
  teacherBootstrapToken: takeBootstrapToken(),
  classCode: runtimeClassCode,
  publicDemo,
  ...suggestionOptions,
  studentSessionTtlMs: optionalDuration('STUDENT_SESSION_TTL_MS', { min: 1000, max: 7 * 24 * 60 * 60 * 1000 }),
  sessionTtlMs: optionalDuration('TEACHER_SESSION_TTL_MS', { min: 60_000, max: 30 * 24 * 60 * 60 * 1000 }),
});

try {
  await ready;
} catch {
  console.error('Systems Mapping could not initialize its persistence layer.');
  await Promise.resolve(close()).catch(() => {});
  process.exit(1);
}

app.use('/assets/*', serveStatic({ root: './dist' }));
app.use('/favicon.svg', serveStatic({ root: './dist' }));
app.use('/favicon.png', serveStatic({ root: './dist' }));
app.get('*', serveStatic({ path: './dist/index.html' }));

const server = serve({ fetch: app.fetch, hostname, port }, (info) => {
  const location = publicOrigin || `http://${info.address}:${info.port}`;
  console.log(`Systems Mapping is available at ${location}`);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(async () => {
    await close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
