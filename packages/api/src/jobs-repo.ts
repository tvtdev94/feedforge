import type { Db } from '@crawler/core';
import { nanoid } from 'nanoid';

export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface JobRow {
  id: string;
  site: string;
  feed: string;
  tag: string | null;
  limit_n: number;
  status: JobStatus;
  inserted: number;
  updated: number;
  error: string | null;
  enqueued_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface CreateJobInput {
  site: string;
  feed: string;
  tag: string | null;
  limit: number;
}

export class JobsRepository {
  private readonly insertStmt;
  private readonly getByIdStmt;
  private readonly nextPendingStmt;
  private readonly markRunningStmt;
  private readonly markDoneStmt;
  private readonly markFailedStmt;
  private readonly recoverStuckStmt;

  constructor(private readonly db: Db) {
    this.insertStmt = db.prepare(`
      INSERT INTO jobs (id, site, feed, tag, limit_n, status, enqueued_at)
      VALUES (@id, @site, @feed, @tag, @limit_n, 'pending', @enqueued_at)
    `);
    this.getByIdStmt = db.prepare(`SELECT * FROM jobs WHERE id = ?`);
    this.nextPendingStmt = db.prepare(
      `SELECT * FROM jobs WHERE status = 'pending' ORDER BY enqueued_at LIMIT 1`,
    );
    this.markRunningStmt = db.prepare(
      `UPDATE jobs SET status = 'running', started_at = ? WHERE id = ? AND status = 'pending'`,
    );
    this.markDoneStmt = db.prepare(`
      UPDATE jobs SET status = 'done', inserted = ?, updated = ?, completed_at = ?
      WHERE id = ?
    `);
    // Persist progress on failure so a partial crawl doesn't lose its inserted/
    // updated counts.
    this.markFailedStmt = db.prepare(`
      UPDATE jobs SET status = 'failed', error = ?, inserted = ?, updated = ?,
        completed_at = ? WHERE id = ?
    `);
    // Sweep on boot: any job left 'running' from a prior crashed process.
    this.recoverStuckStmt = db.prepare(`
      UPDATE jobs SET status = 'failed',
        error = 'process crashed during run',
        completed_at = ?
      WHERE status = 'running'
    `);
  }

  create(input: CreateJobInput): JobRow {
    const id = `job_${nanoid()}`;
    const enqueuedAt = new Date().toISOString();
    this.insertStmt.run({
      id,
      site: input.site,
      feed: input.feed,
      tag: input.tag,
      limit_n: input.limit,
      enqueued_at: enqueuedAt,
    });
    return this.getById(id)!;
  }

  getById(id: string): JobRow | undefined {
    return this.getByIdStmt.get(id) as JobRow | undefined;
  }

  nextPending(): JobRow | undefined {
    return this.nextPendingStmt.get() as JobRow | undefined;
  }

  /** Atomic transition pending → running. Returns true iff this caller won the
   *  race (the row actually flipped). Workers MUST gate runJob on this. */
  markRunning(id: string): boolean {
    const result = this.markRunningStmt.run(new Date().toISOString(), id);
    return result.changes === 1;
  }

  markDone(id: string, inserted: number, updated: number): void {
    this.markDoneStmt.run(inserted, updated, new Date().toISOString(), id);
  }

  /** Records error AND persists partial progress (rows already upserted before
   *  the crawl threw). */
  markFailed(id: string, error: string, inserted = 0, updated = 0): void {
    this.markFailedStmt.run(error, inserted, updated, new Date().toISOString(), id);
  }

  /** Returns count of jobs reset from 'running' to 'failed'. */
  recoverStuck(): number {
    const result = this.recoverStuckStmt.run(new Date().toISOString());
    return result.changes;
  }
}
