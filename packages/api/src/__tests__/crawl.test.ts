import { describe, it, expect } from 'vitest';
import {
  buildTestApp,
  fakeCrawler,
  makeArticle,
  adminReq,
  TEST_KEYS,
} from './test-helpers.js';

describe('POST /crawl + GET /crawl/:id', () => {
  it('rejects body missing required site field', async () => {
    const { app } = buildTestApp();
    const res = await app.fetch(
      adminReq('/crawl', {
        method: 'POST',
        body: JSON.stringify({ limit: 5 }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects feed=search without tag', async () => {
    const { app } = buildTestApp();
    const res = await app.fetch(
      adminReq('/crawl', {
        method: 'POST',
        body: JSON.stringify({ site: 'daily-dev', feed: 'search', limit: 5 }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects limit > 50', async () => {
    const { app } = buildTestApp();
    const res = await app.fetch(
      adminReq('/crawl', {
        method: 'POST',
        body: JSON.stringify({ site: 'daily-dev', limit: 100 }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 202 + jobId for valid POST', async () => {
    const { app } = buildTestApp();
    const res = await app.fetch(
      adminReq('/crawl', {
        method: 'POST',
        body: JSON.stringify({ site: 'daily-dev', limit: 5 }),
      }),
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: string; status: string };
    expect(body.jobId).toMatch(/^job_/);
    expect(body.status).toBe('pending');
  });

  it('GET /crawl/:id returns 404 for unknown jobId', async () => {
    const { app } = buildTestApp();
    const res = await app.fetch(
      new Request('http://test/crawl/job_nonexistent', {
        headers: { 'X-API-Key': TEST_KEYS.admin },
      }),
    );
    expect(res.status).toBe(404);
  });

  it('end-to-end: POST → drain → GET shows done with correct counts', async () => {
    const items = [makeArticle(), makeArticle(), makeArticle()];
    const { app, worker } = buildTestApp({
      getCrawler: () => fakeCrawler(items),
    });

    const post = await app.fetch(
      adminReq('/crawl', {
        method: 'POST',
        body: JSON.stringify({ site: 'daily-dev', limit: 5 }),
      }),
    );
    const { jobId } = (await post.json()) as { jobId: string };

    await worker.drain();

    const get = await app.fetch(
      new Request(`http://test/crawl/${jobId}`, {
        headers: { 'X-API-Key': TEST_KEYS.admin },
      }),
    );
    const job = (await get.json()) as {
      status: string;
      inserted: number;
      updated: number;
    };
    expect(job.status).toBe('done');
    expect(job.inserted).toBe(3);
    expect(job.updated).toBe(0);
  });

  it('end-to-end: re-running same articles → updated counts', async () => {
    const items = [makeArticle({ externalId: 'shared' })];
    const { app, worker, articles } = buildTestApp({
      getCrawler: () => fakeCrawler(items),
    });
    articles.upsert(items[0]!);

    const post = await app.fetch(
      adminReq('/crawl', {
        method: 'POST',
        body: JSON.stringify({ site: 'daily-dev', limit: 5 }),
      }),
    );
    const { jobId } = (await post.json()) as { jobId: string };

    await worker.drain();

    const get = await app.fetch(
      new Request(`http://test/crawl/${jobId}`, {
        headers: { 'X-API-Key': TEST_KEYS.admin },
      }),
    );
    const job = (await get.json()) as { status: string; updated: number; inserted: number };
    expect(job.status).toBe('done');
    expect(job.inserted).toBe(0);
    expect(job.updated).toBe(1);
  });
});
