import { sql } from "drizzle-orm";
import {
  check,
  date,
  integer,
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
import { loanContractRevisionsTable } from "./loan-contract-revisions";
import { loansTable } from "./loans";

export const loanEventSetsTable = pgTable(
  "loan_event_sets",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    loanId: varchar("loan_id").notNull().references(() => loansTable.id, { onDelete: "cascade" }),
    termRevisionId: varchar("term_revision_id").notNull().references(() => loanContractRevisionsTable.id),
    version: integer("version").notNull(),
    fingerprint: text("fingerprint").notNull(),
    supersedesSetId: varchar("supersedes_set_id").references(
      (): AnyPgColumn => loanEventSetsTable.id,
    ),
    reason: text("reason").notNull(),
    source: text("source").notNull(),
    author: text("author"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("loan_event_sets_loan_version_idx").on(table.loanId, table.version),
    check("loan_event_sets_version_positive", sql`${table.version} > 0`),
  ],
);

export const loanEventsTable = pgTable(
  "loan_events",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    setId: varchar("set_id").notNull().references(() => loanEventSetsTable.id, { onDelete: "cascade" }),
    loanId: varchar("loan_id").notNull().references(() => loansTable.id, { onDelete: "cascade" }),
    termRevisionId: varchar("term_revision_id").notNull().references(() => loanContractRevisionsTable.id),
    kind: text("kind").notNull(),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    ordering: text("ordering").notNull(),
    sequence: integer("sequence").notNull(),
    amount: numeric("amount", { precision: 15, scale: 2 }),
    treatment: text("treatment"),
    observationDate: date("observation_date", { mode: "string" }),
    publishedDate: date("published_date", { mode: "string" }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    benchmarkRate: numeric("benchmark_rate", { precision: 7, scale: 4 }),
    spread: numeric("spread", { precision: 7, scale: 4 }),
    resultingRate: numeric("resulting_rate", { precision: 7, scale: 4 }),
    benchmark: text("benchmark"),
    sourceUrl: text("source_url"),
    sourceSeries: text("source_series"),
    rateOrigin: text("rate_origin"), // automatic | override | restore
    classification: text("classification").notNull(),
    source: text("source").notNull(),
    reason: text("reason").notNull(),
    authoredAt: timestamp("authored_at", { withTimezone: true }).notNull(),
    author: text("author"),
    supersedesEventId: varchar("supersedes_event_id").references(
      (): AnyPgColumn => loanEventsTable.id,
    ),
    originEventId: varchar("origin_event_id").references(
      (): AnyPgColumn => loanEventsTable.id,
    ),
  },
  (table) => [
    uniqueIndex("loan_events_set_sequence_idx").on(table.setId, table.sequence),
    check("loan_events_sequence_positive", sql`${table.sequence} > 0`),
    check("loan_events_amount_positive", sql`${table.amount} is null or ${table.amount} > 0`),
    check("loan_events_kind_valid", sql`${table.kind} in ('principal_prepayment', 'rate_reset')`),
    check(
      "loan_events_kind_payload_valid",
      sql`(${table.kind} = 'principal_prepayment' and ${table.amount} is not null and ${table.treatment} is not null)
        or (${table.kind} = 'rate_reset' and ${table.observationDate} is not null and ${table.benchmarkRate} is not null and ${table.spread} is not null and ${table.resultingRate} is not null and ${table.benchmark} is not null and ${table.sourceUrl} is not null and ${table.sourceSeries} is not null and ${table.rateOrigin} is not null)`,
    ),
    check(
      "loan_events_ordering_valid",
      sql`${table.ordering} in ('before_scheduled_payment', 'after_scheduled_payment')`,
    ),
    check(
      "loan_events_treatment_valid",
      sql`${table.treatment} is null or ${table.treatment} in ('keep_payment', 'keep_maturity')`,
    ),
    check(
      "loan_events_classification_valid",
      sql`${table.classification} in ('ordinary', 'agreement_change')`,
    ),
  ],
);

export const insertLoanEventSetSchema = createInsertSchema(loanEventSetsTable).omit({
  id: true,
  createdAt: true,
});
export const insertLoanEventSchema = createInsertSchema(loanEventsTable).omit({ id: true });

export type InsertLoanEventSet = z.infer<typeof insertLoanEventSetSchema>;
export type LoanEventSet = typeof loanEventSetsTable.$inferSelect;
export type InsertLoanEvent = z.infer<typeof insertLoanEventSchema>;
type StoredLoanEvent = typeof loanEventsTable.$inferSelect;
export type LoanEvent = Omit<
  StoredLoanEvent,
  | "observationDate"
  | "publishedDate"
  | "fetchedAt"
  | "benchmarkRate"
  | "spread"
  | "resultingRate"
  | "benchmark"
  | "sourceUrl"
  | "sourceSeries"
  | "rateOrigin"
> &
  Partial<
    Pick<
      StoredLoanEvent,
      | "observationDate"
      | "publishedDate"
      | "fetchedAt"
      | "benchmarkRate"
      | "spread"
      | "resultingRate"
      | "benchmark"
      | "sourceUrl"
      | "sourceSeries"
      | "rateOrigin"
    >
  >;