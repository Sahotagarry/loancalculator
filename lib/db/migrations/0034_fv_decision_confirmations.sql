CREATE TABLE IF NOT EXISTS "fv_decision_confirmations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "loan_id" varchar NOT NULL REFERENCES "loans"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "treatment" text NOT NULL,
  "market_effective_rate" numeric(9,6),
  "rationale_note" text,
  "confirmed_at" timestamptz NOT NULL DEFAULT now(),
  "confirmed_by" text NOT NULL,
  "canonical_fingerprint" text NOT NULL,
  "contract_fingerprint" text NOT NULL,
  "event_set_fingerprint" text,
  "reporting_context_fingerprint" text NOT NULL,
  "modification_fingerprint" text,
  "evidence_version" text NOT NULL,
  "calculation_version" text NOT NULL,
  "evidence" jsonb NOT NULL,
  CONSTRAINT "fv_decision_confirmations_version_positive" CHECK ("version" > 0),
  CONSTRAINT "fv_decision_confirmations_treatment_valid"
    CHECK ("treatment" IN ('use_fv', 'trivial', 'immaterial'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "fv_decision_confirmations_loan_version_idx"
  ON "fv_decision_confirmations" ("loan_id", "version");

CREATE OR REPLACE FUNCTION reject_fv_confirmation_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'FV decision confirmations are immutable';
END;
$$;

DROP TRIGGER IF EXISTS "fv_decision_confirmations_immutable" ON "fv_decision_confirmations";
CREATE TRIGGER "fv_decision_confirmations_immutable"
  BEFORE UPDATE ON "fv_decision_confirmations"
  FOR EACH ROW EXECUTE FUNCTION reject_fv_confirmation_update();