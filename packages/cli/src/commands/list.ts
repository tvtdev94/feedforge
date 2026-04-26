import { api } from '../api-client.js';
import { UserError } from '../errors.js';
import { truncateSummary } from './truncate.js';

export interface ListArgs {
  source: string;
  limit: number;
  offset: number;
  truncate: number | null;
  json: boolean;
}

interface ArticleItem {
  id: string;
  source: string;
  url: string;
  title: string;
  summary: string | null;
  publisher: string | null;
  author: string | null;
  published_at: string | null;
  crawled_at: string;
  tags: string[];
}

interface ListResponse {
  items: ArticleItem[];
  total: number;
  limit: number;
  offset: number;
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

  const params = new URLSearchParams({
    source: args.source,
    limit: String(args.limit),
    offset: String(args.offset),
  });
  const data = await api.get<ListResponse>(`/articles?${params}`);

  if (args.json) {
    console.log(JSON.stringify(data.items, null, 2));
    return;
  }

  if (data.items.length === 0) {
    console.log(`(no rows for source='${args.source}', total=${data.total})`);
    return;
  }

  for (const row of data.items) {
    const when = row.published_at ?? row.crawled_at;
    console.log(`${when} | ${row.title}`);
    console.log(`  ${row.url}`);
    if (row.publisher || row.author) {
      const who = [row.publisher, row.author].filter(Boolean).join(' / by ');
      console.log(`  ${who}`);
    }
    if (row.tags.length > 0) {
      console.log(`  tags: ${row.tags.join(', ')}`);
    }
    if (row.summary) {
      console.log(`  > ${truncateSummary(row.summary, args.truncate)}`);
    }
    console.log();
  }
  console.log(
    `(${data.items.length} shown, offset=${args.offset}, total=${data.total})`,
  );
}
