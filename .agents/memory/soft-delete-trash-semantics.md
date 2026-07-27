---
name: Soft-delete trash semantics
description: Rules for the deletedAt soft-delete/trash system across clients/files/loans
---

- Every route that reads OR mutates a record by id must include `isNull(deletedAt)` — not just list/get. PATCH, roll-forward sources, and source-document downloads all leaked trashed rows until guarded.
- **Why:** trashed records must be invisible/inert everywhere except the trash routes, or hidden data resurfaces (e.g. downloading a trashed loan's PDF by id).
- Restore must un-trash the FULL parent chain unconditionally: restoring a loan un-trashes its file, then separately looks up the file's clientId and un-trashes the client — never gate the client step on whether the file update matched (file may already be active while client is trashed).
- Trash list shows only top-level trashed items (children of a trashed parent are hidden); blob cleanup happens at permanent purge, not soft-delete.
