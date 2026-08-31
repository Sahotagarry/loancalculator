import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { loansTable } from "./loans";
import { filesTable } from "./files";

export type FvDecisionEvidence = {
  contractualCashFlowVersion: string;
  contractualCashFlowFingerprint: string;
  eventSet: { id: string | null; version: number; hash: string | null };
  termRevision: { id: string; hash: string };
  modificationAssessment: {
    identity: string | null;
    conclusion: string | null;
  };
  paymentTiming: string;
  frozenPrimeLinkedDayOneAssumption: Record<string, unknown> | null;
  contractualRate: number;
  marketEffectiveRate: number | null;
  reportingContext: {
    fileId: string;
    fiscalYearEnd: string;
    trivialThreshold: string | null;
    materiality: string | null;
  };
  calculationVersion: string;
  evidenceVersion: string;
  inputs: Record<string, unknown>;
};

export const fvDecisionConfirmationsTable = pgTable(
  "fv_decision_confirmations",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    loanId: varchar("loan_id").notNull().references(() => loansTable.id, { onDelete: "cascade" }),
    // Inherited confirmations are historical source evidence, not target-period
    // approvals. Keep explicit immutable provenance for every annual copy.
    sourceConfirmationId: varchar("source_confirmation_id").references(
      (): AnyPgColumn => fvDecisionConfirmationsTable.id,
    ),
    inheritedFromLoanId: varchar("inherited_from_loan_id").references(() => loansTable.id),
    sourceFileId: varchar("source_file_id").references(() => filesTable.id),
    version: integer("version").notNull(),
    treatment: text("treatment").notNull(),
    marketEffectiveRate: numeric("market_effective_rate", { precision: 9, scale: 6 }),
    rationaleNote: text("rationale_note"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedBy: text("confirmed_by").notNull(),
    canonicalFingerprint: text("canonical_fingerprint").notNull(),
    contractFingerprint: text("contract_fingerprint").notNull(),
    eventSetFingerprint: text("event_set_fingerprint"),
    reportingContextFingerprint: text("reporting_context_fingerprint").notNull(),
    modificationFingerprint: text("modification_fingerprint"),
    evidenceVersion: text("evidence_version").notNull(),
    calculationVersion: text("calculation_version").notNull(),
    evidence: jsonb("evidence").$type<FvDecisionEvidence>().notNull(),
  },
  (table) => [
    uniqueIndex("fv_decision_confirmations_loan_version_idx").on(table.loanId, table.version),
    check("fv_decision_confirmations_version_positive", sql`${table.version} > 0`),
    check(
      "fv_decision_confirmations_treatment_valid",
      sql`${table.treatment} in ('use_fv', 'trivial', 'immaterial')`,
    ),
  ],
);

export const insertFvDecisionConfirmationSchema = createInsertSchema(
  fvDecisionConfirmationsTable,
).omit({ id: true, confirmedAt: true });
export type FvDecisionConfirmation = typeof fvDecisionConfirmationsTable.$inferSelect;
export type InsertFvDecisionConfirmation = z.infer<typeof insertFvDecisionConfirmationSchema>;