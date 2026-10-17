// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSystemsMappingApp } from './app.js';

const BASE_URL = 'http://127.0.0.1:4177';
const JSON_HEADERS = { 'content-type': 'application/json' };
const postJson = (app, path, body, cookie) => app.request(`${BASE_URL}${path}`, {
  method: 'POST', headers: { ...JSON_HEADERS, origin: BASE_URL, 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
});
const overlay = {
  id: 'graph-builder-v1', profileVersion: '1.0.0', outputSchemaVersion: 'systems-mapping.builder.v1', label: 'Graph builder',
  provider: 'local-deterministic', baseModel: 'STEM Splitter', customInstructions: 'Keep questions short.', contextLimit: 32_000,
  confidenceThreshold: 0.72, relationVocabulary: ['provides', 'refers'], revision: 1, fingerprint: 'project_overlay_1',
};
const nodes = [
  { id: 'node_rosa', label: 'Rosa', type: 'person', scale: 'micro' },
  { id: 'node_clinic', label: 'Clinic', type: 'setting', scale: 'micro' },
  { id: 'node_hra', label: 'HRA', type: 'agency', scale: 'exosphere' },
];
const relationships = [{ id: 'edge_hra_clinic', source: 'node_hra', target: 'node_clinic', verb: 'funds' }];
const body = (overrides = {}) => ({
  activeScale: 'exosphere', intent: 'gaps', inquiry: 'How do outside decisions reach Rosa?', memoExcerpt: 'Rosa visits the clinic weekly.',
  nodes, relationships, scopes: [], focus: null, projectOverlay: overlay, studentJudgments: [], ...overrides,
});

describe('Map Check route', () => {
  let tempDirectory; let system; let ollamaRequest; let cookie;
  beforeEach(async () => {
    tempDirectory = mkdtempSync(join(tmpdir(), 'map-check-'));
    ollamaRequest = vi.fn(async () => ({
      suggestion: { notes: [{ kind: 'gap', point: 'Which decision of HRA changes what happens at the clinic?', refs: ['node_hra', 'edge_hra_clinic'] }] },
      metadata: { provider: 'ollama-cloud', model: 'server-model' },
    }));
    system = createSystemsMappingApp({ dbPath: join(tempDirectory, 'map-check.sqlite'), ollamaConfig: { apiKey: 'fresh-test-only-server-key', model: 'server-model' }, ollamaRequest });
    await system.ready;
    const access = await postJson(system.app, '/api/student/access', { code: '101' });
    expect(access.status).toBe(201);
    cookie = access.headers.get('set-cookie').split(';')[0];
  });
  afterEach(async () => { await system?.close?.(); rmSync(tempDirectory, { recursive: true, force: true }); });

  it('requires a student session', async () => {
    expect((await postJson(system.app, '/api/map/check', body())).status).toBe(401);
    expect(ollamaRequest).not.toHaveBeenCalled();
  });

  it('sends the carried map, not the memo, and returns validated notes tied to map IDs', async () => {
    const response = await postJson(system.app, '/api/map/check', body(), cookie);
    expect(response.status, await response.clone().text()).toBe(201);
    expect(await response.json()).toEqual({ intent: 'gaps', notes: [{ kind: 'gap', point: 'Which decision of HRA changes what happens at the clinic?', refs: ['node_hra', 'edge_hra_clinic'] }] });
    expect(ollamaRequest).toHaveBeenCalledTimes(1);
    const [input, , options] = ollamaRequest.mock.calls[0];
    expect(options.kind).toBe('map-check');
    expect(input.systemPrompt).toContain('MAP CHECK JSON CONTRACT');
    expect(input.systemPrompt).toContain('Keep questions short.');
    expect(input.carriedNodes).toEqual(nodes);
    expect(input.carriedConnections).toEqual(relationships);
    expect(input.sourceMetadata).toEqual({ intent: 'gaps', focus: null, scopes: [], studentJudgments: [] });
    expect(input.sourceText).toBe('Rosa visits the clinic weekly.');
  });

  it('reasons from the map alone when no excerpt is supplied', async () => {
    const response = await postJson(system.app, '/api/map/check', body({ memoExcerpt: '' }), cookie);
    expect(response.status).toBe(201);
    expect(ollamaRequest.mock.calls[0][0].sourceText).toMatch(/Reason only from the carried map/);
  });

  it('rejects notes that reference items outside the map without a second paid attempt', async () => {
    ollamaRequest.mockResolvedValueOnce({ suggestion: { notes: [{ kind: 'gap', point: 'Add the school.', refs: ['node_school'] }] }, metadata: {} });
    const response = await postJson(system.app, '/api/map/check', body(), cookie);
    expect(response.status).toBe(502);
    expect(ollamaRequest).toHaveBeenCalledTimes(1);
  });

  it('rejects note kinds that would propose new elements and over-long output', async () => {
    ollamaRequest.mockResolvedValueOnce({ suggestion: { notes: [{ kind: 'claim', point: 'A claim is not a gap.', refs: ['node_rosa'] }] }, metadata: {} });
    expect((await postJson(system.app, '/api/map/check', body(), cookie)).status).toBe(502);
    ollamaRequest.mockResolvedValueOnce({ suggestion: { notes: Array.from({ length: 5 }, () => ({ kind: 'gap', point: 'Too many.', refs: ['node_rosa'] })) }, metadata: {} });
    expect((await postJson(system.app, '/api/map/check', body(), cookie)).status).toBe(502);
  });

  it('validates intent, focus and scale before any model call', async () => {
    expect((await postJson(system.app, '/api/map/check', body({ intent: 'synthesis' }), cookie)).status).toBe(400);
    expect((await postJson(system.app, '/api/map/check', body({ intent: 'connection' }), cookie)).status).toBe(400);
    expect((await postJson(system.app, '/api/map/check', body({ focus: { kind: 'relationship', id: 'missing' } }), cookie)).status).toBe(400);
    expect((await postJson(system.app, '/api/map/check', body({ intent: 'rewrite' }), cookie)).status).toBe(400);
    expect(ollamaRequest).not.toHaveBeenCalled();
    const focused = await postJson(system.app, '/api/map/check', body({ intent: 'connection', focus: { kind: 'relationship', id: 'edge_hra_clinic' } }), cookie);
    expect(focused.status).toBe(502); // the fixture returns a gap note, which a connection check must refuse
    expect(ollamaRequest.mock.calls[0][0].sourceMetadata.focus).toEqual({ kind: 'relationship', id: 'edge_hra_clinic' });
  });

  it('uses the synthesis stage guidance at Macro-level', async () => {
    ollamaRequest.mockResolvedValueOnce({ suggestion: { notes: [{ kind: 'claim', point: 'Funding decisions reach Rosa through the clinic.', refs: ['node_hra', 'node_clinic'] }] }, metadata: {} });
    const response = await postJson(system.app, '/api/map/check', body({ activeScale: 'macrosphere', intent: 'synthesis' }), cookie);
    expect(response.status, await response.clone().text()).toBe(201);
    expect(ollamaRequest.mock.calls[0][0].systemPrompt).toContain('Review and export');
  });
});
