import { GraphQLClient, ClientError } from 'graphql-request';

export interface ClientOptions {
  endpoint?: string;
  userAgent?: string;
  /** Minimum gap (ms) enforced between consecutive requests. */
  throttleMs?: number;
  /** Total attempts on transient failures (429/5xx/network). */
  maxRetries?: number;
  /** Per-request abort timeout (ms). */
  timeoutMs?: number;
}

const DEFAULTS: Required<ClientOptions> = {
  endpoint: 'https://api.daily.dev/graphql',
  userAgent: 'crawler/0.1 (+https://github.com/local/crawler)',
  throttleMs: 1000,
  maxRetries: 3,
  timeoutMs: 15_000,
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Lightweight wrapper around graphql-request that throttles successive calls
 *  and retries transient errors with exponential backoff. */
export class DailyDevClient {
  private readonly opts: Required<ClientOptions>;
  private readonly inner: GraphQLClient;
  private lastRequestAt = 0;

  constructor(opts: ClientOptions = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.inner = new GraphQLClient(this.opts.endpoint, {
      headers: {
        'user-agent': this.opts.userAgent,
        'content-type': 'application/json',
      },
    });
  }

  async request<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    let attempt = 0;
    let lastError: unknown;
    while (attempt < this.opts.maxRetries) {
      attempt++;
      // Throttle inside the loop so retries also respect the rate limit
      // (backoff alone can be < throttleMs and hammer 429s).
      await this.throttle();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.opts.timeoutMs);
      try {
        const result = await this.inner.request<T>({
          document: query,
          variables,
          signal: ac.signal,
        });
        clearTimeout(timer);
        return result;
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
        if (!this.shouldRetry(err, ac.signal) || attempt >= this.opts.maxRetries) break;
        await sleep(backoffMs(attempt));
      }
    }
    throw lastError;
  }

  private async throttle(): Promise<void> {
    const wait = this.opts.throttleMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) await sleep(wait);
    // Stamp AFTER the wait so concurrent callers serialize through the gap.
    this.lastRequestAt = Date.now();
  }

  private shouldRetry(err: unknown, signal: AbortSignal): boolean {
    // Our own abort = timeout → retry. Anything else aborted (e.g. a future
    // caller signal) should not be retried.
    if (err instanceof Error && err.name === 'AbortError' && !signal.aborted) {
      return false;
    }
    if (err instanceof ClientError) {
      const status = err.response?.status;
      return status !== undefined && RETRYABLE_STATUS.has(status);
    }
    // network / timeout / unknown → retry
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  // 500ms, 1s, 2s, ...
  return 500 * 2 ** (attempt - 1);
}
