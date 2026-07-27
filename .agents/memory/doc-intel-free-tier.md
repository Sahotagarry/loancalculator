---
name: Document Intelligence free-tier page limit
description: Azure Doc Intelligence F0 tier only reads 2 pages; how the app works around it
---

Azure Document Intelligence F0 (free) tier analyzes only the first 2 pages of a PDF, silently. Symptom: extraction misses fields that live deeper in the document (payment terms, amortization) while page-1 fields come out fine.

The doc-intel reader compares pages returned vs the PDF's actual page count (pdf-lib) and, when truncated, splits the remaining pages into 2-page chunk PDFs and analyzes each, concatenating the text. Paid-tier (S0) documents take the single-request path untouched.

**Why:** User runs on the free tier; an 11-page loan agreement only yielded pages 1-2 of text, so the AI never saw the repayment article.
**How to apply:** Don't "fix" missing extraction fields by prompt-tuning until you've confirmed the full document text actually reaches the model; dump the OCR text first.
