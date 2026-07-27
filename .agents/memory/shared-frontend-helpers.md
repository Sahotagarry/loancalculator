---
name: Shared frontend helpers (loan-calculator)
description: Where currency formatting and fiscal-year math live; don't re-inline them
---

The loan-calculator artifact centralizes two helpers that were previously copied
across files:

- `formatCurrency` → `artifacts/loan-calculator/src/lib/format.ts`
- `getFiscalYear` / `getFyEndParts` → `artifacts/loan-calculator/src/lib/fiscal.ts`

**Rule:** import these; never re-inline a local `formatCurrency` or a hand-rolled
fiscal-year boundary calc.

**Why:** `formatCurrency` had three identical copies (loan-detail, file-detail,
loan-calculator) and `getFiscalYear` had two definitions (aspe-utils,
straight-line). Divergence risk is real for financial output — inconsistent
rounding or a fiscal-boundary mismatch silently corrupts disclosures.

**How to apply:** the fiscal-year boundary is strict-after — a payment dated
exactly on the FY-end belongs to the current fiscal year, not the next. Keep that
semantics if the helper is ever changed.
