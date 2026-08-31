import { sql } from "drizzle-orm";
import { index, pgTable, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { firmsTable } from "./security";

export const clientsTable = pgTable("clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  // A client is inaccessible until a firm explicitly adopts it. These nullable
  // columns support a staged migration of existing single-tenant records.
  firmId: varchar("firm_id").references(() => firmsTable.id),
  adoptedAt: timestamp("adopted_at", { withTimezone: true }),
  quarantinedAt: timestamp("quarantined_at", { withTimezone: true }),
  quarantineReason: text("quarantine_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  // Soft delete: when set, the client is in the trash (hidden but recoverable)
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("clients_firm_adoption_quarantine_idx").on(
    table.firmId,
    table.adoptedAt,
    table.quarantinedAt,
  ),
]);

export const insertClientSchema = createInsertSchema(clientsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  adoptedAt: true,
  quarantinedAt: true,
  quarantineReason: true,
});

export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;
