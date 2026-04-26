# Phase 02 — Core Package

**Status:** pending
**Priority:** P0
**Estimated effort:** 1-2 hrs
**Blocked by:** Phase 1

## Context Links
- [plan.md](plan.md)
- [phase-01](phase-01-bootstrap-monorepo.md)

## Overview
Implement shared library: types domain (Article, Tag, CrawlOptions), Crawler interface, SQLite DB layer (init + migrations), repository (upsert/list/dedupe). Tất cả site package sau này sẽ phụ thuộc vào package này.

## Key Insights
- `better-sqlite3` sync API → code đơn giản hơn async, đủ nhanh cho one-shot CLI
- Migrations dùng pattern `user_version` PRAGMA — cực kỳ đơn giản, không cần lib migration
- Lưu `raw_json` field → resilient với schema change của site upstream
- Dedupe ở repository layer (UNIQUE constraint + INSERT OR REPLACE), KHÔNG ở crawler layer

## Requirements

### Functional
- Type `Article` chứa core + tags + author + publisher + raw_json
- Interface `Crawler` với `name` và `crawl(options): AsyncIterable<Article>`
- DB tự khởi tạo schema lần đầu, idempotent
- Repository có: `upsert(article)`, `upsertMany(articles)`, `list({source, limit, offset})`, `count(source)`
- Migration runner check `user_version` PRAGMA, apply migrations chưa chạy

### Non-functional
- Sync API (better-sqlite3 native)
- Type-safe (strict TS, không dùng `any`)
- Test cơ bản: upsert + dedupe

## Architecture

### File tree
```
packages/core/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts             # public exports
    ├── types.ts             # Article, Tag, CrawlOptions
    ├── crawler.ts           # interface Crawler
    ├── db.ts                # openDb(path), runMigrations()
    ├── migrations.ts        # array of {version, sql}
    ├── repository.ts        # ArticleRepository class
    └── __tests__/
        └── repository.test.ts
```

### Type design
```ts
// types.ts
export interface Article {
  id: string;                    // nanoid nội bộ
  source: string;                // "daily-dev"
  externalId: string;            // post id upstream
  url: string;                   // link gốc bài viết
  permalink: string | null;      // link daily.dev (nếu có)
  title: string;
  summary: string | null;
  author: string | null;
  publisher: string | null;
  publisherImage: string | null;
  imageUrl: string | null;
  publishedAt: string | null;    // ISO 8601
  crawledAt: string;             // ISO 8601
  tags: string[];
  rawJson: string;               // JSON.stringify(originalPayload)
}

export interface CrawlOptions {
  feed: 'popular' | 'search';
  tag?: string;
  query?: string;
  limit?: number;                // default 50
}
```

### Crawler interface
```ts
// crawler.ts
import type { Article, CrawlOptions } from './types.js';

export interface Crawler {
  readonly name: string;
  crawl(options: CrawlOptions): AsyncIterable<Article>;
}
```

### DB schema (migration v1)
```sql
CREATE TABLE IF NOT EXISTS articles (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL,
  external_id     TEXT NOT NULL,
  url             TEXT NOT NULL,
  permalink       TEXT,
  title           TEXT NOT NULL,
  summary         TEXT,
  author          TEXT,
  publisher       TEXT,
  publisher_image TEXT,
  image_url       TEXT,
  published_at    TEXT,
  crawled_at      TEXT NOT NULL,
  raw_json        TEXT,
  UNIQUE(source, external_id)
);

CREATE TABLE IF NOT EXISTS article_tags (
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL,
  PRIMARY KEY (article_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_articles_source       ON articles(source);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at);
CREATE INDEX IF NOT EXISTS idx_article_tags_tag      ON article_tags(tag);
```

## Related Code Files

### Create
- `packages/core/src/types.ts`
- `packages/core/src/crawler.ts`
- `packages/core/src/db.ts`
- `packages/core/src/migrations.ts`
- `packages/core/src/repository.ts`
- `packages/core/src/index.ts` (re-exports)
- `packages/core/src/__tests__/repository.test.ts`

### Modify
- `packages/core/package.json` — add deps: `better-sqlite3`, `nanoid`. devDeps: `@types/better-sqlite3`, `vitest`

## Implementation Steps

### Step 1 — Add deps
```bash
pnpm --filter @crawler/core add better-sqlite3 nanoid
pnpm --filter @crawler/core add -D @types/better-sqlite3 vitest
```

Add script: `"test": "vitest run"` trong `packages/core/package.json`.

### Step 2 — `types.ts` + `crawler.ts`
Theo design ở section Architecture.

### Step 3 — `migrations.ts`
```ts
export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS articles (...);
      CREATE TABLE IF NOT EXISTS article_tags (...);
      CREATE INDEX IF NOT EXISTS ...;
    `,
  },
];
```

### Step 4 — `db.ts`
```ts
import Database, { type Database as Db } from 'better-sqlite3';
import { MIGRATIONS } from './migrations.js';

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function runMigrations(db: Db): void {
  const current = (db.pragma('user_version', { simple: true }) as number) ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.exec(m.sql);
    db.pragma(`user_version = ${m.version}`);
  }
}
```

### Step 5 — `repository.ts`
```ts
import type { Database } from 'better-sqlite3';
import type { Article } from './types.js';

export class ArticleRepository {
  private readonly upsertStmt;
  private readonly insertTagStmt;
  private readonly clearTagsStmt;
  private readonly listStmt;
  private readonly countStmt;

  constructor(private readonly db: Database) {
    this.upsertStmt = db.prepare(`
      INSERT INTO articles (
        id, source, external_id, url, permalink, title, summary,
        author, publisher, publisher_image, image_url,
        published_at, crawled_at, raw_json
      ) VALUES (
        @id, @source, @externalId, @url, @permalink, @title, @summary,
        @author, @publisher, @publisherImage, @imageUrl,
        @publishedAt, @crawledAt, @rawJson
      )
      ON CONFLICT(source, external_id) DO UPDATE SET
        url = excluded.url,
        permalink = excluded.permalink,
        title = excluded.title,
        summary = excluded.summary,
        author = excluded.author,
        publisher = excluded.publisher,
        publisher_image = excluded.publisher_image,
        image_url = excluded.image_url,
        published_at = excluded.published_at,
        crawled_at = excluded.crawled_at,
        raw_json = excluded.raw_json
      RETURNING id
    `);
    this.clearTagsStmt = db.prepare('DELETE FROM article_tags WHERE article_id = ?');
    this.insertTagStmt = db.prepare('INSERT OR IGNORE INTO article_tags(article_id, tag) VALUES (?, ?)');
    this.listStmt = db.prepare(`
      SELECT * FROM articles
      WHERE source = ?
      ORDER BY COALESCE(published_at, crawled_at) DESC
      LIMIT ? OFFSET ?
    `);
    this.countStmt = db.prepare('SELECT COUNT(*) as n FROM articles WHERE source = ?');
  }

  upsert(article: Article): { id: string; created: boolean } {
    const tx = this.db.transaction((a: Article) => {
      const row = this.upsertStmt.get(a) as { id: string };
      this.clearTagsStmt.run(row.id);
      for (const t of a.tags) this.insertTagStmt.run(row.id, t);
      return row.id;
    });
    const id = tx(article);
    return { id, created: id === article.id };
  }

  upsertMany(articles: Iterable<Article>): { inserted: number; updated: number } {
    let inserted = 0, updated = 0;
    for (const a of articles) {
      const r = this.upsert(a);
      if (r.created) inserted++; else updated++;
    }
    return { inserted, updated };
  }

  list(opts: { source: string; limit?: number; offset?: number }) {
    return this.listStmt.all(opts.source, opts.limit ?? 50, opts.offset ?? 0);
  }

  count(source: string): number {
    return (this.countStmt.get(source) as { n: number }).n;
  }
}
```

### Step 6 — `index.ts`
```ts
export * from './types.js';
export * from './crawler.js';
export { openDb } from './db.js';
export { ArticleRepository } from './repository.js';
```

### Step 7 — Tests
File `__tests__/repository.test.ts`:
- Setup: openDb(':memory:')
- Test: upsert article mới → count = 1
- Test: upsert lại cùng (source, external_id) → count vẫn = 1, title được update
- Test: tags bị replace khi upsert
- Test: list trả articles theo source

### Step 8 — Verify
```bash
pnpm --filter @crawler/core typecheck
pnpm --filter @crawler/core test
```

## Todo List
- [ ] Add deps: better-sqlite3, nanoid, @types/better-sqlite3, vitest
- [ ] Implement `types.ts`, `crawler.ts`
- [ ] Implement `migrations.ts` với schema v1
- [ ] Implement `db.ts` với migration runner
- [ ] Implement `repository.ts` với upsert/list/count
- [ ] Re-export từ `index.ts`
- [ ] Viết unit tests cho repository (upsert, dedupe, tags, list)
- [ ] Verify `typecheck` + `test` pass

## Success Criteria
- `pnpm --filter @crawler/core typecheck` exit 0
- `pnpm --filter @crawler/core test` pass tất cả test
- DB tạo file SQLite hợp lệ, schema đúng (kiểm tra `.schema` qua sqlite3 CLI nếu cần)
- Re-run upsert cùng article → row count không tăng

## Risk Assessment
| Risk | Mitigation |
|---|---|
| `better-sqlite3` cần native build | Document yêu cầu build tools (Windows: VS Build Tools / node-gyp) |
| Migration breaking change sau này | Thêm migration mới, không sửa migration cũ |
| Race condition multi-process | Phase 1 không hỗ trợ; nếu cần → WAL + retry busy_timeout |

## Security Considerations
- Tất cả SQL dùng prepared statement (no concat) → safe khỏi SQL injection
- Không log raw_json mặc định (có thể chứa data nhạy cảm tùy site)

## Next Steps
→ Phase 3: implement daily-dev package, sử dụng types + Crawler interface từ phase này
