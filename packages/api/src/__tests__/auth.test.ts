import { describe, it, expect } from 'vitest';
import { buildTestApp, TEST_KEYS } from './test-helpers.js';

describe('auth middleware', () => {
  it('returns 401 without X-API-Key', async () => {
    const { app } = buildTestApp();
    const res = await app.fetch(new Request('http://test/articles'));
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid X-API-Key', async () => {
    const { app } = buildTestApp();
    const res = await app.fetch(
      new Request('http://test/articles', {
        headers: { 'X-API-Key': 'nope' },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 when read key calls admin route', async () => {
    const { app } = buildTestApp();
    const res = await app.fetch(
      new Request('http://test/crawl', {
        method: 'POST',
        headers: {
          'X-API-Key': TEST_KEYS.read,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ site: 'fake', limit: 1 }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('allows /health without auth', async () => {
    const { app } = buildTestApp();
    const res = await app.fetch(new Request('http://test/health'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });
});
