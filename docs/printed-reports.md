# Reviewing printed PDF reports

All sample inputs are invented in `artifacts/loan-calculator/src/lib/printed-reports.test.ts`. The fixture uses the same booked-schedule, file-summary, workpaper and disclosure builders as the application. It does not read any client records or uploaded documents.

From the repository root:

```sh
PDF_SAMPLE_DIR="$PWD/generated-artifacts/pdf-examples" pnpm --filter @workspace/loan-calculator exec vitest run src/lib/printed-reports.test.ts
python scripts/check-print-samples.py generated-artifacts/pdf-examples
```

The second command requires Poppler's `pdftotext`. It checks serialized page sizes, text margins, page numbers, all 60 dated payment rows in the three reports that contain them, annual and lead-sheet figures, and the disclosure PDF against the actual Word document. Open the PDFs at actual size on Letter paper to check visual layout. To inspect grayscale pages without a printer, for example: `pdftoppm -r 100 -gray -png generated-artifacts/pdf-examples/disclosure.pdf /tmp/disclosure`.

| Sample | What to inspect |
| --- | --- |
| `schedule.pdf` | First and last payment, repeated column headings, event and fair-value support when supplied |
| `annual.pdf` | Opening and closing balances, movements and one total; journal entries separate from cumulative support |
| `agreement.pdf` | Year-end continuity, classification and maturities first; supporting terms, disclosure, evidence and full schedule follow |
| `lead-sheet.pdf` | Landscape sheet with loans and capital leases separate from operating commitments; callable-debt note and signed deferred rent |
| `consolidated.pdf` | Lead Sheet first, then identified agreement workpapers; operating lease has rent and commitments, not a debt schedule |
| `disclosure.pdf` | Formal current/prior figures, full security and covenant narrative and calculation fingerprints; `word-reference.docx` is the unchanged comparison output |

The quick calculator's two existing PDF actions are **Amortization Schedule** and **Annual Breakdown**. They use the same print layouts and retain their own totals and filenames. This change does not add an entry point to the calculator. The sample generation also tests multi-page totals, rates, events and very long evidence notes. Outputs are ignored by Git and deployment.
