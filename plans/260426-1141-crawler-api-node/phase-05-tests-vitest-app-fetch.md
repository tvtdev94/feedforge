---
phase: 5
name: Tests via vitest + app.fetch()
priority: high
status: pending
estimatedHours: 1
blockedBy: [phase-04]
---

# Phase 5: Integration tests cho `@crawler/api`

## Context

- Phases 1-4 implement đầy đủ. Giờ verify behavior với automated tests.
- Hono pattern: test in-process bằng `app.fetch(new Request(...))` — không cần spin up real server. Nhanh, deterministic.

## Overview

Tests cover:
- Auth: missing/invalid key, role boundary (read vs admin)
- Read endpoints: `/health`, `/articles` (filter, pagination), `/articles/:id`, `/sources`
- POST /crawl: validation errors, job creation, GET /crawl/:id status transitions
- Worker behavior: integration test với fake crawler injected vào registry

DB: dùng `:memory:` qua `openDb(':memory:')` cho test isolation. Mỗi test reset state.

Crawler real (daily.dev) KHÔNG hit trong test — inject fake crawler trả static articles.

## Requirements

- Test setup: build app từ scratch với in-memory DB + injected fake crawler registry
- ≥ 12 test cases:
  - 2 auth: missing key 401, wrong role 403
  - 4 read: health 200, /articles list+filter+pagination, /articles/:id 404 + 200, /sources count
  - 4 crawl: validation 400, POST 202+jobId, GET 404, end-to-end happy path (fake crawler → done)
  - 2 worker: failed job (fake crawler throws) marked `failed`, recoverStuck on boot
- All test deterministic, no network calls
- Run trong < 5s

## Architecture

Need to make `app.ts` factory-friendly: instead of importing singletons from `repo.ts`, accept dependencies for testability.

```ts
// app.ts (refactor)
export function buildApp(deps: { articles: ArticleRepository; jobs: JobsRepository; worker: JobWorker }): Hono {
  // mount routes using deps
}
// repo.ts (production wiring)
export const app = buildApp({ articles, jobs, worker });
```

Tests inject fake crawler vào registry — best approach: make registry a passable dep too (constructor-style), OR allow registry override via parameter on `JobWorker`.

KISS option: `JobWorker` constructor accepts `getCrawler` function. Production: `getCrawler` from `crawler-registry.ts`. Test: `getCrawler = (name) => fakeCrawler`.

## Related code files

**Modify (refactor for testability):**
- `packages/api/src/app.ts` — export `buildApp(deps)` factory
- `packages/api/src/job-worker.ts` — accept `getCrawler` in constructor
- `packages/api/src/repo.ts` — keep singletons, call `buildApp` to produce `app`
- `packages/api/src/index.ts` — import `app` from `repo.ts`

**Create:**
- `packages/api/src/__tests__/auth.test.ts`
- `packages/api/src/__tests__/articles.test.ts`
- `packages/api/src/__tests__/crawl.test.ts`
- `packages/api/src/__tests__/worker.test.ts`
- `packages/api/src/__tests__/test-helpers.ts` — `buildTestApp()`, `fakeCrawler()`, fixtures

## Implementation steps

1. Refactor `app.ts` thành factory function (DI):
   ```ts
   export function buildApp(deps: AppDeps): Hono {
     const app = new Hono();
     app.route('/health', healthRoute);
     app.use('/articles/*', apiKeyAuth);
     app.route('/articles', articlesRoute(deps));
     app.use('/sources/*', apiKeyAuth);
     app.route('/sources', sourcesRoute(deps));
     app.use('/crawl/*', apiKeyAuth, requireAdmin);
     app.route('/crawl', crawlRoute(deps));
     return app;
   }
   ```
   Routes export factory functions: `articlesRoute(deps): Hono`.

2. `JobWorker` accept `getCrawler` in constructor:
   ```ts
   constructor(
     private readonly jobs: JobsRepository,
     private readonly articles: ArticleRepository,
     private readonly getCrawler: (name: string) => Crawler,
   ) {}
   ```

3. `test-helpers.ts`:
   ```ts
   import { openDb, ArticleRepository } from '@crawler/core';
   import { JobsRepository } from '../jobs-repo.js';
   import { JobWorker } from '../job-worker.js';
   import { buildApp } from '../app.js';

   export function buildTestApp(opts: { fakeCrawler?: Crawler } = {}) {
     const db = openDb(':memory:');
     const articles = new ArticleRepository(db);
     const jobs = new JobsRepository(db);
     const getCrawler = () => opts.fakeCrawler ?? throwCrawler();
     const worker = new JobWorker(jobs, articles, getCrawler);
     const app = buildApp({ articles, jobs, worker });
     return { app, db, articles, jobs, worker };
   }

   export function fakeCrawler(items: Article[]): Crawler {
     return {
       name: 'fake',
       async *crawl() { for (const a of items) yield a; },
     };
   }

   export function throwingCrawler(message = 'fake fail'): Crawler {
     return {
       name: 'fake',
       async *crawl() { throw new Error(message); yield {} as never; },
     };
   }

   export const TEST_KEYS = { read: 'r-key', admin: 'a-key' };
   // Set process.env.FEEDFORGE_READ_KEY etc trong vitest setup
   ```

4. Vitest setup file `packages/api/vitest.setup.ts`:
   ```ts
   process.env.FEEDFORGE_READ_KEY = 'r-key';
   process.env.FEEDFORGE_ADMIN_KEY = 'a-key';
   process.env.CRAWLER_DB = ':memory:';
   ```
   Reference từ `vitest.config.ts`.

5. `__tests__/auth.test.ts`:
   ```ts
   it('returns 401 without X-API-Key', async () => {
     const { app } = buildTestApp();
     const res = await app.fetch(new Request('http://localhost/articles'));
     expect(res.status).toBe(401);
   });
   it('returns 403 when read key calls admin route', async () => {
     const { app } = buildTestApp();
     const res = await app.fetch(new Request('http://localhost/crawl', {
       method: 'POST', headers: { 'X-API-Key': 'r-key', 'content-type': 'application/json' },
       body: JSON.stringify({ site: 'fake', limit: 1 }),
     }));
     expect(res.status).toBe(403);
   });
   ```

6. `__tests__/articles.test.ts`:
   - GET /articles empty list initially
   - Insert via `articles.upsert()`, GET /articles returns row
   - Filter by source, tag, since
   - Pagination limit/offset

7. `__tests__/crawl.test.ts`:
   - POST validation error: missing site → 400
   - POST happy → 202 + jobId
   - GET /crawl/:id pending → polling state
   - Run end-to-end: fakeCrawler with 3 items → trigger worker → wait → expect status='done', inserted=3

8. `__tests__/worker.test.ts`:
   - Worker with throwingCrawler → job marked failed với error message
   - Mark a job 'running' manually, run `recoverStuck()` → status flips to 'failed'

9. `pnpm --filter @crawler/api test` — phải xanh.

## Code snippets (key test pattern)

```ts
// crawl.test.ts — end-to-end async
it('processes job through worker and reaches done status', async () => {
  const items: Article[] = [makeArticle(), makeArticle({ externalId: 'x2' })];
  const { app, jobs, worker } = buildTestApp({ fakeCrawler: fakeCrawler(items) });

  const post = await app.fetch(new Request('http://localhost/crawl', {
    method: 'POST',
    headers: { 'X-API-Key': 'a-key', 'content-type': 'application/json' },
    body: JSON.stringify({ site: 'daily-dev', limit: 5 }),
  }));
  expect(post.status).toBe(202);
  const { jobId } = await post.json();

  // setImmediate callback fires asynchronously — flush
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  const get = await app.fetch(new Request(`http://localhost/crawl/${jobId}`, {
    headers: { 'X-API-Key': 'a-key' },
  }));
  const job = await get.json();
  expect(job.status).toBe('done');
  expect(job.inserted).toBe(2);
});
```

## Todo list

- [ ] Refactor `app.ts` thành `buildApp(deps)` factory
- [ ] Refactor route files thành factory functions
- [ ] `JobWorker` accept `getCrawler` injected
- [ ] `test-helpers.ts`: buildTestApp, fakeCrawler, throwingCrawler
- [ ] `vitest.setup.ts` set test env vars
- [ ] Tests: auth (2), articles (4+), crawl (4), worker (2)
- [ ] All tests pass — `pnpm --filter @crawler/api test`
- [ ] `pnpm test` overall xanh (no regressions)

## Success criteria

- ≥ 12 tests pass deterministically
- Total runtime < 5s
- No real network calls
- Existing tests (core, daily-dev, cli) vẫn xanh

## Risks

| Risk | Mitigation |
|---|---|
| `setImmediate` async timing flaky | Use `await new Promise(r => setImmediate(r))` to flush; wrap polling helper if cần |
| Refactor `app.ts` breaks Phase 4 CLI smoke | Phase 4 tests qua `pnpm cli` end-to-end vẫn pass nếu factory wiring đúng |
| Singleton state leak giữa tests | Each test calls `buildTestApp()` — fresh DB |
| Vitest env injection vs Zod env validation | `vitest.setup.ts` set vars BEFORE module load; verify import order |

## Next steps

→ Phase 6: README updates + .env.example + dev script + final smoke verification.
