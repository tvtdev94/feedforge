import type { Crawler } from '@crawler/core';
import { DailyDevCrawler } from '@crawler/daily-dev';
import { DevToCrawler } from '@crawler/dev-to';
import { HackerNewsCrawler } from '@crawler/hacker-news';
import { UserError } from './errors.js';

export type CrawlerFactory = () => Crawler;

/**
 * Adding a new site? Three steps:
 *   1. Create `packages/<your-site>/` (copy `packages/daily-dev/` as a
 *      reference — it's the only fully implemented one). Or copy a skeleton
 *      from `packages/hacker-news/` or `packages/dev-to/` for less wiring.
 *   2. Add the workspace dep to `packages/cli/package.json` and run
 *      `pnpm install`.
 *   3. Add one line below: import the class, then map a stable kebab-case
 *      name to a zero-arg factory. That's it — no other CLI code changes.
 *
 * The skeleton entries (`hacker-news`, `dev-to`) ship as templates: they
 * type-check and appear in `--help`, but their `crawl()` throws until you
 * fill in the API calls. See each `crawler.ts` for the implementation
 * outline and a link to the public API.
 */
export const REGISTRY: Record<string, CrawlerFactory> = {
  'daily-dev': () => new DailyDevCrawler(),
  'hacker-news': () => new HackerNewsCrawler(), // skeleton — see packages/hacker-news/src/crawler.ts
  'dev-to': () => new DevToCrawler(), //         skeleton — see packages/dev-to/src/crawler.ts
};

export function getCrawler(name: string): Crawler {
  const factory = REGISTRY[name];
  if (!factory) {
    const available = Object.keys(REGISTRY).sort().join(', ');
    throw new UserError(
      `Unknown site '${name}'. Available: ${available || '(none)'}`,
    );
  }
  return factory();
}

export function listSites(): string[] {
  return Object.keys(REGISTRY).sort();
}
