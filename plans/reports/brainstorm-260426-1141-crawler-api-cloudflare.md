# Brainstorm: feedforge HTTP API on Cloudflare Workers + D1

**Date:** 2026-04-26
**Status:** Design approved, ready for /ck:plan
**Context:** Add HTTP API channel exposing feedforge data to external callers. Deploy on Cloudflare.

---

## Problem statement

`feedforge` hiện chỉ có CLI write/read SQLite local. User muốn mở channel để các bên khác gọi vào (HTTP API). Deployment target: Cloudflare.

## Constraints

- CF Workers KHÔNG chạy `better-sqlite3` (native module, no fs)
- Crawler `daily.dev` throttle 1 RPS → 50 articles ≈ 50s wall time
- 3 crawler packages (daily-dev full, hn/dev-to skeleton) phải còn dùng được
- Free tier Workers CPU 10ms KHÔNG đủ → cần **Workers Paid** ($5/mo)

## Decisions (chốt)

| Item | Choice | Alt rejected | Rationale |
|---|---|---|---|
| Deploy target | **CF Workers + D1** | Containers, Turso/libsql | Full edge stack, native CF tooling, lock-in chấp nhận được |
| Framework | **Hono + @hono/node-server-replaced-by-Workers-fetch** | Fastify, Express | Workers-native, type-safe |
| DB | **D1 (CF managed SQLite)** | better-sqlite3, R2 | Native CF binding, gần SQLite |
| Auth | **2 API keys (read + admin) qua env secret** | DB-backed key table | KISS v1 |
| Endpoints | GET /articles, /articles/:id, /sources, /health, POST /crawl, GET /crawl/:id | — | per user spec |
| /crawl mode | **Async — D1 jobs row + CF Queue + consumer** | Sync, Workflows, DO | KISS, persistent, restart-safe |
| Pagination | Offset/limit | Cursor | Repo pattern unchanged |
| Validation | `@hono/zod-validator` | manual | Type-safe |
| CLI strategy | **Refactor thành API client (HTTP fetch)** | Direct D1 access from CLI | Tránh duplicate query layer; CLI gọi `wrangler dev` local cho dev |
| Tests | `@cloudflare/vitest-pool-workers` (in-process Workers + D1) | supertest + real server | Official pattern |

## Architecture

```
packages/
├── core/             types + IArticleRepository interface + D1 impl (NO better-sqlite3)
├── daily-dev/        unchanged (uses fetch — Workers-compat)
├── hacker-news/      skeleton (unchanged)
├── dev-to/           skeleton (unchanged)
├── cli/              REFACTORED → API client (commander + fetch + poll)
└── api/              NEW — Hono on Workers
    ├── wrangler.toml         D1 binding, Queue binding, secrets
    ├── package.json
    └── src/
        ├── index.ts          Workers entry: { fetch, queue }
        ├── app.ts            Hono app
        ├── auth.ts           X-API-Key middleware (read | admin)
        ├── env.ts            CF env types + zod validation
        ├── repo.ts           wraps env.DB → D1ArticleRepository
        ├── crawler-registry.ts
        ├── routes/
        │   ├── articles.ts   GET /articles, GET /articles/:id
        │   ├── sources.ts    GET /sources
        │   ├── crawl.ts      POST /crawl (enqueue), GET /crawl/:id (status)
        │   └── health.ts     GET /health (no auth)
        ├── queue-consumer.ts pulls job → run crawler → update D1
        └── schemas.ts        zod query/body schemas
```

## Data model addition: `jobs` table

```sql
CREATE TABLE jobs (
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
```

## Endpoint contract

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/health` | — | — | `200 { status: 'ok' }` |
| GET | `/articles?source&tag&limit&offset&since` | read | — | `{ items, total, limit, offset }` |
| GET | `/articles/:id` | read | — | `Article + tags` or `404` |
| GET | `/sources` | read | — | `[{ source, count }]` |
| POST | `/crawl` | admin | `{ site, feed='popular', tag?, limit≤50 }` | `202 { jobId, status:'pending' }` |
| GET | `/crawl/:id` | admin | — | `{ id, status, inserted, updated, error?, ... }` |

Errors: `{ error: { code, message } }` + 4xx/5xx.

## Async POST /crawl flow

1. POST /crawl → validate body → INSERT INTO jobs (status='pending') → push `{jobId}` vào CF Queue → response 202 + jobId.
2. Queue consumer wakes up → SELECT job → UPDATE status='running' → instantiate crawler từ registry → for-await crawler.crawl() → upsert into articles via D1Repo → UPDATE jobs SET inserted, updated, status='done'.
3. On error → UPDATE status='failed' + error message.
4. Client polls GET /crawl/:id every ~2s.

`wrangler.toml` queue config:
```toml
[[queues.consumers]]
queue = "feedforge-crawl"
max_batch_size = 1
max_batch_timeout = 60
max_retries = 2
```

## Repository refactor (breaking)

- Extract `IArticleRepository` interface từ class hiện tại
- Implement `D1ArticleRepository` dùng `env.DB.prepare(...).bind(...).first/all/run/batch`
- Replace `@named` params bằng `?` positional
- Replace `findId+UPDATE/INSERT` branching bằng `INSERT ... ON CONFLICT DO UPDATE` (D1 supports it; reviewer cũng đã đề xuất)
- Use `db.batch([stmts])` cho upsertMany — D1 atomic batch
- Drop `better-sqlite3` + `@types/better-sqlite3` deps
- Migrations: convert `MIGRATIONS` array thành wrangler D1 migration files (`packages/api/migrations/0001_init.sql`, `0002_jobs.sql`)

Tests cho repo: dùng `vitest-pool-workers` để test thật trên local D1.

## CLI refactor

Before: `CLI → ArticleRepository → SQLite local`
After: `CLI → fetch → API server → D1`

```ts
// commands/crawl.ts (after)
const job = await api.post('/crawl', body);
console.log(`[${site}] job ${job.jobId} enqueued`);
while (true) {
  await sleep(2000);
  const j = await api.get(`/crawl/${job.jobId}`);
  if (j.status === 'done')   { console.log(`done: ${j.inserted} inserted, ${j.updated} updated`); break; }
  if (j.status === 'failed') { console.error(`failed: ${j.error}`); process.exit(2); }
  console.log(`  status=${j.status}`);
}
```

CLI cần env: `FEEDFORGE_API_URL` (default `http://localhost:8787`), `FEEDFORGE_API_KEY`.
Dev mode: `wrangler dev` → CLI trỏ `localhost:8787`.

## Security & secrets

- `wrangler secret put FEEDFORGE_READ_KEY`
- `wrangler secret put FEEDFORGE_ADMIN_KEY`
- `.env.example` cho local: `FEEDFORGE_READ_KEY=...`, `FEEDFORGE_ADMIN_KEY=...`, `FEEDFORGE_API_URL=...`
- `.gitignore` cover `.env`, `.dev.vars`

## Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Workers Free tier insufficient** (10ms CPU) | Cần Workers Paid plan ($5/mo). User confirm before deploy. |
| 2 | Queue consumer wall time **30-60s** | Cap `--limit` ≤ 50 (1 RPS × 50 = 50s). Larger crawls split thành multiple jobs. |
| 3 | Throttle state lost between Worker invocations | Per-job consumer instance OK (ephemeral). 1 job at a time (max_concurrency=1) tránh hammer API. |
| 4 | CLI mất offline mode | Document: cần wrangler dev local hoặc network |
| 5 | Migrate existing local `data/crawler.db` data sang D1 | Một lần dump SQL → wrangler d1 execute. Optional, current data có thể discard |
| 6 | D1 row limit + cost | D1 free tier 5GB / 5M rows / 5M reads-day. Đủ cho v1 |
| 7 | Skeletons (hn/dev-to) throw → job fails | Registry trả 501 Not Implemented thay vì 500 |

## Effort estimate

| Phase | Effort |
|---|---|
| 1. Refactor core repo → D1 interface + impl | ~2h |
| 2. Wrangler setup + D1 schema migrations | ~1h |
| 3. Hono Workers app + auth middleware + routes | ~2h |
| 4. Queue producer (POST /crawl) + consumer | ~1.5h |
| 5. CLI refactor as API client | ~1h |
| 6. Tests (vitest-pool-workers) | ~1.5h |
| 7. README + .env.example + wrangler docs | ~0.5h |
| **Total** | **~9-10h** |

## Success metrics

- ✅ `wrangler dev` chạy được, GET /health → 200
- ✅ POST /crawl với valid admin key → 202 + jobId
- ✅ GET /crawl/:id eventually → status='done' với inserted+updated > 0
- ✅ GET /articles trả ≥1 row sau crawl xong
- ✅ Tests vitest-pool-workers pass: 100% pass, coverage > existing
- ✅ CLI flow `pnpm cli crawl daily-dev --limit 5` end-to-end qua HTTP

## Next steps

1. Invoke `/ck:plan` để phá thành phase files chi tiết
2. Implementation theo phase order ở Effort table
3. Deploy lên Workers Paid (sau khi user setup CF account + D1 + Queue)

## Unresolved questions

1. **Migrate data local → D1?** Hay chấp nhận discard data hiện có? (1 lần, không phải concern dài hạn)
2. **CI/CD trên CF**: tự deploy `wrangler deploy` lúc local, hay GitHub Actions? (out of scope v1)
3. **Rate limiting cho external clients**: skip v1, add khi cần?
4. **Observability**: dùng CF Workers Logs + Analytics Engine? Hay external (Sentry/Axiom)? (out of scope v1)
5. **CLI version compat**: nếu API thay schema, CLI cần handle. Versioned API path `/v1/...`? (đề xuất YES từ đầu)

---

## REVISION 2026-04-26 11:51 — drop Cloudflare

User không muốn trả phí Workers Paid → bỏ CF stack hoàn toàn. Sections trên giữ làm tham khảo lịch sử.

### Quyết định mới

- **Runtime:** Node + Hono qua `@hono/node-server` (không Workers)
- **DB:** Giữ nguyên `better-sqlite3` + local SQLite — **KHÔNG refactor `@crawler/core`**
- **Async POST /crawl:** **DB jobs table (better-sqlite3)** + `setImmediate` worker trong cùng process. Persistent qua restart, KISS.
- **Deploy:** chưa quyết, plan focus **local-first**. Free options sau: CF Tunnel + local, Fly.io, Oracle Cloud Always Free.

### Tác động lên plan

- ❌ HỦY: Phase 1 (D1 refactor), Phase 2 (wrangler/D1)
- ✅ GIỮ NGUYÊN architecture: Hono + auth + 6 endpoints + zod validation + CLI as API client + tests
- 🔄 ĐỔI: Async exec via in-process worker thay vì CF Queue
- 🔄 GIẢM scope: 7 phases → **6 phases**, ~9-10h → **~5-6h**

### Architecture mới

```
packages/
├── core/             unchanged — Repository giữ better-sqlite3 (no breaking)
├── daily-dev/        unchanged
├── hacker-news/      skeleton
├── dev-to/           skeleton
├── cli/              REFACTORED → API client (HTTP fetch + poll)
└── api/              NEW — Hono on Node + setImmediate worker
    └── src/
        ├── index.ts          @hono/node-server bootstrap
        ├── app.ts            Hono app
        ├── auth.ts           X-API-Key middleware
        ├── env.ts            zod env validation
        ├── repo.ts           opens DB once, ArticleRepository singleton
        ├── jobs-repo.ts      jobs CRUD (own table)
        ├── crawler-registry.ts
        ├── job-worker.ts     setImmediate consumer for pending jobs
        ├── routes/
        │   ├── articles.ts
        │   ├── sources.ts
        │   ├── crawl.ts      POST creates job + queue, GET reads
        │   └── health.ts
        └── schemas.ts
```

### Repo extensions (additive, no breaking)

`@crawler/core/repository.ts` thêm:
- `findById(id)` — cho GET /articles/:id
- `listAcrossSources({source?, tag?, limit, offset, since?})` — query mở rộng
- `listSources()` — group by source + COUNT

Migration v2: thêm `jobs` table.

### Deploy options (sau khi code xong, free)

| Host | Khi nào chọn |
|---|---|
| Local + `cloudflared tunnel` | Cần public URL miễn phí, máy local up |
| Fly.io free | Cần 24/7 không phụ thuộc máy local |
| Oracle Cloud Always Free | Cần lâu dài, resources nhiều nhất |
| Just local | Team gọi qua LAN/VPN |

Plan-level chỉ dừng ở local dev — deploy quyết sau.
