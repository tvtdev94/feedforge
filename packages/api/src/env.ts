import { z } from 'zod';

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  FEEDFORGE_READ_KEY: z.string().min(1, 'FEEDFORGE_READ_KEY is required'),
  FEEDFORGE_ADMIN_KEY: z.string().min(1, 'FEEDFORGE_ADMIN_KEY is required'),
  CRAWLER_DB: z.string().optional(),
});

export type AppEnv = z.infer<typeof Env>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return Env.parse(source);
}
