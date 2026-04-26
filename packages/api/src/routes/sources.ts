import { Hono } from 'hono';
import type { ArticleRepository } from '@crawler/core';
import type { AuthEnv } from '../auth.js';

export interface SourcesDeps {
  articles: ArticleRepository;
}

export function sourcesRoute(deps: SourcesDeps): Hono<AuthEnv> {
  const r = new Hono<AuthEnv>();
  r.get('/', (c) => {
    return c.json({ sources: deps.articles.listSources() });
  });
  return r;
}
