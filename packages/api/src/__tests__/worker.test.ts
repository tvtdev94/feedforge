import { describe, it, expect } from 'vitest';
import { buildTestApp, throwingCrawler, fakeCrawler, makeArticle } from './test-helpers.js';

describe('JobWorker', () => {
  it('marks job as failed when crawler throws', async () => {
    const { jobs, worker } = buildTestApp({
      getCrawler: () => throwingCrawler('upstream 500'),
    });
    const job = jobs.create({ site: 'fake', feed: 'popular', tag: null, limit: 5 });
    await worker.drain();
    const after = jobs.getById(job.id);
    expect(after?.status).toBe('failed');
    expect(after?.error).toContain('upstream 500');
  });

  it('marks job as failed when registry rejects unknown site', async () => {
    const { jobs, worker } = buildTestApp({
      getCrawler: (name) => {
        throw new Error(`unknown site '${name}'`);
      },
    });
    const job = jobs.create({ site: 'mystery', feed: 'popular', tag: null, limit: 1 });
    await worker.drain();
    const after = jobs.getById(job.id);
    expect(after?.status).toBe('failed');
    expect(after?.error).toContain('unknown site');
  });

  it('processes multiple pending jobs in one drain', async () => {
    const { jobs, worker } = buildTestApp({
      getCrawler: () => fakeCrawler([makeArticle()]),
    });
    const j1 = jobs.create({ site: 'daily-dev', feed: 'popular', tag: null, limit: 1 });
    const j2 = jobs.create({ site: 'daily-dev', feed: 'popular', tag: null, limit: 1 });
    await worker.drain();
    expect(jobs.getById(j1.id)?.status).toBe('done');
    expect(jobs.getById(j2.id)?.status).toBe('done');
  });

  it('recoverStuck flips running jobs back to failed', async () => {
    const { jobs } = buildTestApp();
    const job = jobs.create({ site: 'x', feed: 'popular', tag: null, limit: 1 });
    jobs.markRunning(job.id);
    expect(jobs.getById(job.id)?.status).toBe('running');
    const recovered = jobs.recoverStuck();
    expect(recovered).toBe(1);
    expect(jobs.getById(job.id)?.status).toBe('failed');
  });

  it('persists partial progress when crawler throws after yielding rows', async () => {
    const partialCrawler = {
      name: 'partial',
      // eslint-disable-next-line require-yield
      async *crawl() {
        yield makeArticle();
        yield makeArticle();
        throw new Error('upstream died after 2 articles');
      },
    } as const;
    const { jobs, worker } = buildTestApp({ getCrawler: () => partialCrawler });
    const job = jobs.create({ site: 'partial', feed: 'popular', tag: null, limit: 5 });
    await worker.drain();
    const after = jobs.getById(job.id);
    expect(after?.status).toBe('failed');
    expect(after?.inserted).toBe(2);
    expect(after?.error).toContain('upstream died');
  });

  it('markRunning is idempotent — second caller bails (atomic guard)', () => {
    const { jobs } = buildTestApp();
    const job = jobs.create({ site: 'x', feed: 'popular', tag: null, limit: 1 });
    expect(jobs.markRunning(job.id)).toBe(true);
    // Second call: row no longer 'pending' → no rows updated → false.
    expect(jobs.markRunning(job.id)).toBe(false);
  });
});
