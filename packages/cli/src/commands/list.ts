import { ArticleRepository, openDb } from '@crawler/core';
import { resolveDbPath } from '../db-path.js';
import { UserError } from '../errors.js';

export interface ListArgs {
  source: string;
  limit: number;
  offset: number;
  truncate: number | null;
  json: boolean;
  db?: string;
}

export async function runList(args: ListArgs): Promise<void> {
  if (!Number.isFinite(args.limit) || args.limit < 1) {
    throw new UserError(`--limit must be a positive integer`);
  }
  if (!Number.isFinite(args.offset) || args.offset < 0) {
    throw new UserError(`--offset must be a non-negative integer`);
  }
  if (args.truncate !== null && (!Number.isFinite(args.truncate) || args.truncate < 1)) {
    throw new UserError(`--truncate must be a positive integer`);
  }

  const dbPath = resolveDbPath(args.db);
  const db = openDb(dbPath);
  try {
    const repo = new ArticleRepository(db);
    const rows = repo.list({
      source: args.source,
      limit: args.limit,
      offset: args.offset,
    });
    const total = repo.count(args.source);

    if (args.json) {
      const enriched = rows.map((r) => ({ ...r, tags: repo.tagsOf(r.id) }));
      console.log(JSON.stringify(enriched, null, 2));
      return;
    }

    if (rows.length === 0) {
      console.log(`(no rows for source='${args.source}', total=${total})`);
      return;
    }

    for (const row of rows) {
      const when = row.published_at ?? row.crawled_at;
      const tags = repo.tagsOf(row.id);
      console.log(`${when} | ${row.title}`);
      console.log(`  ${row.url}`);
      if (row.publisher || row.author) {
        const who = [row.publisher, row.author].filter(Boolean).join(' / by ');
        console.log(`  ${who}`);
      }
      if (tags.length > 0) {
        console.log(`  tags: ${tags.join(', ')}`);
      }
      if (row.summary) {
        console.log(`  > ${truncateSummary(row.summary, args.truncate)}`);
      }
      console.log();
    }
    console.log(
      `(${rows.length} shown, offset=${args.offset}, total in source=${total})`,
    );
  } finally {
    db.close();
  }
}

/** Truncate `summary` to `max` chars total. For `max < 4` the ellipsis won't
 *  fit, so hard-slice without the marker. */
export function truncateSummary(summary: string, max: number | null): string {
  if (max === null || summary.length <= max) return summary;
  if (max < 4) return summary.slice(0, max);
  return summary.slice(0, max - 3) + '...';
}
