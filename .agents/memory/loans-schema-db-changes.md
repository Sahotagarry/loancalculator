---
name: Loans schema DB changes
description: How to add/apply columns to the loans table given drizzle push is unusable and the api-server caches the schema module
---

# Applying schema changes to the `loans` table

Two gotchas when adding a column (e.g. `counterparty`) to `lib/db/src/schema/loans.ts`:

1. **`drizzle push` is blocked by an interactive TTY prompt** in this environment and will hang/fail.
   Apply the column to the live DB with direct SQL instead, e.g. via the code_execution `executeSql`
   callback: `ALTER TABLE loans ADD COLUMN IF NOT EXISTS <col> <type>`.
   Do NOT retry `drizzle push` / `push-force`.

2. **The running api-server process caches the drizzle schema module.** The GET loans route uses
   `db.select()` (all columns), which only returns columns present in the *loaded* `loansTable` schema
   object. After editing the schema file, `.select()` will still return `null`/omit the new column until
   you **restart the `artifacts/api-server: API Server` workflow**. Symptom: DB has the value, but the
   API response shows the field as `null` for every row.

**Why:** cost real debugging time — the column existed in the DB and schema file and typecheck passed,
but the API kept returning null purely because the dev server held a stale schema module.

**How to apply:** after any `lib/db/src/schema/loans.ts` change, (a) apply DDL via direct SQL, then
(b) restart the api-server workflow before verifying API output.
