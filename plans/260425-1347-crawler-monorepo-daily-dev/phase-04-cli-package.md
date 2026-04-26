# Phase 04 — CLI Package

**Status:** pending
**Priority:** P0
**Estimated effort:** 1-2 hrs
**Blocked by:** Phase 2, Phase 3

## Context Links
- [plan.md](plan.md)
- [phase-02 core](phase-02-core-package.md)
- [phase-03 daily-dev](phase-03-daily-dev-package.md)

## Overview
Implement CLI dispatcher (`commander`). Registry map `name → Crawler`. Hai lệnh chính: `crawl <site>` (chạy crawler + persist) và `list` (query DB). Khi thêm site mới chỉ cần thêm 1 dòng vào registry.

## Key Insights
- Registry pattern → giữ CLI logic generic, không hard-code per-site
- CLI dùng `tsx` để run TS trực tiếp trong dev → không cần build dist
- Bin entry point có shebang `#!/usr/bin/env -S npx tsx` cho cross-platform run
- DB path mặc định `data/crawler.db` ở root, override được bằng `--db <path>` hoặc env `CRAWLER_DB`

## Requirements

### Functional
- `crawler crawl <site> [options]`
  - `--feed <popular|search>` (default popular)
  - `--tag <tag>`
  - `--limit <number>` (default 50)
  - `--db <path>` (override DB)
- `crawler list [options]`
  - `--source <name>` (required)
  - `--limit <n>` (default 10)
  - `--offset <n>` (default 0)
  - `--db <path>`
- Error message rõ ràng khi:
  - Site không tồn tại trong registry
  - Tag thiếu khi feed=search
  - Network lỗi

### Non-functional
- Output progress khi crawl (số bài đã insert / cập nhật)
- Exit code: 0 success, 1 user error, 2 runtime error
- TTY output có color đẹp (optional, dùng `picocolors` nếu nhẹ)

## Architecture

### File tree
```
packages/cli/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts             # bin entry, commander setup
    ├── registry.ts          # name → CrawlerFactory
    ├── db-path.ts           # resolveDbPath helper
    └── commands/
        ├── crawl.ts
        └── list.ts
```

### Registry
```ts
// registry.ts
import type { Crawler } from '@crawler/core';
import { DailyDevCrawler } from '@crawler/daily-dev';

export type CrawlerFactory = () => Crawler;

export const REGISTRY: Record<string, CrawlerFactory> = {
  'daily-dev': () => new DailyDevCrawler(),
};

export function getCrawler(name: string): Crawler {
  const factory = REGISTRY[name];
  if (!factory) {
    const available = Object.keys(REGISTRY).join(', ');
    throw new Error(`Unknown site '${name}'. Available: ${available}`);
  }
  return factory();
}
```

**Khi thêm site mới:** import + thêm 1 dòng vào REGISTRY. Đó là toàn bộ thay đổi cần.

### Crawl command
```ts
// commands/crawl.ts
import { ArticleRepository, openDb } from '@crawler/core';
import { getCrawler } from '../registry.js';
import { resolveDbPath } from '../db-path.js';

export interface CrawlArgs {
  site: string;
  feed: 'popular' | 'search';
  tag?: string;
  limit: number;
  db?: string;
}

export async function runCrawl(args: CrawlArgs): Promise<void> {
  if (args.feed === 'search' && !args.tag) {
    throw new UserError(`--tag is required when --feed=search`);
  }
  const db = openDb(resolveDbPath(args.db));
  const repo = new ArticleRepository(db);
  const crawler = getCrawler(args.site);

  let inserted = 0, updated = 0, n = 0;
  console.log(`[${crawler.name}] starting crawl: feed=${args.feed} tag=${args.tag ?? '-'} limit=${args.limit}`);
  for await (const article of crawler.crawl({ feed: args.feed, tag: args.tag, limit: args.limit })) {
    const r = repo.upsert(article);
    if (r.created) inserted++; else updated++;
    n++;
    if (n % 10 === 0) console.log(`  progress: ${n}/${args.limit}`);
  }
  console.log(`[${crawler.name}] done. inserted=${inserted} updated=${updated} total=${n}`);
  db.close();
}

export class UserError extends Error {}
```

### List command
```ts
// commands/list.ts
export async function runList(args: { source: string; limit: number; offset: number; db?: string }) {
  const db = openDb(resolveDbPath(args.db));
  const repo = new ArticleRepository(db);
  const rows = repo.list({ source: args.source, limit: args.limit, offset: args.offset });
  for (const r of rows) {
    console.log(`${r.published_at ?? '-'} | ${r.title}`);
    console.log(`  ${r.url}`);
    if (r.summary) console.log(`  → ${r.summary.slice(0, 120)}${r.summary.length > 120 ? '…' : ''}`);
    console.log();
  }
  console.log(`(${rows.length} rows, total ${repo.count(args.source)})`);
  db.close();
}
```

### DB path resolver
```ts
// db-path.ts
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function resolveDbPath(override?: string): string {
  const path = override ?? process.env.CRAWLER_DB ?? resolve(process.cwd(), 'data', 'crawler.db');
  mkdirSync(dirname(path), { recursive: true });
  return path;
}
```

### Entry point
```ts
// index.ts
#!/usr/bin/env node
import { Command } from 'commander';
import { runCrawl, UserError } from './commands/crawl.js';
import { runList } from './commands/list.js';

const program = new Command();
program.name('crawler').description('Multi-site crawler').version('0.1.0');

program.command('crawl <site>')
  .option('--feed <feed>', 'feed type', 'popular')
  .option('--tag <tag>', 'tag filter')
  .option('--limit <n>', 'max items', (v) => parseInt(v, 10), 50)
  .option('--db <path>', 'sqlite path')
  .action(async (site, opts) => {
    await runCrawl({ site, feed: opts.feed, tag: opts.tag, limit: opts.limit, db: opts.db });
  });

program.command('list')
  .requiredOption('--source <name>', 'source name')
  .option('--limit <n>', 'rows', (v) => parseInt(v, 10), 10)
  .option('--offset <n>', 'offset', (v) => parseInt(v, 10), 0)
  .option('--db <path>', 'sqlite path')
  .action(async (opts) => {
    await runList(opts);
  });

program.parseAsync(process.argv).catch((err) => {
  if (err instanceof UserError) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
  console.error(err);
  process.exit(2);
});
```

## Related Code Files

### Create
- `packages/cli/src/index.ts`
- `packages/cli/src/registry.ts`
- `packages/cli/src/db-path.ts`
- `packages/cli/src/commands/crawl.ts`
- `packages/cli/src/commands/list.ts`

### Modify
- `packages/cli/package.json` — add dep `commander`. Optional `picocolors`.

## Implementation Steps

### Step 1 — Add deps
```bash
pnpm --filter @crawler/cli add commander
```

### Step 2 — Implement files theo design ở Architecture

### Step 3 — Wire bin trong `package.json`
```json
"bin": { "crawler": "./src/index.ts" }
```
(Khi dùng workspace + tsx, có thể chạy qua root script: `pnpm cli ...`)

### Step 4 — Add root convenience script
Trong root `package.json`:
```json
"scripts": {
  "cli": "pnpm --filter @crawler/cli exec tsx src/index.ts"
}
```

### Step 5 — Smoke manual
```bash
pnpm cli crawl daily-dev --feed popular --limit 5
pnpm cli list --source daily-dev --limit 5
```

## Todo List
- [ ] Add commander dep
- [ ] Implement `registry.ts` với daily-dev factory
- [ ] Implement `db-path.ts` resolver
- [ ] Implement `commands/crawl.ts` với UserError class
- [ ] Implement `commands/list.ts` với output format
- [ ] Implement `index.ts` (commander entry, error handler, exit codes)
- [ ] Wire root `cli` script
- [ ] Verify typecheck pass

## Success Criteria
- `pnpm typecheck` pass toàn bộ workspace
- `pnpm cli crawl daily-dev --feed popular --limit 5` chạy không crash, in progress, kết thúc với inserted/updated count
- `pnpm cli list --source daily-dev --limit 5` in ra rows
- `pnpm cli crawl unknown-site` exit 1 với message rõ ràng
- `pnpm cli crawl daily-dev --feed search` (thiếu tag) exit 1 với message rõ ràng

## Risk Assessment
| Risk | Mitigation |
|---|---|
| Bin shebang trên Windows | Khuyến khích chạy qua `pnpm cli` thay vì symlink bin |
| Long-running crawl bị Ctrl+C | DB transaction per upsert → state nhất quán dù bị ngắt |
| User truyền limit âm/0 | Validate trong runCrawl, throw UserError nếu < 1 |

## Security Considerations
- DB path do user truyền → resolve bằng `path.resolve` rồi mới mkdir, KHÔNG eval/concat shell

## Next Steps
→ Phase 5: smoke test end-to-end + README usage
