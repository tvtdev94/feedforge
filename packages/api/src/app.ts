import { Hono } from 'hono';
import type { ArticleRepository } from '@crawler/core';
import { buildApiKeyAuth, requireAdmin, type AuthEnv } from './auth.js';
import type { AppEnv } from './env.js';
import type { JobsRepository } from './jobs-repo.js';
import type { JobWorker } from './job-worker.js';
import { healthRoute } from './routes/health.js';
import { articlesRoute } from './routes/articles.js';
import { sourcesRoute } from './routes/sources.js';
import { crawlRoute } from './routes/crawl.js';

export interface AppDeps {
  env: Pick<AppEnv, 'FEEDFORGE_READ_KEY' | 'FEEDFORGE_ADMIN_KEY'>;
  articles: ArticleRepository;
  jobs: JobsRepository;
  worker: JobWorker;
}

/** Factory builds a Hono app from injected deps. Tests inject in-memory
 *  ArticleRepository + test env keys; production wires real singletons. */
export function buildApp(deps: AppDeps): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  const apiKeyAuth = buildApiKeyAuth(deps.env);

  app.route('/health', healthRoute());

  app.use('/articles/*', apiKeyAuth);
  app.route('/articles', articlesRoute({ articles: deps.articles }));

  app.use('/sources/*', apiKeyAuth);
  app.route('/sources', sourcesRoute({ articles: deps.articles }));

  app.use('/crawl/*', apiKeyAuth, requireAdmin);
  app.route('/crawl', crawlRoute({ jobs: deps.jobs, worker: deps.worker }));

  app.onError((err, c) => {
    console.error('[api] error:', err);
    return c.json(
      { error: { code: 'internal', message: err.message } },
      500,
    );
  });

  app.notFound((c) =>
    c.json({ error: { code: 'not_found', message: 'route not found' } }, 404),
  );

  return app;
}
