# code-reviewer — `@crawler/daily-dev` adversarial review

Date: 2026-04-26
Scope: `packages/daily-dev/src/{client,crawler,mapper,queries,schema,index}.ts` + tests
Focus: pagination, retry/throttle, schema validation, mapper

---

## Critical

- **Infinite loop on empty page with `hasNextPage=true`** — `crawler.ts:36-44`.
  If API returns `edges: []`, `hasNextPage: true`, `endCursor: 'X'` (same as previous), `yielded` never advances; loop only exits if `endCursor` becomes null/false. Same applies if API echoes the same `endCursor` twice. Fix: track previous cursor, break when `endCursor === previousCursor` OR after N consecutive empty pages (safety cap on iterations).

- **Throttle bypassed across retries → 429 hammer** — `client.ts:45-67`.
  `throttle()` is awaited once before the retry loop. Between retries only `backoffMs` (500/1000/2000) gates calls; for default `throttleMs=1000` the first backoff (500ms) is shorter than throttle. On a 429 the retry can hit the API faster than the configured rate limit, risking a permanent ban. Fix: call `await this.throttle()` at the top of each iteration of the retry loop (or set `lastRequestAt` so the next throttle includes the backoff).

- **Network errors retry forever (within `maxRetries`) — and `AbortError` is retried** — `client.ts:77-84`.
  `shouldRetry` returns `true` for any non-`ClientError` (DNS, TLS, ECONNRESET, AND `AbortError` on timeout AND user-cancelled aborts). Two issues:
  1. Timeout aborts are retried, multiplying latency by `maxRetries × timeoutMs` (3 × 15s = 45s) silently — fine if intended, but unbounded for true user-cancelled aborts (none currently, but as soon as a parent passes a signal this will mis-handle cancellation).
  2. Hard auth/network misconfig (DNS NXDOMAIN, cert errors) retries 3× wastefully.
  Fix: distinguish `AbortError` (retry only on internal timeout, not external cancel — but easier: never retry abort), and add an explicit allow-list for retryable network errors (`ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`, fetch `TypeError`).

- **`lastRequestAt` set BEFORE await — broken throttle under concurrency** — `client.ts:54`.
  If two `request()` calls run in parallel on the same client, both pass `throttle()` (since neither has set `lastRequestAt` yet for the other), and the timestamp is overwritten by whichever sets first. Throttle becomes non-deterministic. Set `lastRequestAt = Date.now()` inside `throttle()` AFTER the wait, OR (simpler) serialize `request()` with a chained promise. Even single-threaded use of `crawl()` is fine, but `DailyDevClient` is exported and reusable — it shouldn't violate its own throttle contract.

---

## Important

- **`AbortController` timer leaks on success path of last attempt? Actually OK** — verified `clearTimeout` is in both `try` (line 60) and `catch` (line 63). However if `clearTimeout` itself or `return` throws (won't, but) — minor. Use `try { ... } finally { clearTimeout(timer) }` for clarity.

- **`ClientError` from graphql-request may not have `.response.status` for transport errors** — `client.ts:79`.
  graphql-request raises `ClientError` for GraphQL-layer errors *with* a response, but transport errors (fetch throw) are raw — covered by the fallthrough. However a 4xx with GraphQL-shape response (e.g. 400 Bad Request) returns `ClientError` with status=400, which is NOT in `RETRYABLE_STATUS` → correctly does not retry. OK. But: a 401/403 anonymous-rate-limit response is also non-retryable; if daily.dev ever uses 403 to throttle, it will not be retried. Document or extend allow-list cautiously.

- **`endCursor: null` while `hasNextPage: true`** — `crawler.ts:42-44`.
  Currently breaks on null cursor, which is the safe choice. Worth a comment that this is intentional defensive behavior, since the GraphQL spec allows the combination.

- **`url` not validated as URL** — `schema.ts:7`.
  `node.url` is `z.string()` only. Mapper writes it straight to `Article.url`. If upstream returns `javascript:alert(1)` or `data:` URI, it lands in DB and downstream consumers (web UI?) may render it. Defense in depth: `z.string().url()` for `url`, `permalink`, `image`, `source.image`, `author.image`. At minimum, reject non-`https?:` schemes in the mapper. Same for `summary` if surfaced as HTML (currently treated as text — flag for future).

- **`createdAt` not validated as ISO 8601** — `schema.ts:12`.
  Stored to `publishedAt` and used in repository `ORDER BY COALESCE(published_at, crawled_at) DESC`. SQLite string-compares lexicographically; non-ISO strings (e.g. `"yesterday"`, `"2026-4-25"`) sort wrong. Add `z.string().datetime()` (zod v4 supports it) or normalize in mapper via `new Date(x).toISOString()` with try/catch.

- **`tags` may contain empty strings or duplicates** — `schema.ts:13`.
  Repository’s `replaceTags` filters falsy (`if (!t) continue`) but does not dedupe. INSERT OR IGNORE handles duplicates at DB level only because of a UNIQUE constraint (assumed). If schema lacks one, dupes leak. Mapper or schema should dedupe + trim. Also no length cap — a malicious tag of 1MB lands in DB.

- **`rawJson` size unbounded** — `mapper.ts:27`.
  `JSON.stringify(node)` of a single post is small (~few KB), but if upstream ever returns a node with deeply nested or repeating fields (e.g. comment threads inlined), this balloons. Add a soft cap (e.g. 64KB) and truncate with marker. Worth tracking only if real payloads grow.

- **`nanoid()` generated even when `(source, externalId)` already exists — wasteful but not incorrect** — `mapper.ts:13`, `repository.ts:107-110`.
  On UPDATE path, `existing.id` is used; the freshly generated `a.id` is discarded. ~21 bytes of wasted entropy per duplicate. Order of magnitude irrelevant for current scale (50/page). Worth fixing only if `mapPostToArticle` is hot. If you want zero-waste: defer `id` allocation to repository on insert path. Low priority.

- **`shouldRetry` does not honor `Retry-After` header on 429** — `client.ts:77-84`.
  daily.dev may return `Retry-After: <seconds>`. Current backoff ignores it. Risk: under-wait → ban. Read header from `err.response.headers` and floor backoff at that value.

- **`mapPostToArticle` uses `new Date().toISOString()` — not injectable** — `mapper.ts:25`.
  Hard to test crawl ordering or freeze time deterministically. Pass a `now()` fn or accept `crawledAt` parameter. Minor unless tests need it.

- **Schema test fixture has only 2 nodes; no edge cases tested** — `schema.test.ts:11-29`.
  Missing: empty `edges`, `hasNextPage=true` with `endCursor=null`, malformed dates, very long tags array. Add these for confidence.

- **`buildQuery` throws raw `Error` for missing tag** — `crawler.ts:54-58`.
  Caller can’t programmatically distinguish from network errors. Define a typed error (e.g. `InvalidCrawlOptionsError`) — same applies to all subclassed crawlers in the monorepo.

---

## Nits

- `client.ts:14` — `Required<ClientOptions>` is fine but loses the JSDoc at usage sites; consider exporting `DEFAULTS`.
- `client.ts:91-94` — `backoffMs(1)=500`, comment says `500ms, 1s, 2s, ...` — correct, but jitter would be polite (currently every retry across many crawlers desyncs — at one client this is moot).
- `crawler.ts:9` — `PAGE_SIZE=30` is hardcoded; expose via constructor for testability.
- `crawler.ts:25` — `Math.max(1, options.limit ?? DEFAULT_LIMIT)` — if user passes `0` they probably mean "none"; silently coercing to 1 is surprising. Consider throwing or honoring 0 (skip the crawl).
- `mapper.ts:26` — `node.tags ?? []` — tags later flows into DB. Trim/lowercase in mapper for consistency? (Or document that normalization is the repository’s job.)
- `mapper.test.ts:36` — regex `^[a-zA-Z0-9_-]+$` doesn’t actually verify nanoid length (default 21). Tighten to `^[A-Za-z0-9_-]{21}$` or call `nanoid` mocked.
- `queries.ts` — string interpolation builds queries; safe here (no user input), but switching to `gql` template tag would let codegen tools introspect.
- `schema.ts:8-30` — every optional field is `nullable().optional()`. Consistent and matches GraphQL nullability — fine, but readers will wonder why both. A one-line comment explaining (optional = field absent, null = field present-but-null) helps.
- `index.ts` — re-exports look clean; consider re-exporting the queries too if external consumers need them.

---

## Strengths

- Clean separation of concerns: client (transport+retry), crawler (pagination+contract), mapper (shape), schema (validation), queries (GraphQL strings).
- Anonymous-only by design — no token leak vectors.
- `rawJson` for forward compat is pragmatic.
- Throttle + retry + timeout all covered, with sensible defaults.
- Zod parse at boundary, types flow through. Mapper is total over the parsed shape.
- Tests cover happy + minimal + fallback chains for `mapPostToArticle`.
- `signal` IS honored by graphql-request v7 (verified in `legacy/helpers/types.ts:97`) — abort on timeout works.
- Page size = 30, capped per request — polite and bounds payload.

---

## Unresolved Questions

1. Does daily.dev document a per-IP rate limit? If yes, set `throttleMs` default to match.
2. What is the contract on `hasNextPage=true` with `endCursor=null`? The current break-on-null is defensive but loses the last partial page if API misbehaves.
3. Should `Crawler.crawl` accept an `AbortSignal` from the caller for graceful cancellation? Currently no way to stop a long crawl mid-stream.
4. Do we want dedupe of `(source, externalId)` *during the crawl* (skip repeats within a single `crawl()` call) or only at repository upsert time? Currently repository handles it; mapper produces noise.
