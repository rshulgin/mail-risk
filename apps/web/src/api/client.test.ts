import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, api, buildQuery } from './client.js';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => vi.unstubAllGlobals());

describe('buildQuery', () => {
  it('omits absent and blank filters', () => {
    expect(buildQuery({})).toBe('');
    expect(buildQuery({ q: '   ' })).toBe('');
  });

  it('encodes the filters that are set', () => {
    expect(buildQuery({ minRisk: 'high', status: 'completed', q: 'wire transfer' })).toBe(
      '?minRisk=high&status=completed&q=wire+transfer',
    );
  });
});

describe('api error handling', () => {
  it('turns the server envelope into a readable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: 'not_found', message: 'Email not found' } }, 404),
      ),
    );

    await expect(api.getEmail('nope')).rejects.toMatchObject({
      message: 'Email not found',
      code: 'not_found',
      status: 404,
    });
  });

  it('explains a dead API rather than surfacing "Failed to fetch"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(api.health()).rejects.toBeInstanceOf(ApiClientError);
    await expect(api.health()).rejects.toThrow(/Could not reach the API/);
  });

  it('falls back to a status message when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 })),
    );

    await expect(api.listEmails()).rejects.toThrow(/status 502/);
  });

  it('posts pasted text as JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'x' }, 202));
    vi.stubGlobal('fetch', fetchMock);

    await api.createFromText('hello');

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/emails');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ text: 'hello' }));
  });

  it('posts an upload as multipart without forcing a content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'x' }, 202));
    vi.stubGlobal('fetch', fetchMock);

    await api.createFromFile(new File(['body'], 'note.txt', { type: 'text/plain' }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);
    // Setting content-type by hand would break the multipart boundary.
    expect(init.headers).toBeUndefined();
  });
});
