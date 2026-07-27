---
name: ASPE 3856 FV fixed-payment consistency
description: Fair value must never change the contractual payment; the booked schedule uses the effective-interest method everywhere (schedule, cards, reports).
---

When `fvDecision === "use_fv"` (the deprecated `useFvRate` boolean was removed), the contractual cash payments are FIXED at the fair-value rate — the FV rate must never re-amortize the loan into a different (higher) payment. The "booked" schedule shown across every view (loan-detail Schedule/Annual/Chart/Payment Summary, file-detail cards, file summary, and all reports/financial statements) must be the FV effective-interest schedule: fair value = PV of the unchanged contractual payments (plus any term-end balloon balance) discounted at the FV rate; then interest = carrying × FV rate and principal = payment − interest.

**Why:** An accountant flagged that if payments are equal, principal diff must exactly offset interest diff and total-payment diff must be zero — "it is what it is, you can't change the payment." Re-amortizing at the FV rate recomputes the payment, breaking this identity. The user explicitly chose to apply the fixed-payment rule EVERYWHERE, not just the FV comparison tab.

**How to apply:**
1. `calculateFairValueSchedule(contractualSchedule, fvRate, frequency)` in `@workspace/amortization` implements the effective-interest allocation and returns `{ fairValue, monthlyPayment, totalInterest, totalPayment, schedule }`. `monthlyPayment` is the first non-IO contractual payment so it is a drop-in for `calculateAmortization`'s shape.
2. `calculateBookedSchedule(loan)` in `artifacts/loan-calculator/src/lib/aspe-utils.ts` is the SINGLE SOURCE OF TRUTH: it builds the contractual schedule first, then returns the FV effective-interest schedule only when `fvDecision === "use_fv" && fvRate > 0`, else the contractual schedule. Use it in every schedule-computation site so all views agree.
3. `buildLoanSummary` (drives reports/financial statements) uses `calculateBookedSchedule`. `buildFileSummary`'s loan param type must include `fvDecision`/`fvRate` so they propagate.
4. loan-detail `result` selects `fvResult` (from `calculateFairValueSchedule`) when `use_fv`, else `contractualResult`. Keep a separate `contractualResult` only for the FV comparison tab.
5. Journal entries / `fvDiff` and the server-side `computeFvAdjustment` (FV decision) both use the day-1 discount = `principal − fairValue`, NOT the nominal sum of payment differences.

**Lockstep rule:** Changing the FV method or the adjustment definition must stay in sync across `lib/amortization`, `api-server/lib/fv-decisions`, `aspe-utils.ts` (`calculateBookedSchedule`/`buildLoanSummary`), `loan-detail.tsx`, and `file-detail.tsx`.
