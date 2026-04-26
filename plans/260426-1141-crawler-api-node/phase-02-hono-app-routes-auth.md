---
phase: 2
name: Bootstrap @crawler/api + Hono app + auth + read routes
priority: critical
status: pending
estimatedHours: 1.5
blockedBy: [phase-01]
---

# Phase 2: `packages/api/` skeleton, auth, GET routes

## Context

- Phase 1 produced: `findById`, `listAcrossSources`, `listSources`, jobs migration
- Brainstorm REVISION confirms Hono + Node + 2 env keys

## Overview

Tạo package mới `@crawler/api` chạy Hono trên Node. Singleton DB + `ArticleRepository`. Middleware xác thực `X-API-Key` (read | admin role). Implement 3 GET routes (articles, sources, health).

POST /crawl tạm trả 501 — Phase 3 implement đầy đủ.

## Requirements

- `packages/api/` package skeleton (TS, ESM, vitest)
- `@hono/node-server` chạy port 3000 (cấu hình qua `PORT` env)
- 2 env keys: `FEEDFORGE_READ_KEY`, `FEEDFORGE_ADMIN_KEY` (fail-fast nếu thiếu)
- Auth middleware đặt `c.var.role = 'read' | 'admin'`
- `/health` không auth
- `/articles`, `/articles/:id`, `/sources` cần `read` (admin cũng OK)
- Zod validation qua `@hono/zod-validator`
- DB path lấy từ `CRAWLER_DB` hoặc default `<repo>/data/crawler.db` (reuse `db-path.ts` logic của CLI)
- Graceful shutdown (`process.on('SIGINT', closeDb)`)

## Architecture

```
packages/api/
├── package.json
├── tsconfig.json
├── .env.example
└── src/
    ├── index.ts                  bootstrap @hono/node-server
    ├── app.ts                    create Hono, mount routes, error handler
    ├── env.ts                    load + zod-validate process.env
    ├── auth.ts                   X-API-Key middleware + requireRole helper
    ├── repo.ts                   open DB once, export ArticleRepository singleton
    ├── db-path.ts                resolve DB path (copy/share from cli)
    ├── schemas.ts                zod schemas for query/path/body
    └── routes/
        ├── articles.ts           GET /articles, GET /articles/:id
        ├── sources.ts            GET /sources
        ├── health.ts             GET /health
        └── crawl.ts              POST /crawl (501 stub), GET /crawl/:id (501 stub)
```

`db-path.ts`: copy implementation từ `packages/cli/src/db-path.ts` (8 dòng — duplicate KISS). Will share later if 3rd consumer appears.

## Related code files

**Create (all in `packages/api/`):**
- `package.json`, `tsconfig.json`, `.env.example`
- `src/index.ts`, `src/app.ts`, `src/env.ts`, `src/auth.ts`, `src/repo.ts`, `src/db-path.ts`, `src/schemas.ts`
- `src/routes/{articles,sources,health,crawl}.ts`

**Modify:**
- Root `package.json` — add script `"api:dev": "pnpm --filter @crawler/api dev"`
- `pnpm-workspace.yaml` — đã cover `packages/*`, no change

## Implementation steps

1. Create skeleton, deps:
   ```bash
   mkdir -p packages/api/src/routes
   ```
   `packages/api/package.json`:
   ```json
   {
     "name": "@crawler/api",
     "version": "0.1.0",
     "private": true,
     "type": "module",
     "main": "./src/index.ts",
     "scripts": {
       "dev": "tsx watch src/index.ts",
       "start": "node --import tsx src/index.ts",
       "build": "tsc -p tsconfig.json",
       "typecheck": "tsc --noEmit",
       "test": "vitest run"
     },
     "dependencies": {
       "@crawler/core": "workspace:*",
       "@crawler/daily-dev": "workspace:*",
       "@crawler/dev-to": "workspace:*",
       "@crawler/hacker-news": "workspace:*",
       "hono": "^4.7.0",
       "@hono/node-server": "^1.13.0",
       "@hono/zod-validator": "^0.4.0",
       "zod": "^4.3.6",
       "nanoid": "^5.1.9"
     },
     "devDependencies": {
       "vitest": "^4.1.5",
       "tsx": "^4.16.0"
     }
   }
   ```

2. `tsconfig.json` extend root, set `outDir: "dist"`, `rootDir: "src"`.

3. `src/env.ts`:
   ```ts
   import { z } from 'zod';
   const Env = z.object({
     PORT: z.coerce.number().int().positive().default(3000),
     FEEDFORGE_READ_KEY: z.string().min(1),
     FEEDFORGE_ADMIN_KEY: z.string().min(1),
     CRAWLER_DB: z.string().optional(),
   });
   export const env = Env.parse(process.env);  // throws on bootstrap if invalid
   ```

4. `src/db-path.ts`: copy from `packages/cli/src/db-path.ts`.

5. `src/repo.ts`:
   ```ts
   import { ArticleRepository, openDb } from '@crawler/core';
   import { resolveDbPath } from './db-path.js';
   import { env } from './env.js';

   const dbPath = resolveDbPath(env.CRAWLER_DB);
   export const db = openDb(dbPath);
   export const articles = new ArticleRepository(db);
   process.on('SIGINT', () => { db.close(); process.exit(0); });
   process.on('SIGTERM', () => { db.close(); process.exit(0); });
   ```

6. `src/auth.ts`:
   ```ts
   import { createMiddleware } from 'hono/factory';
   import { env } from './env.js';

   export type Role = 'read' | 'admin';
   declare module 'hono' { interface ContextVariableMap { role: Role; } }

   export const apiKeyAuth = createMiddleware(async (c, next) => {
     const key = c.req.header('X-API-Key');
     const role: Role | null =
       key === env.FEEDFORGE_ADMIN_KEY ? 'admin' :
       key === env.FEEDFORGE_READ_KEY  ? 'read'  : null;
     if (!role) return c.json({ error: { code: 'unauthorized', message: 'invalid or missing X-API-Key' } }, 401);
     c.set('role', role);
     await next();
   });

   export const requireAdmin = createMiddleware(async (c, next) => {
     if (c.get('role') !== 'admin') {
       return c.json({ error: { code: 'forbidden', message: 'admin role required' } }, 403);
     }
     await next();
   });
   ```

7. `src/schemas.ts`:
   ```ts
   import { z } from 'zod';
   export const ListQuery = z.object({
     source: z.string().optional(),
     tag: z.string().optional(),
     limit: z.coerce.number().int().min(1).max(100).default(20),
     offset: z.coerce.number().int().min(0).default(0),
     since: z.string().datetime().optional(),
   });
   export const IdParam = z.object({ id: z.string().min(1) });
   ```

8. `src/routes/articles.ts`:
   - `GET /` — validate `ListQuery`, call `articles.listAcrossSources(opts)`, build `{ items, total, limit, offset }`
   - `GET /:id` — validate `IdParam`, `articles.findById(id)`, 404 if not found, attach `tags = articles.tagsOf(id)`

9. `src/routes/sources.ts`:
   - `GET /` — `articles.listSources()` returns `[{ source, count }]`

10. `src/routes/health.ts`:
    - `GET /` — `{ status: 'ok', uptimeSec: process.uptime() }`

11. `src/routes/crawl.ts`:
    - `POST /` — return 501 with `{ error: { code: 'not_implemented', message: 'phase 3' } }`
    - `GET /:id` — same 501 stub

12. `src/app.ts`:
    ```ts
    import { Hono } from 'hono';
    import { apiKeyAuth, requireAdmin } from './auth.js';
    import healthRoute from './routes/health.js';
    import articlesRoute from './routes/articles.js';
    import sourcesRoute from './routes/sources.js';
    import crawlRoute from './routes/crawl.js';

    export const app = new Hono();
    app.route('/health', healthRoute);             // public
    app.use('/articles/*', apiKeyAuth);
    app.use('/sources/*', apiKeyAuth);
    app.use('/crawl/*', apiKeyAuth, requireAdmin);
    app.route('/articles', articlesRoute);
    app.route('/sources', sourcesRoute);
    app.route('/crawl', crawlRoute);

    app.onError((err, c) => {
      console.error(err);
      return c.json({ error: { code: 'internal', message: err.message } }, 500);
    });
    ```

13. `src/index.ts`:
    ```ts
    import { serve } from '@hono/node-server';
    import { app } from './app.js';
    import { env } from './env.js';
    serve({ fetch: app.fetch, port: env.PORT }, (info) => {
      console.log(`feedforge api listening on :${info.port}`);
    });
    ```

14. `.env.example`:
    ```
    PORT=3000
    FEEDFORGE_READ_KEY=change-me-read
    FEEDFORGE_ADMIN_KEY=change-me-admin
    # CRAWLER_DB=/abs/path/to/db
    ```

15. `pnpm install` → `pnpm --filter @crawler/api dev` → manual smoke:
    ```bash
    curl localhost:3000/health
    curl localhost:3000/articles -H "X-API-Key: change-me-read"
    curl localhost:3000/sources -H "X-API-Key: change-me-read"
    curl -X POST localhost:3000/crawl -H "X-API-Key: change-me-admin"   # 501 stub
    ```

## Todo list

- [ ] Bootstrap `packages/api/` skeleton + deps
- [ ] `env.ts` zod-validate startup
- [ ] `repo.ts` singleton DB + graceful shutdown
- [ ] `auth.ts` middleware + role helper
- [ ] `schemas.ts` query/path validation
- [ ] Routes: `articles`, `sources`, `health`, `crawl` (stub)
- [ ] `app.ts` mount + error handler
- [ ] `index.ts` bootstrap
- [ ] `.env.example`
- [ ] Manual smoke OK
- [ ] `pnpm typecheck` xanh

## Success criteria

- `pnpm --filter @crawler/api dev` boots successfully
- All 6 endpoints respond correctly (crawl returns 501)
- Auth works: missing key → 401; wrong key → 401; read key on admin route → 403
- Existing tests vẫn xanh

## Risks

| Risk | Mitigation |
|---|---|
| Cross-package imports type ko resolve | Workspace deps + tsconfig paths đã thiết lập |
| `process.env` không load `.env` file tự động | Document `dotenv -e .env -- pnpm dev` hoặc thêm `dotenv` import; KISS prefer document |
| Hono version mới breaking | Pin `hono@^4.7` |

## Next steps

→ Phase 3: jobs-repo + setImmediate worker + implement đầy đủ POST/GET /crawl.
