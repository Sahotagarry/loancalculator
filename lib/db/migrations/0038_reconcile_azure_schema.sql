-- Additive reconciliation for Azure databases that received the single-firm
-- security migration before the earlier loan timeline migrations.
-- This migration is deliberately idempotent and preserves all legacy tables.

ALTER TABLE "files"
  ADD COLUMN IF NOT EXISTS "rolled_from_id" varchar;

ALTER TABLE "loans"
  ADD COLUMN IF NOT EXISTS "payment_timing" text NOT NULL DEFAULT 'end',
  ADD COLUMN IF NOT EXISTS "grace_term_mode" text NOT NULL DEFAULT 'included',
  ADD COLUMN IF NOT EXISTS "first_payment_date" date,
  ADD COLUMN IF NOT EXISTS "semi_monthly_first_due_day" integer,
  ADD COLUMN IF NOT EXISTS "semi_monthly_second_due_day" integer,
  ADD COLUMN IF NOT EXISTS "current_revision_id" varchar,
  ADD COLUMN IF NOT EXISTS "current_revision_hash" text,
  ADD COLUMN IF NOT EXISTS "calculation_version" text,
  ADD COLUMN IF NOT EXISTS "active_event_set_id" varchar,
  ADD COLUMN IF NOT EXISTS "active_event_set_version" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "active_event_set_hash" text,
  ADD COLUMN IF NOT EXISTS "rate_type" text NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS "rate_benchmark" text,
  ADD COLUMN IF NOT EXISTS "contractual_prime_name" text,
  ADD COLUMN IF NOT EXISTS "benchmark_equivalent_to_contractual_prime" boolean,
  ADD COLUMN IF NOT EXISTS "rate_spread" numeric(7,4),
  ADD COLUMN IF NOT EXISTS "rate_reset_frequency" text,
  ADD COLUMN IF NOT EXISTS "rate_effective_convention" text,
  ADD COLUMN IF NOT EXISTS "rate_payment_treatment" text,
  ADD COLUMN IF NOT EXISTS "rate_refresh_checkpoint_date" date,
  ADD COLUMN IF NOT EXISTS "initial_fv_rate_assumption" jsonb,
  ADD COLUMN IF NOT EXISTS "predecessor_agreement_id" varchar,
  ADD COLUMN IF NOT EXISTS "modification_effective_date" date,
  ADD COLUMN IF NOT EXISTS "modification_assessment" jsonb;

CREATE TABLE IF NOT EXISTS "loan_contract_revisions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "loan_id" varchar NOT NULL REFERENCES "loans"("id") ON DELETE CASCADE,
  "revision_number" integer NOT NULL,
  "snapshot" jsonb NOT NULL,
  "input_hash" text NOT NULL,
  "calculation_version" text NOT NULL,
  "change_reason" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "loan_contract_revisions_loan_revision_idx"
  ON "loan_contract_revisions" ("loan_id", "revision_number");

CREATE TABLE IF NOT EXISTS "loan_event_sets" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "loan_id" varchar NOT NULL REFERENCES "loans"("id") ON DELETE CASCADE,
  "term_revision_id" varchar NOT NULL REFERENCES "loan_contract_revisions"("id"),
  "version" integer NOT NULL,
  "fingerprint" text NOT NULL,
  "supersedes_set_id" varchar REFERENCES "loan_event_sets"("id"),
  "reason" text NOT NULL,
  "source" text NOT NULL,
  "author" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "loan_event_sets_version_positive" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "loan_event_sets_loan_version_idx"
  ON "loan_event_sets" ("loan_id", "version");

CREATE TABLE IF NOT EXISTS "loan_events" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "set_id" varchar NOT NULL REFERENCES "loan_event_sets"("id") ON DELETE CASCADE,
  "loan_id" varchar NOT NULL REFERENCES "loans"("id") ON DELETE CASCADE,
  "term_revision_id" varchar NOT NULL REFERENCES "loan_contract_revisions"("id"),
  "kind" text NOT NULL,
  "effective_date" date NOT NULL,
  "ordering" text NOT NULL,
  "sequence" integer NOT NULL,
  "amount" numeric(15,2),
  "treatment" text,
  "observation_date" date,
  "published_date" date,
  "fetched_at" timestamptz,
  "benchmark_rate" numeric(7,4),
  "spread" numeric(7,4),
  "resulting_rate" numeric(7,4),
  "benchmark" text,
  "source_url" text,
  "source_series" text,
  "rate_origin" text,
  "classification" text NOT NULL,
  "source" text NOT NULL,
  "reason" text NOT NULL,
  "authored_at" timestamptz NOT NULL,
  "author" text,
  "supersedes_event_id" varchar REFERENCES "loan_events"("id"),
  "origin_event_id" varchar REFERENCES "loan_events"("id"),
  CONSTRAINT "loan_events_sequence_positive" CHECK ("sequence" > 0),
  CONSTRAINT "loan_events_amount_positive" CHECK ("amount" IS NULL OR "amount" > 0),
  CONSTRAINT "loan_events_kind_valid"
    CHECK ("kind" IN ('principal_prepayment', 'rate_reset')),
  CONSTRAINT "loan_events_kind_payload_valid" CHECK (
    ("kind" = 'principal_prepayment' AND "amount" IS NOT NULL AND "treatment" IS NOT NULL)
    OR
    ("kind" = 'rate_reset' AND "observation_date" IS NOT NULL
      AND "benchmark_rate" IS NOT NULL AND "spread" IS NOT NULL
      AND "resulting_rate" IS NOT NULL AND "benchmark" IS NOT NULL
      AND "source_url" IS NOT NULL AND "source_series" IS NOT NULL
      AND "rate_origin" IS NOT NULL)
  ),
  CONSTRAINT "loan_events_ordering_valid"
    CHECK ("ordering" IN ('before_scheduled_payment', 'after_scheduled_payment')),
  CONSTRAINT "loan_events_treatment_valid"
    CHECK ("treatment" IS NULL OR "treatment" IN ('keep_payment', 'keep_maturity')),
  CONSTRAINT "loan_events_classification_valid"
    CHECK ("classification" IN ('ordinary', 'agreement_change'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "loan_events_set_sequence_idx"
  ON "loan_events" ("set_id", "sequence");

CREATE TABLE IF NOT EXISTS "rate_refresh_runs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "status" text NOT NULL,
  "attempted" integer NOT NULL DEFAULT 0,
  "applied" integer NOT NULL DEFAULT 0,
  "unresolved" integer NOT NULL DEFAULT 0,
  "evidence" jsonb
);

CREATE TABLE IF NOT EXISTS "rate_reset_findings" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "loan_id" varchar NOT NULL REFERENCES "loans"("id") ON DELETE CASCADE,
  "observation_date" date NOT NULL,
  "contractual_effective_date" date NOT NULL,
  "status" text NOT NULL DEFAULT 'unresolved',
  "reason" text NOT NULL,
  "run_id" varchar REFERENCES "rate_refresh_runs"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "rate_reset_findings_open_key"
  ON "rate_reset_findings"
  ("loan_id", "observation_date", "contractual_effective_date", "status");

CREATE TABLE IF NOT EXISTS "fv_decision_confirmations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "loan_id" varchar NOT NULL REFERENCES "loans"("id") ON DELETE CASCADE,
  "source_confirmation_id" varchar REFERENCES "fv_decision_confirmations"("id"),
  "inherited_from_loan_id" varchar REFERENCES "loans"("id"),
  "source_file_id" varchar REFERENCES "files"("id"),
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

DROP TRIGGER IF EXISTS "fv_decision_confirmations_immutable"
  ON "fv_decision_confirmations";
CREATE TRIGGER "fv_decision_confirmations_immutable"
  BEFORE UPDATE ON "fv_decision_confirmations"
  FOR EACH ROW EXECUTE FUNCTION reject_fv_confirmation_update();

CREATE INDEX IF NOT EXISTS "loans_predecessor_agreement_id_idx"
  ON "loans" ("predecessor_agreement_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'loans_predecessor_agreement_id_fkey'
  ) THEN
    ALTER TABLE "loans"
      ADD CONSTRAINT "loans_predecessor_agreement_id_fkey"
      FOREIGN KEY ("predecessor_agreement_id") REFERENCES "loans"("id");
  END IF;
END $$;

DROP INDEX IF EXISTS "files_rollforward_lineage_idx";
CREATE UNIQUE INDEX "files_rollforward_lineage_idx"
  ON "files" ("rolled_from_id", "fiscal_year_end")
  WHERE "deleted_at" IS NULL;

UPDATE "loans" AS loan
SET "rate_benchmark" = 'boc_v80691311'
WHERE loan."rate_benchmark" = 'boc_v122495'
  AND NOT EXISTS (
    SELECT 1
    FROM "loan_events" AS event
    WHERE event."loan_id" = loan."id"
      AND event."kind" = 'rate_reset'
  );