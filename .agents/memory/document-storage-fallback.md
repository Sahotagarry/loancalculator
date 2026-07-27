---
name: Document storage fallback
description: How imported PDF source documents are stored when Azure Blob Storage is not configured
---

Imported PDFs are stored via a document-store wrapper, not azure-blob directly. If no storage connection string is configured, the PDF goes into the `stored_documents` Postgres table and the blob reference is `db:<uuid>`; otherwise it's an Azure blob name. References are self-describing, so db-stored docs stay readable after Azure storage is added later.

**Why:** User wasn't ready to create an Azure storage account; import must work end-to-end without it.
**How to apply:** Any code touching sourceDocumentBlob must go through document-store (store/retrieve/deleteDocumentRefSafe) and never assume an Azure blob name. Don't require storageConnectionString for `db:` refs.
