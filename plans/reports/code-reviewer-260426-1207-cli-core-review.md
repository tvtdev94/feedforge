# Code Review — CLI refactor + core repo extensions

Scope: `packages/cli/src/**` (commander + thin client) and `packages/core/src/repository.ts` + `migrations.ts` extensions. 50/50 tests pass.

## Critical
None blocking. No injection, no data leak, no auth bypass introduced. Network failure paths are covered.

## Important

### 1. `crawl.ts:43` — poll loop dies on first transient API hiccup
`api.get<JobResponse>(/crawl/${jobId})` throws `UserError` on **any** non-2xx or fetch failure. If the API restarts between polls (or hits a momentary 502 behind a proxy), the CLI aborts and abandons a job that is otherwise progressing server-side. The user sees `Cannot reach API at ...` and assumes the crawl failed; in fact it likely succeeded.

Fix (cheap): wrap the per-poll call in try/catch, swallow transient errors for, say, 3 consecutive failures before giving up. Print `(api unreachable, retrying...)` once so the user knows.

```ts
let consecutiveFails = 0;
while (Date.now() - startedAt < MAX_WAIT_MS) {
  await sleep(POLL_INTERVAL_MS);
  try {
    const job = await api.get<JobResponse>(`/crawl/${enqueued.jobId}`);
    consecutiveFails = 0;
    // ... existing logic
  } catch (err) {
    if (++consecutiveFails >= 3) throw err;
    if (consecutiveFails === 1) console.log(`  (api unreachable, retrying...)`);
  }
}
```

### 2. `repository.ts:179-212` / `214-231` — duplicated WHERE-builder
`listAcrossSources` and `countAcrossSources` reproduce the exact same `where[]`/`params[]` construction. A new filter (e.g. `author`) requires editing two places. Today it works, but the duplication is the kind that drifts: a fix to one and not the other produces silently wrong totals (count says N, list returns N+1 because the second branch missed the new clause).

Fix: extract a private builder. Tiny, KISS-friendly, and removes one whole class of future bug.

```ts
private buildWhere(opts: { source?: string; tag?: string; since?: string }): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.source) { where.push('source = ?'); params.push(opts.source); }
  if (opts.tag) {
    where.push('EXISTS (SELECT 1 FROM article_tags WHERE article_id = articles.id AND tag = ?)');
    params.push(opts.tag);
  }
  if (opts.since) {
    where.push('COALESCE(published_at, crawled_at) >= ?');
    params.push(opts.since);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}
```

Then both methods become 4 lines. This is a YAGNI/KISS positive — the abstraction already exists in the duplicated code, extraction just names it.

### 3. `repository.ts:209-211` — `db.prepare` per call
`listAcrossSources` calls `db.prepare(sql)` on every invocation. better-sqlite3 caches under the hood at the SQL-string level, but the cache key changes whenever filters change (3 boolean filters → up to 8 distinct SQL strings). Fine for v1 list usage. Watch for hot paths once an HTTP feed reads this.

Not a fix-now item, but flag in `## Unresolved Questions` below.

### 4. `crawl.ts:11-18` — `JobResponse.id` is unused, `jobId` declared optional but never read
The CLI POSTs and receives `{ jobId, status }`, then GETs `/crawl/:id` which returns the raw `JobRow` (key is `id`, not `jobId`). The interface mixes both shapes. After enqueue, only `status`, `inserted`, `updated`, `error` are read — those exist on `JobRow`. So no runtime bug, but the type lies about the API contract.

Fix: split the types.
```ts
interface EnqueueResponse { jobId: string; status: 'pending' | 'running' | 'done' | 'failed' }
interface JobStatusResponse { id: string; status: ...; inserted: number; updated: number; error: string | null }
```

## Nits

- `env.ts:5` — `apiKey` defaults to `''`, then `api-client.ts:9` checks `!env.apiKey`. Works because `''` is falsy, but `??` instead of `?? ''` would type it as `string | undefined` and make the check explicit. Minor.
- `api-client.ts:32` — `const text = await res.text()` can itself throw (truncated body, abort). Wrap or accept it'll bubble as `Error`, hit the index.ts:63 fallback, exit 2. Acceptable.
- `crawl.ts:21` — `MAX_WAIT_MS = 5 * 60 * 1000` is hardcoded. Consider `--timeout` flag for long crawls. YAGNI for now.
- `package.json:7` — `bin` points at `./src/index.ts` (TS source). Works under tsx, not under plain `node` after install. OK while CLI stays internal/dev-only. Add `"build"` artifact path before publishing.
- `repository.ts:67-70` — `listSources` ORDER BY source is fine; consider `ORDER BY count DESC` if a UI/listing surface uses it for ranking. v1 is alphabetical, document intent.
- `repository.ts:206` — ORDER BY `COALESCE(published_at, crawled_at) DESC` cannot use either single-column index. For v1 dataset sizes (< 100k rows) this is invisible. Once you cross a few hundred thousand rows, add a generated column `effective_at` indexed DESC. Mention in roadmap, do not pre-optimize.
- `migrations.ts:51` — `CHECK(status IN (...))` constraint is good. Note that adding a status value later requires a new migration to recreate the table (SQLite cannot ALTER a CHECK in place). Acceptable trade-off.
- `index.ts:64` — non-`UserError` exits with code 2; conventional Unix is 1 for any error. If shell scripts grep on `$?`, distinguishing 1 vs 2 is intentional and useful. Leave as-is, just document.
- `truncate.ts` — file is fine, properly extracted, test imports `'../truncate.js'` and behavior is preserved (regression case for `max < 4` still asserted).

## Strengths

- `UserError` discipline: clean `process.exit(1)` path, no stack traces leaking on bad flags or network outage. `api-client.ts:27-30` even wraps fetch failures with a *helpful* hint (`Is 'pnpm api:dev' running?`).
- `listAcrossSources`/`countAcrossSources` correctly use `?`-binds for all values. Column names and clauses are static literals — no string interpolation of user input. SQL injection not possible.
- Migrations: `IF NOT EXISTS` on table + index, no destructive DDL, ordered version array. v1 → v2 idempotent.
- `findById` and `listSources` are pre-prepared (cached), only the dynamic `listAcrossSources` re-prepares — appropriate split.
- Polling protocol: sensible backoff cadence, status-change print is throttled (only logs on transition), final summary line gives `inserted`/`updated`. Good UX.
- Tests cover the truncate edge case (`max < 4` regression), `listAcrossSources` filter combinations, and `findById` miss path. 50/50 pass.

## Unresolved Questions

1. Should the CLI poll tolerate transient API failures (Important #1), or is the current fail-fast behavior intentional for test/CI environments?
2. Will an HTTP/feed surface ever hit `listAcrossSources` on the hot path? If so, expect to revisit per-call `db.prepare` (Important #3) and the COALESCE ORDER BY index gap (Nit on line 206).
3. `--timeout` flag for `crawl` — wanted for long crawls, or accept the 5 min cap?

---

**Status:** DONE
**Summary:** Reviewed CLI (index/api-client/env/crawl/list/truncate/errors) + core repo extensions (4 new methods, v2 migration). No critical issues. 2 important (poll resiliency, WHERE-builder duplication) and a handful of nits. SQL injection vector clean — column names static, values via `?`-binds. 50/50 tests already passing.
**Concerns/Blockers:** None blocking. Recommend addressing Important #1 (poll resiliency) before any deploy where the API and CLI run on different hosts.
