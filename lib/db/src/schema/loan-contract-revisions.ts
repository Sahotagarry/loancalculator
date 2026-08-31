import { sql } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { loansTable } from "./loans";

export const loanContractRevisionsTable = pgTable(
  "loan_contract_revisions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    loanId: varchar("loan_id")
      .notNull()
      .references(() => loansTable.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    inputHash: text("input_hash").notNull(),
    calculationVersion: text("calculation_version").notNull(),
    changeReason: text("change_reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("loan_contract_revisions_loan_revision_idx").on(
      table.loanId,
      table.revisionNumber,
    ),
  ],
);

export const insertLoanContractRevisionSchema = createInsertSchema(
  loanContractRevisionsTable,
).omit({
  id: true,
  createdAt: true,
});

export type InsertLoanContractRevision = z.infer<
  typeof insertLoanContractRevisionSchema
>;
export type LoanContractRevision =
  typeof loanContractRevisionsTable.$inferSelect;