# Auto-memory index

- [App versioning](app-versioning.md) — version lives ONLY in root package.json, baked in at build via define in both vite.config and api-server build.mjs; never runtime package.json lookup (Azure dist lacks root)

- [Payment grace period on loans](grace-period-loans.md) — grace rows are principal:0/payment:0, accretion grows balance directly; date-based boundaries; isGrace must survive FV transforms

- [Operating lease classification](operating-lease-classification.md) — no type column; use isOperatingLeaseLoan() (termMonths is the loan-vs-lease discriminator), never re-inline the heuristic
- [Settings at-rest encryption](settings-encryption.md) — app_settings values encrypted with SESSION_SECRET; always use load/saveAzureSettings, keep SESSION_SECRET stable

- [ASPE 3856 FV rate inconsistency](fv-rate-consistency.md) — primary result must use effectiveRate; keep contractualResult for comparison tab
- [BoC Valet API fallback](prime-rate-api.md) — V122495 series, 7.2% fallback when "no observation" for date; 24h in-memory cache
- [Journal entries computed on-the-fly](journal-entries-computed.md) — never store journal entries; compute from schedules to avoid stale data
- [Down payment semantics](down-payment-semantics.md) — principal stays face amount; all math uses financed = principal − downPayment; display shows face
- [Vitest test setup](testing-vitest-setup.md) — per-package vitest; standalone config (vite.config throws w/o PORT); exclude *.test.ts from composite lib tsconfig
- [API server error handling](api-error-handling.md) — Express 5 leaks HTML stack traces; route errors must pass a global JSON handler (23505→409); client mutations need onError toasts
- [Loan PATCH null-clearing](loan-patch-null-clearing.md) — update route skips undefined; send explicit null to clear a nullable loan column from a form
- [Loan roll-forward field drift](loan-rollforward-field-drift.md) — roll-forward must spread the source row, not copy fields by hand, or new columns silently drop
- [Shared frontend helpers](shared-frontend-helpers.md) — formatCurrency in lib/format.ts, getFiscalYear/getFyEndParts in lib/fiscal.ts; import, don't re-inline
- [Loans schema DB changes](loans-schema-db-changes.md) — drizzle push blocked by TTY (use direct SQL); restart api-server so db.select() picks up new columns
- [Amortization balloon residual](amortization-balloon-residual.md) — schedule stops at term end; final-row balance is an implicit balloon NOT in any principal row; disclosures must add it at maturity FY
- [Shared loan/lease UI cards](shared-loan-lease-ui.md) — loan-detail Payment Summary card is shared by leases+loans; labels must branch on isCapitalLease, never hardcode "Lease"
- [Cash flow disclosure rules](cash-flow-disclosure-rules.md) — proceeds/inducements only if lease originated in reporting FY; interest paid NOT disclosed; inducement cash vs non-cash split, default non-cash
- [Recharts screenshot animation](recharts-screenshot-animation.md) — Area/Line draw left-to-right on mount; screenshots look truncated. Set isAnimationActive={false}
- [Year-End File terminology](year-end-file-terminology.md) — the `file` entity is shown as "Year-End File", leading with the FYE date; never surface bare "File" in UI
- [FV cumulative adjusting entry](fv-adjusting-entry.md) — per-year "unrecorded adjustment" popup; remainingDiscount + current/prior interest split + day-1 offset; balances to day1Discount
- [Add item entry points](add-item-entry-points.md) — Add Loan = loans only; Add Lease = ASPE 3065 wizard (capital or operating); PDF import = all three
- [Clearline branding](clearline-branding.md) — Clearline is the CPA firm, not the app; UI copy must attribute features to "this application", never to Clearline
- [Lease import math reconcile](lease-import-reconcile.md) — recompute per-sf rent/CAM server-side, overwrite LLM numbers; operating-lease principal = straight-line schedule total
- [Lease import provenance](lease-import-provenance.md) — extraction fieldNotes (doc citations) vs estimates (AI guesses); estimates are opt-in in wizard, never prefilled
- [Stepped rent leases](stepped-rent-leases.md) — rentSteps override escalation %; all cash-commitment math must be step-aware, never monthlyPayment×term; import upload field is "file"
- [Document storage fallback](document-storage-fallback.md) — PDFs go to Postgres (`db:<uuid>` refs) when no Azure storage string; always go through document-store wrapper
- [Azure OpenAI model compat](azure-openai-model-compat.md) — GPT-4 family retired mid-2026; use v1 endpoint, no temperature; legacy endpoint only as fallback
- [Doc Intel free-tier page limit](doc-intel-free-tier.md) — F0 silently reads only 2 pages; reader auto-chunks larger PDFs; dump OCR text before prompt-tuning missing fields
- [FYE denormalized onto loans](fye-denormalized-sync.md) — loans carry a copy of the file's FYE; file PATCH must cascade it and client must refetch loans
- [Security clause / NBV coupling](security-clause-nbv-coupling.md) — naming a specific charge requires disclosing the pledged asset's NBV; clause checkboxes auto-sync with collateral type
- [Covenant violation classification](covenant-violation-classification.md) — violation makes full balance current; scheduled within/beyond split kept for disclosure; file-detail has 3 hand-rolled recomputations
- [Soft-delete trash semantics](soft-delete-trash-semantics.md) — every by-id read/mutation needs isNull(deletedAt); restore un-trashes full parent chain unconditionally
- [Clearline Fintech theme](clearline-fintech-theme.md) — dark #262626 header on every page, orange 27 96% 51% in :root AND .dark, Lato/Raleway; PageHeader forces `dark` class
- [FV rate validation boundary](fv-rate-validation.md) — fvRate must be finite >0 at BOTH client helpers and API routes; decision saves omit fvRate when no positive rate exists
- [Master financing agreements](master-agreements.md) — inheritance is copy-on-link (workpapers/disclosures only do live security/covenant fallback); delete unlinks facilities; roll-forward matches masters by rolledFromId
- [Comparatives lineage](comparatives-lineage.md) — prior-year figures follow rolledFromId → source loan's fileId; never pick prior file by fiscal-year date
