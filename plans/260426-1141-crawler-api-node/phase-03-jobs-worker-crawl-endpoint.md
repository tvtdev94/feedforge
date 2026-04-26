---
phase: 3
name: POST /crawl + jobs-repo + setImmediate worker
priority: critical
status: pending
estimatedHours: 1.5
blockedBy: [phase-02]
---

# Phase 3: Async POST /crawl với jobs table + in-process worker

## Context

- Phase 1 đã add `jobs` table migration
- Phase 2 đã có Hono app + crawl route stub trả 501
- Brainstorm REVISION: in-process `setImmediate` worker, persistent jobs, KISS

## Overview

Implement async POST /crawl: validate body → INSERT job (pending) → schedule worker → trả 202 + jobId. Worker pull pending job → run crawler → upsert articles → update job status. GET /crawl/:id đọc trạng thái.

## Requirements

- `JobsRepository` quản lý CRUD cho `jobs` table
- POST /crawl: validate `{ site, feed='popular', tag?, limit≤50 }`, INSERT pending job, schedule worker, return 202 + jobId
- GET /crawl/:id: SELECT job, return 404 nếu không có
- Worker:
  - On startup, recover any `running` jobs → mark `failed` (last process crashed mid-run)
  - Trigger qua `setImmediate` khi POST /crawl mới
  - Process 1 job tại 1 thời điểm (mutex flag), tránh hammer API
  - On error: UPDATE status='failed', error message
  - On success: UPDATE status='done', inserted, updated, completed_at
- Cap `limit ≤ 50` trong validation
- Skeleton crawler (`hacker-news`, `dev-to`) throw → catch + mark failed với clear message

## Architecture

```
src/
├── jobs-repo.ts          create, getById, listPending, markRunning, markDone, markFailed, recoverStuck
├── job-worker.ts         singleton: scheduleNext(), tick(), runJob(jobId)
└── routes/crawl.ts       POST → create + scheduleNext; GET → getById
```

Worker uses an in-process flag `let processing = false` to serialize. `scheduleNext()` calls `setImmediate(tick)` if not already processing. `tick` pulls 1 pending, marks running, runs, marks done/failed, then re-schedules if more pending.

## Related code files

**Create:**
- `packages/api/src/jobs-repo.ts`
- `packages/api/src/job-worker.ts`

**Modify:**
- `packages/api/src/routes/crawl.ts` — replace stubs với real impl
- `packages/api/src/schemas.ts` — add `CreateCrawlBody` schema
- `packages/api/src/index.ts` — call `worker.recoverStuck()` + initial `scheduleNext()` on bootstrap

## Implementation steps

1. `src/jobs-repo.ts`:
   ```ts
   import type { Db } from '@crawler/core';
   import { nanoid } from 'nanoid';

   export interface JobRow {
     id: string; site: string; feed: string; tag: string | null;
     limit_n: number; status: 'pending' | 'running' | 'done' | 'failed';
     inserted: number; updated: number; error: string | null;
     enqueued_at: string; started_at: string | null; completed_at: string | null;
   }

   export class JobsRepository {
     private readonly insertStmt;
     private readonly getByIdStmt;
     private readonly nextPendingStmt;
     private readonly markRunningStmt;
     private readonly markDoneStmt;
     private readonly markFailedStmt;
     private readonly recoverStmt;

     constructor(private readonly db: Db) {
       // prepare statements...
     }

     create(input: { site: string; feed: string; tag: string | null; limit: number }): JobRow {
       const id = `job_${nanoid()}`;
       const now = new Date().toISOString();
       this.insertStmt.run({ id, ...input, limit_n: input.limit, status: 'pending', enqueued_at: now });
       return this.getById(id)!;
     }
     // getById, nextPending, markRunning, markDone, markFailed, recoverStuck
   }
   ```

2. SQL statements:
   - `INSERT INTO jobs (id, site, feed, tag, limit_n, status, enqueued_at) VALUES (@id, @site, @feed, @tag, @limit_n, @status, @enqueued_at)`
   - `SELECT * FROM jobs WHERE id = ?`
   - `SELECT * FROM jobs WHERE status = 'pending' ORDER BY enqueued_at LIMIT 1`
   - `UPDATE jobs SET status='running', started_at=? WHERE id=?`
   - `UPDATE jobs SET status='done', inserted=?, updated=?, completed_at=? WHERE id=?`
   - `UPDATE jobs SET status='failed', error=?, completed_at=? WHERE id=?`
   - `UPDATE jobs SET status='failed', error='process crashed during run' WHERE status='running'` (recover)

3. `src/job-worker.ts`:
   ```ts
   import type { ArticleRepository, CrawlOptions } from '@crawler/core';
   import type { JobsRepository } from './jobs-repo.js';
   import { getCrawler } from './crawler-registry.js';

   export class JobWorker {
     private processing = false;

     constructor(
       private readonly jobs: JobsRepository,
       private readonly articles: ArticleRepository,
     ) {}

     scheduleNext(): void {
       if (this.processing) return;
       setImmediate(() => this.tick().catch(err => console.error('[worker] tick failed:', err)));
     }

     private async tick(): Promise<void> {
       if (this.processing) return;
       this.processing = true;
       try {
         while (true) {
           const job = this.jobs.nextPending();
           if (!job) break;
           await this.runJob(job.id);
         }
       } finally {
         this.processing = false;
       }
     }

     private async runJob(id: string): Promise<void> {
       const job = this.jobs.markRunning(id);
       try {
         const crawler = getCrawler(job.site);
         const opts: CrawlOptions = {
           feed: job.feed as 'popular' | 'search',
           tag: job.tag ?? undefined,
           limit: job.limit_n,
         };
         let inserted = 0, updated = 0;
         for await (const article of crawler.crawl(opts)) {
           const r = this.articles.upsert(article);
           if (r.inserted) inserted++; else updated++;
         }
         this.jobs.markDone(id, inserted, updated);
       } catch (err) {
         this.jobs.markFailed(id, err instanceof Error ? err.message : String(err));
       }
     }
   }
   ```

4. `src/crawler-registry.ts` (copy 5 lines từ CLI):
   ```ts
   import { DailyDevCrawler } from '@crawler/daily-dev';
   import { DevToCrawler } from '@crawler/dev-to';
   import { HackerNewsCrawler } from '@crawler/hacker-news';
   const REGISTRY = {
     'daily-dev': () => new DailyDevCrawler(),
     'hacker-news': () => new HackerNewsCrawler(),
     'dev-to': () => new DevToCrawler(),
   } as const;
   export function getCrawler(name: string) {
     const f = REGISTRY[name as keyof typeof REGISTRY];
     if (!f) throw new Error(`unknown site '${name}'`);
     return f();
   }
   export const SITES = Object.keys(REGISTRY);
   ```

5. `src/schemas.ts` add:
   ```ts
   export const CreateCrawlBody = z.object({
     site: z.string().min(1),
     feed: z.enum(['popular', 'search']).default('popular'),
     tag: z.string().optional(),
     limit: z.number().int().min(1).max(50).default(10),
   }).refine(v => v.feed !== 'search' || v.tag, { message: 'tag required when feed=search', path: ['tag'] });
   ```

6. `src/routes/crawl.ts` — full impl:
   ```ts
   const r = new Hono();
   r.post('/', zValidator('json', CreateCrawlBody), (c) => {
     const body = c.req.valid('json');
     const job = jobs.create({ site: body.site, feed: body.feed, tag: body.tag ?? null, limit: body.limit });
     worker.scheduleNext();
     return c.json({ jobId: job.id, status: job.status }, 202);
   });
   r.get('/:id', zValidator('param', IdParam), (c) => {
     const job = jobs.getById(c.req.valid('param').id);
     if (!job) return c.json({ error: { code: 'not_found' } }, 404);
     return c.json(job);
   });
   ```

7. `src/repo.ts` mở rộng — export `jobs`, `worker` singletons:
   ```ts
   import { JobsRepository } from './jobs-repo.js';
   import { JobWorker } from './job-worker.js';
   export const jobs = new JobsRepository(db);
   export const worker = new JobWorker(jobs, articles);
   ```

8. `src/index.ts` — recover + initial schedule:
   ```ts
   import { jobs, worker } from './repo.js';
   const recovered = jobs.recoverStuck();
   if (recovered > 0) console.log(`[boot] recovered ${recovered} stuck jobs`);
   worker.scheduleNext();  // resume any pending from prior session
   serve(...);
   ```

9. Manual smoke:
   ```bash
   pnpm --filter @crawler/api dev
   curl -X POST localhost:3000/crawl -H "X-API-Key: change-me-admin" \
        -H "content-type: application/json" \
        -d '{"site":"daily-dev","limit":5}'
   # → 202 { jobId, status: "pending" }
   sleep 10
   curl localhost:3000/crawl/<jobId> -H "X-API-Key: change-me-admin"
   # → { ..., status: "done", inserted: 5, updated: 0 }
   curl localhost:3000/articles -H "X-API-Key: change-me-read"
   # → 5 articles
   ```

## Todo list

- [ ] `jobs-repo.ts` với 7 prepared statements + JobRow type
- [ ] `crawler-registry.ts` (5-line factory map)
- [ ] `job-worker.ts` với mutex flag + scheduleNext + runJob
- [ ] Update `repo.ts` export jobs + worker
- [ ] Update `routes/crawl.ts` real impl
- [ ] Update `schemas.ts` CreateCrawlBody
- [ ] Update `index.ts` recoverStuck + scheduleNext on boot
- [ ] Manual end-to-end smoke
- [ ] `pnpm typecheck` xanh

## Success criteria

- POST /crawl admin với valid body → 202 + jobId
- GET /crawl/:id → eventually `done` với inserted+updated chính xác
- Crash recovery: kill server giữa run → restart → job đó marked `failed`
- Skeleton site (hacker-news / dev-to) → job marked `failed` với message rõ ràng
- GET /articles trả rows real từ DB sau crawl xong

## Risks

| Risk | Mitigation |
|---|---|
| Race condition khi 2 POST /crawl đồng thời | `processing` flag + `nextPending` SELECT...LIMIT 1 atomic; SQLite WAL serializes |
| Worker tick lỗi unhandled | try/catch wrap toàn bộ runJob; markFailed luôn được gọi |
| `recoverStuck` chạy trước khi singleton init | Order trong `index.ts` rõ ràng: import repo (init) → recover → schedule → serve |
| Skeleton throws không catch được trong async generator | runJob's try/catch wrap for-await — covered |
| Job pending tích tụ khi crashloop | Document: monitor `SELECT count(*) FROM jobs WHERE status='pending'` |

## Next steps

→ Phase 4: refactor CLI để gọi vào API endpoints (POST /crawl + poll, GET /articles).
