import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../db.js';
import { ArticleRepository } from '../repository.js';
import type { Article } from '../types.js';
import type { Db } from '../db.js';

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'art_1',
    source: 'daily-dev',
    externalId: 'ext_1',
    url: 'https://example.com/a',
    permalink: 'https://daily.dev/posts/ext_1',
    title: 'Hello World',
    summary: 'A summary',
    author: 'Alice',
    publisher: 'example.com',
    publisherImage: null,
    imageUrl: null,
    publishedAt: '2026-04-25T10:00:00.000Z',
    crawledAt: '2026-04-25T13:00:00.000Z',
    tags: ['javascript', 'webdev'],
    rawJson: '{}',
    ...overrides,
  };
}

describe('ArticleRepository', () => {
  let db: Db;
  let repo: ArticleRepository;

  beforeEach(() => {
    db = openDb(':memory:');
    repo = new ArticleRepository(db);
  });

  it('inserts a new article and stores tags', () => {
    const r = repo.upsert(makeArticle());
    expect(r.inserted).toBe(true);
    expect(repo.count('daily-dev')).toBe(1);
    expect(repo.tagsOf(r.id)).toEqual(['javascript', 'webdev']);
  });

  it('dedupes by (source, external_id) — second upsert updates, not inserts', () => {
    repo.upsert(makeArticle());
    const r2 = repo.upsert(
      makeArticle({ id: 'different_internal_id', title: 'Updated Title' }),
    );
    expect(r2.inserted).toBe(false);
    expect(repo.count('daily-dev')).toBe(1);

    const rows = repo.list({ source: 'daily-dev' });
    expect(rows[0]?.title).toBe('Updated Title');
  });

  it('replaces tags on update', () => {
    const r1 = repo.upsert(makeArticle({ tags: ['old', 'tags'] }));
    repo.upsert(makeArticle({ tags: ['new'] }));
    expect(repo.tagsOf(r1.id)).toEqual(['new']);
  });

  it('list orders by published_at desc, falls back to crawled_at', () => {
    repo.upsert(
      makeArticle({
        id: 'a',
        externalId: 'a',
        publishedAt: '2026-01-01T00:00:00Z',
      }),
    );
    repo.upsert(
      makeArticle({
        id: 'b',
        externalId: 'b',
        publishedAt: '2026-04-01T00:00:00Z',
      }),
    );
    const rows = repo.list({ source: 'daily-dev' });
    expect(rows[0]?.external_id).toBe('b');
    expect(rows[1]?.external_id).toBe('a');
  });

  it('upsertMany counts inserted vs updated correctly', () => {
    const articles = [
      makeArticle({ id: 'a', externalId: 'a' }),
      makeArticle({ id: 'b', externalId: 'b' }),
    ];
    const first = repo.upsertMany(articles);
    expect(first).toEqual({ inserted: 2, updated: 0 });

    const second = repo.upsertMany(articles);
    expect(second).toEqual({ inserted: 0, updated: 2 });
  });

  it('count is scoped per source', () => {
    repo.upsert(makeArticle({ source: 'daily-dev', externalId: 'a' }));
    repo.upsert(
      makeArticle({ id: 'art_2', source: 'other-site', externalId: 'a' }),
    );
    expect(repo.count('daily-dev')).toBe(1);
    expect(repo.count('other-site')).toBe(1);
  });

  it('preserves original crawled_at on re-upsert (first-seen semantics)', () => {
    repo.upsert(makeArticle({ crawledAt: '2026-01-01T00:00:00.000Z' }));
    repo.upsert(makeArticle({ crawledAt: '2026-12-31T00:00:00.000Z' }));
    const rows = repo.list({ source: 'daily-dev' });
    expect(rows[0]?.crawled_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('upsertMany handles mixed inserts/updates atomically', () => {
    repo.upsert(makeArticle({ id: 'a', externalId: 'a', title: 'orig' }));
    const result = repo.upsertMany([
      makeArticle({ id: 'a-new', externalId: 'a', title: 'updated' }),
      makeArticle({ id: 'b', externalId: 'b' }),
    ]);
    expect(result).toEqual({ inserted: 1, updated: 1 });
    expect(repo.count('daily-dev')).toBe(2);
  });

  it('findById returns row when exists, undefined when not', () => {
    const r = repo.upsert(makeArticle());
    expect(repo.findById(r.id)?.title).toBe('Hello World');
    expect(repo.findById('nonexistent')).toBeUndefined();
  });

  it('listAcrossSources returns all without filters', () => {
    repo.upsert(makeArticle({ id: 'a', externalId: 'a', source: 'daily-dev' }));
    repo.upsert(makeArticle({ id: 'b', externalId: 'b', source: 'hn' }));
    const rows = repo.listAcrossSources({ limit: 10, offset: 0 });
    expect(rows).toHaveLength(2);
  });

  it('listAcrossSources filters by tag', () => {
    repo.upsert(makeArticle({ id: 'a', externalId: 'a', tags: ['javascript'] }));
    repo.upsert(makeArticle({ id: 'b', externalId: 'b', tags: ['rust'] }));
    const rows = repo.listAcrossSources({ tag: 'rust', limit: 10, offset: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.external_id).toBe('b');
  });

  it('listAcrossSources filters by since', () => {
    repo.upsert(
      makeArticle({ id: 'old', externalId: 'old', publishedAt: '2025-01-01T00:00:00Z' }),
    );
    repo.upsert(
      makeArticle({ id: 'new', externalId: 'new', publishedAt: '2026-06-01T00:00:00Z' }),
    );
    const rows = repo.listAcrossSources({
      since: '2026-01-01T00:00:00Z',
      limit: 10,
      offset: 0,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.external_id).toBe('new');
  });

  it('listSources groups correctly across sources', () => {
    repo.upsert(makeArticle({ id: 'a', externalId: 'a', source: 'daily-dev' }));
    repo.upsert(makeArticle({ id: 'b', externalId: 'b', source: 'daily-dev' }));
    repo.upsert(makeArticle({ id: 'c', externalId: 'c', source: 'hn' }));
    expect(repo.listSources()).toEqual([
      { source: 'daily-dev', count: 2 },
      { source: 'hn', count: 1 },
    ]);
  });

  it('migration v2 creates jobs table', () => {
    const rows = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'`)
      .all() as { name: string }[];
    expect(rows).toHaveLength(1);
  });
});
