import { pgTable, text, timestamp, uuid, customType } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// Fallback storage for imported source documents (PDFs) when no Azure Blob
// Storage connection string is configured. Documents stored here are
// referenced from loans via a "db:<id>" blob name.
export const storedDocumentsTable = pgTable("stored_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  content: bytea("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StoredDocument = typeof storedDocumentsTable.$inferSelect;
