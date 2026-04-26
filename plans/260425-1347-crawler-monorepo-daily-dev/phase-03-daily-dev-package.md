# Phase 03 — Daily-dev Package

**Status:** pending
**Priority:** P0
**Estimated effort:** 2-3 hrs
**Blocked by:** Phase 2

## Context Links
- [plan.md](plan.md)
- [phase-02 core](phase-02-core-package.md)

## Overview
Implement crawler đầu tiên: daily.dev. Gọi GraphQL API public (`https://api.daily.dev/graphql`) cho 2 feed: popular (anonymousFeed) và search by tag (tagFeed) / keyword (searchPosts). Validate response bằng zod, map sang `Article`, expose `DailyDevCrawler` implements `Crawler`.

## Key Insights
- Daily.dev GraphQL public, KHÔNG cần auth cho `anonymousFeed` và `tagFeed`/`searchPosts`
- Pagination cursor-based: `pageInfo { hasNextPage, endCursor }` + `edges { node }`
- Một số field có thể `null` — zod cần `.nullable()` đúng chỗ
- Throttle 1 req/s + retry exponential cho 429/5xx → tránh bị rate-limit
- Lưu raw payload vào `rawJson` ngay từ đầu

## Requirements

### Functional
- Class `DailyDevCrawler implements Crawler` với `name = 'daily-dev'`
- Hỗ trợ `feed: 'popular' | 'search'`
  - popular → query `anonymousFeed` mặc định (ranking RANK)
  - search + tag → query `tagFeed`
  - search + query → query `searchPostSuggestions` hoặc `searchQuery` (dùng cái public)
- Pagination tự động cho đến khi đạt `limit` hoặc hết data
- Throttle ≥ 1s giữa request, retry với backoff
- Map đầy đủ fields về `Article`

### Non-functional
- Validate API response bằng zod, không crash khi field thiếu
- User-Agent rõ ràng: `crawler/0.1 (+https://github.com/<user>/crawler)`
- Timeout 15s cho mỗi request

## Architecture

### File tree
```
packages/daily-dev/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts             # export DailyDevCrawler
    ├── crawler.ts           # class DailyDevCrawler
    ├── client.ts            # GraphQL client wrapper (throttle + retry)
    ├── queries.ts           # GraphQL query strings
    ├── schema.ts            # zod schemas cho response
    ├── mapper.ts            # PostNode → Article
    └── __tests__/
        ├── mapper.test.ts
        └── schema.test.ts   # validate fixture payload
```

### GraphQL queries (essential subset)
```ts
// queries.ts
export const ANONYMOUS_FEED = `
  query AnonymousFeed($first: Int, $after: String, $ranking: Ranking) {
    page: anonymousFeed(first: $first, after: $after, ranking: $ranking) {
      pageInfo { hasNextPage, endCursor }
      edges {
        node {
          id
          url
          permalink
          title
          summary
          image
          createdAt
          tags
          source { name, image }
          author { name, username, image }
          numUpvotes
          numComments
        }
      }
    }
  }
`;

export const TAG_FEED = `
  query TagFeed($first: Int, $after: String, $tag: String!, $ranking: Ranking) {
    page: tagFeed(first: $first, after: $after, tag: $tag, ranking: $ranking) {
      pageInfo { hasNextPage, endCursor }
      edges { node { ...same fields... } }
    }
  }
`;

export const SEARCH_POSTS = `
  query SearchPosts($query: String!, $first: Int, $after: String) {
    page: searchPostSuggestions(query: $query) {
      hits { id title }
    }
  }
`;
```
**Note:** `searchPostSuggestions` chỉ trả id+title. Để lấy full data: dùng `tagFeed` khi user truyền tag, fallback `searchPostSuggestions` + sau đó fetch từng `post(id)` (hoặc nếu API có `feedByIds` thì dùng). **Phase 1: ưu tiên `tagFeed`, để search-by-query là TODO.**

### Client design (throttle + retry)
```ts
// client.ts
export interface ClientOptions {
  endpoint?: string;          // default api.daily.dev/graphql
  userAgent?: string;
  throttleMs?: number;        // default 1000
  maxRetries?: number;        // default 3
  timeoutMs?: number;         // default 15000
}

export class DailyDevClient {
  private lastRequestAt = 0;
  constructor(private readonly opts: Required<ClientOptions>) {}
  async request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    await this.throttle();
    return this.requestWithRetry(query, variables);
  }
  private async throttle() { /* sleep nếu cần */ }
  private async requestWithRetry<T>(...) { /* fetch + retry on 429/5xx */ }
}
```

### Mapper
```ts
// mapper.ts
import { nanoid } from 'nanoid';
import type { Article } from '@crawler/core';
import type { PostNode } from './schema.js';

export function mapPostToArticle(node: PostNode): Article {
  return {
    id: nanoid(),
    source: 'daily-dev',
    externalId: node.id,
    url: node.url,
    permalink: node.permalink ?? null,
    title: node.title,
    summary: node.summary ?? null,
    author: node.author?.name ?? null,
    publisher: node.source?.name ?? null,
    publisherImage: node.source?.image ?? null,
    imageUrl: node.image ?? null,
    publishedAt: node.createdAt ?? null,
    crawledAt: new Date().toISOString(),
    tags: node.tags ?? [],
    rawJson: JSON.stringify(node),
  };
}
```

### Crawler
```ts
// crawler.ts
import type { Crawler, CrawlOptions, Article } from '@crawler/core';
import { DailyDevClient } from './client.js';
import { ANONYMOUS_FEED, TAG_FEED } from './queries.js';
import { FeedResponseSchema } from './schema.js';
import { mapPostToArticle } from './mapper.js';

export class DailyDevCrawler implements Crawler {
  readonly name = 'daily-dev';
  constructor(private readonly client: DailyDevClient = new DailyDevClient({...defaults})) {}

  async *crawl(options: CrawlOptions): AsyncIterable<Article> {
    const limit = options.limit ?? 50;
    let yielded = 0;
    let cursor: string | null = null;
    const pageSize = Math.min(30, limit);

    while (yielded < limit) {
      const { query, variables } = this.buildQuery(options, cursor, pageSize);
      const raw = await this.client.request<unknown>(query, variables);
      const parsed = FeedResponseSchema.parse(raw);
      for (const edge of parsed.page.edges) {
        if (yielded >= limit) break;
        yield mapPostToArticle(edge.node);
        yielded++;
      }
      if (!parsed.page.pageInfo.hasNextPage) break;
      cursor = parsed.page.pageInfo.endCursor;
    }
  }

  private buildQuery(opts: CrawlOptions, after: string | null, first: number) {
    if (opts.feed === 'search' && opts.tag) {
      return { query: TAG_FEED, variables: { first, after, tag: opts.tag, ranking: 'POPULARITY' } };
    }
    return { query: ANONYMOUS_FEED, variables: { first, after, ranking: 'POPULARITY' } };
  }
}
```

## Related Code Files

### Create
- `packages/daily-dev/src/{index,crawler,client,queries,schema,mapper}.ts`
- `packages/daily-dev/src/__tests__/{mapper,schema}.test.ts`
- `packages/daily-dev/src/__tests__/fixtures/sample-feed-response.json`

### Modify
- `packages/daily-dev/package.json` — add deps: `graphql-request`, `zod`, `nanoid`. devDeps: `vitest`

## Implementation Steps

### Step 1 — Add deps
```bash
pnpm --filter @crawler/daily-dev add graphql-request zod nanoid
pnpm --filter @crawler/daily-dev add -D vitest
```

### Step 2 — `queries.ts`
Theo design ở Architecture (full GraphQL strings).

### Step 3 — `schema.ts` (zod)
```ts
import { z } from 'zod';

export const PostNodeSchema = z.object({
  id: z.string(),
  url: z.string(),
  permalink: z.string().nullable().optional(),
  title: z.string(),
  summary: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  source: z.object({
    name: z.string(),
    image: z.string().nullable().optional(),
  }).nullable().optional(),
  author: z.object({
    name: z.string().nullable().optional(),
    username: z.string().nullable().optional(),
    image: z.string().nullable().optional(),
  }).nullable().optional(),
  numUpvotes: z.number().nullable().optional(),
  numComments: z.number().nullable().optional(),
});

export type PostNode = z.infer<typeof PostNodeSchema>;

export const FeedResponseSchema = z.object({
  page: z.object({
    pageInfo: z.object({
      hasNextPage: z.boolean(),
      endCursor: z.string().nullable(),
    }),
    edges: z.array(z.object({ node: PostNodeSchema })),
  }),
});
```

### Step 4 — `client.ts`
- Dùng `graphql-request` với fetch wrapper
- Implement throttle: `await sleep(throttleMs - (now - lastRequestAt))`
- Implement retry: catch 429/5xx, exponential backoff 500ms, 1s, 2s
- AbortController với timeout

### Step 5 — `mapper.ts`
Theo design ở Architecture.

### Step 6 — `crawler.ts`
Theo design. Note `pageSize` = min(30, limit) để giảm payload.

### Step 7 — `index.ts`
```ts
export { DailyDevCrawler } from './crawler.js';
export { DailyDevClient } from './client.js';
```

### Step 8 — Tests
- `mapper.test.ts`: feed PostNode mock → assert Article fields đúng
- `schema.test.ts`: parse fixture JSON từ daily.dev (lưu sẵn) → không throw

### Step 9 — Manual smoke (optional, không bắt buộc trong phase này)
```bash
pnpm --filter @crawler/daily-dev exec tsx -e "
import { DailyDevCrawler } from './src/index.js';
const c = new DailyDevCrawler();
for await (const a of c.crawl({ feed: 'popular', limit: 3 })) console.log(a.title);
"
```

## Todo List
- [ ] Add deps graphql-request, zod, nanoid, vitest
- [ ] Viết `queries.ts` với ANONYMOUS_FEED + TAG_FEED
- [ ] Viết `schema.ts` zod schemas (PostNode, FeedResponse)
- [ ] Viết `client.ts` với throttle + retry + timeout
- [ ] Viết `mapper.ts` (PostNode → Article)
- [ ] Viết `crawler.ts` (DailyDevCrawler) + buildQuery + pagination loop
- [ ] Viết unit tests mapper + schema (dùng fixture JSON)
- [ ] Verify typecheck + test pass
- [ ] Manual smoke optional: crawl 3 bài popular thực tế

## Success Criteria
- `pnpm --filter @crawler/daily-dev typecheck` pass
- `pnpm --filter @crawler/daily-dev test` pass
- (Optional) Smoke crawl thực tế trả ≥ 3 Article hợp lệ với url + title + summary

## Risk Assessment
| Risk | Mitigation |
|---|---|
| Daily.dev đổi GraphQL schema | Lưu raw_json + zod default → không crash. Nếu crash → cập nhật schema |
| Rate limit 429 | Throttle 1s + retry exponential |
| Search-by-query phức tạp (cần fetch theo id) | Phase 1 chỉ implement search-by-tag. Search-by-query để TODO |
| Network flakiness | Timeout 15s + retry 3 lần |

## Security Considerations
- Không gửi credentials nào (anonymous queries)
- User-Agent có URL repo → minh bạch về crawler
- Validate strict response trước khi map → tránh inject data lạ vào DB

## Next Steps
→ Phase 4: CLI dispatcher consume Crawler từ phase này + repository từ phase 2

## Open Questions
- Search-by-query (free-text): có cần thiết phase 1 không, hay tag là đủ? (Hiện đề xuất: tag-only phase 1)
