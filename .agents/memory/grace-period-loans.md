---
name: Payment grace period on loans
description: How payment deferral/grace periods are modeled and the invariants schedules must keep
---

- Loans support `graceMonths` + `graceInterestTreatment` ('capitalized' | 'none'): no payments until N calendar months after start; term includes the grace period, amortization excludes it. Interest-only-with-payments is NOT a grace period — that's ioMonths.
- **Why:** Three distinct deferral arrangements exist in real loan docs and the user needs the AI import to pick the right one (rules live in the extraction prompt in azure-extract.ts).
- **How to apply:**
  - Grace rows must have `principal: 0` and `payment: 0`; capitalized accretion grows `balance` directly. Never encode accretion as negative principal — many views sum `row.principal` as "principal repaid" / current-portion math.
  - Grace period boundaries are date-based (`addMonths(start, graceMonths)`), not `graceMonths × periodsPerYear/12`, so weekly/bi-weekly schedules defer correctly.
  - `isGrace` must be propagated through `calculateFairValueSchedule` and any schedule transform; "first regular payment" helpers must skip both isInterestOnly and isGrace rows.
  - New loan columns must flow through: openapi.yaml → `pnpm --filter @workspace/api-spec run codegen`, loans.ts create/PATCH/roll-forward, fv-decisions, form state, both file-detail payloads, loan-detail editForm, aspe-utils input types.
