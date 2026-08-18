---
name: Master financing agreements
description: How master agreements group loan facilities — inheritance, deletion, and roll-forward semantics
---

# Master financing agreements

A `master_agreements` table (file-scoped, soft-delete) groups loan facilities via nullable `loans.master_agreement_id`.

**Inheritance is copy-on-link, not live — enforced server-side.** Loan create/PATCH-link copy the master's securityDescription into the facility's own securityClauses when the facility has none (see `resolveInheritedSecurityClauses` helper); facility-provided clauses always win. The loan form additionally prefills lender/security as defaults into empty fields. There is NO runtime fallback in schedules or loan math — the facility row is self-contained, so security wording survives master deletion/unlink. The only live fallback is presentational: workpapers and note disclosures use the master's securityDescription/covenantDescription when the facility has no securityClauses.

**Deletion unlinks, never cascades.** Deleting a master soft-deletes it and sets `master_agreement_id = null` on its facilities in one transaction (they revert to standalone loans). Masters are NOT surfaced in the trash UI; restore flows don't need to handle them.

**Why:** facilities are real loans with their own audited schedules; hiding or deleting them with the master would corrupt the year-end file.

**Roll-forward:** file roll-forward clones referenced masters into the new file with `rolledFromId` pointing at the source master, then remaps facility links. Per-loan roll-forward reuses the target file's master matched by `rolledFromId` (or identity within the same file), cloning only when no match exists — so rolling several facilities never duplicates the master.

**Link validation:** loan create/PATCH reject a `masterAgreementId` from a different file or a deleted master (400). PATCH with explicit null unlinks.

**AI import:** extraction classification includes `master_agreement` with a `facilities` array (loan-shaped, revolving operating lines excluded); prime-spread resolution applies per facility. The import dialog creates the master plus checked facilities in one flow; term sheets import as single loans and are attached to a master via the loan form's master select.
