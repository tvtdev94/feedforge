import {
  ArticleRepository,
  openDb,
  type Article,
  type Crawler,
  type Db,
} from '@crawler/core';
import { JobsRepository } from '../jobs-repo.js';
import { JobWorker, type GetCrawler } from '../job-worker.js';
import { buildApp } from '../app.js';
import type { Hono } from 'hono';
import type { AuthEnv } from '../auth.js';

export const TEST_KEYS = {
  read: 'test-read-key',
  admin: 'test-admin-key',
} as const;

export interface TestApp {
  app: Hono<AuthEnv>;
  db: Db;
  articles: ArticleRepository;
  jobs: JobsRepository;
  worker: JobWorker;
}

export function buildTestApp(opts: { getCrawler?: GetCrawler } = {}): TestApp {
  const db = openDb(':memory:');
  const articles = new ArticleRepository(db);
  const jobs = new JobsRepository(db);
  const getCrawler =
    opts.getCrawler ??
    (() => {
      throw new Error('test getCrawler not provided');
    });
  const worker = new JobWorker(jobs, articles, getCrawler);
  const app = buildApp({
    env: {
      FEEDFORGE_READ_KEY: TEST_KEYS.read,
      FEEDFORGE_ADMIN_KEY: TEST_KEYS.admin,
    },
    articles,
    jobs,
    worker,
  });
  return { app, db, articles, jobs, worker };
}

export function fakeCrawler(items: Article[]): Crawler {
  return {
    name: 'fake',
    async *crawl(): AsyncIterable<Article> {
      for (const a of items) yield a;
    },
  };
}

export function throwingCrawler(message = 'fake fail'): Crawler {
  return {
    name: 'fake',
    // eslint-disable-next-line require-yield
    async *crawl(): AsyncIterable<Article> {
      throw new Error(message);
    },
  };
}

let nextExternalId = 1;
export function makeArticle(overrides: Partial<Article> = {}): Article {
  const id = `ext_${nextExternalId++}`;
  return {
    id: `art_${id}`,
    source: 'daily-dev',
    externalId: id,
    url: `https://example.com/${id}`,
    permalink: null,
    title: `Title ${id}`,
    summary: `Summary ${id}`,
    author: 'Tester',
    publisher: 'example.com',
    publisherImage: null,
    imageUrl: null,
    publishedAt: '2026-04-25T10:00:00.000Z',
    crawledAt: '2026-04-25T13:00:00.000Z',
    tags: ['javascript'],
    rawJson: '{}',
    ...overrides,
  };
}

export function readReq(path: string): Request {
  return new Request(`http://test${path}`, {
    headers: { 'X-API-Key': TEST_KEYS.read },
  });
}

export function adminReq(
  path: string,
  init: RequestInit = {},
): Request {
  return new Request(`http://test${path}`, {
    ...init,
    headers: {
      'X-API-Key': TEST_KEYS.admin,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
}
