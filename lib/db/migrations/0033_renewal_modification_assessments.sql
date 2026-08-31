-- Task 30: explicit agreement lineage and persisted renewal/modification evidence.
-- Additive and idempotent so it can also be applied directly to existing databases.
ALTER TABLE loans ADD COLUMN IF NOT EXISTS predecessor_agreement_id varchar;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS modification_effective_date date;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS modification_assessment jsonb;

CREATE INDEX IF NOT EXISTS loans_predecessor_agreement_id_idx
  ON loans (predecessor_agreement_id);

-- Keep the reference intentionally non-cascading: historical assessment evidence
-- must not disappear or silently relink when a predecessor is soft-deleted.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'loans_predecessor_agreement_id_fkey'
  ) THEN
    ALTER TABLE loans
      ADD CONSTRAINT loans_predecessor_agreement_id_fkey
      FOREIGN KEY (predecessor_agreement_id) REFERENCES loans(id);
  END IF;
END $$;