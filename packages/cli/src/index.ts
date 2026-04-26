#!/usr/bin/env node
import { Command } from 'commander';
import { runCrawl } from './commands/crawl.js';
import { runList } from './commands/list.js';
import { UserError } from './errors.js';

const SUPPORTED_SITES = ['daily-dev', 'dev-to', 'hacker-news'];

function parseIntFlag(name: string) {
  return (value: string): number => {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) {
      throw new UserError(`--${name} must be an integer`);
    }
    return n;
  };
}

const program = new Command();
program
  .name('crawler')
  .description('feedforge CLI — thin client of the @crawler/api server')
  .version('0.1.0');

program
  .command('crawl <site>')
  .description(`crawl a site (available: ${SUPPORTED_SITES.join(', ')})`)
  .option('--feed <type>', "feed type: 'popular' or 'search'", 'popular')
  .option('--tag <tag>', 'required when --feed=search')
  .option('--limit <n>', 'maximum items to fetch (max 50)', parseIntFlag('limit'), 10)
  .action(async (site: string, opts: Record<string, unknown>) => {
    await runCrawl({
      site,
      feed: String(opts['feed']),
      tag: opts['tag'] as string | undefined,
      limit: opts['limit'] as number,
    });
  });

program
  .command('list')
  .description('list articles from the API')
  .requiredOption('--source <name>', 'source name (e.g. daily-dev)')
  .option('--limit <n>', 'rows', parseIntFlag('limit'), 10)
  .option('--offset <n>', 'offset', parseIntFlag('offset'), 0)
  .option('--truncate <n>', 'truncate summary to N chars (default: full)', parseIntFlag('truncate'))
  .option('--json', 'print rows as JSON array (full data including raw_json + tags)', false)
  .action(async (opts: Record<string, unknown>) => {
    await runList({
      source: String(opts['source']),
      limit: opts['limit'] as number,
      offset: opts['offset'] as number,
      truncate: (opts['truncate'] as number | undefined) ?? null,
      json: Boolean(opts['json']),
    });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof UserError) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
  console.error(err);
  process.exit(2);
});
