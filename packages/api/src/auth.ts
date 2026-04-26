import { timingSafeEqual } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from './env.js';

export type Role = 'read' | 'admin';

export interface AuthEnv {
  Variables: { role: Role };
}

/** Constant-time string compare. Falls back to false on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Build X-API-Key middleware bound to a specific env (read/admin keys). Uses
 *  constant-time comparison to defeat timing side-channels. */
export function buildApiKeyAuth(env: Pick<AppEnv, 'FEEDFORGE_READ_KEY' | 'FEEDFORGE_ADMIN_KEY'>) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const key = c.req.header('X-API-Key');
    let role: Role | null = null;
    if (key && key.length > 0) {
      if (safeEqual(key, env.FEEDFORGE_ADMIN_KEY)) role = 'admin';
      else if (safeEqual(key, env.FEEDFORGE_READ_KEY)) role = 'read';
    }
    if (!role) {
      return c.json(
        { error: { code: 'unauthorized', message: 'invalid or missing X-API-Key' } },
        401,
      );
    }
    c.set('role', role);
    await next();
  });
}

export const requireAdmin = createMiddleware<AuthEnv>(async (c, next) => {
  if (c.get('role') !== 'admin') {
    return c.json(
      { error: { code: 'forbidden', message: 'admin role required' } },
      403,
    );
  }
  await next();
});
