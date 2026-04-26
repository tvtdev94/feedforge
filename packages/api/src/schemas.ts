import { z } from 'zod';

export const ListQuery = z.object({
  source: z.string().optional(),
  tag: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  since: z.string().datetime().optional(),
});

export const IdParam = z.object({ id: z.string().min(1) });

export const CreateCrawlBody = z
  .object({
    site: z.string().min(1),
    feed: z.enum(['popular', 'search']).default('popular'),
    tag: z.string().optional(),
    limit: z.number().int().min(1).max(50).default(10),
  })
  .refine((v) => v.feed !== 'search' || (v.tag !== undefined && v.tag.length > 0), {
    message: 'tag is required when feed=search',
    path: ['tag'],
  });

export type ListQuery = z.infer<typeof ListQuery>;
export type CreateCrawlBody = z.infer<typeof CreateCrawlBody>;
