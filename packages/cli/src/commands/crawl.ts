import { ArticleRepository, openDb } from '@crawler/core';
import type { CrawlOptions } from '@crawler/core';
import { resolveDbPath } from '../db-path.js';
import { UserError } from '../errors.js';
import { getCrawler } from '../registry.js';

export interface CrawlArgs {
  site: string;
  feed: string;
  tag?: string;
  limit: number;
  db?: string;
}

export async function runCrawl(args: CrawlArgs): Promise<void> {
  const feed = parseFeed(args.feed);
  if (feed === 'search' && !args.tag) {
    throw new UserError(`--tag is required when --feed=search`);
  }
  if (!Number.isFinite(args.limit) || args.limit < 1) {
    throw new UserError(`--limit must be a positive integer`);
  }

  const dbPath = resolveDbPath(args.db);
  const db = openDb(dbPath);
  try {
    const repo = new ArticleRepository(db);
    const crawler = getCrawler(args.site);

    const opts: CrawlOptions = { feed, tag: args.tag, limit: args.limit };
    console.log(
      `[${crawler.name}] crawling: feed=${feed} tag=${args.tag ?? '-'} limit=${args.limit} db=${dbPath}`,
    );

    let inserted = 0;
    let updated = 0;
    let total = 0;
    for await (const article of crawler.crawl(opts)) {
      const r = repo.upsert(article);
      if (r.inserted) inserted++;
      else updated++;
      total++;
      if (total % 10 === 0) {
        console.log(`  progress: ${total}/${args.limit}`);
      }
    }

    console.log(
      `[${crawler.name}] done. inserted=${inserted} updated=${updated} total=${total}`,
    );
  } finally {
    db.close();
  }
}

function parseFeed(value: string): 'popular' | 'search' {
  if (value === 'popular' || value === 'search') return value;
  throw new UserError(`--feed must be 'popular' or 'search' (got '${value}')`);
}
