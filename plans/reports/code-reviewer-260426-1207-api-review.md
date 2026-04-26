# Code Review: `@crawler/api` (Hono + better-sqlite3)

Reviewer: code-reviewer (adversarial pass)
Date: 2026-04-26
Scope: `packages/api/src/**/*.ts`, package.json, tsconfig.json (~700 LOC)
Plan: `plans/260426-1141-crawler-api-node/plan.md`

## Summary
Solid first cut. Architecture clean (DI factory, singleton repo bundle, in-process worker). 22 tests cover happy + key sad paths. No SQL injection (all bound params). No stack-trace leaks (custom onError). Found 4 critical, 7 important, several nits. Most criticals stem from concurrency assumptions that hold for single-node local-first but break the moment a 2nd process touches the DB or a job spans process restart in a non-trivial way.

---

## Critical

1. **`job-worker.ts:37-49` — TOCTOU race between `nextPending()` SELECT and `markRunning()` UPDATE in tick loop.** Mutex flag (`this.processing`) only prevents *intra-process* concurrency. If a 2nd process (e.g. `tsx watch` reload during dev, or accidental double-launch) opens the same DB, both `nextPending()` calls return the same row, both `markRunning` succeed sequentially (the WHERE `status='pending'` guard fails on the 2nd, but only AFTER the first commits — and the loop already swallowed the row reference). Worse, even single-process: a stale `job` reference held across `await this.runJob(job.id)` is fine here because we re-read inside `runJob`, but the loop never checks if `markRunning` actually changed a row. **Fix:** in `runJob`, capture `markRunning`'s `result.changes`; if 0 (someone else claimed it), `return` early without overwriting status. Atomic claim: `UPDATE ... RETURNING *` (SQLite 3.35+) or wrap select+update in `db.transaction(IMMEDIATE)`.

2. **`auth.ts:13-16` — Plain `===` API-key comparison is timing-attack vulnerable.** Trivial in practice for short-lived local-first deploy, but the keys are also Zod-validated `min(1)` only so an attacker who gets MITM on the LAN can probe. **Fix:** use `crypto.timingSafeEqual(Buffer.from(key), Buffer.from(env.X))` with length-pre-check to avoid throwing on mismatched lengths. Also: header is read via `c.req.header('X-API-Key')` — Hono lowercases, so case-insensitive match works, but document that the env keys themselves are compared verbatim (no normalization).

3. **`index.ts:23-29` — Shutdown can hang forever and `db.close()` is never called on `server.close` callback failure.** `server.close()` waits for in-flight requests to drain — if a long-running `/crawl` worker tick is mid `await crawler.crawl()`, the HTTP server has no reference to it and closes fast, but the worker keeps running on `db` AFTER `db.close()` fires inside the callback. Result: worker writes to a closed DB → throws → job stuck in 'running' (recovered next boot, but data loss possible mid-write). **Fix:** before `db.close()`, await worker idle: e.g. add `await worker.waitIdle()` (poll `processing` flag with 50ms tick + 30s ceiling, then force). Also add `process.exitCode` + timeout fallback if `server.close` callback never fires.

4. **`job-worker.ts:51-74` — Partial-progress data inconsistency on crawler exception mid-iteration.** If crawler yields 5 articles successfully then throws on the 6th, articles 1-5 are persisted (each `articles.upsert` is its own tx) but the job is marked `failed` with `inserted=0, updated=0` — counters are local vars never persisted on error. Operator/dashboard cannot tell partial success from total failure → may re-run same job, double-counting "inserted" the 2nd time (now they're updates). **Fix:** in catch branch, call a new `markFailedWithProgress(id, error, inserted, updated)` that persists counters. Phase plan also missed this.

---

## Important

5. **`jobs-repo.ts:99-103` `recoverStuck` race vs already-running worker on boot.** `index.ts:15-17` calls `recoverStuck()` BEFORE `worker.scheduleNext()`, so currently safe — but the comment in `jobs-repo.ts:56` (`Sweep on boot`) doesn't enforce that ordering. If a future refactor moves `scheduleNext()` above `recoverStuck()`, a job marked `running` by the worker in the same process gets clobbered to `failed`. **Fix:** add assert or make `recoverStuck` filter by `started_at < <process_start_time>`; or document the ordering invariant in `jobs-repo.ts`.

6. **`jobs-repo.ts:80,84` — `as JobRow` casts are unchecked schema drift bombs.** If migration adds a column or rename happens, TS still compiles. `getById` returning `JobRow | undefined` while DB might return a row with extra/missing fields is silent. **Fix:** add a runtime guard in `getById` (zod parse the row once on read; cache the parser) OR a single integration test that creates a job, asserts every `JobRow` field is non-null per spec. Same applies to `nextPending`.

7. **`schemas.ts:13-23` — `tag: z.string().optional()` allows empty string `""` when feed=popular.** The `.refine` only enforces non-empty when `feed=='search'`. An empty-string tag for `popular` is meaningless but accepted, then stored as `""` in `jobs.tag` (vs `null` from `body.tag ?? null` in `crawl.ts:21` — wait, `?? null` only catches `undefined`, NOT `""`). Result: DB has mixed `null` and `""` tags. **Fix:** `z.string().min(1).optional()` for tag, or `.transform(v => v === '' ? undefined : v)`.

8. **`schemas.ts:8` — `since: z.string().datetime()` rejects valid ISO 8601 forms.** Zod's `.datetime()` is strict (requires `Z` or `±HH:MM`, no `+0700`, no date-only). Users sending `?since=2026-04-25` get 400. Combined with `repository.ts:198-200` doing `>= ?` against `COALESCE(published_at, crawled_at)` which is full ISO timestamps — partial dates wouldn't compare correctly anyway, BUT the failure mode is silent (returns 0 rows for `since=2026-04-25`). **Fix:** either tighten error message ("expected full ISO 8601 with timezone") or coerce `since` via `z.coerce.date().transform(d => d.toISOString())`.

9. **`articles.ts:22-25` — N+1 query on `tagsOf(row.id)` per article in list response.** For `limit=100`, that's 100 extra prepared-stmt round-trips after the main list query. better-sqlite3 is sync + fast so latency is sub-ms each, but it's an unbounded multiplier. **Fix:** add `ArticleRepository.listAcrossSourcesWithTags()` that uses `GROUP_CONCAT(tag, ',')` joined on article_tags, single query. Defer if benchmarks show <50ms p99.

10. **`db-path.ts:22` — `mkdirSync(dirname(absolute), { recursive: true })` runs unconditionally including for `:memory:` ... wait, `:memory:` is short-circuited at line 12. But for absolute paths under a read-only fs (e.g. running tests inside Docker with mounted ro volume), `mkdirSync` throws an unhelpful `EROFS` error far from the entry point. **Fix:** wrap in try/catch with `Database opening failed: cannot create dir ${dirname}: ${err.message}` for clearer ops error.

11. **`job-worker.ts:24-29` — `setImmediate` callback's `tick().catch()` swallows errors silently to console only.** Failures inside tick (e.g. DB closed, unknown internal bug) are not surfaced via metrics/healthcheck. The `processing` flag may also stay `true` if `tick` somehow throws BEFORE the `try/finally` block (impossible currently — `try` is the first statement — but fragile). **Fix:** ensure `processing = false` reset happens in the `.catch()` too. Currently safe but explicit guard prevents future regressions.

---

## Nits

- `app.ts:36-42` `onError` exposes `err.message` to clients. For a crawler `unknown site 'foo'` that's fine, but a future `Database is locked` / `ENOSPC` message could leak path or internal state. Consider: log full err, return generic `internal error` for non-`Error.name === 'HTTPException'` cases (or whitelist).
- `app.ts:33` `app.use('/crawl/*', apiKeyAuth, requireAdmin)` — note `/crawl` (no trailing slash) is *not* matched by `/crawl/*` pattern in some Hono versions; tests use `POST /crawl` (line 14 in crawl.test.ts) and pass, so OK on 4.7. Worth a single explicit test that `POST /crawl` (exact path) returns 401 unauth (current auth.test.ts only tests `POST /crawl` for the 403 read-key case which already implies auth ran).
- `crawl.ts:24` — `worker.scheduleNext()` is fire-and-forget after creating the job. If scheduleNext throws synchronously (unlikely), the response is 500 but the job is already in DB. Consider try/catch or note that the next POST will pick it up via setImmediate anyway.
- `index.ts:6-7` `loadEnv()` will throw on missing required env vars — process exits without a friendly message. Consider catching ZodError and printing `Missing required env: FEEDFORGE_READ_KEY` then exit 1.
- `package.json` — `vitest` is in devDeps but `@types/better-sqlite3` is not declared anywhere; relies on transitive from core. OK but brittle.
- `tsconfig.json` only has `extends`/`outDir`/`rootDir`; relying entirely on base is fine, but `composite: true` would speed up project refs builds.
- `jobs-repo.ts:65-77` — `create` does insert + getById in two stmts. Could use `INSERT ... RETURNING *` (SQLite 3.35+). Minor.
- `schemas.ts:6` — `limit: z.coerce.number().int().min(1).max(100).default(20)` — a string `"abc"` coerces to `NaN` → fails `.int()` → 400. Good. But `limit=0` → fails `.min(1)` → 400. Tested? (only `limit > 50` tested in `crawl.test.ts:33`). Add test for boundary 0/-1.
- `test-helpers.ts:68` `let nextExternalId = 1;` is module-scoped, leaks state across test files in the same process (vitest runs files in-process per worker). Currently no failure because each test creates its own DB. Consider resetting in a `beforeEach` or use `nanoid()`.
- `worker.test.ts` lacks: (a) a test for *concurrent* `scheduleNext` calls (kicks twice → still single tick, mutex correct), (b) test that `markRunning` no-ops when row already not pending, (c) test for the partial-progress scenario from Critical #4.
- `auth.test.ts` — no test for missing trailing-slash route variants (`/articles` vs `/articles/`), Hono normalizes but worth one assertion.
- `crawl.test.ts:62` jobId regex `^job_` — fine; consider also asserting `nanoid` length (~21) to catch nanoid version drift.

---

## Strengths

- DI factory (`buildApp({ env, articles, jobs, worker })`) makes tests trivial — `:memory:` DB, fake crawlers, no global state.
- Repository singleton lifecycle + `recoverStuck` on boot is the right pattern for crash resilience.
- Worker mutex (`processing` flag) + `setImmediate` keeps event loop fair, prevents request-thread blocking.
- All SQL is parameterized; `listAcrossSources` builds WHERE clauses but uses `?` binds throughout — no injection surface.
- Migrations are versioned + atomic (`BEGIN/COMMIT` per migration in `core/db.ts`), idempotent (`IF NOT EXISTS`), append-only documented.
- Zod env validation at boot (`env.ts`) fail-fast on missing keys.
- Auth split into `apiKeyAuth` (identity) + `requireAdmin` (authz) — clean layering, both checks applied to /crawl.
- Custom `onError` + `notFound` produce consistent `{error: {code, message}}` shape.
- Tests cover the AAA: auth (4 cases), articles (7 cases incl. pagination + filter + 404), crawl (6 cases incl. validation + e2e), worker (4 cases incl. exception path + recoverStuck). Solid baseline.

---

## Recommended Priorities

1. Critical #1 (worker TOCTOU) + #4 (partial-progress counters) — both touch worker correctness, fix together with one test that exercises mid-stream throw.
2. Critical #2 (timing-safe key compare) — 5-line fix, eliminates whole class.
3. Critical #3 (shutdown ordering) — add `worker.waitIdle()` + sequence in `index.ts`.
4. Important #6 (JobRow runtime parse) + #7 (empty tag) + #8 (since datetime) — schema robustness pass.
5. Nits: address as part of next PR; none blocking.

---

## Metrics
- LOC (api package): ~700
- Test count: 22 (auth 4, articles 7, crawl 6, worker 4 + boot)
- Type coverage: high; 3 `as Foo` casts on raw SQL rows (item #6)
- Linting issues: not run in this review (read-only)

---

## Unresolved Questions

1. Is multi-process access to the same `crawler.db` ever expected (e.g. dev `tsx watch` restart while a job is running)? If yes, Critical #1 needs immediate fix. If single-process forever, document the invariant.
2. Should partial-progress jobs (Critical #4) have a new `partial` status separate from `failed`, or just persist counters under `failed`? Plan didn't specify.
3. Is `since` filter spec strict ISO 8601 or "any reasonable date string"? UX call.
4. Is there a budget for adding `@types/better-sqlite3` directly to `packages/api/package.json` or rely on transitive?

**Status:** DONE_WITH_CONCERNS
**Summary:** Architecture and test scaffolding are solid; 4 critical concurrency/correctness gaps need addressing before the package is depended on by anything beyond the CLI. Most are 1-day fixes.
**Concerns/Blockers:** Worker TOCTOU + partial-progress counters are correctness bugs that pass current tests but will manifest in production-like loads. Recommend addressing all 4 criticals before merging downstream consumers.
