---
name: Journal entries computed on-the-fly
description: Why journal entries for ASPE FV adjustments should not be persisted in the database.
---

Journal entries derived from amortization schedules should be computed on-the-fly in the UI, never stored. The schedule itself is computed from live loan parameters, and any stored journal entry would become stale if the loan parameters change.

**Why:** Stale journal entries create a data integrity risk. If a user updates the rate, term, or principal and the journal entries don't reflect the new schedule, the financial records are wrong.

**How to apply:**
- Compute journal entries inside a `useMemo` from `contractualResult` and `fvResult`
- Show them only on the Fair Value tab where context is clear
- Never include journal entries in loan create/update payloads
