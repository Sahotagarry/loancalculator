---
name: Shared loan/lease UI cards
description: The loan-detail Payment Summary card is shared between capital leases and amortizing loans; labels must be isCapitalLease-aware
---

# Shared loan/lease UI cards must be terminology-aware

The loan detail page's "Payment Summary" tab renders one details card for BOTH
capital leases and plain amortizing loans (the branch condition is
`loan.isCapitalLease || (interestRate > 0 && principal > 0 && !monthlyPayment)`).
Operating leases render in a separate `else` branch.

**Rule:** Any label/wording in that shared card (title, "Type", etc.) must branch on
`loan.isCapitalLease` (e.g. `loan.isCapitalLease ? "Lease Details" : "Loan Details"`),
never hardcode "Lease"/"Capital Lease".

**Why:** Hardcoded lease wording made plain loans show "Lease Details / Type: Capital
Lease" on the detail summary, while the Long Term Debt disclosure (which regenerates
narrative via `buildLoanSummary`, keyed on `isCapitalLease`) correctly said "Loan".
That summary-vs-disclosure mismatch was a reported bug.

**How to apply:** When editing shared loan/lease cards on the detail page, keep every
user-visible term conditional on classification so detail-page wording stays consistent
with the aspe-utils-generated disclosure wording.
