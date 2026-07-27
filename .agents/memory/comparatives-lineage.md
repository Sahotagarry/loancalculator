---
name: Prior-year comparatives lineage
description: How file-detail finds the prior year-end file for comparative figures
---

- Prior-year comparatives appear only on rolled-forward files and must follow the actual lineage: current loan's `rolledFromId` → fetch source loan → its `fileId` is the prior file. Never pick "latest earlier fiscal year" from the client's files.
- **Why:** with multiple historical files the date heuristic can pull comparatives from an unrelated file; architect flagged this as a correctness failure.
- Figures are computed on-the-fly with `buildFileSummary(priorLoans, priorFile.fiscalYearEnd)` — never stored (consistent with journal-entries rule).
- If the source loan is trashed, the lookup 404s and comparatives simply don't render (use `retry: false` on that query).
