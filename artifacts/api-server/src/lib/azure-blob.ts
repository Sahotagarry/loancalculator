import { BlobServiceClient } from "@azure/storage-blob";
import { UserFacingError, type AzureSettings } from "./azure-settings";

const CONTAINER = "loan-documents";

function getContainerClient(settings: AzureSettings) {
  try {
    const service = BlobServiceClient.fromConnectionString(settings.storageConnectionString);
    return service.getContainerClient(CONTAINER);
  } catch {
    throw new UserFacingError(
      "The Azure Storage connection string looks invalid. Check it on the Settings page.",
      502,
    );
  }
}

/** Upload a PDF and return the blob name used to retrieve it later. */
export async function uploadDocument(settings: AzureSettings, pdf: Buffer, originalName: string): Promise<string> {
  const container = getContainerClient(settings);
  try {
    await container.createIfNotExists();
    const safeName = originalName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 100);
    const blobName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
    const blob = container.getBlockBlobClient(blobName);
    await blob.uploadData(pdf, { blobHTTPHeaders: { blobContentType: "application/pdf" } });
    return blobName;
  } catch (err) {
    if (err instanceof UserFacingError) throw err;
    throw new UserFacingError(
      "Couldn't store the PDF in Azure Blob Storage. Check the storage connection string on the Settings page.",
      502,
    );
  }
}

/** Download a stored PDF. Returns null if the blob no longer exists. */
export async function downloadDocument(settings: AzureSettings, blobName: string): Promise<Buffer | null> {
  const container = getContainerClient(settings);
  try {
    const blob = container.getBlockBlobClient(blobName);
    if (!(await blob.exists())) return null;
    return await blob.downloadToBuffer();
  } catch {
    throw new UserFacingError("Couldn't retrieve the document from Azure Blob Storage.", 502);
  }
}

/** Best-effort delete; never throws. */
export async function deleteDocumentSafe(settings: AzureSettings, blobName: string): Promise<void> {
  try {
    const container = getContainerClient(settings);
    await container.getBlockBlobClient(blobName).deleteIfExists();
  } catch {
    // Orphaned blobs are acceptable; deletion is best-effort.
  }
}
