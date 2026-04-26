---
title: Multi-site Crawler Monorepo (Daily.dev first)
status: completed
created: 2026-04-25
completed: 2026-04-25
plan_dir: 260425-1347-crawler-monorepo-daily-dev
blockedBy: []
blocks: []
---

# Plan: Multi-site Crawler Monorepo (Daily.dev first)

**Brainstorm:** [`reports/brainstorm-260425-1347-crawler-monorepo-design.md`](../reports/brainstorm-260425-1347-crawler-monorepo-design.md)

## Goal

Dựng monorepo TypeScript crawl daily.dev (popular feed + search by tag/keyword) qua public GraphQL API, lưu SQLite, CLI one-shot. Scale được khi thêm site mới chỉ bằng cách tạo 1 package + 1 dòng registry.

## Phases

| # | Phase | Status | File |
|---|-------|--------|------|
| 1 | Bootstrap monorepo | completed | [phase-01-bootstrap-monorepo.md](phase-01-bootstrap-monorepo.md) |
| 2 | Core package (types, db, repository, interface) | completed | [phase-02-core-package.md](phase-02-core-package.md) |
| 3 | Daily-dev package (GraphQL client + crawler) | completed | [phase-03-daily-dev-package.md](phase-03-daily-dev-package.md) |
| 4 | CLI package (commander + registry + commands) | completed | [phase-04-cli-package.md](phase-04-cli-package.md) |
| 5 | Smoke test + README | completed | [phase-05-smoke-test-readme.md](phase-05-smoke-test-readme.md) |

## Key Dependencies

- Phase 2 blocked by Phase 1 (cần workspace setup)
- Phase 3 blocked by Phase 2 (cần Crawler interface + types)
- Phase 4 blocked by Phase 2 + 3 (cần repository + crawler đầu tiên)
- Phase 5 blocked by Phase 4 (cần CLI hoạt động)

## Success Criteria (toàn plan)

- `pnpm cli crawl daily-dev --feed popular --limit 50` chạy thành công, lưu DB không lỗi
- `pnpm cli crawl daily-dev --feed search --tag javascript --limit 50` trả ≥1 bài
- Re-run cùng command → 0 row mới (UNIQUE(source, external_id) hoạt động)
- `pnpm cli list --source daily-dev --limit 10` in ra rows
- `tsc --noEmit` pass mọi package
- Thêm site mới chỉ cần 1 package + 1 dòng registry, không sửa core

## Tech Stack (đã chốt từ brainstorm)

- pnpm workspaces, TypeScript strict
- `better-sqlite3`, `graphql-request`, `commander`, `zod`, `nanoid`, `tsx`
- Native `fetch` (Node 18+)
