import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { FeedResponseSchema } from '../schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, 'fixtures', 'sample-feed-response.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown;

describe('FeedResponseSchema', () => {
  it('parses a representative payload with both rich and minimal nodes', () => {
    const parsed = FeedResponseSchema.parse(fixture);
    expect(parsed.page.edges).toHaveLength(2);
    expect(parsed.page.pageInfo.hasNextPage).toBe(true);
    expect(parsed.page.edges[0]?.node.title).toBe('How to Build a Crawler');
    expect(parsed.page.edges[1]?.node.summary).toBeNull();
  });

  it('rejects payloads missing required fields', () => {
    expect(() =>
      FeedResponseSchema.parse({
        page: {
          pageInfo: { hasNextPage: true, endCursor: null },
          edges: [{ node: { id: 'x' } }],
        },
      }),
    ).toThrow();
  });

  it('rejects non-URL strings in url field', () => {
    expect(() =>
      FeedResponseSchema.parse({
        page: {
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [{ node: { id: 'x', url: 'not-a-url', title: 't' } }],
        },
      }),
    ).toThrow();
  });
});
