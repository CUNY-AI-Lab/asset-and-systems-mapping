const expected = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(expected || '')) throw new Error('A full source commit is required');
const origin = 'https://systems-mapping.ailab-452.workers.dev';
const health = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(10000), redirect: 'manual' });
const body = await health.json();
if (!health.ok || body.status !== 'ok' || body.release !== expected || body.auth !== 'cuny' || body.storage !== 'isolated-cloudflare') throw new Error('Release readiness does not match the requested source');
const protectedRoute = await fetch(`${origin}/api/cloud/projects`, { signal: AbortSignal.timeout(10000), redirect: 'manual' });
if (protectedRoute.status !== 401 || !protectedRoute.headers.get('cache-control')?.includes('no-store')) throw new Error('Anonymous project access did not fail closed');
console.log(JSON.stringify({ origin, source: expected, readiness: 'passed', anonymousProjects: 'denied', authenticatedAcceptance: 'separate check required' }));
