import { nanoid } from 'nanoid';
import type { Article } from '@crawler/core';
import type { PostNode } from './schema.js';

export const SOURCE_NAME = 'daily-dev';

/** Convert a daily.dev `PostNode` (validated upstream payload) into the shared
 *  `Article` shape stored in SQLite. The original payload is JSON-stringified
 *  into `rawJson` so future schema additions can be backfilled without
 *  re-crawling. */
export function mapPostToArticle(node: PostNode): Article {
  return {
    id: nanoid(),
    source: SOURCE_NAME,
    externalId: node.id,
    url: node.url,
    permalink: node.permalink ?? null,
    title: node.title,
    summary: node.summary ?? null,
    author: node.author?.name ?? node.author?.username ?? null,
    publisher: node.source?.name ?? null,
    publisherImage: node.source?.image ?? null,
    imageUrl: node.image ?? null,
    publishedAt: node.createdAt ?? null,
    crawledAt: new Date().toISOString(),
    tags: node.tags ?? [],
    rawJson: JSON.stringify(node),
  };
}
