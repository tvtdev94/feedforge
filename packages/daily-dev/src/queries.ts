/** GraphQL queries against api.daily.dev. Anonymous (unauthenticated) only. */

const POST_FIELDS = `
  id
  url
  permalink
  title
  summary
  image
  createdAt
  tags
  source { name image }
  author { name username image }
  numUpvotes
  numComments
`;

export const ANONYMOUS_FEED = `
  query AnonymousFeed($first: Int, $after: String, $ranking: Ranking) {
    page: anonymousFeed(first: $first, after: $after, ranking: $ranking) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          ${POST_FIELDS}
        }
      }
    }
  }
`;

export const TAG_FEED = `
  query TagFeed($first: Int, $after: String, $tag: String!, $ranking: Ranking) {
    page: tagFeed(first: $first, after: $after, tag: $tag, ranking: $ranking) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          ${POST_FIELDS}
        }
      }
    }
  }
`;
