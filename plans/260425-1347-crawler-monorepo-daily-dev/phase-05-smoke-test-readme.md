# Phase 05 — Smoke Test + README

**Status:** pending
**Priority:** P1
**Estimated effort:** 30-45 min
**Blocked by:** Phase 4

## Context Links
- [plan.md](plan.md)
- [phase-04 cli](phase-04-cli-package.md)

## Overview
End-to-end validation và document onboarding. Chạy crawl thực tế từ daily.dev, verify dedupe, viết README đủ cho user mới clone repo và chạy được trong < 5 phút.

## Key Insights
- Smoke test chạy thực tế (live API), không mock — verify integration hoạt động end-to-end
- README phải có troubleshooting section cho better-sqlite3 native build (lỗi phổ biến nhất trên Windows)
- Document cách thêm site mới (developer experience cho future contributor / future self)

## Requirements

### Functional (smoke test scenarios)
1. **Fresh DB**: xóa `data/crawler.db`, chạy `crawl daily-dev --feed popular --limit 10` → expect inserted=10, updated=0
2. **Re-run dedupe**: chạy lại cùng command → expect inserted=0, updated=10
3. **Search by tag**: `crawl daily-dev --feed search --tag javascript --limit 20` → expect ≥ 1 article có `javascript` trong tags
4. **List**: `list --source daily-dev --limit 5` → in ra 5 rows hợp lệ
5. **Error handling**: `crawl unknown` → exit 1, message rõ
6. **Error handling**: `crawl daily-dev --feed search` (thiếu tag) → exit 1

### README sections
- Quick start (install, first crawl)
- CLI usage (crawl, list)
- Architecture overview (link sang plans nếu cần)
- Adding new site (step-by-step)
- Troubleshooting (better-sqlite3 build, network, rate-limit)
- License (chọn MIT hoặc để open)

## Architecture

### File tree (final)
```
crawler/
├── README.md                       # mới
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── data/
│   └── crawler.db                  # sau smoke test
└── packages/...
```

## Related Code Files

### Create
- `README.md` (root)
- (Optional) `scripts/smoke-test.sh` hoặc `scripts/smoke-test.ps1`

### Modify
- Không có (chỉ verify, không sửa code khác trừ khi smoke test phát hiện bug)

## Implementation Steps

### Step 1 — Smoke test thủ công
Chạy tuần tự, ghi lại output:
```bash
# 1. Fresh
rm -f data/crawler.db
pnpm cli crawl daily-dev --feed popular --limit 10
#   expect: inserted=10 updated=0

# 2. Dedupe
pnpm cli crawl daily-dev --feed popular --limit 10
#   expect: inserted=0 updated=10

# 3. Search by tag
pnpm cli crawl daily-dev --feed search --tag javascript --limit 20
#   expect: inserted ≥ 1, total > 10 trong DB

# 4. List
pnpm cli list --source daily-dev --limit 5

# 5. Errors
pnpm cli crawl unknown-site || echo "exit=$?"
pnpm cli crawl daily-dev --feed search || echo "exit=$?"
```

Document kết quả vào file `plans/260425-1347-crawler-monorepo-daily-dev/smoke-results.md` (optional).

### Step 2 — README.md

Cấu trúc đề xuất:

```markdown
# crawler

Multi-site article crawler. Mỗi site là 1 package độc lập. Lưu URL, summary, metadata vào SQLite.

## Quick Start

```bash
git clone <repo>
cd crawler
pnpm install
pnpm cli crawl daily-dev --feed popular --limit 10
pnpm cli list --source daily-dev
```

## Requirements

- Node.js ≥ 18.18
- pnpm ≥ 9 (`npm install -g pnpm`)
- Build tools cho native module `better-sqlite3`:
  - **Windows:** `npm install -g windows-build-tools` hoặc Visual Studio Build Tools
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Linux:** `build-essential` + `python3`

## CLI

### `crawl <site>`
| Option | Default | Description |
|---|---|---|
| `--feed <type>` | `popular` | `popular` hoặc `search` |
| `--tag <name>` | | Required khi `--feed=search` |
| `--limit <n>` | `50` | Số article tối đa |
| `--db <path>` | `data/crawler.db` | Override DB path |

### `list`
| Option | Default | Description |
|---|---|---|
| `--source <name>` | (required) | vd `daily-dev` |
| `--limit <n>` | `10` | |
| `--offset <n>` | `0` | |
| `--db <path>` | `data/crawler.db` | |

## Architecture

```
packages/
  core/        # Article type, Crawler interface, SQLite repository
  daily-dev/   # GraphQL crawler cho api.daily.dev
  cli/         # commander dispatcher + registry
```

## Adding a New Site

1. Tạo `packages/<site-name>/` (copy structure từ `daily-dev`)
2. Implement class `XxxCrawler implements Crawler` (xem `@crawler/core`)
3. Add 1 dòng vào `packages/cli/src/registry.ts`:
   ```ts
   import { XxxCrawler } from '@crawler/<site-name>';
   export const REGISTRY = {
     'daily-dev': () => new DailyDevCrawler(),
     '<site-name>': () => new XxxCrawler(),
   };
   ```
4. Run `pnpm install` để link workspace mới
5. `pnpm cli crawl <site-name> ...`

## Troubleshooting

### `better-sqlite3` build fails
- Đảm bảo có Python 3 + C++ compiler
- Windows: cài Visual Studio Build Tools
- Try: `pnpm rebuild better-sqlite3`

### `429 Too Many Requests` từ daily.dev
- Crawler đã throttle 1s/request + retry. Nếu vẫn 429, tăng `throttleMs` trong `DailyDevClient`

### `database is locked`
- WAL mode đã bật. Nếu vẫn lỗi: đảm bảo không có process nào khác mở DB

## License

MIT (hoặc tùy chọn của bạn)
```

### Step 3 — Verify final
- README render OK trên markdown viewer
- Tất cả command trong README chạy thực tế thành công
- `pnpm typecheck` pass
- `pnpm test` pass

### Step 4 — Update plan.md status
Sau khi tất cả phase done → cập nhật `plan.md` frontmatter `status: completed`.

## Todo List
- [ ] Chạy smoke test scenarios 1-6, ghi kết quả
- [ ] Fix bất kỳ bug phát hiện được trong smoke test
- [ ] Viết README.md đủ section: quick start, requirements, CLI, architecture, adding site, troubleshooting
- [ ] Verify mọi command trong README chạy thật được
- [ ] Update plan.md status → completed

## Success Criteria
- 6/6 smoke scenarios pass
- README clone-and-run được < 5 phút (giả định đã có Node + pnpm)
- New developer đọc "Adding a New Site" có thể làm theo mà không hỏi
- Plan.md status = completed

## Risk Assessment
| Risk | Mitigation |
|---|---|
| API rate-limit khi smoke test nhiều lần | Spread test theo phút, hoặc giảm limit về 5 |
| Smoke test phát hiện bug → blocker phase 5 | Loop back vào phase liên quan, fix, re-test |
| README rot khi code đổi | Phase 1 chấp nhận; future: thêm doc-test (out of scope) |

## Next Steps
- Plan complete → có thể journal qua `/ck:journal`
- Tương lai: thêm packages/<site-2>, mở rộng search-by-query, export JSON/CSV, scheduled mode

## Open Questions
- Có cần CI (Github Actions) tự chạy typecheck/test ngay phase này không, hay để sau?
- Có muốn add license file riêng không, hay chỉ note trong README?
