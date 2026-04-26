import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { ArticleRepository } from '@crawler/core';
import type { AuthEnv } from '../auth.js';
import { ListQuery, IdParam } from '../schemas.js';

export interface ArticlesDeps {
  articles: ArticleRepository;
}

export function articlesRoute(deps: ArticlesDeps): Hono<AuthEnv> {
  const r = new Hono<AuthEnv>();

  r.get('/', zValidator('query', ListQuery), (c) => {
    const q = c.req.valid('query');
    const items = deps.articles.listAcrossSources(q);
    const total = deps.articles.countAcrossSources({
      source: q.source,
      tag: q.tag,
      since: q.since,
    });
    const enriched = items.map((row) => ({
      ...row,
      tags: deps.articles.tagsOf(row.id),
    }));
    return c.json({
      items: enriched,
      total,
      limit: q.limit,
      offset: q.offset,
    });
  });

  r.get('/:id', zValidator('param', IdParam), (c) => {
    const { id } = c.req.valid('param');
    const row = deps.articles.findById(id);
    if (!row) {
      return c.json(
        { error: { code: 'not_found', message: `article ${id} not found` } },
        404,
      );
    }
    return c.json({ ...row, tags: deps.articles.tagsOf(id) });
  });

  return r;
}
