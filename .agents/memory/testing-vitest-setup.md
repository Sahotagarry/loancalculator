---
name: Vitest test setup (loan-calculator monorepo)
description: How automated tests are wired into this pnpm monorepo and the two traps that break naive setups
---

# Vitest wiring

Tests use **per-package vitest**: each tested package has `vitest` as a devDependency, its own `vitest.config.ts`, and a `"test": "vitest run"` script. Root `package.json` has `"test": "pnpm -r --if-present run test"`.

## Trap 1 — never import `vite.config.ts` into a test config
`artifacts/loan-calculator/vite.config.ts` **throws at load time** if `PORT`/`BASE_PATH` are unset (they are only provided by the workflow). Vitest runs from bash without them, so the artifact's `vitest.config.ts` must be **standalone** — redeclare only what tests need (the `@` → `src` alias, `environment: "node"`). Do not `import` or `mergeConfig` the vite config.

**Why:** a config that loads vite.config throws before any test runs.

## Trap 2 — exclude test files from composite lib builds
`lib/amortization` is a composite package (`emitDeclarationOnly`). Its `tsconfig.json` must have `"exclude": ["src/**/*.test.ts"]` or `tsc --build` (root `typecheck:libs`) tries to typecheck/emit declarations for test files. Leaf artifacts (loan-calculator) already exclude `**/*.test.ts` in their tsconfig.

**How to apply:** when adding tests to any composite `lib/*`, add the test exclude to that lib's tsconfig too.

## Note on type-checking tests
Excluded test files are run by vitest (esbuild transpile) but are **not** statically type-checked by `pnpm run typecheck`. If full test type-safety is ever needed, add `vitest --typecheck` or a separate `tsconfig.test.json`.
