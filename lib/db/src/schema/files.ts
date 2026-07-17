import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, date, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const filesTable = pgTable("files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  fiscalYearEnd: date("fiscal_year_end", { mode: "string" }).notNull(),
  // Materiality thresholds shared across all loans/leases in this file (FYE)
  trivialThreshold: numeric("trivial_threshold", { precision: 12, scale: 2 }),
  materiality: numeric("materiality", { precision: 12, scale: 2 }),
  // File-level review diagnostics dismissed by the user as not applicable
  dismissedFindings: jsonb("dismissed_findings").$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  // Soft delete: when set, the file is in the trash (hidden but recoverable)
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const insertFileSchema = createInsertSchema(filesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type InsertFile = z.infer<typeof insertFileSchema>;
export type File = typeof filesTable.$inferSelect;
