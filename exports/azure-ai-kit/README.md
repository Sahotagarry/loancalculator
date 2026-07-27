# Azure AI Document Kit — Invoice Reading & Analysis

Extracted from the loan/lease calculator app for reuse in an audit sampling
and vouching app. Reads PDF invoices (including scans) with Azure Document
Intelligence, then analyzes the text with Azure OpenAI and returns validated,
structured fields.

## Files

| File | What it does |
| --- | --- |
| `azure-core.ts` | Settings loading from env vars, `UserFacingError`, missing-config checks. |
| `azure-doc-intel.ts` | PDF → text via Document Intelligence `prebuilt-read` (built-in OCR). Automatically works around the free-tier (F0) 2-page limit by splitting big PDFs into chunks. Taken verbatim from the proven implementation. |
| `azure-openai.ts` | Generic Azure OpenAI chat-completions caller. Tries the modern version-free `v1` endpoint first (needed for GPT-5-family models), falls back to the legacy deployment endpoint. Returns parsed JSON. Taken verbatim, minus app-specific wording. |
| `invoice-extract.ts` | Invoice-specific Zod schema + system prompt + server-side math re-checks. Adapted for invoices/credit notes/receipts from the loan/lease version — adjust freely. |
| `example.ts` | Runnable end-to-end example: `npx tsx example.ts invoice.pdf`. |

## Dependencies

```bash
npm install zod pdf-lib
```

Node.js 20+ (uses the built-in `fetch`). No Azure SDK packages needed — the
Document Intelligence and OpenAI calls use plain REST.

## Configuration (environment variables)

These are the same resources/keys the loan calculator uses — you can share
the exact same Azure resources across both apps.

| Variable | Where to get it |
| --- | --- |
| `AZURE_DOC_INTEL_ENDPOINT` | Document Intelligence resource → Keys and Endpoint |
| `AZURE_DOC_INTEL_KEY` | same page, Key 1 |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI resource → Keys and Endpoint |
| `AZURE_OPENAI_KEY` | same page, Key 1 |
| `AZURE_OPENAI_DEPLOYMENT` | The model deployment name you created (e.g. `gpt-5`) |

## Usage

```ts
import { loadAzureSettings, requireSettings } from "./azure-core";
import { readPdfText } from "./azure-doc-intel";
import { extractInvoice, checkInvoiceMath } from "./invoice-extract";

const settings = loadAzureSettings();
requireSettings(settings, ["docIntelEndpoint", "docIntelKey", "openaiEndpoint", "openaiKey", "openaiDeployment"], "Invoice analysis");

const text = await readPdfText(settings, pdfBuffer);   // OCR / text extraction
const result = await extractInvoice(settings, text);   // AI classification + fields

if (result.classification === "invoice" && result.invoice) {
  const { invoice, warnings } = checkInvoiceMath(result.invoice);
  // warnings = arithmetic mismatches worth flagging to the auditor
}
```

## Design decisions worth keeping (learned in the source app)

1. **Every extracted field is nullable with `.catch(null)`** — one malformed
   field never sinks the whole extraction. `null` means "not found; flag for
   manual follow-up", which is exactly the behaviour an audit tool wants.
2. **The prompt forbids guessing** and requires `fieldNotes` citations
   ("where in the document did this come from") so the auditor can verify
   every number against the source.
3. **Re-do arithmetic server-side.** LLMs make small math mistakes; line-item
   sums and tax totals are re-checked in code and mismatches surfaced as
   warnings rather than silently trusted (`checkInvoiceMath`).
4. **Free-tier OCR truncation is silent.** Document Intelligence F0 reads only
   the first 2 pages per request and reports success — `readPdfText` detects
   this and chunks the PDF. Keep this even if you use the paid tier today.
5. **Model compatibility:** GPT-4-family base models were retired mid-2026.
   Use a current model deployment (GPT-5 family / gpt-4.1) with the
   version-free `v1` endpoint, and don't send `temperature` to reasoning
   models — the dual-attempt logic in `azure-openai.ts` handles both cases.
6. **Cap prompt size** (60k characters here) so giant documents don't blow
   the token budget; for statements/contracts longer than that, consider
   extracting the relevant pages first.

## Adapting the extraction

Everything invoice-specific lives in `invoice-extract.ts`: the Zod schema,
the system prompt, and the math checks. To vouch different document types
(bank statements, purchase orders, shipping documents), copy that file and
change the schema + prompt — the other three files stay untouched.
