---
name: Add item entry points
description: Semantics of the three ways to add loans/leases in a year-end file
---

Rule: the three entry points (now under one "Add Loan or Lease" dropdown) have distinct, non-overlapping semantics:
- **Add Loan** — loans only. The create form is always mode "loan"; capital-lease mode appears only when editing an existing capital lease.
- **Add Lease** — the ASPE 3065 guided assessment; it decides capital vs. operating and creates either.
- **Import from PDF** — AI extraction; handles loans, capital leases, and operating leases.

**Why:** the design changed from the original (loan form used to have a capital-lease toggle at creation). I described the old behavior and the user corrected me; help copy also drifted stale.

**How to apply:** when writing UI copy, help content, or new entry points around adding items, use these semantics; don't assume the loan form can create capital leases.
