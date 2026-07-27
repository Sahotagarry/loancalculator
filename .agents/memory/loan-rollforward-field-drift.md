---
name: Loan roll-forward field drift
description: Why roll-forward must spread the source loan row instead of copying fields by hand
---

The file roll-forward endpoint duplicates each outstanding loan into a new
fiscal-year file. It must **spread the source row** and override only the columns
that change, rather than listing fields to copy one by one.

**Rule:** roll-forward = `const { id, createdAt, updatedAt, ...rest } = original;`
then insert `{ ...rest, fileId: newFile.id, fiscalYearEnd: newFYE, rolledFromId: original.id }`.

**Why:** the original hand-written copy loop silently dropped any column not in
its list — it lost `counterparty`, all security/collateral columns, and the ASPE
3856 fair-value fields (`fvRate`/`fvDecision`/`fvDecisionNote`). Under the
effective-interest method those FV fields must continue year to year, and a GSA /
mortgage still exists next year, so dropping them corrupted the next year's
disclosures. Every new loan column added later would have hit the same trap.

**How to apply:** never enumerate loan fields to copy on roll-forward; carry the
whole row and subtract the few identity/period fields. New columns then carry
forward automatically with no code change.
