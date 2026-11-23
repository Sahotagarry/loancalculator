-- Assessment-only evidence. No backfill or rewrite of historical agreements.
ALTER TABLE loans ADD COLUMN IF NOT EXISTS lease_assessment_rate numeric;
