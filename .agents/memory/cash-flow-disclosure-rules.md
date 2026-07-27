---
name: Cash flow disclosure rules (Presentation & Disclosure tab)
description: Business rules for the loan-calculator statement-of-cash-flows section and lease inducement cash vs non-cash split
---

# Cash Flows — Relevant Items disclosure rules

The file-detail "Presentation & Disclosure" tab's Cash Flows section follows these rules:

- **Loan proceeds** are disclosed as a financing inflow ("Proceeds from long-term debt") **only when the loan originated within the reporting fiscal year**. The FY window test is `isAfter(start, fyWindowStart) && !isAfter(start, reportYearEnd)` in `buildFileSummary` (aspe-utils.ts).
- **Principal repayments** stay as a financing outflow.
- **Interest paid is intentionally NOT disclosed** in the cash flow statement. `totalInterestPaid` is still computed internally but must not be rendered in the cash flow section.
- **Lease inducements** use a per-lease boolean `inducementReceivedInCash` (DB `inducement_received_in_cash`, default false = non-cash):
  - `true` → cash inducement, shown as financing inflow ("Lease inducements received in cash").
  - `false` → non-cash, shown in a separate "Non-cash transactions" disclosure box (free rent / landlord TIs).
  - Inducement amount = tenantImprovementAllowance + otherInducements, counted **only when the lease originated within the reporting FY** (same window logic as loan proceeds).

**Why:** ASPE presentation — cash flow statement discloses actual cash movements; non-cash inducements are supplementary disclosures. New leases default to non-cash because free rent / landlord-funded TIs are the common case.

**How to apply:** Any new inflow/outflow line must respect the FY-origination window. When adding a new inducement type, split it by `inducementReceivedInCash` into `cashInducementsReceived` vs `nonCashInducementsReceived`.
