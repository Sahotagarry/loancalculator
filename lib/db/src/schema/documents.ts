import { sql } from "drizzle-orm";
import { check, customType, foreignKey, index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { filesTable } from "./files";
import { appUsersTable, firmsTable } from "./security";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// Fallback storage for imported source documents (PDFs) when no Azure Blob
// Storage connection string is configured. Documents stored here are
// referenced from loans via a "db:<id>" blob name. Each row supports exactly
// one private backend: bytea fallback content or an Azure storage reference.
// Ownership fields are intentionally nullable for legacy records; authorization
// must only expose records with a complete, adopted ownership chain.
export const storedDocumentsTable = pgTable("stored_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  content: bytea("content"),
  // Private backend locator. API responses use an opaque doc:<uuid> handle,
  // never this value.
  storageRef: text("storage_ref"),
  tenantId: text("tenant_id"),
  firmId: varchar("firm_id").references(() => firmsTable.id),
  clientId: varchar("client_id").references(() => clientsTable.id, { onDelete: "cascade" }),
  fileId: varchar("file_id").references(() => filesTable.id, { onDelete: "cascade" }),
  uploaderTenantId: text("uploader_tenant_id"),
  uploaderObjectId: text("uploader_object_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    columns: [table.uploaderTenantId, table.uploaderObjectId],
    foreignColumns: [appUsersTable.tenantId, appUsersTable.objectId],
    name: "stored_documents_uploader_fkey",
  }),
  index("stored_documents_ownership_idx").on(
    table.tenantId,
    table.firmId,
    table.clientId,
    table.fileId,
  ),
  index("stored_documents_uploader_idx").on(table.uploaderTenantId, table.uploaderObjectId),
  check(
    "stored_documents_exactly_one_backend",
    sql`(${table.content} is null) <> (${table.storageRef} is null)`,
  ),
]);

export type StoredDocument = typeof storedDocumentsTable.$inferSelect;
