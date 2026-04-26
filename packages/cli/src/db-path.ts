import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_FILE = 'data/crawler.db';
const WORKSPACE_MARKERS = ['pnpm-workspace.yaml', 'pnpm-workspace.yml'];

/** Resolve the SQLite path with this precedence:
 *    1. explicit `--db <path>` flag (resolved against process.cwd())
 *    2. `CRAWLER_DB` env var (resolved against process.cwd())
 *    3. `<workspaceRoot>/data/crawler.db`
 *  Walks up from `process.cwd()` to find the workspace root marker so the
 *  default DB lives at repo root regardless of which package script invoked
 *  the CLI. Ensures the parent directory exists before returning. */
export function resolveDbPath(override?: string): string {
  const fromArg = override?.trim();
  const fromEnv = process.env['CRAWLER_DB']?.trim();

  let absolute: string;
  if (fromArg && fromArg.length > 0) {
    absolute = resolve(process.cwd(), fromArg);
  } else if (fromEnv && fromEnv.length > 0) {
    absolute = resolve(process.cwd(), fromEnv);
  } else {
    absolute = resolve(findWorkspaceRoot(process.cwd()), DEFAULT_FILE);
  }

  mkdirSync(dirname(absolute), { recursive: true });
  return absolute;
}

function findWorkspaceRoot(start: string): string {
  let dir = start;
  while (true) {
    for (const marker of WORKSPACE_MARKERS) {
      if (existsSync(resolve(dir, marker))) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return start; // hit filesystem root, fall back
    dir = parent;
  }
}
