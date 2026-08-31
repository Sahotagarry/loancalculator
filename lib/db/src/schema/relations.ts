import { relations } from "drizzle-orm";
import { clientMembershipsTable } from "./client-memberships";
import { clientsTable } from "./clients";
import { storedDocumentsTable } from "./documents";
import { filesTable } from "./files";
import { appUsersTable, firmsTable } from "./security";

export const firmsRelations = relations(firmsTable, ({ many }) => ({
  appUsers: many(appUsersTable),
  clients: many(clientsTable),
  storedDocuments: many(storedDocumentsTable),
}));

export const appUsersRelations = relations(appUsersTable, ({ one, many }) => ({
  firm: one(firmsTable, {
    fields: [appUsersTable.firmId],
    references: [firmsTable.id],
  }),
  clientMemberships: many(clientMembershipsTable),
  uploadedDocuments: many(storedDocumentsTable),
}));

export const clientsRelations = relations(clientsTable, ({ one, many }) => ({
  firm: one(firmsTable, {
    fields: [clientsTable.firmId],
    references: [firmsTable.id],
  }),
  memberships: many(clientMembershipsTable),
  storedDocuments: many(storedDocumentsTable),
}));

export const clientMembershipsRelations = relations(clientMembershipsTable, ({ one }) => ({
  client: one(clientsTable, {
    fields: [clientMembershipsTable.clientId],
    references: [clientsTable.id],
  }),
  appUser: one(appUsersTable, {
    fields: [clientMembershipsTable.tenantId, clientMembershipsTable.objectId],
    references: [appUsersTable.tenantId, appUsersTable.objectId],
  }),
}));

export const storedDocumentsRelations = relations(storedDocumentsTable, ({ one }) => ({
  firm: one(firmsTable, {
    fields: [storedDocumentsTable.firmId],
    references: [firmsTable.id],
  }),
  client: one(clientsTable, {
    fields: [storedDocumentsTable.clientId],
    references: [clientsTable.id],
  }),
  file: one(filesTable, {
    fields: [storedDocumentsTable.fileId],
    references: [filesTable.id],
  }),
  uploader: one(appUsersTable, {
    fields: [storedDocumentsTable.uploaderTenantId, storedDocumentsTable.uploaderObjectId],
    references: [appUsersTable.tenantId, appUsersTable.objectId],
  }),
}));