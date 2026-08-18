---
name: Operating lease classification
description: How the app distinguishes operating leases from 0% loans (no explicit type column)
---

- There is no explicit item-type column: operating lease is inferred as `!isCapitalLease && rate === 0 && monthlyPayment != null && termMonths != null`.
- **Why:** A 0% loan with no termMonths was once misclassified as an operating lease, breaking its amortization schedule; termMonths is the discriminator because only the lease wizard sets it (loans use termYears/amortizationYears).
- **How to apply:** Never re-inline the heuristic — always use `isOperatingLeaseLoan()` in `aspe-utils.ts` (also used by `getLoanKind` and `buildLoanSummary`). Tests in `classification.test.ts` guard the boundary. If a proper type column is ever added, migrate all callers of this helper at once.
