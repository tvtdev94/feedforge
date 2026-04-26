---
phase: 6
name: README + .env.example + dev script
priority: medium
status: pending
estimatedHours: 0.25
blockedBy: [phase-05]
---

# Phase 6: Docs, env example, root scripts

## Context

- Phases 1-5 implement xong + tests xanh.
- Cần document API server cho user mới + chỉ dẫn chạy local + setup env.

## Overview

Update README với section "API server" mô tả endpoints, auth, env. Add `.env.example` ở root và `packages/api/`. Update root `package.json` với scripts tiện dụng.

## Requirements

- README mới có section `## API server` với endpoint table + curl examples
- `.env.example` ở `packages/api/` đã tạo Phase 2; thêm `.env.example` root cho CLI
- Root scripts: `api:dev`, `api:start`
- Document deploy options briefly (free tier roundup)
- Update test count claim trong README (sau Phase 5)

## Related code files

**Modify:**
- `README.md` (root)
- Root `package.json` — add scripts

**Create:**
- `.env.example` (root) — for CLI client config

## Implementation steps

1. Update `README.md`:
   - Add section `## API server` sau `## CLI reference`:
     ```markdown
     ## API server

     `@crawler/api` exposes a Hono HTTP server reading from the same SQLite DB.
     Use this when you want other apps/scripts to call into feedforge data.

     ### Quick start

     ```bash
     cp packages/api/.env.example packages/api/.env
     # edit packages/api/.env to set strong keys
     pnpm api:dev   # boots on port 3000 by default
     ```

     ### Endpoints

     | Method | Path | Auth | Description |
     |---|---|---|---|
     | GET | /health | — | Liveness check |
     | GET | /articles | read | List articles, filter by source/tag/since, pagination |
     | GET | /articles/:id | read | Single article + tags |
     | GET | /sources | read | Sources + counts |
     | POST | /crawl | admin | Enqueue async crawl, returns 202 + jobId |
     | GET | /crawl/:id | admin | Job status (pending/running/done/failed) |

     Auth via `X-API-Key` header. Admin key works on all endpoints; read key only on GET reads.

     ### Async POST /crawl

     1. POST creates a job row, returns `{ jobId, status: 'pending' }` immediately.
     2. An in-process worker (setImmediate) picks it up, runs the crawler, upserts articles.
     3. Poll `GET /crawl/:id` until `status` is `done` or `failed`.

     Job state persists in SQLite (`jobs` table) — restarts recover gracefully (running jobs marked failed).

     Limit cap: `--limit ≤ 50` per job to keep wall time bounded.

     ### CLI as API client

     The CLI in `packages/cli` is now a thin client of the API:
     ```bash
     export FEEDFORGE_API_URL=http://localhost:3000
     export FEEDFORGE_API_KEY=<admin-key>
     pnpm cli crawl daily-dev --limit 5    # POST /crawl + poll until done
     pnpm cli list --source daily-dev      # GET /articles
     ```

     ### Deploy options (free)

     | Host | Notes |
     |---|---|
     | Local + `cloudflared tunnel` | Free public URL, server on local machine |
     | Fly.io free tier | 3 shared VMs + persistent volume for SQLite |
     | Oracle Cloud Always Free | 2 ARM VMs always free, generous resources |
     | Just LAN | Skip public exposure |
     ```
   - Update test count to reflect new totals (likely ~32+).
   - Update `Architecture` mermaid: add `API[Hono on Node]` node + arrows from API → Core → DB và API → Crawlers (qua registry).

2. `packages/api/.env.example` (đã tạo Phase 2; verify):
   ```
   PORT=3000
   FEEDFORGE_READ_KEY=change-me-read
   FEEDFORGE_ADMIN_KEY=change-me-admin
   # CRAWLER_DB=/abs/path/to/db
   ```

3. Root `.env.example`:
   ```
   # CLI client config (when running pnpm cli against API)
   FEEDFORGE_API_URL=http://localhost:3000
   FEEDFORGE_API_KEY=change-me-admin
   ```

4. Root `package.json` scripts:
   ```json
   "scripts": {
     "build": "pnpm -r build",
     "typecheck": "pnpm -r exec tsc --noEmit",
     "test": "pnpm -r test",
     "cli": "pnpm --filter @crawler/cli exec tsx src/index.ts",
     "api:dev": "pnpm --filter @crawler/api dev",
     "api:start": "pnpm --filter @crawler/api start"
   }
   ```

5. Final end-to-end smoke (manual):
   ```bash
   pnpm install
   pnpm typecheck
   pnpm test
   # terminal A
   FEEDFORGE_READ_KEY=foo FEEDFORGE_ADMIN_KEY=bar pnpm api:dev
   # terminal B
   FEEDFORGE_API_KEY=bar pnpm cli crawl daily-dev --limit 3
   FEEDFORGE_API_KEY=foo pnpm cli list --source daily-dev --limit 3
   ```

6. Optional: regenerate hero image (Phase 6 of original session đã làm) — skip nếu không cần.

## Todo list

- [ ] README new `## API server` section
- [ ] README architecture mermaid updated với API node
- [ ] README test count refreshed
- [ ] Root `.env.example` created
- [ ] Root `package.json` scripts
- [ ] Final manual smoke test passes
- [ ] Commit + push

## Success criteria

- New developer reading README có thể run `pnpm api:dev` + `pnpm cli` trong < 2 phút setup
- All test counts factual
- Deploy options visible cho future reader

## Risks

| Risk | Mitigation |
|---|---|
| README quá dài | Keep API section concise (~40 dòng); link vào phase docs nếu cần chi tiết hơn |
| `.env.example` confuse với production secrets | Naming `change-me-*` rõ là placeholder |

## Next steps

→ Plan complete. Run `/ck:journal` to log, optionally commit + push.
