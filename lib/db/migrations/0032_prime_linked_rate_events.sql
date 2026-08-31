-- Task 32: additive, idempotent prime-linked rate persistence.
-- Deliberately not executed by this change.
ALTER TABLE loans ADD COLUMN IF NOT EXISTS rate_type text NOT NULL DEFAULT 'fixed';
ALTER TABLE loans ADD COLUMN IF NOT EXISTS rate_benchmark text;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS contractual_prime_name text;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS benchmark_equivalent_to_contractual_prime boolean;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS rate_spread numeric(7,4);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS rate_reset_frequency text;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS rate_effective_convention text;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS rate_payment_treatment text;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS rate_refresh_checkpoint_date date;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS initial_fv_rate_assumption jsonb;

ALTER TABLE loan_events ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE loan_events ALTER COLUMN treatment DROP NOT NULL;
ALTER TABLE loan_events ADD COLUMN IF NOT EXISTS observation_date date;
ALTER TABLE loan_events ADD COLUMN IF NOT EXISTS published_date date;
ALTER TABLE loan_events ADD COLUMN IF NOT EXISTS fetched_at timestamptz;
ALTER TABLE loan_events ADD COLUMN IF NOT EXISTS benchmark_rate numeric(7,4);
ALTER TABLE loan_events ADD COLUMN IF NOT EXISTS spread numeric(7,4);
ALTER TABLE loan_events ADD COLUMN IF NOT EXISTS resulting_rate numeric(7,4);
ALTER TABLE loan_events ADD COLUMN IF NOT EXISTS benchmark text;
ALTER TABLE loan_events ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE loan_events ADD COLUMN IF NOT EXISTS source_series text;
ALTER TABLE loan_events ADD COLUMN IF NOT EXISTS rate_origin text;

ALTER TABLE loan_events DROP CONSTRAINT IF EXISTS loan_events_kind_valid;
ALTER TABLE loan_events ADD CONSTRAINT loan_events_kind_valid
  CHECK (kind IN ('principal_prepayment', 'rate_reset'));
ALTER TABLE loan_events DROP CONSTRAINT IF EXISTS loan_events_amount_positive;
ALTER TABLE loan_events ADD CONSTRAINT loan_events_amount_positive CHECK (amount IS NULL OR amount > 0);
ALTER TABLE loan_events DROP CONSTRAINT IF EXISTS loan_events_treatment_valid;
ALTER TABLE loan_events ADD CONSTRAINT loan_events_treatment_valid
  CHECK (treatment IS NULL OR treatment IN ('keep_payment', 'keep_maturity'));
ALTER TABLE loan_events DROP CONSTRAINT IF EXISTS loan_events_kind_payload_valid;
ALTER TABLE loan_events ADD CONSTRAINT loan_events_kind_payload_valid CHECK (
  (kind = 'principal_prepayment' AND amount IS NOT NULL AND treatment IS NOT NULL)
  OR
  (kind = 'rate_reset' AND observation_date IS NOT NULL
    AND benchmark_rate IS NOT NULL AND spread IS NOT NULL AND resulting_rate IS NOT NULL
    AND benchmark IS NOT NULL AND source_url IS NOT NULL AND source_series IS NOT NULL
    AND rate_origin IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS rate_refresh_runs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL,
  attempted integer NOT NULL DEFAULT 0,
  applied integer NOT NULL DEFAULT 0,
  unresolved integer NOT NULL DEFAULT 0,
  evidence jsonb
);

CREATE TABLE IF NOT EXISTS rate_reset_findings (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id varchar NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  observation_date date NOT NULL,
  contractual_effective_date date NOT NULL,
  status text NOT NULL DEFAULT 'unresolved',
  reason text NOT NULL,
  run_id varchar REFERENCES rate_refresh_runs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS rate_reset_findings_open_key
  ON rate_reset_findings (loan_id, observation_date, contractual_effective_date, status);

-- V122495 was used during draft development but is a retired series. Safely
-- adopt the current V80691311 contract identifier only where no immutable rate
-- history exists. Loans with history remain explicitly retired/unresolved until
-- a user adopts the current benchmark; event source_series evidence is never
-- rewritten.
UPDATE loans AS loan
SET rate_benchmark = 'boc_v80691311'
WHERE loan.rate_benchmark = 'boc_v122495'
  AND NOT EXISTS (
    SELECT 1
    FROM loan_events AS event
    WHERE event.loan_id = loan.id
      AND event.kind = 'rate_reset'
  );