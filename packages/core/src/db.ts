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
  const current = (db.pragma('user_version', { simple: true }) as number) ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.exec(m.sql);
    db.pragma(`user_version = ${m.version}`);
  }
}

export type Db = BetterDb;
