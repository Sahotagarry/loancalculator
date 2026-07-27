---
name: Loan PATCH null-clearing semantics
description: How to clear a nullable loan column from the client via the update endpoint
---

The loan update route only writes a field when it is `!== undefined`, so a partial
PATCH leaves omitted fields untouched.

**Rule:** To *clear* a nullable loan column from a form submit, send explicit
`null`, not `undefined` (`value || null`, not `value || undefined`). Sending
`undefined` (or omitting the key) is a no-op and leaves stale data persisted.

**Why:** Collateral fields were first submitted as `value || undefined`; selecting
"No specific collateral" or zeroing a cost silently failed to clear the stored
collateral/NBV, so disclosures kept stale values.

**How to apply:** Any edit form that can blank out an optional loan field must map
the empty/zero state to `null` in the mutation body. Only use `undefined` when the
intent is genuinely "leave unchanged" (e.g. a targeted single-field PATCH).
