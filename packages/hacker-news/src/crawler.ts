import type { Article, Crawler, CrawlOptions } from '@crawler/core';

export const SOURCE_NAME = 'hacker-news';

/**
 * Skeleton implementation for the Hacker News crawler.
 *
 * This file shows the shape every site package should follow. Replace the
 * TODOs with real logic, then this site will start producing articles via
 * the same `crawler crawl <site>` CLI as `daily-dev`.
 *
 * Suggested implementation outline:
 *   1. Fetch top story IDs:
 *        GET https://hacker-news.firebaseio.com/v0/topstories.json
 *      → number[] of story IDs.
 *   2. For each ID (respecting `options.limit`), fetch the item:
 *        GET https://hacker-news.firebaseio.com/v0/item/<id>.json
 *      → { id, title, url, by, time, score, descendants, ... }.
 *   3. Skip items where `url` is missing (Ask HN posts) or map them to a
 *      `permalink` of `https://news.ycombinator.com/item?id=<id>`.
 *   4. Map to `Article`:
 *        externalId  = String(item.id)
 *        url         = item.url ?? `https://news.ycombinator.com/item?id=${item.id}`
 *        title       = item.title
 *        author      = item.by
 *        publishedAt = new Date(item.time * 1000).toISOString()
 *        publisher   = new URL(item.url).hostname (when url present)
 *        tags        = []  (HN has no tags; could derive from domain)
 *        rawJson     = JSON.stringify(item)
 *   5. Throttle requests (~5 rps is fine for the firebase API) and yield
 *      articles with `for await` so the CLI can persist them incrementally.
 *
 * For `options.feed === 'search'`, use the Algolia HN Search API:
 *        GET https://hn.algolia.com/api/v1/search?tags=story&query=<query>
 *
 * See `packages/daily-dev/` for a fully wired reference implementation
 * (GraphQL client, zod-validated mapper, throttle/retry, pagination).
 */
export class HackerNewsCrawler implements Crawler {
  readonly name = SOURCE_NAME;

  // eslint-disable-next-line @typescript-eslint/require-await
  async *crawl(_options: CrawlOptions): AsyncIterable<Article> {
    throw new Error(
      `${SOURCE_NAME}: not implemented yet — see packages/hacker-news/src/crawler.ts for the implementation outline.`,
    );
    // The yield is unreachable but keeps this method an async generator.
    // eslint-disable-next-line no-unreachable
    yield undefined as never;
  }
}
