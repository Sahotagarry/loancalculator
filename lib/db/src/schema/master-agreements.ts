import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, numeric, jsonb } from "drizzle-orm/pg-core";
import { filesTable } from "./files";

// A master financing agreement groups related credit facilities (loans) within
// a year-end file. It carries the shared base terms — lender, security and
// covenant wording, overall facility limit — while each facility (loan) keeps
// its own rate, principal, and amortization schedule, optionally overriding
// the master's security details.
export const masterAgreementsTable = pgTable("master_agreements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fileId: varchar("file_id").notNull().references(() => filesTable.id, { onDelete: "cascade" }),
  lender: text("lender").notNull(),
  description: text("description"),
  // Overall facility limit across all facilities (display-only; no
  // availability math is performed on it).
  facilityLimit: numeric("facility_limit", { precision: 15, scale: 2 }),
  // Shared security package — same shape as loan-level security clauses.
  securityClauses: jsonb("security_clauses").$type<string[]>(),
  securityDescription: text("security_description"),
  // Shared covenant wording (e.g. required ratios) for disclosure.
  covenantDescription: text("covenant_description"),
  // Attached source document (the master agreement PDF)
  sourceDocumentBlob: text("source_document_blob"),
  sourceDocumentName: text("source_document_name"),
  // Roll-forward tracking (points at the prior year's master agreement)
  rolledFromId: varchar("rolled_from_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  // Soft delete: when set, the master agreement is hidden; its facilities are
  // unlinked back to standalone loans at delete time.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type MasterAgreement = typeof masterAgreementsTable.$inferSelect;
export type InsertMasterAgreement = typeof masterAgreementsTable.$inferInsert;
