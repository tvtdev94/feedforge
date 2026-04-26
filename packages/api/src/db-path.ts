import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_FILE = 'data/crawler.db';
const WORKSPACE_MARKERS = ['pnpm-workspace.yaml', 'pnpm-workspace.yml'];

/** Resolve the SQLite path with this precedence:
 *    1. explicit `override` arg (resolved against process.cwd())
 *    2. `<workspaceRoot>/data/crawler.db` (walks up from cwd)
 *  Returns ':memory:' verbatim. Ensures parent dir exists for file paths. */
export function resolveDbPath(override?: string): string {
  if (override === ':memory:') return override;

  const fromArg = override?.trim();
  let absolute: string;
  if (fromArg && fromArg.length > 0) {
    absolute = resolve(process.cwd(), fromArg);
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
    if (parent === dir) return start;
    dir = parent;
  }
}
