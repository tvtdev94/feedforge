import { Hono } from 'hono';

export function healthRoute(): Hono {
  const r = new Hono();
  r.get('/', (c) =>
    c.json({ status: 'ok', uptimeSec: Math.round(process.uptime()) }),
  );
  return r;
}
