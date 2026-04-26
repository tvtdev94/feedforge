# Brainstorm: Multi-site Crawler Monorepo (Daily.dev first)

**Date:** 2026-04-25 13:47 (Asia/Bangkok)
**Status:** Approved → proceed to `/ck:plan`

## 1. Problem Statement

Cần dự án crawl data từ nhiều site khác nhau. Mỗi site là 1 package độc lập. Package đầu tiên: **daily.dev** — lấy URL, summary, metadata. Phải scale được khi thêm site mới (hacker-news, reddit, ...).

## 2. Requirements

### Functional
- Crawl daily.dev: popular/trending feed + search theo tag/keyword
- Lưu URL, title, summary, metadata (tags, author, publisher, image, timestamps)
- Deduplicate theo `(source, external_id)`
- CLI one-shot: `crawler crawl <site> [options]`
- Liệt kê data đã crawl: `crawler list --source ... --limit ...`

### Non-functional
- Free, không cần API key trả phí
- Scale được khi thêm site mới (chỉ cần 1 package + 1 dòng registry)
- Single-process, single-file DB (SQLite) — dễ backup/portable
- TypeScript strict mode, code clean theo YAGNI/KISS/DRY

## 3. Evaluated Approaches

### Scrape method
| Approach | Verdict |
|---|---|
| GraphQL API daily.dev | **CHỌN** — public, free, ổn định, structured |
| HTML parsing | Loại — fragile, dễ vỡ khi UI đổi |
| Headless browser | Loại — overkill, chậm, không cần khi có API |

### Storage
| Approach | Verdict |
|---|---|
| File JSON/JSONL | Loại — khó query, khó dedupe |
| SQLite | **CHỌN** — query, dedupe, single-file, không cần server |
| Postgres | Loại (cho phase 1) — overkill cho personal crawler |
| MongoDB | Loại — schema-flexible nhưng SQLite đã đủ |

### Monorepo tooling
| Approach | Verdict |
|---|---|
| pnpm workspaces | **CHỌN** — nhẹ, scale tốt, KISS |
| Turborepo + pnpm | Loại (phase 1) — YAGNI, thêm sau khi cần build cache |
| npm workspaces | Loại — chậm hơn pnpm, ít feature |

## 4. Final Solution

### Repo structure
```
crawler/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── data/crawler.db                 # gitignored
└── packages/
    ├── core/                       # types, db, repository, Crawler interface
    ├── daily-dev/                  # GraphQL client + queries + mapper
    └── cli/                        # commander dispatcher + registry
```

### Crawler interface (core)
```ts
interface Crawler {
  readonly name: string;
  crawl(options: CrawlOptions): AsyncIterable<Article>;
}

interface CrawlOptions {
  feed: 'popular' | 'search';
  tag?: string;
  query?: string;
  limit?: number;
}
```

### DB schema (SQLite)
- `articles` — id, source, external_id, url, permalink, title, summary, author, publisher, publisher_image, image_url, published_at, crawled_at, raw_json. UNIQUE(source, external_id).
- `article_tags` — article_id, tag. PK(article_id, tag).
- Index: source, published_at, tag.

### Tech stack
- `graphql-request` — GraphQL client
- `better-sqlite3` — SQLite driver (sync, fast)
- `commander` — CLI parser
- `zod` — validate API response
- `nanoid` — internal IDs
- `tsx` — dev runner
- Native `fetch` — không thêm HTTP dep

### Daily.dev queries
- `anonymousFeed` — popular/trending (public)
- `searchPosts` / `tagFeed` — search by tag/keyword (public)
- Endpoint: `https://api.daily.dev/graphql`
- Không cần auth cho 2 query trên

### CLI
```bash
pnpm cli crawl daily-dev --feed popular --limit 50
pnpm cli crawl daily-dev --feed search --tag javascript --limit 100
pnpm cli list --source daily-dev --limit 10
```

## 5. Implementation Considerations

- **Rate limiting**: throttle 1-2 req/s, retry with exponential backoff
- **Resilience**: lưu `raw_json` đầy đủ → migrate field về sau không cần crawl lại
- **Validation**: dùng `zod` parse response → fail-safe nếu schema thay đổi
- **User-Agent**: set thân thiện, identify rõ
- **Pagination**: GraphQL daily.dev dùng cursor-based pagination → loop cho đến `hasNextPage = false` hoặc đạt `limit`

## 6. Risks & Mitigation

| Risk | Mitigation |
|---|---|
| API rate-limit/block | Throttle + retry + UA hợp lệ |
| GraphQL schema đổi | Lưu raw_json, dùng zod parse có default |
| TOS daily.dev | Personal use, không spam, query public |
| File DB lock multi-run | One-shot CLI, không multi-process; nếu cần → WAL mode |

## 7. Success Metrics

- Crawl 100 bài từ daily.dev popular feed thành công, lưu DB không lỗi
- Re-run cùng command → 0 row mới (deduplicate hoạt động)
- Search theo tag `javascript` trả ≥50 bài có tag chứa `javascript`
- Thêm site mới (mock) chỉ cần tạo 1 package + 1 dòng registry, không sửa core

## 8. Next Steps

1. Invoke `/ck:plan` để chia phase chi tiết:
   - Phase 1: bootstrap monorepo (pnpm workspaces, tsconfig base, scripts)
   - Phase 2: core package (types, DB, repository, Crawler interface)
   - Phase 3: daily-dev package (GraphQL client, queries, mapper)
   - Phase 4: CLI package (commander, registry, commands)
   - Phase 5: smoke test end-to-end + README
2. Sau plan → implement theo phase order

## 9. Unresolved Questions

- Có cần command `export` (JSON/CSV) sớm không, hay chỉ `list` là đủ phase 1?
- Có cần config file (`.crawlerrc`) cho throttle/limit defaults không, hay CLI flag là đủ?
- Có muốn lưu daily.dev cookie để mở rộng sang personal feed/bookmarks ở phase sau không?
