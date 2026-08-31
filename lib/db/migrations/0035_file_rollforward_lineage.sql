ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "rolled_from_id" varchar;

CREATE UNIQUE INDEX IF NOT EXISTS "files_rollforward_lineage_idx"
  ON "files" ("rolled_from_id", "fiscal_year_end");