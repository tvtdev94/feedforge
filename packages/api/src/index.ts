import { serve } from '@hono/node-server';
import { loadEnv } from './env.js';
import { openRepo } from './repo.js';
import { buildApp } from './app.js';

const env = loadEnv();
const repo = openRepo(env);
const app = buildApp({
  env,
  articles: repo.articles,
  jobs: repo.jobs,
  worker: repo.worker,
});

const recovered = repo.jobs.recoverStuck();
if (recovered > 0) console.log(`[boot] recovered ${recovered} stuck jobs → failed`);
repo.worker.scheduleNext();

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`);
});

async function shutdown(signal: string) {
  console.log(`[api] ${signal} received, closing...`);
  server.close(async () => {
    // Wait for any in-flight job tick to finish before closing the DB —
    // otherwise the worker will try to use closed prepared statements.
    await repo.worker.waitIdle();
    repo.db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
