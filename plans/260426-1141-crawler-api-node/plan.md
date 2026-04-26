---
name: feedforge HTTP API on Node + Hono
slug: crawler-api-node
created: 2026-04-26
status: pending
mode: fast
priority: high
estimatedHours: 5-6
blockedBy: []
blocks: []
---

# Plan: feedforge HTTP API on Node + Hono

Add `@crawler/api` package: Hono trên Node, expose articles ra qua HTTP API. Async POST /crawl qua DB jobs table + in-process `setImmediate` worker. Refactor CLI thành API client.

**Brainstorm:** [reports/brainstorm-260426-1141-crawler-api-cloudflare.md](../reports/brainstorm-260426-1141-crawler-api-cloudflare.md) — đọc section **REVISION 2026-04-26 11:51** cho final design (CF rejected).

## Decisions (locked)

- **Stack:** Hono + `@hono/node-server` + `@hono/zod-validator`
- **DB:** Giữ `better-sqlite3` + local SQLite — KHÔNG refactor core
- **Async POST /crawl:** jobs table + `setImmediate` worker (in-process, persistent)
- **Auth:** 2 env keys (read + admin) qua `.env`
- **Tests:** vitest + Hono `app.fetch()` (in-process, no real server spin-up)
- **Deploy:** local-first; deploy target chưa chốt (free options sau)

## Phases

| # | Phase | File | Effort | Depends |
|---|---|---|---|---|
| 1 | Extend core repo + jobs migration | [phase-01-extend-core-repo-jobs.md](./phase-01-extend-core-repo-jobs.md) | 1h | — |
| 2 | Bootstrap `packages/api` + Hono app + auth + read routes | [phase-02-hono-app-routes-auth.md](./phase-02-hono-app-routes-auth.md) | 1.5h | 1 |
| 3 | POST /crawl + jobs-repo + setImmediate worker | [phase-03-jobs-worker-crawl-endpoint.md](./phase-03-jobs-worker-crawl-endpoint.md) | 1.5h | 2 |
| 4 | CLI refactor as API client | [phase-04-cli-api-client-refactor.md](./phase-04-cli-api-client-refactor.md) | 0.75h | 3 |
| 5 | Tests (vitest + app.fetch) | [phase-05-tests-vitest-app-fetch.md](./phase-05-tests-vitest-app-fetch.md) | 1h | 4 |
| 6 | README + .env.example + dev script | [phase-06-docs-env.md](./phase-06-docs-env.md) | 0.25h | 5 |

## Critical paths

1 → 2 → 3 → 4 → 5 → 6 (linear)

## Success criteria

- `pnpm --filter @crawler/api dev` boots Hono on port 3000
- `GET /health` → 200; auth-gated routes 401 without key
- `POST /crawl` admin → 202 + jobId; worker tick → eventually `done`; `GET /articles` returns rows
- `pnpm cli crawl daily-dev --limit 5` end-to-end qua HTTP works
- Tests xanh; existing 22 tests vẫn pass; thêm ~10 cho api
