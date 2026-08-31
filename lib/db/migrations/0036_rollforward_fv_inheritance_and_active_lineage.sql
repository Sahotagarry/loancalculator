-- Replacing the original full index permits a fresh active roll-forward after
-- a prior target has been moved to trash, while still serializing active work.
DROP INDEX IF EXISTS "files_rollforward_lineage_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "files_rollforward_lineage_idx"
  ON "files" ("rolled_from_id", "fiscal_year_end")
  WHERE "deleted_at" IS NULL;

ALTER TABLE "fv_decision_confirmations"
  ADD COLUMN IF NOT EXISTS "source_confirmation_id" varchar
    REFERENCES "fv_decision_confirmations"("id"),
  ADD COLUMN IF NOT EXISTS "inherited_from_loan_id" varchar
    REFERENCES "loans"("id"),
  ADD COLUMN IF NOT EXISTS "source_file_id" varchar
    REFERENCES "files"("id");