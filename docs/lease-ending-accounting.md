# Lease ending accounting contract

New interpretations are opt-in; absent metadata preserves legacy calculations exactly.
No migration may infer the meaning of an existing balloon/buyout.

## Basis and professional judgment

ASPE 3065 distinguishes lessee minimum payments from the lessor's residual investment.
Mandatory payments and lessee-guaranteed residuals belong in minimum payments.
A sale-shortfall guarantee is not an automatically exercised purchase option.
An ordinary purchase option is excluded; a qualifying bargain purchase price is
included. Qualification depends on expected value at exercise, not a fixed
percentage of original cost. Alternative purchase/return settlements must not
be added together. Unsupported alternatives require review.

Unguaranteed lessor residual value may inform an implicit-rate estimate, but
must not be included in the lessee liability. A reserve table computes a value;
it does not establish who bears the shortfall.

Use the lower of the known implicit rate and incremental borrowing rate.
Record the asset at no more than fair value. Upfront down payments reduce the
unpaid obligation, while a refundable deposit is separate. For advance rentals,
the first payment reduces liability immediately without a month's interest.
Final rental and residual settlement are distinct events.

Recoverable sales taxes and executory/service costs are not financing payments.
Non-recoverable taxes need an explicit accounting assessment; neither a province
nor a tax label establishes recoverability. No inferred tax-inclusive price.

The 75% and 90% indicators require judgment. Specialized use supports the
risks-and-rewards assessment; it is not a separate automatic ASPE bright line.

## Sources checked

- BDO Canada, Section 3065 – Leases:
  https://www.bdo.ca/insights/accounting-knowledge-center/aspe/section-3065-leases
  (classification, executory costs, lower discount rate, fair-value ceiling).
- Densmore CPA, Technical Spotlight: Accounting for Leases (Lessees), February 2025:
  https://www.densmorecpa.com/blog/technical-spotlight-accounting-for-leases-lessees
  (residual treatment and distinction from IFRS).

These public professional summaries are not a substitute for the licensed CPA
Canada Handbook or engagement-specific judgment. Conflicting clauses, missing
appendices, unsupported formulas and unconfirmed date assumptions remain drafts.

The explicit monthly ending schedule does not yet represent irregular first
due dates or dated prepayment/rate-reset timelines. Those agreements must remain
on the existing event-aware legacy path or have draft ending metadata; the API
rejects reviewed adoption and event additions to an already-reviewed explicit
schedule. Reports and roll-forward also fail closed for unsupported combinations.
This restriction avoids silently dropping contractual dates or recorded events.

Tax/service financing rentals are rounded to the persisted cents **before** PV
and opening-value calculation. The server validates the saved-basis schedule
before accepting reviewed status, so reopening cannot introduce a different
cash-flow basis.
