const expected = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(expected || '')) throw new Error('A full source commit is required');
// Second argument selects a Worker origin; production is the default so the
// release workflow keeps its receipt unchanged. The dev Worker passes its own.
const ALLOWED_ORIGINS = ['https://systems-mapping.ailab-452.workers.dev', 'https://systems-mapping-dev.ailab-452.workers.dev'];
const origin = process.argv[3] || ALLOWED_ORIGINS[0];
if (!ALLOWED_ORIGINS.includes(origin)) throw new Error('Unknown Systems Mapping origin');
const health = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(10000), redirect: 'manual' });
const body = await health.json();
if (!health.ok || body.status !== 'ok' || body.release !== expected || body.auth !== 'cuny' || body.storage !== 'isolated-cloudflare') throw new Error('Release readiness does not match the requested source');
const protectedRoute = await fetch(`${origin}/api/cloud/projects`, { signal: AbortSignal.timeout(10000), redirect: 'manual' });
if (protectedRoute.status !== 401 || !protectedRoute.headers.get('cache-control')?.includes('no-store')) throw new Error('Anonymous project access did not fail closed');
console.log(JSON.stringify({ origin, source: expected, readiness: 'passed', anonymousProjects: 'denied', authenticatedAcceptance: 'separate check required' }));
