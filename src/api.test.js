import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteProjectLink,
  revokeProjectLink,
  updateProjectLink,
} from './api.js';

function successfulFetch() {
  return vi.fn(async () => ({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ accepted: true }),
  }));
}

describe('project link API helpers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the expected revision in the request body and If-Match header', async () => {
    const fetch = successfulFetch();
    vi.stubGlobal('fetch', fetch);

    await updateProjectLink('token/with punctuation', '{"id":"project_1"}', 7);

    expect(fetch).toHaveBeenCalledWith('/api/projects/token%2Fwith%20punctuation', expect.objectContaining({
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': '"7"',
      },
      body: JSON.stringify({ project: '{"id":"project_1"}', expectedRevision: 7 }),
    }));
  });

  it('keeps existing two-argument updates backward compatible', async () => {
    const fetch = successfulFetch();
    vi.stubGlobal('fetch', fetch);

    await updateProjectLink('token', '{"id":"project_1"}');

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ project: '{"id":"project_1"}' });
    expect(fetch.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('supports distinct revoke and delete operations with optimistic revisions', async () => {
    const fetch = successfulFetch();
    vi.stubGlobal('fetch', fetch);

    await revokeProjectLink('token', 3);
    await deleteProjectLink('token', 4);

    expect(fetch.mock.calls[0][0]).toBe('/api/projects/token/revoke');
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ expectedRevision: 3 });
    expect(fetch.mock.calls[1][0]).toBe('/api/projects/token');
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'DELETE' });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ expectedRevision: 4 });
  });

  it('rejects invalid expected revisions before issuing a request', () => {
    const fetch = successfulFetch();
    vi.stubGlobal('fetch', fetch);

    expect(() => updateProjectLink('token', '{}', 0)).toThrow('positive integer');
    expect(fetch).not.toHaveBeenCalled();
  });
});
