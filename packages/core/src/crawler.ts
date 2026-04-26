import type { Article, CrawlOptions } from './types.js';

/** Contract every site-specific crawler package must implement. */
export interface Crawler {
  /** Stable identifier used by the CLI registry, e.g. "daily-dev". */
  readonly name: string;

  /** Yields articles lazily. Implementations are responsible for pagination,
   *  rate limiting, and respecting the `limit` option. */
  crawl(options: CrawlOptions): AsyncIterable<Article>;
}
