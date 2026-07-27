---
name: FV cumulative adjusting entry (ASPE 3856)
description: How the per-year "unrecorded adjustment" journal entry on the Fair Value tab is composed and why it balances
---

# Cumulative FV adjusting entry (per fiscal year)

On the Fair Value tab, each fiscal-year row exposes an "Adjusting Entry" button (replacing the old "Total Payment Diff" column, which is always zero under fixed FV payments). The dialog shows the CUMULATIVE unrecorded fair-value catch-up as at that year end — not the static day-one discount.

## The rule
Client books stay on the contractual (face) basis; the FV discount unwinds over time via extra interest. As at fiscal year end Y:
- `day1Discount = face principal − fair value` (fvDiff)
- `currentExtra` (year Y) = FV interest − contractual interest for that fiscal year
- `priorExtra` = sum of extra interest for all fiscal years BEFORE Y (capture before adding current year)
- `cumulativeExtra` = priorExtra + currentExtra
- `remainingDiscount = day1Discount − cumulativeExtra`

Journal entry (positive amount → debit, negative → credit) — 3 lines:
- Loan Payable / Obligation under Capital Lease = `remainingDiscount`  (restate carrying value to FV)
- Interest Expense = `currentExtra`  (current-year accretion)
- Retained Earnings (opening) = `priorExtra − day1Discount`  (net credit: initial FV benefit net of prior-year accretion)

**Use Retained Earnings, NOT Contributed Surplus**, for the initial FV benefit — this firm runs the whole below-market related-party adjustment through retained earnings. The day-one benefit (credit) and prior-year interest accretion (debit) are netted into ONE opening-RE line rather than shown as separate offsetting lines.

## Why it balances
Debits = remainingDiscount + currentExtra = (day1 − prior − current) + current = day1 − prior. Credit = day1Discount − priorExtra = day1 − prior. Equal every year (year 1 has priorExtra 0, so RE credit = day1Discount).

**Why:** an accountant reviewing working papers needs the full catch-up (incl. prior years) as at the reporting FYE, with the P&L split between opening retained earnings (prior) and current interest expense (current) — the standard "summary of unadjusted differences" form.

## Caveats
- Liability line label switches on `loan.isCapitalLease` (Obligation under Capital Lease vs Loan Payable).
- Shown whenever the Fair Value tab is visible (`isLowRate && fvResult`) and `|fvDiff| >= 0.01` — NOT gated on `fvDecision === "use_fv"` (deliberately relaxed so the adjustment documents trivial/immaterial conclusions too).
- Computed on-the-fly, never stored (see journal-entries-computed.md).
