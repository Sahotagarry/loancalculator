import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const firmsTable = pgTable("firms", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: text("tenant_id").notNull().unique(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const appUsersTable = pgTable("app_users", {
  tenantId: text("tenant_id").notNull(),
  objectId: text("object_id").notNull(),
  firmId: varchar("firm_id").notNull().references(() => firmsTable.id),
  // Informational identity claims only; tenantId + objectId remains authoritative.
  displayName: text("display_name"),
  email: text("email"),
  role: text("role").$type<AppUserRole>().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.objectId] }),
  index("app_users_firm_id_idx").on(table.firmId),
  check(
    "app_users_role_valid",
    sql`${table.role} in ('admin', 'manager', 'accountant', 'read_only')`,
  ),
]);

export type AppUserRole = "admin" | "manager" | "accountant" | "read_only";

export const insertFirmSchema = createInsertSchema(firmsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertAppUserSchema = createInsertSchema(appUsersTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertFirm = z.infer<typeof insertFirmSchema>;
export type Firm = typeof firmsTable.$inferSelect;
export type InsertAppUser = z.infer<typeof insertAppUserSchema>;
export type AppUser = typeof appUsersTable.$inferSelect;