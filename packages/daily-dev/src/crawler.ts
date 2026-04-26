import type { Article, Crawler, CrawlOptions } from '@crawler/core';
import { DailyDevClient, type ClientOptions } from './client.js';
import { ANONYMOUS_FEED, TAG_FEED } from './queries.js';
import { FeedResponseSchema } from './schema.js';
import { mapPostToArticle, SOURCE_NAME } from './mapper.js';

const DEFAULT_LIMIT = 50;
/** Daily.dev caps per-page; keep conservative to be polite + small payloads. */
const PAGE_SIZE = 30;

export interface DailyDevCrawlerOptions {
  client?: DailyDevClient;
  clientOptions?: ClientOptions;
}

export class DailyDevCrawler implements Crawler {
  readonly name = SOURCE_NAME;
  private readonly client: DailyDevClient;

  constructor(opts: DailyDevCrawlerOptions = {}) {
    this.client = opts.client ?? new DailyDevClient(opts.clientOptions);
  }

  async *crawl(options: CrawlOptions): AsyncIterable<Article> {
    const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
    let yielded = 0;
    let cursor: string | null = null;

    while (yielded < limit) {
      const remaining = limit - yielded;
      const first = Math.min(PAGE_SIZE, remaining);
      const { query, variables } = this.buildQuery(options, cursor, first);
      const raw = await this.client.request<unknown>(query, variables);
      const parsed = FeedResponseSchema.parse(raw);

      for (const edge of parsed.page.edges) {
        if (yielded >= limit) break;
        yield mapPostToArticle(edge.node);
        yielded++;
      }

      if (!parsed.page.pageInfo.hasNextPage) break;
      cursor = parsed.page.pageInfo.endCursor;
      if (!cursor) break;
    }
  }

  private buildQuery(
    opts: CrawlOptions,
    after: string | null,
    first: number,
  ): { query: string; variables: Record<string, unknown> } {
    if (opts.feed === 'search') {
      if (!opts.tag) {
        throw new Error(
          `daily-dev: --tag is required when feed='search' (free-text query is not supported in phase 1)`,
        );
      }
      return {
        query: TAG_FEED,
        variables: { first, after, tag: opts.tag, ranking: 'POPULARITY' },
      };
    }
    return {
      query: ANONYMOUS_FEED,
      variables: { first, after, ranking: 'POPULARITY' },
    };
  }
}
