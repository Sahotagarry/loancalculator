-- Additive only. No backfill: legacy buyout semantics must not be inferred.
ALTER TABLE loans ADD COLUMN IF NOT EXISTS lease_ending_terms jsonb;
