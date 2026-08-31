import { sql } from "drizzle-orm";
import {
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { loansTable } from "./loans";

export const rateRefreshRunsTable = pgTable("rate_refresh_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: text("status").notNull(), // running | succeeded | partial | failed
  attempted: integer("attempted").notNull().default(0),
  applied: integer("applied").notNull().default(0),
  unresolved: integer("unresolved").notNull().default(0),
  evidence: jsonb("evidence").$type<Record<string, unknown>>(),
});

export const rateResetFindingsTable = pgTable(
  "rate_reset_findings",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    loanId: varchar("loan_id").notNull().references(() => loansTable.id, { onDelete: "cascade" }),
    observationDate: date("observation_date", { mode: "string" }).notNull(),
    contractualEffectiveDate: date("contractual_effective_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("unresolved"),
    reason: text("reason").notNull(),
    runId: varchar("run_id").references(() => rateRefreshRunsTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("rate_reset_findings_open_key").on(
      table.loanId,
      table.observationDate,
      table.contractualEffectiveDate,
      table.status,
    ),
  ],
);
