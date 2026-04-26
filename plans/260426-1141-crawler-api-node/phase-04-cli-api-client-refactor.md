---
phase: 4
name: CLI refactor as API client
priority: high
status: pending
estimatedHours: 0.75
blockedBy: [phase-03]
---

# Phase 4: Refactor `@crawler/cli` thành API client

## Context

- Phase 3 đã có endpoints đầy đủ: GET /articles, POST /crawl, GET /crawl/:id
- CLI hiện đọc/ghi DB trực tiếp qua `@crawler/core` repo

## Overview

CLI trở thành **HTTP client** gọi vào API server. Không truy cập DB trực tiếp nữa. `crawl` command tạo job + poll cho đến done. `list` command gọi GET /articles.

Khi dev: chạy `pnpm api:dev` ở terminal A, `pnpm cli ...` ở terminal B → CLI trỏ vào `localhost:3000`.

## Requirements

- CLI cần env: `FEEDFORGE_API_URL` (default `http://localhost:3000`), `FEEDFORGE_API_KEY` (admin key cho `crawl`, read key cho `list`)
- Drop direct DB access từ CLI commands
- `crawl` command: POST /crawl → poll GET /crawl/:id mỗi 2s → in progress → done/failed
- `list` command: GET /articles?source=&limit=&offset= → format giống output cũ
- Error handling: HTTP 4xx/5xx → exit 1 với message clean
- Truncate logic giữ nguyên (Phase 6 review fix đã pass)

## Architecture

```
packages/cli/src/
├── index.ts              commander setup (unchanged structurally)
├── api-client.ts         NEW: fetch wrapper + types
├── env.ts                NEW: read FEEDFORGE_API_URL + FEEDFORGE_API_KEY
├── errors.ts             unchanged
├── commands/
│   ├── crawl.ts          REWRITE: POST + poll
│   └── list.ts           REWRITE: GET /articles
├── db-path.ts            DELETE (no longer accessing DB)
└── registry.ts           DELETE (server owns registry now; CLI just calls API)
```

`db-path.ts` và `registry.ts` xóa để tránh nhầm lẫn — CLI không còn role truy cập DB local.

`@crawler/cli/package.json` — drop deps `@crawler/core`, `@crawler/daily-dev`, `@crawler/dev-to`, `@crawler/hacker-news`. CLI giờ chỉ cần `commander`.

## Related code files

**Create:**
- `packages/cli/src/api-client.ts`
- `packages/cli/src/env.ts`

**Rewrite:**
- `packages/cli/src/commands/crawl.ts`
- `packages/cli/src/commands/list.ts`
- `packages/cli/src/index.ts` (drop `listSites` dynamic help — show static list)

**Delete:**
- `packages/cli/src/db-path.ts`
- `packages/cli/src/registry.ts`

**Modify:**
- `packages/cli/package.json` — remove direct crawler/core deps; keep `commander`

## Implementation steps

1. `src/env.ts`:
   ```ts
   export const env = {
     apiUrl: process.env['FEEDFORGE_API_URL']?.replace(/\/$/, '') ?? 'http://localhost:3000',
     apiKey: process.env['FEEDFORGE_API_KEY'] ?? '',
   };
   ```

2. `src/api-client.ts`:
   ```ts
   import { UserError } from './errors.js';
   import { env } from './env.js';

   async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
     if (!env.apiKey) throw new UserError('FEEDFORGE_API_KEY not set');
     const res = await fetch(`${env.apiUrl}${path}`, {
       method,
       headers: { 'X-API-Key': env.apiKey, 'content-type': 'application/json' },
       body: body ? JSON.stringify(body) : undefined,
     });
     if (!res.ok) {
       const text = await res.text();
       throw new UserError(`API ${res.status}: ${text}`);
     }
     return res.json() as Promise<T>;
   }

   export const api = {
     get: <T>(path: string) => request<T>('GET', path),
     post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
   };
   ```

3. `commands/crawl.ts`:
   ```ts
   import { api } from '../api-client.js';

   export async function runCrawl(args: CrawlArgs): Promise<void> {
     const job = await api.post<{ jobId: string; status: string }>('/crawl', {
       site: args.site, feed: args.feed, tag: args.tag, limit: args.limit,
     });
     console.log(`[${args.site}] job ${job.jobId} enqueued`);
     while (true) {
       await new Promise(r => setTimeout(r, 2000));
       const j = await api.get<{ status: string; inserted: number; updated: number; error?: string }>(`/crawl/${job.jobId}`);
       if (j.status === 'done') {
         console.log(`[${args.site}] done. inserted=${j.inserted} updated=${j.updated}`);
         return;
       }
       if (j.status === 'failed') {
         console.error(`[${args.site}] failed: ${j.error}`);
         process.exit(2);
       }
       console.log(`  status=${j.status}`);
     }
   }
   ```

4. `commands/list.ts`:
   ```ts
   import { api } from '../api-client.js';
   import { truncateSummary } from './truncate.js';  // export from existing file

   interface Article { id: string; source: string; url: string; title: string; published_at: string | null; crawled_at: string; publisher: string | null; author: string | null; summary: string | null; tags: string[]; }

   export async function runList(args: ListArgs): Promise<void> {
     const params = new URLSearchParams({ limit: String(args.limit), offset: String(args.offset) });
     if (args.source) params.set('source', args.source);
     const data = await api.get<{ items: Article[]; total: number }>(`/articles?${params}`);
     if (args.json) { console.log(JSON.stringify(data.items, null, 2)); return; }
     for (const row of data.items) {
       const when = row.published_at ?? row.crawled_at;
       console.log(`${when} | ${row.title}`);
       console.log(`  ${row.url}`);
       if (row.publisher || row.author) console.log(`  ${[row.publisher, row.author].filter(Boolean).join(' / by ')}`);
       if (row.tags.length) console.log(`  tags: ${row.tags.join(', ')}`);
       if (row.summary) console.log(`  > ${truncateSummary(row.summary, args.truncate)}`);
       console.log();
     }
     console.log(`(${data.items.length} shown, offset=${args.offset}, total=${data.total})`);
   }
   ```

5. Move `truncateSummary` từ `commands/list.ts` ra `commands/truncate.ts` để export rõ.

6. `package.json`:
   ```json
   "dependencies": {
     "commander": "^14.0.3"
   },
   "devDependencies": {
     "vitest": "^4.1.5"
   }
   ```

7. `index.ts`: drop `listSites()` import, hardcode supported sites trong help OR fetch GET /sources tại runtime cho help text (over-engineering; just hardcode).

8. Smoke test:
   ```bash
   # terminal A
   pnpm --filter @crawler/api dev
   # terminal B
   FEEDFORGE_API_KEY=change-me-admin pnpm cli crawl daily-dev --limit 5
   FEEDFORGE_API_KEY=change-me-read pnpm cli list --source daily-dev --limit 3
   ```

## Todo list

- [ ] Create `env.ts` + `api-client.ts`
- [ ] Move `truncateSummary` ra `truncate.ts`
- [ ] Rewrite `crawl.ts` (POST + poll)
- [ ] Rewrite `list.ts` (GET /articles)
- [ ] Delete `db-path.ts`, `registry.ts`
- [ ] Update `package.json` (drop crawler workspace deps)
- [ ] Update `index.ts` (static site list trong help)
- [ ] `pnpm install` + verify CLI vẫn xài được
- [ ] Smoke test end-to-end với API server đang chạy
- [ ] `pnpm typecheck` xanh

## Success criteria

- `pnpm cli crawl daily-dev --limit 5` produces same output as before, end-to-end qua HTTP
- `pnpm cli list --source daily-dev` returns rows từ API
- Existing CLI tests (truncate) vẫn xanh sau khi move file
- Helper messages clear khi `FEEDFORGE_API_KEY` thiếu hoặc API server down

## Risks

| Risk | Mitigation |
|---|---|
| API server không chạy → CLI fail | Friendly error: "Cannot connect to {apiUrl}. Run pnpm api:dev first." |
| Polling loop bị stuck nếu worker chậm | Add timeout: max 5 min wait, then exit với warning |
| Site list trong CLI help out-of-date với server | Hardcode + document; nếu user muốn always-fresh thì gọi GET /sources lazy |

## Next steps

→ Phase 5: integration tests qua `app.fetch()` (in-process Hono testing).
