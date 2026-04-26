# Code Review: `@crawler/core`

Scope: `packages/core/src/{db,repository,migrations,types,crawler,index}.ts` + tests.
Stack: better-sqlite3 (sync), single-process CLI, ESM.

---

## Critical

1. **`repository.ts:88` — `ORDER BY COALESCE(published_at, crawled_at)` is not index-friendly.**
   `idx_articles_published_at` covers `published_at` only and is not a partial index keyed by source. List query becomes a full scan of `source` rows + sort. Fix: composite index `CREATE INDEX idx_articles_source_pub ON articles(source, COALESCE(published_at, crawled_at) DESC)` (SQLite supports expression indexes since 3.9), or simpler: store an effective `sort_at TEXT NOT NULL DEFAULT (COALESCE(published_at, crawled_at))` column + index. With `IF NOT EXISTS` guards in migration v1, the cheap fix is to add migration v2.

2. **`db.ts:15-22` — migrations not wrapped in a transaction; `user_version` set after `db.exec` succeeds, but no rollback if a later statement in the same `sql` block fails partially.**
   `db.exec` runs each statement; if statement #3 of 5 fails, statements 1-2 are committed but `user_version` is NOT bumped — next run replays 1-2 and fails again on whatever caused #3 to fail (now duplicate object errors). All current `CREATE … IF NOT EXISTS` happen to be idempotent so it's invisible today, but the pattern is a footgun for future migrations (e.g. `ALTER TABLE`, data backfills). Fix:
   ```ts
   db.exec('BEGIN');
   try { db.exec(m.sql); db.pragma(`user_version = ${m.version}`); db.exec('COMMIT'); }
   catch (e) { db.exec('ROLLBACK'); throw e; }
   ```
   Or use `db.transaction(() => { db.exec(m.sql); db.pragma(...) })()`. Note: SQLite does **not** support DDL inside a savepoint cleanly across all versions, but plain `BEGIN/COMMIT` is fine for schema migrations.

3. **`repository.ts:113-114` — INSERT path trusts caller-supplied `a.id` is unique; collision throws `SQLITE_CONSTRAINT_PRIMARYKEY` and the txn aborts.**
   `findIdStmt` only locates by `(source, external_id)`. If the caller passes a fresh `a.id` for an article whose `(source, external_id)` was deleted/cascaded but a row with the same primary id still lives elsewhere (e.g. user retried with a stale nanoid), insert fails. Low probability with nanoid, but the failure mode is silent corruption from caller's POV (txn rolls back, returns nothing — actually it throws, but error is undocumented in JSDoc). Fix: document that `upsert` may throw `SqliteError` on PK collision, or switch to `INSERT … ON CONFLICT(source, external_id) DO UPDATE …` (single-statement upsert, removes the find/branch entirely — see Important #1).

---

## Important

1. **`repository.ts:99-118` — manual find+branch upsert is more complex than `INSERT … ON CONFLICT … DO UPDATE`.**
   SQLite 3.24+ (better-sqlite3 ships 3.50+) supports `ON CONFLICT(source, external_id) DO UPDATE SET …`. Collapses three prepared statements into one, eliminates the read-then-write race window (irrelevant in single-process, but still simpler), and `RETURNING id, (xmax=0) AS inserted`-style patterns can be emulated with `RETURNING id` + comparing to inserted id. KISS win.

2. **`repository.ts:73 / types.ts:25 — `crawled_at` is overwritten on every upsert.**
   The plan question is correct: as written, `crawled_at` means "last seen", not "first seen". For a crawler this is genuinely ambiguous — most consumers want **both**. Recommend split:
   - `first_seen_at TEXT NOT NULL` (set on INSERT only, never updated)
   - `last_seen_at TEXT NOT NULL` (set on every upsert)
   Keep `published_at` as upstream-authoritative. Update `ORDER BY` to `COALESCE(published_at, first_seen_at)` so newly republished items don't jump the queue. Add as migration v2.

3. **`repository.ts:149-155` — `replaceTags` clears then re-inserts inside a transaction.**
   For the common case where tags are unchanged (most upserts on a re-crawl), this generates churn: N deletes + N inserts every time. Either:
   - Diff first (compute set difference, delete missing, insert new), or
   - Skip if tag arrays match (cheap `SELECT GROUP_CONCAT(tag) … = ?` check).
   YAGNI says fine for now at small scale; flag for when row counts grow.

4. **`repository.ts:152` — `if (!t) continue;` silently drops empty-string tags but not whitespace-only or duplicates-after-trim.**
   `'  '` passes; `'foo '` and `'foo'` are stored as distinct tags. Either normalize at boundary (`tag.trim().toLowerCase()` if case-insensitive desired) or document that tags are stored verbatim. Also no length cap — a 10MB tag string is accepted.

5. **`repository.ts:131-138` — `list` has no upper bound on `limit`.**
   `repo.list({ source: 'x', limit: Number.MAX_SAFE_INTEGER })` will happily try to materialize everything. Cap at e.g. 500, or document the contract. Same applies to negative `limit`/`offset` (SQLite treats negative LIMIT as unbounded — surprise behavior).

6. **`repository.ts:144-147` — `tagsOf` is called per article in any UI path → classic N+1.**
   No batch `tagsOfMany(ids: string[]): Map<string, string[]>` and `list()` doesn't return tags. CLI consumers will end up doing `for (row of list()) tagsOf(row.id)`. Add a join-based variant or include tags in `list()` via `GROUP_CONCAT(tag)`.

7. **`db.ts:8` — no `Database` open options.**
   No `readonly`, `fileMustExist`, `timeout`, or `verbose`. For tests `:memory:` works, but for production CLI: missing parent directory throws cryptic ENOENT (better-sqlite3 doesn't `mkdirp`). Either document or `mkdirSync(dirname(path), { recursive: true })` before opening (skip for `:memory:`).

8. **`db.ts:9` — `journal_mode = WAL` on `:memory:` is a no-op but also on read-only filesystems will fail silently (returns current mode).**
   `db.pragma('journal_mode = WAL')` returns the actual mode used; if SQLite couldn't switch it stays in `memory`/`delete`. Not checked. Add: `const mode = db.pragma('journal_mode = WAL', { simple: true }); if (path !== ':memory:' && mode !== 'wal') console.warn(...)`. Optional but cheap.

9. **`db.ts:16` — `?? 0` is unreachable.**
   `db.pragma('user_version', { simple: true })` always returns a number (default 0). The `?? 0` is dead defensive code. Nit, remove.

10. **`migrations.ts:13` — `CREATE TABLE IF NOT EXISTS` defeats migration safety.**
    If a future v2 migration is buggy and drops + recreates `articles` with new columns missing from v1, then user re-runs v1 (because user_version got reset somehow), `IF NOT EXISTS` silently leaves the broken schema. For the very first migration this is OK; future migrations should NOT use `IF NOT EXISTS` — let them fail loudly if state is unexpected. Document the convention.

11. **`crawler.ts:10` — `crawl` returns `AsyncIterable<Article>` but no cancellation.**
    No `AbortSignal` parameter. CLI Ctrl-C will leak in-flight HTTP requests. Add `signal?: AbortSignal` to `CrawlOptions` or as a second arg.

12. **`types.ts:28` — `rawJson: string` (non-null) is asymmetric with the row schema where `raw_json TEXT` is nullable.**
    `repository.ts:172` passes through whatever the caller supplies; if a future caller writes `null`, TypeScript blocks it but a JS-side caller could slip through. Either tighten DB column to `NOT NULL DEFAULT '{}'` or relax type to `string | null`.

13. **`repository.ts:120-129` — `upsertMany` is not itself a transaction; each `upsert` opens its own.**
    For 1000-article batches that's 1000 transaction commits = 1000 fsyncs in WAL. Fix: wrap the whole loop in a single `db.transaction((arts) => { for (const a of arts) … })` and call once. Massive perf win at batch size > ~50.

14. **`repository.ts:36-43` — prepared statements are field-init'd BEFORE migrations could possibly re-run.**
    Actually fine in current flow (`openDb` runs migrations before `new ArticleRepository(db)`), but if anything ever re-opens the same `db` handle and migrations are appended at runtime, statements bind to old schema. Document: "construct AFTER `openDb`" — currently the only documented entry point so this is a nit, but worth a comment.

---

## Nits

- `repository.ts:131` — return type `ArticleRow[]` exposes snake_case to consumers; rest of public API is camelCase. Inconsistent. Either map to `Article` (without tags) or document the snake_case escape hatch.
- `repository.ts:141` — `count` returns `number`; SQLite COUNT can technically return a bigint via `safeIntegers` mode. Not enabled here, so fine — note for future.
- `index.ts:1-9` — re-exports look clean. `Crawler` type-only re-export is correct (it has no runtime).
- `types.ts:31-39` — `CrawlOptions.feed` is a string literal union of two values; `query` reserved field is YAGNI flag — drop until needed (you said new repo, no production). Same for `tag` being optional when `feed === 'search'` — TypeScript can enforce this with a discriminated union: `{ feed: 'popular' } | { feed: 'search'; tag: string }`.
- `repository.ts:120` — `Iterable<Article>` is correct (works for arrays, generators, `crawl()` would need `for await` though — async iterable not accepted here). Document that `upsertMany` is sync-only; for async sources caller must `for await` and accumulate, or add `upsertManyAsync(it: AsyncIterable<Article>)`.
- `__tests__/repository.test.ts:78` — uses `?.` chain on `rows[0]` but doesn't assert `rows.length === 2`. If query returns 0 rows the test passes vacuously. Add length check.
- `__tests__/repository.test.ts` — no test for: unicode in title/tags (`'🚀'`, `' '`), very long strings, empty tag array, null `published_at` ordering against another null `published_at`, `LIMIT 0`, negative offset.
- `migrations.ts:39` — `idx_article_tags_tag` indexes only `tag`; for "find articles by tag" queries you'll want `(tag, article_id)` covering index. YAGNI but flag.
- No test for migration idempotency (open same db file twice with same MIGRATIONS array).

---

## Adversarial Edge Cases

| Input | Outcome |
|---|---|
| `openDb(':memory:')` | OK (covered by tests). |
| `openDb('/read/only/fs/db.sqlite')` | Throws `SQLITE_CANTOPEN`. Not caught/wrapped — caller sees raw better-sqlite3 error. |
| `openDb('relative/path/that/does/not/exist/db.sqlite')` | Throws ENOENT. No `mkdirp`. |
| `openDb` then process killed mid-migration | WAL recovery handles it; `user_version` not bumped → next run retries. With current `IF NOT EXISTS` this is safe but see Critical #2. |
| `upsert(article with empty tags: [])` | Tags cleared, none inserted. OK. |
| `upsert(article with tags: ['', '  ', null as any])` | Empty string skipped (`!t`), whitespace stored, null would throw at SQLite (TEXT NOT NULL). Type system blocks null but JS callers can slip. |
| `upsert(article with title: 'A'.repeat(1e7))` | Stored. SQLite TEXT max is ~1GB by default; no app-layer cap. |
| `upsert(article with id containing NUL byte: 'x y')` | better-sqlite3 stores it; SELECTs may truncate display in some clients. No validation. |
| `list({ source: "'; DROP TABLE articles; --" })` | Safe — prepared statement params. No injection. ✓ |
| `list({ source: 'x', limit: -1 })` | SQLite treats `LIMIT -1` as unlimited. Surprise. |
| `list({ source: 'x', limit: 0 })` | Returns empty (correct). |
| Two concurrent `upsert` calls (impossible single-process, but worth noting) | better-sqlite3 is sync; no concurrency in this process. ✓ |
| Multi-process access to same DB file | WAL mode handles readers; writers serialize via SQLite's lock. No app-level coordination needed. ✓ |
| `count('non-existent-source')` | Returns 0. ✓ |
| `tagsOf('non-existent-id')` | Returns `[]`. ✓ |
| Migration v1 partial failure (e.g. disk full mid-CREATE) | See Critical #2. |

---

## Strengths

- Schema is clean: explicit FK with `ON DELETE CASCADE`, composite PK on `article_tags`, sensible indexes.
- `(source, external_id)` UNIQUE is the right dedupe key.
- Prepared statements throughout; SQL injection-safe.
- Migration version tracking via `user_version` pragma is the canonical SQLite approach.
- Tests cover the main happy paths concisely.
- Type/row separation (camelCase domain `Article` ↔ snake_case `ArticleRow`) is deliberate and correct.
- WAL + foreign_keys pragmas set on every open. ✓
- Single-statement `upsert` wrapped in `db.transaction` for atomicity of articles+tags. ✓
- `Iterable<Article>` for `upsertMany` allows generator sources. ✓
- ESM `.js` import extensions correct for NodeNext.

---

## Recommended Actions (priority order)

1. Wrap migrations in a transaction (Critical #2). 5-line fix.
2. Decide on `crawled_at` vs `first_seen_at`/`last_seen_at` semantics; add migration v2 if splitting (Important #2).
3. Wrap `upsertMany` body in single `db.transaction` (Important #13). One-line fix, large perf gain.
4. Switch `upsert` to `INSERT … ON CONFLICT DO UPDATE RETURNING` (Important #1). Removes Critical #3 entirely.
5. Add `AbortSignal` to `CrawlOptions` (Important #11) before any crawler implementations land.
6. Cap/validate `limit` in `list` (Important #5).
7. Add composite index for `list` query (Critical #1) once data volume is known.
8. Add `mkdirSync(dirname(path), { recursive: true })` in `openDb` for non-`:memory:` paths (Important #7).
9. Add tests for unicode, empty/whitespace tags, `LIMIT 0`, negative offset, migration idempotency.

---

## Unresolved Questions

- Is `crawled_at` intended as "first seen" or "last seen"? Plan should pick one; current behavior is "last seen" but field name says otherwise. → recommend renaming to `last_seen_at` and adding `first_seen_at`.
- Are tags case-sensitive? `'JavaScript'` vs `'javascript'` will be stored as two distinct tags today.
- Should `rawJson` ever be `null`? Type says no, schema says yes.
- Multi-source behavior: is one DB shared across all source crawlers, or one DB per source? Affects whether composite `(source, …)` indexes are worth the cost.
- What's the expected upsert batch size? Determines whether Important #13 is critical or nice-to-have.

---

**Status:** DONE
**Summary:** Schema and core flow are solid for a fresh repo; migration transaction safety, `crawled_at` semantics, and per-row transaction overhead in `upsertMany` are the highest-leverage fixes. No security issues (prepared statements throughout). Several YAGNI/perf concerns flagged for future scale.
**Concerns:** Confirm `crawled_at` semantic intent before more crawlers land — schema change later means data migration.
