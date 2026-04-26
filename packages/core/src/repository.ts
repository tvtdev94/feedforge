import type { Db } from './db.js';
import type { Article } from './types.js';

/** Row shape as stored in SQLite (snake_case columns). */
export interface ArticleRow {
  id: string;
  source: string;
  external_id: string;
  url: string;
  permalink: string | null;
  title: string;
  summary: string | null;
  author: string | null;
  publisher: string | null;
  publisher_image: string | null;
  image_url: string | null;
  published_at: string | null;
  crawled_at: string;
  raw_json: string | null;
}

export interface ListOptions {
  source: string;
  limit?: number;
  offset?: number;
}

export interface UpsertResult {
  /** Internal id (either freshly inserted or existing). */
  id: string;
  /** True if this was a new row, false if it updated an existing one. */
  inserted: boolean;
}

export class ArticleRepository {
  private readonly insertStmt;
  private readonly findIdStmt;
  private readonly updateStmt;
  private readonly clearTagsStmt;
  private readonly insertTagStmt;
  private readonly listStmt;
  private readonly countStmt;
  private readonly tagsByArticleStmt;

  private readonly findByIdStmt;
  private readonly listSourcesStmt;

  constructor(private readonly db: Db) {
    this.insertStmt = db.prepare(`
      INSERT INTO articles (
        id, source, external_id, url, permalink, title, summary,
        author, publisher, publisher_image, image_url,
        published_at, crawled_at, raw_json
      ) VALUES (
        @id, @source, @externalId, @url, @permalink, @title, @summary,
        @author, @publisher, @publisherImage, @imageUrl,
        @publishedAt, @crawledAt, @rawJson
      )
    `);

    this.findIdStmt = db.prepare(
      `SELECT id FROM articles WHERE source = ? AND external_id = ?`,
    );

    this.findByIdStmt = db.prepare(`SELECT * FROM articles WHERE id = ?`);

    this.listSourcesStmt = db.prepare(`
      SELECT source, COUNT(*) AS count FROM articles
      GROUP BY source ORDER BY source
    `);

    // crawled_at is intentionally NOT updated — it preserves the
    // first-seen timestamp so list ordering stays stable on re-crawl.
    this.updateStmt = db.prepare(`
      UPDATE articles SET
        url = @url,
        permalink = @permalink,
        title = @title,
        summary = @summary,
        author = @author,
        publisher = @publisher,
        publisher_image = @publisherImage,
        image_url = @imageUrl,
        published_at = @publishedAt,
        raw_json = @rawJson
      WHERE id = @id
    `);

    this.clearTagsStmt = db.prepare(
      `DELETE FROM article_tags WHERE article_id = ?`,
    );
    this.insertTagStmt = db.prepare(
      `INSERT OR IGNORE INTO article_tags(article_id, tag) VALUES (?, ?)`,
    );

    this.listStmt = db.prepare(`
      SELECT * FROM articles
      WHERE source = ?
      ORDER BY COALESCE(published_at, crawled_at) DESC
      LIMIT ? OFFSET ?
    `);
    this.countStmt = db.prepare(
      `SELECT COUNT(*) AS n FROM articles WHERE source = ?`,
    );
    this.tagsByArticleStmt = db.prepare(
      `SELECT tag FROM article_tags WHERE article_id = ? ORDER BY tag`,
    );
  }

  /** Insert if new, update if `(source, external_id)` already exists. Tags are
   *  fully replaced on each upsert to reflect the latest upstream state. */
  upsert(article: Article): UpsertResult {
    const tx = this.db.transaction((a: Article): UpsertResult => {
      const existing = this.findIdStmt.get(a.source, a.externalId) as
        | { id: string }
        | undefined;

      if (existing) {
        const { crawledAt: _drop, ...updateParams } = this.toRowParams(a);
        this.updateStmt.run({ ...updateParams, id: existing.id });
        this.replaceTags(existing.id, a.tags);
        return { id: existing.id, inserted: false };
      }

      this.insertStmt.run(this.toRowParams(a));
      this.replaceTags(a.id, a.tags);
      return { id: a.id, inserted: true };
    });
    return tx(article);
  }

  /** Batched upsert: single transaction across the whole iterable so 1000
   *  articles → 1 fsync instead of 1000. Falls through to per-row `upsert`
   *  for the actual SQL. */
  upsertMany(articles: Iterable<Article>): { inserted: number; updated: number } {
    const tx = this.db.transaction((items: Iterable<Article>) => {
      let inserted = 0;
      let updated = 0;
      for (const a of items) {
        const existing = this.findIdStmt.get(a.source, a.externalId) as
          | { id: string }
          | undefined;
        if (existing) {
          const { crawledAt: _drop, ...updateParams } = this.toRowParams(a);
          this.updateStmt.run({ ...updateParams, id: existing.id });
          this.replaceTags(existing.id, a.tags);
          updated++;
        } else {
          this.insertStmt.run(this.toRowParams(a));
          this.replaceTags(a.id, a.tags);
          inserted++;
        }
      }
      return { inserted, updated };
    });
    return tx(articles);
  }

  list(opts: ListOptions): ArticleRow[] {
    const rows = this.listStmt.all(
      opts.source,
      opts.limit ?? 50,
      opts.offset ?? 0,
    ) as ArticleRow[];
    return rows;
  }

  count(source: string): number {
    return (this.countStmt.get(source) as { n: number }).n;
  }

  findById(id: string): ArticleRow | undefined {
    return this.findByIdStmt.get(id) as ArticleRow | undefined;
  }

  /** Cross-source query with optional source/tag/since filters. SQL is built
   *  per-call (not cached) since clauses vary; values still go through `?`
   *  binds so injection-safe. */
  listAcrossSources(opts: {
    source?: string;
    tag?: string;
    limit: number;
    offset: number;
    since?: string;
  }): ArticleRow[] {
    const { whereClause, params } = buildArticleWhere(opts);
    const sql = `
      SELECT * FROM articles
      ${whereClause}
      ORDER BY COALESCE(published_at, crawled_at) DESC
      LIMIT ? OFFSET ?
    `;
    return this.db
      .prepare(sql)
      .all(...params, opts.limit, opts.offset) as ArticleRow[];
  }

  countAcrossSources(opts: { source?: string; tag?: string; since?: string }): number {
    const { whereClause, params } = buildArticleWhere(opts);
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM articles ${whereClause}`)
      .get(...params) as { n: number };
    return row.n;
  }

  listSources(): { source: string; count: number }[] {
    return this.listSourcesStmt.all() as { source: string; count: number }[];
  }

  tagsOf(articleId: string): string[] {
    const rows = this.tagsByArticleStmt.all(articleId) as { tag: string }[];
    return rows.map((r) => r.tag);
  }

  private replaceTags(articleId: string, tags: readonly string[]): void {
    this.clearTagsStmt.run(articleId);
    for (const t of tags) {
      if (!t) continue;
      this.insertTagStmt.run(articleId, t);
    }
  }

  private toRowParams(a: Article) {
    return {
      id: a.id,
      source: a.source,
      externalId: a.externalId,
      url: a.url,
      permalink: a.permalink,
      title: a.title,
      summary: a.summary,
      author: a.author,
      publisher: a.publisher,
      publisherImage: a.publisherImage,
      imageUrl: a.imageUrl,
      publishedAt: a.publishedAt,
      crawledAt: a.crawledAt,
      rawJson: a.rawJson,
    };
  }
}

/** Build a parameterized WHERE clause for cross-source article queries.
 *  Single source of truth shared by `listAcrossSources` and
 *  `countAcrossSources` so they can never disagree on filter semantics. */
function buildArticleWhere(opts: {
  source?: string;
  tag?: string;
  since?: string;
}): { whereClause: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.source) {
    where.push('source = ?');
    params.push(opts.source);
  }
  if (opts.tag) {
    where.push(
      'EXISTS (SELECT 1 FROM article_tags WHERE article_id = articles.id AND tag = ?)',
    );
    params.push(opts.tag);
  }
  if (opts.since) {
    where.push('COALESCE(published_at, crawled_at) >= ?');
    params.push(opts.since);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  return { whereClause, params };
}
