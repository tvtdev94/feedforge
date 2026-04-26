# Phase 01 — Bootstrap Monorepo

**Status:** pending
**Priority:** P0 (blocking everything)
**Estimated effort:** 30 min

## Context Links
- [plan.md](plan.md)
- [brainstorm](../reports/brainstorm-260425-1347-crawler-monorepo-design.md)

## Overview
Khởi tạo monorepo pnpm workspaces với TypeScript strict, scripts chuẩn, và .gitignore. Cuối phase: `pnpm install` chạy được, tsc compile các package rỗng OK.

## Key Insights
- pnpm workspaces đủ cho phase này, KHÔNG dùng Turborepo (YAGNI — thêm sau khi cần build cache)
- Dùng `tsc --noEmit` cho check, dùng `tsx` để run TS trực tiếp khi dev (không cần build dist trong dev)
- Single tsconfig base, các package extend từ nó

## Requirements

### Functional
- `pnpm install` thành công ở root
- 3 package directories tồn tại: `packages/core`, `packages/daily-dev`, `packages/cli`
- `pnpm -r exec tsc --noEmit` pass với package rỗng

### Non-functional
- Node ≥ 18 (cho native fetch)
- TypeScript strict mode bật toàn bộ
- ES modules (`"type": "module"`)

## Architecture

### File tree
```
crawler/
├── .gitignore
├── .npmrc
├── package.json                    # root, private
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── data/                           # SQLite file location (gitignored content)
│   └── .gitkeep
└── packages/
    ├── core/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/index.ts            # placeholder export
    ├── daily-dev/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/index.ts            # placeholder
    └── cli/
        ├── package.json
        ├── tsconfig.json
        └── src/index.ts            # placeholder
```

## Related Code Files

### Create
- `package.json` (root)
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `.gitignore`
- `.npmrc`
- `data/.gitkeep`
- `packages/core/{package.json,tsconfig.json,src/index.ts}`
- `packages/daily-dev/{package.json,tsconfig.json,src/index.ts}`
- `packages/cli/{package.json,tsconfig.json,src/index.ts}`

## Implementation Steps

### Step 1 — Root configs

**`pnpm-workspace.yaml`**
```yaml
packages:
  - "packages/*"
```

**`.npmrc`**
```
shamefully-hoist=false
strict-peer-dependencies=false
```

**`.gitignore`**
```
node_modules/
dist/
*.log
.DS_Store
data/*.db
data/*.db-journal
data/*.db-wal
data/*.db-shm
```

**`tsconfig.base.json`**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true
  }
}
```

**Root `package.json`**
```json
{
  "name": "crawler",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18.18" },
  "scripts": {
    "build": "pnpm -r build",
    "typecheck": "pnpm -r exec tsc --noEmit",
    "cli": "pnpm --filter @crawler/cli exec tsx src/index.ts",
    "test": "pnpm -r test"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "tsx": "^4.16.0",
    "@types/node": "^20.14.0"
  }
}
```

### Step 2 — Per-package `package.json`

**`packages/core/package.json`**
```json
{
  "name": "@crawler/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit"
  }
}
```

**`packages/daily-dev/package.json`**
```json
{
  "name": "@crawler/daily-dev",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@crawler/core": "workspace:*"
  }
}
```

**`packages/cli/package.json`**
```json
{
  "name": "@crawler/cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "crawler": "./src/index.ts" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@crawler/core": "workspace:*",
    "@crawler/daily-dev": "workspace:*"
  }
}
```

### Step 3 — Per-package `tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

### Step 4 — Placeholder `src/index.ts` cho mỗi package
```ts
export {};
```

### Step 5 — Verify
```bash
pnpm install
pnpm typecheck
```

## Todo List
- [ ] Tạo `pnpm-workspace.yaml`, `.npmrc`, `.gitignore`, `tsconfig.base.json`
- [ ] Tạo root `package.json` với scripts + devDeps
- [ ] Tạo 3 package directories với `package.json`, `tsconfig.json`, `src/index.ts`
- [ ] Tạo `data/.gitkeep`
- [ ] Chạy `pnpm install` → verify không lỗi
- [ ] Chạy `pnpm typecheck` → verify pass

## Success Criteria
- `pnpm install` exit 0
- `pnpm typecheck` exit 0
- Workspace symlinks tồn tại trong `node_modules/@crawler/*`

## Risk Assessment
| Risk | Mitigation |
|---|---|
| pnpm chưa cài trên máy | Hướng dẫn `npm install -g pnpm` trong README |
| Node version < 18 | Set `engines.node` ≥ 18.18 + warn |

## Next Steps
→ Phase 2: implement core package (types, db, repository, Crawler interface)
