import { describe, it, expect } from 'vitest';
import { buildTestApp, makeArticle, readReq } from './test-helpers.js';

describe('GET /articles + /sources', () => {
  it('returns empty when DB has no rows', async () => {
    const { app } = buildTestApp();
    const res = await app.fetch(readReq('/articles'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
  });

  it('lists articles with tags + total count', async () => {
    const { app, articles } = buildTestApp();
    articles.upsert(makeArticle({ tags: ['rust', 'webdev'] }));
    articles.upsert(makeArticle());
    const res = await app.fetch(readReq('/articles'));
    const body = (await res.json()) as { items: Array<{ tags: string[] }>; total: number };
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]?.tags).toBeInstanceOf(Array);
  });

  it('filters by source query param', async () => {
    const { app, articles } = buildTestApp();
    articles.upsert(makeArticle({ source: 'daily-dev' }));
    articles.upsert(makeArticle({ source: 'hn' }));
    const res = await app.fetch(readReq('/articles?source=hn'));
    const body = (await res.json()) as { items: Array<{ source: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0]?.source).toBe('hn');
  });

  it('paginates via limit/offset', async () => {
    const { app, articles } = buildTestApp();
    for (let i = 0; i < 5; i++) articles.upsert(makeArticle());
    const res = await app.fetch(readReq('/articles?limit=2&offset=1'));
    const body = (await res.json()) as { items: unknown[]; total: number; limit: number; offset: number };
    expect(body.items).toHaveLength(2);
    expect(body.total).toBe(5);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(1);
  });

  it('GET /articles/:id returns article + tags', async () => {
    const { app, articles } = buildTestApp();
    const r = articles.upsert(makeArticle({ tags: ['ai'] }));
    const res = await app.fetch(readReq(`/articles/${r.id}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; tags: string[] };
    expect(body.id).toBe(r.id);
    expect(body.tags).toEqual(['ai']);
  });

  it('GET /articles/:id returns 404 for unknown id', async () => {
    const { app } = buildTestApp();
    const res = await app.fetch(readReq('/articles/missing'));
    expect(res.status).toBe(404);
  });

  it('GET /sources groups by source', async () => {
    const { app, articles } = buildTestApp();
    articles.upsert(makeArticle({ source: 'daily-dev' }));
    articles.upsert(makeArticle({ source: 'daily-dev' }));
    articles.upsert(makeArticle({ source: 'hn' }));
    const res = await app.fetch(readReq('/sources'));
    const body = (await res.json()) as { sources: { source: string; count: number }[] };
    expect(body.sources).toEqual([
      { source: 'daily-dev', count: 2 },
      { source: 'hn', count: 1 },
    ]);
  });
});
