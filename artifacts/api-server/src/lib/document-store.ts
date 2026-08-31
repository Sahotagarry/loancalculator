import { and, eq, inArray } from "drizzle-orm";
import { db, storedDocumentsTable } from "@workspace/db";
import type { AzureSettings } from "./azure-settings";
import {
  uploadDocument as uploadToAzure,
  downloadDocument as downloadFromAzure,
  deleteDocumentSafe as deleteFromAzureSafe,
} from "./azure-blob";

const DOCUMENT_PREFIX = "doc:";
export type DocumentOwnership = {
  tenantId: string; firmId: string; clientId: string; fileId: string; uploaderObjectId: string;
};

/**
 * Store a PDF and return an opaque handle. Backend storage locators never
 * cross the API boundary and legacy db:/blob strings are intentionally invalid.
 *
 * When an Azure Storage connection string is configured, the document goes to
 * Azure Blob Storage (reference = blob name). Otherwise it is kept in the
 * app's own database as a temporary fallback (reference = "db:<uuid>").
 * References are self-describing, so documents stored in the database remain
 * readable even after Azure storage is configured later.
 */
export async function storeDocument(
  settings: AzureSettings,
  pdf: Buffer,
  originalName: string,
  ownership: DocumentOwnership,
): Promise<string> {
  const storageRef = settings.storageConnectionString ? await uploadToAzure(settings, pdf, originalName) : null;
  const [row] = await db
    .insert(storedDocumentsTable)
    .values({
      name: originalName, content: storageRef ? null : pdf, storageRef,
      tenantId: ownership.tenantId, firmId: ownership.firmId, clientId: ownership.clientId,
      fileId: ownership.fileId, uploaderTenantId: ownership.tenantId, uploaderObjectId: ownership.uploaderObjectId,
    })
    .returning({ id: storedDocumentsTable.id });
  return `${DOCUMENT_PREFIX}${row.id}`;
}

/** Retrieve a stored PDF by its blob reference. Returns null if missing. */
export async function retrieveDocument(
  settings: AzureSettings,
  documentId: string,
  ownership: Pick<DocumentOwnership, "tenantId" | "firmId" | "clientId" | "fileId">,
): Promise<Buffer | null> {
  if (!documentId.startsWith(DOCUMENT_PREFIX)) return null;
  const id = documentId.slice(DOCUMENT_PREFIX.length);
  const [row] = await db.select({ content: storedDocumentsTable.content, storageRef: storedDocumentsTable.storageRef })
    .from(storedDocumentsTable).where(and(
      eq(storedDocumentsTable.id, id), eq(storedDocumentsTable.tenantId, ownership.tenantId),
      eq(storedDocumentsTable.firmId, ownership.firmId), eq(storedDocumentsTable.clientId, ownership.clientId),
      eq(storedDocumentsTable.fileId, ownership.fileId),
    ));
  if (!row) return null;
  return row.content ? Buffer.from(row.content) : row.storageRef ? downloadFromAzure(settings, row.storageRef) : null;
}

/** Check ownership without fetching potentially large private document bytes. */
export async function documentBelongsTo(
  documentId: string,
  ownership: Pick<DocumentOwnership, "tenantId" | "firmId" | "clientId" | "fileId">,
): Promise<boolean> {
  if (!documentId.startsWith(DOCUMENT_PREFIX)) return false;
  const [row] = await db.select({ id: storedDocumentsTable.id }).from(storedDocumentsTable).where(and(
    eq(storedDocumentsTable.id, documentId.slice(DOCUMENT_PREFIX.length)),
    eq(storedDocumentsTable.tenantId, ownership.tenantId), eq(storedDocumentsTable.firmId, ownership.firmId),
    eq(storedDocumentsTable.clientId, ownership.clientId), eq(storedDocumentsTable.fileId, ownership.fileId),
  )).limit(1);
  return !!row;
}

/** Snapshot Azure locators before a DB cascade removes owned document rows. */
export async function ownedStorageRefs(
  documentIds: string[],
  ownership: Pick<DocumentOwnership, "tenantId" | "firmId" | "clientId" | "fileId">,
): Promise<string[]> {
  const ids = [...new Set(documentIds.filter((value) => value.startsWith(DOCUMENT_PREFIX)).map((value) => value.slice(DOCUMENT_PREFIX.length)))];
  if (!ids.length) return [];
  const rows = await db.select({ storageRef: storedDocumentsTable.storageRef }).from(storedDocumentsTable).where(and(
    inArray(storedDocumentsTable.id, ids), eq(storedDocumentsTable.tenantId, ownership.tenantId),
    eq(storedDocumentsTable.firmId, ownership.firmId), eq(storedDocumentsTable.clientId, ownership.clientId),
    eq(storedDocumentsTable.fileId, ownership.fileId),
  ));
  return rows.flatMap((row) => row.storageRef ? [row.storageRef] : []);
}

export async function deleteExternalStorageRefsSafe(settings: AzureSettings, refs: string[]): Promise<void> {
  if (!settings.storageConnectionString) return;
  await Promise.all(refs.map((ref) => deleteFromAzureSafe(settings, ref)));
}

/** Best-effort delete of a stored PDF; never throws. */
export async function deleteDocumentRefSafe(settings: AzureSettings, documentId: string, ownership?: Pick<DocumentOwnership, "tenantId" | "firmId" | "clientId" | "fileId">): Promise<void> {
  if (!ownership || !documentId.startsWith(DOCUMENT_PREFIX)) return;
  const id = documentId.slice(DOCUMENT_PREFIX.length);
  try {
    const [row] = await db.select({ storageRef: storedDocumentsTable.storageRef }).from(storedDocumentsTable).where(and(
      eq(storedDocumentsTable.id, id), eq(storedDocumentsTable.tenantId, ownership.tenantId),
      eq(storedDocumentsTable.firmId, ownership.firmId), eq(storedDocumentsTable.clientId, ownership.clientId), eq(storedDocumentsTable.fileId, ownership.fileId),
    ));
    if (!row) return;
    await db.delete(storedDocumentsTable).where(eq(storedDocumentsTable.id, id));
    if (row.storageRef && settings.storageConnectionString) await deleteFromAzureSafe(settings, row.storageRef);
  } catch {
    // Orphaned rows are acceptable; deletion is best-effort.
  }
}
