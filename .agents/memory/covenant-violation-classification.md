---
name: Covenant violation classification
description: How covenant-violation reclassification flows through loan summaries and UI
---

Rule: when a loan/capital lease has `covenantViolation`, the presented `currentPortion` becomes the entire `balanceAtYearEnd` and `longTermPortion` is 0 (ASPE 1510 — callable debt). The scheduled split is preserved in `scheduledWithinOneYear` / `scheduledBeyondOneYear` on `LoanSummary` for disclosure ("due within one year" vs "due beyond one year, callable").

**Why:** callable debt must be classified current, but users still need the scheduled split for the balance sheet breakdown and note disclosures.

**How to apply:** `buildLoanSummary` in aspe-utils is the source of truth; `buildFileSummary` aggregates its `currentPortion`/`longTermPortion`, so anything using FileSummary is automatically correct. But file-detail.tsx has THREE local recomputations (card view, table `getDebtMetrics`, summary `getSummaryMetrics`) that each apply the reclass by hand — any new surface that computes current/long-term from schedules must branch on `covenantViolation` too. Toggle is hidden for operating leases (isDebt only). Tests: `covenant-violation.test.ts`.
