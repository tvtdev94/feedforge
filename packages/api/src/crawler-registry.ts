import type { Crawler } from '@crawler/core';
import { DailyDevCrawler } from '@crawler/daily-dev';
import { DevToCrawler } from '@crawler/dev-to';
import { HackerNewsCrawler } from '@crawler/hacker-news';

export type CrawlerFactory = () => Crawler;

const REGISTRY: Record<string, CrawlerFactory> = {
  'daily-dev': () => new DailyDevCrawler(),
  'hacker-news': () => new HackerNewsCrawler(),
  'dev-to': () => new DevToCrawler(),
};

export function getCrawler(name: string): Crawler {
  const factory = REGISTRY[name];
  if (!factory) {
    throw new Error(
      `unknown site '${name}'. Available: ${Object.keys(REGISTRY).sort().join(', ')}`,
    );
  }
  return factory();
}

export const SITES = Object.keys(REGISTRY).sort();
