import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Simple key/value store for app-level configuration entered through the UI
// (e.g. Azure service credentials). Values are stored server-side only and
// never returned in full to the client.
export const appSettingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AppSetting = typeof appSettingsTable.$inferSelect;
