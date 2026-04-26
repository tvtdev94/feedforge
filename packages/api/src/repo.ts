import { ArticleRepository, openDb, type Db } from '@crawler/core';
import { resolveDbPath } from './db-path.js';
import type { AppEnv } from './env.js';
import { JobsRepository } from './jobs-repo.js';
import { JobWorker } from './job-worker.js';
import { getCrawler } from './crawler-registry.js';

export interface RepoBundle {
  db: Db;
  articles: ArticleRepository;
  jobs: JobsRepository;
  worker: JobWorker;
}

/** Open DB once + create repository + worker singletons. Caller wires
 *  shutdown. Worker uses production registry; tests call `JobWorker`
 *  directly with an injected `getCrawler`. */
export function openRepo(env: Pick<AppEnv, 'CRAWLER_DB'>): RepoBundle {
  const dbPath = resolveDbPath(env.CRAWLER_DB);
  const db = openDb(dbPath);
  const articles = new ArticleRepository(db);
  const jobs = new JobsRepository(db);
  const worker = new JobWorker(jobs, articles, getCrawler);
  return { db, articles, jobs, worker };
}
