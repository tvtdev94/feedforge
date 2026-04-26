/** SQLite migrations applied in version order. New migrations are appended;
 *  existing entries must never be edited once shipped. */

export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS articles (
        id              TEXT PRIMARY KEY,
        source          TEXT NOT NULL,
        external_id     TEXT NOT NULL,
        url             TEXT NOT NULL,
        permalink       TEXT,
        title           TEXT NOT NULL,
        summary         TEXT,
        author          TEXT,
        publisher       TEXT,
        publisher_image TEXT,
        image_url       TEXT,
        published_at    TEXT,
        crawled_at      TEXT NOT NULL,
        raw_json        TEXT,
        UNIQUE(source, external_id)
      );

      CREATE TABLE IF NOT EXISTS article_tags (
        article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
        tag        TEXT NOT NULL,
        PRIMARY KEY (article_id, tag)
      );

      CREATE INDEX IF NOT EXISTS idx_articles_source       ON articles(source);
      CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at);
      CREATE INDEX IF NOT EXISTS idx_article_tags_tag      ON article_tags(tag);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS jobs (
        id           TEXT PRIMARY KEY,
        site         TEXT NOT NULL,
        feed         TEXT NOT NULL,
        tag          TEXT,
        limit_n      INTEGER NOT NULL,
        status       TEXT NOT NULL CHECK(status IN ('pending','running','done','failed')),
        inserted     INTEGER NOT NULL DEFAULT 0,
        updated      INTEGER NOT NULL DEFAULT 0,
        error        TEXT,
        enqueued_at  TEXT NOT NULL,
        started_at   TEXT,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    `,
  },
];
