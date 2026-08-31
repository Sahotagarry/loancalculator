import { index, pgTable, primaryKey, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { appUsersTable } from "./security";

export const clientMembershipsTable = pgTable("client_memberships", {
  clientId: varchar("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id").notNull(),
  objectId: text("object_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.clientId, table.tenantId, table.objectId] }),
  index("client_memberships_user_idx").on(table.tenantId, table.objectId),
]);

export const insertClientMembershipSchema = createInsertSchema(clientMembershipsTable).omit({
  createdAt: true,
});

export type InsertClientMembership = z.infer<typeof insertClientMembershipSchema>;
export type ClientMembership = typeof clientMembershipsTable.$inferSelect;