import { describe, it, expect } from 'vitest';
import { mapPostToArticle, SOURCE_NAME } from '../mapper.js';
import type { PostNode } from '../schema.js';

describe('mapPostToArticle', () => {
  it('maps a fully-populated post to an Article', () => {
    const node: PostNode = {
      id: 'post_1',
      url: 'https://example.com/a',
      permalink: 'https://daily.dev/posts/post_1',
      title: 'Hello',
      summary: 'world',
      image: 'https://example.com/i.png',
      createdAt: '2026-04-25T10:00:00.000Z',
      tags: ['js'],
      source: { name: 'example.com', image: 'https://example.com/l.png' },
      author: { name: 'Alice', username: 'alice', image: null },
      numUpvotes: 10,
      numComments: 1,
    };

    const article = mapPostToArticle(node);

    expect(article.source).toBe(SOURCE_NAME);
    expect(article.externalId).toBe('post_1');
    expect(article.url).toBe('https://example.com/a');
    expect(article.permalink).toBe('https://daily.dev/posts/post_1');
    expect(article.title).toBe('Hello');
    expect(article.summary).toBe('world');
    expect(article.author).toBe('Alice');
    expect(article.publisher).toBe('example.com');
    expect(article.publisherImage).toBe('https://example.com/l.png');
    expect(article.imageUrl).toBe('https://example.com/i.png');
    expect(article.publishedAt).toBe('2026-04-25T10:00:00.000Z');
    expect(article.tags).toEqual(['js']);
    expect(article.id).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(article.crawledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.parse(article.rawJson)).toEqual(node);
  });

  it('falls back through author.name → author.username → null', () => {
    const noName = mapPostToArticle({
      id: 'p',
      url: 'u',
      title: 't',
      author: { name: null, username: 'bob' },
    });
    expect(noName.author).toBe('bob');

    const noAuthor = mapPostToArticle({ id: 'p', url: 'u', title: 't' });
    expect(noAuthor.author).toBeNull();
  });

  it('handles minimal post (only required fields)', () => {
    const minimal = mapPostToArticle({
      id: 'p',
      url: 'https://x',
      title: 'T',
    });
    expect(minimal.summary).toBeNull();
    expect(minimal.permalink).toBeNull();
    expect(minimal.tags).toEqual([]);
    expect(minimal.publisher).toBeNull();
  });
});
