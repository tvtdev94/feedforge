import { api } from '../api-client.js';
import { UserError } from '../errors.js';

export interface CrawlArgs {
  site: string;
  feed: string;
  tag?: string;
  limit: number;
}

interface JobResponse {
  id: string;
  jobId?: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  inserted: number;
  updated: number;
  error: string | null;
}

const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 5 * 60 * 1000;

export async function runCrawl(args: CrawlArgs): Promise<void> {
  if (args.feed === 'search' && !args.tag) {
    throw new UserError(`--tag is required when --feed=search`);
  }
  if (!Number.isFinite(args.limit) || args.limit < 1) {
    throw new UserError(`--limit must be a positive integer`);
  }

  const enqueued = await api.post<{ jobId: string; status: string }>('/crawl', {
    site: args.site,
    feed: args.feed,
    tag: args.tag,
    limit: args.limit,
  });
  console.log(`[${args.site}] job ${enqueued.jobId} enqueued`);

  const startedAt = Date.now();
  let lastStatus = enqueued.status;
  // Tolerate transient API hiccups (server restart mid-job, brief network
  // blip). Job state is server-side persistent so retrying is always safe.
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 3;
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    await sleep(POLL_INTERVAL_MS);
    let job: JobResponse;
    try {
      job = await api.get<JobResponse>(`/crawl/${enqueued.jobId}`);
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        throw err;
      }
      console.log(`  poll ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS} failed, retrying...`);
      continue;
    }
    if (job.status !== lastStatus) {
      console.log(`  status=${job.status}`);
      lastStatus = job.status;
    }
    if (job.status === 'done') {
      console.log(
        `[${args.site}] done. inserted=${job.inserted} updated=${job.updated}`,
      );
      return;
    }
    if (job.status === 'failed') {
      throw new UserError(`crawl failed: ${job.error ?? 'unknown error'}`);
    }
  }
  throw new UserError(
    `crawl timed out after ${MAX_WAIT_MS / 1000}s (job still pending/running)`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
