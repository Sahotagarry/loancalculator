---
name: Amortization balloon residual
description: The amortization schedule stops at term end and leaves an implicit balloon residual that is NOT a principal row — disclosures must add it back
---

# Implicit balloon residual when term < amortization

`calculateAmortization` (exported as the amortization lib's schedule builder) loops
only for the **term** periods, not the full amortization period. When
`amortizationYears > termYears`, the schedule ends at term end with a large
remaining `balance` still owed — an implicit balloon due at maturity. That residual
is **never recorded as a `principal` row**; it only lives in the final row's
`balance`.

**Consequence:** any disclosure that sums `row.principal` (e.g. the ASPE
"principal repayment terms are approximately" schedule, current vs long-term split)
will under-report and fail to reconcile to the carrying amount. Symptom seen: total
long-term debt $688,174.26 but principal-repayment schedule totaled only
$199,572.70.

**Fix (in the summary/disclosure layer, not the amortization lib):** take the final
schedule row's `balance` as `residualBalloon` (only when that row's date is after
the report year-end), then:
- add it to the principal due in the **maturity fiscal year** so the yearly
  repayment schedule reconciles to `balanceAtYearEnd`;
- add it to the **current portion** if maturity falls within the next fiscal year.

**Why:** the borrower must repay/refinance the residual at maturity, so under ASPE
it is principal due in the maturity year. Reconciliation check: for each loan,
sum(future `row.principal`) + residual === balanceAtYearEnd.

**How to apply:** any new disclosure or rollup that consumes the schedule's
per-period principal must account for the final-row residual, or it will silently
under-report balloon/short-term-loan principal.
