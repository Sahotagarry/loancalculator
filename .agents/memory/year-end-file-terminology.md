---
name: Year-End File terminology
description: How the "file" entity is presented to users in the loan-calculator UI
---

# "File" is presented as "Year-End File"

The `file` entity (a client's fiscal-year-end audit/review engagement) is labelled **"Year-End File"** in all user-facing copy, and the UI **leads with the fiscal year end date** as the primary label.

**Why:** staff were confused by the generic word "File". A file = a specific client's FYE engagement (e.g. "December 31, 2024" audit/review). User chose the "Year-End File" wording and date-first hierarchy over adding an explicit engagement-type field.

**How to apply:**
- Never surface the bare word "File"/"Files" in new UI — use "Year-End File(s)".
- Cards/headers/breadcrumbs lead with `file.fiscalYearEnd` (formatted date); the `file.name` is secondary and labelled "Name / Reference".
- In create/edit dialogs, put the Fiscal Year End field **before** the Name / Reference field.
- Code identifiers (`fileId`, `useGetFile`, etc.) and the DB model keep the `file` name — only display copy changed.
