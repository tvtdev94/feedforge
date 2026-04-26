---
phase: 1
name: Extend core repo + jobs migration
priority: critical
status: pending
estimatedHours: 1
---

# Phase 1: Extend `@crawler/core` Repository + add `jobs` migration

## Context

- Brainstorm REVISION: [../reports/brainstorm-260426-1141-crawler-api-cloudflare.md](../reports/brainstorm-260426-1141-crawler-api-cloudflare.md) (section "REVISION 2026-04-26 11:51")
- Current repo: `packages/core/src/repository.ts`, `packages/core/src/migrations.ts`
- KHÔNG refactor — chỉ ADD new methods + new migration v2 cho jobs table.

## Overview

Thêm 3 method vào `ArticleRepository`: `findById`, `listAcrossSources`, `listSources`. Thêm migration v2 tạo `jobs` table. Tests cover các method mới.

## Requirements

- `findById(id): ArticleRow | undefined`
- `listAcrossSources(opts: { source?, tag?, limit, offset, since? }): ArticleRow[]`
- `listSources(): { source: string; count: number }[]`
- Migration v2: `jobs` table (id, site, feed, tag, limit_n, status, inserted, updated, error, enqueued_at, started_at, completed_at) + index trên `status`
- Existing `list({source, limit, offset})` giữ nguyên (CLI hiện vẫn dùng — Phase 4 mới đổi)

## Architecture

`packages/core/src/repository.ts` — extend class. `migrations.ts` — append v2.

Tag filter dùng `WHERE EXISTS (SELECT 1 FROM article_tags WHERE article_id = articles.id AND tag = ?)`.
`since` dùng `AND COALESCE(published_at, crawled_at) >= ?`.

## Related code files

**Modify:**
- `packages/core/src/repository.ts` — add 3 methods + 3 prepared stmts
- `packages/core/src/migrations.ts` — append migration `{ version: 2, sql: '...' }`
- `packages/core/src/__tests__/repository.test.ts` — add tests cho 3 methods + verify migration v2 applied

**No changes:**
- types.ts, db.ts, crawler.ts, index.ts (no new exports needed; methods on existing class)

## Implementation steps

1. Add migration v2 vào `MIGRATIONS` array:
   ```ts
   {
     version: 2,
     sql: `
       CREATE TABLE IF NOT EXISTS jobs (
         id           TEXT PRIMARY KEY,
         site         TEXT NOT NULL,
         feed         TEXT NOT NULL,
         tag          TEXT,
         limit_n      INTEGER NOT NULL,
         status       TEXT NOT NULL CHECK(status IN ('pending','running','done','failed')),
         inserted     INTEGER NOT NULL DEFAULT 0,
         updated      INTEGER NOT NULL DEFAULT 0,
         error        TEXT,
         enqueued_at  TEXT NOT NULL,
         started_at   TEXT,
         completed_at TEXT
       );
       CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
     `,
   }
   ```

2. Add 3 prepared statements + methods trong `ArticleRepository` constructor. Pattern theo `listStmt`.

3. `findById`:
   ```sql
   SELECT * FROM articles WHERE id = ?
   ```

4. `listAcrossSources`:
   - Build SQL dynamically based on opts present (source, tag, since)
   - Sử dụng `db.prepare()` per call (không cache vì SQL khác nhau theo opts) — OK cho v1, KISS
   - Or: 4 prepared stmts cho 4 combinations (no filter, source-only, tag-only, source+tag) — over-engineering
   - **Recommend dynamic build** — SQL injection an toàn vì values qua `?` binds

5. `listSources`:
   ```sql
   SELECT source, COUNT(*) AS count FROM articles GROUP BY source ORDER BY source
   ```

6. Tests:
   - `findById returns row when exists, undefined when not`
   - `listAcrossSources without filters returns all`
   - `listAcrossSources filters by tag`
   - `listAcrossSources filters by since (newer than)`
   - `listSources groups correctly across sources`

7. `pnpm --filter @crawler/core test` — phải xanh hết.

## Code snippets (reference)

```ts
// repository.ts (extend)
findById(id: string): ArticleRow | undefined {
  return this.findByIdStmt.get(id) as ArticleRow | undefined;
}

listAcrossSources(opts: {
  source?: string; tag?: string; limit: number; offset: number; since?: string;
}): ArticleRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.source) { where.push('source = ?'); params.push(opts.source); }
  if (opts.tag)    { where.push('EXISTS (SELECT 1 FROM article_tags WHERE article_id = articles.id AND tag = ?)'); params.push(opts.tag); }
  if (opts.since)  { where.push('COALESCE(published_at, crawled_at) >= ?'); params.push(opts.since); }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `SELECT * FROM articles ${whereClause}
               ORDER BY COALESCE(published_at, crawled_at) DESC
               LIMIT ? OFFSET ?`;
  return this.db.prepare(sql).all(...params, opts.limit, opts.offset) as ArticleRow[];
}

listSources(): { source: string; count: number }[] {
  return this.db.prepare(`
    SELECT source, COUNT(*) AS count FROM articles
    GROUP BY source ORDER BY source
  `).all() as { source: string; count: number }[];
}
```

## Todo list

- [ ] Append migration v2 to `MIGRATIONS`
- [ ] Add `findById` + prepared stmt
- [ ] Add `listAcrossSources` (dynamic SQL build)
- [ ] Add `listSources`
- [ ] Add 5 tests covering above
- [ ] `pnpm --filter @crawler/core test` xanh
- [ ] `pnpm typecheck` cleaner

## Success criteria

- 3 methods khả dụng và type-correct
- Migration v2 chạy on fresh DB tạo bảng `jobs`
- Existing tests vẫn xanh + 5 tests mới pass

## Risks

| Risk | Mitigation |
|---|---|
| Migration v2 không chạy trên existing DB (đã ở v1) | Migration logic check `m.version > current` rồi mới run; v2 sẽ áp khi mở DB cũ |
| `listAcrossSources` dynamic SQL bug | Tests cover mọi combination |
| Tag JOIN performance trên large data | Index trên `article_tags(tag)` đã có; OK với <100K rows |

## Next steps

→ Phase 2: bootstrap `packages/api` với Hono + auth + read routes (articles, sources, health).
