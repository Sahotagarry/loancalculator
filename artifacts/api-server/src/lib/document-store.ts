import { eq } from "drizzle-orm";
import { db, storedDocumentsTable } from "@workspace/db";
import type { AzureSettings } from "./azure-settings";
import {
  uploadDocument as uploadToAzure,
  downloadDocument as downloadFromAzure,
  deleteDocumentSafe as deleteFromAzureSafe,
} from "./azure-blob";

const DB_PREFIX = "db:";

/**
 * Store a PDF and return a blob reference.
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
): Promise<string> {
  if (settings.storageConnectionString) {
    return uploadToAzure(settings, pdf, originalName);
  }
  const [row] = await db
    .insert(storedDocumentsTable)
    .values({ name: originalName, content: pdf })
    .returning({ id: storedDocumentsTable.id });
  return `${DB_PREFIX}${row.id}`;
}

/** Retrieve a stored PDF by its blob reference. Returns null if missing. */
export async function retrieveDocument(
  settings: AzureSettings,
  blobRef: string,
): Promise<Buffer | null> {
  if (blobRef.startsWith(DB_PREFIX)) {
    const id = blobRef.slice(DB_PREFIX.length);
    const [row] = await db
      .select({ content: storedDocumentsTable.content })
      .from(storedDocumentsTable)
      .where(eq(storedDocumentsTable.id, id));
    return row ? Buffer.from(row.content) : null;
  }
  return downloadFromAzure(settings, blobRef);
}

/** Best-effort delete of a stored PDF; never throws. */
export async function deleteDocumentRefSafe(settings: AzureSettings, blobRef: string): Promise<void> {
  if (blobRef.startsWith(DB_PREFIX)) {
    const id = blobRef.slice(DB_PREFIX.length);
    try {
      await db.delete(storedDocumentsTable).where(eq(storedDocumentsTable.id, id));
    } catch {
      // Orphaned rows are acceptable; deletion is best-effort.
    }
    return;
  }
  if (settings.storageConnectionString) {
    await deleteFromAzureSafe(settings, blobRef);
  }
}
