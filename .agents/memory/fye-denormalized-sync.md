---
name: FYE denormalized onto loans
description: Loans carry a copy of the file's fiscalYearEnd; it must be cascaded on file update
---

Each loan/lease row stores a denormalized copy of its Year-End File's fiscalYearEnd, and nearly all schedule slicing, current-portion classification, and disclosure math reads the loan-level copy, not the file's.

The file PATCH route cascades fiscalYearEnd to all loans in the file, and the client invalidates the file's loans list plus every `/api/loans/<id>` query after a file update.

**Why:** Editing a file's FYE (2025→2026) silently left loans slicing at the old date — the file header showed the new year while every schedule used the old one.
**How to apply:** Any new write path that changes a file's fiscalYearEnd (imports, roll-forward, bulk edits) must also update the loans' copies; any new loan-level FYE consumer should assume the loan copy is authoritative only because the cascade keeps it so.
