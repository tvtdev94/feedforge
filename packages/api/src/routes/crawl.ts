import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { AuthEnv } from '../auth.js';
import type { JobsRepository } from '../jobs-repo.js';
import type { JobWorker } from '../job-worker.js';
import { CreateCrawlBody, IdParam } from '../schemas.js';

export interface CrawlDeps {
  jobs: JobsRepository;
  worker: JobWorker;
}

export function crawlRoute(deps: CrawlDeps): Hono<AuthEnv> {
  const r = new Hono<AuthEnv>();

  r.post('/', zValidator('json', CreateCrawlBody), (c) => {
    const body = c.req.valid('json');
    const job = deps.jobs.create({
      site: body.site,
      feed: body.feed,
      tag: body.tag ?? null,
      limit: body.limit,
    });
    deps.worker.scheduleNext();
    return c.json({ jobId: job.id, status: job.status }, 202);
  });

  r.get('/:id', zValidator('param', IdParam), (c) => {
    const { id } = c.req.valid('param');
    const job = deps.jobs.getById(id);
    if (!job) {
      return c.json(
        { error: { code: 'not_found', message: `job ${id} not found` } },
        404,
      );
    }
    return c.json(job);
  });

  return r;
}
