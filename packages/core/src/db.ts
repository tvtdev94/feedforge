import Database from 'better-sqlite3';
import type { Database as BetterDb } from 'better-sqlite3';
import { MIGRATIONS } from './migrations.js';

/** Open (or create) the SQLite database at `path` and run any pending
 *  migrations. Use `:memory:` for tests. */
export function openDb(path: string): BetterDb {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function runMigrations(db: BetterDb): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    // Atomic per-migration: SQL + version bump commit/rollback together.
    // Without this, a partial-statement failure leaves user_version stale
    // and the next process replays already-applied DDL.
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.pragma(`user_version = ${m.version}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

export type Db = BetterDb;
