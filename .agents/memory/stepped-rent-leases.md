---
name: Stepped rent lease handling
description: How rentSteps (stepped $ rent schedules) flow through the loan calculator and the rules that keep math consistent
---

# Stepped rent lease handling

Rules:
- `rentSteps` (jsonb `[{fromYear,toYear,monthlyRent}]`, 1-based inclusive lease years) are authoritative when non-empty: they override the escalation % everywhere. The last step extends past its `toYear` if the term runs longer.
- Free rent months zero out rent for the first N payment months (month index < freeRentMonths).
- Any place that sums operating lease cash (fiscal-year commitment buckets, total commitment) must be step-aware — never `monthlyPayment × termMonths` when steps exist. Prefer the straight-line result's `totalLeasePayments`.

**Why:** flat-rent math silently understates/overstates ASPE 3065 disclosure commitments for stepped office leases; the bug surfaces only in commitment tables, not in totals users check first.

**How to apply:** when adding any new consumer of lease payments (exports, disclosures, charts), route through `calculateStraightLineLease`'s schedule rather than re-deriving from `monthlyPayment`.

Also: the document import upload field name is `file` (multer `upload.single("file")`) — using another form field yields a MulterError 500.
