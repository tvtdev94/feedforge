# Code Review: `@crawler/cli`

Adversarial review. Files in scope listed in task. Found by reading source + tracing edge cases by hand.

## Critical

- **`package.json:7` — `bin` points at `.ts` source.** `bin: { crawler: ./src/index.ts }` plus shebang `#!/usr/bin/env node` will exit with `SyntaxError: Cannot use import statement outside a module` (or similar) when globally installed via `npm i -g`. Node cannot execute TypeScript. Fix: either ship compiled `dist/index.js` (script `build` already exists) and point bin at `./dist/index.js`, or use a tsx-based shim shebang `#!/usr/bin/env -S npx tsx` (fragile, not portable to Windows). Document that current state is dev-only via `pnpm cli`. Also add `"files": ["dist"]` and `"main"` for completeness if publishing.

- **`commands/list.ts:62` — truncate off-by-one for small N.** `slice(0, args.truncate - 3) + '...'` when `truncate < 3` produces output longer than requested. `--truncate=1` → `slice(0,-2)` = whole-string-minus-2 + `'...'`. `--truncate=2` → `slice(0,-1)` + `'...'` (worse than no truncation). Fix: either reject `truncate < 4` in validation, or `Math.max(0, truncate - 3)` and clamp final output: `(truncate >= 3 ? slice(0, truncate-3)+'...' : slice(0, truncate))`.

## Important

- **`index.ts:10` — `parseInt` silently accepts garbage.** `Number.parseInt("10abc", 10) === 10`, `parseInt("1.5") === 1`. Flag like `--limit=12abc` works without warning. Fix: regex-validate `/^-?\d+$/` before parse, or use `Number(value)` + `Number.isInteger(n)`.

- **`db-path.ts:38` — workspace marker fallback silently uses cwd.** When no marker found walking up, returns `start` (original cwd). User running CLI outside any workspace from `/tmp` ends up with `/tmp/data/crawler.db` — surprising and easy to forget. Fix: log a warning when falling back, or require explicit `--db` / env when no workspace detected.

- **`db-path.ts:14` — empty-string flag silently ignored, falls through to env.** `--db ""` → `fromArg = ""` → length 0 → uses env or default. User passing empty likely meant something. Fix: throw `UserError` on explicitly-empty `--db`.

- **`commands/crawl.ts:51` — `db.close()` in finally races with `openDb` throwing.** If `openDb` itself throws (bad path, locked DB), `db` is undefined and `db.close()` will throw `TypeError`, masking original error. Same in `commands/list.ts:71`. Fix: assign `db` after the try, or guard `db?.close()`. Better: move open inside try with `let db: Db | undefined`.

- **`commands/crawl.ts:38-46` — partial-state on mid-stream failure.** If crawler iterator throws halfway, transactions are per-row (each `repo.upsert` is its own tx), so DB ends with partial fetch. Possibly intentional (resumable), but no resume support exists in the CLI — re-running blindly re-fetches from start. Document or wrap whole loop in single tx for atomicity. At minimum log how many rows succeeded before the throw (currently lost — error escapes finally to top-level `console.error(err)`).

- **`registry.ts:25-27` — skeleton entries silently appear in `--help`.** `crawl <site>` description lists all three (`daily-dev, dev-to, hacker-news`), but two throw at runtime. New users will pick `dev-to`, hit a stack trace, and file a bug. Fix: mark unimplemented in help text (e.g., `dev-to (skeleton)`), or filter out and require `--include-skeletons`.

- **`commands/list.ts:50,64` — `console.log` writes raw user content, no escaping.** Article titles/URLs come from external APIs. A title containing `\r` or ANSI escape sequences could mangle terminal output or hide content. Plain text mode is fine for trusted sources, but daily.dev/HN content is user-generated. Low real risk, but worth a `stripAnsi` or replace control chars on output.

- **`commands/list.ts:62` — multibyte truncation cuts code points / grapheme clusters.** `String.slice` operates on UTF-16 code units. A summary containing emoji or surrogate pairs at the boundary will produce a lone surrogate (`\uD83D` alone) and printing that may render as `?` or worse, corrupt the terminal. Fix: use `Array.from(str).slice(0, n)` or `Intl.Segmenter` for grapheme-aware truncation.

- **`commands/list.ts:36` — `--json` emits pretty-printed array but no streaming.** Fine for `--limit=10`, but `--limit=100000` materializes entire enriched array before printing. Also, N+1 query: `repo.tagsOf(r.id)` runs once per row inside the map. For large lists this is slow. Fix: either join tags in SQL (single query) or batch-fetch tags with `WHERE article_id IN (?, ?, ...)`.

- **`index.ts:26` — `listSites()` evaluated at module load.** `description: \`crawl a site (available: ${listSites().join(', ')})\`` runs eagerly. Fine today but if registry ever becomes async/lazy it'll silently render empty. Defer with Commander's lazy description if available, or accept this as fine for static registry.

## Nits

- `index.ts:8` — `parseIntFlag` returns inline `(value) => { ... }` but doesn't pass through Commander's `previous` arg. Not used today, but signature mismatch with Commander's `(value, previous) => T` convention.
- `index.ts:34` — `String(opts['feed'])` defensively wraps a value already typed by Commander. Cosmetic; `opts.feed as string` would do.
- `errors.ts:6` — missing `Object.setPrototypeOf(this, UserError.prototype)` for `instanceof` to survive transpilation. Modern TS targeting ES2022 likely fine; check `tsconfig.base.json` target.
- `commands/list.ts:43` — `(no rows for source='${args.source}', total=${total})` will always have `total=0` when `rows.length === 0` only if offset is past end. If source has 100 rows and user passes `--offset=200`, message shows `total=100`, slightly confusing. Fine, but consider distinguishing "source has no data" vs "offset out of range".
- `commands/crawl.ts:32` — `tag=${args.tag ?? '-'}` printing `-` for unset is cute but unconventional; `(none)` is clearer.
- `db-path.ts:16` — env var name `CRAWLER_DB` not documented in `--help` for either command. Should appear at least in README.
- `package.json` — no `engines` field; root requires `>=18.18` but CLI doesn't restate. `better-sqlite3` is sensitive to Node version.
- No tests for `db-path.ts` despite branching logic (override / env / workspace / fallback).

## Strengths

- Clean separation: `index.ts` (wiring) / `commands/*` (logic) / `registry.ts` (extension point) / `db-path.ts` (resolution) / `errors.ts` (typed user errors).
- `UserError` distinction with proper exit codes (1 vs 2) — good UX, no stack on user mistakes.
- `db.close()` always in `finally` (correct intent, even if the open-throws-early case has the bug noted above).
- Input validation in commands re-checks parsed numbers (`isFinite`, `< 1`) — defense in depth even though Commander already parsed.
- Registry pattern with clear "how to add a site" comment is genuinely helpful for contributors.
- WAL mode in `openDb` means concurrent CLI invocations writing same DB will not corrupt — readers don't block writers. Repo-aware enough for typical use.
- Workspace-root resolution for default DB path is a nice DX touch.

## Unresolved Questions

- Is global install via `bin` an actual goal for v0.1, or is `pnpm cli` the only intended entry? Determines whether the bin/shebang issue is a blocker or a documented limitation.
- Should mid-crawl failures preserve partial DB state (current behavior) or be atomic? Affects whether to wrap loop in one transaction.
- Is `dev-to` / `hacker-news` template-only status meant to be visible to end users via `--help`, or should they be hidden until implemented?
