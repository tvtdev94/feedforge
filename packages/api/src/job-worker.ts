import type {
  ArticleRepository,
  Crawler,
  CrawlOptions,
} from '@crawler/core';
import type { JobsRepository } from './jobs-repo.js';

export type GetCrawler = (name: string) => Crawler;

/** In-process job runner. One job at a time (mutex flag) so we don't hammer
 *  upstream APIs. Schedules itself via setImmediate after each kick. */
export class JobWorker {
  private processing = false;

  constructor(
    private readonly jobs: JobsRepository,
    private readonly articles: ArticleRepository,
    private readonly getCrawler: GetCrawler,
  ) {}

  /** Trigger drain in next tick. Idempotent: no-op if already running. */
  scheduleNext(): void {
    if (this.processing) return;
    setImmediate(() => {
      this.tick().catch((err) => {
        console.error('[worker] tick failed:', err);
      });
    });
  }

  /** For tests: drain synchronously (await all pending). */
  async drain(): Promise<void> {
    if (this.processing) return;
    await this.tick();
  }

  /** Resolves when the worker is no longer mid-tick. Used at shutdown so we
   *  don't close the DB while runJob still holds prepared statements open. */
  async waitIdle(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.processing && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
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
    // Atomic guard: if another tick already claimed this job, bail.
    if (!this.jobs.markRunning(id)) return;
    const job = this.jobs.getById(id);
    if (!job) return;
    let inserted = 0;
    let updated = 0;
    try {
      const crawler = this.getCrawler(job.site);
      const opts: CrawlOptions = {
        feed: job.feed as 'popular' | 'search',
        tag: job.tag ?? undefined,
        limit: job.limit_n,
      };
      for await (const article of crawler.crawl(opts)) {
        const r = this.articles.upsert(article);
        if (r.inserted) inserted++;
        else updated++;
      }
      this.jobs.markDone(id, inserted, updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Persist partial progress so caller sees N rows landed before the throw.
      this.jobs.markFailed(id, message, inserted, updated);
    }
  }
}
