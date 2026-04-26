import type { Article, Crawler, CrawlOptions } from '@crawler/core';

export const SOURCE_NAME = 'dev-to';

/**
 * Skeleton implementation for the dev.to crawler.
 *
 * Replace the TODOs with real logic, then this site is reachable via
 * `crawler crawl dev-to ...` like `daily-dev`.
 *
 * Suggested implementation outline:
 *   1. Fetch articles list:
 *        GET https://dev.to/api/articles?per_page=30&page=<n>
 *      → array of { id, title, url, description, published_at, tag_list,
 *                    user { name, username, profile_image },
 *                    cover_image, ... }
 *   2. For `options.feed === 'search'`, use the `tag` query param:
 *        GET https://dev.to/api/articles?tag=<options.tag>&per_page=30&page=<n>
 *   3. Loop pages until `options.limit` is satisfied or the API returns an
 *      empty array (dev.to does not return a `hasNextPage`/cursor — page+1
 *      until empty).
 *   4. Map to `Article`:
 *        externalId  = String(item.id)
 *        url         = item.url
 *        title       = item.title
 *        summary     = item.description
 *        author      = item.user?.name ?? item.user?.username
 *        publisher   = 'dev.to'
 *        publisherImage = item.user?.profile_image
 *        imageUrl    = item.cover_image
 *        publishedAt = item.published_at
 *        tags        = item.tag_list ?? []
 *        rawJson     = JSON.stringify(item)
 *   5. Throttle ~1 rps (dev.to documents 30 req/30s on the public API) and
 *      yield each article; the CLI persists them incrementally.
 *
 * No auth needed for the public list endpoint. For per-user feeds you would
 * need an `api-key` header — out of scope for this skeleton.
 *
 * See `packages/daily-dev/` for a fully wired reference implementation.
 */
export class DevToCrawler implements Crawler {
  readonly name = SOURCE_NAME;

  // eslint-disable-next-line @typescript-eslint/require-await
  async *crawl(_options: CrawlOptions): AsyncIterable<Article> {
    throw new Error(
      `${SOURCE_NAME}: not implemented yet — see packages/dev-to/src/crawler.ts for the implementation outline.`,
    );
    // eslint-disable-next-line no-unreachable
    yield undefined as never;
  }
}
