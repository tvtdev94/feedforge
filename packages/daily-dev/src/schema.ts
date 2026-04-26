import { z } from 'zod';

/** Subset of daily.dev `Post` GraphQL type we depend on. Anything else upstream
 *  can return is preserved via `rawJson` in the mapper. */
export const PostNodeSchema = z.object({
  id: z.string(),
  url: z.string(),
  permalink: z.string().nullable().optional(),
  title: z.string(),
  summary: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  source: z
    .object({
      name: z.string(),
      image: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  author: z
    .object({
      name: z.string().nullable().optional(),
      username: z.string().nullable().optional(),
      image: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  numUpvotes: z.number().nullable().optional(),
  numComments: z.number().nullable().optional(),
});

export type PostNode = z.infer<typeof PostNodeSchema>;

export const FeedResponseSchema = z.object({
  page: z.object({
    pageInfo: z.object({
      hasNextPage: z.boolean(),
      endCursor: z.string().nullable(),
    }),
    edges: z.array(z.object({ node: PostNodeSchema })),
  }),
});

export type FeedResponse = z.infer<typeof FeedResponseSchema>;
