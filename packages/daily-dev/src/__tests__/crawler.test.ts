import { describe, it, expect } from 'vitest';
import { DailyDevCrawler } from '../crawler.js';
import type { DailyDevClient } from '../client.js';

/** Minimal stub matching the surface DailyDevCrawler uses. */
function makeStubClient(pages: Array<{
  edges: Array<{ node: { id: string; url: string; title: string } }>;
  hasNextPage: boolean;
  endCursor: string | null;
}>): DailyDevClient {
  let i = 0;
  return {
    async request<T>(): Promise<T> {
      const page = pages[Math.min(i++, pages.length - 1)]!;
      return {
        page: {
          pageInfo: {
            hasNextPage: page.hasNextPage,
            endCursor: page.endCursor,
          },
          edges: page.edges,
        },
      } as unknown as T;
    },
  } as unknown as DailyDevClient;
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('DailyDevCrawler pagination guards', () => {
  it('breaks when API returns empty edges with hasNextPage=true', async () => {
    const client = makeStubClient([
      { edges: [], hasNextPage: true, endCursor: 'a' },
    ]);
    const crawler = new DailyDevCrawler({ client });
    const items = await collect(crawler.crawl({ feed: 'popular', limit: 50 }));
    expect(items).toEqual([]);
  });

  it('breaks when endCursor does not advance', async () => {
    const stuck = {
      edges: [
        { node: { id: 'p1', url: 'https://x.com/1', title: 't1' } },
      ],
      hasNextPage: true,
      endCursor: 'same-cursor',
    };
    // 3+ pages all returning the same cursor → would loop forever without guard.
    const client = makeStubClient([stuck, stuck, stuck, stuck, stuck]);
    const crawler = new DailyDevCrawler({ client });
    const items = await collect(crawler.crawl({ feed: 'popular', limit: 100 }));
    // First call: cursor=null → advances to 'same-cursor' (1 item).
    // Second call: cursor stays 'same-cursor' → guard breaks (1 more item).
    // Without the guard this would be ≥5 items (one per stub page).
    expect(items).toHaveLength(2);
  });

  it('respects limit across pages', async () => {
    const node = (id: string) => ({
      node: { id, url: `https://x.com/${id}`, title: id },
    });
    const client = makeStubClient([
      { edges: [node('1'), node('2')], hasNextPage: true, endCursor: 'c1' },
      { edges: [node('3'), node('4')], hasNextPage: true, endCursor: 'c2' },
    ]);
    const crawler = new DailyDevCrawler({ client });
    const items = await collect(crawler.crawl({ feed: 'popular', limit: 3 }));
    expect(items).toHaveLength(3);
  });
});
