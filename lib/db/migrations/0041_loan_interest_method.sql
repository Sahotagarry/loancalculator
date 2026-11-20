-- NULL retains existing agreements' contractual calculation and historical fingerprints.
ALTER TABLE loans ADD COLUMN IF NOT EXISTS interest_method text;
